import test from "node:test";
import assert from "node:assert/strict";
import {
  compactTaskOutbox,
  applyTaskOutbox,
  makeTaskUpsert,
  makeTaskDelete,
  recordConfirmedTaskWrite,
  mergeTaskRevisions,
  reconcileRemoteTasks,
  settleSentTaskOp,
} from "../src/lib/taskSyncV6.js";

// Bug relatado (2026-09): marcar uma tarefa como concluída às vezes fazia ela
// "voltar" pra pendente por ~1-2s (concluída → pendente → concluída). Causa:
// leituras remotas (pull do foco/poll, POST genérico disparado pelo XP da
// própria conclusão) tiram o snapshot ANTES do RPC da tarefa comitar e chegam
// DEPOIS que o op já saiu da outbox — sem outbox, nada protegia a tarefa.

const status = (tasks, id = "t1") => tasks.find((task) => task.id === id)?.status ?? "ausente";

test("snapshot atrasado não reverte uma escrita já confirmada (e já fora da outbox)", () => {
  const op = makeTaskUpsert({ id: "t1", title: "Lavar louça", status: "concluida" }, 3, "m1");
  const known = recordConfirmedTaskWrite({}, op, { task_id: "t1", revision: 4, task: op.payload });

  const result = reconcileRemoteTasks({
    remoteTasks: [{ id: "t1", title: "Lavar louça", status: "pendente" }],
    remoteRevisions: { t1: 3 },
    outbox: [],
    known,
  });

  assert.equal(status(result.tasks), "concluida");
  assert.deepEqual(result.heldTaskIds, ["t1"]);
  assert.equal(result.known.t1.revision, 4);
});

test("leitura nova chegando ANTES de uma velha não abre brecha pra velha reverter", () => {
  // Achado pela simulação: pull final (rev 4) chega, depois uma leitura do foco
  // que tinha saído antes do RPC (rev 3) chega por último.
  const op = makeTaskUpsert({ id: "t1", status: "concluida" }, 3, "m1");
  let known = recordConfirmedTaskWrite({}, op, { task_id: "t1", revision: 4, task: op.payload });
  const fresh = reconcileRemoteTasks({ remoteTasks: [{ id: "t1", status: "concluida" }], remoteRevisions: { t1: 4 }, known });
  known = fresh.known;
  const late = reconcileRemoteTasks({ remoteTasks: [{ id: "t1", status: "pendente" }], remoteRevisions: { t1: 3 }, known });
  assert.equal(status(late.tasks), "concluida");
});

test("edição de outro aparelho (revisão maior) chega normalmente depois de uma escrita local", () => {
  const op = makeTaskUpsert({ id: "t1", status: "concluida" }, 3, "m1");
  const known = recordConfirmedTaskWrite({}, op, { task_id: "t1", revision: 4, task: op.payload });
  const otherDevice = reconcileRemoteTasks({ remoteTasks: [{ id: "t1", status: "pendente" }], remoteRevisions: { t1: 5 }, known });
  assert.equal(status(otherDevice.tasks), "pendente");
  assert.equal(otherDevice.known.t1.revision, 5);
  assert.deepEqual(otherDevice.heldTaskIds, []);
});

test("sem nenhuma escrita local, leituras fora de ordem também não regridem (ex.: foco + poll)", () => {
  const first = reconcileRemoteTasks({ remoteTasks: [{ id: "t1", status: "concluida" }], remoteRevisions: { t1: 7 } });
  const stale = reconcileRemoteTasks({ remoteTasks: [{ id: "t1", status: "pendente" }], remoteRevisions: { t1: 6 }, known: first.known });
  assert.equal(status(stale.tasks), "concluida");
});

test("exclusão remota (tombstone com revisão maior) remove a tarefa mesmo com escrita local confirmada", () => {
  const op = makeTaskUpsert({ id: "t1", status: "concluida" }, 3, "m1");
  const known = recordConfirmedTaskWrite({}, op, { task_id: "t1", revision: 4, task: op.payload });
  // fetchAtomicTasksForUser devolve revisões também das linhas apagadas.
  const result = reconcileRemoteTasks({ remoteTasks: [], remoteRevisions: { t1: 5 }, known });
  assert.equal(status(result.tasks), "ausente");
});

test("tarefa recém-criada não some quando a leitura é anterior à criação", () => {
  const op = makeTaskUpsert({ id: "novo", title: "Nova", taskTime: "09:00" }, 0, "m1");
  const known = recordConfirmedTaskWrite({}, op, { task_id: "novo", revision: 1, task: op.payload });
  const result = reconcileRemoteTasks({ remoteTasks: [{ id: "t1" }], remoteRevisions: { t1: 3 }, known });
  assert.deepEqual(result.tasks.map((task) => task.id).sort(), ["novo", "t1"]);
});

