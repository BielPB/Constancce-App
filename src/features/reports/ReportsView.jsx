import React from "react";
import { Progress, ProLockCard } from "../../components/ui.jsx";

export default function ReportsView({ habits, completions, tasks, workoutSessions, transactions, goals, isPro, onUpgrade, today, startOfMonth, habitValidOnDate, addDays, money, months, stats }) {
  const t = today();
  const monthStart = startOfMonth(t);
  const best = stats?.bestHabit && stats.bestHabit !== "—" ? { name: stats.bestHabit, rate: stats.bestHabitRate || 0 } : null;
  const worst = stats?.worstHabit && stats.worstHabit !== "—" ? { name: stats.worstHabit, rate: stats.worstHabitRate || 0 } : null;
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
            const target = Math.max(0, Number(g.target || 0));
            const current = Math.max(0, Number(g.current || 0));
            const pct = target > 0 ? Math.min(100, Math.max(0, Math.round((current / target) * 100))) : 0;
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
