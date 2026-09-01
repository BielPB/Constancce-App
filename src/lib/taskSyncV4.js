const clone = (value) => {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch (_) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
};

const idOf = (task) => String(task?.id || "");
const equal = (a, b) => {
  try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
  catch (_) { return false; }
};

// Converte o estado desejado de Tarefas em operações por item comparando apenas
// com a última versão confirmada pelo servidor. Isso impede que uma tarefa criada
// em outro dispositivo seja apagada só porque ainda não existia no cache local.
export function buildTaskOpsV4(serverTasks = [], desiredTasks = [], revisions = {}) {
  const serverMap = new Map((Array.isArray(serverTasks) ? serverTasks : []).map((task) => [idOf(task), task]).filter(([id]) => id));
  const desiredMap = new Map((Array.isArray(desiredTasks) ? desiredTasks : []).map((task) => [idOf(task), task]).filter(([id]) => id));
  const ops = [];

  for (const [id, task] of desiredMap.entries()) {
    const before = serverMap.get(id);
    if (!before || !equal(before, task)) {
      ops.push({
        op: "upsert",
        id,
        payload: clone(task),
        baseRevision: Number(revisions?.[id] || 0),
      });
    }
  }

  for (const [id] of serverMap.entries()) {
    if (!desiredMap.has(id)) {
      ops.push({
        op: "delete",
        id,
        baseRevision: Number(revisions?.[id] || 0),
      });
    }
  }

  return ops;
}

export function applyTaskOpsToList(tasks = [], ops = []) {
  const map = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [idOf(task), clone(task)]).filter(([id]) => id));
  for (const op of Array.isArray(ops) ? ops : []) {
    const id = String(op?.id || "");
    if (!id) continue;
    if (op?.op === "delete") map.delete(id);
    else if (op?.op === "upsert" && op?.payload) map.set(id, clone(op.payload));
  }
  return [...map.values()];
}