test("tarefa recém-excluída não reaparece com uma leitura anterior à exclusão", () => {
  const op = makeTaskDelete("t1", 3, "m1");
  const known = recordConfirmedTaskWrite({}, op, { task_id: "t1", revision: 4, deleted_at: "2026-09-25T10:00:00Z", task: null });
  const result = reconcileRemoteTasks({ remoteTasks: [{ id: "t1", status: "pendente" }, { id: "t2" }], remoteRevisions: { t1: 3, t2: 1 }, known });
  assert.deepEqual(result.tasks.map((task) => task.id), ["t2"]);
});

test("tarefas novas de outro aparelho e mutações pendentes convivem com a trava", () => {
  const pending = makeTaskUpsert({ id: "t2", status: "concluida" }, 1, "m2");
  const result = reconcileRemoteTasks({
    remoteTasks: [{ id: "t1", status: "pendente" }, { id: "t2", status: "pendente" }, { id: "t3", title: "de outro aparelho" }],
    remoteRevisions: { t1: 3, t2: 1, t3: 1 },
    outbox: [pending],
    known: {},
  });
  assert.equal(status(result.tasks, "t2"), "concluida", "outbox continua vencendo");
  assert.equal(status(result.tasks, "t1"), "pendente");
  assert.ok(result.tasks.some((task) => task.id === "t3"));
});

test("leitura sem revisões (fallback) não derruba a proteção", () => {
  const op = makeTaskUpsert({ id: "t1", status: "concluida" }, 3, "m1");
  const known = recordConfirmedTaskWrite({}, op, { task_id: "t1", revision: 4, task: op.payload });
  const result = reconcileRemoteTasks({ remoteTasks: [{ id: "t1", status: "pendente" }], remoteRevisions: undefined, known });
  assert.equal(status(result.tasks), "concluida");
});

test("recordConfirmedTaskWrite usa o estado do servidor numa resposta duplicate e ignora resposta sem revisão", () => {
  const op = makeTaskUpsert({ id: "t1", status: "concluida" }, 3, "m1");
  const dup = recordConfirmedTaskWrite({}, op, { duplicate: true, task_id: "t1", revision: 6, task: { id: "t1", status: "pendente" } });
  assert.equal(dup.t1.task.status, "pendente");
  assert.equal(dup.t1.revision, 6);
  assert.deepEqual(recordConfirmedTaskWrite({}, op, { duplicate: true, task_id: "t1", revision: 0, task: null }), {});
  // Resposta atrasada de uma escrita mais antiga não sobrescreve um registro mais novo.
  assert.equal(recordConfirmedTaskWrite(dup, op, { task_id: "t1", revision: 5, task: op.payload }).t1.revision, 6);
});

test("settleSentTaskOp remove o op confirmado e rebaseia a edição mais nova da mesma tarefa", () => {
  const sent = makeTaskUpsert({ id: "t1", status: "concluida" }, 6, "m1");
  const newer = makeTaskUpsert({ id: "t1", status: "pendente" }, 6, "m2");
  const other = makeTaskUpsert({ id: "t2", status: "concluida" }, 2, "m3");
  const outbox = compactTaskOutbox([sent, newer, other]);

  const settled = settleSentTaskOp(outbox, sent, 7);
  assert.deepEqual(settled.map((op) => [op.id, op.mutationId, op.baseRevision]), [["t1", "m2", 7], ["t2", "m3", 2]]);

  const plain = settleSentTaskOp(compactTaskOutbox([sent, other]), sent, 7);
  assert.deepEqual(plain.map((op) => op.id), ["t2"]);

  const duplicate = settleSentTaskOp(outbox, sent, 0);
  assert.equal(duplicate[0].baseRevision, 6, "sem revisão confiável não mexe na base");
});

test("mergeTaskRevisions nunca regride uma revisão conhecida", () => {
  assert.deepEqual(mergeTaskRevisions({ a: 5, b: 2 }, { a: 4, b: 3, c: 1 }), { a: 5, b: 3, c: 1 });
  assert.deepEqual(mergeTaskRevisions({ a: 5 }, undefined), { a: 5 });
});

// ---------------------------------------------------------------------------
// Simulação do pipeline do App (mesmas funções puras que App.jsx usa) contra um
// servidor com latências aleatórias: cada leitura tira o snapshot num instante
// qualquer entre o envio e a resposta, e as respostas chegam fora de ordem.
// O modelo "ingênuo" reproduz o comportamento anterior (só a outbox protegia).
// ---------------------------------------------------------------------------

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

