import { createClient as createSupabaseRealtimeClient } from "@supabase/supabase-js";
import React, { useState, useEffect, useMemo, useCallback, useRef, useId, lazy, Suspense } from "react";
import { DATA_SCHEMA_VERSION, migrateUserData } from "./src/lib/schema.js";
import { DOMAIN_FIELDS, mergeDomainRows, pickDataForKeys, mergePendingPayload, mergeRemoteWithPending } from "./src/lib/syncDomains.js";
import { mergePendingPayloadV3, mergeRemoteWithPendingV3, rebasePendingV3, newMutationId, mergeEntityArray3Way } from "./src/lib/syncV3.js";
import { compactTaskOutbox, applyTaskOutbox, makeTaskUpsert, makeTaskDelete } from "./src/lib/taskSyncV6.js";
import { ROUTINE_COLLECTIONS, ROUTINE_FIELDS, compactRoutineOutbox, buildRoutineOps, routineFieldsFromRows, applyRoutineOutbox, mergeRoutineBootstrap } from "./src/lib/routineSyncV1.js";
import { captureClientError, consumeQueuedErrors, sendTelemetry, analyticsEvent } from "./src/lib/observability.js";
import { ErrorBoundary } from "./src/components/ErrorBoundary.jsx";
import { useConstancceData } from "./src/hooks/useConstancceData.js";
import { useWorkoutRestTimer } from "./src/hooks/useWorkoutRestTimer.js";
import { computeUsageStreaks, normalizeUsageDays } from "./src/lib/usageStreak.js";
import { PRO_LIMITS, PRO_FEATURE_COPY, accessSummary } from "./src/lib/plans.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, authHeaders, rpcRequest } from "./src/lib/supabaseRpc.js";
import { fetchProfessionalLinks, sendPrescription, fetchPrescriptions } from "./src/lib/professionalLinks.js";
import { DIET_FOOD_BASE } from "./src/data/dietFoodBase.js";
import { Progress, Modal, Field, EmptyState, StatMini, Toast, ProBadge, ProLockCard } from "./src/components/ui.jsx";
import {
  Flame, CheckCircle2, Circle, Plus, X, Calendar as CalendarIcon,
  Target, Trophy, User, LayoutGrid, ListChecks, ChevronLeft, ChevronRight,
  Pencil, Trash2, Copy, GripVertical, ChevronUp, ChevronDown, Pause, Play, Sun, Moon, Monitor, TrendingUp, Award,
  Dumbbell, Apple, Wallet, Bell, FileBarChart, MoreHorizontal, ArrowUpRight,
  ArrowDownRight, Minus, Download, Upload, ShieldCheck, LogOut, Mail, Lock, Eye, EyeOff, Camera, Users, UserPlus, Swords, RefreshCw, Check,
  Search, Clock3, Timer, Sparkles, History, Zap, SlidersHorizontal, RotateCcw, CreditCard, Repeat2,
  Palette, Share2, Archive, Image as ImageIcon,
  Activity, Layers3, Grid3X3, BrainCircuit, Star, ArrowRightLeft, Gauge, Stethoscope,
} from "lucide-react";

const NotificationsView = lazy(() => import("./src/features/notifications/NotificationsView.jsx"));
const ReportsView = lazy(() => import("./src/features/reports/ReportsView.jsx"));
const ProfessionalView = lazy(() => import("./src/features/professional/ProfessionalView.jsx"));



const constancceLogo = "/constancce-logo.png";

function FirstVisitTip({ id, icon: Icon = Sparkles, title, children }) {
  const storageKey = `constancce_first_visit_tip_${id}`;
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(storageKey) !== "seen"; } catch (_) { return true; }
  });

  if (!visible) return null;

  const dismiss = () => {
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
function useConfirm() {
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
function usePrompt() {
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


/* ---------------------------------------------------------------
   AUTENTICAÇÃO + ARMAZENAMENTO POR CONTA
----------------------------------------------------------------*/
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const LEGACY_DATA_KEY = "constancia_local_data";
const AUTH_SESSION_KEY = "constancia_auth_session";

function userDataKey(userId) { return `constancia_user_data_${userId}`; }
function recoveryDataKey(userId) { return `constancce_recovery_snapshots_${userId}`; }
function pendingSyncDataKey(userId) { return `constancce_pending_sync_${userId}`; }
function taskOutboxDataKey(userId) { return `constancce_task_outbox_v6_${userId}`; }
function routineOutboxDataKey(userId) { return `constancce_routine_outbox_v1_${userId}`; }
function routineMigrationKey(userId) { return `constancce_routine_migrated_v1_${userId}`; }
function legacyPendingTaskSyncDataKey(userId) { return `constancce_pending_task_sync_v5_${userId}`; }
function syncClientIdKey(userId) { return `constancce_sync_client_id_${userId}`; }
function getSyncClientId(userId) {
  if (!userId) return "unknown-client";
  try {
    const existing = localStorage.getItem(syncClientIdKey(userId));
    if (existing) return existing;
    const created = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(syncClientIdKey(userId), created);
    return created;
  } catch (_) {
    return `volatile-${userId}`;
  }
}

function loadRecoverySnapshots(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(recoveryDataKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveRecoverySnapshot(userId, payload) {
  if (!userId || !payload) return;
  try {
    const date = today();
    const existing = loadRecoverySnapshots(userId).filter((item) => item.date !== date);
    const safeProfile = payload.profile ? { ...payload.profile, avatarDataUrl: null } : payload.profile;
    const snapshot = {
      id: `${date}-${Date.now()}`,
      date,
      createdAt: new Date().toISOString(),
      data: { ...payload, profile: safeProfile },
    };
    localStorage.setItem(recoveryDataKey(userId), JSON.stringify([snapshot, ...existing].slice(0, 3)));
  } catch (_) {
    // Snapshots são uma camada extra; falha de espaço não interfere no autosave principal.
  }
}

function loadPendingSync(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(pendingSyncDataKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !Array.isArray(parsed?.changedKeys) || !parsed.changedKeys.length) return null;

    // 1.1.25: Tarefas não pertencem mais à fila genérica/domain-sync.
    // Remove resíduos de versões 1.1.20–1.1.24 que poderiam manter o Perfil
    // eternamente em “Falha de sincronização”.
    const changedKeys = parsed.changedKeys.filter((key) => key !== "tasks");
    if (!changedKeys.length) {
      localStorage.removeItem(pendingSyncDataKey(userId));
      return null;
    }
    const data = pickDataForKeys(parsed.data, changedKeys);
    const baseData = {};
    for (const key of changedKeys) {
      if (Object.prototype.hasOwnProperty.call(parsed.baseData || {}, key)) baseData[key] = parsed.baseData[key];
    }
    return {
      ...parsed,
      data,
      changedKeys,
      baseData,
      baseFieldRevisions: parsed.baseFieldRevisions || {},
      mutationId: parsed.mutationId || newMutationId(),
      taskOps: [],
    };
  } catch (e) {
    captureClientError(e, { module: "storage", action: "loadPendingSync" });
    return null;
  }
}

function savePendingSync(userId, pending) {
  if (!userId || !pending?.data || !pending?.changedKeys?.length) return;
  try {
    const keys = [...new Set(pending.changedKeys)];
    const compactData = pickDataForKeys(pending.data, keys);
    const compactBase = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(pending?.baseData || {}, key)) compactBase[key] = pending.baseData[key];
    }
    localStorage.setItem(pendingSyncDataKey(userId), JSON.stringify({
      data: compactData,
      changedKeys: keys,
      baseData: compactBase,
      baseFieldRevisions: pending?.baseFieldRevisions || {},
      mutationId: pending?.mutationId || newMutationId(),
      queuedAt: pending?.queuedAt || new Date().toISOString(),
      taskOps: [],
      savedAt: new Date().toISOString(),
    }));
  } catch (e) {
    captureClientError(e, { module: "storage", action: "savePendingSync" });
  }
}

function clearPendingSync(userId) {
  if (!userId) return;
  try { localStorage.removeItem(pendingSyncDataKey(userId)); } catch (_) {}
}

function loadTaskOutbox(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(taskOutboxDataKey(userId));
    if (!raw) return [];
    return compactTaskOutbox(JSON.parse(raw));
  } catch (e) {
    captureClientError(e, { module: "storage", action: "loadTaskOutbox" });
    return [];
  }
}

function saveTaskOutbox(userId, entries = []) {
  if (!userId) return;
  try {
    const compact = compactTaskOutbox(entries);
    if (!compact.length) localStorage.removeItem(taskOutboxDataKey(userId));
    else localStorage.setItem(taskOutboxDataKey(userId), JSON.stringify(compact));
  } catch (e) {
    captureClientError(e, { module: "storage", action: "saveTaskOutbox" });
  }
}

function clearTaskOutbox(userId) {
  if (!userId) return;
  try { localStorage.removeItem(taskOutboxDataKey(userId)); } catch (_) {}
}

function loadRoutineOutbox(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(routineOutboxDataKey(userId));
    if (!raw) return [];
    return compactRoutineOutbox(JSON.parse(raw));
  } catch (e) {
    captureClientError(e, { module: "storage", action: "loadRoutineOutbox" });
    return [];
  }
}

function saveRoutineOutbox(userId, entries = []) {
  if (!userId) return;
  try {
    const compact = compactRoutineOutbox(entries);
    if (!compact.length) localStorage.removeItem(routineOutboxDataKey(userId));
    else localStorage.setItem(routineOutboxDataKey(userId), JSON.stringify(compact));
  } catch (e) {
    captureClientError(e, { module: "storage", action: "saveRoutineOutbox" });
  }
}

function clearRoutineOutbox(userId) {
  if (!userId) return;
  try { localStorage.removeItem(routineOutboxDataKey(userId)); } catch (_) {}
}

function routineMigrationDone(userId) {
  if (!userId) return true;
  try { return localStorage.getItem(routineMigrationKey(userId)) === "done"; } catch (_) { return false; }
}

function markRoutineMigrationDone(userId) {
  if (!userId) return;
  try { localStorage.setItem(routineMigrationKey(userId), "done"); } catch (_) {}
}

// Converte uma fila V5 que tenha sobrevivido no aparelho para operações V6.
// Não envia arrays inteiros: cada item vira uma mutação independente.
function migrateLegacyTaskPendingToOutbox(userId, remoteTasks = [], revisions = {}) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(legacyPendingTaskSyncDataKey(userId));
    if (!raw) return loadTaskOutbox(userId);
    const legacy = JSON.parse(raw);
    const base = Array.isArray(legacy?.baseTasks) ? legacy.baseTasks : [];
    const desired = Array.isArray(legacy?.desiredTasks) ? legacy.desiredTasks : [];
    const baseMap = new Map(base.map((task) => [String(task?.id || ""), task]).filter(([id]) => id));
    const desiredMap = new Map(desired.map((task) => [String(task?.id || ""), task]).filter(([id]) => id));
    const remoteMap = new Map((Array.isArray(remoteTasks) ? remoteTasks : []).map((task) => [String(task?.id || ""), task]).filter(([id]) => id));
    const ops = loadTaskOutbox(userId);
    for (const [id, task] of desiredMap) {
      const before = baseMap.get(id);
      let changed = !before;
      if (!changed) {
        try { changed = JSON.stringify(before) !== JSON.stringify(task); } catch (_) { changed = true; }
      }
      if (changed) ops.push(makeTaskUpsert(task, Number(revisions?.[id] || 0), newMutationId()));
    }
    for (const [id] of baseMap) {
      if (!desiredMap.has(id) && remoteMap.has(id)) ops.push(makeTaskDelete(id, Number(revisions?.[id] || 0), newMutationId()));
    }
    const compact = compactTaskOutbox(ops.filter(Boolean));
    saveTaskOutbox(userId, compact);
    localStorage.removeItem(legacyPendingTaskSyncDataKey(userId));
    return compact;
  } catch (e) {
    captureClientError(e, { module: "storage", action: "migrateLegacyTaskPendingToOutbox" });
    return loadTaskOutbox(userId);
  }
}

function syncFieldSignatures(data = {}) {
  const signatures = {};
  for (const field of Object.values(DOMAIN_FIELDS).flat()) {
    try { signatures[field] = JSON.stringify(data?.[field] ?? null); }
    catch (_) { signatures[field] = String(data?.[field] ?? ""); }
  }
  return signatures;
}

function loadUserLocalData(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(userDataKey(userId));
    return raw ? migrateUserData(JSON.parse(raw)) : null;
  } catch (e) {
    captureClientError(e, { module: "storage", action: "loadUserLocalData" });
    return null;
  }
}
function saveUserLocalData(userId, data) {
  if (!userId) return;
  try {
    const stamped = migrateUserData({
      ...data,
      schemaVersion: DATA_SCHEMA_VERSION,
      __syncUpdatedAt: data?.__syncUpdatedAt || null,
      __localUpdatedAt: data?.__localUpdatedAt || new Date().toISOString(),
    });
    localStorage.setItem(userDataKey(userId), JSON.stringify(stamped));
  } catch (e) {
    captureClientError(e, { module: "storage", action: "saveUserLocalData" });
  }
}
function loadLegacyLocalData() {
  try {
    const raw = localStorage.getItem(LEGACY_DATA_KEY);
    return raw ? migrateUserData(JSON.parse(raw)) : null;
  } catch (e) {
    captureClientError(e, { module: "storage", action: "loadLegacyLocalData" });
    return null;
  }
}
function clearLegacyLocalData() {
  try { localStorage.removeItem(LEGACY_DATA_KEY); } catch (e) { /* ignore */ }
}
function loadStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveStoredSession(session) {
  try {
    if (session) localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(AUTH_SESSION_KEY);
  } catch (e) { /* ignore */ }
}

function normalizeAuthSession(nextSession, previousSession = null) {
  if (!nextSession) return null;
  const expiresIn = Number(nextSession.expires_in || previousSession?.expires_in || 0);
  const computedExpiresAt = expiresIn > 0 ? Math.floor(Date.now() / 1000) + expiresIn : null;
  return {
    ...(previousSession || {}),
    ...nextSession,
    refresh_token: nextSession.refresh_token || previousSession?.refresh_token || null,
    user: nextSession.user || previousSession?.user || null,
    expires_at: Number(nextSession.expires_at || 0) || Number(previousSession?.expires_at || 0) || computedExpiresAt,
  };
}

async function ensureFreshAuthSession(currentSession, { force = false, minValidityMs = 120000 } = {}) {
  if (!currentSession?.refresh_token) throw new Error("missing_refresh_token");

  const expiresAtMs = Number(currentSession.expires_at || 0) * 1000;
  const hasUsableToken = Boolean(currentSession.access_token);
  const tokenStillValid = !Number.isFinite(expiresAtMs) || expiresAtMs <= 0
    ? hasUsableToken
    : Date.now() < expiresAtMs - minValidityMs;

  if (!force && hasUsableToken && tokenStillValid) return currentSession;

  const refreshed = await refreshAuthSession(currentSession.refresh_token);
  const normalized = normalizeAuthSession(refreshed, currentSession);
  if (!normalized?.access_token) throw new Error("session_refresh_failed");
  saveStoredSession(normalized);
  return normalized;
}

function monthKey(dateStr = today()) {
  return String(dateStr || "").slice(0, 7);
}

function dateLabel(dateStr, options = { weekday: "short", day: "2-digit", month: "2-digit" }) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", options);
}

// Datas por extenso em pt-BR só devem ter a primeira letra maiúscula
// ("Terça-feira, 1 de setembro"), nunca cada palavra — por isso não usamos
// a classe utilitária `capitalize` (que maiusculiza palavra por palavra).
function capitalizeFirst(text) {
  const value = String(text || "");
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function weekdayIndex(dateStr = today()) {
  return new Date(dateStr + "T12:00:00").getDay();
}

function goalMilestonePercents(goal) {
  if (goal?.checklist?.length) return [];
  if (goal?.milestones?.length) return goal.milestones;
  return [25, 50, 75, 100];
}

function goalMilestonesReached(goal) {
  const target = Math.max(1, Number(goal?.target || 0));
  const currentPct = Math.min(100, Math.max(0, (Number(goal?.current || 0) / target) * 100));
  return goalMilestonePercents(goal).filter((pct) => currentPct >= pct).length;
}

function moduleEnabled(profile, id) {
  // Relatórios fica só no código (uso interno) — nunca aparece na navegação do usuário.
  if (id === "reports") return false;
  if (["dashboard", "profile", "notifications"].includes(id)) return true;
  return profile?.moduleVisibility?.[id] !== false;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const start = new Date(today() + "T12:00:00");
  const end = new Date(dateStr + "T12:00:00");
  return Math.ceil((end - start) / 86400000);
}


async function authRequest(path, body, accessToken) {
  if (!SUPABASE_CONFIGURED) throw new Error("supabase_not_configured");
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.msg || data?.message || data?.error_description || "auth_failed");
  return data;
}
async function signInWithPassword(email, password) {
  return authRequest("token?grant_type=password", { email: email.trim().toLowerCase(), password });
}
function isEmailConfirmedUser(user) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

function strongPasswordError(password) {
  const value = String(password || "");
  if (value.length < 10) return "Use pelo menos 10 caracteres.";
  if (!/[a-z]/.test(value)) return "Inclua pelo menos uma letra minúscula.";
  if (!/[A-Z]/.test(value)) return "Inclua pelo menos uma letra maiúscula.";
  if (!/\d/.test(value)) return "Inclua pelo menos um número.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Inclua pelo menos um símbolo.";
  return "";
}

async function signUpWithPassword(email, password) {
  const redirect = typeof window !== "undefined" ? `${window.location.origin}/` : "";
  const suffix = redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : "";
  return authRequest(`signup${suffix}`, { email: email.trim().toLowerCase(), password });
}
async function resendSignupConfirmation(email) {
  const redirect = typeof window !== "undefined" ? `${window.location.origin}/` : "";
  const suffix = redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : "";
  return authRequest(`resend${suffix}`, { type: "signup", email: String(email || "").trim().toLowerCase() });
}
async function refreshAuthSession(refreshToken) {
  return authRequest("token?grant_type=refresh_token", { refresh_token: refreshToken });
}
async function signOutRemote(accessToken) {
  try { await authRequest("logout", null, accessToken); } catch (e) { /* logout local continua */ }
}

async function updateAuthUser(session, payload) {
  if (!session?.access_token) throw new Error("missing_session");
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.msg || "update_user_failed");
  return data;
}

async function sendPasswordRecovery(email) {
  return authRequest("recover", { email: String(email || "").trim().toLowerCase() });
}


const SYNC_TABLE_URL = `${SUPABASE_URL}/rest/v1/device_sync`;
const DOMAIN_SYNC_TABLE_URL = `${SUPABASE_URL}/rest/v1/constancce_domain_sync`;

async function fetchAtomicTasksForUser(session) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("missing_user");
  const list = [];
  const pageSize = 500;
  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/constancce_tasks?user_id=eq.${encodeURIComponent(userId)}&select=task_id,payload,revision,deleted_at,updated_at&order=updated_at.asc&limit=${pageSize}&offset=${offset}`,
      { headers: authHeaders(session), cache: "no-store" }
    );
    const rows = await res.json().catch(() => []);
    if (!res.ok) {
      const error = new Error(rows?.message || rows?.error || `task_sync_fetch_${res.status}`);
      error.status = res.status;
      throw error;
    }
    const batch = Array.isArray(rows) ? rows : [];
    list.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return {
    tasks: list.filter((row) => !row?.deleted_at).map((row) => row?.payload).filter(Boolean),
    taskRevisions: Object.fromEntries(list.map((row) => [String(row?.task_id || ""), Number(row?.revision || 0)]).filter(([id]) => id)),
    updatedAt: list.map((row) => row?.updated_at).filter(Boolean).sort().at(-1) || null,
  };
}

async function applyAtomicTaskOpForUser(session, op, options = {}) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("missing_user");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/constancce_apply_my_task_op`, {
    method: "POST",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      p_mutation_id: options.mutationId || op?.mutationId || newMutationId(),
      p_client_id: options.clientId || getSyncClientId(userId),
      p_op: op || {},
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.message || data?.details || data?.hint || data?.error || `task_sync_rpc_${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.details = data;
    throw error;
  }
  return Array.isArray(data) ? data[0] : data;
}

async function fetchAtomicRoutineForUser(session) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("missing_user");
  const list = [];
  const pageSize = 1000;
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/constancce_sync_entities?user_id=eq.${encodeURIComponent(userId)}&select=collection,entity_id,payload,revision,deleted_at,updated_at&order=updated_at.asc&limit=${pageSize}&offset=${offset}`,
      { headers: authHeaders(session), cache: "no-store" }
    );
    const rows = await res.json().catch(() => []);
    if (!res.ok) {
      const error = new Error(rows?.message || rows?.error || `routine_sync_fetch_${res.status}`);
      error.status = res.status;
      throw error;
    }
    const batch = Array.isArray(rows) ? rows : [];
    list.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return routineFieldsFromRows(list);
}

async function applyAtomicRoutineOpForUser(session, op, options = {}) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("missing_user");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/constancce_apply_my_entity_op`, {
    method: "POST",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      p_collection: op?.collection || "",
      p_mutation_id: options.mutationId || op?.mutationId || newMutationId(),
      p_client_id: options.clientId || getSyncClientId(userId),
      p_op: op || {},
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.message || data?.details || data?.hint || data?.error || `routine_sync_rpc_${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.details = data;
    throw error;
  }
  return Array.isArray(data) ? data[0] : data;
}

async function fetchLegacyRemoteForUser(session) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("missing_user");
  const res = await fetch(`${SYNC_TABLE_URL}?user_id=eq.${encodeURIComponent(userId)}&select=data,updated_at`, {
    headers: authHeaders(session),
  });
  if (!res.ok) throw new Error("legacy_sync_fetch_failed");
  const rows = await res.json();
  if (!rows[0]?.data) return null;
  return migrateUserData({
    ...rows[0].data,
    __syncUpdatedAt: rows[0].updated_at || rows[0].data?.__syncUpdatedAt || null,
  });
}

async function saveDomainRemoteForUser(session, data, options = {}) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("missing_user");

  const migrated = migrateUserData(data || {});
  const changedKeys = Array.isArray(options.changedKeys) ? [...new Set(options.changedKeys)] : [];
  const payload = pickDataForKeys(migrated, changedKeys);
  const mutationId = options.mutationId || newMutationId();
  const clientId = options.clientId || getSyncClientId(userId);
  const baseFieldRevisions = options.baseFieldRevisions && typeof options.baseFieldRevisions === "object"
    ? options.baseFieldRevisions
    : (migrated?.__syncFieldRevisions || {});

  const res = await fetch(`${SUPABASE_URL}/functions/v1/domain-sync`, {
    method: "POST",
    keepalive: Boolean(options.keepalive),
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      protocolVersion: 3,
      mutationId,
      clientId,
      data: payload,
      changedKeys,
      schemaVersion: DATA_SCHEMA_VERSION,
      baseFieldRevisions,
      taskOps: [], // 1.1.25: Tarefas nunca são escritas pela domain-sync
    }),
  });

  const response = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(response?.error || `domain_sync_http_${res.status}`);
    error.status = res.status;
    error.details = response;
    throw error;
  }
  return response;
}

async function fetchRemoteForUser(session) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("missing_user");

  // 1.1.25: Tarefas são lidas diretamente da tabela atômica com RLS.
  // Mesmo que domain-sync esteja indisponível, tarefas continuam chegando
  // entre dispositivos e não ficam presas à Edge Function genérica.
  let atomicTasks = null;
  try {
    atomicTasks = await fetchAtomicTasksForUser(session);
  } catch (error) {
    captureClientError(error, { module: "sync", action: "fetch_atomic_tasks_v5" });
  }
  const attachAtomicTasks = (value) => {
    if (!value) return null;
    if (!atomicTasks) return value;
    const base = value;
    return migrateUserData({
      ...base,
      tasks: atomicTasks.tasks || [],
      __taskRevisions: atomicTasks.taskRevisions || {},
      __syncUpdatedAt: [base?.__syncUpdatedAt, atomicTasks.updatedAt].filter(Boolean).sort().at(-1) || base?.__syncUpdatedAt || null,
    });
  };

  // Leitura genérica continua pela Edge Function, mas não é mais requisito
  // para a comunicação de Tarefas.
  // qualquer dispositivo da mesma conta recebe o snapshot mais recente sem
  // depender de particularidades do cache/localStorage ou de policies REST.
  try {
    const edge = await fetch(`${SUPABASE_URL}/functions/v1/domain-sync`, {
      method: "GET",
      headers: authHeaders(session),
      cache: "no-store",
    });
    const response = await edge.json().catch(() => ({}));
    if (edge.ok) {
      if (!response?.data) {
        if (atomicTasks) {
          return migrateUserData({
            tasks: atomicTasks.tasks || [],
            __taskRevisions: atomicTasks.taskRevisions || {},
            __syncUpdatedAt: atomicTasks.updatedAt || null,
          });
        }
        return null;
      }
      return attachAtomicTasks(migrateUserData({
        ...response.data,
        __syncRevision: Number(response.revision || 0),
        __syncFieldRevisions: response.fieldRevisions || {},
        __syncDomainUpdatedAt: response.domainUpdatedAt || {},
        __syncUpdatedAt: response.updated_at || response.data?.__syncUpdatedAt || null,
        __taskRevisions: response.taskRevisions || {},
      }));
    }
    // Durante uma atualização gradual, versões antigas da função podem responder
    // 405. Nesse caso mantemos o fallback REST até o deploy da 1.1.20 terminar.
    if (![404, 405].includes(edge.status)) {
      const error = new Error(response?.error || `domain_sync_pull_${edge.status}`);
      error.status = edge.status;
      captureClientError(error, { module: "sync", action: "domain_sync_pull_nonfatal_v5" });
      // Continua para o fallback REST. Uma falha da Edge Function não pode
      // interromper a leitura atômica de Tarefas.
    }
  } catch (error) {
    captureClientError(error, { module: "sync", action: "fetch_domain_sync_edge_fallback_v5" });
    // Falhas do domínio genérico são não fatais para Tarefas. O fallback REST
    // abaixo ainda tenta recuperar os demais módulos.
  }

  let domainRows = [];
  let domainAvailable = true;

  try {
    const res = await fetch(
      `${DOMAIN_SYNC_TABLE_URL}?user_id=eq.${encodeURIComponent(userId)}&select=domain,data,updated_at`,
      { headers: authHeaders(session), cache: "no-store" }
    );
    if (!res.ok) {
      domainAvailable = false;
    } else {
      domainRows = await res.json().catch(() => []);
    }
  } catch (error) {
    domainAvailable = false;
    captureClientError(error, { module: "sync", action: "fetch_domain_sync" });
  }

  const domainNames = new Set(domainRows.map((row) => row.domain));
  const domainUpdatedAt = Object.fromEntries(
    domainRows
      .filter((row) => row?.domain && row?.updated_at)
      .map((row) => [row.domain, row.updated_at])
  );
  const allDomainsPresent =
    domainRows.length > 0 &&
    Object.keys(DOMAIN_FIELDS).every((domain) => domainNames.has(domain));

  if (allDomainsPresent) {
    return attachAtomicTasks(migrateUserData({ ...mergeDomainRows(domainRows), __syncDomainUpdatedAt: domainUpdatedAt }));
  }

  const legacy = await fetchLegacyRemoteForUser(session).catch(() => null);

  if (!domainRows.length) {
    if (legacy && domainAvailable) {
      saveDomainRemoteForUser(session, legacy, {
        expectedDomainUpdatedAt: {},
      }).catch((error) =>
        captureClientError(error, { module: "sync", action: "seed_domain_sync" })
      );
    }
    return attachAtomicTasks(legacy);
  }

  const mergedDomains = mergeDomainRows(domainRows);
  const combined = migrateUserData({
    ...(legacy || {}),
    ...mergedDomains,
    __syncDomainUpdatedAt: domainUpdatedAt,
    __syncUpdatedAt: [legacy?.__syncUpdatedAt, mergedDomains?.__syncUpdatedAt]
      .filter(Boolean)
      .sort()
      .at(-1) || null,
  });

  if (domainAvailable && domainNames.size < Object.keys(DOMAIN_FIELDS).length) {
    const missingDomains = Object.keys(DOMAIN_FIELDS).filter((domain) => !domainNames.has(domain));
    saveDomainRemoteForUser(session, combined, {
      changedKeys: missingDomains.flatMap((domain) => DOMAIN_FIELDS[domain] || []),
      expectedDomainUpdatedAt: domainUpdatedAt,
    }).catch((error) => captureClientError(error, { module: "sync", action: "complete_domain_migration" }));
  }

  return attachAtomicTasks(combined);
}

async function saveRemoteForUser(session, data, options = {}) {
  return saveDomainRemoteForUser(session, data, options);
}

async function recordActivityEvent(session, eventType, eventKey, metadata = {}) {
  if (!session?.user?.id || !eventType || !eventKey) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/activity-event`, {
      method: "POST",
      headers: authHeaders(session, { "Content-Type": "application/json" }),
      body: JSON.stringify({ eventType, eventKey, metadata }),
    });
    if (!res.ok) {
      const response = await res.json().catch(() => ({}));
      throw new Error(response?.error || `activity_event_${res.status}`);
    }
    return true;
  } catch (error) {
    captureClientError(error, { module: "activity-ledger", action: eventType });
    return false;
  }
}

const PUBLIC_PROFILE_URL = `${SUPABASE_URL}/rest/v1/constancce_profiles`;
async function upsertPublicProfile(session, publicData) {
  const userId = session?.user?.id;
  if (!userId) return;
  const res = await fetch(`${PUBLIC_PROFILE_URL}?on_conflict=user_id`, {
    method: "POST",
    headers: authHeaders(session, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    }),
    body: JSON.stringify({ user_id: userId, email: session.user.email?.toLowerCase(), ...publicData, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error("public_profile_save_failed");
}
async function fetchFriends(session) { return rpcRequest(session, "get_constancce_friends"); }
async function addFriendByEmail(session, email) { return rpcRequest(session, "add_constancce_friend", { p_email: email.trim().toLowerCase() }); }
async function respondFriendRequest(session, friendshipId, accept) { return rpcRequest(session, "respond_constancce_friend", { p_friendship_id: friendshipId, p_accept: accept }); }
async function removeFriendship(session, friendshipId) { return rpcRequest(session, "remove_constancce_friend", { p_friendship_id: friendshipId }); }

async function edgeFunctionRequest(session, functionName, body = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers: authHeaders(session, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
  } catch (_) {
    throw new Error(`${functionName}_network_error`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error || data?.message || `${functionName}_http_${res.status}`;
    throw new Error(message);
  }
  return data;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function ensureConstancceServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("service_worker_unavailable");

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });

  // Não depende de navigator.serviceWorker.ready, que pode ficar pendente em
  // alguns navegadores na primeira instalação ou após uma atualização.
  if (!registration.active) {
    const worker = registration.installing || registration.waiting;

    if (worker) {
      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("service_worker_timeout")), 8000);

        const check = () => {
          if (worker.state === "activated") {
            window.clearTimeout(timeout);
            resolve();
          } else if (worker.state === "redundant") {
            window.clearTimeout(timeout);
            reject(new Error("service_worker_redundant"));
          }
        };

        worker.addEventListener("statechange", check);
        check();
      }).catch(async (error) => {
        // Se já houver um worker ativo no registro, podemos continuar.
        if (!registration.active) throw error;
      });
    }
  }

  return registration;
}

async function getConstancceServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  return ensureConstancceServiceWorker();
}

async function fetchPushSubscriptionState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { supported: false, enabled: false };
  }

  try {
    const registration = await getConstancceServiceWorkerRegistration();
    if (!registration) return { supported: true, enabled: false };
    const subscription = await registration.pushManager.getSubscription();
    return { supported: true, enabled: Boolean(subscription), subscription };
  } catch (_) {
    return { supported: true, enabled: false };
  }
}

async function showConstanccePermissionTest(registration) {
  try {
    await registration.showNotification("Constancce", {
      body: "Permissão concedida. Estamos finalizando a ativação dos seus lembretes.",
      icon: "/icon-192.png",
      badge: "/favicon-32x32.png",
      tag: "constancce-permission-granted",
      data: { url: "/?view=notifications" },
    });
  } catch (_) {}
}

async function enableConstanccePush(session) {
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
    throw new Error("push_not_supported");
  }

  let permission = Notification.permission;

  // Só abre a caixa nativa quando ainda for necessário.
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "notification_denied" : "notification_not_granted");
  }

  const registration = await ensureConstancceServiceWorker();

  // Confirma visualmente que a permissão do navegador funciona, mesmo antes
  // da etapa de cadastro da assinatura no backend.
  await showConstanccePermissionTest(registration);

  const config = await edgeFunctionRequest(session, "push-subscription", { action: "config" });
  if (!config?.public_key) throw new Error("vapid_not_configured");

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.public_key),
      });
    } catch (error) {
      const name = String(error?.name || "");
      if (name === "NotAllowedError") throw new Error("notification_denied");
      if (name === "InvalidStateError") throw new Error("push_invalid_state");
      throw new Error("push_subscribe_failed");
    }
  }

  await edgeFunctionRequest(session, "push-subscription", {
    action: "save",
    subscription: subscription.toJSON(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    user_agent: navigator.userAgent,
  });

  try {
    await registration.showNotification("Notificações ativadas", {
      body: "Você receberá lembretes da sua rotina.",
      icon: "/icon-192.png",
      badge: "/favicon-32x32.png",
      tag: "constancce-notifications-enabled",
      data: { url: "/?view=notifications" },
    });
  } catch (_) {}

  return subscription;
}

async function disableConstanccePush(session) {
  if (!("serviceWorker" in navigator)) return;

  const registration = await getConstancceServiceWorkerRegistration();
  if (!registration) return;

  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    try {
      await edgeFunctionRequest(session, "push-subscription", {
        action: "remove",
        endpoint: subscription.endpoint,
      });
    } catch (_) {}

    await subscription.unsubscribe().catch(() => {});
  }
}

const ACCESS_TABLE_URL = `${SUPABASE_URL}/rest/v1/constancce_access`;
async function fetchAccessForUser(session) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("missing_user");
  const res = await fetch(`${ACCESS_TABLE_URL}?user_id=eq.${encodeURIComponent(userId)}&select=*`, {
    headers: authHeaders(session, { "Cache-Control": "no-cache" }),
    cache: "no-store",
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw new Error(rows?.message || "access_fetch_failed");
  return rows?.[0] || null;
}
async function createLifetimeCheckout(session) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-mercadopago-checkout`, {
    method: "POST",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error || data?.message || `checkout_http_${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

function proCutoffDate(days = PRO_LIMITS.historyDays) {
  return addDays(today(), -Math.max(0, Number(days) || 0));
}


/* ---------------------------------------------------------------
   TOKENS — pure-black instrument panel. Brass = discipline/action,
   ember = streak/fire, moss = success. Numbers set in mono.
----------------------------------------------------------------*/


/* ---------------------------------------------------------------
   HELPERS
----------------------------------------------------------------*/
const fmt = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today = () => fmt(new Date());
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return fmt(d);
};
const dayOfWeek = (dateStr) => new Date(dateStr + "T00:00:00").getDay();
const startOfWeek = (dateStr) => { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() - d.getDay()); return fmt(d); };
const startOfMonth = (dateStr) => { const d = new Date(dateStr + "T00:00:00"); return fmt(new Date(d.getFullYear(), d.getMonth(), 1)); };
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const uid = () => Math.random().toString(36).slice(2, 10);

const optimizeImageFile = async (file, maxSize = 900, quality = 0.82) => {
  if (!file || !file.type?.startsWith("image/")) throw new Error("invalid_image");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
};

const calculateTmb = ({ sex, age, weightKg, heightCm } = {}) => {
  const ageN = Number(age);
  const weight = Number(weightKg);
  const height = Number(heightCm);
  if (!["male", "female"].includes(sex) || ageN <= 0 || weight <= 0 || height <= 0) return null;
  const base = 10 * weight + 6.25 * height - 5 * ageN;
  return Math.round(base + (sex === "male" ? 5 : -161));
};

const encodeWorkoutShare = (workout) => {
  const safe = {
    v: 1,
    name: String(workout?.name || "Treino compartilhado"),
    scheduleDays: Array.isArray(workout?.scheduleDays) ? workout.scheduleDays : [],
    exercises: (workout?.exercises || []).map((exercise) => ({
      name: String(exercise?.name || "Exercício"),
      sets: Math.max(1, Number(exercise?.sets) || 1),
      reps: String(exercise?.reps || ""),
      load: exercise?.load ?? "",
      muscleGroup: String(exercise?.muscleGroup || inferWorkoutMuscleGroup(exercise?.name || "")),
      restSeconds: Number(exercise?.restSeconds || 90),
      videoUrl: String(exercise?.videoUrl || ""),
    })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(safe));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const decodeWorkoutShare = (value) => {
  if (!value) return null;
  try {
    let token = String(value).trim();
    if (token.includes("sharedWorkout=")) {
      const url = new URL(token, window.location.origin);
      token = url.searchParams.get("sharedWorkout") || "";
    }
    token = token.replaceAll("-", "+").replaceAll("_", "/");
    while (token.length % 4) token += "=";
    const binary = atob(token);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed?.name || !Array.isArray(parsed?.exercises) || parsed.exercises.length === 0) return null;
    return parsed;
  } catch (_) {
    return null;
  }
};
const taskOccursOnDate = (task, dateStr) => {
  const start = task.dueDate || task.createdAt || dateStr;
  if (dateStr < start) return false;
  const repeat = task.repeat || "none";
  if (repeat === "daily") return true;
  if (repeat === "weekly") return dayOfWeek(dateStr) === dayOfWeek(start);
  if (repeat === "monthly") return new Date(dateStr + "T00:00:00").getDate() === new Date(start + "T00:00:00").getDate();
  if (repeat === "custom") return (task.repeatDays || []).includes(dayOfWeek(dateStr));
  return task.dueDate === dateStr;
};
const isRecurringTask = (task) => (task.repeat || "none") !== "none";
const taskDoneOnDate = (task, dateStr) => isRecurringTask(task)
  ? (task.completionDates || []).includes(dateStr)
  : task.status === "concluida" && (!task.completedAt || task.completedAt === dateStr || task.dueDate === dateStr);
const taskRepeatLabel = (task) => {
  const repeat = task.repeat || "none";
  if (repeat === "daily") return "Todo dia";
  if (repeat === "weekly") return "Toda semana";
  if (repeat === "monthly") return "Todo mês";
  if (repeat === "custom") {
    const days = (task.repeatDays || []).map((d) => WEEKDAYS[d]);
    return days.length ? days.join(", ") : "Dias específicos";
  }
  return "Não repetir";
};
const money = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const goalValueLabel = (goal, value) =>
  goal?.type === "financeira"
    ? money(value)
    : (Number(value) || 0).toLocaleString("pt-BR");

const monthsUntilGoal = (endDate) => {
  if (!endDate) return 1;
  const start = new Date(today() + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  const diffDays = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  return Math.max(1, Math.ceil(diffDays / 30.4375));
};

const monthlyGoalEstimate = (goal) => {
  const remaining = Math.max(0, Number(goal?.target || 0) - Number(goal?.current || 0));
  return remaining / monthsUntilGoal(goal?.endDate);
};

const goalProgressPercent = (goal) => {
  const target = Math.max(0, Number(goal?.target || 0));
  const current = Math.max(0, Number(goal?.current || 0));
  return target > 0 ? Math.min(100, Math.max(0, Math.round((current / target) * 100))) : 0;
};

const goalProgressEntries = (goalProgressLog, goalId) =>
  [...(goalProgressLog || [])]
    .filter((entry) => entry.goalId === goalId)
    .sort((a, b) =>
      String(a.createdAt || `${a.date || ""}T00:00:00`).localeCompare(
        String(b.createdAt || `${b.date || ""}T00:00:00`)
      )
    );

const goalDailyHistory = (goal, goalProgressLog) => {
  const entries = goalProgressEntries(goalProgressLog, goal.id);
  const byDate = new Map();

  entries.forEach((entry) => {
    const date = String(entry.date || entry.createdAt || "").slice(0, 10);
    if (!date) return;
    byDate.set(date, {
      date,
      value: Math.max(0, Number(entry.value || 0)),
      added: Math.max(0, Number(entry.added || 0)),
      createdAt: entry.createdAt || `${date}T12:00:00`,
    });
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

const goalLastActivityDate = (goal, goalProgressLog) => {
  const history = goalDailyHistory(goal, goalProgressLog);
  const checkins = [...(goal?.weeklyCheckins || [])]
    .filter((item) => item.value !== "nenhum")
    .map((item) => String(item.date || item.createdAt || "").slice(0, 10))
    .filter(Boolean)
    .sort();

  const candidates = [
    history.at(-1)?.date,
    checkins.at(-1),
    goal?.startDate,
  ].filter(Boolean).sort();

  return candidates.at(-1) || goal?.startDate || today();
};

const goalDaysSinceActivity = (goal, goalProgressLog) => {
  const last = goalLastActivityDate(goal, goalProgressLog);
  const from = new Date(`${last}T12:00:00`);
  const to = new Date(`${today()}T12:00:00`);
  return Math.max(0, Math.floor((to - from) / 86400000));
};

const goalPaceInfo = (goal, goalProgressLog) => {
  if (goal?.completed) return { label: "Concluída", tone: "positive", expectedPct: 100, deltaPct: 0 };

  const pct = goalProgressPercent(goal);
  const inactiveDays = goalDaysSinceActivity(goal, goalProgressLog);

  if (inactiveDays >= 21 && pct < 100) {
    return { label: "Parada", tone: "danger", expectedPct: null, deltaPct: null, inactiveDays };
  }

  if (!goal?.endDate) {
    return { label: "Em andamento", tone: "neutral", expectedPct: null, deltaPct: null, inactiveDays };
  }

  const start = new Date(`${goal.startDate || today()}T12:00:00`);
  const end = new Date(`${goal.endDate}T12:00:00`);
  const now = new Date(`${today()}T12:00:00`);
  const totalDays = Math.max(1, Math.ceil((end - start) / 86400000));
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((now - start) / 86400000)));
  const expectedPct = Math.max(0, Math.min(100, Math.round(elapsedDays / totalDays * 100)));
  const deltaPct = pct - expectedPct;

  if (goal.endDate < today() && pct < 100) {
    return { label: "Atenção", tone: "attention", expectedPct: 100, deltaPct: pct - 100, inactiveDays };
  }

  if (deltaPct >= -5) {
    return { label: "No ritmo", tone: "positive", expectedPct, deltaPct, inactiveDays };
  }

  return { label: "Atenção", tone: "attention", expectedPct, deltaPct, inactiveDays };
};

const goalPaceScore = (goal, goalProgressLog) => {
  if (goal?.completed) return 100;

  const pct = goalProgressPercent(goal);
  const pace = goalPaceInfo(goal, goalProgressLog);
  const progressPart = Math.min(35, pct * 0.35);
  const pacePart =
    pace.label === "No ritmo" ? 35 :
    pace.label === "Em andamento" ? 25 :
    pace.label === "Atenção" ? 16 :
    5;

  const inactiveDays = goalDaysSinceActivity(goal, goalProgressLog);
  const recencyPart = inactiveDays <= 7 ? 20 : inactiveDays <= 14 ? 12 : inactiveDays <= 21 ? 6 : 0;
  const milestonePercents = goalMilestonePercents(goal);
  const milestonePart = milestonePercents.length
    ? Math.round(goalMilestonesReached(goal) / milestonePercents.length * 10)
    : Math.min(10, pct * 0.1);

  return Math.max(0, Math.min(100, Math.round(progressPart + pacePart + recencyPart + milestonePart)));
};

const goalPaceScoreLabel = (score) =>
  score >= 80 ? "Forte" :
  score >= 60 ? "Estável" :
  score >= 40 ? "Atenção" :
  "Fraco";

const goalForecast = (goal, goalProgressLog) => {
  if (!goal || goal.completed) {
    return {
      predictedDate: goal?.completedAt ? String(goal.completedAt).slice(0, 10) : null,
      ratePerDay: 0,
      daysDifference: null,
    };
  }

  const target = Math.max(0, Number(goal.target || 0));
  const current = Math.max(0, Number(goal.current || 0));
  const remaining = Math.max(0, target - current);
  if (!target || !remaining) return { predictedDate: today(), ratePerDay: 0, daysDifference: 0 };

  const history = goalDailyHistory(goal, goalProgressLog);
  let ratePerDay = 0;

  if (history.length >= 2) {
    const first = history[0];
    const last = history.at(-1);
    const days = Math.max(
      1,
      Math.round(
        (new Date(`${last.date}T12:00:00`) - new Date(`${first.date}T12:00:00`)) / 86400000
      )
    );
    ratePerDay = Math.max(0, (Number(last.value || 0) - Number(first.value || 0)) / days);
  }

  if (ratePerDay <= 0 && current > 0) {
    const start = new Date(`${goal.startDate || today()}T12:00:00`);
    const now = new Date(`${today()}T12:00:00`);
    const elapsedDays = Math.max(1, Math.round((now - start) / 86400000) + 1);
    ratePerDay = current / elapsedDays;
  }

  if (!Number.isFinite(ratePerDay) || ratePerDay <= 0) {
    return { predictedDate: null, ratePerDay: 0, daysDifference: null };
  }

  const daysNeeded = Math.min(3650, Math.max(1, Math.ceil(remaining / ratePerDay)));
  const predictedDate = addDays(today(), daysNeeded);
  const daysDifference = goal.endDate
    ? Math.round(
        (new Date(`${predictedDate}T12:00:00`) - new Date(`${goal.endDate}T12:00:00`)) / 86400000
      )
    : null;

  return { predictedDate, ratePerDay, daysDifference };
};

const goalRequiredPace = (goal) => {
  const remaining = Math.max(0, Number(goal?.target || 0) - Number(goal?.current || 0));
  if (!goal?.endDate || remaining <= 0) {
    return { value: 0, unit: goal?.type === "financeira" ? "mês" : "semana" };
  }

  const days = Math.max(1, daysUntil(goal.endDate) || 1);
  if (goal.type === "financeira") {
    return {
      value: remaining / Math.max(1, days / 30.4375),
      unit: "mês",
    };
  }

  return {
    value: remaining / Math.max(1, days / 7),
    unit: "semana",
  };
};

const goalNextMilestone = (goal) => {
  const pct = goalProgressPercent(goal);
  const milestonePct = goalMilestonePercents(goal)
    .filter((value) => value > pct)
    .sort((a, b) => a - b)[0];

  if (!milestonePct) return null;

  const target = Math.max(0, Number(goal.target || 0));
  return {
    pct: milestonePct,
    value: target * milestonePct / 100,
  };
};

const normalizeGoalQuestion = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const goalQuestionTarget = (question, goals) => {
  const normalized = normalizeGoalQuestion(question);
  return (goals || []).find((goal) => {
    const name = normalizeGoalQuestion(goal.name);
    return name && normalized.includes(name);
  }) || null;
};

const CATEGORIES = [
  { id: "saude", label: "Saúde", color: "var(--moss)" },
  { id: "estudo", label: "Estudo", color: "var(--brass)" },
  { id: "trabalho", label: "Trabalho", color: "#7C93B0" },
  { id: "casa", label: "Casa", color: "#B08E5C" },
  { id: "mente", label: "Mente", color: "#9C7FB0" },
  { id: "outro", label: "Outro", color: "var(--text-dim)" },
];
const catColor = (id) => CATEGORIES.find((c) => c.id === id)?.color || "var(--text-dim)";
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "Outro";

const PRIORITIES = [
  { id: "baixa", label: "Baixa", color: "var(--text-faint)" },
  { id: "media", label: "Média", color: "var(--moss)" },
  { id: "alta", label: "Alta", color: "var(--brass)" },
  { id: "urgente", label: "Urgente", color: "var(--ember)" },
];

const MEAL_TYPES = ["Café da manhã", "Almoço", "Lanche", "Jantar", "Outro"];



const dietNormalize = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const dietFoodKey = (food) => {
  const source = String(food?.source || "");
  if (source === "constancce" || source === "taco") {
    return `catalog:${dietNormalize(food?.name || "")}`;
  }
  return String(
    food?.sourceId ||
    food?.id ||
    `${source || "custom"}:${dietNormalize(food?.brand || "")}:${dietNormalize(food?.name || "")}`
  );
};

const dietDedupFoods = (items = []) => {
  const seen = new Set();
  return items.filter((food) => {
    if (!food?.name) return false;
    const key = dietFoodKey(food);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const dietFoodMatches = (food, query) => {
  const normalized = dietNormalize(query);
  if (!normalized) return true;
  const haystack = dietNormalize([
    food?.name,
    food?.brand,
    food?.category,
    ...(food?.aliases || []),
  ].filter(Boolean).join(" "));
  return normalized.split(/\s+/).every((token) => haystack.includes(token));
};

const dietFoodSearchScore = (food, query) => {
  const q = dietNormalize(query);
  if (!q) return 0;

  const name = dietNormalize(food?.name || "");
  const aliases = (food?.aliases || []).map(dietNormalize);
  const category = dietNormalize(food?.category || "");
  const tokens = q.split(/\s+/).filter(Boolean);

  let score = 0;
  if (name === q) score += 1000;
  if (aliases.some((alias) => alias === q)) score += 900;
  if (name.startsWith(q)) score += 600;
  if (aliases.some((alias) => alias.startsWith(q))) score += 500;
  if (name.includes(q)) score += 350;
  if (aliases.some((alias) => alias.includes(q))) score += 300;

  tokens.forEach((token) => {
    if (name.startsWith(token)) score += 80;
    else if (name.includes(token)) score += 45;

    if (aliases.some((alias) => alias.startsWith(token))) score += 60;
    else if (aliases.some((alias) => alias.includes(token))) score += 30;

    if (category.includes(token)) score += 8;
  });

  if (food?.source === "constancce") score += 12;
  if (food?.source === "taco") score += 6;

  return score;
};

const dietFoodMeasures = (food) => {
  const measures = Array.isArray(food?.measures) ? food.measures.filter((item) => Number(item?.amount) > 0) : [];
  if (measures.length) return measures;
  const base = Math.max(0.1, Number(food?.baseQuantity || 100));
  return [{ label: `${base}${food?.unit || "g"}`, amount: base }];
};

// Medidas prontas + opção "Personalizado (g)" para o usuário digitar a quantidade
// exata em gramas, sem precisar calcular múltiplos de uma porção padrão.
const dietFoodMeasureOptions = (food) => [
  ...dietFoodMeasures(food),
  { label: "Personalizado (g)", amount: 1, custom: true },
];

const dietNutrientsForAmount = (food, amount) => {
  const base = Math.max(0.1, Number(food?.baseQuantity || 100));
  const factor = Math.max(0, Number(amount || 0)) / base;
  const value = (key) => Math.round(Number(food?.[key] || 0) * factor * 10) / 10;
  return {
    calories: value("calories"),
    protein: value("protein"),
    carbs: value("carbs"),
    fat: value("fat"),
    fiber: value("fiber"),
    sodium: value("sodium"),
    sugar: food?.sugarAvailable === false ? null : value("sugar"),
  };
};

const dietMealConsumed = (meal) => meal?.consumed !== false;

const dietDailyTotals = (mealLog = [], date = today()) =>
  mealLog
    .filter((meal) => meal.date === date && dietMealConsumed(meal))
    .reduce(
      (sum, meal) => ({
        calories: sum.calories + Number(meal.calories || 0),
        protein: sum.protein + Number(meal.protein || 0),
        carbs: sum.carbs + Number(meal.carbs || 0),
        fat: sum.fat + Number(meal.fat || 0),
        fiber: sum.fiber + Number(meal.fiber || 0),
        sodium: sum.sodium + Number(meal.sodium || 0),
        sugar: sum.sugar + Number(meal.sugar || 0),
      }),
      { calories:0, protein:0, carbs:0, fat:0, fiber:0, sodium:0, sugar:0 }
    );

async function searchDietProducts(session, { query = "", barcode = "" } = {}) {
  if (!SUPABASE_CONFIGURED || !session?.access_token) throw new Error("remote_search_unavailable");
  const response = await fetch(`${SUPABASE_URL}/functions/v1/food-search`, {
    method: "POST",
    headers: authHeaders(session, { "Content-Type": "application/json" }),
    body: JSON.stringify({ query, barcode }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "food_search_failed");
  return Array.isArray(data?.foods) ? data.foods : [];
}

const FIN_IN = ["Salário", "Freelance", "Venda", "Outro"];
const FIN_OUT = ["Alimentação", "Transporte", "Lazer", "Contas", "Compras", "Educação", "Aporte para meta", "Outro"];

const ACHIEVEMENT_DEFS = [
  { id: "first-day", label: "Primeiro dia perfeito", desc: "Conclua seu primeiro dia perfeito.", category: "Constância", rarity: "Comum", target: 1, value: (s) => s.totalPerfectDays || 0 },
  { id: "streak-7", label: "Semana firme", desc: "Mantenha 7 dias consecutivos.", category: "Constância", rarity: "Comum", target: 7, value: (s) => s.bestStreak || 0 },
  { id: "streak-30", label: "30 dias de disciplina", desc: "Mantenha 30 dias consecutivos.", category: "Constância", rarity: "Rara", target: 30, value: (s) => s.bestStreak || 0 },
  { id: "streak-90", label: "Imparável", desc: "Mantenha 90 dias consecutivos.", category: "Constância", rarity: "Épica", target: 90, value: (s) => s.bestStreak || 0 },
  { id: "streak-180", label: "Mestre da rotina", desc: "Mantenha 180 dias consecutivos.", category: "Constância", rarity: "Épica", target: 180, value: (s) => s.bestStreak || 0 },
  { id: "streak-365", label: "Lenda da constância", desc: "Mantenha 365 dias consecutivos.", category: "Constância", rarity: "Lendária", target: 365, value: (s) => s.bestStreak || 0 },

  { id: "habits-50", label: "Ritmo criado", desc: "Conclua 50 execuções de hábitos.", category: "Hábitos", rarity: "Comum", target: 50, value: (s) => s.habitCompletionsTotal || 0 },
  { id: "habits-100", label: "Guardião dos hábitos", desc: "Conclua 100 execuções de hábitos.", category: "Hábitos", rarity: "Rara", target: 100, value: (s) => s.habitCompletionsTotal || 0 },
  { id: "habits-500", label: "Automático", desc: "Conclua 500 execuções de hábitos.", category: "Hábitos", rarity: "Épica", target: 500, value: (s) => s.habitCompletionsTotal || 0 },
  { id: "habits-1000", label: "Mil execuções", desc: "Conclua 1.000 execuções de hábitos.", category: "Hábitos", rarity: "Lendária", target: 1000, value: (s) => s.habitCompletionsTotal || 0 },

  { id: "tasks-1", label: "Primeira entrega", desc: "Conclua sua primeira tarefa.", category: "Tarefas", rarity: "Comum", target: 1, value: (s) => s.tasksDone || 0 },
  { id: "tasks-25", label: "Operador", desc: "Conclua 25 tarefas.", category: "Tarefas", rarity: "Comum", target: 25, value: (s) => s.tasksDone || 0 },
  { id: "tasks-50", label: "Executor", desc: "Conclua 50 tarefas.", category: "Tarefas", rarity: "Rara", target: 50, value: (s) => s.tasksDone || 0 },
  { id: "tasks-250", label: "Máquina de execução", desc: "Conclua 250 tarefas.", category: "Tarefas", rarity: "Épica", target: 250, value: (s) => s.tasksDone || 0 },
  { id: "tasks-1000", label: "Mil entregas", desc: "Conclua 1.000 tarefas.", category: "Tarefas", rarity: "Lendária", target: 1000, value: (s) => s.tasksDone || 0 },

  { id: "workouts-1", label: "Primeiro treino", desc: "Conclua seu primeiro treino.", category: "Treinos", rarity: "Comum", target: 1, value: (s) => s.workoutsDone || 0 },
  { id: "workouts-10", label: "Corpo em movimento", desc: "Conclua 10 treinos.", category: "Treinos", rarity: "Comum", target: 10, value: (s) => s.workoutsDone || 0 },
  { id: "workouts-18", label: "Combatente", desc: "Conclua 18 treinos.", category: "Treinos", rarity: "Rara", target: 18, value: (s) => s.workoutsDone || 0 },
  { id: "workouts-50", label: "50 treinos", desc: "Conclua 50 treinos.", category: "Treinos", rarity: "Rara", target: 50, value: (s) => s.workoutsDone || 0 },
  { id: "workouts-100", label: "Centenário", desc: "Conclua 100 treinos.", category: "Treinos", rarity: "Épica", target: 100, value: (s) => s.workoutsDone || 0 },
  { id: "workouts-250", label: "Atleta da constância", desc: "Conclua 250 treinos.", category: "Treinos", rarity: "Lendária", target: 250, value: (s) => s.workoutsDone || 0 },

  { id: "goal-1", label: "Primeira meta", desc: "Conclua sua primeira meta.", category: "Metas", rarity: "Comum", target: 1, value: (s) => s.goalsDone || 0 },
  { id: "goals-5", label: "Objetivos em série", desc: "Conclua 5 metas.", category: "Metas", rarity: "Rara", target: 5, value: (s) => s.goalsDone || 0 },
  { id: "goals-10", label: "Direção clara", desc: "Conclua 10 metas.", category: "Metas", rarity: "Épica", target: 10, value: (s) => s.goalsDone || 0 },
  { id: "goal-early", label: "Antes do prazo", desc: "Conclua uma meta antes da data final.", category: "Metas", rarity: "Rara", target: 1, value: (s) => s.goalsEarly || 0 },

  { id: "savings", label: "Mês no verde", desc: "Termine um mês com saldo positivo.", category: "Finanças", rarity: "Comum", target: 1, value: (s) => s.positiveMonths || 0 },
  { id: "budget-ok", label: "Dentro do plano", desc: "Feche um mês respeitando seus orçamentos.", category: "Finanças", rarity: "Rara", target: 1, value: (s) => s.monthsWithinBudget || 0 },
  { id: "finance-goal", label: "Meta financeira concluída", desc: "Conclua uma meta financeira.", category: "Finanças", rarity: "Rara", target: 1, value: (s) => s.financialGoalsDone || 0 },
  { id: "finance-1000", label: "Primeiros R$ 1.000", desc: "Acumule R$ 1.000 em metas financeiras.", category: "Finanças", rarity: "Rara", target: 1000, value: (s) => s.financialGoalAccumulated || 0, money: true },
  { id: "finance-3months", label: "Trimestre positivo", desc: "Tenha 3 meses consecutivos com saldo positivo.", category: "Finanças", rarity: "Épica", target: 3, value: (s) => s.positiveMonthStreak || 0 },

  { id: "secret-perfect-score", label: "Dia impecável", desc: "Alcance 100/100 em um único dia.", category: "Secretas", rarity: "Épica", target: 100, value: (s) => s.highestDayScore || 0, secret: true },
  { id: "secret-task-sprint", label: "Sprint de execução", desc: "Conclua 10 tarefas em um único dia.", category: "Secretas", rarity: "Épica", target: 10, value: (s) => s.maxTasksInDay || 0, secret: true },
  { id: "secret-workout-week", label: "Semana de aço", desc: "Treine por 7 dias consecutivos.", category: "Secretas", rarity: "Lendária", target: 7, value: (s) => s.workoutBestStreak || 0, secret: true },
];

ACHIEVEMENT_DEFS.forEach((a) => {
  a.check = (stats) => Number(a.value(stats) || 0) >= Number(a.target || 1);
});


/* ---------------------------------------------------------------
   GAME LAYER — XP, níveis, cargos, score, missões e temporadas.
----------------------------------------------------------------*/
const RANKS = [
  { min: 0, title: "Recruta" }, { min: 250, title: "Iniciado" },
  { min: 600, title: "Executor" }, { min: 1200, title: "Operador" },
  { min: 2200, title: "Combatente" }, { min: 3800, title: "Guardião" },
  { min: 6000, title: "Veterano" }, { min: 9000, title: "Estrategista" },
  { min: 13000, title: "Comandante" }, { min: 18000, title: "Mestre" },
  { min: 25000, title: "Lenda" },
];
function gameLevel(xp) { return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1); }
function rankForXp(xp) { return [...RANKS].reverse().find((r) => xp >= r.min) || RANKS[0]; }
function nextRankForXp(xp) { return RANKS.find((r) => r.min > xp) || null; }
function pctBetween(value, min, max) { return max <= min ? 100 : Math.round(((value - min) / (max - min)) * 100); }
function getDayPerformance(dateStr, habits, completions, tasks, workoutSessions, mealLog, goalProgressLog = []) {
  const valid = habits.filter((h) => habitValidOnDate(h, dateStr, completions));
  const doneIds = new Set(completions.filter((c) => c.date === dateStr).map((c) => c.habitId));
  const habitsPct = valid.length ? valid.filter((h) => doneIds.has(h.id)).length / valid.length : 0;
  const dayTasks = tasks.filter((task) => taskOccursOnDate(task, dateStr));
  const tasksPct = dayTasks.length ? dayTasks.filter((task) => taskDoneOnDate(task, dateStr)).length / dayTasks.length : 0;
  const workout = workoutSessions.some((w) => w.date === dateStr && w.completed) ? 1 : 0;
  const nutrition = mealLog.some((m) => m.date === dateStr && dietMealConsumed(m)) ? 1 : 0;
  const goal = goalProgressLog.some((g) => g.date === dateStr) ? 1 : 0;
  const score = Math.round(habitsPct * 40 + tasksPct * 20 + workout * 20 + nutrition * 10 + goal * 10);
  return { score, habitsPct: Math.round(habitsPct * 100), tasksPct: Math.round(tasksPct * 100), workout, nutrition, goal };
}
function computeXp(completions, tasks, workoutSessions, goals, streaks) {
  const taskCompletions = tasks.reduce((total, task) => {
    if (isRecurringTask(task)) return total + (task.completionDates || []).length;
    return total + (task.status === "concluida" ? 1 : 0);
  }, 0);
  return completions.length * 10 + taskCompletions * 20 + workoutSessions.filter((w) => w.completed).length * 50 + goals.filter((g) => g.completed).length * 150 + streaks.totalPerfectDays * 30;
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

function MiniLineChart({ data, height = 150, color = "var(--brass)" }) {
  const gradientId = useId();
  const vals = data.map((item) => Number(item.value) || 0);
  const w = 600;
  const h = height;
  const padX = 22;
  const padY = 18;
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
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
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label="Gráfico de evolução">
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

function MiniBarChart({ data, height = 130 }) {
  const max = Math.max(...data.map((item) => Number(item.value) || 0), 1);

  return (
    <div className="tech-bar-chart flex items-end gap-2" style={{ height }}>
      {data.map((item, index) => {
        const pct = Math.max(3, (Number(item.value || 0) / max) * 100);
        return (
          <div key={index} className="flex-1 h-full flex flex-col items-center min-w-0">
            <span className="text-[9px] text-faint font-mono mb-1">{item.value}%</span>
            <div className="flex-1 w-full flex items-end justify-center">
              <div className="tech-bar-track h-full relative">
                <div className="tech-bar-fill absolute left-0 right-0 bottom-0" style={{ height: `${pct}%` }} />
              </div>
            </div>
            <span className="text-[9px] text-faint truncate w-full text-center mt-1.5">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ConsistencyHeatmap({ days }) {
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

function RadialProgress({ value = 0, size = 132, strokeWidth = 10, label, color = "var(--brass)" }) {
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

/* ---------------------------------------------------------------
   STREAK / VALIDITY LOGIC
----------------------------------------------------------------*/
function countInRange(habitId, completions, startInclusive, endExclusive) {
  return completions.filter((c) => c.habitId === habitId && c.date >= startInclusive && c.date < endExclusive).length;
}
function habitValidOnDate(habit, dateStr, completions = []) {
  if (!habit.active) return false;
  if (habit.createdAt && habit.createdAt > dateStr) return false;
  if (habit.pausedAt && habit.pausedAt <= dateStr && (!habit.resumedAt || habit.resumedAt > dateStr)) return false;
  const freq = habit.frequency;
  if (freq.type === "daily") return true;
  if (freq.type === "weekdays") return (freq.days || []).includes(dayOfWeek(dateStr));
  if (freq.type === "perweek") { const ws = startOfWeek(dateStr); return countInRange(habit.id, completions, ws, dateStr) < (freq.target || 1); }
  if (freq.type === "permonth") { const ms = startOfMonth(dateStr); return countInRange(habit.id, completions, ms, dateStr) < (freq.target || 1); }
  return true;
}
function freqLabel(h) {
  if (h.frequency.type === "daily") return "Todos os dias";
  if (h.frequency.type === "weekdays") return (h.frequency.days || []).map((d) => WEEKDAYS[d]).join(", ");
  if (h.frequency.type === "perweek") return `${h.frequency.target}x por semana`;
  if (h.frequency.type === "permonth") return `${h.frequency.target}x por mês`;
  return "";
}

function isDayComplete(habits, completions, dateStr) {
  const required = habits.filter((h) => h.countsForStreak && habitValidOnDate(h, dateStr, completions));
  if (required.length === 0) return null;
  const doneIds = new Set(completions.filter((c) => c.date === dateStr).map((c) => c.habitId));
  return required.every((h) => doneIds.has(h.id));
}

function computeStreaks(habits, completions, refDate) {
  const streakHabits = habits.filter((habit) => habit.countsForStreak);
  if (streakHabits.length === 0) return { current: 0, best: 0, totalPerfectDays: 0 };

  const earliestCreated = streakHabits.reduce((min, habit) => {
    const created = String(habit.createdAt || refDate).slice(0, 10);
    return created < min ? created : min;
  }, refDate);

  // O dia atual não deve zerar o foguinho enquanto ainda está em andamento.
  // Se hoje ainda não estiver completo, o streak vigente termina em ontem.
  const todayStatus = isDayComplete(streakHabits, completions, refDate);
  let cursor = todayStatus === true ? refDate : addDays(refDate, -1);
  let current = 0;
  let iterations = 0;

  while (iterations < 730) {
    iterations++;
    if (cursor < earliestCreated) break;
    const status = isDayComplete(streakHabits, completions, cursor);
    if (status === true) {
      current++;
      cursor = addDays(cursor, -1);
    } else if (status === null) {
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }

  let best = 0;
  let run = 0;
  let scan = earliestCreated;
  while (scan <= refDate) {
    const status = isDayComplete(streakHabits, completions, scan);
    if (status === true) {
      run++;
      best = Math.max(best, run);
    } else if (status === false) {
      run = 0;
    }
    scan = addDays(scan, 1);
  }

  let totalPerfectDays = 0;
  scan = earliestCreated;
  while (scan <= refDate) {
    if (isDayComplete(streakHabits, completions, scan) === true) totalPerfectDays++;
    scan = addDays(scan, 1);
  }

  return { current, best: Math.max(best, current), totalPerfectDays };
}

/* ---------------------------------------------------------------
   SMALL UI PRIMITIVES
----------------------------------------------------------------*/

/* ---------------------------------------------------------------
   ONBOARDING
----------------------------------------------------------------*/
function LoginView({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim() || !password) return setError("Preencha e-mail e senha.");
    if (mode === "signup") {
      const passwordError = strongPasswordError(password);
      if (passwordError) return setError(passwordError);
    }
    setLoading(true);
    try {
      const data = mode === "login"
        ? await signInWithPassword(email, password)
        : await signUpWithPassword(email, password);
      if (data?.access_token && data?.user) {
        if (!isEmailConfirmedUser(data.user)) {
          await signOutRemote(data.access_token);
          saveStoredSession(null);
          setAwaitingConfirmation(true);
          setMessage("Confirme o link enviado para seu e-mail antes de entrar no Constancce.");
          setMode("login");
          return;
        }
        saveStoredSession(data);
        onAuthenticated(data);
      } else if (mode === "signup") {
        setAwaitingConfirmation(true);
        setMessage("Conta criada. Enviamos um link de confirmação para seu e-mail. Confirme antes de entrar.");
        setMode("login");
      } else {
        setError("Não foi possível iniciar sua sessão.");
      }
    } catch (err) {
      const raw = String(err?.message || "").toLowerCase();
      if (raw.includes("supabase_not_configured")) setError("A conexão do app ainda não foi configurada neste ambiente.");
      else if (raw.includes("invalid login credentials")) setError("E-mail ou senha incorretos.");
      else if (raw.includes("already registered") || raw.includes("user already registered")) setError("Este e-mail já possui uma conta.");
      else if (raw.includes("email not confirmed")) setError("Confirme seu e-mail antes de entrar.");
      else setError("Não foi possível conectar à sua conta. Verifique os dados e a conexão.");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 5%, rgba(201,162,74,.12), transparent 34%)" }} />
      <div className="w-full max-w-md relative">
        <div className="text-center mb-7">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 overflow-hidden shadow-lg" style={{ boxShadow: "0 10px 34px color-mix(in srgb, var(--brass) 24%, transparent)" }}><img src={constancceLogo} alt="Constancce" className="w-full h-full object-cover" /></div>
          <h1 className="font-display text-3xl mb-2">Constancce</h1>
          <p className="text-dim text-sm">Você não precisa de motivação. Precisa de constância.</p>
        </div>
        <form onSubmit={submit} className="surface rounded-3xl p-5 sm:p-6">
          <div className="flex p-1 rounded-xl mb-5" style={{ background: "var(--surface-2)", border: "1px solid var(--border-soft)" }}>
            <button type="button" onClick={() => { setMode("login"); setError(""); setMessage(""); }} className="flex-1 py-2.5 rounded-lg text-sm transition" style={{ background: mode === "login" ? "var(--surface)" : "transparent", color: mode === "login" ? "var(--text)" : "var(--text-dim)" }}>Entrar</button>
            <button type="button" onClick={() => { setMode("signup"); setError(""); setMessage(""); }} className="flex-1 py-2.5 rounded-lg text-sm transition" style={{ background: mode === "signup" ? "var(--surface)" : "transparent", color: mode === "signup" ? "var(--text)" : "var(--text-dim)" }}>Criar conta</button>
          </div>
          <Field label="E-mail">
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input type="email" autoComplete="email" className="w-full py-3 pl-10 pr-3 ring-focus" placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </Field>
          <div className="h-3" />
          <Field label="Senha">
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} className="w-full py-3 pl-10 pr-11 ring-focus" placeholder={mode === "signup" ? "10+ caracteres, maiúscula, número e símbolo" : "Sua senha"} value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
          </Field>
          {error && <div className="mt-4 rounded-xl px-3 py-2.5 text-xs" style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 32%, transparent)" }}>{error}</div>}
          {message && <div className="mt-4 rounded-xl px-3 py-2.5 text-xs text-moss" style={{ background: "color-mix(in srgb, var(--moss) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--moss) 30%, transparent)" }}>{message}</div>}
          {awaitingConfirmation && email.trim() && (
            <button
              type="button"
              className="btn-ghost w-full rounded-xl py-2.5 mt-3 text-xs"
              onClick={async () => {
                setError("");
                try {
                  await resendSignupConfirmation(email);
                  setMessage("Novo link de confirmação enviado. Confira também a caixa de spam.");
                } catch (_) {
                  setError("Não foi possível reenviar agora. Aguarde um pouco e tente novamente.");
                }
              }}
            >
              Reenviar e-mail de confirmação
            </button>
          )}
          <button className="login-submit-button btn-primary w-full rounded-xl py-3 mt-5 text-sm font-semibold disabled:opacity-60" disabled={loading}>{loading ? "Aguarde…" : mode === "login" ? "Entrar na minha conta" : "Criar minha conta"}</button>
          <p className="text-faint text-[11px] text-center mt-4">Cada conta mantém hábitos, metas, treinos, dieta, finanças e progresso separados.</p>
        </form>
      </div>
    </div>
  );
}

function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("Criar disciplina");
  const [areas, setAreas] = useState(["Hábitos", "Tarefas", "Metas"]);

  const goals = [
    "Criar disciplina",
    "Organizar minha rotina",
    "Melhorar minha saúde",
    "Treinar consistentemente",
    "Organizar minhas finanças",
    "Cumprir minhas metas",
    "Melhorar minha produtividade",
  ];
  const areaOpts = ["Hábitos", "Tarefas", "Treinos", "Dieta", "Finanças", "Metas"];
  const toggleArea = (area) => setAreas((prev) => prev.includes(area) ? prev.filter((item) => item !== area) : [...prev, area]);

  const introSlides = [
    {
      eyebrow: "Bem-vindo",
      title: "Bem-vindo ao Constancce",
      description: "Sua vida organizada em um só lugar.",
      icon: Flame,
      visual: ["Rotina", "Foco", "Evolução"],
    },
    {
      eyebrow: "Sua central",
      title: "Comece pelo seu dia.",
      description: "Na aba Hoje você encontra o que precisa acompanhar e concluir.",
      icon: LayoutGrid,
      visual: ["Hoje", "Prioridades", "Progresso diário"],
    },
    {
      eyebrow: "Construa",
      title: "Construa sua rotina.",
      description: "Cadastre seus hábitos, tarefas e treinos.",
      icon: ListChecks,
      visual: ["Hábitos", "Tarefas", "Treinos"],
    },
    {
      eyebrow: "Organize",
      title: "Organize sua evolução.",
      description: "Use Finanças, Metas e Dieta conforme fizer sentido para você.",
      icon: Wallet,
      visual: ["Finanças", "Metas", "Dieta"],
    },
    {
      eyebrow: "Evolua",
      title: "Acompanhe seu progresso.",
      description: "O Constancce transforma tudo que você registra em uma visão da sua evolução.",
      icon: TrendingUp,
      visual: ["Organizar", "Executar", "Acompanhar", "Evoluir"],
    },
  ];

  const currentSlide = introSlides[step] || introSlides[0];
  const CurrentIcon = currentSlide.icon;
  const finishIntro = () => setShowSetup(true);

  const completeSetup = () => {
    if (!name.trim()) return;
    onDone({
      name: name.trim(),
      goalFocus: goal,
      areas,
      onboardingVersion: 2,
      onboardingIntroCompleted: true,
      gettingStartedDismissed: false,
      gettingStartedStartedAt: new Date().toISOString(),
      priorityAreas: areas,
      moduleVisibility: {
        habits: areas.includes("Hábitos"),
        tasks: areas.includes("Tarefas"),
        calendar: areas.includes("Tarefas"),
        goals: areas.includes("Metas"),
        workouts: areas.includes("Treinos"),
        food: areas.includes("Dieta"),
        finance: areas.includes("Finanças"),
        progress: true,
        achievements: true,
        friends: true,
        challenges: true,
        timeline: true,
        reports: true,
      },
    });
  };

  if (showSetup) {
    return (
      <div className="onboarding-shell min-h-screen flex items-center justify-center p-4 sm:p-5">
        <div className="surface rounded-3xl p-5 sm:p-7 w-full max-w-lg rise onboarding-card">
          <div className="flex items-center gap-3 mb-6">
            <img src={constancceLogo} alt="" className="w-11 h-11 rounded-xl shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[10px] text-brass uppercase tracking-[.18em]">Último passo</p>
              <h2 className="font-display text-2xl leading-tight">Deixe o Constancce com a sua cara.</h2>
            </div>
          </div>

          <Field label="Como podemos te chamar?">
            <input
              autoFocus
              className="w-full p-3 ring-focus"
              placeholder="Seu nome"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <div className="mt-5">
            <p className="text-[10px] text-faint uppercase tracking-widest mb-2">Seu principal objetivo</p>
            <div className="flex flex-wrap gap-2">
              {goals.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setGoal(item)}
                  className="rounded-full px-3 py-2 text-xs transition-colors"
                  style={{
                    border: `1px solid ${goal === item ? "var(--brass)" : "var(--border)"}`,
                    background: goal === item ? "var(--surface-2)" : "transparent",
                    color: goal === item ? "var(--text)" : "var(--text-dim)",
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-end justify-between gap-3 mb-2">
              <div>
                <p className="text-[10px] text-faint uppercase tracking-widest">Áreas que você quer acompanhar</p>
                <p className="text-[11px] text-dim mt-1">Você poderá ativar ou desativar módulos depois no Perfil.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {areaOpts.map((area) => (
                <button
                  key={area}
                  type="button"
                  onClick={() => toggleArea(area)}
                  className="text-left px-3 py-3 rounded-xl text-sm transition-colors"
                  style={{
                    border: `1px solid ${areas.includes(area) ? "var(--brass)" : "var(--border)"}`,
                    background: areas.includes(area) ? "var(--surface-2)" : "transparent",
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] shrink-0"
                      style={{
                        border: `1px solid ${areas.includes(area) ? "var(--brass)" : "var(--border)"}`,
                        color: areas.includes(area) ? "var(--brass)" : "var(--text-faint)",
                      }}
                    >
                      {areas.includes(area) ? "✓" : ""}
                    </span>
                    {area}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={!name.trim()}
            className="btn-primary w-full rounded-xl py-3.5 mt-6 text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2"
            onClick={completeSetup}
          >
            Entrar no Constancce
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className="btn-ghost w-full rounded-xl py-2.5 mt-2 text-xs"
            onClick={() => setShowSetup(false)}
          >
            Voltar para a introdução
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-shell min-h-screen flex items-center justify-center p-4 sm:p-5 relative overflow-hidden">
      <div className="onboarding-glow onboarding-glow-one" aria-hidden="true" />
      <div className="onboarding-glow onboarding-glow-two" aria-hidden="true" />

      <div className="surface rounded-3xl p-5 sm:p-7 w-full max-w-md rise onboarding-card relative z-10">
        <div className="flex items-center justify-between gap-3 mb-7">
          <div className="flex items-center gap-2">
            <img src={constancceLogo} alt="" className="w-8 h-8 rounded-lg" aria-hidden="true" />
            <span className="font-display text-lg">Constancce</span>
          </div>
          <span className="text-[10px] text-faint font-mono">{step + 1} / {introSlides.length}</span>
        </div>

        <div className="flex items-center gap-2 mb-7" aria-label={`Etapa ${step + 1} de ${introSlides.length}`}>
          {introSlides.map((slide, index) => (
            <div key={slide.title} className="track flex-1" style={{ height: 4 }}>
              <div
                className="fill h-full"
                style={{
                  width: index <= step ? "100%" : "0%",
                  transition: "width 300ms ease",
                }}
              />
            </div>
          ))}
        </div>

        <div key={step} className="rise">
          <div className="onboarding-hero-icon mb-6">
            <CurrentIcon size={34} strokeWidth={2.2} />
          </div>
          <p className="text-[10px] text-brass uppercase tracking-[.2em] mb-2">{currentSlide.eyebrow}</p>
          <h2 className="font-display text-3xl sm:text-[2rem] leading-[1.05] mb-3">{currentSlide.title}</h2>
          <p className="text-dim text-[15px] leading-relaxed min-h-[3rem]">{currentSlide.description}</p>

          <div className="onboarding-visual mt-7">
            {currentSlide.visual.map((item, index) => (
              <div key={item} className="onboarding-visual-chip">
                <span className="onboarding-visual-index">{String(index + 1).padStart(2, "0")}</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          {step === 4 && (
            <div className="surface-2 rounded-2xl p-4 mt-5" style={{ border: "1px solid var(--border)" }}>
              <p className="text-[10px] text-faint uppercase tracking-widest mb-2">A lógica é simples</p>
              <p className="text-sm leading-relaxed">
                <span className="text-brass">Organizar</span> → Executar → Acompanhar → <span className="text-moss">Evoluir</span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-[auto_1fr] gap-2 mt-7">
            <button
              type="button"
              className="btn-ghost rounded-xl px-4 py-3 text-sm disabled:opacity-30"
              disabled={step === 0}
              onClick={() => setStep((value) => Math.max(0, value - 1))}
              aria-label="Voltar"
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              className="btn-primary rounded-xl py-3 text-sm font-semibold inline-flex items-center justify-center gap-2"
              onClick={() => {
                if (step < introSlides.length - 1) setStep((value) => value + 1);
                else finishIntro();
              }}
            >
              {step < introSlides.length - 1 ? "Continuar" : "Personalizar meu Constancce"}
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   DASHBOARD
----------------------------------------------------------------*/
function Dashboard({ profile, setProfile, habits, completions, tasks, toggleHabit, streaks, setView, onQuickStart, workoutTemplates, workoutSessions, mealLog, transactions, goals, goalProgressLog, game, stats, isPro, onUpgrade }) {
  const [showStreakInfo, setShowStreakInfo] = useState(false);
  const t = today();
  const usedToday = (profile?.appUsageDays || []).includes(t);
  const validHabitsToday = habits.filter((h) => habitValidOnDate(h, t, completions));
  const doneIds = new Set(completions.filter((c) => c.date === t).map((c) => c.habitId));
  const habitsDone = validHabitsToday.filter((h) => doneIds.has(h.id)).length;

  const allTasksToday = tasks
    .filter((tk) => taskOccursOnDate(tk, t))
    .sort((a, b) => (a.taskTime || "99:99").localeCompare(b.taskTime || "99:99"));
  const tasksToday = allTasksToday.filter((tk) => !taskDoneOnDate(tk, t));
  const tasksDoneToday = allTasksToday.filter((tk) => taskDoneOnDate(tk, t)).length;

  const totalToday = validHabitsToday.length + allTasksToday.length;
  const completedToday = habitsDone + tasksDoneToday;
  const pct = totalToday === 0 ? 0 : Math.round((completedToday / totalToday) * 100);
  const performance = getDayPerformance(t, habits, completions, tasks, workoutSessions, mealLog, goalProgressLog);
  const score = performance.score;
  const workoutToday = workoutSessions.some((s) => s.date === t && s.completed);
  const scheduledWorkout = workoutTemplates.find((tp) => (tp.scheduleDays || []).includes(weekdayIndex(t)));
  const kcalToday = mealLog.filter((m) => m.date === t && dietMealConsumed(m)).reduce((s, m) => s + Number(m.calories || 0), 0);
  const spentToday = transactions.filter((tx) => tx.date === t && tx.type === "saida").reduce((s, tx) => s + Number(tx.value || 0), 0);

  const currentMonth = monthKey(t);
  const monthTx = transactions.filter((tx) => monthKey(tx.date) === currentMonth);
  const monthIn = monthTx.filter((tx) => tx.type === "entrada").reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const monthOut = monthTx.filter((tx) => tx.type === "saida").reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const monthlyLimit = Number(profile?.monthlyLimit ?? 3000);
  const availableMonth = Math.max(0, monthlyLimit - monthOut);

  const pendingHabits = validHabitsToday.filter((h) => !doneIds.has(h.id));
  const nextTask = tasksToday[0];
  const nextAction = nextTask || pendingHabits[0];

  const pendingBills = (profile?.financeBills || [])
    .filter((bill) => bill.status !== "pago")
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const nextBill = pendingBills[0];

  const goalAttention = goals
    .filter((g) => !g.completed && !g.archived)
    .map((g) => ({ ...g, daysLeft: daysUntil(g.endDate) }))
    .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999))
    .slice(0, 2);
  const dashboardPrimaryGoal =
    goals.find((goal) => goal.isPrimary && !goal.completed && !goal.archived) ||
    goalAttention[0] ||
    null;

  const last7Dates = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const weekScores = last7Dates.map((date) => getDayPerformance(date, habits, completions, tasks, workoutSessions, mealLog, goalProgressLog).score);
  const weekAvg = Math.round(weekScores.reduce((a, b) => a + b, 0) / Math.max(1, weekScores.length));

  const weekGridRows = [
    {
      id: "habits",
      label: "Hábitos",
      cells: last7Dates.map((date) => {
        const valid = habits.filter((h) => habitValidOnDate(h, date, completions));
        if (valid.length === 0) return { na: true };
        const done = valid.filter((h) => completions.some((c) => c.habitId === h.id && c.date === date)).length;
        return { ratio: done / valid.length, title: `${done}/${valid.length} hábitos concluídos` };
      }),
    },
    {
      id: "tasks",
      label: "Tarefas",
      cells: last7Dates.map((date) => {
        const dayTasks = tasks.filter((tk) => taskOccursOnDate(tk, date));
        if (dayTasks.length === 0) return { na: true };
        const done = dayTasks.filter((tk) => taskDoneOnDate(tk, date)).length;
        return { ratio: done / dayTasks.length, title: `${done}/${dayTasks.length} tarefas concluídas` };
      }),
    },
    {
      id: "workout",
      label: "Treino",
      cells: last7Dates.map((date) => {
        const scheduled = workoutTemplates.some((tp) => (tp.scheduleDays || []).includes(weekdayIndex(date)));
        const done = workoutSessions.some((s) => s.date === date && s.completed);
        if (!scheduled && !done) return { na: true };
        return { ratio: done ? 1 : 0, title: done ? "Treino concluído" : "Treino não realizado" };
      }),
    },
  ];
  const weekWorkouts = workoutSessions.filter((s) => s.completed && s.date >= last7Dates[0] && s.date <= t).length;
  const weekTasks = tasks.filter((task) => {
    if (isRecurringTask(task)) return (task.completionDates || []).some((date) => date >= last7Dates[0] && date <= t);
    return task.status === "concluida" && (task.completedAt || task.dueDate || "") >= last7Dates[0];
  }).length;

  const previous7Dates = Array.from({ length: 7 }, (_, i) => addDays(t, i - 13));
  const previousWeekWorkouts = workoutSessions.filter((s) => s.completed && s.date >= previous7Dates[0] && s.date <= previous7Dates[6]).length;
  const previousWeekTasks = tasks.filter((task) => {
    if (isRecurringTask(task)) return (task.completionDates || []).some((date) => date >= previous7Dates[0] && date <= previous7Dates[6]);
    const completedDate = task.completedAt || task.dueDate || "";
    return task.status === "concluida" && completedDate >= previous7Dates[0] && completedDate <= previous7Dates[6];
  }).length;

  const selectedPriorityAreas = Array.isArray(profile?.priorityAreas) ? profile.priorityAreas : [];
  const setupCandidates = [
    { id: "habits", area: "Hábitos", label: "Crie seu primeiro hábito", done: habits.length > 0, view: "habits" },
    { id: "tasks", area: "Tarefas", label: "Adicione uma tarefa", done: tasks.length > 0, view: "tasks" },
    { id: "workouts", area: "Treinos", label: "Configure seu primeiro treino", done: workoutTemplates.length > 0, view: "workouts" },
    { id: "goals", area: "Metas", label: "Defina uma meta", done: goals.length > 0, view: "goals" },
  ];
  const setupItems = [
    { id: "today", label: "Conheça sua tela Hoje", done: Boolean(profile?.onboardingIntroCompleted), view: "dashboard" },
    ...setupCandidates.filter((item) => selectedPriorityAreas.length === 0 || selectedPriorityAreas.includes(item.area)),
  ];
  const setupDone = setupItems.filter((item) => item.done).length;
  const setupComplete = setupDone === setupItems.length;
  const showGettingStarted = !setupComplete && profile?.gettingStartedDismissed !== true;

  const dailySummaryParts = [];
  if (validHabitsToday.length) dailySummaryParts.push(`${habitsDone} de ${validHabitsToday.length} hábitos`);
  if (allTasksToday.length) dailySummaryParts.push(`${tasksDoneToday} de ${allTasksToday.length} tarefas`);
  if (scheduledWorkout) dailySummaryParts.push(workoutToday ? "treino concluído" : "treino ainda pendente");
  const dailyHumanSummary = dailySummaryParts.length
    ? `Hoje você registrou ${dailySummaryParts.join(", ")}. Seu progresso do dia está em ${pct}%.`
    : "Seu dia ainda está em branco. Comece com uma tarefa ou um hábito simples e deixe o Constancce montar a leitura com você.";

  const workoutDelta = weekWorkouts - previousWeekWorkouts;
  const taskDelta = weekTasks - previousWeekTasks;
  const weeklyHumanSummary = [
    workoutDelta === 0
      ? `Você manteve ${weekWorkouts} treino${weekWorkouts === 1 ? "" : "s"} em relação à semana anterior.`
      : `Você fez ${Math.abs(workoutDelta)} treino${Math.abs(workoutDelta) === 1 ? "" : "s"} ${workoutDelta > 0 ? "a mais" : "a menos"} que na semana anterior.`,
    taskDelta === 0
      ? `Seu ritmo de tarefas ficou estável em ${weekTasks} conclusão${weekTasks === 1 ? "" : "ões"}.`
      : `Você concluiu ${Math.abs(taskDelta)} tarefa${Math.abs(taskDelta) === 1 ? "" : "s"} ${taskDelta > 0 ? "a mais" : "a menos"} que na semana anterior.`,
  ].join(" ");

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const commandTitle = hour >= 18 ? "Fechamento do seu dia" : "Seu comando central de hoje";

  return (
    <div className="flex flex-col gap-5">
      <div className="surface rounded-2xl p-5 md:p-7" style={{ borderColor: "color-mix(in srgb, var(--brass) 20%, var(--border))" }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-dim text-sm">{greeting}, {profile?.name || "visitante"}.</p>
            <h2 className="font-display text-2xl md:text-3xl mt-1">{commandTitle}</h2>
            <p className="text-faint text-xs mt-1">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
            {selectedPriorityAreas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                <span className="text-[9px] text-faint uppercase tracking-widest self-center mr-1">Seu foco</span>
                {selectedPriorityAreas.slice(0, 4).map((area) => <span key={area} className="chip text-[9px]">{area}</span>)}
              </div>
            )}
          </div>
          <button
            type="button"
            className="surface-2 px-3 py-2 flex items-center gap-2 shrink-0"
            onClick={() => setShowStreakInfo(true)}
            aria-label={`Ver detalhes do streak atual de ${streaks.current} dias`}
          >
            <Flame size={16} className="text-ember" />
            <span className="font-mono text-sm">{streaks.current}d</span>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-5">
          <div className="surface-2 rounded-xl p-3">
            <p className="text-[9px] text-faint uppercase tracking-widest">Score</p>
            <p className="font-display text-xl mt-1 text-brass">{score}/100</p>
          </div>
          <div className="surface-2 rounded-xl p-3">
            <p className="text-[9px] text-faint uppercase tracking-widest">Atividades</p>
            <p className="font-display text-xl mt-1">{completedToday}/{totalToday}</p>
          </div>
          <div className="surface-2 rounded-xl p-3">
            <p className="text-[9px] text-faint uppercase tracking-widest">Treino</p>
            <p className={`font-display text-sm mt-1 ${workoutToday ? "text-moss" : "text-dim"}`}>{workoutToday ? "Concluído" : scheduledWorkout ? scheduledWorkout.name : "Sem programação"}</p>
          </div>
          <div className="surface-2 rounded-xl p-3">
            <p className="text-[9px] text-faint uppercase tracking-widest">Disponível no mês</p>
            <p className="font-display text-sm mt-1">{money(availableMonth)}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5"><span className="text-dim">Dia concluído</span><span className="font-mono text-brass">{pct}%</span></div>
          <Progress value={pct} height={8} />
        </div>
      </div>

      {showGettingStarted && (
        <div className="surface rounded-2xl p-4 md:p-5" style={{ borderColor: "var(--brass-dim)" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Flame size={16} className="text-brass" />
                <p className="text-[10px] text-brass uppercase tracking-widest">Comece por aqui</p>
              </div>
              <p className="font-display text-xl mt-1">Configure seu Constancce</p>
              <p className="text-xs text-dim mt-1">Complete os primeiros passos para transformar o app na sua central diária.</p>
            </div>
            <span className="chip font-mono shrink-0">{setupDone}/{setupItems.length}</span>
          </div>

          <div className="mt-4 mb-3"><Progress value={(setupDone / setupItems.length) * 100} height={6} /></div>

          <div className="flex flex-col gap-2">
            {setupItems.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.done}
                onClick={() => {
                  if (item.id === "today") {
                    setProfile((current) => ({ ...current, onboardingIntroCompleted: true }));
                    return;
                  }
                  onQuickStart?.(item.view);
                }}
                className="surface-2 rounded-xl p-3 flex items-center gap-3 text-left disabled:opacity-80"
              >
                {item.done ? <CheckCircle2 size={17} className="text-moss shrink-0" /> : <Circle size={17} className="text-faint shrink-0" />}
                <span className={`text-sm flex-1 ${item.done ? "text-dim" : ""}`}>{item.label}</span>
                {!item.done && <ChevronRight size={15} className="text-brass shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {setupComplete && profile?.gettingStartedDismissed !== true && (
        <div className="surface-2 rounded-2xl p-4 flex items-center justify-between gap-3" style={{ borderColor: "var(--moss)" }}>
          <div>
            <p className="font-display text-lg">Tudo pronto. Agora é constância. 🔥</p>
            <p className="text-xs text-dim mt-1">Sua base está configurada. A partir daqui, use a aba Hoje como seu ponto de partida.</p>
          </div>
          <button className="btn-ghost rounded-xl px-3 py-2 text-xs" onClick={() => setProfile({ ...profile, gettingStartedDismissed: true })}>Fechar</button>
        </div>
      )}

      {nextAction && (
        <div className="surface-2 rounded-2xl p-4 md:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[10px] text-faint uppercase tracking-widest">Próxima ação</p>
            <div className="flex items-center gap-2 mt-1">
              {nextTask?.taskTime && <span className="chip font-mono">{nextTask.taskTime}</span>}
              <p className="font-display text-xl break-words">{nextAction.name || nextAction.title}</p>
            </div>
          </div>
          <button className="btn-primary rounded-xl px-4 py-2 text-sm" onClick={() => setView(nextAction.name ? "habits" : "tasks")}>Começar agora</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="surface rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div><p className="text-xs text-faint uppercase tracking-widest">Agenda de hoje</p><p className="text-dim text-xs mt-1">Tarefas ordenadas pelo horário.</p></div>
            <button className="text-xs text-brass" onClick={() => setView("tasks")}>Abrir tarefas</button>
          </div>
          <div className="flex flex-col gap-2">
            {allTasksToday.length === 0 && <p className="text-dim text-sm py-3">Seu dia ainda não tem tarefas. Adicione uma prioridade para transformar esta área na sua agenda de execução.</p>}
            {allTasksToday.slice(0, 7).map((task) => {
              const done = taskDoneOnDate(task, t);
              return (
                <div key={task.id} className="surface-2 rounded-xl p-3 flex items-center gap-3">
                  <span className="font-mono text-xs text-brass w-11 shrink-0">{task.taskTime || "—"}</span>
                  {done ? <CheckCircle2 size={16} className="text-moss" /> : <Circle size={16} className="text-faint" />}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm break-words block" style={{ textDecoration: done ? "line-through" : "none", color: done ? "var(--text-dim)" : "var(--text)" }}>{task.title}</span>
                    {(task.description || (task.subtasks || []).length > 0) && (
                      <p className="text-[9px] text-faint mt-0.5">
                        {task.description ? "com descrição" : ""}
                        {task.description && (task.subtasks || []).length > 0 ? " · " : ""}
                        {(task.subtasks || []).length > 0 ? `${(task.subtasks || []).length} subtarefa(s)` : ""}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="surface rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div><p className="text-xs text-faint uppercase tracking-widest">Rotina pendente</p><p className="text-dim text-xs mt-1">Hábitos que ainda dependem de você hoje.</p></div>
            <button className="text-xs text-brass" onClick={() => setView("habits")}>Abrir hábitos</button>
          </div>
          <div className="flex flex-col gap-2">
            {pendingHabits.length === 0 && <p className="text-moss text-sm py-3">Hábitos de hoje concluídos.</p>}
            {pendingHabits.slice(0, 7).map((habit) => (
              <button key={habit.id} onClick={() => toggleHabit(habit.id, t)} className="surface-2 rounded-xl p-3 flex items-center gap-3 text-left">
                <Circle size={16} className="text-faint shrink-0" />
                <span className="text-sm flex-1 min-w-0 break-words">{habit.name}</span>
                <span className="chip text-[9px] shrink-0">{catLabel(habit.category)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {(scheduledWorkout || nextBill || dashboardPrimaryGoal) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button className="surface rounded-2xl p-4 text-left" onClick={() => setView("workouts")}>
            <Dumbbell size={18} className="text-brass mb-3" />
            <p className="text-[10px] text-faint uppercase tracking-widest">Treino do dia</p>
            <p className="font-medium text-sm mt-1">{scheduledWorkout?.name || "Nenhum treino programado"}</p>
            <p className="text-faint text-[10px] mt-1">{workoutToday ? "Concluído hoje" : scheduledWorkout ? "Aguardando execução" : "Cadastre sua ficha e escolha os dias para ela aparecer aqui"}</p>
          </button>

          <button className="surface rounded-2xl p-4 text-left" onClick={() => setView("finance")}>
            <Wallet size={18} className="text-brass mb-3" />
            <p className="text-[10px] text-faint uppercase tracking-widest">Próxima conta</p>
            <p className="font-medium text-sm mt-1">{nextBill?.description || "Nenhuma pendente"}</p>
            <p className="text-faint text-[10px] mt-1">{nextBill ? `${money(nextBill.value)} · ${dateLabel(nextBill.dueDate)}` : `${money(monthOut)} gastos no mês`}</p>
          </button>

          <button className="dashboard-primary-goal surface rounded-2xl p-4 text-left" onClick={() => setView("goals")}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <Target size={18} className="text-brass" />
              {dashboardPrimaryGoal?.isPrimary && <span className="chip text-brass"><Star size={9} /> principal</span>}
            </div>
            <p className="text-[10px] text-faint uppercase tracking-widest">Meta em foco</p>
            <p className="font-medium text-sm mt-1 break-words">{dashboardPrimaryGoal?.name || "Defina para onde você quer ir"}</p>
            {dashboardPrimaryGoal ? (
              <>
                <div className="flex items-center justify-between gap-2 mt-2 mb-1.5">
                  <span className="text-faint text-[9px]">
                    {goalValueLabel(dashboardPrimaryGoal, dashboardPrimaryGoal.current)} de {goalValueLabel(dashboardPrimaryGoal, dashboardPrimaryGoal.target)}
                  </span>
                  <span className="font-mono text-[10px] text-brass">{goalProgressPercent(dashboardPrimaryGoal)}%</span>
                </div>
                <Progress value={goalProgressPercent(dashboardPrimaryGoal)} height={4} />
                <p className="text-faint text-[9px] mt-2 break-words">
                  {dashboardPrimaryGoal.nextAction
                    ? `Próxima ação: ${dashboardPrimaryGoal.nextAction}`
                    : `${goalValueLabel(dashboardPrimaryGoal, Math.max(0, Number(dashboardPrimaryGoal.target || 0) - Number(dashboardPrimaryGoal.current || 0)))} restantes`}
                </p>
              </>
            ) : (
              <p className="text-faint text-[10px] mt-1">Crie uma meta para acompanhar</p>
            )}
          </button>
        </div>
      )}

      {(hour >= 18 || pct === 100) && (
        <div className="surface rounded-2xl p-4 md:p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className={pct === 100 ? "text-moss" : "text-brass"} />
            <div>
              <p className="text-[10px] text-faint uppercase tracking-widest">Resumo do dia</p>
              <p className="text-sm leading-relaxed mt-1">{dailyHumanSummary}</p>
              <p className="text-xs text-dim mt-2">{pct >= 80 ? "Você fechou o dia com um ritmo forte. Amanhã, repita o que funcionou." : "Ainda dá para melhorar o fechamento de hoje com uma pequena próxima ação."}</p>
            </div>
          </div>
        </div>
      )}

      {isPro ? (
        <div className="surface rounded-2xl p-4 md:p-5" style={{ borderColor: "var(--brass-dim)" }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-brass" />
                <p className="text-xs text-faint uppercase tracking-widest">Constancce Intelligence</p>
                <ProBadge compact />
              </div>
              <p className="text-dim text-xs mt-1">Leituras automáticas do que merece sua atenção agora.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(stats?.insights || []).slice(0, 3).map((insight, index) => (
              <div key={index} className="surface-2 rounded-xl p-3 text-xs leading-relaxed">
                <span className="font-mono text-brass mr-1">0{index + 1}</span> {insight}
              </div>
            ))}
            {(!stats?.insights || stats.insights.length === 0) && (
              <div className="surface-2 rounded-xl p-3 text-xs text-dim md:col-span-3">Continue registrando sua rotina para gerar análises mais precisas.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="surface rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-brass" />
                <p className="text-xs text-faint uppercase tracking-widest">Prévia Intelligence de hoje</p>
              </div>
              <p className="text-[10px] text-faint mt-1">1 leitura gratuita por dia para você experimentar o PRO.</p>
            </div>
            <ProBadge compact />
          </div>

          <div className="surface-2 rounded-xl p-3 text-sm leading-relaxed">
            {(stats?.insights || [])[0] || "Continue registrando sua rotina hoje para gerar sua primeira leitura automática."}
          </div>

          <button className="text-xs text-brass font-medium mt-3" onClick={() => onUpgrade("intelligence")}>
            Liberar todas as análises PRO
          </button>
        </div>
      )}

      <div>
        <div className="flex items-end justify-between mb-2"><div><p className="text-xs text-faint uppercase tracking-widest">Missões</p><p className="text-dim text-xs">Objetivos de hoje e desta semana</p></div><span className="chip">+ XP bônus</span></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {game.missions.map((m) => <div key={m.id} className="surface rounded-2xl p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium text-sm">{m.title}</p><p className="text-faint text-xs">{m.scope} · +{m.xp} XP</p></div>{m.done ? <CheckCircle2 size={20} className="text-moss" /> : <span className="font-mono text-xs text-dim">{m.current}/{m.target}</span>}</div><div className="mt-3"><Progress value={Math.min(100,(m.current/m.target)*100)} height={6} tone={m.done ? "moss" : "fill"} /></div></div>)}
        </div>
      </div>

      <div className="surface rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs text-faint uppercase tracking-widest">Revisão dos últimos 7 dias</p>
            <p className="font-display text-2xl mt-1">Score médio {weekAvg}/100</p>
          </div>
          <Sparkles size={20} className="text-brass" />
        </div>

        <div className="habit-grid-scroll mb-4">
          <table className="habit-grid-table">
            <thead>
              <tr>
                <th className="habit-grid-name-col text-left" />
                {last7Dates.map((date) => (
                  <th key={date} className={`habit-grid-day-head font-mono ${date === t ? "habit-grid-today" : ""}`}>
                    {WEEKDAYS[weekdayIndex(date)][0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weekGridRows.map((row) => (
                <tr key={row.id}>
                  <td className="habit-grid-name-col"><span className="text-xs font-medium">{row.label}</span></td>
                  {row.cells.map((cell, index) => (
                    <td key={index} className={`habit-grid-cell-wrap ${last7Dates[index] === t ? "habit-grid-today" : ""}`}>
                      <div
                        className="habit-grid-cell"
                        title={cell.na ? "Sem programação" : cell.title}
                        style={{
                          background: cell.na
                            ? "transparent"
                            : `color-mix(in srgb, var(--moss) ${Math.round(cell.ratio * 100)}%, var(--surface-2))`,
                          border: cell.na
                            ? "1px dashed var(--border-soft)"
                            : cell.ratio > 0
                              ? "1px solid var(--moss)"
                              : "1px solid var(--border)",
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="surface-2 rounded-xl p-3"><p className="text-[9px] text-faint uppercase">Tarefas</p><p className="font-mono mt-1">{weekTasks}</p></div>
          <div className="surface-2 rounded-xl p-3"><p className="text-[9px] text-faint uppercase">Treinos</p><p className="font-mono mt-1">{weekWorkouts}</p></div>
          <div className="surface-2 rounded-xl p-3"><p className="text-[9px] text-faint uppercase">Streak</p><p className="font-mono mt-1">{streaks.current}d</p></div>
        </div>
        <div className="surface-2 rounded-xl p-3">
          <p className="text-[9px] text-faint uppercase tracking-widest">O que isso significa</p>
          <p className="text-sm leading-relaxed mt-1">{weeklyHumanSummary}</p>
        </div>
      </div>

      <div>
        <p className="text-xs text-faint uppercase tracking-widest mb-2">Resumo rápido</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatMini label="Hábitos" value={`${habitsDone}/${validHabitsToday.length}`} />
          <StatMini label="Tarefas" value={`${tasksDoneToday}/${allTasksToday.length}`} />
          <StatMini label="Treino" value={workoutToday ? "Concluído" : "Pendente"} />
          <StatMini label="Dieta" value={`${kcalToday} kcal`} />
          <StatMini label="Gastos hoje" value={money(spentToday)} />
          <StatMini label="XP total" value={game.xp.toLocaleString("pt-BR")} />
        </div>
      </div>

      {showStreakInfo && (
        <Modal title="Sua sequência de uso" onClose={() => setShowStreakInfo(false)} width={500}>
          <div className="grid grid-cols-3 gap-2">
            <div className="surface-2 rounded-xl p-3 text-center">
              <p className="text-faint text-[10px] uppercase tracking-widest">Atual</p>
              <p className="font-display text-2xl text-ember mt-1">{streaks.current}d</p>
            </div>
            <div className="surface-2 rounded-xl p-3 text-center">
              <p className="text-faint text-[10px] uppercase tracking-widest">Recorde</p>
              <p className="font-display text-2xl text-brass mt-1">{streaks.best}d</p>
            </div>
            <div className="surface-2 rounded-xl p-3 text-center">
              <p className="text-faint text-[10px] uppercase tracking-widest">Dias ativos</p>
              <p className="font-display text-2xl mt-1">{streaks.totalActiveDays}</p>
            </div>
          </div>

          <div className="surface-2 rounded-xl p-4 mt-3">
            <p className="text-[10px] text-faint uppercase tracking-widest">Como o foguinho conta</p>
            <p className="text-sm text-dim leading-relaxed mt-2">
              Cada dia em que você abre e usa o Constancce conta para esta sequência. Você não precisa concluir todos os hábitos para manter o foguinho — basta voltar ao app em dias consecutivos.
            </p>
          </div>

          <div className="surface-2 rounded-xl p-4 mt-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] text-faint uppercase tracking-widest">Hoje</p>
                <p className="text-sm mt-1">
                  {usedToday
                    ? "Sua presença de hoje já foi registrada."
                    : "Registrando sua presença de hoje…"}
                </p>
              </div>
              {usedToday
                ? <CheckCircle2 size={22} className="text-moss shrink-0" />
                : <Flame size={22} className="text-ember shrink-0" />}
            </div>
          </div>

          <div className="surface-2 rounded-xl p-4 mt-3">
            <p className="text-[10px] text-faint uppercase tracking-widest">Streak de hábitos</p>
            <p className="text-sm text-dim leading-relaxed mt-2">
              A sequência de hábitos continua sendo calculada separadamente para suas estatísticas de disciplina, conquistas e evolução. Este foguinho da tela Hoje representa somente a sua constância em voltar ao Constancce.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   HABITS
----------------------------------------------------------------*/
function HabitForm({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [category, setCategory] = useState(initial?.category || "saude");
  const [freqType, setFreqType] = useState(initial?.frequency?.type || "daily");
  const [days, setDays] = useState(initial?.frequency?.days || []);
  const [target, setTarget] = useState(initial?.frequency?.target || 3);
  const [countsForStreak, setCountsForStreak] = useState(initial?.countsForStreak ?? true);
  const [checklist, setChecklist] = useState(initial?.checklist || []);
  const [confirm, confirmDialog] = useConfirm();
  const addChecklistItem = () => setChecklist((prev) => [...prev, { id: uid(), text: "" }]);
  const updateChecklistItem = (id, text) => setChecklist((prev) => prev.map((x) => x.id === id ? { ...x, text } : x));
  const removeChecklistItem = async (id) => { if (!(await confirm("Tem certeza que deseja remover esta etapa?"))) return; setChecklist((prev) => prev.filter((x) => x.id !== id)); };
  const toggleDay = (d) => setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());

  return (
    <Modal title={initial ? "Editar hábito" : "Novo hábito"} onClose={onClose}>
      <Field label="Nome"><input className="w-full p-3 ring-focus" placeholder="Ex: Ler 20 minutos" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Categoria">
        <select className="w-full p-3 ring-focus" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Frequência">
        <div className="flex gap-2 flex-wrap">
          {[["daily", "Todos os dias"], ["weekdays", "Dias específicos"], ["perweek", "X por semana"], ["permonth", "X por mês"]].map(([id, label]) => (
            <button key={id} onClick={() => setFreqType(id)} className="px-3 py-1.5 rounded-full text-sm"
              style={{ border: `1px solid ${freqType === id ? "var(--brass)" : "var(--border)"}`, background: freqType === id ? "var(--surface-2)" : "transparent" }}>
              {label}
            </button>
          ))}
        </div>
      </Field>
      {freqType === "weekdays" && (
        <Field label="Dias da semana">
          <div className="flex gap-1.5">
            {WEEKDAYS.map((w, i) => (
              <button key={i} onClick={() => toggleDay(i)} className="w-9 h-9 rounded-full text-xs font-mono"
                style={{ border: `1px solid ${days.includes(i) ? "var(--brass)" : "var(--border)"}`, background: days.includes(i) ? "var(--brass)" : "transparent", color: days.includes(i) ? "#141208" : "var(--text-dim)" }}>
                {w[0]}
              </button>
            ))}
          </div>
        </Field>
      )}
      {(freqType === "perweek" || freqType === "permonth") && (
        <Field label={freqType === "perweek" ? "Quantas vezes por semana" : "Quantas vezes por mês"}>
          <input type="number" min={1} className="w-full p-3 ring-focus" value={target} onChange={(e) => setTarget(Number(e.target.value))} />
        </Field>
      )}
      <Field label="Conta para a sequência?">
        <div className="flex gap-2">
          <button onClick={() => setCountsForStreak(true)} className="px-4 py-1.5 rounded-full text-sm" style={{ border: `1px solid ${countsForStreak ? "var(--brass)" : "var(--border)"}`, background: countsForStreak ? "var(--surface-2)" : "transparent" }}>Sim</button>
          <button onClick={() => setCountsForStreak(false)} className="px-4 py-1.5 rounded-full text-sm" style={{ border: `1px solid ${!countsForStreak ? "var(--brass)" : "var(--border)"}`, background: !countsForStreak ? "var(--surface-2)" : "transparent" }}>Não</button>
        </div>
      </Field>
      <Field label="Checklist do hábito (opcional)">
        <div className="flex flex-col gap-2">
          {checklist.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2">
              <Circle size={16} className="text-faint shrink-0" />
              <input className="flex-1 p-2.5 text-sm ring-focus" placeholder={`Etapa ${i + 1}`} value={item.text} onChange={(e) => updateChecklistItem(item.id, e.target.value)} />
              <button className="btn-ghost rounded-lg p-2" onClick={() => removeChecklistItem(item.id)}><X size={14} /></button>
            </div>
          ))}
          <button className="btn-ghost rounded-xl py-2 text-sm flex items-center justify-center gap-1" onClick={addChecklistItem}><Plus size={14} /> Adicionar etapa</button>
        </div>
      </Field>
      <button disabled={!name.trim() || (freqType === "weekdays" && days.length === 0)} className="btn-primary w-full rounded-xl py-3 mt-2 disabled:opacity-40"
        onClick={() => onSave({
          id: initial?.id || uid(), name: name.trim(), category, countsForStreak, checklist: checklist.filter((x) => x.text.trim()).map((x) => ({ ...x, text: x.text.trim() })),
          frequency: { type: freqType, days: freqType === "weekdays" ? days : undefined, target: (freqType === "perweek" || freqType === "permonth") ? target : undefined },
          active: initial?.active ?? true, createdAt: initial?.createdAt || today(),
        })}>
        Salvar hábito
      </button>
      {confirmDialog}
    </Modal>
  );
}

function HabitsView({ habits, completions, toggleHabit, saveHabit, deleteHabit, toggleActive, habitChecklistLog, toggleHabitChecklist, autoOpen, isPro, onUpgrade }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [monthCursor, setMonthCursor] = useState(today().slice(0, 7));
  const [checklistCell, setChecklistCell] = useState(null); // { habitId, dateStr }

  useEffect(() => {
    if (autoOpen) {
      setEditing(null);
      setShowForm(true);
    }
  }, [autoOpen]);

  const t = today();
  const [cursorYear, cursorMonth] = monthCursor.split("-").map(Number);
  const daysInMonth = new Date(cursorYear, cursorMonth, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => index + 1);
  const dateForDay = (day) => `${monthCursor}-${String(day).padStart(2, "0")}`;
  const monthLabel = new Date(cursorYear, cursorMonth - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthLabelDisplay = capitalizeFirst(monthLabel);
  const moveMonth = (direction) => {
    const next = new Date(cursorYear, cursorMonth - 1 + direction, 1);
    setMonthCursor(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };

  const activeHabits = habits.filter((habit) => habit.active !== false);
  const sortedHabits = [...habits].sort((a, b) =>
    Number(a.active === false) - Number(b.active === false) || a.name.localeCompare(b.name, "pt-BR")
  );

  const habitMonthRate = (habit) => {
    let validDays = 0;
    let completedDays = 0;
    for (const day of days) {
      const dateStr = dateForDay(day);
      if (dateStr > t) break;
      if (!habitValidOnDate(habit, dateStr, completions)) continue;
      validDays += 1;
      if (completions.some((completion) => completion.habitId === habit.id && completion.date === dateStr)) completedDays += 1;
    }
    return validDays ? Math.round(completedDays / validDays * 100) : 0;
  };

  const chartData = days
    .filter((day) => dateForDay(day) <= t)
    .map((day) => {
      const dateStr = dateForDay(day);
      const valid = habits.filter((habit) => habitValidOnDate(habit, dateStr, completions));
      if (!valid.length) return null;
      const doneIdsForDay = new Set(completions.filter((completion) => completion.date === dateStr).map((completion) => completion.habitId));
      return { day, value: Math.round(valid.filter((habit) => doneIdsForDay.has(habit.id)).length / valid.length * 100) };
    })
    .filter(Boolean)
    .map((point, index, arr) => ({
      label: index === 0 || index === arr.length - 1 || point.day % 5 === 0 ? String(point.day) : "",
      value: point.value,
    }));

  const activeChecklistHabit = checklistCell ? habits.find((habit) => habit.id === checklistCell.habitId) : null;

  return (
    <div className="habits-view flex flex-col gap-4 md:gap-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl md:text-3xl">Hábitos</h2>
            {!isPro && <span className="chip">{activeHabits.length}/{PRO_LIMITS.habits} ativos Free</span>}
          </div>
          <p className="text-dim text-sm mt-1">Construa constância diária sem perder de vista sua evolução.</p>
        </div>
        <button
          className="btn-primary rounded-xl px-4 py-2.5 text-sm flex items-center justify-center gap-1.5 self-start sm:self-auto"
          onClick={() => {
            if (!isPro && activeHabits.length >= PRO_LIMITS.habits) {
              onUpgrade("habits");
              return;
            }
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Plus size={16} /> Novo hábito
        </button>
      </div>

      <FirstVisitTip id="habits" icon={ListChecks} title="Hábitos constroem sua constância.">
        Comece com poucos hábitos que realmente importam. Marque cada execução na grade e acompanhe o mês inteiro de uma vez.
      </FirstVisitTip>

      {habits.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title="Você ainda não possui hábitos."
          hint="Seu primeiro hábito deve ser simples o bastante para repetir. Você pode criar do zero ou começar com um exemplo pronto."
          action={(
            <div className="flex flex-col items-center gap-2 mt-2">
              <button className="btn-primary rounded-xl px-4 py-2" onClick={() => setShowForm(true)}>Criar meu primeiro hábito</button>
              <div className="flex flex-wrap justify-center gap-1.5">
                {[
                  ["Beber 2L de água", "saude"],
                  ["Ler 20 minutos", "mente"],
                  ["Treinar", "saude"],
                ].map(([name, category]) => (
                  <button key={name} className="chip" onClick={() => saveHabit({ id: uid(), name, category, countsForStreak: true, checklist: [], frequency: { type: "daily" }, active: true, createdAt: today() })}>+ {name}</button>
                ))}
              </div>
            </div>
          )}
        />
      )}

      {habits.length > 0 && (
        <>
          <div className="habit-grid-month-nav surface rounded-xl flex items-center justify-between gap-2 px-2 py-1.5">
            <button className="btn-ghost rounded-lg p-2" onClick={() => moveMonth(-1)} aria-label="Mês anterior" title="Mês anterior">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium">{monthLabelDisplay}</span>
            <button className="btn-ghost rounded-lg p-2" onClick={() => moveMonth(1)} aria-label="Próximo mês" title="Próximo mês">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="surface rounded-2xl p-4 md:p-5">
            <p className="text-[10px] text-faint uppercase tracking-widest mb-2">Progresso do mês</p>
            {chartData.length > 0 ? (
              <MiniLineChart data={chartData} height={120} />
            ) : (
              <p className="text-dim text-xs py-4 text-center">Sem dados suficientes neste mês ainda.</p>
            )}
          </div>

          <div className="surface glass-panel rounded-2xl p-3 md:p-4">
            <p className="text-[10px] text-faint uppercase tracking-widest mb-3 px-1">Grade de hábitos</p>
            <div className="habit-grid-scroll">
              <table className="habit-grid-table">
                <thead>
                  <tr>
                    <th className="habit-grid-name-col text-left">Hábito</th>
                    {days.map((day) => {
                      const dateStr = dateForDay(day);
                      const isToday = dateStr === t;
                      return (
                        <th key={day} className={`habit-grid-day-head font-mono ${isToday ? "habit-grid-today" : ""}`}>
                          {day}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedHabits.map((habit) => {
                    const isPaused = habit.active === false;
                    const hasChecklist = habit.checklist?.length > 0;
                    const monthRate = habitMonthRate(habit);

                    return (
                      <tr key={habit.id} style={{ opacity: isPaused ? 0.55 : 1 }}>
                        <td className="habit-grid-name-col">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 min-w-0">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="habit-grid-cat-dot shrink-0" style={{ background: catColor(habit.category) }} />
                              <div className="min-w-0 flex-1">
                                <p
                                  className="text-xs md:text-sm font-medium break-words leading-snug"
                                  style={{ textDecoration: isPaused ? "line-through" : "none" }}
                                  title={habit.name}
                                >
                                  {habit.name}
                                </p>
                                <div className="hidden sm:flex items-center gap-1 mt-0.5">
                                  {habit.countsForStreak && <Flame size={10} className="text-ember shrink-0" />}
                                  <span className={`text-[9px] font-mono ${monthRate >= 80 ? "text-moss" : monthRate >= 50 ? "text-brass" : "text-faint"}`}>
                                    {monthRate}%
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex sm:hidden items-center justify-between gap-2">
                              <div className="flex items-center gap-1">
                                {habit.countsForStreak && <Flame size={10} className="text-ember shrink-0" />}
                                <span className={`text-[9px] font-mono ${monthRate >= 80 ? "text-moss" : monthRate >= 50 ? "text-brass" : "text-faint"}`}>
                                  {monthRate}%
                                </span>
                              </div>
                              <div className="habit-grid-row-actions flex items-center gap-0.5 shrink-0">
                                <button className="btn-ghost rounded-lg p-1.5" title={habit.active ? "Pausar" : "Reativar"} onClick={() => toggleActive(habit.id)}>
                                  {habit.active ? <Pause size={12} /> : <Play size={12} />}
                                </button>
                                <button className="btn-ghost rounded-lg p-1.5" title="Editar" onClick={() => { setEditing(habit); setShowForm(true); }}>
                                  <Pencil size={12} />
                                </button>
                                <button className="btn-ghost rounded-lg p-1.5" title="Excluir" onClick={() => deleteHabit(habit.id)}>
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                            <div className="hidden sm:flex habit-grid-row-actions items-center gap-0.5 shrink-0">
                              <button className="btn-ghost rounded-lg p-1.5" title={habit.active ? "Pausar" : "Reativar"} onClick={() => toggleActive(habit.id)}>
                                {habit.active ? <Pause size={12} /> : <Play size={12} />}
                              </button>
                              <button className="btn-ghost rounded-lg p-1.5" title="Editar" onClick={() => { setEditing(habit); setShowForm(true); }}>
                                <Pencil size={12} />
                              </button>
                              <button className="btn-ghost rounded-lg p-1.5" title="Excluir" onClick={() => deleteHabit(habit.id)}>
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        </td>

                        {days.map((day) => {
                          const dateStr = dateForDay(day);
                          const isFuture = dateStr > t;
                          const isToday = dateStr === t;
                          const scheduledDay = habitValidOnDate(habit, dateStr, completions);
                          // Só o dia de hoje pode ser alterado — dias passados ficam travados para
                          // preservar a integridade do histórico (não dá pra "voltar" e marcar depois).
                          const editable = isToday && scheduledDay;
                          const showAsEmpty = !scheduledDay || isFuture;
                          const done = completions.some((completion) => completion.habitId === habit.id && completion.date === dateStr);

                          let checklistPct = null;
                          if (hasChecklist && scheduledDay) {
                            const total = habit.checklist.length;
                            const doneCount = habit.checklist.filter((item) =>
                              habitChecklistLog.some((row) => row.habitId === habit.id && row.itemId === item.id && row.date === dateStr && row.done)
                            ).length;
                            checklistPct = total ? doneCount / total : 0;
                          }

                          return (
                            <td key={day} className={`habit-grid-cell-wrap ${isToday ? "habit-grid-today" : ""}`}>
                              <button
                                type="button"
                                className={`habit-grid-cell ${!showAsEmpty && (done || (hasChecklist && checklistPct > 0)) ? "habit-grid-cell-done" : ""}`}
                                disabled={!editable}
                                title={
                                  showAsEmpty
                                    ? (isFuture ? "Ainda não chegou" : "Não aplicável")
                                    : !editable
                                      ? "Dias passados ficam travados — não é possível alterar"
                                      : hasChecklist ? "Ver etapas do dia" : done ? "Concluído — clique para desmarcar" : "Marcar como concluído"
                                }
                                onClick={() => {
                                  if (!editable) return;
                                  if (hasChecklist) { setChecklistCell({ habitId: habit.id, dateStr }); return; }
                                  toggleHabit(habit.id, dateStr);
                                }}
                                style={{
                                  background: showAsEmpty
                                    ? "transparent"
                                    : hasChecklist
                                      ? `color-mix(in srgb, var(--moss) ${Math.round((checklistPct || 0) * 100)}%, var(--surface-2))`
                                      : done
                                        ? "linear-gradient(145deg, color-mix(in srgb, var(--moss) 85%, white 15%), var(--moss))"
                                        : "var(--surface-2)",
                                  border: showAsEmpty
                                    ? "1px dashed var(--border-soft)"
                                    : done || (hasChecklist && checklistPct > 0)
                                      ? "1px solid color-mix(in srgb, var(--moss) 70%, transparent)"
                                      : "1px solid var(--border)",
                                  cursor: editable ? "pointer" : "default",
                                  opacity: !showAsEmpty && !editable ? 0.68 : 1,
                                }}
                              >
                                {hasChecklist && checklistPct != null && checklistPct > 0 && checklistPct < 1 && (
                                  <span className="habit-grid-cell-frac font-mono">{Math.round(checklistPct * 100)}</span>
                                )}
                                {!hasChecklist && done && <Check size={14} strokeWidth={3} color="#0A0D08" />}
                                {hasChecklist && checklistPct === 1 && <Check size={12} strokeWidth={3} color="#0A0D08" />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <HabitForm
          initial={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSave={(habit) => {
            const saved = saveHabit(habit);
            if (saved === false) return;
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {activeChecklistHabit && checklistCell && (
        <Modal
          title={`${activeChecklistHabit.name} — ${dateLabel(checklistCell.dateStr, { day: "2-digit", month: "long" })}`}
          onClose={() => setChecklistCell(null)}
          width={380}
        >
          <div className="flex flex-col gap-2">
            {activeChecklistHabit.checklist.map((item) => {
              const checked = habitChecklistLog.some((row) =>
                row.habitId === activeChecklistHabit.id && row.itemId === item.id && row.date === checklistCell.dateStr && row.done
              );
              return (
                <button
                  key={item.id}
                  className="flex items-start gap-2 text-left text-sm surface-2 rounded-xl p-3"
                  onClick={() => toggleHabitChecklist(activeChecklistHabit.id, item.id, checklistCell.dateStr)}
                >
                  {checked
                    ? <CheckCircle2 size={17} className="text-moss shrink-0 mt-0.5" />
                    : <Circle size={17} className="text-faint shrink-0 mt-0.5" />}
                  <span
                    className="break-words"
                    style={{
                      textDecoration: checked ? "line-through" : "none",
                      color: checked ? "var(--text-dim)" : "var(--text)",
                    }}
                  >
                    {item.text}
                  </span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   TASKS
----------------------------------------------------------------*/

const taskEstimatedLabel = (minutes) => {
  const value = Math.max(0, Number(minutes) || 0);
  if (!value) return "";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
};

const taskPriorityScore = (task, referenceDate = today()) => {
  if (!task) return -999;
  const recurring = isRecurringTask(task);
  const done = recurring ? taskDoneOnDate(task, referenceDate) : task.status === "concluida";
  if (done) return -999;

  const priorityWeight = {
    urgente: 52,
    alta: 38,
    media: 24,
    baixa: 12,
  };

  let score = priorityWeight[task.priority] || 20;
  const dueDate = task.dueDate || "";

  if (!recurring && dueDate && dueDate < referenceDate) score += 42;
  if (taskOccursOnDate(task, referenceDate)) score += 28;
  if (!recurring && dueDate === addDays(referenceDate, 1)) score += 12;

  const pendingSubtasks = (task.subtasks || []).filter((item) => !item.done).length;
  score += Math.min(10, pendingSubtasks * 2);

  if (task.taskTime && taskOccursOnDate(task, referenceDate)) score += 8;
  if (Number(task.deferCount || 0) >= 2) score += Math.min(12, Number(task.deferCount || 0) * 3);

  return score;
};

const taskPriorityReason = (task, referenceDate = today()) => {
  if (!task) return "";
  if (!isRecurringTask(task) && task.dueDate && task.dueDate < referenceDate) return "Atrasada";
  if (task.priority === "urgente") return "Urgente";
  if (task.priority === "alta" && taskOccursOnDate(task, referenceDate)) return "Alta prioridade para hoje";
  if (task.taskTime && taskOccursOnDate(task, referenceDate)) return `Programada para ${task.taskTime}`;
  if (Number(task.deferCount || 0) >= 2) return `Adiada ${task.deferCount}x`;
  if ((task.subtasks || []).some((item) => !item.done)) return "Possui subtarefas pendentes";
  return "Próxima ação recomendada";
};

const taskCompletionRows = (tasks, fromDate, toDate) => {
  const rows = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    (tasks || []).forEach((task) => {
      if (!taskOccursOnDate(task, date)) return;
      rows.push({
        task,
        date,
        done: taskDoneOnDate(task, date),
      });
    });
  }
  return rows;
};

const taskIntelligenceSnapshot = (tasks) => {
  const end = today();
  const start30 = addDays(end, -29);
  const rows30 = taskCompletionRows(tasks, start30, end);
  const completionRate = rows30.length
    ? Math.round(rows30.filter((row) => row.done).length / rows30.length * 100)
    : 0;

  const weekStart = startOfWeek(end);
  const weekEnd = addDays(weekStart, 6);
  const weekRows = taskCompletionRows(tasks, weekStart, weekEnd);
  const weekCompleted = weekRows.filter((row) => row.done).length;

  const weekdayMap = new Map();
  rows30.filter((row) => row.done).forEach((row) => {
    const weekday = weekdayIndex(row.date);
    weekdayMap.set(weekday, (weekdayMap.get(weekday) || 0) + 1);
  });
  const bestDayEntry = [...weekdayMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const bestDay = bestDayEntry ? WEEKDAYS[bestDayEntry[0]] : "Sem base";

  const deferred = [...(tasks || [])]
    .filter((task) => Number(task.deferCount || 0) > 0 && task.status !== "concluida")
    .sort((a, b) => Number(b.deferCount || 0) - Number(a.deferCount || 0));

  const overdue = (tasks || []).filter((task) =>
    !isRecurringTask(task) &&
    task.status !== "concluida" &&
    task.dueDate &&
    task.dueDate < end
  );

  return {
    completionRate,
    weekCompleted,
    bestDay,
    mostDeferred: deferred[0] || null,
    deferredCount: deferred.filter((task) => Number(task.deferCount || 0) >= 2).length,
    overdueCount: overdue.length,
  };
};

function TaskForm({ initial, onSave, onClose, isPro, onUpgrade, defaultDueDate = null }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [priority, setPriority] = useState(initial?.priority || "media");
  const [category, setCategory] = useState(initial?.category || "trabalho");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? defaultDueDate ?? today());
  const [taskTime, setTaskTime] = useState(initial?.taskTime || "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(Number(initial?.estimatedMinutes || 0));
  const [formError, setFormError] = useState("");
  const [subtasks, setSubtasks] = useState(() =>
    initial?.subtasks?.length ? initial.subtasks.map((item) => ({ ...item })) : []
  );
  const [repeat, setRepeat] = useState(initial?.repeat || "none");
  const [repeatDays, setRepeatDays] = useState(initial?.repeatDays || []);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initial?.id));
  const isEditing = Boolean(initial?.id);

  const toggleRepeatDay = (day) =>
    setRepeatDays((prev) =>
      prev.includes(day)
        ? prev.filter((item) => item !== day)
        : [...prev, day].sort()
    );

  const quickDates = [
    ["today", "Hoje", today()],
    ["tomorrow", "Amanhã", addDays(today(), 1)],
    ["week", "+7 dias", addDays(today(), 7)],
  ];

  const save = () => {
    if (!title.trim()) {
      setFormError("Digite o nome da tarefa.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(String(taskTime || ""))) {
      setFormError("Defina um horário para criar a tarefa.");
      return;
    }
    if (repeat === "custom" && repeatDays.length === 0) {
      setFormError("Selecione pelo menos um dia da semana.");
      return;
    }

    setFormError("");
    onSave({
      ...initial,
      id: initial?.id || uid(),
      title: title.trim(),
      description: description.trim(),
      priority,
      category,
      dueDate,
      taskTime,
      estimatedMinutes: Math.max(0, Number(estimatedMinutes) || 0),
      reminderMinutes: 30,
      subtasks: subtasks
        .filter((item) => item.text.trim())
        .map((item) => ({ ...item, text: item.text.trim() })),
      repeat,
      repeatDays: repeat === "custom" ? repeatDays : [],
      status: isRecurringTask({ repeat })
        ? "pendente"
        : (initial?.status || "pendente"),
      completionDates: initial?.completionDates || [],
      createdAt: initial?.createdAt || today(),
      deferCount: Number(initial?.deferCount || 0),
    });
  };

  return (
    <Modal title={isEditing ? "Editar tarefa" : "Nova tarefa"} onClose={onClose} width={620}>
      <div className="task-quick-create surface-2 rounded-2xl p-3 md:p-4 mb-3">
        <Field label="O que precisa ser feito?">
          <input
            autoFocus={!initial}
            className="w-full p-3 ring-focus"
            placeholder="Ex: Enviar proposta"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !showAdvanced && title.trim()) save();
            }}
          />
        </Field>

        <div className="mb-3">
          <p className="text-[9px] text-faint uppercase tracking-widest mb-2">Quando</p>
          <div className="grid grid-cols-3 gap-1.5">
            {quickDates.map(([id, label, value]) => (
              <button
                key={id}
                type="button"
                className="task-quick-option rounded-xl py-2 text-[10px] md:text-xs"
                onClick={() => setDueDate(value)}
                style={{
                  border: `1px solid ${dueDate === value ? "var(--brass)" : "var(--border)"}`,
                  background: dueDate === value ? "color-mix(in srgb, var(--brass) 8%, var(--surface))" : "transparent",
                  color: dueDate === value ? "var(--brass)" : "var(--text-dim)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <p className="text-[9px] text-faint uppercase tracking-widest mb-2">Horário obrigatório</p>
          <div className="task-time-field relative">
            <input
              type="time"
              required
              className="task-time-input w-full p-3 pr-11 ring-focus"
              value={taskTime}
              onChange={(event) => {
                setTaskTime(event.target.value);
                if (event.target.value) setFormError("");
              }}
              aria-label="Horário obrigatório da tarefa"
            />
            <Clock3
              size={17}
              color="#FFFFFF"
              strokeWidth={2}
              className="task-time-icon pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
          </div>
          <p className="text-[10px] text-faint mt-1.5">Você receberá um lembrete automático 30 minutos antes.</p>
        </div>

        <div className="mb-3">
          <p className="text-[9px] text-faint uppercase tracking-widest mb-2">Prioridade</p>
          <div className="grid grid-cols-4 gap-1.5">
            {PRIORITIES.map((item) => (
              <button
                key={item.id}
                type="button"
                className="task-quick-option rounded-xl py-2 text-[10px] md:text-xs min-w-0"
                onClick={() => setPriority(item.id)}
                style={{
                  border: `1px solid ${priority === item.id ? item.color : "var(--border)"}`,
                  color: priority === item.id ? item.color : "var(--text-dim)",
                  background: priority === item.id ? "var(--surface)" : "transparent",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[9px] text-faint uppercase tracking-widest mb-2">Tempo estimado</p>
          <div className="grid grid-cols-4 gap-1.5">
            {[15, 30, 60].map((minutes) => (
              <button
                key={minutes}
                type="button"
                className="task-quick-option rounded-xl py-2 text-[10px] md:text-xs"
                onClick={() => setEstimatedMinutes(estimatedMinutes === minutes ? 0 : minutes)}
                style={{
                  border: `1px solid ${estimatedMinutes === minutes ? "var(--brass)" : "var(--border)"}`,
                  color: estimatedMinutes === minutes ? "var(--brass)" : "var(--text-dim)",
                }}
              >
                {taskEstimatedLabel(minutes)}
              </button>
            ))}
            <input
              type="number"
              min="0"
              step="5"
              className="task-estimate-custom min-w-0 w-full p-2 text-center text-xs ring-focus"
              placeholder="min"
              value={[15, 30, 60].includes(Number(estimatedMinutes)) ? "" : (estimatedMinutes || "")}
              onChange={(event) => setEstimatedMinutes(Math.max(0, Number(event.target.value) || 0))}
              aria-label="Tempo estimado personalizado em minutos"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        className="task-more-options btn-ghost rounded-xl px-3 py-2 text-xs w-full flex items-center justify-center gap-1.5 mb-3"
        onClick={() => setShowAdvanced((value) => !value)}
      >
        <SlidersHorizontal size={13} />
        {showAdvanced ? "Ocultar opções" : "Mais opções"}
        {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {showAdvanced && (
        <div className="task-advanced-fields fade-in">
          <Field label="Descrição (opcional)">
            <textarea
              rows={3}
              className="w-full p-3 ring-focus resize-none"
              placeholder="Contexto, detalhes ou observações..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Categoria">
              <select
                className="w-full p-3 ring-focus"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Data específica">
              <input
                type="date"
                className="w-full p-3 ring-focus"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Subtarefas (opcional)">
            <div className="flex flex-col gap-2">
              {subtasks.map((subtask, index) => (
                <div key={subtask.id} className="flex items-center gap-2">
                  <Circle size={15} className="text-faint shrink-0" />
                  <input
                    className="flex-1 min-w-0 p-2.5 text-sm ring-focus"
                    placeholder={`Subtarefa ${index + 1}`}
                    value={subtask.text}
                    onChange={(event) =>
                      setSubtasks((prev) =>
                        prev.map((item) =>
                          item.id === subtask.id
                            ? { ...item, text: event.target.value }
                            : item
                        )
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn-ghost rounded-lg p-2"
                    onClick={() =>
                      setSubtasks((prev) =>
                        prev.filter((item) => item.id !== subtask.id)
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="btn-ghost rounded-xl py-2 text-sm flex items-center justify-center gap-1"
                onClick={() =>
                  setSubtasks((prev) => [
                    ...prev,
                    { id: uid(), text: "", done: false },
                  ])
                }
              >
                <Plus size={14} /> Adicionar subtarefa
              </button>
            </div>
          </Field>

          <Field label="Repetir">
            <select
              className="w-full p-3 ring-focus"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            >
              <option value="none">Não repetir</option>
              <option value="daily">Todo dia</option>
              <option value="custom">Dias específicos</option>
              <option value="weekly">Toda semana</option>
              <option value="monthly">Todo mês</option>
            </select>
          </Field>

          {repeat === "custom" && (
            <Field label="Dias da semana">
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((label, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => toggleRepeatDay(index)}
                    className="rounded-xl py-2 text-xs sm:text-sm"
                    style={{
                      border: `1px solid ${repeatDays.includes(index) ? "var(--brass)" : "var(--border)"}`,
                      background: repeatDays.includes(index)
                        ? "color-mix(in srgb, var(--brass) 12%, transparent)"
                        : "transparent",
                      color: repeatDays.includes(index)
                        ? "var(--brass)"
                        : "var(--text-dim)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>
      )}

      {formError && (
        <div className="rounded-xl px-3 py-2.5 mb-2 text-xs text-ember" style={{ background: "color-mix(in srgb, var(--ember) 8%, var(--surface))", border: "1px solid color-mix(in srgb, var(--ember) 35%, var(--border))" }}>
          {formError}
        </div>
      )}

      <button
        disabled={!title.trim() || !taskTime || (repeat === "custom" && repeatDays.length === 0)}
        className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
        onClick={save}
      >
        {isEditing ? "Salvar alterações" : "Criar tarefa"}
      </button>
    </Modal>
  );
}

function TaskFocusModal({ task, onClose, onSave, onComplete }) {
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running || secondsLeft <= 0) return;
    const timer = setInterval(
      () => setSecondsLeft((seconds) => Math.max(0, seconds - 1)),
      1000
    );
    return () => clearInterval(timer);
  }, [running, secondsLeft]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const subtasks = task.subtasks || [];
  const doneSubtasks = subtasks.filter((item) => item.done).length;
  const subtaskPct = subtasks.length
    ? Math.round(doneSubtasks / subtasks.length * 100)
    : 0;

  const toggleSubtask = (id) => {
    onSave({
      ...task,
      subtasks: subtasks.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item
      ),
    });
  };

  return (
    <Modal title="Modo foco" onClose={onClose} width={560}>
      <div className="task-focus-shell text-center py-1">
        <p className="text-[9px] text-faint uppercase tracking-[.18em]">Próxima ação</p>
        <h3 className="font-display text-2xl md:text-3xl mt-2 break-words">{task.title}</h3>

        <div className="flex flex-wrap justify-center gap-1.5 mt-3">
          <span className="chip">{PRIORITIES.find((item) => item.id === task.priority)?.label || "Média"}</span>
          {task.taskTime && <span className="chip font-mono">{task.taskTime}</span>}
          {task.estimatedMinutes > 0 && <span className="chip">{taskEstimatedLabel(task.estimatedMinutes)} estimados</span>}
          {task.dueDate && <span className="chip">{task.dueDate === today() ? "Hoje" : new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</span>}
        </div>

        {task.description && (
          <div className="surface-2 rounded-xl p-3 mt-3 text-left">
            <p className="text-[9px] text-faint uppercase tracking-widest mb-1">Contexto</p>
            <p className="text-sm text-dim leading-relaxed whitespace-pre-wrap break-words">{task.description}</p>
          </div>
        )}

        {subtasks.length > 0 && (
          <div className="surface-2 rounded-xl p-3 mt-3 text-left">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[9px] text-faint uppercase tracking-widest">Progresso</p>
              <span className="font-mono text-[10px] text-dim">{doneSubtasks}/{subtasks.length}</span>
            </div>
            <Progress value={subtaskPct} height={5} />
          </div>
        )}

        <div className="task-focus-timer font-mono text-5xl md:text-6xl mt-6 mb-2">
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </div>
        <p className="text-dim text-xs">25 minutos focados. Uma tarefa de cada vez.</p>

        <div className="grid grid-cols-3 gap-2 mt-5">
          <button
            className="btn-primary rounded-xl py-2.5 text-xs md:text-sm"
            onClick={() => setRunning((value) => !value)}
          >
            {running ? "Pausar" : "Iniciar"}
          </button>
          <button
            className="btn-ghost rounded-xl py-2.5 text-xs md:text-sm"
            onClick={() => {
              setRunning(false);
              setSecondsLeft(25 * 60);
            }}
          >
            Reiniciar
          </button>
          <button
            className="btn-ghost rounded-xl py-2.5 text-xs md:text-sm"
            onClick={() => {
              setRunning(false);
              setSecondsLeft(5 * 60);
            }}
          >
            Pausa 5m
          </button>
        </div>
      </div>

      {subtasks.length > 0 && (
        <div className="surface-2 rounded-2xl p-4 mt-4">
          <p className="text-xs text-faint uppercase tracking-widest mb-3">Subtarefas</p>
          <div className="flex flex-col gap-2">
            {subtasks.map((item) => (
              <button
                key={item.id}
                className="flex items-start gap-2 text-left text-sm"
                onClick={() => toggleSubtask(item.id)}
              >
                {item.done
                  ? <CheckCircle2 size={17} className="text-moss shrink-0 mt-0.5" />
                  : <Circle size={17} className="text-faint shrink-0 mt-0.5" />}
                <span
                  className="break-words"
                  style={{
                    textDecoration: item.done ? "line-through" : "none",
                    color: item.done ? "var(--text-dim)" : "var(--text)",
                  }}
                >
                  {item.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        className="btn-primary w-full rounded-xl py-3 mt-4"
        onClick={() => {
          onComplete();
          onClose();
        }}
      >
        Concluir tarefa
      </button>
    </Modal>
  );
}



function TasksView({ tasks, saveTask, deleteTask, setStatus, moveTask, autoOpen, isPro, onUpgrade }) {
  const [section, setSection] = useState("today");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [boardFilter, setBoardFilter] = useState("todas");
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [focusTask, setFocusTask] = useState(null);
  const [weekDragTarget, setWeekDragTarget] = useState(null);
  const [expandedSubtasks, setExpandedSubtasks] = useState({});
  const [showAllTodayCompleted, setShowAllTodayCompleted] = useState(false);
  const [showAllBoardCompleted, setShowAllBoardCompleted] = useState(false);

  useEffect(() => {
    if (autoOpen) {
      setEditing(null);
      setShowForm(true);
    }
  }, [autoOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.querySelector(".app-main")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    });
  }, [section]);

  const t = today();
  const tomorrow = addDays(t, 1);
  const nextWeek = addDays(t, 7);
  const plannerWeekStart = startOfWeek(t);
  const plannerDays = Array.from({ length: 7 }, (_, index) =>
    addDays(plannerWeekStart, index)
  );
  const plannerWeekEnd = addDays(plannerWeekStart, 6);

  const activeTasks = tasks.filter((task) =>
    isRecurringTask(task) || task.status !== "concluida"
  );

  const todayTasks = tasks
    .filter((task) => taskOccursOnDate(task, t))
    .sort((a, b) => taskPriorityScore(b, t) - taskPriorityScore(a, t));

  const todayPending = todayTasks.filter((task) => !taskDoneOnDate(task, t));
  const todayCompleted = todayTasks.filter((task) => taskDoneOnDate(task, t));
  const todayCompletionPct = todayTasks.length
    ? Math.round(todayCompleted.length / todayTasks.length * 100)
    : 0;

  const todayEstimatedMinutes = todayTasks.reduce(
    (sum, task) => sum + Math.max(0, Number(task.estimatedMinutes || 0)),
    0
  );

  const overdueTasks = tasks
    .filter((task) =>
      !isRecurringTask(task) &&
      task.status !== "concluida" &&
      task.dueDate &&
      task.dueDate < t
    )
    .sort((a, b) => taskPriorityScore(b, t) - taskPriorityScore(a, t));

  const unscheduledTasks = tasks
    .filter((task) =>
      !isRecurringTask(task) &&
      task.status !== "concluida" &&
      !task.dueDate
    )
    .sort((a, b) => taskPriorityScore(b, t) - taskPriorityScore(a, t));

  const recurringTasks = tasks
    .filter((task) => isRecurringTask(task))
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "pt-BR"));

  const futureTasks = tasks
    .filter((task) =>
      !isRecurringTask(task) &&
      task.status !== "concluida" &&
      task.dueDate &&
      task.dueDate > plannerWeekEnd
    )
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  const queueMap = new Map();
  [...todayPending, ...overdueTasks].forEach((task) => queueMap.set(task.id, task));
  const priorityQueue = [...queueMap.values()]
    .sort((a, b) => taskPriorityScore(b, t) - taskPriorityScore(a, t));

  const nextTask = priorityQueue[0] || null;
  const todayPriority = todayPending.filter((task) =>
    ["urgente", "alta"].includes(task.priority)
  );
  const todayLater = todayPending.filter((task) =>
    !["urgente", "alta"].includes(task.priority)
  );

  const scheduleTask = (task, date, countAsDefer = false) => {
    if (!task || isRecurringTask(task)) return;
    saveTask({
      ...task,
      dueDate: date,
      deferCount: countAsDefer
        ? Number(task.deferCount || 0) + 1
        : Number(task.deferCount || 0),
      lastDeferredAt: countAsDefer ? new Date().toISOString() : task.lastDeferredAt,
      status: task.status === "concluida" ? "pendente" : task.status,
      completedAt: task.status === "concluida" ? undefined : task.completedAt,
    });
  };

  const toggleCardSubtask = (task, subtaskId) => {
    saveTask({
      ...task,
      subtasks: (task.subtasks || []).map((item) =>
        item.id === subtaskId ? { ...item, done: !item.done } : item
      ),
    });
  };

  const openCreate = (prefillTitle = "") => {
    const seedTitle = typeof prefillTitle === "string" ? prefillTitle : "";
    const activeCount = tasks.filter((task) =>
      isRecurringTask(task) || task.status !== "concluida"
    ).length;

    if (!isPro && activeCount >= PRO_LIMITS.activeTasks) {
      onUpgrade("tasks");
      return;
    }

    setEditing(seedTitle ? { title: seedTitle } : null);
    setShowForm(true);
  };

  const openEdit = (task) => {
    setEditing(task);
    setShowForm(true);
  };

  const taskMetaDate = (task) => {
    if (isRecurringTask(task)) return taskRepeatLabel(task);
    if (!task.dueDate) return "Sem data";
    if (task.dueDate === t) return "Hoje";
    if (task.dueDate === tomorrow) return "Amanhã";
    return new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("pt-BR");
  };

  const renderSubtaskProgress = (task, interactive = false) => {
    const subtasks = task.subtasks || [];
    if (!subtasks.length) return null;

    const doneCount = subtasks.filter((item) => item.done).length;
    const pct = Math.round(doneCount / subtasks.length * 100);
    const visible = expandedSubtasks[task.id] ? subtasks : subtasks.slice(0, 3);

    return (
      <div className="task-card-subtasks rounded-xl p-2.5 mt-2" data-no-swipe>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-[9px] text-faint uppercase tracking-widest">Subtarefas</p>
          <span className="text-[9px] font-mono text-dim">{doneCount}/{subtasks.length}</span>
        </div>
        <Progress value={pct} height={4} />

        {interactive && (
          <div className="flex flex-col gap-1 mt-2">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                draggable={false}
                className="task-subtask-toggle flex items-start gap-2 text-[10px] text-left rounded-lg px-1.5 py-1.5"
                onPointerDown={(event) => event.stopPropagation()}
                onDragStart={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCardSubtask(task, item.id);
                }}
              >
                {item.done
                  ? <CheckCircle2 size={13} className="text-moss shrink-0 mt-0.5" />
                  : <Circle size={13} className="text-faint shrink-0 mt-0.5" />}
                <span
                  className="break-words flex-1"
                  style={{
                    textDecoration: item.done ? "line-through" : "none",
                    color: item.done ? "var(--text-faint)" : "var(--text-dim)",
                  }}
                >
                  {item.text}
                </span>
              </button>
            ))}

            {subtasks.length > 3 && (
              <button
                type="button"
                className="text-[9px] text-brass text-left px-1.5 py-1"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedSubtasks((current) => ({
                    ...current,
                    [task.id]: !current[task.id],
                  }));
                }}
              >
                {expandedSubtasks[task.id]
                  ? "Mostrar menos"
                  : `Ver mais ${subtasks.length - 3}`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTaskActions = (task, { compact = false, doneDate = t } = {}) => {
    const done = taskDoneOnDate(task, doneDate);

    return (
      <div className={`task-modern-actions flex items-center gap-1.5 ${compact ? "" : "mt-3 pt-2"}`}>
        {!done && (
          <button
            className="btn-ghost rounded-lg p-2"
            onClick={() => setFocusTask(task)}
            title="Modo foco"
            aria-label={`Iniciar foco em ${task.title}`}
          >
            <Timer size={14} />
          </button>
        )}

        {!isRecurringTask(task) && !done && (
          <select
            className="task-postpone-select rounded-lg px-2 py-1.5 text-[10px] ring-focus"
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return;
              if (value === "today") scheduleTask(task, t, task.dueDate !== t);
              if (value === "tomorrow") scheduleTask(task, tomorrow, true);
              if (value === "week") scheduleTask(task, nextWeek, true);
              event.target.value = "";
            }}
            aria-label={`Adiar ou reagendar ${task.title}`}
          >
            <option value="">Adiar</option>
            <option value="today">Hoje</option>
            <option value="tomorrow">Amanhã</option>
            <option value="week">+7 dias</option>
          </select>
        )}

        <button
          className="btn-ghost rounded-lg p-2"
          onClick={() => openEdit(task)}
          title="Editar"
          aria-label={`Editar ${task.title}`}
        >
          <Pencil size={14} />
        </button>

        <button
          className="btn-ghost rounded-lg p-2"
          onClick={() => deleteTask(task.id)}
          title="Excluir"
          aria-label={`Excluir ${task.title}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  const renderTodayTask = (task) => {
    const done = taskDoneOnDate(task, t);
    const overdue = !isRecurringTask(task) && task.dueDate && task.dueDate < t;

    return (
      <article
        key={task.id}
        className={`task-today-card surface rounded-2xl p-3 md:p-4 ${done ? "task-is-done" : ""}`}
        style={{ "--task-accent": PRIORITIES.find((item) => item.id === task.priority)?.color || "var(--border)" }}
      >
        <div className="flex items-start gap-3">
          <button
            className="task-check-button shrink-0 mt-0.5"
            onClick={() => setStatus(task.id, done ? "pendente" : "concluida", t)}
            aria-label={done ? "Desmarcar tarefa" : "Concluir tarefa"}
          >
            {done
              ? <CheckCircle2 size={20} className="text-moss" />
              : <Circle size={20} className="text-faint" />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p
                className="font-medium text-sm md:text-base break-words"
                style={{
                  textDecoration: done ? "line-through" : "none",
                  color: done ? "var(--text-dim)" : "var(--text)",
                }}
              >
                {task.title}
              </p>
              <span
                className="chip shrink-0"
                style={{ color: PRIORITIES.find((item) => item.id === task.priority)?.color }}
              >
                {PRIORITIES.find((item) => item.id === task.priority)?.label || "Média"}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2">
              {task.taskTime && <span className="chip font-mono">{task.taskTime}</span>}
              {overdue && <span className="chip text-ember">Atrasada</span>}
              {task.estimatedMinutes > 0 && <span className="chip">{taskEstimatedLabel(task.estimatedMinutes)}</span>}
              {isRecurringTask(task) && <span className="chip"><Repeat2 size={10} /> {taskRepeatLabel(task)}</span>}
              {!isRecurringTask(task) && task.dueDate && task.dueDate !== t && <span className="chip">{taskMetaDate(task)}</span>}
            </div>

            {task.description && (
              <p className="task-card-description text-[10px] md:text-xs text-dim mt-2 leading-relaxed break-words">
                {task.description}
              </p>
            )}

            {renderSubtaskProgress(task, true)}

            {!done && renderTaskActions(task)}
          </div>
        </div>
      </article>
    );
  };

  const boardReferenceDate =
    boardFilter === "amanha" ? tomorrow : t;

  const boardIsDone = (task) => {
    if (boardFilter === "hoje") return taskDoneOnDate(task, t);
    if (boardFilter === "amanha") return taskDoneOnDate(task, tomorrow);
    if (isRecurringTask(task)) return taskDoneOnDate(task, t);
    return task.status === "concluida";
  };

  const boardTasks = tasks.filter((task) => {
    if (categoryFilter !== "todas" && task.category !== categoryFilter) return false;
    if (boardFilter === "hoje") return taskOccursOnDate(task, t);
    if (boardFilter === "amanha") return taskOccursOnDate(task, tomorrow);
    if (boardFilter === "atrasadas") {
      return !isRecurringTask(task) &&
        task.status !== "concluida" &&
        task.dueDate &&
        task.dueDate < t;
    }
    if (boardFilter === "concluidas") {
      return isRecurringTask(task)
        ? taskDoneOnDate(task, t)
        : task.status === "concluida";
    }
    return true;
  });

  const boardPending = boardTasks.filter((task) => !boardIsDone(task));
  const boardCompleted = boardTasks.filter((task) => boardIsDone(task));

  const boardColumns = [
    ...PRIORITIES.map((priority) => ({
      ...priority,
      items: boardPending
        .filter((task) => task.priority === priority.id)
        .sort((a, b) => taskPriorityScore(b, boardReferenceDate) - taskPriorityScore(a, boardReferenceDate)),
    })),
    {
      id: "concluida",
      label: "Concluídas",
      color: "var(--moss)",
      items: boardCompleted,
    },
  ];

  const destinationDateForBoard = (task) => {
    if (boardFilter === "amanha") return tomorrow;
    if (boardFilter === "hoje") return t;
    if (!isRecurringTask(task) && task.dueDate) return task.dueDate;
    return t;
  };

  const moveBoardTask = (taskId, destination) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    moveTask(taskId, destination, destinationDateForBoard(task));
    setDraggedTaskId(null);
    setDragOverColumn(null);
  };

  const productivityHeatmap = Array.from({ length: 90 }, (_, i) => addDays(t, i - 89)).map((date) => {
    const dayTasks = tasks.filter((task) => taskOccursOnDate(task, date));
    const done = dayTasks.filter((task) => taskDoneOnDate(task, date)).length;
    return { date, score: dayTasks.length ? Math.round((done / dayTasks.length) * 100) : 0 };
  });

  return (
    <div className="tasks-modern-view flex flex-col gap-4 md:gap-5">
      <div className="task-main-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl md:text-3xl">Tarefas</h2>
            {!isPro && (
              <span className="chip">
                {activeTasks.length}/{PRO_LIMITS.activeTasks} ativas Free
              </span>
            )}
          </div>
          <p className="text-dim text-xs md:text-sm mt-1">
            Planeje menos, enxergue a próxima ação e execute com clareza.
          </p>
        </div>

        <button
          className="task-new-button btn-primary rounded-xl px-4 py-2.5 text-sm flex items-center justify-center gap-1.5 shrink-0"
          onClick={openCreate}
        >
          <Plus size={15} /> Nova tarefa
        </button>
      </div>

      <FirstVisitTip id="tasks" icon={CheckCircle2} title="Tarefas mostram o que precisa sair da cabeça e virar ação.">
        Use Hoje para o que precisa ser feito agora e Planejamento para organizar os próximos dias. Priorize a próxima ação, não uma lista infinita.
      </FirstVisitTip>

      <div className="task-section-tabs task-glass-tabs rounded-2xl p-1 grid grid-cols-3 gap-1">
        {[
          ["today", "Hoje"],
          ["board", "Quadro"],
          ["planning", "Planejamento"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`task-tab-button rounded-xl py-2 text-[10px] sm:text-xs md:text-sm font-medium min-w-0 ${section === id ? "task-tab-active" : ""}`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "today" && (
        <>
          <div className="task-day-command rounded-2xl p-4 md:p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] text-faint uppercase tracking-widest">Seu dia</p>
                <div className="flex flex-wrap items-end gap-x-3 gap-y-1 mt-1">
                  <p className="font-display text-2xl md:text-3xl">
                    {todayCompleted.length}/{todayTasks.length}
                  </p>
                  <p className="text-xs text-dim mb-1">
                    tarefas concluídas
                  </p>
                </div>
                {todayEstimatedMinutes > 0 && (
                  <p className="text-[10px] text-faint mt-1">~{taskEstimatedLabel(todayEstimatedMinutes)} planejados</p>
                )}

                <div className="task-day-kpis grid grid-cols-3 gap-2 mt-4 max-w-md">
                  <div className="surface-2 rounded-xl p-3 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Pendentes</p>
                    <p className="font-display text-xl mt-1">{todayPending.length}</p>
                  </div>
                  <div className="surface-2 rounded-xl p-3 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Prioridade</p>
                    <p className="font-display text-xl mt-1">{todayPriority.length}</p>
                  </div>
                  <div className="surface-2 rounded-xl p-3 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Atrasadas</p>
                    <p className={`font-display text-xl mt-1 ${overdueTasks.length ? "text-ember" : ""}`}>{overdueTasks.length}</p>
                  </div>
                </div>
              </div>

              <RadialProgress value={todayCompletionPct} label="do dia" size={128} strokeWidth={9} />
            </div>
          </div>

          {overdueTasks.length > 0 && (
            <div className="task-attention surface rounded-2xl p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Precisa de atenção</p>
                  <p className="font-display text-lg mt-1">
                    {overdueTasks.length} tarefa{overdueTasks.length === 1 ? "" : "s"} atrasada{overdueTasks.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">
                    Reagende sem precisar abrir a edição completa.
                  </p>
                </div>
                <Bell size={17} className="text-ember shrink-0" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-3">
                {overdueTasks.slice(0, 4).map((task) => (
                  <div key={task.id} className="task-attention-row surface-2 rounded-xl p-3 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs md:text-sm font-medium break-words">{task.title}</p>
                        <p className="text-[9px] text-ember mt-1">
                          atrasada desde {new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <span className="chip shrink-0">
                        {PRIORITIES.find((item) => item.id === task.priority)?.label || "Média"}
                      </span>
                    </div>

                    <div className="task-reschedule-grid grid grid-cols-3 gap-1.5 mt-3">
                      <button
                        className="btn-ghost rounded-lg py-2 text-[10px]"
                        onClick={() => scheduleTask(task, t, true)}
                      >
                        Hoje
                      </button>
                      <button
                        className="btn-ghost rounded-lg py-2 text-[10px]"
                        onClick={() => scheduleTask(task, tomorrow, true)}
                      >
                        Amanhã
                      </button>
                      <input
                        type="date"
                        className="min-w-0 w-full p-2 text-[10px] ring-focus"
                        min={t}
                        value=""
                        onChange={(event) => {
                          if (event.target.value) scheduleTask(task, event.target.value, true);
                        }}
                        aria-label={`Escolher nova data para ${task.title}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {nextTask && (
            <div className="task-next-action surface rounded-2xl p-4 md:p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles size={14} className="text-brass" />
                    <p className="text-[10px] text-faint uppercase tracking-widest">Próxima tarefa</p>
                    <span className="chip">{taskPriorityReason(nextTask, t)}</span>
                  </div>

                  <p className="font-display text-xl md:text-2xl mt-2 break-words">{nextTask.title}</p>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {nextTask.taskTime && <span className="chip font-mono">{nextTask.taskTime}</span>}
                    <span
                      className="chip"
                      style={{ color: PRIORITIES.find((item) => item.id === nextTask.priority)?.color }}
                    >
                      {PRIORITIES.find((item) => item.id === nextTask.priority)?.label || "Média"}
                    </span>
                    {nextTask.estimatedMinutes > 0 && <span className="chip">{taskEstimatedLabel(nextTask.estimatedMinutes)}</span>}
                    <span className="chip">{taskMetaDate(nextTask)}</span>
                  </div>
                </div>

                <button
                  className="btn-primary rounded-xl px-5 py-3 text-sm shrink-0 flex items-center justify-center gap-1.5"
                  onClick={() => setFocusTask(nextTask)}
                >
                  <Timer size={14} /> Iniciar
                </button>
              </div>
            </div>
          )}

          {priorityQueue.length > 0 && (
            <div className="task-priority-engine surface rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Prioridade Constancce</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">
                    Ordenação simples por prioridade, prazo, atraso, horário e subtarefas.
                  </p>
                </div>
                <Gauge size={16} className="text-brass shrink-0" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {priorityQueue.slice(0, 3).map((task, index) => (
                  <button
                    key={task.id}
                    className="task-priority-item surface-2 rounded-xl p-3 text-left min-w-0"
                    onClick={() => setFocusTask(task)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] text-brass">0{index + 1}</span>
                    </div>
                    <p className="text-xs md:text-sm font-medium mt-2 break-words">{task.title}</p>
                    <p className="text-[9px] text-dim mt-1">{taskPriorityReason(task, t)}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {todayPriority.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-faint uppercase tracking-widest">Prioridade</p>
                <span className="chip">{todayPriority.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {todayPriority.map(renderTodayTask)}
              </div>
            </div>
          )}

          {todayLater.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-faint uppercase tracking-widest">Depois</p>
                <span className="chip">{todayLater.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {todayLater.map(renderTodayTask)}
              </div>
            </div>
          )}

          {todayPending.length === 0 && todayTasks.length > 0 && (
            <div className="surface rounded-2xl p-5 text-center">
              <CheckCircle2 size={24} className="text-moss mx-auto" />
              <p className="font-display text-lg mt-2">Dia concluído</p>
              <p className="text-dim text-xs mt-1">Todas as tarefas programadas para hoje foram concluídas.</p>
            </div>
          )}

          {todayTasks.length === 0 && (
            <div className="surface rounded-2xl p-5 text-center">
              <CheckCircle2 size={22} className="text-faint mx-auto" />
              <p className="font-display text-lg mt-2">Nenhuma tarefa para hoje</p>
              <p className="text-dim text-xs mt-1">Comece com uma ação concreta para hoje. Você pode criar do zero ou usar um exemplo pronto.</p>
              <button className="btn-primary rounded-xl px-4 py-2 text-sm mt-3" onClick={openCreate}>
                Criar primeira tarefa
              </button>
              {tasks.length === 0 && (
                <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                  {["Planejar meu dia", "Responder pendências", "Organizar a semana"].map((title) => (
                    <button key={title} className="chip" onClick={() => openCreate(title)}>+ {title}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {todayCompleted.length > 0 && (
            <div className="surface rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Concluídas hoje</p>
                  <p className="text-dim text-xs mt-1">{todayCompleted.length} tarefa{todayCompleted.length === 1 ? "" : "s"}</p>
                </div>
                <CheckCircle2 size={17} className="text-moss" />
              </div>

              <div className="flex flex-col gap-1.5 mt-3">
                {(showAllTodayCompleted ? todayCompleted : todayCompleted.slice(0, 6)).map((task) => (
                  <button
                    key={task.id}
                    className="surface-2 rounded-xl px-3 py-2 flex items-center gap-2 text-left"
                    onClick={() => setStatus(task.id, "pendente", t)}
                  >
                    <CheckCircle2 size={14} className="text-moss shrink-0" />
                    <span className="text-xs text-dim line-through break-words">{task.title}</span>
                  </button>
                ))}
              </div>

              {todayCompleted.length > 6 && (
                <button
                  type="button"
                  className="text-[10px] text-brass text-left mt-2 px-1 py-1"
                  onClick={() => setShowAllTodayCompleted((value) => !value)}
                >
                  {showAllTodayCompleted ? "Ver menos" : `Ver mais (${todayCompleted.length - 6})`}
                </button>
              )}
            </div>
          )}

          <div className="surface rounded-2xl p-4 md:p-6">
            <div className="flex items-center gap-2">
              <Grid3X3 size={15} className="text-brass" />
              <p className="text-xs text-faint uppercase tracking-widest">Padrão de produtividade</p>
            </div>
            <p className="text-dim text-xs mt-1 mb-4">
              Cada bloco representa um dia. Quanto mais intenso, maior o percentual de tarefas concluídas.
            </p>
            <ConsistencyHeatmap days={productivityHeatmap} />
            <div className="flex items-center justify-between mt-3 text-[9px] text-faint">
              <span>menos tarefas concluídas</span>
              <span>90 dias</span>
              <span>mais tarefas concluídas</span>
            </div>
          </div>
</>
      )}

      {section === "board" && (
        <>
          <div className="task-board-controls surface rounded-2xl p-3 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 lg:pb-0">
              {[
                ["todas", "Todas"],
                ["hoje", "Hoje"],
                ["amanha", "Amanhã"],
                ["atrasadas", "Atrasadas"],
                ["concluidas", "Concluídas"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className="task-board-filter px-3 py-1.5 rounded-full text-xs whitespace-nowrap"
                  onClick={() => setBoardFilter(id)}
                  style={{
                    border: `1px solid ${boardFilter === id ? "var(--brass)" : "var(--border)"}`,
                    background: boardFilter === id ? "var(--surface-2)" : "transparent",
                    color: boardFilter === id ? "var(--text)" : "var(--text-dim)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              className="task-category-filter px-3 py-2 rounded-xl text-xs ring-focus lg:min-w-[170px]"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="todas">Todas categorias</option>
              {CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>{category.label}</option>
              ))}
            </select>
          </div>

          <div className="kanban-board task-modern-board grid gap-3 items-start">
            {boardColumns.map((column) => (
              <section
                key={column.id}
                className={`kanban-column surface rounded-2xl p-3 min-h-[180px] ${
                  dragOverColumn === column.id ? "kanban-column-active" : ""
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverColumn(column.id);
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragOverColumn(column.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setDragOverColumn(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const taskId =
                    event.dataTransfer.getData("text/plain") ||
                    draggedTaskId;
                  moveBoardTask(taskId, column.id);
                }}
              >
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: column.color, boxShadow: `0 0 8px ${column.color}` }}
                    />
                    <h3 className="font-medium text-sm truncate">{column.label}</h3>
                  </div>
                  <span className="chip font-mono shrink-0">{column.items.length}</span>
                </div>

                <div className="flex flex-col gap-2">
                  {column.items.length === 0 && (
                    <div className="kanban-empty rounded-xl border border-dashed p-4 text-center text-faint text-xs">
                      {draggedTaskId ? "Solte a tarefa aqui" : "Nenhuma tarefa"}
                    </div>
                  )}

                  {(column.id === "concluida" && !showAllBoardCompleted
                    ? column.items.slice(0, 6)
                    : column.items
                  ).map((task) => {
                    const done = boardIsDone(task);
                    const overdue =
                      !isRecurringTask(task) &&
                      task.status !== "concluida" &&
                      task.dueDate &&
                      task.dueDate < t;

                    return (
                      <article
                        key={task.id}
                        draggable
                        onDragStart={(event) => {
                          setDraggedTaskId(task.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", task.id);
                        }}
                        onDragEnd={() => {
                          setDraggedTaskId(null);
                          setDragOverColumn(null);
                        }}
                        className={`kanban-card premium-task-card task-board-card rounded-xl p-3 ${
                          draggedTaskId === task.id ? "kanban-card-dragging" : ""
                        }`}
                        style={{ "--task-accent": column.color }}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            className="mt-0.5 shrink-0"
                            onClick={() =>
                              setStatus(
                                task.id,
                                done ? "pendente" : "concluida",
                                destinationDateForBoard(task)
                              )
                            }
                          >
                            {done
                              ? <CheckCircle2 size={18} className="text-moss" />
                              : <Circle size={18} className="text-faint" />}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                              {task.taskTime && <span className="chip font-mono">{task.taskTime}</span>}
                              <span
                                className="chip"
                                style={{ color: PRIORITIES.find((item) => item.id === task.priority)?.color }}
                              >
                                {PRIORITIES.find((item) => item.id === task.priority)?.label || "Média"}
                              </span>
                              {overdue && <span className="chip text-ember">Atrasada</span>}
                              {isRecurringTask(task) && <span className="chip"><Repeat2 size={9} /> recorrente</span>}
                            </div>

                            <p
                              className="text-sm font-medium break-words"
                              style={{
                                textDecoration: done ? "line-through" : "none",
                                color: done ? "var(--text-dim)" : "var(--text)",
                              }}
                            >
                              {task.title}
                            </p>

                            {task.description && (
                              <p className="task-card-description text-[10px] text-dim mt-1.5 leading-relaxed whitespace-pre-wrap break-words">
                                {task.description}
                              </p>
                            )}

                            {renderSubtaskProgress(task, true)}

                            <div className="flex flex-wrap gap-1.5 mt-2">
                              <span className="chip">{taskMetaDate(task)}</span>
                              {task.estimatedMinutes > 0 && <span className="chip">{taskEstimatedLabel(task.estimatedMinutes)}</span>}
                              <span className="chip">{catLabel(task.category)}</span>
                            </div>

                            {!done && renderTaskActions(task)}
                          </div>
                        </div>
                      </article>
                    );
                  })}

                  {column.id === "concluida" && column.items.length > 6 && (
                    <button
                      type="button"
                      className="text-[10px] text-brass text-left px-1 py-1"
                      onClick={() => setShowAllBoardCompleted((value) => !value)}
                    >
                      {showAllBoardCompleted ? "Ver menos" : `Ver mais (${column.items.length - 6})`}
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {section === "planning" && (
        <>
          <div className="task-week-planner">
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] text-faint uppercase tracking-widest">Minha semana</p>
                <p className="text-dim text-xs mt-1">Arraste uma tarefa não recorrente para reorganizar o dia.</p>
              </div>
              <span className="chip whitespace-nowrap shrink-0">7 dias</span>
            </div>

            <div className="overflow-x-auto scrollbar-none pb-2">
              <div className="task-week-grid grid grid-cols-1 md:grid-cols-7 gap-1.5 md:min-w-[860px] items-start">
                {plannerDays.map((dateStr) => {
                  const dayTasks = tasks
                    .filter((task) => taskOccursOnDate(task, dateStr))
                    .sort((a, b) =>
                      (a.taskTime || "99:99").localeCompare(b.taskTime || "99:99")
                    );
                  const isToday = dateStr === t;

                  return (
                    <section
                      key={dateStr}
                      className={`task-planning-day surface rounded-xl p-2.5 min-h-[100px] ${
                        weekDragTarget === dateStr ? "kanban-column-active" : ""
                      }`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setWeekDragTarget(dateStr);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                          setWeekDragTarget(null);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const taskId =
                          event.dataTransfer.getData("text/plain") ||
                          draggedTaskId;
                        const task = tasks.find((item) => item.id === taskId);
                        if (task && !isRecurringTask(task)) {
                          scheduleTask(task, dateStr, false);
                        }
                        setDraggedTaskId(null);
                        setWeekDragTarget(null);
                      }}
                    >
                      <div className="flex md:block items-center justify-between gap-2 mb-2">
                        <p className={`font-medium text-xs ${isToday ? "text-brass" : ""}`}>
                          {WEEKDAYS[weekdayIndex(dateStr)]}
                        </p>
                        <p className="text-[9px] text-faint">
                          {dateLabel(dateStr, { day: "2-digit", month: "2-digit" })}
                        </p>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        {dayTasks.length === 0 && <p className="text-faint text-[10px] py-1">Livre</p>}

                        {dayTasks.map((task) => (
                          <article
                            key={`${dateStr}-${task.id}`}
                            draggable={!isRecurringTask(task)}
                            onDragStart={(event) => {
                              if (isRecurringTask(task)) return;
                              setDraggedTaskId(task.id);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", task.id);
                            }}
                            onDragEnd={() => setDraggedTaskId(null)}
                            className="task-week-card task-week-card-full rounded-lg p-2.5"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {task.taskTime && (
                                  <span className="task-week-time text-[8px] font-mono text-brass shrink-0">
                                    {task.taskTime}
                                  </span>
                                )}
                                <span className="task-week-priority text-[8px] text-faint shrink-0">
                                  {PRIORITIES.find((item) => item.id === task.priority)?.label || "Média"}
                                </span>
                              </div>
                              {(task.subtasks || []).length > 0 && (
                                <span className="task-week-subtasks text-[8px] text-faint shrink-0">
                                  {(task.subtasks || []).filter((item) => item.done).length}/{task.subtasks.length}
                                </span>
                              )}
                            </div>
                            <p className="task-week-title-full text-[10px] md:text-[11px] font-medium leading-snug whitespace-normal break-words">
                              {task.title}
                            </p>
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>

          {unscheduledTasks.length > 0 && (
            <div className="task-unscheduled surface rounded-2xl p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Sem data</p>
                  <p className="font-display text-lg mt-1">{unscheduledTasks.length} esperando planejamento</p>
                </div>
                <CalendarIcon size={17} className="text-brass shrink-0" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-3">
                {unscheduledTasks.map((task) => (
                  <div key={task.id} className="surface-2 rounded-xl p-3">
                    <p className="text-xs md:text-sm font-medium break-words">{task.title}</p>
                    <div className="grid grid-cols-3 gap-1.5 mt-3">
                      <button className="btn-ghost rounded-lg py-2 text-[10px]" onClick={() => scheduleTask(task, t, false)}>
                        Hoje
                      </button>
                      <button className="btn-ghost rounded-lg py-2 text-[10px]" onClick={() => scheduleTask(task, tomorrow, false)}>
                        Amanhã
                      </button>
                      <input
                        type="date"
                        className="min-w-0 w-full p-2 text-[10px] ring-focus"
                        min={t}
                        value=""
                        onChange={(event) => {
                          if (event.target.value) scheduleTask(task, event.target.value, false);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recurringTasks.length > 0 && (
            <div className="surface rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Recorrentes</p>
                  <p className="text-dim text-xs mt-1">Rotinas que reaparecem conforme sua programação.</p>
                </div>
                <Repeat2 size={16} className="text-brass" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                {recurringTasks.map((task) => (
                  <button
                    key={task.id}
                    className="surface-2 rounded-xl p-3 text-left"
                    onClick={() => openEdit(task)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs md:text-sm font-medium break-words">{task.title}</p>
                      <span className="chip shrink-0">{taskRepeatLabel(task)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {task.taskTime && <span className="chip font-mono">{task.taskTime}</span>}
                      <span className="chip">{PRIORITIES.find((item) => item.id === task.priority)?.label || "Média"}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {futureTasks.length > 0 && (
            <div className="surface rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Próximas datas</p>
                  <p className="text-dim text-xs mt-1">Tarefas agendadas depois desta semana.</p>
                </div>
                <Clock3 size={16} className="text-faint" />
              </div>

              <div className="flex flex-col gap-2 mt-3">
                {futureTasks.slice(0, 12).map((task) => (
                  <div key={task.id} className="surface-2 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs md:text-sm font-medium break-words">{task.title}</p>
                      <p className="text-[9px] text-faint mt-1">
                        {new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}
                        {task.estimatedMinutes > 0 ? ` · ${taskEstimatedLabel(task.estimatedMinutes)}` : ""}
                      </p>
                    </div>
                    <button className="btn-ghost rounded-lg p-2 shrink-0" onClick={() => openEdit(task)}>
                      <Pencil size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {unscheduledTasks.length === 0 && recurringTasks.length === 0 && futureTasks.length === 0 && tasks.length === 0 && (
            <div className="surface rounded-2xl p-5 text-center text-dim text-sm">
              Crie tarefas para começar seu planejamento.
            </div>
          )}
        </>
      )}

      {focusTask && (
        <TaskFocusModal
          task={tasks.find((task) => task.id === focusTask.id) || focusTask}
          onClose={() => setFocusTask(null)}
          onSave={saveTask}
          onComplete={() =>
            setStatus(
              focusTask.id,
              "concluida",
              taskOccursOnDate(focusTask, t)
                ? t
                : (focusTask.dueDate || t)
            )
          }
        />
      )}

      {showForm && (
        <TaskForm
          initial={editing}
          isPro={isPro}
          onUpgrade={onUpgrade}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSave={(task) => {
            const saved = saveTask(task);
            if (saved === false) return;
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   CALENDAR
----------------------------------------------------------------*/
function calendarWorkoutCountForDate(workoutTemplates, workoutSessions, date) {
  const templateIds = new Set(
    (workoutSessions || [])
      .filter((session) => session.date === date)
      .map((session) => session.templateId)
  );

  (workoutTemplates || [])
    .filter((template) => (template.scheduleDays || []).includes(weekdayIndex(date)))
    .forEach((template) => templateIds.add(template.id));

  return templateIds.size;
}

function calendarIntelligenceSnapshot({ tasks, workoutTemplates, workoutSessions, bills, anchorDate }) {
  const weekStart = startOfWeek(anchorDate || today());
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const dayRows = days.map((date) => {
    const dayTasks = (tasks || []).filter((task) => taskOccursOnDate(task, date));
    const pendingTasks = dayTasks.filter((task) => !taskDoneOnDate(task, date));
    const estimatedMinutes = dayTasks.reduce(
      (sum, task) => sum + Math.max(0, Number(task.estimatedMinutes || 0)),
      0
    );
    const workouts = calendarWorkoutCountForDate(workoutTemplates, workoutSessions, date);
    const dayBills = (bills || []).filter((bill) => bill.status !== "pago" && bill.dueDate === date);

    const timeMap = new Map();
    pendingTasks
      .filter((task) => task.taskTime)
      .forEach((task) => timeMap.set(task.taskTime, (timeMap.get(task.taskTime) || 0) + 1));
    const conflicts = [...timeMap.entries()].filter(([, count]) => count > 1);

    return {
      date,
      taskCount: dayTasks.length,
      pendingCount: pendingTasks.length,
      estimatedMinutes,
      workouts,
      bills: dayBills.length,
      conflicts,
      itemCount: dayTasks.length + workouts + dayBills.length,
    };
  });

  const hasEstimates = dayRows.some((row) => row.estimatedMinutes > 0);
  const ranked = [...dayRows].sort((a, b) => {
    if (hasEstimates && b.estimatedMinutes !== a.estimatedMinutes) {
      return b.estimatedMinutes - a.estimatedMinutes;
    }
    return b.itemCount - a.itemCount;
  });

  const fullest = ranked[0] || dayRows[0];
  const freest = [...dayRows].sort((a, b) => {
    if (hasEstimates && a.estimatedMinutes !== b.estimatedMinutes) {
      return a.estimatedMinutes - b.estimatedMinutes;
    }
    return a.itemCount - b.itemCount;
  })[0] || dayRows[0];

  const tomorrow = addDays(today(), 1);
  const tomorrowTasks = (tasks || []).filter((task) => taskOccursOnDate(task, tomorrow));

  const weekEnd = addDays(weekStart, 6);
  const weekBills = (bills || [])
    .filter((bill) =>
      bill.status !== "pago" &&
      bill.dueDate &&
      bill.dueDate >= weekStart &&
      bill.dueDate <= weekEnd
    )
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  const overdueTasks = (tasks || []).filter((task) =>
    !isRecurringTask(task) &&
    task.status !== "concluida" &&
    task.dueDate &&
    task.dueDate < today()
  );

  const workoutDays = dayRows.filter((row) => row.workouts > 0).map((row) => row.date);
  let consecutiveWorkoutPair = null;
  for (let index = 1; index < workoutDays.length; index += 1) {
    if (workoutDays[index] === addDays(workoutDays[index - 1], 1)) {
      consecutiveWorkoutPair = [workoutDays[index - 1], workoutDays[index]];
      break;
    }
  }

  const totalConflicts = dayRows.reduce((sum, row) => sum + row.conflicts.length, 0);

  return {
    weekStart,
    weekEnd,
    dayRows,
    hasEstimates,
    fullest,
    freest,
    tomorrowTasks,
    weekBills,
    overdueTasks,
    consecutiveWorkoutPair,
    totalConflicts,
  };
}

function CalendarIntelligencePanel({
  tasks,
  workoutTemplates,
  workoutSessions,
  bills,
  anchorDate,
  isPro,
  onUpgrade,
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const snapshot = calendarIntelligenceSnapshot({
    tasks,
    workoutTemplates,
    workoutSessions,
    bills,
    anchorDate,
  });

  if (!isPro) {
    return (
      <ProLockCard
        feature="intelligence"
        title="Calendar Intelligence"
        description="O PRO identifica dias carregados, conflitos de horário, tarefas atrasadas, contas próximas e os melhores espaços da sua semana."
        onUpgrade={onUpgrade}
      />
    );
  }

  const maxLoad = Math.max(
    1,
    ...snapshot.dayRows.map((row) =>
      snapshot.hasEstimates ? row.estimatedMinutes : row.itemCount
    )
  );

  const insights = [];
  if (snapshot.fullest) {
    insights.push(
      snapshot.hasEstimates && snapshot.fullest.estimatedMinutes > 0
        ? `${WEEKDAYS[weekdayIndex(snapshot.fullest.date)]} está mais carregado, com ${taskEstimatedLabel(snapshot.fullest.estimatedMinutes)} de tarefas estimadas.`
        : `${WEEKDAYS[weekdayIndex(snapshot.fullest.date)]} concentra mais itens na sua semana (${snapshot.fullest.itemCount}).`
    );
  }
  if (snapshot.overdueTasks.length) {
    insights.push(
      `Você tem ${snapshot.overdueTasks.length} tarefa${snapshot.overdueTasks.length === 1 ? "" : "s"} atrasada${snapshot.overdueTasks.length === 1 ? "" : "s"} sem reagendamento.`
    );
  }
  if (snapshot.totalConflicts) {
    insights.push(
      `Existem ${snapshot.totalConflicts} conflito${snapshot.totalConflicts === 1 ? "" : "s"} de horário entre tarefas nesta semana.`
    );
  }
  if (snapshot.consecutiveWorkoutPair) {
    insights.push("Você programou treinos em dias consecutivos nesta semana.");
  }
  if (!insights.length) {
    insights.push("Sua semana está distribuída sem alertas importantes no momento.");
  }

  const ask = (rawQuestion) => {
    const raw = String(rawQuestion || "").trim();
    if (!raw) return;

    const normalized = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    let nextAnswer = "Não consigo te ajudar com essa pergunta no momento.";

    if (/(dia.*mais cheio|mais carregado|mais ocupado)/.test(normalized)) {
      const row = snapshot.fullest;
      if (row) {
        nextAnswer = snapshot.hasEstimates && row.estimatedMinutes > 0
          ? `${WEEKDAYS[weekdayIndex(row.date)]} é seu dia mais carregado, com ${taskEstimatedLabel(row.estimatedMinutes)} de tarefas estimadas.`
          : `${WEEKDAYS[weekdayIndex(row.date)]} é o dia com mais itens programados: ${row.itemCount}.`;
      }
    } else if (/(quantas?.*tarefas?.*amanha|tarefas?.*amanha)/.test(normalized)) {
      nextAnswer = `Você tem ${snapshot.tomorrowTasks.length} tarefa${snapshot.tomorrowTasks.length === 1 ? "" : "s"} programada${snapshot.tomorrowTasks.length === 1 ? "" : "s"} para amanhã.`;
    } else if (/(conta|boleto).*(semana|vence|vencendo)/.test(normalized)) {
      if (!snapshot.weekBills.length) {
        nextAnswer = "Você não tem contas pendentes vencendo nesta semana.";
      } else {
        const total = snapshot.weekBills.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
        nextAnswer = `Você tem ${snapshot.weekBills.length} conta${snapshot.weekBills.length === 1 ? "" : "s"} vencendo nesta semana, totalizando ${money(total)}.`;
      }
    } else if (/(dia.*mais livre|mais livre|menos ocupado)/.test(normalized)) {
      const row = snapshot.freest;
      nextAnswer = row
        ? `${WEEKDAYS[weekdayIndex(row.date)]} é o dia mais livre desta semana, com ${row.itemCount} item${row.itemCount === 1 ? "" : "s"} programado${row.itemCount === 1 ? "" : "s"}.`
        : "Ainda não há dados suficientes.";
    } else if (/(atrasad)/.test(normalized)) {
      nextAnswer = snapshot.overdueTasks.length
        ? `Você tem ${snapshot.overdueTasks.length} tarefa${snapshot.overdueTasks.length === 1 ? "" : "s"} atrasada${snapshot.overdueTasks.length === 1 ? "" : "s"}.`
        : "Você não tem tarefas atrasadas agora.";
    } else if (/(conflito|mesmo horario|mesma hora)/.test(normalized)) {
      nextAnswer = snapshot.totalConflicts
        ? `Encontrei ${snapshot.totalConflicts} conflito${snapshot.totalConflicts === 1 ? "" : "s"} de horário entre suas tarefas nesta semana.`
        : "Não encontrei conflitos de horário nesta semana.";
    }

    setQuestion(raw);
    setAnswer(nextAnswer);
  };

  return (
    <div className="calendar-intelligence surface rounded-2xl p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BrainCircuit size={16} className="text-brass" />
            <p className="text-[10px] text-faint uppercase tracking-widest">Calendar Intelligence · PRO</p>
          </div>
          <p className="font-display text-lg md:text-xl mt-1">Leitura inteligente da sua semana</p>
          <p className="text-[10px] md:text-xs text-dim mt-1">
            Usa apenas tarefas, treinos e contas já registrados no Constancce.
          </p>
        </div>
        <span className="chip shrink-0">semana atual</span>
      </div>

      <div className="calendar-load-grid grid grid-cols-7 gap-1.5 mt-4">
        {snapshot.dayRows.map((row) => {
          const rawLoad = snapshot.hasEstimates ? row.estimatedMinutes : row.itemCount;
          const pct = Math.round(rawLoad / maxLoad * 100);

          return (
            <div key={row.date} className="calendar-load-day surface-2 rounded-xl p-2 min-w-0 text-center">
              <p className="text-[8px] md:text-[9px] text-faint uppercase">{WEEKDAYS[weekdayIndex(row.date)]}</p>
              <div className="calendar-load-track mt-2">
                <span style={{ height: `${Math.max(8, pct)}%` }} />
              </div>
              <p className="font-mono text-[8px] md:text-[9px] mt-1.5 text-dim">
                {snapshot.hasEstimates && row.estimatedMinutes > 0
                  ? taskEstimatedLabel(row.estimatedMinutes)
                  : `${row.itemCount} it.`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
        {insights.slice(0, 3).map((insight, index) => (
          <div key={index} className="calendar-intelligence-card surface-2 rounded-xl p-3">
            <span className="font-mono text-[9px] text-brass">0{index + 1}</span>
            <p className="text-xs mt-1 leading-relaxed">{insight}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-4">
        {[
          "Qual meu dia mais cheio?",
          "Quantas tarefas tenho amanhã?",
          "Tenho alguma conta vencendo esta semana?",
          "Qual dia está mais livre?",
        ].map((prompt) => (
          <button key={prompt} className="chip hover:text-brass" onClick={() => ask(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <input
          className="flex-1 min-w-0 p-3 ring-focus"
          placeholder="Pergunte sobre sua semana..."
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask(question);
          }}
        />
        <button className="btn-primary rounded-xl px-4 py-2.5 text-sm shrink-0" onClick={() => ask(question)}>
          Perguntar
        </button>
      </div>

      {answer && (
        <div className="calendar-intelligence-answer surface-2 rounded-xl p-3 mt-3">
          <p className="text-[9px] text-faint uppercase tracking-widest">Constancce</p>
          <p className="text-sm mt-1 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

function CalendarView({
  habits,
  completions,
  tasks,
  saveTask,
  setTaskStatus,
  workoutTemplates,
  workoutSessions,
  saveWorkoutTemplate,
  scheduleWorkoutSession,
  goals,
  profile,
  setProfile,
  isPro,
  onUpgrade,
}) {
  const [mode, setMode] = useState("today");
  const [selected, setSelected] = useState(today());
  const [cursor, setCursor] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date;
  });
  const [filter, setFilter] = useState("all");
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showWorkoutPicker, setShowWorkoutPicker] = useState(false);
  const [showWorkoutForm, setShowWorkoutForm] = useState(false);
  const [selectedWorkoutTemplateId, setSelectedWorkoutTemplateId] = useState("");
  const [showBillForm, setShowBillForm] = useState(false);
  const [rescheduleTaskId, setRescheduleTaskId] = useState(null);
  const [dragTargetDate, setDragTargetDate] = useState(null);
  const calendarSwipeRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.querySelector(".app-main")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    });
  }, [mode]);

  const bills = profile?.financeBills || [];
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let index = 0; index < firstDow; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);

  const syncCursorToDate = (dateStr) => {
    const date = new Date(`${dateStr}T12:00:00`);
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const setSelectedDate = (dateStr) => {
    setSelected(dateStr);
    syncCursorToDate(dateStr);
  };

  const weekStart = startOfWeek(selected);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const getWorkoutEvents = (date) => {
    const sessionRows = workoutSessions
      .filter((session) => session.date === date)
      .map((session) => ({
        id: `session-${session.id}`,
        templateId: session.templateId,
        session,
        template: workoutTemplates.find((template) => template.id === session.templateId),
        completed: Boolean(session.completed),
        planned: Boolean(session.plannedOnly),
      }));

    const existingTemplateIds = new Set(sessionRows.map((row) => row.templateId));

    const scheduledRows = workoutTemplates
      .filter((template) =>
        (template.scheduleDays || []).includes(weekdayIndex(date)) &&
        !existingTemplateIds.has(template.id)
      )
      .map((template) => ({
        id: `scheduled-${template.id}-${date}`,
        templateId: template.id,
        session: null,
        template,
        completed: false,
        planned: true,
      }));

    return [...sessionRows, ...scheduledRows];
  };

  const getDayData = (date) => {
    const dayTasks = tasks
      .filter((task) => taskOccursOnDate(task, date))
      .sort((a, b) => (a.taskTime || "99:99").localeCompare(b.taskTime || "99:99"));
    const dayHabits = habits.filter((habit) => habitValidOnDate(habit, date, completions));
    const doneHabitIds = new Set(
      completions
        .filter((completion) => completion.date === date)
        .map((completion) => completion.habitId)
    );
    const dayWorkouts = getWorkoutEvents(date);
    const dayBills = bills
      .filter((bill) => bill.dueDate === date)
      .sort((a, b) => String(a.description || "").localeCompare(String(b.description || ""), "pt-BR"));
    const dayGoals = goals.filter((goal) =>
      !goal.archived &&
      (goal.endDate === date || String(goal.completedAt || "").slice(0, 10) === date)
    );

    const taskDoneCount = dayTasks.filter((task) => taskDoneOnDate(task, date)).length;
    const estimatedMinutes = dayTasks.reduce(
      (sum, task) => sum + Math.max(0, Number(task.estimatedMinutes || 0)),
      0
    );

    const timeMap = new Map();
    dayTasks
      .filter((task) => !taskDoneOnDate(task, date) && task.taskTime)
      .forEach((task) => timeMap.set(task.taskTime, (timeMap.get(task.taskTime) || 0) + 1));
    const conflicts = [...timeMap.entries()].filter(([, count]) => count > 1);

    const nextTask = dayTasks
      .filter((task) => !taskDoneOnDate(task, date))
      .sort((a, b) => taskPriorityScore(b, date) - taskPriorityScore(a, date))[0] || null;

    return {
      tasks: dayTasks,
      habits: dayHabits,
      doneHabitIds,
      workouts: dayWorkouts,
      bills: dayBills,
      goals: dayGoals,
      taskDoneCount,
      estimatedMinutes,
      conflicts,
      nextTask,
      totalItems: dayTasks.length + dayHabits.length + dayWorkouts.length + dayBills.length + dayGoals.length,
    };
  };

  const selectedData = getDayData(selected);

  const showType = (id) => filter === "all" || filter === id;

  const visibleSelectedItemCount =
    (showType("tasks") ? selectedData.tasks.length : 0) +
    (showType("workouts") ? selectedData.workouts.length : 0) +
    (showType("finance") ? selectedData.bills.length : 0) +
    (showType("habits") ? selectedData.habits.length : 0) +
    (showType("goals") ? selectedData.goals.length : 0);

  const selectedLabel = capitalizeFirst(new Date(`${selected}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: mode === "today" ? "numeric" : undefined,
  }));

  const goToday = () => {
    setSelectedDate(today());
    setMode("today");
  };

  const navigatePeriod = (direction) => {
    if (mode === "today") {
      setSelectedDate(addDays(selected, direction));
      return;
    }

    if (mode === "week") {
      setSelectedDate(addDays(selected, direction * 7));
      return;
    }

    const next = new Date(year, month + direction, 1);
    setCursor(next);
    setSelected(fmt(next));
  };

  const onCalendarTouchStart = (event) => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;
    const target = event.target;
    if (target?.closest?.("input, textarea, select, button, .overflow-x-auto")) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    calendarSwipeRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  };

  const onCalendarTouchEnd = (event) => {
    const start = calendarSwipeRef.current;
    calendarSwipeRef.current = null;
    if (!start || typeof window === "undefined" || window.innerWidth >= 768) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2 || Date.now() - start.at > 850) return;
    navigatePeriod(dx < 0 ? 1 : -1);
  };

  const rescheduleTask = (task, date) => {
    if (!task || !date || isRecurringTask(task)) return;
    saveTask({
      ...task,
      dueDate: date,
      deferCount: Number(task.deferCount || 0) + 1,
      lastDeferredAt: new Date().toISOString(),
      status: task.status === "concluida" ? "pendente" : task.status,
      completedAt: task.status === "concluida" ? undefined : task.completedAt,
    });
    setRescheduleTaskId(null);
  };

  const saveCalendarBill = (bill) => {
    setProfile((current) => ({
      ...current,
      financeBills: [...(current?.financeBills || []), bill],
    }));
    setShowBillForm(false);
  };

  const scheduleSelectedWorkout = () => {
    if (!selectedWorkoutTemplateId) return;
    scheduleWorkoutSession(selectedWorkoutTemplateId, selected);
    setShowWorkoutPicker(false);
    setSelectedWorkoutTemplateId("");
  };

  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthTasks = tasks.filter((task) => {
    if (isRecurringTask(task)) {
      return Array.from({ length: daysInMonth }, (_, index) => fmt(new Date(year, month, index + 1)))
        .some((date) => taskOccursOnDate(task, date));
    }
    return String(task.dueDate || "").startsWith(monthPrefix);
  });
  const monthCompletedTasks = monthTasks.filter((task) => {
    if (isRecurringTask(task)) {
      return (task.completionDates || []).some((date) => String(date).startsWith(monthPrefix));
    }
    return task.status === "concluida";
  }).length;
  const monthWorkouts = workoutSessions.filter(
    (session) => session.completed && String(session.date || "").startsWith(monthPrefix)
  ).length;
  const monthBills = bills.filter((bill) => String(bill.dueDate || "").startsWith(monthPrefix)).length;

  const renderDayPanel = () => (
    <div key={selected} className="calendar-day-panel fade-in">
      <div className="calendar-day-summary surface rounded-2xl p-4 md:p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] text-faint uppercase tracking-widest">Resumo do dia</p>
              {selected === today() && <span className="chip text-brass">Hoje</span>}
              {selectedData.conflicts.length > 0 && (
                <span className="chip text-ember">
                  {selectedData.conflicts.length === 1
                    ? `${selectedData.conflicts[0][1]} itens às ${selectedData.conflicts[0][0]}`
                    : `${selectedData.conflicts.length} conflitos de horário`}
                </span>
              )}
            </div>
            <p className="font-display text-xl md:text-2xl mt-1 break-words">{selectedLabel}</p>

            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="chip">{selectedData.tasks.length} tarefas</span>
              <span className="chip">{selectedData.workouts.length} treino{selectedData.workouts.length === 1 ? "" : "s"}</span>
              <span className="chip">{selectedData.bills.length} conta{selectedData.bills.length === 1 ? "" : "s"}</span>
              {selectedData.estimatedMinutes > 0 && (
                <span className="chip">~{taskEstimatedLabel(selectedData.estimatedMinutes)} planejados</span>
              )}
            </div>

            {selectedData.tasks.length > 0 && (
              <div className="max-w-xl mt-3">
                <div className="flex items-center justify-between gap-2 text-[10px] mb-1.5">
                  <span className="text-faint">Tarefas concluídas</span>
                  <span className="font-mono text-dim">{selectedData.taskDoneCount}/{selectedData.tasks.length}</span>
                </div>
                <Progress
                  value={Math.round(selectedData.taskDoneCount / selectedData.tasks.length * 100)}
                  height={5}
                />
              </div>
            )}
          </div>

          {selected >= today() && (
            <button
              className="calendar-add-button btn-primary rounded-xl px-4 py-2.5 text-sm shrink-0 flex items-center justify-center gap-1.5"
              onClick={() => setShowQuickMenu(true)}
            >
              <Plus size={14} /> Adicionar
            </button>
          )}
        </div>

        {selectedData.nextTask && (
          <div className="calendar-next-action surface-2 rounded-xl p-3 mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] text-faint uppercase tracking-widest">Próxima ação</p>
              <p className="text-sm font-medium mt-1 break-words">{selectedData.nextTask.title}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {selectedData.nextTask.taskTime && <span className="chip font-mono">{selectedData.nextTask.taskTime}</span>}
                <span className="chip">{PRIORITIES.find((item) => item.id === selectedData.nextTask.priority)?.label || "Média"}</span>
              </div>
            </div>
            {selected === today() && (
              <span className="chip text-brass shrink-0">{taskPriorityReason(selectedData.nextTask, selected)}</span>
            )}
          </div>
        )}
      </div>

      <div className="calendar-agenda surface glass-panel rounded-2xl p-4 md:p-5 mt-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] text-faint uppercase tracking-widest">Agenda</p>
            <p className="text-[10px] md:text-xs text-dim mt-1">
              {visibleSelectedItemCount} item{visibleSelectedItemCount === 1 ? "" : "s"} visível{visibleSelectedItemCount === 1 ? "" : "is"}
            </p>
          </div>
          <Clock3 size={16} className="text-faint" />
        </div>

        <div className="flex flex-col gap-2">
          {showType("tasks") && selectedData.tasks.map((task) => {
            const done = taskDoneOnDate(task, selected);
            const isRescheduling = rescheduleTaskId === task.id;

            return (
              <div
                key={`task-${task.id}`}
                className="calendar-agenda-item surface-2 rounded-xl p-3"
                draggable={
                  !isRecurringTask(task) &&
                  (typeof window === "undefined" || window.innerWidth >= 768)
                }
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/calendar-task-id", task.id);
                }}
              >
                <div className="flex items-start gap-3">
                  <button
                    className="shrink-0 mt-0.5"
                    onClick={() =>
                      setTaskStatus(task.id, done ? "pendente" : "concluida", selected)
                    }
                  >
                    {done
                      ? <CheckCircle2 size={17} className="text-moss" />
                      : <Circle size={17} className="text-brass" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {task.taskTime && <span className="calendar-time font-mono text-[10px] text-brass">{task.taskTime}</span>}
                          <span className="text-[9px] text-faint uppercase">Tarefa</span>
                        </div>
                        <p className={`text-sm font-medium mt-1 break-words ${done ? "text-dim line-through" : ""}`}>{task.title}</p>
                      </div>
                      <span className="chip shrink-0">{PRIORITIES.find((item) => item.id === task.priority)?.label || "Média"}</span>
                    </div>

                    {(task.subtasks || []).length > 0 && (
                      <p className="text-[9px] text-faint mt-1.5">
                        {(task.subtasks || []).filter((item) => item.done).length}/{task.subtasks.length} subtarefas
                      </p>
                    )}

                    {!isRecurringTask(task) && !done && (
                      <div className="mt-2">
                        <button
                          className="btn-ghost rounded-lg px-2.5 py-1.5 text-[10px]"
                          onClick={() => setRescheduleTaskId(isRescheduling ? null : task.id)}
                        >
                          Reagendar
                        </button>

                        {isRescheduling && (
                          <div className="calendar-reschedule-row grid grid-cols-3 gap-1.5 mt-2">
                            <button className="btn-ghost rounded-lg py-2 text-[10px]" onClick={() => rescheduleTask(task, today())}>
                              Hoje
                            </button>
                            <button className="btn-ghost rounded-lg py-2 text-[10px]" onClick={() => rescheduleTask(task, addDays(today(), 1))}>
                              Amanhã
                            </button>
                            <input
                              type="date"
                              min={today()}
                              className="min-w-0 w-full p-2 text-[10px] ring-focus"
                              value=""
                              onChange={(event) => {
                                if (event.target.value) rescheduleTask(task, event.target.value);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {showType("workouts") && selectedData.workouts.map((row) => (
            <div key={row.id} className="calendar-agenda-item surface-2 rounded-xl p-3 flex items-start gap-3">
              {row.completed
                ? <CheckCircle2 size={17} className="text-moss shrink-0 mt-0.5" />
                : <Dumbbell size={17} className="text-brass shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="text-[9px] text-faint uppercase">Treino</p>
                <p className="text-sm font-medium mt-1 break-words">{row.template?.name || "Treino"}</p>
                <p className="text-[9px] text-faint mt-1">
                  {row.completed ? "Concluído" : row.session?.plannedOnly ? "Programado para esta data" : "Programado"}
                </p>
              </div>
            </div>
          ))}

          {showType("finance") && selectedData.bills.map((bill) => (
            <div key={`bill-${bill.id}`} className="calendar-agenda-item surface-2 rounded-xl p-3 flex items-start gap-3">
              <CreditCard size={17} className={`shrink-0 mt-0.5 ${bill.status === "pago" ? "text-moss" : bill.dueDate < today() ? "text-ember" : "text-brass"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[9px] text-faint uppercase">Finanças</p>
                <div className="flex flex-wrap items-start justify-between gap-2 mt-1">
                  <p className="text-sm font-medium break-words">{bill.description}</p>
                  <span className="font-mono text-xs shrink-0">{money(bill.value)}</span>
                </div>
                <p className="text-[9px] text-faint mt-1">
                  {bill.status === "pago" ? "Pago" : bill.dueDate < today() ? "Vencida" : "Vence neste dia"}
                </p>
              </div>
            </div>
          ))}

          {showType("habits") && selectedData.habits.map((habit) => {
            const done = selectedData.doneHabitIds.has(habit.id);
            return (
              <div key={`habit-${habit.id}`} className="calendar-agenda-item surface-2 rounded-xl p-3 flex items-start gap-3">
                {done
                  ? <CheckCircle2 size={17} className="text-moss shrink-0 mt-0.5" />
                  : <ListChecks size={17} className="text-faint shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-[9px] text-faint uppercase">Hábito</p>
                  <p className="text-sm font-medium mt-1 break-words">{habit.name}</p>
                  <p className="text-[9px] text-faint mt-1">{done ? "Concluído" : "Pendente"}</p>
                </div>
              </div>
            );
          })}

          {showType("goals") && selectedData.goals.map((goal) => (
            <div key={`goal-${goal.id}`} className="calendar-agenda-item surface-2 rounded-xl p-3 flex items-start gap-3">
              <Target size={17} className="text-brass shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[9px] text-faint uppercase">Meta</p>
                <p className="text-sm font-medium mt-1 break-words">{goal.name}</p>
                <p className="text-[9px] text-faint mt-1">
                  {String(goal.completedAt || "").slice(0, 10) === selected ? "Concluída neste dia" : "Prazo da meta"}
                </p>
              </div>
            </div>
          ))}

          {visibleSelectedItemCount === 0 && (
            <div className="calendar-empty-day rounded-xl border border-dashed p-5 text-center text-dim text-sm">
              Nenhum item visível neste dia.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="calendar-view calendar-modern flex flex-col gap-4 md:gap-5"
      data-no-swipe
      onTouchStart={onCalendarTouchStart}
      onTouchEnd={onCalendarTouchEnd}
    >
      <div className="calendar-main-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl md:text-3xl">Calendário</h2>
          <p className="text-dim text-xs md:text-sm mt-1">
            Tarefas, treinos, contas, hábitos e metas em uma única visão temporal.
          </p>
        </div>

        <button className="btn-ghost rounded-xl px-3 py-2 text-xs self-start sm:self-auto" onClick={goToday}>
          Hoje
        </button>
      </div>

      <div className="calendar-mode-tabs task-glass-tabs rounded-2xl p-1 grid grid-cols-3 gap-1">
        {[
          ["today", "Hoje"],
          ["week", "Semana"],
          ["month", "Mês"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`calendar-mode-tab task-tab-button rounded-xl py-2 text-[10px] sm:text-xs md:text-sm font-medium ${mode === id ? "task-tab-active" : ""}`}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="calendar-filter-scroll flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
        {[
          ["all", "Tudo"],
          ["tasks", "Tarefas"],
          ["workouts", "Treinos"],
          ["finance", "Finanças"],
          ["habits", "Hábitos"],
          ["goals", "Metas"],
        ].map(([id, label]) => (
          <button
            key={id}
            className="calendar-filter-chip chip whitespace-nowrap"
            onClick={() => setFilter(id)}
            style={{
              borderColor: filter === id ? "var(--brass)" : "var(--border)",
              color: filter === id ? "var(--brass)" : "var(--text-dim)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="calendar-period-nav surface rounded-2xl p-2 md:p-3 flex items-center justify-between gap-3">
        <button className="btn-ghost rounded-xl p-2.5 shrink-0" onClick={() => navigatePeriod(-1)} aria-label="Período anterior">
          <ChevronLeft size={17} />
        </button>

        <div className="text-center min-w-0">
          <p className="font-display text-base md:text-lg capitalize break-words">
            {mode === "month"
              ? `${MONTHS[month]} ${year}`
              : mode === "week"
                ? `${dateLabel(weekStart, { day: "2-digit", month: "short" })} — ${dateLabel(addDays(weekStart, 6), { day: "2-digit", month: "short" })}`
                : dateLabel(selected, { day: "2-digit", month: "short", year: "numeric" })}
          </p>
          <p className="text-[9px] md:text-[10px] text-faint mt-0.5">
            No celular, deslize para navegar
          </p>
        </div>

        <button className="btn-ghost rounded-xl p-2.5 shrink-0" onClick={() => navigatePeriod(1)} aria-label="Próximo período">
          <ChevronRight size={17} />
        </button>
      </div>

      {mode === "today" && renderDayPanel()}

      {mode === "week" && (
        <>
          <div className="calendar-week-view grid grid-cols-1 md:grid-cols-7 gap-2">
            {weekDays.map((date) => {
              const data = getDayData(date);
              const isSelected = date === selected;
              const isToday = date === today();

              return (
                <section
                  key={date}
                  className={`calendar-week-column surface rounded-2xl p-3 ${isSelected ? "calendar-week-selected" : ""} ${dragTargetDate === date ? "calendar-drop-target" : ""}`}
                  onClick={() => setSelectedDate(date)}
                  onDragOver={(event) => {
                    if (typeof window !== "undefined" && window.innerWidth < 768) return;
                    event.preventDefault();
                    setDragTargetDate(date);
                  }}
                  onDragLeave={() => setDragTargetDate(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    const taskId = event.dataTransfer.getData("text/calendar-task-id");
                    const task = tasks.find((item) => item.id === taskId);
                    if (task && !isRecurringTask(task)) rescheduleTask(task, date);
                    setDragTargetDate(null);
                  }}
                >
                  <button className="w-full text-left" onClick={() => setSelectedDate(date)}>
                    <div className="flex md:block items-center justify-between gap-2">
                      <div>
                        <p className={`text-[9px] uppercase ${isToday ? "text-brass" : "text-faint"}`}>{WEEKDAYS[weekdayIndex(date)]}</p>
                        <p className="font-display text-lg mt-0.5">{new Date(`${date}T12:00:00`).getDate()}</p>
                      </div>
                      <span className="chip md:mt-1">
                        {(showType("tasks") ? data.tasks.length : 0) +
                         (showType("workouts") ? data.workouts.length : 0) +
                         (showType("finance") ? data.bills.length : 0) +
                         (showType("habits") ? data.habits.length : 0) +
                         (showType("goals") ? data.goals.length : 0)}
                      </span>
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[8px] text-faint mb-1">
                        <span>Tarefas</span>
                        <span>{data.taskDoneCount}/{data.tasks.length}</span>
                      </div>
                      <Progress
                        value={data.tasks.length ? Math.round(data.taskDoneCount / data.tasks.length * 100) : 0}
                        height={4}
                      />
                    </div>

                    <div className="flex flex-wrap gap-1 mt-2">
                      {showType("tasks") && data.tasks.length > 0 && <span className="calendar-dot bg-brass" />}
                      {showType("workouts") && data.workouts.length > 0 && <span className="calendar-dot bg-moss" />}
                      {showType("finance") && data.bills.length > 0 && <span className="calendar-dot bg-ember" />}
                      {showType("habits") && data.habits.length > 0 && <span className="calendar-dot" style={{ background: "var(--text-dim)" }} />}
                    </div>

                    {data.estimatedMinutes > 0 && (
                      <p className="text-[8px] text-faint mt-2">~{taskEstimatedLabel(data.estimatedMinutes)}</p>
                    )}
                  </button>

                  {showType("tasks") && (
                    <div className="hidden md:flex flex-col gap-1 mt-2">
                      {data.tasks.slice(0, 3).map((task) => (
                        <div
                          key={task.id}
                          draggable={!isRecurringTask(task)}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/calendar-task-id", task.id);
                          }}
                          className="calendar-week-task rounded-lg px-2 py-1.5 text-[9px] break-words"
                        >
                          {task.taskTime ? `${task.taskTime} · ` : ""}{task.title}
                        </div>
                      ))}
                      {data.tasks.length > 3 && <p className="text-[8px] text-faint">+{data.tasks.length - 3} tarefas</p>}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {renderDayPanel()}
        </>
      )}

      {mode === "month" && (
        <>
          <div className="calendar-month-shell surface rounded-2xl p-3 md:p-5">
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="surface-2 rounded-xl p-3 min-w-0">
                <p className="text-[8px] md:text-[9px] text-faint uppercase tracking-widest">Tarefas</p>
                <p className="font-display text-lg md:text-xl mt-1">{monthCompletedTasks}</p>
                <p className="text-[8px] md:text-[9px] text-faint">concluídas</p>
              </div>
              <div className="surface-2 rounded-xl p-3 min-w-0">
                <p className="text-[8px] md:text-[9px] text-faint uppercase tracking-widest">Treinos</p>
                <p className="font-display text-lg md:text-xl mt-1">{monthWorkouts}</p>
                <p className="text-[8px] md:text-[9px] text-faint">concluídos</p>
              </div>
              <div className="surface-2 rounded-xl p-3 min-w-0">
                <p className="text-[8px] md:text-[9px] text-faint uppercase tracking-widest">Contas</p>
                <p className="font-display text-lg md:text-xl mt-1">{monthBills}</p>
                <p className="text-[8px] md:text-[9px] text-faint">no mês</p>
              </div>
            </div>

            <div className="calendar-weekdays grid grid-cols-7 gap-1 md:gap-2 mb-1">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="text-center text-faint text-[9px] md:text-[10px] py-1 uppercase tracking-wide">
                  {weekday}
                </div>
              ))}
            </div>

            <div key={`${year}-${month}`} className="calendar-month-grid grid grid-cols-7 gap-1 md:gap-2 tab-in">
              {cells.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} className="calendar-day-empty" />;

                const dateStr = fmt(new Date(year, month, day));
                const data = getDayData(dateStr);
                const isSelected = dateStr === selected;
                const isToday = dateStr === today();

                const visibleCount =
                  (showType("tasks") ? data.tasks.length : 0) +
                  (showType("workouts") ? data.workouts.length : 0) +
                  (showType("finance") ? data.bills.length : 0) +
                  (showType("habits") ? data.habits.length : 0) +
                  (showType("goals") ? data.goals.length : 0);

                return (
                  <button
                    key={dateStr}
                    onClick={() => setSelectedDate(dateStr)}
                    onDragOver={(event) => {
                      if (typeof window !== "undefined" && window.innerWidth < 768) return;
                      event.preventDefault();
                      setDragTargetDate(dateStr);
                    }}
                    onDragLeave={() => setDragTargetDate(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      const taskId = event.dataTransfer.getData("text/calendar-task-id");
                      const task = tasks.find((item) => item.id === taskId);
                      if (task && !isRecurringTask(task)) rescheduleTask(task, dateStr);
                      setDragTargetDate(null);
                    }}
                    className={`calendar-day rounded-xl relative flex flex-col items-center justify-center gap-1 ${isSelected ? "calendar-day-selected" : ""} ${dragTargetDate === dateStr ? "calendar-drop-target" : ""}`}
                    style={{
                      border: isSelected
                        ? "1.5px solid var(--brass)"
                        : isToday
                          ? "1px solid var(--brass-dim)"
                          : "1px solid var(--border-soft)",
                      background: "var(--surface-2)",
                    }}
                  >
                    <span className={`font-mono text-xs md:text-sm ${isToday ? "text-brass" : ""}`}>{day}</span>

                    <div className="calendar-day-dots flex items-center justify-center gap-1 min-h-[5px]">
                      {showType("tasks") && data.tasks.length > 0 && <span className="calendar-dot bg-brass" />}
                      {showType("workouts") && data.workouts.length > 0 && <span className="calendar-dot bg-moss" />}
                      {showType("finance") && data.bills.length > 0 && <span className="calendar-dot bg-ember" />}
                      {showType("habits") && data.habits.length > 0 && <span className="calendar-dot" style={{ background: "var(--text-dim)" }} />}
                      {showType("goals") && data.goals.length > 0 && <span className="calendar-dot" style={{ background: "var(--brass)" }} />}
                    </div>

                    {visibleCount > 3 && (
                      <span className="calendar-more-count text-[7px] md:text-[8px] text-faint">+{visibleCount - 3}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-[9px] md:text-[10px] text-faint">
              <span className="flex items-center gap-1.5"><span className="calendar-dot bg-brass" /> tarefas</span>
              <span className="flex items-center gap-1.5"><span className="calendar-dot bg-moss" /> treino</span>
              <span className="flex items-center gap-1.5"><span className="calendar-dot bg-ember" /> finanças</span>
            </div>
          </div>

          {renderDayPanel()}
        </>
      )}

      <CalendarIntelligencePanel
        tasks={tasks}
        workoutTemplates={workoutTemplates}
        workoutSessions={workoutSessions}
        bills={bills}
        anchorDate={selected}
        isPro={isPro}
        onUpgrade={onUpgrade}
      />

      {showQuickMenu && (
        <Modal title={`Adicionar em ${dateLabel(selected, { day: "2-digit", month: "2-digit" })}`} onClose={() => setShowQuickMenu(false)} width={430}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              className="calendar-quick-create surface-2 rounded-2xl p-4 text-left"
              onClick={() => {
                setShowQuickMenu(false);
                setShowTaskForm(true);
              }}
            >
              <CheckCircle2 size={19} className="text-brass" />
              <p className="font-medium text-sm mt-3">Tarefa</p>
              <p className="text-[10px] text-faint mt-1">Criar já nesta data</p>
            </button>

            <button
              className="calendar-quick-create surface-2 rounded-2xl p-4 text-left"
              onClick={() => {
                setShowQuickMenu(false);
                if (workoutTemplates.length) setShowWorkoutPicker(true);
                else setShowWorkoutForm(true);
              }}
            >
              <Dumbbell size={19} className="text-moss" />
              <p className="font-medium text-sm mt-3">Treino</p>
              <p className="text-[10px] text-faint mt-1">Programar uma sessão</p>
            </button>

            <button
              className="calendar-quick-create surface-2 rounded-2xl p-4 text-left"
              onClick={() => {
                setShowQuickMenu(false);
                setShowBillForm(true);
              }}
            >
              <CreditCard size={19} className="text-ember" />
              <p className="font-medium text-sm mt-3">Conta</p>
              <p className="text-[10px] text-faint mt-1">Cadastrar vencimento</p>
            </button>
          </div>
        </Modal>
      )}

      {showTaskForm && (
        <TaskForm
          initial={null}
          defaultDueDate={selected}
          isPro={isPro}
          onUpgrade={onUpgrade}
          onClose={() => setShowTaskForm(false)}
          onSave={(task) => {
            const saved = saveTask(task);
            if (saved === false) return;
            setShowTaskForm(false);
          }}
        />
      )}

      {showWorkoutPicker && (
        <Modal title="Programar treino" onClose={() => setShowWorkoutPicker(false)} width={480}>
          <Field label="Treino">
            <select
              className="w-full p-3 ring-focus"
              value={selectedWorkoutTemplateId}
              onChange={(event) => setSelectedWorkoutTemplateId(event.target.value)}
            >
              <option value="">Selecione um treino</option>
              {workoutTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </Field>

          <div className="surface-2 rounded-xl p-3 mb-3">
            <p className="text-[9px] text-faint uppercase tracking-widest">Data</p>
            <p className="text-sm mt-1">
              {capitalizeFirst(new Date(`${selected}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }))}
            </p>
          </div>

          <button
            disabled={!selectedWorkoutTemplateId}
            className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
            onClick={scheduleSelectedWorkout}
          >
            Programar sessão
          </button>

          <button
            className="btn-ghost w-full rounded-xl py-2.5 text-xs mt-2"
            onClick={() => {
              setShowWorkoutPicker(false);
              setShowWorkoutForm(true);
            }}
          >
            Criar novo treino
          </button>
        </Modal>
      )}

      {showWorkoutForm && (
        <WorkoutTemplateForm
          initial={null}
          defaultScheduleDays={[]}
          exerciseLibrary={[]}
          onClose={() => setShowWorkoutForm(false)}
          onSave={(template) => {
            const saved = saveWorkoutTemplate(template);
            if (saved === false) return;
            scheduleWorkoutSession(template.id, selected, template);
            setShowWorkoutForm(false);
          }}
        />
      )}

      {showBillForm && (
        <FinanceBillForm
          initial={null}
          defaultDueDate={selected}
          onClose={() => setShowBillForm(false)}
          onSave={saveCalendarBill}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   GOALS
----------------------------------------------------------------*/
function GoalForm({ initial, onSave, onClose, isPro, onUpgrade, tasks = [], habits = [] }) {
  const [name, setName] = useState(initial?.name || "");
  const [type, setType] = useState(initial?.type === "checklist" ? "numerica" : (initial?.type || "financeira"));
  const [target, setTarget] = useState(Number(initial?.type === "checklist" ? 1 : (initial?.target ?? 1000)));
  const [current, setCurrent] = useState(Number(initial?.type === "checklist" ? 0 : (initial?.current ?? 0)));
  const [endDate, setEndDate] = useState(initial?.endDate || "");
  const [nextAction, setNextAction] = useState(initial?.nextAction || "");
  const [isPrimary, setIsPrimary] = useState(Boolean(initial?.isPrimary));
  const [linkedTaskIds, setLinkedTaskIds] = useState(initial?.linkedTaskIds || []);
  const [linkedHabitIds, setLinkedHabitIds] = useState(initial?.linkedHabitIds || []);
  const [milestones, setMilestones] = useState(initial?.milestones?.length ? initial.milestones : [25, 50, 75, 100]);
  const [imageDataUrl, setImageDataUrl] = useState(initial?.imageDataUrl || "");
  const goalImageRef = useRef(null);
  const [confirm, confirmDialog] = useConfirm();
  const [checklist, setChecklist] = useState(() =>
    initial?.checklist?.length
      ? initial.checklist.map((item) => ({ ...item }))
      : []
  );

  const handleGoalImage = async (file) => {
    if (!file) return;
    try {
      setImageDataUrl(await optimizeImageFile(file, 800, 0.74));
    } catch (_) {
      window.alert("Não foi possível processar esta imagem.");
    }
  };

  const addChecklistItem = () =>
    setChecklist((prev) => [...prev, { id: uid(), text: "", done: false }]);

  const updateChecklistItem = (id, text) =>
    setChecklist((prev) => prev.map((item) => item.id === id ? { ...item, text } : item));

  const removeChecklistItem = async (id) => {
    if (!(await confirm("Tem certeza que deseja remover esta etapa?"))) return;
    setChecklist((prev) => prev.filter((item) => item.id !== id));
  };

  const toggleLinkedTask = (id) =>
    setLinkedTaskIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );

  const toggleLinkedHabit = (id) =>
    setLinkedHabitIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );

  const remaining = Math.max(0, Number(target || 0) - Number(current || 0));
  const required = goalRequiredPace({
    type,
    target,
    current,
    endDate,
  });

  const cleanChecklist = checklist
    .filter((item) => item.text.trim())
    .map((item) => ({ ...item, text: item.text.trim() }));
  const isChecklist = cleanChecklist.length > 0;

  return (
    <Modal title={initial ? "Editar meta" : "Nova meta"} onClose={onClose} width={620}>
      <div className="goal-form-hero surface-2 rounded-2xl p-3 md:p-4 mb-3">
        <Field label="Nome da meta">
          <input
            autoFocus={!initial}
            className="w-full p-3 ring-focus"
            placeholder="Ex: Viagem para o Japão"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="Próxima ação">
          <input
            className="w-full p-3 ring-focus"
            placeholder="Ex: Guardar R$ 500 neste mês"
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
          />
          <p className="text-[10px] text-faint mt-1.5">
            Transforme a meta em uma ação concreta que pode ser executada agora.
          </p>
        </Field>

        <button
          type="button"
          className="goal-primary-toggle w-full rounded-xl p-3 flex items-center justify-between gap-3 text-left"
          onClick={() => setIsPrimary((value) => !value)}
          style={{
            border: `1px solid ${isPrimary ? "var(--brass)" : "var(--border)"}`,
            background: isPrimary ? "color-mix(in srgb, var(--brass) 7%, var(--surface))" : "transparent",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Star size={15} className={isPrimary ? "text-brass" : "text-faint"} />
            <div className="min-w-0">
              <p className="text-xs font-medium">Meta principal</p>
              <p className="text-[9px] text-faint mt-0.5">Apenas uma meta pode ficar em destaque.</p>
            </div>
          </div>
          <span className="chip shrink-0">{isPrimary ? "Ativa" : "Não"}</span>
        </button>
      </div>

      {isPro ? (
        <Field label="Foto da meta (opcional)">
          <div className="surface-2 rounded-2xl overflow-hidden">
            {imageDataUrl ? (
              <div className="relative">
                <img src={imageDataUrl} alt="Foto da meta" className="w-full h-40 object-cover block" />
                <div className="absolute right-2 bottom-2 flex gap-2">
                  <button type="button" className="btn-ghost rounded-lg px-3 py-2 text-xs" onClick={() => goalImageRef.current?.click()}>
                    Trocar
                  </button>
                  <button type="button" className="btn-ghost rounded-lg px-3 py-2 text-xs text-ember" onClick={() => setImageDataUrl("")}>
                    Remover
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="w-full min-h-[110px] flex flex-col items-center justify-center gap-2 text-dim" onClick={() => goalImageRef.current?.click()}>
                <ImageIcon size={22} className="text-brass" />
                <span className="text-sm">Adicionar uma foto</span>
                <span className="text-[10px] text-faint">Use uma imagem que represente o objetivo.</span>
              </button>
            )}
            <input
              ref={goalImageRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleGoalImage(file);
                event.target.value = "";
              }}
            />
          </div>
        </Field>
      ) : imageDataUrl ? (
        <div className="surface-2 rounded-2xl overflow-hidden mb-3">
          <img src={imageDataUrl} alt="Foto atual da meta" className="w-full h-36 object-cover block opacity-80" />
          <div className="p-3">
            <div className="flex items-center gap-2">
              <Lock size={13} className="text-brass" />
              <p className="text-xs font-medium">Foto preservada</p>
              <ProBadge compact />
            </div>
            <p className="text-[10px] text-faint mt-1">Sua imagem continua salva. Alterar ou adicionar fotos às metas é um recurso PRO.</p>
            <button type="button" className="text-xs text-brass mt-2" onClick={() => onUpgrade("goals")}>Conhecer o PRO</button>
          </div>
        </div>
      ) : (
        <ProLockCard
          feature="goals"
          title="Foto personalizada na meta"
          description="No PRO, transforme cada meta em uma caixinha visual com sua própria imagem."
          onUpgrade={onUpgrade}
          compact
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className="w-full p-3 ring-focus" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="financeira">Financeira (R$)</option>
            <option value="numerica">Numérica</option>
            <option value="quantidade">Quantidade</option>
            <option value="frequencia">Frequência</option>
            <option value="prazo">Prazo</option>
          </select>
        </Field>

        <Field label="Prazo (opcional)">
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="w-full p-3 ring-focus"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
            {endDate && (
              <button type="button" className="btn-ghost rounded-xl px-3 py-3 text-xs shrink-0" onClick={() => setEndDate("")}>
                Sem prazo
              </button>
            )}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={type === "financeira" ? "Meta final (R$)" : "Valor alvo"}>
          <input
            type="number"
            min="0"
            step={type === "financeira" ? "0.01" : "1"}
            className="w-full p-3 ring-focus"
            value={target}
            onChange={(event) => setTarget(Math.max(0, Number(event.target.value)))}
          />
        </Field>

        <Field label={type === "financeira" ? "Valor já acumulado (R$)" : "Progresso atual"}>
          <input
            type="number"
            min="0"
            step={type === "financeira" ? "0.01" : "1"}
            className="w-full p-3 ring-focus"
            value={current}
            onChange={(event) => setCurrent(Math.max(0, Number(event.target.value)))}
          />
        </Field>
      </div>

      {endDate && !isChecklist && Number(target) > 0 && (
        <div className="goal-form-pace surface-2 rounded-2xl p-4 mb-3">
          <p className="text-[10px] text-faint uppercase tracking-widest">Ritmo necessário</p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <p className="text-[10px] text-faint">Restante</p>
              <p className="font-display text-lg mt-0.5">
                {type === "financeira" ? money(remaining) : remaining.toLocaleString("pt-BR")}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-faint">Até o prazo</p>
              <p className="font-display text-lg text-brass mt-0.5">
                {type === "financeira" ? money(required.value) : required.value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/{required.unit}
              </p>
            </div>
          </div>
        </div>
      )}

      {!isChecklist && (
        <Field label="Marcos da meta">
          <div className="grid grid-cols-4 gap-2">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                className="rounded-xl py-2 text-xs"
                onClick={() => setMilestones((prev) => prev.includes(pct) ? prev.filter((item) => item !== pct) : [...prev, pct].sort((a, b) => a - b))}
                style={{
                  border: `1px solid ${milestones.includes(pct) ? "var(--brass)" : "var(--border)"}`,
                  background: milestones.includes(pct) ? "var(--surface-2)" : "transparent",
                  color: milestones.includes(pct) ? "var(--brass)" : "var(--text-dim)",
                }}
              >
                {pct}%
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Etapas da meta (opcional)">
        <div className="flex flex-col gap-2">
          {checklist.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2">
              {item.done ? <CheckCircle2 size={16} className="text-moss shrink-0" /> : <Circle size={16} className="text-faint shrink-0" />}
              <input
                className="flex-1 min-w-0 p-2.5 text-sm ring-focus"
                placeholder={`Etapa ${index + 1}`}
                value={item.text}
                onChange={(event) => updateChecklistItem(item.id, event.target.value)}
              />
              <button className="btn-ghost rounded-lg p-2" onClick={() => removeChecklistItem(item.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            className="btn-ghost rounded-xl py-2 text-sm flex items-center justify-center gap-1"
            onClick={addChecklistItem}
          >
            <Plus size={14} /> Adicionar etapa
          </button>
        </div>
      </Field>

      {(tasks.length > 0 || habits.length > 0) && (
        <div className="goal-related-form surface-2 rounded-2xl p-3 md:p-4 mb-3">
          <div className="flex items-center gap-2 mb-3">
            <Layers3 size={14} className="text-brass" />
            <div>
              <p className="text-xs font-medium">Relacionados</p>
              <p className="text-[9px] text-faint mt-0.5">Conecte ações que ajudam a construir esta meta.</p>
            </div>
          </div>

          {tasks.length > 0 && (
            <div className="mb-3">
              <p className="text-[9px] text-faint uppercase tracking-widest mb-2">Tarefas</p>
              <div className="goal-related-list flex flex-col gap-1.5 max-h-40 overflow-y-auto scrollbar-none">
                {tasks
                  .filter((task) => task.status !== "concluida")
                  .slice(0, 20)
                  .map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className="goal-related-option rounded-xl p-2.5 flex items-center gap-2 text-left"
                      onClick={() => toggleLinkedTask(task.id)}
                    >
                      {linkedTaskIds.includes(task.id)
                        ? <CheckCircle2 size={14} className="text-moss shrink-0" />
                        : <Circle size={14} className="text-faint shrink-0" />}
                      <span className="text-xs break-words flex-1">{task.title}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {habits.length > 0 && (
            <div>
              <p className="text-[9px] text-faint uppercase tracking-widest mb-2">Hábitos</p>
              <div className="goal-related-list flex flex-col gap-1.5 max-h-40 overflow-y-auto scrollbar-none">
                {habits
                  .filter((habit) => habit.active !== false)
                  .slice(0, 20)
                  .map((habit) => (
                    <button
                      key={habit.id}
                      type="button"
                      className="goal-related-option rounded-xl p-2.5 flex items-center gap-2 text-left"
                      onClick={() => toggleLinkedHabit(habit.id)}
                    >
                      {linkedHabitIds.includes(habit.id)
                        ? <CheckCircle2 size={14} className="text-moss shrink-0" />
                        : <Circle size={14} className="text-faint shrink-0" />}
                      <span className="text-xs break-words flex-1">{habit.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        disabled={!name.trim() || (!isChecklist && Number(target) <= 0)}
        className="btn-primary w-full rounded-xl py-3 mt-2 disabled:opacity-40"
        onClick={() => {
          const checklistCurrent = cleanChecklist.filter((item) => item.done).length;
          const savedCurrent = cleanChecklist.length ? checklistCurrent : Math.max(0, Number(current) || 0);
          const savedTarget = cleanChecklist.length ? cleanChecklist.length : Math.max(0, Number(target) || 0);

          onSave({
            ...initial,
            id: initial?.id || uid(),
            name: name.trim(),
            type: cleanChecklist.length ? "checklist" : type,
            target: savedTarget,
            current: savedCurrent,
            checklist: cleanChecklist,
            milestones: cleanChecklist.length ? [] : milestones,
            imageDataUrl: imageDataUrl || null,
            startDate: initial?.startDate || today(),
            endDate: endDate || "",
            nextAction: nextAction.trim(),
            isPrimary,
            linkedTaskIds,
            linkedHabitIds,
            weeklyCheckins: initial?.weeklyCheckins || [],
            nextActionHistory: initial?.nextActionHistory || [],
            completed: initial?.completed || false,
            completedAt: initial?.completedAt,
            archived: initial?.archived || false,
          });
        }}
      >
        {initial ? "Salvar alterações" : "Criar meta"}
      </button>
      {confirmDialog}
    </Modal>
  );
}

function GoalAddValue({ goal, onAdjust }) {
  const [mode, setMode] = useState("add");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(null);
  const numericAmount = Math.max(0, Number(amount || 0));
  const current = Math.max(0, Number(goal.current || 0));
  const presets = goal.type === "financeira" ? [50, 100, 500] : [1, 5, 10];

  const valueLabel = (value) =>
    goal.type === "financeira"
      ? money(value)
      : Number(value || 0).toLocaleString("pt-BR");

  const requestAdjustment = (value, requestedMode = mode) => {
    const safe = Math.max(0, Number(value) || 0);
    if (safe <= 0) return;

    if (requestedMode === "remove" && current <= 0) return;

    const effectiveAmount =
      requestedMode === "remove"
        ? Math.min(current, safe)
        : safe;

    if (effectiveAmount <= 0) return;

    setPending({
      mode: requestedMode,
      amount: effectiveAmount,
      requestedAmount: safe,
    });
  };

  const confirmAdjustment = () => {
    if (!pending) return;

    const signedAmount =
      pending.mode === "remove"
        ? -pending.amount
        : pending.amount;

    onAdjust(signedAmount);
    setPending(null);
    setAmount("");
  };

  const previewTotal = pending
    ? pending.mode === "remove"
      ? Math.max(0, current - pending.amount)
      : current + pending.amount
    : current;

  return (
    <div className="goal-quick-progress">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <p className="text-[9px] text-faint uppercase tracking-widest">Ajustar progresso</p>

        <div className="goal-value-mode-switch grid grid-cols-2 gap-1 p-1 rounded-xl surface-2">
          <button
            type="button"
            className="goal-value-mode-button rounded-lg px-3 py-1.5 text-[10px]"
            onClick={() => setMode("add")}
            style={{
              background: mode === "add" ? "color-mix(in srgb, var(--moss) 12%, var(--surface))" : "transparent",
              border: `1px solid ${mode === "add" ? "color-mix(in srgb, var(--moss) 40%, var(--border))" : "transparent"}`,
              color: mode === "add" ? "var(--moss)" : "var(--text-dim)",
            }}
          >
            <Plus size={11} className="inline mr-1" /> Adicionar
          </button>

          <button
            type="button"
            disabled={current <= 0}
            className="goal-value-mode-button rounded-lg px-3 py-1.5 text-[10px] disabled:opacity-40"
            onClick={() => setMode("remove")}
            style={{
              background: mode === "remove" ? "color-mix(in srgb, var(--ember) 10%, var(--surface))" : "transparent",
              border: `1px solid ${mode === "remove" ? "color-mix(in srgb, var(--ember) 35%, var(--border))" : "transparent"}`,
              color: mode === "remove" ? "var(--ember)" : "var(--text-dim)",
            }}
          >
            <Minus size={11} className="inline mr-1" /> Remover
          </button>
        </div>
      </div>

      <div className="goal-progress-presets grid grid-cols-4 gap-1.5">
        {presets.map((value) => (
          <button
            key={`${mode}-${value}`}
            type="button"
            disabled={mode === "remove" && current <= 0}
            className="goal-progress-preset btn-ghost rounded-xl py-2 text-[10px] md:text-xs disabled:opacity-40"
            onClick={() => requestAdjustment(value)}
          >
            {mode === "remove" ? "−" : "+"}
            {goal.type === "financeira" ? money(value) : value}
          </button>
        ))}

        <button
          type="button"
          className="goal-progress-preset btn-ghost rounded-xl py-2 text-[10px] md:text-xs"
          onClick={() => document.getElementById(`goal-custom-${goal.id}`)?.focus()}
        >
          Outro
        </button>
      </div>

      <div className="flex gap-2 mt-2">
        <input
          id={`goal-custom-${goal.id}`}
          type="number"
          inputMode="decimal"
          min="0"
          step={goal.type === "financeira" ? "0.01" : "1"}
          className="goal-value-custom-input flex-1 min-w-0 p-2.5 ring-focus"
          placeholder={
            mode === "remove"
              ? goal.type === "financeira"
                ? "Valor a remover"
                : "Progresso a remover"
              : goal.type === "financeira"
                ? "Valor a adicionar"
                : "Progresso a adicionar"
          }
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") requestAdjustment(numericAmount);
          }}
        />

        <button
          type="button"
          disabled={numericAmount <= 0 || (mode === "remove" && current <= 0)}
          className={`rounded-xl px-3 py-2 text-xs disabled:opacity-40 shrink-0 ${mode === "remove" ? "btn-ghost text-ember" : "btn-primary"}`}
          onClick={() => requestAdjustment(numericAmount)}
        >
          {mode === "remove" ? "Remover" : "Adicionar"}
        </button>
      </div>

      {mode === "remove" && current > 0 && (
        <p className="text-[9px] text-faint mt-1.5">
          Disponível para remover: {valueLabel(current)}
        </p>
      )}
      {current <= 0 && (
        <p className="text-[9px] text-faint mt-1.5">
          Nada para remover ainda — adicione progresso primeiro.
        </p>
      )}

      {pending && (
        <Modal
          title={pending.mode === "remove" ? "Confirmar remoção" : "Confirmar adição"}
          onClose={() => setPending(null)}
          width={430}
        >
          <div className="goal-value-confirmation">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3"
              style={{
                background: pending.mode === "remove"
                  ? "color-mix(in srgb, var(--ember) 10%, var(--surface-2))"
                  : "color-mix(in srgb, var(--moss) 10%, var(--surface-2))",
                border: `1px solid ${pending.mode === "remove"
                  ? "color-mix(in srgb, var(--ember) 30%, var(--border))"
                  : "color-mix(in srgb, var(--moss) 30%, var(--border))"}`,
              }}
            >
              {pending.mode === "remove"
                ? <Minus size={18} className="text-ember" />
                : <Plus size={18} className="text-moss" />}
            </div>

            <p className="text-sm leading-relaxed">
              Você está prestes a{" "}
              <strong>{pending.mode === "remove" ? "remover" : "adicionar"} {valueLabel(pending.amount)}</strong>{" "}
              {pending.mode === "remove" ? "do progresso" : "ao progresso"} da meta{" "}
              <strong>{goal.name}</strong>.
            </p>

            {pending.mode === "remove" && pending.requestedAmount > current && (
              <div className="surface-2 rounded-xl p-3 mt-3 text-xs text-dim">
                O valor informado é maior que o progresso atual. A remoção será limitada a {valueLabel(current)}.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="surface-2 rounded-xl p-3">
                <p className="text-[9px] text-faint uppercase tracking-widest">Atual</p>
                <p className="font-display text-base mt-1">{valueLabel(current)}</p>
              </div>
              <div className="surface-2 rounded-xl p-3">
                <p className="text-[9px] text-faint uppercase tracking-widest">Após confirmar</p>
                <p className={`font-display text-base mt-1 ${pending.mode === "remove" ? "text-ember" : "text-moss"}`}>
                  {valueLabel(previewTotal)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                type="button"
                className="btn-ghost rounded-xl py-2.5 text-sm"
                onClick={() => setPending(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={`rounded-xl py-2.5 text-sm font-medium ${pending.mode === "remove" ? "btn-ghost text-ember" : "btn-primary"}`}
                onClick={confirmAdjustment}
              >
                {pending.mode === "remove" ? "Confirmar remoção" : "Confirmar adição"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function GoalIntelligencePanel({ goals, goalProgressLog, isPro, onUpgrade }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const active = (goals || []).filter((goal) => !goal.completed && !goal.archived);

  if (!isPro) {
    return (
      <ProLockCard
        feature="intelligence"
        title="Goal Intelligence"
        description="O PRO calcula ritmo, previsão de conclusão, metas atrasadas e quais objetivos estão mais próximos de serem alcançados."
        onUpgrade={onUpgrade}
      />
    );
  }

  const closest = [...active].sort((a, b) => goalProgressPercent(b) - goalProgressPercent(a))[0] || null;
  const slowest = [...active].sort(
    (a, b) => goalPaceScore(a, goalProgressLog) - goalPaceScore(b, goalProgressLog)
  )[0] || null;
  const longestWithoutProgress = [...active].sort(
    (a, b) => goalDaysSinceActivity(b, goalProgressLog) - goalDaysSinceActivity(a, goalProgressLog)
  )[0] || null;
  const completedSixMonths = (goals || []).filter((goal) =>
    goal.completed &&
    String(goal.completedAt || "").slice(0, 10) >= addDays(today(), -183)
  ).length;

  const primary = active.find((goal) => goal.isPrimary) || closest;
  const primaryForecast = primary ? goalForecast(primary, goalProgressLog) : null;
  const autoInsights = [];

  if (closest) {
    autoInsights.push(`${closest.name} está mais perto da conclusão: ${goalProgressPercent(closest)}%.`);
  }
  if (longestWithoutProgress && goalDaysSinceActivity(longestWithoutProgress, goalProgressLog) >= 7) {
    autoInsights.push(`${longestWithoutProgress.name} está há ${goalDaysSinceActivity(longestWithoutProgress, goalProgressLog)} dias sem novo progresso.`);
  }
  if (primary && primaryForecast?.predictedDate) {
    const difference = primaryForecast.daysDifference;
    autoInsights.push(
      difference == null
        ? `${primary.name} tende a ser concluída em ${dateLabel(primaryForecast.predictedDate, { day: "2-digit", month: "short" })}.`
        : difference <= 0
          ? `${primary.name} está projetada para terminar ${Math.abs(difference)} dia${Math.abs(difference) === 1 ? "" : "s"} antes ou dentro do prazo.`
          : `${primary.name} está projetada ${difference} dia${difference === 1 ? "" : "s"} após o prazo atual.`
    );
  }
  if (!autoInsights.length) {
    autoInsights.push("Continue registrando progresso para gerar leituras mais precisas.");
  }

  const ask = (rawQuestion) => {
    const raw = String(rawQuestion || "").trim();
    if (!raw) return;

    const normalized = normalizeGoalQuestion(raw);
    const namedGoal = goalQuestionTarget(raw, goals);
    const targetGoal = namedGoal || primary;
    let nextAnswer = "Não consigo te ajudar com essa pergunta no momento.";

    if (/(mais atrasada|mais atrasado|precisa.*atencao|pior ritmo)/.test(normalized)) {
      if (!slowest) {
        nextAnswer = "Você não tem metas ativas no momento.";
      } else {
        const pace = goalPaceInfo(slowest, goalProgressLog);
        nextAnswer = `${slowest.name} merece mais atenção agora. O ritmo está classificado como ${pace.label.toLowerCase()} e o score de ritmo é ${goalPaceScore(slowest, goalProgressLog)}/100.`;
      }
    } else if (/(mais perto|mais proxima|proximo.*concluir|quase conclu)/.test(normalized)) {
      nextAnswer = closest
        ? `${closest.name} é a meta mais próxima de ser concluída, com ${goalProgressPercent(closest)}% de progresso.`
        : "Você não tem metas ativas no momento.";
    } else if (/(quanto.*guardar|por mes|mensal)/.test(normalized)) {
      if (!targetGoal) {
        nextAnswer = "Escolha uma meta ativa para calcular o ritmo necessário.";
      } else if (targetGoal.type !== "financeira") {
        const required = goalRequiredPace(targetGoal);
        nextAnswer = targetGoal.endDate
          ? `Para ${targetGoal.name}, o ritmo necessário é aproximadamente ${required.value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por ${required.unit}.`
          : `${targetGoal.name} não possui prazo definido, então não há um ritmo obrigatório por período.`;
      } else {
        const required = goalRequiredPace(targetGoal);
        nextAnswer = targetGoal.endDate
          ? `Para ${targetGoal.name}, você precisa avançar aproximadamente ${money(required.value)} por mês até o prazo.`
          : `${targetGoal.name} não possui prazo definido, então não há um valor mensal obrigatório.`;
      }
    } else if (/(quando.*termin|quando.*conclu|previsao)/.test(normalized)) {
      if (!targetGoal) {
        nextAnswer = "Escolha uma meta ativa para calcular uma previsão.";
      } else {
        const forecast = goalForecast(targetGoal, goalProgressLog);
        nextAnswer = forecast.predictedDate
          ? `Mantendo o ritmo atual, ${targetGoal.name} tem previsão de conclusão em ${dateLabel(forecast.predictedDate, { day: "2-digit", month: "long", year: "numeric" })}.`
          : `Ainda não há progresso suficiente em ${targetGoal.name} para gerar uma previsão confiável.`;
      }
    } else if (/(mais tempo.*sem|sem avancar|parada)/.test(normalized)) {
      nextAnswer = longestWithoutProgress
        ? `${longestWithoutProgress.name} está há ${goalDaysSinceActivity(longestWithoutProgress, goalProgressLog)} dia${goalDaysSinceActivity(longestWithoutProgress, goalProgressLog) === 1 ? "" : "s"} sem um novo registro de progresso.`
        : "Você não tem metas ativas no momento.";
    } else if (/(quantas?.*conclui|concluidas?).*(6 meses|seis meses|semestre)/.test(normalized)) {
      nextAnswer = `Você concluiu ${completedSixMonths} meta${completedSixMonths === 1 ? "" : "s"} nos últimos 6 meses.`;
    }

    setQuestion(raw);
    setAnswer(nextAnswer);
  };

  return (
    <div className="goal-intelligence surface rounded-2xl p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BrainCircuit size={16} className="text-brass" />
            <p className="text-[10px] text-faint uppercase tracking-widest">Goal Intelligence · PRO</p>
          </div>
          <p className="font-display text-lg md:text-xl mt-1">Transforme progresso em previsão</p>
          <p className="text-[10px] md:text-xs text-dim mt-1">
            Cálculos determinísticos usando seus prazos, avanços e histórico real.
          </p>
        </div>
        <span className="chip shrink-0">{active.length} ativa{active.length === 1 ? "" : "s"}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
        <div className="goal-intelligence-card surface-2 rounded-xl p-3">
          <p className="text-[9px] text-faint uppercase tracking-widest">Mais próxima</p>
          <p className="text-sm font-medium mt-1 break-words">{closest?.name || "Sem meta ativa"}</p>
          <p className="font-mono text-xs text-brass mt-1">{closest ? `${goalProgressPercent(closest)}%` : "—"}</p>
        </div>
        <div className="goal-intelligence-card surface-2 rounded-xl p-3">
          <p className="text-[9px] text-faint uppercase tracking-widest">Maior atenção</p>
          <p className="text-sm font-medium mt-1 break-words">{slowest?.name || "Sem meta ativa"}</p>
          <p className="font-mono text-xs text-brass mt-1">{slowest ? `${goalPaceScore(slowest, goalProgressLog)}/100` : "—"}</p>
        </div>
        <div className="goal-intelligence-card surface-2 rounded-xl p-3">
          <p className="text-[9px] text-faint uppercase tracking-widest">6 meses</p>
          <p className="font-display text-xl mt-1">{completedSixMonths}</p>
          <p className="text-[9px] text-faint mt-1">metas concluídas</p>
        </div>
      </div>

      <div className="goal-intelligence-insights grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
        {autoInsights.slice(0, 3).map((insight, index) => (
          <div key={index} className="surface-2 rounded-xl p-3">
            <span className="font-mono text-[9px] text-brass">0{index + 1}</span>
            <p className="text-[10px] md:text-xs mt-1 leading-relaxed">{insight}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-4">
        {[
          "Qual meta está mais atrasada?",
          "Qual meta estou mais perto de concluir?",
          "Quanto preciso guardar por mês?",
          "Se continuar nesse ritmo, quando termino?",
          "Em qual meta estou há mais tempo sem avançar?",
        ].map((prompt) => (
          <button key={prompt} className="chip hover:text-brass" onClick={() => ask(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <input
          className="flex-1 min-w-0 p-3 ring-focus"
          placeholder="Pergunte sobre suas metas..."
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask(question);
          }}
        />
        <button className="btn-primary rounded-xl px-4 py-2.5 text-sm shrink-0" onClick={() => ask(question)}>
          Perguntar
        </button>
      </div>

      {answer && (
        <div className="goal-intelligence-answer surface-2 rounded-xl p-3 mt-3">
          <p className="text-[9px] text-faint uppercase tracking-widest">Constancce</p>
          <p className="text-sm mt-1 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

function GoalsView({
  goals,
  saveGoal,
  addProgress,
  updateProgress,
  toggleGoalChecklist,
  deleteGoal,
  goalProgressLog = [],
  tasks = [],
  habits = [],
  autoOpen,
  isPro,
  onUpgrade,
}) {
  const [section, setSection] = useState("overview");
  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [expandedGoalId, setExpandedGoalId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (autoOpen) {
      setEditingGoal(null);
      setShowForm(true);
    }
  }, [autoOpen]);

  const active = goals.filter((goal) => !goal.completed && !goal.archived);
  const done = goals.filter((goal) => goal.completed && !goal.archived);
  const archived = goals.filter((goal) => goal.archived);

  const primaryGoal =
    active.find((goal) => goal.isPrimary) ||
    [...active].sort((a, b) => goalProgressPercent(b) - goalProgressPercent(a))[0] ||
    null;

  const closestGoal = [...active].sort((a, b) => goalProgressPercent(b) - goalProgressPercent(a))[0] || null;
  const onTrackCount = active.filter((goal) => goalPaceInfo(goal, goalProgressLog).label === "No ritmo").length;
  const attentionCount = active.filter((goal) => ["Atenção", "Parada"].includes(goalPaceInfo(goal, goalProgressLog).label)).length;

  const openCreate = () => {
    if (!isPro && active.length >= PRO_LIMITS.activeGoals) {
      onUpgrade("goals");
      return;
    }
    setEditingGoal(null);
    setShowForm(true);
  };

  const openEdit = (goal) => {
    setEditingGoal(goal);
    setShowForm(true);
  };

  const completeNextAction = (goal) => {
    if (!goal.nextAction) return;
    saveGoal({
      ...goal,
      nextActionHistory: [
        ...(goal.nextActionHistory || []),
        {
          id: uid(),
          text: goal.nextAction,
          completedAt: new Date().toISOString(),
        },
      ],
      nextAction: "",
      nextActionCompletedAt: new Date().toISOString(),
    });
  };

  const saveWeeklyCheckin = (goal, value) => {
    const week = startOfWeek(today());
    const row = {
      id: uid(),
      week,
      date: today(),
      value,
      createdAt: new Date().toISOString(),
    };

    saveGoal({
      ...goal,
      weeklyCheckins: [
        ...(goal.weeklyCheckins || []).filter((item) => item.week !== week),
        row,
      ],
    });
  };

  const renderMilestones = (goal) => {
    const pct = goalProgressPercent(goal);
    const milestones = goalMilestonePercents(goal);
    if (!milestones.length) return null;

    return (
      <div className="goal-milestone-rail mt-4">
        {milestones.map((milestone, index) => {
          const reached = pct >= milestone;
          const isNext = !reached && milestones.filter((value) => value > pct)[0] === milestone;

          return (
            <div key={milestone} className="goal-milestone-step">
              <div className={`goal-milestone-dot ${reached ? "reached" : isNext ? "next" : ""}`}>
                {reached ? <Check size={10} /> : <span />}
              </div>
              <p className={`text-[8px] md:text-[9px] mt-1 ${reached ? "text-moss" : isNext ? "text-brass" : "text-faint"}`}>
                {milestone}%
              </p>
              {index < milestones.length - 1 && (
                <span className={`goal-milestone-line ${reached ? "reached" : ""}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderGoalCard = (goal, { hero = false } = {}) => {
    const target = Math.max(0, Number(goal.target || 0));
    const current = Math.max(0, Number(goal.current || 0));
    const pct = goalProgressPercent(goal);
    const remaining = Math.max(0, target - current);
    const pace = goalPaceInfo(goal, goalProgressLog);
    const nextMilestone = goalNextMilestone(goal);
    const expanded = expandedGoalId === goal.id;
    const fullHistory = goalDailyHistory(goal, goalProgressLog);
    const fullEntries = goalProgressEntries(goalProgressLog, goal.id);
    const historyCutoff = addDays(today(), -29);
    const visibleHistory = isPro
      ? fullHistory
      : fullHistory.filter((row) => row.date >= historyCutoff);
    const visibleEntries = isPro
      ? fullEntries
      : fullEntries.filter((row) => String(row.date || "").slice(0, 10) >= historyCutoff);
    const chartRows = visibleHistory.slice(-8).map((row) => ({
      label: dateLabel(row.date, { day: "2-digit", month: "2-digit" }),
      value: Number(row.value || 0),
    }));
    const forecast = goalForecast(goal, goalProgressLog);
    const required = goalRequiredPace(goal);
    const linkedTasks = tasks.filter((task) => (goal.linkedTaskIds || []).includes(task.id));
    const linkedHabits = habits.filter((habit) => (goal.linkedHabitIds || []).includes(habit.id));
    const week = startOfWeek(today());
    const thisWeekCheckin = (goal.weeklyCheckins || []).find((item) => item.week === week);
    const paceScore = goalPaceScore(goal, goalProgressLog);
    const daysLeft = goal.endDate ? daysUntil(goal.endDate) : null;

    return (
      <article
        key={goal.id}
        className={`goal-modern-card surface rounded-2xl overflow-hidden ${hero ? "goal-primary-card" : ""}`}
      >
        {goal.imageDataUrl && (
          <div className={`goal-card-image-wrap ${hero ? "hero" : ""}`}>
            <img src={goal.imageDataUrl} alt="" className="goal-card-image w-full object-cover" />
            <div className="goal-card-image-overlay" />
          </div>
        )}

        <div className={`goal-card-body p-4 md:p-5 ${goal.imageDataUrl ? "with-image" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {(goal.isPrimary || hero) && (
                  <span className="goal-highlight-chip chip text-brass">
                    <Star size={10} className="shrink-0" />
                    <span>{goal.isPrimary ? "Meta principal" : "Destaque"}</span>
                  </span>
                )}
                <span className={`goal-status-chip chip goal-status-${pace.tone}`}>{pace.label}</span>
                {!goal.endDate && <span className="chip">Sem prazo</span>}
              </div>

              <h3 className={`goal-card-title font-display mt-2 break-words ${hero ? "text-xl md:text-2xl" : "text-lg md:text-xl"}`}>
                {goal.name}
              </h3>

              {goal.endDate && (
                <p className="text-[9px] md:text-[10px] text-faint mt-1">
                  {daysLeft !== null && daysLeft >= 0
                    ? `${daysLeft} dia${daysLeft === 1 ? "" : "s"} restantes`
                    : "Prazo encerrado"} · {dateLabel(goal.endDate, { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              )}
            </div>

            <div className="goal-card-actions flex items-center gap-1 shrink-0">
              {!goal.isPrimary && !goal.completed && (
                <button
                  className="btn-ghost rounded-lg p-2"
                  onClick={() => saveGoal({ ...goal, isPrimary: true })}
                  title="Definir como meta principal"
                  aria-label={`Definir ${goal.name} como meta principal`}
                >
                  <Star size={14} />
                </button>
              )}
              <button className="btn-ghost rounded-lg p-2" onClick={() => openEdit(goal)} title="Editar meta">
                <Pencil size={14} />
              </button>
              <button className="btn-ghost rounded-lg p-2" onClick={() => deleteGoal(goal.id)} title="Excluir meta">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="goal-progress-hero mt-4">
            <div className="flex items-end justify-between gap-3 mb-2">
              <div className="min-w-0">
                <p className={`font-display ${hero ? "text-2xl md:text-3xl" : "text-xl md:text-2xl"}`}>
                  {goalValueLabel(goal, current)}
                </p>
                <p className="text-[9px] md:text-[10px] text-faint mt-0.5">
                  de {goalValueLabel(goal, target)}
                </p>
              </div>
              <span className={`goal-percent font-display ${hero ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl"} text-brass`}>
                {pct}%
              </span>
            </div>
            <Progress value={pct} height={hero ? 8 : 6} />
          </div>

          {renderMilestones(goal)}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4">
            <div className="surface-2 rounded-xl p-3 min-w-0">
              <p className="text-[9px] text-faint uppercase tracking-widest">Falta</p>
              <p className="font-display text-sm md:text-base mt-1 break-words">{goalValueLabel(goal, remaining)}</p>
            </div>
            <div className="surface-2 rounded-xl p-3 min-w-0">
              <p className="text-[9px] text-faint uppercase tracking-widest">Próximo marco</p>
              <p className="font-display text-sm md:text-base mt-1 break-words">
                {nextMilestone ? goalValueLabel(goal, nextMilestone.value) : "Último marco"}
              </p>
            </div>
            <div className="surface-2 rounded-xl p-3 min-w-0 col-span-2 md:col-span-1">
              <p className="text-[9px] text-faint uppercase tracking-widest">Relacionados</p>
              <p className="font-display text-sm md:text-base mt-1">
                {linkedTasks.length} tarefa{linkedTasks.length === 1 ? "" : "s"} · {linkedHabits.length} hábito{linkedHabits.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="goal-next-action surface-2 rounded-xl p-3 mt-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] text-faint uppercase tracking-widest">Próxima ação</p>
                <p className={`text-sm mt-1 break-words ${goal.nextAction ? "" : "text-dim"}`}>
                  {goal.nextAction || "Defina uma ação concreta para continuar avançando."}
                </p>
              </div>

              {goal.nextAction ? (
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs shrink-0" onClick={() => completeNextAction(goal)}>
                  <Check size={13} className="inline mr-1" /> Concluir ação
                </button>
              ) : (
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs shrink-0" onClick={() => openEdit(goal)}>
                  Definir próxima
                </button>
              )}
            </div>
          </div>

          {goal.checklist?.length > 0 ? (
            <div className="goal-checklist mt-4 flex flex-col gap-2">
              {goal.checklist.map((item) => (
                <button
                  key={item.id}
                  className="goal-checklist-row flex items-center gap-2 text-left text-sm text-dim rounded-xl px-2 py-1.5"
                  onClick={() => toggleGoalChecklist(goal.id, item.id)}
                >
                  {item.done
                    ? <CheckCircle2 size={17} className="text-moss shrink-0" />
                    : <Circle size={17} className="text-faint shrink-0" />}
                  <span className="break-words" style={{ textDecoration: item.done ? "line-through" : "none" }}>
                    {item.text}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <GoalAddValue goal={goal} onAdjust={(amount) => addProgress(goal.id, amount)} />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
            <button
              className="goal-details-button btn-ghost rounded-xl px-3 py-2 text-xs flex items-center gap-1.5"
              onClick={() => setExpandedGoalId(expanded ? null : goal.id)}
            >
              <History size={13} />
              {expanded ? "Ocultar detalhes" : "Evolução e detalhes"}
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {pct >= 100 && !goal.completed && (
              <button
                className="btn-primary rounded-xl px-4 py-2 text-xs"
                onClick={() => updateProgress(goal.id, current, true)}
              >
                <Trophy size={13} className="inline mr-1" /> Concluir meta
              </button>
            )}
          </div>

          {expanded && (
            <div className="goal-details fade-in mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="surface-2 rounded-2xl p-3 md:p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <p className="text-[9px] text-faint uppercase tracking-widest">Evolução</p>
                      <p className="text-[10px] text-dim mt-1">
                        {isPro ? "Histórico completo" : "Últimos 30 dias"}
                      </p>
                    </div>
                    <TrendingUp size={15} className="text-brass" />
                  </div>

                  {chartRows.length >= 2 ? (
                    <MiniLineChart data={chartRows} height={120} />
                  ) : (
                    <div className="goal-history-empty rounded-xl border border-dashed p-4 text-center text-xs text-dim">
                      Adicione progresso em dias diferentes para formar o gráfico.
                    </div>
                  )}

                  <div className="goal-history-list flex flex-col gap-1.5 mt-3 max-h-48 overflow-y-auto scrollbar-none">
                    {visibleEntries.length === 0 && <p className="text-xs text-faint">Nenhum avanço registrado ainda.</p>}
                    {[...visibleEntries].reverse().slice(0, 12).map((row) => {
                      const rowDate = String(row.date || row.createdAt || "").slice(0, 10);
                      const added = Number(row.added || 0);
                      return (
                        <div key={row.id || `${rowDate}-${row.createdAt}-${row.value}`} className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-faint">{dateLabel(rowDate, { day: "2-digit", month: "short" })}</span>
                          <span className="font-mono">
                            {added !== 0
                              ? `${added > 0 ? "+" : "−"}${goalValueLabel(goal, Math.abs(added))}`
                              : goalValueLabel(goal, row.value)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {!isPro && fullEntries.some((row) => String(row.date || "").slice(0, 10) < historyCutoff) && (
                    <button className="text-[10px] text-brass mt-3" onClick={() => onUpgrade("goals")}>
                      Liberar histórico completo no PRO
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  {isPro ? (
                    <>
                      <div className="goal-pace-card surface-2 rounded-2xl p-3 md:p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[9px] text-faint uppercase tracking-widest">Ritmo da meta</p>
                            <div className="flex items-end gap-2 mt-1">
                              <p className="font-display text-2xl">{paceScore}/100</p>
                              <span className={`chip goal-status-${pace.tone} mb-0.5`}>{goalPaceScoreLabel(paceScore)}</span>
                            </div>
                          </div>
                          <Gauge size={17} className="text-brass" />
                        </div>
                        <Progress value={paceScore} height={5} />
                        <p className="text-[10px] text-dim mt-2">
                          {pace.deltaPct != null
                            ? pace.deltaPct >= 0
                              ? `Você está ${Math.abs(pace.deltaPct)}% à frente do ritmo proporcional ao prazo.`
                              : `Você está ${Math.abs(pace.deltaPct)}% abaixo do ritmo proporcional ao prazo.`
                            : `${goalDaysSinceActivity(goal, goalProgressLog)} dia${goalDaysSinceActivity(goal, goalProgressLog) === 1 ? "" : "s"} desde a última atividade registrada.`}
                        </p>
                      </div>

                      <div className="goal-forecast-card surface-2 rounded-2xl p-3 md:p-4">
                        <p className="text-[9px] text-faint uppercase tracking-widest">Previsão de conclusão</p>
                        <p className="font-display text-lg md:text-xl mt-1">
                          {forecast.predictedDate
                            ? dateLabel(forecast.predictedDate, { day: "2-digit", month: "long", year: "numeric" })
                            : "Sem base suficiente"}
                        </p>
                        {forecast.predictedDate && goal.endDate && forecast.daysDifference != null && (
                          <p className={`text-[10px] mt-1 ${forecast.daysDifference <= 0 ? "text-moss" : "text-ember"}`}>
                            {forecast.daysDifference === 0
                              ? "No prazo planejado"
                              : forecast.daysDifference < 0
                                ? `${Math.abs(forecast.daysDifference)} dias antes do prazo`
                                : `${forecast.daysDifference} dias depois do prazo`}
                          </p>
                        )}

                        {goal.endDate && (
                          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                            <p className="text-[9px] text-faint uppercase tracking-widest">Ritmo necessário</p>
                            <p className="font-display text-base text-brass mt-1">
                              {goal.type === "financeira"
                                ? money(required.value)
                                : required.value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/{required.unit}
                            </p>
                            {goal.type === "financeira" && <p className="text-[9px] text-faint mt-0.5">por mês até o prazo</p>}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <ProLockCard
                      feature="goals"
                      title="Ritmo e previsão"
                      description="O PRO calcula score de ritmo, quanto você precisa avançar e a previsão de conclusão da meta."
                      onUpgrade={onUpgrade}
                      compact
                    />
                  )}
                </div>
              </div>

              {(linkedTasks.length > 0 || linkedHabits.length > 0) && (
                <div className="goal-related-view surface-2 rounded-2xl p-3 md:p-4 mt-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers3 size={14} className="text-brass" />
                    <p className="text-[9px] text-faint uppercase tracking-widest">Relacionados</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {linkedTasks.length > 0 && (
                      <div>
                        <p className="text-[9px] text-faint mb-2">Tarefas</p>
                        <div className="flex flex-col gap-1.5">
                          {linkedTasks.slice(0, 6).map((task) => (
                            <div key={task.id} className="goal-related-row rounded-xl p-2.5 flex items-center gap-2">
                              {task.status === "concluida"
                                ? <CheckCircle2 size={13} className="text-moss shrink-0" />
                                : <Circle size={13} className="text-faint shrink-0" />}
                              <span className="text-[10px] break-words">{task.title}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {linkedHabits.length > 0 && (
                      <div>
                        <p className="text-[9px] text-faint mb-2">Hábitos</p>
                        <div className="flex flex-col gap-1.5">
                          {linkedHabits.slice(0, 6).map((habit) => (
                            <div key={habit.id} className="goal-related-row rounded-xl p-2.5 flex items-center gap-2">
                              <ListChecks size={13} className="text-brass shrink-0" />
                              <span className="text-[10px] break-words">{habit.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="goal-weekly-checkin surface-2 rounded-2xl p-3 md:p-4 mt-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[9px] text-faint uppercase tracking-widest">Check-in semanal</p>
                    <p className="text-[10px] text-dim mt-1">Como foi sua semana nessa meta?</p>
                  </div>
                  {thisWeekCheckin && <span className="chip text-moss">Registrado</span>}
                </div>

                <div className="grid grid-cols-3 gap-1.5 mt-3">
                  {[
                    ["forte", "Avancei bastante"],
                    ["pouco", "Avancei pouco"],
                    ["nenhum", "Não avancei"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className="goal-checkin-button rounded-xl py-2 px-1 text-[9px] md:text-[10px]"
                      onClick={() => saveWeeklyCheckin(goal, value)}
                      style={{
                        border: `1px solid ${thisWeekCheckin?.value === value ? "var(--brass)" : "var(--border)"}`,
                        color: thisWeekCheckin?.value === value ? "var(--brass)" : "var(--text-dim)",
                        background: thisWeekCheckin?.value === value ? "color-mix(in srgb, var(--brass) 6%, transparent)" : "transparent",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="goals-modern-view flex flex-col gap-4 md:gap-5">
      <div className="goal-main-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl md:text-3xl">Metas</h2>
            {!isPro && <span className="chip">{active.length}/{PRO_LIMITS.activeGoals} ativas Free</span>}
          </div>
          <p className="text-dim text-xs md:text-sm mt-1">
            Veja onde você está, o que falta e qual é a próxima ação.
          </p>
        </div>

        <button className="goal-new-button btn-primary rounded-xl px-4 py-2.5 text-sm flex items-center justify-center gap-1.5" onClick={openCreate}>
          <Plus size={15} /> Nova meta
        </button>
      </div>

      <FirstVisitTip id="goals" icon={Target} title="Metas dão direção ao que você faz todos os dias.">
        Defina onde quer chegar, registre o avanço e deixe uma próxima ação clara. O Constancce usa esses registros para mostrar seu ritmo.
      </FirstVisitTip>

      <div className="goal-section-tabs surface rounded-2xl p-1 grid grid-cols-3 gap-1">
        {[
          ["overview", "Visão geral"],
          ["active", "Em andamento"],
          ["completed", "Concluídas"],
        ].map(([id, label]) => (
          <button
            key={id}
            className="goal-tab-button rounded-xl py-2 text-[10px] sm:text-xs md:text-sm font-medium min-w-0"
            onClick={() => setSection(id)}
            style={{
              background: section === id ? "var(--surface-2)" : "transparent",
              border: `1px solid ${section === id ? "var(--brass-dim)" : "transparent"}`,
              color: section === id ? "var(--text)" : "var(--text-dim)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {goals.length === 0 && (
        <EmptyState
          icon={Target}
          title="Nenhuma meta ainda."
          hint="Defina um objetivo, escolha uma próxima ação e acompanhe sua evolução. Se quiser, comece com um modelo simples."
          action={(
            <div className="flex flex-col items-center gap-2 mt-2">
              <button className="btn-primary rounded-xl px-4 py-2 text-sm" onClick={openCreate}>Criar primeira meta</button>
              <div className="flex flex-wrap justify-center gap-1.5">
                <button className="chip" onClick={() => saveGoal({ id: uid(), name: "Reserva de emergência", type: "financeira", target: 5000, current: 0, checklist: [], milestones: [25,50,75,100], startDate: today(), endDate: addDays(today(), 365), nextAction: "Definir meu primeiro aporte", completed: false, archived: false })}>+ Reserva de emergência</button>
                <button className="chip" onClick={() => saveGoal({ id: uid(), name: "Ler 12 livros", type: "numerica", target: 12, current: 0, checklist: [], milestones: [25,50,75,100], startDate: today(), endDate: addDays(today(), 365), nextAction: "Escolher o primeiro livro", completed: false, archived: false })}>+ Ler 12 livros</button>
              </div>
            </div>
          )}
        />
      )}

      {section === "overview" && goals.length > 0 && (
        <>
          <div className="goal-overview-command surface rounded-2xl p-4 md:p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="surface-2 rounded-xl p-3 min-w-0">
                <p className="text-[9px] text-faint uppercase tracking-widest">Ativas</p>
                <p className="font-display text-xl mt-1">{active.length}</p>
              </div>
              <div className="surface-2 rounded-xl p-3 min-w-0">
                <p className="text-[9px] text-faint uppercase tracking-widest">Mais próxima</p>
                <p className="font-display text-xl mt-1">{closestGoal ? `${goalProgressPercent(closestGoal)}%` : "—"}</p>
              </div>
              <div className="surface-2 rounded-xl p-3 min-w-0">
                <p className="text-[9px] text-faint uppercase tracking-widest">No ritmo</p>
                <p className="font-display text-xl text-moss mt-1">{onTrackCount}</p>
              </div>
              <div className="surface-2 rounded-xl p-3 min-w-0">
                <p className="text-[9px] text-faint uppercase tracking-widest">Atenção</p>
                <p className={`font-display text-xl mt-1 ${attentionCount ? "text-ember" : ""}`}>{attentionCount}</p>
              </div>
            </div>
          </div>

          {primaryGoal ? (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-faint uppercase tracking-widest">Meta principal</p>
                {!primaryGoal.isPrimary && (
                  <button className="text-[10px] text-brass" onClick={() => saveGoal({ ...primaryGoal, isPrimary: true })}>
                    Fixar como principal
                  </button>
                )}
              </div>
              {renderGoalCard(primaryGoal, { hero: true })}
            </div>
          ) : (
            <div className="surface rounded-2xl p-5 text-center">
              <Target size={22} className="text-faint mx-auto" />
              <p className="font-display text-lg mt-2">Nenhuma meta ativa</p>
              <p className="text-dim text-xs mt-1">Crie uma nova meta para começar um novo ciclo.</p>
            </div>
          )}

          {active.filter((goal) => goal.id !== primaryGoal?.id).length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-faint uppercase tracking-widest">Outras metas</p>
                <button className="text-[10px] text-brass" onClick={() => setSection("active")}>Ver todas</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {active
                  .filter((goal) => goal.id !== primaryGoal?.id)
                  .slice(0, 4)
                  .map((goal) => {
                    const pace = goalPaceInfo(goal, goalProgressLog);
                    return (
                      <button
                        key={goal.id}
                        className="goal-overview-mini surface rounded-2xl p-3 md:p-4 text-left min-w-0"
                        onClick={() => {
                          setSection("active");
                          setExpandedGoalId(goal.id);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium break-words">{goal.name}</p>
                          <span className={`chip goal-status-${pace.tone} shrink-0`}>{pace.label}</span>
                        </div>
                        <div className="flex items-end justify-between gap-3 mt-3 mb-1.5">
                          <span className="text-[9px] text-faint">{goalValueLabel(goal, goal.current)} de {goalValueLabel(goal, goal.target)}</span>
                          <span className="font-mono text-xs text-brass">{goalProgressPercent(goal)}%</span>
                        </div>
                        <Progress value={goalProgressPercent(goal)} height={5} />
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <GoalIntelligencePanel
            goals={goals}
            goalProgressLog={goalProgressLog}
            isPro={isPro}
            onUpgrade={onUpgrade}
          />
        </>
      )}

      {section === "active" && (
        <div className="flex flex-col gap-3">
          {active.length === 0 && (
            <div className="surface rounded-2xl p-5 text-center text-dim text-sm">
              Nenhuma meta em andamento.
            </div>
          )}
          {active.map((goal) => renderGoalCard(goal))}
        </div>
      )}

      {section === "completed" && (
        <>
          <div className="goal-completed-summary surface rounded-2xl p-4 md:p-5">
            <div className="grid grid-cols-2 gap-2">
              <div className="surface-2 rounded-xl p-3">
                <p className="text-[9px] text-faint uppercase tracking-widest">Concluídas</p>
                <p className="font-display text-2xl text-moss mt-1">{done.length}</p>
              </div>
              <div className="surface-2 rounded-xl p-3">
                <p className="text-[9px] text-faint uppercase tracking-widest">Arquivadas</p>
                <p className="font-display text-2xl mt-1">{archived.length}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {done.length === 0 && (
              <div className="surface rounded-2xl p-5 text-center">
                <Trophy size={22} className="text-faint mx-auto" />
                <p className="font-display text-lg mt-2">Suas conquistas aparecerão aqui</p>
              </div>
            )}

            {done.map((goal) => {
              const completedDate = String(goal.completedAt || "").slice(0, 10);
              const earlyDays = goal.endDate && completedDate
                ? Math.round(
                    (new Date(`${goal.endDate}T12:00:00`) - new Date(`${completedDate}T12:00:00`)) / 86400000
                  )
                : null;

              return (
                <div key={goal.id} className="goal-completed-card surface rounded-2xl p-3 md:p-4 flex items-center gap-3">
                  {goal.imageDataUrl ? (
                    <img src={goal.imageDataUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 surface-2">
                      <Trophy size={18} className="text-brass" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium break-words">{goal.name}</p>
                      <span className="chip text-moss">Concluída</span>
                    </div>
                    <p className="text-[9px] text-faint mt-1">
                      {completedDate ? `Concluída em ${dateLabel(completedDate, { day: "2-digit", month: "2-digit", year: "numeric" })}` : "Meta concluída"}
                      {earlyDays != null && earlyDays > 0 ? ` · ${earlyDays} dias antes do prazo` : ""}
                      {earlyDays != null && earlyDays < 0 ? ` · ${Math.abs(earlyDays)} dias após o prazo` : ""}
                    </p>
                  </div>

                  <button
                    className="btn-ghost rounded-lg p-2 shrink-0"
                    title="Arquivar meta"
                    onClick={() => {
                      if (!isPro) {
                        onUpgrade("goals");
                        return;
                      }
                      saveGoal({ ...goal, archived: true, archivedAt: today(), isPrimary: false });
                    }}
                  >
                    {!isPro ? <Lock size={13} /> : <Archive size={14} />}
                  </button>
                </div>
              );
            })}
          </div>

          {archived.length > 0 && (
            <div>
              <button
                className="w-full flex items-center justify-between gap-3 text-left mt-2"
                onClick={() => setShowArchived((value) => !value)}
              >
                <span className="text-xs text-faint uppercase tracking-widest">Arquivadas</span>
                <span className="chip">{archived.length} {showArchived ? "ocultar" : "ver"}</span>
              </button>

              {showArchived && (
                <div className="flex flex-col gap-2 mt-2">
                  {archived.map((goal) => (
                    <div key={goal.id} className="surface-2 rounded-xl p-3 flex items-center gap-3 text-sm text-dim">
                      {goal.imageDataUrl
                        ? <img src={goal.imageDataUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                        : <Archive size={15} className="text-faint shrink-0" />}
                      <span className="flex-1 min-w-0 break-words">{goal.name}</span>
                      <button
                        className="btn-ghost rounded-lg p-2"
                        title="Restaurar meta"
                        onClick={() => saveGoal({ ...goal, archived: false, archivedAt: null })}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showForm && (
        <GoalForm
          initial={editingGoal}
          tasks={tasks}
          habits={habits}
          isPro={isPro}
          onUpgrade={onUpgrade}
          onClose={() => {
            setShowForm(false);
            setEditingGoal(null);
          }}
          onSave={(goal) => {
            const saved = saveGoal(goal);
            if (saved === false) return;
            setShowForm(false);
            setEditingGoal(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   WORKOUTS
----------------------------------------------------------------*/
const WORKOUT_MUSCLE_GROUPS = ["Peito", "Costas", "Pernas", "Ombros", "Braços", "Core", "Cardio", "Outro"];

const inferWorkoutMuscleGroup = (name = "") => {
  const value = String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/(supino|peito|crucifixo|voador|crossover)/.test(value)) return "Peito";
  if (/(remada|puxada|costas|pulldown|barra fixa)/.test(value)) return "Costas";
  if (/(agach|leg press|extensora|flexora|panturr|stiff|terra|glute)/.test(value)) return "Pernas";
  if (/(ombro|elevacao lateral|desenvolvimento)/.test(value)) return "Ombros";
  if (/(biceps|triceps|rosca|pulley|frances)/.test(value)) return "Braços";
  if (/(abd|prancha|core)/.test(value)) return "Core";
  if (/(corrida|esteira|bike|bicicleta|cardio|eliptico)/.test(value)) return "Cardio";
  return "Outro";
};

const normalizeWorkoutExerciseName = (name = "") =>
  String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const workoutVideoSource = (rawUrl = "") => {
  const url = String(rawUrl || "").trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? { type: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
    }

    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const id = parsed.searchParams.get("v") ||
        (parts[0] === "shorts" || parts[0] === "embed" ? parts[1] : "");
      return id ? { type: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
    }

    if (host === "vimeo.com" || host.endsWith("vimeo.com")) {
      const id = parsed.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part));
      return id ? { type: "embed", src: `https://player.vimeo.com/video/${id}` } : null;
    }

    return { type: "video", src: url };
  } catch (_) {
    return null;
  }
};

const workoutRepEstimate = (reps) => {
  const values = String(reps || "").match(/\d+/g)?.map(Number).filter(Number.isFinite) || [];
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  return Math.round((values[0] + values[1]) / 2);
};

const workoutDoneSetsCount = (session) =>
  Object.values(session?.sets || {}).reduce(
    (sum, rows) => sum + (rows || []).filter(Boolean).length,
    0
  );

const workoutTotalSetsCount = (template) =>
  (template?.exercises || []).reduce((sum, exercise) => sum + Number(exercise.sets || 0), 0);

const workoutSessionVolume = (session, template) => {
  if (!session || !template) return 0;
  return (template.exercises || []).reduce((sum, exercise) => {
    const setFlags = session.sets?.[exercise.id] || [];
    const repsLogged = session.repsDone?.[exercise.id] || [];
    const load = Number(session.loads?.[exercise.id] ?? exercise.load ?? 0);
    const fallbackReps = workoutRepEstimate(exercise.reps);
    return sum + setFlags.reduce((setSum, done, setIndex) => {
      if (!done) return setSum;
      const loggedReps = Number(repsLogged[setIndex]);
      const reps = Number.isFinite(loggedReps) && loggedReps > 0 ? loggedReps : fallbackReps;
      return setSum + Math.max(0, load) * Math.max(0, reps);
    }, 0);
  }, 0);
};

const workoutSessionDurationMinutes = (session, template = null) => {
  if (!session) return 0;

  const stored = Number(session.durationMinutes || 0);
  if (stored > 0) return Math.max(1, Math.round(stored));

  if (session.startedAt && session.completedAt) {
    const start = new Date(session.startedAt).getTime();
    const end = new Date(session.completedAt).getTime();
    const diff = end - start;
    if (Number.isFinite(diff) && diff > 0) return Math.max(1, Math.round(diff / 60000));
  }

  // Compatibilidade com treinos antigos, criados antes do cronômetro de sessão.
  // Sem timestamps confiáveis, estima pelo número de séries efetivamente realizadas.
  const doneSets = workoutDoneSetsCount(session);
  const totalSets = workoutTotalSetsCount(template);
  const referenceSets = doneSets > 0 ? doneSets : session.completed ? totalSets : 0;
  return referenceSets > 0 ? Math.max(1, Math.round(referenceSets * 2.25)) : 0;
};

const workoutPreviousCompletedSession = (sessions, templateId, date) =>
  [...(sessions || [])]
    .filter((session) => session.completed && session.templateId === templateId && session.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;

// A carga anterior deve refletir a última carga realmente registrada para o
// exercício, mesmo quando a sessão anterior não chegou a ser concluída.
// Isso evita o card ficar vazio depois de um treino interrompido/reaberto.
const workoutPreviousExerciseLoad = (sessions, templateId, exerciseId, beforeDate) => {
  const previous = [...(sessions || [])]
    .filter((session) =>
      session.templateId === templateId &&
      session.date < beforeDate &&
      session.loads?.[exerciseId] !== "" &&
      session.loads?.[exerciseId] != null &&
      Number.isFinite(Number(session.loads?.[exerciseId]))
    )
    .sort((a, b) => {
      const byDate = String(b.date || "").localeCompare(String(a.date || ""));
      if (byDate !== 0) return byDate;
      return String(b.completedAt || b.startedAt || "").localeCompare(
        String(a.completedAt || a.startedAt || "")
      );
    })[0];

  return previous ? Number(previous.loads?.[exerciseId]) : null;
};

const workoutHistoricalMaxLoad = (sessions, templateId, exerciseId, beforeDate = null) => {
  const values = (sessions || [])
    .filter((session) =>
      session.completed &&
      session.templateId === templateId &&
      (!beforeDate || session.date < beforeDate)
    )
    .map((session) => Number(session.loads?.[exerciseId]))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : 0;
};

// Estimativa de 1RM (fórmula de Epley) a partir da carga do exercício e da maior
// quantidade de repetições realmente registrada com ela em cada sessão concluída.
const workoutEstimated1RM = (sessions, templateId, exerciseId) => {
  let best = 0;
  (sessions || []).forEach((session) => {
    if (!session.completed || session.templateId !== templateId) return;
    const load = Number(session.loads?.[exerciseId]);
    if (!Number.isFinite(load) || load <= 0) return;
    const reps = (session.repsDone?.[exerciseId] || [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!reps.length) return;
    const estimate = load * (1 + Math.max(...reps) / 30);
    if (estimate > best) best = estimate;
  });
  return Math.round(best);
};

const workoutMuscleWeekGrid = (templates, sessions, days) => {
  const groupSet = new Set();
  const perDay = days.map((date) => {
    const dayGroups = new Set();
    (sessions || [])
      .filter((session) => session.completed && session.date === date)
      .forEach((session) => {
        const template = (templates || []).find((item) => item.id === session.templateId);
        (template?.exercises || []).forEach((exercise) => {
          const group = exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name);
          dayGroups.add(group);
          groupSet.add(group);
        });
      });
    return dayGroups;
  });

  return [...groupSet]
    .map((label) => ({ label, cells: perDay.map((dayGroups) => dayGroups.has(label)) }))
    .sort((a, b) => b.cells.filter(Boolean).length - a.cells.filter(Boolean).length);
};

const workoutTrainingInsights = (templates, sessions) => {
  const completed = [...(sessions || [])]
    .filter((session) => session.completed)
    .sort((a, b) => a.date.localeCompare(b.date));

  const insights = [];
  const exerciseRows = [];

  (templates || []).forEach((template) => {
    (template.exercises || []).forEach((exercise) => {
      const rows = completed
        .filter((session) => session.templateId === template.id)
        .map((session) => ({
          date: session.date,
          load: Number(session.loads?.[exercise.id] || 0),
        }))
        .filter((row) => row.load > 0);

      if (rows.length >= 2) {
        const first = rows[0];
        const last = rows[rows.length - 1];
        const pct = first.load > 0 ? Math.round(((last.load - first.load) / first.load) * 100) : 0;
        exerciseRows.push({ name: exercise.name, pct, rows });
      }
    });
  });

  const best = [...exerciseRows].sort((a, b) => b.pct - a.pct)[0];
  if (best && best.pct > 0) {
    insights.push(`${best.name} foi o exercício que mais evoluiu em carga: +${best.pct}%.`);
  }

  const stagnated = exerciseRows.find((item) => {
    const lastThree = item.rows.slice(-3);
    return lastThree.length === 3 && lastThree.every((row) => row.load === lastThree[0].load);
  });
  if (stagnated) {
    insights.push(`${stagnated.name} está há 3 sessões na mesma carga.`);
  }

  const recentStart = addDays(today(), -29);
  const previousStart = addDays(today(), -59);
  const previousEnd = addDays(today(), -30);

  const recentVolume = completed
    .filter((session) => session.date >= recentStart)
    .reduce((sum, session) => {
      const template = (templates || []).find((item) => item.id === session.templateId);
      return sum + workoutSessionVolume(session, template);
    }, 0);

  const previousVolume = completed
    .filter((session) => session.date >= previousStart && session.date <= previousEnd)
    .reduce((sum, session) => {
      const template = (templates || []).find((item) => item.id === session.templateId);
      return sum + workoutSessionVolume(session, template);
    }, 0);

  if (recentVolume > 0 && previousVolume > 0) {
    const delta = Math.round(((recentVolume - previousVolume) / previousVolume) * 100);
    insights.push(
      delta >= 0
        ? `Seu volume de treino aumentou ${delta}% nos últimos 30 dias.`
        : `Seu volume de treino caiu ${Math.abs(delta)}% nos últimos 30 dias.`
    );
  }

  if (!insights.length) {
    insights.push("Continue registrando cargas e séries para gerar análises mais precisas.");
  }

  return insights.slice(0, 3);
};

function WorkoutTemplateForm({ initial, onSave, onClose, exerciseLibrary = [], defaultScheduleDays = [] }) {
  const isCopy = Boolean(initial?.__copyMode);
  const [confirm, confirmDialog] = useConfirm();
  const [name, setName] = useState(initial?.name || "");
  const [scheduleDays, setScheduleDays] = useState(initial?.scheduleDays || defaultScheduleDays);
  const [exercises, setExercises] = useState(() =>
    initial?.exercises?.length
      ? initial.exercises.map((exercise) => ({
          ...exercise,
          load: exercise.load ?? "",
          muscleGroup: exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name),
          restSeconds: Number(exercise.restSeconds || 90),
          favorite: Boolean(exercise.favorite),
          videoUrl: String(exercise.videoUrl || ""),
        }))
      : [{
          id: uid(),
          name: "",
          sets: 3,
          reps: "10-12",
          load: "",
          muscleGroup: "Outro",
          restSeconds: 90,
          favorite: false,
          videoUrl: "",
        }]
  );

  const update = (id, patch) =>
    setExercises((prev) => prev.map((exercise) => exercise.id === id ? { ...exercise, ...patch } : exercise));

  const addExercise = () =>
    setExercises((prev) => [
      ...prev,
      {
        id: uid(),
        name: "",
        sets: 3,
        reps: "10-12",
        load: "",
        muscleGroup: "Outro",
        restSeconds: 90,
        favorite: false,
        videoUrl: "",
      },
    ]);

  const toggleScheduleDay = (day) =>
    setScheduleDays((prev) =>
      prev.includes(day)
        ? prev.filter((item) => item !== day)
        : [...prev, day].sort()
    );

  const removeExercise = async (id) => {
    if (!(await confirm("Tem certeza que deseja remover este exercício?"))) return;
    setExercises((prev) => prev.filter((exercise) => exercise.id !== id));
  };

  return (
    <Modal title={isCopy ? "Novo treino a partir de cópia" : initial ? "Editar treino" : "Novo treino"} onClose={onClose} width={620}>
      <Field label="Nome do treino">
        <input
          className="w-full p-3 ring-focus"
          placeholder="Ex: Treino A — Peito e Tríceps"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field label="Programação semanal (opcional)">
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((label, index) => (
            <button
              key={index}
              type="button"
              className="rounded-xl py-2 text-xs"
              onClick={() => toggleScheduleDay(index)}
              style={{
                border: `1px solid ${scheduleDays.includes(index) ? "var(--brass)" : "var(--border)"}`,
                background: scheduleDays.includes(index) ? "var(--surface-2)" : "transparent",
                color: scheduleDays.includes(index) ? "var(--brass)" : "var(--text-dim)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <datalist id="constancce-exercise-library">
        {exerciseLibrary.map((item) => (
          <option key={item.name} value={item.name}>{item.lastLoad ? `${item.lastLoad} kg` : ""}</option>
        ))}
      </datalist>

      <div className="flex items-end justify-between gap-3 mb-2">
        <div>
          <p className="text-xs text-dim">Exercícios</p>
          <p className="text-[10px] text-faint mt-0.5">O básico fica visível. Grupo muscular e descanso ajudam o app a organizar melhor sua evolução.</p>
        </div>
        <span className="chip">{exercises.length}</span>
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {exercises.map((exercise, index) => (
          <div key={exercise.id} className="workout-form-exercise surface-2 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                className="btn-ghost rounded-lg p-1.5 shrink-0"
                title={exercise.favorite ? "Remover dos favoritos" : "Favoritar exercício"}
                onClick={() => update(exercise.id, { favorite: !exercise.favorite })}
              >
                <Star size={14} className={exercise.favorite ? "text-brass" : "text-faint"} fill={exercise.favorite ? "currentColor" : "none"} />
              </button>

              <input
                list="constancce-exercise-library"
                className="flex-1 min-w-0 p-2 text-sm ring-focus"
                placeholder={`Exercício ${index + 1}`}
                value={exercise.name}
                onChange={(event) => {
                  const nextName = event.target.value;
                  const libraryMatch = exerciseLibrary.find((item) =>
                    normalizeWorkoutExerciseName(item.name) === normalizeWorkoutExerciseName(nextName)
                  );
                  update(exercise.id, {
                    name: nextName,
                    muscleGroup:
                      exercise.muscleGroup === "Outro" || !exercise.muscleGroup
                        ? inferWorkoutMuscleGroup(nextName)
                        : exercise.muscleGroup,
                    videoUrl: exercise.videoUrl || libraryMatch?.videoUrl || "",
                  });
                }}
              />

              {exercises.length > 1 && (
                <button className="btn-ghost rounded-lg p-2" onClick={() => removeExercise(exercise.id)}>
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                min={1}
                className="p-2 text-sm ring-focus"
                placeholder="Séries"
                value={exercise.sets}
                onChange={(event) => update(exercise.id, { sets: Number(event.target.value) })}
              />
              <input
                className="p-2 text-sm ring-focus"
                placeholder="Repetições"
                value={exercise.reps}
                onChange={(event) => update(exercise.id, { reps: event.target.value })}
              />
              <input
                type="number"
                min={0}
                step="0.5"
                className="p-2 text-sm ring-focus"
                placeholder="Carga kg"
                value={exercise.load ?? ""}
                onChange={(event) => update(exercise.id, { load: event.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <select
                className="p-2 text-xs ring-focus"
                value={exercise.muscleGroup || "Outro"}
                onChange={(event) => update(exercise.id, { muscleGroup: event.target.value })}
              >
                {WORKOUT_MUSCLE_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>

              <select
                className="p-2 text-xs ring-focus"
                value={Number(exercise.restSeconds || 90)}
                onChange={(event) => update(exercise.id, { restSeconds: Number(event.target.value) })}
              >
                <option value={60}>Descanso 60s</option>
                <option value={90}>Descanso 90s</option>
                <option value={120}>Descanso 120s</option>
              </select>
            </div>

            <div className="mt-2">
              <input
                type="url"
                className="w-full p-2 text-xs ring-focus"
                placeholder="Vídeo explicativo (YouTube, Vimeo ou MP4)"
                value={exercise.videoUrl || ""}
                onChange={(event) => update(exercise.id, { videoUrl: event.target.value })}
              />
              <p className="text-[9px] text-faint mt-1">
                O vídeo abre ao tocar no nome do exercício durante o treino. O mesmo link é reaproveitado em exercícios com o mesmo nome.
              </p>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn-ghost rounded-xl py-2 w-full text-sm mb-3 flex items-center justify-center gap-1"
        onClick={addExercise}
      >
        <Plus size={14} /> Adicionar exercício
      </button>

      <button
        disabled={!name.trim() || exercises.some((exercise) => !exercise.name.trim())}
        className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
        onClick={() => {
          const cleanExercises = exercises.map((exercise) => ({
            ...exercise,
            id: isCopy ? uid() : exercise.id,
            name: exercise.name.trim(),
            sets: Math.max(1, Number(exercise.sets) || 1),
            reps: String(exercise.reps || "").trim(),
            load: exercise.load === "" ? "" : Number(exercise.load || 0),
            muscleGroup: exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name),
            restSeconds: Number(exercise.restSeconds || 90),
            favorite: Boolean(exercise.favorite),
            videoUrl: String(exercise.videoUrl || "").trim(),
          }));

          onSave({
            ...(isCopy ? {} : initial || {}),
            id: isCopy ? uid() : (initial?.id || uid()),
            name: name.trim(),
            scheduleDays,
            exercises: cleanExercises,
          });
        }}
      >
        {isCopy ? "Criar treino copiado" : initial ? "Salvar alterações" : "Salvar treino"}
      </button>
      {confirmDialog}
    </Modal>
  );
}


function WorkoutLoadInput({ value, disabled, onCommit }) {
  const [draft, setDraft] = useState(() => value === "" || value == null ? "" : String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(value === "" || value == null ? "" : String(value));
  }, [value]);

  const commit = () => {
    const raw = String(draft ?? "").trim().replace(",", ".");
    if (!raw) {
      onCommit("");
      setDraft("");
      return;
    }

    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) {
      setDraft(value === "" || value == null ? "" : String(value));
      return;
    }

    onCommit(number);
    setDraft(String(number));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      className="workout-load-input w-full p-2 mt-1 ring-focus"
      value={draft}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        // Não sincroniza a sessão a cada tecla. Isso preserva foco/cursor e
        // permite digitar valores como "12,5" antes de confirmar.
        setDraft(event.target.value);
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function WorkoutRepsInput({ value, disabled, onCommit }) {
  const [draft, setDraft] = useState(() => value === "" || value == null ? "" : String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(value === "" || value == null ? "" : String(value));
  }, [value]);

  const commit = () => {
    const raw = String(draft ?? "").trim();
    if (!raw) {
      onCommit("");
      setDraft("");
      return;
    }

    const number = Math.round(Number(raw));
    if (!Number.isFinite(number) || number < 0) {
      setDraft(value === "" || value == null ? "" : String(value));
      return;
    }

    onCommit(number);
    setDraft(String(number));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      enterKeyHint="done"
      autoComplete="off"
      placeholder="reps"
      className="workout-reps-input w-10 p-1 text-[10px] text-center ring-focus"
      value={draft}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function WorkoutNoteInput({ value, disabled, onCommit, className, placeholder }) {
  const [draft, setDraft] = useState(() => value || "");
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(value || "");
  }, [value]);

  const commit = () => {
    if (draft === (value || "")) return;
    onCommit(draft);
  };

  return (
    <input
      className={className}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        // Mesmo motivo do WorkoutLoadInput: sincronizar a cada tecla derruba
        // caracteres quando a resposta do servidor chega no meio da digitação.
        setDraft(event.target.value);
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function WorkoutsView({
  session,
  templates,
  sessions,
  saveTemplate,
  deleteTemplate,
  reorderTemplates,
  moveTemplateByStep,
  startOrGetSession,
  toggleSet,
  toggleExercise,
  updateLoad,
  updateReps,
  updateSession,
  completeSession,
  undoCompleteSession,
  autoOpen,
  isPro,
  onUpgrade,
  restTimer,
  onStartRest,
  onCancelRest,
  onAdjustRest,
  resumeSessionId,
  onResumeHandled,
}) {
  const [section, setSection] = useState("today");
  const [promptFor, promptDialog] = usePrompt();
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [expandedTemplateId, setExpandedTemplateId] = useState(null);
  const [draggedTemplateId, setDraggedTemplateId] = useState(null);
  const [dragOverTemplateId, setDragOverTemplateId] = useState(null);
  const [progressExerciseKey, setProgressExerciseKey] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState("30d");
  const [historyCustomStart, setHistoryCustomStart] = useState(() => addDays(today(), -29));
  const [historyCustomEnd, setHistoryCustomEnd] = useState(() => today());
  const [showImportWorkout, setShowImportWorkout] = useState(false);
  const [importWorkoutValue, setImportWorkoutValue] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(null);
  const [exerciseGuide, setExerciseGuide] = useState(null);
  const [prescribeTemplate, setPrescribeTemplate] = useState(null);
  const [prescribeClients, setPrescribeClients] = useState([]);
  const [prescribeClientId, setPrescribeClientId] = useState("");
  const [prescribeNote, setPrescribeNote] = useState("");
  const [prescribeLoading, setPrescribeLoading] = useState(false);
  const [prescribeNotice, setPrescribeNotice] = useState(null);

  useEffect(() => {
    if (autoOpen) {
      setSection("library");
      setEditingTemplate(null);
      setShowForm(true);
    }
  }, [autoOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.querySelector(".app-main")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    });
  }, [section]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("sharedWorkout");
    if (!shared) return;
    setSection("library");
    setImportWorkoutValue(shared);
    setShowImportWorkout(true);
    params.delete("sharedWorkout");
    const nextQuery = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`
    );
  }, []);

  useEffect(() => {
    // resumeSessionId só existe como um pedido explícito (clique no pílula de descanso
    // flutuante) e é consumido/zerado pelo pai (onResumeHandled) logo depois de tratado.
    // Isso é essencial: sem o consumo, o valor continuaria "verdadeiro" e este efeito
    // reabriria o modal do treino e forçaria a aba "Hoje" de novo a cada re-render,
    // mesmo depois do usuário fechar o modal ou trocar para "Meus treinos" de propósito.
    if (!resumeSessionId) return;
    const sessionToResume = sessions.find(
      (session) => session.id === resumeSessionId && !session.completed
    );
    if (sessionToResume) {
      setSection("today");
      setActiveSessionId(sessionToResume.id);
      setActiveTemplateId(sessionToResume.templateId);
    }
    onResumeHandled?.();
  }, [resumeSessionId, sessions, onResumeHandled]);



  const t = today();
  const yesterday = addDays(t, -1);
  const activeSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId)
    : activeTemplateId
      ? sessions.find((session) => session.templateId === activeTemplateId && session.date === t)
      : null;

  const activeTemplate = activeSession
    ? templates.find((template) => template.id === activeSession.templateId)
    : templates.find((template) => template.id === activeTemplateId);

  const [workoutClockTick, setWorkoutClockTick] = useState(() => Date.now());
  const workoutInProgress = Boolean(activeSession && !activeSession.completed);
  useEffect(() => {
    if (!workoutInProgress) return;
    setWorkoutClockTick(Date.now());
    const interval = window.setInterval(() => setWorkoutClockTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [workoutInProgress, activeSession?.id]);
  const workoutElapsedSeconds = workoutInProgress && activeSession?.startedAt
    ? Math.max(0, Math.floor((workoutClockTick - new Date(activeSession.startedAt).getTime()) / 1000))
    : 0;
  const formatWorkoutClock = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(h > 0 ? 2 : 1, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  };

  const allHistory = [...sessions]
    .filter((session) => !session.plannedOnly || session.date <= t)
    .sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );
  const historyCutoff = proCutoffDate();
  const history = isPro
    ? allHistory
    : allHistory.filter((session) => session.date >= historyCutoff);
  const hiddenHistoryCount = isPro
    ? 0
    : allHistory.filter((session) => session.date < historyCutoff).length;

  const historyPeriodRange = (() => {
    if (historyPeriod === "7d") {
      return { start: addDays(t, -6), end: t, label: "Últimos 7 dias" };
    }
    if (historyPeriod === "30d") {
      return { start: addDays(t, -29), end: t, label: "Últimos 30 dias" };
    }
    if (historyPeriod === "90d") {
      return { start: addDays(t, -89), end: t, label: "Últimos 90 dias" };
    }
    if (historyPeriod === "year") {
      return { start: `${t.slice(0, 4)}-01-01`, end: t, label: "Este ano" };
    }
    if (historyPeriod === "custom") {
      const start = historyCustomStart || (isPro ? "" : historyCutoff);
      const end = historyCustomEnd || t;
      return {
        start,
        end,
        label: start && end
          ? `${dateLabel(start, { day: "2-digit", month: "2-digit", year: "numeric" })} — ${dateLabel(end, { day: "2-digit", month: "2-digit", year: "numeric" })}`
          : "Período personalizado",
      };
    }
    return { start: "", end: t, label: "Todo o histórico" };
  })();

  const filteredHistory = history.filter((session) => {
    const date = String(session.date || "");
    if (!date) return false;
    if (historyPeriodRange.start && date < historyPeriodRange.start) return false;
    if (historyPeriodRange.end && date > historyPeriodRange.end) return false;
    return true;
  });

  const filteredCompletedHistory = filteredHistory.filter((session) => session.completed);
  const filteredHistoryVolume = filteredCompletedHistory.reduce((sum, session) => {
    const template = templates.find((item) => item.id === session.templateId);
    return sum + workoutSessionVolume(session, template);
  }, 0);
  const filteredHistoryMinutes = filteredCompletedHistory.reduce((sum, session) => {
    const template = templates.find((item) => item.id === session.templateId);
    return sum + workoutSessionDurationMinutes(session, template);
  }, 0);

  const selectHistoryPeriod = (period) => {
    const proOnlyPeriod = ["90d", "year", "all"].includes(period);
    if (!isPro && proOnlyPeriod) {
      onUpgrade("history");
      return;
    }
    setHistoryPeriod(period);
  };

  useEffect(() => {
    if (isPro) return;
    if (historyCustomStart && historyCustomStart < historyCutoff) {
      setHistoryCustomStart(historyCutoff);
    }
    if (["90d", "year", "all"].includes(historyPeriod)) {
      setHistoryPeriod("30d");
    }
  }, [isPro, historyCutoff, historyPeriod, historyCustomStart]);

  const plannedTodayTemplateIds = new Set(
    sessions
      .filter((session) => session.date === t && session.plannedOnly)
      .map((session) => session.templateId)
  );
  const scheduledToday = templates.filter((template) =>
    (template.scheduleDays || []).includes(weekdayIndex(t)) ||
    plannedTodayTemplateIds.has(template.id)
  );

  const yesterdayMissed = templates.filter((template) =>
    (template.scheduleDays || []).includes(weekdayIndex(yesterday)) &&
    !sessions.some((session) =>
      session.templateId === template.id &&
      session.date === yesterday &&
      session.completed
    )
  );

  const weekStart = startOfWeek(t);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const muscleWeekDays = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const muscleWeekGrid = workoutMuscleWeekGrid(templates, sessions, muscleWeekDays);
  const trainingInsights = workoutTrainingInsights(templates, sessions);

  const exerciseLibrary = useMemo(() => {
    const rows = new Map();

    templates.forEach((template) => {
      template.exercises.forEach((exercise) => {
        const key = String(exercise.name || "").trim().toLowerCase();
        if (!key) return;

        const latestLoad = [...sessions]
          .filter((session) =>
            session.completed &&
            session.templateId === template.id &&
            session.loads?.[exercise.id] != null
          )
          .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.loads?.[exercise.id];

        const current = rows.get(key);
        rows.set(key, {
          name: exercise.name,
          favorite: Boolean(exercise.favorite) || Boolean(current?.favorite),
          muscleGroup: exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name),
          lastLoad: Number(latestLoad || current?.lastLoad || exercise.load || 0),
          videoUrl: String(exercise.videoUrl || current?.videoUrl || ""),
        });
      });
    });

    return [...rows.values()].sort((a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      a.name.localeCompare(b.name, "pt-BR")
    );
  }, [templates, sessions]);

  const favoriteExercises = exerciseLibrary.filter((item) => item.favorite);

  const selectedHistorySessions = selectedHistoryDate
    ? sessions
        .filter((session) => session.date === selectedHistoryDate && !session.plannedOnly)
        .sort((a, b) => String(a.startedAt || "").localeCompare(String(b.startedAt || "")))
    : [];

  const selectedHistoryPlannedTemplates = selectedHistoryDate
    ? templates.filter((template) =>
        (template.scheduleDays || []).includes(weekdayIndex(selectedHistoryDate)) ||
        sessions.some((session) =>
          session.date === selectedHistoryDate &&
          session.templateId === template.id &&
          session.plannedOnly
        )
      )
    : [];

  const exerciseGuideVideo = exerciseGuide
    ? workoutVideoSource(exerciseGuide.videoUrl)
    : null;

  const primaryToday = scheduledToday[0] || null;
  const primaryTodaySession = primaryToday
    ? sessions.find((session) => session.templateId === primaryToday.id && session.date === t)
    : null;

  const progressOptions = templates.flatMap((template) =>
    template.exercises.map((exercise) => ({
      key: `${template.id}::${exercise.id}`,
      templateId: template.id,
      exerciseId: exercise.id,
      label: `${template.name} · ${exercise.name}`,
    }))
  );

  const effectiveProgressKey = progressExerciseKey || progressOptions[0]?.key || "";
  const selectedProgressOption = progressOptions.find((option) => option.key === effectiveProgressKey);
  const loadProgressRows = selectedProgressOption
    ? sessions
        .filter((session) =>
          session.completed &&
          session.templateId === selectedProgressOption.templateId &&
          session.loads?.[selectedProgressOption.exerciseId] !== "" &&
          session.loads?.[selectedProgressOption.exerciseId] != null
        )
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .slice(-12)
        .map((session) => ({
          label: dateLabel(session.date, { day: "2-digit", month: "2-digit" }),
          value: Number(session.loads?.[selectedProgressOption.exerciseId] || 0),
        }))
    : [];

  const records = templates
    .flatMap((template) =>
      template.exercises.map((exercise) => ({
        name: exercise.name,
        load: workoutHistoricalMaxLoad(sessions, template.id, exercise.id),
        oneRepMax: workoutEstimated1RM(sessions, template.id, exercise.id),
      }))
    )
    .filter((item) => item.load > 0)
    .sort((a, b) => b.load - a.load)
    .slice(0, 4);

  const sharedWorkoutPreview = decodeWorkoutShare(importWorkoutValue);

  const openTodaySession = (template) => {
    setActiveSessionId(null);
    startOrGetSession(template.id);
    setActiveTemplateId(template.id);
  };

  const formatTimer = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = String(seconds % 60).padStart(2, "0");
    return `${min}:${sec}`;
  };

  const openPrescribeWorkout = async (template) => {
    if (!isPro) {
      onUpgrade("professional");
      return;
    }
    setPrescribeTemplate(template);
    setPrescribeClientId("");
    setPrescribeNote("");
    setPrescribeNotice(null);
    try {
      const links = (await fetchProfessionalLinks(session)) || [];
      setPrescribeClients(links.filter((l) => l.status === "accepted" && l.direction === "as_professional" && l.link_type === "personal"));
    } catch (_) {
      setPrescribeClients([]);
    }
  };

  const confirmPrescribeWorkout = async () => {
    if (!prescribeTemplate || !prescribeClientId) return;
    setPrescribeLoading(true);
    setPrescribeNotice(null);
    try {
      await sendPrescription(session, prescribeClientId, "workout", prescribeTemplate, prescribeNote);
      setPrescribeNotice({ type: "ok", text: "Treino enviado para o aluno." });
    } catch (err) {
      const raw = (err.message || "").toLowerCase();
      const text = raw.includes("pro_required")
        ? "É preciso ser PRO para prescrever treinos."
        : "Não foi possível enviar o treino.";
      setPrescribeNotice({ type: "error", text });
    } finally {
      setPrescribeLoading(false);
    }
  };

  const shareWorkout = async (template) => {
    if (!isPro) {
      onUpgrade("sharing");
      return;
    }

    const token = encodeWorkoutShare(template);
    const url = `${window.location.origin}${window.location.pathname}?view=workouts&sharedWorkout=${encodeURIComponent(token)}`;
    const shareData = {
      title: `Treino: ${template.name}`,
      text: `Estou compartilhando o treino "${template.name}" pelo Constancce.`,
      url,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setShareNotice("Treino compartilhado.");
      } else {
        await navigator.clipboard.writeText(url);
        setShareNotice("Link do treino copiado.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(url);
          setShareNotice("Link do treino copiado.");
        } catch (_) {
          setShareNotice("Não foi possível compartilhar neste navegador.");
        }
      }
    }

    window.setTimeout(() => setShareNotice(""), 3200);
  };

  const importSharedWorkout = () => {
    const payload = decodeWorkoutShare(importWorkoutValue);
    if (!payload) return;

    const saved = saveTemplate({
      id: uid(),
      name: `${payload.name} — Recebido`,
      scheduleDays: Array.isArray(payload.scheduleDays) ? payload.scheduleDays : [],
      exercises: payload.exercises.map((exercise) => ({
        id: uid(),
        name: String(exercise.name || "Exercício"),
        sets: Math.max(1, Number(exercise.sets) || 1),
        reps: String(exercise.reps || ""),
        load: exercise.load ?? "",
        muscleGroup: exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name),
        restSeconds: Number(exercise.restSeconds || 90),
        favorite: false,
        videoUrl: String(exercise.videoUrl || ""),
      })),
      receivedAt: today(),
    });

    if (saved === false) return;

    setShowImportWorkout(false);
    setImportWorkoutValue("");
    setShareNotice("Treino recebido e adicionado à sua lista.");
    window.setTimeout(() => setShareNotice(""), 3200);
  };

  const sessionSummary = activeSession && activeTemplate
    ? {
        doneSets: workoutDoneSetsCount(activeSession),
        totalSets: workoutTotalSetsCount(activeTemplate),
        volume: workoutSessionVolume(activeSession, activeTemplate),
        duration: workoutSessionDurationMinutes(activeSession, activeTemplate),
        previous: workoutPreviousCompletedSession(
          sessions,
          activeTemplate.id,
          activeSession.date
        ),
      }
    : null;

  const previousSessionVolume = sessionSummary?.previous && activeTemplate
    ? workoutSessionVolume(sessionSummary.previous, activeTemplate)
    : 0;

  const sessionPrs = activeSession && activeTemplate
    ? activeTemplate.exercises.filter((exercise) => {
        const currentLoad = Number(activeSession.loads?.[exercise.id] || 0);
        const previousMax = workoutHistoricalMaxLoad(
          sessions,
          activeTemplate.id,
          exercise.id,
          activeSession.date
        );
        const hasDoneSet = (activeSession.sets?.[exercise.id] || []).some(Boolean);
        return hasDoneSet && currentLoad > 0 && currentLoad > previousMax;
      })
    : [];

  return (
    <div className="workouts-view flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl">Treinos</h2>
            {!isPro && <span className="chip">{templates.length}/{PRO_LIMITS.workouts} Free</span>}
          </div>
          <p className="text-faint text-xs mt-1">
            Execute o treino, registre cargas e acompanhe sua evolução sem complicação.
          </p>
        </div>

        <button
          className="btn-primary rounded-xl px-3 py-2 text-sm flex items-center justify-center gap-1 self-start sm:self-auto"
          onClick={() => {
            if (!isPro && templates.length >= PRO_LIMITS.workouts) {
              onUpgrade("workouts");
              return;
            }
            setSection("library");
            setEditingTemplate(null);
            setShowForm(true);
          }}
        >
          <Plus size={16} /> Novo treino
        </button>
      </div>

      <FirstVisitTip id="workouts" icon={Dumbbell} title="Treinos guardam sua evolução, não só sua ficha.">
        Cadastre seu treino uma vez, registre cargas e séries durante a execução e acompanhe como seu desempenho muda com o tempo.
      </FirstVisitTip>

      <div className="workout-section-tabs task-glass-tabs rounded-2xl p-1 grid grid-cols-3 gap-1">
        {[
          ["today", "Hoje"],
          ["library", "Meus treinos"],
          ["evolution", "Evolução"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`task-tab-button rounded-xl py-2 text-xs md:text-sm ${section === id ? "task-tab-active" : ""}`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {shareNotice && (
        <div className="surface-2 rounded-xl px-3 py-2 text-xs text-moss">
          {shareNotice}
        </div>
      )}

      {section === "today" && (
        <>
          <div className="workout-week-strip surface rounded-2xl p-3 md:p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] text-faint uppercase tracking-widest">Sua semana</p>
                <p className="text-dim text-xs mt-0.5">✓ feito · ● programado</p>
              </div>
              <span className="chip">
                {sessions.filter((session) =>
                  session.completed &&
                  session.date >= weekStart &&
                  session.date <= addDays(weekStart, 6)
                ).length} treinos
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {weekDays.map((date) => {
                const done = sessions.some((session) => session.completed && session.date === date);
                const scheduled = templates.some((template) =>
                  (template.scheduleDays || []).includes(weekdayIndex(date))
                );
                const isToday = date === t;

                const isPast = date < t;

                return (
                  <button
                    type="button"
                    key={date}
                    className={`workout-week-day rounded-xl py-2 px-1 text-center ${isPast ? "cursor-pointer" : "cursor-default"}`}
                    onClick={() => {
                      if (isPast) setSelectedHistoryDate(date);
                    }}
                    aria-label={isPast ? `Ver treino de ${dateLabel(date)}` : undefined}
                    title={isPast ? "Ver treino deste dia" : undefined}
                    style={{
                      border: `1px solid ${isToday ? "var(--brass-dim)" : "var(--border-soft)"}`,
                      background: isToday ? "color-mix(in srgb, var(--brass) 5%, var(--surface-2))" : "var(--surface-2)",
                      opacity: date > t ? 0.68 : 1,
                    }}
                  >
                    <p className="text-[9px] text-faint">{WEEKDAYS[weekdayIndex(date)]}</p>
                    <p className="font-mono text-[11px] mt-0.5">
                      {new Date(`${date}T12:00:00`).getDate()}
                    </p>
                    <p className={`text-[10px] mt-1 ${done ? "text-moss" : scheduled ? "text-brass" : "text-faint"}`}>
                      {done ? "✓" : scheduled ? "●" : "—"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {templates.length === 0 && (
            <EmptyState
              icon={Dumbbell}
              title="Nenhum treino cadastrado."
              hint="Crie sua ficha ou comece com um treino básico pronto e ajuste depois ao seu nível."
              action={
                <div className="flex flex-col items-center gap-2 mt-2">
                  <button
                    className="btn-primary rounded-xl px-4 py-2 text-sm"
                    onClick={() => {
                      setSection("library");
                      setShowForm(true);
                    }}
                  >
                    Criar meu primeiro treino
                  </button>
                  <button
                    className="chip"
                    onClick={() => saveTemplate({
                      id: uid(),
                      name: "Treino A — Corpo inteiro",
                      scheduleDays: [1, 3, 5],
                      exercises: [
                        { id: uid(), name: "Agachamento", sets: 3, reps: "8-12", load: "", muscleGroup: "Pernas", restSeconds: 90, favorite: false, videoUrl: "" },
                        { id: uid(), name: "Supino reto", sets: 3, reps: "8-12", load: "", muscleGroup: "Peito", restSeconds: 90, favorite: false, videoUrl: "" },
                        { id: uid(), name: "Remada", sets: 3, reps: "8-12", load: "", muscleGroup: "Costas", restSeconds: 90, favorite: false, videoUrl: "" },
                      ],
                    })}
                  >
                    + Usar treino básico
                  </button>
                </div>
              }
            />
          )}

          {primaryToday ? (
            <div className="workout-today-hero surface rounded-2xl p-4 md:p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] text-faint uppercase tracking-widest">Treino de hoje</p>
                    {primaryTodaySession?.completed && <span className="chip text-moss">Concluído</span>}
                    {primaryTodaySession && !primaryTodaySession.completed && <span className="chip text-brass">Em andamento</span>}
                  </div>

                  <p className="font-display text-2xl mt-1 break-words">{primaryToday.name}</p>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="chip">{primaryToday.exercises.length} exercícios</span>
                    <span className="chip">{workoutTotalSetsCount(primaryToday)} séries</span>
                    <span className="chip">
                      ~{Math.max(20, workoutTotalSetsCount(primaryToday) * 2)} min
                    </span>
                  </div>

                  {primaryTodaySession && (
                    <div className="mt-3 max-w-md">
                      <div className="flex items-center justify-between text-[10px] mb-1.5">
                        <span className="text-faint">Progresso</span>
                        <span className="font-mono">
                          {workoutDoneSetsCount(primaryTodaySession)}/{workoutTotalSetsCount(primaryToday)}
                        </span>
                      </div>
                      <Progress
                        value={
                          workoutTotalSetsCount(primaryToday) > 0
                            ? Math.round(
                                workoutDoneSetsCount(primaryTodaySession) /
                                workoutTotalSetsCount(primaryToday) * 100
                              )
                            : 0
                        }
                        height={5}
                      />
                    </div>
                  )}
                </div>

                <button
                  className="btn-primary rounded-xl px-5 py-3 text-sm whitespace-nowrap"
                  onClick={() => openTodaySession(primaryToday)}
                >
                  {primaryTodaySession?.completed
                    ? "Visualizar treino feito"
                    : primaryTodaySession
                      ? "Continuar treino"
                      : "Iniciar treino"}
                </button>
              </div>
            </div>
          ) : templates.length > 0 ? (
            <div className="surface rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest">Hoje</p>
              <p className="font-display text-xl mt-1">Nenhum treino programado.</p>
              <p className="text-dim text-xs mt-1">
                Você pode descansar ou iniciar um dos seus treinos manualmente.
              </p>

              <div className="flex flex-wrap gap-2 mt-3">
                {templates.slice(0, 3).map((template) => (
                  <button
                    key={template.id}
                    className="btn-ghost rounded-xl px-3 py-2 text-xs"
                    onClick={() => openTodaySession(template)}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {yesterdayMissed.length > 0 && (
            <div className="workout-missed-card surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-[10px] text-faint uppercase tracking-widest">Treino não realizado</p>
                <p className="font-medium text-sm mt-1">{yesterdayMissed[0].name}</p>
                <p className="text-dim text-xs mt-1">Estava programado para ontem.</p>
              </div>
              <button
                className="btn-ghost rounded-xl px-3 py-2 text-xs flex items-center gap-1"
                onClick={() => openTodaySession(yesterdayMissed[0])}
              >
                <Repeat2 size={13} /> Fazer hoje
              </button>
            </div>
          )}
        </>
      )}

      {section === "library" && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-faint uppercase tracking-widest">Meus treinos</p>
              <p className="text-dim text-xs mt-1">Fichas simples para iniciar, editar, copiar ou compartilhar.</p>
            </div>
            <button
              className="btn-ghost rounded-xl px-3 py-2 text-xs flex items-center gap-1"
              onClick={() => {
                setImportWorkoutValue("");
                setShowImportWorkout(true);
              }}
            >
              <Upload size={14} /> Receber
            </button>
          </div>

          {favoriteExercises.length > 0 && (
            <div className="surface glass-panel rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Star size={14} className="text-brass" fill="currentColor" />
                <p className="text-[10px] text-faint uppercase tracking-widest">Exercícios favoritos</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {favoriteExercises.slice(0, 10).map((exercise) => (
                  <span key={exercise.name} className="chip">
                    {exercise.name}
                    {exercise.lastLoad > 0 ? ` · ${exercise.lastLoad}kg` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {templates.length === 0 && (
            <EmptyState
              icon={Dumbbell}
              title="Nenhum treino cadastrado."
              hint="Crie um treino com exercícios, séries e repetições."
            />
          )}

          {templates.length > 1 && (
            <div className="flex items-center gap-2 text-[11px] text-faint px-1">
              <GripVertical size={13} />
              <span className="hidden md:inline">Arraste para organizar a ordem.</span>
              <span className="md:hidden">Use as setas para organizar.</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {templates.map((template, index) => {
              const doneToday = sessions.some((session) =>
                session.templateId === template.id &&
                session.date === t &&
                session.completed
              );
              const isDragging = draggedTemplateId === template.id;
              const isDragTarget =
                dragOverTemplateId === template.id &&
                draggedTemplateId !== template.id;

              const groups = [...new Set(
                template.exercises.map((exercise) =>
                  exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name)
                )
              )].filter((group) => group !== "Outro");

              return (
                <div
                  key={template.id}
                  draggable
                  onDragStart={(event) => {
                    setDraggedTemplateId(template.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", template.id);
                  }}
                  onDragEnd={() => {
                    setDraggedTemplateId(null);
                    setDragOverTemplateId(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (draggedTemplateId !== template.id) setDragOverTemplateId(template.id);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setDragOverTemplateId(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId =
                      event.dataTransfer.getData("text/plain") ||
                      draggedTemplateId;
                    reorderTemplates(sourceId, template.id);
                    setDraggedTemplateId(null);
                    setDragOverTemplateId(null);
                  }}
                  className={`workout-template-card surface rounded-2xl p-4 ${
                    isDragging ? "workout-template-dragging" : ""
                  } ${isDragTarget ? "workout-template-drop-target" : ""}`}
                >
                  <div className="workout-template-header flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex items-start md:items-center gap-2.5 min-w-0 w-full md:w-auto">
                      <div className="hidden md:flex workout-drag-handle shrink-0 items-center justify-center" title="Arraste para reorganizar">
                        <GripVertical size={17} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          className="workout-template-name-button flex items-center gap-1.5 max-w-full text-left"
                          onClick={() => setExpandedTemplateId((current) => current === template.id ? null : template.id)}
                          onPointerDown={(event) => event.stopPropagation()}
                          aria-expanded={expandedTemplateId === template.id}
                          title="Ver exercícios deste treino"
                        >
                          <span className="workout-template-name font-display text-lg break-words">{template.name}</span>
                          {expandedTemplateId === template.id
                            ? <ChevronUp size={14} className="text-brass shrink-0" />
                            : <ChevronDown size={14} className="text-faint shrink-0" />}
                        </button>
                        <p className="text-faint text-xs">
                          {template.exercises.length} exercícios · {workoutTotalSetsCount(template)} séries · toque no nome para ver
                        </p>

                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(template.scheduleDays || []).map((day) => (
                            <span key={day} className="chip text-[9px]">{WEEKDAYS[day]}</span>
                          ))}
                          {groups.slice(0, 3).map((group) => (
                            <span key={group} className="chip text-[9px]">{group}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="workout-template-actions flex flex-wrap items-center justify-end gap-1 shrink-0">
                      {doneToday && <span className="chip text-moss whitespace-nowrap">feito hoje</span>}

                      <button
                        className="btn-ghost rounded-lg p-2 md:hidden"
                        disabled={index === 0}
                        onClick={() => moveTemplateByStep(template.id, "up")}
                        aria-label={`Mover ${template.name} para cima`}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        className="btn-ghost rounded-lg p-2 md:hidden"
                        disabled={index === templates.length - 1}
                        onClick={() => moveTemplateByStep(template.id, "down")}
                        aria-label={`Mover ${template.name} para baixo`}
                      >
                        <ChevronDown size={14} />
                      </button>

                      <button
                        className="btn-ghost rounded-lg p-2"
                        onClick={() => shareWorkout(template)}
                        title={isPro ? "Compartilhar treino" : "Compartilhar · PRO"}
                      >
                        {isPro ? <Share2 size={14} /> : <Lock size={13} />}
                      </button>

                      <button
                        className="btn-ghost rounded-lg p-2"
                        onClick={() => openPrescribeWorkout(template)}
                        title={isPro ? "Enviar para aluno" : "Enviar para aluno · PRO"}
                      >
                        {isPro ? <Stethoscope size={14} /> : <Lock size={13} />}
                      </button>

                      <button
                        className="btn-ghost rounded-lg p-2"
                        onClick={() => {
                          setEditingTemplate(template);
                          setShowForm(true);
                        }}
                        title="Editar treino"
                      >
                        <Pencil size={14} />
                      </button>

                      <button
                        className="btn-ghost rounded-lg p-2"
                        onClick={() => {
                          if (!isPro && templates.length >= PRO_LIMITS.workouts) {
                            onUpgrade("workouts");
                            return;
                          }

                          setEditingTemplate({
                            __copyMode: true,
                            name: `${template.name} - Cópia`,
                            scheduleDays: template.scheduleDays || [],
                            exercises: template.exercises.map((exercise) => ({
                              ...exercise,
                              id: uid(),
                            })),
                          });
                          setShowForm(true);
                        }}
                        title="Copiar treino"
                      >
                        <Copy size={14} />
                      </button>

                      <button
                        className="btn-ghost rounded-lg p-2"
                        onClick={() => deleteTemplate(template.id)}
                        title="Excluir treino"
                      >
                        <Trash2 size={14} />
                      </button>

                      <button
                        className="btn-primary rounded-lg px-3 py-1.5 text-xs"
                        onClick={() => openTodaySession(template)}
                      >
                        {doneToday ? "Visualizar" : "Iniciar"}
                      </button>
                    </div>
                  </div>

                  {expandedTemplateId === template.id && (
                    <div className="workout-template-exercises fade-in mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-[9px] text-faint uppercase tracking-widest">Exercícios cadastrados</p>
                        <span className="chip">{template.exercises.length}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {template.exercises.map((exercise, exerciseIndex) => (
                          <div key={exercise.id} className="workout-template-exercise-row surface-2 rounded-xl p-3 flex items-center gap-3 min-w-0">
                            <span className="font-mono text-[9px] text-brass shrink-0">{String(exerciseIndex + 1).padStart(2, "0")}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs md:text-sm font-medium break-words">{exercise.name}</p>
                              <p className="text-[9px] text-faint mt-1">
                                {exercise.sets} séries · {exercise.reps || "repetições livres"}
                                {Number(exercise.load || 0) > 0 ? ` · ${exercise.load} kg` : ""}
                              </p>
                            </div>
                            <span className="chip text-[8px] shrink-0">
                              {exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {section === "evolution" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest">Frequência muscular · 7 dias</p>
              {muscleWeekGrid.length > 0 ? (
                <div className="habit-grid-scroll mt-3">
                  <table className="habit-grid-table">
                    <thead>
                      <tr>
                        <th className="habit-grid-name-col text-left" />
                        {muscleWeekDays.map((date) => (
                          <th key={date} className={`habit-grid-day-head font-mono ${date === t ? "habit-grid-today" : ""}`}>
                            {WEEKDAYS[weekdayIndex(date)][0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {muscleWeekGrid.map((row) => (
                        <tr key={row.label}>
                          <td className="habit-grid-name-col"><span className="text-xs font-medium">{row.label}</span></td>
                          {row.cells.map((done, index) => (
                            <td key={index} className={`habit-grid-cell-wrap ${muscleWeekDays[index] === t ? "habit-grid-today" : ""}`}>
                              <div
                                className="habit-grid-cell"
                                title={done ? `${row.label} treinado` : "Não treinado"}
                                style={{
                                  background: done ? "var(--moss)" : "var(--surface-2)",
                                  border: done ? "1px solid var(--moss)" : "1px solid var(--border)",
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-dim text-xs mt-3">Conclua treinos para visualizar sua frequência.</p>
              )}
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest">Recordes de carga</p>
              <div className="flex flex-col gap-2 mt-3">
                {records.length > 0 ? (
                  records.map((record, index) => (
                    <div key={`${record.name}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate">{record.name}</span>
                      <span className="text-right shrink-0">
                        <span className="font-mono text-brass block">{record.load} kg</span>
                        {record.oneRepMax > 0 && (
                          <span className="font-mono text-faint text-[9px] block">~{record.oneRepMax} kg 1RM est.</span>
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-dim text-xs">Registre cargas para criar seus recordes.</p>
                )}
              </div>
            </div>
          </div>

          {progressOptions.length > 0 && (
            isPro ? (
              <div className="surface glass-panel rounded-2xl p-4 md:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div>
                    <p className="text-xs text-faint uppercase tracking-widest">Progressão de carga</p>
                    <p className="text-dim text-xs mt-1">Evolução simples do exercício selecionado.</p>
                  </div>

                  <select
                    className="p-2 rounded-xl text-xs ring-focus max-w-full"
                    value={effectiveProgressKey}
                    onChange={(event) => setProgressExerciseKey(event.target.value)}
                  >
                    {progressOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </div>

                {loadProgressRows.length >= 2 ? (
                  <MiniLineChart data={loadProgressRows} height={145} />
                ) : (
                  <div className="surface-2 rounded-xl p-4 text-dim text-xs">
                    Registre a carga em pelo menos dois treinos concluídos.
                  </div>
                )}
              </div>
            ) : (
              <ProLockCard
                feature="history"
                title="Progressão de carga"
                description="O registro básico continua gratuito. Gráficos e histórico completo ficam no PRO."
                onUpgrade={onUpgrade}
              />
            )
          )}

          {isPro ? (
            <div className="training-intelligence surface rounded-2xl p-4 md:p-5">
              <div className="flex items-center gap-2 mb-3">
                <BrainCircuit size={16} className="text-brass" />
                <div>
                  <p className="text-xs text-faint uppercase tracking-widest">Training Intelligence</p>
                  <p className="text-dim text-xs mt-1">Leituras simples geradas pelos seus próprios registros.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {trainingInsights.map((insight, index) => (
                  <div key={index} className="surface-2 rounded-xl p-3 text-xs leading-relaxed">
                    <span className="font-mono text-[9px] text-brass mr-1.5">0{index + 1}</span>
                    {insight}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <ProLockCard
              feature="intelligence"
              title="Training Intelligence"
              description="O PRO identifica evolução, estagnação e mudança de volume com base nos treinos registrados."
              onUpgrade={onUpgrade}
            />
          )}

          <div>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
              <div>
                <p className="text-xs text-faint uppercase tracking-widest">Histórico de treinos</p>
                <p className="text-dim text-xs mt-1">
                  Selecione um período para revisar os treinos que você já realizou.
                </p>
              </div>
              <span className="chip shrink-0">
                {filteredCompletedHistory.length} concluído{filteredCompletedHistory.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="workout-history-filter surface rounded-2xl p-3 md:p-4 mb-3">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={14} className="text-brass shrink-0" />
                    <p className="text-[10px] text-faint uppercase tracking-widest">Período</p>
                  </div>
                  <p className="text-xs text-dim mt-1">{historyPeriodRange.label}</p>
                </div>

                <div className="workout-history-periods flex gap-1.5 overflow-x-auto scrollbar-none pb-1 lg:pb-0">
                  {[
                    ["7d", "7 dias", false],
                    ["30d", "30 dias", false],
                    ["90d", "90 dias", true],
                    ["year", "Este ano", true],
                    ["all", "Tudo", true],
                    ["custom", "Personalizado", false],
                  ].map(([id, label, proOnly]) => {
                    const locked = !isPro && proOnly;
                    const selected = historyPeriod === id;

                    return (
                      <button
                        key={id}
                        type="button"
                        className="workout-history-period-button rounded-xl px-3 py-2 text-[10px] md:text-xs whitespace-nowrap flex items-center justify-center gap-1.5"
                        onClick={() => selectHistoryPeriod(id)}
                        style={{
                          border: `1px solid ${selected ? "var(--brass)" : "var(--border)"}`,
                          background: selected
                            ? "color-mix(in srgb, var(--brass) 8%, var(--surface-2))"
                            : "var(--surface-2)",
                          color: selected ? "var(--brass)" : "var(--text-dim)",
                        }}
                      >
                        {locked && <Lock size={10} />}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {historyPeriod === "custom" && (
                <div className="workout-history-custom grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                  <Field label="De">
                    <input
                      type="date"
                      className="w-full p-2.5 ring-focus"
                      min={isPro ? undefined : historyCutoff}
                      max={historyCustomEnd || t}
                      value={historyCustomStart}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) return;
                        const safe = !isPro && next < historyCutoff ? historyCutoff : next;
                        setHistoryCustomStart(safe);
                        if (historyCustomEnd && safe > historyCustomEnd) setHistoryCustomEnd(safe);
                      }}
                    />
                  </Field>

                  <Field label="Até">
                    <input
                      type="date"
                      className="w-full p-2.5 ring-focus"
                      min={historyCustomStart || (isPro ? undefined : historyCutoff)}
                      max={t}
                      value={historyCustomEnd}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) return;
                        setHistoryCustomEnd(next > t ? t : next);
                      }}
                    />
                  </Field>
                </div>
              )}

              <div className="workout-history-period-summary grid grid-cols-3 gap-2 mt-3">
                <div className="surface-2 rounded-xl p-2.5 md:p-3 min-w-0">
                  <p className="text-[8px] md:text-[9px] text-faint uppercase tracking-widest">Treinos</p>
                  <p className="font-display text-lg md:text-xl mt-1">{filteredCompletedHistory.length}</p>
                </div>
                <div className="surface-2 rounded-xl p-2.5 md:p-3 min-w-0">
                  <p className="text-[8px] md:text-[9px] text-faint uppercase tracking-widest">Volume</p>
                  <p className="font-display text-sm md:text-base mt-1 break-words">
                    {filteredHistoryVolume > 0
                      ? `${Math.round(filteredHistoryVolume).toLocaleString("pt-BR")} kg`
                      : "—"}
                  </p>
                </div>
                <div className="surface-2 rounded-xl p-2.5 md:p-3 min-w-0">
                  <p className="text-[8px] md:text-[9px] text-faint uppercase tracking-widest">Tempo</p>
                  <p className="font-display text-sm md:text-base mt-1">
                    {filteredHistoryMinutes > 0
                      ? filteredHistoryMinutes >= 60
                        ? `${Math.floor(filteredHistoryMinutes / 60)}h ${filteredHistoryMinutes % 60}min`
                        : `${filteredHistoryMinutes} min`
                      : "—"}
                  </p>
                </div>
              </div>

              {!isPro && (
                <p className="text-[9px] text-faint mt-2">
                  No Free, o histórico disponível permanece limitado aos últimos 30 dias.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredHistory.length === 0 && (
                <div className="surface rounded-2xl p-5 text-dim text-sm md:col-span-2 text-center">
                  {history.length === 0
                    ? "Seu histórico aparecerá aqui depois do primeiro treino."
                    : "Nenhum treino encontrado no período selecionado."}
                </div>
              )}

              {filteredHistory.map((session) => {
                const template = templates.find((item) => item.id === session.templateId);
                const totalSets = workoutTotalSetsCount(template);
                const doneSets = workoutDoneSetsCount(session);
                const completionPct =
                  totalSets > 0
                    ? Math.min(100, Math.round(doneSets / totalSets * 100))
                    : session.completed ? 100 : 0;
                const volume = workoutSessionVolume(session, template);
                const duration = workoutSessionDurationMinutes(session, template);

                return (
                  <button
                    key={session.id}
                    type="button"
                    className="workout-history-card surface rounded-2xl p-4 text-left w-full"
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setActiveTemplateId(session.templateId);
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          background: session.completed
                            ? "color-mix(in srgb, var(--moss) 16%, var(--surface-2))"
                            : "var(--surface-2)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {session.completed
                          ? <CheckCircle2 size={18} className="text-moss" />
                          : <Dumbbell size={17} className="text-faint" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-display text-base break-words">{template?.name || "Treino"}</p>
                          <span className={`chip whitespace-nowrap ${session.completed ? "text-moss" : "text-brass"}`}>
                            {session.completed ? "Concluído" : "Em andamento"}
                          </span>
                        </div>

                        <p className="text-[10px] text-faint mt-1">
                          {dateLabel(session.date, { weekday: "short", day: "2-digit", month: "short" })}
                        </p>

                        <div className="mt-3">
                          <div className="flex items-center justify-between text-[10px] mb-1.5">
                            <span className="text-faint">Séries</span>
                            <span className="font-mono">{doneSets}/{totalSets}</span>
                          </div>
                          <Progress value={session.completed ? 100 : completionPct} height={5} />
                        </div>

                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {volume > 0 && <span className="chip">Volume {Math.round(volume).toLocaleString("pt-BR")} kg</span>}
                          {duration > 0 && <span className="chip">{duration} min</span>}
                          {session.effortRating && <span className="chip">Esforço {session.effortRating}/10</span>}
                          {session.completed && <span className="chip text-moss">Visualizar treino feito</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {hiddenHistoryCount > 0 && (
              <div className="mt-3">
                <ProLockCard
                  feature="history"
                  title={`${hiddenHistoryCount} sessão${hiddenHistoryCount === 1 ? "" : "ões"} anterior${hiddenHistoryCount === 1 ? "" : "es"} protegida${hiddenHistoryCount === 1 ? "" : "s"}`}
                  description="Seus dados continuam salvos. O PRO libera todo o histórico."
                  onUpgrade={onUpgrade}
                  compact
                />
              </div>
            )}
          </div>
        </>
      )}

      {activeTemplate && activeSession && (
        <Modal
          title={activeTemplate.name}
          onClose={() => {
            setActiveTemplateId(null);
            setActiveSessionId(null);
          }}
          width={700}
        >
          <div className="workout-focus-mode flex flex-col gap-3">
            <div className="workout-focus-summary surface-2 rounded-2xl p-3">
              {workoutInProgress && (
                <div className="workout-live-clock flex items-center justify-between gap-3 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="workout-live-clock-dot" aria-hidden="true" />
                    <p className="text-[9px] text-faint uppercase tracking-widest">Cronômetro do treino</p>
                  </div>
                  <p className="font-mono text-xl md:text-2xl text-brass">{formatWorkoutClock(workoutElapsedSeconds)}</p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] text-faint uppercase tracking-widest">Séries</p>
                  <p className="font-mono text-sm mt-1">
                    {sessionSummary?.doneSets || 0}/{sessionSummary?.totalSets || 0}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-faint uppercase tracking-widest">Volume</p>
                  <p className="font-mono text-sm mt-1">
                    {Math.round(sessionSummary?.volume || 0).toLocaleString("pt-BR")} kg
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-faint uppercase tracking-widest">Descanso</p>
                  <p className={`font-mono text-sm mt-1 ${restTimer.running ? "text-brass" : ""}`}>
                    {restTimer.running ? formatTimer(restTimer.remaining) : "—"}
                  </p>
                </div>
              </div>

              {restTimer.running && (
                <div className="workout-rest-active mt-3 pt-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Descansando</p>
                    <p className="font-mono text-2xl text-brass">{formatTimer(restTimer.remaining)}</p>
                  </div>
                  <Progress
                    value={restTimer.total > 0 ? (restTimer.remaining / restTimer.total) * 100 : 0}
                    height={4}
                  />
                  <div className="flex items-center justify-between gap-2 mt-2.5">
                    <div className="flex gap-1.5">
                      <button className="chip" onClick={() => onAdjustRest(-15)}>-15s</button>
                      <button className="chip" onClick={() => onAdjustRest(15)}>+15s</button>
                    </div>
                    <button
                      className="text-[10px] text-faint"
                      onClick={onCancelRest}
                    >
                      Pular
                    </button>
                  </div>
                </div>
              )}
            </div>

            {activeSession.completed && (
              <div className="workout-complete-summary surface rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-moss">
                      <CheckCircle2 size={17} />
                      <p className="text-sm font-medium">Treino concluído</p>
                    </div>
                    <p className="text-dim text-xs mt-1">
                      {sessionSummary?.doneSets || 0} séries · {Math.round(sessionSummary?.volume || 0).toLocaleString("pt-BR")} kg de volume
                      {sessionSummary?.duration ? ` · ${sessionSummary.duration} min` : ""}
                    </p>
                  </div>
                  {sessionPrs.length > 0 && <span className="chip text-brass">{sessionPrs.length} PR</span>}
                </div>

                {previousSessionVolume > 0 && sessionSummary?.volume > 0 && (
                  <p className="text-xs text-dim mt-3">
                    Vs. treino anterior:{" "}
                    <span className={sessionSummary.volume >= previousSessionVolume ? "text-moss" : "text-ember"}>
                      {sessionSummary.volume >= previousSessionVolume ? "+" : ""}
                      {Math.round(((sessionSummary.volume - previousSessionVolume) / previousSessionVolume) * 100)}% de volume
                    </span>
                  </p>
                )}

                {sessionPrs.length > 0 && (
                  <p className="text-xs text-brass mt-2">
                    Novo recorde: {sessionPrs.slice(0, 3).map((exercise) => exercise.name).join(", ")}.
                  </p>
                )}
              </div>
            )}

            {activeTemplate.exercises.map((exercise, exerciseIndex) => {
              const displayName =
                activeSession.exerciseOverrides?.[exercise.id] ||
                exercise.name;

              const previousLoad = workoutPreviousExerciseLoad(
                sessions,
                activeTemplate.id,
                exercise.id,
                activeSession.date
              );
              const currentLoad = Number(
                activeSession.loads?.[exercise.id] ??
                exercise.load ??
                0
              );

              const previousMax = workoutHistoricalMaxLoad(
                sessions,
                activeTemplate.id,
                exercise.id,
                activeSession.date
              );

              const completedSets = (activeSession.sets?.[exercise.id] || []).filter(Boolean).length;
              const isPr = completedSets > 0 && currentLoad > 0 && currentLoad > previousMax;

              const lastTwo = [...sessions]
                .filter((session) =>
                  session.completed &&
                  session.templateId === activeTemplate.id &&
                  session.date < activeSession.date &&
                  Number(session.loads?.[exercise.id] || 0) > 0
                )
                .sort((a, b) => String(b.date).localeCompare(String(a.date)))
                .slice(0, 2);

              const canSuggestProgression =
                lastTwo.length === 2 &&
                Number(lastTwo[0].loads?.[exercise.id]) === Number(lastTwo[1].loads?.[exercise.id]) &&
                Number(lastTwo[0].loads?.[exercise.id]) > 0;

              return (
                <div key={exercise.id} className="workout-focus-exercise surface-2 rounded-2xl p-3 md:p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-start gap-2 text-left min-w-0">
                      <button
                        type="button"
                        className="shrink-0 mt-0.5 disabled:cursor-default"
                        disabled={activeSession.completed}
                        onClick={() => toggleExercise(activeSession.id, exercise.id, exercise.sets)}
                        aria-label={`Marcar ${displayName} como concluído`}
                      >
                        {(activeSession.sets?.[exercise.id] || []).length === exercise.sets &&
                        (activeSession.sets?.[exercise.id] || []).every(Boolean)
                          ? <CheckCircle2 size={18} className="text-moss" />
                          : <Circle size={18} className="text-faint" />}
                      </button>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="workout-exercise-guide-trigger text-sm font-medium break-words text-left inline-flex items-center gap-1.5"
                            onClick={() => {
                              const libraryGuide = exerciseLibrary.find((item) =>
                                normalizeWorkoutExerciseName(item.name) === normalizeWorkoutExerciseName(exercise.name)
                              );
                              setExerciseGuide({
                                name: displayName,
                                muscleGroup: exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name),
                                videoUrl: String(exercise.videoUrl || libraryGuide?.videoUrl || ""),
                              });
                            }}
                            title="Ver vídeo explicativo"
                          >
                            <span>{displayName}</span>
                            <Play size={11} className="text-brass shrink-0" fill="currentColor" />
                          </button>
                          {isPr && <span className="chip text-brass">PR</span>}
                          {exercise.favorite && <Star size={11} className="text-brass" fill="currentColor" />}
                        </div>
                        <p className="text-[10px] text-faint mt-0.5">
                          {exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name)} · {exercise.sets}× {exercise.reps}
                        </p>
                      </div>
                    </div>

                    {!activeSession.completed && (
                      <button
                        className="btn-ghost rounded-lg px-2 py-1 text-[10px] flex items-center gap-1 shrink-0"
                        onClick={async () => {
                          const nextName = await promptFor(
                            "Substituir apenas neste treino por:",
                            displayName
                          );
                          if (!nextName?.trim()) return;
                          updateSession(activeSession.id, (session) => ({
                            ...session,
                            exerciseOverrides: {
                              ...(session.exerciseOverrides || {}),
                              [exercise.id]: nextName.trim(),
                            },
                          }));
                        }}
                      >
                        <ArrowRightLeft size={11} /> Trocar
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <label className="text-[9px] text-faint uppercase tracking-widest">Carga atual</label>
                      <WorkoutLoadInput
                        value={activeSession.loads?.[exercise.id] ?? exercise.load ?? ""}
                        disabled={activeSession.completed}
                        onCommit={(value) =>
                          updateLoad(activeSession.id, exercise.id, value)
                        }
                      />
                    </div>

                    <div className="workout-previous-load surface rounded-xl p-2">
                      <p className="text-[9px] text-faint uppercase tracking-widest">Treino anterior</p>
                      <p className="font-mono text-sm mt-1">
                        {previousLoad != null
                          ? `${previousLoad} kg`
                          : exercise.load
                            ? `${exercise.load} kg`
                            : "—"}
                      </p>
                      {previousLoad != null && currentLoad > 0 && (
                        <p className={`text-[9px] mt-0.5 ${
                          currentLoad > Number(previousLoad)
                            ? "text-moss"
                            : currentLoad < Number(previousLoad)
                              ? "text-ember"
                              : "text-faint"
                        }`}>
                          {currentLoad === Number(previousLoad)
                            ? "mesma carga"
                            : `${currentLoad > Number(previousLoad) ? "+" : ""}${Math.round(((currentLoad - Number(previousLoad)) / Math.max(1, Number(previousLoad))) * 100)}%`}
                        </p>
                      )}
                    </div>
                  </div>

                  {canSuggestProgression && !activeSession.completed && (
                    <div className="workout-simple-suggestion rounded-xl px-3 py-2 mb-3 text-[10px] text-dim">
                      <Sparkles size={11} className="text-brass inline mr-1" />
                      Mesma carga nos 2 últimos treinos. Se estiver confortável, teste +2,5 kg.
                    </div>
                  )}

                  <div className="flex gap-1.5 flex-wrap">
                    {Array.from({ length: exercise.sets }).map((_, setIndex) => {
                      const on = activeSession.sets?.[exercise.id]?.[setIndex];
                      const repsValue = activeSession.repsDone?.[exercise.id]?.[setIndex];

                      return (
                        <div key={setIndex} className="flex flex-col items-center gap-1">
                          <button
                            disabled={activeSession.completed}
                            onClick={() => {
                              toggleSet(activeSession.id, exercise.id, setIndex, exercise.sets);
                              if (!on) {
                                onStartRest(exercise.restSeconds || 90, {
                                  sessionId: activeSession.id,
                                  templateId: activeTemplate.id,
                                  exerciseId: exercise.id,
                                  exerciseName: displayName,
                                });
                              }
                            }}
                            className="workout-set-button w-10 h-10 rounded-lg text-xs font-mono disabled:cursor-default"
                            style={{
                              background: on ? "var(--moss)" : "transparent",
                              border: "1px solid var(--border)",
                              color: on ? "#0A0D08" : "var(--text-dim)",
                            }}
                          >
                            {setIndex + 1}
                          </button>
                          {on && (
                            <WorkoutRepsInput
                              value={repsValue}
                              disabled={activeSession.completed}
                              onCommit={(value) =>
                                updateReps(activeSession.id, exercise.id, setIndex, value)
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <WorkoutNoteInput
                    className="w-full p-2 mt-3 text-xs ring-focus"
                    placeholder="Observação deste exercício (opcional)"
                    value={activeSession.exerciseNotes?.[exercise.id] || ""}
                    disabled={activeSession.completed}
                    onCommit={(text) =>
                      updateSession(activeSession.id, (session) => ({
                        ...session,
                        exerciseNotes: {
                          ...(session.exerciseNotes || {}),
                          [exercise.id]: text,
                        },
                      }))
                    }
                  />
                </div>
              );
            })}

            <div className="surface-2 rounded-xl p-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Esforço percebido</p>
                  <p className="text-dim text-[10px] mt-0.5">Opcional. Ajuda a lembrar como o treino realmente pareceu.</p>
                </div>

                <select
                  className="p-2 text-xs ring-focus sm:w-[180px]"
                  value={activeSession.effortRating || ""}
                  disabled={activeSession.completed}
                  onChange={(event) =>
                    updateSession(activeSession.id, {
                      effortRating: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                >
                  <option value="">Não informar</option>
                  <option value="5">5 · Leve</option>
                  <option value="6">6 · Moderado</option>
                  <option value="7">7 · Bom</option>
                  <option value="8">8 · Difícil</option>
                  <option value="9">9 · Muito difícil</option>
                  <option value="10">10 · Máximo</option>
                </select>
              </div>
            </div>

            {activeSession.completed ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  className="btn-ghost rounded-xl py-2.5 text-sm"
                  onClick={() => {
                    setActiveTemplateId(null);
                    setActiveSessionId(null);
                  }}
                >
                  Fechar
                </button>

                <button
                  className="btn-ghost rounded-xl py-2.5 text-sm text-brass flex items-center justify-center gap-2"
                  onClick={() => undoCompleteSession(activeSession.id)}
                >
                  <RotateCcw size={14} /> Desfazer conclusão
                </button>
              </div>
            ) : (
              <button
                className="btn-primary w-full rounded-xl py-3"
                onClick={() => {
                  completeSession(activeSession.id);
                  onCancelRest();
                }}
              >
                Concluir treino
              </button>
            )}
          </div>
        </Modal>
      )}

      {prescribeTemplate && (
        <Modal title="Enviar treino para aluno" onClose={() => setPrescribeTemplate(null)} width={520}>
          <p className="text-dim text-xs mb-3">Prescrevendo <strong>{prescribeTemplate.name}</strong>.</p>

          {prescribeClients.length === 0 ? (
            <p className="text-faint text-xs">
              Nenhum aluno vinculado ainda. Convide alguém na tela "Personal & Nutri" e espere a pessoa aceitar.
            </p>
          ) : (
            <>
              <Field label="Aluno">
                <select
                  className="w-full p-3 ring-focus"
                  value={prescribeClientId}
                  onChange={(event) => setPrescribeClientId(event.target.value)}
                >
                  <option value="">Selecione…</option>
                  {prescribeClients.map((client) => (
                    <option key={client.link_id} value={client.link_id}>
                      {client.display_name || client.email}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Nota para o aluno (opcional)">
                <textarea
                  rows={3}
                  className="w-full p-3 ring-focus resize-none"
                  placeholder="Ex: reduzi a carga do supino por causa do ombro."
                  value={prescribeNote}
                  onChange={(event) => setPrescribeNote(event.target.value)}
                />
              </Field>

              {prescribeNotice && (
                <p className={`text-xs mb-3 ${prescribeNotice.type === "error" ? "text-ember" : "text-moss"}`}>
                  {prescribeNotice.text}
                </p>
              )}

              <button
                disabled={!prescribeClientId || prescribeLoading}
                className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
                onClick={confirmPrescribeWorkout}
              >
                {prescribeLoading ? "Enviando…" : "Enviar treino"}
              </button>
            </>
          )}
        </Modal>
      )}

      {showImportWorkout && (
        <Modal title="Receber treino de um amigo" onClose={() => setShowImportWorkout(false)} width={520}>
          <Field label="Link ou código compartilhado">
            <textarea
              rows={3}
              className="w-full p-3 ring-focus resize-none"
              placeholder="Cole aqui o link recebido."
              value={importWorkoutValue}
              onChange={(event) => setImportWorkoutValue(event.target.value)}
            />
          </Field>

          {importWorkoutValue && !sharedWorkoutPreview && (
            <div className="surface-2 rounded-xl p-3 text-xs text-ember mb-3">
              Este link/código não contém um treino válido do Constancce.
            </div>
          )}

          {sharedWorkoutPreview && (
            <div className="surface-2 rounded-2xl p-4 mb-3">
              <p className="text-[10px] text-faint uppercase tracking-widest">Prévia</p>
              <p className="font-display text-xl mt-1 break-words">{sharedWorkoutPreview.name}</p>
              <p className="text-dim text-xs mt-1">{sharedWorkoutPreview.exercises.length} exercícios</p>

              <div className="flex flex-col gap-1.5 mt-3">
                {sharedWorkoutPreview.exercises.slice(0, 6).map((exercise, index) => (
                  <div key={index} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate">{exercise.name}</span>
                    <span className="font-mono text-faint shrink-0">{exercise.sets}× {exercise.reps}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            disabled={!sharedWorkoutPreview}
            className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
            onClick={importSharedWorkout}
          >
            Adicionar treino à minha conta
          </button>
        </Modal>
      )}

      {selectedHistoryDate && (
        <Modal
          title={`Treino · ${dateLabel(selectedHistoryDate, { day: "2-digit", month: "2-digit", year: "numeric" })}`}
          onClose={() => setSelectedHistoryDate(null)}
          width={620}
        >
          <div className="workout-day-history flex flex-col gap-3">
            <div className="surface-2 rounded-xl p-3">
              <p className="text-[9px] text-faint uppercase tracking-widest">Mini histórico</p>
              <p className="text-sm mt-1">{dateLabel(selectedHistoryDate, { weekday: "long", day: "2-digit", month: "long" })}</p>
            </div>

            {selectedHistorySessions.length > 0 ? (
              selectedHistorySessions.map((session) => {
                const template = templates.find((item) => item.id === session.templateId);
                if (!template) return null;
                const doneSets = workoutDoneSetsCount(session);
                const totalSets = workoutTotalSetsCount(template);

                return (
                  <div key={session.id} className="surface rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-lg">{template.name}</p>
                        <p className="text-[10px] text-faint mt-1">
                          {doneSets}/{totalSets} séries · {Math.round(workoutSessionVolume(session, template)).toLocaleString("pt-BR")} kg de volume
                        </p>
                      </div>
                      <span className={`chip ${session.completed ? "text-moss" : "text-brass"}`}>
                        {session.completed ? "Concluído" : "Parcial"}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2 mt-3">
                      {template.exercises.map((exercise) => {
                        const rows = session.sets?.[exercise.id] || [];
                        const completed = rows.filter(Boolean).length;
                        const load = session.loads?.[exercise.id] ?? exercise.load ?? "";
                        const displayName = session.exerciseOverrides?.[exercise.id] || exercise.name;

                        return (
                          <div key={exercise.id} className="surface-2 rounded-xl px-3 py-2 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-medium break-words">{displayName}</p>
                              <p className="text-[9px] text-faint mt-0.5">{completed}/{exercise.sets} séries concluídas</p>
                            </div>
                            <span className="font-mono text-xs shrink-0">
                              {load !== "" && load != null && Number(load) > 0 ? `${Number(load)} kg` : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            ) : selectedHistoryPlannedTemplates.length > 0 ? (
              <div className="surface rounded-2xl p-4">
                <p className="text-sm font-medium">Treino programado, mas sem execução registrada.</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {selectedHistoryPlannedTemplates.map((template) => (
                    <span key={template.id} className="chip">{template.name}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="surface rounded-2xl p-4 text-center">
                <p className="text-sm">Nenhum treino registrado neste dia.</p>
                <p className="text-[10px] text-faint mt-1">O histórico aparece automaticamente quando houver uma sessão.</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {exerciseGuide && (
        <Modal
          title={exerciseGuide.name}
          onClose={() => setExerciseGuide(null)}
          width={640}
        >
          <div className="workout-exercise-guide flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[9px] text-faint uppercase tracking-widest">Execução do exercício</p>
                <p className="text-xs text-dim mt-1">{exerciseGuide.muscleGroup}</p>
              </div>
              <span className="chip"><Play size={10} fill="currentColor" /> vídeo</span>
            </div>

            {exerciseGuideVideo?.type === "embed" ? (
              <div className="workout-guide-video-frame">
                <iframe
                  src={exerciseGuideVideo.src}
                  title={`Como executar ${exerciseGuide.name}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            ) : exerciseGuideVideo?.type === "video" ? (
              <div className="workout-guide-video-frame">
                <video
                  src={exerciseGuideVideo.src}
                  controls
                  playsInline
                  preload="metadata"
                />
              </div>
            ) : (
              <div className="surface-2 rounded-2xl p-5 text-center">
                <Play size={26} className="text-faint mx-auto" />
                <p className="text-sm mt-3">Vídeo explicativo ainda não cadastrado.</p>
                <p className="text-[10px] text-faint mt-1">
                  Edite o treino e cole o link do vídeo neste exercício. YouTube, Vimeo e arquivos MP4 são aceitos.
                </p>
              </div>
            )}

            <p className="text-[10px] text-faint">
              O vídeo só é carregado quando você toca no nome do exercício, evitando consumo desnecessário de internet durante o treino.
            </p>
          </div>
        </Modal>
      )}

      {showForm && (
        <WorkoutTemplateForm
          initial={editingTemplate}
          exerciseLibrary={exerciseLibrary}
          onClose={() => {
            setShowForm(false);
            setEditingTemplate(null);
          }}
          onSave={(template) => {
            const saved = saveTemplate(template);
            if (saved === false) return;
            setShowForm(false);
            setEditingTemplate(null);
          }}
        />
      )}
      {promptDialog}
    </div>
  );
}

/* ---------------------------------------------------------------
   FOOD
----------------------------------------------------------------*/
function BarcodeScannerModal({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState("Abrindo câmera…");
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks?.().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const start = async () => {
      try {
        if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
          setSupported(false);
          setStatus("Leitura automática não disponível neste navegador.");
          return;
        }

        const formats = typeof window.BarcodeDetector.getSupportedFormats === "function"
          ? await window.BarcodeDetector.getSupportedFormats().catch(() => [])
          : [];
        const desired = ["ean_13", "ean_8", "upc_a", "upc_e"];
        const usable = formats?.length ? desired.filter((item) => formats.includes(item)) : desired;
        const detector = new window.BarcodeDetector({ formats: usable.length ? usable : desired });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus("Aponte a câmera para o código de barras.");

        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = String(codes?.[0]?.rawValue || "").trim();
            if (value) {
              stop();
              onDetected(value);
            }
          } catch (_) {}
        }, 550);
      } catch (_) {
        setStatus("Não foi possível acessar a câmera. Digite o código manualmente.");
      }
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [onDetected]);

  return (
    <Modal title="Escanear código de barras" onClose={onClose} width={460}>
      <div className="diet-barcode-camera surface-2 rounded-2xl overflow-hidden">
        {supported ? (
          <video ref={videoRef} muted playsInline className="w-full block" style={{ minHeight: 220, objectFit: "cover" }} />
        ) : (
          <div className="min-h-[220px] flex items-center justify-center p-5 text-center text-dim text-sm">
            Seu navegador não possui leitor de código de barras integrado.
          </div>
        )}
      </div>
      <p className="text-xs text-dim mt-3 text-center">{status}</p>
    </Modal>
  );
}

const DIET_MONTH_METRICS = [
  { id: "calories", label: "Calorias", unit: "kcal" },
  { id: "protein", label: "Proteína", unit: "g" },
  { id: "carbs", label: "Carboidratos", unit: "g" },
  { id: "fat", label: "Gordura", unit: "g" },
];

function NutritionIntelligencePanel({ mealLog, profile, isPro, onUpgrade }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [monthMetric, setMonthMetric] = useState("calories");

  if (!isPro) {
    return (
      <ProLockCard
        feature="diet"
        title="Nutrition Intelligence"
        description="O PRO analisa sua média calórica, proteína, distribuição das refeições, alimentos mais frequentes e aderência aos macros."
        onUpgrade={onUpgrade}
      />
    );
  }

  const dates = Array.from({ length: 7 }, (_, index) => addDays(today(), index - 6));
  const rows = dates.map((date) => ({ date, ...dietDailyTotals(mealLog, date) }));
  const loggedRows = rows.filter((row) => row.calories > 0);

  const currentMonthKey = monthKey(today());
  const daysElapsedInMonth = new Date().getDate();
  const monthDates = Array.from({ length: daysElapsedInMonth }, (_, index) => `${currentMonthKey}-${String(index + 1).padStart(2, "0")}`);
  const monthRows = monthDates.map((date) => ({ date, ...dietDailyTotals(mealLog, date) }));
  const hasMonthData = monthRows.some((row) => row.calories > 0);
  const monthChartData = monthRows.map((row) => ({
    value: row[monthMetric] || 0,
    label: String(Number(row.date.slice(-2))),
  }));
  const loggedDays = Math.max(1, loggedRows.length);
  const sum = (key) => loggedRows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const avgCalories = Math.round(sum("calories") / loggedDays);
  const proteinTotal = Math.round(sum("protein") * 10) / 10;
  const proteinTarget = Math.max(1, Number(profile?.proteinTarget || 150));
  const carbTarget = Math.max(1, Number(profile?.carbTarget || 250));
  const fatTarget = Math.max(1, Number(profile?.fatTarget || 70));

  const proteinHitDays = loggedRows.filter((row) => row.protein >= proteinTarget * 0.9).length;
  const macroHitDays = loggedRows.filter((row) =>
    row.protein >= proteinTarget * 0.9 &&
    row.carbs >= carbTarget * 0.85 && row.carbs <= carbTarget * 1.15 &&
    row.fat >= fatTarget * 0.85 && row.fat <= fatTarget * 1.15
  ).length;

  const recentMeals = mealLog.filter((meal) => meal.date >= addDays(today(), -6) && meal.date <= today() && dietMealConsumed(meal));
  const mealCalories = MEAL_TYPES.map((mealType) => ({
    mealType,
    calories: recentMeals
      .filter((meal) => meal.mealType === mealType)
      .reduce((total, meal) => total + Number(meal.calories || 0), 0),
  })).sort((a, b) => b.calories - a.calories);
  const highestMeal = mealCalories.find((item) => item.calories > 0) || null;

  const foodCount = new Map();
  recentMeals.forEach((meal) => {
    const name = String(meal.name || "").trim();
    if (!name) return;
    foodCount.set(name, (foodCount.get(name) || 0) + 1);
  });
  const topFood = [...foodCount.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  const insights = [];
  if (loggedRows.length) {
    insights.push(`Sua média nos dias registrados foi de ${avgCalories.toLocaleString("pt-BR")} kcal.`);
    insights.push(`Você atingiu pelo menos 90% da meta de proteína em ${proteinHitDays} de ${loggedRows.length} dias registrados.`);
  }
  if (topFood) insights.push(`${topFood[0]} foi seu alimento mais frequente nos últimos 7 dias.`);
  if (!insights.length) insights.push("Registre suas refeições para o Constancce começar a identificar padrões.");

  const ask = (rawQuestion) => {
    const raw = String(rawQuestion || "").trim();
    if (!raw) return;
    const normalized = dietNormalize(raw);
    let next = "Não consigo te ajudar com essa pergunta no momento.";

    if (/(proteina.*semana|quanto.*proteina)/.test(normalized)) {
      next = `Nos últimos 7 dias você registrou ${proteinTotal.toLocaleString("pt-BR")} g de proteína.`;
    } else if (/(refeicao.*mais calor|mais calorias)/.test(normalized)) {
      next = highestMeal
        ? `${highestMeal.mealType} concentrou mais calorias nos últimos 7 dias: ${Math.round(highestMeal.calories).toLocaleString("pt-BR")} kcal no total.`
        : "Ainda não há refeições suficientes para comparar.";
    } else if (/(media.*calor|media calorica)/.test(normalized)) {
      next = loggedRows.length
        ? `Sua média foi de ${avgCalories.toLocaleString("pt-BR")} kcal por dia registrado nos últimos 7 dias.`
        : "Ainda não há dias registrados para calcular sua média calórica.";
    } else if (/(bati.*macro|macros)/.test(normalized)) {
      next = `Você ficou dentro da faixa dos três macros em ${macroHitDays} de ${loggedRows.length} dia${loggedRows.length === 1 ? "" : "s"} registrados.`;
    } else if (/(alimento.*mais|mais consumo|mais consum)/.test(normalized)) {
      next = topFood
        ? `${topFood[0]} foi o alimento mais registrado, aparecendo ${topFood[1]} vez${topFood[1] === 1 ? "" : "es"} nos últimos 7 dias.`
        : "Ainda não há alimentos suficientes para identificar o mais consumido.";
    }

    setQuestion(raw);
    setAnswer(next);
  };

  return (
    <div className="diet-intelligence surface glass-panel rounded-2xl p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit size={16} className="text-brass" />
            <p className="text-[10px] text-faint uppercase tracking-widest">Nutrition Intelligence · PRO</p>
          </div>
          <p className="font-display text-lg md:text-xl mt-1">Leitura nutricional dos últimos 7 dias</p>
          <p className="text-xs text-dim mt-1">Análise determinística baseada apenas no que você registrou.</p>
        </div>
        <span className="chip shrink-0">{loggedRows.length} dia{loggedRows.length === 1 ? "" : "s"} com dados</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
        {[
          ["Média calórica", loggedRows.length ? `${avgCalories.toLocaleString("pt-BR")} kcal` : "—"],
          ["Proteína", `${proteinTotal.toLocaleString("pt-BR")} g`],
          ["Meta de proteína", `${proteinHitDays}/${loggedRows.length || 0} dias`],
          ["Macros completos", `${macroHitDays}/${loggedRows.length || 0} dias`],
        ].map(([label, value]) => (
          <div key={label} className="surface-2 rounded-xl p-3">
            <p className="text-[8px] md:text-[9px] text-faint uppercase tracking-widest">{label}</p>
            <p className="font-display text-sm md:text-base mt-1 break-words">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[9px] text-faint uppercase tracking-widest">Evolução no mês</p>
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {DIET_MONTH_METRICS.map((metric) => (
              <button
                key={metric.id}
                className={`chip whitespace-nowrap ${monthMetric === metric.id ? "text-brass" : ""}`}
                style={monthMetric === metric.id ? { borderColor: "var(--brass-dim)", background: "var(--surface-2)" } : {}}
                onClick={() => setMonthMetric(metric.id)}
              >
                {metric.label}
              </button>
            ))}
          </div>
        </div>
        {hasMonthData ? (
          <MiniLineChart data={monthChartData} height={140} />
        ) : (
          <p className="text-dim text-xs py-4 text-center">Sem dados suficientes neste mês ainda.</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
        {insights.slice(0, 3).map((insight, index) => (
          <div key={index} className="surface-2 rounded-xl p-3">
            <span className="font-mono text-[9px] text-brass">0{index + 1}</span>
            <p className="text-[10px] md:text-xs mt-1 leading-relaxed">{insight}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-4">
        {[
          "Quanto de proteína consumi esta semana?",
          "Qual refeição tem mais calorias?",
          "Qual minha média calórica?",
          "Quantos dias bati meus macros?",
          "Qual alimento mais consumo?",
        ].map((prompt) => (
          <button key={prompt} className="chip hover:text-brass" onClick={() => ask(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <input
          className="flex-1 min-w-0 p-3 ring-focus"
          placeholder="Pergunte sobre sua alimentação..."
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") ask(question); }}
        />
        <button className="btn-primary rounded-xl px-4 py-2.5 text-sm shrink-0" onClick={() => ask(question)}>
          Perguntar
        </button>
      </div>

      {answer && (
        <div className="surface-2 rounded-xl p-3 mt-3" style={{ borderLeft: "2px solid var(--brass-dim)" }}>
          <p className="text-[9px] text-faint uppercase tracking-widest">Constancce</p>
          <p className="text-sm mt-1 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

function MealForm({
  foodBase = [],
  foods = [],
  onSave,
  onClose,
  initialFood = null,
  initialMealType = MEAL_TYPES[0],
}) {
  const library = useMemo(
    () => dietDedupFoods([...foodBase, ...foods]),
    [foodBase, foods]
  );
  const [mealType, setMealType] = useState(initialMealType || MEAL_TYPES[0]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(initialFood || null);
  const [measureIndex, setMeasureIndex] = useState(0);
  const [portionCount, setPortionCount] = useState(1);

  const results = useMemo(() => {
    const matched = library.filter((food) => dietFoodMatches(food, query));
    if (query.trim()) {
      matched.sort(
        (a, b) =>
          dietFoodSearchScore(b, query) - dietFoodSearchScore(a, query) ||
          String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );
    } else {
      matched.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
    }
    return matched.slice(0, query.trim() ? 80 : 40);
  }, [library, query]);

  const measures = selected ? dietFoodMeasureOptions(selected) : [];
  const activeMeasure = measures[measureIndex] || measures[0] || null;
  const consumedAmount = activeMeasure
    ? Math.max(0, Number(portionCount || 0)) * Number(activeMeasure.amount || 0)
    : 0;
  const calculated = selected ? dietNutrientsForAmount(selected, consumedAmount) : null;

  useEffect(() => {
    if (!selected) return;
    setMeasureIndex(0);
    setPortionCount(1);
  }, [selected ? dietFoodKey(selected) : ""]);

  const saveSelected = () => {
    if (!selected || !activeMeasure || Number(portionCount) <= 0 || !calculated) return;

    onSave({
      id: uid(),
      date: today(),
      mealType,
      name: selected.name,
      brand: selected.brand || null,
      foodKey: dietFoodKey(selected),
      source: selected.source || "catalog",
      quantity: Number(portionCount),
      unit: activeMeasure.label,
      consumedAmount,
      baseUnit: selected.unit || "g",
      consumed: false,
      consumedAt: null,
      foodSnapshot: {
        id: selected.id,
        source: selected.source || "catalog",
        sourceId: selected.sourceId || null,
        name: selected.name,
        brand: selected.brand || null,
        baseQuantity: selected.baseQuantity || 100,
        unit: selected.unit || "g",
        calories: Number(selected.calories || 0),
        protein: Number(selected.protein || 0),
        carbs: Number(selected.carbs || 0),
        fat: Number(selected.fat || 0),
        fiber: Number(selected.fiber || 0),
        sodium: Number(selected.sodium || 0),
        sugar: selected.sugarAvailable === false ? null : Number(selected.sugar || 0),
        sugarAvailable: selected.sugarAvailable !== false,
        measures: dietFoodMeasures(selected),
      },
      ...calculated,
    });
  };

  return (
    <Modal title="Adicionar alimento à dieta de hoje" onClose={onClose} width={680}>
      <div className="surface-2 rounded-xl p-3 mb-3 text-[10px] text-dim">
        Escolha um alimento da base, ajuste a porção e adicione. Proteínas, carboidratos e gorduras são calculados automaticamente.
      </div>

      <Field label="Refeição">
        <select className="w-full p-3 ring-focus" value={mealType} onChange={(event) => setMealType(event.target.value)}>
          {MEAL_TYPES.map((meal) => <option key={meal}>{meal}</option>)}
        </select>
      </Field>

      {!initialFood && (
        <>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              autoFocus
              className="w-full pl-9 pr-3 py-3 ring-focus"
              placeholder="Buscar arroz, frango, banana, ovo..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

        <div className="flex flex-col gap-2 max-h-[330px] overflow-y-auto scrollbar-none">
          {results.map((food) => (
            <button
              key={dietFoodKey(food)}
              type="button"
              className={`diet-food-result surface-2 rounded-xl p-3 text-left ${selected && dietFoodKey(selected) === dietFoodKey(food) ? "is-selected" : ""}`}
              onClick={() => setSelected(food)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">{food.name}</p>
                  <p className="text-[9px] text-faint mt-1">Referência: {food.baseQuantity || 100}{food.unit || "g"} · {Math.round(Number(food.calories || 0))} kcal</p>
                </div>
                <span className="text-[9px] text-brass shrink-0">Selecionar</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                <span className="chip justify-center text-[9px]">P {Math.round(Number(food.protein || 0) * 10) / 10}g</span>
                <span className="chip justify-center text-[9px]">C {Math.round(Number(food.carbs || 0) * 10) / 10}g</span>
                <span className="chip justify-center text-[9px]">G {Math.round(Number(food.fat || 0) * 10) / 10}g</span>
              </div>
            </button>
          ))}
          {results.length === 0 && (
            <p className="text-sm text-dim text-center py-6">Nenhum alimento encontrado na base.</p>
          )}
        </div>
        </>
      )}

      {selected && (
        <div className="diet-selected-food surface rounded-2xl p-4 mt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] text-faint uppercase tracking-widest">Alimento selecionado</p>
              <p className="font-medium mt-1 break-words">{selected.name}</p>
              {selected.brand && <p className="text-[10px] text-faint mt-0.5">{selected.brand}</p>}
            </div>
            {!initialFood && (
              <button type="button" className="btn-ghost rounded-lg px-2.5 py-1.5 text-[10px]" onClick={() => setSelected(null)}>
                Trocar
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <Field label="Medida">
              <select className="w-full p-3 ring-focus" value={measureIndex} onChange={(event) => setMeasureIndex(Number(event.target.value))}>
                {measures.map((measure, index) => (
                  <option key={`${measure.label}-${index}`} value={index}>{measure.label}</option>
                ))}
              </select>
            </Field>
            <Field label={activeMeasure?.custom ? "Quantidade (g)" : "Quantidade"}>
              <input
                type="number"
                min="0.1"
                step={activeMeasure?.custom ? "1" : "0.1"}
                placeholder={activeMeasure?.custom ? "Ex.: 137" : undefined}
                className="w-full p-3 ring-focus"
                value={portionCount}
                onChange={(event) => setPortionCount(event.target.value)}
              />
            </Field>
          </div>

          {calculated && (
            <div className="grid grid-cols-4 gap-2 mt-3 text-center">
              {[
                ["kcal", calculated.calories],
                ["proteína", `${calculated.protein}g`],
                ["carbo", `${calculated.carbs}g`],
                ["gordura", `${calculated.fat}g`],
              ].map(([label, value]) => (
                <div key={label} className="surface-2 rounded-xl p-2">
                  <div className="font-mono text-sm">{value}</div>
                  <div className="text-faint text-[8px] uppercase mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={!selected || Number(portionCount) <= 0}
            className="btn-primary w-full rounded-xl py-3 mt-3 disabled:opacity-40"
            onClick={saveSelected}
          >
            Adicionar à dieta de hoje
          </button>
        </div>
      )}
    </Modal>
  );
}

function DietMealEditModal({ meal, isPro, onSave, onClose }) {
  const sourceFood = meal?.foodSnapshot || null;
  const sourceMeasures = sourceFood ? dietFoodMeasureOptions(sourceFood) : [];
  const initialMeasureIndex = Math.max(0, sourceMeasures.findIndex((item) => item.label === meal?.unit));

  const [mealType, setMealType] = useState(meal?.mealType || MEAL_TYPES[0]);
  const [name, setName] = useState(meal?.name || "");
  const [measureIndex, setMeasureIndex] = useState(initialMeasureIndex);
  const [quantity, setQuantity] = useState(Number(meal?.quantity || 1));
  const [unit, setUnit] = useState(meal?.unit || "porção");
  const [calories, setCalories] = useState(Number(meal?.calories || 0));
  const [protein, setProtein] = useState(Number(meal?.protein || 0));
  const [carbs, setCarbs] = useState(Number(meal?.carbs || 0));
  const [fat, setFat] = useState(Number(meal?.fat || 0));
  const [fiber, setFiber] = useState(Number(meal?.fiber || 0));
  const [sodium, setSodium] = useState(Number(meal?.sodium || 0));
  const [sugar, setSugar] = useState(Number(meal?.sugar || 0));

  const activeMeasure = sourceMeasures[measureIndex] || sourceMeasures[0] || null;
  const consumedAmount = sourceFood && activeMeasure
    ? Math.max(0, Number(quantity || 0)) * Number(activeMeasure.amount || 0)
    : Number(meal?.consumedAmount || 0);
  const recalculated = sourceFood && activeMeasure
    ? dietNutrientsForAmount(sourceFood, consumedAmount)
    : null;

  const save = () => {
    if (!name.trim() || Number(quantity) <= 0) return;
    const nutrition = recalculated || {
      calories: Math.max(0, Number(calories) || 0),
      protein: Math.max(0, Number(protein) || 0),
      carbs: Math.max(0, Number(carbs) || 0),
      fat: Math.max(0, Number(fat) || 0),
      fiber: Math.max(0, Number(fiber) || 0),
      sodium: Math.max(0, Number(sodium) || 0),
      sugar: Math.max(0, Number(sugar) || 0),
    };

    onSave({
      ...meal,
      name: name.trim(),
      mealType,
      quantity: Number(quantity),
      unit: sourceFood && activeMeasure ? activeMeasure.label : unit,
      consumedAmount: sourceFood && activeMeasure ? consumedAmount : meal?.consumedAmount,
      ...nutrition,
    });
  };

  return (
    <Modal title="Editar alimento registrado" onClose={onClose} width={560}>
      <div className="diet-edit-summary surface-2 rounded-2xl p-3 mb-3">
        <p className="text-[9px] text-faint uppercase tracking-widest">Registro da dieta</p>
        <p className="text-sm font-medium mt-1">{meal?.name}</p>
        <p className="text-[10px] text-faint mt-1">Edite a refeição, quantidade e informações do item sem precisar excluí-lo.</p>
      </div>

      <Field label="Refeição">
        <select className="w-full p-3 ring-focus" value={mealType} onChange={(event) => setMealType(event.target.value)}>
          {MEAL_TYPES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </Field>

      <Field label="Nome">
        <input className="w-full p-3 ring-focus" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>

      {sourceFood && sourceMeasures.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Medida">
            <select className="w-full p-3 ring-focus" value={measureIndex} onChange={(event) => setMeasureIndex(Number(event.target.value))}>
              {sourceMeasures.map((measure, index) => (
                <option key={`${measure.label}-${index}`} value={index}>{measure.label}</option>
              ))}
            </select>
          </Field>
          <Field label={activeMeasure?.custom ? "Quantidade (g)" : "Quantidade"}>
            <input
              type="number"
              min="0.1"
              step={activeMeasure?.custom ? "1" : "0.1"}
              className="w-full p-3 ring-focus"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade">
            <input type="number" min="0.1" step="0.1" className="w-full p-3 ring-focus" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </Field>
          <Field label="Medida">
            <input className="w-full p-3 ring-focus" value={unit} onChange={(event) => setUnit(event.target.value)} />
          </Field>
        </div>
      )}

      {recalculated ? (
        <div className="grid grid-cols-4 gap-2 mb-3 text-center">
          {[
            ["kcal", recalculated.calories],
            ["prot.", recalculated.protein],
            ["carb.", recalculated.carbs],
            ["gord.", recalculated.fat],
          ].map(([label, value]) => (
            <div key={label} className="surface-2 rounded-xl p-2">
              <p className="font-mono text-sm">{value}</p>
              <p className="text-[8px] text-faint uppercase mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Calorias"><input type="number" min="0" step="0.1" className="w-full p-3 ring-focus" value={calories} onChange={(event) => setCalories(event.target.value)} /></Field>
          <Field label="Proteínas"><input type="number" min="0" step="0.1" className="w-full p-3 ring-focus" value={protein} onChange={(event) => setProtein(event.target.value)} /></Field>
          <Field label="Carboidratos"><input type="number" min="0" step="0.1" className="w-full p-3 ring-focus" value={carbs} onChange={(event) => setCarbs(event.target.value)} /></Field>
          <Field label="Gorduras"><input type="number" min="0" step="0.1" className="w-full p-3 ring-focus" value={fat} onChange={(event) => setFat(event.target.value)} /></Field>
          {isPro && <>
            <Field label="Fibras"><input type="number" min="0" step="0.1" className="w-full p-3 ring-focus" value={fiber} onChange={(event) => setFiber(event.target.value)} /></Field>
            <Field label="Sódio (mg)"><input type="number" min="0" step="1" className="w-full p-3 ring-focus" value={sodium} onChange={(event) => setSodium(event.target.value)} /></Field>
            <Field label="Açúcares"><input type="number" min="0" step="0.1" className="w-full p-3 ring-focus" value={sugar} onChange={(event) => setSugar(event.target.value)} /></Field>
          </>}
        </div>
      )}

      <button className="btn-primary w-full rounded-xl py-3 mt-2" onClick={save}>Salvar alterações</button>
    </Modal>
  );
}

function FoodView({
  foodBase = [],
  foods = [],
  mealLog,
  addMeal,
  updateMeal,
  toggleMealConsumed,
  deleteMeal,
  deleteFood,
  profile,
  setProfile,
  session,
  autoOpen,
  isPro,
  onUpgrade,
}) {
  const [section, setSection] = useState("today");
  const [confirm, confirmDialog] = useConfirm();
  const [promptFor, promptDialog] = usePrompt();
  const [showForm, setShowForm] = useState(false);
  const [formSeed, setFormSeed] = useState(null);
  const [formMode, setFormMode] = useState("search");
  const [formMealType, setFormMealType] = useState(MEAL_TYPES[0]);
  const [editingMeal, setEditingMeal] = useState(null);
  const [editingTargets, setEditingTargets] = useState(false);
  const [foodLibraryQuery, setFoodLibraryQuery] = useState("");
  const [foodMacroFilter, setFoodMacroFilter] = useState("all");
  const [foodVisibleCount, setFoodVisibleCount] = useState(80);
  const [prescribeMeal, setPrescribeMeal] = useState(null);
  const [prescribePatients, setPrescribePatients] = useState([]);
  const [prescribePatientId, setPrescribePatientId] = useState("");
  const [prescribeNote, setPrescribeNote] = useState("");
  const [prescribeLoading, setPrescribeLoading] = useState(false);
  const [prescribeNotice, setPrescribeNotice] = useState(null);

  const defaults = { calorieTarget:2200, proteinTarget:150, carbTarget:250, fatTarget:70 };
  const [draftTargets, setDraftTargets] = useState({
    calorieTarget: profile?.calorieTarget ?? defaults.calorieTarget,
    proteinTarget: profile?.proteinTarget ?? defaults.proteinTarget,
    carbTarget: profile?.carbTarget ?? defaults.carbTarget,
    fatTarget: profile?.fatTarget ?? defaults.fatTarget,
  });

  useEffect(() => {
    if (autoOpen) {
      setFormSeed(null);
      setFormMode("search");
      setFormMealType(MEAL_TYPES[0]);
      setShowForm(true);
    }
  }, [autoOpen]);

  const t = today();
  const todayLog = mealLog.filter((meal) => meal.date === t);
  const yesterdayLog = mealLog.filter((meal) => meal.date === addDays(t, -1));
  const totals = dietDailyTotals(mealLog, t);
  const byMeal = MEAL_TYPES.map((mealType) => ({
    mealType,
    items: todayLog.filter((meal) => meal.mealType === mealType),
  }));
  const targets = {
    calories: Number(profile?.calorieTarget ?? 2200),
    protein: Number(profile?.proteinTarget ?? 150),
    carbs: Number(profile?.carbTarget ?? 250),
    fat: Number(profile?.fatTarget ?? 70),
  };
  const metabolicProfile = profile?.metabolicProfile || { sex: "", age: "", weightKg: "", heightCm: "" };
  const tmb = calculateTmb(metabolicProfile);
  const savedMeals = profile?.dietSavedMeals || [];
  const remainingCalories = Math.max(0, targets.calories - totals.calories);
  const foodLibrary = useMemo(() => dietDedupFoods([...foodBase, ...foods]), [foodBase, foods]);
  const foodLibraryResults = useMemo(() => {
    const macroGroup = (food) => {
      const proteinEnergy = Number(food?.protein || 0) * 4;
      const carbEnergy = Number(food?.carbs || 0) * 4;
      const fatEnergy = Number(food?.fat || 0) * 9;
      if (proteinEnergy >= carbEnergy && proteinEnergy >= fatEnergy) return "protein";
      if (fatEnergy >= proteinEnergy && fatEnergy >= carbEnergy) return "fat";
      return "carbs";
    };

    const matched = foodLibrary
      .filter((food) => dietFoodMatches(food, foodLibraryQuery))
      .filter((food) => foodMacroFilter === "all" || macroGroup(food) === foodMacroFilter);

    if (foodLibraryQuery.trim()) {
      matched.sort(
        (a, b) =>
          dietFoodSearchScore(b, foodLibraryQuery) - dietFoodSearchScore(a, foodLibraryQuery) ||
          String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );
    } else {
      matched.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
    }
    return matched;
  }, [foodLibrary, foodLibraryQuery, foodMacroFilter]);

  useEffect(() => {
    setFoodVisibleCount(80);
  }, [foodLibraryQuery, foodMacroFilter]);

  const updateMetabolic = (key, value) => setProfile((current) => ({
    ...current,
    metabolicProfile: {
      ...(current?.metabolicProfile || {}),
      [key]: value,
    },
  }));

  const saveTargets = () => {
    setProfile((current) => ({ ...current, ...draftTargets }));
    setEditingTargets(false);
  };

  const openFood = (food = null, mode = "search", mealType = null) => {
    const targetMealType = mealType || MEAL_TYPES[0];
    const currentCount = todayLog.filter((meal) => meal.mealType === targetMealType).length;
    if (mealType && !isPro && currentCount >= PRO_LIMITS.dietItemsPerMeal) {
      onUpgrade("diet");
      return false;
    }
    setFormSeed(food);
    setFormMode(mode);
    setFormMealType(targetMealType);
    setShowForm(true);
    return true;
  };

  const addSavedMeal = (template) => {
    const meals = (template.items || []).map((item) => ({
      ...item,
      id: uid(),
      date: today(),
      mealType: template.mealType || item.mealType || MEAL_TYPES[0],
      consumed: false,
      consumedAt: null,
    }));
    if (!meals.length) return;
    addMeal(meals);
  };

  const saveMealTemplate = async (group) => {
    if (!group?.items?.length) return;
    if (!isPro && savedMeals.length >= PRO_LIMITS.dietSavedMeals) {
      onUpgrade("diet");
      return;
    }

    const defaultName = `${group.mealType} padrão`;
    const requested = await promptFor("Nome da refeição salva:", defaultName);
    const name = String(requested || "").trim();
    if (!name) return;

    const template = {
      id: uid(),
      name,
      mealType: group.mealType,
      createdAt: new Date().toISOString(),
      items: group.items.map((item) => ({
        ...item,
        id: undefined,
        date: undefined,
      })),
    };

    setProfile((current) => ({
      ...current,
      dietSavedMeals: [template, ...(current?.dietSavedMeals || [])],
    }));
  };

  const deleteSavedMeal = async (id) => {
    if (!(await confirm("Excluir esta refeição salva?"))) return;
    setProfile((current) => ({
      ...current,
      dietSavedMeals: (current?.dietSavedMeals || []).filter((item) => item.id !== id),
    }));
  };

  const openPrescribeDiet = async (template) => {
    if (!isPro) {
      onUpgrade("professional");
      return;
    }
    setPrescribeMeal(template);
    setPrescribePatientId("");
    setPrescribeNote("");
    setPrescribeNotice(null);
    try {
      const links = (await fetchProfessionalLinks(session)) || [];
      setPrescribePatients(links.filter((l) => l.status === "accepted" && l.direction === "as_professional" && l.link_type === "nutricionista"));
    } catch (_) {
      setPrescribePatients([]);
    }
  };

  const confirmPrescribeDiet = async () => {
    if (!prescribeMeal || !prescribePatientId) return;
    setPrescribeLoading(true);
    setPrescribeNotice(null);
    try {
      await sendPrescription(session, prescribePatientId, "diet", prescribeMeal, prescribeNote);
      setPrescribeNotice({ type: "ok", text: "Refeição enviada para o paciente." });
    } catch (err) {
      const raw = (err.message || "").toLowerCase();
      const text = raw.includes("pro_required")
        ? "É preciso ser PRO para prescrever dietas."
        : "Não foi possível enviar a refeição.";
      setPrescribeNotice({ type: "error", text });
    } finally {
      setPrescribeLoading(false);
    }
  };

  const repeatYesterday = () => {
    if (!yesterdayLog.length) return;
    addMeal(yesterdayLog.map((item) => ({
      ...item,
      id: uid(),
      date: today(),
      consumed: false,
      consumedAt: null,
    })));
  };

  const recent7 = mealLog.filter((meal) => meal.date >= addDays(today(), -6) && meal.date <= today() && dietMealConsumed(meal));
  const advancedTotals7 = recent7.reduce(
    (sum, meal) => ({
      fiber: sum.fiber + Number(meal.fiber || 0),
      sodium: sum.sodium + Number(meal.sodium || 0),
      sugar: sum.sugar + Number(meal.sugar || 0),
    }),
    { fiber:0, sodium:0, sugar:0 }
  );
  const loggedDates7 = new Set(recent7.map((meal) => meal.date)).size || 1;

  return (
    <div className="diet-modern-view flex flex-col gap-4 md:gap-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl md:text-3xl">Dieta</h2>
          <p className="text-faint text-xs md:text-sm mt-1">Escolha alimentos da base, acompanhe os macros e monte a dieta do dia.</p>
        </div>
        <button className="btn-primary rounded-xl px-4 py-2.5 text-sm flex items-center justify-center gap-1.5" onClick={() => openFood()}>
          <Plus size={15} /> Adicionar alimento
        </button>
      </div>

      <FirstVisitTip id="diet" icon={Apple} title="Dieta é seu registro alimentar do dia.">
        Busque um alimento, informe a porção e adicione à refeição. O Constancce calcula calorias, proteínas, carboidratos e gorduras para você.
      </FirstVisitTip>

      <div className="diet-section-tabs task-glass-tabs rounded-2xl p-1 grid grid-cols-3 gap-1">
        {[
          ["today", "Hoje"],
          ["foods", "Alimentos"],
          ["insights", "Insights"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`task-tab-button rounded-xl py-2 text-[10px] sm:text-xs md:text-sm font-medium ${section === id ? "task-tab-active" : ""}`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "today" && (
        <>
          <div className="diet-day-hero glass-panel-strong rounded-2xl p-4 md:p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-faint uppercase tracking-widest">Hoje</p>
                <div className="flex items-end gap-2 mt-1">
                  <p className="font-display text-3xl md:text-4xl">{Math.round(totals.calories).toLocaleString("pt-BR")}</p>
                  <span className="text-dim text-sm mb-1">/ {targets.calories.toLocaleString("pt-BR")} kcal</span>
                </div>
                <p className="text-[10px] text-faint mt-1">{Math.round(remainingCalories).toLocaleString("pt-BR")} kcal restantes pela meta atual.</p>

                <div className="flex flex-wrap gap-2 mt-3">
                  {yesterdayLog.length > 0 && (
                    <button className="btn-ghost rounded-xl px-3 py-2 text-xs" onClick={repeatYesterday}>
                      <Repeat2 size={12} className="inline mr-1" /> Repetir ontem
                    </button>
                  )}
                  <button
                    className="btn-ghost rounded-xl px-3 py-2 text-xs"
                    onClick={() => {
                      if (!isPro) {
                        onUpgrade("diet");
                        return;
                      }
                      setEditingTargets(true);
                    }}
                  >
                    {!isPro && <Lock size={11} className="inline mr-1" />}
                    Ajustar metas
                  </button>
                </div>
              </div>

              <RadialProgress
                value={targets.calories > 0 ? (totals.calories / targets.calories) * 100 : 0}
                label="da meta"
                size={116}
                strokeWidth={8}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {[
                ["Proteínas", totals.protein, targets.protein, "g"],
                ["Carboidratos", totals.carbs, targets.carbs, "g"],
                ["Gorduras", totals.fat, targets.fat, "g"],
                ["Calorias", totals.calories, targets.calories, "kcal"],
              ].map(([label, value, target, unit]) => (
                <div key={label} className="surface-2 rounded-xl p-3">
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <span className="text-[9px] text-faint uppercase tracking-wide">{label}</span>
                    <span className="font-mono text-[10px] whitespace-nowrap">{Math.round(Number(value) * 10) / 10}/{target}{unit}</span>
                  </div>
                  <Progress value={target > 0 ? Math.min(100, Number(value) / target * 100) : 0} height={5} />
                </div>
              ))}
            </div>
          </div>

          {savedMeals.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-faint uppercase tracking-widest">Refeições salvas</p>
                {!isPro && <span className="chip">{savedMeals.length}/{PRO_LIMITS.dietSavedMeals} Free</span>}
              </div>
              <div className="diet-saved-scroll flex gap-2 overflow-x-auto scrollbar-none pb-1">
                {savedMeals.slice(0, isPro ? 12 : PRO_LIMITS.dietSavedMeals).map((template) => (
                  <div key={template.id} className="diet-saved-meal surface-2 rounded-xl p-3 text-left shrink-0 relative">
                    <button className="block w-full text-left" onClick={() => addSavedMeal(template)}>
                      <p className="text-sm font-medium pr-5">{template.name}</p>
                      <p className="text-[9px] text-faint mt-1">{template.items?.length || 0} itens · toque para adicionar</p>
                    </button>
                    <button
                      className="btn-ghost rounded-lg p-1 absolute top-2 right-2"
                      onClick={(event) => { event.stopPropagation(); openPrescribeDiet(template); }}
                      title={isPro ? "Enviar para paciente" : "Enviar para paciente · PRO"}
                    >
                      {isPro ? <Stethoscope size={12} /> : <Lock size={11} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="diet-meal-plan flex flex-col gap-3">
            {byMeal.map((group) => {
              const consumedItems = group.items.filter(dietMealConsumed);
              const plannedCalories = group.items.reduce((sum, item) => sum + Number(item.calories || 0), 0);
              const consumedCalories = consumedItems.reduce((sum, item) => sum + Number(item.calories || 0), 0);
              const consumedProtein = consumedItems.reduce((sum, item) => sum + Number(item.protein || 0), 0);
              const completionPct = group.items.length > 0
                ? Math.round(consumedItems.length / group.items.length * 100)
                : 0;

              return (
                <section key={group.mealType} className="diet-meal-section surface rounded-2xl p-3 md:p-4">
                  <div className="diet-meal-section-head flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-display text-base md:text-lg">{group.mealType}</p>
                        {group.items.length > 0 && (
                          <span className={`chip ${completionPct === 100 ? "text-moss" : ""}`}>
                            {consumedItems.length}/{group.items.length} consumidos
                          </span>
                        )}
                        {!isPro && <span className="chip">{group.items.length}/{PRO_LIMITS.dietItemsPerMeal} alimentos Free</span>}
                      </div>
                      <p className="text-[9px] md:text-[10px] text-faint mt-1">
                        {group.items.length > 0
                          ? `${Math.round(consumedCalories)} de ${Math.round(plannedCalories)} kcal consumidas · P ${Math.round(consumedProtein * 10) / 10}g`
                          : "Ainda sem alimentos. Toque em Adicionar para buscar na base e montar esta refeição."}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {group.items.length > 0 && (
                        <button
                          className="btn-ghost rounded-lg px-2.5 py-2 text-[9px] hidden sm:inline-flex"
                          onClick={() => saveMealTemplate(group)}
                          title="Salvar esta refeição para reutilizar depois"
                        >
                          <Archive size={12} className="mr-1" /> Salvar
                        </button>
                      )}
                      <button
                        className="diet-add-to-meal btn-ghost rounded-xl px-3 py-2 text-[10px] md:text-xs text-brass"
                        onClick={() => openFood(null, "search", group.mealType)}
                      >
                        <Plus size={13} className="inline mr-1" /> Adicionar
                      </button>
                    </div>
                  </div>

                  {group.items.length > 0 && (
                    <div className="mt-3 mb-3">
                      <Progress value={completionPct} height={4} tone={completionPct === 100 ? "moss" : "fill"} />
                    </div>
                  )}

                  {group.items.length === 0 ? (
                    <button
                      className="diet-meal-empty w-full rounded-xl py-3 px-3 text-left flex items-center justify-between gap-3"
                      onClick={() => openFood(null, "search", group.mealType)}
                    >
                      <span className="text-[10px] md:text-xs text-dim">Planeje o que vai consumir no {group.mealType.toLowerCase()}.</span>
                      <Plus size={14} className="text-faint shrink-0" />
                    </button>
                  ) : (
                    <div className="diet-plan-items flex flex-col gap-2">
                      {group.items.map((meal) => {
                        const consumed = dietMealConsumed(meal);
                        return (
                          <article
                            key={meal.id}
                            className={`diet-plan-item rounded-xl p-3 flex items-center gap-3 ${consumed ? "is-consumed" : "is-pending"}`}
                          >
                            <button
                              type="button"
                              className={`diet-consume-check shrink-0 ${consumed ? "checked" : ""}`}
                              onClick={() => toggleMealConsumed(meal.id)}
                              aria-pressed={consumed}
                              aria-label={consumed ? `Marcar ${meal.name} como não consumido` : `Marcar ${meal.name} como consumido`}
                              title={consumed ? "Consumido" : "Marcar como consumido"}
                            >
                              {consumed ? <Check size={15} /> : <Circle size={15} />}
                            </button>

                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className={`diet-plan-item-name text-xs md:text-sm font-medium break-words ${consumed ? "text-dim" : ""}`}>
                                  {meal.name}
                                </p>
                                {consumed && <span className="chip text-moss">Consumido</span>}
                              </div>
                              <p className="text-[9px] md:text-[10px] text-faint mt-1 break-words">
                                {meal.quantity ? `${meal.quantity} × ${meal.unit || "porção"}` : meal.unit || "porção"}
                                {meal.brand ? ` · ${meal.brand}` : ""}
                              </p>
                              <div className="diet-plan-macros flex flex-wrap gap-1 mt-1.5">
                                <span className="chip text-[8px]">P {Math.round(Number(meal.protein || 0) * 10) / 10}g</span>
                                <span className="chip text-[8px]">C {Math.round(Number(meal.carbs || 0) * 10) / 10}g</span>
                                <span className="chip text-[8px]">G {Math.round(Number(meal.fat || 0) * 10) / 10}g</span>
                              </div>
                            </div>

                            <div className="diet-plan-item-side shrink-0 flex flex-col items-end gap-1.5">
                              <span className={`font-mono text-xs whitespace-nowrap ${consumed ? "text-moss" : "text-brass"}`}>
                                {Math.round(Number(meal.calories || 0))} kcal
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  className="btn-ghost rounded-lg p-1.5"
                                  onClick={() => setEditingMeal(meal)}
                                  title="Editar alimento"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  className="btn-ghost rounded-lg p-1.5"
                                  onClick={() => deleteMeal(meal.id)}
                                  title="Remover alimento"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {group.items.length > 0 && (
                    <div className="sm:hidden mt-2 flex justify-end">
                      <button className="text-[9px] text-faint" onClick={() => saveMealTemplate(group)}>
                        Salvar refeição para repetir
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {section === "foods" && (
        <>
          <div className="diet-library-command surface glass-panel rounded-2xl p-4 md:p-5">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
              <div>
                <p className="text-[10px] text-faint uppercase tracking-widest">Lista de alimentos</p>
                <p className="font-display text-lg md:text-xl mt-1">{foodLibrary.length} alimentos disponíveis</p>
                <p className="text-xs text-dim mt-1">Pesquise, confira proteínas, carboidratos e gorduras e adicione o alimento à dieta de hoje.</p>
              </div>
              <button className="btn-primary rounded-xl px-4 py-2.5 text-sm shrink-0" onClick={() => openFood()}>
                <Plus size={14} className="inline mr-1" /> Adicionar alimento
              </button>
            </div>

            <div className="relative mt-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                className="w-full pl-9 pr-3 py-3 ring-focus"
                placeholder="Buscar alimento..."
                value={foodLibraryQuery}
                onChange={(event) => setFoodLibraryQuery(event.target.value)}
              />
            </div>

            <div className="diet-food-tabs flex gap-1.5 overflow-x-auto scrollbar-none pb-1 mt-3">
              {[
                ["all", "Todos"],
                ["protein", "Proteínas"],
                ["carbs", "Carboidratos"],
                ["fat", "Gorduras"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="chip whitespace-nowrap"
                  onClick={() => setFoodMacroFilter(id)}
                  style={{
                    color: foodMacroFilter === id ? "var(--brass)" : "var(--text-dim)",
                    borderColor: foodMacroFilter === id ? "var(--brass)" : "var(--border)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-1">
            <p className="text-[10px] text-faint uppercase tracking-widest">
              {foodLibraryResults.length} resultado{foodLibraryResults.length === 1 ? "" : "s"}
            </p>
            <p className="text-[10px] text-faint">Valores por porção de referência</p>
          </div>

          <div className="diet-food-library-list grid grid-cols-1 md:grid-cols-2 gap-2">
            {foodLibraryResults.slice(0, foodVisibleCount).map((food) => (
              <article key={dietFoodKey(food)} className="diet-food-library-card surface rounded-2xl p-3 md:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{food.name}</p>
                    <p className="text-[9px] text-faint mt-1">
                      {food.baseQuantity || 100}{food.unit || "g"} · {Math.round(Number(food.calories || 0))} kcal
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary rounded-xl px-3 py-2 text-[10px] shrink-0"
                    onClick={() => openFood(food)}
                  >
                    <Plus size={11} className="inline mr-1" /> Adicionar
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="diet-macro-cell surface-2 rounded-xl p-2 text-center">
                    <p className="font-mono text-xs">{Math.round(Number(food.protein || 0) * 10) / 10}g</p>
                    <p className="text-[8px] text-faint uppercase mt-0.5">Proteínas</p>
                  </div>
                  <div className="diet-macro-cell surface-2 rounded-xl p-2 text-center">
                    <p className="font-mono text-xs">{Math.round(Number(food.carbs || 0) * 10) / 10}g</p>
                    <p className="text-[8px] text-faint uppercase mt-0.5">Carboidratos</p>
                  </div>
                  <div className="diet-macro-cell surface-2 rounded-xl p-2 text-center">
                    <p className="font-mono text-xs">{Math.round(Number(food.fat || 0) * 10) / 10}g</p>
                    <p className="text-[8px] text-faint uppercase mt-0.5">Gorduras</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {foodLibraryResults.length === 0 && (
            <div className="surface-2 rounded-2xl p-6 text-center">
              <p className="text-sm text-dim">Nenhum alimento encontrado.</p>
              <p className="text-[10px] text-faint mt-1">Tente outro nome ou selecione “Todos”.</p>
            </div>
          )}

          {foodVisibleCount < foodLibraryResults.length && (
            <button
              type="button"
              className="btn-ghost w-full rounded-xl py-2.5 text-xs"
              onClick={() => setFoodVisibleCount((current) => current + 80)}
            >
              Mostrar mais alimentos ({Math.min(foodVisibleCount + 80, foodLibraryResults.length)} de {foodLibraryResults.length})
            </button>
          )}
        </>
      )}

      {section === "insights" && (
        <>
          <NutritionIntelligencePanel
            mealLog={mealLog}
            profile={profile}
            isPro={isPro}
            onUpgrade={onUpgrade}
          />

          {isPro ? (
            <>
              <div className="surface glass-panel rounded-2xl p-4 md:p-5">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div>
                    <p className="text-[10px] text-faint uppercase tracking-widest">Taxa Metabólica Basal</p>
                    <p className="text-dim text-xs mt-1">Estimativa automática pela fórmula de Mifflin-St Jeor.</p>
                    <div className="flex items-baseline gap-2 mt-3">
                      <p className="font-display text-3xl text-brass">{tmb ? tmb.toLocaleString("pt-BR") : "—"}</p>
                      <span className="text-dim text-sm">kcal/dia</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-2 gap-2 w-full md:max-w-md">
                    <Field label="Sexo">
                      <select className="w-full p-2.5 ring-focus" value={metabolicProfile.sex || ""} onChange={(event) => updateMetabolic("sex", event.target.value)}>
                        <option value="">Selecione</option>
                        <option value="male">Masculino</option>
                        <option value="female">Feminino</option>
                      </select>
                    </Field>
                    <Field label="Idade"><input type="number" min="10" max="120" className="w-full p-2.5 ring-focus" value={metabolicProfile.age ?? ""} onChange={(event) => updateMetabolic("age", event.target.value)} placeholder="anos" /></Field>
                    <Field label="Peso"><input type="number" min="20" step="0.1" className="w-full p-2.5 ring-focus" value={metabolicProfile.weightKg ?? ""} onChange={(event) => updateMetabolic("weightKg", event.target.value)} placeholder="kg" /></Field>
                    <Field label="Altura"><input type="number" min="100" step="0.5" className="w-full p-2.5 ring-focus" value={metabolicProfile.heightCm ?? ""} onChange={(event) => updateMetabolic("heightCm", event.target.value)} placeholder="cm" /></Field>
                  </div>
                </div>
                {!tmb && <p className="text-[10px] text-faint mt-3">Preencha sexo, idade, peso e altura para calcular a estimativa.</p>}
                {tmb && <p className="text-[10px] text-faint mt-3">Estimativa informativa; não substitui avaliação profissional individualizada.</p>}
              </div>

              <div className="surface glass-panel rounded-2xl p-4 md:p-5">
                <p className="text-[10px] text-faint uppercase tracking-widest">Nutrientes avançados · média por dia registrado</p>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="surface-2 rounded-xl p-3 text-center">
                    <p className="font-display text-lg">{Math.round(advancedTotals7.fiber / loggedDates7 * 10) / 10}g</p>
                    <p className="text-[9px] text-faint mt-1">Fibra</p>
                  </div>
                  <div className="surface-2 rounded-xl p-3 text-center">
                    <p className="font-display text-lg">{Math.round(advancedTotals7.sodium / loggedDates7)}mg</p>
                    <p className="text-[9px] text-faint mt-1">Sódio</p>
                  </div>
                  <div className="surface-2 rounded-xl p-3 text-center">
                    <p className="font-display text-lg">{Math.round(advancedTotals7.sugar / loggedDates7 * 10) / 10}g</p>
                    <p className="text-[9px] text-faint mt-1">Açúcares</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <ProLockCard
              feature="diet"
              title="Metabolismo e nutrientes avançados"
              description="TMB, fibras, sódio, açúcares e metas nutricionais personalizadas ficam disponíveis no PRO."
              onUpgrade={onUpgrade}
            />
          )}
        </>
      )}

      {showForm && (
        <MealForm
          foodBase={foodBase}
          foods={foods}
          profile={profile}
          setProfile={setProfile}
          session={session}
          isPro={isPro}
          onUpgrade={onUpgrade}
          initialFood={formSeed}
          initialMode={formMode}
          initialMealType={formMealType}
          onClose={() => {
            setShowForm(false);
            setFormSeed(null);
            setFormMode("search");
            setFormMealType(MEAL_TYPES[0]);
          }}
          onSave={(meal, newFood) => {
            if (addMeal(meal, newFood) === false) return;
            setShowForm(false);
            setFormSeed(null);
            setFormMode("search");
            setFormMealType(MEAL_TYPES[0]);
          }}
        />
      )}

      {editingMeal && (
        <DietMealEditModal
          meal={editingMeal}
          isPro={isPro}
          onClose={() => setEditingMeal(null)}
          onSave={(nextMeal) => {
            updateMeal(editingMeal.id, nextMeal);
            setEditingMeal(null);
          }}
        />
      )}

      {editingTargets && (
        <Modal title="Metas nutricionais" onClose={() => setEditingTargets(false)}>
          <p className="text-dim text-sm mb-4">Defina suas metas diárias conforme sua necessidade individual.</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["calorieTarget", "Calorias (kcal)"],
              ["proteinTarget", "Proteínas (g)"],
              ["carbTarget", "Carboidratos (g)"],
              ["fatTarget", "Gorduras (g)"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full p-3 ring-focus"
                  value={draftTargets[key]}
                  onChange={(event) => setDraftTargets((current) => ({ ...current, [key]: Number(event.target.value) }))}
                />
              </Field>
            ))}
          </div>
          <button className="btn-primary w-full rounded-xl py-3 mt-3" onClick={saveTargets}>Salvar metas</button>
        </Modal>
      )}

      {prescribeMeal && (
        <Modal title="Enviar refeição para paciente" onClose={() => setPrescribeMeal(null)} width={520}>
          <p className="text-dim text-xs mb-3">Prescrevendo <strong>{prescribeMeal.name}</strong>.</p>

          {prescribePatients.length === 0 ? (
            <p className="text-faint text-xs">
              Nenhum paciente vinculado ainda. Convide alguém na tela "Personal & Nutri" e espere a pessoa aceitar.
            </p>
          ) : (
            <>
              <Field label="Paciente">
                <select
                  className="w-full p-3 ring-focus"
                  value={prescribePatientId}
                  onChange={(event) => setPrescribePatientId(event.target.value)}
                >
                  <option value="">Selecione…</option>
                  {prescribePatients.map((patient) => (
                    <option key={patient.link_id} value={patient.link_id}>
                      {patient.display_name || patient.email}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Nota para o paciente (opcional)">
                <textarea
                  rows={3}
                  className="w-full p-3 ring-focus resize-none"
                  placeholder="Ex: substitua o arroz por batata-doce nos dias de treino."
                  value={prescribeNote}
                  onChange={(event) => setPrescribeNote(event.target.value)}
                />
              </Field>

              {prescribeNotice && (
                <p className={`text-xs mb-3 ${prescribeNotice.type === "error" ? "text-ember" : "text-moss"}`}>
                  {prescribeNotice.text}
                </p>
              )}

              <button
                disabled={!prescribePatientId || prescribeLoading}
                className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
                onClick={confirmPrescribeDiet}
              >
                {prescribeLoading ? "Enviando…" : "Enviar refeição"}
              </button>
            </>
          )}
        </Modal>
      )}
      {confirmDialog}
      {promptDialog}
    </div>
  );
}

/* ---------------------------------------------------------------
   FINANCE
----------------------------------------------------------------*/
function TransactionForm({ presetType, goals = [], onSave, onClose }) {
  const [type, setType] = useState(presetType || "saida");
  const [category, setCategory] = useState((presetType === "entrada" ? FIN_IN : FIN_OUT)[0]);
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today());
  const [goalId, setGoalId] = useState("");
  const cats = type === "entrada" ? FIN_IN : FIN_OUT;
  return (
    <Modal title="Novo lançamento" onClose={onClose}>
      <Field label="Tipo">
        <div className="flex gap-2">
          <button onClick={() => { setType("entrada"); setCategory(FIN_IN[0]); }} className="flex-1 py-2 rounded-xl text-sm flex items-center justify-center gap-1" style={{ border: `1px solid ${type === "entrada" ? "var(--moss)" : "var(--border)"}`, background: type === "entrada" ? "var(--surface-2)" : "transparent", color: type === "entrada" ? "var(--moss)" : "var(--text-dim)" }}><ArrowUpRight size={14} /> Entrada</button>
          <button onClick={() => { setType("saida"); setCategory(FIN_OUT[0]); }} className="flex-1 py-2 rounded-xl text-sm flex items-center justify-center gap-1" style={{ border: `1px solid ${type === "saida" ? "var(--ember)" : "var(--border)"}`, background: type === "saida" ? "var(--surface-2)" : "transparent", color: type === "saida" ? "var(--ember)" : "var(--text-dim)" }}><ArrowDownRight size={14} /> Saída</button>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)"><input type="number" className="w-full p-3 ring-focus" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Data"><input type="date" className="w-full p-3 ring-focus" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Categoria">
        <select className="w-full p-3 ring-focus" value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      {type === "saida" && category === "Aporte para meta" && (
        <Field label="Meta financeira">
          <select className="w-full p-3 ring-focus" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">Selecione a meta</option>
            {goals.filter((g) => g.type === "financeira" && !g.completed).map((g) => (
              <option key={g.id} value={g.id}>{g.name} · {money(g.current)} / {money(g.target)}</option>
            ))}
          </select>
          <p className="text-[10px] text-faint mt-1.5">O valor será registrado na Finanças e também somado automaticamente ao progresso da meta.</p>
        </Field>
      )}
      <Field label="Descrição"><input className="w-full p-3 ring-focus" placeholder="Opcional" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <button disabled={!value || Number(value) <= 0 || (type === "saida" && category === "Aporte para meta" && !goalId)} className="btn-primary w-full rounded-xl py-3 mt-2 disabled:opacity-40"
        onClick={() => onSave({ id: uid(), type, category, value: Number(value), date, description: description.trim(), goalId: goalId || null })}>
        Salvar lançamento
      </button>
    </Modal>
  );
}

function FinanceRecurringForm({ onSave, onClose }) {
  const [type, setType] = useState("saida");
  const [category, setCategory] = useState(FIN_OUT[0]);
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState(Math.min(28, new Date().getDate()));
  const cats = type === "entrada" ? FIN_IN : FIN_OUT;

  return (
    <Modal title="Nova recorrência mensal" onClose={onClose}>
      <Field label="Tipo">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setType("entrada"); setCategory(FIN_IN[0]); }}
            className="flex-1 py-2 rounded-xl text-sm"
            style={{ border: `1px solid ${type === "entrada" ? "var(--moss)" : "var(--border)"}`, color: type === "entrada" ? "var(--moss)" : "var(--text-dim)" }}
          >
            Entrada
          </button>
          <button
            type="button"
            onClick={() => { setType("saida"); setCategory(FIN_OUT[0]); }}
            className="flex-1 py-2 rounded-xl text-sm"
            style={{ border: `1px solid ${type === "saida" ? "var(--ember)" : "var(--border)"}`, color: type === "saida" ? "var(--ember)" : "var(--text-dim)" }}
          >
            Saída
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Valor mensal (R$)">
          <input type="number" min="0" step="0.01" className="w-full p-3 ring-focus" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Dia do mês">
          <input type="number" min="1" max="31" className="w-full p-3 ring-focus" value={day} onChange={(e) => setDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
        </Field>
      </div>

      <Field label="Categoria">
        <select className="w-full p-3 ring-focus" value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>

      <Field label="Descrição">
        <input className="w-full p-3 ring-focus" placeholder="Ex: Aluguel, academia, salário..." value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="surface-2 rounded-xl p-3 text-xs text-dim mb-3">
        O Constancce lançará esta recorrência automaticamente quando chegar o dia definido em cada mês.
      </div>

      <button
        disabled={!value || Number(value) <= 0 || !description.trim()}
        className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
        onClick={() => onSave({
          id: uid(),
          type,
          category,
          value: Number(value),
          description: description.trim(),
          day,
          active: true,
          createdAt: today(),
        })}
      >
        Salvar recorrência
      </button>
    </Modal>
  );
}


function FinanceDonutChart({ data, total }) {
  const palette = ["var(--ember)", "var(--brass)", "var(--moss)", "#8b78d1", "#4f9d9d", "#d18d5f", "#7e8794"];
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col lg:flex-row items-center gap-5">
      <div className="relative w-44 h-44 shrink-0">
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90" role="img" aria-label="Distribuição dos gastos por categoria">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
          {data.map((item, index) => {
            const share = total > 0 ? item.total / total : 0;
            const dash = share * circumference;
            const node = (
              <circle
                key={item.category}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={palette[index % palette.length]}
                strokeWidth="18"
                strokeLinecap="butt"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${item.category}: ${money(item.total)}`}</title>
              </circle>
            );
            offset += dash;
            return node;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] text-faint uppercase tracking-widest">Gastos</span>
          <strong className="font-display text-lg mt-0.5">{money(total)}</strong>
        </div>
      </div>

      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
        {data.length === 0 && <p className="text-dim text-sm">Nenhum gasto registrado neste mês.</p>}
        {data.slice(0, 7).map((item, index) => {
          const pct = total > 0 ? Math.round((item.total / total) * 100) : 0;
          return (
            <div key={item.category} className="flex items-center gap-2.5 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: palette[index % palette.length] }} />
              <span className="text-xs text-dim truncate flex-1">{item.category}</span>
              <span className="text-[11px] text-faint">{pct}%</span>
              <span className="text-xs font-mono min-w-[74px] text-right">{money(item.total)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinanceTrendChart({ rows }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const width = 680;
  const height = 220;
  const left = 30;
  const right = 20;
  const top = 18;
  const bottom = 36;
  const chartW = width - left - right;
  const chartH = height - top - bottom;
  const max = Math.max(1, ...rows.flatMap((row) => [row.entrada, row.saida]));
  const step = rows.length > 1 ? chartW / (rows.length - 1) : chartW;

  const pointsFor = (key) =>
    rows.map((row, index) => ({
      x: left + index * step,
      y: top + chartH - (Number(row[key] || 0) / max) * chartH,
      value: Number(row[key] || 0),
      label: row.label,
    }));

  const entradaPts = pointsFor("entrada");
  const saidaPts = pointsFor("saida");
  const entradaPath = smoothChartPath(entradaPts);
  const saidaPath = smoothChartPath(saidaPts);
  const selected = selectedIndex != null ? rows[selectedIndex] : null;

  return (
    <div className="tech-chart">
      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-h-[175px] md:min-h-[190px]"
          role="img"
          aria-label="Evolução financeira dos últimos seis meses"
        >
          {[0, .25, .5, .75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={left}
              x2={width - right}
              y1={top + chartH * ratio}
              y2={top + chartH * ratio}
              stroke="var(--border-soft)"
              strokeWidth="1"
              strokeDasharray="3 7"
              opacity=".62"
            />
          ))}

          {selectedIndex != null && entradaPts[selectedIndex] && (
            <line
              x1={entradaPts[selectedIndex].x}
              x2={entradaPts[selectedIndex].x}
              y1={top}
              y2={top + chartH}
              stroke="var(--brass)"
              strokeWidth="1"
              strokeDasharray="2 6"
              opacity=".55"
            />
          )}

          <path d={entradaPath} fill="none" stroke="var(--moss)" strokeWidth="7" strokeLinecap="round" opacity=".045" />
          <path d={saidaPath} fill="none" stroke="var(--ember)" strokeWidth="7" strokeLinecap="round" opacity=".04" />
          <path d={entradaPath} fill="none" stroke="var(--moss)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d={saidaPath} fill="none" stroke="var(--ember)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {rows.map((row, index) => {
            const x = entradaPts[index]?.x || left;
            const hitWidth = rows.length > 1 ? Math.max(42, step * .9) : chartW;
            return (
              <rect
                key={`hit-${row.key || index}`}
                x={Math.max(left, x - hitWidth / 2)}
                y={top}
                width={Math.min(hitWidth, width - right - Math.max(left, x - hitWidth / 2))}
                height={chartH}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedIndex(index)}
              >
                <title>{`${row.label} · Entradas ${money(row.entrada)} · Saídas ${money(row.saida)}`}</title>
              </rect>
            );
          })}

          {entradaPts.map((point, index) => (
            <g key={`in-${index}`} onClick={() => setSelectedIndex(index)} style={{ cursor: "pointer" }}>
              <circle
                cx={point.x}
                cy={point.y}
                r={selectedIndex === index ? "4.5" : "2.4"}
                fill="var(--surface)"
                stroke="var(--moss)"
                strokeWidth="1.5"
              />
            </g>
          ))}

          {saidaPts.map((point, index) => (
            <g key={`out-${index}`} onClick={() => setSelectedIndex(index)} style={{ cursor: "pointer" }}>
              <circle
                cx={point.x}
                cy={point.y}
                r={selectedIndex === index ? "4.5" : "2.4"}
                fill="var(--surface)"
                stroke="var(--ember)"
                strokeWidth="1.5"
              />
              <text
                x={point.x}
                y={height - 11}
                textAnchor="middle"
                fontSize="9"
                fill="var(--text-faint)"
                style={{ fontFamily: "Poppins, sans-serif" }}
              >
                {point.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {selected ? (
        <div className="finance-chart-tooltip rounded-xl p-3 mt-1.5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="font-medium text-sm capitalize">{selected.label}</p>
            <button className="text-[10px] text-faint" onClick={() => setSelectedIndex(null)}>Fechar</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] text-faint uppercase tracking-widest">Entradas</p>
              <p className="font-mono text-sm text-moss mt-1 break-words">{money(selected.entrada)}</p>
            </div>
            <div>
              <p className="text-[9px] text-faint uppercase tracking-widest">Saídas</p>
              <p className="font-mono text-sm text-ember mt-1 break-words">{money(selected.saida)}</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[9px] text-faint text-center mt-1">Toque em um mês para ver os valores.</p>
      )}

      <div className="flex items-center justify-center gap-5 text-[10px] text-dim mt-2">
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-moss" />Entradas</span>
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-ember" />Saídas</span>
      </div>
    </div>
  );
}

function FinanceBillForm({ initial, onSave, onClose, defaultDueDate = null }) {
  const [description, setDescription] = useState(initial?.description || "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate || defaultDueDate || today());
  const [category, setCategory] = useState(initial?.category || "Contas");

  return (
    <Modal title={initial ? "Editar conta a pagar" : "Nova conta a pagar"} onClose={onClose}>
      <Field label="Descrição">
        <input className="w-full p-3 ring-focus" placeholder="Ex: Internet, aluguel, cartão..." value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Valor (R$)">
          <input type="number" min="0" step="0.01" className="w-full p-3 ring-focus" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Vencimento">
          <input type="date" className="w-full p-3 ring-focus" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Categoria">
        <select className="w-full p-3 ring-focus" value={category} onChange={(e) => setCategory(e.target.value)}>
          {FIN_OUT.filter((x) => x !== "Aporte para meta").map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <button
        disabled={!description.trim() || !value || Number(value) <= 0}
        className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
        onClick={() => onSave({
          ...initial,
          id: initial?.id || uid(),
          description: description.trim(),
          value: Number(value),
          dueDate,
          category,
          status: initial?.status || "pendente",
          createdAt: initial?.createdAt || today(),
          paidAt: initial?.paidAt || null,
        })}
      >
        {initial ? "Salvar alterações" : "Salvar conta"}
      </button>
    </Modal>
  );
}


/* ---------------------------------------------------------------
   CONSTANCCE FINANCIAL INTELLIGENCE ENGINE
   Interpreta a pergunta; os cálculos sempre usam dados reais do app.
----------------------------------------------------------------*/

const FINANCE_CATEGORY_ALIASES = {
  "Alimentação": ["alimentacao", "comida", "mercado", "supermercado", "restaurante", "lanche", "delivery", "ifood", "jantar", "almoco", "cafe"],
  "Transporte": ["transporte", "uber", "99", "taxi", "gasolina", "combustivel", "posto", "estacionamento", "onibus"],
  "Lazer": ["lazer", "cinema", "bar", "festa", "viagem", "jogo", "games", "streaming", "passeio"],
  "Contas": ["conta", "contas", "aluguel", "condominio", "energia", "luz", "agua", "internet", "telefone", "celular", "boleto"],
  "Compras": ["compra", "compras", "shopping", "roupa", "tenis", "eletronico", "amazon", "magalu", "mercado livre"],
  "Educação": ["educacao", "curso", "faculdade", "livro", "escola", "mensalidade", "estudo"],
  "Aporte para meta": ["aporte", "investimento", "guardar", "poupar", "reserva", "meta"],
};

const FINANCE_MONTH_NAMES = {
  janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

const normalizeFinanceText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$.,-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const financeDateString = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const financePeriodLabel = (period) => {
  if (!period) return "período";
  if (period.label) return period.label;
  if (period.start === period.end) return new Date(`${period.start}T12:00:00`).toLocaleDateString("pt-BR");
  return `${new Date(`${period.start}T12:00:00`).toLocaleDateString("pt-BR")} a ${new Date(`${period.end}T12:00:00`).toLocaleDateString("pt-BR")}`;
};

const financeMonthRange = (year, monthIndex) => {
  const start = new Date(year, monthIndex, 1, 12);
  const end = new Date(year, monthIndex + 1, 0, 12);
  return { start: financeDateString(start), end: financeDateString(end) };
};

const financePreviousPeriod = (period) => {
  if (!period) return null;

  const start = new Date(`${period.start}T12:00:00`);
  const end = new Date(`${period.end}T12:00:00`);

  if (start.getDate() === 1 && ["current_month", "selected_month", "named_month", "previous_month"].includes(period.id)) {
    const previousMonth = financeMonthRange(start.getFullYear(), start.getMonth() - 1);
    return {
      id: "previous_calendar_month",
      ...previousMonth,
      label: "mês anterior",
    };
  }

  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);

  return {
    id: "previous_period",
    start: financeDateString(prevStart),
    end: financeDateString(prevEnd),
    label: "período anterior",
  };
};

function detectFinancePeriod(text, fallbackMonth = today().slice(0, 7), contextPeriod = null) {
  const q = normalizeFinanceText(text);
  const now = new Date(`${today()}T12:00:00`);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  if (/\bhoje\b/.test(q)) {
    return { id: "today", start: today(), end: today(), label: "hoje", explicit: true };
  }

  if (/\bontem\b/.test(q)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const date = financeDateString(d);
    return { id: "yesterday", start: date, end: date, label: "ontem", explicit: true };
  }

  if (/anteontem/.test(q)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    const date = financeDateString(d);
    return { id: "before_yesterday", start: date, end: date, label: "anteontem", explicit: true };
  }

  if (/(essa|esta|nesta) semana/.test(q)) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    return {
      id: "current_week",
      start: financeDateString(start),
      end: today(),
      label: "esta semana",
      explicit: true,
    };
  }

  if (/semana passada|ultima semana/.test(q)) {
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - currentStart.getDay());
    const end = new Date(currentStart);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return {
      id: "previous_week",
      start: financeDateString(start),
      end: financeDateString(end),
      label: "semana passada",
      explicit: true,
    };
  }

  const lastDaysMatch = q.match(/ultimos?\s+(\d{1,3})\s+dias?/);
  if (lastDaysMatch) {
    const amount = Math.max(1, Math.min(365, Number(lastDaysMatch[1])));
    const start = new Date(now);
    start.setDate(start.getDate() - amount + 1);
    return {
      id: `last_${amount}_days`,
      start: financeDateString(start),
      end: today(),
      label: `últimos ${amount} dias`,
      explicit: true,
    };
  }

  if (/mes passado|ultimo mes/.test(q)) {
    const range = financeMonthRange(currentYear, currentMonth - 1);
    return { id: "previous_month", ...range, label: "mês passado", explicit: true };
  }

  if (/(esse|este|neste) mes/.test(q)) {
    const range = financeMonthRange(currentYear, currentMonth);
    return { id: "current_month", start: range.start, end: today(), label: "este mês", explicit: true };
  }

  for (const [name, monthIndex] of Object.entries(FINANCE_MONTH_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(q)) {
      const yearMatch = q.match(/\b(20\d{2})\b/);
      let year = yearMatch ? Number(yearMatch[1]) : currentYear;
      if (!yearMatch && monthIndex > currentMonth) year -= 1;
      const range = financeMonthRange(year, monthIndex);
      return { id: "named_month", ...range, label: `${name} de ${year}`, explicit: true };
    }
  }

  // Frases de continuação como "e mês passado?" usam o mesmo assunto,
  // mas detectFinancePeriod já captura o período acima.
  if (contextPeriod && /^(e |e no |e em |e na |e nos |e nas )/.test(q)) {
    return { ...contextPeriod, explicit: false };
  }

  // Sem período explícito: usa o mês que o usuário está visualizando em Finanças.
  const [year, month] = String(fallbackMonth || today().slice(0, 7)).split("-").map(Number);
  const range = financeMonthRange(year, month - 1);
  const isCurrent = fallbackMonth === today().slice(0, 7);
  return {
    id: "selected_month",
    start: range.start,
    end: isCurrent ? today() : range.end,
    label: isCurrent
      ? "este mês"
      : new Date(`${fallbackMonth}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    explicit: false,
  };
}

function detectFinanceCategory(text) {
  const q = normalizeFinanceText(text);
  const candidates = Object.entries(FINANCE_CATEGORY_ALIASES)
    .flatMap(([category, aliases]) =>
      aliases.map((alias) => ({ category, alias: normalizeFinanceText(alias) }))
    )
    .sort((a, b) => b.alias.length - a.alias.length);

  const match = candidates.find(({ alias }) => new RegExp(`\\b${alias}\\b`).test(q));
  return match?.category || null;
}

function detectFinanceGoal(text, goals = []) {
  const q = normalizeFinanceText(text);
  const active = (goals || []).filter((goal) => goal.type === "financeira" && !goal.completed);
  if (!active.length) return null;

  const scored = active
    .map((goal) => {
      const name = normalizeFinanceText(goal.name);
      const nameWords = name.split(" ").filter((word) => word.length >= 3);
      const hits = nameWords.filter((word) => q.includes(word)).length;
      const exact = name && q.includes(name);
      return { goal, score: exact ? 10 : hits };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].goal : null;
}

function detectFinanceSearchTerm(text, transactions = []) {
  const q = normalizeFinanceText(text);
  const stopWords = new Set([
    "quanto","gastei","gasto","gastos","paguei","pago","recebi","entrou","entrada","saida","saidas",
    "esse","este","neste","mes","mês","passado","hoje","ontem","semana","ultima","última","ultimos",
    "dias","com","em","no","na","nos","nas","de","do","da","dos","das","meu","minha","eu","foi",
    "qual","onde","mais","menos","total","valor","dinheiro","tenho","tive",
  ]);

  const knownDescriptions = [...new Set((transactions || []).map((tx) => normalizeFinanceText(tx.description)).filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  const direct = knownDescriptions.find((description) => q.includes(description));
  if (direct) return direct;

  const words = q.split(" ").filter((word) => word.length >= 3 && !stopWords.has(word));
  const candidate = words.find((word) =>
    (transactions || []).some((tx) => normalizeFinanceText(tx.description).includes(word))
  );
  return candidate || null;
}

function financeTransactionsInPeriod(transactions, period) {
  return (transactions || []).filter((tx) => {
    const date = String(tx.date || "");
    return date >= period.start && date <= period.end;
  });
}

function financeSum(rows, type = null) {
  return (rows || [])
    .filter((row) => !type || row.type === type)
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
}

function financeCategorySummary(rows) {
  const map = new Map();
  rows
    .filter((row) => row.type === "saida")
    .forEach((row) => {
      const key = row.category || "Outro";
      map.set(key, (map.get(key) || 0) + Number(row.value || 0));
    });
  return [...map.entries()]
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => b.value - a.value);
}

function financeDescriptionSummary(rows) {
  const map = new Map();
  rows
    .filter((row) => row.type === "saida")
    .forEach((row) => {
      const description = String(row.description || row.category || "Sem descrição").trim();
      const key = description || "Sem descrição";
      map.set(key, (map.get(key) || 0) + Number(row.value || 0));
    });
  return [...map.entries()]
    .map(([description, value]) => ({ description, value }))
    .sort((a, b) => b.value - a.value);
}

function computeFinanceProjectionForMonth({
  month,
  transactions,
  bills,
  recurring,
  monthlyLimit,
}) {
  const key = month || today().slice(0, 7);
  const rows = (transactions || []).filter((tx) => String(tx.date || "").slice(0, 7) === key);
  const monthIn = financeSum(rows.filter((tx) => tx.type === "entrada"));
  const monthOut = financeSum(rows.filter((tx) => tx.type === "saida"));

  const [year, monthNumber] = key.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const isCurrentMonth = key === today().slice(0, 7);
  const elapsedDays = isCurrentMonth ? Math.max(1, new Date().getDate()) : daysInMonth;

  const activeRecurring = (recurring || []).filter(
    (item) =>
      item.active !== false &&
      (!item.createdAt || String(item.createdAt).slice(0, 7) <= key)
  );

  const postedRecurringIds = new Set(rows.filter((tx) => tx.recurringId).map((tx) => tx.recurringId));
  const missingRecurring = isCurrentMonth
    ? activeRecurring.filter((item) => !postedRecurringIds.has(item.id))
    : [];

  const postedRecurringOut = rows
    .filter((tx) => tx.type === "saida" && tx.recurringId)
    .reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  // Contas a pagar já quitadas neste mês (têm billId) são um valor certo que
  // já aconteceu, não um ritmo de gasto do dia a dia. Se entrarem no cálculo
  // de "gasto variável", o projetor as multiplica pelos dias restantes do mês
  // como se você fosse pagar aquele boleto todo santo dia — daí a projeção
  // vinha muito distorcida sempre que uma conta grande era paga cedo no mês.
  const postedBillsOut = rows
    .filter((tx) => tx.type === "saida" && tx.billId)
    .reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  const futureRecurringOut = missingRecurring
    .filter((item) => item.type === "saida")
    .reduce((sum, item) => sum + Number(item.value || 0), 0);

  const futureRecurringIn = missingRecurring
    .filter((item) => item.type === "entrada")
    .reduce((sum, item) => sum + Number(item.value || 0), 0);

  const pendingBills = (bills || [])
    .filter((bill) => bill.status !== "pago" && String(bill.dueDate || "").slice(0, 7) === key)
    .reduce((sum, bill) => sum + Number(bill.value || 0), 0);

  // Nos primeiros dias do mês, extrapolar pelo número real de dias já
  // passados amplifica qualquer gasto de forma extrema (no dia 1, um multiplicador
  // de 30x). Limitamos a base da extrapolação a pelo menos 20% do mês, o que
  // trava o multiplicador em no máximo 5x — a projeção fica mais conservadora
  // logo no início e se aproxima do ritmo real conforme os dias passam.
  const extrapolationDays = Math.max(elapsedDays, Math.round(daysInMonth * 0.2));
  const variableSpent = Math.max(0, monthOut - postedRecurringOut - postedBillsOut);
  const projectedVariableOut = isCurrentMonth
    ? (variableSpent / extrapolationDays) * daysInMonth
    : variableSpent;

  const projectedOut = projectedVariableOut + postedRecurringOut + postedBillsOut + futureRecurringOut + pendingBills;
  const projectedIn = monthIn + futureRecurringIn;
  const projectedBalance = projectedIn - projectedOut;
  const limit = Number(monthlyLimit || 0);

  return {
    monthIn,
    monthOut,
    projectedIn,
    projectedOut,
    projectedBalance,
    availableToSpend: limit > 0
      ? Math.max(0, limit - monthOut)
      : Math.max(0, monthIn - monthOut),
  };
}

const FINANCE_INTENT_RULES = [
  {
    id: "goals_overview",
    confidence: .97,
    patterns: [/(como estao|como vao).*(metas?)/, /(resumo|situacao).*(metas?)/],
  },
  {
    id: "goal_projection",
    confidence: .94,
    patterns: [/(vou|consigo|conseguirei).*(bater|atingir|chegar).*(meta)/, /(meta).*(vou|consigo).*(bater|atingir|chegar)/],
  },
  {
    id: "goal_monthly_needed",
    confidence: .96,
    patterns: [/(quanto).*(guardar|aportar|poupar).*(mes).*(meta)?/, /(meta).*(quanto).*(mes)/],
  },
  {
    id: "balance_diagnosis",
    confidence: .90,
    patterns: [/(por que|porque).*(saldo|sobra).*(caiu|diminuiu|baixou)/, /(saldo|sobra).*(caiu|diminuiu|baixou)/],
  },
  {
    id: "expense_diagnosis",
    confidence: .90,
    patterns: [/(onde).*(desperdic|gastando demais|gasto demais)/, /(o que).*(aumentou|subiu).*(gasto|despesa)/, /(qual).*(categoria).*(aumentou|subiu)/],
  },

  {
    id: "goals_count",
    confidence: .98,
    patterns: [/quantas?.*metas?/, /mais de (uma|1).*meta/, /metas?.*(tenho|possuo)/],
  },
  {
    id: "goals_list",
    confidence: .96,
    patterns: [/(quais|lista|listar|mostra|mostrar).*(metas?)/, /metas?.*(quais|lista|listar|mostra|mostrar)/],
  },
  {
    id: "goal_remaining",
    confidence: .96,
    patterns: [/(quanto falta|falta quanto).*(meta)/, /meta.*(quanto falta|falta quanto)/],
  },
  {
    id: "goal_progress",
    confidence: .94,
    patterns: [/(como esta|progresso|andamento|quanto tenho).*(meta)/, /meta.*(como esta|progresso|andamento|quanto tenho)/],
  },
  {
    id: "bills_overdue",
    confidence: .98,
    patterns: [/(conta|boleto).*(atrasad|vencid)/, /(atrasad|vencid).*(conta|boleto)/],
  },
  {
    id: "next_bill",
    confidence: .97,
    patterns: [/(proxima|próxima).*(conta|boleto)/, /(conta|boleto).*(proxima|próxima)/],
  },
  {
    id: "bills_due",
    confidence: .94,
    patterns: [/(contas?|boletos?).*(venc|proxim)/, /(venc|proxim).*(contas?|boletos?)/],
  },
  {
    id: "bills_total",
    confidence: .93,
    patterns: [/(quanto|total).*(contas?|boletos?).*(pagar|pendente)/, /(contas?|boletos?).*(quanto|total)/],
  },
  {
    id: "month_forecast",
    confidence: .97,
    patterns: [/como.*(fecha|fechamento).*(mes)?/, /(projecao|projeção|fim do mes|final do mes)/],
  },
  {
    id: "available_budget",
    confidence: .96,
    patterns: [/quanto.*(posso|ainda posso).*(gastar)/, /(disponivel|disponível).*(gastar|limite)/, /quanto.*livre/],
  },
  {
    id: "compare_income",
    confidence: .94,
    patterns: [/(recebi|entrada|receita).*(mais|menos).*(mes passado|periodo anterior)/, /compar.*(entrada|receita)/],
  },
  {
    id: "savings_total",
    confidence: .93,
    patterns: [/(quanto).*(economizei|guardei|poupei)/, /(economizei|guardei|poupei).*(quanto)?/],
  },
  {
    id: "compare_expenses",
    confidence: .95,
    patterns: [/(gastei|gastando|gastos?|despesas?).*(mais|menos).*(mes passado|periodo anterior)/, /(mais|menos).*(gasto|despesa)/, /compar.*(gasto|despesa)/],
  },
  {
    id: "top_category",
    confidence: .95,
    patterns: [/(onde|categoria).*(gasto|gasta|gastos).*(mais)?/, /(gasto|gastos).*mais/, /maior.*(gasto|categoria)/],
  },
  {
    id: "top_expense",
    confidence: .93,
    patterns: [/(maior|pior).*(compra|gasto|despesa)/, /(gasto|despesa).*(maior|mais caro)/],
  },
  {
    id: "category_expense",
    confidence: .94,
    patterns: [/quanto.*(gastei|gasto|paguei).*(com|em)/, /(gastei|gasto).*(alimentacao|comida|transporte|uber|gasolina|lazer|conta|compras|educacao|ifood)/],
  },
  {
    id: "expense_total",
    confidence: .90,
    patterns: [/(quanto|total).*(gastei|gasto|gastos|paguei|saidas?|despesas?)/, /(gastei|paguei).*(quanto)/],
  },
  {
    id: "income_total",
    confidence: .92,
    patterns: [/(quanto|total).*(recebi|entrou|entradas?|receita)/, /(recebi|entrou).*(quanto)/],
  },
  {
    id: "balance",
    confidence: .92,
    patterns: [/(saldo|sobrou|sobra|diferenca|diferença)/],
  },
  {
    id: "recurring_expenses",
    confidence: .94,
    patterns: [/(gastos?|despesas?).*(recorrente|fixo)/, /(recorrente|fixo).*(gasto|despesa)/],
  },
  {
    id: "recurring_income",
    confidence: .94,
    patterns: [/(receitas?|entradas?).*(recorrente|fixa)/, /(recorrente|fixa).*(receita|entrada)/],
  },
];

function detectFinanceIntent(text, context = null) {
  const q = normalizeFinanceText(text);

  if (context?.goal && /quanto falta/.test(q)) {
    return { intent: "goal_remaining", confidence: .90, source: "context" };
  }
  if (context?.goal && /(quanto).*(guardar|aportar|poupar).*(mes)/.test(q)) {
    return { intent: "goal_monthly_needed", confidence: .90, source: "context" };
  }
  if (context?.goal && /(vou|consigo).*(bater|atingir|chegar)/.test(q)) {
    return { intent: "goal_projection", confidence: .88, source: "context" };
  }

  for (const rule of FINANCE_INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(q))) {
      return { intent: rule.id, confidence: rule.confidence, source: "direct" };
    }
  }

  // Continuação contextual: "e mês passado?", "e hoje?", "e alimentação?"
  const continuation = /^(e\b|e no\b|e na\b|e em\b|e a\b|e o\b|e esse\b|e este\b|e mes\b|e hoje\b|e ontem\b)/.test(q);
  if (continuation && context?.intent) {
    return { intent: context.intent, confidence: .78, source: "context" };
  }

  return { intent: null, confidence: .25, source: "none" };
}

function executeFinanceIntelligence({
  question,
  transactions,
  goals,
  bills,
  recurring,
  monthlyLimit,
  budgets,
  selectedMonth,
  projectedBalance,
  availableToSpend,
  context,
}) {
  const q = normalizeFinanceText(question);
  const intentResult = detectFinanceIntent(q, context);
  let period = detectFinancePeriod(q, selectedMonth, context?.period);

  // "Estou gastando mais que mês passado?" compara o mês atual contra o mês passado,
  // e não o mês passado contra dois meses atrás.
  if (["compare_expenses", "compare_income"].includes(intentResult.intent) && /mes passado/.test(q)) {
    const currentRange = financeMonthRange(new Date().getFullYear(), new Date().getMonth());
    period = {
      id: "current_month",
      start: currentRange.start,
      end: today(),
      label: "este mês",
      explicit: true,
    };
  }

  const category = detectFinanceCategory(q) || (intentResult.source === "context" ? context?.category : null);
  const goal = detectFinanceGoal(q, goals) || (intentResult.source === "context" ? context?.goal : null);
  const searchTerm = detectFinanceSearchTerm(q, transactions) || (intentResult.source === "context" ? context?.searchTerm : null);
  let { intent, confidence } = intentResult;

  // Uma descrição/estabelecimento cadastrado é mais específico que uma categoria,
  // mas nunca pode sobrescrever perguntas sobre metas, contas ou projeções.
  const canResolveAsExpense = !intent || ["expense_total", "category_expense"].includes(intent);

  if (category && intent === "available_budget") {
    intent = "category_budget";
    confidence = Math.max(confidence, .95);
  } else if (canResolveAsExpense && searchTerm && /(gasto|gastei|paguei|quanto|despesa)/.test(q)) {
    intent = "merchant_expense";
    confidence = Math.max(confidence, .91);
  } else if (canResolveAsExpense && category && /(gasto|gastei|paguei|quanto|despesa)/.test(q)) {
    intent = "category_expense";
    confidence = Math.max(confidence, .93);
  }

  const periodRows = financeTransactionsInPeriod(transactions, period);
  const expenses = periodRows.filter((tx) => tx.type === "saida");
  const incomes = periodRows.filter((tx) => tx.type === "entrada");
  const activeGoals = (goals || []).filter((item) => item.type === "financeira" && !item.completed);
  const pendingBills = (bills || []).filter((bill) => bill.status !== "pago");
  const nowDate = today();

  const resultContext = {
    intent,
    period,
    category,
    goal,
    searchTerm,
  };

  const fail = (message = "Não consigo te ajudar com essa pergunta no momento.", nextConfidence = confidence) => ({
    ok: false,
    answer: message,
    confidence: nextConfidence,
    intent,
    context: resultContext,
  });

  const success = (answer, meta = {}) => ({
    ok: true,
    answer,
    confidence,
    intent,
    context: resultContext,
    meta,
  });

  if (!intent || confidence < .55) return fail();

  switch (intent) {
    case "goals_overview": {
      if (!activeGoals.length) return success("Você não tem nenhuma meta financeira ativa.");

      if (activeGoals.length === 1) {
        const item = activeGoals[0];
        const current = Number(item.current || 0);
        const target = Number(item.target || 0);
        const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
        return success(`Sua meta ${item.name} está em ${pct}%.`);
      }

      const summary = activeGoals
        .slice(0, 3)
        .map((item) => {
          const current = Number(item.current || 0);
          const target = Number(item.target || 0);
          const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
          return `${item.name} ${pct}%`;
        })
        .join(" · ");

      return success(`Você tem ${activeGoals.length} metas ativas. ${summary}.`);
    }

    case "goal_projection": {
      const targetGoal = goal || (activeGoals.length === 1 ? activeGoals[0] : null);
      if (!targetGoal && activeGoals.length > 1) {
        return fail("Me diga qual meta você quer projetar.", .82);
      }
      if (!targetGoal) return success("Você não tem nenhuma meta financeira ativa.");

      const remaining = Math.max(0, Number(targetGoal.target || 0) - Number(targetGoal.current || 0));
      if (remaining <= 0) return success(`A meta ${targetGoal.name} já foi atingida.`);
      if (!targetGoal.endDate) {
        return fail(`A meta ${targetGoal.name} não tem uma data final. Sem isso, não consigo fazer a projeção.`, .88);
      }

      const months = monthsUntilGoal(targetGoal.endDate);
      const needed = remaining / Math.max(1, months);
      const projection = computeFinanceProjectionForMonth({
        month: today().slice(0, 7),
        transactions,
        bills,
        recurring,
        monthlyLimit,
      });

      if (projection.projectedBalance >= needed) {
        return success(`Sim. A meta ${targetGoal.name} parece viável. Você precisa de cerca de ${money(needed)} por mês.`);
      }

      return success(`No ritmo atual, a meta ${targetGoal.name} está apertada. Você precisa de cerca de ${money(needed)} por mês.`);
    }

    case "goal_monthly_needed": {
      const targetGoal = goal || (activeGoals.length === 1 ? activeGoals[0] : null);
      if (!targetGoal && activeGoals.length > 1) {
        return fail("Me diga para qual meta você quer calcular o valor mensal.", .82);
      }
      if (!targetGoal) return success("Você não tem nenhuma meta financeira ativa.");
      if (!targetGoal.endDate) {
        return fail(`A meta ${targetGoal.name} não tem data final. Não consigo calcular o valor mensal sem essa data.`, .88);
      }

      return success(`Para atingir ${targetGoal.name} no prazo, você precisa de aproximadamente ${money(monthlyGoalEstimate(targetGoal))} por mês.`);
    }

    case "balance_diagnosis": {
      const previousPeriod = financePreviousPeriod(period);
      const previousRows = financeTransactionsInPeriod(transactions, previousPeriod);

      const currentIn = financeSum(periodRows, "entrada");
      const currentOut = financeSum(periodRows, "saida");
      const previousIn = financeSum(previousRows, "entrada");
      const previousOut = financeSum(previousRows, "saida");

      const incomeChange = currentIn - previousIn;
      const expenseChange = currentOut - previousOut;

      if (expenseChange > 0 && Math.abs(expenseChange) >= Math.abs(incomeChange)) {
        const currentCategories = financeCategorySummary(periodRows);
        const previousCategories = financeCategorySummary(previousRows);

        const changes = currentCategories
          .map((item) => {
            const before = previousCategories.find((row) => row.category === item.category)?.value || 0;
            return { category: item.category, delta: item.value - before };
          })
          .sort((a, b) => b.delta - a.delta);

        const driver = changes[0];
        if (driver?.delta > 0) {
          return success(`Sua sobra caiu principalmente porque ${driver.category} aumentou ${money(driver.delta)}.`);
        }

        return success(`Sua sobra caiu porque seus gastos aumentaram ${money(expenseChange)}.`);
      }

      if (incomeChange < 0) {
        return success(`Sua sobra caiu principalmente porque suas entradas diminuíram ${money(Math.abs(incomeChange))}.`);
      }

      return success("Não encontrei uma mudança forte o suficiente para apontar um único motivo.");
    }

    case "expense_diagnosis": {
      const previousPeriod = financePreviousPeriod(period);
      const previousRows = financeTransactionsInPeriod(transactions, previousPeriod);
      const currentCategories = financeCategorySummary(periodRows);
      const previousCategories = financeCategorySummary(previousRows);

      const changes = currentCategories
        .map((item) => {
          const previousValue = previousCategories.find((row) => row.category === item.category)?.value || 0;
          return {
            category: item.category,
            current: item.value,
            previous: previousValue,
            delta: item.value - previousValue,
          };
        })
        .sort((a, b) => b.delta - a.delta);

      const top = changes[0];

      if (!top || top.delta <= 0) {
        const ranking = financeCategorySummary(periodRows);
        if (!ranking.length) return success("Ainda não há gastos suficientes para fazer esse diagnóstico.");
        return success(`Seu maior gasto está em ${ranking[0].category}: ${money(ranking[0].value)}.`);
      }

      return success(`${top.category} foi a maior alta: ${money(top.delta)} a mais que no período anterior.`);
    }

    case "goals_count": {
      if (activeGoals.length === 0) return success("Você não tem nenhuma meta financeira ativa.");
      if (activeGoals.length === 1) return success(`Você tem 1 meta financeira ativa: ${activeGoals[0].name}.`);
      return success(`Você tem ${activeGoals.length} metas financeiras ativas.`);
    }

    case "goals_list": {
      if (!activeGoals.length) return success("Você não tem nenhuma meta financeira ativa.");
      return success(`Suas metas ativas são: ${activeGoals.map((item) => item.name).join(", ")}.`);
    }

    case "goal_progress":
    case "goal_remaining": {
      const targetGoal = goal || (activeGoals.length === 1 ? activeGoals[0] : null);
      if (!targetGoal && activeGoals.length > 1) {
        return fail("Você tem mais de uma meta. Me diga o nome da meta que quer consultar.", .82);
      }
      if (!targetGoal) return success("Você não tem nenhuma meta financeira ativa.");

      const current = Number(targetGoal.current || 0);
      const target = Number(targetGoal.target || 0);
      const remaining = Math.max(0, target - current);
      const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

      if (intent === "goal_remaining") {
        return success(`Faltam ${money(remaining)} para a meta ${targetGoal.name}.`);
      }
      return success(`${targetGoal.name}: ${pct}% concluída. Você tem ${money(current)} de ${money(target)}.`);
    }

    case "expense_total": {
      return success(`Você gastou ${money(financeSum(expenses))} ${financePeriodLabel(period)}.`);
    }

    case "income_total": {
      return success(`Entrou ${money(financeSum(incomes))} ${financePeriodLabel(period)}.`);
    }

    case "balance": {
      const balance = financeSum(incomes) - financeSum(expenses);
      return success(
        balance >= 0
          ? `Seu saldo em ${financePeriodLabel(period)} está positivo em ${money(balance)}.`
          : `Seu saldo em ${financePeriodLabel(period)} está negativo em ${money(Math.abs(balance))}.`
      );
    }

    case "category_expense": {
      if (!category) return fail("Qual categoria você quer consultar? Ex.: Alimentação, Transporte ou Contas.", .72);
      const rows = expenses.filter((tx) => tx.category === category);
      return success(`Você gastou ${money(financeSum(rows))} com ${category} ${financePeriodLabel(period)}.`);
    }

    case "merchant_expense": {
      if (!searchTerm) return fail();
      const rows = expenses.filter((tx) => normalizeFinanceText(tx.description).includes(searchTerm));
      const display = rows[0]?.description || searchTerm;
      return success(`Você gastou ${money(financeSum(rows))} com ${display} ${financePeriodLabel(period)}.`);
    }

    case "top_category": {
      const ranking = financeCategorySummary(expenses);
      if (!ranking.length) return success(`Você ainda não registrou gastos ${financePeriodLabel(period)}.`);
      const top = ranking[0];
      return success(`Sua maior categoria é ${top.category}: ${money(top.value)} ${financePeriodLabel(period)}.`);
    }

    case "top_expense": {
      const ranking = financeDescriptionSummary(expenses);
      if (!ranking.length) return success(`Você ainda não registrou gastos ${financePeriodLabel(period)}.`);
      const top = ranking[0];
      return success(`Seu maior gasto foi ${top.description}: ${money(top.value)} ${financePeriodLabel(period)}.`);
    }

    case "compare_income": {
      const previous = financePreviousPeriod(period);
      const currentValue = financeSum(incomes);
      const previousValue = financeSum(
        financeTransactionsInPeriod(transactions, previous).filter((tx) => tx.type === "entrada")
      );
      const diff = currentValue - previousValue;

      if (previousValue === 0 && currentValue === 0) {
        return success("Não há entradas suficientes para comparar esses períodos.");
      }
      if (diff === 0) return success(`Suas entradas ficaram iguais: ${money(currentValue)}.`);
      if (diff > 0) return success(`Você recebeu ${money(diff)} a mais que no período anterior.`);
      return success(`Você recebeu ${money(Math.abs(diff))} a menos que no período anterior.`);
    }

    case "savings_total": {
      const saved = financeSum(incomes) - financeSum(expenses);
      if (saved > 0) return success(`Você economizou ${money(saved)} ${financePeriodLabel(period)}.`);
      if (saved === 0) return success(`Você ficou no zero a zero ${financePeriodLabel(period)}.`);
      return success(`Não houve economia líquida. O período ficou negativo em ${money(Math.abs(saved))}.`);
    }

    case "category_budget": {
      if (!category) return fail("Qual categoria você quer consultar?", .72);
      const budget = Number(budgets?.[category] || 0);
      if (budget <= 0) {
        return fail(`Você ainda não definiu um orçamento para ${category}.`, .86);
      }
      const spent = financeSum(expenses.filter((tx) => tx.category === category));
      const remaining = Math.max(0, budget - spent);
      return success(`Você ainda pode gastar ${money(remaining)} em ${category} dentro do orçamento atual.`);
    }

    case "compare_expenses": {
      const previous = financePreviousPeriod(period);
      const currentValue = financeSum(expenses);
      const previousValue = financeSum(financeTransactionsInPeriod(transactions, previous).filter((tx) => tx.type === "saida"));
      const diff = currentValue - previousValue;

      if (previousValue === 0 && currentValue === 0) {
        return success("Não há gastos suficientes para comparar esses períodos.");
      }
      if (diff === 0) return success(`Seus gastos ficaram iguais: ${money(currentValue)}.`);
      if (diff > 0) return success(`Você gastou ${money(diff)} a mais que no período anterior.`);
      return success(`Você gastou ${money(Math.abs(diff))} a menos que no período anterior.`);
    }

    case "bills_overdue": {
      const overdue = pendingBills
        .filter((bill) => bill.dueDate && bill.dueDate < nowDate)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

      if (!overdue.length) return success("Você não tem contas vencidas.");
      const total = overdue.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
      return success(`Você tem ${overdue.length} conta${overdue.length === 1 ? "" : "s"} vencida${overdue.length === 1 ? "" : "s"}, somando ${money(total)}.`);
    }

    case "next_bill": {
      const future = pendingBills
        .filter((bill) => bill.dueDate && bill.dueDate >= nowDate)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      if (!future.length) return success("Você não tem nenhuma conta futura pendente.");
      const next = future[0];
      return success(`Sua próxima conta é ${next.description}: ${money(next.value)}, vencendo em ${new Date(`${next.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}.`);
    }

    case "bills_due": {
      const future = pendingBills
        .filter((bill) => bill.dueDate && bill.dueDate >= nowDate)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      if (!future.length) return success("Você não tem contas futuras pendentes.");
      const nextSeven = future.filter((bill) => {
        const days = Math.ceil((new Date(`${bill.dueDate}T12:00:00`) - new Date(`${nowDate}T12:00:00`)) / 86400000);
        return days <= 7;
      });
      if (!nextSeven.length) return success("Você não tem contas vencendo nos próximos 7 dias.");
      const total = nextSeven.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
      return success(`${nextSeven.length} conta${nextSeven.length === 1 ? "" : "s"} vence${nextSeven.length === 1 ? "" : "m"} nos próximos 7 dias: ${money(total)}.`);
    }

    case "bills_total": {
      const total = pendingBills.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
      return success(`Você tem ${money(total)} em contas pendentes.`);
    }

    case "month_forecast": {
      const projection = computeFinanceProjectionForMonth({
        month: period.start.slice(0, 7),
        transactions,
        bills,
        recurring,
        monthlyLimit,
      });

      return success(
        projection.projectedBalance >= 0
          ? `Mantendo o ritmo atual, você fecha o mês com aproximadamente ${money(projection.projectedBalance)} positivo.`
          : `Mantendo o ritmo atual, você fecha o mês com aproximadamente ${money(Math.abs(projection.projectedBalance))} negativo.`
      );
    }

    case "available_budget": {
      if (Number(monthlyLimit || 0) <= 0) {
        return fail("Defina um limite mensal para eu calcular quanto ainda pode gastar.", .8);
      }

      const projection = computeFinanceProjectionForMonth({
        month: period.start.slice(0, 7),
        transactions,
        bills,
        recurring,
        monthlyLimit,
      });

      return success(`Você ainda pode gastar aproximadamente ${money(projection.availableToSpend)} dentro do limite atual.`);
    }

    case "recurring_expenses": {
      const rows = (recurring || []).filter((item) => item.active !== false && item.type === "saida");
      if (!rows.length) return success("Você não tem despesas recorrentes cadastradas.");
      const total = rows.reduce((sum, item) => sum + Number(item.value || 0), 0);
      return success(`Suas despesas recorrentes somam ${money(total)} por mês.`);
    }

    case "recurring_income": {
      const rows = (recurring || []).filter((item) => item.active !== false && item.type === "entrada");
      if (!rows.length) return success("Você não tem receitas recorrentes cadastradas.");
      const total = rows.reduce((sum, item) => sum + Number(item.value || 0), 0);
      return success(`Suas receitas recorrentes somam ${money(total)} por mês.`);
    }

    default:
      return fail();
  }
}

function FinanceProAssistant({
  transactions,
  financialGoals,
  financeBills,
  financeRecurring,
  monthlyLimit,
  financeBudgets,
  selectedMonth,
  projectedBalance,
  availableToSpend,
}) {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState([]);
  const [assistantContext, setAssistantContext] = useState(null);

  const runQuestion = (raw) => {
    const clean = String(raw || "").trim();
    if (!clean) return;

    const result = executeFinanceIntelligence({
      question: clean,
      transactions,
      goals: financialGoals,
      bills: financeBills,
      recurring: financeRecurring,
      monthlyLimit,
      budgets: financeBudgets,
      selectedMonth,
      projectedBalance,
      availableToSpend,
      context: assistantContext,
    });

    setAssistantContext(result.context || assistantContext);
    setConversation((current) => [
      ...current,
      {
        id: uid(),
        question: clean,
        answer: result.answer,
        confidence: result.confidence,
        intent: result.intent,
      },
    ].slice(-6));
    setQuestion("");
  };

  const prompts = [
    "Quanto gastei este mês?",
    "Onde gasto mais?",
    "Como estão minhas metas?",
    "Tenho contas próximas?",
    "Como fecha o mês?",
  ];

  return (
    <div className="finance-assistant surface rounded-2xl p-4 md:p-5" style={{ borderColor: "var(--brass-dim)" }}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BrainCircuit size={16} className="text-brass" />
            <p className="text-xs text-faint uppercase tracking-widest">Financial Intelligence</p>
            <ProBadge compact />
            <span className="chip">Engine interno</span>
          </div>
          <p className="text-dim text-xs mt-1">
            Pergunte normalmente. O Constancce interpreta a pergunta e calcula a resposta usando somente seus dados reais.
          </p>
        </div>
        {conversation.length > 0 && (
          <button
            className="text-[10px] text-faint hover:text-dim self-start"
            onClick={() => {
              setConversation([]);
              setAssistantContext(null);
            }}
          >
            Limpar conversa
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            className="chip hover:text-brass"
            onClick={() => runQuestion(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      {conversation.length > 0 && (
        <div className="finance-intelligence-conversation rounded-2xl p-3 mb-3">
          <div className="flex flex-col gap-3">
            {conversation.map((turn) => (
              <div key={turn.id}>
                <p className="text-[10px] text-faint mb-1">Você</p>
                <p className="text-xs text-dim break-words">{turn.question}</p>
                <div className="finance-intelligence-answer rounded-xl p-3 mt-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Constancce</p>
                    {turn.confidence >= .85 && <span className="text-[8px] text-moss">dados confirmados</span>}
                  </div>
                  <p className="text-sm leading-relaxed break-words">{turn.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          className="flex-1 min-w-0 p-3 ring-focus"
          placeholder='Ex: "Quanto gastei no iFood mês passado?"'
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") runQuestion(question);
          }}
        />
        <button className="btn-primary rounded-xl px-4 py-2.5 text-sm shrink-0" onClick={() => runQuestion(question)}>
          Perguntar
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
        <div className="surface-2 rounded-xl p-2.5">
          <p className="text-[9px] text-faint uppercase tracking-widest">Interpreta</p>
          <p className="text-[10px] text-dim mt-1">intenção, período, categoria e meta</p>
        </div>
        <div className="surface-2 rounded-xl p-2.5">
          <p className="text-[9px] text-faint uppercase tracking-widest">Calcula</p>
          <p className="text-[10px] text-dim mt-1">direto dos registros financeiros</p>
        </div>
        <div className="surface-2 rounded-xl p-2.5">
          <p className="text-[9px] text-faint uppercase tracking-widest">Contexto</p>
          <p className="text-[10px] text-dim mt-1">entende continuações da conversa</p>
        </div>
      </div>

      <p className="text-[9px] text-faint mt-3">
        Se a pergunta não puder ser respondida com segurança, o assistente informa que não consegue ajudar naquele momento.
      </p>
    </div>
  );
}

function FinanceView({ transactions, addTransaction, addGoalProgress, deleteTransaction, removeTransactionRecord, profile, setProfile, goals, autoOpen, isPro, onUpgrade }) {
  const [confirm, confirmDialog] = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [showBillForm, setShowBillForm] = useState(false);
  const [editingBill, setEditingBill] = useState(null);
  const [presetType, setPresetType] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [editingBudgets, setEditingBudgets] = useState(false);
  const [editingMonthlyLimit, setEditingMonthlyLimit] = useState(false);
  const [launchFilter, setLaunchFilter] = useState("all");
  const [launchTypeFilter, setLaunchTypeFilter] = useState("all");
  const [launchDateFilter, setLaunchDateFilter] = useState("");
  const [launchSearch, setLaunchSearch] = useState("");
  const [financeSection, setFinanceSection] = useState("overview");
  const [duplicatePending, setDuplicatePending] = useState(null);
  const freeFinanceLimitReached = !isPro && transactions.length >= PRO_LIMITS.financeTransactions;
  const requestFinanceRecord = () => {
    if (!freeFinanceLimitReached) return true;
    onUpgrade("finance");
    return false;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.querySelector(".app-main")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    });
  }, [financeSection]);

  useEffect(() => {
    if (autoOpen) {
      setFinanceSection("launches");
      setPresetType(autoOpen);
      if (!isPro && transactions.length >= PRO_LIMITS.financeTransactions) {
        onUpgrade("finance");
        return;
      }
      setShowForm(true);
    }
  }, [autoOpen]);

  const selectedDate = new Date(`${selectedMonth}-01T12:00:00`);
  const monthLabel = selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthLabelDisplay = monthLabel ? `${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)}` : "";
  const monthTx = transactions.filter((tx) => String(tx.date || "").slice(0, 7) === selectedMonth);

  const monthIn = monthTx.filter((tx) => tx.type === "entrada").reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const monthOut = monthTx.filter((tx) => tx.type === "saida").reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const monthBalance = monthIn - monthOut;
  const savingsPct = monthIn > 0 ? Math.max(0, Math.round((monthBalance / monthIn) * 100)) : 0;
  const incomeCommittedPct = monthIn > 0 ? Math.max(0, Math.round((monthOut / monthIn) * 100)) : 0;

  const previousDate = new Date(selectedDate);
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`;
  const previousTx = transactions.filter((tx) => String(tx.date || "").slice(0, 7) === previousKey);
  const previousIn = previousTx.filter((tx) => tx.type === "entrada").reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const previousOut = previousTx.filter((tx) => tx.type === "saida").reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  // Enquanto o mês selecionado ainda está em andamento, comparar o total do
  // mês anterior inteiro contra só os dias já passados deste mês distorce o
  // número (fica sempre perto de -100% no início do mês). Nesse caso,
  // comparamos só até o mesmo dia do mês anterior.
  const isCurrentMonthView = selectedMonth === monthKey(today());
  const dayOfMonthCutoff = isCurrentMonthView ? Number(today().slice(8, 10)) : null;
  const previousOutComparable = isCurrentMonthView
    ? previousTx.filter((tx) => tx.type === "saida" && Number(String(tx.date || "").slice(8, 10)) <= dayOfMonthCutoff)
        .reduce((sum, tx) => sum + Number(tx.value || 0), 0)
    : previousOut;
  const outDeltaPct = previousOutComparable > 0 ? Math.round(((monthOut - previousOutComparable) / previousOutComparable) * 100) : null;
  const inDeltaPct = previousIn > 0 ? Math.round(((monthIn - previousIn) / previousIn) * 100) : null;

  const recurringItems = profile?.financeRecurring || [];
  const activeRecurring = recurringItems.filter((item) => item.active !== false);
  const currentMonthKey = today().slice(0, 7);
  const isPastMonth = selectedMonth < currentMonthKey;
  const applicableRecurring = activeRecurring.filter((item) => !item.createdAt || String(item.createdAt).slice(0, 7) <= selectedMonth);
  const postedRecurringIds = new Set(monthTx.filter((tx) => tx.recurringId).map((tx) => tx.recurringId));
  const missingRecurring = isPastMonth ? [] : applicableRecurring.filter((item) => !postedRecurringIds.has(item.id));
  const futureRecurringOut = missingRecurring.filter((item) => item.type === "saida").reduce((sum, item) => sum + Number(item.value || 0), 0);
  const futureRecurringIn = missingRecurring.filter((item) => item.type === "entrada").reduce((sum, item) => sum + Number(item.value || 0), 0);
  const postedRecurringOut = monthTx.filter((tx) => tx.type === "saida" && tx.recurringId).reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  // Contas a pagar já quitadas neste mês (têm billId) são um valor certo que já
  // aconteceu, não ritmo de gasto do dia a dia — não pode entrar no cálculo de
  // "gasto variável" abaixo, senão o projetor multiplica o valor da conta pelos
  // dias restantes do mês, como se ela se repetisse todo dia.
  const postedBillsOut = monthTx.filter((tx) => tx.type === "saida" && tx.billId).reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  const daysInMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
  const isCurrentMonth = selectedMonth === currentMonthKey;
  const elapsedDays = isCurrentMonth ? Math.max(1, new Date().getDate()) : daysInMonth;
  // Ver comentário equivalente em computeFinanceProjectionForMonth: sem esse piso,
  // a projeção do dia 1 multiplica qualquer gasto por até 30x.
  const extrapolationDays = Math.max(elapsedDays, Math.round(daysInMonth * 0.2));
  const variableSpent = Math.max(0, monthOut - postedRecurringOut - postedBillsOut);
  const projectedVariableOut = isCurrentMonth ? (variableSpent / extrapolationDays) * daysInMonth : variableSpent;
  const pendingBillsForMonth = (profile?.financeBills || [])
    .filter((bill) => bill.status !== "pago" && monthKey(bill.dueDate) === selectedMonth)
    .reduce((sum, bill) => sum + Number(bill.value || 0), 0);
  const projectedOut = projectedVariableOut + postedRecurringOut + postedBillsOut + futureRecurringOut + pendingBillsForMonth;
  const projectedIn = monthIn + futureRecurringIn;
  const projectedBalance = projectedIn - projectedOut;

  const byCategory = FIN_OUT
    .map((category) => ({
      category,
      total: monthTx
        .filter((tx) => tx.type === "saida" && tx.category === category)
        .reduce((sum, tx) => sum + Number(tx.value || 0), 0),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);

  const sixMonths = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(selectedDate);
    d.setMonth(selectedDate.getMonth() - (5 - index));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const list = transactions.filter((tx) => String(tx.date || "").slice(0, 7) === key);
    return {
      key,
      label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      entrada: list.filter((tx) => tx.type === "entrada").reduce((s, tx) => s + Number(tx.value || 0), 0),
      saida: list.filter((tx) => tx.type === "saida").reduce((s, tx) => s + Number(tx.value || 0), 0),
    };
  });

  const dailySpendMax = Math.max(1, ...Array.from({ length: elapsedDays }, (_, i) => {
    const dateStr = `${selectedMonth}-${String(i + 1).padStart(2, "0")}`;
    return monthTx.filter((tx) => tx.type === "saida" && tx.date === dateStr).reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  }));
  const spendingHeatmap = Array.from({ length: elapsedDays }, (_, i) => {
    const dateStr = `${selectedMonth}-${String(i + 1).padStart(2, "0")}`;
    const spent = monthTx.filter((tx) => tx.type === "saida" && tx.date === dateStr).reduce((sum, tx) => sum + Number(tx.value || 0), 0);
    return { date: dateStr, score: Math.round((spent / dailySpendMax) * 100) };
  });

  const categoryRows = FIN_OUT.map((category) => {
    const spent = monthTx
      .filter((tx) => tx.type === "saida" && tx.category === category)
      .reduce((sum, tx) => sum + Number(tx.value || 0), 0);
    const budget = Number(profile?.financeBudgets?.[category] || 0);
    return { category, spent, budget };
  });

  const configuredBudgets = categoryRows.filter((item) => item.budget > 0);
  const budgetCompliance = configuredBudgets.length
    ? configuredBudgets.filter((item) => item.spent <= item.budget).length / configuredBudgets.length
    : 1;
  const monthlyLimit = Number(profile?.monthlyLimit || 3000);
  const limitOk = monthlyLimit <= 0 || monthOut <= monthlyLimit;
  const hasFinanceData = monthTx.length > 0;
  const savingsScore = monthIn > 0 ? Math.max(0, Math.min(35, (savingsPct / 20) * 35)) : 0;
  const budgetScore = configuredBudgets.length ? budgetCompliance * 30 : 15;
  const balanceScore = monthBalance >= 0 ? 20 : 0;
  const limitScore = limitOk ? 15 : 0;
  const financialHealth = hasFinanceData
    ? Math.round(Math.max(0, Math.min(100, savingsScore + budgetScore + balanceScore + limitScore)))
    : 0;
  const financialHealthLabel = !hasFinanceData ? "Sem dados" : financialHealth >= 80 ? "Forte" : financialHealth >= 60 ? "Estável" : financialHealth >= 40 ? "Atenção" : "Crítica";

  const availableToSpend = monthlyLimit > 0
    ? Math.max(0, monthlyLimit - monthOut)
    : Math.max(0, monthBalance);

  const financialGoals = (goals || []).filter((g) => g.type === "financeira" && !g.completed);

  const launchFilterOptions = [...new Set(
    monthTx
      .map((tx) => String(tx.description || tx.category || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  const normalizedLaunchSearch = String(launchSearch || "").trim().toLocaleLowerCase("pt-BR");
  const selectedMonthLastDay = `${selectedMonth}-${String(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const hasLaunchFilters = Boolean(
    normalizedLaunchSearch ||
    launchFilter !== "all" ||
    launchTypeFilter !== "all" ||
    launchDateFilter
  );

  const filteredLaunches = [...monthTx]
    .filter((tx) => launchTypeFilter === "all" || tx.type === launchTypeFilter)
    .filter((tx) => launchFilter === "all" || String(tx.description || tx.category || "").trim() === launchFilter)
    .filter((tx) => !launchDateFilter || String(tx.date || "") === launchDateFilter)
    .filter((tx) => {
      if (!normalizedLaunchSearch) return true;
      const haystack = `${tx.description || ""} ${tx.category || ""}`.toLocaleLowerCase("pt-BR");
      return haystack.includes(normalizedLaunchSearch);
    })
    .sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));

  const filteredIncome = filteredLaunches
    .filter((tx) => tx.type === "entrada")
    .reduce((sum, tx) => sum + Number(tx.value || 0), 0);
  const filteredExpense = filteredLaunches
    .filter((tx) => tx.type === "saida")
    .reduce((sum, tx) => sum + Number(tx.value || 0), 0);

  const moveMonth = (direction) => {
    const d = new Date(selectedDate);
    d.setMonth(d.getMonth() + direction);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  useEffect(() => {
    if (launchFilter !== "all" && !launchFilterOptions.includes(launchFilter)) {
      setLaunchFilter("all");
    }
    if (launchDateFilter && !launchDateFilter.startsWith(`${selectedMonth}-`)) {
      setLaunchDateFilter("");
    }
  }, [selectedMonth, launchFilter, launchDateFilter, launchFilterOptions.join("|")]);

  const updateBudget = (category, value) => {
    const amount = Math.max(0, Number(value) || 0);
    setProfile((current) => ({
      ...current,
      financeBudgets: {
        ...(current?.financeBudgets || {}),
        [category]: amount,
      },
    }));
  };

  const saveRecurring = (item) => {
    setProfile((current) => ({
      ...current,
      financeRecurring: [...(current?.financeRecurring || []), item],
    }));
    setShowRecurringForm(false);
  };

  const toggleRecurring = (id) => {
    setProfile((current) => ({
      ...current,
      financeRecurring: (current?.financeRecurring || []).map((item) =>
        item.id === id ? { ...item, active: item.active === false } : item
      ),
    }));
  };

  const deleteRecurring = async (id) => {
    if (!(await confirm("Tem certeza que deseja remover esta recorrência?"))) return;
    setProfile((current) => ({
      ...current,
      financeRecurring: (current?.financeRecurring || []).filter((item) => item.id !== id),
    }));
  };

  const financeBills = profile?.financeBills || [];
  const pendingFinanceBills = financeBills
    .filter((bill) => bill.status !== "pago" && monthKey(bill.dueDate) === selectedMonth)
    .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
  const overdueBills = pendingFinanceBills.filter((bill) => bill.dueDate && bill.dueDate < today());
  const overdueTotal = overdueBills.reduce((sum, bill) => sum + Number(bill.value || 0), 0);
  const upcomingBills = pendingFinanceBills
    .filter((bill) => bill.dueDate && bill.dueDate >= today());
  const monthlyLimitUsedPct = monthlyLimit > 0 ? Math.round((monthOut / monthlyLimit) * 100) : 0;
  const topCategory = byCategory[0] || null;
  const previousByCategory = FIN_OUT.map((category) => ({
    category,
    total: previousTx
      .filter((tx) => tx.type === "saida" && tx.category === category)
      .reduce((sum, tx) => sum + Number(tx.value || 0), 0),
  }));
  const topCategoryPrevious = topCategory
    ? previousByCategory.find((item) => item.category === topCategory.category)?.total || 0
    : 0;
  const topCategoryDelta = topCategory ? topCategory.total - topCategoryPrevious : 0;

  const financeInsights = [];
  if (overdueBills.length > 0) {
    financeInsights.push({
      tone: "danger",
      title: `${overdueBills.length} conta${overdueBills.length === 1 ? "" : "s"} vencida${overdueBills.length === 1 ? "" : "s"}`,
      text: `${money(overdueTotal)} aguardando pagamento.`,
    });
  }
  if (topCategory && topCategoryDelta > 0) {
    financeInsights.push({
      tone: "attention",
      title: `${topCategory.category} aumentou`,
      text: `${money(topCategoryDelta)} a mais que no mês anterior.`,
    });
  } else if (topCategory) {
    financeInsights.push({
      tone: "neutral",
      title: `Maior gasto: ${topCategory.category}`,
      text: `${money(topCategory.total)} neste mês.`,
    });
  }
  if (monthlyLimit > 0) {
    financeInsights.push({
      tone: monthlyLimitUsedPct >= 100 ? "danger" : monthlyLimitUsedPct >= 80 ? "attention" : "positive",
      title: monthlyLimitUsedPct >= 100 ? "Limite mensal ultrapassado" : `${monthlyLimitUsedPct}% do limite utilizado`,
      text: monthlyLimitUsedPct >= 100
        ? `${money(monthOut - monthlyLimit)} acima do planejado.`
        : `${money(availableToSpend)} ainda disponíveis.`,
    });
  }
  if (isPro && Number.isFinite(projectedBalance)) {
    financeInsights.push({
      tone: projectedBalance >= 0 ? "positive" : "danger",
      title: "Projeção de fechamento",
      text: projectedBalance >= 0
        ? `O mês tende a fechar ${money(projectedBalance)} positivo.`
        : `O mês tende a fechar ${money(Math.abs(projectedBalance))} negativo.`,
    });
  }
  const visibleFinanceInsights = financeInsights.slice(0, 3);

  const duplicateTransaction = (tx) => {
    setDuplicatePending(tx);
  };

  const confirmDuplicateTransaction = () => {
    if (!duplicatePending) return;
    const tx = duplicatePending;
    if (!requestFinanceRecord()) return;
    const added = addTransaction({
      ...tx,
      id: uid(),
      billId: null,
      recurringId: null,
      recurringMonth: null,
      goalId: null,
      description: tx.description || tx.category,
    });
    if (added === false) return;
    setDuplicatePending(null);
  };

  const saveBill = (bill) => {
    const previousBill = financeBills.find((item) => item.id === bill.id);
    const wasPaid = previousBill?.status === "pago";

    setProfile((current) => {
      const exists = (current?.financeBills || []).some((item) => item.id === bill.id);
      return {
        ...current,
        financeBills: exists
          ? (current?.financeBills || []).map((item) => item.id === bill.id ? bill : item)
          : [...(current?.financeBills || []), bill],
      };
    });

    if (wasPaid) {
      const linked = transactions.filter((tx) => tx.billId === bill.id);
      // Não usa deleteTransaction aqui: salvar uma conta já editada não deveria
      // abrir uma segunda confirmação de exclusão por trás das cenas, e chamar a
      // versão que confirma dentro de um forEach só guarda uma confirmação
      // pendente por vez — a segunda chamada nunca resolveria a primeira.
      linked.forEach((tx) => removeTransactionRecord(tx.id));
      addTransaction({
        id: uid(),
        type: "saida",
        category: bill.category,
        value: Number(bill.value || 0),
        date: previousBill?.paidAt || linked[0]?.date || today(),
        description: bill.description,
        billId: bill.id,
      });
    }

    setEditingBill(null);
    setShowBillForm(false);
  };

  const removeBill = async (id) => {
    if (!(await confirm("Excluir esta conta a pagar?"))) return;
    setProfile((current) => ({ ...current, financeBills: (current?.financeBills || []).filter((bill) => bill.id !== id) }));
  };

  const payBill = (bill) => {
    if (!requestFinanceRecord()) return;
    const added = addTransaction({
      id: uid(),
      type: "saida",
      category: bill.category,
      value: Number(bill.value || 0),
      date: today(),
      description: bill.description,
      billId: bill.id,
    });
    if (added === false) return;
    setProfile((current) => ({
      ...current,
      financeBills: (current?.financeBills || []).map((item) => item.id === bill.id ? { ...item, status: "pago", paidAt: today() } : item),
    }));
  };

  const unpayBill = async (bill) => {
    if (!(await confirm(`Desmarcar "${bill.description}" como paga? O lançamento financeiro criado por este pagamento também será removido.`, { confirmLabel: "Desmarcar" }))) return;

    transactions
      .filter((tx) => tx.billId === bill.id)
      .forEach((tx) => removeTransactionRecord(tx.id));

    setProfile((current) => ({
      ...current,
      financeBills: (current?.financeBills || []).map((item) =>
        item.id === bill.id
          ? { ...item, status: "pendente", paidAt: null }
          : item
      ),
    }));
  };

  const saveFinanceTransaction = (tx) => {
    if (!requestFinanceRecord()) return false;
    if (addTransaction(tx) === false) return false;
    if (tx.goalId && tx.type === "saida" && tx.category === "Aporte para meta") {
      addGoalProgress(tx.goalId, Number(tx.value || 0));
    }
    return true;
  };

  const exportMonth = () => {
    const rowsToExport = hasLaunchFilters ? filteredLaunches : monthTx;
    if (rowsToExport.length === 0) return;

    const header = ["Data", "Tipo", "Categoria", "Descrição", "Valor"];
    const rows = rowsToExport.map((tx) => [
      tx.date,
      tx.type === "entrada" ? "Entrada" : "Saída",
      tx.category,
      tx.description || "",
      Number(tx.value || 0).toFixed(2).replace(".", ","),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
      .join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = launchDateFilter
      ? `constancce-financas-${launchDateFilter}.csv`
      : `constancce-financas-${selectedMonth}${hasLaunchFilters ? "-filtrado" : ""}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="finance-view flex flex-col gap-4 md:gap-5">
      <div className="finance-main-header">
        <div className="finance-header-copy min-w-0">
          <h2 className="font-display text-2xl md:text-3xl">Finanças</h2>
          <p className="text-dim text-xs md:text-sm mt-1 max-w-2xl">
            Veja primeiro o que importa: quanto entrou, quanto saiu, quanto sobrou e o que vem pela frente.
          </p>
        </div>

        {!isPro && (
          <div className="flex items-center gap-2">
            <span className="chip">{transactions.length}/{PRO_LIMITS.financeTransactions} lançamentos Free</span>
          </div>
        )}

        <div className="finance-header-controls">
          <div className="finance-month-picker surface rounded-xl">
            <button
              className="btn-ghost rounded-lg finance-icon-button"
              onClick={() => moveMonth(-1)}
              aria-label="Mês anterior"
              title="Mês anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <span className="finance-month-label">
              {monthLabelDisplay}
            </span>

            <button
              className="btn-ghost rounded-lg finance-icon-button"
              onClick={() => moveMonth(1)}
              aria-label="Próximo mês"
              title="Próximo mês"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <button
            className="finance-action-button finance-entry-button btn-ghost rounded-xl"
            onClick={() => {
              if (!requestFinanceRecord()) return;
              setFinanceSection("launches");
              setPresetType("entrada");
              setShowForm(true);
            }}
          >
            <ArrowUpRight size={15} />
            <span>Entrada</span>
          </button>

          <button
            className="finance-action-button finance-exit-button btn-primary rounded-xl"
            onClick={() => {
              if (!requestFinanceRecord()) return;
              setFinanceSection("launches");
              setPresetType("saida");
              setShowForm(true);
            }}
          >
            <ArrowDownRight size={15} />
            <span>Saída</span>
          </button>
        </div>
      </div>

      <FirstVisitTip id="finance" icon={Wallet} title="Finanças mostram para onde seu dinheiro está indo.">
        Registre entradas e saídas. O painel transforma esses lançamentos em saldo, categorias e uma leitura simples do seu mês.
      </FirstVisitTip>

      <div className="finance-section-tabs task-glass-tabs rounded-2xl p-1 grid grid-cols-3 gap-1">
        {[
          ["overview", "Visão geral"],
          ["launches", "Lançamentos"],
          ["intelligence", "Inteligência"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`finance-tab-button task-tab-button rounded-xl py-2 text-[10px] sm:text-xs md:text-sm font-medium min-w-0 truncate ${financeSection === id ? "task-tab-active" : ""}`}
            onClick={() => setFinanceSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {financeSection === "overview" && (
        <>
          {overdueBills.length > 0 && (
            <div className="finance-overdue-alert rounded-2xl p-3 md:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <Bell size={16} className="text-ember shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs md:text-sm font-medium">
                    {overdueBills.length} conta{overdueBills.length === 1 ? "" : "s"} vencida{overdueBills.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-[10px] md:text-xs text-dim mt-0.5 break-words">
                    {money(overdueTotal)} aguardando pagamento.
                  </p>
                </div>
              </div>
              <button
                className="btn-ghost rounded-xl px-3 py-2 text-xs shrink-0"
                onClick={() => document.getElementById("finance-bills-card")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                Ver contas
              </button>
            </div>
          )}

          <div className="finance-overview-hero glass-panel-strong rounded-2xl p-4 md:p-6">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[9px] md:text-[10px] text-faint uppercase tracking-widest">Saldo do mês</p>
                <p className={`finance-hero-balance font-display text-3xl md:text-4xl mt-1 break-words ${monthBalance >= 0 ? "text-moss" : "text-ember"}`}>
                  {money(monthBalance)}
                </p>
                <p className="text-[10px] md:text-xs text-dim mt-1.5">
                  Entrou <span className="text-moss">{money(monthIn)}</span> · Saiu <span className="text-ember">{money(monthOut)}</span>
                </p>
              </div>

              <div className="finance-overview-mini-grid grid grid-cols-2 gap-2 w-full lg:w-auto lg:min-w-[360px]">
                <div className="surface-2 rounded-xl p-3 min-w-0">
                  <p className="text-[9px] text-faint uppercase tracking-widest">Ainda pode gastar</p>
                  <p className="font-mono text-sm md:text-base mt-1 truncate">{money(availableToSpend)}</p>
                </div>
                <div className="surface-2 rounded-xl p-3 min-w-0">
                  <p className="text-[9px] text-faint uppercase tracking-widest">
                    Vs. mês anterior{isCurrentMonthView ? " (até hoje)" : ""}
                  </p>
                  <p className={`font-mono text-sm md:text-base mt-1 truncate ${outDeltaPct !== null && outDeltaPct <= 0 ? "text-moss" : outDeltaPct !== null ? "text-ember" : "text-dim"}`}>
                    {outDeltaPct === null ? "Sem base" : `${outDeltaPct >= 0 ? "+" : ""}${outDeltaPct}% gastos`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="finance-limit-card surface glass-panel rounded-2xl p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <p className="text-[10px] text-faint uppercase tracking-widest">Limite mensal</p>

              {editingMonthlyLimit ? (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <input
                    type="number"
                    min="0"
                    step="50"
                    className="finance-limit-input flex-1 sm:w-36 p-2.5 text-sm ring-focus text-right"
                    defaultValue={monthlyLimit}
                    onBlur={(e) => setProfile((current) => ({
                      ...current,
                      monthlyLimit: Math.max(0, Number(e.target.value) || 0),
                    }))}
                  />
                  <button className="btn-ghost rounded-xl px-3 py-2.5 text-xs shrink-0" onClick={() => setEditingMonthlyLimit(false)}>
                    Concluir
                  </button>
                </div>
              ) : (
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs self-start sm:self-auto" onClick={() => setEditingMonthlyLimit(true)}>
                  <Pencil size={12} className="inline mr-1" /> Editar limite
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <RadialProgress
                value={monthlyLimitUsedPct}
                label="utilizado"
                size={104}
                strokeWidth={8}
                color={monthlyLimitUsedPct >= 100 ? "var(--ember)" : monthlyLimitUsedPct >= 80 ? "var(--brass)" : "var(--moss)"}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm md:text-base">
                  {money(monthOut)} usados de {money(monthlyLimit)}
                </p>
                <p className="text-dim text-xs mt-1">{money(availableToSpend)} disponíveis</p>
              </div>
            </div>
          </div>

          {visibleFinanceInsights.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-faint uppercase tracking-widest">Leituras rápidas</p>
                <span className="chip">até 3</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {visibleFinanceInsights.map((insight, index) => (
                  <div key={`${insight.title}-${index}`} className={`finance-insight-card surface rounded-xl p-3 ${insight.tone}`}>
                    <p className="text-xs font-medium break-words">{insight.title}</p>
                    <p className="text-[10px] md:text-xs text-dim mt-1 break-words">{insight.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 md:gap-4">
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Categorias</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Onde seu dinheiro está saindo.</p>
                </div>
                <span className="chip">Top {Math.min(5, byCategory.length)}</span>
              </div>

              <div className="flex flex-col gap-3">
                {byCategory.length === 0 && <p className="text-xs text-dim py-2">Nenhuma saída registrada neste mês.</p>}
                {byCategory.slice(0, 5).map((item, index) => {
                  const pct = monthOut > 0 ? Math.round((item.total / monthOut) * 100) : 0;
                  return (
                    <div key={item.category}>
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[9px] text-brass shrink-0">0{index + 1}</span>
                          <span className="text-xs md:text-sm truncate">{item.category}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-xs">{money(item.total)}</p>
                          <p className="text-[9px] text-faint">{pct}%</p>
                        </div>
                      </div>
                      <Progress value={pct} height={4} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div id="finance-bills-card" className="surface glass-panel rounded-2xl p-4 md:p-5 scroll-mt-20">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Próximas contas</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Os compromissos mais próximos.</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className="btn-ghost rounded-xl px-2.5 py-2 text-[10px] md:text-xs"
                    onClick={() => {
                      setEditingBill(null);
                      setShowBillForm(true);
                    }}
                  >
                    <Plus size={12} className="inline mr-1" /> Nova
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {upcomingBills.length === 0 && overdueBills.length === 0 && (
                  <p className="text-xs text-dim py-2">Nenhuma conta pendente cadastrada.</p>
                )}

                {[...overdueBills, ...upcomingBills].map((bill) => {
                  const overdue = bill.dueDate < today();
                  const diffDays = Math.ceil(
                    (new Date(`${bill.dueDate}T12:00:00`).getTime() - new Date(`${today()}T12:00:00`).getTime()) / 86400000
                  );
                  return (
                    <div key={bill.id} className="finance-upcoming-bill surface-2 rounded-xl p-3 flex items-center gap-3 min-w-0">
                      <CreditCard size={15} className={`shrink-0 ${overdue ? "text-ember" : "text-brass"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs md:text-sm font-medium truncate">{bill.description}</p>
                        <p className={`text-[9px] md:text-[10px] mt-0.5 ${overdue ? "text-ember" : "text-faint"}`}>
                          {overdue ? `${Math.abs(diffDays)}d atrasada` : diffDays === 0 ? "vence hoje" : `vence em ${diffDays}d`}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] md:text-xs shrink-0">{money(bill.value)}</span>
                      {bill.status !== "pago" && (
                        <button className="btn-ghost rounded-lg px-2 py-1.5 text-[9px] md:text-[10px] shrink-0" onClick={() => payBill(bill)}>
                          Pagar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {financeBills.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
                  <p className="text-[10px] text-faint">{financeBills.length} conta{financeBills.length === 1 ? "" : "s"} cadastrada{financeBills.length === 1 ? "" : "s"} no total.</p>
                </div>
              )}

            </div>
          </div>

          {financialGoals.length > 0 && (
            <div className="surface rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Metas financeiras</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Quanto já avançou nos seus objetivos.</p>
                </div>
                <span className="chip">{financialGoals.length} ativa{financialGoals.length === 1 ? "" : "s"}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {financialGoals.slice(0, 4).map((goal) => {
                  const pct = goal.target > 0
                    ? Math.min(100, Math.round(Number(goal.current || 0) / Number(goal.target) * 100))
                    : 0;
                  return (
                    <div key={goal.id} className="surface-2 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <p className="text-xs md:text-sm font-medium truncate">{goal.name}</p>
                          <p className="text-[9px] md:text-[10px] text-faint mt-0.5">{money(goal.current)} de {money(goal.target)}</p>
                        </div>
                        <span className="chip shrink-0">{pct}%</span>
                      </div>
                      <Progress value={pct} height={5} />
                      {isPro && (
                        <p className="text-[9px] md:text-[10px] text-dim mt-2">
                          Ritmo sugerido: <span className="text-brass">{money(monthlyGoalEstimate(goal))}/mês</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="finance-month-close surface rounded-2xl p-4 md:p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] text-faint uppercase tracking-widest">
                  {isPastMonth ? "Fechamento do mês" : "Resumo até agora"}
                </p>
                <p className="text-xs md:text-sm leading-relaxed mt-2 break-words">
                  Você recebeu <span className="text-moss">{money(monthIn)}</span>, gastou <span className="text-ember">{money(monthOut)}</span>
                  {monthBalance >= 0
                    ? <> e ficou com <span className="text-moss">{money(monthBalance)}</span> de saldo.</>
                    : <> e ficou <span className="text-ember">{money(Math.abs(monthBalance))}</span> negativo.</>}
                </p>
                {topCategory && (
                  <p className="text-[10px] md:text-xs text-dim mt-1.5">
                    Maior categoria: {topCategory.category} · {money(topCategory.total)}.
                  </p>
                )}
              </div>

              {isPro && (
                <div className="surface-2 rounded-xl p-3 md:min-w-[230px]">
                  <p className="text-[9px] text-faint uppercase tracking-widest">Projeção</p>
                  <p className={`font-display text-lg md:text-xl mt-1 ${projectedBalance >= 0 ? "text-moss" : "text-ember"}`}>
                    {projectedBalance >= 0 ? money(projectedBalance) : `-${money(Math.abs(projectedBalance))}`}
                  </p>
                  <p className="text-[9px] text-faint mt-0.5">
                    ritmo atual + contas pendentes
                    {isCurrentMonth && elapsedDays < 5 ? " · início do mês, estimativa ainda instável" : ""}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {financeSection === "launches" && (
        <>
          <div className="finance-launch-top surface rounded-2xl p-3 md:p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-[10px] text-faint uppercase tracking-widest">Lançamentos de {monthLabelDisplay}</p>
                <p className="text-[10px] md:text-xs text-dim mt-1">Busque por iFood, Uber, aluguel, categoria ou descrição.</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-ghost rounded-xl px-3 py-2 text-[10px] md:text-xs flex items-center gap-1.5" onClick={exportMonth}>
                  <Download size={13} /> Exportar
                </button>
                <span className="chip">{filteredLaunches.length}/{monthTx.length}</span>
              </div>
            </div>

            <div className="finance-search-wrap relative mt-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <input
                className="finance-search-input w-full py-3 pl-9 pr-3 ring-focus text-sm"
                placeholder="Pesquisar lançamentos..."
                value={launchSearch}
                onChange={(e) => setLaunchSearch(e.target.value)}
              />
            </div>

            <div className="finance-filter-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
              <select
                className="finance-filter-control w-full p-2.5 text-xs ring-focus"
                value={launchTypeFilter}
                onChange={(e) => setLaunchTypeFilter(e.target.value)}
                aria-label="Filtrar por tipo de lançamento"
              >
                <option value="all">Entradas e saídas</option>
                <option value="entrada">Somente entradas</option>
                <option value="saida">Somente saídas</option>
              </select>

              <select
                className="finance-filter-control w-full p-2.5 text-xs ring-focus"
                value={launchFilter}
                onChange={(e) => setLaunchFilter(e.target.value)}
                aria-label="Filtrar por descrição"
              >
                <option value="all">Todas as descrições</option>
                {launchFilterOptions.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>

              <div className="finance-date-filter-wrap relative sm:col-span-2 lg:col-span-1">
                <CalendarIcon
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
                />
                <input
                  type="date"
                  className="finance-filter-control finance-date-filter w-full py-2.5 pl-9 pr-3 text-xs ring-focus"
                  value={launchDateFilter}
                  min={`${selectedMonth}-01`}
                  max={selectedMonthLastDay}
                  onChange={(e) => setLaunchDateFilter(e.target.value)}
                  aria-label="Filtrar lançamentos por data"
                />
              </div>
            </div>

            {hasLaunchFilters && (
              <div className="finance-filter-results mt-3">
                <div className="grid grid-cols-2 gap-2 min-w-0">
                  <div className="surface-2 rounded-xl p-2.5 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Entradas encontradas</p>
                    <p className="font-mono text-xs md:text-sm text-moss mt-1 truncate">{money(filteredIncome)}</p>
                  </div>
                  <div className="surface-2 rounded-xl p-2.5 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Saídas encontradas</p>
                    <p className="font-mono text-xs md:text-sm text-ember mt-1 truncate">{money(filteredExpense)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {launchDateFilter && (
                      <span className="chip">
                        {new Date(`${launchDateFilter}T12:00:00`).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                    <span className="text-[9px] md:text-[10px] text-faint">
                      {filteredLaunches.length} de {monthTx.length} lançamento{monthTx.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <button
                    className="finance-clear-filters btn-ghost rounded-lg px-2.5 py-1.5 text-[10px] md:text-xs"
                    onClick={() => {
                      setLaunchSearch("");
                      setLaunchTypeFilter("all");
                      setLaunchFilter("all");
                      setLaunchDateFilter("");
                    }}
                  >
                    Limpar filtros
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="finance-history-ledger surface rounded-2xl overflow-hidden">
            <div className="finance-history-head p-4 md:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <History size={15} className="text-brass shrink-0" />
                  <p className="text-[10px] text-faint uppercase tracking-widest">Histórico financeiro</p>
                </div>
                <p className="text-xs md:text-sm text-dim mt-1">
                  Linha do tempo dos pagamentos e movimentações do período selecionado.
                </p>
              </div>
              <div className="finance-history-summary flex items-center gap-2 shrink-0">
                <span className="chip">{filteredLaunches.length} registro{filteredLaunches.length === 1 ? "" : "s"}</span>
                <span className="chip">{monthLabelDisplay}</span>
              </div>
            </div>

            <div className="finance-history-stream">
              {filteredLaunches.length === 0 && (
                <div className="p-5 text-dim text-xs md:text-sm text-center">
                  {monthTx.length === 0 ? "Seu mês ainda está sem lançamentos. Registre uma entrada ou saída para começar a enxergar seu saldo e seus padrões." : "Nenhum lançamento corresponde à busca ou aos filtros."}
                </div>
              )}

              {filteredLaunches.map((tx, index) => (
                <div
                  key={tx.id}
                  className={`finance-transaction-row finance-history-row p-3 md:p-4 flex flex-col sm:flex-row sm:items-center gap-2.5 md:gap-3 text-sm ${index === 0 ? "is-latest" : ""}`}
                  style={{ "--finance-row-accent": tx.type === "entrada" ? "var(--moss)" : "var(--ember)" }}
                >
                  <div className="finance-history-marker shrink-0">
                    <div className={`finance-history-icon ${tx.type === "entrada" ? "text-moss" : "text-ember"}`}>
                      {tx.type === "entrada" ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                    </div>
                    <span className="finance-history-line" />
                  </div>

                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="finance-history-date rounded-xl shrink-0">
                      <span className="font-mono text-xs">{String(new Date(tx.date + "T12:00:00").getDate()).padStart(2, "0")}</span>
                      <span className="text-[8px] text-faint uppercase">
                        {new Date(tx.date + "T12:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                      </span>
                    </div>

                    <div className="finance-history-content flex-1 min-w-0">
                      <div className="finance-history-name-value flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0 flex-1">
                          <p className="finance-transaction-description text-xs md:text-sm font-medium leading-relaxed">
                            {tx.description || tx.category}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-faint text-[9px] md:text-[10px]">
                              {tx.category} · {tx.type === "entrada" ? "Entrada" : "Saída"}
                            </span>
                            {tx.billId && <span className="chip text-moss">Pago</span>}
                            {tx.recurringId && <span className="chip">Recorrente</span>}
                          </div>
                        </div>

                        <div className="finance-history-value shrink-0 text-right">
                          <p
                            className="font-mono text-xs md:text-sm whitespace-nowrap"
                            style={{ color: tx.type === "entrada" ? "var(--moss)" : "var(--ember)" }}
                          >
                            {tx.type === "entrada" ? "+" : "-"}{money(tx.value)}
                          </p>
                          <p className="text-[8px] text-faint mt-0.5 whitespace-nowrap">
                            {new Date(tx.date + "T12:00:00").toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="finance-transaction-actions flex items-center justify-end gap-2 w-auto shrink-0">
                    <button className="finance-history-action btn-ghost rounded-lg p-2 shrink-0" onClick={() => duplicateTransaction(tx)} aria-label="Duplicar lançamento" title="Duplicar lançamento">
                      <Copy size={13} />
                    </button>
                    <button className="finance-history-action btn-ghost rounded-lg p-2 shrink-0" onClick={() => deleteTransaction(tx.id)} aria-label="Excluir lançamento" title="Excluir lançamento">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {financeSection === "intelligence" && (
        isPro ? (
          <>
            <div className="finance-intelligence-entry surface rounded-2xl p-4 md:p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--brass) 10%, var(--surface-2))" }}>
                  <BrainCircuit size={18} className="text-brass" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-faint uppercase tracking-widest">Pergunte sobre seu dinheiro</p>
                  <p className="font-display text-lg md:text-xl mt-0.5">Financial Intelligence</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">O Constancce interpreta a pergunta e calcula a resposta usando seus registros.</p>
                </div>
              </div>

              <FinanceProAssistant
                transactions={transactions}
                financialGoals={goals || []}
                financeBills={profile?.financeBills || []}
                financeRecurring={profile?.financeRecurring || []}
                monthlyLimit={profile?.monthlyLimit || 0}
                financeBudgets={profile?.financeBudgets || {}}
                selectedMonth={selectedMonth}
                projectedBalance={projectedBalance}
                availableToSpend={availableToSpend}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
              <div className="surface rounded-2xl p-4 md:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] text-faint uppercase tracking-widest">Saúde financeira</p>
                    <div className="flex items-end gap-2 mt-1.5">
                      <p className="font-display text-2xl md:text-3xl">{financialHealth}</p>
                      <span className="chip mb-1">{financialHealthLabel}</span>
                    </div>
                  </div>
                  <Gauge size={19} className="text-brass" />
                </div>
                <Progress value={financialHealth} height={6} />
                <p className="text-[10px] md:text-xs text-dim mt-2 leading-relaxed">
                  {!hasFinanceData
                    ? "Registre entradas e saídas para gerar uma leitura."
                    : monthBalance < 0
                      ? "O principal ponto de atenção é o saldo negativo deste mês."
                      : monthlyLimitUsedPct >= 100
                        ? "Seu saldo está positivo, mas o limite mensal foi ultrapassado."
                        : savingsPct >= 20
                          ? "Seu saldo e sua capacidade de poupança estão em uma faixa saudável."
                          : "Seu saldo está positivo, mas ainda há espaço para aumentar a sobra do mês."}
                </p>
              </div>

              <div className="surface rounded-2xl p-4 md:p-5" style={{ borderColor: "var(--brass-dim)" }}>
                <p className="text-[10px] text-faint uppercase tracking-widest">Previsão transparente</p>
                <p className={`font-display text-2xl md:text-3xl mt-1.5 ${projectedBalance >= 0 ? "text-moss" : "text-ember"}`}>
                  {projectedBalance >= 0 ? money(projectedBalance) : `-${money(Math.abs(projectedBalance))}`}
                </p>
                <p className="text-[10px] md:text-xs text-dim mt-2 leading-relaxed">
                  Se continuar nesse ritmo, sua saída estimada é {money(projectedOut)}. O cálculo considera gastos atuais, recorrências pendentes e contas cadastradas.
                </p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="surface-2 rounded-xl p-2.5 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Pode gastar</p>
                    <p className="font-mono text-xs md:text-sm mt-1 truncate">{money(availableToSpend)}</p>
                  </div>
                  <div className="surface-2 rounded-xl p-2.5 min-w-0">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Fixos pendentes</p>
                    <p className="font-mono text-xs md:text-sm mt-1 truncate">{money(futureRecurringOut)}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 md:gap-4">
              <div className="surface glass-panel rounded-2xl p-4 md:p-5">
                <p className="text-[10px] text-faint uppercase tracking-widest">Gastos por categoria</p>
                <p className="text-[10px] md:text-xs text-dim mt-1 mb-4">Visão gráfica do mês selecionado.</p>
                <FinanceDonutChart data={byCategory} total={monthOut} />
              </div>
              <div className="surface glass-panel rounded-2xl p-4 md:p-5">
                <p className="text-[10px] text-faint uppercase tracking-widest">Últimos 6 meses</p>
                <p className="text-[10px] md:text-xs text-dim mt-1 mb-3">Entradas e saídas ao longo do tempo.</p>
                <FinanceTrendChart rows={sixMonths} />
              </div>
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-6">
              <p className="text-[10px] text-faint uppercase tracking-widest">Gastos por dia</p>
              <p className="text-[10px] md:text-xs text-dim mt-1 mb-4">Cada bloco é um dia de {monthLabelDisplay}. Quanto mais intenso, maior o gasto em relação ao pico do mês.</p>
              {spendingHeatmap.length > 0 ? (
                <>
                  <ConsistencyHeatmap days={spendingHeatmap} />
                  <div className="flex items-center justify-between mt-3 text-[9px] text-faint">
                    <span>menor gasto</span>
                    <span>{monthLabelDisplay}</span>
                    <span>maior gasto</span>
                  </div>
                </>
              ) : (
                <p className="text-dim text-xs py-4 text-center">Sem dias suficientes neste mês ainda.</p>
              )}
            </div>

            <div className="surface rounded-2xl p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Orçamento por categoria</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Defina somente o teto e acompanhe o consumo.</p>
                </div>
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs self-start sm:self-auto" onClick={() => setEditingBudgets((value) => !value)}>
                  <Pencil size={12} className="inline mr-1" /> {editingBudgets ? "Concluir" : "Editar tetos"}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {categoryRows.map((item) => {
                  const rawPct = item.budget > 0 ? Math.round((item.spent / item.budget) * 100) : 0;
                  const pct = Math.min(100, rawPct);
                  const over = item.budget > 0 && item.spent > item.budget;
                  return (
                    <div key={item.category} className="surface-2 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-xs md:text-sm font-medium truncate">{item.category}</p>
                          <p className="text-[9px] md:text-[10px] text-faint mt-0.5">
                            {item.budget > 0 ? `${money(item.spent)} de ${money(item.budget)}` : `${money(item.spent)} gastos`}
                          </p>
                        </div>
                        {editingBudgets ? (
                          <input
                            type="number"
                            min="0"
                            step="10"
                            className="finance-category-budget-input w-24 p-2 text-xs ring-focus text-right shrink-0"
                            defaultValue={item.budget || ""}
                            placeholder="Teto"
                            onBlur={(e) => updateBudget(item.category, e.target.value)}
                          />
                        ) : (
                          <span className={`text-[10px] md:text-xs font-mono shrink-0 ${over ? "text-ember" : rawPct >= 80 ? "text-brass" : "text-dim"}`}>
                            {item.budget > 0 ? `${rawPct}%` : "sem teto"}
                          </span>
                        )}
                      </div>
                      <Progress value={pct} height={5} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="surface rounded-2xl p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <p className="text-[10px] text-faint uppercase tracking-widest">Fixos e recorrentes</p>
                  <p className="text-[10px] md:text-xs text-dim mt-1">Entradas fixas de um lado, despesas fixas do outro.</p>
                </div>
                <button className="btn-ghost rounded-xl px-3 py-2 text-xs self-start sm:self-auto" onClick={() => setShowRecurringForm(true)}>
                  <Plus size={12} className="inline mr-1" /> Nova recorrência
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ["entrada", "Entradas fixas", "text-moss"],
                  ["saida", "Despesas fixas", "text-ember"],
                ].map(([type, title, tone]) => {
                  const rows = recurringItems.filter((item) => item.type === type);
                  return (
                    <div key={type} className="surface-2 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className={`text-xs font-medium ${tone}`}>{title}</p>
                        <span className="chip">{rows.length}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {rows.length === 0 && <p className="text-[10px] text-faint py-1">Nenhuma cadastrada.</p>}
                        {rows.map((item) => (
                          <div key={item.id} className="flex items-center gap-2 min-w-0">
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] md:text-xs truncate">{item.description}</p>
                              <p className="text-[9px] text-faint">dia {item.day} · {item.active === false ? "pausada" : "ativa"}</p>
                            </div>
                            <span className={`font-mono text-[9px] md:text-[10px] shrink-0 ${tone}`}>{money(item.value)}</span>
                            <button className="btn-ghost rounded-lg p-1.5 shrink-0" onClick={() => toggleRecurring(item.id)} title={item.active === false ? "Ativar" : "Pausar"}>
                              {item.active === false ? <Play size={12} /> : <Pause size={12} />}
                            </button>
                            <button className="btn-ghost rounded-lg p-1.5 shrink-0" onClick={() => deleteRecurring(item.id)} title="Excluir">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <ProLockCard
              feature="finance"
              title="Financial Intelligence"
              description="Comparações históricas, projeções avançadas, gráficos, recorrências automáticas e perguntas inteligentes ficam no PRO. O controle financeiro básico continua disponível no Free."
              onUpgrade={onUpgrade}
            />
            <div className="surface rounded-2xl p-4 md:p-5">
              <p className="text-[10px] text-faint uppercase tracking-widest">O que continua no Free</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                {["Entradas e saídas", "Saldo e limite", "Categorias", "Contas e metas"].map((label) => (
                  <div key={label} className="surface-2 rounded-xl p-3 text-[10px] md:text-xs text-dim">{label}</div>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {duplicatePending && (
        <Modal title="Confirmar cópia" onClose={() => setDuplicatePending(null)} width={430}>
          <div className="finance-copy-confirmation">
            <div className="w-11 h-11 rounded-2xl surface-2 flex items-center justify-center mb-3">
              <Copy size={18} className="text-brass" />
            </div>
            <p className="text-sm leading-relaxed">
              Deseja copiar <strong>{duplicatePending.description || duplicatePending.category}</strong> com o valor de <strong>{money(duplicatePending.value)}</strong>?
            </p>
            <p className="text-[10px] text-faint mt-2">
              A cópia manterá tipo, categoria, valor e data. Vínculos automáticos com conta recorrente ou meta não serão duplicados.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button className="btn-ghost rounded-xl py-2.5 text-sm" onClick={() => setDuplicatePending(null)}>Cancelar</button>
              <button className="btn-primary rounded-xl py-2.5 text-sm" onClick={confirmDuplicateTransaction}>Confirmar cópia</button>
            </div>
          </div>
        </Modal>
      )}

      {showForm && (
        <TransactionForm
          presetType={presetType}
          goals={goals}
          onClose={() => setShowForm(false)}
          onSave={(tx) => {
            if (saveFinanceTransaction(tx) === false) return;
            setShowForm(false);
          }}
        />
      )}

      {showRecurringForm && (
        <FinanceRecurringForm onClose={() => setShowRecurringForm(false)} onSave={saveRecurring} />
      )}

      {showBillForm && (
        <FinanceBillForm
          initial={editingBill}
          onClose={() => {
            setShowBillForm(false);
            setEditingBill(null);
          }}
          onSave={saveBill}
        />
      )}
      {confirmDialog}
    </div>
  );
}

/* ---------------------------------------------------------------
   PROGRESS / ACHIEVEMENTS / NOTIFICATIONS / REPORTS / PROFILE
----------------------------------------------------------------*/
function ProgressFriendComparison({ session, profile, game, streaks }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!session?.user?.id) return;
    setLoading(true);
    fetchFriends(session)
      .then((data) => { if (active) setRows((data || []).filter((r) => r.status === "accepted")); })
      .catch(() => { if (active) setRows([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session]);

  const own = {
    user_id: session?.user?.id,
    display_name: profile?.name || "Você",
    xp: game.xp,
    score: game.score || 0,
    streak_current: streaks.current,
    isMe: true,
  };

  const leaderboard = [own, ...rows]
    .sort((a, b) => Number(b.xp || 0) - Number(a.xp || 0));
  const position = leaderboard.findIndex((r) => r.isMe) + 1;
  const leader = leaderboard[0];
  const xpToLeader = leader?.isMe ? 0 : Math.max(0, Number(leader?.xp || 0) - Number(game.xp || 0));

  if (loading) {
    return <div className="surface rounded-2xl p-5 text-dim text-sm">Carregando comparação com amigos…</div>;
  }

  return (
    <div className="surface rounded-2xl p-5 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-xs text-faint uppercase tracking-widest">Comparação com amigos</p>
          <p className="text-dim text-xs mt-1">
            {rows.length
              ? `Você está em #${position} entre ${leaderboard.length} pessoas no ranking.`
              : "Adicione amigos para comparar XP, score e constância."}
          </p>
        </div>
        <Swords size={18} className="text-brass" />
      </div>

      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="surface-2 rounded-xl p-3">
              <p className="text-[10px] text-faint uppercase tracking-widest">Sua posição</p>
              <p className="font-display text-2xl mt-1">#{position}</p>
            </div>
            <div className="surface-2 rounded-xl p-3">
              <p className="text-[10px] text-faint uppercase tracking-widest">Até o líder</p>
              <p className="font-display text-2xl mt-1">{xpToLeader.toLocaleString("pt-BR")} XP</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {leaderboard.slice(0, 4).map((row, index) => (
              <div key={row.user_id || index} className="surface-2 rounded-xl p-3 flex items-center gap-3">
                <span className="font-mono text-xs text-brass w-6">#{index + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{row.isMe ? "Você" : (row.display_name || "Amigo")}</p>
                  <p className="text-[10px] text-faint">{Number(row.score || 0)}/100 · {Number(row.streak_current || 0)}d streak</p>
                </div>
                <span className="font-mono text-xs">{Number(row.xp || 0).toLocaleString("pt-BR")} XP</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProgressView({ streaks, stats, game, session, profile, isPro, onUpgrade }) {
  const [range, setRange] = useState("7d");

  const chartData = stats.rangeCharts?.[range] || stats.last14Chart || [];
  const rangeLabel = { "7d": "7 dias", "30d": "30 dias", "90d": "90 dias", "365d": "1 ano" }[range];

  const indexValue = Math.max(0, Math.min(100, Number(stats.avg30 || 0)));
  const delta = Number(stats.monthDelta || 0);
  const indexState =
    indexValue >= 85 ? "Alta consistência" :
    indexValue >= 70 ? "Consistência sólida" :
    indexValue >= 50 ? "Em construção" :
    "Precisa de atenção";

  const trendState =
    delta >= 5 ? "Evolução clara" :
    delta > 0 ? "Evolução leve" :
    delta === 0 ? "Estável" :
    delta > -5 ? "Leve recuo" :
    "Recuo importante";

  const strongest = stats.strongestArea || { label: "—", value: 0 };
  const weakest = stats.weakestArea || { label: "—", value: 0 };
  const areaPerformance = stats.areaPerformance || [];
  const insights = stats.insights || [];
  const heatmap = stats.heatmap90 || [];

  const focusText = weakest?.label && weakest.label !== "—"
    ? `Sua principal oportunidade agora está em ${weakest.label}.`
    : "Continue registrando sua rotina para identificar seu próximo ponto de alavancagem.";

  return (
    <div className="progress-view flex flex-col gap-4 md:gap-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl md:text-3xl">Progresso</h2>
            {isPro && <ProBadge compact />}
          </div>
          <p className="text-dim text-sm mt-1">
            Uma leitura objetiva da sua consistência, tendência e pontos de melhoria.
          </p>
        </div>
        <span className="chip self-start sm:self-auto">{game.rank.title} · Nv. {game.level}</span>
      </div>

      <FirstVisitTip id="progress" icon={TrendingUp} title="Progresso é onde seus registros viram resposta.">
        Aqui você não precisa interpretar dezenas de números: acompanhe tendência, consistência e o ponto que merece mais atenção agora.
      </FirstVisitTip>

      <div className="progress-command-center surface glass-panel rounded-2xl p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_.95fr] gap-5 lg:gap-7">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Activity size={15} className="text-brass" />
              <p className="text-[10px] text-faint uppercase tracking-widest">Índice Constancce</p>
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-3">
              <RadialProgress value={indexValue} size={116} strokeWidth={9} />
              <div>
                <p className="text-sm font-medium">{indexState}</p>
                <p className="text-[10px] text-faint mt-0.5">escala de 0 a 100</p>
              </div>
            </div>

            <div className="surface-2 rounded-xl p-3 mt-4">
              <p className="text-[9px] text-faint uppercase tracking-widest">Leitura principal</p>
              <p className="text-sm leading-relaxed mt-1">{focusText}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2">
            <div className="progress-signal-card rounded-xl p-3">
              <p className="text-[9px] text-faint uppercase tracking-widest">Tendência</p>
              <div className="flex items-center justify-between gap-3 mt-1">
                <p className="font-medium text-sm">{trendState}</p>
                <span className={`font-mono text-xs ${delta >= 0 ? "text-moss" : "text-ember"}`}>
                  {delta >= 0 ? "+" : ""}{delta} pts
                </span>
              </div>
              <p className="text-[10px] text-faint mt-1">comparado ao período anterior</p>
            </div>

            <div className="progress-signal-card rounded-xl p-3">
              <p className="text-[9px] text-faint uppercase tracking-widest">Força dominante</p>
              <div className="flex items-center justify-between gap-3 mt-1">
                <p className="font-medium text-sm break-words">{strongest.label}</p>
                <span className="font-mono text-xs text-moss">{strongest.value || 0}%</span>
              </div>
              <p className="text-[10px] text-faint mt-1">área com melhor resposta atual</p>
            </div>

            <div className="progress-signal-card rounded-xl p-3">
              <p className="text-[9px] text-faint uppercase tracking-widest">Ponto de alavancagem</p>
              <div className="flex items-center justify-between gap-3 mt-1">
                <p className="font-medium text-sm break-words">{weakest.label}</p>
                <span className="font-mono text-xs text-brass">{weakest.value || 0}%</span>
              </div>
              <p className="text-[10px] text-faint mt-1">onde uma melhora tende a gerar mais impacto</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <div className="progress-kpi surface rounded-2xl p-3 md:p-4">
          <p className="text-[9px] text-faint uppercase tracking-widest">XP acumulado</p>
          <p className="font-display text-xl mt-1">{game.xp.toLocaleString("pt-BR")}</p>
          <p className="text-[9px] text-faint mt-1">progressão total</p>
        </div>
        <div className="progress-kpi surface rounded-2xl p-3 md:p-4">
          <p className="text-[9px] text-faint uppercase tracking-widest">Dias perfeitos seguidos</p>
          <p className="font-display text-xl mt-1">{streaks.current}d</p>
          <p className="text-[9px] text-faint mt-1">todos os hábitos do dia concluídos</p>
        </div>
        <div className="progress-kpi surface rounded-2xl p-3 md:p-4">
          <p className="text-[9px] text-faint uppercase tracking-widest">Recorde de dias perfeitos</p>
          <p className="font-display text-xl mt-1">{streaks.best}d</p>
          <p className="text-[9px] text-faint mt-1">maior sequência já alcançada</p>
        </div>
        <div className="progress-kpi surface rounded-2xl p-3 md:p-4">
          <p className="text-[9px] text-faint uppercase tracking-widest">Melhor dia</p>
          <p className="font-display text-xl mt-1">{stats.highestDayScore || 0}%</p>
          <p className="text-[9px] text-faint mt-1">maior score diário</p>
        </div>
      </div>

      <div className="surface glass-panel rounded-2xl p-4 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-brass" />
              <p className="text-xs text-faint uppercase tracking-widest">Evolução temporal</p>
            </div>
            <p className="text-dim text-xs mt-1">
              Veja se sua consistência está subindo, estabilizando ou recuando nos últimos {rangeLabel}.
            </p>
          </div>

          <div className="progress-range-tabs flex gap-1.5 overflow-x-auto scrollbar-none">
            {[["7d", "7D"], ["30d", "30D"], ["90d", "90D"], ["365d", "1A"]].map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  if (!isPro && id !== "7d") {
                    onUpgrade("progress");
                    return;
                  }
                  setRange(id);
                }}
                className={`chip whitespace-nowrap flex items-center gap-1 ${range === id ? "text-brass" : ""}`}
                style={range === id ? { borderColor: "var(--brass-dim)", background: "var(--surface-2)" } : {}}
              >
                {!isPro && id !== "7d" && <Lock size={9} />}
                {label}
              </button>
            ))}
          </div>
        </div>

        <MiniLineChart data={chartData} height={180} />

        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="surface-2 rounded-xl p-2.5">
            <p className="text-[9px] text-faint">Média atual</p>
            <p className="font-mono text-sm mt-1">{stats.avg30 || 0}/100</p>
          </div>
          <div className="surface-2 rounded-xl p-2.5">
            <p className="text-[9px] text-faint">Média anterior</p>
            <p className="font-mono text-sm mt-1">{stats.prevAvg30 || 0}/100</p>
          </div>
          <div className="surface-2 rounded-xl p-2.5">
            <p className="text-[9px] text-faint">Dias acima de 80</p>
            <p className="font-mono text-sm mt-1">{stats.daysAbove80 || 0}</p>
          </div>
        </div>
      </div>

      {!isPro && (
        <ProLockCard
          feature="progress"
          title="Leitura avançada do seu comportamento"
          description="O PRO libera 30D, 90D e 1 ano, matriz por área, mapa de consistência, diagnóstico inteligente e recordes avançados."
          onUpgrade={onUpgrade}
        />
      )}

      {isPro && (
        <>
          <div className="surface glass-panel rounded-2xl p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Layers3 size={15} className="text-brass" />
                  <p className="text-xs text-faint uppercase tracking-widest">Matriz de performance</p>
                </div>
                <p className="text-dim text-xs mt-1">Compare cada área com o período anterior sem precisar interpretar números complexos.</p>
              </div>
              <span className="chip">30 dias</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {areaPerformance.map((item) => {
                const previous = stats.areaPerformancePrev?.find((row) => row.label === item.label)?.value || 0;
                const areaDelta = Number(item.value || 0) - Number(previous || 0);

                return (
                  <div key={item.label} className="progress-area-card rounded-xl p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-sm">{item.label}</p>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{item.value}%</span>
                        <span className={`font-mono text-[10px] ${areaDelta >= 0 ? "text-moss" : "text-ember"}`}>
                          {areaDelta >= 0 ? "+" : ""}{areaDelta}
                        </span>
                      </div>
                    </div>

                    <div className="progress-area-track mt-3">
                      <span style={{ width: `${Math.max(0, Math.min(100, Number(item.value || 0)))}%` }} />
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-faint mt-2">
                      <span>Antes: {previous}%</span>
                      <span>{areaDelta >= 0 ? "Avançou" : "Recuou"}</span>
                    </div>
                  </div>
                );
              })}

              {areaPerformance.length === 0 && (
                <p className="text-dim text-sm md:col-span-2">Continue usando o Constancce para construir sua matriz de performance.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_.95fr] gap-3">
            <div className="surface glass-panel rounded-2xl p-4 md:p-6">
              <div className="flex items-center gap-2">
                <Grid3X3 size={15} className="text-brass" />
                <p className="text-xs text-faint uppercase tracking-widest">Padrão de consistência</p>
              </div>
              <p className="text-dim text-xs mt-1 mb-4">
                Cada bloco representa um dia. Quanto mais intenso, maior foi sua execução.
              </p>
              <ConsistencyHeatmap days={heatmap} />
              <div className="flex items-center justify-between mt-3 text-[9px] text-faint">
                <span>menor execução</span>
                <span>90 dias</span>
                <span>maior execução</span>
              </div>
            </div>

            <div className="surface glass-panel rounded-2xl p-4 md:p-6">
              <div className="flex items-center gap-2">
                <BrainCircuit size={15} className="text-brass" />
                <p className="text-xs text-faint uppercase tracking-widest">Diagnóstico do sistema</p>
              </div>
              <p className="text-dim text-xs mt-1 mb-3">
                Leituras geradas apenas com os dados registrados no seu próprio app.
              </p>

              <div className="flex flex-col gap-2">
                {insights.slice(0, 4).map((insight, index) => (
                  <div key={index} className="progress-insight rounded-xl p-3 flex items-start gap-3">
                    <span className="progress-insight-index font-mono text-[10px]">{String(index + 1).padStart(2, "0")}</span>
                    <p className="text-sm leading-relaxed">{insight}</p>
                  </div>
                ))}

                {insights.length === 0 && (
                  <div className="progress-insight rounded-xl p-3 text-sm text-dim">
                    Continue registrando sua rotina para gerar um diagnóstico mais preciso.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="surface glass-panel rounded-2xl p-4 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-faint uppercase tracking-widest">Recordes e contexto</p>
                <p className="text-dim text-xs mt-1">Marcos que ajudam a entender até onde você já conseguiu chegar.</p>
              </div>
              <Trophy size={17} className="text-brass" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                ["Tarefas em 1 dia", stats.maxTasksInDay || 0, ListChecks],
                ["Sequência de treinos", `${stats.workoutBestStreak || 0}d`, Dumbbell],
                ["Melhor semana", `${stats.bestWeekAvg || 0}%`, CalendarIcon],
                ["Melhor mês", `${stats.bestMonthAvg || 0}%`, Trophy],
              ].map(([label, value, Icon]) => (
                <div key={label} className="progress-record rounded-xl p-3.5">
                  <Icon size={14} className="text-brass mb-2" />
                  <p className="font-display text-lg">{value}</p>
                  <p className="text-faint text-[10px] mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <ProgressFriendComparison session={session} profile={profile} game={game} streaks={streaks} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-xs text-faint uppercase tracking-widest mb-3">Leitura comportamental</p>
              <div className="flex flex-col gap-3 text-sm">
                <div className="progress-reading-row">
                  <span className="text-dim">Melhor dia</span>
                  <span>{stats.bestWeekday || "—"} · {stats.bestWeekdayAverage || 0}%</span>
                </div>
                <div className="progress-reading-row">
                  <span className="text-dim">Hábito mais consistente</span>
                  <span className="text-right">{stats.bestHabit || "—"} · {stats.bestHabitRate || 0}%</span>
                </div>
                <div className="progress-reading-row">
                  <span className="text-dim">Mais negligenciado</span>
                  <span className="text-right">{stats.worstHabit || "—"} · {stats.worstHabitRate || 0}%</span>
                </div>
              </div>
            </div>

            <div className="progress-season-card surface glass-panel rounded-2xl p-4 md:p-5">
              <p className="text-xs text-faint uppercase tracking-widest">Temporada atual</p>
              <p className="font-display text-2xl mt-1">{game.season?.name || "Temporada"}</p>
              <div className="flex items-baseline gap-2 mt-3">
                <p className="font-mono text-3xl text-brass">{game.season?.xp || 0}</p>
                <span className="text-[10px] text-faint">XP mensal</span>
              </div>
              <p className="text-dim text-xs mt-2">Reinicia mensalmente sem alterar seu nível geral.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AchievementsView({ unlocked, stats, profile, setProfile, isPro, onUpgrade }) {
  const [confirm, confirmDialog] = useConfirm();
  const [selectedReward, setSelectedReward] = useState(null);
  const bestStreak = Math.max(0, Number(stats?.bestStreak || 0));

  const levels = [
    {
      id: "common",
      label: "Comum",
      target: 45,
      period: "45 dias consecutivos",
      approx: "aprox. 1 mês e meio",
      prize: "Prêmio Comum",
      icon: Award,
      description: "Mantenha sua constância por 45 dias seguidos.",
    },
    {
      id: "rare",
      label: "Rara",
      target: 90,
      period: "90 dias consecutivos",
      approx: "aprox. 3 meses",
      prize: "Prêmio Raro",
      icon: Trophy,
      description: "Chegue a 90 dias seguidos sem quebrar sua sequência.",
    },
    {
      id: "epic",
      label: "Épico",
      target: 180,
      period: "180 dias consecutivos",
      approx: "aprox. 6 meses",
      prize: "Prêmio Épico",
      icon: Sparkles,
      description: "Complete meio ano de constância: 180 dias consecutivos.",
    },
    {
      id: "legendary",
      label: "Lendário",
      target: 365,
      period: "365 dias consecutivos",
      approx: "1 ano completo",
      prize: "Prêmio Lendário",
      icon: Flame,
      description: "Permaneça um ano inteiro no desafio: 365 dias consecutivos.",
    },
  ];

  const journeyPct = Math.min(100, Math.round((bestStreak / 365) * 100));
  const nextLevel = levels.find((level) => bestStreak < level.target);
  const unlockedLevels = levels.filter((level) => bestStreak >= level.target).length;

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div>
        <h2 className="font-display text-2xl md:text-3xl">Conquistas</h2>
        <p className="text-dim text-sm mt-1">
          Os prêmios são liberados pela sua maior sequência de dias perfeitos — dias em que todos os hábitos marcados para contar streak foram concluídos. Não é o mesmo número do foguinho de uso no topo do app.
        </p>
      </div>

      <div className="surface rounded-2xl p-4 md:p-5" style={{ borderColor: "var(--brass-dim)" }}>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] text-faint uppercase tracking-widest">Sua jornada até o Lendário</p>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="font-display text-3xl">{bestStreak}</p>
              <span className="text-dim text-sm">dias de recorde</span>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="font-mono text-sm">{unlockedLevels}/4 níveis</p>
            <p className="text-[9px] text-faint uppercase">desbloqueados</p>
          </div>
        </div>

        <Progress value={journeyPct} height={7} />

        <div className="surface-2 rounded-xl p-3 mt-3">
          {nextLevel ? (
            <>
              <p className="text-xs font-medium">Próximo: {nextLevel.label}</p>
              <p className="text-[11px] text-dim mt-1">
                Faltam <strong className="text-brass">{Math.max(0, nextLevel.target - bestStreak)} dias</strong> para alcançar {nextLevel.period}.
              </p>
            </>
          ) : (
            <p className="text-sm text-moss">Você já alcançou o nível Lendário: 365 dias consecutivos.</p>
          )}
        </div>

        <p className="text-[10px] text-faint mt-3">
          A conquista usa a sua maior sequência registrada. Depois de liberar um nível, ele continua conquistado mesmo que sua sequência atual seja reiniciada.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {levels.map((level) => {
          const unlockedLevel = bestStreak >= level.target;
          const progress = Math.min(100, Math.round((bestStreak / level.target) * 100));
          const remaining = Math.max(0, level.target - bestStreak);
          const LevelIcon = level.icon;

          return (
            <button
              key={level.id}
              type="button"
              onClick={() => setSelectedReward({ ...level, unlockedLevel, progress, remaining })}
              className="achievement-level-card surface rounded-2xl p-4 md:p-5 text-left w-full"
              style={{
                borderColor: unlockedLevel ? "var(--brass-dim)" : "var(--border)",
                opacity: unlockedLevel ? 1 : 0.9,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                  style={{
                    background: unlockedLevel ? "var(--brass)" : "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {unlockedLevel
                    ? <LevelIcon size={18} color="#141208" />
                    : <Lock size={16} className="text-faint" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-display text-lg">{level.label}</p>
                    <span className={`chip ${unlockedLevel ? "text-moss" : ""}`}>
                      {unlockedLevel ? "Liberado" : `${progress}%`}
                    </span>
                  </div>

                  <p className="text-xs text-brass mt-1">{level.prize}</p>

                  <div className="surface-2 rounded-xl p-3 mt-3">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Como desbloquear</p>
                    <p className="text-sm font-medium mt-1 break-words">{level.period}</p>
                    <p className="text-[10px] text-faint mt-0.5">{level.approx}</p>
                    <p className="text-xs text-dim mt-2 leading-relaxed">{level.description}</p>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-3 text-[10px] mb-1.5">
                      <span className="text-faint">Seu recorde: {bestStreak} dias</span>
                      <span className={unlockedLevel ? "text-moss" : "text-dim"}>
                        {unlockedLevel ? "Conquistado" : `Faltam ${remaining}`}
                      </span>
                    </div>
                    <Progress value={progress} height={5} />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedReward && (
        <Modal title={`${selectedReward.label} · ${selectedReward.prize}`} onClose={() => setSelectedReward(null)} width={520}>
          <div className="reward-product-preview rounded-2xl overflow-hidden mb-4" style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}>
            <div className="aspect-[4/3] flex flex-col items-center justify-center text-center p-6">
              <ImageIcon size={34} className="text-faint mb-3" />
              <p className="font-display text-lg">Foto do prêmio</p>
              <p className="text-xs text-faint mt-1">A imagem oficial deste produto será adicionada posteriormente.</p>
            </div>
          </div>

          <div className="surface-2 rounded-xl p-4">
            <p className="text-[9px] text-faint uppercase tracking-widest">Critério</p>
            <p className="font-display text-xl mt-1">{selectedReward.period}</p>
            <p className="text-xs text-dim mt-2 leading-relaxed">{selectedReward.description}</p>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                <span className="text-faint">Seu recorde: {bestStreak} dias</span>
                <span className={selectedReward.unlockedLevel ? "text-moss" : "text-brass"}>
                  {selectedReward.unlockedLevel ? "Prêmio desbloqueado" : `Faltam ${selectedReward.remaining} dias`}
                </span>
              </div>
              <Progress value={selectedReward.progress} height={6} />
            </div>
          </div>

          {selectedReward.unlockedLevel && (
            <div className="mt-3">
              {isPro ? (
                (() => {
                  const claim = (profile?.rewardClaims || []).find((item) => item.levelId === selectedReward.id);
                  return claim ? (
                    <div className="surface-2 rounded-xl p-3 text-sm">
                      <div className="flex items-center gap-2 text-moss"><CheckCircle2 size={15} /> Solicitação registrada</div>
                      <p className="text-[10px] text-faint mt-1">Status: {claim.status || "solicitado"} · {claim.requestedAt ? new Date(claim.requestedAt).toLocaleDateString("pt-BR") : ""}</p>
                    </div>
                  ) : (
                    <button
                      className="btn-primary w-full rounded-xl py-3 text-sm"
                      onClick={async () => {
                        if (!(await confirm(`Solicitar o ${selectedReward.prize}?`, { danger: false, confirmLabel: "Solicitar" }))) return;
                        setProfile((current) => ({
                          ...current,
                          rewardClaims: [
                            ...(current?.rewardClaims || []),
                            { levelId: selectedReward.id, prize: selectedReward.prize, requestedAt: new Date().toISOString(), status: "solicitado" },
                          ],
                        }));
                      }}
                    >
                      Solicitar prêmio físico
                    </button>
                  );
                })()
              ) : (
                <ProLockCard
                  feature="prizes"
                  title="Prêmio físico exclusivo PRO"
                  description="A conquista digital já é sua. Torne-se PRO para solicitar o produto correspondente a este nível."
                  onUpgrade={onUpgrade}
                  compact
                />
              )}
            </div>
          )}
        </Modal>
      )}
      {confirmDialog}
    </div>
  );
}

function ChallengeForm({ onSave, onClose }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState(30);
  const [unit, setUnit] = useState("dias");

  return (
    <Modal title="Novo desafio pessoal" onClose={onClose}>
      <Field label="Nome">
        <input className="w-full p-3 ring-focus" placeholder="Ex: 30 dias sem refrigerante" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Meta">
          <input type="number" min="1" className="w-full p-3 ring-focus" value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        <Field label="Unidade">
          <input className="w-full p-3 ring-focus" placeholder="dias, treinos, páginas..." value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
      </div>
      <button
        disabled={!name.trim()}
        className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
        onClick={() => onSave({ id: uid(), name: name.trim(), target, current: 0, unit: unit.trim() || "vezes", createdAt: today(), completed: false })}
      >
        Criar desafio
      </button>
    </Modal>
  );
}

function ChallengeProgressAdder({ challenge, onAdd }) {
  const [amount, setAmount] = useState(1);
  return (
    <div className="flex gap-2 mt-3">
      <input
        type="number"
        min="0.01"
        step="0.01"
        className="w-24 p-2 text-xs ring-focus"
        value={amount}
        onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
      />
      <button
        disabled={amount <= 0}
        className="btn-primary rounded-lg px-3 py-1.5 text-xs flex-1 disabled:opacity-40"
        onClick={() => { onAdd(amount); setAmount(1); }}
      >
        Adicionar {challenge.unit}
      </button>
    </div>
  );
}

function ChallengesView({ session, profile, setProfile, game, streaks, autoOpen, isPro, onUpgrade }) {
  const [confirm, confirmDialog] = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [friends, setFriends] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const personal = profile?.personalChallenges || [];
  const socialMetric = profile?.socialChallengeMetric || "xp";

  useEffect(() => {
    if (!autoOpen) return;
    const activeChallenges = (profile?.personalChallenges || []).filter((challenge) => !challenge.completed).length;
    if (!isPro && activeChallenges >= PRO_LIMITS.challenges) {
      onUpgrade("challenges");
      return;
    }
    setShowForm(true);
  }, [autoOpen]);

  useEffect(() => {
    let active = true;
    if (!session?.user?.id) return;
    setLoadingFriends(true);
    fetchFriends(session)
      .then((rows) => { if (active) setFriends((rows || []).filter((r) => r.status === "accepted")); })
      .catch(() => { if (active) setFriends([]); })
      .finally(() => { if (active) setLoadingFriends(false); });
    return () => { active = false; };
  }, [session]);

  const saveChallenge = (challenge) => {
    const activeChallenges = (profile?.personalChallenges || []).filter((item) => !item.completed).length;
    if (!isPro && activeChallenges >= PRO_LIMITS.challenges) {
      onUpgrade("challenges");
      return false;
    }
    setProfile((p) => ({ ...p, personalChallenges: [...(p?.personalChallenges || []), challenge] }));
    setShowForm(false);
    return true;
  };

  const addChallengeProgress = (id, delta = 1) => {
    setProfile((p) => ({
      ...p,
      personalChallenges: (p?.personalChallenges || []).map((challenge) => {
        if (challenge.id !== id) return challenge;
        const current = Math.min(Number(challenge.target || 0), Number(challenge.current || 0) + Number(delta || 0));
        return { ...challenge, current, completed: current >= Number(challenge.target || 0), completedAt: current >= Number(challenge.target || 0) ? today() : challenge.completedAt };
      }),
    }));
  };

  const removeChallenge = async (id) => {
    if (!(await confirm("Excluir este desafio?"))) return;
    setProfile((p) => ({ ...p, personalChallenges: (p?.personalChallenges || []).filter((x) => x.id !== id) }));
  };

  const own = {
    user_id: session?.user?.id,
    display_name: profile?.name || "Você",
    xp: game.xp,
    score: game.score,
    streak_current: streaks.current,
    isMe: true,
  };
  const socialRows = [own, ...friends].sort((a, b) => {
    const key = socialMetric === "streak" ? "streak_current" : socialMetric;
    return Number(b[key] || 0) - Number(a[key] || 0);
  });

  const socialValue = (row) => {
    if (socialMetric === "score") return `${Number(row.score || 0)}/100`;
    if (socialMetric === "streak") return `${Number(row.streak_current || 0)}d`;
    return `${Number(row.xp || 0).toLocaleString("pt-BR")} XP`;
  };

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl md:text-3xl">Desafios</h2>
          <p className="text-dim text-sm mt-1">Crie compromissos pessoais e dispute evolução com seus amigos.</p>
        </div>
        <button
          className="btn-primary rounded-xl px-3 py-2 text-sm flex items-center gap-1"
          onClick={() => {
            const activeChallenges = personal.filter((challenge) => !challenge.completed).length;
            if (!isPro && activeChallenges >= PRO_LIMITS.challenges) {
              onUpgrade("challenges");
              return;
            }
            setShowForm(true);
          }}
        >
          <Plus size={15} /> Novo
          {!isPro && <span className="text-[9px] opacity-70">1 Free</span>}
        </button>
      </div>

      <div className="surface rounded-2xl p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-4">Desafios pessoais</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {personal.length === 0 && <p className="text-dim text-sm">Crie seu primeiro desafio: leitura, treino, economia, alimentação ou qualquer objetivo mensurável.</p>}
          {personal.map((challenge) => {
            const pct = Math.min(100, Math.round(Number(challenge.current || 0) / Math.max(1, Number(challenge.target || 1)) * 100));
            return (
              <div key={challenge.id} className="surface-2 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm break-words">{challenge.name}</p>
                    <p className="text-faint text-[10px] mt-1">{challenge.current}/{challenge.target} {challenge.unit}</p>
                  </div>
                  {challenge.completed ? <Trophy size={16} className="text-brass" /> : <Zap size={16} className="text-moss" />}
                </div>
                <Progress value={pct} height={6} />
                {!challenge.completed && <ChallengeProgressAdder challenge={challenge} onAdd={(amount) => addChallengeProgress(challenge.id, amount)} />}
                <div className="flex justify-end mt-2">
                  <button className="btn-ghost rounded-lg p-2" onClick={() => removeChallenge(challenge.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="surface rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <p className="text-xs text-faint uppercase tracking-widest">Desafio entre amigos</p>
            <p className="text-dim text-xs mt-1">Uma competição viva com os dados públicos do ranking.</p>
          </div>
          <select
            className="p-2 rounded-xl text-sm ring-focus"
            value={socialMetric}
            onChange={(e) => setProfile((p) => ({ ...p, socialChallengeMetric: e.target.value }))}
          >
            <option value="xp">Mais XP</option>
            <option value="score">Maior score</option>
            <option value="streak">Maior sequência</option>
          </select>
        </div>

        {loadingFriends ? <p className="text-dim text-sm">Carregando amigos…</p> : (
          <div className="flex flex-col gap-2">
            {socialRows.map((row, index) => (
              <div key={row.user_id || index} className="surface-2 rounded-xl p-3 flex items-center gap-3">
                <span className="font-mono text-brass text-xs w-6">#{index + 1}</span>
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{row.isMe ? "Você" : (row.display_name || "Amigo")}</span>
                <span className="font-mono text-xs">{socialValue(row)}</span>
              </div>
            ))}
            {friends.length === 0 && <p className="text-faint text-xs">Adicione amigos para transformar essa área em uma disputa real.</p>}
          </div>
        )}
      </div>

      {showForm && <ChallengeForm onClose={() => setShowForm(false)} onSave={saveChallenge} />}
      {confirmDialog}
    </div>
  );
}

function TimelineView({ habits, completions, tasks, goals, workoutSessions, goalProgressLog, stats, isPro, onUpgrade }) {
  const events = useMemo(() => {
    const rows = [];

    const firstHabitCompletion = [...completions].sort((a, b) => a.date.localeCompare(b.date))[0];
    if (firstHabitCompletion) {
      rows.push({ id: "first-habit", date: firstHabitCompletion.date, title: "Primeiro hábito concluído", desc: "O início da sua jornada registrada no Constancce.", icon: ListChecks });
    }

    workoutSessions.filter((s) => s.completed).forEach((session) => {
      rows.push({ id: `workout-${session.id}`, date: session.date, title: "Treino concluído", desc: "Mais uma sessão registrada na sua evolução física.", icon: Dumbbell });
    });

    goals.filter((g) => g.completed).forEach((goal) => {
      rows.push({ id: `goal-${goal.id}`, date: goal.completedAt || goal.endDate || today(), title: `Meta alcançada: ${goal.name}`, desc: goal.type === "financeira" ? `Objetivo de ${money(goal.target)} concluído.` : "Objetivo concluído.", icon: Trophy });
    });

    tasks.filter((task) => !isRecurringTask(task) && task.status === "concluida" && task.completedAt).forEach((task) => {
      rows.push({ id: `task-${task.id}`, date: task.completedAt, title: `Tarefa entregue: ${task.title}`, desc: "Execução concluída.", icon: CheckCircle2 });
    });

    goalProgressLog.forEach((log) => {
      const goal = goals.find((g) => g.id === log.goalId);
      if (!goal || !goal.target || goal.completed) return;
      const pct = Math.round(Number(log.value || 0) / Number(goal.target) * 100);
      const milestone = [25, 50, 75].find((m) => Math.abs(pct - m) <= 3);
      if (milestone) rows.push({ id: `milestone-${log.id}`, date: log.date, title: `${milestone}% da meta ${goal.name}`, desc: "Marco intermediário alcançado.", icon: Target });
    });

    if (stats.bestStreak >= 7) rows.push({ id: "streak-current-best", date: today(), title: `Recorde de ${stats.bestStreak} dias`, desc: "Sua maior sequência de dias perfeitos registrada até agora.", icon: Flame });

    const sorted = rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return isPro ? sorted.slice(0, 120) : sorted.filter((event) => event.date >= proCutoffDate()).slice(0, 60);
  }, [habits, completions, tasks, goals, workoutSessions, goalProgressLog, stats.bestStreak]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-2xl md:text-3xl">Jornada</h2>
        <p className="text-dim text-sm mt-1">Sua história de disciplina, evolução e marcos importantes.</p>
      </div>

      <div className="surface rounded-2xl p-4 md:p-5">
        {events.length === 0 && <p className="text-dim text-sm py-4">Sua timeline aparecerá conforme você conclui hábitos, tarefas, treinos e metas.</p>}
        <div className="flex flex-col">
          {events.map((event, index) => {
            const Icon = event.icon;
            return (
              <div key={event.id} className="flex gap-3 relative pb-5">
                {index < events.length - 1 && <div className="absolute left-[17px] top-9 bottom-0 w-px" style={{ background: "var(--border)" }} />}
                <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center z-10" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <Icon size={15} className="text-brass" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-[10px] text-faint">{dateLabel(event.date)}</p>
                  <p className="font-medium text-sm mt-0.5 break-words">{event.title}</p>
                  <p className="text-dim text-xs mt-1">{event.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!isPro && (
        <ProLockCard
          feature="timeline"
          title="Jornada completa"
          description="No plano Free, a Jornada mostra os últimos 30 dias. Seus eventos antigos continuam salvos e voltam a aparecer ao liberar o PRO."
          onUpgrade={onUpgrade}
        />
      )}
    </div>
  );
}



function FriendsView({ session, profile, game, streaks, isPro, onUpgrade }) {
  const [rows, setRows] = useState([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    try { setRows((await fetchFriends(session)) || []); setNotice(null); }
    catch (e) { setNotice({ type:'error', text:'Não foi possível carregar seus amigos agora. Tente novamente em instantes.' }); }
    finally { setLoading(false); }
  }, [session]);
  useEffect(()=>{ load(); },[load]);

  const add = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    const currentFriendSlots = rows.filter((row) => row.status === "accepted" || row.status === "pending").length;
    if (!isPro && currentFriendSlots >= PRO_LIMITS.friends) {
      onUpgrade("friends");
      return;
    }
    setActionLoading(true); setNotice(null);
    try { await addFriendByEmail(session,email); setEmail(''); setNotice({type:'ok',text:'Convite enviado. Quando a pessoa aceitar, ela entra no seu ranking.'}); await load(); }
    catch(e){ const raw=(e.message||'').toLowerCase(); const text=raw.includes('not found')||raw.includes('não encontrado')?'Nenhum usuário cadastrado com esse e-mail.':raw.includes('yourself')||raw.includes('mesmo usuário')?'Você não pode adicionar sua própria conta.':raw.includes('already')||raw.includes('já existe')?'Já existe um convite ou amizade com esse usuário.':'Não foi possível enviar o convite.'; setNotice({type:'error',text}); }
    finally { setActionLoading(false); }
  };
  const respond = async (id, accept) => { setActionLoading(true); try { await respondFriendRequest(session,id,accept); await load(); } finally { setActionLoading(false); } };
  const remove = async (id) => { if (!(await confirm('Remover este amigo?', { confirmLabel: "Remover" }))) return; setActionLoading(true); try { await removeFriendship(session,id); setSelected(null); await load(); } finally { setActionLoading(false); } };
  const accepted=rows.filter((r)=>r.status==='accepted');
  const received=rows.filter((r)=>r.status==='pending'&&r.direction==='received');
  const sent=rows.filter((r)=>r.status==='pending'&&r.direction==='sent');
  const own={user_id:session?.user?.id,display_name:profile?.name||'Você',email:session?.user?.email,avatar_data_url:profile?.avatarDataUrl,level:game.level,rank_name:game.rank?.title||'Recruta',xp:game.xp,score:game.score||0,streak_current:streaks.current,streak_best:streaks.best,isMe:true};
  const leaderboard=[own,...accepted].sort((a,b)=>Number(b.xp||0)-Number(a.xp||0));

  const Avatar=({r,size='w-11 h-11'}) => r.avatar_data_url?<img src={r.avatar_data_url} className={`${size} rounded-full object-cover border hairline`} alt=""/>:<div className={`${size} rounded-full flex items-center justify-center font-display`} style={{background:'var(--surface-2)',border:'1px solid var(--border)'}}>{(r.display_name||r.email||'?')[0]?.toUpperCase()}</div>;
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-2xl">Amigos</h2><p className="text-dim text-xs mt-1">Compitam por XP, nível e constância.</p></div><div className="flex items-center gap-2">{!isPro && <span className="chip">até {PRO_LIMITS.friends} Free</span>}<Swords size={22} className="text-brass"/></div></div>
    <form onSubmit={add} className="surface rounded-2xl p-4 md:p-5">
      <p className="text-xs text-faint uppercase tracking-widest mb-3">Adicionar por e-mail</p>
      <div className="flex flex-col sm:flex-row gap-2"><div className="relative flex-1"><Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="amigo@email.com" className="w-full pl-9 pr-3 py-3 ring-focus"/></div><button disabled={actionLoading} className="btn-primary rounded-xl px-4 py-3 text-sm flex items-center justify-center gap-2"><UserPlus size={15}/>{actionLoading?'Aguarde…':'Enviar convite'}</button></div>
      {notice&&<p className={`text-xs mt-3 ${notice.type==='error'?'text-ember':'text-moss'}`}>{notice.text}</p>}
    </form>
    {received.length>0&&<div className="surface rounded-2xl p-4 md:p-5"><p className="text-xs text-faint uppercase tracking-widest mb-3">Convites recebidos</p><div className="flex flex-col gap-2">{received.map(r=><div key={r.friendship_id} className="surface-2 p-3 flex flex-col sm:flex-row sm:items-center gap-3"><div className="flex items-center gap-3 flex-1 min-w-0"><Avatar r={r}/><div className="min-w-0"><p className="text-sm font-semibold truncate">{r.display_name||'Usuário'}</p><p className="text-faint text-xs truncate">{r.email}</p></div></div><div className="flex gap-2"><button className="btn-primary rounded-lg px-3 py-2 text-xs flex-1 sm:flex-none" onClick={()=>respond(r.friendship_id,true)}><Check size={13} className="inline mr-1"/>Aceitar</button><button className="btn-ghost rounded-lg px-3 py-2 text-xs flex-1 sm:flex-none" onClick={()=>respond(r.friendship_id,false)}>Recusar</button></div></div>)}</div></div>}
    {sent.length>0&&<div className="surface-2 rounded-2xl p-4"><p className="text-xs text-faint uppercase tracking-widest mb-2">Convites enviados</p>{sent.map(r=><div key={r.friendship_id} className="flex items-center gap-2 text-sm py-1"><RefreshCw size={13} className="text-brass"/><span className="truncate flex-1">{r.display_name||r.email}</span><span className="chip">Pendente</span></div>)}</div>}
    <div className="surface rounded-2xl p-4 md:p-5">
      <div className="flex items-center justify-between mb-4"><div><p className="text-xs text-faint uppercase tracking-widest">Ranking entre amigos</p><p className="text-dim text-xs mt-1">Ordenado pelo XP total.</p></div><span className="chip">{accepted.length} amigo{accepted.length===1?'':'s'}</span></div>
      {loading?<div className="py-10 text-center text-dim text-sm">Carregando ranking…</div>:<div className="flex flex-col gap-2">{leaderboard.map((r,i)=><button key={r.user_id} onClick={()=>!r.isMe&&setSelected(r)} className="surface-2 p-3 md:p-4 text-left flex items-center gap-3 hover:-translate-y-[1px]">
        <div className="font-mono text-sm w-6 text-center text-brass">#{i+1}</div><Avatar r={r}/><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><p className="font-semibold text-sm truncate">{r.display_name||'Usuário'}</p>{r.isMe&&<span className="chip">Você</span>}</div><p className="text-faint text-[11px] truncate">{r.rank_name||'Recruta'} · Nível {r.level||1}</p></div><div className="text-right shrink-0"><p className="font-mono text-sm">{Number(r.xp||0).toLocaleString('pt-BR')} XP</p><p className="text-faint text-[10px]">{r.streak_current||0}d perfeitos</p></div>
      </button>)}</div>}
    </div>
    {selected&&<Modal title="Perfil do amigo" onClose={()=>setSelected(null)}><div className="flex flex-col gap-4"><div className="flex items-center gap-4"><Avatar r={selected} size="w-16 h-16"/><div className="min-w-0"><p className="font-display text-xl truncate">{selected.display_name||'Usuário'}</p><p className="text-faint text-xs truncate">{selected.email}</p><p className="text-brass text-xs mt-1">{selected.rank_name||'Recruta'} · Nível {selected.level||1}</p></div></div><div className="grid grid-cols-2 gap-2"><StatMini label="XP" value={Number(selected.xp||0).toLocaleString('pt-BR')}/><StatMini label="Score atual" value={`${selected.score||0}/100`}/><StatMini label="Dias perfeitos" value={`${selected.streak_current||0}d`}/><StatMini label="Recorde" value={`${selected.streak_best||0}d`}/></div><button className="btn-ghost rounded-xl py-2.5 text-sm text-ember" onClick={()=>remove(selected.friendship_id)}>Remover amigo</button></div></Modal>}
    {confirmDialog}
  </div>;
}

function PlanComparisonSection({ isPro, accessInfo, onUpgrade }) {
  const freeItems = [
    "5 hábitos · 5 tarefas ativas",
    "2 treinos · 1 meta ativa",
    "Até 8 lançamentos financeiros",
    "Até 2 alimentos por refeição do dia",
    "Histórico recente de 30 dias",
    "Notificações básicas",
  ];

  const proItems = [
    "Hábitos, tarefas, treinos e metas ilimitados",
    "Histórico completo + análises avançadas",
    "Intelligence + Assistente Financeiro",
    "Produtos por barcode, TMB e Nutrition Intelligence",
    "Temas, menu personalizado e prêmios físicos",
  ];

  return (
    <div className="plan-section surface rounded-2xl p-4 md:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] text-faint uppercase tracking-widest">Planos e recursos</p>
          <p className="font-display text-xl mt-1">Seu nível no Constancce</p>
          <p className="text-xs text-dim mt-1">O Free organiza. O PRO analisa, automatiza e amplia.</p>
        </div>
        <span className={`plan-current-chip chip self-start ${isPro ? "text-moss" : "text-brass"}`}>
          {isPro ? "PRO ativo" : "Free ativo"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          className={`plan-tier-card rounded-2xl p-4 ${!isPro ? "plan-tier-active" : ""}`}
          style={{ border: `1px solid ${!isPro ? "var(--brass-dim)" : "var(--border)"}` }}
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-[9px] text-faint uppercase tracking-widest">Constancce</p>
              <p className="font-display text-2xl mt-1">Free</p>
            </div>
            {!isPro ? (
              <span className="chip text-brass">Seu plano</span>
            ) : (
              <span className="chip">Base</span>
            )}
          </div>

          <div className="flex items-baseline gap-1 mb-4">
            <span className="font-display text-2xl">R$ 0</span>
            <span className="text-[10px] text-faint">para sempre</span>
          </div>

          <div className="flex flex-col gap-2">
            {freeItems.map((item) => (
              <div key={item} className="flex items-start gap-2 text-xs text-dim">
                <Check size={13} className="text-moss shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`plan-tier-card plan-tier-pro rounded-2xl p-4 ${isPro ? "plan-tier-active" : ""}`}
          style={{ border: `1px solid ${isPro ? "var(--brass)" : "var(--brass-dim)"}` }}
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[9px] text-faint uppercase tracking-widest">Constancce</p>
                <ProBadge compact />
              </div>
              <p className="font-display text-2xl mt-1">PRO</p>
            </div>
            {isPro ? (
              <span className="chip text-moss">Seu plano</span>
            ) : (
              <Sparkles size={18} className="text-brass" />
            )}
          </div>

          <div className="flex items-baseline gap-1 mb-4">
            <span className="font-display text-2xl">R$ 37,90</span>
            <span className="text-[10px] text-faint">vitalício</span>
          </div>

          <div className="flex flex-col gap-2">
            {proItems.map((item) => (
              <div key={item} className="flex items-start gap-2 text-xs text-dim">
                <Check size={13} className="text-brass shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          {!isPro && (
            <div className="flex justify-center mt-5">
              <button
                className="plan-upgrade-button btn-primary rounded-xl px-6 py-2.5 text-sm inline-flex items-center justify-center gap-2"
                onClick={() => onUpgrade("intelligence")}
              >
                <Sparkles size={14} />
                Atualizar para PRO
              </button>
            </div>
          )}

          {isPro && accessInfo?.isLifetime && (
            <div className="flex justify-center mt-4">
              <div className="surface-2 rounded-xl px-4 py-2 inline-flex items-center justify-center gap-2 text-xs text-moss">
                <Trophy size={13} />
                <span>Founder vitalício ativo</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileView({ profile, setProfile, theme, setTheme, streaks, stats, lastSaved, syncStatus, genericHasPending, taskSyncStatus, taskSyncError, session, user, onLogout, onSyncNow, onDeleteAccount, installPrompt, onInstallApp, access, accessInfo, isPro, onUpgrade, onBuyLifetime, checkoutLoading, paymentMessage, accessError }) {
  const [name, setName] = useState(profile?.name || "");
  const [accountEmail, setAccountEmail] = useState(user?.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const avatarFileRef = useRef(null);

  useEffect(() => { setName(profile?.name || ""); }, [profile?.name]);
  useEffect(() => { setAccountEmail(user?.email || ""); }, [user?.email]);

  const handleAvatarUpload = async (file) => {
    if (!file || !file.type?.startsWith("image/")) return;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = dataUrl;
      });
      const size = 360;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      const optimized = canvas.toDataURL("image/jpeg", 0.84);
      setProfile((p) => ({ ...p, avatarDataUrl: optimized }));
    } catch (e) {
      // Mantém a foto atual caso o arquivo não possa ser processado.
    }
  };

  const genericStatusLabel = syncStatus === "syncing"
    ? "Sincronizando outros dados…"
    : syncStatus === "offline"
      ? (genericHasPending ? "Offline · alterações aguardam internet" : "Offline · dados locais disponíveis")
      : syncStatus === "error"
        ? (genericHasPending ? "Outros dados aguardam confirmação" : "Não foi possível verificar outros dados agora")
        : "Outros dados sincronizados";
  const taskStatusLabel = taskSyncStatus === "syncing"
    ? "Sincronizando tarefas…"
    : taskSyncStatus === "offline"
      ? "Tarefas salvas neste dispositivo · offline"
      : taskSyncStatus === "error"
        ? "Falha ao confirmar tarefas"
        : "Tarefas sincronizadas";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-2xl">Perfil</h2>
      <div className="surface rounded-2xl p-5 flex items-center gap-4">
        <div className="relative shrink-0">
          {profile?.avatarDataUrl ? (
            <img src={profile.avatarDataUrl} alt="Foto de perfil" className="profile-avatar" style={{ border: "1px solid var(--border)" }} />
          ) : (
            <div className="profile-avatar flex items-center justify-center font-display text-2xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>{(profile?.name || "?")[0]?.toUpperCase()}</div>
          )}
          <button type="button" className="avatar-action" onClick={() => avatarFileRef.current?.click()} aria-label="Alterar foto de perfil"><Camera size={13} /></button>
          <input ref={avatarFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (file) handleAvatarUpload(file); e.target.value = ""; }} />
        </div>
        <div className="flex-1 min-w-0">
          <input className="w-full p-2.5 ring-focus mb-1" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setProfile((p) => ({ ...p, name }))} />
          <p className="text-faint text-xs truncate">{profile?.goalFocus}</p>
          {profile?.avatarDataUrl && <button type="button" className="text-[10px] text-faint mt-1 hover:text-dim" onClick={() => setProfile((p) => ({ ...p, avatarDataUrl: null }))}>Remover foto</button>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatMini label="Dias perfeitos" value={`${streaks.current}d`} />
        <StatMini label="Recorde" value={`${streaks.best}d`} />
        <StatMini label="Níveis" value="4" />
      </div>

      <div className="surface rounded-2xl p-4 md:p-5" style={{ borderColor: isPro ? "var(--brass-dim)" : "var(--border)" }}>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] text-faint uppercase tracking-widest">Seu plano</p>
              {isPro && <ProBadge />}
              {accessInfo?.isLifetime && <span className="chip text-moss">FOUNDING MEMBER</span>}
            </div>
            <p className="font-display text-2xl mt-1">{accessInfo?.planLabel || "Constancce Free"}</p>
            <p className="text-xs text-dim mt-1">
              {accessInfo?.isLifetime
                ? "Acesso PRO vitalício vinculado à sua conta."
                : accessInfo?.isTrial
                  ? `Você está testando todos os recursos PRO. Restam ${accessInfo.daysRemaining} dia${accessInfo.daysRemaining === 1 ? "" : "s"}.`
                  : "Registre sua rotina gratuitamente. O PRO libera análise, automação, personalização e recompensas."}
            </p>
            {accessInfo?.isLifetime && access?.created_at && (
              <p className="text-[10px] text-faint mt-2">
                Membro há {Math.max(1, Math.floor((Date.now() - new Date(access.created_at).getTime()) / 86400000))} dias.
              </p>
            )}
          </div>
          {!isPro && (
            <button className="btn-primary rounded-xl px-4 py-2.5 text-sm shrink-0" onClick={() => onUpgrade("intelligence")}>
              Desbloquear PRO
            </button>
          )}
        </div>

        {accessInfo?.isTrial && (
          <div
            className="surface-2 rounded-2xl p-4 mt-4"
            style={{ border: "1px solid var(--brass-dim)", background: "linear-gradient(135deg, color-mix(in srgb, var(--brass) 10%, var(--surface-2)), var(--surface-2))" }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--surface)", color: "var(--brass)", border: "1px solid var(--brass-dim)" }}>
                <Flame size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-faint uppercase tracking-widest">Acesso PRO temporário</p>
                <p className="font-display text-xl mt-1">
                  {accessInfo.daysRemaining} {accessInfo.daysRemaining === 1 ? "dia restante" : "dias restantes"}
                </p>
                <p className="text-xs text-dim mt-2 leading-relaxed">
                  Você está aproveitando todos os recursos do Constancce PRO. Garanta seu acesso vitalício antes que seu período termine.
                </p>
                <button
                  type="button"
                  className="btn-primary rounded-xl px-4 py-3 text-sm w-full mt-4 inline-flex items-center justify-center gap-2"
                  onClick={() => onBuyLifetime?.()}
                  disabled={checkoutLoading}
                >
                  <CreditCard size={15} />
                  {checkoutLoading ? "Abrindo pagamento…" : "Garantir PRO Vitalício — R$ 37,90"}
                </button>
                {(paymentMessage || accessError) && (
                  <div className="surface rounded-xl p-3 mt-3 text-xs text-dim flex items-start gap-2" role="status">
                    <ShieldCheck size={14} className="text-brass shrink-0 mt-0.5" />
                    <span>{paymentMessage || accessError}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!isPro && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            <div className="surface-2 rounded-xl p-2.5"><p className="text-[9px] text-faint">Hábitos</p><p className="font-mono text-xs mt-1">5</p></div>
            <div className="surface-2 rounded-xl p-2.5"><p className="text-[9px] text-faint">Tarefas ativas</p><p className="font-mono text-xs mt-1">5</p></div>
            <div className="surface-2 rounded-xl p-2.5"><p className="text-[9px] text-faint">Treinos</p><p className="font-mono text-xs mt-1">2</p></div>
            <div className="surface-2 rounded-xl p-2.5"><p className="text-[9px] text-faint">Metas ativas</p><p className="font-mono text-xs mt-1">2</p></div>
          </div>
        )}
      </div>

      <PlanComparisonSection isPro={isPro} accessInfo={accessInfo} onUpgrade={onUpgrade} />

      <div className="surface rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Palette size={16} className="text-brass" />
          <p className="text-xs text-faint uppercase tracking-widest">Cor do aplicativo</p>
        </div>
        <p className="text-dim text-xs mb-4">Personalize a cor principal da sua interface.</p>
        <div className="grid grid-cols-4 gap-2">
          {[
            ["green", "Verde", "#69D36F"],
            ["pink", "Rosa", "#F06DA8"],
            ["blue", "Azul", "#5B9CFF"],
            ["purple", "Roxo", "#A77BFF"],
          ].map(([id, label, color]) => {
            const selected = (profile?.accentTheme || "green") === id;
            return (
              <button
                key={id}
                className="rounded-xl p-2.5 text-xs flex flex-col items-center gap-2"
                onClick={() => {
                  if (!isPro && id !== "green") {
                    onUpgrade("personalization");
                    return;
                  }
                  setProfile((p) => ({ ...p, accentTheme: id }));
                }}
                style={{
                  border: `1px solid ${selected && (isPro || id === "green") ? color : "var(--border)"}`,
                  background: selected && (isPro || id === "green") ? "var(--surface-2)" : "transparent",
                  opacity: !isPro && id !== "green" ? .68 : 1,
                }}
              >
                <span className="w-7 h-7 rounded-full block relative" style={{ background: color, boxShadow: selected && (isPro || id === "green") ? `0 0 0 3px ${color}33` : "none" }}>
                  {!isPro && id !== "green" && <Lock size={11} className="absolute inset-0 m-auto text-white" />}
                </span>
                <span className="flex items-center gap-1" style={{ color: selected && (isPro || id === "green") ? "var(--text)" : "var(--text-dim)" }}>{label}{!isPro && id !== "green" && <ProBadge compact />}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="menu-order-section surface rounded-2xl p-3 md:p-5">
        <div className="flex items-center gap-2 mb-1">
          <GripVertical size={15} className="text-brass" />
          <p className="text-xs text-faint uppercase tracking-widest">Ordem do menu</p>
          {!isPro && <ProBadge compact />}
        </div>
        <p className="menu-order-description text-dim text-xs mb-3 md:mb-4">
          Organize as seções. As primeiras 5 ficam no menu principal; as demais em “Mais”.
        </p>

        <div className="menu-order-list flex flex-col gap-2">
          {(() => {
            const validNavIds = NAV.map((item) => item.id);
            const rawOrder = Array.isArray(profile?.menuOrder) && profile.menuOrder.length
              ? [
                  ...profile.menuOrder.filter((id) => validNavIds.includes(id)),
                  ...validNavIds.filter((id) => !profile.menuOrder.includes(id)),
                ]
              : validNavIds;
            const currentOrder = [...rawOrder.filter((id) => id !== "profile"), "profile"];

            return currentOrder.map((id, index) => {
              const item = NAV.find((navItem) => navItem.id === id);
              if (!item) return null;
              const Icon = item.icon;
              const enabled = moduleEnabled(profile, id);

              const move = (direction) => {
                if (!isPro) {
                  onUpgrade("personalization");
                  return;
                }
                if (id === "profile") return;
                const nextIndex = direction === "up" ? index - 1 : index + 1;
                if (currentOrder[nextIndex] === "profile") return;
                if (nextIndex < 0 || nextIndex >= currentOrder.length) return;
                const next = [...currentOrder];
                [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
                setProfile((p) => ({ ...p, menuOrder: next }));
              };

              return (
                <div key={id} className="menu-order-item surface-2 rounded-xl px-3 py-2.5 flex items-center gap-3">
                  <span className="menu-order-number font-mono text-[10px] text-faint w-5">{String(index + 1).padStart(2, "0")}</span>
                  <Icon size={15} className={index < 5 && enabled ? "text-brass" : "text-faint"} />
                  <div className="menu-order-copy flex-1 min-w-0">
                    <p className="menu-order-label text-sm">{item.label}</p>
                    <p className="menu-order-meta text-[9px] text-faint">
                      {!enabled ? "Oculto" : index < 5 ? "Menu principal" : "Menu Mais"}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button className="menu-order-control btn-ghost rounded-lg p-2 disabled:opacity-20" disabled={index === 0 || id === "profile"} onClick={() => move("up")} aria-label={`Mover ${item.label} para cima`}>
                      <ChevronUp size={13} />
                    </button>
                    <button className="menu-order-control btn-ghost rounded-lg p-2 disabled:opacity-20" disabled={index === currentOrder.length - 1 || id === "profile" || currentOrder[index + 1] === "profile"} onClick={() => move("down")} aria-label={`Mover ${item.label} para baixo`}>
                      <ChevronDown size={13} />
                    </button>
                  </div>
                </div>
              );
            });
          })()}
        </div>

        <button
          className="btn-ghost w-full rounded-xl py-2.5 text-xs mt-3"
          onClick={() => {
            if (!isPro) {
              onUpgrade("personalization");
              return;
            }
            setProfile((p) => ({ ...p, menuOrder: NAV.map((item) => item.id) }));
          }}
        >
          {isPro ? "Restaurar ordem padrão" : "Personalizar ordem · PRO"}
        </button>
      </div>

      <div className="surface rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <SlidersHorizontal size={15} className="text-brass" />
          <p className="text-xs text-faint uppercase tracking-widest">Módulos do Constancce</p>
        </div>
        <p className="text-dim text-xs mb-4">Escolha quais áreas aparecem na sua navegação. Hoje, Perfil e Notificações permanecem sempre disponíveis.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ["habits", "Hábitos"], ["tasks", "Tarefas"], ["calendar", "Calendário"], ["goals", "Metas"],
            ["workouts", "Treinos"], ["food", "Dieta"], ["finance", "Finanças"], ["friends", "Amigos"],
            ["professional", "Personal & Nutri"],
            ["progress", "Progresso"], ["achievements", "Conquistas"],
          ].map(([id, label]) => {
            const enabled = profile?.moduleVisibility?.[id] !== false;
            return (
              <div key={id} className="flex items-center justify-between gap-3 text-sm surface-2 rounded-xl px-3 py-2.5">
                <span>{label}</span>
                <button
                  className="module-visibility-toggle w-10 h-6 rounded-full relative shrink-0"
                  onClick={() => setProfile((p) => ({ ...p, moduleVisibility: { ...(p?.moduleVisibility || {}), [id]: !enabled } }))}
                  style={{ background: enabled ? "var(--brass)" : "var(--border)" }}
                  aria-label={`${enabled ? "Ocultar" : "Mostrar"} ${label}`}
                >
                  <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: enabled ? 18 : 2 }} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {isPro ? (
        <div className="surface rounded-2xl p-5">
          <p className="text-xs text-faint uppercase tracking-widest mb-3">Metas nutricionais diárias</p>
          <div className="grid grid-cols-2 gap-3">
            {[["calorieTarget", "Calorias (kcal)"], ["proteinTarget", "Proteínas (g)"], ["carbTarget", "Carboidratos (g)"], ["fatTarget", "Gorduras (g)"]].map(([key, label]) => (
              <Field key={key} label={label}>
                <input type="number" className="w-full p-2.5 ring-focus" defaultValue={profile?.[key] || (key === "calorieTarget" ? 2200 : key === "proteinTarget" ? 150 : key === "carbTarget" ? 250 : 70)}
                  onBlur={(e) => setProfile((p) => ({ ...p, [key]: Number(e.target.value) }))} />
              </Field>
            ))}
          </div>
        </div>
      ) : (
        <ProLockCard feature="diet" title="Metas nutricionais personalizadas" onUpgrade={onUpgrade} />
      )}
      <div className="surface rounded-2xl p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-3">Fuso horário</p>
        <select className="w-full p-3 ring-focus" defaultValue={profile?.timezone || "America/Sao_Paulo"} onChange={(e) => setProfile((p) => ({ ...p, timezone: e.target.value }))}>
          <option value="America/Sao_Paulo">Brasília (GMT-3)</option>
          <option value="America/Manaus">Manaus (GMT-4)</option>
          <option value="America/Noronha">Fernando de Noronha (GMT-2)</option>
          <option value="America/Rio_Branco">Rio Branco (GMT-5)</option>
        </select>
      </div>
      <div className="surface rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={15} className="text-brass" />
          <p className="text-xs text-faint uppercase tracking-widest">Privacidade e diagnóstico</p>
        </div>
        <p className="text-dim text-xs mb-4">
          Erros técnicos essenciais podem ser registrados para estabilidade. Dados de uso não incluem nomes de tarefas, alimentos, valores financeiros ou conteúdo pessoal.
        </p>
        <div className="flex items-center justify-between gap-3 surface-2 rounded-xl px-3 py-3">
          <div className="min-w-0">
            <p className="text-sm">Compartilhar analytics de uso</p>
            <p className="text-[10px] text-faint mt-1">Ajuda a identificar telas mais usadas e pontos de abandono.</p>
          </div>
          <button
            type="button"
            className="w-11 h-6 rounded-full relative shrink-0"
            onClick={() => setProfile((p) => ({ ...p, analyticsConsent: p?.analyticsConsent !== true }))}
            style={{ background: profile?.analyticsConsent === true ? "var(--brass)" : "var(--border)" }}
            aria-label={`${profile?.analyticsConsent === true ? "Desativar" : "Ativar"} analytics de uso`}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
              style={{ left: profile?.analyticsConsent === true ? 22 : 2 }}
            />
          </button>
        </div>
      </div>

      <div className="surface rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-xs text-faint uppercase tracking-widest mb-1">Conta e sincronização</p>
            <p className="text-sm truncate">{user?.email || "Conta autenticada"}</p>
          </div>
          <ShieldCheck size={18} className="text-moss shrink-0" />
        </div>

        <div className="grid gap-2 mb-3">
          <div className={`save-status ${taskSyncStatus === "syncing" ? "syncing" : taskSyncStatus === "offline" ? "offline" : ""}`}>
            <span className="save-status-dot" />
            <span>{taskStatusLabel}</span>
          </div>
          <div className={`save-status ${syncStatus === "syncing" ? "syncing" : syncStatus === "offline" ? "offline" : ""}`}>
            <span className="save-status-dot" />
            <span>{genericStatusLabel}</span>
            {lastSaved && syncStatus === "idle" && taskSyncStatus === "idle" && <span>· {lastSaved}</span>}
          </div>
        </div>
        <p className="text-faint text-[11px] mb-3">Tarefas são gravadas individualmente no Supabase e propagadas entre dispositivos. Os demais módulos usam a sincronização geral da conta.</p>
        {taskSyncStatus === "error" && <p className="text-[11px] text-ember mb-2">Tarefas ainda não confirmadas na nuvem{taskSyncError ? ` · ${taskSyncError}` : ""}.</p>}
        {syncStatus === "error" && genericHasPending && <p className="text-[11px] text-ember mb-3">Há dados de outros módulos aguardando confirmação. Isso não bloqueia a sincronização de Tarefas.</p>}
        {syncStatus === "error" && !genericHasPending && <p className="text-[11px] text-faint mb-3">Não há alterações locais pendentes. A verificação dos outros módulos não pôde ser concluída agora.</p>}
        <button className="btn-ghost w-full rounded-xl py-2.5 text-sm flex items-center justify-center gap-2 mb-4" onClick={onSyncNow}>
          <RefreshCw size={14} /> Sincronizar agora
        </button>

        <div className="pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <Field label="E-mail da conta">
            <div className="flex gap-2">
              <input type="email" className="flex-1 min-w-0 p-2.5 ring-focus" value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} />
              <button
                className="btn-ghost rounded-xl px-3 text-xs"
                onClick={async () => {
                  setAccountMessage("");
                  try {
                    if (!currentPassword) throw new Error("current_password_required");
                    const reauth = await signInWithPassword(user?.email || "", currentPassword);
                    if (!isEmailConfirmedUser(reauth?.user)) throw new Error("email_not_confirmed");
                    await updateAuthUser(reauth, { email: accountEmail.trim().toLowerCase() });
                    setAccountMessage("Alteração solicitada. O novo e-mail só passa a valer após a confirmação enviada pelo Supabase.");
                  } catch (_) {
                    setAccountMessage("Não foi possível alterar o e-mail agora.");
                  }
                }}
              >
                Alterar
              </button>
            </div>
          </Field>

          <Field label="Senha atual (exigida para alterações sensíveis)">
            <input type="password" autoComplete="current-password" className="w-full p-2.5 ring-focus" placeholder="Confirme sua senha atual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Field>

          <Field label="Nova senha">
            <div className="flex gap-2">
              <input type="password" autoComplete="new-password" className="flex-1 min-w-0 p-2.5 ring-focus" placeholder="10+ caracteres, maiúscula, número e símbolo" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button
                disabled={Boolean(strongPasswordError(newPassword)) || !currentPassword}
                className="btn-ghost rounded-xl px-3 text-xs disabled:opacity-40"
                onClick={async () => {
                  setAccountMessage("");
                  try {
                    const passwordError = strongPasswordError(newPassword);
                    if (passwordError) throw new Error(passwordError);
                    const reauth = await signInWithPassword(user?.email || "", currentPassword);
                    if (!reauth?.access_token) throw new Error("reauth_failed");
                    await updateAuthUser(reauth, { password: newPassword });
                    setCurrentPassword("");
                    setNewPassword("");
                    setAccountMessage("Senha alterada com sucesso.");
                  } catch (_) {
                    setAccountMessage("Não foi possível alterar a senha. Confira a senha atual e os requisitos da nova senha.");
                  }
                }}
              >
                Salvar
              </button>
            </div>
          </Field>

          <button
            className="text-xs text-brass mb-3"
            onClick={async () => {
              try {
                await sendPasswordRecovery(user?.email);
                setAccountMessage("E-mail de recuperação enviado.");
              } catch (_) {
                setAccountMessage("Não foi possível enviar a recuperação.");
              }
            }}
          >
            Enviar recuperação de senha
          </button>

          {accountMessage && <p className="text-[11px] text-dim mb-3">{accountMessage}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button className="btn-ghost rounded-xl py-2.5 text-sm flex items-center justify-center gap-2" onClick={onLogout}><LogOut size={15} /> Sair da conta</button>
            <button disabled={!currentPassword} className="btn-ghost rounded-xl py-2.5 text-sm text-ember flex items-center justify-center gap-2 disabled:opacity-40" onClick={() => onDeleteAccount(currentPassword)}><Trash2 size={14} /> Excluir conta</button>
          </div>
        </div>
      </div>
      <div className="surface rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Monitor size={15} className="text-brass" />
          <p className="text-xs text-faint uppercase tracking-widest">Aplicativo instalado</p>
        </div>
        <p className="text-dim text-xs mb-3">Instale o Constancce como PWA para abrir em tela cheia, usar atalhos do sistema e ter melhor experiência offline.</p>
        {installPrompt ? (
          <button className="btn-primary w-full rounded-xl py-2.5 text-sm" onClick={onInstallApp}>Instalar Constancce neste dispositivo</button>
        ) : (
          <div className="surface-2 rounded-xl p-3 text-xs text-dim">
            {typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)")?.matches
              ? "Constancce já está sendo executado como aplicativo."
              : "Se a opção de instalação não aparecer, use “Adicionar à Tela de Início” no menu do navegador."}
          </div>
        )}
      </div>

      <div className="surface rounded-2xl p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-3">Aparência</p>
        <div className="flex gap-2">
          {[["system", Monitor, "Sistema"], ["light", Sun, "Claro"], ["dark", Moon, "Escuro"]].map(([id, Icon, label]) => (
            <button key={id} onClick={() => setTheme(id)} className="flex-1 flex flex-col items-center gap-1 py-3 rounded-xl text-xs" style={{ border: `1px solid ${theme === id ? "var(--brass)" : "var(--border)"}`, background: theme === id ? "var(--surface-2)" : "transparent" }}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}



function NotificationPermissionPrompt({ onEnable, onLater, busy }) {
  return (
    <div className="fixed inset-0 modal-backdrop flex items-end md:items-center justify-center z-[70] p-0 md:p-4" onClick={onLater}>
      <div className="surface rise w-full md:max-w-md md:rounded-2xl rounded-t-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <Bell size={20} className="text-brass" />
        </div>

        <p className="text-xs text-brass uppercase tracking-[.16em] mb-2">Lembretes do Constancce</p>
        <h3 className="font-display text-2xl mb-2">Quer receber notificações da sua rotina?</h3>
        <p className="text-dim text-sm leading-relaxed mb-5">
          O Constancce avisa 30 minutos antes das suas tarefas e também pode lembrar hábitos, treinos, metas e outros alertas importantes no celular ou computador.
        </p>

        <button
          disabled={busy}
          onClick={onEnable}
          className="btn-primary w-full rounded-xl py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Bell size={15} />
          {busy ? "Ativando…" : "Permitir notificações"}
        </button>

        <button onClick={onLater} className="btn-ghost w-full rounded-xl py-2.5 text-sm mt-2">
          Agora não
        </button>

        <p className="text-faint text-[10px] mt-3 text-center">
          Você pode alterar essa escolha depois na aba Notificações.
        </p>
      </div>
    </div>
  );
}

function AccessPaywall({ access, user, onCheckout, checkoutLoading, onRefresh, verifyLoading, onLogout, message }) {
  const info = accessSummary(access);
  return (
    <div className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 0%, rgba(201,162,74,.16), transparent 34%)" }} />
      <div className="w-full max-w-lg relative surface rounded-3xl p-6 sm:p-8">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <Trophy size={25} className="text-brass" />
        </div>
        <p className="text-brass text-xs uppercase tracking-[.18em] mb-2">Constancce Founder</p>
        <h1 className="font-display text-3xl sm:text-4xl leading-tight mb-3">Seu teste terminou. Seu progresso continua salvo.</h1>
        <p className="text-dim text-sm leading-relaxed mb-6">Libere o Constancce para sempre e continue sua evolução sem mensalidade.</p>
        <div className="surface-2 rounded-2xl p-5 mb-5">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-faint text-xs uppercase tracking-widest">Acesso vitalício</p><p className="font-display text-3xl mt-1">R$ 37,90</p></div>
            <span className="text-moss text-xs px-2.5 py-1 rounded-full" style={{ border: "1px solid var(--border)" }}>Pagamento único</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-dim">
            {["Todos os recursos", "Dados preservados", "Sem mensalidade", "Selo Founder"].map((x) => <div key={x} className="flex items-center gap-2"><Check size={14} className="text-moss" />{x}</div>)}
          </div>
        </div>
        {message && <div className="rounded-xl px-3 py-2.5 text-xs mb-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-dim)" }}>{message}</div>}
        <button onClick={onCheckout} disabled={checkoutLoading} className="btn-primary w-full rounded-xl py-3.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {checkoutLoading ? "Abrindo pagamento…" : "Desbloquear acesso vitalício"}<ArrowUpRight size={16} />
        </button>
        <button
          onClick={onRefresh}
          disabled={verifyLoading}
          className="btn-ghost w-full rounded-xl py-2.5 text-sm mt-2 disabled:opacity-60"
        >
          {verifyLoading ? "Verificando pagamento…" : "Já paguei · verificar acesso"}
        </button>
        <div className="mt-5 pt-4 flex items-center justify-between gap-3 text-[11px] text-faint" style={{ borderTop: "1px solid var(--border-soft)" }}>
          <span className="truncate">{user?.email}</span>
          <button onClick={onLogout} className="hover:text-dim">Sair</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   QUICK ADD
----------------------------------------------------------------*/
function CommandCenter({ open, onClose, onNavigate, onQuickAction, habits, tasks, goals, workouts, transactions }) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const results = [
    ...habits.map((item) => ({ id: item.id, type: "Hábito", label: item.name, view: "habits", icon: ListChecks })),
    ...tasks.map((item) => ({ id: item.id, type: "Tarefa", label: item.title, view: "tasks", icon: CheckCircle2 })),
    ...goals.map((item) => ({ id: item.id, type: "Meta", label: item.name, view: "goals", icon: Target })),
    ...workouts.map((item) => ({ id: item.id, type: "Treino", label: item.name, view: "workouts", icon: Dumbbell })),
    ...transactions.map((item) => ({ id: item.id, type: "Finanças", label: item.description || item.category, view: "finance", icon: Wallet })),
  ].filter((item) => !q || `${item.type} ${item.label}`.toLowerCase().includes(q)).slice(0, 12);

  return (
    <Modal title="Central de comandos" onClose={onClose} width={620}>
      <div className="relative mb-4">
        <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          className="w-full pl-10 pr-3 py-3 ring-focus"
          placeholder="Buscar tarefa, meta, hábito, treino ou lançamento..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!q && (
        <div className="mb-4">
          <p className="text-[10px] text-faint uppercase tracking-widest mb-2">Ações rápidas</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {QUICK_OPTS.slice(0, 8).map((option) => (
              <button key={option.id} className="surface-2 rounded-xl p-3 text-xs flex flex-col items-center gap-1.5" onClick={() => { onQuickAction(option); onClose(); }}>
                <option.icon size={16} className="text-brass" />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-faint uppercase tracking-widest mb-2">{q ? "Resultados" : "Acesso rápido"}</p>
      <div className="flex flex-col gap-2 max-h-[45vh] overflow-y-auto scrollbar-none">
        {results.map((result) => {
          const Icon = result.icon;
          return (
            <button
              key={`${result.type}-${result.id}`}
              className="surface-2 rounded-xl p-3 flex items-center gap-3 text-left"
              onClick={() => { onNavigate(result.view); onClose(); }}
            >
              <Icon size={16} className="text-brass shrink-0" />
              <div className="min-w-0">
                <p className="text-sm truncate">{result.label}</p>
                <p className="text-[10px] text-faint">{result.type}</p>
              </div>
            </button>
          );
        })}
        {q && results.length === 0 && <p className="text-dim text-sm py-5 text-center">Nada encontrado.</p>}
      </div>

      <p className="text-[10px] text-faint mt-4 hidden md:block">Atalho: ⌘ K no Mac ou Ctrl K no Windows.</p>
    </Modal>
  );
}

const QUICK_OPTS = [
  { id: "habit", label: "Hábito", icon: ListChecks, view: "habits" },
  { id: "task", label: "Tarefa", icon: CheckCircle2, view: "tasks" },
  { id: "goal", label: "Meta", icon: Target, view: "goals" },
  { id: "workout", label: "Treino", icon: Dumbbell, view: "workouts" },
  { id: "food", label: "Alimento", icon: Apple, view: "food" },
  { id: "expense", label: "Gasto", icon: ArrowDownRight, view: "finance" },
  { id: "income", label: "Entrada", icon: ArrowUpRight, view: "finance" },
];
function ProUpgradeModal({ request, accessInfo, onClose, onCheckout, checkoutLoading, onVerify, verifyLoading, message }) {
  const feature = request?.feature || "intelligence";
  const copy = PRO_FEATURE_COPY[feature] || PRO_FEATURE_COPY.intelligence;

  return (
    <Modal title="Constancce PRO" onClose={onClose} width={500}>
      <div className="flex flex-col gap-4">
        <div className="surface-2 rounded-2xl p-4" style={{ border: "1px solid var(--brass-dim)" }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--surface)", border: "1px solid var(--brass-dim)" }}>
              <Sparkles size={19} className="text-brass" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-lg">{copy[0]}</p>
                <ProBadge compact />
              </div>
              <p className="text-xs text-dim mt-1.5 leading-relaxed">{copy[1]}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-4" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--brass) 12%, var(--surface)), var(--surface-2))", border: "1px solid var(--brass-dim)" }}>
          <p className="text-[10px] text-faint uppercase tracking-widest">Acesso completo</p>
          <div className="flex items-end justify-between gap-3 mt-1">
            <div>
              <p className="font-display text-2xl">Constancce PRO</p>
              <p className="text-xs text-dim mt-1">Pagamento único. Acesso vitalício.</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-display text-2xl">R$ 37,90</p>
              <p className="text-[10px] text-faint">uma única vez</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
            {["Recursos sem limites", "Histórico completo", "Inteligência e análises", "Personalização PRO"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs text-dim">
                <Check size={13} className="text-moss shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {message && (
          <div className="surface-2 rounded-xl p-3 text-xs text-dim flex items-start gap-2" role="status">
            <ShieldCheck size={14} className="text-brass shrink-0 mt-0.5" />
            <span>{message}</span>
          </div>
        )}

        <button
          type="button"
          className="btn-primary rounded-xl px-4 py-3 text-sm w-full inline-flex items-center justify-center gap-2"
          onClick={onCheckout}
          disabled={checkoutLoading}
        >
          <CreditCard size={15} />
          {checkoutLoading ? "Abrindo pagamento…" : "Garantir PRO Vitalício — R$ 37,90"}
        </button>

        <button
          type="button"
          className="btn-ghost rounded-xl px-4 py-2.5 text-xs w-full inline-flex items-center justify-center gap-2"
          onClick={onVerify}
          disabled={verifyLoading}
        >
          <RefreshCw size={13} className={verifyLoading ? "animate-spin" : ""} />
          {verifyLoading ? "Verificando…" : "Já paguei · verificar acesso"}
        </button>

        {accessInfo?.expired && (
          <p className="text-[10px] text-faint text-center">Seu período PRO temporário terminou. Seus dados continuam preservados no plano Free.</p>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------
   APP SHELL
----------------------------------------------------------------*/
const NAV = [
  { id: "dashboard", label: "Hoje", icon: LayoutGrid, group: "Rotina" },
  { id: "workouts", label: "Treinos", icon: Dumbbell, group: "Saúde" },
  { id: "habits", label: "Hábitos", icon: ListChecks, group: "Rotina" },
  { id: "finance", label: "Finanças", icon: Wallet, group: "Planejamento" },
  { id: "tasks", label: "Tarefas", icon: CheckCircle2, group: "Rotina" },
  { id: "calendar", label: "Calendário", icon: CalendarIcon, group: "Planejamento" },
  { id: "goals", label: "Metas", icon: Target, group: "Planejamento" },
  { id: "food", label: "Dieta", icon: Apple, group: "Saúde" },
  { id: "friends", label: "Amigos", icon: Users, group: "Social" },
  { id: "professional", label: "Personal & Nutri", icon: Stethoscope, group: "Social" },
  { id: "progress", label: "Progresso", icon: TrendingUp, group: "Evolução" },
  { id: "achievements", label: "Conquistas", icon: Trophy, group: "Evolução" },
  { id: "notifications", label: "Notificações", icon: Bell, group: "Conta" },
  { id: "reports", label: "Relatórios", icon: FileBarChart, group: "Evolução" },
  { id: "profile", label: "Perfil", icon: User, group: "Conta" },
];

// A sidebar desktop usa grupos semânticos fixos para não repetir títulos
// quando a ordem personalizada do menu intercala módulos de áreas diferentes.
const SIDEBAR_GROUPS = [
  { label: "Rotina", ids: ["dashboard", "habits", "tasks"] },
  { label: "Saúde", ids: ["workouts", "food"] },
  { label: "Planejamento", ids: ["finance", "calendar", "goals"] },
  { label: "Evolução", ids: ["progress", "achievements", "reports"] },
  { label: "Social", ids: ["friends", "professional"] },
  { label: "Conta", ids: ["profile", "notifications"] },
];

const MOBILE_MAIN = ["dashboard", "workouts", "habits", "finance", "tasks"];
const MOBILE_MORE = NAV.filter((n) => !MOBILE_MAIN.includes(n.id));

const formatRestCountdown = (seconds = 0) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const min = Math.floor(safe / 60);
  const sec = String(safe % 60).padStart(2, "0");
  return `${min}:${sec}`;
};


function ConstancceApp() {
  const [session, setSession] = useState(() => loadStoredSession());
  const [authReady, setAuthReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [access, setAccess] = useState(null);
  const [accessReady, setAccessReady] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [verifyPaymentLoading, setVerifyPaymentLoading] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [proRequest, setProRequest] = useState(null);
  const planInfo = accessSummary(access);
  const isPro = Boolean(planInfo.isPro);

  const {
    profile, setProfileState,
    habits, setHabits,
    completions, setCompletions,
    tasks, setTasks,
    goals, setGoals,
    unlocked, setUnlocked,
    workoutTemplates, setWorkoutTemplates,
    workoutSessions, setWorkoutSessions,
    foods, setFoods,
    mealLog, setMealLog,
    transactions, setTransactions,
    goalProgressLog, setGoalProgressLog,
    habitChecklistLog, setHabitChecklistLog,
  } = useConstancceData();
  const [view, setView] = useState("dashboard");
  const [confirm, confirmDialog] = useConfirm();
  // A base curada fica embutida no bundle para a Dieta nunca abrir vazia.
  // A TACO completa é carregada em segundo plano e mesclada depois.
  const [dietFoodBase, setDietFoodBase] = useState(() => dietDedupFoods(DIET_FOOD_BASE));
  const [dietBaseLoading, setDietBaseLoading] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [toast, setToast] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const [showCommandCenter, setShowCommandCenter] = useState(false);
  const [quickTrigger, setQuickTrigger] = useState({});
  const [lastSaved, setLastSaved] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle"); // sincronização geral
  const [taskSyncStatus, setTaskSyncStatus] = useState("idle"); // idle | syncing | offline | error
  const [taskSyncError, setTaskSyncError] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [pushSupported, setPushSupported] = useState(() =>
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
  const [pushEnabled, setPushEnabled] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [workoutResumeSessionId, setWorkoutResumeSessionId] = useState(null);
  const workoutRest = useWorkoutRestTimer(session?.user?.id);

  const pendingSyncRef = useRef(null);
  const materializedRecurringRef = useRef(new Set());
  const taskOutboxRef = useRef([]);
  const taskSyncInFlightRef = useRef(false);
  const taskRetryTimerRef = useRef(null);
  const routineOutboxRef = useRef([]);
  const routineSyncInFlightRef = useRef(false);
  const routineRetryTimerRef = useRef(null);
  const routineRevisionRef = useRef({});
  const routineVisibleRef = useRef(null);
  const mobileSwipeRef = useRef(null);
  const appMainRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const retrySyncTimer = useRef(null);
  const prevBest = useRef(0);
  const toastTimer = useRef(null);
  const remoteSaveTimer = useRef(null);
  const dietBaseLoadStartedRef = useRef(false);
  const safetySyncInterval = useRef(null);
  const lastRemoteSyncStampRef = useRef(null);
  const domainVersionRef = useRef({});
  const syncRevisionRef = useRef(0);
  const fieldRevisionRef = useRef({});
  const taskRevisionRef = useRef({});
  const lastSyncedDataRef = useRef({});
  const remotePullInFlightRef = useRef(false);
  const lastRemotePullAtRef = useRef(0);
  const observedDataSignaturesRef = useRef(null);
  const telemetryQueueRef = useRef([]);
  const telemetryTimerRef = useRef(null);
  const genericSyncFailureCountRef = useRef(0);

  const fireToast = useCallback((message, icon) => {
    setToast({ message, icon });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);


  const flushTelemetry = useCallback(async () => {
    if (!session?.access_token || !SUPABASE_CONFIGURED) return;
    const queued = telemetryQueueRef.current.splice(0, 50);
    if (!queued.length) return;
    const ok = await sendTelemetry({
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      session,
      events: queued,
    });
    if (!ok) telemetryQueueRef.current = [...queued, ...telemetryQueueRef.current].slice(0, 100);
  }, [session]);

  const track = useCallback((name, properties = {}) => {
    if (profile?.analyticsConsent !== true) return;
    telemetryQueueRef.current.push(analyticsEvent(name, properties));
    clearTimeout(telemetryTimerRef.current);
    telemetryTimerRef.current = setTimeout(() => flushTelemetry(), 4500);
  }, [flushTelemetry, profile?.analyticsConsent]);

  useEffect(() => {
    const handleError = (event) => {
      const captured = captureClientError(event?.error || new Error(event?.message || "window_error"), {
        module: "window",
        action: "error",
      });
      telemetryQueueRef.current.push(captured);
    };

    const handleRejection = (event) => {
      const reason = event?.reason instanceof Error
        ? event.reason
        : new Error(String(event?.reason || "unhandled_rejection"));
      const captured = captureClientError(reason, {
        module: "window",
        action: "unhandledrejection",
      });
      telemetryQueueRef.current.push(captured);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token || !dataReady) return;
    const queuedErrors = consumeQueuedErrors();
    telemetryQueueRef.current.push(...queuedErrors);
    if (profile?.analyticsConsent === true) {
      telemetryQueueRef.current.push(
        analyticsEvent("app_opened", {
          plan: isPro ? "pro" : "free",
          schema_version: DATA_SCHEMA_VERSION,
        })
      );
    }
    flushTelemetry();
  }, [session?.user?.id, dataReady]);

  useEffect(() => {
    if (!dataReady) return;
    track("view_opened", { view, plan: isPro ? "pro" : "free" });
  }, [view, dataReady, isPro, track]);

  useEffect(() => {
    const flushBeforeLeaveTelemetry = () => flushTelemetry();
    window.addEventListener("pagehide", flushBeforeLeaveTelemetry);
    return () => {
      window.removeEventListener("pagehide", flushBeforeLeaveTelemetry);
      clearTimeout(telemetryTimerRef.current);
    };
  }, [flushTelemetry]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        setShowCommandCenter((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      appMainRef.current?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);


  useEffect(() => {
    if (view !== "food" || dietBaseLoadStartedRef.current) return;

    // Evita o bug anterior em que setDietBaseLoading(true) fazia o próprio
    // effect ser limpo antes da Promise terminar, deixando a lista vazia.
    dietBaseLoadStartedRef.current = true;
    setDietBaseLoading(true);

    import("./src/data/tacoFoodBase.js")
      .then(async (tacoModule) => {
        let taco = [];

        try {
          taco = await tacoModule.loadTacoFoodBase();
        } catch (error) {
          captureClientError(error, {
            module: "diet",
            action: "load_taco_food_base",
          });
        }

        // Mesmo sem internet/TACO, os alimentos curados já estão disponíveis.
        setDietFoodBase(dietDedupFoods([...DIET_FOOD_BASE, ...taco]));
      })
      .catch((error) =>
        captureClientError(error, {
          module: "diet",
          action: "load_food_base_chunk",
        })
      )
      .finally(() => {
        setDietBaseLoading(false);
        // Se a TACO falhar, permite uma nova tentativa ao sair e voltar à Dieta.
        dietBaseLoadStartedRef.current = false;
      });
  }, [view]);

  useEffect(() => {
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);


  const refreshPushState = useCallback(async () => {
    if (!pushSupported) {
      setPushEnabled(false);
      return;
    }

    try {
      await ensureConstancceServiceWorker();
      const state = await fetchPushSubscriptionState();
      setPushEnabled(Boolean(state.enabled));
      setNotificationPermission(Notification.permission);
    } catch (_) {
      setPushEnabled(false);
    }
  }, [pushSupported]);

  const handleEnableNotifications = useCallback(async () => {
    if (!session?.user?.id || notificationBusy) return;

    setNotificationBusy(true);

    try {
      if (!pushSupported) {
        throw new Error("push_not_supported");
      }

      let permission = Notification.permission;

      if (permission === "default") {
        permission = await Notification.requestPermission();
      }

      setNotificationPermission(permission);

      if (permission === "denied") {
        setShowNotificationPrompt(false);
        localStorage.setItem(`constancce_notification_prompt_${session.user.id}`, "denied");
        fireToast("As notificações foram bloqueadas pelo navegador.", <Bell size={16} className="text-ember" />);
        return;
      }

      if (permission !== "granted") {
        setShowNotificationPrompt(false);
        localStorage.setItem(`constancce_notification_prompt_${session.user.id}`, "later");
        return;
      }

      // A autorização nativa já foi concedida. O modal do Constancce deve sair
      // imediatamente e nunca ficar prendendo o usuário enquanto o backend é registrado.
      setShowNotificationPrompt(false);
      localStorage.setItem(`constancce_notification_prompt_${session.user.id}`, "permission-granted");

      await enableConstanccePush(session);

      setPushEnabled(true);
      localStorage.setItem(`constancce_notification_prompt_${session.user.id}`, "enabled");
      fireToast("Notificações ativadas com sucesso", <Bell size={16} className="text-brass" />);
    } catch (e) {
      const code = String(e?.message || "");
      const currentPermission =
        typeof Notification !== "undefined" ? Notification.permission : "unsupported";

      setNotificationPermission(currentPermission);
      setShowNotificationPrompt(false);

      // Uma inscrição antiga pode ter sido criada antes da falha ao salvar no backend.
      // Verificamos o estado real para manter a interface coerente.
      try {
        const state = await fetchPushSubscriptionState();
        setPushEnabled(Boolean(state.enabled));
      } catch (_) {
        setPushEnabled(false);
      }

      if (code === "notification_denied") {
        localStorage.setItem(`constancce_notification_prompt_${session.user.id}`, "denied");
        fireToast("As notificações foram bloqueadas pelo navegador.", <Bell size={16} className="text-ember" />);
      } else if (
        code === "vapid_not_configured" ||
        code.includes("push-subscription_http_404") ||
        code.includes("push-subscription_http_500") ||
        code.includes("push-subscription_network_error")
      ) {
        localStorage.setItem(`constancce_notification_prompt_${session.user.id}`, "permission-granted");
        fireToast("Permissão concedida. Falta concluir a configuração do servidor de notificações.", <Bell size={16} className="text-ember" />);
      } else if (code === "service_worker_timeout" || code === "service_worker_redundant") {
        fireToast("Atualize a página e tente ativar as notificações novamente.", <Bell size={16} className="text-ember" />);
      } else if (code === "push_subscribe_failed" || code === "push_invalid_state") {
        fireToast("O navegador permitiu as notificações, mas não conseguiu registrar este dispositivo.", <Bell size={16} className="text-ember" />);
      } else if (code === "push_not_supported") {
        fireToast("Este navegador não oferece suporte completo a notificações push.", <Bell size={16} className="text-ember" />);
      } else {
        fireToast("A permissão foi salva, mas a ativação dos lembretes ainda não foi concluída.", <Bell size={16} className="text-ember" />);
      }
    } finally {
      setNotificationBusy(false);
    }
  }, [session, notificationBusy, pushSupported, fireToast]);

  const handleDisableNotifications = useCallback(async () => {
    if (!session?.user?.id || notificationBusy) return;

    setNotificationBusy(true);
    try {
      await disableConstanccePush(session);
      setPushEnabled(false);
      localStorage.setItem(`constancce_notification_prompt_${session.user.id}`, "disabled");
      fireToast("Notificações desativadas neste dispositivo", <Bell size={16} className="text-dim" />);
    } finally {
      setNotificationBusy(false);
    }
  }, [session, notificationBusy, fireToast]);

  const applyRemoteData = useCallback((remote) => {
    const baseMigrated = migrateUserData(remote || {});
    // 1.1.28 — Hábitos e Treinos têm uma fonte atômica própria. Uma resposta
    // antiga da sincronização genérica nunca pode regredir esses módulos.
    const migrated = routineVisibleRef.current
      ? migrateUserData({ ...baseMigrated, ...routineVisibleRef.current })
      : baseMigrated;
    observedDataSignaturesRef.current = syncFieldSignatures(migrated);
    if (migrated?.__syncDomainUpdatedAt && typeof migrated.__syncDomainUpdatedAt === "object") {
      domainVersionRef.current = { ...migrated.__syncDomainUpdatedAt };
    }
    if (migrated?.__syncFieldRevisions && typeof migrated.__syncFieldRevisions === "object") {
      fieldRevisionRef.current = { ...migrated.__syncFieldRevisions };
    }
    syncRevisionRef.current = Number(migrated?.__syncRevision || syncRevisionRef.current || 0);
    if (migrated?.__taskRevisions && typeof migrated.__taskRevisions === "object") {
      taskRevisionRef.current = { ...migrated.__taskRevisions };
    }
    if (migrated?.__syncUpdatedAt) lastRemoteSyncStampRef.current = migrated.__syncUpdatedAt;
    setProfileState(migrated.profile || null);
    setHabits(migrated.habits || []);
    setCompletions(migrated.completions || []);
    setTasks(migrated.tasks || []);
    setGoals(migrated.goals || []);
    setUnlocked(migrated.unlocked || []);
    setWorkoutTemplates(migrated.workoutTemplates || []);
    setWorkoutSessions(migrated.workoutSessions || []);
    setFoods(migrated.foods || []);
    setMealLog(migrated.mealLog || []);
    setTransactions(migrated.transactions || []);
    setGoalProgressLog(migrated.goalProgressLog || []);
    setHabitChecklistLog(migrated.habitChecklistLog || []);
  }, []);

  // valida/renova a sessão ao abrir o app
  useEffect(() => {
    (async () => {
      const stored = loadStoredSession();
      if (!stored?.refresh_token) {
        setSession(null);
        setAuthReady(true);
        return;
      }
      try {
        const fresh = await ensureFreshAuthSession(stored, { minValidityMs: 60000 });
        if (!isEmailConfirmedUser(fresh?.user)) {
          await signOutRemote(fresh?.access_token);
          saveStoredSession(null);
          setSession(null);
        } else {
          setSession(fresh);
        }
      } catch (e) {
        saveStoredSession(null);
        setSession(null);
      } finally {
        setAuthReady(true);
      }
    })();
  }, []);

  const getFreshSession = useCallback(async (force = false) => {
    const current = loadStoredSession() || session;
    if (!current?.refresh_token) throw new Error("missing_refresh_token");
    const fresh = await ensureFreshAuthSession(current, { force, minValidityMs: 120000 });
    if (fresh?.access_token !== session?.access_token || fresh?.expires_at !== session?.expires_at) {
      setSession(fresh);
    }
    return fresh;
  }, [session]);

  // Mantém o JWT vivo enquanto o app permanece aberto por longos períodos.
  useEffect(() => {
    if (!session?.refresh_token) return;
    let cancelled = false;
    const keepSessionFresh = async () => {
      try {
        const fresh = await ensureFreshAuthSession(loadStoredSession() || session, { minValidityMs: 180000 });
        if (!cancelled && fresh?.access_token !== session?.access_token) setSession(fresh);
      } catch (_) {
        // Uma falha transitória não derruba a sessão; ações protegidas tentam renovar novamente.
      }
    };
    const timer = window.setInterval(keepSessionFresh, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session?.refresh_token, session?.access_token, session?.expires_at]);

  const refreshAccess = useCallback(async () => {
    if (!session?.user?.id) { setAccess(null); setAccessReady(true); return null; }
    try {
      const row = await fetchAccessForUser(session);
      setAccess(row);
      setAccessError("");
      return row;
    } catch (e) {
      setAccessError("Não foi possível verificar o plano agora.");
      return null;
    } finally { setAccessReady(true); }
  }, [session]);

  const handleVerifyPayment = useCallback(async () => {
    if (!session?.user?.id || verifyPaymentLoading) return;

    setVerifyPaymentLoading(true);
    setAccessError("");
    setPaymentMessage("Verificando seu pagamento…");

    try {
      let latest = null;

      // O webhook pode levar alguns segundos. Fazemos algumas consultas
      // curtas antes de informar que o pagamento ainda não apareceu.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        latest = await fetchAccessForUser(session);
        setAccess(latest);

        if (latest?.plan === "lifetime") {
          setPaymentMessage("Pagamento confirmado. Seu acesso vitalício foi liberado.");
          fireToast("Acesso vitalício liberado", <ShieldCheck size={16} className="text-moss" />);
          return;
        }

        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 1400));
        }
      }

      if (latest?.payment_status === "pending" || latest?.payment_status === "in_process") {
        setPaymentMessage("Seu pagamento ainda está sendo processado. Aguarde alguns instantes e tente novamente.");
      } else {
        setPaymentMessage("Ainda não encontramos um pagamento aprovado para esta conta.");
      }
    } catch (e) {
      setPaymentMessage("Não foi possível verificar o pagamento agora. Verifique sua conexão e tente novamente.");
    } finally {
      setVerifyPaymentLoading(false);
    }
  }, [session, verifyPaymentLoading, fireToast]);

  useEffect(() => {
    setAccessReady(false);
    refreshAccess();
  }, [refreshAccess]);

  // Ao voltar do Mercado Pago, aguarda alguns segundos pela confirmação segura do webhook.
  useEffect(() => {
    if (!session?.user?.id) return;
    const params = new URLSearchParams(window.location.search);
    const paymentReturn = params.get("payment");
    if (!paymentReturn) return;
    if (paymentReturn === "approved") setPaymentMessage("Pagamento recebido. Confirmando seu acesso…");
    if (paymentReturn === "pending") setPaymentMessage("Pagamento pendente. Assim que for aprovado, o acesso será liberado automaticamente.");
    if (paymentReturn === "failure") setPaymentMessage("O pagamento não foi concluído. Você pode tentar novamente.");
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const row = await refreshAccess();
      if (row?.plan === "lifetime") {
        setPaymentMessage("Acesso vitalício liberado. Bem-vindo ao Constancce Founder.");
        clearInterval(timer);
        window.history.replaceState({}, "", window.location.pathname);
      } else if (tries >= 12) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [session?.user?.id, refreshAccess]);

  const handleLifetimeCheckout = useCallback(async () => {
    if (!session?.user) return;
    setCheckoutLoading(true);
    setPaymentMessage("");
    try {
      track("checkout_started", { plan: "lifetime" });

      let activeSession = await getFreshSession(false);
      let checkout;
      try {
        checkout = await createLifetimeCheckout(activeSession);
      } catch (error) {
        // JWT expirado/rejeitado: renova uma vez e repete o checkout automaticamente.
        if (Number(error?.status) !== 401) throw error;
        activeSession = await getFreshSession(true);
        checkout = await createLifetimeCheckout(activeSession);
      }

      const target = checkout?.init_point || checkout?.sandbox_init_point;
      if (!target) throw new Error("checkout_url_missing");
      window.location.assign(target);
    } catch (e) {
      const code = String(e?.message || "").toLowerCase();
      if (code.includes("refresh") || code.includes("missing_refresh_token") || Number(e?.status) === 401) {
        setPaymentMessage("Sua sessão precisa ser renovada. Saia e entre novamente na conta se o botão continuar sem abrir o pagamento.");
      } else if (code.includes("checkout_url_missing")) {
        setPaymentMessage("O Mercado Pago não devolveu o link de pagamento. Tente novamente em alguns instantes.");
      } else if (code.includes("email_not_confirmed")) {
        setPaymentMessage("Confirme seu e-mail antes de iniciar o pagamento.");
      } else if (code.includes("too_many_requests")) {
        setPaymentMessage("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.");
      } else {
        setPaymentMessage("Não foi possível abrir o pagamento agora. Tente novamente em alguns instantes.");
      }
      captureClientError(e, { module: "payments", action: "lifetime_checkout" });
    } finally { setCheckoutLoading(false); }
  }, [session, getFreshSession, track]);

  const requestPro = useCallback((feature = "intelligence") => {
    if (isPro) return true;
    track("paywall_opened", { feature });
    setProRequest({ feature, requestedAt: Date.now() });
    return false;
  }, [isPro, track]);

  // A nuvem é a fonte principal ao entrar em outro dispositivo, mas uma edição
  // local ainda pendente nunca é descartada. Dados atualizados em outro dispositivo
  // são usados como base antes de reaplicar as mudanças deste aparelho.
  // Ao trocar de conta, recupera primeiro qualquer alteração local que ainda não
  // chegou ao Supabase. A fila pendente é persistida no aparelho, então fechar,
  // atualizar ou instalar uma nova versão do PWA não apaga o histórico recente.
  useEffect(() => {
    if (!authReady) return;
    if (!session?.user?.id) {
      setDataReady(false);
      pendingSyncRef.current = null;
      taskOutboxRef.current = [];
      routineOutboxRef.current = [];
      routineVisibleRef.current = null;
      routineRevisionRef.current = {};
      setTaskSyncStatus("idle");
      setTaskSyncError("");
      applyRemoteData({});
      return;
    }
    let cancelled = false;
    (async () => {
      const userId = session.user.id;
      setDataReady(false);
      setSyncStatus("syncing");

      const cached = loadUserLocalData(userId);
      const durablePending = loadPendingSync(userId);
      let durableTaskOutbox = loadTaskOutbox(userId);
      let durableRoutineOutbox = loadRoutineOutbox(userId);
      pendingSyncRef.current = durablePending;
      taskOutboxRef.current = durableTaskOutbox;
      routineOutboxRef.current = durableRoutineOutbox;

      try {
        // Sempre usa um JWT renovado no bootstrap. Um PWA que ficou dias fechado
        // pode reabrir com uma sessão armazenada prestes a expirar; nesse caso a
        // leitura remota não pode cair silenciosamente para o cache local.
        let activeSession = session;
        try { activeSession = await getFreshSession(false); } catch (_) {}

        // 1.1.28 — Hábitos e Treinos são carregados de uma tabela atômica própria
        // antes do snapshot genérico. Isso impede o desktop de receber uma versão
        // antiga enquanto o celular já concluiu hábitos ou treino.
        const [genericResult, routineResult] = await Promise.allSettled([
          fetchRemoteForUser(activeSession),
          fetchAtomicRoutineForUser(activeSession),
        ]);
        if (cancelled) return;
        const genericRemote = genericResult.status === "fulfilled" ? genericResult.value : null;
        if (genericResult.status === "rejected") {
          captureClientError(genericResult.reason, { module: "sync", action: "bootstrap_generic_nonfatal_1_1_28" });
        }
        if (routineResult.status !== "fulfilled") throw routineResult.reason || new Error("routine_bootstrap_failed");
        const routineRemote = routineResult.value;

        routineRevisionRef.current = { ...(routineRemote?.revisions || {}) };
        let routineBase = {
          habits: routineRemote?.habits || [],
          completions: routineRemote?.completions || [],
          habitChecklistLog: routineRemote?.habitChecklistLog || [],
          workoutTemplates: routineRemote?.workoutTemplates || [],
          workoutSessions: routineRemote?.workoutSessions || [],
        };

        // Migração defensiva por dispositivo. Conclusões/progresso que estavam
        // apenas no cache local são unidos ao estado remoto e entram na outbox.
        if (!routineMigrationDone(userId) && cached) {
          const mergedRoutine = mergeRoutineBootstrap(routineBase, cached);
          const migrationOps = buildRoutineOps(routineBase, mergedRoutine, routineRemote?.revisions || {}, ROUTINE_FIELDS)
            .map((op) => ({ ...op, mutationId: newMutationId(), queuedAt: new Date().toISOString() }));
          if (migrationOps.length) {
            durableRoutineOutbox = compactRoutineOutbox([...durableRoutineOutbox, ...migrationOps]);
            routineOutboxRef.current = durableRoutineOutbox;
            saveRoutineOutbox(userId, durableRoutineOutbox);
          }
          routineBase = mergedRoutine;
          markRoutineMigrationDone(userId);
        }

        const visibleRoutine = durableRoutineOutbox.length
          ? applyRoutineOutbox(routineBase, durableRoutineOutbox)
          : routineBase;
        routineVisibleRef.current = visibleRoutine;

        const remote = genericRemote
          ? migrateUserData({ ...genericRemote, ...visibleRoutine })
          : (Object.values(visibleRoutine).some((value) => Array.isArray(value) && value.length)
              ? migrateUserData({ ...visibleRoutine })
              : null);

        if (remote) {
          // A resposta do servidor é a base confirmada deste dispositivo.
          syncRevisionRef.current = Number(remote?.__syncRevision || 0);
          fieldRevisionRef.current = { ...(remote?.__syncFieldRevisions || {}) };
          lastRemoteSyncStampRef.current = remote?.__syncUpdatedAt || null;
          lastSyncedDataRef.current = remote;

          const rebasedPending = durablePending?.data ? rebasePendingV3(remote, durablePending) : null;
          let visibleData = rebasedPending?.data
            ? migrateUserData(mergeRemoteWithPendingV3(remote, rebasedPending))
            : remote;
          durableTaskOutbox = migrateLegacyTaskPendingToOutbox(userId, remote.tasks || [], remote?.__taskRevisions || {});
          taskOutboxRef.current = durableTaskOutbox;
          if (durableTaskOutbox.length) {
            visibleData = migrateUserData({ ...visibleData, tasks: applyTaskOutbox(remote.tasks || [], durableTaskOutbox) });
          }
          if (rebasedPending?.data) {
            pendingSyncRef.current = rebasedPending;
            savePendingSync(userId, rebasedPending);
          }
          applyRemoteData(visibleData);
          saveUserLocalData(userId, visibleData);
          lastRemotePullAtRef.current = Date.now();
        } else {
          // Conta sem snapshot remoto: aproveita dados legados/cache e também
          // qualquer fila pendente preservada de uma sessão anterior.
          const legacy = loadLegacyLocalData();
          const base = legacy || cached || {};
          const seed = durablePending?.data
            ? migrateUserData(mergeRemoteWithPendingV3(base, durablePending))
            : (legacy || cached);

          if (seed) {
            const stampedSeed = migrateUserData({
              ...seed,
              schemaVersion: DATA_SCHEMA_VERSION,
              __syncDomainUpdatedAt: seed?.__syncDomainUpdatedAt || {},
              __syncUpdatedAt: seed?.__syncUpdatedAt || null,
              __localUpdatedAt: seed?.__localUpdatedAt || new Date().toISOString(),
            });
            applyRemoteData(stampedSeed);
            saveUserLocalData(userId, stampedSeed);

            // Se o servidor ainda não tem estado canônico, envia o snapshot completo
            // UMA vez, inclusive quando há fila pendente. Isso evita criar uma conta
            // remota parcial contendo apenas o último domínio editado offline.
            const saved = await saveRemoteForUser(session, stampedSeed, {
              changedKeys: Object.values(DOMAIN_FIELDS).flat().filter((key) => key !== "tasks" && !ROUTINE_FIELDS.includes(key)),
              baseFieldRevisions: {},
              mutationId: durablePending?.mutationId || newMutationId(),
              clientId: getSyncClientId(userId),
            });
            if (saved?.data) {
              const synced = migrateUserData({
                ...saved.data,
                __syncRevision: Number(saved.revision || 0),
                __syncFieldRevisions: saved.fieldRevisions || {},
                __syncUpdatedAt: saved.updated_at || null,
              });
              syncRevisionRef.current = Number(saved.revision || 0);
              fieldRevisionRef.current = { ...(saved.fieldRevisions || {}) };
              lastSyncedDataRef.current = synced;
              pendingSyncRef.current = null;
              clearPendingSync(userId);
              const syncedVisible = routineVisibleRef.current ? migrateUserData({ ...synced, ...routineVisibleRef.current }) : synced;
              applyRemoteData(syncedVisible);
              saveUserLocalData(userId, syncedVisible);
            }
            if (legacy) clearLegacyLocalData();
          } else {
            applyRemoteData({});
          }
        }
        setSyncStatus(durablePending?.data ? "syncing" : "idle");
        setTaskSyncStatus(taskOutboxRef.current.length ? "syncing" : "idle");
        setLastSaved(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      } catch (e) {
        // Offline: mantém o snapshot mais novo deste aparelho e a fila pendente.
        // Nada é descartado só porque a nuvem ficou indisponível.
        if (!cancelled) {
          let offlineData = durablePending?.data
            ? migrateUserData(mergeRemoteWithPendingV3(cached || {}, durablePending))
            : cached;
          durableTaskOutbox = loadTaskOutbox(userId);
          taskOutboxRef.current = durableTaskOutbox;
          durableRoutineOutbox = loadRoutineOutbox(userId);
          routineOutboxRef.current = durableRoutineOutbox;
          if (offlineData) {
            const offlineRoutine = {
              habits: offlineData.habits || [],
              completions: offlineData.completions || [],
              habitChecklistLog: offlineData.habitChecklistLog || [],
              workoutTemplates: offlineData.workoutTemplates || [],
              workoutSessions: offlineData.workoutSessions || [],
            };
            routineVisibleRef.current = offlineRoutine;
          }
          if (offlineData && durableTaskOutbox.length) {
            offlineData = migrateUserData({ ...offlineData, tasks: applyTaskOutbox(offlineData.tasks || [], durableTaskOutbox) });
          }
          if (offlineData) {
            if (durablePending?.data) {
              pendingSyncRef.current = {
                ...durablePending,
                data: pickDataForKeys(offlineData, durablePending.changedKeys || []),
                changedKeys: [...new Set(durablePending.changedKeys || [])],
              };
              savePendingSync(userId, pendingSyncRef.current);
            }
            applyRemoteData(offlineData);
            saveUserLocalData(userId, offlineData);
          }
          setSyncStatus(
            typeof navigator !== "undefined" && navigator.onLine === false
              ? "offline"
              : (pendingSyncRef.current ? "error" : "idle")
          );
        }
      } finally {
        if (!cancelled) setDataReady(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session?.user?.id]);

  const buildDataPayload = useCallback((patch = {}) => migrateUserData({
    profile: patch.profile !== undefined ? patch.profile : profile,
    habits: patch.habits !== undefined ? patch.habits : habits,
    completions: patch.completions !== undefined ? patch.completions : completions,
    tasks: patch.tasks !== undefined ? patch.tasks : tasks,
    goals: patch.goals !== undefined ? patch.goals : goals,
    unlocked: patch.unlocked !== undefined ? patch.unlocked : unlocked,
    workoutTemplates: patch.workoutTemplates !== undefined ? patch.workoutTemplates : workoutTemplates,
    workoutSessions: patch.workoutSessions !== undefined ? patch.workoutSessions : workoutSessions,
    foods: patch.foods !== undefined ? patch.foods : foods,
    mealLog: patch.mealLog !== undefined ? patch.mealLog : mealLog,
    transactions: patch.transactions !== undefined ? patch.transactions : transactions,
    goalProgressLog: patch.goalProgressLog !== undefined ? patch.goalProgressLog : goalProgressLog,
    habitChecklistLog: patch.habitChecklistLog !== undefined ? patch.habitChecklistLog : habitChecklistLog,
    schemaVersion: DATA_SCHEMA_VERSION,
    __syncDomainUpdatedAt: { ...domainVersionRef.current },
    __syncRevision: Number(syncRevisionRef.current || 0),
    __syncFieldRevisions: { ...fieldRevisionRef.current },
    __taskRevisions: { ...taskRevisionRef.current },
    __syncUpdatedAt: lastRemoteSyncStampRef.current || null,
    __localUpdatedAt: new Date().toISOString(),
  }), [
    profile, habits, completions, tasks, goals, unlocked,
    workoutTemplates, workoutSessions, foods, mealLog,
    transactions, goalProgressLog, habitChecklistLog,
  ]);

  const persistTaskLocalState = useCallback((nextTasks = []) => {
    if (!session?.user?.id) return;
    const local = migrateUserData({
      ...(loadUserLocalData(session.user.id) || lastSyncedDataRef.current || {}),
      tasks: Array.isArray(nextTasks) ? nextTasks : [],
      __taskRevisions: { ...taskRevisionRef.current },
      __localUpdatedAt: new Date().toISOString(),
    });
    saveUserLocalData(session.user.id, local);
  }, [session?.user?.id]);

  const queueTaskMutation = useCallback((op) => {
    if (!session?.user?.id || !op?.id) return;
    const withMutation = {
      ...op,
      mutationId: op.mutationId || newMutationId(),
      baseRevision: Number(op.baseRevision ?? taskRevisionRef.current?.[op.id] ?? 0) || 0,
      queuedAt: op.queuedAt || new Date().toISOString(),
    };
    taskOutboxRef.current = compactTaskOutbox([...(taskOutboxRef.current || []), withMutation]);
    saveTaskOutbox(session.user.id, taskOutboxRef.current);
    setTaskSyncStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "syncing");
    setTaskSyncError("");
  }, [session?.user?.id]);

  const pullTaskState = useCallback(async ({ preservePending = true } = {}) => {
    if (!session?.user?.id) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setTaskSyncStatus("offline");
      return false;
    }
    try {
      let activeSession = session;
      try { activeSession = await getFreshSession(false); } catch (_) {}
      const remote = await fetchAtomicTasksForUser(activeSession);
      taskRevisionRef.current = { ...(remote.taskRevisions || {}) };
      let outbox = preservePending ? compactTaskOutbox(taskOutboxRef.current || loadTaskOutbox(session.user.id)) : [];
      taskOutboxRef.current = outbox;
      const visibleTasks = outbox.length ? applyTaskOutbox(remote.tasks || [], outbox) : (remote.tasks || []);

      lastSyncedDataRef.current = migrateUserData({
        ...(lastSyncedDataRef.current || {}),
        tasks: remote.tasks || [],
        __taskRevisions: remote.taskRevisions || {},
        __syncUpdatedAt: [lastSyncedDataRef.current?.__syncUpdatedAt, remote.updatedAt].filter(Boolean).sort().at(-1) || null,
      });
      setTasks(visibleTasks);
      persistTaskLocalState(visibleTasks);
      setTaskSyncStatus(outbox.length ? "syncing" : "idle");
      setTaskSyncError("");
      setLastSaved(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      return true;
    } catch (error) {
      captureClientError(error, { module: "task-sync-v6", action: "pull" });
      setTaskSyncError("verifique sua conexão");
      setTaskSyncStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
      return false;
    }
  }, [session, getFreshSession, persistTaskLocalState]);

  const flushTaskSync = useCallback(async () => {
    if (!session?.user?.id || taskSyncInFlightRef.current) return false;
    let outbox = compactTaskOutbox(taskOutboxRef.current || loadTaskOutbox(session.user.id));
    if (!outbox.length) {
      clearTaskOutbox(session.user.id);
      setTaskSyncStatus("idle");
      setTaskSyncError("");
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setTaskSyncStatus("offline");
      return false;
    }

    taskSyncInFlightRef.current = true;
    setTaskSyncStatus("syncing");
    setTaskSyncError("");
    try {
      let activeSession = session;
      try { activeSession = await getFreshSession(false); } catch (_) {}

      while (outbox.length) {
        let op = outbox[0];
        let response;
        const send = (currentSession, currentOp) => applyAtomicTaskOpForUser(currentSession, currentOp, {
          mutationId: currentOp.mutationId || newMutationId(),
          clientId: getSyncClientId(session.user.id),
        });
        try {
          response = await send(activeSession, op);
        } catch (error) {
          if (Number(error?.status || 0) !== 401) throw error;
          activeSession = await getFreshSession(true);
          response = await send(activeSession, op);
        }

        if (response?.conflict) {
          const fresh = await fetchAtomicTasksForUser(activeSession);
          taskRevisionRef.current = { ...(fresh.taskRevisions || {}) };
          const remoteExists = (fresh.tasks || []).some((task) => String(task?.id || "") === String(op.id));
          if (response?.reason === "deleted_remotely" || (op.op === "delete" && !remoteExists)) {
            outbox.shift();
          } else {
            op = { ...op, baseRevision: Number(fresh.taskRevisions?.[op.id] || 0), mutationId: newMutationId() };
            outbox[0] = op;
          }
          taskOutboxRef.current = compactTaskOutbox(outbox);
          saveTaskOutbox(session.user.id, taskOutboxRef.current);
          if (response?.reason !== "revision_conflict") continue;
          response = await send(activeSession, op);
          if (response?.conflict) throw new Error(`task_conflict_${response?.reason || "unknown"}`);
        }

        if (response?.task_id) {
          taskRevisionRef.current = {
            ...taskRevisionRef.current,
            [String(response.task_id)]: Number(response.revision || taskRevisionRef.current?.[response.task_id] || 0),
          };
        }
        outbox.shift();
        taskOutboxRef.current = compactTaskOutbox(outbox);
        saveTaskOutbox(session.user.id, taskOutboxRef.current);
      }

      clearTaskOutbox(session.user.id);
      taskOutboxRef.current = [];
      const pulled = await pullTaskState({ preservePending: false });
      setTaskSyncStatus(pulled ? "idle" : "error");
      setTaskSyncError(pulled ? "" : "task_pull_after_flush_failed");
      return pulled;
    } catch (error) {
      captureClientError(error, { module: "task-sync-v6", action: "flush" });
      taskOutboxRef.current = compactTaskOutbox(outbox);
      saveTaskOutbox(session.user.id, taskOutboxRef.current);
      const message = String(error?.message || "task_sync_failed");
      setTaskSyncError(message);
      if (message.toLowerCase().includes("task_time_required")) {
        fireToast("Uma tarefa nova sem horário foi recusada. Defina o horário e tente novamente.", <Clock3 size={16} color="#FFFFFF" />);
      } else if (message.toLowerCase().includes("free_limit_tasks")) {
        fireToast("O plano Free permite até 5 tarefas ativas.", <RefreshCw size={16} className="text-ember" />);
      }
      setTaskSyncStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
      return false;
    } finally {
      taskSyncInFlightRef.current = false;
      if (taskOutboxRef.current?.length && (typeof navigator === "undefined" || navigator.onLine !== false)) {
        clearTimeout(taskRetryTimerRef.current);
        taskRetryTimerRef.current = setTimeout(() => flushTaskSync(), 1800);
      }
    }
  }, [session, getFreshSession, pullTaskState, fireToast]);

  const routineFieldsSnapshot = useCallback(() => ({
    habits,
    completions,
    habitChecklistLog,
    workoutTemplates,
    workoutSessions,
  }), [habits, completions, habitChecklistLog, workoutTemplates, workoutSessions]);

  const persistRoutineLocalState = useCallback((fields = {}) => {
    if (!session?.user?.id) return;
    const normalized = {
      habits: Array.isArray(fields.habits) ? fields.habits : [],
      completions: Array.isArray(fields.completions) ? fields.completions : [],
      habitChecklistLog: Array.isArray(fields.habitChecklistLog) ? fields.habitChecklistLog : [],
      workoutTemplates: Array.isArray(fields.workoutTemplates) ? fields.workoutTemplates : [],
      workoutSessions: Array.isArray(fields.workoutSessions) ? fields.workoutSessions : [],
    };
    routineVisibleRef.current = normalized;
    const local = migrateUserData({
      ...(loadUserLocalData(session.user.id) || lastSyncedDataRef.current || {}),
      ...normalized,
      __localUpdatedAt: new Date().toISOString(),
    });
    saveUserLocalData(session.user.id, local);
  }, [session?.user?.id]);

  const queueRoutinePatch = useCallback((patch = {}, payload = null) => {
    if (!session?.user?.id) return;
    const changedFields = Object.keys(patch || {}).filter((key) => ROUTINE_FIELDS.includes(key));
    if (!changedFields.length) return;
    const before = routineFieldsSnapshot();
    const afterSource = payload || buildDataPayload(patch);
    const after = {
      habits: afterSource.habits || [],
      completions: afterSource.completions || [],
      habitChecklistLog: afterSource.habitChecklistLog || [],
      workoutTemplates: afterSource.workoutTemplates || [],
      workoutSessions: afterSource.workoutSessions || [],
    };
    const ops = buildRoutineOps(before, after, routineRevisionRef.current || {}, changedFields)
      .map((op) => ({ ...op, mutationId: newMutationId(), queuedAt: new Date().toISOString() }));
    if (!ops.length) {
      persistRoutineLocalState(after);
      return;
    }
    routineOutboxRef.current = compactRoutineOutbox([...(routineOutboxRef.current || []), ...ops]);
    saveRoutineOutbox(session.user.id, routineOutboxRef.current);
    persistRoutineLocalState(after);
  }, [session?.user?.id, routineFieldsSnapshot, buildDataPayload, persistRoutineLocalState]);

  const pullRoutineState = useCallback(async ({ preservePending = true, bootstrapLocal = null } = {}) => {
    if (!session?.user?.id) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    try {
      let activeSession = session;
      try { activeSession = await getFreshSession(false); } catch (_) {}
      const remote = await fetchAtomicRoutineForUser(activeSession);
      routineRevisionRef.current = { ...(remote.revisions || {}) };

      let outbox = preservePending
        ? compactRoutineOutbox(routineOutboxRef.current || loadRoutineOutbox(session.user.id))
        : [];

      // Migração única por dispositivo: preserva conclusões de hábitos e progresso
      // de treino que existiam apenas no cache local antes da arquitetura atômica.
      if (bootstrapLocal && !routineMigrationDone(session.user.id)) {
        const localFields = {
          habits: bootstrapLocal.habits || [],
          completions: bootstrapLocal.completions || [],
          habitChecklistLog: bootstrapLocal.habitChecklistLog || [],
          workoutTemplates: bootstrapLocal.workoutTemplates || [],
          workoutSessions: bootstrapLocal.workoutSessions || [],
        };
        const mergedMigration = mergeRoutineBootstrap(remote, localFields);
        const migrationOps = buildRoutineOps(remote, mergedMigration, remote.revisions || {}, ROUTINE_FIELDS)
          .map((op) => ({ ...op, mutationId: newMutationId(), queuedAt: new Date().toISOString() }));
        if (migrationOps.length) {
          outbox = compactRoutineOutbox([...outbox, ...migrationOps]);
          saveRoutineOutbox(session.user.id, outbox);
        }
        markRoutineMigrationDone(session.user.id);
      }

      routineOutboxRef.current = outbox;
      const visible = outbox.length ? applyRoutineOutbox(remote, outbox) : {
        habits: remote.habits || [],
        completions: remote.completions || [],
        habitChecklistLog: remote.habitChecklistLog || [],
        workoutTemplates: remote.workoutTemplates || [],
        workoutSessions: remote.workoutSessions || [],
      };
      routineVisibleRef.current = visible;
      setHabits(visible.habits);
      setCompletions(visible.completions);
      setHabitChecklistLog(visible.habitChecklistLog);
      setWorkoutTemplates(visible.workoutTemplates);
      setWorkoutSessions(visible.workoutSessions);
      persistRoutineLocalState(visible);
      return true;
    } catch (error) {
      captureClientError(error, { module: "routine-sync-v1", action: "pull" });
      return false;
    }
  }, [session, getFreshSession, persistRoutineLocalState]);

  const flushRoutineSync = useCallback(async () => {
    if (!session?.user?.id || routineSyncInFlightRef.current) return false;
    let outbox = compactRoutineOutbox(routineOutboxRef.current || loadRoutineOutbox(session.user.id));
    if (!outbox.length) {
      clearRoutineOutbox(session.user.id);
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;

    routineSyncInFlightRef.current = true;
    try {
      let activeSession = session;
      try { activeSession = await getFreshSession(false); } catch (_) {}

      while (outbox.length) {
        let op = outbox[0];
        const send = async (currentSession, currentOp) => applyAtomicRoutineOpForUser(currentSession, currentOp, {
          mutationId: currentOp.mutationId || newMutationId(),
          clientId: getSyncClientId(session.user.id),
        });
        let response;
        try {
          response = await send(activeSession, op);
        } catch (error) {
          if (Number(error?.status || 0) !== 401) throw error;
          activeSession = await getFreshSession(true);
          response = await send(activeSession, op);
        }

        if (response?.conflict) {
          const fresh = await fetchAtomicRoutineForUser(activeSession);
          routineRevisionRef.current = { ...(fresh.revisions || {}) };
          const revisionKey = `${op.collection}:${op.id}`;
          const collectionField = Object.entries(ROUTINE_COLLECTIONS).find(([, value]) => value === op.collection)?.[0];
          const remoteList = collectionField ? (fresh?.[collectionField] || []) : [];
          const remoteExists = remoteList.some((item) => {
            const directId = String(item?.id || "");
            if (directId === String(op.id)) return true;
            if (op.collection === "habit_completion") return `${item?.habitId || ""}:${item?.date || ""}` === String(op.id);
            if (op.collection === "habit_checklist") return `${item?.habitId || ""}:${item?.itemId || ""}:${item?.date || ""}` === String(op.id);
            return false;
          });
          if (response?.reason === "deleted_remotely" || (op.op === "delete" && !remoteExists)) {
            outbox.shift();
          } else {
            op = { ...op, baseRevision: Number(fresh.revisions?.[revisionKey] || 0), mutationId: newMutationId() };
            outbox[0] = op;
            response = await send(activeSession, op);
            if (response?.conflict) throw new Error(`routine_conflict_${response?.reason || "unknown"}`);
          }
        }

        if (response?.entity_id) {
          routineRevisionRef.current = {
            ...routineRevisionRef.current,
            [`${response.collection}:${response.entity_id}`]: Number(response.revision || 0),
          };
        }
        outbox.shift();
        routineOutboxRef.current = compactRoutineOutbox(outbox);
        saveRoutineOutbox(session.user.id, routineOutboxRef.current);
      }

      clearRoutineOutbox(session.user.id);
      routineOutboxRef.current = [];
      return await pullRoutineState({ preservePending: false });
    } catch (error) {
      captureClientError(error, { module: "routine-sync-v1", action: "flush" });
      routineOutboxRef.current = compactRoutineOutbox(outbox);
      saveRoutineOutbox(session.user.id, routineOutboxRef.current);
      return false;
    } finally {
      routineSyncInFlightRef.current = false;
      if (routineOutboxRef.current?.length && (typeof navigator === "undefined" || navigator.onLine !== false)) {
        clearTimeout(routineRetryTimerRef.current);
        routineRetryTimerRef.current = setTimeout(() => flushRoutineSync(), 1800);
      }
    }
  }, [session, getFreshSession, pullRoutineState]);

  const queueRemoteSync = useCallback((payload, changedKeys = []) => {
    if (!session?.user?.id || !changedKeys.length) return;

    // Tarefas V6 e, a partir da 1.1.28, Hábitos/Treinos atômicos são
    // sincronizados fora da domain-sync genérica.
    const genericKeys = changedKeys.filter((key) => key !== "tasks" && !ROUTINE_FIELDS.includes(key));
    if (!genericKeys.length) return;

    const merged = mergePendingPayloadV3(
      pendingSyncRef.current,
      payload,
      genericKeys,
      lastSyncedDataRef.current || {},
      fieldRevisionRef.current || {},
    );
    pendingSyncRef.current = merged;
    savePendingSync(session.user.id, merged);
  }, [session?.user?.id]);

  const flushPendingSync = useCallback(async () => {
    if (!session?.user?.id || !pendingSyncRef.current || syncInFlightRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("offline");
      return;
    }

    const pending = pendingSyncRef.current;
    const payload = pending?.data || pending;
    const changedKeys = Array.isArray(pending?.changedKeys) ? pending.changedKeys : [];
    if (!changedKeys.length) {
      pendingSyncRef.current = null;
      clearPendingSync(session.user.id);
      return;
    }

    syncInFlightRef.current = true;
    setSyncStatus("syncing");

    try {
      let activeSession = session;
      try { activeSession = await getFreshSession(false); } catch (_) {}

      const send = (currentSession) => saveRemoteForUser(currentSession, payload, {
        changedKeys,
        mutationId: pending?.mutationId || newMutationId(),
        clientId: getSyncClientId(session.user.id),
        baseFieldRevisions: pending?.baseFieldRevisions || fieldRevisionRef.current || {},
        taskOps: [],
      });

      let response;
      try {
        response = await send(activeSession);
      } catch (error) {
        if (Number(error?.status || 0) !== 401) throw error;
        activeSession = await getFreshSession(true);
        response = await send(activeSession);
      }

      const canonical = migrateUserData({
        ...(response?.data || {}),
        __syncRevision: Number(response?.revision || 0),
        __syncFieldRevisions: response?.fieldRevisions || {},
        __syncUpdatedAt: response?.updated_at || null,
        __taskRevisions: response?.taskRevisions || {},
      });
      taskRevisionRef.current = { ...(response?.taskRevisions || taskRevisionRef.current || {}) };
      syncRevisionRef.current = Number(response?.revision || syncRevisionRef.current || 0);
      fieldRevisionRef.current = { ...(response?.fieldRevisions || fieldRevisionRef.current || {}) };
      lastRemoteSyncStampRef.current = response?.updated_at || lastRemoteSyncStampRef.current || null;
      lastSyncedDataRef.current = canonical;

      const currentPending = pendingSyncRef.current;
      if (currentPending === pending) {
        pendingSyncRef.current = null;
        clearPendingSync(session.user.id);
        let visibleCanonical = taskOutboxRef.current?.length
          ? migrateUserData({ ...canonical, tasks: applyTaskOutbox(canonical.tasks || [], taskOutboxRef.current) })
          : canonical;
        if (routineVisibleRef.current) visibleCanonical = migrateUserData({ ...visibleCanonical, ...routineVisibleRef.current });
        applyRemoteData(visibleCanonical);
        saveUserLocalData(session.user.id, visibleCanonical);
      } else if (currentPending?.data) {
        // Uma segunda alteração aconteceu durante o POST. Usa a resposta confirmada
        // como nova base e reaplica a alteração mais nova item a item.
        const rebased = rebasePendingV3(canonical, currentPending);
        pendingSyncRef.current = rebased;
        savePendingSync(session.user.id, rebased);
        let visible = migrateUserData(mergeRemoteWithPendingV3(canonical, rebased));
        if (taskOutboxRef.current?.length) visible = migrateUserData({ ...visible, tasks: applyTaskOutbox(canonical.tasks || [], taskOutboxRef.current) });
        if (routineVisibleRef.current) visible = migrateUserData({ ...visible, ...routineVisibleRef.current });
        applyRemoteData(visible);
        saveUserLocalData(session.user.id, visible);
      }

      genericSyncFailureCountRef.current = 0;
      setSyncStatus(pendingSyncRef.current ? "syncing" : "idle");
      setLastSaved(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      captureClientError(e, { module: "sync", action: "flushPendingSync_v3" });
      if (Number(e?.status || 0) === 409 && e?.details?.error === "sync_conflict") {
        try {
          // A resposta 409 já traz a versão canônica atual. Não depende de uma
          // segunda requisição para reconciliar o conflito.
          const latest = e?.details?.data
            ? migrateUserData({
                ...e.details.data,
                __syncRevision: Number(e.details.revision || 0),
                __syncFieldRevisions: e.details.fieldRevisions || {},
                __syncUpdatedAt: e.details.updated_at || null,
                __taskRevisions: e.details.taskRevisions || {},
              })
            : await fetchRemoteForUser(await getFreshSession(false));
          if (latest) {
            syncRevisionRef.current = Number(latest?.__syncRevision || 0);
            fieldRevisionRef.current = { ...(latest?.__syncFieldRevisions || {}) };
            taskRevisionRef.current = { ...(latest?.__taskRevisions || e?.details?.taskRevisions || {}) };
            lastSyncedDataRef.current = latest;
            const rebasedPending = rebasePendingV3(latest, pending);

            // Tarefas V6 não participam da fila genérica. Conflitos da
            // domain-sync são tratados apenas para os demais módulos.

            pendingSyncRef.current = rebasedPending;
            if (rebasedPending?.changedKeys?.length) savePendingSync(session.user.id, rebasedPending);
            else clearPendingSync(session.user.id);
            let visible = rebasedPending?.data
              ? migrateUserData(mergeRemoteWithPendingV3(latest, rebasedPending))
              : latest;
            if (routineVisibleRef.current) visible = migrateUserData({ ...visible, ...routineVisibleRef.current });
            applyRemoteData(visible);
            saveUserLocalData(session.user.id, visible);
            lastRemotePullAtRef.current = Date.now();
          }
          setSyncStatus("syncing");
        } catch (pullError) {
          captureClientError(pullError, { module: "sync", action: "conflict_rebase_v3" });
          savePendingSync(session.user.id, pendingSyncRef.current || pending);
          setSyncStatus("offline");
        }
      } else if ([403, 422].includes(Number(e?.status || 0))) {
        saveRecoverySnapshot(session.user.id, migrateUserData({ ...(loadUserLocalData(session.user.id) || {}), ...payload }));
        if (pendingSyncRef.current === pending) pendingSyncRef.current = null;
        clearPendingSync(session.user.id);
        setSyncStatus("idle");
        fireToast(
          e?.details?.error === "task_time_required"
            ? "A sincronização recusou uma tarefa sem horário. Edite a tarefa e defina o horário."
            : "Uma alteração não pôde ser sincronizada por uma regra da conta.",
          <RefreshCw size={16} className="text-ember" />
        );
      } else {
        savePendingSync(session.user.id, pendingSyncRef.current || pending);
        genericSyncFailureCountRef.current = Math.min(8, genericSyncFailureCountRef.current + 1);
        setSyncStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
      }
    } finally {
      syncInFlightRef.current = false;
      if (pendingSyncRef.current && (typeof navigator === "undefined" || navigator.onLine !== false)) {
        clearTimeout(retrySyncTimer.current);
        const failures = genericSyncFailureCountRef.current;
        const delay = failures > 0 ? Math.min(30000, 1500 * (2 ** Math.min(failures - 1, 4))) : 650;
        retrySyncTimer.current = setTimeout(() => flushPendingSync(), delay);
      }
    }
  }, [session, getFreshSession, applyRemoteData, fireToast]);

  const pullRemoteState = useCallback(async ({ preservePending = true, flushAfterPull = false } = {}) => {
    if (!session?.user?.id || remotePullInFlightRef.current) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("offline");
      return false;
    }

    remotePullInFlightRef.current = true;
    setSyncStatus("syncing");
    try {
      let activeSession = session;
      try { activeSession = await getFreshSession(false); } catch (_) {}
      const remote = await fetchRemoteForUser(activeSession);
      lastRemotePullAtRef.current = Date.now();
      if (!remote) {
        setSyncStatus(pendingSyncRef.current ? "syncing" : "idle");
        return false;
      }

      syncRevisionRef.current = Number(remote?.__syncRevision || 0);
      fieldRevisionRef.current = { ...(remote?.__syncFieldRevisions || {}) };
      lastRemoteSyncStampRef.current = remote?.__syncUpdatedAt || null;
      lastSyncedDataRef.current = remote;

      const pending = preservePending ? pendingSyncRef.current : null;
      if (pending?.data) {
        const rebasedPending = rebasePendingV3(remote, pending);
        pendingSyncRef.current = rebasedPending;
        savePendingSync(session.user.id, rebasedPending);
        let merged = migrateUserData(mergeRemoteWithPendingV3(remote, rebasedPending));
        if (preservePending && taskOutboxRef.current?.length) {
          merged = migrateUserData({ ...merged, tasks: applyTaskOutbox(remote.tasks || [], taskOutboxRef.current) });
        }
        if (routineVisibleRef.current) merged = migrateUserData({ ...merged, ...routineVisibleRef.current });
        applyRemoteData(merged);
        saveUserLocalData(session.user.id, merged);
      } else {
        let visibleRemote = preservePending && taskOutboxRef.current?.length
          ? migrateUserData({ ...remote, tasks: applyTaskOutbox(remote.tasks || [], taskOutboxRef.current) })
          : remote;
        if (routineVisibleRef.current) visibleRemote = migrateUserData({ ...visibleRemote, ...routineVisibleRef.current });
        applyRemoteData(visibleRemote);
        saveUserLocalData(session.user.id, visibleRemote);
      }
      if (flushAfterPull) {
        await Promise.allSettled([flushPendingSync(), flushTaskSync()]);
      }

      setSyncStatus(pendingSyncRef.current ? "syncing" : "idle");
      setLastSaved(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      return true;
    } catch (error) {
      captureClientError(error, { module: "sync", action: "pullRemoteState_v3" });
      // Falha de leitura remota não significa que existam alterações locais
      // aguardando envio. Só exibimos erro de confirmação quando há fila real.
      setSyncStatus(
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "offline"
          : (pendingSyncRef.current ? "error" : "idle")
      );
      return false;
    } finally {
      remotePullInFlightRef.current = false;
    }
  }, [session, getFreshSession, applyRemoteData, flushPendingSync, flushTaskSync]);

  // Persistência principal: grava imediatamente no aparelho e envia somente os
  // domínios efetivamente alterados para a nuvem.
  const persist = useCallback((patch) => {
    if (!session?.user?.id) return;

    const payload = buildDataPayload(patch);
    const allChangedKeys = Object.keys(patch || {});
    const routineChangedKeys = allChangedKeys.filter((key) => ROUTINE_FIELDS.includes(key));
    const genericChangedKeys = allChangedKeys.filter((key) => key !== "tasks" && !ROUTINE_FIELDS.includes(key));

    if (!observedDataSignaturesRef.current) observedDataSignaturesRef.current = syncFieldSignatures(payload);
    for (const key of allChangedKeys.filter((key) => key !== "tasks")) {
      try { observedDataSignaturesRef.current[key] = JSON.stringify(payload?.[key] ?? null); } catch (_) {}
    }

    saveUserLocalData(session.user.id, payload);
    if (routineChangedKeys.length) queueRoutinePatch(patch, payload);
    if (genericChangedKeys.length) queueRemoteSync(payload, genericChangedKeys);

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (genericChangedKeys.length) setSyncStatus("offline");
      return;
    }

    if (routineChangedKeys.length) {
      clearTimeout(routineRetryTimerRef.current);
      routineRetryTimerRef.current = setTimeout(() => flushRoutineSync(), 120);
    }

    if (genericChangedKeys.length) {
      setSyncStatus("syncing");
      clearTimeout(remoteSaveTimer.current);
      remoteSaveTimer.current = setTimeout(() => {
        flushPendingSync();
      }, 350);
    }
  }, [session, buildDataPayload, queueRoutinePatch, queueRemoteSync, flushRoutineSync, flushPendingSync]);

  // Autosave de segurança: além de gravar localmente, detecta qualquer mudança
  // de estado que algum fluxo futuro tenha feito sem chamar persist(). Assim
  // históricos e registros não ficam presos apenas na memória do React.
  useEffect(() => {
    if (!dataReady || !session?.user?.id) return;
    const payload = buildDataPayload();
    const currentSignatures = syncFieldSignatures(payload);
    const previousSignatures = observedDataSignaturesRef.current;

    saveUserLocalData(session.user.id, payload);

    if (previousSignatures) {
      const changedKeys = Object.keys(currentSignatures).filter(
        (key) => key !== "tasks" && !ROUTINE_FIELDS.includes(key) && currentSignatures[key] !== previousSignatures[key]
      );
      if (changedKeys.length) {
        queueRemoteSync(payload, changedKeys);
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setSyncStatus("offline");
        } else {
          setSyncStatus("syncing");
          clearTimeout(remoteSaveTimer.current);
          remoteSaveTimer.current = setTimeout(() => {
            flushPendingSync();
          }, 350);
        }
      }
    }
    observedDataSignaturesRef.current = currentSignatures;

    const snapshots = loadRecoverySnapshots(session.user.id);
    if (!snapshots.some((item) => item.date === today())) {
      saveRecoverySnapshot(session.user.id, payload);
    }
  }, [dataReady, session?.user?.id, buildDataPayload, queueRemoteSync, flushPendingSync, flushTaskSync]);

  // Uma fila que sobreviveu a refresh/fechamento é retomada assim que os dados
  // da conta terminam de carregar. Esse é o ponto que garante persistência após
  // fechar o PWA antes do debounce de sincronização terminar.
  useEffect(() => {
    if (!dataReady || !session?.user?.id || !pendingSyncRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("offline");
      return;
    }
    clearTimeout(retrySyncTimer.current);
    retrySyncTimer.current = setTimeout(() => flushPendingSync(), 180);
    return () => clearTimeout(retrySyncTimer.current);
  }, [dataReady, session?.user?.id, flushPendingSync]);

  // Outbox V6: cada tarefa é uma mutação individual e durável. Ao reabrir o
  // PWA, a fila é retomada sem recalcular diferenças do array inteiro.
  useEffect(() => {
    if (!dataReady || !session?.user?.id) return;
    taskOutboxRef.current = compactTaskOutbox(loadTaskOutbox(session.user.id));
    if (!taskOutboxRef.current.length) {
      setTaskSyncStatus("idle");
      setTaskSyncError("");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setTaskSyncStatus("offline");
      return;
    }
    setTaskSyncStatus("syncing");
    clearTimeout(taskRetryTimerRef.current);
    taskRetryTimerRef.current = setTimeout(async () => {
      await pullTaskState({ preservePending: true });
      if (taskOutboxRef.current.length) await flushTaskSync();
    }, 160);
    return () => clearTimeout(taskRetryTimerRef.current);
  }, [dataReady, session?.user?.id, pullTaskState, flushTaskSync]);

  // 1.1.28 — Outbox dedicada de Hábitos e Treinos. O progresso local é
  // persistido por item e retomado após refresh/PWA fechado, sem domain-sync.
  useEffect(() => {
    if (!dataReady || !session?.user?.id) return;
    routineOutboxRef.current = compactRoutineOutbox(loadRoutineOutbox(session.user.id));
    if (!routineOutboxRef.current.length) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    clearTimeout(routineRetryTimerRef.current);
    routineRetryTimerRef.current = setTimeout(async () => {
      await pullRoutineState({ preservePending: true });
      if (routineOutboxRef.current.length) await flushRoutineSync();
    }, 180);
    return () => clearTimeout(routineRetryTimerRef.current);
  }, [dataReady, session?.user?.id, pullRoutineState, flushRoutineSync]);

  // Realtime dedicado para Hábitos e Treinos. A tabela é filtrada por user_id
  // via RLS; qualquer alteração em outro dispositivo dispara um pull imediato.
  useEffect(() => {
    if (!dataReady || !session?.user?.id || !session?.access_token || !SUPABASE_CONFIGURED) return;
    let disposed = false;
    const realtime = createSupabaseRealtimeClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    realtime.realtime.setAuth(session.access_token);
    const channel = realtime
      .channel(`constancce-routine-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "constancce_sync_entities", filter: `user_id=eq.${session.user.id}` },
        () => {
          if (disposed || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
          window.setTimeout(async () => {
            await pullRoutineState({ preservePending: true });
            if (routineOutboxRef.current.length) await flushRoutineSync();
          }, 80);
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          captureClientError(new Error(`routine_realtime_${String(status).toLowerCase()}`), { module: "routine-sync-v1", action: "realtime" });
        }
      });

    return () => {
      disposed = true;
      realtime.removeChannel(channel).catch(() => {});
    };
  }, [dataReady, session?.user?.id, session?.access_token, pullRoutineState, flushRoutineSync]);

  // Polling curto é somente fallback do Realtime, seguindo o padrão estável do
  // Task Sync V6. Mantém hábitos e treinos em harmonia mesmo se o websocket cair.
  useEffect(() => {
    if (!dataReady || !session?.user?.id) return;
    const timer = window.setInterval(async () => {
      if (routineSyncInFlightRef.current) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      await pullRoutineState({ preservePending: true });
      if (routineOutboxRef.current.length) await flushRoutineSync();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [dataReady, session?.user?.id, pullRoutineState, flushRoutineSync]);

  // 1.1.25 — Realtime de Tarefas consulta diretamente constancce_tasks.
  // domain-sync não participa deste caminho.
  useEffect(() => {
    if (!dataReady || !session?.user?.id || !session?.access_token || !SUPABASE_CONFIGURED) return;
    let disposed = false;
    const realtime = createSupabaseRealtimeClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    realtime.realtime.setAuth(session.access_token);
    const channel = realtime
      .channel(`constancce-tasks-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "constancce_tasks", filter: `user_id=eq.${session.user.id}` },
        () => {
          if (disposed || typeof navigator !== "undefined" && navigator.onLine === false) return;
          window.setTimeout(async () => {
            await pullTaskState({ preservePending: true });
            if (taskOutboxRef.current.length) await flushTaskSync();
          }, 80);
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          captureClientError(new Error(`task_realtime_${String(status).toLowerCase()}`), { module: "sync", action: "task_realtime" });
        }
      });

    return () => {
      disposed = true;
      realtime.removeChannel(channel).catch(() => {});
    };
  }, [dataReady, session?.user?.id, session?.access_token, pullTaskState, flushTaskSync]);

  // Polling dedicado de Tarefas como fallback do Realtime. É barato (uma tabela
  // pequena, filtrada por user_id) e não depende da saúde da domain-sync.
  useEffect(() => {
    if (!dataReady || !session?.user?.id) return;
    const timer = window.setInterval(async () => {
      if (taskSyncInFlightRef.current) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      await pullTaskState({ preservePending: true });
      if (taskOutboxRef.current.length) await flushTaskSync();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [dataReady, session?.user?.id, pullTaskState, flushTaskSync]);

  // Checkpoint multi-dispositivo: consulta a nuvem com frequência enquanto o app
  // está visível. 60s fazia uma alteração correta parecer "não sincronizada" em
  // outro aparelho; 5s reduz a janela de atualização sem transformar o app em polling agressivo.
  useEffect(() => {
    if (!dataReady || !session?.user?.id) return;

    clearInterval(safetySyncInterval.current);
    safetySyncInterval.current = window.setInterval(() => {
      if (pendingSyncRef.current || syncInFlightRef.current || remotePullInFlightRef.current) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      pullRemoteState({ preservePending: false });
    }, 30000);

    return () => clearInterval(safetySyncInterval.current);
  }, [dataReady, session?.user?.id, pullRemoteState]);

  // Ao sair/ocultar a página, tenta enviar a versão mais recente sem abandonar a gravação local.
  useEffect(() => {
    const flushBeforeLeave = () => {
      if (!session?.user?.id) return;
      const pending = pendingSyncRef.current;
      if (!pending?.data) return;
      const latest = pending.data;
      const localBeforeLeave = migrateUserData({
        ...(loadUserLocalData(session.user.id) || {}),
        ...latest,
      });
      saveUserLocalData(session.user.id, localBeforeLeave);
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        saveRemoteForUser(session, latest, {
          keepalive: true,
          changedKeys: pending.changedKeys || [],
          mutationId: pending.mutationId || newMutationId(),
          clientId: getSyncClientId(session.user.id),
          baseFieldRevisions: pending.baseFieldRevisions || fieldRevisionRef.current || {},
          taskOps: [],
        }).catch((error) => captureClientError(error, { module: "sync", action: "pagehide_flush_v3" }));
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushBeforeLeave();
        return;
      }
      if (
        document.visibilityState === "visible" &&
        (typeof navigator === "undefined" || navigator.onLine !== false)
      ) {
        pullTaskState({ preservePending: true }).then(() => {
          if (taskOutboxRef.current.length) flushTaskSync();
        });
        pullRoutineState({ preservePending: true }).then(() => {
          if (routineOutboxRef.current.length) flushRoutineSync();
        });
        if (Date.now() - lastRemotePullAtRef.current > 4000) {
          pullRemoteState({ preservePending: true, flushAfterPull: true });
        }
      }
    };
    const refreshWhenActive = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      pullTaskState({ preservePending: true }).then(() => {
        if (taskOutboxRef.current.length) flushTaskSync();
      });
      pullRoutineState({ preservePending: true }).then(() => {
        if (routineOutboxRef.current.length) flushRoutineSync();
      });
      if (pendingSyncRef.current || syncInFlightRef.current || remotePullInFlightRef.current) return;
      if (Date.now() - lastRemotePullAtRef.current < 1500) return;
      pullRemoteState({ preservePending: false });
    };
    window.addEventListener("pagehide", flushBeforeLeave);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("pageshow", refreshWhenActive);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", flushBeforeLeave);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("pageshow", refreshWhenActive);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session, pullRemoteState, pullTaskState, flushTaskSync, pullRoutineState, flushRoutineSync]);

  // Ao recuperar a internet, primeiro consulta a conta na nuvem e só depois
  // envia alterações locais pendentes. Isso evita que um aparelho offline
  // sobrescreva atualizações feitas em outro dispositivo.
  useEffect(() => {
    const handleOnline = () => {
      clearTimeout(retrySyncTimer.current);
      retrySyncTimer.current = setTimeout(async () => {
        await pullTaskState({ preservePending: true });
        if (taskOutboxRef.current.length) await flushTaskSync();
        await pullRoutineState({ preservePending: true });
        if (routineOutboxRef.current.length) await flushRoutineSync();
        await pullRemoteState({ preservePending: true, flushAfterPull: true });
      }, 120);
    };
    const handleOffline = () => { setSyncStatus("offline"); setTaskSyncStatus("offline"); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearTimeout(retrySyncTimer.current);
    };
  }, [pullRemoteState, pullTaskState, flushTaskSync, pullRoutineState, flushRoutineSync]);

  const handleAuthenticated = useCallback((authSession) => {
    if (!isEmailConfirmedUser(authSession?.user)) {
      saveStoredSession(null);
      setSession(null);
      setDataReady(false);
      return;
    }
    saveStoredSession(authSession);
    setSession(authSession);
    setDataReady(false);
  }, []);

  const handleLogout = useCallback(async () => {
    clearTimeout(remoteSaveTimer.current);
    clearTimeout(retrySyncTimer.current);
    clearInterval(safetySyncInterval.current);
    pendingSyncRef.current = null;
    materializedRecurringRef.current = new Set();
    taskOutboxRef.current = [];
    clearTimeout(taskRetryTimerRef.current);
    routineOutboxRef.current = [];
    routineVisibleRef.current = null;
    routineRevisionRef.current = {};
    clearTimeout(routineRetryTimerRef.current);
    const current = session;
    saveStoredSession(null);
    setSession(null);
    setLastSaved(null);
    setSyncStatus("idle");
    setTaskSyncStatus("idle");
    setTaskSyncError("");
    setDataReady(false);
    applyRemoteData({});
    if (current?.access_token) await signOutRemote(current.access_token);
  }, [session]);

  const setProfile = (updater) => {
    setProfileState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persist({ profile: next });
      return next;
    });
  };

  const handleManualSync = async () => {
    if (!session?.user?.id) return;
    setSyncStatus("syncing");
    setTaskSyncStatus("syncing");
    const [tasksPulled, routinePulled] = await Promise.all([
      pullTaskState({ preservePending: true }),
      pullRoutineState({ preservePending: true }),
    ]);
    const [tasksFlushed, routineFlushed] = await Promise.all([
      taskOutboxRef.current.length ? flushTaskSync() : Promise.resolve(true),
      routineOutboxRef.current.length ? flushRoutineSync() : Promise.resolve(true),
    ]);
    const genericPulled = await pullRemoteState({ preservePending: true, flushAfterPull: true });
    const taskOk = Boolean(tasksPulled && tasksFlushed && !taskOutboxRef.current.length);
    const routineOk = Boolean(routinePulled && routineFlushed && !routineOutboxRef.current.length);
    const genericOk = Boolean(genericPulled || !pendingSyncRef.current);
    setTaskSyncStatus(taskOutboxRef.current.length ? "syncing" : (taskOk ? "idle" : "error"));
    setSyncStatus(pendingSyncRef.current ? "syncing" : (genericOk ? "idle" : "error"));
    fireToast(
      taskOk && routineOk
        ? (genericOk ? "Tudo sincronizado entre seus dispositivos." : "Tarefas, Hábitos e Treinos sincronizados. Outros dados ainda aguardam confirmação.")
        : (!routineOk ? "Não foi possível confirmar Hábitos e Treinos na nuvem." : "Não foi possível confirmar as tarefas na nuvem."),
      <RefreshCw size={16} className={taskOk && routineOk ? "text-brass" : "text-ember"} />
    );
  };

  const handleDeleteAccount = async (currentPassword = "") => {
    if (!currentPassword) {
      fireToast("Digite sua senha atual no Perfil antes de excluir a conta.", <ShieldCheck size={16} className="text-ember" />);
      return;
    }
    if (!(await confirm("Excluir sua conta e seus dados? Esta ação não pode ser desfeita.", { confirmLabel: "Excluir conta" }))) return;
    try {
      await edgeFunctionRequest(session, "delete-account", { password: currentPassword });
      await handleLogout();
    } catch (_) {
      fireToast("A exclusão da conta ainda não está disponível neste deploy.", <X size={16} className="text-ember" />);
    }
  };

  const toggleHabit = (habitId, dateStr) => {
    setCompletions((prev) => {
      const exists = prev.find((c) => c.habitId === habitId && c.date === dateStr);
      const next = exists ? prev.filter((c) => c !== exists) : [...prev, { id: uid(), habitId, date: dateStr }];
      persist({ completions: next });
      if (!exists) {
        recordActivityEvent(session, "habit_completed", `habit:${habitId}:${dateStr}`, { date: dateStr });
      }
      return next;
    });
  };
  const toggleHabitChecklist = (habitId, itemId, dateStr) => {
    setHabitChecklistLog((prev) => {
      const existing = prev.find((x) => x.habitId === habitId && x.itemId === itemId && x.date === dateStr);
      const next = existing ? prev.map((x) => x === existing ? { ...x, done: !x.done } : x) : [...prev, { id: uid(), habitId, itemId, date: dateStr, done: true }];
      const habit = habits.find((h) => h.id === habitId);
      const allDone = habit?.checklist?.length > 0 && habit.checklist.every((item) => next.some((x) => x.habitId === habitId && x.itemId === item.id && x.date === dateStr && x.done));
      setCompletions((cprev) => { const exists = cprev.some((c) => c.habitId === habitId && c.date === dateStr); const cnext = allDone && !exists ? [...cprev, { id: uid(), habitId, date: dateStr }] : (!allDone && exists ? cprev.filter((c) => !(c.habitId === habitId && c.date === dateStr)) : cprev); persist({ habitChecklistLog: next, completions: cnext }); return cnext; });
      return next;
    });
  };
  const saveHabit = (h) => {
    const exists = habits.some((item) => item.id === h.id);
    const activeCount = habits.filter((item) => item.active !== false).length;
    if (!exists && !isPro && activeCount >= PRO_LIMITS.habits) {
      requestPro("habits");
      return false;
    }
    setHabits((prev) => {
      const next = exists ? prev.map((x) => x.id === h.id ? h : x) : [...prev, h];
      persist({ habits: next });
      return next;
    });
    return true;
  };
  const deleteHabit = async (id) => { if (!(await confirm("Tem certeza que deseja excluir este hábito?"))) return; const nextChecklistLog = habitChecklistLog.filter((x) => x.habitId !== id); setHabitChecklistLog(nextChecklistLog); setHabits((prev) => { const next = prev.filter((h) => h.id !== id); persist({ habits: next, habitChecklistLog: nextChecklistLog }); return next; }); };
  const toggleActive = (id) => setHabits((prev) => { const next = prev.map((h) => h.id === id ? { ...h, active: !h.active, pausedAt: h.active ? today() : h.pausedAt, resumedAt: !h.active ? today() : h.resumedAt } : h); persist({ habits: next }); return next; });

  const commitTaskMutation = (nextTasks, op) => {
    persistTaskLocalState(nextTasks);
    if (op) queueTaskMutation(op);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setTaskSyncStatus("offline");
      return;
    }
    setTaskSyncStatus("syncing");
    clearTimeout(taskRetryTimerRef.current);
    taskRetryTimerRef.current = setTimeout(() => flushTaskSync(), 120);
  };

  const saveTask = (tk) => {
    const exists = tasks.some((item) => item.id === tk.id);
    if (!exists && !/^\d{2}:\d{2}$/.test(String(tk?.taskTime || ""))) {
      fireToast("Defina um horário antes de criar a tarefa.", <Clock3 size={16} color="#FFFFFF" />);
      return false;
    }
    const activeCount = tasks.filter((item) => {
      if (isRecurringTask(item)) return true;
      return item.status !== "concluida";
    }).length;
    if (!exists && !isPro && activeCount >= PRO_LIMITS.activeTasks) {
      requestPro("tasks");
      return false;
    }
    setTasks((prev) => {
      const next = exists ? prev.map((x) => x.id === tk.id ? tk : x) : [...prev, tk];
      commitTaskMutation(next, makeTaskUpsert(tk, taskRevisionRef.current?.[tk.id] || 0, newMutationId()));
      return next;
    });
    return true;
  };
  const deleteTask = async (id) => { if (!(await confirm("Tem certeza que deseja excluir esta tarefa?"))) return; setTasks((prev) => { const next = prev.filter((t) => t.id !== id); commitTaskMutation(next, makeTaskDelete(id, taskRevisionRef.current?.[id] || 0, newMutationId())); return next; }); };
  const setTaskStatus = (id, status, dateStr = today()) => setTasks((prev) => {
    const next = prev.map((task) => {
      if (task.id !== id) return task;
      if (isRecurringTask(task)) {
        const dates = new Set(task.completionDates || []);
        if (status === "concluida") dates.add(dateStr); else dates.delete(dateStr);
        return { ...task, status: "pendente", completionDates: [...dates].sort() };
      }
      return { ...task, status, completedAt: status === "concluida" ? dateStr : undefined };
    });
    const changedTask = next.find((task) => task.id === id);
    if (changedTask) commitTaskMutation(next, makeTaskUpsert(changedTask, taskRevisionRef.current?.[id] || 0, newMutationId()));
    if (status === "concluida") {
      recordActivityEvent(session, "task_completed", `task:${id}:${dateStr}`, { date: dateStr });
    }
    return next;
  });

  const moveTaskKanban = (id, destination, dateStr = today()) => setTasks((prev) => {
    const next = prev.map((task) => {
      if (task.id !== id) return task;

      if (destination === "concluida") {
        if (isRecurringTask(task)) {
          const dates = new Set(task.completionDates || []);
          dates.add(dateStr);
          return { ...task, status: "pendente", completionDates: [...dates].sort() };
        }
        return { ...task, status: "concluida", completedAt: dateStr };
      }

      if (isRecurringTask(task)) {
        const dates = new Set(task.completionDates || []);
        dates.delete(dateStr);
        return {
          ...task,
          priority: destination,
          status: "pendente",
          completionDates: [...dates].sort(),
        };
      }

      return {
        ...task,
        priority: destination,
        status: "pendente",
        completedAt: undefined,
      };
    });

    const changedTask = next.find((task) => task.id === id);
    if (changedTask) commitTaskMutation(next, makeTaskUpsert(changedTask, taskRevisionRef.current?.[id] || 0, newMutationId()));
    if (destination === "concluida") {
      recordActivityEvent(session, "task_completed", `task:${id}:${dateStr}`, { date: dateStr, source: "kanban" });
    }
    return next;
  });

  const saveGoal = (g) => {
    const exists = goals.some((item) => item.id === g.id);
    const activeCount = goals.filter((item) => !item.completed && !item.archived).length;
    if (!exists && !isPro && activeCount >= PRO_LIMITS.activeGoals) {
      requestPro("goals");
      return false;
    }
    setGoals((prev) => {
      const base = g.isPrimary
        ? prev.map((item) => item.id === g.id ? item : { ...item, isPrimary: false })
        : prev;
      const next = exists
        ? base.map((item) => item.id === g.id ? g : item)
        : [...base, g];
      persist({ goals: next });
      return next;
    });
    return true;
  };
  const deleteGoal = async (id) => { if (!(await confirm("Tem certeza que deseja excluir esta meta?"))) return; setGoals((prev) => { const next = prev.filter((g) => g.id !== id); persist({ goals: next }); return next; }); };
  const toggleGoalChecklist = (goalId, itemId) => setGoals((prev) => {
    const next = prev.map((g) => {
      if (g.id !== goalId) return g;
      const checklist = (g.checklist || []).map((item) => item.id === itemId ? { ...item, done: !item.done } : item);
      const current = checklist.filter((x) => x.done).length;
      const completed = checklist.length > 0 && current === checklist.length;
      return { ...g, checklist, current, target: checklist.length || g.target, completed, completedAt: completed ? today() : undefined };
    });
    const changed = next.find((g) => g.id === goalId);
    const logEntry = { id: uid(), goalId, date: today(), value: Number(changed?.current) || 0 };
    const nextLog = [...goalProgressLog, logEntry];
    setGoalProgressLog(nextLog); persist({ goals: next, goalProgressLog: nextLog });
    if (changed?.completed) {
      fireToast("Meta concluída!", <Trophy size={16} className="text-brass" />);
      recordActivityEvent(session, "goal_completed", `goal:${goalId}`, { date: today() });
    }
    return next;
  });
  const addGoalProgress = (id, amount) => setGoals((prev) => {
    const requestedDelta = Number(amount) || 0;
    if (requestedDelta === 0) return prev;

    const previousGoal = prev.find((goal) => goal.id === id);
    if (!previousGoal) return prev;

    const previousCurrent = Math.max(0, Number(previousGoal.current || 0));
    const appliedDelta = requestedDelta < 0
      ? -Math.min(previousCurrent, Math.abs(requestedDelta))
      : requestedDelta;

    if (appliedDelta === 0) return prev;

    let changed = null;
    const next = prev.map((g) => {
      if (g.id !== id) return g;
      const nextCurrent = Math.max(0, Number(g.current || 0) + appliedDelta);
      changed = { ...g, current: nextCurrent };
      return changed;
    });

    if (!changed) return prev;

    const logEntry = {
      id: uid(),
      goalId: id,
      date: today(),
      value: Number(changed.current) || 0,
      added: appliedDelta,
      adjustmentType: appliedDelta < 0 ? "remove" : "add",
      createdAt: new Date().toISOString(),
    };

    const nextLog = [...goalProgressLog, logEntry];

    setGoalProgressLog(nextLog);
    persist({ goals: next, goalProgressLog: nextLog });

    const previousPct = goalProgressPercent(previousGoal);
    const nextPct = goalProgressPercent(changed);
    const crossedMilestone = appliedDelta > 0
      ? goalMilestonePercents(changed)
          .filter((milestone) => milestone > previousPct && milestone <= nextPct)
          .sort((a, b) => b - a)[0]
      : null;

    fireToast(
      crossedMilestone
        ? `Marco alcançado: ${crossedMilestone}% da meta.`
        : appliedDelta < 0
          ? changed.type === "financeira"
            ? `${money(Math.abs(appliedDelta))} removido da meta.`
            : `-${Math.abs(appliedDelta).toLocaleString("pt-BR")} removido da meta.`
          : changed.type === "financeira"
            ? `${money(appliedDelta)} adicionado à meta.`
            : `+${appliedDelta.toLocaleString("pt-BR")} adicionado à meta.`,
      crossedMilestone
        ? <Trophy size={16} className="text-brass" />
        : appliedDelta < 0
          ? <Minus size={16} className="text-ember" />
          : <Target size={16} className="text-brass" />
    );

    return next;
  });

  const updateProgress = (id, current, complete) => setGoals((prev) => {
    let changed = null;
    const next = prev.map((g) => {
      if (g.id !== id) return g;
      changed = {
        ...g,
        current: Math.max(0, Number(current) || 0),
        completed: complete ? true : g.completed,
        completedAt: complete ? today() : g.completedAt,
      };
      return changed;
    });

    if (!changed) return prev;

    const logEntry = {
      id: uid(),
      goalId: id,
      date: today(),
      value: Number(changed.current) || 0,
      createdAt: new Date().toISOString(),
    };

    const nextLog = [...goalProgressLog, logEntry];

    setGoalProgressLog(nextLog);
    persist({ goals: next, goalProgressLog: nextLog });

    if (complete) {
      fireToast("Meta concluída!", <Trophy size={16} className="text-brass" />);
      recordActivityEvent(session, "goal_completed", `goal:${id}`, { date: today() });
    }
    return next;
  });

  const saveWorkoutTemplate = (tp) => {
    const exists = workoutTemplates.some((item) => item.id === tp.id);
    if (!exists && !isPro && workoutTemplates.length >= PRO_LIMITS.workouts) {
      requestPro("workouts");
      return false;
    }
    setWorkoutTemplates((prev) => {
      const next = exists
        ? prev.map((item) => item.id === tp.id ? tp : item)
        : [...prev, tp];
      persist({ workoutTemplates: next });
      return next;
    });
    return true;
  };

  const reorderWorkoutTemplates = (sourceId, targetId) => setWorkoutTemplates((prev) => {
    if (!sourceId || !targetId || sourceId === targetId) return prev;

    const fromIndex = prev.findIndex((item) => item.id === sourceId);
    const toIndex = prev.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return prev;

    const next = [...prev];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);

    persist({ workoutTemplates: next });
    return next;
  });

  const moveWorkoutTemplateByStep = (templateId, direction) => setWorkoutTemplates((prev) => {
    const index = prev.findIndex((item) => item.id === templateId);
    if (index < 0) return prev;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= prev.length) return prev;

    const next = [...prev];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];

    persist({ workoutTemplates: next });
    return next;
  });
  const deleteWorkoutTemplate = async (id) => { if (!(await confirm("Tem certeza que deseja excluir este treino?"))) return; setWorkoutTemplates((prev) => { const next = prev.filter((tp) => tp.id !== id); persist({ workoutTemplates: next }); return next; }); };
  const startOrGetSession = (templateId) => {
    const t = today();
    setWorkoutSessions((prev) => {
      const existing = prev.find((s) => s.templateId === templateId && s.date === t);
      if (existing) {
        if (!existing.plannedOnly) return prev;
        const next = prev.map((sessionRow) =>
          sessionRow.id === existing.id
            ? {
                ...sessionRow,
                plannedOnly: false,
                startedAt: sessionRow.startedAt || new Date().toISOString(),
              }
            : sessionRow
        );
        persist({ workoutSessions: next });
        return next;
      }

      const tpl = workoutTemplates.find((x) => x.id === templateId);
      if (!tpl) return prev;

      const sets = {};
      const loads = {};
      tpl.exercises.forEach((ex) => {
        sets[ex.id] = Array.from({ length: ex.sets }, () => false);
        if (ex.load !== "" && ex.load != null) loads[ex.id] = Number(ex.load);
      });

      const next = [
        ...prev,
        {
          id: uid(),
          templateId,
          date: t,
          sets,
          loads,
          repsDone: {},
          exerciseNotes: {},
          exerciseOverrides: {},
          effortRating: null,
          startedAt: new Date().toISOString(),
          completed: false,
          plannedOnly: false,
        },
      ];
      persist({ workoutSessions: next });
      return next;
    });
  };

  const scheduleWorkoutSession = (templateId, date, templateOverride = null) => {
    if (!templateId || !date) return false;
    const tpl = templateOverride || workoutTemplates.find((item) => item.id === templateId);
    if (!tpl) return false;

    setWorkoutSessions((prev) => {
      if (prev.some((sessionRow) => sessionRow.templateId === templateId && sessionRow.date === date)) {
        return prev;
      }

      const sets = {};
      const loads = {};
      tpl.exercises.forEach((exercise) => {
        sets[exercise.id] = Array.from({ length: exercise.sets }, () => false);
        if (exercise.load !== "" && exercise.load != null) loads[exercise.id] = Number(exercise.load);
      });

      const next = [
        ...prev,
        {
          id: uid(),
          templateId,
          date,
          sets,
          loads,
          repsDone: {},
          exerciseNotes: {},
          exerciseOverrides: {},
          effortRating: null,
          startedAt: null,
          completed: false,
          plannedOnly: true,
          scheduledAt: new Date().toISOString(),
        },
      ];
      persist({ workoutSessions: next });
      return next;
    });

    return true;
  };
  const toggleSet = (sessionId, exerciseId, idx) => setWorkoutSessions((prev) => {
    const next = prev.map((s) => {
      if (s.id !== sessionId) return s;
      const arr = [...(s.sets[exerciseId] || [])]; arr[idx] = !arr[idx];
      return { ...s, sets: { ...s.sets, [exerciseId]: arr } };
    });
    persist({ workoutSessions: next });
    return next;
  });
  const toggleExercise = (sessionId, exerciseId, totalSets) => setWorkoutSessions((prev) => {
    const next = prev.map((s) => { if (s.id !== sessionId) return s; const current = s.sets[exerciseId] || Array.from({ length: totalSets }, () => false); const allOn = current.length === totalSets && current.every(Boolean); return { ...s, sets: { ...s.sets, [exerciseId]: Array.from({ length: totalSets }, () => !allOn) } }; });
    persist({ workoutSessions: next }); return next;
  });
  const updateWorkoutLoad = (sessionId, exerciseId, value) => setWorkoutSessions((prev) => {
    const next = prev.map((sessionRow) => sessionRow.id === sessionId
      ? { ...sessionRow, loads: { ...(sessionRow.loads || {}), [exerciseId]: value === "" ? "" : Number(value) } }
      : sessionRow);
    persist({ workoutSessions: next });
    return next;
  });
  const updateWorkoutReps = (sessionId, exerciseId, setIndex, value) => setWorkoutSessions((prev) => {
    const next = prev.map((sessionRow) => {
      if (sessionRow.id !== sessionId) return sessionRow;
      const arr = [...(sessionRow.repsDone?.[exerciseId] || [])];
      arr[setIndex] = value === "" ? null : Number(value);
      return { ...sessionRow, repsDone: { ...(sessionRow.repsDone || {}), [exerciseId]: arr } };
    });
    persist({ workoutSessions: next });
    return next;
  });

  const updateWorkoutSession = (sessionId, patchOrUpdater) => setWorkoutSessions((prev) => {
    const next = prev.map((sessionRow) => {
      if (sessionRow.id !== sessionId) return sessionRow;
      if (typeof patchOrUpdater === "function") {
        return patchOrUpdater(sessionRow);
      }
      return { ...sessionRow, ...(patchOrUpdater || {}) };
    });
    persist({ workoutSessions: next });
    return next;
  });
  const completeSession = (sessionId) => setWorkoutSessions((prev) => {
    const completedAt = new Date().toISOString();
    const next = prev.map((sessionRow) => {
      if (sessionRow.id !== sessionId) return sessionRow;

      const startedAt = sessionRow.startedAt || completedAt;
      const elapsed = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const durationMinutes = elapsed > 0
        ? Math.max(1, Math.round(elapsed / 60000))
        : Number(sessionRow.durationMinutes || 0);

      return {
        ...sessionRow,
        completed: true,
        completedAt,
        startedAt,
        durationMinutes,
      };
    });
    persist({ workoutSessions: next });
    fireToast("Treino concluído e salvo.", <Dumbbell size={16} className="text-brass" />);
    recordActivityEvent(session, "workout_completed", `workout-session:${sessionId}`, { date: today() });
    return next;
  });

  const undoCompleteSession = async (sessionId) => {
    if (!(await confirm("Desfazer a conclusão deste treino? As séries e cargas registradas serão mantidas, mas o treino voltará para Em andamento.", { confirmLabel: "Desfazer" }))) return;

    setWorkoutSessions((prev) => {
      const next = prev.map((sessionRow) =>
        sessionRow.id === sessionId
          ? { ...sessionRow, completed: false, completedAt: null }
          : sessionRow
      );
      persist({ workoutSessions: next });
      fireToast("Conclusão do treino desfeita.", <RotateCcw size={16} className="text-brass" />);
      return next;
    });
  };

  const addMeal = (meal, newFood) => {
    const meals = Array.isArray(meal) ? meal.filter(Boolean) : [meal].filter(Boolean);
    if (!isPro && meals.length) {
      const counts = new Map();
      for (const item of mealLog) {
        const key = `${item?.date || today()}::${item?.mealType || MEAL_TYPES[0]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const item of meals) {
        const key = `${item?.date || today()}::${item?.mealType || MEAL_TYPES[0]}`;
        const nextCount = (counts.get(key) || 0) + 1;
        if (nextCount > PRO_LIMITS.dietItemsPerMeal) {
          requestPro("diet");
          fireToast(`No Free, cada refeição permite até ${PRO_LIMITS.dietItemsPerMeal} alimentos.`, <Lock size={16} className="text-brass" />);
          return false;
        }
        counts.set(key, nextCount);
      }
    }
    if (meals.length) {
      setMealLog((prev) => {
        const next = [...prev, ...meals];
        persist({ mealLog: next });
        return next;
      });
    }

    if (newFood) {
      setFoods((prev) => {
        const key = dietFoodKey(newFood);
        if (prev.some((food) => dietFoodKey(food) === key)) return prev;
        const next = [...prev, newFood];
        persist({ foods: next });
        return next;
      });
    }
    return true;
  };

  const updateMeal = (id, patchOrMeal) => {
    setMealLog((prev) => {
      const next = prev.map((meal) => {
        if (meal.id !== id) return meal;
        return typeof patchOrMeal === "function"
          ? patchOrMeal(meal)
          : { ...meal, ...(patchOrMeal || {}) };
      });
      persist({ mealLog: next });
      return next;
    });
  };

  const toggleMealConsumed = (id) => {
    setMealLog((prev) => {
      const next = prev.map((meal) => {
        if (meal.id !== id) return meal;
        const consumed = !dietMealConsumed(meal);
        return {
          ...meal,
          consumed,
          consumedAt: consumed ? new Date().toISOString() : null,
        };
      });
      persist({ mealLog: next });
      return next;
    });
  };

  const deleteMeal = async (id) => {
    if (!(await confirm("Tem certeza que deseja excluir esta refeição?"))) return;
    setMealLog((prev) => {
      const next = prev.filter((meal) => meal.id !== id);
      persist({ mealLog: next });
      return next;
    });
  };

  const deleteFood = async (id) => {
    if (!(await confirm("Excluir este alimento personalizado? Os registros antigos serão mantidos."))) return;
    setFoods((prev) => {
      const next = prev.filter((food) => food.id !== id);
      persist({ foods: next });
      return next;
    });
  };

  const addTransaction = (tx) => {
    if (!isPro && transactions.length >= PRO_LIMITS.financeTransactions) {
      requestPro("finance");
      fireToast(`O plano Free permite até ${PRO_LIMITS.financeTransactions} lançamentos financeiros.`, <Lock size={16} className="text-brass" />);
      return false;
    }
    setTransactions((prev) => {
      const next = [...prev, tx];
      persist({ transactions: next });
      return next;
    });
    return true;
  };
  const removeTransactionRecord = (id) => { setTransactions((prev) => { const next = prev.filter((t) => t.id !== id); persist({ transactions: next }); return next; }); };
  const deleteTransaction = async (id) => { if (!(await confirm("Tem certeza que deseja excluir este lançamento?"))) return; removeTransactionRecord(id); };

  // Materializa automaticamente as recorrências mensais quando o dia programado chega.
  //
  // profile é reconstruído (referência nova) a cada sincronização aplicada, então
  // profile?.financeRecurring muda de referência com muito mais frequência do que
  // seu conteúdo — este efeito refazia a checagem de "já existe?" a cada pull. Se
  // um pull sobrescrevesse transactions ANTES da adição recém-criada ter sido
  // sincronizada (uma corrida real, já vista em outro campo), a checagem local
  // deixava de encontrar o lançamento e criava outro, duplicando a recorrência —
  // e se isso se repetisse, parecia que um lançamento excluído "voltava sozinho".
  // materializedRecurringRef garante uma única materialização por combinação
  // recorrência+mês durante a sessão, independente de quantas vezes o efeito rodar.
  useEffect(() => {
    if (!isPro || !dataReady || !profile?.financeRecurring?.length) return;

    const now = new Date();
    const monthKey = today().slice(0, 7);
    const currentDay = now.getDate();
    const year = now.getFullYear();
    const monthIndex = now.getMonth();
    const daysInCurrentMonth = new Date(year, monthIndex + 1, 0).getDate();

    setTransactions((prev) => {
      const additions = [];

      (profile.financeRecurring || [])
        .filter((item) => item.active !== false)
        .forEach((item) => {
          const materializedKey = `${item.id}:${monthKey}`;
          if (materializedRecurringRef.current.has(materializedKey)) return;

          const dueDay = Math.min(daysInCurrentMonth, Math.max(1, Number(item.day) || 1));
          if (dueDay > currentDay) return;
          if (item.createdAt && String(item.createdAt).slice(0, 7) > monthKey) return;

          const alreadyExists = prev.some(
            (tx) => tx.recurringId === item.id && String(tx.date || "").slice(0, 7) === monthKey
          );
          materializedRecurringRef.current.add(materializedKey);
          if (alreadyExists) return;

          additions.push({
            id: uid(),
            type: item.type,
            category: item.category,
            value: Number(item.value || 0),
            date: `${monthKey}-${String(dueDay).padStart(2, "0")}`,
            description: item.description || "Recorrência",
            recurringId: item.id,
            recurringMonth: monthKey,
          });
        });

      if (!additions.length) return prev;
      const next = [...prev, ...additions];
      persist({ transactions: next });
      return next;
    });
  }, [isPro, dataReady, profile?.financeRecurring]);

  // Foguinho da tela Hoje = presença diária no Constancce.
  // v3 corrige definitivamente a migração histórica: enquanto a conta ainda
  // estiver em uma versão antiga do streak, reconstruímos os dias anteriores
  // usando a MESMA lógica de atividade/score exibida em Progresso.
  const accountCreatedDate = useMemo(() => {
    const raw = session?.user?.created_at;
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : fmt(date);
  }, [session?.user?.created_at]);

  const usageDaysForToday = useMemo(() => {
    const currentDate = today();
    const version = Number(profile?.appUsageStreakVersion || 0);
    const existing = normalizeUsageDays(profile?.appUsageDays || [], currentDate)
      .filter((date) => !accountCreatedDate || date >= accountCreatedDate);

    if (version >= 3) {
      return normalizeUsageDays([...existing, currentDate], currentDate, 730);
    }

    const historical = [];
    for (let offset = 44; offset >= 1; offset -= 1) {
      const date = addDays(currentDate, -offset);
      if (accountCreatedDate && date < accountCreatedDate) continue;
      const performance = getDayPerformance(
        date,
        habits,
        completions,
        tasks,
        workoutSessions,
        mealLog,
        goalProgressLog
      );
      if (performance.score > 0) historical.push(date);
    }

    // Hoje conta imediatamente porque esta execução do código prova que o app foi aberto.
    return normalizeUsageDays([...historical, currentDate], currentDate, 730);
  }, [
    accountCreatedDate,
    profile?.appUsageStreakVersion,
    profile?.appUsageDays,
    habits,
    completions,
    tasks,
    workoutSessions,
    mealLog,
    goalProgressLog,
  ]);

  useEffect(() => {
    if (!dataReady || !session?.user?.id || !profile) return;

    const currentDate = today();
    const existing = normalizeUsageDays(profile?.appUsageDays || [], currentDate)
      .filter((date) => !accountCreatedDate || date >= accountCreatedDate);
    const alreadyV3 = Number(profile?.appUsageStreakVersion || 0) >= 3;
    const sameDays =
      existing.length === usageDaysForToday.length &&
      existing.every((date, index) => date === usageDaysForToday[index]);

    if (alreadyV3 && sameDays) return;

    const nextProfile = {
      ...profile,
      appUsageDays: usageDaysForToday,
      appUsageStreakVersion: 3,
      lastAppVisitAt: new Date().toISOString(),
    };

    setProfileState(nextProfile);
    persist({ profile: nextProfile });
  }, [
    dataReady,
    session?.user?.id,
    accountCreatedDate,
    profile?.appUsageStreakVersion,
    profile?.appUsageDays,
    usageDaysForToday,
  ]);

  // Streak de hábitos "perfeitos": só conta um dia quando TODOS os hábitos
  // marcados countsForStreak foram concluídos nele. Distinto do streak de USO
  // do app (usageStreaks, mostrado no foguinho do topo) — os dois números
  // divergem por design e não devem compartilhar o nome genérico "streak" na UI.
  const habitStreaks = useMemo(() => computeStreaks(habits, completions, today()), [habits, completions]);
  const usageStreaks = useMemo(
    () => computeUsageStreaks(usageDaysForToday, today()),
    [usageDaysForToday]
  );

  const stats = useMemo(() => {
    const t = today();
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const perfFor = (d) => getDayPerformance(d, habits, completions, tasks, workoutSessions, mealLog, goalProgressLog);

    const history365 = Array.from({ length: 365 }, (_, j) => {
      const date = addDays(t, j - 364);
      return { date, ...perfFor(date) };
    });

    const last7Rows = history365.slice(-7);
    const last30Rows = history365.slice(-30);
    const prev30Rows = history365.slice(-60, -30);
    const heatmap90 = history365.slice(-90).map((r) => ({ date: r.date, score: r.score }));

    const areaForRows = (rows) => {
      const start = rows[0]?.date || t;
      const end = rows[rows.length - 1]?.date || t;
      const count = Math.max(1, rows.length);

      return [
        { label: "Hábitos", value: avg(rows.map((r) => r.habitsPct)) },
        { label: "Tarefas", value: avg(rows.map((r) => r.tasksPct)) },
        {
          label: "Treino",
          value: Math.round(
            workoutSessions.filter((w) => w.completed && w.date >= start && w.date <= end).length /
            count * 100
          ),
        },
        {
          label: "Nutrição",
          value: Math.round(
            new Set(mealLog.filter((m) => m.date >= start && m.date <= end).map((m) => m.date)).size /
            count * 100
          ),
        },
        {
          label: "Metas",
          value: Math.round(
            new Set(goalProgressLog.filter((g) => g.date >= start && g.date <= end).map((g) => g.date)).size /
            count * 100
          ),
        },
      ].map((item) => ({ ...item, value: Math.max(0, Math.min(100, item.value)) }));
    };

    const areaPerformance = areaForRows(last30Rows);
    const areaPerformancePrev = areaForRows(prev30Rows);

    const aggregateChart = (rows, buckets) => {
      if (rows.length <= buckets) {
        return rows.map((r) => ({
          label: new Date(r.date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          value: r.score,
        }));
      }

      const bucketSize = Math.ceil(rows.length / buckets);
      const result = [];
      for (let i = 0; i < rows.length; i += bucketSize) {
        const part = rows.slice(i, i + bucketSize);
        if (!part.length) continue;
        const first = part[0].date;
        result.push({
          label: rows.length > 100
            ? new Date(first + "T00:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")
            : new Date(first + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          value: avg(part.map((r) => r.score)),
        });
      }
      return result;
    };

    const rangeCharts = {
      "7d": aggregateChart(history365.slice(-7), 7),
      "30d": aggregateChart(history365.slice(-30), 10),
      "90d": aggregateChart(history365.slice(-90), 12),
      "365d": aggregateChart(history365, 12),
    };

    const monthStart = startOfMonth(t);
    const currentMonthKey = t.slice(0, 7);
    const monthBalance = transactions
      .filter((tx) => String(tx.date || "").slice(0, 7) === currentMonthKey)
      .reduce((sum, tx) => sum + (tx.type === "entrada" ? Number(tx.value || 0) : -Number(tx.value || 0)), 0);

    const weekdayBuckets = WEEKDAYS.map((label, idx) => {
      const vals = history365.slice(-90).filter((d) => dayOfWeek(d.date) === idx).map((d) => d.score);
      return { label, vals, average: avg(vals) };
    });
    const orderedWeekdays = [...weekdayBuckets].sort((a, b) => b.average - a.average);
    const bestWeekdayInfo = orderedWeekdays[0] || { label: "—", average: 0 };

    const habitRates = habits.map((h) => {
      const relevant = history365.slice(-90).filter((d) => habitValidOnDate(h, d.date, completions));
      const done = relevant.filter((d) => completions.some((c) => c.habitId === h.id && c.date === d.date)).length;
      return { name: h.name, rate: relevant.length ? Math.round(done / relevant.length * 100) : 0 };
    }).sort((a, b) => b.rate - a.rate);

    const taskCompletionDates = [];
    tasks.forEach((task) => {
      if (isRecurringTask(task)) {
        (task.completionDates || []).forEach((date) => taskCompletionDates.push(date));
      } else if (task.status === "concluida") {
        taskCompletionDates.push(task.completedAt || task.dueDate || task.createdAt || t);
      }
    });
    const taskCountsByDate = taskCompletionDates.reduce((acc, date) => {
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});
    const maxTasksInDay = Math.max(0, ...Object.values(taskCountsByDate));

    const workoutDates = [...new Set(
      workoutSessions.filter((s) => s.completed).map((s) => s.date)
    )].sort();
    let workoutBestStreak = 0;
    let workoutRun = 0;
    let previousWorkoutDate = null;
    workoutDates.forEach((date) => {
      if (previousWorkoutDate && date === addDays(previousWorkoutDate, 1)) workoutRun += 1;
      else workoutRun = 1;
      workoutBestStreak = Math.max(workoutBestStreak, workoutRun);
      previousWorkoutDate = date;
    });

    const weekGroups = {};
    history365.forEach((row) => {
      const key = startOfWeek(row.date);
      if (!weekGroups[key]) weekGroups[key] = [];
      weekGroups[key].push(row.score);
    });
    const bestWeekAvg = Math.max(0, ...Object.values(weekGroups).map((rows) => avg(rows)));

    const monthGroups = {};
    history365.forEach((row) => {
      const key = row.date.slice(0, 7);
      if (!monthGroups[key]) monthGroups[key] = [];
      monthGroups[key].push(row.score);
    });
    const bestMonthAvg = Math.max(0, ...Object.values(monthGroups).map((rows) => avg(rows)));

    const weeklyWorkoutComparisons = Object.entries(weekGroups)
      .slice(-10)
      .map(([week, scores]) => {
        const weekEnd = addDays(week, 6);
        const workouts = workoutSessions.filter((w) => w.completed && w.date >= week && w.date <= weekEnd).length;
        return { workouts, score: avg(scores) };
      });
    const activeWeeks = weeklyWorkoutComparisons.filter((w) => w.workouts >= 3);
    const quietWeeks = weeklyWorkoutComparisons.filter((w) => w.workouts < 3);
    const workoutScoreDelta = activeWeeks.length && quietWeeks.length
      ? avg(activeWeeks.map((w) => w.score)) - avg(quietWeeks.map((w) => w.score))
      : null;

    const transactionMonths = {};
    transactions.forEach((tx) => {
      const key = String(tx.date || "").slice(0, 7);
      if (!key) return;
      if (!transactionMonths[key]) transactionMonths[key] = { entrada: 0, saida: 0, list: [] };
      transactionMonths[key][tx.type === "entrada" ? "entrada" : "saida"] += Number(tx.value || 0);
      transactionMonths[key].list.push(tx);
    });
    const sortedMonthKeys = Object.keys(transactionMonths).sort();
    const positiveMonthKeys = sortedMonthKeys.filter((key) => transactionMonths[key].entrada - transactionMonths[key].saida > 0);
    let positiveMonthStreak = 0;
    let positiveRun = 0;
    let prevPositive = null;
    positiveMonthKeys.forEach((key) => {
      const d = new Date(key + "-01T12:00:00");
      if (prevPositive) {
        const next = new Date(prevPositive);
        next.setMonth(next.getMonth() + 1);
        const expected = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
        positiveRun = expected === key ? positiveRun + 1 : 1;
      } else {
        positiveRun = 1;
      }
      positiveMonthStreak = Math.max(positiveMonthStreak, positiveRun);
      prevPositive = d;
    });

    const financeBudgets = profile?.financeBudgets || {};
    const configuredBudgets = Object.entries(financeBudgets).filter(([, value]) => Number(value) > 0);
    const monthsWithinBudget = configuredBudgets.length
      ? sortedMonthKeys.filter((key) =>
          configuredBudgets.every(([category, budget]) => {
            const spent = (transactionMonths[key]?.list || [])
              .filter((tx) => tx.type === "saida" && tx.category === category)
              .reduce((sum, tx) => sum + Number(tx.value || 0), 0);
            return spent <= Number(budget);
          })
        ).length
      : 0;

    const goalsDone = goals.filter((g) => g.completed).length;
    const financialGoals = goals.filter((g) => g.type === "financeira");
    const financialGoalsDone = financialGoals.filter((g) => g.completed).length;
    const financialGoalAccumulated = financialGoals.reduce((sum, g) => sum + Math.max(0, Number(g.current || 0)), 0);
    const goalsEarly = goals.filter((g) => g.completed && g.completedAt && g.endDate && g.completedAt < g.endDate).length;
    const tasksDone = taskCompletionDates.length;
    const workoutsDone = workoutSessions.filter((s) => s.completed).length;

    const weakestArea = [...areaPerformance].sort((a, b) => a.value - b.value)[0] || { label: "—", value: 0 };
    const strongestArea = [...areaPerformance].sort((a, b) => b.value - a.value)[0] || { label: "—", value: 0 };
    const monthDelta = avg(last30Rows.map((r) => r.score)) - avg(prev30Rows.map((r) => r.score));

    const insights = [
      bestWeekdayInfo.average > 0
        ? `Seu melhor dia tende a ser ${bestWeekdayInfo.label}, com score médio de ${bestWeekdayInfo.average}%.`
        : null,
      workoutScoreDelta !== null
        ? `Nas semanas com 3 ou mais treinos, seu score médio ficou ${Math.abs(workoutScoreDelta)} ponto${Math.abs(workoutScoreDelta) === 1 ? "" : "s"} ${workoutScoreDelta >= 0 ? "acima" : "abaixo"} das demais semanas.`
        : null,
      weakestArea.value < 70
        ? `${weakestArea.label} é a área que mais merece atenção agora (${weakestArea.value}%).`
        : `Seu desempenho está equilibrado; a área mais baixa é ${weakestArea.label}, com ${weakestArea.value}%.`,
      monthDelta !== 0
        ? `Seu score dos últimos 30 dias está ${Math.abs(monthDelta)} ponto${Math.abs(monthDelta) === 1 ? "" : "s"} ${monthDelta > 0 ? "acima" : "abaixo"} do período anterior.`
        : null,
      maxTasksInDay > 0
        ? `Seu recorde atual é de ${maxTasksInDay} tarefa${maxTasksInDay === 1 ? "" : "s"} concluída${maxTasksInDay === 1 ? "" : "s"} em um único dia.`
        : null,
    ].filter(Boolean);

    return {
      last7: last7Rows.map((r) => r.score),
      last14Chart: aggregateChart(history365.slice(-14), 14),
      rangeCharts,
      heatmap90,
      history365,
      areaPerformance,
      areaPerformancePrev,
      avg30: avg(last30Rows.map((r) => r.score)),
      prevAvg30: avg(prev30Rows.map((r) => r.score)),
      daysAbove80: last30Rows.filter((x) => x.score >= 80).length,
      monthDelta,
      bestWeekday: bestWeekdayInfo.label,
      bestWeekdayAverage: bestWeekdayInfo.average,
      bestHabit: habitRates[0]?.name || "—",
      bestHabitRate: habitRates[0]?.rate || 0,
      worstHabit: habitRates.length > 1 ? habitRates[habitRates.length - 1].name : (habitRates[0]?.name || "—"),
      worstHabitRate: habitRates.length ? habitRates[habitRates.length - 1].rate : 0,
      strongestArea,
      weakestArea,
      insights,
      highestDayScore: Math.max(0, ...history365.map((r) => r.score)),
      maxTasksInDay,
      workoutBestStreak,
      bestWeekAvg,
      bestMonthAvg,
      tasksDone,
      goalsDone,
      goalsEarly,
      habitCompletionsTotal: completions.length,
      bestStreak: habitStreaks.best,
      totalPerfectDays: habitStreaks.totalPerfectDays,
      workoutsDone,
      workoutsThisMonth: workoutSessions.filter((s) => s.completed && s.date >= monthStart).length,
      tasksThisMonth: taskCompletionDates.filter((date) => date >= monthStart).length,
      habitCompletionsThisMonth: completions.filter((c) => c.date >= monthStart).length,
      highScoreDaysThisMonth: history365.filter((r) => r.date >= monthStart && r.score >= 80).length,
      positiveBalance: monthBalance > 0,
      positiveMonths: positiveMonthKeys.length,
      positiveMonthStreak,
      monthsWithinBudget,
      financialGoalsDone,
      financialGoalAccumulated,
    };
  }, [habits, completions, tasks, goals, habitStreaks, workoutSessions, mealLog, goalProgressLog, transactions, profile]);

  const game = useMemo(() => {
    const t=today();
    const validHabitStepIds = new Set(habits.flatMap((h) => (h.checklist || []).map((item) => `${h.id}:${item.id}`)));
    const checklistXp = habitChecklistLog.filter((x) => x.done && validHabitStepIds.has(`${x.habitId}:${x.itemId}`)).length * 5 + goals.reduce((sum, g) => sum + (g.checklist || []).filter((x) => x.done).length * 10, 0);
    const milestoneXp = goals.reduce((sum, goal) => sum + goalMilestonesReached(goal) * 25, 0);
    const personalChallengeXp = (profile?.personalChallenges || []).filter((challenge) => challenge.completed).length * 100;
    const baseXp=computeXp(completions,tasks,workoutSessions,goals,habitStreaks) + checklistXp + milestoneXp + personalChallengeXp;
    const rank=rankForXp(baseXp), nextRank=nextRankForXp(baseXp), level=gameLevel(baseXp);
    const weekStart=startOfWeek(t);
    const dailyPerf=getDayPerformance(t,habits,completions,tasks,workoutSessions,mealLog,goalProgressLog);
    const weekWorkouts=workoutSessions.filter((w)=>w.completed&&w.date>=weekStart&&w.date<=t).length;
    const weekHighDays=Array.from({length:7},(_,i)=>addDays(weekStart,i)).filter((d)=>d<=t&&getDayPerformance(d,habits,completions,tasks,workoutSessions,mealLog,goalProgressLog).score>=80).length;
    const dayTasks=tasks.filter((x)=>taskOccursOnDate(x,t)); const dayTasksDone=dayTasks.filter((x)=>taskDoneOnDate(x,t)).length;
    const validHabits=habits.filter((h)=>habitValidOnDate(h,t,completions)); const doneIds=new Set(completions.filter((c)=>c.date===t).map((c)=>c.habitId)); const dayHabitsDone=validHabits.filter((h)=>doneIds.has(h.id)).length;
    const missions=[
      {id:'d-habits',title:'Domine seus hábitos',scope:'Diária',current:dayHabitsDone,target:Math.max(1,validHabits.length),xp:40,done:validHabits.length>0&&dayHabitsDone>=validHabits.length},
      {id:'d-score',title:'Atinja 80 de score',scope:'Diária',current:Math.min(80,dailyPerf.score),target:80,xp:30,done:dailyPerf.score>=80},
      {id:'w-workout',title:'Complete 3 treinos',scope:'Semanal',current:weekWorkouts,target:3,xp:100,done:weekWorkouts>=3},
      {id:'w-high',title:'Tenha 5 dias de alta performance',scope:'Semanal',current:weekHighDays,target:5,xp:120,done:weekHighDays>=5},
    ];
    const bonusXp=missions.filter((m)=>m.done).reduce((a,m)=>a+m.xp,0); const earnedXp=baseXp+bonusXp; const xp=Math.max(earnedXp,Number(profile?.xpFloor||0)); const actualRank=rankForXp(xp), actualNext=nextRankForXp(xp);
    const monthStart=startOfMonth(t); const seasonXp=completions.filter((c)=>c.date>=monthStart).length*10+tasks.filter((x)=>x.status==='concluida'&&(x.completedAt||x.dueDate)>=monthStart).length*20+workoutSessions.filter((w)=>w.completed&&w.date>=monthStart).length*50+goals.filter((g)=>g.completed&&(g.completedAt||t)>=monthStart).length*150;
    return {xp,earnedXp,level:gameLevel(xp),rank:actualRank,nextRank:actualNext,rankProgress:actualNext?pctBetween(xp,actualRank.min,actualNext.min):100,score:dailyPerf.score,missions,season:{name:`Temporada ${MONTHS[new Date().getMonth()]}`,xp:seasonXp}};
  }, [completions,tasks,workoutSessions,goals,habitStreaks,habits,mealLog,goalProgressLog,habitChecklistLog,profile?.personalChallenges,profile?.xpFloor]);

  // XP nunca diminui por exclusão/edição de um item histórico. O ledger remoto
  // registra eventos importantes e o xpFloor preserva a progressão já conquistada.
  useEffect(() => {
    if (!dataReady || !profile) return;
    const floor = Math.max(0, Number(profile?.xpFloor || 0));
    if (Number(game.earnedXp || 0) <= floor) return;
    setProfile((current) => ({ ...current, xpFloor: Number(game.earnedXp || 0) }));
  }, [dataReady, game.earnedXp, profile?.xpFloor]);

  // Registra o Service Worker e oferece ativação das notificações uma única vez por conta.
  useEffect(() => {
    if (!dataReady || !session?.user?.id) return;

    const supported =
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;

    setPushSupported(supported);
    setNotificationPermission(supported ? Notification.permission : "unsupported");

    if (!supported) return;

    ensureConstancceServiceWorker()
      .then(() => refreshPushState())
      .catch(() => {});

    const promptState = localStorage.getItem(`constancce_notification_prompt_${session.user.id}`);

    // O modal só aparece quando o navegador ainda não recebeu uma decisão.
    // Se já estiver "granted", nunca volta a prender o usuário.
    if (Notification.permission === "granted") {
      setShowNotificationPrompt(false);
      return;
    }

    if (Notification.permission === "denied") {
      setShowNotificationPrompt(false);
      return;
    }

    if (Notification.permission === "default" && !promptState) {
      const timer = window.setTimeout(() => setShowNotificationPrompt(true), 1200);
      return () => window.clearTimeout(timer);
    }
  }, [dataReady, session?.user?.id, refreshPushState]);

  // Quando o usuário toca/clica em uma notificação, abre a área correspondente do app.
  useEffect(() => {
    if (!dataReady || !session?.user?.id) return;

    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    const completeTaskId = params.get("completeTask");
    const snoozeTaskId = params.get("task");
    const snoozeMinutes = Number(params.get("snooze") || 0);

    if (requestedView && NAV.some((item) => item.id === requestedView)) {
      setView(requestedView);
    }

    if (completeTaskId) {
      setTaskStatus(completeTaskId, "concluida", today());
      fireToast("Tarefa concluída pela notificação.", <CheckCircle2 size={16} className="text-moss" />);
    }

    if (snoozeTaskId && snoozeMinutes > 0) {
      const until = new Date(Date.now() + snoozeMinutes * 60000).toISOString();
      setTasks((prev) => {
        const next = prev.map((task) => task.id === snoozeTaskId ? { ...task, snoozedUntil: until } : task);
        const changedTask = next.find((task) => task.id === snoozeTaskId);
        if (changedTask) commitTaskMutation(next, makeTaskUpsert(changedTask, taskRevisionRef.current?.[snoozeTaskId] || 0, newMutationId()));
        return next;
      });
      fireToast(`Tarefa adiada por ${snoozeMinutes} minutos.`, <Clock3 size={16} className="text-brass" />);
    }

    params.delete("view");
    params.delete("completeTask");
    params.delete("task");
    params.delete("snooze");
    const nextQuery = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`
    );
  }, [dataReady, session?.user?.id]);

  // Perfil competitivo público: apenas métricas de gamificação e identificação necessária aos amigos.
  useEffect(() => {
    if (!dataReady || !session?.user?.id || !profile || !SUPABASE_CONFIGURED) return;
    const timer = setTimeout(() => {
      upsertPublicProfile(session, {
        display_name: profile?.name || "Usuário",
        avatar_data_url: profile?.avatarDataUrl || null,
        level: Number(game.level || 1),
        rank_name: game.rank?.title || "Recruta",
        xp: Number(game.xp || 0),
        score: Number(game.score || 0),
        streak_current: Number(habitStreaks.current || 0),
        streak_best: Number(habitStreaks.best || 0),
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [dataReady, session, profile?.name, profile?.avatarDataUrl, game.level, game.xp, game.rank, game.score, habitStreaks.current, habitStreaks.best]);

  // achievement + record + day-complete celebrations
  useEffect(() => {
    if (habitStreaks.best > prevBest.current && prevBest.current > 0) fireToast("NOVO RECORDE", <Flame size={16} className="text-ember" />);
    prevBest.current = habitStreaks.best;
    const newlyUnlocked = ACHIEVEMENT_DEFS.filter((a) => !unlocked.includes(a.id) && a.check(stats));
    if (newlyUnlocked.length > 0) {
      setUnlocked((prev) => { const next = [...prev, ...newlyUnlocked.map((a) => a.id)]; persist({ unlocked: next }); return next; });
      fireToast(`MARCO DESBLOQUEADO — ${newlyUnlocked[0].label}`, <Award size={16} className="text-brass" />);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, habitStreaks]);

  const notifications = useMemo(() => {
    const t = today();
    const items = [];
    const validHabitsToday = habits.filter((h) => habitValidOnDate(h, t, completions));
    const doneIds = new Set(completions.filter((c) => c.date === t).map((c) => c.habitId));
    const pendingHabits = validHabitsToday.filter((h) => !doneIds.has(h.id)).length;
    if (pendingHabits > 0) items.push({ category: "habits", icon: <ListChecks size={16} className="text-brass" />, message: `Você ainda possui ${pendingHabits} hábito${pendingHabits > 1 ? "s" : ""} pendente${pendingHabits > 1 ? "s" : ""} hoje.` });
    const pendingTasks = tasks.filter((tk) => taskOccursOnDate(tk, t) && !taskDoneOnDate(tk, t)).length;
    if (pendingTasks > 0) items.push({ category: "tasks", icon: <CheckCircle2 size={16} className="text-brass" />, message: `${pendingTasks} tarefa${pendingTasks > 1 ? "s" : ""} aguardando para hoje.` });
    const overdue = tasks.filter((tk) => tk.status !== "concluida" && tk.dueDate < t).length;
    if (overdue > 0) items.push({ category: "tasks", icon: <CheckCircle2 size={16} className="text-ember" />, message: `${overdue} tarefa${overdue > 1 ? "s" : ""} atrasada${overdue > 1 ? "s" : ""}.` });
    if (workoutTemplates.length > 0 && !workoutSessions.some((s) => s.date === t && s.completed)) items.push({ category: "workouts", icon: <Dumbbell size={16} className="text-brass" />, message: "Seu treino está esperando por você." });
    if (habitStreaks.current > 0 && habitStreaks.current === habitStreaks.best && pendingHabits > 0) items.push({ category: "habits", icon: <Flame size={16} className="text-ember" />, message: "Você está a 1 dia de alcançar um novo recorde de dias perfeitos. Não deixe cair hoje." });
    goals.filter((g) => !g.completed && g.endDate).forEach((g) => {
      const daysLeft = Math.ceil((new Date(g.endDate) - new Date(t)) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 5) items.push({ category: "goals", icon: <Target size={16} className="text-brass" />, message: `Meta "${g.name}" vence em ${daysLeft} dia${daysLeft === 1 ? "" : "s"}.` });
    });
    const monthStart = startOfMonth(t);
    const monthOut = transactions.filter((tx) => tx.type === "saida" && tx.date >= monthStart).reduce((s, tx) => s + tx.value, 0);
    const limit = profile?.monthlyLimit || 3000;
    if (monthOut > limit) items.push({ category: "finance", icon: <Wallet size={16} className="text-ember" />, message: "Você ultrapassou o limite mensal de gastos." });
    return items;
  }, [habits, completions, tasks, workoutTemplates, workoutSessions, habitStreaks, goals, transactions, profile]);

  const [pendingPrescriptionCount, setPendingPrescriptionCount] = useState(0);
  useEffect(() => {
    if (!session?.user?.id) return;
    let active = true;
    fetchPrescriptions(session)
      .then((rows) => { if (active) setPendingPrescriptionCount((rows || []).filter((r) => r.status === "sent").length); })
      .catch(() => { if (active) setPendingPrescriptionCount(0); });
    return () => { active = false; };
  }, [session?.user?.id]);

  if (!authReady) {
    return <div className={`app-root ${theme === "light" ? "light-mode" : "dark-mode"}`}><div className="min-h-screen flex items-center justify-center"><div className="text-center"><img src={constancceLogo} alt="Constancce" className="w-10 h-10 rounded-xl mx-auto mb-3" /><p className="text-dim text-sm">Abrindo sua conta…</p></div></div></div>;
  }

  if (!session?.user) {
    return <div className={`app-root ${theme === "light" ? "light-mode" : "dark-mode"}`}><LoginView onAuthenticated={handleAuthenticated} /></div>;
  }

  if (session?.user && !accessReady) {
    return <div className={`app-root ${theme === "light" ? "light-mode" : "dark-mode"}`}><div className="min-h-screen flex items-center justify-center"><div className="text-center"><ShieldCheck size={28} className="text-moss mx-auto mb-3" /><p className="text-dim text-sm">Verificando seu acesso…</p></div></div></div>;
  }

  const accessInfo = planInfo;

  if (!dataReady) {
    return <div className={`app-root ${theme === "light" ? "light-mode" : "dark-mode"}`}><div className="min-h-screen flex items-center justify-center"><div className="text-center"><ShieldCheck size={28} className="text-moss mx-auto mb-3" /><p className="text-dim text-sm">Carregando seus dados…</p></div></div></div>;
  }

  if (!profile) {
    const finishOnboarding = (p) => {
      const baseProfile = {
        ...p,
        accentTheme: p.accentTheme || "green",
        onboarded: true,
        notificationSettings: { habits: true, tasks: true, workouts: true, goals: true, finance: true, hourlyReminders: true, weeklyReview: true },
      };
      setProfile(baseProfile);

      // O onboarding agora ensina sem preencher a conta automaticamente.
      // Os primeiros registros são criados pelo próprio usuário através do checklist “Comece por aqui”.
    };

    return <div className={`app-root ${theme === "light" ? "light-mode" : "dark-mode"}`}><Onboarding onDone={finishOnboarding} /></div>;
  }

  const handleQuickPick = (opt) => {
    setView(opt.view);
    if (opt.id === "expense") setQuickTrigger({ finance: "saida-" + Date.now() });
    else if (opt.id === "income") setQuickTrigger({ finance: "entrada-" + Date.now() });
    else setQuickTrigger({ [opt.view]: Date.now() });
  };

  const handleGettingStartedAction = (targetView) => {
    setView(targetView);
    setQuickTrigger({ [targetView]: Date.now() });
  };

  const defaultMenuOrder = NAV.map((item) => item.id);
  const savedMenuOrder = isPro && Array.isArray(profile?.menuOrder) && profile.menuOrder.length
    ? profile.menuOrder
    : defaultMenuOrder;
  const menuOrder = [
    ...savedMenuOrder.filter((id) => id !== "profile"),
    ...defaultMenuOrder.filter((id) => id !== "profile" && !savedMenuOrder.includes(id)),
    "profile",
  ];
  const orderedNav = [...NAV].sort((a, b) => {
    const ai = menuOrder.indexOf(a.id);
    const bi = menuOrder.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  const visibleNav = orderedNav.filter((item) => moduleEnabled(profile, item.id));
  const sidebarGroups = SIDEBAR_GROUPS
    .map((group) => ({
      ...group,
      items: group.ids
        .map((id) => NAV.find((item) => item.id === id))
        .filter(Boolean)
        .filter((item) => moduleEnabled(profile, item.id)),
    }))
    .filter((group) => group.items.length > 0);
  const visibleMobileMain = visibleNav.slice(0, 5).map((item) => item.id);
  const visibleMobileMore = visibleNav.slice(5);
  const mobileSwipeOrder = visibleNav.map((item) => item.id);
  const accentClass = `accent-${isPro ? (profile?.accentTheme || "green") : "green"}`;

  const handleMobileSwipeStart = (event) => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;
    const target = event.target;
    if (target?.closest?.("input, textarea, select, button, [data-no-swipe], .overflow-x-auto")) {
      mobileSwipeRef.current = null;
      return;
    }
    const touch = event.touches?.[0];
    if (!touch) return;
    mobileSwipeRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  };

  const handleMobileSwipeEnd = (event) => {
    const start = mobileSwipeRef.current;
    mobileSwipeRef.current = null;
    if (!start || typeof window === "undefined" || window.innerWidth >= 768) return;

    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 58 || Math.abs(dx) < Math.abs(dy) * 1.2 || Date.now() - start.at > 850) return;

    const currentIndex = mobileSwipeOrder.indexOf(view);
    if (currentIndex < 0) return;
    const nextIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextView = mobileSwipeOrder[nextIndex];
    if (nextView) {
      setView(nextView);
      setShowMore(false);
    }
  };

  const renderCurrentView = () => {
    switch (view) {
      case "dashboard": return <Dashboard profile={profile} setProfile={setProfile} habits={habits} completions={completions} tasks={tasks} toggleHabit={toggleHabit} streaks={usageStreaks} setView={setView} onQuickStart={handleGettingStartedAction} workoutTemplates={workoutTemplates} workoutSessions={workoutSessions} mealLog={mealLog} transactions={transactions} goals={goals} goalProgressLog={goalProgressLog} game={game} stats={stats} isPro={isPro} onUpgrade={requestPro} />;
      case "habits": return <HabitsView habits={habits} completions={completions} toggleHabit={toggleHabit} saveHabit={saveHabit} deleteHabit={deleteHabit} toggleActive={toggleActive} habitChecklistLog={habitChecklistLog} toggleHabitChecklist={toggleHabitChecklist} autoOpen={quickTrigger.habits} isPro={isPro} onUpgrade={requestPro} />;
      case "tasks": return <TasksView tasks={tasks} saveTask={saveTask} deleteTask={deleteTask} setStatus={setTaskStatus} moveTask={moveTaskKanban} autoOpen={quickTrigger.tasks} isPro={isPro} onUpgrade={requestPro} />;
      case "calendar": return <CalendarView habits={habits} completions={completions} tasks={tasks} saveTask={saveTask} setTaskStatus={setTaskStatus} workoutTemplates={workoutTemplates} workoutSessions={workoutSessions} saveWorkoutTemplate={saveWorkoutTemplate} scheduleWorkoutSession={scheduleWorkoutSession} goals={goals} profile={profile} setProfile={setProfile} isPro={isPro} onUpgrade={requestPro} />;
      case "goals": return <GoalsView goals={goals} saveGoal={saveGoal} addProgress={addGoalProgress} updateProgress={updateProgress} toggleGoalChecklist={toggleGoalChecklist} deleteGoal={deleteGoal} goalProgressLog={goalProgressLog} tasks={tasks} habits={habits} autoOpen={quickTrigger.goals} isPro={isPro} onUpgrade={requestPro} />;
      case "workouts": return <WorkoutsView session={session} templates={workoutTemplates} sessions={workoutSessions} saveTemplate={saveWorkoutTemplate} deleteTemplate={deleteWorkoutTemplate} reorderTemplates={reorderWorkoutTemplates} moveTemplateByStep={moveWorkoutTemplateByStep} startOrGetSession={startOrGetSession} toggleSet={toggleSet} toggleExercise={toggleExercise} updateLoad={updateWorkoutLoad} updateReps={updateWorkoutReps} updateSession={updateWorkoutSession} completeSession={completeSession} undoCompleteSession={undoCompleteSession} autoOpen={quickTrigger.workouts} isPro={isPro} onUpgrade={requestPro} restTimer={{ remaining: workoutRest.remaining, total: workoutRest.total, running: workoutRest.running }} onStartRest={workoutRest.start} onCancelRest={workoutRest.cancel} onAdjustRest={workoutRest.adjust} resumeSessionId={workoutResumeSessionId} onResumeHandled={() => setWorkoutResumeSessionId(null)} />;
      case "food": return <FoodView foodBase={dietFoodBase} foods={foods} mealLog={mealLog} addMeal={addMeal} updateMeal={updateMeal} toggleMealConsumed={toggleMealConsumed} deleteMeal={deleteMeal} deleteFood={deleteFood} profile={profile} setProfile={setProfile} session={session} autoOpen={quickTrigger.food} isPro={isPro} onUpgrade={requestPro} />;
      case "finance": return <FinanceView transactions={transactions} addTransaction={addTransaction} addGoalProgress={addGoalProgress} deleteTransaction={deleteTransaction} removeTransactionRecord={removeTransactionRecord} profile={profile} setProfile={setProfile} goals={goals} autoOpen={quickTrigger.finance} isPro={isPro} onUpgrade={requestPro} />;
      case "friends": return <FriendsView session={session} profile={profile} game={game} streaks={habitStreaks} isPro={isPro} onUpgrade={requestPro} />;
      case "professional": return <ProfessionalView session={session} profile={profile} setProfile={setProfile} isPro={isPro} onUpgrade={requestPro} saveWorkoutTemplate={saveWorkoutTemplate} />;
      case "progress": return <ProgressView streaks={habitStreaks} stats={stats} game={game} session={session} profile={profile} isPro={isPro} onUpgrade={requestPro} />;
      case "achievements": return <AchievementsView unlocked={unlocked} stats={stats} profile={profile} setProfile={setProfile} isPro={isPro} onUpgrade={requestPro} />;
      case "notifications": return <NotificationsView items={notifications} profile={profile} setProfile={setProfile} notificationPermission={notificationPermission} pushEnabled={pushEnabled} pushSupported={pushSupported} notificationBusy={notificationBusy} onEnableNotifications={handleEnableNotifications} onDisableNotifications={handleDisableNotifications} isPro={isPro} onUpgrade={requestPro} />;
      case "reports": return <ReportsView habits={habits} completions={completions} tasks={tasks} workoutSessions={workoutSessions} transactions={transactions} goals={goals} isPro={isPro} onUpgrade={requestPro} today={today} startOfMonth={startOfMonth} habitValidOnDate={habitValidOnDate} addDays={addDays} money={money} months={MONTHS} />;
      case "profile": return <ProfileView profile={profile} setProfile={setProfile} theme={theme} setTheme={setTheme} streaks={habitStreaks} stats={stats} lastSaved={lastSaved} syncStatus={syncStatus} genericHasPending={Boolean(pendingSyncRef.current)} taskSyncStatus={taskSyncStatus} taskSyncError={taskSyncError} session={session} user={session?.user} onLogout={handleLogout} onSyncNow={handleManualSync} onDeleteAccount={handleDeleteAccount} installPrompt={installPrompt} onInstallApp={async () => { if (!installPrompt) return; await installPrompt.prompt(); setInstallPrompt(null); }} access={access} accessInfo={accessInfo} isPro={isPro} onUpgrade={requestPro} onBuyLifetime={handleLifetimeCheckout} checkoutLoading={checkoutLoading} paymentMessage={paymentMessage} accessError={accessError} />;
      default: return null;
    }
  };

  return (
    <div className={`app-root app-authenticated-root ${theme === "light" ? "light-mode" : "dark-mode"} ${accentClass}`}>
      <div className="flex app-shell min-h-screen md:h-screen md:overflow-hidden">
        <aside className="sidebar hidden md:flex fixed left-0 top-0 bottom-0 z-30 flex-col w-64 h-screen p-5 gap-1.5 hairline overflow-y-auto scrollbar-none" style={{ borderRight: "1px solid var(--border)" }}>
          <div className="sidebar-brand flex items-center justify-center gap-2 px-2 mb-1 w-full text-center">
            <img src={constancceLogo} alt="" className="w-7 h-7 rounded-lg shrink-0" aria-hidden="true" />
            <span className="font-display text-xl tracking-tight">Constancce</span>
          </div>
          <div className="sidebar-account px-2 mb-4 min-w-0 w-full text-center">
            <p className="text-faint text-[10px] truncate text-center">{session?.user?.email}</p>
            <div className="flex justify-center mt-3">
              <button
                className="sidebar-plan-card inline-flex items-center justify-center gap-1.5 text-[10px] px-3 py-2 rounded-full text-center"
                style={{
                  background: "var(--surface-2)",
                  border: `1px solid ${accessInfo.isPro ? "color-mix(in srgb, var(--brass) 42%, var(--border))" : "var(--border)"}`,
                  color: accessInfo.isPro ? "var(--brass)" : "var(--text-dim)",
                }}
                onClick={() => !accessInfo.isPro && requestPro("intelligence")}
              >
                {accessInfo.isPro ? <Trophy size={12} /> : <Lock size={12} />}
                <span>{accessInfo.isLifetime ? "PRO Founder · Vitalício" : accessInfo.label}</span>
              </button>
            </div>
          </div>
          <button onClick={() => setShowCommandCenter(true)} className="nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left mb-1" style={{ background: "var(--surface-2)" }}>
            <Search size={16} /> Buscar
            <span className="ml-auto text-[9px] text-faint font-mono">⌘K</span>
          </button>
          {sidebarGroups.map((group) => (
            <div key={group.label} className="sidebar-nav-group">
              <p className="sidebar-group-label px-3 pt-2 pb-0.5 text-[9px] text-faint uppercase tracking-[.14em]">
                {group.label}
              </p>
              <div className="flex flex-col gap-1">
                {group.items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setView(n.id)}
                    className={`nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left relative ${view === n.id ? "active" : ""}`}
                    style={{ background: view === n.id ? "var(--surface-2)" : "transparent" }}
                  >
                    <n.icon size={16} />
                    {n.label}
                    {n.id === "notifications" && notifications.length > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-ember ml-auto" />
                    )}
                    {n.id === "professional" && pendingPrescriptionCount > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-ember ml-auto" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main
          ref={appMainRef}
          className="app-main flex-1 min-w-0 px-3 pt-1 md:ml-64 md:px-8 md:pt-8 pb-24 md:pb-10 w-full overflow-x-hidden md:h-screen md:overflow-y-auto"
          onTouchStart={handleMobileSwipeStart}
          onTouchEnd={handleMobileSwipeEnd}
        ><div className={`${view === "tasks" ? "max-w-[1280px]" : "max-w-4xl"} mx-auto`}>
          <div key={view} className="screen-in">
            <Suspense
              fallback={
                <div className="surface rounded-2xl p-6 text-center text-sm text-dim">
                  Carregando seção…
                </div>
              }
            >
              {renderCurrentView()}
            </Suspense>
          </div>
          </div>
        </main>
      </div>

      {workoutRest.running && (
        <button
          type="button"
          className="workout-global-rest"
          onClick={() => {
            if (workoutRest.timer?.sessionId) {
              setWorkoutResumeSessionId(workoutRest.timer.sessionId);
            }
            setView("workouts");
            setShowMore(false);
          }}
          aria-label={`Descanso em andamento. Faltam ${formatRestCountdown(workoutRest.remaining)}.`}
        >
          <span className="workout-global-rest-icon">
            <Timer size={16} />
          </span>
          <span className="min-w-0">
            <span className="workout-global-rest-label">Descanso</span>
            <span className="workout-global-rest-exercise">
              {workoutRest.timer?.exerciseName || "Treino em andamento"}
            </span>
          </span>
          <span className="workout-global-rest-time font-mono">
            {formatRestCountdown(workoutRest.remaining)}
          </span>
        </button>
      )}

      <nav
        className="mobile-nav md:hidden fixed bottom-0 left-0 right-0 surface grid items-stretch px-1.5 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] z-40"
        style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderBottom: "none", gridTemplateColumns: `repeat(${visibleMobileMain.length + 1}, minmax(0, 1fr))` }}
        aria-label="Navegação principal"
      >
        {visibleMobileMain.map((id) => {
          const n = NAV.find((x) => x.id === id);
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`nav-item mobile-nav-item min-w-0 w-full flex flex-col items-center justify-center gap-1 px-0.5 py-1.5 ${view === id ? "active" : ""}`}
            >
              <n.icon size={18} />
              <span className="mobile-nav-label truncate w-full text-center">{n.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setShowMore(true)}
          className={`nav-item mobile-nav-item min-w-0 w-full flex flex-col items-center justify-center gap-1 px-0.5 py-1.5 ${visibleMobileMore.some((item) => item.id === view) ? "active" : ""}`}
          aria-label="Mais opções"
        >
          <MoreHorizontal size={19} />
          <span className="mobile-nav-label">Mais</span>
        </button>
      </nav>

      {showMore && (
        <Modal title="Mais" onClose={() => setShowMore(false)} width={380}>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => { setShowCommandCenter(true); setShowMore(false); }} className="surface-2 rounded-xl p-3 flex flex-col items-center gap-1.5 text-xs">
              <Search size={18} className="text-brass" /> Buscar
            </button>
            {visibleMobileMore.map((n) => {
              const isCurrentMobileMore = view === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => { setView(n.id); setShowMore(false); }}
                  className={`mobile-more-card surface-2 rounded-xl p-3 flex flex-col items-center gap-1.5 text-xs relative ${isCurrentMobileMore ? "active" : ""}`}
                  aria-current={isCurrentMobileMore ? "page" : undefined}
                >
                  <n.icon size={18} className={isCurrentMobileMore ? "text-brass" : "text-dim"} />
                  <span className={isCurrentMobileMore ? "text-brass font-medium" : ""}>{n.label}</span>
                  {isCurrentMobileMore && <span className="mobile-more-current-dot" aria-hidden="true" />}
                  {n.id === "notifications" && notifications.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-ember absolute top-2 right-2" />}
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {showNotificationPrompt && (
        <NotificationPermissionPrompt
          busy={notificationBusy}
          onEnable={handleEnableNotifications}
          onLater={() => {
            setShowNotificationPrompt(false);
            if (session?.user?.id) {
              localStorage.setItem(`constancce_notification_prompt_${session.user.id}`, "later");
            }
          }}
        />
      )}

      <CommandCenter
        open={showCommandCenter}
        onClose={() => setShowCommandCenter(false)}
        onNavigate={setView}
        onQuickAction={handleQuickPick}
        habits={habits}
        tasks={tasks}
        goals={goals}
        workouts={workoutTemplates}
        transactions={transactions}
      />

      {workoutRest.finishedTimer && (
        <Modal
          title="Descanso finalizado"
          onClose={() => workoutRest.acknowledgeFinished()}
          width={430}
        >
          <div className="workout-rest-finished text-center">
            <div className="workout-rest-finished-icon mx-auto">
              <Timer size={24} />
            </div>
            <p className="font-display text-xl mt-3">Hora da próxima série.</p>
            <p className="text-sm text-dim mt-2 leading-relaxed">
              {workoutRest.finishedTimer.exerciseName
                ? `O descanso após “${workoutRest.finishedTimer.exerciseName}” terminou.`
                : "Seu tempo de descanso terminou."}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-5">
              <button
                className="btn-ghost rounded-xl py-2.5 text-sm"
                onClick={() => workoutRest.acknowledgeFinished()}
              >
                Entendi
              </button>
              <button
                className="btn-primary rounded-xl py-2.5 text-sm flex items-center justify-center gap-2"
                onClick={() => {
                  const sessionId = workoutRest.finishedTimer?.sessionId || null;
                  if (sessionId) setWorkoutResumeSessionId(sessionId);
                  workoutRest.acknowledgeFinished();
                  setView("workouts");
                  setShowMore(false);
                }}
              >
                <Dumbbell size={14} />
                Voltar ao treino
              </button>
            </div>
          </div>
        </Modal>
      )}

      {proRequest && !isPro && (
        <ProUpgradeModal
          request={proRequest}
          accessInfo={accessInfo}
          onClose={() => setProRequest(null)}
          onCheckout={handleLifetimeCheckout}
          checkoutLoading={checkoutLoading}
          onVerify={handleVerifyPayment}
          verifyLoading={verifyPaymentLoading}
          message={paymentMessage || accessError}
        />
      )}

      <Toast toast={toast} />
      {confirmDialog}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ConstancceApp />
    </ErrorBoundary>
  );
}
