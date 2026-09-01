import { pickDataForKeys } from "./syncDomains.js";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch (_) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
};

export function syncEqual(a, b) {
  if (Object.is(a, b)) return true;
  try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
  catch (_) { return false; }
}

function entityId(item) {
  if (!isObject(item)) return "";
  return String(item.id ?? item.user_id ?? item.key ?? "");
}

function isEntityArray(value) {
  return Array.isArray(value) && value.every((item) => isObject(item) && entityId(item));
}

function mergeObject(base, local, remote) {
  const output = {};
  const keys = new Set([
    ...Object.keys(isObject(base) ? base : {}),
    ...Object.keys(isObject(local) ? local : {}),
    ...Object.keys(isObject(remote) ? remote : {}),
  ]);
  for (const key of keys) {
    const b = base?.[key];
    const l = local?.[key];
    const r = remote?.[key];
    const localHas = Object.prototype.hasOwnProperty.call(local || {}, key);
    const remoteHas = Object.prototype.hasOwnProperty.call(remote || {}, key);
    const baseHas = Object.prototype.hasOwnProperty.call(base || {}, key);
    const localChanged = localHas !== baseHas || !syncEqual(l, b);
    const remoteChanged = remoteHas !== baseHas || !syncEqual(r, b);

    if (localChanged && !remoteChanged) {
      if (localHas) output[key] = clone(l);
      continue;
    }
    if (!localChanged && remoteChanged) {
      if (remoteHas) output[key] = clone(r);
      continue;
    }
    if (!localChanged && !remoteChanged) {
      if (baseHas) output[key] = clone(b);
      continue;
    }
    if (!localHas) continue; // exclusão local vence conflito simultâneo
    if (!remoteHas) { output[key] = clone(l); continue; }
    output[key] = threeWayMergeValue(b, l, r);
  }
  return output;
}

