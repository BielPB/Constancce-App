export const DATA_SCHEMA_VERSION = 4;

const array = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function migrateUserData(input = {}) {
  const raw = object(input);
  const version = Math.max(0, Number(raw.schemaVersion || 0));

  let data = {
    ...raw,
    profile: raw.profile ?? null,
    habits: array(raw.habits),
    completions: array(raw.completions),
    tasks: array(raw.tasks),
    goals: array(raw.goals),
    unlocked: array(raw.unlocked),
    workoutTemplates: array(raw.workoutTemplates),
    workoutSessions: array(raw.workoutSessions),
    foods: array(raw.foods),
    mealLog: array(raw.mealLog),
    transactions: array(raw.transactions),
    goalProgressLog: array(raw.goalProgressLog),
    habitChecklistLog: array(raw.habitChecklistLog),
  };

  // v1 -> v2: defaults defensivos para coleções e perfil.
  if (version < 2) {
    data.profile = data.profile ? {
      notificationSettings: {},
      financeBills: [],
      ...data.profile,
    } : data.profile;
  }

  // v2 -> v3: registros antigos da Dieta já eram itens consumidos.
  if (version < 3) {
    data.mealLog = data.mealLog.map((meal) => ({
      ...meal,
      consumed: meal?.consumed === undefined ? true : Boolean(meal.consumed),
    }));
  }

  // v3 -> v4: normalização dos campos adicionados posteriormente.
  if (version < 4) {
    data.tasks = data.tasks.map((task) => ({
      ...task,
      estimatedMinutes: Math.max(0, Number(task?.estimatedMinutes || 0)),
      deferCount: Math.max(0, Number(task?.deferCount || 0)),
      subtasks: array(task?.subtasks),
      completionDates: array(task?.completionDates),
      repeatDays: array(task?.repeatDays),
    }));

    data.goals = data.goals.map((goal) => ({
      ...goal,
      linkedTaskIds: array(goal?.linkedTaskIds),
      linkedHabitIds: array(goal?.linkedHabitIds),
      weeklyCheckins: array(goal?.weeklyCheckins),
      nextActionHistory: array(goal?.nextActionHistory),
    }));
  }

  return {
    ...data,
    schemaVersion: DATA_SCHEMA_VERSION,
  };
}
