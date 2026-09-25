import React from "react";
import { Calendar, CheckCircle2, Hash, Hourglass, Layers, ListChecks, Repeat, Wallet } from "lucide-react";
import { daysUntil, goalProgressPercent } from "../../lib/goalForecast.js";

// Card de meta em galeria: capa com a foto da meta (ou, sem foto, uma capa
// com o ícone do tipo da meta; foto é PRO), título e prazo por cima,
// progresso e dias restantes embaixo. Tocar abre o detalhe completo
// (renderGoalCard em GoalsView).

// Os mesmos tipos do formulário da meta.
export const GOAL_TYPES = {
  financeira: { label: "Financeira", icon: Wallet },
  numerica: { label: "Numérica", icon: Hash },
  quantidade: { label: "Quantidade", icon: Layers },
  frequencia: { label: "Frequência", icon: Repeat },
  prazo: { label: "Prazo", icon: Hourglass },
  checklist: { label: "Etapas", icon: ListChecks },
};
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export function formatGoalDeadline(dateStr) {
  if (!dateStr) return "Sem prazo";
  const [, month, day] = String(dateStr).split("-");
  return `até ${Number(day)} ${MONTHS[Number(month) - 1] || ""}`.trim();
}

export function goalTimeLeftLabel(goal) {
  if (goal?.completed) return "Concluída";
  if (!goal?.endDate) return "Sem prazo";
  const left = daysUntil(goal.endDate);
  if (left < 0) return "Prazo encerrado";
  if (left === 0) return "Termina hoje";
  return `Faltam ${left} dia${left === 1 ? "" : "s"}`;
}

export default function GoalCoverCard({ goal, valueText, onOpen }) {
  const typeKey = GOAL_TYPES[goal.type] ? goal.type : "numerica";
  const { label: typeLabel, icon: TypeIcon } = GOAL_TYPES[typeKey];
  const pct = goal.completed ? 100 : goalProgressPercent(goal);

  return (
    <button
      type="button"
      className="goal-cover-card text-left min-w-0"
      onClick={() => onOpen(goal.id)}
      aria-label={`${goal.name}, meta ${typeLabel.toLowerCase()}, ${pct}% concluída, ${goalTimeLeftLabel(goal)}`}
    >
      <div className="goal-cover-media">
        {goal.imageDataUrl ? (
          <img src={goal.imageDataUrl} alt="" className="goal-cover-image" loading="lazy" />
        ) : (
          <div className={`goal-cover-fallback goal-cover-${typeKey}`} aria-hidden="true">
            <TypeIcon className="goal-cover-fallback-icon" strokeWidth={1.25} />
          </div>
        )}
        <div className="goal-cover-shade" />
        <div className="goal-cover-caption">
          <span className="goal-cover-type">{typeLabel}</span>
          <p className="goal-cover-title font-display">{goal.name}</p>
          <p className="goal-cover-date">
            {goal.completed ? <CheckCircle2 size={13} aria-hidden="true" /> : <Calendar size={13} aria-hidden="true" />}
            <span>{goal.completed ? "Concluída" : formatGoalDeadline(goal.endDate)}</span>
          </p>
        </div>
      </div>
      <div className="goal-cover-footer">
        <div className="goal-cover-bar" aria-hidden="true">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="goal-cover-meta">
          <span className="goal-cover-value">{valueText}</span>
          <span className="goal-cover-left">{goalTimeLeftLabel(goal)}</span>
        </div>
      </div>
    </button>
  );
}
