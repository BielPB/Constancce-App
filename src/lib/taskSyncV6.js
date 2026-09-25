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

// ---------------------------------------------------------------------------
// Trava por tarefa contra leituras atrasadas ("marca, volta, marca de novo").
//
// Toda leitura remota (pull de tarefas, pull/POST da sync genérica, bootstrap)
// é um snapshot tirado em algum instante entre o envio e a resposta, e as
// respostas chegam fora de ordem. Uma leitura que saiu antes do RPC de uma
// tarefa comitar e chega depois que o op já saiu da outbox traz a tarefa no
// estado antigo — aplicá-la fazia a tarefa recém-marcada "voltar" até o
// próximo pull. A outbox só protege enquanto a mutação está pendente.
//
// `known` é um registro por tarefa da MAIOR revisão que este aparelho já viu
// (por escrita confirmada ou por leitura) e do estado nessa revisão:
//   { [taskId]: { revision, deleted, task } }
// Revisões por tarefa só crescem no servidor, então uma leitura que traz
// revisão menor (ou nenhuma) para uma tarefa conhecida é, para essa tarefa,
// um snapshot velho e é ignorada — sem janela de tempo, e sem "liberar" a
// trava cedo demais (uma leitura nova chegando antes de uma velha não abre
// brecha). Edições e exclusões de outro aparelho têm revisão maior e passam.
// ---------------------------------------------------------------------------

const knownEntry = (revision, task) => ({
  revision,
  deleted: !task,
  task: task ? clone(task) : null,
});

// Registra a resposta de sucesso do RPC constancce_apply_my_task_op.
export function recordConfirmedTaskWrite(known = {}, op = {}, response = {}) {
  const id = String(response?.task_id || op?.id || "").trim();
  const revision = Number(response?.revision || 0);
  const base = known || {};
  if (!id || !(revision > 0)) return base;
  if (Number(base[id]?.revision || 0) > revision) return base;
  // Numa resposta "duplicate" (retry idempotente) o servidor devolve o estado
  // ATUAL da tarefa, que pode já ser de uma escrita posterior — por isso o
  // payload/deleted_at da resposta têm prioridade sobre o op enviado.
  const deleted = Boolean(response?.deleted_at) || (op?.op === "delete" && !response?.task);
  const task = deleted ? null : { ...(response?.task || op?.payload || {}), id };
  return { ...base, [id]: knownEntry(revision, task) };
}

// Revisões por tarefa só crescem no servidor; uma leitura atrasada nunca pode
// fazer este aparelho "esquecer" uma revisão mais nova que ele já viu (senão
// a próxima escrita sai com baseRevision velho e cai no caminho de conflito).
export function mergeTaskRevisions(local = {}, remote = {}) {
  const merged = { ...(local || {}) };
  for (const [id, value] of Object.entries(remote || {})) {
    const next = Number(value || 0);
    if (!id) continue;
    if (!(Number(merged[id] || 0) > next)) merged[id] = next;
  }
  return merged;
}

// Decide o que fica visível a partir de um snapshot remoto:
//   1. tarefa conhecida cuja revisão na leitura é menor (ou ausente) mantém o
//      estado conhecido — inclusive "excluída" e "recém-criada";
//   2. revisão igual ou maior vence e atualiza o registro (inclui exclusões
//      remotas: id com revisão mas fora da lista = tombstone);
//   3. mutações ainda na outbox são reaplicadas por cima (applyTaskOutbox).
// Função pura: devolve também o registro `known` atualizado.
export function reconcileRemoteTasks({ remoteTasks = [], remoteRevisions = {}, outbox = [], known = {} } = {}) {
  const revisions = remoteRevisions && typeof remoteRevisions === "object" ? remoteRevisions : {};
  const map = new Map((Array.isArray(remoteTasks) ? remoteTasks : [])
    .map((task) => [String(task?.id || ""), task])
    .filter(([id]) => id));
  const nextKnown = { ...(known || {}) };
  const heldTaskIds = [];
  const ids = new Set([...Object.keys(nextKnown), ...Object.keys(revisions)]);
  for (const id of ids) {
    if (!id) continue;
    const entry = nextKnown[id];
    const remoteRevision = revisions[id] == null ? null : Number(revisions[id]);
    if (entry && (remoteRevision == null || remoteRevision < Number(entry.revision || 0))) {
      heldTaskIds.push(id);
      if (entry.deleted) map.delete(id);
      else if (entry.task) map.set(id, clone(entry.task));
      continue;
    }
    if (remoteRevision != null) nextKnown[id] = knownEntry(remoteRevision, map.get(id) || null);
  }
  const tasks = applyTaskOutbox([...map.values()], outbox);
  return { tasks, known: nextKnown, heldTaskIds };
}

// Tira da outbox o op que o servidor acabou de confirmar. Se, enquanto ele
// estava em voo, uma edição mais nova da MESMA tarefa foi compactada por cima
// (mutationId diferente), ela fica — mas herdava o baseRevision do op enviado
// e batia num revision_conflict contra a nossa própria escrita (fetch + reenvio
// a cada toque rápido). Como ela foi feita depois, neste aparelho, sua base
// correta é justamente a revisão que acabou de ser confirmada; se outro
// aparelho escreveu nesse meio-tempo, o servidor ainda acusa o conflito.
export function settleSentTaskOp(outbox = [], sentOp = {}, confirmedRevision = 0) {
  const id = String(sentOp?.id || "");
  const mutationId = String(sentOp?.mutationId || "");
  const revision = Number(confirmedRevision || 0);
  return compactTaskOutbox(outbox)
    .filter((item) => item.id !== id || String(item.mutationId || "") !== mutationId)
    .map((item) => (item.id === id && revision > 0 ? { ...item, baseRevision: revision } : item));
}

// Linhas de constancce_tasks → formato usado pelo app. Revisões incluem as
// linhas apagadas (tombstones), que é como uma exclusão remota é reconhecida.
export function atomicTasksFromRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    tasks: list.filter((row) => !row?.deleted_at).map((row) => row?.payload).filter(Boolean),
    taskRevisions: Object.fromEntries(list.map((row) => [String(row?.task_id || ""), Number(row?.revision || 0)]).filter(([id]) => id)),
    updatedAt: list.map((row) => row?.updated_at).filter(Boolean).sort().at(-1) || null,
  };
}
