import test from "node:test";
import assert from "node:assert/strict";
import { buildLifeGraph, initLayout, stepLayout, layoutBounds, nodeBox, NODE_RADIUS, LINK_LENGTH, UNLINKED_GROUP_ID, MAX_TASKS_PER_GOAL } from "../src/lib/lifeMap.js";

const TODAY = "2026-09-25";

test("mapa só com o que existe: Você → metas → hábitos/tarefas vinculados; nenhuma categoria inventada", () => {
  const graph = buildLifeGraph({
    today: TODAY,
    goals: [
      { id: "g1", name: "Correr uma meia maratona", target: 21, current: 14, linkedHabitIds: ["h1"], linkedTaskIds: ["t1", "t2"] },
      { id: "g2", name: "Ler 12 livros", target: 12, current: 12, completed: true, linkedHabitIds: ["h1", "sumiu"] },
      { id: "g3", name: "Arquivada", archived: true },
    ],
    habits: [{ id: "h1", name: "Beber 3L de água" }],
    completions: [{ habitId: "h1", date: TODAY }],
    tasks: [
      { id: "t1", title: "Longão de 15km", status: "pendente" },
      { id: "t2", title: "Corrida 8km no parque", status: "concluida" },
    ],
  });
  const node = (id) => graph.nodes.find((n) => n.id === id);
  assert.deepEqual([...new Set(graph.nodes.map((n) => n.kind))].sort(), ["goal", "habit", "root", "task"]);
  assert.equal(node("root").label, "Você");
  assert.equal(node("goal:g1").progress, 67);
  assert.equal(node("goal:g2").progress, 100);
  assert.equal(node("goal:g3"), undefined, "metas arquivadas ficam fora");
  assert.equal(node("habit:h1").done, true);
  assert.equal(node("task:t2").done, true);
  assert.equal(graph.nodes.filter((n) => n.id === "habit:h1").length, 1, "hábito ligado a 2 metas é um nó só…");
  assert.equal(graph.links.filter((l) => l.target === "habit:h1").length, 2, "…com um vínculo para cada meta");
  assert.ok(!graph.nodes.some((n) => n.id === "habit:sumiu"), "vínculo para hábito apagado é ignorado");
  assert.equal(node(UNLINKED_GROUP_ID), undefined, "sem hábitos soltos, não existe o grupo 'Sem meta'");
  for (const link of graph.links) assert.ok(node(link.source) && node(link.target), `vínculo órfão ${link.source}→${link.target}`);
});

test("hábitos ativos sem meta vão para 'Sem meta'; pausados sem meta não aparecem", () => {
  const graph = buildLifeGraph({
    today: TODAY,
    goals: [{ id: "g", name: "Ler", linkedHabitIds: ["h1"] }],
    habits: [{ id: "h1", name: "Leitura" }, { id: "h2", name: "Acordar 5h" }, { id: "h3", name: "Pausado", active: false }],
  });
  const group = graph.nodes.find((n) => n.id === UNLINKED_GROUP_ID);
  assert.equal(group.label, "Sem meta");
  assert.deepEqual(graph.links.filter((l) => l.source === UNLINKED_GROUP_ID).map((l) => l.target), ["habit:h2"]);
  assert.ok(!graph.nodes.some((n) => n.id === "habit:h3"));
});

test("conta vazia: só o centro, sem ramos", () => {
  assert.deepEqual(buildLifeGraph({ today: TODAY }).nodes.map((n) => n.id), ["root"]);
});

test("tarefas por meta: no máximo 6, pendentes primeiro; recorrente conta como feita se concluída hoje", () => {
  const tasks = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, status: i < 5 ? "concluida" : "pendente" }));
  const graph = buildLifeGraph({ today: TODAY, goals: [{ id: "g", name: "X", linkedTaskIds: tasks.map((t) => t.id) }], tasks });
  const taskNodes = graph.nodes.filter((n) => n.kind === "task");
  assert.equal(taskNodes.length, MAX_TASKS_PER_GOAL);
  assert.deepEqual(taskNodes.slice(0, 4).map((n) => n.done), [false, false, false, false]);

  const recurring = buildLifeGraph({ today: TODAY, goals: [{ id: "g", name: "X", linkedTaskIds: ["r"] }], tasks: [{ id: "r", title: "R", repeat: "daily", completionDates: [TODAY] }] });
  assert.equal(recurring.nodes.find((n) => n.id === "task:r").done, true);
});

