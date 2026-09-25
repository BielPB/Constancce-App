import test from "node:test";
import assert from "node:assert/strict";
import { buildTrajectory, layoutTrajectory, rangeStart, MAP_AREAS } from "../src/lib/trajectoryMap.js";

const TODAY = "2026-09-25";
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const branch = (t, id) => t.branches.find((b) => b.id === id);
// Marcos de história (sem os nós de ritmo semanal/mensal, testados à parte).
const titles = (t, id) => branch(t, id).allNodes.filter((n) => !n.rhythm).map((n) => n.title);

test("marcos de hábitos: criação e contagens, na data da N-ésima conclusão", () => {
  const completions = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, habitId: "h1", date: addDays(TODAY, -20 + i) }));
  const t = buildTrajectory({ habits: [{ id: "h1", name: "Ler", createdAt: addDays(TODAY, -21) }], completions }, { range: "30d", today: TODAY });
  assert.deepEqual(titles(t, "habits"), ["Começou: Ler", "Primeiro hábito concluído", "10 hábitos concluídos"]);
  assert.equal(branch(t, "habits").allNodes.find((n) => n.id === "habit-count-10").date, addDays(TODAY, -11), "10º check é o marco");
  assert.equal(branch(t, "habits").activity, 12);
});

test("tarefas recorrentes e simples contam; pendentes não", () => {
  const tasks = [
    { id: "a", status: "concluida", completedAt: addDays(TODAY, -3) },
    { id: "b", status: "pendente", dueDate: TODAY },
    { id: "c", repeat: "daily", status: "pendente", completionDates: [addDays(TODAY, -2), addDays(TODAY, -1)] },
  ];
  const t = buildTrajectory({ tasks }, { range: "30d", today: TODAY });
  assert.deepEqual(titles(t, "tasks"), ["Primeira tarefa concluída"]);
  assert.equal(branch(t, "tasks").activity, 3);
});

test("período filtra marcos: 30D esconde o que é mais antigo, Tudo mostra", () => {
  const workoutSessions = [
    { id: "w1", completed: true, date: "2025-01-10", name: "Peito" },
    { id: "w2", completed: true, date: addDays(TODAY, -5), name: "Costas" },
    { id: "w3", completed: false, date: TODAY },
  ];
  assert.deepEqual(titles(buildTrajectory({ workoutSessions }, { range: "30d", today: TODAY }), "workouts"), []);
  const all = buildTrajectory({ workoutSessions }, { range: "all", today: TODAY });
  assert.deepEqual(titles(all, "workouts"), ["Primeiro treino"]);
  assert.equal(all.firstDate, "2025-01-10");
  assert.equal(rangeStart("30d", TODAY), addDays(TODAY, -29));
});

test("metas: criada é marco pequeno, concluída é marco grande", () => {
  const goals = [{ id: "g1", name: "Correr 5km", startDate: addDays(TODAY, -40), completed: true, completedAt: `${addDays(TODAY, -2)}T10:00:00Z` }];
  const t = buildTrajectory({ goals }, { range: "90d", today: TODAY });
  assert.deepEqual(branch(t, "goals").nodes.map((n) => [n.title, n.major]), [["Nova meta: Correr 5km", false], ["Meta concluída: Correr 5km", true]]);
});

test("finanças: mês no azul só para meses fechados, no último dia do mês", () => {
  const transactions = [
    { type: "entrada", value: 5000, date: "2026-08-05" },
    { type: "saida", value: 3000, date: "2026-08-20" },
    { type: "entrada", value: 100, date: "2026-07-05" },
    { type: "saida", value: 900, date: "2026-07-06" },
    { type: "entrada", value: 9000, date: "2026-09-01" }, // mês atual: ainda aberto
  ];
  const t = buildTrajectory({ transactions }, { range: "365d", today: TODAY });
  const positive = branch(t, "finance").nodes.filter((n) => n.id.startsWith("finance-positive"));
  assert.deepEqual(positive.map((n) => [n.title, n.date]), [["Mês no azul: ago/2026", "2026-08-31"]]);
});

test("dieta conta dias distintos com refeição consumida", () => {
  const mealLog = [
    { date: TODAY, consumed: true }, { date: TODAY, consumed: true },
    { date: addDays(TODAY, -1), consumed: false },
  ];
  const t = buildTrajectory({ mealLog }, { range: "30d", today: TODAY });
  assert.deepEqual(titles(t, "food"), ["Primeiro dia de dieta registrado"]);
  assert.equal(branch(t, "food").activity, 1);
});

