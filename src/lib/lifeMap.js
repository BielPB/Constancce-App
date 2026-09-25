// Mapa da vida: "Minha evolução" no centro → áreas da vida → metas de cada
// área → hábitos e tarefas vinculados a cada meta. Tudo puro (sem React/DOM):
// montagem do grafo, área sugerida para metas antigas e a simulação de física
// que o componente anima a cada frame.

import { goalProgressPercent } from "./goalForecast.js";

export const LIFE_AREAS = Object.freeze([
  { id: "saude", label: "Saúde", icon: "HeartPulse" },
  { id: "mente", label: "Mente", icon: "Brain" },
  { id: "carreira", label: "Carreira", icon: "Briefcase" },
  { id: "financas", label: "Finanças", icon: "Wallet" },
  { id: "relacionamentos", label: "Relacionamentos", icon: "Users" },
  { id: "disciplina", label: "Disciplina", icon: "Shield" },
]);
const AREA_IDS = new Set(LIFE_AREAS.map((a) => a.id));

// Metas criadas antes do campo "área" ganham uma sugestão (o usuário troca no
// formulário). Tipo financeiro → Finanças; senão, palavras do nome.
const AREA_KEYWORDS = [
  ["saude", ["corr", "maratona", "trein", "academia", "peso", "dieta", "saúde", "saude", "km", "nadar", "dormir", "sono", "água", "agua", "bike", "pedal"]],
  ["mente", ["ler", "livro", "leitura", "medit", "estud", "curso", "idioma", "inglês", "ingles", "diário", "diario", "redes sociais", "terapia"]],
  ["carreira", ["projeto", "trabalho", "empresa", "cliente", "lançar", "lancar", "carreira", "promoç", "promoc", "negócio", "negocio", "vendas", "portfólio", "portfolio"]],
  ["financas", ["reserva", "invest", "dívida", "divida", "poupar", "economizar", "r$", "salário", "salario", "renda"]],
  ["relacionamentos", ["família", "familia", "amigo", "namor", "casamento", "filho", "pais", "relacion"]],
];

export function suggestGoalArea(goal = {}) {
  if (goal?.type === "financeira") return "financas";
  const name = String(goal?.name || "").toLowerCase();
  for (const [area, words] of AREA_KEYWORDS) if (words.some((word) => name.includes(word))) return area;
  return "disciplina";
}

export function goalArea(goal = {}) {
  return AREA_IDS.has(goal?.area) ? goal.area : suggestGoalArea(goal);
}

const isRecurring = (task) => (task?.repeat || "none") !== "none";
const taskDone = (task, today) => (isRecurring(task)
  ? (task.completionDates || []).includes(today)
  : task?.status === "concluida");

const MAX_TASKS_PER_GOAL = 6;

