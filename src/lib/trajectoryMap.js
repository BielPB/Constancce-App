// Mapa da trajetória: transforma os registros do usuário em um mapa mental
// radial — o usuário no centro, cada área como um ramo e os marcos reais da
// história dele como nós (mais longe do centro = mais recente).
//
// Tudo aqui é puro (sem React/DOM) para ser testado em Node. Datas são
// strings "YYYY-MM-DD", como no resto do app.

export const MAP_RANGES = Object.freeze({
  "30d": { label: "30D", title: "Últimos 30 dias", days: 30 },
  "90d": { label: "90D", title: "Últimos 90 dias", days: 90 },
  "365d": { label: "1A", title: "Último ano", days: 365 },
  all: { label: "Tudo", title: "Desde o início", days: null },
});
export const FREE_MAP_RANGE = "30d";

// Cores = as mesmas categorias da legenda do Calendário, pra o usuário
// reconhecer a área pela cor. Só variáveis do tema.
export const MAP_AREAS = Object.freeze([
  { id: "habits", module: "habits", label: "Hábitos", color: "var(--text-dim)" },
  { id: "tasks", module: "tasks", label: "Tarefas", color: "var(--brass)" },
  { id: "workouts", module: "workouts", label: "Treinos", color: "var(--moss)" },
  { id: "goals", module: "goals", label: "Metas", color: "var(--danger)" },
  { id: "finance", module: "finance", label: "Finanças", color: "var(--ember)" },
  { id: "food", module: "food", label: "Dieta", color: "var(--brass-dim)" },
]);

const MAX_NODES_PER_BRANCH = 7;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const day = (value) => {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};
const addDays = (dateStr, amount) => {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};
const monthLabel = (monthKey) => {
  const [year, month] = monthKey.split("-");
  return `${MONTHS[Number(month) - 1]}/${year}`;
};
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// Marcos de quantidade: a N-ésima ocorrência (em ordem de data) vira um nó.
function countMilestones(dates, thresholds, build) {
  const sorted = dates.filter(Boolean).sort();
  return thresholds
    .filter((n) => sorted.length >= n)
    .map((n) => ({ ...build(n), date: sorted[n - 1] }));
}

function habitMilestones({ habits = [], completions = [] }) {
  const nodes = [];
  for (const habit of habits) {
    const date = day(habit?.createdAt);
    if (date) nodes.push({ id: `habit-new-${habit.id}`, date, major: false, title: `Começou: ${habit.name || "hábito"}`, detail: "Novo hábito na sua rotina." });
  }
  nodes.push(...countMilestones(
    completions.map((c) => day(c?.date)),
    [1, 10, 50, 100, 250, 500, 1000],
    (n) => ({
      id: `habit-count-${n}`,
      major: n >= 100,
      title: n === 1 ? "Primeiro hábito concluído" : `${n} hábitos concluídos`,
      detail: n === 1 ? "O primeiro check da sua trajetória." : `Você chegou a ${n} conclusões de hábitos.`,
    })
  ));
  return { nodes, activity: completions.map((c) => day(c?.date)) };
}

function taskCompletionDates(tasks = []) {
  const dates = [];
  for (const task of tasks) {
    if ((task?.repeat || "none") !== "none") dates.push(...(task.completionDates || []).map(day));
    else if (task?.status === "concluida") dates.push(day(task.completedAt) || day(task.dueDate));
  }
  return dates.filter(Boolean);
}

function taskMilestones({ tasks = [] }) {
  const dates = taskCompletionDates(tasks);
  const nodes = countMilestones(dates, [1, 10, 50, 100, 250, 500, 1000], (n) => ({
    id: `task-count-${n}`,
    major: n >= 100,
    title: n === 1 ? "Primeira tarefa concluída" : `${n} tarefas concluídas`,
    detail: n === 1 ? "A primeira coisa que saiu da cabeça e virou feito." : `${n} tarefas tiradas da frente.`,
  }));
  return { nodes, activity: dates };
}

function workoutMilestones({ workoutSessions = [] }) {
  const done = workoutSessions.filter((w) => w?.completed && day(w.date)).sort((a, b) => day(a.date).localeCompare(day(b.date)));
  const nodes = [];
  if (done[0]) {
    nodes.push({ id: "workout-first", date: day(done[0].date), major: true, title: "Primeiro treino", detail: done[0].name ? `Treino: ${done[0].name}.` : "O começo da sua rotina de treinos." });
  }
  nodes.push(...countMilestones(done.map((w) => day(w.date)), [10, 25, 50, 100, 200, 365], (n) => ({
    id: `workout-count-${n}`,
    major: n >= 50,
    title: `${n} treinos concluídos`,
    detail: `${plural(n, "treino", "treinos")} no histórico.`,
  })));
  return { nodes, activity: done.map((w) => day(w.date)) };
}

