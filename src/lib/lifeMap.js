// Mapa da vida: só o que existe no app. "Você" no centro → suas metas →
// os hábitos e tarefas que você vinculou a cada meta. Hábitos ativos sem
// nenhuma meta ficam num grupo "Sem meta" (que só aparece se houver algum).
// Nada de categorias inventadas nem ramos vazios.
//
// Tudo puro (sem React/DOM): montagem do grafo e a simulação de física que
// o componente usa para acomodar os nós.

import { goalProgressPercent } from "./goalForecast.js";

export const UNLINKED_GROUP_ID = "group:unlinked";

const isRecurring = (task) => (task?.repeat || "none") !== "none";
const taskDone = (task, today) => (isRecurring(task)
  ? (task.completionDates || []).includes(today)
  : task?.status === "concluida");

export const MAX_TASKS_PER_GOAL = 6;

// nodes: { id, kind: root|goal|group|habit|task, label, ... }; links: { source, target }
export function buildLifeGraph({ goals = [], habits = [], tasks = [], completions = [], today } = {}) {
  const nodes = [{ id: "root", kind: "root", label: "Você" }];
  const links = [];
  const byId = new Map([["root", nodes[0]]]);
  const add = (node) => {
    if (!byId.has(node.id)) { byId.set(node.id, node); nodes.push(node); }
    return byId.get(node.id);
  };

  const doneToday = new Set(completions.filter((c) => c?.date === today).map((c) => c.habitId));
  const habitById = new Map(habits.map((h) => [h.id, h]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const habitNode = (habit) => ({
    id: `habit:${habit.id}`,
    kind: "habit",
    label: habit.name || "Hábito",
    habitId: habit.id,
    done: doneToday.has(habit.id),
    paused: habit.active === false,
  });
  const linkedHabitIds = new Set();

  for (const goal of goals.filter((g) => g && !g.archived)) {
    const goalId = `goal:${goal.id}`;
    add({
      id: goalId,
      kind: "goal",
      label: goal.name || "Meta",
      goalId: goal.id,
      progress: goal.completed ? 100 : goalProgressPercent(goal),
      completed: Boolean(goal.completed),
      endDate: goal.endDate || "",
    });
    links.push({ source: "root", target: goalId });

    for (const habitId of goal.linkedHabitIds || []) {
      const habit = habitById.get(habitId);
      if (!habit) continue;
      linkedHabitIds.add(habit.id);
      add(habitNode(habit));
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

  // Hábitos ativos que não estão ligados a nenhuma meta.
  const unlinked = habits.filter((h) => h && h.active !== false && !linkedHabitIds.has(h.id));
  if (unlinked.length) {
    add({ id: UNLINKED_GROUP_ID, kind: "group", label: "Sem meta" });
    links.push({ source: "root", target: UNLINKED_GROUP_ID });
    for (const habit of unlinked) {
      add(habitNode(habit));
      links.push({ source: UNLINKED_GROUP_ID, target: `habit:${habit.id}` });
    }
  }
  return { nodes, links };
}

// ---------------------------------------------------------------------------
// Física (force-directed): repulsão entre todos, molas nos vínculos, leve
// atração ao centro. O componente roda stepLayout até assentar; arrastar
// um nó reaquece.
// ---------------------------------------------------------------------------

export const LINK_LENGTH = { goal: 200, group: 200, habit: 108, task: 108 };
export const NODE_RADIUS = { root: 30, goal: 24, group: 20, habit: 10, task: 10 };
const CHARGE = { root: 2800, goal: 2200, group: 1800, habit: 1000, task: 1000 };
const isLeaf = (kind) => kind === "habit" || kind === "task";

// Caixa ocupada por um nó: o desenho em cima e o rótulo (até 2 linhas)
// embaixo. Usada para que nenhum rótulo encoste em outro nó ou rótulo.
const LABEL_WIDTH = { root: 70, goal: 128, group: 90, habit: 108, task: 108 };
export function nodeBox(kind, x, y) {
  const r = NODE_RADIUS[kind];
  const labelHeight = kind === "root" ? 0 : 36;
  const top = y - r;
  const bottom = y + r + (labelHeight ? 10 + labelHeight : 0);
  return { left: x - LABEL_WIDTH[kind] / 2, right: x + LABEL_WIDTH[kind] / 2, top, bottom };
}

// Posições iniciais determinísticas: filhos da raiz em círculo, filhos das
// metas em leque na mesma direção (o mapa já abre arrumado e só se acomoda).
export function initLayout(graph, previous = {}) {
  const pos = {};
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
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
      const r = LINK_LENGTH[kindOf.get(id)] || 90;
      place(id, pos[parentId].x + Math.cos(a) * r, pos[parentId].y + Math.sin(a) * r);
      visit(id, a, depth + 1);
    });
  };
  visit("root", 0, 0);
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
      // Folga para os rótulos (ficam embaixo do ponto e são mais largos que ele).
      force[a.id].x += (dx / d) * strength; force[a.id].y += (dy / d) * strength;
      force[b.id].x -= (dx / d) * strength; force[b.id].y -= (dy / d) * strength;

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
    const rest = LINK_LENGTH[kindOf.get(link.target)] || 90;
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
    p.vx = (p.vx + f.x * alpha) * 0.6;
    p.vy = (p.vy + f.y * alpha) * 0.6;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 40) { p.vx *= 40 / speed; p.vy *= 40 / speed; }
    p.x += p.vx; p.y += p.vy;
    energy += speed;
  }
  resolveCollisions(nodes, pos, pinned);
  return energy / Math.max(1, nodes.length);
}

// Separação direta das caixas (desenho + rótulo), independente da energia da
// simulação: garante que nenhum rótulo termine em cima de outro nó. Move os
// dois nós pela metade da sobreposição, no eixo em que ela é menor; a raiz e
// o nó sendo arrastado ficam parados (o outro anda a sobreposição inteira).
function resolveCollisions(nodes, pos, pinned, passes = 3) {
  const fixed = (id) => id === "root" || (pinned && pinned.id === id);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]; const b = nodes[j];
        const pa = pos[a.id]; const pb = pos[b.id];
        const ba = nodeBox(a.kind, pa.x, pa.y);
        const bb = nodeBox(b.kind, pb.x, pb.y);
        const overlapX = Math.min(ba.right, bb.right) - Math.max(ba.left, bb.left) + 6;
        const overlapY = Math.min(ba.bottom, bb.bottom) - Math.max(ba.top, bb.top) + 6;
        if (overlapX <= 0 || overlapY <= 0) continue;
        const fa = fixed(a.id); const fb = fixed(b.id);
        if (fa && fb) continue;
        const shareA = fa ? 0 : fb ? 1 : 0.5;
        const shareB = 1 - shareA;
        if (overlapX < overlapY) {
          const dir = pa.x === pb.x ? (i % 2 ? 1 : -1) : Math.sign(pa.x - pb.x);
          pa.x += dir * overlapX * shareA; pb.x -= dir * overlapX * shareB;
        } else {
          const dir = (ba.top + ba.bottom) === (bb.top + bb.bottom) ? (i % 2 ? 1 : -1) : Math.sign((ba.top + ba.bottom) - (bb.top + bb.bottom));
          pa.y += dir * overlapY * shareA; pb.y -= dir * overlapY * shareB;
        }
      }
    }
  }
}

export function layoutBounds(graph, pos) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const node of graph.nodes) {
    const p = pos[node.id];
    if (!p) continue;
    const r = NODE_RADIUS[node.kind] + 48; // folga pro rótulo
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
