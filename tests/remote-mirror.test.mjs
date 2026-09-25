import test from "node:test";
import assert from "node:assert/strict";
import {
  DELTA_OVERLAP_MS,
  FULL_RESYNC_MS,
  parseServerTimestamp,
  mergeMirrorRows,
  mirrorRows,
  deltaCursor,
  needsFullResync,
  serverTimeFromHeaders,
} from "../src/lib/remoteMirror.js";
import { atomicTasksFromRows } from "../src/lib/taskSyncV6.js";

// Antes, os polls de 3s de tarefas e de hábitos/treinos baixavam a tabela
// inteira da conta (inclusive todo o histórico de conclusões). Agora pedem só
// `updated_at >= cursor` e juntam num espelho local.

const key = (row) => row.task_id;
const row = (id, revision, updatedAt, extra = {}) => ({ task_id: id, revision, updated_at: updatedAt, deleted_at: null, payload: { id, rev: revision }, ...extra });

test("parseServerTimestamp entende microssegundos do Postgres", () => {
  assert.equal(parseServerTimestamp("2026-09-25T13:51:11.123456+00:00"), Date.parse("2026-09-25T13:51:11.123Z"));
  assert.ok(Number.isNaN(parseServerTimestamp(null)));
});

test("mergeMirrorRows junta por maior revisão e conta só o que mudou", () => {
  let { mirror, changed } = mergeMirrorRows({}, [row("a", 1, "2026-09-25T10:00:00Z"), row("b", 1, "2026-09-25T10:00:01Z")], key);
  assert.equal(changed, 2);

  ({ mirror, changed } = mergeMirrorRows(mirror, [row("a", 1, "2026-09-25T10:00:00Z")], key));
  assert.equal(changed, 0, "releitura idêntica (margem do cursor) não conta como mudança");

  ({ mirror, changed } = mergeMirrorRows(mirror, [row("a", 3, "2026-09-25T10:05:00Z"), row("b", 0, "2026-09-25T09:00:00Z")], key));
  assert.equal(changed, 1);
  assert.equal(mirror.a.revision, 3);
  assert.equal(mirror.b.revision, 1, "resposta atrasada não faz a linha regredir");
});

test("exclusão remota chega pela leitura incremental como tombstone", () => {
  let { mirror } = mergeMirrorRows({}, [row("a", 1, "2026-09-25T10:00:00Z"), row("b", 1, "2026-09-25T10:00:00Z")], key);
  ({ mirror } = mergeMirrorRows(mirror, [row("b", 2, "2026-09-25T10:01:00Z", { deleted_at: "2026-09-25T10:01:00Z" })], key));
  const view = atomicTasksFromRows(mirrorRows(mirror));
  assert.deepEqual(view.tasks.map((t) => t.id), ["a"]);
  assert.equal(view.taskRevisions.b, 2, "a revisão do tombstone continua visível pra trava de tarefas");
});

test("deltaCursor recua a margem a partir da linha mais nova; espelho vazio pede leitura completa", () => {
  assert.equal(deltaCursor({}), null);
  const { mirror } = mergeMirrorRows({}, [row("a", 1, "2026-09-25T10:00:00.500000+00:00"), row("b", 1, "2026-09-25T09:00:00Z")], key);
  assert.equal(deltaCursor(mirror), new Date(Date.parse("2026-09-25T10:00:00.500Z") - DELTA_OVERLAP_MS).toISOString());
});

test("deltaCursor ancorado na hora do servidor da leitura anterior não relê linhas antigas agrupadas", () => {
  // Migração gravou 3.000 linhas no mesmo segundo: ancorar na linha mais nova
  // relia todas a cada poll. Ancorado na leitura anterior, a janela fica vazia.
  const rows = Array.from({ length: 3000 }, (_, i) => row(`c${i}`, 1, "2026-01-01T00:00:00Z"));
  const { mirror } = mergeMirrorRows({}, rows, key);
  const readAt = Date.parse("2026-09-25T10:00:00Z");
  const cursor = deltaCursor(mirror, { readAt });
  assert.equal(cursor, new Date(readAt - DELTA_OVERLAP_MS).toISOString());
  assert.equal(rows.filter((r) => Date.parse(r.updated_at) >= Date.parse(cursor)).length, 0);
  assert.equal(deltaCursor({}, { readAt }), null, "espelho vazio continua exigindo leitura completa");
});

test("serverTimeFromHeaders lê o cabeçalho Date", () => {
  assert.equal(serverTimeFromHeaders(new Headers({ date: "Fri, 25 Sep 2026 13:51:12 GMT" })), Date.parse("2026-09-25T13:51:12Z"));
  assert.ok(Number.isNaN(serverTimeFromHeaders(new Headers())));
});

test("needsFullResync: primeira leitura, forçada ou a cada FULL_RESYNC_MS", () => {
  const mirror = { a: row("a", 1, "2026-09-25T10:00:00Z") };
  assert.equal(needsFullResync({ mirror: {}, lastFullAt: Date.now() }), true);
  assert.equal(needsFullResync({ mirror, lastFullAt: 1000, now: 1000 + FULL_RESYNC_MS - 1 }), false);
  assert.equal(needsFullResync({ mirror, lastFullAt: 1000, now: 1000 + FULL_RESYNC_MS }), true);
  assert.equal(needsFullResync({ mirror, lastFullAt: Date.now(), force: true }), true);
});