function goalMilestones({ goals = [] }) {
  const nodes = [];
  const activity = [];
  for (const goal of goals) {
    const name = goal?.name || goal?.title || "meta";
    const created = day(goal?.createdAt) || day(goal?.startDate);
    if (created) {
      nodes.push({ id: `goal-new-${goal.id}`, date: created, major: false, title: `Nova meta: ${name}`, detail: "Um novo alvo entrou no mapa." });
      activity.push(created);
    }
    const completed = goal?.completed ? day(goal.completedAt) : "";
    if (completed) {
      nodes.push({ id: `goal-done-${goal.id}`, date: completed, major: true, title: `Meta concluída: ${name}`, detail: "Alvo alcançado." });
      activity.push(completed);
    }
  }
  return { nodes, activity };
}

function financeMilestones({ transactions = [], today }) {
  const dated = transactions.filter((tx) => day(tx?.date));
  const nodes = [];
  const first = [...dated].sort((a, b) => day(a.date).localeCompare(day(b.date)))[0];
  if (first) nodes.push({ id: "finance-first", date: day(first.date), major: false, title: "Primeiro lançamento", detail: "Suas finanças começaram a ser registradas." });

  // Meses fechados em que entrou mais do que saiu.
  const byMonth = new Map();
  for (const tx of dated) {
    const key = day(tx.date).slice(0, 7);
    const value = Number(tx.value || 0);
    const entry = byMonth.get(key) || { in: 0, out: 0 };
    if (tx.type === "entrada") entry.in += value; else entry.out += value;
    byMonth.set(key, entry);
  }
  const currentMonth = String(today || "").slice(0, 7);
  for (const [key, entry] of byMonth) {
    if (key >= currentMonth || !(entry.in > entry.out)) continue;
    const lastDay = addDays(`${addDays(`${key}-28`, 4).slice(0, 7)}-01`, -1);
    nodes.push({ id: `finance-positive-${key}`, date: lastDay, major: true, title: `Mês no azul: ${monthLabel(key)}`, detail: "Entradas maiores que saídas no mês." });
  }
  return { nodes, activity: dated.map((tx) => day(tx.date)) };
}

function foodMilestones({ mealLog = [] }) {
  const days = [...new Set(mealLog.filter((m) => m?.consumed !== false).map((m) => day(m?.date)).filter(Boolean))];
  const nodes = countMilestones(days, [1, 7, 30, 100, 365], (n) => ({
    id: `food-days-${n}`,
    major: n >= 30,
    title: n === 1 ? "Primeiro dia de dieta registrado" : `${n} dias de dieta registrados`,
    detail: n === 1 ? "A primeira refeição anotada." : `${n} dias com a alimentação acompanhada.`,
  }));
  return { nodes, activity: days };
}

const EXTRACTORS = {
  habits: habitMilestones,
  tasks: taskMilestones,
  workouts: workoutMilestones,
  goals: goalMilestones,
  finance: financeMilestones,
  food: foodMilestones,
};

