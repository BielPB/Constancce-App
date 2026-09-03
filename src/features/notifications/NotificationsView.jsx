import React from "react";
import { Bell, X, Check } from "lucide-react";
import { EmptyState, ProBadge } from "../../components/ui.jsx";

export default function NotificationsView({
  items,
  profile,
  setProfile,
  notificationPermission,
  pushEnabled,
  pushSupported,
  notificationBusy,
  onEnableNotifications,
  onDisableNotifications,
  isPro,
  onUpgrade,
}) {
  const settings = profile?.notificationSettings || {
    habits: true,
    tasks: true,
    workouts: true,
    goals: true,
    finance: true,
    reminderIntensity: "persistent",
  };
  const reminderIntensity = settings.reminderIntensity || "persistent";

  const setSetting = (key, val) =>
    setProfile((p) => ({
      ...p,
      notificationSettings: {
        ...(p.notificationSettings || settings),
        [key]: val,
      },
    }));

  const visible = items.filter((n) => settings[n.category] !== false);

  const permissionLabel =
    notificationPermission === "granted"
      ? "Permitido"
      : notificationPermission === "denied"
        ? "Bloqueado pelo navegador"
        : "Ainda não permitido";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-2xl">Notificações</h2>
        <p className="text-dim text-sm mt-1">Receba lembretes da sua rotina no celular ou computador.</p>
      </div>

      <div className="surface rounded-2xl p-5" style={{ borderColor: pushEnabled ? "var(--brass-dim)" : "var(--border)" }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <Bell size={18} className={pushEnabled ? "text-brass" : "text-dim"} />
            </div>
            <div>
              <p className="text-xs text-faint uppercase tracking-widest">Notificações do dispositivo</p>
              <p className="text-sm mt-1">
                {pushEnabled
                  ? "Ativas neste dispositivo"
                  : notificationPermission === "granted"
                    ? "Permissão concedida · conclua a ativação"
                    : "Ative para receber seus lembretes"}
              </p>
              <p className="text-[11px] text-faint mt-1">Permissão: {permissionLabel}</p>
            </div>
          </div>

          {pushEnabled && <span className="chip text-[10px] text-moss shrink-0">Ativas</span>}
        </div>

        {!pushSupported ? (
          <div className="rounded-xl px-3 py-2.5 text-xs text-dim" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            Este navegador não oferece suporte a notificações push. Em iPhone/iPad, instale o Constancce na Tela de Início para usar notificações.
          </div>
        ) : notificationPermission === "denied" ? (
          <div className="rounded-xl px-3 py-2.5 text-xs text-dim" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            As notificações foram bloqueadas. Abra as configurações do navegador/site e permita notificações para o Constancce.
          </div>
        ) : !pushEnabled ? (
          <button
            disabled={notificationBusy}
            onClick={onEnableNotifications}
            className="btn-primary w-full rounded-xl py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Bell size={15} />
            {notificationBusy
              ? "Ativando…"
              : notificationPermission === "granted"
                ? "Concluir ativação"
                : "Ativar notificações"}
          </button>
        ) : (
          <button
            disabled={notificationBusy}
            onClick={onDisableNotifications}
            className="btn-ghost w-full rounded-xl py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <X size={14} />
            {notificationBusy ? "Desativando…" : "Desativar neste dispositivo"}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && <EmptyState icon={Bell} title="Tudo em dia." hint="Nenhum aviso no momento. Continue assim." />}
        {visible.map((n, i) => (
          <div key={i} className="surface rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              {n.icon}
            </div>
            <p className="text-sm">{n.message}</p>
          </div>
        ))}
      </div>

      <div className="surface rounded-2xl p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-1">Avisos por categoria</p>
        <p className="text-dim text-xs mb-4">Escolha quais tipos de lembretes o Constancce pode enviar.</p>

        <div className="flex flex-col gap-3">
          {[
            ["habits", "Hábitos", false],
            ["tasks", "Tarefas", false],
            ["workouts", "Treinos", false],
            ["goals", "Metas", false],
            ["finance", "Finanças", false],
          ].map(([key, label, proOnly]) => (
            <div key={key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                {label}
                {proOnly && !isPro && <ProBadge compact />}
              </span>
              <button
                onClick={() => {
                  if (proOnly && !isPro) {
                    onUpgrade("notifications");
                    return;
                  }
                  setSetting(key, settings[key] === false);
                }}
                className="w-11 h-6 rounded-full relative shrink-0"
                style={{ background: proOnly && !isPro ? "var(--border)" : settings[key] !== false ? "var(--brass)" : "var(--border)" }}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                  style={{ left: proOnly && !isPro ? 2 : settings[key] !== false ? 22 : 2 }}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="surface rounded-2xl p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-1">Automações</p>
        <p className="text-dim text-xs mb-4">Rotinas automáticas que não dependem de uma categoria específica.</p>

        <div className="flex flex-col gap-3">
          {[
            ["hourlyReminders", "Resumo a cada hora", true],
            ["weeklyReview", "Revisão semanal", true],
          ].map(([key, label, proOnly]) => (
            <div key={key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                {label}
                {proOnly && !isPro && <ProBadge compact />}
              </span>
              <button
                onClick={() => {
                  if (proOnly && !isPro) {
                    onUpgrade("notifications");
                    return;
                  }
                  setSetting(key, settings[key] === false);
                }}
                className="w-11 h-6 rounded-full relative shrink-0"
                style={{ background: proOnly && !isPro ? "var(--border)" : settings[key] !== false ? "var(--brass)" : "var(--border)" }}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                  style={{ left: proOnly && !isPro ? 2 : settings[key] !== false ? 22 : 2 }}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="surface rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-xs text-faint uppercase tracking-widest">Intensidade dos lembretes</p>
            <p className="text-dim text-xs mt-1">Controle o quanto o Constancce insiste em tarefas atrasadas.</p>
          </div>
          {!isPro && <ProBadge compact />}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            ["discreet", "Discreto", "Sem repetição horária."],
            ["balanced", "Equilibrado", "Relembra a cada 2 horas."],
            ["persistent", "Persistente", "Relembra a cada 1 hora."],
          ].map(([id, label, description]) => (
            <button
              key={id}
              type="button"
              className="surface-2 rounded-xl p-3 text-left"
              onClick={() => {
                if (!isPro) {
                  onUpgrade("notifications");
                  return;
                }
                setSetting("reminderIntensity", id);
              }}
              style={{
                borderColor: reminderIntensity === id ? "var(--brass)" : "var(--border-soft)",
                background: reminderIntensity === id
                  ? "color-mix(in srgb, var(--brass) 7%, var(--surface-2))"
                  : undefined,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-medium ${reminderIntensity === id ? "text-brass" : ""}`}>{label}</span>
                {reminderIntensity === id && <Check size={13} className="text-brass" />}
              </div>
              <p className="text-[10px] text-faint mt-1">{description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="surface rounded-2xl p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-2">Lembretes automáticos</p>
        <div className="text-xs text-dim leading-relaxed flex flex-col gap-1.5">
          <p>• Tarefas: lembrete automático 30 minutos antes, com horário, prioridade e detalhes cadastrados.</p>
          <p>• Ações rápidas para concluir ou adiar tarefas.</p>
          <p>• Tarefas sem horário e tarefas atrasadas.</p>
          <p>• Hábitos ainda pendentes no fim do dia.</p>
          <p>• Treino ainda não concluído.</p>
          <p>• Metas próximas da data final.</p>
          <p>• Contas próximas do vencimento e limite financeiro ultrapassado.</p>
          <p>• O lembrete de 30 minutos das tarefas também funciona no plano Free.</p>
          <p className={!isPro ? "text-faint" : ""}>• Resumos entre 8h e 22h, repetição de tarefas atrasadas e automações avançadas {isPro ? "ativos no PRO." : "— PRO."}</p>
          <p className={!isPro ? "text-faint" : ""}>• Revisão semanal automática aos domingos {isPro ? "" : "— PRO."}</p>
        </div>
      </div>
    </div>
  );
}
