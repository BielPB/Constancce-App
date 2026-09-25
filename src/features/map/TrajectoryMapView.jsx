import React, { useMemo, useState } from "react";
import { Lock, Waypoints } from "lucide-react";
import { FirstVisitTip, ProBadge } from "../../components/ui.jsx";
import { MAP_RANGES, FREE_MAP_RANGE, buildTrajectory, layoutTrajectory } from "../../lib/trajectoryMap.js";
import LifeMap from "./LifeMap.jsx";

// Seção "Mapa" (substitui a antiga "Progresso"), em três abas:
//   Mapa da vida — áreas → metas → hábitos/tarefas, com física (LifeMap.jsx);
//   Trajetória   — linha do tempo radial de marcos reais (este arquivo);
//   Números      — os gráficos do antigo Progresso.

const SIZE = 400;
const CENTER = SIZE / 2;
const RINGS = [62, 110, 158];

const formatDate = (dateStr, options = { day: "2-digit", month: "2-digit", year: "numeric" }) =>
  dateStr ? new Date(`${dateStr}T12:00:00`).toLocaleDateString("pt-BR", options) : "—";

const activateOnKey = (handler) => (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handler();
  }
};

export default function TrajectoryMapView({ data, today, game, streaks, unlockedCount, enabledAreas, isPro, onUpgrade, numbers, onOpenGoal, onGoToGoals }) {
  const [tab, setTab] = useState("life");
  const [range, setRange] = useState(FREE_MAP_RANGE);
  const [selection, setSelection] = useState({ type: "center" });

  const trajectory = useMemo(
    () => buildTrajectory(data, { range, today, enabledAreas }),
    [data, range, today, enabledAreas]
  );
  const layout = useMemo(() => layoutTrajectory(trajectory, { size: SIZE, outerRadius: RINGS[2] }), [trajectory]);

  const selectedBranch = selection.type === "branch" ? layout.find((b) => b.id === selection.id) : null;
  const selectedNode = selection.type === "node"
    ? layout.flatMap((b) => b.nodes).find((n) => n.id === selection.id) || selection.node || null
    : null;
  const nodeBranch = selectedNode ? layout.find((b) => b.id === selectedNode.areaId) : null;

  const ranked = [...trajectory.branches].sort((a, b) => b.activity - a.activity);
  const strongest = ranked[0]?.activity ? ranked[0] : null;
  const quietest = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const milestonesInRange = trajectory.branches.reduce((sum, b) => sum + b.nodes.length + b.hiddenCount, 0);

  const pickRange = (id) => {
    if (!isPro && id !== FREE_MAP_RANGE) {
      onUpgrade("map");
      return;
    }
    setRange(id);
    setSelection({ type: "center" });
  };

  return (
    <div className="trajectory-view flex flex-col gap-4 md:gap-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl md:text-3xl">Mapa</h2>
            {isPro && <ProBadge compact />}
          </div>
          <p className="text-dim text-sm mt-1">
            Sua vida em um mapa: áreas, metas, hábitos e tarefas — e a trajetória que te trouxe até aqui.
          </p>
        </div>
        <span className="chip self-start sm:self-auto">{game.rank.title} · Nv. {game.level}</span>
      </div>

      <FirstVisitTip id="map" icon={Waypoints} title="Seu mapa cresce junto com você.">
        Cada meta entra na área da vida dela, com os hábitos e tarefas que levam até lá. Arraste, aproxime e toque nos pontos para explorar.
      </FirstVisitTip>

      <div className="task-glass-tabs rounded-2xl p-1 grid grid-cols-3 gap-1" role="tablist" aria-label="Visualização">
        {[["life", "Mapa da vida"], ["trail", "Trajetória"], ["numbers", "Números"]].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`task-tab-button rounded-xl py-2 text-xs md:text-sm font-medium min-w-0 ${tab === id ? "task-tab-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "numbers" && numbers}
      {tab === "life" && (
        <LifeMap
          goals={data.goals}
          habits={data.habits}
          tasks={data.tasks}
          completions={data.completions}
          today={today}
          onOpenGoal={onOpenGoal}
          onGoToGoals={onGoToGoals}
        />
      )}
      {tab === "trail" && (
        <>
          <div className="surface glass-panel rounded-2xl p-3 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-[10px] text-faint uppercase tracking-widest">{MAP_RANGES[range].title}</p>
              <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
                {Object.entries(MAP_RANGES).map(([id, { label }]) => (
                  <button
                    key={id}
                    onClick={() => pickRange(id)}
                    aria-pressed={range === id}
                    className={`chip whitespace-nowrap flex items-center gap-1 ${range === id ? "text-brass" : ""}`}
                    style={range === id ? { borderColor: "var(--brass-dim)", background: "var(--surface-2)" } : {}}
                  >
                    {!isPro && id !== FREE_MAP_RANGE && <Lock size={9} aria-label="PRO" />}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <svg
              viewBox={`-44 -8 ${SIZE + 88} ${SIZE + 16}`}
              className="trajectory-svg w-full max-w-[560px] mx-auto block"
              role="group"
              aria-label="Mapa da sua trajetória"
            >
              {RINGS.map((r) => (
                <circle key={r} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="var(--border)" strokeDasharray="2 6" />
              ))}

              {layout.map((branch) => (
                <line
                  key={`line-${branch.id}`}
                  x1={branch.start.x} y1={branch.start.y} x2={branch.end.x} y2={branch.end.y}
                  stroke={branch.color}
                  strokeWidth={1.5 + branch.weight * 3.5}
                  strokeOpacity={0.3 + branch.weight * 0.6}
                  strokeLinecap="round"
                />
              ))}

              {layout.map((branch) => (
                <g
                  key={`label-${branch.id}`}
                  className="trajectory-hit"
                  role="button"
                  tabIndex={0}
                  aria-label={`${branch.label}: ${branch.activity} registros no período, ${branch.nodes.length + branch.hiddenCount} marcos`}
                  onClick={() => setSelection({ type: "branch", id: branch.id })}
                  onKeyDown={activateOnKey(() => setSelection({ type: "branch", id: branch.id }))}
                >
                  <text
                    x={branch.labelAt.x} y={branch.labelAt.y}
                    textAnchor={branch.labelAt.anchor}
                    dominantBaseline="middle"
                    fontSize="14"
                    fontWeight={selection.id === branch.id ? 700 : 500}
                    fill={selection.id === branch.id ? "var(--text)" : "var(--text-dim)"}
                  >
                    {branch.label}
                  </text>
                  <text
                    x={branch.labelAt.x} y={branch.labelAt.y + 15}
                    textAnchor={branch.labelAt.anchor}
                    dominantBaseline="middle"
                    fontSize="10.5"
                    fill="var(--text-faint)"
                  >
                    {branch.activity} no período
                  </text>
                </g>
              ))}

              {layout.flatMap((branch) => branch.nodes.map((node) => {
                const selected = selection.type === "node" && selection.id === node.id;
                const r = node.major ? 7 : 4.5;
                return (
                  <g
                    key={node.id}
                    className="trajectory-node trajectory-hit"
                    role="button"
                    tabIndex={0}
                    aria-label={`${branch.label}: ${node.title}, ${formatDate(node.date)}`}
                    aria-pressed={selected}
                    onClick={() => setSelection({ type: "node", id: node.id })}
                    onKeyDown={activateOnKey(() => setSelection({ type: "node", id: node.id }))}
                  >
                    <circle cx={node.x} cy={node.y} r={14} fill="transparent" />
                    <circle className="trajectory-node-ring" cx={node.x} cy={node.y} r={r + 5} fill="none" stroke={branch.color} strokeWidth="1.5" opacity={selected ? 1 : 0} />
                    <circle cx={node.x} cy={node.y} r={r} fill={branch.color} stroke="var(--surface)" strokeWidth="2" />
                  </g>
                );
              }))}

              <g
                className="trajectory-hit"
                role="button"
                tabIndex={0}
                aria-label={`Você: nível ${game.level}, ${game.rank.title}`}
                onClick={() => setSelection({ type: "center" })}
                onKeyDown={activateOnKey(() => setSelection({ type: "center" }))}
              >
                <circle cx={CENTER} cy={CENTER} r="36" fill="var(--surface-2)" stroke="var(--brass)" strokeWidth={selection.type === "center" ? 2.5 : 1.5} />
                <text x={CENTER} y={CENTER - 6} textAnchor="middle" dominantBaseline="middle" fontSize="17" fontWeight="700" fill="var(--text)">Nv. {game.level}</text>
                <text x={CENTER} y={CENTER + 12} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="var(--brass)">{game.rank.title}</text>
              </g>
            </svg>

            <p className="text-[10px] text-faint text-center mt-1">
              Perto do centro = mais antigo · longe do centro = mais recente · ponto maior = marco importante
            </p>
          </div>

          <div className="surface glass-panel rounded-2xl p-4 md:p-5" aria-live="polite">
            {selectedNode && nodeBranch && (
              <div>
                <p className="text-[10px] uppercase tracking-widest flex items-center gap-1.5" style={{ color: nodeBranch.color }}>
                  <span className="calendar-dot" style={{ background: nodeBranch.color }} /> {nodeBranch.label}
                </p>
                <p className="font-display text-xl mt-1.5">{selectedNode.title}</p>
                <p className="text-dim text-sm mt-1">{formatDate(selectedNode.date, { day: "numeric", month: "long", year: "numeric" })}</p>
                <p className="text-sm mt-3">{selectedNode.detail}</p>
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs mt-3" onClick={() => setSelection({ type: "branch", id: nodeBranch.id })}>
                  Ver todos os marcos de {nodeBranch.label}
                </button>
              </div>
            )}

            {selectedBranch && (
              <div>
                <p className="text-[10px] uppercase tracking-widest flex items-center gap-1.5" style={{ color: selectedBranch.color }}>
                  <span className="calendar-dot" style={{ background: selectedBranch.color }} /> {selectedBranch.label}
                </p>
                <p className="text-dim text-sm mt-1">{selectedBranch.activity} registros · {MAP_RANGES[range].title.toLowerCase()}</p>
                {selectedBranch.allNodes.length ? (
                  <ol className="mt-3 flex flex-col gap-2">
                    {[...selectedBranch.allNodes].reverse().map((node) => (
                      <li key={node.id}>
                        <button
                          className="w-full text-left surface-2 rounded-xl px-3 py-2 flex items-center justify-between gap-3 interactive"
                          onClick={() => setSelection({ type: "node", id: node.id, node })}
                        >
                          <span className={`text-sm min-w-0 ${node.major ? "font-medium" : ""}`}>{node.title}</span>
                          <span className="text-faint text-xs shrink-0">{formatDate(node.date)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-dim mt-3">Nenhum marco nesta área no período. Um registro já começa a desenhar este ramo.</p>
                )}
                {selectedBranch.hiddenCount > 0 && (
                  <p className="text-xs text-faint mt-2">O mapa desenha os {selectedBranch.nodes.length} marcos principais desta área; a lista acima tem todos.</p>
                )}
              </div>
            )}

            {selection.type === "center" && (
              <div>
                <p className="text-[10px] text-brass uppercase tracking-widest">Você hoje</p>
                <p className="font-display text-xl mt-1.5">{game.rank.title} · Nível {game.level}</p>
                {trajectory.isEmpty ? (
                  <p className="text-sm text-dim mt-2">
                    Seu mapa começa no primeiro registro. Conclua um hábito, uma tarefa ou um treino e o primeiro ramo aparece aqui.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="surface-2 rounded-xl p-3">
                      <p className="text-[10px] text-faint uppercase tracking-widest">Marcos no período</p>
                      <p className="font-display text-2xl mt-1">{milestonesInRange}</p>
                    </div>
                    <div className="surface-2 rounded-xl p-3">
                      <p className="text-[10px] text-faint uppercase tracking-widest">Trajetória desde</p>
                      <p className="font-display text-lg mt-1">{formatDate(trajectory.firstDate, { month: "short", year: "numeric" })}</p>
                    </div>
                    <div className="surface-2 rounded-xl p-3">
                      <p className="text-[10px] text-faint uppercase tracking-widest">Streak de hábitos</p>
                      <p className="font-display text-lg mt-1">{streaks.current}d <span className="text-faint text-xs">recorde {streaks.best}d</span></p>
                    </div>
                    <div className="surface-2 rounded-xl p-3">
                      <p className="text-[10px] text-faint uppercase tracking-widest">Conquistas</p>
                      <p className="font-display text-lg mt-1">{unlockedCount}</p>
                    </div>
                  </div>
                )}
                {!trajectory.isEmpty && strongest && (
                  <p className="text-sm text-dim mt-3">
                    Ramo mais forte no período: <span style={{ color: strongest.color }} className="font-medium">{strongest.label}</span>
                    {quietest && quietest.id !== strongest.id && (
                      <> · pede atenção: <span style={{ color: quietest.color }} className="font-medium">{quietest.label}</span></>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
