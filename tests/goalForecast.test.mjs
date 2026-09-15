import test from "node:test";
import assert from "node:assert/strict";
import {
  goalProgressPercent,
  goalPaceInfo,
  goalPaceScore,
  goalForecast,
  goalRequiredPace,
  goalMilestonePercents,
  goalMilestonesReached,
  goalNextMilestone,
} from "../src/lib/goalForecast.js";

// goalForecast/goalPaceInfo/goalRequiredPace giram em torno de "hoje", então
// os testes usam datas relativas ao momento em que a suíte roda (mesma
// abordagem usada pra verificar isso manualmente no navegador antes de
// extrair estas funções de App.jsx) em vez de datas fixas.
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); };
const daysAhead = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); };
const today = () => fmt(new Date());

test("goalProgressPercent trava em 0-100 e não divide por zero", () => {
  assert.equal(goalProgressPercent({ target: 0, current: 50 }), 0);
  assert.equal(goalProgressPercent({ target: 200, current: 100 }), 50);
  assert.equal(goalProgressPercent({ target: 200, current: 999 }), 100);
  assert.equal(goalProgressPercent({ target: 200, current: -50 }), 0);
});

test("goalPaceInfo marca 'Parada' depois de 21 dias sem atividade", () => {
  const goal = { startDate: daysAgo(40), endDate: daysAhead(20), target: 100, current: 10 };
  const goalProgressLog = [{ goalId: "g1", date: daysAgo(25), value: 10, createdAt: `${daysAgo(25)}T10:00:00` }];
  const info = goalPaceInfo({ ...goal, id: "g1" }, goalProgressLog);
  assert.equal(info.label, "Parada");
  assert.equal(info.tone, "danger");
});

test("goalPaceInfo marca 'No ritmo' quando o progresso está à frente do esperado pro prazo", () => {
  // 50% do prazo decorrido (30 de 60 dias) com 60% do alvo concluído — acima
  // do esperado, então fica "No ritmo" (deltaPct = 60 - 50 = 10 >= -5).
  const goal = {
    id: "g1",
    startDate: daysAgo(30),
    endDate: daysAhead(30),
    target: 100,
    current: 60,
  };
  const goalProgressLog = [{ goalId: "g1", date: daysAgo(2), value: 60, createdAt: `${daysAgo(2)}T10:00:00` }];
  const info = goalPaceInfo(goal, goalProgressLog);
  assert.equal(info.label, "No ritmo");
  assert.equal(info.tone, "positive");
  assert.equal(info.expectedPct, 50);
  assert.equal(info.deltaPct, 10);
});

test("goalPaceInfo marca 'Atenção' quando o progresso está atrás do esperado pro prazo", () => {
  // Mesmo cenário, mas só 20% concluído contra 50% esperado (deltaPct = -30).
  const goal = { id: "g1", startDate: daysAgo(30), endDate: daysAhead(30), target: 100, current: 20 };
  const goalProgressLog = [{ goalId: "g1", date: daysAgo(2), value: 20, createdAt: `${daysAgo(2)}T10:00:00` }];
  const info = goalPaceInfo(goal, goalProgressLog);
  assert.equal(info.label, "Atenção");
  assert.equal(info.deltaPct, -30);
});

test("goalPaceScore combina progresso, ritmo, recência e marcos num score 0-100", () => {
  const completedGoal = { completed: true };
  assert.equal(goalPaceScore(completedGoal, []), 100);

  const freshGoal = { id: "g1", startDate: daysAgo(10), endDate: daysAhead(50), target: 100, current: 50 };
  const recentLog = [{ goalId: "g1", date: daysAgo(1), value: 50, createdAt: `${daysAgo(1)}T10:00:00` }];
  const score = goalPaceScore(freshGoal, recentLog);
  assert.ok(score >= 0 && score <= 100, `score fora da faixa: ${score}`);
  assert.ok(score >= 60, `meta em dia com atividade recente deveria pontuar bem, veio ${score}`);
});

