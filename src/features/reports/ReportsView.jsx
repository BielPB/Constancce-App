import React, { useId } from "react";
import {
  FileBarChart,
  Download,
  Flame,
  ListChecks,
  Dumbbell,
  Wallet,
  Apple,
  Target,
  TrendingUp,
  TrendingDown,
  Lightbulb,
  Trophy,
} from "lucide-react";
import { Progress, ProLockCard } from "../../components/ui.jsx";

/* -----------------------------------------------------------------------
   Mini gráficos — cópias enxutas e autocontidas de MiniLineChart /
   RadialProgress / ConsistencyHeatmap (definidas em App.jsx). App.jsx não
   exporta nada (não é um módulo ES) e este arquivo é carregado via lazy
   import a partir dele, então importar de volta criaria um ciclo de
   módulos arriscado. Preferimos duplicar essas três funções puras (mesmas
   classes CSS, mesmo visual) a mexer em App.jsx fora do escopo autorizado.
------------------------------------------------------------------------ */
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

function ReportMiniLineChart({ data, height = 120, color = "var(--brass)" }) {
  const gradientId = useId();
  const vals = data.map((item) => Number(item.value) || 0);
  const w = 600;
  const h = height;
  const padX = 22;
  const padY = 18;
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = Math.max(1, max - min);
  const baseline = h - padY;

  const points = vals.map((value, index) => ({
    x: padX + (index * (w - padX * 2)) / Math.max(1, vals.length - 1),
    y: padY + (1 - (value - min) / range) * (h - padY * 2),
    value,
    label: data[index]?.label,
  }));

  const path = smoothChartPath(points);
  const areaPath = points.length
    ? `${path} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`
    : "";

  return (
    <div className="tech-chart w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label="Gráfico de evolução">
        <defs>
          <linearGradient id={`mlc-fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
          <line
            key={ratio}
            x1={padX}
            x2={w - padX}
            y1={padY + (h - padY * 2) * ratio}
            y2={padY + (h - padY * 2) * ratio}
            stroke="var(--border-soft)"
            strokeWidth="1"
            strokeDasharray="3 7"
            opacity=".65"
          />
        ))}

        <path d={areaPath} fill={`url(#mlc-fill-${gradientId})`} stroke="none" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        {points.map((point, index) => (
          <g key={index}>
            <circle cx={point.x} cy={point.y} r="7" fill="transparent">
              <title>{`${point.label || ""}: ${point.value}`}</title>
            </circle>
            <circle cx={point.x} cy={point.y} r="2" fill="var(--surface)" stroke={color} strokeWidth="1.2" />
          </g>
        ))}
      </svg>

      <div className="flex justify-between text-[9px] text-faint font-mono">
        {data.map((item, index) => <span key={index}>{item.label}</span>)}
      </div>
    </div>
  );
}

function ReportRadialProgress({ value = 0, size = 132, strokeWidth = 10, label, color = "var(--brass)" }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="radial-progress shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-soft)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="radial-progress-arc"
        />
      </svg>
      <div className="radial-progress-center">
        <span className="radial-progress-value font-display">{Math.round(clamped)}%</span>
        {label && <span className="radial-progress-label">{label}</span>}
      </div>
    </div>
  );
}

function ReportConsistencyHeatmap({ days }) {
  return (
    <div className="tech-heatmap grid gap-1" style={{ gridTemplateColumns: "repeat(15, minmax(0,1fr))" }}>
      {days.map((day, index) => {
        const opacity = day.score === 0 ? 0.05 : 0.16 + (day.score / 100) * 0.74;
        return (
          <div
            key={index}
            title={`${day.date}: ${day.score}%`}
            className="aspect-square rounded-[2px]"
            style={{
              background: "var(--brass)",
              opacity,
              border: "1px solid color-mix(in srgb, var(--brass) 18%, transparent)",
            }}
          />
        );
      })}
    </div>
  );
}

