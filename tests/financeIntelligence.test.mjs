import test from "node:test";
import assert from "node:assert/strict";
import {
  detectFinanceIntent,
  executeFinanceIntelligence,
  computeFinanceProjectionForMonth,
} from "../src/lib/financeIntelligence.js";

// O assistente de linguagem natural de Finanças gira em torno de "hoje" (mês
// selecionado por padrão, "este mês" etc.), então as datas de teste são
// relativas ao momento em que a suíte roda, igual ao padrão já usado pros
// testes de goalForecast.
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmtDate(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmtDate(d); };
const daysAhead = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fmtDate(d); };
const money = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

test("detectFinanceIntent reconhece as perguntas mais comuns", () => {
  assert.equal(detectFinanceIntent("qual é meu saldo").intent, "balance");
  assert.equal(detectFinanceIntent("quanto gastei esse mes").intent, "expense_total");
  assert.equal(detectFinanceIntent("quantas metas eu tenho").intent, "goals_count");
  assert.equal(detectFinanceIntent("tem alguma conta atrasada").intent, "bills_overdue");
  assert.equal(detectFinanceIntent("como fecha o mes").intent, "month_forecast");
});

test("detectFinanceIntent resolve continuação contextual ('e mês passado?')", () => {
  const result = detectFinanceIntent("e mes passado", { intent: "expense_total" });
  assert.equal(result.intent, "expense_total");
  assert.equal(result.source, "context");
});

test("detectFinanceIntent usa o contexto de meta pra 'quanto falta' sem repetir o nome da meta", () => {
  const result = detectFinanceIntent("quanto falta", { goal: { id: "g1", name: "Viagem" } });
  assert.equal(result.intent, "goal_remaining");
  assert.equal(result.source, "context");
});

test("detectFinanceIntent devolve confiança baixa e sem intenção pra frases sem sentido financeiro", () => {
  const result = detectFinanceIntent("blablabla xyz 123");
  assert.equal(result.intent, null);
  assert.ok(result.confidence < 0.55);
});

function baseArgs(overrides = {}) {
  return {
    question: "",
    transactions: [],
    goals: [],
    bills: [],
    recurring: [],
    monthlyLimit: 0,
    budgets: {},
    selectedMonth: today().slice(0, 7),
    projectedBalance: 0,
    availableToSpend: 0,
    context: null,
    ...overrides,
  };
}

const transactions = [
  { id: "t1", type: "entrada", value: 5000, date: today() },
  { id: "t2", type: "saida", value: 1200, date: today(), category: "Alimentação", description: "Mercado" },
  { id: "t3", type: "saida", value: 300, date: today(), category: "Transporte", description: "Uber" },
];

const goals = [
  { id: "g1", type: "financeira", name: "Viagem", target: 5000, current: 1000, completed: false, endDate: daysAhead(90) },
];

const bills = [
  { id: "b1", status: "pendente", dueDate: daysAgo(5), value: 200 },
  { id: "b2", status: "pendente", dueDate: daysAhead(10), value: 150 },
];

test("executeFinanceIntelligence responde o saldo do período com base nas transações reais", () => {
  const result = executeFinanceIntelligence(baseArgs({ question: "qual é meu saldo", transactions }));
  assert.equal(result.ok, true);
  assert.equal(result.intent, "balance");
  assert.match(result.answer, new RegExp(money(5000 - 1500).replace(/[.$]/g, "\\$&")));
  assert.match(result.answer, /positivo/);
});

test("executeFinanceIntelligence soma só as saídas do período pra 'quanto gastei'", () => {
  const result = executeFinanceIntelligence(baseArgs({ question: "quanto gastei esse mes", transactions }));
  assert.equal(result.ok, true);
  assert.equal(result.intent, "expense_total");
  assert.match(result.answer, new RegExp(money(1500).replace(/[.$]/g, "\\$&")));
});

test("executeFinanceIntelligence filtra por categoria detectada na pergunta", () => {
  const result = executeFinanceIntelligence(baseArgs({ question: "quanto gastei com alimentacao", transactions }));
  assert.equal(result.ok, true);
  assert.equal(result.intent, "category_expense");
  assert.match(result.answer, new RegExp(money(1200).replace(/[.$]/g, "\\$&")));
  assert.match(result.answer, /Alimentação/);
});

test("executeFinanceIntelligence conta metas financeiras ativas e cita o nome quando só há uma", () => {
  const result = executeFinanceIntelligence(baseArgs({ question: "quantas metas eu tenho", goals }));
  assert.equal(result.ok, true);
  assert.match(result.answer, /1 meta financeira ativa: Viagem/);
});

test("executeFinanceIntelligence lista contas vencidas somando os valores", () => {
  const result = executeFinanceIntelligence(baseArgs({ question: "tem conta atrasada", bills }));
  assert.equal(result.ok, true);
  assert.equal(result.intent, "bills_overdue");
  assert.match(result.answer, /1 conta vencida/);
  assert.match(result.answer, new RegExp(money(200).replace(/[.$]/g, "\\$&")));
});

test("executeFinanceIntelligence falha graciosamente quando não reconhece a pergunta", () => {
  const result = executeFinanceIntelligence(baseArgs({ question: "isso nao quer dizer nada financeiro" }));
  assert.equal(result.ok, false);
  assert.ok(result.answer.length > 0);
});

test("computeFinanceProjectionForMonth soma entradas/saídas do mês e calcula disponível pelo limite", () => {
  const projection = computeFinanceProjectionForMonth({
    month: today().slice(0, 7),
    transactions,
    bills: [],
    recurring: [],
    monthlyLimit: 2000,
  });
  assert.equal(projection.monthIn, 5000);
  assert.equal(projection.monthOut, 1500);
  // Com limite mensal definido, o disponível é limite - gasto (não renda - gasto).
  assert.equal(projection.availableToSpend, 500);
});

test("computeFinanceProjectionForMonth usa renda - gasto como disponível quando não há limite definido", () => {
  const projection = computeFinanceProjectionForMonth({
    month: today().slice(0, 7),
    transactions,
    bills: [],
    recurring: [],
    monthlyLimit: 0,
  });
  assert.equal(projection.availableToSpend, 5000 - 1500);
});

test("computeFinanceProjectionForMonth não extrapola gasto de mês fechado (só o mês corrente extrapola)", () => {
  // Um mês totalmente no passado usa o gasto real como projeção, sem
  // multiplicar por dias restantes (que não existem mais).
  const pastMonthDate = new Date();
  pastMonthDate.setMonth(pastMonthDate.getMonth() - 2, 15);
  const pastMonthKey = `${pastMonthDate.getFullYear()}-${pad(pastMonthDate.getMonth() + 1)}`;
  const pastTransactions = [
    { id: "p1", type: "saida", value: 900, date: `${pastMonthKey}-10` },
  ];
  const projection = computeFinanceProjectionForMonth({
    month: pastMonthKey,
    transactions: pastTransactions,
    bills: [],
    recurring: [],
    monthlyLimit: 0,
  });
  assert.equal(projection.projectedOut, 900);
});
