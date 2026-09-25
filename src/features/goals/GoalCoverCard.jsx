import React from "react";
import { Brain, Briefcase, Calendar, CheckCircle2, HeartPulse, Shield, Users, Wallet } from "lucide-react";
import { LIFE_AREAS, goalArea } from "../../lib/lifeMap.js";
import { daysUntil, goalProgressPercent } from "../../lib/goalForecast.js";

// Card de meta em galeria (estilo "vision board"): capa com a foto da meta
// (ou uma capa gerada pela área da vida, para quem não tem foto — foto é PRO),
// título e prazo por cima, progresso e dias restantes embaixo. Tocar abre o
// detalhe completo (renderGoalCard em GoalsView).

const AREA_ICONS = { saude: HeartPulse, mente: Brain, carreira: Briefcase, financas: Wallet, relacionamentos: Users, disciplina: Shield };
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
  const areaId = goalArea(goal);
  const area = LIFE_AREAS.find((a) => a.id === areaId);
  const AreaIcon = AREA_ICONS[areaId] || Shield;
  const pct = goal.completed ? 100 : goalProgressPercent(goal);

  return (
    <button
      type="button"
      className="goal-cover-card text-left min-w-0"
      onClick={() => onOpen(goal.id)}
      aria-label={`${goal.name}, ${area?.label}, ${pct}% concluída, ${goalTimeLeftLabel(goal)}`}
    >
      <div className="goal-cover-media">
        {goal.imageDataUrl ? (
          <img src={goal.imageDataUrl} alt="" className="goal-cover-image" loading="lazy" />
        ) : (
          <div className={`goal-cover-fallback goal-cover-${areaId}`} aria-hidden="true">
            <AreaIcon className="goal-cover-fallback-icon" strokeWidth={1.25} />
          </div>
        )}
        <div className="goal-cover-shade" />
        <div className="goal-cover-caption">
          <span className="goal-cover-area">{area?.label}</span>
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
