import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, LocateFixed, Target, ZoomIn, ZoomOut } from "lucide-react";
import { buildLifeGraph, initLayout, stepLayout, layoutBounds, NODE_RADIUS, UNLINKED_GROUP_ID } from "../../lib/lifeMap.js";
import { daysUntil } from "../../lib/goalForecast.js";

// Mapa da vida: só o que existe no app. Você no centro, suas metas em volta
// e, ligados a cada meta, os hábitos e tarefas vinculados a ela. A lógica
// (grafo + física) está em src/lib/lifeMap.js; aqui só desenho e gestos.

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.6;
const TAP_SLOP = 6;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Rótulo em até 2 linhas.
function wrapLabel(text, max) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [""];
  for (const word of words) {
    const current = lines[lines.length - 1];
    if (!current) lines[lines.length - 1] = word;
    else if ((current + " " + word).length <= max) lines[lines.length - 1] = `${current} ${word}`;
    else if (lines.length < 2) lines.push(word);
    else { lines[1] = `${lines[1].slice(0, max - 1).trimEnd()}…`; break; }
  }
  return lines.map((line) => (line.length > max + 2 ? `${line.slice(0, max).trimEnd()}…` : line));
}

const deadlineText = (node) => {
  if (node.completed) return "Concluída";
  if (!node.endDate) return "Sem prazo";
  const left = daysUntil(node.endDate);
  if (left < 0) return "Prazo encerrado";
  if (left === 0) return "Termina hoje";
  return `Faltam ${left} dia${left === 1 ? "" : "s"}`;
};

