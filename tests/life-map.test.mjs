import test from "node:test";
import assert from "node:assert/strict";
import { LIFE_AREAS, suggestGoalArea, goalArea, buildLifeGraph, initLayout, stepLayout, layoutBounds, NODE_RADIUS, LINK_LENGTH } from "../src/lib/lifeMap.js";

const TODAY = "2026-09-25";

test("área sugerida para metas antigas: tipo financeiro e palavras do nome; área escolhida sempre vence", () => {
  assert.equal(suggestGoalArea({ type: "financeira", name: "Viagem" }), "financas");
  assert.equal(suggestGoalArea({ name: "Correr uma meia maratona" }), "saude");
  assert.equal(suggestGoalArea({ name: "Ler 12 livros no ano" }), "mente");
  assert.equal(suggestGoalArea({ name: "90 dias sem redes sociais" }), "mente");
  assert.equal(suggestGoalArea({ name: "Lançar meu projeto pessoal" }), "carreira");
  assert.equal(suggestGoalArea({ name: "Acordar 5h por 60 dias" }), "disciplina");
  assert.equal(goalArea({ name: "Ler 12 livros", area: "carreira" }), "carreira");
  assert.equal(goalArea({ name: "Ler 12 livros", area: "inexistente" }), "mente");
});

test("grafo: raiz → 6 áreas → metas → hábitos e tarefas vinculados, com progresso e status de hoje", () => {
  const graph = buildLifeGraph({
    today: TODAY,
    goals: [
      { id: "g1", name: "Correr uma meia maratona", target: 21, current: 14, linkedHabitIds: ["h1"], linkedTaskIds: ["t1", "t2"] },
      { id: "g2", name: "Ler 12 livros", target: 12, current: 12, completed: true, area: "mente", linkedHabitIds: ["h1", "sumiu"] },
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
  assert.equal(graph.nodes.filter((n) => n.kind === "area").length, LIFE_AREAS.length);
  assert.equal(node("goal:g1").areaId, "saude");
  assert.equal(node("goal:g1").progress, 67);
  assert.equal(node("goal:g2").progress, 100);
  assert.equal(node("goal:g3"), undefined, "metas arquivadas ficam fora");
  assert.equal(node("habit:h1").done, true);
  assert.equal(node("task:t2").done, true);
  assert.equal(graph.nodes.filter((n) => n.id === "habit:h1").length, 1, "hábito ligado a 2 metas é um nó só…");
  assert.equal(graph.links.filter((l) => l.target === "habit:h1").length, 2, "…com um vínculo para cada meta");
  assert.ok(!graph.nodes.some((n) => n.id === "habit:sumiu"), "vínculo para hábito apagado é ignorado");
  for (const link of graph.links) assert.ok(node(link.source) && node(link.target), `vínculo órfão ${link.source}→${link.target}`);
});

test("tarefas por meta: no máximo 6, pendentes primeiro; recorrente conta como feita se concluída hoje", () => {
  const tasks = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, status: i < 5 ? "concluida" : "pendente" }));
  tasks.push({ id: "r", title: "Recorrente", repeat: "daily", completionDates: [TODAY] });
  const graph = buildLifeGraph({ today: TODAY, goals: [{ id: "g", name: "X", linkedTaskIds: tasks.map((t) => t.id) }], tasks });
  const taskNodes = graph.nodes.filter((n) => n.kind === "task");
  assert.equal(taskNodes.length, 6);
  assert.deepEqual(taskNodes.slice(0, 4).map((n) => n.done), [false, false, false, false]);
  assert.equal(graph.nodes.find((n) => n.id === "task:r")?.done ?? true, true);
});

test("física: acomoda sem NaN, raiz fixa no centro, vínculos perto do comprimento de repouso e nós sem se sobrepor", () => {
  const goals = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, name: `Meta ${i}`, area: LIFE_AREAS[i % 6].id, linkedHabitIds: [`h${i}`, `h${(i + 1) % 10}`], linkedTaskIds: [`t${i}`] }));
  const habits = Array.from({ length: 10 }, (_, i) => ({ id: `h${i}`, name: `Hábito ${i}` }));
  const tasks = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, title: `Tarefa ${i}`, status: "pendente" }));
  const graph = buildLifeGraph({ goals, habits, tasks, today: TODAY });
  const pos = initLayout(graph);
  let energy = Infinity;
  for (let i = 0; i < 400; i += 1) energy = stepLayout(graph, pos, { alpha: Math.max(0.02, 1 - i / 300) });
  assert.ok(energy < 1, `ainda agitado: ${energy}`);
  for (const n of graph.nodes) assert.ok(Number.isFinite(pos[n.id].x) && Number.isFinite(pos[n.id].y), n.id);
  assert.deepEqual([pos.root.x, pos.root.y], [0, 0]);

  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  for (const link of graph.links.filter((l) => l.source !== "root")) {
    const d = Math.hypot(pos[link.source].x - pos[link.target].x, pos[link.source].y - pos[link.target].y);
    assert.ok(d < LINK_LENGTH[kind.get(link.target)] * 2.2, `${link.source}→${link.target} esticado demais (${Math.round(d)})`);
  }
  for (let i = 0; i < graph.nodes.length; i += 1) for (let j = i + 1; j < graph.nodes.length; j += 1) {
    const a = graph.nodes[i]; const b = graph.nodes[j];
    const d = Math.hypot(pos[a.id].x - pos[b.id].x, pos[a.id].y - pos[b.id].y);
    assert.ok(d > NODE_RADIUS[a.kind] + NODE_RADIUS[b.kind], `${a.id} e ${b.id} sobrepostos`);
    const leaf = (k) => k === "habit" || k === "task";
    // Rótulos das pontas ficam embaixo do ponto: precisam de folga pra não se sobrepor.
    if (leaf(a.kind) && leaf(b.kind)) assert.ok(d > 48, `rótulos de ${a.id} e ${b.id} colados (${Math.round(d)})`);
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
