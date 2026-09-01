import test from "node:test";
import assert from "node:assert/strict";
import { DATA_SCHEMA_VERSION, migrateUserData } from "../src/lib/schema.js";
import { DOMAIN_FIELDS, domainsForPatch, buildDomainRows, mergeDomainRows, pickDataForKeys, mergePendingPayload, mergeRemoteWithPending } from "../src/lib/syncDomains.js";

test("migrateUserData normaliza dados legados sem apagar coleções", () => {
  const migrated = migrateUserData({
    mealLog: [{ id: "m1", name: "Arroz" }],
    tasks: [{ id: "t1", title: "Teste" }],
    profile: { name: "Gabriel" },
  });

  assert.equal(migrated.schemaVersion, DATA_SCHEMA_VERSION);
  assert.equal(migrated.mealLog[0].consumed, true);
  assert.equal(migrated.tasks[0].estimatedMinutes, 0);
  assert.deepEqual(migrated.tasks[0].completionDates, []);
  assert.equal(migrated.profile.name, "Gabriel");
});

test("domainsForPatch retorna somente os domínios alterados", () => {
  assert.deepEqual(domainsForPatch({ tasks: [] }), ["tasks"]);
  assert.deepEqual(domainsForPatch({ mealLog: [], foods: [] }), ["diet"]);
  assert.deepEqual(domainsForPatch({ profile: {}, transactions: [] }).sort(), ["account", "finance"]);
});

test("buildDomainRows separa payload por domínio", () => {
  const rows = buildDomainRows(
    "00000000-0000-0000-0000-000000000001",
    { tasks: [{ id: "1" }], mealLog: [{ id: "2" }], foods: [], schemaVersion: 4 },
    ["tasks", "diet"],
    "2026-08-26T12:00:00.000Z"
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((row) => row.domain === "tasks").data.tasks, [{ id: "1" }]);
  assert.deepEqual(rows.find((row) => row.domain === "diet").data.mealLog, [{ id: "2" }]);
});

test("mergeDomainRows preserva o updated_at mais recente", () => {
  const merged = mergeDomainRows([
    { domain: "tasks", data: { tasks: [{ id: "a" }] }, updated_at: "2026-08-25T10:00:00.000Z" },
    { domain: "diet", data: { mealLog: [{ id: "b" }] }, updated_at: "2026-08-26T10:00:00.000Z" },
  ]);
  assert.equal(merged.tasks[0].id, "a");
  assert.equal(merged.mealLog[0].id, "b");
  assert.equal(merged.__syncUpdatedAt, "2026-08-26T10:00:00.000Z");
});


test("pickDataForKeys reduz o payload ao domínio alterado", () => {
  const picked = pickDataForKeys({ tasks:[{id:"t"}], foods:[{id:"f"}], mealLog:[], schemaVersion:4, __syncUpdatedAt:"x" }, ["tasks"]);
  assert.deepEqual(picked.tasks, [{id:"t"}]);
  assert.equal("foods" in picked, false);
  assert.equal(picked.schemaVersion, 4);
});


test("mergePendingPayload preserva uma alteração rápida anterior em outro campo do mesmo domínio", () => {
  const first = mergePendingPayload(null, {
    foods: [{ id: "f-old" }],
    mealLog: [{ id: "meal-new" }],
    tasks: [],
    schemaVersion: 4,
    __syncDomainUpdatedAt: { diet: "2026-08-31T10:00:00.000Z" },
  }, ["mealLog"]);

  const second = mergePendingPayload(first, {
    foods: [{ id: "food-new" }],
    mealLog: [], // snapshot do mesmo render ainda estava antigo
    tasks: [],
    schemaVersion: 4,
    __syncDomainUpdatedAt: { diet: "2026-08-31T10:00:00.000Z" },
  }, ["foods"]);

  assert.deepEqual(second.changedKeys.sort(), ["foods", "mealLog"]);
  assert.deepEqual(second.data.mealLog, [{ id: "meal-new" }]);
  assert.deepEqual(second.data.foods, [{ id: "food-new" }]);
});

test("mergeRemoteWithPending reaplica somente campos locais ainda não sincronizados", () => {
  const remote = {
    tasks: [{ id: "remote-task" }],
    workoutSessions: [{ id: "remote-session" }],
    workoutTemplates: [{ id: "remote-template" }],
    schemaVersion: 4,
    __syncUpdatedAt: "2026-08-31T11:00:00.000Z",
    __syncDomainUpdatedAt: { tasks: "2026-08-31T11:00:00.000Z", workouts: "2026-08-31T11:00:00.000Z" },
  };
  const pending = {
    data: {
      tasks: [{ id: "local-task" }],
      workoutSessions: [{ id: "stale-local-session" }],
      workoutTemplates: [{ id: "stale-local-template" }],
      schemaVersion: 4,
    },
    changedKeys: ["tasks"],
  };
  const merged = mergeRemoteWithPending(remote, pending);
  assert.deepEqual(merged.tasks, [{ id: "local-task" }]);
  assert.deepEqual(merged.workoutSessions, [{ id: "remote-session" }]);
  assert.deepEqual(merged.workoutTemplates, [{ id: "remote-template" }]);
  assert.equal(merged.__syncUpdatedAt, "2026-08-31T11:00:00.000Z");
});