// nodes: { id, kind: root|area|goal|habit|task, label, ... }; links: { source, target }
export function buildLifeGraph({ goals = [], habits = [], tasks = [], completions = [], today } = {}) {
  const nodes = [{ id: "root", kind: "root", label: "Minha evolução" }];
  const links = [];
  const byId = new Map();
  const add = (node) => { if (!byId.has(node.id)) { byId.set(node.id, node); nodes.push(node); } return byId.get(node.id); };

  for (const area of LIFE_AREAS) {
    add({ id: `area:${area.id}`, kind: "area", label: area.label, areaId: area.id, icon: area.icon });
    links.push({ source: "root", target: `area:${area.id}` });
  }

  const doneToday = new Set(completions.filter((c) => c?.date === today).map((c) => c.habitId));
  const habitById = new Map(habits.map((h) => [h.id, h]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const goal of goals.filter((g) => g && !g.archived)) {
    const goalId = `goal:${goal.id}`;
    const areaId = goalArea(goal);
    add({
      id: goalId,
      kind: "goal",
      label: goal.name || "Meta",
      goalId: goal.id,
      areaId,
      progress: goal.completed ? 100 : goalProgressPercent(goal),
      completed: Boolean(goal.completed),
      endDate: goal.endDate || "",
    });
    links.push({ source: `area:${areaId}`, target: goalId });

    for (const habitId of goal.linkedHabitIds || []) {
      const habit = habitById.get(habitId);
      if (!habit) continue;
      add({ id: `habit:${habit.id}`, kind: "habit", label: habit.name || "Hábito", habitId: habit.id, done: doneToday.has(habit.id), paused: habit.active === false });
      links.push({ source: goalId, target: `habit:${habit.id}` });
    }

    // Tarefas vinculadas: pendentes primeiro, no máximo MAX_TASKS_PER_GOAL.
    const linkedTasks = (goal.linkedTaskIds || []).map((id) => taskById.get(id)).filter(Boolean)
      .sort((a, b) => Number(taskDone(a, today)) - Number(taskDone(b, today)));
    for (const task of linkedTasks.slice(0, MAX_TASKS_PER_GOAL)) {
      add({ id: `task:${task.id}`, kind: "task", label: task.title || "Tarefa", taskId: task.id, done: taskDone(task, today) });
      links.push({ source: goalId, target: `task:${task.id}` });
    }
  }
  return { nodes, links };
}

// ---------------------------------------------------------------------------
// Física (force-directed): repulsão entre todos, molas nos vínculos, leve
// atração ao centro. O componente chama stepLayout a cada frame enquanto
// `alpha` (energia) não esfria; arrastar um nó reaquece.
// ---------------------------------------------------------------------------

export const LINK_LENGTH = { area: 190, goal: 130, habit: 88, task: 88 };
export const NODE_RADIUS = { root: 30, area: 22, goal: 19, habit: 8, task: 8 };
const CHARGE = { root: 2600, area: 2000, goal: 1400, habit: 900, task: 900 };

// Posições iniciais determinísticas: áreas em círculo, filhos em leque ao
// redor do pai, na mesma direção (o mapa já "abre" arrumado e só se acomoda).
export function initLayout(graph, previous = {}) {
  const pos = {};
  const children = new Map();
  for (const link of graph.links) {
    if (!children.has(link.source)) children.set(link.source, []);
    children.get(link.source).push(link.target);
  }
  const place = (id, x, y) => {
    const prev = previous[id];
    pos[id] = prev ? { ...prev, vx: 0, vy: 0 } : { x, y, vx: 0, vy: 0 };
  };
  pos.root = { x: 0, y: 0, vx: 0, vy: 0 };
  const visit = (parentId, angle, depth) => {
    const kids = (children.get(parentId) || []).filter((id) => !pos[id]);
    const spread = depth === 0 ? Math.PI * 2 : Math.PI * 1.1;
    kids.forEach((id, i) => {
      const a = depth === 0
        ? -Math.PI / 2 + (i * spread) / Math.max(1, kids.length)
        : angle - spread / 2 + (spread * (i + 0.5)) / kids.length;
      const kind = graph.nodes.find((n) => n.id === id)?.kind || "task";
      const r = LINK_LENGTH[kind] || 80;
      place(id, pos[parentId].x + Math.cos(a) * r, pos[parentId].y + Math.sin(a) * r);
      visit(id, a, depth + 1);
    });
  };
  visit("root", 0, 0);
  // Nós sem pai (não deveria acontecer) ficam perto do centro.
  graph.nodes.forEach((n, i) => { if (!pos[n.id]) place(n.id, Math.cos(i) * 40, Math.sin(i) * 40); });
  return pos;
}

export function stepLayout(graph, pos, { alpha = 1, pinned = null } = {}) {
  const nodes = graph.nodes;
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const force = Object.fromEntries(nodes.map((n) => [n.id, { x: 0, y: 0 }]));

  // Repulsão (O(n²); o grafo tem no máximo algumas centenas de nós).
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const pa = pos[a.id];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const pb = pos[b.id];
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) { dx = (i - j) * 0.1 || 0.1; dy = 0.1; d2 = dx * dx + dy * dy; }
      const d = Math.sqrt(d2);
      const strength = ((CHARGE[a.kind] + CHARGE[b.kind]) / 2) / Math.max(d2, 400);
      // Folga extra entre pontas (hábitos/tarefas): os rótulos ficam embaixo
      // do ponto e são mais largos que ele.
      const leafPair = (a.kind === "habit" || a.kind === "task") && (b.kind === "habit" || b.kind === "task");
      const minGap = NODE_RADIUS[a.kind] + NODE_RADIUS[b.kind] + (leafPair ? 58 : 30);
      const push = strength + (d < minGap ? (minGap - d) * 0.25 : 0);
      force[a.id].x += (dx / d) * push; force[a.id].y += (dy / d) * push;
      force[b.id].x -= (dx / d) * push; force[b.id].y -= (dy / d) * push;
    }
  }
  // Molas.
  for (const link of graph.links) {
    const s = pos[link.source];
    const t = pos[link.target];
    if (!s || !t) continue;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const rest = LINK_LENGTH[kindOf.get(link.target)] || 80;
    const k = 0.06 * (d - rest);
    force[link.source].x += (dx / d) * k; force[link.source].y += (dy / d) * k;
    force[link.target].x -= (dx / d) * k; force[link.target].y -= (dy / d) * k;
  }
  // Integração com amortecimento; raiz fixa no centro; nó arrastado fixo.
  let energy = 0;
  for (const node of nodes) {
    const p = pos[node.id];
    if (node.id === "root") { p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; continue; }
    if (pinned && pinned.id === node.id) { p.x = pinned.x; p.y = pinned.y; p.vx = 0; p.vy = 0; continue; }
    const f = force[node.id];
    f.x -= p.x * 0.002; f.y -= p.y * 0.002; // gravidade leve
    p.vx = (p.vx + f.x * alpha) * 0.62;
    p.vy = (p.vy + f.y * alpha) * 0.62;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 40) { p.vx *= 40 / speed; p.vy *= 40 / speed; }
    p.x += p.vx; p.y += p.vy;
    energy += speed;
  }
  return energy / Math.max(1, nodes.length);
}

export function layoutBounds(graph, pos) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const node of graph.nodes) {
    const p = pos[node.id];
    if (!p) continue;
    const r = NODE_RADIUS[node.kind] + 40; // folga pro rótulo
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