function simulate(seed, { guarded }) {
  const random = rng(seed);
  const between = (a, b) => a + Math.floor(random() * (b - a));
  const server = { payload: { id: "t1", title: "Lavar louça", status: "pendente" }, revision: 3 };
  const snapshot = () => ({ tasks: [structuredClone(server.payload)], revisions: { t1: server.revision } });

  const client = { visible: [structuredClone(server.payload)], outbox: [], known: {}, revisions: { t1: 3 } };
  const history = [];
  let intent = "pendente";
  let flushing = false;
  let mutationSeq = 0;
  const queue = [];
  const at = (time, fn) => queue.push({ time, fn, order: queue.length });

  const record = (time, source) => history.push({ time, source, visible: status(client.visible), intent });
  const applySnapshot = (snap) => {
    if (guarded) {
      const result = reconcileRemoteTasks({ remoteTasks: snap.tasks, remoteRevisions: snap.revisions, outbox: client.outbox, known: client.known });
      client.known = result.known;
      client.revisions = mergeTaskRevisions(client.revisions, snap.revisions);
      client.visible = result.tasks;
    } else {
      client.visible = applyTaskOutbox(snap.tasks, client.outbox);
      client.revisions = { ...snap.revisions };
    }
  };
  const read = (time, source) => {
    const snapAt = time + between(0, 300);
    const arriveAt = snapAt + between(5, 1200);
    let snap;
    at(snapAt, () => { snap = snapshot(); });
    at(arriveAt, () => { applySnapshot(snap); record(arriveAt, source); });
  };
  const flush = (time) => {
    if (flushing || !client.outbox.length) return;
    flushing = true;
    const op = compactTaskOutbox(client.outbox)[0];
    const commitAt = time + between(20, 400);
    const respondAt = commitAt + between(5, 300);
    let response;
    at(commitAt, () => {
      server.payload = structuredClone(op.payload);
      server.revision += 1;
      response = { task_id: op.id, revision: server.revision, task: structuredClone(op.payload) };
    });
    at(respondAt, () => {
      client.revisions = mergeTaskRevisions(client.revisions, { [op.id]: response.revision });
      if (guarded) client.known = recordConfirmedTaskWrite(client.known, op, response);
      client.outbox = guarded
        ? settleSentTaskOp(client.outbox, op, response.revision)
        : compactTaskOutbox(client.outbox).filter((item) => item.id !== op.id || item.mutationId !== op.mutationId);
      flushing = false;
      record(respondAt, "flush");
      if (client.outbox.length) flush(respondAt);
      else read(respondAt, "pull-final");
    });
  };
  const toggle = (time) => {
    intent = intent === "concluida" ? "pendente" : "concluida";
    const task = { ...client.visible.find((item) => item.id === "t1"), status: intent };
    const op = makeTaskUpsert(task, client.revisions.t1 || 0, `m${++mutationSeq}`);
    client.outbox = compactTaskOutbox([...client.outbox, op]);
    client.visible = client.visible.map((item) => (item.id === "t1" ? task : item));
    record(time, "toggle");
    at(time + 120, () => flush(time + 120));
  };

  let t = 0;
  for (let i = 0; i < 4; i += 1) { t += between(50, 900); const when = t; at(when, () => toggle(when)); }
  for (let i = 0; i < 12; i += 1) { const when = between(0, t + 1500); at(when, () => read(when, "poll/foco/genérica")); }

  while (queue.length) {
    queue.sort((a, b) => a.time - b.time || a.order - b.order);
    queue.shift().fn();
  }
  // Único escritor = este aparelho, então o estado visível tem que ser SEMPRE a última intenção.
  return history.filter((entry) => entry.visible !== entry.intent);
}

test("simulação: marca → leitura concorrente com snapshot velho → flush confirmado → pull final nunca passa por 'pendente'", () => {
  // Sequência determinística do bug relatado.
  const server = { payload: { id: "t1", status: "pendente" }, revision: 3 };
  const outbox = [];
  let known = {};
  const seen = [];
  const apply = (snap) => {
    const result = reconcileRemoteTasks({ remoteTasks: snap.tasks, remoteRevisions: snap.revisions, outbox, known });
    known = result.known;
    seen.push(status(result.tasks));
  };

  const staleSnap = { tasks: [structuredClone(server.payload)], revisions: { t1: 3 } }; // poll sai antes do clique
  const op = makeTaskUpsert({ id: "t1", status: "concluida" }, 3, "m1");
  outbox.push(op); seen.push("concluida"); // clique (otimista)
  apply(staleSnap); // snapshot velho chega com o op ainda na outbox
  server.payload = op.payload; server.revision = 4; // RPC comita
  known = recordConfirmedTaskWrite(known, op, { task_id: "t1", revision: 4, task: op.payload });
  outbox.length = 0; // removeSentOp
  apply(staleSnap); // POST genérico/foco com snapshot anterior ao RPC chega agora
  apply({ tasks: [structuredClone(server.payload)], revisions: { t1: 4 } }); // pull final

  assert.deepEqual(seen, ["concluida", "concluida", "concluida", "concluida"]);
  assert.equal(known.t1.revision, 4);
});

test("simulação com latências aleatórias: o modelo antigo pisca, o novo nunca", () => {
  const seeds = Array.from({ length: 400 }, (_, i) => i + 1);
  const naiveFlickers = seeds.filter((seed) => simulate(seed, { guarded: false }).length > 0);
  assert.ok(naiveFlickers.length > 20, `o modelo antigo deveria reproduzir o flicker (reproduziu em ${naiveFlickers.length}/400)`);

  for (const seed of seeds) {
    const violations = simulate(seed, { guarded: true });
    assert.deepEqual(violations, [], `seed ${seed}: estado visível divergiu da intenção do usuário`);
  }
});
