import React, { useEffect, useId, useRef, useState, useCallback } from "react";
import { Lock, X, Sparkles } from "lucide-react";
import { PRO_FEATURE_COPY } from "../lib/plans.js";

// Cada tela remonta o FirstVisitTip ao trocar de aba (o wrapper usa
// key={view}), então o estado "visto" tem que sobreviver a isso mesmo
// quando o localStorage falha silenciosamente (modo privado, quota cheia,
// partição de storage no navegador) — sem isso, "Entendi" clicado nessas
// condições faz a dica sumir na hora e voltar assim que a tela é reaberta.
const dismissedFirstVisitTips = new Set();

export function FirstVisitTip({ id, icon: Icon = Sparkles, title, children }) {
  const storageKey = `constancce_first_visit_tip_${id}`;
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    if (dismissedFirstVisitTips.has(storageKey)) return false;
    try { return localStorage.getItem(storageKey) !== "seen"; } catch (_) { return true; }
  });

  if (!visible) return null;

  const dismiss = () => {
    dismissedFirstVisitTips.add(storageKey);
    try { localStorage.setItem(storageKey, "seen"); } catch (_) {}
    setVisible(false);
  };

  return (
    <div className="surface-2 rounded-2xl p-4 flex items-start gap-3" style={{ borderColor: "var(--brass-dim)" }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--brass) 12%, var(--surface))" }}>
        <Icon size={17} className="text-brass" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-brass uppercase tracking-widest">Primeira vez aqui?</p>
        <p className="font-medium text-sm mt-0.5">{title}</p>
        <p className="text-xs text-dim leading-relaxed mt-1">{children}</p>
      </div>
      <button type="button" className="btn-ghost rounded-lg px-2.5 py-1.5 text-[10px] shrink-0" onClick={dismiss}>Entendi</button>
    </div>
  );
}

// Substitui window.confirm por um Modal próprio do app (o nativo do navegador
// quebra a identidade visual). Uso: const [confirm, confirmDialog] = useConfirm();
// depois `if (!(await confirm("mensagem"))) return;` e renderizar {confirmDialog}.
export function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback((message, options = {}) => (
    new Promise((resolve) => setState({ message, resolve, ...options }))
  ), []);

  const dialog = state ? (
    <Modal
      title={state.title || "Confirmar ação"}
      onClose={() => { state.resolve(false); setState(null); }}
      width={400}
    >
      <p className="text-sm text-dim leading-relaxed">{state.message}</p>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <button
          type="button"
          className="btn-ghost rounded-xl py-2.5 text-sm"
          onClick={() => { state.resolve(false); setState(null); }}
        >
          {state.cancelLabel || "Cancelar"}
        </button>
        <button
          type="button"
          className={`rounded-xl py-2.5 text-sm font-medium ${state.danger === false ? "btn-primary" : "btn-ghost text-ember"}`}
          onClick={() => { state.resolve(true); setState(null); }}
        >
          {state.confirmLabel || (state.danger === false ? "Confirmar" : "Excluir")}
        </button>
      </div>
    </Modal>
  ) : null;

  return [confirm, dialog];
}

// Substitui window.prompt por um Modal próprio do app, mesma ideia do useConfirm.
export function usePrompt() {
  const [state, setState] = useState(null);
  const [value, setValue] = useState("");

  const promptFor = useCallback((message, defaultValue = "") => (
    new Promise((resolve) => { setValue(defaultValue); setState({ message, resolve }); })
  ), []);

  const dialog = state ? (
    <Modal
      title="Confirmar"
      onClose={() => { state.resolve(null); setState(null); }}
      width={380}
    >
      <p className="text-sm text-dim mb-2">{state.message}</p>
      <input
        autoFocus
        className="w-full p-2.5 ring-focus"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { state.resolve(value); setState(null); }
        }}
      />
      <div className="grid grid-cols-2 gap-2 mt-4">
        <button
          type="button"
          className="btn-ghost rounded-xl py-2.5 text-sm"
          onClick={() => { state.resolve(null); setState(null); }}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary rounded-xl py-2.5 text-sm font-medium"
          onClick={() => { state.resolve(value); setState(null); }}
        >
          OK
        </button>
      </div>
    </Modal>
  ) : null;

  return [promptFor, dialog];
}

export function Progress({ value, height = 8, tone = "fill" }) {
  return (
    <div className="track w-full" style={{ height }}>
      <div
        className={tone === "brass" ? "fill-brass h-full" : "fill h-full"}
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          transition: "width 320ms ease",
        }}
      />
    </div>
  );
}