export function mergeEntityArray3Way(base = [], local = [], remote = []) {
  const baseMap = new Map((Array.isArray(base) ? base : []).map((item) => [entityId(item), item]).filter(([id]) => id));
  const localMap = new Map((Array.isArray(local) ? local : []).map((item) => [entityId(item), item]).filter(([id]) => id));
  const remoteMap = new Map((Array.isArray(remote) ? remote : []).map((item) => [entityId(item), item]).filter(([id]) => id));
  const ids = new Set([...baseMap.keys(), ...remoteMap.keys(), ...localMap.keys()]);
  const mergedMap = new Map();

  for (const id of ids) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    const baseHas = baseMap.has(id);
    const localHas = localMap.has(id);
    const remoteHas = remoteMap.has(id);
    const localChanged = localHas !== baseHas || !syncEqual(l, b);
    const remoteChanged = remoteHas !== baseHas || !syncEqual(r, b);

    if (localChanged && !remoteChanged) {
      if (localHas) mergedMap.set(id, clone(l));
      continue;
    }
    if (!localChanged && remoteChanged) {
      if (remoteHas) mergedMap.set(id, clone(r));
      continue;
    }
    if (!localChanged && !remoteChanged) {
      if (baseHas) mergedMap.set(id, clone(b));
      continue;
    }
    if (!localHas) continue; // deleção explícita local
    if (!remoteHas) { mergedMap.set(id, clone(l)); continue; }
    mergedMap.set(id, mergeObject(b || {}, l, r));
  }

  // Ordem remota é a base visual; itens criados neste aparelho entram ao final.
  const orderedIds = [];
  for (const item of Array.isArray(remote) ? remote : []) {
    const id = entityId(item);
    if (id && mergedMap.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
  }
  for (const item of Array.isArray(local) ? local : []) {
    const id = entityId(item);
    if (id && mergedMap.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
  }
  return orderedIds.map((id) => mergedMap.get(id));
}

export function threeWayMergeValue(base, local, remote) {
  if (syncEqual(local, base)) return clone(remote);
  if (syncEqual(remote, base)) return clone(local);
  if (syncEqual(local, remote)) return clone(local);
  if (isEntityArray(local) && isEntityArray(remote) && (isEntityArray(base) || !Array.isArray(base) || base.length === 0)) {
    return mergeEntityArray3Way(Array.isArray(base) ? base : [], local, remote);
  }
  if (isObject(local) && isObject(remote)) return mergeObject(isObject(base) ? base : {}, local, remote);
  // Listas primitivas e valores escalares: a ação local pendente vence apenas
  // quando ambos realmente mudaram desde a mesma base.
  return clone(local);
}

export function mergeRemoteWithPendingV3(remote = {}, pending = null) {
  if (!pending?.data) return remote;
  const merged = { ...remote };
  for (const key of pending.changedKeys || []) {
    if (!Object.prototype.hasOwnProperty.call(pending.data, key)) continue;
    merged[key] = threeWayMergeValue(
      pending?.baseData?.[key],
      pending.data[key],
      remote?.[key],
    );
  }
  merged.schemaVersion = remote?.schemaVersion ?? pending.data?.schemaVersion;
  merged.__syncRevision = Number(remote?.__syncRevision || 0);
  merged.__syncFieldRevisions = { ...(remote?.__syncFieldRevisions || {}) };
  merged.__syncUpdatedAt = remote?.__syncUpdatedAt || null;
  merged.__localUpdatedAt = pending.data?.__localUpdatedAt || new Date().toISOString();
  return merged;
}

export function newMutationId() {
  try { return crypto.randomUUID(); } catch (_) {
    return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function mergePendingPayloadV3(previousPending, payload = {}, changedKeys = [], serverBase = {}, fieldRevisions = {}) {
  const previousKeys = Array.isArray(previousPending?.changedKeys) ? previousPending.changedKeys : [];
  const currentKeys = Array.isArray(changedKeys) ? changedKeys : [];
  const unionKeys = [...new Set([...previousKeys, ...currentKeys])];
  const legacyMerged = previousPending?.data
    ? { ...previousPending.data }
    : {};

  for (const key of currentKeys) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) legacyMerged[key] = clone(payload[key]);
  }
  // Mantém campos anteriores na fila mesmo quando o snapshot de um segundo setState
  // ainda veio do render anterior.
  for (const key of previousKeys) {
    if (!Object.prototype.hasOwnProperty.call(legacyMerged, key) && Object.prototype.hasOwnProperty.call(previousPending?.data || {}, key)) {
      legacyMerged[key] = clone(previousPending.data[key]);
    }
  }

  const baseData = { ...(previousPending?.baseData || {}) };
  const baseFieldRevisions = { ...(previousPending?.baseFieldRevisions || {}) };
  for (const key of currentKeys) {
    if (!Object.prototype.hasOwnProperty.call(baseData, key)) baseData[key] = clone(serverBase?.[key]);
    if (!Object.prototype.hasOwnProperty.call(baseFieldRevisions, key)) {
      baseFieldRevisions[key] = Number(fieldRevisions?.[key] || 0);
    }
  }

  const compact = pickDataForKeys({ ...payload, ...legacyMerged }, unionKeys);
  for (const key of unionKeys) {
    if (Object.prototype.hasOwnProperty.call(legacyMerged, key)) compact[key] = clone(legacyMerged[key]);
  }

  return {
    data: compact,
    changedKeys: unionKeys,
    baseData,
    baseFieldRevisions,
    mutationId: newMutationId(),
    queuedAt: new Date().toISOString(),
  };
}

export function rebasePendingV3(remote, pending) {
  if (!pending?.data) return null;
  const merged = mergeRemoteWithPendingV3(remote, pending);
  const baseData = {};
  const baseFieldRevisions = {};
  for (const key of pending.changedKeys || []) {
    baseData[key] = clone(remote?.[key]);
    baseFieldRevisions[key] = Number(remote?.__syncFieldRevisions?.[key] || 0);
  }
  return {
    data: pickDataForKeys(merged, pending.changedKeys || []),
    changedKeys: [...new Set(pending.changedKeys || [])],
    baseData,
    baseFieldRevisions,
    mutationId: newMutationId(),
    queuedAt: new Date().toISOString(),
  };
}
