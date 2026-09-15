// Matemática pura de projeção/ritmo de metas — extraída de App.jsx pra ser
// testável isoladamente (goalForecast/goalPaceScore/goalRequiredPace fazem
// contas de data não-triviais que já tiveram bug antes). Duplica localmente
// fmt/today/addDays (App.jsx mantém as suas próprias, usadas em todo o resto
// do arquivo) — mesmo padrão de pequena duplicação intencional já usado em
// src/features/finance/FinanceView.jsx.
const fmt = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today = () => fmt(new Date());
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return fmt(d);
};

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const start = new Date(today() + "T12:00:00");
  const end = new Date(dateStr + "T12:00:00");
  return Math.ceil((end - start) / 86400000);
}

export function goalMilestonePercents(goal) {
  if (goal?.checklist?.length) return [];
  // Array.isArray (não .length) distingue "usuário escolheu nenhum marco" ([])
  // de "nunca definiu" (undefined) — com .length, um [] salvo de propósito
  // sempre revertia pro padrão de 4 marcos.
  if (Array.isArray(goal?.milestones)) return goal.milestones;
  return [25, 50, 75, 100];
}

export function goalMilestonesReached(goal) {
  const target = Math.max(1, Number(goal?.target || 0));
  // Arredondado igual a goalProgressPercent(), usado pela trilha visual e pelo
  // toast de "marco alcançado" — sem isso, a trilha comemorava um marco (ex.:
  // 24,6% arredondado pra 25%) que o score de ritmo/XP não reconhecia.
  const currentPct = Math.round(Math.min(100, Math.max(0, (Number(goal?.current || 0) / target) * 100)));
  return goalMilestonePercents(goal).filter((pct) => currentPct >= pct).length;
}

export const goalProgressPercent = (goal) => {
  const target = Math.max(0, Number(goal?.target || 0));
  const current = Math.max(0, Number(goal?.current || 0));
  return target > 0 ? Math.min(100, Math.max(0, Math.round((current / target) * 100))) : 0;
};

export const goalProgressEntries = (goalProgressLog, goalId) =>
  [...(goalProgressLog || [])]
    .filter((entry) => entry.goalId === goalId)
    .sort((a, b) =>
      String(a.createdAt || `${a.date || ""}T00:00:00`).localeCompare(
        String(b.createdAt || `${b.date || ""}T00:00:00`)
      )
    );

