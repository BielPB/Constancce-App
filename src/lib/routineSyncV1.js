const clone = (value) => {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch (_) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
};

export const ROUTINE_COLLECTIONS = Object.freeze({
  habits: "habit",
  completions: "habit_completion",
  habitChecklistLog: "habit_checklist",
  workoutTemplates: "workout_template",
  workoutSessions: "workout_session",
});

export const ROUTINE_FIELDS = Object.freeze(Object.keys(ROUTINE_COLLECTIONS));

export function routineEntityId(collection, item = {}) {
  // Conclusões e checklist representam um estado lógico por hábito/data (e etapa).
  // Usar a chave composta antes do id aleatório impede que dois dispositivos
  // criem duas entidades diferentes para a mesma conclusão.
  if (collection === "habit_completion") {
    const habitId = String(item?.habitId || "").trim();
    const date = String(item?.date || "").trim();
    if (habitId && date) return `${habitId}:${date}`;
  }
  if (collection === "habit_checklist") {
    const habitId = String(item?.habitId || "").trim();
    const itemId = String(item?.itemId || "").trim();
    const date = String(item?.date || "").trim();
    if (habitId && itemId && date) return `${habitId}:${itemId}:${date}`;
  }
  const direct = String(item?.id || "").trim();
  return direct;
}

function withOrder(collection, item, index) {
  const payload = clone(item || {});
  return { ...payload, __syncOrder: Math.max(0, Number(index) || 0) };
}

function stripOrder(item) {
  if (!item || typeof item !== "object") return item;
  const { __syncOrder, ...rest } = item;
  return rest;
}

function samePayload(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
}

export function compactRoutineOutbox(entries = []) {
  const order = [];
  const byKey = new Map();
  for (const raw of Array.isArray(entries) ? entries : []) {
    const collection = String(raw?.collection || "").trim();
    const id = String(raw?.id || "").trim();
    const op = String(raw?.op || "").toLowerCase();
    if (!Object.values(ROUTINE_COLLECTIONS).includes(collection) || !id || !["upsert", "delete"].includes(op)) continue;
    const key = `${collection}:${id}`;
    if (!byKey.has(key)) order.push(key);
    const previous = byKey.get(key);
    byKey.set(key, {
      collection,
      op,
      id,
      payload: op === "upsert" ? clone(raw?.payload || {}) : undefined,
      baseRevision: Number(previous?.baseRevision ?? raw?.baseRevision ?? 0) || 0,
      mutationId: String(raw?.mutationId || previous?.mutationId || ""),
      queuedAt: raw?.queuedAt || previous?.queuedAt || new Date().toISOString(),
    });
  }
  return order.map((key) => byKey.get(key)).filter(Boolean);
}

export function buildCollectionOps(collection, previous = [], next = [], revisions = {}) {
  const prevMap = new Map();
  const nextMap = new Map();
  (Array.isArray(previous) ? previous : []).forEach((item, index) => {
    const id = routineEntityId(collection, item);
    if (id) prevMap.set(id, withOrder(collection, item, index));
  });
  (Array.isArray(next) ? next : []).forEach((item, index) => {
    const id = routineEntityId(collection, item);
    if (id) nextMap.set(id, withOrder(collection, item, index));
  });

  const ops = [];
  for (const [id, payload] of nextMap.entries()) {
    const prev = prevMap.get(id);
    if (!prev || !samePayload(prev, payload)) {
      ops.push({
        collection,
        op: "upsert",
        id,
        payload,
        baseRevision: Number(revisions?.[`${collection}:${id}`] || 0),
      });
    }
  }
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) {
      ops.push({
        collection,
        op: "delete",
        id,
        baseRevision: Number(revisions?.[`${collection}:${id}`] || 0),
      });
    }
  }
  return ops;
}

export function buildRoutineOps(previousFields = {}, nextFields = {}, revisions = {}, changedFields = ROUTINE_FIELDS) {
  const wanted = new Set(Array.isArray(changedFields) ? changedFields : ROUTINE_FIELDS);
  const ops = [];
  for (const [field, collection] of Object.entries(ROUTINE_COLLECTIONS)) {
    if (!wanted.has(field)) continue;
    ops.push(...buildCollectionOps(collection, previousFields?.[field] || [], nextFields?.[field] || [], revisions));
  }
  return ops;
}