test("física: acomoda sem NaN, centro fixo, vínculos perto do repouso, nós e rótulos sem se sobrepor", () => {
  const goals = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, name: `Meta ${i}`, linkedHabitIds: [`h${i}`, `h${(i + 1) % 8}`], linkedTaskIds: [`t${i}`] }));
  const habits = Array.from({ length: 11 }, (_, i) => ({ id: `h${i}`, name: `Hábito ${i}` }));
  const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Tarefa ${i}`, status: "pendente" }));
  const graph = buildLifeGraph({ goals, habits, tasks, today: TODAY });
  const pos = initLayout(graph);
  let energy = Infinity;
  for (let i = 0; i < 400; i += 1) energy = stepLayout(graph, pos, { alpha: Math.max(0.02, 1 - i / 300) });
  assert.ok(energy < 1, `ainda agitado: ${energy}`);
  for (const n of graph.nodes) assert.ok(Number.isFinite(pos[n.id].x) && Number.isFinite(pos[n.id].y), n.id);
  assert.deepEqual([pos.root.x, pos.root.y], [0, 0]);

  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  // Item ligado a 2+ metas fica entre elas, então a linha até cada uma pode ser mais longa.
  const parents = (id) => graph.links.filter((l) => l.target === id).length;
  for (const link of graph.links) {
    const d = Math.hypot(pos[link.source].x - pos[link.target].x, pos[link.source].y - pos[link.target].y);
    const limit = LINK_LENGTH[kind.get(link.target)] * (parents(link.target) > 1 ? 3 : 2.2);
    assert.ok(d < limit, `${link.source}→${link.target} esticado demais (${Math.round(d)})`);
  }
  for (let i = 0; i < graph.nodes.length; i += 1) for (let j = i + 1; j < graph.nodes.length; j += 1) {
    const a = graph.nodes[i]; const b = graph.nodes[j];
    const d = Math.hypot(pos[a.id].x - pos[b.id].x, pos[a.id].y - pos[b.id].y);
    assert.ok(d > NODE_RADIUS[a.kind] + NODE_RADIUS[b.kind], `${a.id} e ${b.id} sobrepostos`);
    if (a.kind !== "root" && b.kind !== "root") {
      const ba = nodeBox(a.kind, pos[a.id].x, pos[a.id].y);
      const bb = nodeBox(b.kind, pos[b.id].x, pos[b.id].y);
      const overlap = Math.min(ba.right, bb.right) > Math.max(ba.left, bb.left) + 2 && Math.min(ba.bottom, bb.bottom) > Math.max(ba.top, bb.top) + 2;
      assert.ok(!overlap, `rótulo/desenho de ${a.id} encosta em ${b.id}`);
    }
  }
  const bounds = layoutBounds(graph, pos);
  assert.ok(bounds.width > 0 && bounds.height > 0);
});

test("nó arrastado fica onde o dedo está; posições anteriores são reaproveitadas ao reconstruir o grafo", () => {
  const graph = buildLifeGraph({ goals: [{ id: "g", name: "Correr" }], today: TODAY });
  const pos = initLayout(graph);
  stepLayout(graph, pos, { alpha: 1, pinned: { id: "goal:g", x: 300, y: -120 } });
  assert.deepEqual([pos["goal:g"].x, pos["goal:g"].y], [300, -120]);
  const again = initLayout(buildLifeGraph({ goals: [{ id: "g", name: "Correr" }, { id: "g2", name: "Ler" }], today: TODAY }), pos);
  assert.deepEqual([again["goal:g"].x, again["goal:g"].y], [300, -120], "adicionar uma meta não embaralha o mapa");
});
