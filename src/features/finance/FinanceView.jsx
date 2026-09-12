import React, { useState, useEffect } from "react";
import {
  ArrowDownRight, ArrowUpRight, Bell, BrainCircuit, Calendar as CalendarIcon, ChevronLeft,
  ChevronRight, Copy, CreditCard, Download, Gauge, History, MoreHorizontal, Pause, Pencil, Play,
  Plus, Search, Trash2, Wallet, Apple, Car, PartyPopper, Receipt, ShoppingBag, GraduationCap, Target,
} from "lucide-react";
import {
  Modal, Field, Progress, ProBadge, ProLockCard, FirstVisitTip, ConsistencyHeatmap, RadialProgress, useConfirm,
} from "../../components/ui.jsx";
import { PRO_LIMITS } from "../../lib/plans.js";
import FinanceBillForm from "./FinanceBillForm.jsx";

// Utilitários universais pequenos, copiados aqui de propósito (mesmo padrão já
// usado em src/features/professional/ProfessionalView.jsx para `uid`) — evita
// criar um import circular com App.jsx, que é quem carrega esta tela via lazy().
const fmt = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today = () => fmt(new Date());
const uid = () => Math.random().toString(36).slice(2, 10);
const money = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function monthKey(dateStr = today()) {
  return String(dateStr || "").slice(0, 7);
}
function smoothChartPath(points) {
  if (!points?.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    path += ` C ${midX} ${current.y}, ${midX} ${next.y}, ${next.x} ${next.y}`;
  }
  return path;
}
const monthsUntilGoal = (endDate) => {
  if (!endDate) return 1;
  const start = new Date(today() + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  const diffDays = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  return Math.max(1, Math.ceil(diffDays / 30.4375));
};
const monthlyGoalEstimate = (goal) => {
  const remaining = Math.max(0, Number(goal?.target || 0) - Number(goal?.current || 0));
  return remaining / monthsUntilGoal(goal?.endDate);
};

const FIN_IN = ["Salário", "Freelance", "Venda", "Outro"];
const FIN_OUT = ["Alimentação", "Transporte", "Lazer", "Contas", "Compras", "Educação", "Aporte para meta", "Outro"];
const FIN_CATEGORY_ICONS = {
  "Alimentação": Apple,
  "Transporte": Car,
  "Lazer": PartyPopper,
  "Contas": Receipt,
  "Compras": ShoppingBag,
  "Educação": GraduationCap,
  "Aporte para meta": Target,
  "Outro": MoreHorizontal,
};

/* ---------------------------------------------------------------
   FINANCE
----------------------------------------------------------------*/
function TransactionForm({ presetType, goals = [], onSave, onClose }) {
  const [type, setType] = useState(presetType || "saida");
  const [category, setCategory] = useState((presetType === "entrada" ? FIN_IN : FIN_OUT)[0]);
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today());
  const [goalId, setGoalId] = useState("");
  const cats = type === "entrada" ? FIN_IN : FIN_OUT;
  return (
    <Modal title="Novo lançamento" onClose={onClose}>
      <Field label="Tipo">
        <div className="flex gap-2">
          <button onClick={() => { setType("entrada"); setCategory(FIN_IN[0]); }} className="flex-1 py-2 rounded-xl text-sm flex items-center justify-center gap-1" style={{ border: `1px solid ${type === "entrada" ? "var(--moss)" : "var(--border)"}`, background: type === "entrada" ? "var(--surface-2)" : "transparent", color: type === "entrada" ? "var(--moss)" : "var(--text-dim)" }}><ArrowUpRight size={14} /> Entrada</button>
          <button onClick={() => { setType("saida"); setCategory(FIN_OUT[0]); }} className="flex-1 py-2 rounded-xl text-sm flex items-center justify-center gap-1" style={{ border: `1px solid ${type === "saida" ? "var(--ember)" : "var(--border)"}`, background: type === "saida" ? "var(--surface-2)" : "transparent", color: type === "saida" ? "var(--ember)" : "var(--text-dim)" }}><ArrowDownRight size={14} /> Saída</button>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)"><input type="number" className="w-full p-3 ring-focus" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Data"><input type="date" className="w-full p-3 ring-focus" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Categoria">
        <select className="w-full p-3 ring-focus" value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      {type === "saida" && category === "Aporte para meta" && (
        <Field label="Meta financeira">
          <select className="w-full p-3 ring-focus" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">Selecione a meta</option>
            {goals.filter((g) => g.type === "financeira" && !g.completed).map((g) => (
              <option key={g.id} value={g.id}>{g.name} · {money(g.current)} / {money(g.target)}</option>
            ))}
          </select>
          <p className="text-[10px] text-faint mt-1.5">O valor será registrado na Finanças e também somado automaticamente ao progresso da meta.</p>
        </Field>
      )}
      <Field label="Descrição"><input className="w-full p-3 ring-focus" placeholder="Opcional" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <button disabled={!value || Number(value) <= 0 || (type === "saida" && category === "Aporte para meta" && !goalId)} className="btn-primary w-full rounded-xl py-3 mt-2 disabled:opacity-40"
        onClick={() => onSave({ id: uid(), type, category, value: Number(value), date, description: description.trim(), goalId: goalId || null })}>
        Salvar lançamento
      </button>
    </Modal>
  );
}

function FinanceRecurringForm({ onSave, onClose }) {
  const [type, setType] = useState("saida");
  const [category, setCategory] = useState(FIN_OUT[0]);
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState(Math.min(28, new Date().getDate()));
  const cats = type === "entrada" ? FIN_IN : FIN_OUT;

  return (
    <Modal title="Nova recorrência mensal" onClose={onClose}>
      <Field label="Tipo">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setType("entrada"); setCategory(FIN_IN[0]); }}
            className="flex-1 py-2 rounded-xl text-sm"
            style={{ border: `1px solid ${type === "entrada" ? "var(--moss)" : "var(--border)"}`, color: type === "entrada" ? "var(--moss)" : "var(--text-dim)" }}
          >
            Entrada
          </button>
          <button
            type="button"
            onClick={() => { setType("saida"); setCategory(FIN_OUT[0]); }}
            className="flex-1 py-2 rounded-xl text-sm"
            style={{ border: `1px solid ${type === "saida" ? "var(--ember)" : "var(--border)"}`, color: type === "saida" ? "var(--ember)" : "var(--text-dim)" }}
          >
            Saída
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Valor mensal (R$)">
          <input type="number" min="0" step="0.01" className="w-full p-3 ring-focus" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Dia do mês">
          <input type="number" min="1" max="31" className="w-full p-3 ring-focus" value={day} onChange={(e) => setDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
        </Field>
      </div>

      <Field label="Categoria">
        <select className="w-full p-3 ring-focus" value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>

      <Field label="Descrição">
        <input className="w-full p-3 ring-focus" placeholder="Ex: Aluguel, academia, salário..." value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="surface-2 rounded-xl p-3 text-xs text-dim mb-3">
        O Constancce lançará esta recorrência automaticamente quando chegar o dia definido em cada mês.
      </div>

      <button
        disabled={!value || Number(value) <= 0 || !description.trim()}
        className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
        onClick={() => onSave({
          id: uid(),
          type,
          category,
          value: Number(value),
          description: description.trim(),
          day,
          active: true,
          createdAt: today(),
        })}
      >
        Salvar recorrência
      </button>
    </Modal>
  );
}