import { mergeEntityArray3Way, mergeRemoteWithPendingV3, mergePendingPayloadV3, rebasePendingV3 } from "../src/lib/syncV3.js";

test("sync v3 preserva tarefa criada no mobile e tarefa criada no desktop", () => {
  const base = [
    { id: "a", title: "Preparar estratégias", status: "pendente" },
  ];
  const mobile = [
    { id: "a", title: "Preparar estratégias", status: "pendente" },
    { id: "m", title: "TESTE", taskTime: "15:53", status: "pendente" },
  ];
  const desktop = [
    { id: "a", title: "Preparar estratégias", status: "pendente" },
    { id: "d", title: "Preencher grupo de entradas", taskTime: "16:00", status: "pendente" },
  ];
  const merged = mergeEntityArray3Way(base, mobile, desktop);
  assert.deepEqual(new Set(merged.map((item) => item.id)), new Set(["a", "m", "d"]));
});

test("sync v3 respeita exclusão local quando remoto não alterou o item", () => {
  const base = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
  const local = [{ id: "a", title: "A" }];
  const remote = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  const merged = mergeEntityArray3Way(base, local, remote);
  assert.deepEqual(merged.map((item) => item.id), ["a", "c"]);
});

test("sync v3 rebase usa servidor como nova base e mantém alteração pendente", () => {
  const pending = mergePendingPayloadV3(null, {
    tasks: [{ id: "a" }, { id: "m", title: "TESTE" }],
    schemaVersion: 4,
  }, ["tasks"], { tasks: [{ id: "a" }] }, { tasks: 7 });
  const remote = {
    tasks: [{ id: "a" }, { id: "d", title: "Desktop" }],
    schemaVersion: 4,
    __syncRevision: 9,
    __syncFieldRevisions: { tasks: 9 },
  };
  const visible = mergeRemoteWithPendingV3(remote, pending);
  assert.deepEqual(new Set(visible.tasks.map((item) => item.id)), new Set(["a", "d", "m"]));
  const rebased = rebasePendingV3(remote, pending);
  assert.equal(rebased.baseFieldRevisions.tasks, 9);
  assert.notEqual(rebased.mutationId, pending.mutationId);
});

test("sync v3 cobre todos os campos persistentes da conta", () => {
  const persisted = new Set(Object.values(DOMAIN_FIELDS).flat());
  const expected = [
    "profile","habits","completions","tasks","goals","unlocked",
    "workoutTemplates","workoutSessions","foods","mealLog","transactions",
    "goalProgressLog","habitChecklistLog",
  ];
  assert.deepEqual(new Set(expected), persisted);
});

import { buildTaskOpsV4, applyTaskOpsToList } from "../src/lib/taskSyncV4.js";

test("task sync v4 não apaga tarefa criada em outro dispositivo sem conhecê-la", () => {
  const baseDesktop = [{ id: "a", title: "Existente" }];
  const desiredDesktop = [{ id: "a", title: "Existente" }, { id: "desktop", title: "Desktop" }];
  const opsDesktop = buildTaskOpsV4(baseDesktop, desiredDesktop, { a: 1 });
  assert.deepEqual(opsDesktop.map((op) => [op.op, op.id]), [["upsert", "desktop"]]);

  const serverAfterMobile = [{ id: "a", title: "Existente" }, { id: "mobile", title: "Mobile" }];
  const merged = applyTaskOpsToList(serverAfterMobile, opsDesktop);
  assert.deepEqual(new Set(merged.map((task) => task.id)), new Set(["a", "mobile", "desktop"]));
});

test("task sync v4 gera delete somente para item conhecido na última base do cliente", () => {
  const base = [{ id: "a" }, { id: "b" }];
  const desired = [{ id: "a" }];
  const ops = buildTaskOpsV4(base, desired, { a: 2, b: 4 });
  assert.deepEqual(ops, [{ op: "delete", id: "b", baseRevision: 4 }]);
});

test("task sync v5 rebase preserva tarefa remota criada enquanto havia alteração local pendente", () => {
  const base = [{ id: "a", title: "A" }];
  const localDesired = [{ id: "a", title: "A" }, { id: "m", title: "Mobile" }];
  const remoteNow = [{ id: "a", title: "A" }, { id: "d", title: "Desktop" }];
  const rebasedDesired = mergeEntityArray3Way(base, localDesired, remoteNow);
  const ops = buildTaskOpsV4(remoteNow, rebasedDesired, { a: 1, d: 1 });
  assert.deepEqual(new Set(rebasedDesired.map((task) => task.id)), new Set(["a", "m", "d"]));
  assert.deepEqual(ops.map((op) => [op.op, op.id]), [["upsert", "m"]]);
});