export const goalDailyHistory = (goal, goalProgressLog) => {
  const entries = goalProgressEntries(goalProgressLog, goal.id);
  const byDate = new Map();

  entries.forEach((entry) => {
    const date = String(entry.date || entry.createdAt || "").slice(0, 10);
    if (!date) return;
    byDate.set(date, {
      date,
      value: Math.max(0, Number(entry.value || 0)),
      added: Math.max(0, Number(entry.added || 0)),
      createdAt: entry.createdAt || `${date}T12:00:00`,
    });
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

export const goalLastActivityDate = (goal, goalProgressLog) => {
  const history = goalDailyHistory(goal, goalProgressLog);
  const checkins = [...(goal?.weeklyCheckins || [])]
    .filter((item) => item.value !== "nenhum")
    .map((item) => String(item.date || item.createdAt || "").slice(0, 10))
    .filter(Boolean)
    .sort();

  const candidates = [
    history.at(-1)?.date,
    checkins.at(-1),
    goal?.startDate,
  ].filter(Boolean).sort();

  return candidates.at(-1) || goal?.startDate || today();
};

export const goalDaysSinceActivity = (goal, goalProgressLog) => {
  const last = goalLastActivityDate(goal, goalProgressLog);
  const from = new Date(`${last}T12:00:00`);
  const to = new Date(`${today()}T12:00:00`);
  return Math.max(0, Math.floor((to - from) / 86400000));
};

export const goalPaceInfo = (goal, goalProgressLog) => {
  if (goal?.completed) return { label: "Concluída", tone: "positive", expectedPct: 100, deltaPct: 0 };

  const pct = goalProgressPercent(goal);
  const inactiveDays = goalDaysSinceActivity(goal, goalProgressLog);

  if (inactiveDays >= 21 && pct < 100) {
    return { label: "Parada", tone: "danger", expectedPct: null, deltaPct: null, inactiveDays };
  }

  if (!goal?.endDate) {
    return { label: "Em andamento", tone: "neutral", expectedPct: null, deltaPct: null, inactiveDays };
  }

  const start = new Date(`${goal.startDate || today()}T12:00:00`);
  const end = new Date(`${goal.endDate}T12:00:00`);
  const now = new Date(`${today()}T12:00:00`);
  const totalDays = Math.max(1, Math.ceil((end - start) / 86400000));
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((now - start) / 86400000)));
  const expectedPct = Math.max(0, Math.min(100, Math.round(elapsedDays / totalDays * 100)));
  const deltaPct = pct - expectedPct;

  if (goal.endDate < today() && pct < 100) {
    return { label: "Atenção", tone: "attention", expectedPct: 100, deltaPct: pct - 100, inactiveDays };
  }

  if (deltaPct >= -5) {
    return { label: "No ritmo", tone: "positive", expectedPct, deltaPct, inactiveDays };
  }

  return { label: "Atenção", tone: "attention", expectedPct, deltaPct, inactiveDays };
};

export const goalPaceScore = (goal, goalProgressLog) => {
  if (goal?.completed) return 100;

  const pct = goalProgressPercent(goal);
  const pace = goalPaceInfo(goal, goalProgressLog);
  const progressPart = Math.min(35, pct * 0.35);
  const pacePart =
    pace.label === "No ritmo" ? 35 :
    pace.label === "Em andamento" ? 25 :
    pace.label === "Atenção" ? 16 :
    5;

  const inactiveDays = goalDaysSinceActivity(goal, goalProgressLog);
  const recencyPart = inactiveDays <= 7 ? 20 : inactiveDays <= 14 ? 12 : inactiveDays <= 21 ? 6 : 0;
  const milestonePercents = goalMilestonePercents(goal);
  const milestonePart = milestonePercents.length
    ? Math.round(goalMilestonesReached(goal) / milestonePercents.length * 10)
    : Math.min(10, pct * 0.1);

  return Math.max(0, Math.min(100, Math.round(progressPart + pacePart + recencyPart + milestonePart)));
};

export const goalPaceScoreLabel = (score) =>
  score >= 80 ? "Forte" :
  score >= 60 ? "Estável" :
  score >= 40 ? "Atenção" :
  "Fraco";

export const goalForecast = (goal, goalProgressLog) => {
  if (!goal || goal.completed) {
    return {
      predictedDate: goal?.completedAt ? String(goal.completedAt).slice(0, 10) : null,
      ratePerDay: 0,
      daysDifference: null,
    };
  }

  const target = Math.max(0, Number(goal.target || 0));
  const current = Math.max(0, Number(goal.current || 0));
  const remaining = Math.max(0, target - current);
  if (!target || !remaining) return { predictedDate: today(), ratePerDay: 0, daysDifference: 0 };

  const history = goalDailyHistory(goal, goalProgressLog);
  let ratePerDay = 0;

  if (history.length >= 2) {
    const first = history[0];
    const last = history.at(-1);
    const days = Math.max(
      1,
      Math.round(
        (new Date(`${last.date}T12:00:00`) - new Date(`${first.date}T12:00:00`)) / 86400000
      )
    );
    ratePerDay = Math.max(0, (Number(last.value || 0) - Number(first.value || 0)) / days);
  }

  if (ratePerDay <= 0 && current > 0) {
    const start = new Date(`${goal.startDate || today()}T12:00:00`);
    const now = new Date(`${today()}T12:00:00`);
    const elapsedDays = Math.max(1, Math.round((now - start) / 86400000) + 1);
    ratePerDay = current / elapsedDays;
  }

  if (!Number.isFinite(ratePerDay) || ratePerDay <= 0) {
    return { predictedDate: null, ratePerDay: 0, daysDifference: null };
  }

  const daysNeeded = Math.min(3650, Math.max(1, Math.ceil(remaining / ratePerDay)));
  const predictedDate = addDays(today(), daysNeeded);
  const daysDifference = goal.endDate
    ? Math.round(
        (new Date(`${predictedDate}T12:00:00`) - new Date(`${goal.endDate}T12:00:00`)) / 86400000
      )
    : null;

  return { predictedDate, ratePerDay, daysDifference };
};

export const goalRequiredPace = (goal) => {
  const remaining = Math.max(0, Number(goal?.target || 0) - Number(goal?.current || 0));
  if (!goal?.endDate || remaining <= 0) {
    return { value: 0, unit: goal?.type === "financeira" ? "mês" : "semana" };
  }

  const days = Math.max(1, daysUntil(goal.endDate) || 1);
  if (goal.type === "financeira") {
    return {
      value: remaining / Math.max(1, days / 30.4375),
      unit: "mês",
    };
  }

  return {
    value: remaining / Math.max(1, days / 7),
    unit: "semana",
  };
};

export const goalNextMilestone = (goal) => {
  const pct = goalProgressPercent(goal);
  const milestonePct = goalMilestonePercents(goal)
    .filter((value) => value > pct)
    .sort((a, b) => a - b)[0];

  if (!milestonePct) return null;

  const target = Math.max(0, Number(goal.target || 0));
  return {
    pct: milestonePct,
    value: target * milestonePct / 100,
  };
};
