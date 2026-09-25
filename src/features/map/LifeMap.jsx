import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, LocateFixed, Target, ZoomIn, ZoomOut } from "lucide-react";
import { LIFE_AREAS, buildLifeGraph, initLayout, stepLayout, layoutBounds, NODE_RADIUS } from "../../lib/lifeMap.js";
import { daysUntil } from "../../lib/goalForecast.js";

// Mapa da vida: grafo com física (os nós se acomodam sozinhos), arrastável,
// com zoom por pinça/roda e pan. A lógica (grafo + física) está em
// src/lib/lifeMap.js; aqui só animação, gestos e desenho.

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.6;
const TAP_SLOP = 6;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Rótulo em até 2 linhas de ~16 caracteres.
function wrapLabel(text, max = 16) {
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

// Pontinhos decorativos (como estrelas) em posições fixas do "mundo".
const STARS = Array.from({ length: 28 }, (_, i) => ({
  x: Math.cos(i * 2.39996) * (140 + ((i * 97) % 520)),
  y: Math.sin(i * 2.39996) * (140 + ((i * 53) % 480)),
  r: 1.2 + (i % 3) * 0.7,
  delay: (i % 7) * 0.9,
}));

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
  const fittedRef = useRef(false);
  // Depois que o usuário mexe (arrasta, dá zoom), o mapa não se reenquadra sozinho.
  const interactedRef = useRef(false);
  const fitRef = useRef(() => {});
  const [, setFrame] = useState(0);
  // Tamanho real só chega pelo ResizeObserver; antes disso não enquadra.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ x: 180, y: 240, k: 0.8 });
  const [selectedId, setSelectedId] = useState("root");

  const fit = useCallback(() => {
    const bounds = layoutBounds(graph, posRef.current);
    if (!Number.isFinite(bounds.width) || !size.width) return;
    const k = Math.max(MIN_ZOOM, Math.min(1.3, Math.min(size.width / bounds.width, size.height / bounds.height) * 0.94));
    const next = {
      x: size.width / 2 - (bounds.minX + bounds.width / 2) * k,
      y: size.height / 2 - (bounds.minY + bounds.height / 2) * k,
      k,
    };
    setView(next);
  }, [graph, size]);
  fitRef.current = fit;

  // Loop da simulação: roda enquanto há energia; arrastar reaquece.
  const run = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (prefersReducedMotion()) {
      for (let i = 0; i < 320; i += 1) stepLayout(graph, posRef.current, { alpha: Math.max(0.02, 1 - i / 260) });
      alphaRef.current = 0;
      setFrame((f) => f + 1);
      return;
    }
    const tick = () => {
      const energy = stepLayout(graph, posRef.current, { alpha: alphaRef.current, pinned: pinnedRef.current });
      alphaRef.current = Math.max(0, alphaRef.current * 0.982);
      setFrame((f) => f + 1);
      if (pinnedRef.current || alphaRef.current > 0.015 || energy > 0.35) rafRef.current = requestAnimationFrame(tick);
      else if (!interactedRef.current) fitRef.current(); // assentou: enquadra o resultado final
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [graph]);

  useEffect(() => {
    posRef.current = initLayout(graph, posRef.current);
    alphaRef.current = fittedRef.current ? 0.45 : 1;
    run();
    return () => cancelAnimationFrame(rafRef.current);
  }, [graph, run]);

  // Tamanho do container → primeiro enquadramento.
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
  // Enquadra pela posição que a física vai atingir — na primeira medida e a
  // cada mudança de tamanho (girar o celular, redimensionar), até o usuário mexer.
  useEffect(() => {
    if (size.width < 50 || interactedRef.current) return;
    // Enquadra pela posição que a física vai atingir (simulação rápida numa cópia).
    const probe = JSON.parse(JSON.stringify(posRef.current));
    for (let i = 0; i < 260; i += 1) stepLayout(graph, probe, { alpha: Math.max(0.02, 1 - i / 220) });
    const bounds = layoutBounds(graph, probe);
    const k = Math.max(MIN_ZOOM, Math.min(1.3, Math.min(size.width / bounds.width, size.height / bounds.height) * 0.94));
    setView({ x: size.width / 2 - (bounds.minX + bounds.width / 2) * k, y: size.height / 2 - (bounds.minY + bounds.height / 2) * k, k });
    fittedRef.current = true;
  }, [size, graph]);

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

  // Roda do mouse / pinça do trackpad (precisa de listener não-passivo).
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
    svgRef.current.setPointerCapture?.(event.pointerId);
    if (g.pointers.size === 2) {
      // Segundo dedo: vira pinça (cancela arrasto de nó).
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
    if (g.start && !g.moved && g.start.nodeId) setSelectedId(g.start.nodeId);
    else if (g.start && !g.moved && !g.start.nodeId) setSelectedId("root");
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

  const goals_ = graph.nodes.filter((n) => n.kind === "goal");
  const activeGoals = goals_.filter((n) => !n.completed);
  const avgProgress = activeGoals.length ? Math.round(activeGoals.reduce((s, n) => s + n.progress, 0) / activeGoals.length) : 0;
  const pos = posRef.current;

  const renderNode = (node, index) => {
    const p = pos[node.id];
    if (!p) return null;
    const r = NODE_RADIUS[node.kind];
    const isSelected = selected?.id === node.id;
    const lines = wrapLabel(node.label, node.kind === "habit" || node.kind === "task" ? 15 : 17);
    const circumference = 2 * Math.PI * (r + 0.5);
    const labelSize = node.kind === "root" ? 13 : node.kind === "area" ? 12 : node.kind === "goal" ? 11 : 10;
    const strong = node.kind === "root" || node.kind === "area";
    const ariaState = node.kind === "goal" ? `${node.progress}% concluída` : node.kind === "habit" || node.kind === "task" ? (node.done ? "feito" : "pendente") : "";
    return (
      <g
        key={node.id}
        transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
        className="life-node"
        role="button"
        tabIndex={0}
        aria-label={`${node.label}${ariaState ? `, ${ariaState}` : ""}`}
        aria-pressed={isSelected}
        onPointerDown={(event) => onPointerDown(event, node.id)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); } }}
      >
        <g className="life-node-float" style={{ animationDelay: `${(index % 9) * -0.7}s` }}>
          <circle r={r + 10} fill="transparent" />
          {isSelected && <circle r={r + 6} fill="none" stroke="var(--brass)" strokeOpacity="0.55" strokeWidth="1.5" />}

          {node.kind === "root" && (
            <>
              <circle r={r + 5} fill="none" stroke="var(--brass)" strokeOpacity="0.25" />
              <circle r={r} fill="var(--surface-2)" stroke="var(--brass)" strokeWidth="2" />
              <circle r={r * 0.34} fill="var(--brass)" fillOpacity="0.2" />
            </>
          )}
          {node.kind === "area" && <circle r={r} fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1.5" />}
          {node.kind === "goal" && (
            <>
              <circle r={r} fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2.5" />
              <circle
                r={r + 0.5}
                fill="none"
                stroke="var(--brass)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${(circumference * node.progress) / 100} ${circumference}`}
                transform="rotate(-90)"
              />
              {node.completed && <path d="M-6 0.5 L-2 4.5 L6.5 -4.5" fill="none" stroke="var(--brass)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
            </>
          )}
          {(node.kind === "habit" || node.kind === "task") && (
            node.done ? (
              <>
                <circle r={r} fill="var(--brass)" />
                <path d="M-3.4 0.2 L-1.1 2.6 L3.6 -2.4" fill="none" stroke="var(--brass-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : (
              <>
                <circle r={r} fill="var(--surface-2)" stroke="var(--brass)" strokeOpacity={node.paused ? 0.35 : 0.8} strokeWidth="1.5" />
                <circle r={node.kind === "task" ? 1.8 : 2.6} fill="var(--brass)" fillOpacity={node.paused ? 0.35 : 0.9} />
              </>
            )
          )}

          {lines.map((line, i) => (
            <text
              key={i}
              y={r + 14 + i * (labelSize + 2)}
              textAnchor="middle"
              fontSize={labelSize}
              fontWeight={strong ? 600 : 400}
              fill={strong ? "var(--text)" : "var(--text-dim)"}
              className="life-node-label"
            >
              {line}
            </text>
          ))}
        </g>
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
          aria-label="Mapa da sua vida: áreas, metas, hábitos e tarefas. Arraste para mover, use os botões ou a pinça para zoom."
        >
          <g className="life-map-world" transform={`translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(3)})`}>
            {STARS.map((s, i) => (
              <circle key={`s${i}`} cx={s.x} cy={s.y} r={s.r} fill="var(--text)" className="life-star" style={{ animationDelay: `${s.delay}s` }} />
            ))}
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
                  strokeOpacity={highlighted ? 0.7 : 0.35}
                  strokeWidth={highlighted ? 1.6 : 1}
                />
              );
            })}
            {graph.nodes.map(renderNode)}
          </g>
        </svg>

        <div className="absolute right-2 top-2 flex flex-col gap-1.5">
          <button className="life-map-control" onClick={() => zoomButton(1.25)} aria-label="Aproximar"><ZoomIn size={15} /></button>
          <button className="life-map-control" onClick={() => zoomButton(0.8)} aria-label="Afastar"><ZoomOut size={15} /></button>
          <button className="life-map-control" onClick={() => fit()} aria-label="Centralizar o mapa"><LocateFixed size={15} /></button>
        </div>

        {!goals_.length && (
          <div className="absolute left-3 right-3 bottom-3 surface-2 rounded-xl p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-dim">Seu mapa cresce com suas metas. Crie uma e escolha a área da vida dela.</p>
            <button className="btn-primary rounded-xl px-3 py-2 text-xs shrink-0" onClick={onGoToGoals}>Criar meta</button>
          </div>
        )}
      </div>

      <div className="surface glass-panel rounded-2xl p-4 md:p-5" aria-live="polite">
        {selected?.kind === "root" && (
          <div>
            <p className="text-[10px] text-brass uppercase tracking-widest">Minha evolução</p>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="surface-2 rounded-xl p-3"><p className="text-[10px] text-faint uppercase tracking-widest">Ativas</p><p className="font-display text-2xl mt-1">{activeGoals.length}</p></div>
              <div className="surface-2 rounded-xl p-3"><p className="text-[10px] text-faint uppercase tracking-widest">Concluídas</p><p className="font-display text-2xl mt-1">{goals_.length - activeGoals.length}</p></div>
              <div className="surface-2 rounded-xl p-3"><p className="text-[10px] text-faint uppercase tracking-widest">Média</p><p className="font-display text-2xl mt-1">{avgProgress}%</p></div>
            </div>
            <p className="text-xs text-faint mt-3">Toque numa área, meta, hábito ou tarefa para ver os detalhes. Arraste os pontos para reorganizar.</p>
          </div>
        )}

        {selected?.kind === "area" && (() => {
          const areaGoals = neighbors(selected.id).filter((n) => n.kind === "goal");
          return (
            <div>
              <p className="text-[10px] text-brass uppercase tracking-widest">Área da vida</p>
              <p className="font-display text-xl mt-1">{selected.label}</p>
              {areaGoals.length ? (
                <ul className="mt-3 flex flex-col gap-2">
                  {areaGoals.map((goal) => (
                    <li key={goal.id}>
                      <button className="w-full text-left surface-2 interactive rounded-xl px-3 py-2 flex items-center justify-between gap-3" onClick={() => setSelectedId(goal.id)}>
                        <span className="text-sm min-w-0 truncate">{goal.label}</span>
                        <span className="font-mono text-xs text-brass shrink-0">{goal.progress}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-dim">Nenhuma meta em {selected.label} ainda.</p>
                  <button className="btn-ghost rounded-xl px-3 py-2 text-xs shrink-0" onClick={onGoToGoals}>Criar meta</button>
                </div>
              )}
            </div>
          );
        })()}

        {selected?.kind === "goal" && (() => {
          const leaves = neighbors(selected.id).filter((n) => n.kind === "habit" || n.kind === "task");
          const left = selected.endDate ? daysUntil(selected.endDate) : null;
          const area = LIFE_AREAS.find((a) => a.id === selected.areaId);
          return (
            <div>
              <p className="text-[10px] text-brass uppercase tracking-widest">Meta · {area?.label}</p>
              <p className="font-display text-xl mt-1">{selected.label}</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
                  <div className="h-full rounded-full" style={{ width: `${selected.progress}%`, background: "var(--brass)" }} />
                </div>
                <span className="font-mono text-xs text-brass">{selected.progress}%</span>
              </div>
              <p className="text-xs text-faint mt-1.5">
                {selected.completed ? "Concluída" : left === null ? "Sem prazo" : left >= 0 ? `Faltam ${left} dia${left === 1 ? "" : "s"}` : "Prazo encerrado"}
              </p>
              {leaves.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {leaves.map((leaf) => (
                    <li key={leaf.id} className="flex items-center gap-2 text-sm">
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${leaf.done ? "bg-brass" : ""}`} style={leaf.done ? {} : { border: "1.5px solid var(--brass-dim)" }}>
                        {leaf.done && <Check size={10} style={{ color: "var(--brass-ink)" }} />}
                      </span>
                      <span className={`min-w-0 truncate ${leaf.done ? "text-dim" : ""}`}>{leaf.label}</span>
                      <span className="text-[10px] text-faint shrink-0">{leaf.kind === "habit" ? "hábito" : "tarefa"}</span>
                    </li>
                  ))}
                </ul>
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
              <p className="text-sm text-dim mt-1">
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