test("task sync v5 rebase mantém exclusão local e não apaga item remoto desconhecido", () => {
  const base = [{ id: "a" }, { id: "b" }];
  const localDesired = [{ id: "a" }]; // b foi excluída localmente
  const remoteNow = [{ id: "a" }, { id: "b" }, { id: "c" }]; // c nasceu no outro dispositivo
  const rebasedDesired = mergeEntityArray3Way(base, localDesired, remoteNow);
  const ops = buildTaskOpsV4(remoteNow, rebasedDesired, { a: 1, b: 2, c: 1 });
  assert.deepEqual(rebasedDesired.map((task) => task.id), ["a", "c"]);
  assert.deepEqual(ops, [{ op: "delete", id: "b", baseRevision: 2 }]);
});

import { compactTaskOutbox, applyTaskOutbox, makeTaskUpsert, makeTaskDelete } from "../src/lib/taskSyncV6.js";

test("task sync v6 compacta múltiplas edições da mesma tarefa em uma mutação", () => {
  const first = makeTaskUpsert({ id: "t1", title: "A", taskTime: "10:00" }, 3, "m1");
  const second = makeTaskUpsert({ id: "t1", title: "B", taskTime: "10:00" }, 3, "m2");
  const outbox = compactTaskOutbox([first, second]);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].payload.title, "B");
  assert.equal(outbox[0].baseRevision, 3);
});

test("task sync v6 mantém criação em outro dispositivo ao aplicar outbox local", () => {
  const remote = [
    { id: "mac", title: "Mac", taskTime: "10:00" },
    { id: "mobile", title: "Mobile", taskTime: "11:00" },
  ];
  const outbox = [makeTaskUpsert({ id: "local", title: "Local", taskTime: "12:00" }, 0, "m-local")];
  const visible = applyTaskOutbox(remote, outbox);
  assert.deepEqual(new Set(visible.map((t) => t.id)), new Set(["mac", "mobile", "local"]));
});

test("task sync v6 delete local remove somente o item alvo", () => {
  const remote = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const visible = applyTaskOutbox(remote, [makeTaskDelete("b", 2, "del-b")]);
  assert.deepEqual(visible.map((t) => t.id), ["a", "c"]);
});

import { ROUTINE_COLLECTIONS, buildRoutineOps, compactRoutineOutbox, applyRoutineOutbox, mergeRoutineBootstrap } from "../src/lib/routineSyncV1.js";

test("1.1.28 hábitos atômicos preservam conclusão criada no celular", () => {
  const remote = {
    habits: [{ id: "h1", name: "Água" }],
    completions: [],
    habitChecklistLog: [],
    workoutTemplates: [],
    workoutSessions: [],
  };
  const local = {
    ...remote,
    completions: [{ id: "c1", habitId: "h1", date: "2026-08-31" }],
  };
  const ops = buildRoutineOps(remote, local, {}, ["completions"]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].collection, ROUTINE_COLLECTIONS.completions);
  assert.equal(ops[0].op, "upsert");
  const visible = applyRoutineOutbox(remote, compactRoutineOutbox(ops));
  assert.equal(visible.completions.length, 1);
  assert.equal(visible.completions[0].habitId, "h1");
});

test("1.1.28 exclusão de hábito gera operação somente para o hábito alvo", () => {
  const remote = {
    habits: [{ id: "h1", name: "Água" }, { id: "h2", name: "Ler" }],
    completions: [], habitChecklistLog: [], workoutTemplates: [], workoutSessions: [],
  };
  const desired = { ...remote, habits: [{ id: "h1", name: "Água" }] };
  const ops = buildRoutineOps(remote, desired, { "habit:h2": 4 }, ["habits"]);
  assert.deepEqual(ops.map((op) => [op.op, op.id, op.baseRevision]), [["delete", "h2", 4]]);
});

test("1.1.28 migração de treino mantém conclusão local contra snapshot remoto incompleto", () => {
  const remote = {
    habits: [], completions: [], habitChecklistLog: [], workoutTemplates: [],
    workoutSessions: [{ id: "s1", completed: false, sets: { e1: [true, false, false] }, loads: { e1: 20 } }],
  };
  const local = {
    habits: [], completions: [], habitChecklistLog: [], workoutTemplates: [],
    workoutSessions: [{ id: "s1", completed: true, completedAt: "2026-08-31T22:30:00.000Z", sets: { e1: [true, true, true] }, loads: { e1: 25 } }],
  };
  const merged = mergeRoutineBootstrap(remote, local);
  assert.equal(merged.workoutSessions[0].completed, true);
  assert.deepEqual(merged.workoutSessions[0].sets.e1, [true, true, true]);
  assert.equal(merged.workoutSessions[0].loads.e1, 25);
});