export function Modal({ title, onClose, children, width = 460 }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  // onClose costuma ser uma função inline. Guardá-la em ref impede que o
  // gerenciamento de foco do modal seja desmontado/remontado em cada render.
  onCloseRef.current = onClose;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const body = document.body;
    const html = document.documentElement;
    const appMain = document.querySelector(".app-main");
    const scrollY = window.scrollY || html.scrollTop || 0;
    const previousActive = document.activeElement;

    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverscroll: html.style.overscrollBehavior,
      appMainOverflow: appMain?.style?.overflowY || "",
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overscrollBehavior = "none";
    html.style.overscrollBehavior = "none";
    if (appMain?.style) appMain.style.overflowY = "hidden";

    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusInitial = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const first = dialog?.querySelector?.(focusableSelector);
      (first || closeRef.current || dialog)?.focus?.({ preventScroll: true });
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)]
        .filter((element) => element.offsetParent !== null);

      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      if (appMain?.style) appMain.style.overflowY = previous.appMainOverflow;
      window.scrollTo(0, scrollY);
      previousActive?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="fixed inset-0 modal-backdrop modal-scroll-lock flex items-end md:items-center justify-center z-50 p-0 md:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="modal-sheet surface rise w-full md:rounded-2xl rounded-t-2xl p-5 overflow-y-auto scrollbar-none"
        style={{ maxWidth: width }}
        onClick={(event) => event.stopPropagation()}
        data-no-swipe
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-sheet-header flex items-center justify-between mb-4">
          <h3 id={titleId} className="font-display text-xl" style={{ fontWeight: 600 }}>{title}</h3>
          <button
            ref={closeRef}
            onClick={onClose}
            className="btn-ghost rounded-full p-2.5"
            aria-label={`Fechar ${title || "janela"}`}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label className="text-xs text-dim block mb-1">{label}</label>
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="surface rounded-2xl p-8 flex flex-col items-center text-center gap-2">
      <Icon size={28} className="text-faint" />
      <p className="font-display text-lg">{title}</p>
      <p className="text-dim text-sm max-w-xs">{hint}</p>
      {action}
    </div>
  );
}

export function StatMini({ label, value, title }) {
  return (
    <div className="surface rounded-2xl p-4" title={title}>
      <p className="text-faint text-xs mb-1">{label}</p>
      <p className="font-mono text-xl">{value}</p>
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      className="fixed bottom-24 md:bottom-8 left-1/2 toast-in z-50"
      style={{ transform: "translateX(-50%)" }}
    >
      <div className="surface rounded-full px-5 py-3 flex items-center gap-2 shadow-lg" style={{ borderColor: "var(--brass)" }}>
        {toast.icon}
        <span className="text-sm font-medium">{toast.message}</span>
      </div>
    </div>
  );
}

export function ProBadge({ compact = false }) {
  return (
    <span className={`pro-badge ${compact ? "pro-badge-compact" : ""}`}>
      <Lock size={compact ? 9 : 10} /> PRO
    </span>
  );
}

export function ProLockCard({ feature, title, description, onUpgrade, compact = false }) {
  const copy = PRO_FEATURE_COPY[feature] || [
    title || "Recurso PRO",
    description || "Disponível no Constancce PRO.",
  ];

  return (
    <div className={`pro-lock-card surface-2 rounded-2xl ${compact ? "p-3" : "p-4 md:p-5"}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <Lock size={15} className="text-brass" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-sm md:text-base">{title || copy[0]}</p>
            <ProBadge compact />
          </div>
          <p className="text-[10px] md:text-xs text-dim mt-1 leading-relaxed">{description || copy[1]}</p>
          {onUpgrade && (
            <button className="text-xs text-brass font-medium mt-2" onClick={() => onUpgrade(feature)}>
              Conhecer o PRO
            </button>
          )}
        </div>
      </div>
    </div>
  );
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

export function MiniLineChart({ data, height = 150, color = "var(--brass)" }) {
  const gradientId = useId();
  const vals = data.map((item) => Number(item.value) || 0);
  const w = 600;
  const h = height;
  const padX = 22;
  const padY = 18;
  // Forçar o teto em pelo menos 1 e o piso em no máximo 0 fazia uma série
  // 100% negativa (ex.: saldo sempre no vermelho) desenhar espremida perto do
  // fundo do gráfico, reservando espaço vertical inútil até 0/+1. O range
  // abaixo já protege contra altura zero quando todos os valores são iguais.
  const max = Math.max(...vals);
  const min = Math.min(...vals);
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
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Gráfico de evolução">
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

export function ConsistencyHeatmap({ days }) {
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

export function RadialProgress({ value = 0, size = 132, strokeWidth = 10, label, color = "var(--brass)" }) {
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