// Marcadores da legenda (os mesmos desenhos do mapa, em miniatura).
function LegendMark({ kind, done }) {
  return (
    <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true" className="shrink-0">
      {kind === "goal" && (
        <>
          <circle r="7" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2" />
          <circle r="7" fill="none" stroke="var(--brass)" strokeWidth="2" strokeDasharray="30 44" transform="rotate(-90)" />
        </>
      )}
      {kind === "habit" && <circle r="6.5" fill={done ? "var(--brass)" : "var(--surface-2)"} stroke="var(--brass)" strokeWidth="1.5" />}
      {kind === "task" && <rect x="-6.5" y="-6.5" width="13" height="13" rx="3.5" fill={done ? "var(--brass)" : "var(--surface-2)"} stroke="var(--brass)" strokeWidth="1.5" />}
      {done && <path d="M-3 0 L-1 2.2 L3.2 -2.2" fill="none" stroke="var(--brass-ink)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export default function LifeMap({ goals = [], habits = [], tasks = [], completions = [], today, onOpenGoal, onGoToGoals }) {
  const graph = useMemo(
    () => buildLifeGraph({ goals, habits, tasks, completions, today }),
    [goals, habits, tasks, completions, today]
  );
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const posRef = useRef({});
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const pinnedRef = useRef(null);
  const gestureRef = useRef({ pointers: new Map(), mode: null });
  const interactedRef = useRef(false); // depois que o usuário mexe, não reenquadra sozinho
  const fitRef = useRef(() => {});
  const [, setFrame] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 }); // chega pelo ResizeObserver
  const [view, setView] = useState({ x: 0, y: 0, k: 0.8 });
  const [selectedId, setSelectedId] = useState("root");

  const fitTo = useCallback((positions) => {
    const bounds = layoutBounds(graph, positions);
    if (!Number.isFinite(bounds.width) || size.width < 50) return;
    const k = Math.max(MIN_ZOOM, Math.min(1.25, Math.min(size.width / bounds.width, size.height / bounds.height) * 0.94));
    setView({
      x: size.width / 2 - (bounds.minX + bounds.width / 2) * k,
      y: size.height / 2 - (bounds.minY + bounds.height / 2) * k,
      k,
    });
  }, [graph, size]);
  const fit = useCallback(() => fitTo(posRef.current), [fitTo]);
  fitRef.current = fit;

  // Loop da física: roda até assentar; arrastar reaquece.
  const run = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (prefersReducedMotion()) {
      for (let i = 0; i < 320; i += 1) stepLayout(graph, posRef.current, { alpha: Math.max(0.02, 1 - i / 260) });
      alphaRef.current = 0;
      setFrame((f) => f + 1);
      if (!interactedRef.current) fitRef.current();
      return;
    }
    const tick = () => {
      const energy = stepLayout(graph, posRef.current, { alpha: alphaRef.current, pinned: pinnedRef.current });
      alphaRef.current = Math.max(0, alphaRef.current * 0.98);
      setFrame((f) => f + 1);
      if (pinnedRef.current || alphaRef.current > 0.015 || energy > 0.35) rafRef.current = requestAnimationFrame(tick);
      else if (!interactedRef.current) fitRef.current();
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [graph]);

  useEffect(() => {
    posRef.current = initLayout(graph, posRef.current);
    alphaRef.current = 1;
    run();
    return () => cancelAnimationFrame(rafRef.current);
  }, [graph, run]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Enquadra pela posição que a física vai atingir (numa cópia), na primeira
  // medida e a cada mudança de tamanho, até o usuário mexer.
  useEffect(() => {
    if (size.width < 50 || interactedRef.current) return;
    const probe = JSON.parse(JSON.stringify(posRef.current));
    for (let i = 0; i < 260; i += 1) stepLayout(graph, probe, { alpha: Math.max(0.02, 1 - i / 220) });
    fitTo(probe);
  }, [size, graph, fitTo]);

  const toWorld = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };
  const zoomAt = useCallback((factor, cx, cy) => {
    interactedRef.current = true;
    setView((v) => {
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k * factor));
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0022)), event.clientX - rect.left, event.clientY - rect.top);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (event, nodeId = null) => {
    event.stopPropagation();
    const g = gestureRef.current;
    g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { svgRef.current.setPointerCapture?.(event.pointerId); } catch (_) { /* ponteiro sintético */ }
    if (g.pointers.size === 2) {
      pinnedRef.current = null;
      const [a, b] = [...g.pointers.values()];
      g.mode = "pinch";
      interactedRef.current = true;
      g.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), view };
      return;
    }
    g.start = { x: event.clientX, y: event.clientY, view, nodeId };
    g.moved = false;
    g.mode = nodeId && nodeId !== "root" ? "node" : "pan";
  };
  const onPointerMove = (event) => {
    const g = gestureRef.current;
    if (!g.pointers.has(event.pointerId)) return;
    g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (g.mode === "pinch" && g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      const rect = svgRef.current.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2 - rect.left;
      const cy = (a.y + b.y) / 2 - rect.top;
      const base = g.pinch.view;
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base.k * (dist / Math.max(1, g.pinch.dist))));
      setView({ k, x: cx - (cx - base.x) * (k / base.k), y: cy - (cy - base.y) * (k / base.k) });
      return;
    }
    if (!g.start) return;
    const dx = event.clientX - g.start.x;
    const dy = event.clientY - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    g.moved = true;
    interactedRef.current = true;
    if (g.mode === "node") {
      const world = toWorld(event.clientX, event.clientY);
      pinnedRef.current = { id: g.start.nodeId, x: world.x, y: world.y };
      if (alphaRef.current < 0.3) { alphaRef.current = 0.3; run(); }
    } else if (g.mode === "pan") {
      setView({ ...g.start.view, x: g.start.view.x + dx, y: g.start.view.y + dy });
    }
  };
  const onPointerUp = (event) => {
    const g = gestureRef.current;
    g.pointers.delete(event.pointerId);
    if (g.mode === "pinch") {
      if (g.pointers.size === 0) g.mode = null;
      g.start = null;
      return;
    }
    if (g.start && !g.moved) setSelectedId(g.start.nodeId || "root");
    if (pinnedRef.current) { pinnedRef.current = null; alphaRef.current = Math.max(alphaRef.current, 0.15); run(); }
    g.start = null;
    g.mode = null;
  };

  const zoomButton = (factor) => zoomAt(factor, size.width / 2, size.height / 2);
  const selected = nodeById.get(selectedId) || nodeById.get("root");
  const neighbors = (id) => graph.links
    .filter((l) => l.source === id || l.target === id)
    .map((l) => nodeById.get(l.source === id ? l.target : l.source))
    .filter(Boolean);

  const goalNodes = graph.nodes.filter((n) => n.kind === "goal");
  const activeGoals = goalNodes.filter((n) => !n.completed);
  const unlinkedHabits = neighbors(UNLINKED_GROUP_ID).filter((n) => n.kind === "habit");
  const pos = posRef.current;

  const renderNode = (node) => {
    const p = pos[node.id];
    if (!p) return null;
    const r = NODE_RADIUS[node.kind];
    const isSelected = selected?.id === node.id;
    const leaf = node.kind === "habit" || node.kind === "task";
    const circumference = 2 * Math.PI * r;
    const lines = node.kind === "root" ? [] : wrapLabel(node.label, leaf ? 16 : 18);
    const labelSize = leaf ? 11.5 : 13;
    const status = node.kind === "goal"
      ? `meta, ${node.progress}%${node.completed ? ", concluída" : ""}`
      : node.kind === "habit" ? `hábito, ${node.paused ? "pausado" : node.done ? "feito hoje" : "pendente hoje"}`
      : node.kind === "task" ? `tarefa, ${node.done ? "concluída" : "pendente"}`
      : node.kind === "group" ? `${unlinkedHabits.length} ${unlinkedHabits.length === 1 ? "hábito" : "hábitos"} sem meta` : "centro do mapa";
    return (
      <g
        key={node.id}
        transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
        className="life-node"
        role="button"
        tabIndex={0}
        aria-label={`${node.label}, ${status}`}
        aria-pressed={isSelected}
        onPointerDown={(event) => onPointerDown(event, node.id)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); } }}
      >
        <circle r={r + 12} fill="transparent" />
        {isSelected && <circle r={r + 7} fill="none" stroke="var(--brass)" strokeOpacity="0.6" strokeWidth="1.5" />}

        {node.kind === "root" && (
          <>
            <circle r={r} fill="var(--surface-2)" stroke="var(--brass)" strokeWidth="2.5" />
            <text textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--text)">Você</text>
          </>
        )}
        {node.kind === "goal" && (
          <>
            <circle r={r} fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
            <circle
              r={r}
              fill="none"
              stroke="var(--brass)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(circumference * node.progress) / 100} ${circumference}`}
              transform="rotate(-90)"
            />
            {node.completed
              ? <path d="M-7 0.5 L-2.5 5 L7.5 -5" fill="none" stroke="var(--brass)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              : <text textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill="var(--text)">{node.progress}%</text>}
          </>
        )}
        {node.kind === "group" && (
          <>
            <circle r={r} fill="var(--surface-2)" stroke="var(--text-faint)" strokeWidth="1.5" strokeDasharray="4 4" />
            <text textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill="var(--text-dim)">{unlinkedHabits.length}</text>
          </>
        )}
        {leaf && (
          <g opacity={node.paused ? 0.45 : 1}>
            {node.kind === "habit"
              ? <circle r={r} fill={node.done ? "var(--brass)" : "var(--surface-2)"} stroke="var(--brass)" strokeWidth="1.8" />
              : <rect x={-r} y={-r} width={r * 2} height={r * 2} rx="5" fill={node.done ? "var(--brass)" : "var(--surface-2)"} stroke="var(--brass)" strokeWidth="1.8" />}
            {node.done && <path d="M-4.2 0.2 L-1.4 3 L4.4 -3" fill="none" stroke="var(--brass-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          </g>
        )}

        {lines.map((line, i) => (
          <text
            key={i}
            y={r + 16 + i * (labelSize + 3)}
            textAnchor="middle"
            fontSize={labelSize}
            fontWeight={leaf ? 400 : 600}
            fill={leaf ? "var(--text-dim)" : "var(--text)"}
            className="life-node-label"
          >
            {line}
          </text>
        ))}
      </g>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={containerRef}
        className="life-map surface rounded-2xl overflow-hidden relative"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          className="block w-full h-full"
          onPointerDown={(event) => onPointerDown(event, null)}
          role="group"
          aria-label="Mapa das suas metas, com os hábitos e tarefas ligados a cada uma. Arraste para mover e use os botões ou a pinça para zoom."
        >
          <g transform={`translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(3)})`}>
            {graph.links.map((link) => {
              const a = pos[link.source];
              const b = pos[link.target];
              if (!a || !b) return null;
              const highlighted = selected && (link.source === selected.id || link.target === selected.id);
              return (
                <line
                  key={`${link.source}->${link.target}`}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={highlighted ? "var(--brass)" : "var(--text-faint)"}
                  strokeOpacity={highlighted ? 0.8 : 0.4}
                  strokeWidth={highlighted ? 2 : 1.2}
                />
              );
            })}
            {graph.nodes.map(renderNode)}
          </g>
        </svg>

        <div className="absolute right-2 top-2 flex flex-col gap-1.5">
          <button className="life-map-control" onClick={() => zoomButton(1.25)} aria-label="Aproximar"><ZoomIn size={15} /></button>
          <button className="life-map-control" onClick={() => zoomButton(0.8)} aria-label="Afastar"><ZoomOut size={15} /></button>
          <button className="life-map-control" onClick={() => { interactedRef.current = false; fit(); }} aria-label="Centralizar o mapa"><LocateFixed size={15} /></button>
        </div>

        {graph.nodes.length === 1 && (
          <div className="absolute left-3 right-3 bottom-3 surface-2 rounded-xl p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-dim">Seu mapa começa na primeira meta. Crie uma e vincule a ela os hábitos e tarefas que levam até lá.</p>
            <button className="btn-primary rounded-xl px-3 py-2 text-xs shrink-0" onClick={onGoToGoals}>Criar meta</button>
          </div>
        )}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-dim" aria-label="Legenda do mapa">
        <li className="flex items-center gap-1.5"><LegendMark kind="goal" /> Meta (o anel mostra o progresso)</li>
        <li className="flex items-center gap-1.5"><LegendMark kind="habit" /> Hábito</li>
        <li className="flex items-center gap-1.5"><LegendMark kind="task" /> Tarefa</li>
        <li className="flex items-center gap-1.5"><LegendMark kind="habit" done /> Feito</li>
      </ul>

      <div className="surface glass-panel rounded-2xl p-4 md:p-5" aria-live="polite">
        {selected?.kind === "root" && (
          <div>
            <p className="text-[10px] text-brass uppercase tracking-widest">Seu mapa</p>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="surface-2 rounded-xl p-3"><p className="text-[10px] text-faint uppercase tracking-widest">Metas ativas</p><p className="font-display text-2xl mt-1">{activeGoals.length}</p></div>
              <div className="surface-2 rounded-xl p-3"><p className="text-[10px] text-faint uppercase tracking-widest">Concluídas</p><p className="font-display text-2xl mt-1">{goalNodes.length - activeGoals.length}</p></div>
              <div className="surface-2 rounded-xl p-3"><p className="text-[10px] text-faint uppercase tracking-widest">Hábitos sem meta</p><p className="font-display text-2xl mt-1">{unlinkedHabits.length}</p></div>
            </div>
            <p className="text-xs text-faint mt-3">Toque numa meta, hábito ou tarefa para ver os detalhes. Arraste os pontos para reorganizar.</p>
          </div>
        )}

        {selected?.kind === "group" && (
          <div>
            <p className="text-[10px] text-brass uppercase tracking-widest">Sem meta</p>
            <p className="font-display text-xl mt-1">Hábitos que ainda não levam a nenhuma meta</p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {unlinkedHabits.map((habit) => (
                <li key={habit.id} className="flex items-center gap-2 text-sm">
                  <LegendMark kind="habit" done={habit.done} />
                  <span className="min-w-0 truncate">{habit.label}</span>
                  <span className="text-[10px] text-faint shrink-0">{habit.done ? "feito hoje" : "pendente hoje"}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-faint mt-3">Para ligar um hábito a uma meta, edite a meta e marque o hábito em "Relacionados".</p>
          </div>
        )}

        {selected?.kind === "goal" && (() => {
          const leaves = neighbors(selected.id).filter((n) => n.kind === "habit" || n.kind === "task");
          return (
            <div>
              <p className="text-[10px] text-brass uppercase tracking-widest">Meta</p>
              <p className="font-display text-xl mt-1">{selected.label}</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
                  <div className="h-full rounded-full" style={{ width: `${selected.progress}%`, background: "var(--brass)" }} />
                </div>
                <span className="font-mono text-xs text-brass">{selected.progress}%</span>
              </div>
              <p className="text-xs text-faint mt-1.5">{deadlineText(selected)}</p>
              {leaves.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {leaves.map((leaf) => (
                    <li key={leaf.id} className="flex items-center gap-2 text-sm">
                      <LegendMark kind={leaf.kind} done={leaf.done} />
                      <span className={`min-w-0 truncate ${leaf.done ? "text-dim" : ""}`}>{leaf.label}</span>
                      <span className="text-[10px] text-faint shrink-0">{leaf.kind === "habit" ? "hábito" : "tarefa"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-dim mt-3">Nenhum hábito ou tarefa vinculado a esta meta ainda.</p>
              )}
              <button className="btn-primary rounded-xl px-3 py-2 text-xs mt-3 inline-flex items-center gap-1.5" onClick={() => onOpenGoal?.(selected.goalId)}>
                <Target size={13} /> Abrir meta
              </button>
            </div>
          );
        })()}

        {(selected?.kind === "habit" || selected?.kind === "task") && (() => {
          const linkedGoals = neighbors(selected.id).filter((n) => n.kind === "goal");
          return (
            <div>
              <p className="text-[10px] text-brass uppercase tracking-widest">{selected.kind === "habit" ? "Hábito" : "Tarefa"}</p>
              <p className="font-display text-xl mt-1">{selected.label}</p>
              <p className="text-sm text-dim mt-1 flex items-center gap-1.5">
                {selected.done && <Check size={14} className="text-brass" aria-hidden="true" />}
                {selected.kind === "habit"
                  ? (selected.paused ? "Pausado" : selected.done ? "Feito hoje" : "Ainda não feito hoje")
                  : (selected.done ? "Concluída" : "Pendente")}
              </p>
              {linkedGoals.length > 0 && (
                <p className="text-xs text-faint mt-2">Leva você a: {linkedGoals.map((g) => g.label).join(" · ")}</p>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