function FinanceDonutChart({ data, total }) {
  const palette = ["var(--ember)", "var(--brass)", "var(--moss)", "#8b78d1", "#4f9d9d", "#d18d5f", "#7e8794"];
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col lg:flex-row items-center gap-5">
      <div className="relative w-44 h-44 shrink-0">
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90" role="img" aria-label="Distribuição dos gastos por categoria">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
          {data.map((item, index) => {
            const share = total > 0 ? item.total / total : 0;
            const dash = share * circumference;
            const node = (
              <circle
                key={item.category}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={palette[index % palette.length]}
                strokeWidth="18"
                strokeLinecap="butt"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${item.category}: ${money(item.total)}`}</title>
              </circle>
            );
            offset += dash;
            return node;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] text-faint uppercase tracking-widest">Gastos</span>
          <strong className="font-display text-lg mt-0.5">{money(total)}</strong>
        </div>
      </div>

      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
        {data.length === 0 && <p className="text-dim text-sm">Nenhum gasto registrado neste mês.</p>}
        {data.slice(0, 7).map((item, index) => {
          const pct = total > 0 ? Math.round((item.total / total) * 100) : 0;
          return (
            <div key={item.category} className="flex items-center gap-2.5 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: palette[index % palette.length] }} />
              <span className="text-xs text-dim truncate flex-1">{item.category}</span>
              <span className="text-[11px] text-faint">{pct}%</span>
              <span className="text-xs font-mono min-w-[74px] text-right">{money(item.total)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinanceTrendChart({ rows }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const width = 680;
  const height = 220;
  const left = 30;
  const right = 20;
  const top = 18;
  const bottom = 36;
  const chartW = width - left - right;
  const chartH = height - top - bottom;
  const max = Math.max(1, ...rows.flatMap((row) => [row.entrada, row.saida]));
  const step = rows.length > 1 ? chartW / (rows.length - 1) : chartW;

  const pointsFor = (key) =>
    rows.map((row, index) => ({
      x: left + index * step,
      y: top + chartH - (Number(row[key] || 0) / max) * chartH,
      value: Number(row[key] || 0),
      label: row.label,
    }));

  const entradaPts = pointsFor("entrada");
  const saidaPts = pointsFor("saida");
  const entradaPath = smoothChartPath(entradaPts);
  const saidaPath = smoothChartPath(saidaPts);
  const selected = selectedIndex != null ? rows[selectedIndex] : null;

  return (
    <div className="tech-chart">
      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-h-[175px] md:min-h-[190px]"
          role="img"
          aria-label="Evolução financeira dos últimos seis meses"
        >
          {[0, .25, .5, .75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={left}
              x2={width - right}
              y1={top + chartH * ratio}
              y2={top + chartH * ratio}
              stroke="var(--border-soft)"
              strokeWidth="1"
              strokeDasharray="3 7"
              opacity=".62"
            />
          ))}

          {selectedIndex != null && entradaPts[selectedIndex] && (
            <line
              x1={entradaPts[selectedIndex].x}
              x2={entradaPts[selectedIndex].x}
              y1={top}
              y2={top + chartH}
              stroke="var(--brass)"
              strokeWidth="1"
              strokeDasharray="2 6"
              opacity=".55"
            />
          )}

          <path d={entradaPath} fill="none" stroke="var(--moss)" strokeWidth="7" strokeLinecap="round" opacity=".045" />
          <path d={saidaPath} fill="none" stroke="var(--ember)" strokeWidth="7" strokeLinecap="round" opacity=".04" />
          <path d={entradaPath} fill="none" stroke="var(--moss)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d={saidaPath} fill="none" stroke="var(--ember)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {rows.map((row, index) => {
            const x = entradaPts[index]?.x || left;
            const hitWidth = rows.length > 1 ? Math.max(42, step * .9) : chartW;
            return (
              <rect
                key={`hit-${row.key || index}`}
                x={Math.max(left, x - hitWidth / 2)}
                y={top}
                width={Math.min(hitWidth, width - right - Math.max(left, x - hitWidth / 2))}
                height={chartH}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedIndex(index)}
              >
                <title>{`${row.label} · Entradas ${money(row.entrada)} · Saídas ${money(row.saida)}`}</title>
              </rect>
            );
          })}

          {entradaPts.map((point, index) => (
            <g key={`in-${index}`} onClick={() => setSelectedIndex(index)} style={{ cursor: "pointer" }}>
              <circle
                cx={point.x}
                cy={point.y}
                r={selectedIndex === index ? "4.5" : "2.4"}
                fill="var(--surface)"
                stroke="var(--moss)"
                strokeWidth="1.5"
              />
            </g>
          ))}

          {saidaPts.map((point, index) => (
            <g key={`out-${index}`} onClick={() => setSelectedIndex(index)} style={{ cursor: "pointer" }}>
              <circle
                cx={point.x}
                cy={point.y}
                r={selectedIndex === index ? "4.5" : "2.4"}
                fill="var(--surface)"
                stroke="var(--ember)"
                strokeWidth="1.5"
              />
              <text
                x={point.x}
                y={height - 11}
                textAnchor="middle"
                fontSize="9"
                fill="var(--text-faint)"
                style={{ fontFamily: "Poppins, sans-serif" }}
              >
                {point.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {selected ? (
        <div className="finance-chart-tooltip rounded-xl p-3 mt-1.5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="font-medium text-sm capitalize">{selected.label}</p>
            <button className="text-[10px] text-faint" onClick={() => setSelectedIndex(null)}>Fechar</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] text-faint uppercase tracking-widest">Entradas</p>
              <p className="font-mono text-sm text-moss mt-1 break-words">{money(selected.entrada)}</p>
            </div>
            <div>
              <p className="text-[9px] text-faint uppercase tracking-widest">Saídas</p>
              <p className="font-mono text-sm text-ember mt-1 break-words">{money(selected.saida)}</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[9px] text-faint text-center mt-1">Toque em um mês para ver os valores.</p>
      )}

      <div className="flex items-center justify-center gap-5 text-[10px] text-dim mt-2">
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-moss" />Entradas</span>
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-ember" />Saídas</span>
      </div>
    </div>
  );
}


/* ---------------------------------------------------------------
   CONSTANCCE FINANCIAL INTELLIGENCE ENGINE
   Interpreta a pergunta; os cálculos sempre usam dados reais do app.
----------------------------------------------------------------*/

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

function FinanceProAssistant({
  transactions,
  financialGoals,
  financeBills,
  financeRecurring,
  monthlyLimit,
  financeBudgets,
  selectedMonth,
  projectedBalance,
  availableToSpend,
}) {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState([]);
  const [assistantContext, setAssistantContext] = useState(null);

  const runQuestion = (raw) => {
    const clean = String(raw || "").trim();
    if (!clean) return;

    const result = executeFinanceIntelligence({
      question: clean,
      transactions,
      goals: financialGoals,
      bills: financeBills,
      recurring: financeRecurring,
      monthlyLimit,
      budgets: financeBudgets,
      selectedMonth,
      projectedBalance,
      availableToSpend,
      context: assistantContext,
    });

    setAssistantContext(result.context || assistantContext);
    setConversation((current) => [
      ...current,
      {
        id: uid(),
        question: clean,
        answer: result.answer,
        confidence: result.confidence,
        intent: result.intent,
      },
    ].slice(-6));
    setQuestion("");
  };

  const prompts = [
    "Quanto gastei este mês?",
    "Onde gasto mais?",
    "Como estão minhas metas?",
    "Tenho contas próximas?",
    "Como fecha o mês?",
  ];

  return (
    <div className="finance-assistant surface rounded-2xl p-4 md:p-5" style={{ borderColor: "var(--brass-dim)" }}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BrainCircuit size={16} className="text-brass" />
            <p className="text-xs text-faint uppercase tracking-widest">Financial Intelligence</p>
            <ProBadge compact />
            <span className="chip">Engine interno</span>
          </div>
          <p className="text-dim text-xs mt-1">
            Pergunte normalmente. O Constancce interpreta a pergunta e calcula a resposta usando somente seus dados reais.
          </p>
        </div>
        {conversation.length > 0 && (
          <button
            className="text-[10px] text-faint hover:text-dim self-start"
            onClick={() => {
              setConversation([]);
              setAssistantContext(null);
            }}
          >
            Limpar conversa
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            className="chip hover:text-brass"
            onClick={() => runQuestion(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      {conversation.length > 0 && (
        <div className="finance-intelligence-conversation rounded-2xl p-3 mb-3">
          <div className="flex flex-col gap-3">
            {conversation.map((turn) => (
              <div key={turn.id}>
                <p className="text-[10px] text-faint mb-1">Você</p>
                <p className="text-xs text-dim break-words">{turn.question}</p>
                <div className="finance-intelligence-answer rounded-xl p-3 mt-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Constancce</p>
                    {turn.confidence >= .85 && <span className="text-[8px] text-moss">dados confirmados</span>}
                  </div>
                  <p className="text-sm leading-relaxed break-words">{turn.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          className="flex-1 min-w-0 p-3 ring-focus"
          placeholder='Ex: "Quanto gastei no iFood mês passado?"'
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") runQuestion(question);
          }}
        />
        <button className="btn-primary rounded-xl px-4 py-2.5 text-sm shrink-0" onClick={() => runQuestion(question)}>
          Perguntar
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
        <div className="surface-2 rounded-xl p-2.5">
          <p className="text-[9px] text-faint uppercase tracking-widest">Interpreta</p>
          <p className="text-[10px] text-dim mt-1">intenção, período, categoria e meta</p>
        </div>
        <div className="surface-2 rounded-xl p-2.5">
          <p className="text-[9px] text-faint uppercase tracking-widest">Calcula</p>
          <p className="text-[10px] text-dim mt-1">direto dos registros financeiros</p>
        </div>
        <div className="surface-2 rounded-xl p-2.5">
          <p className="text-[9px] text-faint uppercase tracking-widest">Contexto</p>
          <p className="text-[10px] text-dim mt-1">entende continuações da conversa</p>
        </div>
      </div>

      <p className="text-[9px] text-faint mt-3">
        Se a pergunta não puder ser respondida com segurança, o assistente informa que não consegue ajudar naquele momento.
      </p>
    </div>
  );
}

function FinanceView({ transactions, addTransaction, addGoalProgress, deleteTransaction, removeTransactionRecord, profile, setProfile, goals, autoOpen, isPro, onUpgrade }) {
  const [confirm, confirmDialog] = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [showBillForm, setShowBillForm] = useState(false);
  const [editingBill, setEditingBill] = useState(null);
  const [presetType, setPresetType] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [editingBudgets, setEditingBudgets] = useState(false);
  const [editingMonthlyLimit, setEditingMonthlyLimit] = useState(false);
  const [launchFilter, setLaunchFilter] = useState("all");
  const [launchTypeFilter, setLaunchTypeFilter] = useState("all");
  const [launchDateFilter, setLaunchDateFilter] = useState("");
  const [launchSearch, setLaunchSearch] = useState("");
  const [financeSection, setFinanceSection] = useState("overview");
  const [duplicatePending, setDuplicatePending] = useState(null);
  const freeFinanceLimitReached = !isPro && transactions.length >= PRO_LIMITS.financeTransactions;
  const requestFinanceRecord = () => {
    if (!freeFinanceLimitReached) return true;
    onUpgrade("finance");
    return false;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.querySelector(".app-main")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    });
  }, [financeSection]);

  useEffect(() => {
    if (autoOpen) {
      setFinanceSection("launches");
      setPresetType(autoOpen);
      if (!isPro && transactions.length >= PRO_LIMITS.financeTransactions) {
        onUpgrade("finance");
        return;
      }
      setShowForm(true);
    }
  }, [autoOpen]);

  const selectedDate = new Date(`${selectedMonth}-01T12:00:00`);
  const monthLabel = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthLabelDisplay = monthLabel ? `${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)}` : "";
  const monthTx = transactions.filter((tx) => String(tx.date || "").slice(0, 7) === selectedMonth);

  const monthIn = monthTx.filter((tx) => tx.type === "entrada").reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const monthOut = monthTx.filter((tx) => tx.type === "saida").reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const monthBalance = monthIn - monthOut;
  const savingsPct = monthIn > 0 ? Math.max(0, Math.round((monthBalance / monthIn) * 100)) : 0;
  const incomeCommittedPct = monthIn > 0 ? Math.max(0, Math.round((monthOut / monthIn) * 100)) : 0;

  const previousDate = new Date(selectedDate);
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`;
  const previousTx = transactions.filter((tx) => String(tx.date || "").slice(0, 7) === previousKey);
  const previousIn = previousTx.filter((tx) => tx.type === "entrada").reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const previousOut = previousTx.filter((tx) => tx.type === "saida").reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  // Enquanto o mês selecionado ainda está em andamento, comparar o total do
  // mês anterior inteiro contra só os dias já passados deste mês distorce o
  // número (fica sempre perto de -100% no início do mês). Nesse caso,
  // comparamos só até o mesmo dia do mês anterior.
  const isCurrentMonthView = selectedMonth === monthKey(today());
  const dayOfMonthCutoff = isCurrentMonthView ? Number(today().slice(8, 10)) : null;
  const previousOutComparable = isCurrentMonthView
    ? previousTx.filter((tx) => tx.type === "saida" && Number(String(tx.date || "").slice(8, 10)) <= dayOfMonthCutoff)
        .reduce((sum, tx) => sum + Number(tx.value || 0), 0)
    : previousOut;
  const outDeltaPct = previousOutComparable > 0 ? Math.round(((monthOut - previousOutComparable) / previousOutComparable) * 100) : null;
  const inDeltaPct = previousIn > 0 ? Math.round(((monthIn - previousIn) / previousIn) * 100) : null;

  const recurringItems = profile?.financeRecurring || [];
  const currentMonthKey = today().slice(0, 7);

  const daysInMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
  const isCurrentMonth = selectedMonth === currentMonthKey;
  const elapsedDays = isCurrentMonth ? Math.max(1, new Date().getDate()) : daysInMonth;

  const byCategory = FIN_OUT
    .map((category) => ({
      category,
      total: monthTx
        .filter((tx) => tx.type === "saida" && tx.category === category)
        .reduce((sum, tx) => sum + Number(tx.value || 0), 0),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);

  const sixMonths = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(selectedDate);
    d.setMonth(selectedDate.getMonth() - (5 - index));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const list = transactions.filter((tx) => String(tx.date || "").slice(0, 7) === key);
    return {
      key,
      label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      entrada: list.filter((tx) => tx.type === "entrada").reduce((s, tx) => s + Number(tx.value || 0), 0),
      saida: list.filter((tx) => tx.type === "saida").reduce((s, tx) => s + Number(tx.value || 0), 0),
    };
  });

  const dailySpendMax = Math.max(1, ...Array.from({ length: elapsedDays }, (_, i) => {
    const dateStr = `${selectedMonth}-${String(i + 1).padStart(2, "0")}`;
    return monthTx.filter((tx) => tx.type === "saida" && tx.date === dateStr).reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  }));
  const spendingHeatmap = Array.from({ length: elapsedDays }, (_, i) => {
    const dateStr = `${selectedMonth}-${String(i + 1).padStart(2, "0")}`;
    const spent = monthTx.filter((tx) => tx.type === "saida" && tx.date === dateStr).reduce((sum, tx) => sum + Number(tx.value || 0), 0);
    return { date: dateStr, score: Math.round((spent / dailySpendMax) * 100) };
  });

  const categoryRows = FIN_OUT.map((category) => {
    const spent = monthTx
      .filter((tx) => tx.type === "saida" && tx.category === category)
      .reduce((sum, tx) => sum + Number(tx.value || 0), 0);
    const budget = Number(profile?.financeBudgets?.[category] || 0);
    return { category, spent, budget };
  });

  const configuredBudgets = categoryRows.filter((item) => item.budget > 0);
  const budgetCompliance = configuredBudgets.length
    ? configuredBudgets.filter((item) => item.spent <= item.budget).length / configuredBudgets.length
    : 1;
  const monthlyLimit = Number(profile?.monthlyLimit || 3000);
  const limitOk = monthlyLimit <= 0 || monthOut <= monthlyLimit;
  const hasFinanceData = monthTx.length > 0;
  const savingsScore = monthIn > 0 ? Math.max(0, Math.min(35, (savingsPct / 20) * 35)) : 0;
  const budgetScore = configuredBudgets.length ? budgetCompliance * 30 : 15;
  const balanceScore = monthBalance >= 0 ? 20 : 0;
  const limitScore = limitOk ? 15 : 0;
  const financialHealth = hasFinanceData
    ? Math.round(Math.max(0, Math.min(100, savingsScore + budgetScore + balanceScore + limitScore)))
    : 0;
  const financialHealthLabel = !hasFinanceData ? "Sem dados" : financialHealth >= 80 ? "Forte" : financialHealth >= 60 ? "Estável" : financialHealth >= 40 ? "Atenção" : "Crítica";

  const projection = computeFinanceProjectionForMonth({
    month: selectedMonth,
    transactions,
    bills: profile?.financeBills,
    recurring: profile?.financeRecurring,
    monthlyLimit,
  });
  const { projectedBalance, availableToSpend } = projection;

  const financialGoals = (goals || []).filter((g) => g.type === "financeira" && !g.completed);

  const launchFilterOptions = [...new Set(
    monthTx
      .map((tx) => String(tx.description || tx.category || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  const normalizedLaunchSearch = String(launchSearch || "").trim().toLocaleLowerCase("pt-BR");
  const selectedMonthLastDay = `${selectedMonth}-${String(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const hasLaunchFilters = Boolean(
    normalizedLaunchSearch ||
    launchFilter !== "all" ||
    launchTypeFilter !== "all" ||
    launchDateFilter
  );

  const filteredLaunches = [...monthTx]
    .filter((tx) => launchTypeFilter === "all" || tx.type === launchTypeFilter)
    .filter((tx) => launchFilter === "all" || String(tx.description || tx.category || "").trim() === launchFilter)
    .filter((tx) => !launchDateFilter || String(tx.date || "") === launchDateFilter)
    .filter((tx) => {
      if (!normalizedLaunchSearch) return true;
      const haystack = `${tx.description || ""} ${tx.category || ""}`.toLocaleLowerCase("pt-BR");
      return haystack.includes(normalizedLaunchSearch);
    })
    .sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));

  const filteredIncome = filteredLaunches
    .filter((tx) => tx.type === "entrada")
    .reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const filteredExpense = filteredLaunches
    .filter((tx) => tx.type === "saida")
    .reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  const moveMonth = (direction) => {
    const d = new Date(selectedDate);
    d.setMonth(d.getMonth() + direction);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  useEffect(() => {
    if (launchFilter !== "all" && !launchFilterOptions.includes(launchFilter)) {
      setLaunchFilter("all");
    }
    if (launchDateFilter && !launchDateFilter.startsWith(`${selectedMonth}-`)) {
      setLaunchDateFilter("");
    }
  }, [selectedMonth, launchFilter, launchDateFilter, launchFilterOptions.join("|")]);

  const updateBudget = (category, value) => {
    const amount = Math.max(0, Number(value) || 0);
    setProfile((current) => ({
      ...current,
      financeBudgets: {
        ...(current?.financeBudgets || {}),
        [category]: amount,
      },
    }));
  };

  const saveRecurring = (item) => {
    setProfile((current) => ({
      ...current,
      financeRecurring: [...(current?.financeRecurring || []), item],
    }));
    setShowRecurringForm(false);
  };

  const toggleRecurring = (id) => {
    setProfile((current) => ({
      ...current,
      financeRecurring: (current?.financeRecurring || []).map((item) =>
        item.id === id ? { ...item, active: item.active === false } : item
      ),
    }));
  };

  const deleteRecurring = async (id) => {
    if (!(await confirm("Tem certeza que deseja remover esta recorrência?"))) return;
    setProfile((current) => ({
      ...current,
      financeRecurring: (current?.financeRecurring || []).filter((item) => item.id !== id),
    }));
  };

  const financeBills = profile?.financeBills || [];
  const pendingFinanceBills = financeBills
    .filter((bill) => bill.status !== "pago" && monthKey(bill.dueDate) === selectedMonth)
    .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
  const overdueBills = pendingFinanceBills.filter((bill) => bill.dueDate && bill.dueDate < today());
  const overdueTotal = overdueBills.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
  const upcomingBills = pendingFinanceBills
    .filter((bill) => bill.dueDate && bill.dueDate >= today());
  const monthlyLimitUsedPct = monthlyLimit > 0 ? Math.round((monthOut / monthlyLimit) * 100) : 0;
  const topCategory = byCategory[0] || null;
  // Mesmo corte usado em previousOutComparable: sem isso, o "maior gasto por
  // categoria" comparava o ritmo parcial deste mês contra o mês anterior
  // INTEIRO, fazendo uma categoria com ritmo acelerado parecer neutra/em queda
  // só por o mês anterior completo somar mais.
  const previousTxComparable = isCurrentMonthView
    ? previousTx.filter((tx) => Number(String(tx.date || "").slice(8, 10)) <= dayOfMonthCutoff)
    : previousTx;
  const previousByCategory = FIN_OUT.map((category) => ({
    category,
    total: previousTxComparable
      .filter((tx) => tx.type === "saida" && tx.category === category)
      .reduce((sum, tx) => sum + Number(tx.value || 0), 0),
  }));
  const topCategoryPrevious = topCategory
    ? previousByCategory.find((item) => item.category === topCategory.category)?.total || 0
    : 0;
  const topCategoryDelta = topCategory ? topCategory.total - topCategoryPrevious : 0;

  const financeInsights = [];
  if (overdueBills.length > 0) {
    financeInsights.push({
      tone: "danger",
      title: `${overdueBills.length} conta${overdueBills.length === 1 ? "" : "s"} vencida${overdueBills.length === 1 ? "" : "s"}`,
      text: `${money(overdueTotal)} aguardando pagamento.`,
    });
  }
  if (topCategory && topCategoryDelta > 0) {
    financeInsights.push({
      tone: "attention",
      title: `${topCategory.category} aumentou`,
      text: `${money(topCategoryDelta)} a mais que no mês anterior.`,
    });
  } else if (topCategory) {
    financeInsights.push({
      tone: "neutral",
      title: `Maior gasto: ${topCategory.category}`,
      text: `${money(topCategory.total)} neste mês.`,
    });
  }
  if (monthlyLimit > 0) {
    financeInsights.push({
      tone: monthlyLimitUsedPct >= 100 ? "danger" : monthlyLimitUsedPct >= 80 ? "attention" : "positive",
      title: monthlyLimitUsedPct >= 100 ? "Limite mensal ultrapassado" : `${monthlyLimitUsedPct}% do limite utilizado`,
      text: monthlyLimitUsedPct >= 100
        ? `${money(monthOut - monthlyLimit)} acima do planejado.`
        : `${money(availableToSpend)} ainda disponíveis.`,
    });
  }
  if (isPro && Number.isFinite(projectedBalance)) {
    financeInsights.push({
      tone: projectedBalance >= 0 ? "positive" : "danger",
      title: "Projeção de fechamento",
      text: projectedBalance >= 0
        ? `O mês tende a fechar ${money(projectedBalance)} positivo.`
        : `O mês tende a fechar ${money(Math.abs(projectedBalance))} negativo.`,
    });
  }
  const visibleFinanceInsights = financeInsights.slice(0, 3);

  const duplicateTransaction = (tx) => {
    setDuplicatePending(tx);
  };

  const confirmDuplicateTransaction = () => {
    if (!duplicatePending) return;
    const tx = duplicatePending;
    if (!requestFinanceRecord()) return;
    const added = addTransaction({
      ...tx,
      id: uid(),
      billId: null,
      recurringId: null,
      recurringMonth: null,
      goalId: null,
      description: tx.description || tx.category,
    });
    if (added === false) return;
    setDuplicatePending(null);
  };

  const saveBill = (bill) => {
    const previousBill = financeBills.find((item) => item.id === bill.id);
    const wasPaid = previousBill?.status === "pago";

    setProfile((current) => {
      const exists = (current?.financeBills || []).some((item) => item.id === bill.id);
      return {
        ...current,
        financeBills: exists
          ? (current?.financeBills || []).map((item) => item.id === bill.id ? bill : item)
          : [...(current?.financeBills || []), bill],
      };
    });

    if (wasPaid) {
      const linked = transactions.filter((tx) => tx.billId === bill.id);
      // Não usa deleteTransaction aqui: salvar uma conta já editada não deveria
      // abrir uma segunda confirmação de exclusão por trás das cenas, e chamar a
      // versão que confirma dentro de um forEach só guarda uma confirmação
      // pendente por vez — a segunda chamada nunca resolveria a primeira.
      linked.forEach((tx) => removeTransactionRecord(tx.id));
      addTransaction({
        id: uid(),
        type: "saida",
        category: bill.category,
        value: Number(bill.value || 0),
        date: previousBill?.paidAt || linked[0]?.date || today(),
        description: bill.description,
        billId: bill.id,
      });
    }

    setEditingBill(null);
    setShowBillForm(false);
  };

  const removeBill = async (id) => {
    if (!(await confirm("Excluir esta conta a pagar?"))) return;
    setProfile((current) => ({ ...current, financeBills: (current?.financeBills || []).filter((bill) => bill.id !== id) }));
  };

  const payBill = (bill) => {
    if (!requestFinanceRecord()) return;
    const added = addTransaction({
      id: uid(),
      type: "saida",
      category: bill.category,
      value: Number(bill.value || 0),
      date: today(),
      description: bill.description,
      billId: bill.id,
    });
    if (added === false) return;
    setProfile((current) => ({
      ...current,
      financeBills: (current?.financeBills || []).map((item) => item.id === bill.id ? { ...item, status: "pago", paidAt: today() } : item),
    }));
  };

  const unpayBill = async (bill) => {
    if (!(await confirm(`Desmarcar "${bill.description}" como paga? O lançamento financeiro criado por este pagamento também será removido.`, { confirmLabel: "Desmarcar" }))) return;

    transactions
      .filter((tx) => tx.billId === bill.id)
      .forEach((tx) => removeTransactionRecord(tx.id));

    setProfile((current) => ({
      ...current,
      financeBills: (current?.financeBills || []).map((item) =>
        item.id === bill.id
          ? { ...item, status: "pendente", paidAt: null }
          : item
      ),
    }));
  };

  const saveFinanceTransaction = (tx) => {
    if (!requestFinanceRecord()) return false;
    if (addTransaction(tx) === false) return false;
    if (tx.goalId && tx.type === "saida" && tx.category === "Aporte para meta") {
      addGoalProgress(tx.goalId, Number(tx.value || 0));
    }
    return true;
  };

  const exportMonth = () => {
    const rowsToExport = hasLaunchFilters ? filteredLaunches : monthTx;
    if (rowsToExport.length === 0) return;

    const header = ["Data", "Tipo", "Categoria", "Descrição", "Valor"];
    const rows = rowsToExport.map((tx) => [
      tx.date,
      tx.type === "entrada" ? "Entrada" : "Saída",
      tx.category,
      tx.description || "",
      Number(tx.value || 0).toFixed(2).replace(".", ","),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
      .join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = launchDateFilter
      ? `constancce-financas-${launchDateFilter}.csv`
      : `constancce-financas-${selectedMonth}${hasLaunchFilters ? "-filtrado" : ""}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="finance-view flex flex-col gap-4 md:gap-5">
      <div className="finance-main-header">
        <div className="finance-header-copy min-w-0">
          <h2 className="font-display text-2xl md:text-3xl">Finanças</h2>
          <p className="text-dim text-xs md:text-sm mt-1 max-w-2xl">
            Veja primeiro o que importa: quanto entrou, quanto saiu, quanto sobrou e o que vem pela frente.
          </p>
        </div>

        {!isPro && (
          <div className="flex items-center gap-2">
            <span className="chip">{transactions.length}/{PRO_LIMITS.financeTransactions} lançamentos Free</span>
          </div>
        )}

        <div className="finance-header-controls">
          <div className="finance-month-picker surface rounded-xl">
            <button
              className="btn-ghost rounded-lg finance-icon-button"
              onClick={() => moveMonth(-1)}
              aria-label="Mês anterior"
              title="Mês anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <span className="finance-month-label">
              {monthLabelDisplay}
            </span>

            <button
              className="btn-ghost rounded-lg finance-icon-button"
              onClick={() => moveMonth(1)}
              aria-label="Próximo mês"
              title="Próximo mês"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <button
            className="finance-action-button finance-entry-button btn-ghost rounded-xl"
            onClick={() => {
              if (!requestFinanceRecord()) return;
              setFinanceSection("launches");
              setPresetType("entrada");
              setShowForm(true);
            }}
          >
            <ArrowUpRight size={15} />
            <span>Entrada</span>
          </button>

          <button
            className="finance-action-button finance-exit-button btn-primary rounded-xl"
            onClick={() => {
              if (!requestFinanceRecord()) return;
              setFinanceSection("launches");
              setPresetType("saida");
              setShowForm(true);
            }}
          >
            <ArrowDownRight size={15} />
            <span>Saída</span>
          </button>
        </div>
      </div>

      <FirstVisitTip id="finance" icon={Wallet} title="Finanças mostram para onde seu dinheiro está indo.">
        Registre entradas e saídas. O painel transforma esses lançamentos em saldo, categorias e uma leitura simples do seu mês.
      </FirstVisitTip>

      <div className="finance-section-tabs task-glass-tabs rounded-2xl p-1 grid grid-cols-3 gap-1">
        {[
          ["overview", "Visão geral"],
          ["launches", "Lançamentos"],
          ["intelligence", "Inteligência"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`finance-tab-button task-tab-button rounded-xl py-2 text-[10px] sm:text-xs md:text-sm font-medium min-w-0 truncate ${financeSection === id ? "task-tab-active" : ""}`}
            onClick={() => setFinanceSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {financeSection === "overview" && (
        <>
          {overdueBills.length > 0 && (
            <div className="finance-overdue-alert rounded-2xl p-3 md:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <Bell size={16} className="text-ember shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs md:text-sm font-medium">
                    {overdueBills.length} conta{overdueBills.length === 1 ? "" : "s"} vencida{overdueBills.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-[10px] md:text-xs text-dim mt-0.5 break-words">
                    {money(overdueTotal)} aguardando pagamento.
                  </p>
                </div>
              </div>
              <button
                className="btn-ghost rounded-xl px-3 py-2 text-xs shrink-0"
                onClick={() => document.getElementById("finance-bills-card")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                Ver contas
              </button>
            </div>
          )}

          <div className="finance-overview-hero glass-panel-strong rounded-2xl p-4 md:p-6">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[9px] md:text-[10px] text-faint uppercase tracking-widest">Saldo do mês</p>
                <p className={`finance-hero-balance font-display text-3xl md:text-4xl mt-1 break-words ${monthBalance >= 0 ? "text-moss" : "text-ember"}`}>
                  {money(monthBalance)}
                </p>
                <p className="text-[10px] md:text-xs text-dim mt-1.5">
                  Entrou <span className="text-moss">{money(monthIn)}</span> · Saiu <span className="text-ember">{money(monthOut)}</span>
                </p>
              </div>

              <div className="finance-overview-mini-grid grid grid-cols-2 gap-2 w-full lg:w-auto lg:min-w-[360px]">
                <div className="surface-2 rounded-xl p-3 min-w-0">
                  <p className="text-[9px] text-faint uppercase tracking-widest">Ainda pode gastar</p>
                  <p className="font-mono text-sm md:text-base mt-1 truncate">{money(availableToSpend)}</p>
                  <p className="text-[8px] text-faint mt-0.5">{monthlyLimit > 0 ? "com base no limite mensal" : "saldo atual (sem limite definido)"}</p>
                </div>
                <div className="surface-2 rounded-xl p-3 min-w-0">
                  <p className="text-[9px] text-faint uppercase tracking-widest">
                    Vs. mês anterior{isCurrentMonthView ? " (até hoje)" : ""}
                  </p>
                  <p className={`font-mono text-sm md:text-base mt-1 truncate ${outDeltaPct !== null && outDeltaPct <= 0 ? "text-moss" : outDeltaPct !== null ? "text-ember" : "text-dim"}`}>
                    {outDeltaPct === null ? "Sem base" : `${outDeltaPct >= 0 ? "+" : ""}${outDeltaPct}% gastos`}
                  </p>
                  <p className={`font-mono text-[10px] mt-1 truncate ${inDeltaPct !== null && inDeltaPct >= 0 ? "text-moss" : inDeltaPct !== null ? "text-ember" : "text-faint"}`}>
                    {inDeltaPct === null ? "Sem base de entradas" : `${inDeltaPct >= 0 ? "+" : ""}${inDeltaPct}% entradas`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="finance-limit-card surface glass-panel rounded-2xl p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <p className="text-[10px] text-faint uppercase tracking-widest">Limite mensal</p>

              {editingMonthlyLimit ? (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <input
                    type="number"
                    min="0"
                    step="50"
                    className="finance-limit-input flex-1 sm:w-36 p-2.5 text-sm ring-focus text-right"
                    defaultValue={monthlyLimit}
                    onBlur={(e) => setProfile((current) => ({
                      ...current,
                      monthlyLimit: Math.max(0, Number(e.target.value) || 0),
                    }))}
                  />
                  <button className="btn-ghost rounded-xl px-3 py-2.5 text-xs shrink-0" onClick={() => setEditingMonthlyLimit(false)}>
                    Concluir
                  </button>
                </div>
              ) : (
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs self-start sm:self-auto" onClick={() => setEditingMonthlyLimit(true)}>
                  <Pencil size={12} className="inline mr-1" /> Editar limite
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <RadialProgress
                value={monthlyLimitUsedPct}
                label="utilizado"
                size={104}
                strokeWidth={8}
                color={monthlyLimitUsedPct >= 100 ? "var(--ember)" : monthlyLimitUsedPct >= 80 ? "var(--brass)" : "var(--moss)"}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm md:text-base">
                  {money(monthOut)} usados de {money(monthlyLimit)}
                </p>
                <p className="text-dim text-xs mt-1">{money(availableToSpend)} disponíveis</p>
              </div>
            </div>
          </div>

          {visibleFinanceInsights.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-faint uppercase tracking-widest">Leituras rápidas</p>
                <span className="chip">até 3</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {visibleFinanceInsights.map((insight, index) => (
                  <div key={`${insight.title}-${index}`} className={`finance-insight-card surface rounded-xl p-3 ${insight.tone}`}>
                    <p className="text-xs font-medium break-words">{insight.title}</p>
                    <p className="text-[10px] md:text-xs text-dim mt-1 break-words">{insight.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 md:gap-4">
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Categorias</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Onde seu dinheiro está saindo.</p>
                </div>
                <span className="chip">Top {Math.min(5, byCategory.length)}</span>
              </div>

              <div className="flex flex-col gap-3">
                {byCategory.length === 0 && <p className="text-xs text-dim py-2">Nenhuma saída registrada neste mês.</p>}
                {byCategory.slice(0, 5).map((item, index) => {
                  const pct = monthOut > 0 ? Math.round((item.total / monthOut) * 100) : 0;
                  const CategoryIcon = FIN_CATEGORY_ICONS[item.category] || MoreHorizontal;
                  return (
                    <div key={item.category}>
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[9px] text-brass shrink-0">0{index + 1}</span>
                          <CategoryIcon size={12} className="text-dim shrink-0" />
                          <span className="text-xs md:text-sm truncate">{item.category}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-xs">{money(item.total)}</p>
                          <p className="text-[9px] text-faint">{pct}%</p>
                        </div>
                      </div>
                      <Progress value={pct} height={4} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div id="finance-bills-card" className="surface glass-panel rounded-2xl p-4 md:p-5 scroll-mt-20">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Próximas contas</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Os compromissos mais próximos. Contas têm vencimento e ficam pendentes até você marcar como pagas.</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className="btn-ghost rounded-xl px-2.5 py-2 text-[10px] md:text-xs"
                    onClick={() => {
                      setEditingBill(null);
                      setShowBillForm(true);
                    }}
                  >
                    <Plus size={12} className="inline mr-1" /> Nova
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {upcomingBills.length === 0 && overdueBills.length === 0 && (
                  <p className="text-xs text-dim py-2">Nenhuma conta pendente cadastrada.</p>
                )}

                {[...overdueBills, ...upcomingBills].map((bill) => {
                  const overdue = bill.dueDate < today();
                  const diffDays = Math.ceil(
                    (new Date(`${bill.dueDate}T12:00:00`).getTime() - new Date(`${today()}T12:00:00`).getTime()) / 86400000
                  );
                  return (
                    <div key={bill.id} className="finance-upcoming-bill surface-2 rounded-xl p-3 flex items-center gap-3 min-w-0">
                      <CreditCard size={15} className={`shrink-0 ${overdue ? "text-ember" : "text-brass"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs md:text-sm font-medium truncate">{bill.description}</p>
                        <p className={`text-[9px] md:text-[10px] mt-0.5 ${overdue ? "text-ember" : "text-faint"}`}>
                          {overdue ? `${Math.abs(diffDays)}d atrasada` : diffDays === 0 ? "vence hoje" : `vence em ${diffDays}d`}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] md:text-xs shrink-0">{money(bill.value)}</span>
                      {bill.status !== "pago" && (
                        <button className="btn-ghost rounded-lg px-2 py-1.5 text-[9px] md:text-[10px] shrink-0" onClick={() => payBill(bill)}>
                          Pagar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {financeBills.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                  <p className="text-[10px] text-faint">{financeBills.length} conta{financeBills.length === 1 ? "" : "s"} cadastrada{financeBills.length === 1 ? "" : "s"} no total.</p>
                </div>
              )}

            </div>
          </div>

          {financialGoals.length > 0 && (
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Metas financeiras</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Quanto já avançou nos seus objetivos.</p>
                </div>
                <span className="chip">{financialGoals.length} ativa{financialGoals.length === 1 ? "" : "s"}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {financialGoals.slice(0, 4).map((goal) => {
                  const pct = goal.target > 0
                    ? Math.min(100, Math.round(Number(goal.current || 0) / Number(goal.target) * 100))
                    : 0;
                  return (
                    <div key={goal.id} className="surface-2 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <p className="text-xs md:text-sm font-medium truncate">{goal.name}</p>
                          <p className="text-[9px] md:text-[10px] text-faint mt-0.5">{money(goal.current)} de {money(goal.target)}</p>
                        </div>
                        <span className="chip shrink-0">{pct}%</span>
                      </div>
                      <Progress value={pct} height={5} />
                      {isPro && (
                        <p className="text-[9px] md:text-[10px] text-dim mt-2">
                          Ritmo sugerido: <span className="text-brass">{money(monthlyGoalEstimate(goal))}/mês</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </>
      )}

      {financeSection === "launches" && (
        <>
          <div className="finance-launch-top surface rounded-2xl p-3 md:p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-[10px] text-faint uppercase tracking-widest">Lançamentos de {monthLabelDisplay}</p>
                <p className="text-[10px] md:text-xs text-dim mt-1">Busque por iFood, Uber, aluguel, categoria ou descrição.</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-ghost rounded-xl px-3 py-2 text-[10px] md:text-xs flex items-center gap-1.5" onClick={exportMonth}>
                  <Download size={13} /> Exportar
                </button>
                <span className="chip">{filteredLaunches.length}/{monthTx.length}</span>
              </div>
            </div>

            <div className="finance-search-wrap relative mt-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <input
                className="finance-search-input w-full py-3 pl-9 pr-3 ring-focus text-sm"
                placeholder="Pesquisar lançamentos..."
                value={launchSearch}
                onChange={(e) => setLaunchSearch(e.target.value)}
              />
            </div>

            <div className="finance-filter-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
              <select
                className="finance-filter-control w-full p-2.5 text-xs ring-focus"
                value={launchTypeFilter}
                onChange={(e) => setLaunchTypeFilter(e.target.value)}
                aria-label="Filtrar por tipo de lançamento"
              >
                <option value="all">Entradas e saídas</option>
                <option value="entrada">Somente entradas</option>
                <option value="saida">Somente saídas</option>
              </select>

              <select
                className="finance-filter-control w-full p-2.5 text-xs ring-focus"
                value={launchFilter}
                onChange={(e) => setLaunchFilter(e.target.value)}
                aria-label="Filtrar por descrição"
              >
                <option value="all">Todas as descrições</option>
                {launchFilterOptions.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>

              <div className="finance-date-filter-wrap relative sm:col-span-2 lg:col-span-1">
                <CalendarIcon
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
                />
                <input
                  type="date"
                  className="finance-filter-control finance-date-filter w-full py-2.5 pl-9 pr-3 text-xs ring-focus"
                  value={launchDateFilter}
                  min={`${selectedMonth}-01`}
                  max={selectedMonthLastDay}
                  onChange={(e) => setLaunchDateFilter(e.target.value)}
                  aria-label="Filtrar lançamentos por data"
                />
              </div>
            </div>

            {hasLaunchFilters && (
              <div className="finance-filter-results mt-3">
                <div className="grid grid-cols-2 gap-2 min-w-0">
                  <div className="surface-2 rounded-xl p-2.5 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Entradas encontradas</p>
                    <p className="font-mono text-xs md:text-sm text-moss mt-1 truncate">{money(filteredIncome)}</p>
                  </div>
                  <div className="surface-2 rounded-xl p-2.5 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Saídas encontradas</p>
                    <p className="font-mono text-xs md:text-sm text-ember mt-1 truncate">{money(filteredExpense)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {launchDateFilter && (
                      <span className="chip">
                        {new Date(`${launchDateFilter}T12:00:00`).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                    <span className="text-[9px] md:text-[10px] text-faint">
                      {filteredLaunches.length} de {monthTx.length} lançamento{monthTx.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <button
                    className="finance-clear-filters btn-ghost rounded-lg px-2.5 py-1.5 text-[10px] md:text-xs"
                    onClick={() => {
                      setLaunchSearch("");
                      setLaunchTypeFilter("all");
                      setLaunchFilter("all");
                      setLaunchDateFilter("");
                    }}
                  >
                    Limpar filtros
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="finance-history-ledger surface glass-panel rounded-2xl overflow-hidden">
            <div className="finance-history-head p-4 md:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <History size={15} className="text-brass shrink-0" />
                  <p className="text-[10px] text-faint uppercase tracking-widest">Histórico financeiro</p>
                </div>
                <p className="text-xs md:text-sm text-dim mt-1">
                  Linha do tempo dos pagamentos e movimentações do período selecionado.
                </p>
              </div>
              <div className="finance-history-summary flex items-center gap-2 shrink-0">
                <span className="chip">{filteredLaunches.length} registro{filteredLaunches.length === 1 ? "" : "s"}</span>
                <span className="chip">{monthLabelDisplay}</span>
              </div>
            </div>

            <div className="finance-history-stream">
              {filteredLaunches.length === 0 && (
                <div className="p-5 text-dim text-xs md:text-sm text-center">
                  {monthTx.length === 0 ? "Seu mês ainda está sem lançamentos. Registre uma entrada ou saída para começar a enxergar seu saldo e seus padrões." : "Nenhum lançamento corresponde à busca ou aos filtros."}
                </div>
              )}

              {filteredLaunches.map((tx, index) => {
                const RowIcon = tx.type === "entrada" ? ArrowUpRight : (FIN_CATEGORY_ICONS[tx.category] || MoreHorizontal);
                return (
                <div
                  key={tx.id}
                  className={`finance-transaction-row finance-history-row p-3 md:p-4 flex flex-col sm:flex-row sm:items-center gap-2.5 md:gap-3 text-sm ${index === 0 ? "is-latest" : ""}`}
                  style={{ "--finance-row-accent": tx.type === "entrada" ? "var(--moss)" : "var(--ember)" }}
                >
                  <div className="finance-history-marker shrink-0">
                    <div className={`finance-history-icon ${tx.type === "entrada" ? "text-moss" : "text-ember"}`}>
                      <RowIcon size={15} />
                    </div>
                    <span className="finance-history-line" />
                  </div>

                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="finance-history-date rounded-xl shrink-0">
                      <span className="font-mono text-xs">{String(new Date(tx.date + "T12:00:00").getDate()).padStart(2, "0")}</span>
                      <span className="text-[8px] text-faint uppercase">
                        {new Date(tx.date + "T12:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                      </span>
                    </div>

                    <div className="finance-history-content flex-1 min-w-0">
                      <div className="finance-history-name-value flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0 flex-1">
                          <p className="finance-transaction-description text-xs md:text-sm font-medium leading-relaxed">
                            {tx.description || tx.category}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-faint text-[9px] md:text-[10px]">
                              {tx.category} · {tx.type === "entrada" ? "Entrada" : "Saída"}
                            </span>
                            {tx.billId && <span className="chip text-brass">Pago</span>}
                            {tx.recurringId && <span className="chip">Recorrente</span>}
                          </div>
                        </div>

                        <div className="finance-history-value shrink-0 text-right">
                          <p
                            className="font-mono text-sm md:text-base font-semibold whitespace-nowrap"
                            style={{ color: tx.type === "entrada" ? "var(--moss)" : "var(--ember)" }}
                          >
                            {tx.type === "entrada" ? "+" : "-"}{money(tx.value)}
                          </p>
                          <p className="text-[8px] text-faint mt-0.5 whitespace-nowrap">
                            {new Date(tx.date + "T12:00:00").toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="finance-transaction-actions flex items-center justify-end gap-2 w-auto shrink-0">
                    <button className="finance-history-action btn-ghost rounded-lg p-2 shrink-0" onClick={() => duplicateTransaction(tx)} aria-label="Duplicar lançamento" title="Duplicar lançamento">
                      <Copy size={13} />
                    </button>
                    <button className="finance-history-action btn-ghost rounded-lg p-2 shrink-0" onClick={() => deleteTransaction(tx.id)} aria-label="Excluir lançamento" title="Excluir lançamento">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {financeSection === "intelligence" && (
        isPro ? (
          <>
            <div className="finance-intelligence-entry surface rounded-2xl p-4 md:p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--brass) 10%, var(--surface-2))" }}>
                  <BrainCircuit size={18} className="text-brass" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-faint uppercase tracking-widest">Pergunte sobre seu dinheiro</p>
                  <p className="font-display text-lg md:text-xl mt-0.5">Financial Intelligence</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">O Constancce interpreta a pergunta e calcula a resposta usando seus registros.</p>
                </div>
              </div>

              <FinanceProAssistant
                transactions={transactions}
                financialGoals={goals || []}
                financeBills={profile?.financeBills || []}
                financeRecurring={profile?.financeRecurring || []}
                monthlyLimit={profile?.monthlyLimit || 0}
                financeBudgets={profile?.financeBudgets || {}}
                selectedMonth={selectedMonth}
                projectedBalance={projectedBalance}
                availableToSpend={availableToSpend}
              />
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Saúde financeira</p>
                  <div className="flex items-end gap-2 mt-1.5">
                    <p className="font-display text-2xl md:text-3xl">{financialHealth}</p>
                    <span className="chip mb-1">{financialHealthLabel}</span>
                  </div>
                </div>
                <Gauge size={19} className="text-brass" />
              </div>
              <Progress value={financialHealth} height={6} />
              <p className="text-[10px] md:text-xs text-dim mt-2 leading-relaxed">
                {!hasFinanceData
                  ? "Registre entradas e saídas para gerar uma leitura."
                  : monthBalance < 0
                    ? "O principal ponto de atenção é o saldo negativo deste mês."
                    : monthlyLimitUsedPct >= 100
                      ? "Seu saldo está positivo, mas o limite mensal foi ultrapassado."
                      : savingsPct >= 20
                        ? "Seu saldo e sua capacidade de poupança estão em uma faixa saudável."
                        : "Seu saldo está positivo, mas ainda há espaço para aumentar a sobra do mês."}
              </p>
              <p className="text-[9px] text-faint mt-1">Poupança 35% · Orçamento 30% · Saldo 20% · Limite 15%</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 md:gap-4">
              <div className="surface glass-panel rounded-2xl p-4 md:p-5">
                <p className="text-[10px] text-faint uppercase tracking-widest">Gastos por categoria</p>
                <p className="text-[10px] md:text-xs text-dim mt-1 mb-4">Visão gráfica do mês selecionado.</p>
                <FinanceDonutChart data={byCategory} total={monthOut} />
              </div>
              <div className="surface glass-panel rounded-2xl p-4 md:p-5">
                <p className="text-[10px] text-faint uppercase tracking-widest">Últimos 6 meses</p>
                <p className="text-[10px] md:text-xs text-dim mt-1 mb-3">Entradas e saídas ao longo do tempo.</p>
                <FinanceTrendChart rows={sixMonths} />
              </div>
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-6">
              <p className="text-[10px] text-faint uppercase tracking-widest">Gastos por dia</p>
              <p className="text-[10px] md:text-xs text-dim mt-1 mb-4">Cada bloco é um dia de {monthLabelDisplay}. Quanto mais intenso, maior o gasto em relação ao pico do mês.</p>
              {spendingHeatmap.length > 0 ? (
                <>
                  <ConsistencyHeatmap days={spendingHeatmap} />
                  <div className="flex items-center justify-between mt-3 text-[9px] text-faint">
                    <span>menor gasto</span>
                    <span>{monthLabelDisplay}</span>
                    <span>maior gasto</span>
                  </div>
                </>
              ) : (
                <p className="text-dim text-xs py-4 text-center">Sem dias suficientes neste mês ainda.</p>
              )}
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Orçamento por categoria</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Defina somente o teto e acompanhe o consumo.</p>
                </div>
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs self-start sm:self-auto" onClick={() => setEditingBudgets((value) => !value)}>
                  <Pencil size={12} className="inline mr-1" /> {editingBudgets ? "Concluir" : "Editar tetos"}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {categoryRows.map((item) => {
                  const rawPct = item.budget > 0 ? Math.round((item.spent / item.budget) * 100) : 0;
                  const pct = Math.min(100, rawPct);
                  const over = item.budget > 0 && item.spent > item.budget;
                  const CategoryIcon = FIN_CATEGORY_ICONS[item.category] || MoreHorizontal;
                  return (
                    <div key={item.category} className="surface-2 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0 flex items-start gap-1.5">
                          <CategoryIcon size={13} className="text-brass shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-xs md:text-sm font-medium truncate">{item.category}</p>
                            <p className="text-[9px] md:text-[10px] text-faint mt-0.5">
                              {item.budget > 0 ? `${money(item.spent)} de ${money(item.budget)}` : `${money(item.spent)} gastos`}
                            </p>
                          </div>
                        </div>
                        {editingBudgets ? (
                          <input
                            type="number"
                            min="0"
                            step="10"
                            className="finance-category-budget-input w-24 p-2 text-xs ring-focus text-right shrink-0"
                            defaultValue={item.budget || ""}
                            placeholder="Teto"
                            onBlur={(e) => updateBudget(item.category, e.target.value)}
                          />
                        ) : (
                          <span className={`text-[10px] md:text-xs font-mono shrink-0 ${over ? "text-ember" : rawPct >= 80 ? "text-brass" : "text-dim"}`}>
                            {item.budget > 0 ? `${rawPct}%` : "sem teto"}
                          </span>
                        )}
                      </div>
                      <Progress value={pct} height={5} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Fixos e recorrentes</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Entradas fixas de um lado, despesas fixas do outro. São lançadas automaticamente todo mês — use para assinaturas e salário; contas com vencimento ficam em 'Próximas contas'.</p>
                </div>
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs self-start sm:self-auto" onClick={() => setShowRecurringForm(true)}>
                  <Plus size={12} className="inline mr-1" /> Nova recorrência
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ["entrada", "Entradas fixas", "text-moss"],
                  ["saida", "Despesas fixas", "text-ember"],
                ].map(([type, title, tone]) => {
                  const rows = recurringItems.filter((item) => item.type === type);
                  return (
                    <div key={type} className="surface-2 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className={`text-xs font-medium ${tone}`}>{title}</p>
                        <span className="chip">{rows.length}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {rows.length === 0 && <p className="text-[10px] text-faint py-1">Nenhuma cadastrada.</p>}
                        {rows.map((item) => (
                          <div key={item.id} className="flex items-center gap-2 min-w-0">
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] md:text-xs truncate">{item.description}</p>
                              <p className="text-[9px] text-faint">dia {item.day} · {item.active === false ? "pausada" : "ativa"}</p>
                            </div>
                            <span className={`font-mono text-[9px] md:text-[10px] shrink-0 ${tone}`}>{money(item.value)}</span>
                            <button className="btn-ghost rounded-lg p-1.5 shrink-0" onClick={() => toggleRecurring(item.id)} title={item.active === false ? "Ativar" : "Pausar"}>
                              {item.active === false ? <Play size={12} /> : <Pause size={12} />}
                            </button>
                            <button className="btn-ghost rounded-lg p-1.5 shrink-0" onClick={() => deleteRecurring(item.id)} title="Excluir">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <ProLockCard
              feature="finance"
              title="Financial Intelligence"
              description="Comparações históricas, projeções avançadas, gráficos, recorrências automáticas e perguntas inteligentes ficam no PRO. O controle financeiro básico continua disponível no Free."
              onUpgrade={onUpgrade}
            />
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest">O que continua no Free</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                {["Entradas e saídas", "Saldo e limite", "Categorias", "Contas e metas"].map((label) => (
                  <div key={label} className="surface-2 rounded-xl p-3 text-[10px] md:text-xs text-dim">{label}</div>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {duplicatePending && (
        <Modal title="Confirmar cópia" onClose={() => setDuplicatePending(null)} width={430}>
          <div className="finance-copy-confirmation">
            <div className="w-11 h-11 rounded-2xl surface-2 flex items-center justify-center mb-3">
              <Copy size={18} className="text-brass" />
            </div>
            <p className="text-sm leading-relaxed">
              Deseja copiar <strong>{duplicatePending.description || duplicatePending.category}</strong> com o valor de <strong>{money(duplicatePending.value)}</strong>?
            </p>
            <p className="text-[10px] text-faint mt-2">
              A cópia manterá tipo, categoria, valor e data. Vínculos automáticos com conta recorrente ou meta não serão duplicados.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button className="btn-ghost rounded-xl py-2.5 text-sm" onClick={() => setDuplicatePending(null)}>Cancelar</button>
              <button className="btn-primary rounded-xl py-2.5 text-sm" onClick={confirmDuplicateTransaction}>Confirmar cópia</button>
            </div>
          </div>
        </Modal>
      )}

      {showForm && (
        <TransactionForm
          presetType={presetType}
          goals={goals}
          onClose={() => setShowForm(false)}
          onSave={(tx) => {
            if (saveFinanceTransaction(tx) === false) return;
            setShowForm(false);
          }}
        />
      )}

      {showRecurringForm && (
        <FinanceRecurringForm onClose={() => setShowRecurringForm(false)} onSave={saveRecurring} />
      )}

      {showBillForm && (
        <FinanceBillForm
          initial={editingBill}
          onClose={() => {
            setShowBillForm(false);
            setEditingBill(null);
          }}
          onSave={saveBill}
        />
      )}
      {confirmDialog}
    </div>
  );
}

export default FinanceView;
