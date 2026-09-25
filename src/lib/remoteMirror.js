// Espelho local das linhas de uma tabela atômica (constancce_tasks,
// constancce_sync_entities), para ler só o que mudou em vez da tabela inteira.
//
// Antes, os polls de 3s baixavam TODAS as linhas da conta a cada volta —
// hábitos/treinos incluem o histórico completo de conclusões e sessões, que só
// cresce. Com o espelho, cada poll pede apenas `updated_at >= cursor` e junta
// o resultado aqui; o resto do app continua recebendo o mesmo formato de antes
// (todas as linhas), montado a partir do espelho.
//
// A junção é por maior revisão: uma resposta atrasada nunca faz uma linha
// regredir. Exclusões chegam como linhas com deleted_at (tombstones), então a
// leitura incremental também as enxerga.

// Uma transação grava updated_at = now() (início dela) mas só fica visível ao
// comitar. Uma escrita que começou um pouco antes da última linha vista pode
// comitar depois — por isso o cursor recua esta margem. Linhas relidas são
// inofensivas (mesma revisão).
export const DELTA_OVERLAP_MS = 60_000;

// Releitura completa periódica: rede de segurança barata contra qualquer caso
// que a leitura incremental não cubra.
export const FULL_RESYNC_MS = 5 * 60_000;

// Postgres devolve microssegundos ("…:11.123456+00:00"); Date entende milissegundos.
export function parseServerTimestamp(value) {
  if (!value) return NaN;
  const normalized = String(value).replace(/(\.\d{3})\d+/, "$1");
  return Date.parse(normalized);
}

export function mergeMirrorRows(mirror = {}, rows = [], keyOf = (row) => row?.id) {
  const next = { ...(mirror || {}) };
  let changed = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = keyOf(row);
    if (!key) continue;
    const previous = next[key];
    const revision = Number(row?.revision || 0);
    if (previous && Number(previous.revision || 0) > revision) continue;
    if (previous
      && Number(previous.revision || 0) === revision
      && previous.updated_at === row?.updated_at
      && Boolean(previous.deleted_at) === Boolean(row?.deleted_at)) continue;
    next[key] = row;
    changed += 1;
  }
  return { mirror: next, changed };
}

export function mirrorRows(mirror = {}) {
  return Object.values(mirror || {});
}

// Cursor ISO para `updated_at=gte.` ou null quando o espelho está vazio
// (aí a leitura tem que ser completa).
//
// Preferência: a hora do SERVIDOR da leitura anterior (cabeçalho Date). Tudo
// que comitou depois dela começou, no máximo, `overlapMs` antes — então a
// janela relida é só o intervalo entre polls + margem, e fica vazia quando
// nada mudou. Sem essa hora, recua a partir da linha mais nova do espelho
// (correto, mas relê as linhas gravadas em volta dela a cada poll).
export function deltaCursor(mirror = {}, { readAt = null, overlapMs = DELTA_OVERLAP_MS } = {}) {
  if (!Object.keys(mirror || {}).length) return null;
  if (Number.isFinite(readAt)) return new Date(readAt - overlapMs).toISOString();
  let max = NaN;
  for (const row of Object.values(mirror || {})) {
    const ts = parseServerTimestamp(row?.updated_at);
    if (Number.isFinite(ts) && !(ts <= max)) max = ts;
  }
  if (!Number.isFinite(max)) return null;
  return new Date(max - overlapMs).toISOString();
}

// Hora do servidor a partir do cabeçalho Date de uma resposta (NaN se ausente).
export function serverTimeFromHeaders(headers) {
  const value = headers?.get?.("date");
  return value ? Date.parse(value) : NaN;
}

export function needsFullResync({ mirror = {}, lastFullAt = 0, now = Date.now(), force = false } = {}) {
  if (force) return true;
  if (!Object.keys(mirror || {}).length) return true;
  return !(now - Number(lastFullAt || 0) < FULL_RESYNC_MS);
}