export function routineFieldsFromRows(rows = []) {
  const fields = {
    habits: [],
    completions: [],
    habitChecklistLog: [],
    workoutTemplates: [],
    workoutSessions: [],
  };
  const revisions = {};
  let updatedAt = null;
  const byCollection = new Map(Object.entries(ROUTINE_COLLECTIONS).map(([field, collection]) => [collection, field]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const collection = String(row?.collection || "");
    const id = String(row?.entity_id || "");
    const field = byCollection.get(collection);
    if (!field || !id) continue;
    revisions[`${collection}:${id}`] = Number(row?.revision || 0);
    if (row?.updated_at && (!updatedAt || row.updated_at > updatedAt)) updatedAt = row.updated_at;
    if (row?.deleted_at || !row?.payload) continue;
    fields[field].push(stripOrder(clone(row.payload)));
  }

  for (const [field, collection] of Object.entries(ROUTINE_COLLECTIONS)) {
    const activeRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => String(row?.collection || "") === collection && !row?.deleted_at && row?.payload)
      .sort((a, b) => {
        const ao = Number(a?.payload?.__syncOrder ?? 1e9);
        const bo = Number(b?.payload?.__syncOrder ?? 1e9);
        if (ao !== bo) return ao - bo;
        return String(a?.updated_at || "").localeCompare(String(b?.updated_at || ""));
      });
    fields[field] = activeRows.map((row) => stripOrder(clone(row.payload))).filter(Boolean);
  }

  return { ...fields, revisions, updatedAt };
}

export function applyRoutineOutbox(remoteFields = {}, outbox = []) {
  const result = Object.fromEntries(ROUTINE_FIELDS.map((field) => [field, clone(remoteFields?.[field] || [])]));
  const collectionToField = new Map(Object.entries(ROUTINE_COLLECTIONS).map(([field, collection]) => [collection, field]));
  for (const op of compactRoutineOutbox(outbox)) {
    const field = collectionToField.get(op.collection);
    if (!field) continue;
    const list = Array.isArray(result[field]) ? [...result[field]] : [];
    const index = list.findIndex((item) => routineEntityId(op.collection, item) === op.id);
    if (op.op === "delete") {
      if (index >= 0) list.splice(index, 1);
    } else {
      const payload = stripOrder(clone({ ...(op.payload || {}), id: op.payload?.id || op.id }));
      if (index >= 0) list[index] = payload;
      else list.push(payload);
    }
    result[field] = list;
  }
  return result;
}

function unionByEntity(collection, remote = [], local = [], mergeSame = null) {
  const map = new Map();
  const order = [];
  const add = (item, source) => {
    const id = routineEntityId(collection, item);
    if (!id) return;
    if (!map.has(id)) order.push(id);
    if (!map.has(id)) map.set(id, clone(item));
    else if (mergeSame) map.set(id, mergeSame(map.get(id), item, source));
  };
  (Array.isArray(remote) ? remote : []).forEach((item) => add(item, "remote"));
  (Array.isArray(local) ? local : []).forEach((item) => add(item, "local"));
  return order.map((id) => map.get(id)).filter(Boolean);
}

function mergeChecklist(remote, local) {
  return { ...remote, ...local, done: Boolean(remote?.done || local?.done) };
}

function progressScore(session = {}) {
  let score = session?.completed ? 100000 : 0;
  for (const values of Object.values(session?.sets || {})) {
    if (Array.isArray(values)) score += values.filter(Boolean).length * 100;
  }
  if (session?.completedAt) score += 1000;
  if (session?.startedAt) score += 10;
  return score;
}

function mergeWorkoutSession(remote, local) {
  const localWins = progressScore(local) > progressScore(remote);
  const base = localWins ? { ...remote, ...local } : { ...local, ...remote };
  const sets = { ...(remote?.sets || {}) };
  for (const [exerciseId, values] of Object.entries(local?.sets || {})) {
    const remoteValues = Array.isArray(sets[exerciseId]) ? sets[exerciseId] : [];
    const localValues = Array.isArray(values) ? values : [];
    const len = Math.max(remoteValues.length, localValues.length);
    sets[exerciseId] = Array.from({ length: len }, (_, index) => Boolean(remoteValues[index] || localValues[index]));
  }
  return {
    ...base,
    completed: Boolean(remote?.completed || local?.completed),
    completedAt: [remote?.completedAt, local?.completedAt].filter(Boolean).sort().at(-1) || null,
    startedAt: [remote?.startedAt, local?.startedAt].filter(Boolean).sort()[0] || base?.startedAt || null,
    sets,
    loads: localWins ? { ...(remote?.loads || {}), ...(local?.loads || {}) } : { ...(local?.loads || {}), ...(remote?.loads || {}) },
    exerciseNotes: { ...(remote?.exerciseNotes || {}), ...(local?.exerciseNotes || {}) },
    exerciseOverrides: { ...(remote?.exerciseOverrides || {}), ...(local?.exerciseOverrides || {}) },
  };
}

export function mergeRoutineBootstrap(remoteFields = {}, localFields = {}) {
  return {
    habits: unionByEntity("habit", remoteFields.habits, localFields.habits),
    completions: unionByEntity("habit_completion", remoteFields.completions, localFields.completions),
    habitChecklistLog: unionByEntity("habit_checklist", remoteFields.habitChecklistLog, localFields.habitChecklistLog, mergeChecklist),
    workoutTemplates: unionByEntity("workout_template", remoteFields.workoutTemplates, localFields.workoutTemplates),
    workoutSessions: unionByEntity("workout_session", remoteFields.workoutSessions, localFields.workoutSessions, mergeWorkoutSession),
  };
}