test("goalForecast prevê a data de conclusão a partir do ritmo real de progresso registrado", () => {
  // Ganhou 200 em 15 dias (200 -> 400) => ritmo 13,33/dia. Faltam 600 pra
  // bater 1000 => 45 dias. Prazo é em 60 dias, então termina 15 dias antes.
  const goal = { id: "g1", target: 1000, current: 400, startDate: daysAgo(30), endDate: daysAhead(60) };
  const goalProgressLog = [
    { goalId: "g1", date: daysAgo(20), value: 200, createdAt: `${daysAgo(20)}T10:00:00` },
    { goalId: "g1", date: daysAgo(5), value: 400, createdAt: `${daysAgo(5)}T10:00:00` },
  ];
  const forecast = goalForecast(goal, goalProgressLog);
  assert.equal(forecast.predictedDate, daysAhead(45));
  assert.equal(forecast.daysDifference, -15);
  assert.ok(Math.abs(forecast.ratePerDay - 200 / 15) < 1e-9);
});

test("goalForecast não divide por zero quando não há ritmo ainda (meta nova, sem progresso)", () => {
  const goal = { id: "g1", target: 1000, current: 0, startDate: today(), endDate: daysAhead(60) };
  const forecast = goalForecast(goal, []);
  assert.equal(forecast.predictedDate, null);
  assert.equal(forecast.ratePerDay, 0);
  assert.equal(forecast.daysDifference, null);
});

test("goalForecast trata meta já concluída e meta já batida sem histórico", () => {
  const completed = goalForecast({ completed: true, completedAt: "2026-05-10T12:00:00.000Z" }, []);
  assert.equal(completed.predictedDate, "2026-05-10");

  const alreadyThere = goalForecast({ id: "g1", target: 100, current: 150, endDate: daysAhead(10) }, []);
  assert.equal(alreadyThere.predictedDate, today());
  assert.equal(alreadyThere.daysDifference, 0);
});

test("goalRequiredPace calcula ritmo mensal pra metas financeiras e semanal pras demais", () => {
  const financeGoal = { type: "financeira", target: 10000, current: 4000, endDate: daysAhead(60) };
  const financePace = goalRequiredPace(financeGoal);
  assert.equal(financePace.unit, "mês");
  // Faltam 6000 em ~60 dias (~1,972 meses) => ~3043,75/mês, igual ao valor
  // conferido manualmente no navegador antes desta extração.
  assert.ok(Math.abs(financePace.value - 3043.75) < 1, `esperava ~3043.75, veio ${financePace.value}`);

  const habitGoal = { type: "habito", target: 20, current: 5, endDate: daysAhead(14) };
  const habitPace = goalRequiredPace(habitGoal);
  assert.equal(habitPace.unit, "semana");
  assert.ok(Math.abs(habitPace.value - 7.5) < 0.5, `esperava ~7.5/semana, veio ${habitPace.value}`);

  // Sem prazo, ou meta já batida: ritmo necessário é 0.
  assert.equal(goalRequiredPace({ type: "financeira", target: 100, current: 100 }).value, 0);
  assert.equal(goalRequiredPace({ target: 100, current: 200, endDate: daysAhead(10) }).value, 0);
});

test("marcos (25/50/75/100) respeitam a lista customizada e o [] intencional", () => {
  assert.deepEqual(goalMilestonePercents({}), [25, 50, 75, 100]);
  assert.deepEqual(goalMilestonePercents({ milestones: [10, 90] }), [10, 90]);
  // [] explícito (usuário escolheu "nenhum marco") não deve cair pro padrão.
  assert.deepEqual(goalMilestonePercents({ milestones: [] }), []);
  assert.deepEqual(goalMilestonePercents({ checklist: [{ id: "a" }] }), []);

  assert.equal(goalMilestonesReached({ target: 100, current: 60 }), 2);
  assert.equal(goalMilestonesReached({ target: 100, current: 100 }), 4);

  const next = goalNextMilestone({ target: 100, current: 60 });
  assert.equal(next.pct, 75);
  assert.equal(next.value, 75);
  assert.equal(goalNextMilestone({ target: 100, current: 100 }), null);
});
