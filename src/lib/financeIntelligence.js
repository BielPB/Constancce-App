// Assistente de linguagem natural de Finanças (detecção de intenção,
// execução e projeção do mês) — extraído de src/features/finance/FinanceView.jsx
// pra ser testável isoladamente (Node não consegue importar um .jsx
// diretamente, e essa lógica é 100% pura, sem JSX/React). Duplica localmente
// fmt/today/money/monthsUntilGoal (FinanceView.jsx mantém as suas próprias
// cópias, usadas pelos componentes de UI) — mesmo padrão de pequena
// duplicação intencional já usado entre FinanceView.jsx e App.jsx.
const fmt = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today = () => fmt(new Date());
const money = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthsUntilGoal = (endDate) => {
  if (!endDate) return 1;
  const start = new Date(today() + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  const diffDays = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  return Math.max(1, Math.ceil(diffDays / 30.4375));
};

const FINANCE_CATEGORY_ALIASES = {
  "Alimentação": ["alimentacao", "comida", "mercado", "supermercado", "restaurante", "lanche", "delivery", "ifood", "jantar", "almoco", "cafe"],
  "Transporte": ["transporte", "uber", "99", "taxi", "gasolina", "combustivel", "posto", "estacionamento", "onibus"],
  "Lazer": ["lazer", "cinema", "bar", "festa", "viagem", "jogo", "games", "streaming", "passeio"],
  "Contas": ["conta", "contas", "aluguel", "condominio", "energia", "luz", "agua", "internet", "telefone", "celular", "boleto"],
  "Compras": ["compra", "compras", "shopping", "roupa", "tenis", "eletronico", "amazon", "magalu", "mercado livre"],
  "Educação": ["educacao", "curso", "faculdade", "livro", "escola", "mensalidade", "estudo"],
  "Aporte para meta": ["aporte", "investimento", "guardar", "poupar", "reserva", "meta"],
};

const FINANCE_MONTH_NAMES = {
  janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

const normalizeFinanceText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$.,-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const financeDateString = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const financePeriodLabel = (period) => {
  if (!period) return "período";
  if (period.label) return period.label;
  if (period.start === period.end) return new Date(`${period.start}T12:00:00`).toLocaleDateString("pt-BR");
  return `${new Date(`${period.start}T12:00:00`).toLocaleDateString("pt-BR")} a ${new Date(`${period.end}T12:00:00`).toLocaleDateString("pt-BR")}`;
};

const financeMonthRange = (year, monthIndex) => {
  const start = new Date(year, monthIndex, 1, 12);
  const end = new Date(year, monthIndex + 1, 0, 12);
  return { start: financeDateString(start), end: financeDateString(end) };
};

const financePreviousPeriod = (period) => {
  if (!period) return null;

  const start = new Date(`${period.start}T12:00:00`);
  const end = new Date(`${period.end}T12:00:00`);

  if (start.getDate() === 1 && ["current_month", "selected_month", "named_month", "previous_month"].includes(period.id)) {
    const previousMonth = financeMonthRange(start.getFullYear(), start.getMonth() - 1);
    return {
      id: "previous_calendar_month",
      ...previousMonth,
      label: "mês anterior",
    };
  }

  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);

  return {
    id: "previous_period",
    start: financeDateString(prevStart),
    end: financeDateString(prevEnd),
    label: "período anterior",
  };
};

function detectFinancePeriod(text, fallbackMonth = today().slice(0, 7), contextPeriod = null) {
  const q = normalizeFinanceText(text);
  const now = new Date(`${today()}T12:00:00`);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  if (/\bhoje\b/.test(q)) {
    return { id: "today", start: today(), end: today(), label: "hoje", explicit: true };
  }

  if (/\bontem\b/.test(q)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const date = financeDateString(d);
    return { id: "yesterday", start: date, end: date, label: "ontem", explicit: true };
  }

  if (/anteontem/.test(q)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    const date = financeDateString(d);
    return { id: "before_yesterday", start: date, end: date, label: "anteontem", explicit: true };
  }

  if (/(essa|esta|nesta|nessa) semana/.test(q)) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    return {
      id: "current_week",
      start: financeDateString(start),
      end: today(),
      label: "esta semana",
      explicit: true,
    };
  }

  if (/semana passada|ultima semana/.test(q)) {
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - currentStart.getDay());
    const end = new Date(currentStart);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return {
      id: "previous_week",
      start: financeDateString(start),
      end: financeDateString(end),
      label: "semana passada",
      explicit: true,
    };
  }

  const lastDaysMatch = q.match(/ultimos?\s+(\d{1,3})\s+dias?/);
  if (lastDaysMatch) {
    const amount = Math.max(1, Math.min(365, Number(lastDaysMatch[1])));
    const start = new Date(now);
    start.setDate(start.getDate() - amount + 1);
    return {
      id: `last_${amount}_days`,
      start: financeDateString(start),
      end: today(),
      label: `últimos ${amount} dias`,
      explicit: true,
    };
  }

  if (/mes passado|ultimo mes/.test(q)) {
    const range = financeMonthRange(currentYear, currentMonth - 1);
    return { id: "previous_month", ...range, label: "mês passado", explicit: true };
  }

  if (/(esse|este|neste|nesse) mes/.test(q)) {
    const range = financeMonthRange(currentYear, currentMonth);
    return { id: "current_month", start: range.start, end: today(), label: "este mês", explicit: true };
  }

  for (const [name, monthIndex] of Object.entries(FINANCE_MONTH_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(q)) {
      const yearMatch = q.match(/\b(20\d{2})\b/);
      let year = yearMatch ? Number(yearMatch[1]) : currentYear;
      if (!yearMatch && monthIndex > currentMonth) year -= 1;
      const range = financeMonthRange(year, monthIndex);
      return { id: "named_month", ...range, label: `${name} de ${year}`, explicit: true };
    }
  }

  // Frases de continuação como "e mês passado?" usam o mesmo assunto,
  // mas detectFinancePeriod já captura o período acima.
  if (contextPeriod && /^(e |e no |e em |e na |e nos |e nas )/.test(q)) {
    return { ...contextPeriod, explicit: false };
  }

  // Sem período explícito: usa o mês que o usuário está visualizando em Finanças.
  const [year, month] = String(fallbackMonth || today().slice(0, 7)).split("-").map(Number);
  const range = financeMonthRange(year, month - 1);
  const isCurrent = fallbackMonth === today().slice(0, 7);
  return {
    id: "selected_month",
    start: range.start,
    end: isCurrent ? today() : range.end,
    label: isCurrent
      ? "este mês"
      : new Date(`${fallbackMonth}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    explicit: false,
  };
}

function detectFinanceCategory(text) {
  const q = normalizeFinanceText(text);
  const candidates = Object.entries(FINANCE_CATEGORY_ALIASES)
    .flatMap(([category, aliases]) =>
      aliases.map((alias) => ({ category, alias: normalizeFinanceText(alias) }))
    )
    .sort((a, b) => b.alias.length - a.alias.length);

  const match = candidates.find(({ alias }) => new RegExp(`\\b${alias}\\b`).test(q));
  return match?.category || null;
}

function detectFinanceGoal(text, goals = []) {
  const q = normalizeFinanceText(text);
  const active = (goals || []).filter((goal) => goal.type === "financeira" && !goal.completed);
  if (!active.length) return null;

  const scored = active
    .map((goal) => {
      const name = normalizeFinanceText(goal.name);
      const nameWords = name.split(" ").filter((word) => word.length >= 3);
      const hits = nameWords.filter((word) => q.includes(word)).length;
      const exact = name && q.includes(name);
      return { goal, score: exact ? 10 : hits };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].goal : null;
}

function detectFinanceSearchTerm(text, transactions = []) {
  const q = normalizeFinanceText(text);
  const stopWords = new Set([
    "quanto","gastei","gasto","gastos","paguei","pago","recebi","entrou","entrada","saida","saidas",
    "esse","este","neste","mes","mês","passado","hoje","ontem","semana","ultima","última","ultimos",
    "dias","com","em","no","na","nos","nas","de","do","da","dos","das","meu","minha","eu","foi",
    "qual","onde","mais","menos","total","valor","dinheiro","tenho","tive",
  ]);

  const knownDescriptions = [...new Set((transactions || []).map((tx) => normalizeFinanceText(tx.description)).filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  const direct = knownDescriptions.find((description) => q.includes(description));
  if (direct) return direct;

  const words = q.split(" ").filter((word) => word.length >= 3 && !stopWords.has(word));
  const candidate = words.find((word) =>
    (transactions || []).some((tx) => normalizeFinanceText(tx.description).includes(word))
  );
  return candidate || null;
}

function financeTransactionsInPeriod(transactions, period) {
  return (transactions || []).filter((tx) => {
    const date = String(tx.date || "");
    return date >= period.start && date <= period.end;
  });
}

function financeSum(rows, type = null) {
  return (rows || [])
    .filter((row) => !type || row.type === type)
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
}

function financeCategorySummary(rows) {
  const map = new Map();
  rows
    .filter((row) => row.type === "saida")
    .forEach((row) => {
      const key = row.category || "Outro";
      map.set(key, (map.get(key) || 0) + Number(row.value || 0));
    });
  return [...map.entries()]
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => b.value - a.value);
}

function financeDescriptionSummary(rows) {
  const map = new Map();
  rows
    .filter((row) => row.type === "saida")
    .forEach((row) => {
      const description = String(row.description || row.category || "Sem descrição").trim();
      const key = description || "Sem descrição";
      map.set(key, (map.get(key) || 0) + Number(row.value || 0));
    });
  return [...map.entries()]
    .map(([description, value]) => ({ description, value }))
    .sort((a, b) => b.value - a.value);
}

function computeFinanceProjectionForMonth({
  month,
  transactions,
  bills,
  recurring,
  monthlyLimit,
}) {
  const key = month || today().slice(0, 7);
  const rows = (transactions || []).filter((tx) => String(tx.date || "").slice(0, 7) === key);
  const monthIn = financeSum(rows.filter((tx) => tx.type === "entrada"));
  const monthOut = financeSum(rows.filter((tx) => tx.type === "saida"));

  const [year, monthNumber] = key.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const isCurrentMonth = key === today().slice(0, 7);
  const elapsedDays = isCurrentMonth ? Math.max(1, new Date().getDate()) : daysInMonth;

  const activeRecurring = (recurring || []).filter(
    (item) =>
      item.active !== false &&
      (!item.createdAt || String(item.createdAt).slice(0, 7) <= key)
  );

  const postedRecurringIds = new Set(rows.filter((tx) => tx.recurringId).map((tx) => tx.recurringId));
  const missingRecurring = isCurrentMonth
    ? activeRecurring.filter((item) => !postedRecurringIds.has(item.id))
    : [];

  const postedRecurringOut = rows
    .filter((tx) => tx.type === "saida" && tx.recurringId)
    .reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  // Contas a pagar já quitadas neste mês (têm billId) são um valor certo que
  // já aconteceu, não um ritmo de gasto do dia a dia. Se entrarem no cálculo
  // de "gasto variável", o projetor as multiplica pelos dias restantes do mês
  // como se você fosse pagar aquele boleto todo santo dia — daí a projeção
  // vinha muito distorcida sempre que uma conta grande era paga cedo no mês.
  const postedBillsOut = rows
    .filter((tx) => tx.type === "saida" && tx.billId)
    .reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  const futureRecurringOut = missingRecurring
    .filter((item) => item.type === "saida")
    .reduce((sum, item) => sum + Number(item.value || 0), 0);

  const futureRecurringIn = missingRecurring
    .filter((item) => item.type === "entrada")
    .reduce((sum, item) => sum + Number(item.value || 0), 0);

  const pendingBills = (bills || [])
    .filter((bill) => bill.status !== "pago" && String(bill.dueDate || "").slice(0, 7) === key)
    .reduce((sum, bill) => sum + Number(bill.value || 0), 0);

  // Nos primeiros dias do mês, extrapolar pelo número real de dias já
  // passados amplifica qualquer gasto de forma extrema (no dia 1, um multiplicador
  // de 30x). Limitamos a base da extrapolação a pelo menos 20% do mês, o que
  // trava o multiplicador em no máximo 5x — a projeção fica mais conservadora
  // logo no início e se aproxima do ritmo real conforme os dias passam.
  const extrapolationDays = Math.max(elapsedDays, Math.round(daysInMonth * 0.2));
  const variableSpent = Math.max(0, monthOut - postedRecurringOut - postedBillsOut);
  const projectedVariableOut = isCurrentMonth
    ? (variableSpent / extrapolationDays) * daysInMonth
    : variableSpent;

  const projectedOut = projectedVariableOut + postedRecurringOut + postedBillsOut + futureRecurringOut + pendingBills;
  const projectedIn = monthIn + futureRecurringIn;
  const projectedBalance = projectedIn - projectedOut;
  const limit = Number(monthlyLimit || 0);

  return {
    monthIn,
    monthOut,
    projectedIn,
    projectedOut,
    projectedBalance,
    futureRecurringOut,
    futureRecurringIn,
    availableToSpend: limit > 0
      ? Math.max(0, limit - monthOut)
      : Math.max(0, monthIn - monthOut),
  };
}

const FINANCE_INTENT_RULES = [
  {
    id: "goals_overview",
    confidence: .97,
    patterns: [/(como estao|como vao).*(metas?)/, /(resumo|situacao).*(metas?)/],
  },
  {
    id: "goal_projection",
    confidence: .94,
    patterns: [/(vou|consigo|conseguirei).*(bater|atingir|chegar).*(meta)/, /(meta).*(vou|consigo).*(bater|atingir|chegar)/],
  },
  {
    id: "goal_monthly_needed",
    confidence: .96,
    patterns: [/(quanto).*(guardar|aportar|poupar).*(mes).*(meta)?/, /(meta).*(quanto).*(mes)/],
  },
  {
    id: "balance_diagnosis",
    confidence: .90,
    patterns: [/(por que|porque).*(saldo|sobra).*(caiu|diminuiu|baixou)/, /(saldo|sobra).*(caiu|diminuiu|baixou)/],
  },
  {
    id: "expense_diagnosis",
    confidence: .90,
    patterns: [/(onde).*(desperdic|gastando demais|gasto demais)/, /(o que).*(aumentou|subiu).*(gasto|despesa)/, /(qual).*(categoria).*(aumentou|subiu)/],
  },

  {
    id: "goals_count",
    confidence: .98,
    patterns: [/quantas?.*metas?/, /mais de (uma|1).*meta/, /metas?.*(tenho|possuo)/],
  },
  {
    id: "goals_list",
    confidence: .96,
    patterns: [/(quais|lista|listar|mostra|mostrar).*(metas?)/, /metas?.*(quais|lista|listar|mostra|mostrar)/],
  },
  {
    id: "goal_remaining",
    confidence: .96,
    patterns: [/(quanto falta|falta quanto).*(meta)/, /meta.*(quanto falta|falta quanto)/],
  },
  {
    id: "goal_progress",
    confidence: .94,
    patterns: [/(como esta|progresso|andamento|quanto tenho).*(meta)/, /meta.*(como esta|progresso|andamento|quanto tenho)/],
  },
  {
    id: "bills_overdue",
    confidence: .98,
    patterns: [/(conta|boleto).*(atrasad|vencid)/, /(atrasad|vencid).*(conta|boleto)/],
  },
  {
    id: "next_bill",
    confidence: .97,
    patterns: [/(proxima|próxima).*(conta|boleto)/, /(conta|boleto).*(proxima|próxima)/],
  },
  {
    id: "bills_due",
    confidence: .94,
    patterns: [/(contas?|boletos?).*(venc|proxim)/, /(venc|proxim).*(contas?|boletos?)/],
  },
  {
    id: "bills_total",
    confidence: .93,
    patterns: [/(quanto|total).*(contas?|boletos?).*(pagar|pendente)/, /(contas?|boletos?).*(quanto|total)/],
  },
  {
    id: "month_forecast",
    confidence: .97,
    patterns: [/como.*(fecha|fechamento).*(mes)?/, /(projecao|projeção|fim do mes|final do mes)/],
  },
  {
    id: "available_budget",
    confidence: .96,
    patterns: [/quanto.*(posso|ainda posso).*(gastar)/, /(disponivel|disponível).*(gastar|limite)/, /quanto.*livre/],
  },
  {
    id: "compare_income",
    confidence: .94,
    patterns: [/(recebi|entrada|receita).*(mais|menos).*(mes passado|periodo anterior)/, /compar.*(entrada|receita)/],
  },
  {
    id: "savings_total",
    confidence: .93,
    patterns: [/(quanto).*(economizei|guardei|poupei)/, /(economizei|guardei|poupei).*(quanto)?/],
  },
  {
    id: "compare_expenses",
    confidence: .95,
    patterns: [/(gastei|gastando|gastos?|despesas?).*(mais|menos).*(mes passado|periodo anterior)/, /(mais|menos).*(gasto|despesa)/, /compar.*(gasto|despesa)/],
  },
  {
    id: "top_category",
    confidence: .95,
    patterns: [/(onde|categoria).*(gasto|gasta|gastos).*(mais)?/, /(gasto|gastos).*mais/, /maior.*(gasto|categoria)/],
  },
  {
    id: "top_expense",
    confidence: .93,
    patterns: [/(maior|pior).*(compra|gasto|despesa)/, /(gasto|despesa).*(maior|mais caro)/],
  },
  {
    id: "category_expense",
    confidence: .94,
    patterns: [/quanto.*(gastei|gasto|paguei).*(com|em)/, /(gastei|gasto).*(alimentacao|comida|transporte|uber|gasolina|lazer|conta|compras|educacao|ifood)/],
  },
  {
    id: "expense_total",
    confidence: .90,
    patterns: [/(quanto|total).*(gastei|gasto|gastos|paguei|saidas?|despesas?)/, /(gastei|paguei).*(quanto)/],
  },
  {
    id: "income_total",
    confidence: .92,
    patterns: [/(quanto|total).*(recebi|entrou|entradas?|receita)/, /(recebi|entrou).*(quanto)/],
  },
  {
    id: "balance",
    confidence: .92,
    patterns: [/(saldo|sobrou|sobra|diferenca|diferença)/],
  },
  {
    id: "recurring_expenses",
    confidence: .94,
    patterns: [/(gastos?|despesas?).*(recorrente|fixo)/, /(recorrente|fixo).*(gasto|despesa)/],
  },
  {
    id: "recurring_income",
    confidence: .94,
    patterns: [/(receitas?|entradas?).*(recorrente|fixa)/, /(recorrente|fixa).*(receita|entrada)/],
  },
];

function detectFinanceIntent(text, context = null) {
  const q = normalizeFinanceText(text);

  if (context?.goal && /quanto falta/.test(q)) {
    return { intent: "goal_remaining", confidence: .90, source: "context" };
  }
  if (context?.goal && /(quanto).*(guardar|aportar|poupar).*(mes)/.test(q)) {
    return { intent: "goal_monthly_needed", confidence: .90, source: "context" };
  }
  if (context?.goal && /(vou|consigo).*(bater|atingir|chegar)/.test(q)) {
    return { intent: "goal_projection", confidence: .88, source: "context" };
  }

  for (const rule of FINANCE_INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(q))) {
      return { intent: rule.id, confidence: rule.confidence, source: "direct" };
    }
  }

  // Continuação contextual: "e mês passado?", "e hoje?", "e alimentação?"
  const continuation = /^(e\b|e no\b|e na\b|e em\b|e a\b|e o\b|e esse\b|e este\b|e mes\b|e hoje\b|e ontem\b)/.test(q);
  if (continuation && context?.intent) {
    return { intent: context.intent, confidence: .78, source: "context" };
  }

  return { intent: null, confidence: .25, source: "none" };
}

function executeFinanceIntelligence({
  question,
  transactions,
  goals,
  bills,
  recurring,
  monthlyLimit,
  budgets,
  selectedMonth,
  projectedBalance,
  availableToSpend,
  context,
}) {
  const q = normalizeFinanceText(question);
  const intentResult = detectFinanceIntent(q, context);
  let period = detectFinancePeriod(q, selectedMonth, context?.period);

  // "Estou gastando mais que mês passado?" compara o mês atual contra o mês passado,
  // e não o mês passado contra dois meses atrás.
  if (["compare_expenses", "compare_income"].includes(intentResult.intent) && /mes passado/.test(q)) {
    const currentRange = financeMonthRange(new Date().getFullYear(), new Date().getMonth());
    period = {
      id: "current_month",
      start: currentRange.start,
      end: today(),
      label: "este mês",
      explicit: true,
    };
  }

  const category = detectFinanceCategory(q) || (intentResult.source === "context" ? context?.category : null);
  const goal = detectFinanceGoal(q, goals) || (intentResult.source === "context" ? context?.goal : null);
  const searchTerm = detectFinanceSearchTerm(q, transactions) || (intentResult.source === "context" ? context?.searchTerm : null);
  let { intent, confidence } = intentResult;

  // Uma descrição/estabelecimento cadastrado é mais específico que uma categoria,
  // mas nunca pode sobrescrever perguntas sobre metas, contas ou projeções.
  const canResolveAsExpense = !intent || ["expense_total", "category_expense"].includes(intent);

  if (category && intent === "available_budget") {
    intent = "category_budget";
    confidence = Math.max(confidence, .95);
  } else if (canResolveAsExpense && searchTerm && /(gasto|gastei|paguei|quanto|despesa)/.test(q)) {
    intent = "merchant_expense";
    confidence = Math.max(confidence, .91);
  } else if (canResolveAsExpense && category && /(gasto|gastei|paguei|quanto|despesa)/.test(q)) {
    intent = "category_expense";
    confidence = Math.max(confidence, .93);
  }

  const periodRows = financeTransactionsInPeriod(transactions, period);
  const expenses = periodRows.filter((tx) => tx.type === "saida");
  const incomes = periodRows.filter((tx) => tx.type === "entrada");
  const activeGoals = (goals || []).filter((item) => item.type === "financeira" && !item.completed);
  const pendingBills = (bills || []).filter((bill) => bill.status !== "pago");
  const nowDate = today();

  const resultContext = {
    intent,
    period,
    category,
    goal,
    searchTerm,
  };

  const fail = (message = "Não consigo te ajudar com essa pergunta no momento.", nextConfidence = confidence) => ({
    ok: false,
    answer: message,
    confidence: nextConfidence,
    intent,
    context: resultContext,
  });

  const success = (answer, meta = {}) => ({
    ok: true,
    answer,
    confidence,
    intent,
    context: resultContext,
    meta,
  });

  if (!intent || confidence < .55) return fail();

  switch (intent) {
    case "goals_overview": {
      if (!activeGoals.length) return success("Você não tem nenhuma meta financeira ativa.");

      if (activeGoals.length === 1) {
        const item = activeGoals[0];
        const current = Number(item.current || 0);
        const target = Number(item.target || 0);
        const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
        return success(`Sua meta ${item.name} está em ${pct}%.`);
      }

      const summary = activeGoals
        .slice(0, 3)
        .map((item) => {
          const current = Number(item.current || 0);
          const target = Number(item.target || 0);
          const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
          return `${item.name} ${pct}%`;
        })
        .join(" · ");

      return success(`Você tem ${activeGoals.length} metas ativas. ${summary}.`);
    }

    case "goal_projection": {
      const targetGoal = goal || (activeGoals.length === 1 ? activeGoals[0] : null);
      if (!targetGoal && activeGoals.length > 1) {
        return fail("Me diga qual meta você quer projetar.", .82);
      }
      if (!targetGoal) return success("Você não tem nenhuma meta financeira ativa.");

      const remaining = Math.max(0, Number(targetGoal.target || 0) - Number(targetGoal.current || 0));
      if (remaining <= 0) return success(`A meta ${targetGoal.name} já foi atingida.`);
      if (!targetGoal.endDate) {
        return fail(`A meta ${targetGoal.name} não tem uma data final. Sem isso, não consigo fazer a projeção.`, .88);
      }

      const months = monthsUntilGoal(targetGoal.endDate);
      const needed = remaining / Math.max(1, months);
      const projection = computeFinanceProjectionForMonth({
        month: today().slice(0, 7),
        transactions,
        bills,
        recurring,
        monthlyLimit,
      });

      if (projection.projectedBalance >= needed) {
        return success(`Sim. A meta ${targetGoal.name} parece viável. Você precisa de cerca de ${money(needed)} por mês.`);
      }

      return success(`No ritmo atual, a meta ${targetGoal.name} está apertada. Você precisa de cerca de ${money(needed)} por mês.`);
    }

    case "goal_monthly_needed": {
      const targetGoal = goal || (activeGoals.length === 1 ? activeGoals[0] : null);
      if (!targetGoal && activeGoals.length > 1) {
        return fail("Me diga para qual meta você quer calcular o valor mensal.", .82);
      }
      if (!targetGoal) return success("Você não tem nenhuma meta financeira ativa.");
      if (!targetGoal.endDate) {
        return fail(`A meta ${targetGoal.name} não tem data final. Não consigo calcular o valor mensal sem essa data.`, .88);
      }

      return success(`Para atingir ${targetGoal.name} no prazo, você precisa de aproximadamente ${money(monthlyGoalEstimate(targetGoal))} por mês.`);
    }

    case "balance_diagnosis": {
      const previousPeriod = financePreviousPeriod(period);
      const previousRows = financeTransactionsInPeriod(transactions, previousPeriod);

      const currentIn = financeSum(periodRows, "entrada");
      const currentOut = financeSum(periodRows, "saida");
      const previousIn = financeSum(previousRows, "entrada");
      const previousOut = financeSum(previousRows, "saida");

      const incomeChange = currentIn - previousIn;
      const expenseChange = currentOut - previousOut;

      if (expenseChange > 0 && Math.abs(expenseChange) >= Math.abs(incomeChange)) {
        const currentCategories = financeCategorySummary(periodRows);
        const previousCategories = financeCategorySummary(previousRows);

        const changes = currentCategories
          .map((item) => {
            const before = previousCategories.find((row) => row.category === item.category)?.value || 0;
            return { category: item.category, delta: item.value - before };
          })
          .sort((a, b) => b.delta - a.delta);

        const driver = changes[0];
        if (driver?.delta > 0) {
          return success(`Sua sobra caiu principalmente porque ${driver.category} aumentou ${money(driver.delta)}.`);
        }

        return success(`Sua sobra caiu porque seus gastos aumentaram ${money(expenseChange)}.`);
      }

      if (incomeChange < 0) {
        return success(`Sua sobra caiu principalmente porque suas entradas diminuíram ${money(Math.abs(incomeChange))}.`);
      }

      return success("Não encontrei uma mudança forte o suficiente para apontar um único motivo.");
    }

    case "expense_diagnosis": {
      const previousPeriod = financePreviousPeriod(period);
      const previousRows = financeTransactionsInPeriod(transactions, previousPeriod);
      const currentCategories = financeCategorySummary(periodRows);
      const previousCategories = financeCategorySummary(previousRows);

      const changes = currentCategories
        .map((item) => {
          const previousValue = previousCategories.find((row) => row.category === item.category)?.value || 0;
          return {
            category: item.category,
            current: item.value,
            previous: previousValue,
            delta: item.value - previousValue,
          };
        })
        .sort((a, b) => b.delta - a.delta);

      const top = changes[0];

      if (!top || top.delta <= 0) {
        const ranking = financeCategorySummary(periodRows);
        if (!ranking.length) return success("Ainda não há gastos suficientes para fazer esse diagnóstico.");
        return success(`Seu maior gasto está em ${ranking[0].category}: ${money(ranking[0].value)}.`);
      }

      return success(`${top.category} foi a maior alta: ${money(top.delta)} a mais que no período anterior.`);
    }

    case "goals_count": {
      if (activeGoals.length === 0) return success("Você não tem nenhuma meta financeira ativa.");
      if (activeGoals.length === 1) return success(`Você tem 1 meta financeira ativa: ${activeGoals[0].name}.`);
      return success(`Você tem ${activeGoals.length} metas financeiras ativas.`);
    }

    case "goals_list": {
      if (!activeGoals.length) return success("Você não tem nenhuma meta financeira ativa.");
      return success(`Suas metas ativas são: ${activeGoals.map((item) => item.name).join(", ")}.`);
    }

    case "goal_progress":
    case "goal_remaining": {
      const targetGoal = goal || (activeGoals.length === 1 ? activeGoals[0] : null);
      if (!targetGoal && activeGoals.length > 1) {
        return fail("Você tem mais de uma meta. Me diga o nome da meta que quer consultar.", .82);
      }
      if (!targetGoal) return success("Você não tem nenhuma meta financeira ativa.");

      const current = Number(targetGoal.current || 0);
      const target = Number(targetGoal.target || 0);
      const remaining = Math.max(0, target - current);
      const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

      if (intent === "goal_remaining") {
        return success(`Faltam ${money(remaining)} para a meta ${targetGoal.name}.`);
      }
      return success(`${targetGoal.name}: ${pct}% concluída. Você tem ${money(current)} de ${money(target)}.`);
    }

    case "expense_total": {
      return success(`Você gastou ${money(financeSum(expenses))} ${financePeriodLabel(period)}.`);
    }

    case "income_total": {
      return success(`Entrou ${money(financeSum(incomes))} ${financePeriodLabel(period)}.`);
    }

    case "balance": {
      const balance = financeSum(incomes) - financeSum(expenses);
      return success(
        balance >= 0
          ? `Seu saldo em ${financePeriodLabel(period)} está positivo em ${money(balance)}.`
          : `Seu saldo em ${financePeriodLabel(period)} está negativo em ${money(Math.abs(balance))}.`
      );
    }

    case "category_expense": {
      if (!category) return fail("Qual categoria você quer consultar? Ex.: Alimentação, Transporte ou Contas.", .72);
      const rows = expenses.filter((tx) => tx.category === category);
      return success(`Você gastou ${money(financeSum(rows))} com ${category} ${financePeriodLabel(period)}.`);
    }

    case "merchant_expense": {
      if (!searchTerm) return fail();
      const rows = expenses.filter((tx) => normalizeFinanceText(tx.description).includes(searchTerm));
      const display = rows[0]?.description || searchTerm;
      return success(`Você gastou ${money(financeSum(rows))} com ${display} ${financePeriodLabel(period)}.`);
    }

    case "top_category": {
      const ranking = financeCategorySummary(expenses);
      if (!ranking.length) return success(`Você ainda não registrou gastos ${financePeriodLabel(period)}.`);
      const top = ranking[0];
      return success(`Sua maior categoria é ${top.category}: ${money(top.value)} ${financePeriodLabel(period)}.`);
    }

    case "top_expense": {
      const ranking = financeDescriptionSummary(expenses);
      if (!ranking.length) return success(`Você ainda não registrou gastos ${financePeriodLabel(period)}.`);
      const top = ranking[0];
      return success(`Seu maior gasto foi ${top.description}: ${money(top.value)} ${financePeriodLabel(period)}.`);
    }

    case "compare_income": {
      const previous = financePreviousPeriod(period);
      const currentValue = financeSum(incomes);
      const previousValue = financeSum(
        financeTransactionsInPeriod(transactions, previous).filter((tx) => tx.type === "entrada")
      );
      const diff = currentValue - previousValue;

      if (previousValue === 0 && currentValue === 0) {
        return success("Não há entradas suficientes para comparar esses períodos.");
      }
      // Tolerância de meio centavo: diff === 0 exato quase nunca bate por
      // resíduo de ponto flutuante em somas de valores monetários, mesmo
      // quando os totais são, na prática, iguais.
      if (Math.abs(diff) < 0.005) return success(`Suas entradas ficaram iguais: ${money(currentValue)}.`);
      if (diff > 0) return success(`Você recebeu ${money(diff)} a mais que no período anterior.`);
      return success(`Você recebeu ${money(Math.abs(diff))} a menos que no período anterior.`);
    }

    case "savings_total": {
      const saved = financeSum(incomes) - financeSum(expenses);
      if (saved > 0.005) return success(`Você economizou ${money(saved)} ${financePeriodLabel(period)}.`);
      if (Math.abs(saved) < 0.005) return success(`Você ficou no zero a zero ${financePeriodLabel(period)}.`);
      return success(`Não houve economia líquida. O período ficou negativo em ${money(Math.abs(saved))}.`);
    }

    case "category_budget": {
      if (!category) return fail("Qual categoria você quer consultar?", .72);
      const budget = Number(budgets?.[category] || 0);
      if (budget <= 0) {
        return fail(`Você ainda não definiu um orçamento para ${category}.`, .86);
      }
      const spent = financeSum(expenses.filter((tx) => tx.category === category));
      const remaining = Math.max(0, budget - spent);
      return success(`Você ainda pode gastar ${money(remaining)} em ${category} dentro do orçamento atual.`);
    }

    case "compare_expenses": {
      const previous = financePreviousPeriod(period);
      const currentValue = financeSum(expenses);
      const previousValue = financeSum(financeTransactionsInPeriod(transactions, previous).filter((tx) => tx.type === "saida"));
      const diff = currentValue - previousValue;

      if (previousValue === 0 && currentValue === 0) {
        return success("Não há gastos suficientes para comparar esses períodos.");
      }
      if (Math.abs(diff) < 0.005) return success(`Seus gastos ficaram iguais: ${money(currentValue)}.`);
      if (diff > 0) return success(`Você gastou ${money(diff)} a mais que no período anterior.`);
      return success(`Você gastou ${money(Math.abs(diff))} a menos que no período anterior.`);
    }

    case "bills_overdue": {
      const overdue = pendingBills
        .filter((bill) => bill.dueDate && bill.dueDate < nowDate)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

      if (!overdue.length) return success("Você não tem contas vencidas.");
      const total = overdue.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
      return success(`Você tem ${overdue.length} conta${overdue.length === 1 ? "" : "s"} vencida${overdue.length === 1 ? "" : "s"}, somando ${money(total)}.`);
    }

    case "next_bill": {
      const future = pendingBills
        .filter((bill) => bill.dueDate && bill.dueDate >= nowDate)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      if (!future.length) return success("Você não tem nenhuma conta futura pendente.");
      const next = future[0];
      return success(`Sua próxima conta é ${next.description}: ${money(next.value)}, vencendo em ${new Date(`${next.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}.`);
    }

    case "bills_due": {
      const future = pendingBills
        .filter((bill) => bill.dueDate && bill.dueDate >= nowDate)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      if (!future.length) return success("Você não tem contas futuras pendentes.");
      const nextSeven = future.filter((bill) => {
        const days = Math.ceil((new Date(`${bill.dueDate}T12:00:00`) - new Date(`${nowDate}T12:00:00`)) / 86400000);
        return days <= 7;
      });
      if (!nextSeven.length) return success("Você não tem contas vencendo nos próximos 7 dias.");
      const total = nextSeven.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
      return success(`${nextSeven.length} conta${nextSeven.length === 1 ? "" : "s"} vence${nextSeven.length === 1 ? "" : "m"} nos próximos 7 dias: ${money(total)}.`);
    }

    case "bills_total": {
      const total = pendingBills.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
      return success(`Você tem ${money(total)} em contas pendentes.`);
    }

    case "month_forecast": {
      const projection = computeFinanceProjectionForMonth({
        month: period.start.slice(0, 7),
        transactions,
        bills,
        recurring,
        monthlyLimit,
      });

      return success(
        projection.projectedBalance >= 0
          ? `Mantendo o ritmo atual, você fecha o mês com aproximadamente ${money(projection.projectedBalance)} positivo.`
          : `Mantendo o ritmo atual, você fecha o mês com aproximadamente ${money(Math.abs(projection.projectedBalance))} negativo.`
      );
    }

    case "available_budget": {
      if (Number(monthlyLimit || 0) <= 0) {
        return fail("Defina um limite mensal para eu calcular quanto ainda pode gastar.", .8);
      }

      const projection = computeFinanceProjectionForMonth({
        month: period.start.slice(0, 7),
        transactions,
        bills,
        recurring,
        monthlyLimit,
      });

      return success(`Você ainda pode gastar aproximadamente ${money(projection.availableToSpend)} dentro do limite atual.`);
    }

    case "recurring_expenses": {
      const rows = (recurring || []).filter((item) => item.active !== false && item.type === "saida");
      if (!rows.length) return success("Você não tem despesas recorrentes cadastradas.");
      const total = rows.reduce((sum, item) => sum + Number(item.value || 0), 0);
      return success(`Suas despesas recorrentes somam ${money(total)} por mês.`);
    }

    case "recurring_income": {
      const rows = (recurring || []).filter((item) => item.active !== false && item.type === "entrada");
      if (!rows.length) return success("Você não tem receitas recorrentes cadastradas.");
      const total = rows.reduce((sum, item) => sum + Number(item.value || 0), 0);
      return success(`Suas receitas recorrentes somam ${money(total)} por mês.`);
    }

    default:
      return fail();
  }
}

export {
  detectFinanceIntent,
  executeFinanceIntelligence,
  computeFinanceProjectionForMonth,
};