test("nós de ritmo: um por semana em 30D (o melhor vira marco grande), por mês nos períodos longos", () => {
  // Quem já usa o app há tempo passou dos marcos de contagem: sem ritmo, o
  // mapa de 30 dias (o que o Free vê) ficava vazio mesmo com dezenas de registros.
  const completions = [
    ...Array.from({ length: 5 }, (_, i) => ({ date: "2026-09-14" })), // semana de 14/09 (seg)
    { date: "2026-09-21" }, { date: "2026-09-22" },                     // semana de 21/09
  ];
  const weekly = branch(buildTrajectory({ completions }, { range: "30d", today: TODAY }), "habits").allNodes.filter((n) => n.rhythm);
  assert.deepEqual(weekly.map((n) => [n.title, n.major, n.date]), [
    ["Melhor semana: 14/09 · 5 hábitos concluídos", true, "2026-09-20"],
    ["Semana de 21/09 · 2 hábitos concluídos", false, TODAY], // semana em andamento: nó em hoje
  ]);

  const monthly = branch(buildTrajectory({ completions: [...completions, { date: "2026-08-10" }] }, { range: "90d", today: TODAY }), "habits").allNodes.filter((n) => n.rhythm);
  assert.deepEqual(monthly.map((n) => n.title), ["Ago/2026 · 1 hábito concluído", "Melhor mês: set/2026 · 7 hábitos concluídos"]);

  assert.deepEqual(branch(buildTrajectory({ goals: [{ id: "g", name: "X", startDate: TODAY }] }, { range: "30d", today: TODAY }), "goals").allNodes.filter((n) => n.rhythm), [], "Metas não tem ritmo (atividade esparsa)");
});

test("no máximo 7 nós por ramo, priorizando marcos grandes; resto vira hiddenCount", () => {
  const goals = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, name: `M${i}`, startDate: addDays(TODAY, -60 + i), completed: i < 3, completedAt: i < 3 ? addDays(TODAY, -10 + i) : null }));
  const b = branch(buildTrajectory({ goals }, { range: "90d", today: TODAY }), "goals");
  assert.equal(b.nodes.length, 7);
  assert.equal(b.hiddenCount, 6);
  assert.equal(b.allNodes.length, 13, "a lista do painel tem todos os marcos do período");
  assert.equal(b.nodes.filter((n) => n.major).length, 3, "as 3 metas concluídas sempre aparecem");
  assert.deepEqual([...b.nodes].map((n) => n.date), [...b.nodes].map((n) => n.date).sort(), "nós em ordem de data (centro → fora)");
});

test("módulos escondidos não viram ramo; peso é relativo à área mais ativa", () => {
  const data = {
    tasks: [{ id: "a", status: "concluida", completedAt: TODAY }],
    completions: Array.from({ length: 4 }, (_, i) => ({ date: addDays(TODAY, -i) })),
  };
  const t = buildTrajectory(data, { range: "30d", today: TODAY, enabledAreas: ["habits", "tasks"] });
  assert.deepEqual(t.branches.map((b) => b.id), ["habits", "tasks"]);
  assert.equal(branch(t, "habits").weight, 1);
  assert.equal(branch(t, "tasks").weight, 0.25);
});

test("conta vazia é reconhecida como vazia", () => {
  assert.equal(buildTrajectory({}, { range: "all", today: TODAY }).isEmpty, true);
});

test("layout: ramos em ângulos iguais a partir do topo, nós do centro pra fora, tudo dentro do viewBox", () => {
  const completions = Array.from({ length: 60 }, (_, i) => ({ date: addDays(TODAY, -59 + i) }));
  const t = buildTrajectory({ completions, habits: [{ id: "h", name: "Ler", createdAt: addDays(TODAY, -59) }], tasks: [{ status: "concluida", completedAt: TODAY }] }, { range: "90d", today: TODAY });
  const layout = layoutTrajectory(t, { size: 400 });
  assert.equal(layout.length, MAP_AREAS.length);
  assert.equal(layout[0].end.x, 200, "primeiro ramo aponta pra cima");
  assert.ok(layout[0].end.y < 200);
  const habits = layout.find((b) => b.id === "habits");
  const dist = habits.nodes.map((n) => Math.hypot(n.x - 200, n.y - 200));
  assert.deepEqual(dist, [...dist].sort((a, b) => a - b), "mais recente = mais longe do centro");
  for (const b of layout) for (const p of [...b.nodes, b.end]) {
    assert.ok(p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 400, `${b.id} fora do viewBox`);
  }
});

test("layout preserva o nome da área (label) e põe a posição do rótulo em labelAt", () => {
  const [first] = layoutTrajectory(buildTrajectory({}, { range: "30d", today: TODAY }));
  assert.equal(typeof first.label, "string");
  assert.ok(Number.isFinite(first.labelAt.x) && ["start", "middle", "end"].includes(first.labelAt.anchor));
});
