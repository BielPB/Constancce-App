const clone = (value) => {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch (_) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
};

export function compactTaskOutbox(entries = []) {
  const order = [];
  const byId = new Map();
  for (const raw of Array.isArray(entries) ? entries : []) {
    const id = String(raw?.id || raw?.taskId || "").trim();
    const op = String(raw?.op || "").toLowerCase();
    if (!id || !["upsert", "delete"].includes(op)) continue;
    if (!byId.has(id)) order.push(id);
    const previous = byId.get(id);
    const next = {
      op,
      id,
      payload: op === "upsert" ? clone(raw?.payload || {}) : undefined,
      baseRevision: Number(previous?.baseRevision ?? raw?.baseRevision ?? 0) || 0,
      mutationId: String(raw?.mutationId || previous?.mutationId || ""),
      queuedAt: raw?.queuedAt || previous?.queuedAt || new Date().toISOString(),
    };
    // Se uma tarefa ainda não existia no servidor (baseRevision 0) e foi criada,
    // alterada e apagada antes do flush, manter apenas o delete é seguro: o servidor
    // criará um tombstone e nenhum dispositivo antigo poderá ressuscitá-la.
    byId.set(id, next);
  }
  return order.map((id) => byId.get(id)).filter(Boolean);
}

export function applyTaskOutbox(tasks = [], outbox = []) {
  const map = new Map((Array.isArray(tasks) ? tasks : [])
    .map((task) => [String(task?.id || ""), clone(task)])
    .filter(([id]) => id));
  for (const op of compactTaskOutbox(outbox)) {
    if (op.op === "delete") map.delete(op.id);
    else map.set(op.id, clone({ ...(op.payload || {}), id: op.id }));
  }
  return [...map.values()];
}

export function makeTaskUpsert(task, revision = 0, mutationId = "") {
  const id = String(task?.id || "").trim();
  if (!id) return null;
  return {
    op: "upsert",
    id,
    payload: clone({ ...task, id }),
    baseRevision: Number(revision || 0),
    mutationId,
    queuedAt: new Date().toISOString(),
  };
}

export function makeTaskDelete(id, revision = 0, mutationId = "") {
  const taskId = String(id || "").trim();
  if (!taskId) return null;
  return {
    op: "delete",
    id: taskId,
    baseRevision: Number(revision || 0),
    mutationId,
    queuedAt: new Date().toISOString(),
  };
}
