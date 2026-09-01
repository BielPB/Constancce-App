export const DOMAIN_FIELDS = {
  account: ["profile", "unlocked"],
  habits: ["habits", "completions", "habitChecklistLog"],
  tasks: ["tasks"],
  goals: ["goals", "goalProgressLog"],
  workouts: ["workoutTemplates", "workoutSessions"],
  diet: ["foods", "mealLog"],
  finance: ["transactions"],
};

export function domainsForPatch(patch = {}) {
  const keys = new Set(Object.keys(patch || {}));
  const domains = Object.entries(DOMAIN_FIELDS)
    .filter(([, fields]) => fields.some((field) => keys.has(field)))
    .map(([domain]) => domain);
  return domains;
}

export function pickDataForKeys(data = {}, changedKeys = []) {
  const keys = Array.isArray(changedKeys) ? changedKeys : [];
  const domains = keys.length
    ? domainsForPatch(Object.fromEntries(keys.map((key) => [key, true])))
    : Object.keys(DOMAIN_FIELDS);
  const fields = new Set(domains.flatMap((domain) => DOMAIN_FIELDS[domain] || []));
  const picked = {};
  fields.forEach((field) => { picked[field] = data?.[field]; });
  picked.schemaVersion = data?.schemaVersion;
  picked.__syncUpdatedAt = data?.__syncUpdatedAt;
  picked.__localUpdatedAt = data?.__localUpdatedAt;
  picked.__syncDomainUpdatedAt = data?.__syncDomainUpdatedAt || {};
  return picked;
}

// Une alterações pendentes sem deixar uma segunda alteração rápida apagar
// campos alterados pela primeira antes do envio ao servidor.
export function mergePendingPayload(previousPending, payload = {}, changedKeys = []) {
  const previousKeys = Array.isArray(previousPending?.changedKeys) ? previousPending.changedKeys : [];
  const currentKeys = Array.isArray(changedKeys) ? changedKeys : [];
  const unionKeys = [...new Set([...previousKeys, ...currentKeys])];

  const mergedData = { ...payload };
  const currentSet = new Set(currentKeys);

  for (const key of previousKeys) {
    if (currentSet.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(previousPending?.data || {}, key)) {
      mergedData[key] = previousPending.data[key];
    }
  }

  for (const key of currentKeys) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      mergedData[key] = payload[key];
    }
  }

  mergedData.schemaVersion = payload?.schemaVersion ?? previousPending?.data?.schemaVersion;
  mergedData.__syncUpdatedAt = payload?.__syncUpdatedAt ?? previousPending?.data?.__syncUpdatedAt ?? null;
  mergedData.__localUpdatedAt = payload?.__localUpdatedAt ?? new Date().toISOString();
  mergedData.__syncDomainUpdatedAt = {
    ...(previousPending?.data?.__syncDomainUpdatedAt || {}),
    ...(payload?.__syncDomainUpdatedAt || {}),
  };

  return { data: mergedData, changedKeys: unionKeys };
}

// Em um novo pull, a nuvem fornece a base e somente os campos efetivamente
// alterados neste aparelho são reaplicados. Isso preserva mudanças remotas em
// outros campos do mesmo domínio.
export function mergeRemoteWithPending(remote = {}, pending = null) {
  if (!pending?.data) return remote;
  const merged = { ...remote };
  for (const key of pending.changedKeys || []) {
    if (Object.prototype.hasOwnProperty.call(pending.data, key)) {
      merged[key] = pending.data[key];
    }
  }
  merged.schemaVersion = remote?.schemaVersion ?? pending.data?.schemaVersion;
  merged.__syncUpdatedAt = remote?.__syncUpdatedAt || null;
  merged.__localUpdatedAt = pending.data?.__localUpdatedAt || new Date().toISOString();
  merged.__syncDomainUpdatedAt = { ...(remote?.__syncDomainUpdatedAt || {}) };
  return merged;
}

export function buildDomainRows(userId, data, domains = Object.keys(DOMAIN_FIELDS), updatedAt = new Date().toISOString()) {
  return domains.map((domain) => {
    const fields = DOMAIN_FIELDS[domain] || [];
    const payload = {};
    fields.forEach((field) => {
      payload[field] = data?.[field];
    });
    if (domain === "account") payload.schemaVersion = data?.schemaVersion;
    return {
      user_id: userId,
      domain,
      data: payload,
      updated_at: updatedAt,
    };
  });
}

export function mergeDomainRows(rows = []) {
  const combined = {};
  let latest = 0;
  rows.forEach((row) => {
    Object.assign(combined, row?.data || {});
    const time = Date.parse(row?.updated_at || "") || 0;
    latest = Math.max(latest, time);
  });
  return {
    ...combined,
    __syncUpdatedAt: latest ? new Date(latest).toISOString() : null,
  };
}