export default function ReportsView({ habits, completions, tasks, workoutSessions, transactions, goals, isPro, onUpgrade, today, startOfMonth, habitValidOnDate, addDays, money, months, stats }) {
  const t = today();
  const monthStart = startOfMonth(t);
  const monthLabel = months[new Date(`${t}T12:00:00`).getMonth()];

  const best = stats?.bestHabit && stats.bestHabit !== "—" ? { name: stats.bestHabit, rate: stats.bestHabitRate || 0 } : null;
  const worst = stats?.worstHabit && stats.worstHabit !== "—" ? { name: stats.worstHabit, rate: stats.worstHabitRate || 0 } : null;

  const tasksDoneMonth = tasks.filter((tk) => tk.status === "concluida" && (tk.completedAt || "") >= monthStart).length;
  const tasksTotalMonth = tasks.filter((tk) => (tk.createdAt || "") >= monthStart).length;
  const overdueTasks = tasks.filter((tk) => (tk.repeat || "none") === "none" && tk.status !== "concluida" && tk.dueDate && tk.dueDate < t).length;

  const workoutsMonth = workoutSessions.filter((s) => s.date >= monthStart && s.completed).length;

  const inMonth = transactions.filter((tx) => tx.type === "entrada" && tx.date >= monthStart).reduce((s, tx) => s + tx.value, 0);
  const outMonth = transactions.filter((tx) => tx.type === "saida" && tx.date >= monthStart).reduce((s, tx) => s + tx.value, 0);
  const categoryTotalsMonth = transactions
    .filter((tx) => tx.type === "saida" && tx.date >= monthStart)
    .reduce((acc, tx) => {
      const key = tx.category || "Outros";
      acc[key] = (acc[key] || 0) + Number(tx.value || 0);
      return acc;
    }, {});
  const topCategory = Object.entries(categoryTotalsMonth).sort((a, b) => b[1] - a[1])[0] || null;

  const goalsProgress = goals.filter((g) => !g.completed);
  const goalsDoneTotal = stats?.goalsDone ?? goals.filter((g) => g.completed).length;

  const overallScore = stats?.avg30 ?? 0;
  const monthDelta = stats?.monthDelta ?? 0;
  const daysAbove80 = stats?.daysAbove80 ?? 0;
  const bestStreak = stats?.bestStreak ?? 0;
  const totalPerfectDays = stats?.totalPerfectDays ?? 0;
  const workoutBestStreak = stats?.workoutBestStreak ?? 0;
  const financialGoalsDone = stats?.financialGoalsDone ?? 0;
  const financialGoalAccumulated = stats?.financialGoalAccumulated ?? 0;
  const nutritionArea = stats?.areaPerformance?.find((item) => item.label === "Nutrição") || null;
  const insights = stats?.insights || [];
  const heatmapDays = stats?.heatmap90 || [];
  const trendChart = stats?.rangeCharts?.["30d"] || [];

  const scoreColor = overallScore >= 80 ? "var(--moss)" : overallScore >= 50 ? "var(--brass)" : "var(--ember)";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl flex items-center gap-2">
            <FileBarChart size={22} className="text-brass" /> Relatórios
          </h2>
          <p className="text-dim text-sm mt-1">Resumo consolidado de {monthLabel}.</p>
        </div>
        <div className="print-hidden flex flex-col items-end">
          <button
            type="button"
            className="btn-primary rounded-xl px-4 py-2.5 text-sm inline-flex items-center gap-2"
            onClick={() => window.print()}
          >
            <Download size={15} /> Baixar PDF
          </button>
          <p className="text-[10px] text-faint mt-1 max-w-[230px] text-right leading-relaxed">
            Abre a janela de impressão do navegador — escolha "Salvar como PDF" no destino.
          </p>
        </div>
      </div>

      <div className="glass-panel-strong rounded-2xl p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          <div className="flex items-center gap-4 shrink-0">
            <ReportRadialProgress value={overallScore} label="score 30d" size={104} strokeWidth={8} color={scoreColor} />
            <div className="min-w-0">
              <p className="text-[9px] md:text-[10px] text-faint uppercase tracking-widest">Desempenho geral</p>
              <p className="font-display text-2xl md:text-3xl mt-1">{overallScore}%</p>
              <p className="text-[10px] md:text-xs text-dim mt-1.5 max-w-[220px]">
                {monthDelta === 0
                  ? "Estável em relação aos 30 dias anteriores"
                  : `${Math.abs(monthDelta)} ponto${Math.abs(monthDelta) === 1 ? "" : "s"} ${monthDelta > 0 ? "acima" : "abaixo"} do período anterior`}
                {" · "}{daysAbove80} dia{daysAbove80 === 1 ? "" : "s"} acima de 80%
              </p>
            </div>
          </div>
          {trendChart.length > 1 && (
            <div className="flex-1 min-w-0">
              <p className="text-[9px] text-faint uppercase tracking-widest mb-1">Tendência — últimos 30 dias</p>
              <ReportMiniLineChart data={trendChart} height={96} color={scoreColor} />
            </div>
          )}
        </div>
      </div>

      <div className="surface glass-panel rounded-2xl p-4 md:p-5">
        <p className="text-[10px] text-faint uppercase tracking-widest mb-3">Resumo executivo</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-start gap-2">
            <ListChecks size={15} className="text-brass shrink-0 mt-0.5" />
            <div><p className="text-faint text-xs">Tarefas concluídas</p><p className="font-mono">{tasksDoneMonth}/{tasksTotalMonth}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Dumbbell size={15} className="text-brass shrink-0 mt-0.5" />
            <div><p className="text-faint text-xs">Treinos realizados</p><p className="font-mono">{workoutsMonth}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Wallet size={15} className="text-moss shrink-0 mt-0.5" />
            <div><p className="text-faint text-xs">Entradas no mês</p><p className="font-mono text-moss">{money(inMonth)}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Wallet size={15} className="text-ember shrink-0 mt-0.5" />
            <div><p className="text-faint text-xs">Gastos no mês</p><p className="font-mono text-ember">{money(outMonth)}</p></div>
          </div>
        </div>
      </div>

      {isPro ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Flame size={13} className="text-brass" /> Hábitos
              </p>
              {best && (
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-moss flex items-center gap-1.5"><TrendingUp size={14} /> {best.name}</span>
                  <span className="font-mono">{best.rate}%</span>
                </div>
              )}
              {worst && (!best || worst.name !== best.name) && (
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-ember flex items-center gap-1.5"><TrendingDown size={14} /> {worst.name}</span>
                  <span className="font-mono">{worst.rate}%</span>
                </div>
              )}
              {!best && !worst && <p className="text-dim text-sm">Sem hábitos suficientes para comparar ainda.</p>}
              <div className="flex items-center justify-between text-xs text-dim mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                <span>Melhor sequência</span>
                <span className="font-mono text-brass">{bestStreak} dia{bestStreak === 1 ? "" : "s"}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-dim mt-1.5">
                <span>Dias perfeitos (100%)</span>
                <span className="font-mono">{totalPerfectDays}</span>
              </div>
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Dumbbell size={13} className="text-brass" /> Treinos
              </p>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-dim">Sessões concluídas neste mês</span>
                <span className="font-mono">{workoutsMonth}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-dim mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                <span>Melhor sequência de treinos</span>
                <span className="font-mono text-brass">{workoutBestStreak} dia{workoutBestStreak === 1 ? "" : "s"}</span>
              </div>
              {nutritionArea && (
                <div className="flex items-center justify-between text-xs text-dim mt-1.5">
                  <span className="flex items-center gap-1.5"><Apple size={12} /> Nutrição registrada (30d)</span>
                  <span className="font-mono">{nutritionArea.value}%</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Wallet size={13} className="text-brass" /> Finanças
              </p>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-dim">Entradas</span>
                <span className="font-mono text-moss">{money(inMonth)}</span>
              </div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-dim">Gastos</span>
                <span className="font-mono text-ember">{money(outMonth)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-dim">Saldo</span>
                <span className={`font-mono ${inMonth - outMonth >= 0 ? "text-moss" : "text-ember"}`}>{money(inMonth - outMonth)}</span>
              </div>
              {topCategory && (
                <div className="flex items-center justify-between text-xs text-dim mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                  <span>Maior categoria de gasto</span>
                  <span className="font-mono">{topCategory[0]} · {money(topCategory[1])}</span>
                </div>
              )}
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Target size={13} className="text-brass" /> Metas
              </p>
              {goalsProgress.length === 0 && <p className="text-dim text-sm">Nenhuma meta em aberto.</p>}
              <div className="flex flex-col gap-2">
                {goalsProgress.map((g) => {
                  const target = Math.max(0, Number(g.target || 0));
                  const current = Math.max(0, Number(g.current || 0));
                  const pct = target > 0 ? Math.min(100, Math.max(0, Math.round((current / target) * 100))) : 0;
                  return (
                    <div key={g.id} className="flex items-center gap-3 text-sm">
                      <span className="flex-1 truncate">{g.name}</span>
                      <div className="w-20 md:w-24"><Progress value={pct} height={6} /></div>
                      <span className="font-mono text-xs w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-xs text-dim mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                <span>Metas concluídas (total)</span>
                <span className="font-mono">{goalsDoneTotal}</span>
              </div>
              {financialGoalsDone > 0 && (
                <div className="flex items-center justify-between text-xs text-dim mt-1.5">
                  <span>Acumulado em metas financeiras</span>
                  <span className="font-mono text-moss">{money(financialGoalAccumulated)}</span>
                </div>
              )}
            </div>
          </div>

          {heatmapDays.length > 0 && (
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest mb-3">Consistência — últimos 90 dias</p>
              <ReportConsistencyHeatmap days={heatmapDays} />
            </div>
          )}

          {insights.length > 0 && (
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Lightbulb size={13} className="text-brass" /> Insights
              </p>
              <div className="flex flex-col gap-2.5">
                {insights.map((text, index) => (
                  <p key={index} className="text-xs md:text-sm text-dim leading-relaxed flex items-start gap-2">
                    <Trophy size={12} className="text-brass shrink-0 mt-0.5" />
                    <span>{text}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="surface-2 rounded-2xl p-4 text-xs text-dim">
            Prioridade recomendada: mantenha os hábitos com maior taxa de conclusão e ajuste horário ou frequência dos que estão com taxa mais baixa — hábitos negligenciados costumam indicar frequência mal calibrada, não falta de vontade.
            {overdueTasks > 0 && (
              <> Você também tem {overdueTasks} tarefa{overdueTasks === 1 ? "" : "s"} atrasada{overdueTasks === 1 ? "" : "s"} aguardando reagendamento.</>
            )}
          </div>
        </>
      ) : (
        <ProLockCard
          feature="reports"
          title="Relatórios avançados"
          description="O resumo executivo mensal permanece gratuito. Comparações de hábitos, metas, consistência e recomendações detalhadas são recursos PRO."
          onUpgrade={onUpgrade}
        />
      )}
    </div>
  );
}
