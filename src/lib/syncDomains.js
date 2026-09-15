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
