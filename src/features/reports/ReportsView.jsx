import React from "react";
import { Progress, ProLockCard } from "../../components/ui.jsx";

export default function ReportsView({ habits, completions, tasks, workoutSessions, transactions, goals, isPro, onUpgrade, today, startOfMonth, habitValidOnDate, addDays, money, months }) {
  const t = today();
  const monthStart = startOfMonth(t);
  const habitStats = habits.map((h) => {
    let valid = 0, done = 0, scan = monthStart;
    const doneDates = new Set(completions.filter((c) => c.habitId === h.id).map((c) => c.date));
    while (scan <= t) { if (habitValidOnDate(h, scan, completions)) { valid++; if (doneDates.has(scan)) done++; } scan = addDays(scan, 1); }
    return { name: h.name, rate: valid === 0 ? 0 : Math.round((done / valid) * 100) };
  }).filter((h) => h.rate !== null);
  const best = [...habitStats].sort((a, b) => b.rate - a.rate)[0];
  const worst = [...habitStats].sort((a, b) => a.rate - b.rate)[0];
  const tasksDoneMonth = tasks.filter((tk) => tk.status === "concluida" && (tk.completedAt || "") >= monthStart).length;
  const tasksTotalMonth = tasks.filter((tk) => (tk.createdAt || "") >= monthStart).length;
  const workoutsMonth = workoutSessions.filter((s) => s.date >= monthStart && s.completed).length;
  const inMonth = transactions.filter((tx) => tx.type === "entrada" && tx.date >= monthStart).reduce((s, tx) => s + tx.value, 0);
  const outMonth = transactions.filter((tx) => tx.type === "saida" && tx.date >= monthStart).reduce((s, tx) => s + tx.value, 0);
  const goalsProgress = goals.filter((g) => !g.completed);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-2xl">Relatórios</h2>
      <p className="text-dim text-sm -mt-2">Resumo do mês de {months[new Date().getMonth()]}.</p>

      <div className="surface rounded-2xl p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-3">Resumo executivo</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-faint text-xs">Tarefas concluídas</p><p className="font-mono">{tasksDoneMonth}/{tasksTotalMonth}</p></div>
          <div><p className="text-faint text-xs">Treinos realizados</p><p className="font-mono">{workoutsMonth}</p></div>
          <div><p className="text-faint text-xs">Entradas no mês</p><p className="font-mono text-moss">{money(inMonth)}</p></div>
          <div><p className="text-faint text-xs">Gastos no mês</p><p className="font-mono text-ember">{money(outMonth)}</p></div>
        </div>
      </div>

      {isPro ? (
        <>
      {best && (
        <div className="surface rounded-2xl p-5">
          <p className="text-xs text-faint uppercase tracking-widest mb-3">Hábitos — o que melhor e pior performou</p>
          <div className="flex items-center justify-between text-sm mb-2"><span className="text-moss">▲ {best.name}</span><span className="font-mono">{best.rate}%</span></div>
          {worst && worst.name !== best.name && <div className="flex items-center justify-between text-sm"><span className="text-ember">▼ {worst.name}</span><span className="font-mono">{worst.rate}%</span></div>}
        </div>
      )}

      <div className="surface rounded-2xl p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-3">Metas em andamento</p>
        {goalsProgress.length === 0 && <p className="text-dim text-sm">Nenhuma meta em aberto.</p>}
        <div className="flex flex-col gap-2">
          {goalsProgress.map((g) => {
            const pct = Math.min(100, Math.round((g.current / g.target) * 100));
            return (
              <div key={g.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate">{g.name}</span>
                <div className="w-24"><Progress value={pct} height={6} /></div>
                <span className="font-mono text-xs w-10 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="surface-2 rounded-2xl p-4 text-xs text-dim">
        Prioridade recomendada: mantenha os hábitos com maior taxa de conclusão e ajuste horário ou frequência dos que estão com taxa mais baixa — hábitos negligenciados costumam indicar frequência mal calibrada, não falta de vontade.
      </div>
        </>
      ) : (
        <ProLockCard
          feature="reports"
          title="Relatórios avançados"
          description="O resumo executivo mensal permanece gratuito. Comparações de hábitos, metas e recomendações detalhadas são recursos PRO."
          onUpgrade={onUpgrade}
        />
      )}
    </div>
  );
}
