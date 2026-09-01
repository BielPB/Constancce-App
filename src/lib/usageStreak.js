const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const safeDate = (value) => {
  const date = String(value || "").slice(0, 10);
  return DATE_RE.test(date) ? date : null;
};

const addDays = (dateStr, amount) => {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + amount);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function normalizeUsageDays(days = [], refDate = null, maxDays = 730) {
  const upper = safeDate(refDate);
  const unique = [...new Set(
    (Array.isArray(days) ? days : [])
      .map(safeDate)
      .filter(Boolean)
      .filter((date) => !upper || date <= upper)
  )].sort();

  return unique.slice(-Math.max(1, Number(maxDays) || 730));
}

export function computeUsageStreaks(days = [], refDate) {
  const today = safeDate(refDate);
  if (!today) {
    return { current: 0, best: 0, totalActiveDays: 0 };
  }

  const normalized = normalizeUsageDays(days, today);
  const active = new Set(normalized);

  let current = 0;
  let cursor = today;
  let guard = 0;

  while (active.has(cursor) && guard < 730) {
    current += 1;
    cursor = addDays(cursor, -1);
    guard += 1;
  }

  let best = 0;
  let run = 0;
  let previous = null;

  for (const date of normalized) {
    if (previous && addDays(previous, 1) === date) {
      run += 1;
    } else {
      run = 1;
    }

    best = Math.max(best, run);
    previous = date;
  }

  return {
    current,
    best: Math.max(best, current),
    totalActiveDays: normalized.length,
  };
}

export function inferLegacyUsageDays({
  refDate,
  habits = [],
  completions = [],
  tasks = [],
  workoutSessions = [],
  mealLog = [],
  goalProgressLog = [],
  habitChecklistLog = [],
  transactions = [],
  existingDays = [],
  lookbackDays = 45,
} = {}) {
  const today = safeDate(refDate);
  if (!today) return normalizeUsageDays(existingDays);

  const cutoff = addDays(today, -Math.max(1, Number(lookbackDays) || 45));
  const candidates = [...(Array.isArray(existingDays) ? existingDays : [])];

  const add = (value) => {
    const date = safeDate(value);
    if (date && date >= cutoff && date <= today) candidates.push(date);
  };

  // Sinais de interação real, não apenas datas programadas.
  // Datas de criação/onboarding não representam presença real.
  completions.forEach((completion) => add(completion?.date));
  habitChecklistLog.forEach((entry) => {
    if (entry?.done !== false) add(entry?.date);
  });

  tasks.forEach((task) => {
    add(task?.completedAt);
    (Array.isArray(task?.completionDates) ? task.completionDates : []).forEach(add);
  });

  workoutSessions.forEach((session) => add(session?.date));
  mealLog.forEach((meal) => add(meal?.date));
  goalProgressLog.forEach((entry) => add(entry?.date));
  transactions.forEach((tx) => add(tx?.date));

  return normalizeUsageDays(candidates, today);
}