// Simulação: servidor com updated_at = início da transação e visibilidade só
// no commit (escritas podem comitar fora de ordem). O cliente faz só leituras
// incrementais depois da primeira; o espelho tem que convergir pro estado real.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("simulação: só leituras incrementais convergem pro estado do servidor (commits fora de ordem, exclusões)", () => {
  for (const anchor of ["readAt", "maxRow"]) for (let seed = 1; seed <= 300; seed += 1) {
    const random = rng(seed);
    const base = Date.parse("2026-09-25T10:00:00Z");
    const committed = new Map(); // id -> row visível
    const pending = []; // escritas iniciadas e ainda não comitadas
    let clock = 0;
    let mirror = {};
    let readAt = null;

    const read = (fullRead) => {
      const since = fullRead ? null : deltaCursor(mirror, anchor === "readAt" ? { readAt } : {});
      readAt = base + clock;
      const sinceMs = since ? Date.parse(since) : -Infinity;
      const rows = [...committed.values()].filter((r) => parseServerTimestamp(r.updated_at) >= sinceMs).map((r) => structuredClone(r));
      ({ mirror } = mergeMirrorRows(mirror, rows, key));
    };

    read(true);
    for (let step = 0; step < 120; step += 1) {
      clock += Math.floor(random() * 4000);
      const action = random();
      if (action < 0.45) {
        // Inicia uma escrita: updated_at fica no início; comita até 20s depois.
        const id = `t${Math.floor(random() * 12)}`;
        pending.push({ id, startedAt: clock, commitAt: clock + Math.floor(random() * 20000), remove: random() < 0.15 });
      } else if (action < 0.8) {
        read(false);
      }
      for (const write of pending.filter((w) => w.commitAt <= clock)) {
        const previous = committed.get(write.id);
        const revision = (previous?.revision || 0) + 1;
        const at = new Date(base + write.startedAt).toISOString();
        committed.set(write.id, row(write.id, revision, at, write.remove ? { deleted_at: at } : {}));
        pending.splice(pending.indexOf(write), 1);
      }
    }
    for (const write of pending) {
      const previous = committed.get(write.id);
      const at = new Date(base + write.startedAt).toISOString();
      committed.set(write.id, row(write.id, (previous?.revision || 0) + 1, at, write.remove ? { deleted_at: at } : {}));
    }
    read(false);

    const expected = atomicTasksFromRows([...committed.values()]);
    const actual = atomicTasksFromRows(mirrorRows(mirror));
    assert.deepEqual(actual.taskRevisions, expected.taskRevisions, `${anchor} seed ${seed}`);
    assert.deepEqual(actual.tasks.map((t) => t.id).sort(), expected.tasks.map((t) => t.id).sort(), `${anchor} seed ${seed}`);
  }
});

import { confirmedEntityRow, routineFieldsFromRows } from "../src/lib/routineSyncV1.js";

test("hábito: conclusão confirmada não some com uma leitura que saiu antes do commit", () => {
  const routineKey = (r) => `${r.collection}:${r.entity_id}`;
  const habit = { collection: "habit", entity_id: "h1", payload: { id: "h1", name: "Ler" }, revision: 1, deleted_at: null, updated_at: "2026-09-25T09:00:00Z" };
  let { mirror } = mergeMirrorRows({}, [habit], routineKey);

  // Marca hoje → RPC confirma → op sai da outbox; a linha confirmada entra no espelho.
  const op = { op: "upsert", collection: "habit_completion", id: "c1", payload: { id: "c1", habitId: "h1", date: "2026-09-25" } };
  const row = confirmedEntityRow(op, { applied: true, collection: "habit_completion", entity_id: "c1", revision: 1, updated_at: "2026-09-25T10:00:00Z" });
  ({ mirror } = mergeMirrorRows(mirror, [row], routineKey));

  // Leitura incremental que saiu antes do commit: não traz a conclusão.
  ({ mirror } = mergeMirrorRows(mirror, [], routineKey));
  assert.deepEqual(routineFieldsFromRows(mirrorRows(mirror)).completions.map((c) => c.id), ["c1"]);

  // Desmarcar: delete confirmado vira tombstone e a conclusão sai.
  const del = confirmedEntityRow({ op: "delete", collection: "habit_completion", id: "c1" }, { applied: true, collection: "habit_completion", entity_id: "c1", revision: 2, deleted_at: "2026-09-25T10:01:00Z", updated_at: "2026-09-25T10:01:00Z", entity: null });
  ({ mirror } = mergeMirrorRows(mirror, [del], routineKey));
  // …e uma leitura velha (revisão 1) não a ressuscita.
  ({ mirror } = mergeMirrorRows(mirror, [{ ...row }], routineKey));
  assert.deepEqual(routineFieldsFromRows(mirrorRows(mirror)).completions, []);
});

test("confirmedEntityRow: duplicate usa o estado atual do servidor; sem revisão não gera linha", () => {
  const op = { op: "upsert", collection: "habit", id: "h1", payload: { id: "h1", name: "Antigo" } };
  const dup = confirmedEntityRow(op, { duplicate: true, collection: "habit", entity_id: "h1", revision: 5, entity: { id: "h1", name: "Atual" }, updated_at: "2026-09-25T10:00:00Z" });
  assert.equal(dup.payload.name, "Atual");
  assert.equal(confirmedEntityRow(op, { duplicate: true, revision: 0 }), null);
});