// Nós de ritmo: marcos de contagem (10, 50, 100…) ficam raros para quem já
// usa o app há tempo, e o mapa de 30 dias ficava vazio mesmo com dezenas de
// registros. Cada semana (30D) ou mês (períodos longos) com atividade vira um
// nó com a contagem real; o melhor período vira marco grande.
const RHYTHM_UNITS = {
  habits: ["hábito concluído", "hábitos concluídos"],
  tasks: ["tarefa concluída", "tarefas concluídas"],
  workouts: ["treino", "treinos"],
  finance: ["lançamento", "lançamentos"],
  food: ["dia com dieta registrada", "dias com dieta registrada"],
};
const weekStart = (dateStr) => {
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(dateStr, -((weekday + 6) % 7)); // semanas começam na segunda
};
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const shortDate = (dateStr) => `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;

function rhythmNodes(areaId, dates, { range, today, inRange }) {
  const units = RHYTHM_UNITS[areaId];
  if (!units) return [];
  const weekly = range === "30d";
  const buckets = new Map();
  for (const date of dates) {
    if (!inRange(date)) continue;
    const key = weekly ? weekStart(date) : date.slice(0, 7);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  if (!buckets.size) return [];
  const best = Math.max(...buckets.values());
  return [...buckets].map(([key, count]) => {
    const isBest = buckets.size > 1 && count === best;
    const period = weekly
      ? (isBest ? `Melhor semana: ${shortDate(key)}` : `Semana de ${shortDate(key)}`)
      : (isBest ? `Melhor mês: ${monthLabel(key)}` : capitalize(monthLabel(key)));
    // Nó no último dia do período (ou hoje, se ainda está em andamento).
    const periodEnd = weekly ? addDays(key, 6) : addDays(`${addDays(`${key}-28`, 4).slice(0, 7)}-01`, -1);
    return {
      id: `${areaId}-rhythm-${key}`,
      date: periodEnd > today ? today : periodEnd,
      major: isBest,
      rhythm: true,
      title: `${period} · ${plural(count, ...units)}`,
      detail: isBest
        ? `Seu ${weekly ? "melhor ritmo semanal" : "melhor mês"} em ${units[1]} neste período.`
        : `${plural(count, ...units)} ${weekly ? "nesta semana" : "neste mês"}.`,
    };
  });
}

export function rangeStart(range, today) {
  const days = MAP_RANGES[range]?.days;
  return days ? addDays(today, -(days - 1)) : "";
}

// Monta os ramos do mapa para um período. `enabledAreas` = ids de MAP_AREAS
// visíveis (módulos que o usuário esconde no Perfil não viram ramo).
export function buildTrajectory(data = {}, { range = FREE_MAP_RANGE, today, enabledAreas = MAP_AREAS.map((a) => a.id) } = {}) {
  const start = rangeStart(range, today);
  const inRange = (date) => Boolean(date) && date >= start && date <= today;
  let firstDate = null;
  const branches = MAP_AREAS.filter((area) => enabledAreas.includes(area.id)).map((area) => {
    const extracted = EXTRACTORS[area.id]({ ...data, today });
    const activity = extracted.activity;
    for (const date of activity) if (date && (!firstDate || date < firstDate)) firstDate = date;
    const nodes = [...extracted.nodes, ...rhythmNodes(area.id, activity, { range, today, inRange })];
    const visible = nodes.filter((node) => inRange(node.date));
    // Até MAX_NODES_PER_BRANCH nós: marcos grandes primeiro, depois os mais recentes.
    const chosen = [...visible]
      .sort((a, b) => Number(b.major) - Number(a.major) || b.date.localeCompare(a.date))
      .slice(0, MAX_NODES_PER_BRANCH)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return {
      ...area,
      activity: activity.filter(inRange).length,
      nodes: chosen.map((node) => ({ ...node, areaId: area.id })),
      // Lista completa do período (painel da área); o desenho mostra só `nodes`.
      allNodes: [...visible].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map((node) => ({ ...node, areaId: area.id })),
      hiddenCount: visible.length - chosen.length,
      totalMilestones: nodes.length,
    };
  });
  const maxActivity = Math.max(1, ...branches.map((b) => b.activity));
  for (const branch of branches) branch.weight = branch.activity / maxActivity;
  return { range, start: start || firstDate, today, branches, firstDate, isEmpty: branches.every((b) => !b.nodes.length && !b.activity) };
}

// Posições no SVG (viewBox 0 0 size size). Ramos em ângulos iguais a partir
// do topo; nós em ordem de data do centro pra fora.
export function layoutTrajectory(trajectory, { size = 400, innerRadius = 62, outerRadius = 158 } = {}) {
  const center = size / 2;
  const count = Math.max(1, trajectory.branches.length);
  return trajectory.branches.map((branch, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const point = (radius, offset = 0) => ({
      x: +(center + cos * radius - sin * offset).toFixed(2),
      y: +(center + sin * radius + cos * offset).toFixed(2),
    });
    const n = branch.nodes.length;
    const nodes = branch.nodes.map((node, i) => {
      const radius = n === 1 ? (innerRadius + outerRadius) / 2 : innerRadius + ((outerRadius - innerRadius) * i) / (n - 1);
      // Pequeno zigue-zague pra nós vizinhos não se encostarem.
      return { ...node, ...point(radius, n > 3 ? (i % 2 ? 7 : -7) : 0) };
    });
    return {
      ...branch,
      angle,
      start: point(34),
      end: point(outerRadius + 8),
      labelAt: { ...point(outerRadius + 26), anchor: Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end" },
      nodes,
    };
  });
}
