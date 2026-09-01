import React, { useEffect, useId, useRef } from "react";
import { Lock, X } from "lucide-react";
import { PRO_FEATURE_COPY } from "../lib/plans.js";

export function Progress({ value, height = 8, tone = "fill" }) {
  return (
    <div className="track w-full" style={{ height }}>
      <div
        className={tone === "moss" ? "fill-moss h-full" : "fill h-full"}
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

export function StatMini({ label, value }) {
  return (
    <div className="surface rounded-2xl p-4">
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
