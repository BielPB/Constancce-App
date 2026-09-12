import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  ArrowRightLeft, BrainCircuit, Calendar as CalendarIcon, CheckCircle2, ChevronDown, ChevronUp,
  Circle, Copy, Dumbbell, GripVertical, Lock, Pencil, Play, Plus, RefreshCw, Repeat2, RotateCcw,
  Share2, Sparkles, Star, Stethoscope, Timer, Trash2, Trophy, Upload, X,
} from "lucide-react";
import {
  Modal, Field, EmptyState, Progress, ProLockCard, FirstVisitTip, MiniLineChart, useConfirm, usePrompt,
} from "../../components/ui.jsx";
import { PRO_LIMITS } from "../../lib/plans.js";
import { fetchProfessionalLinks, sendPrescription } from "../../lib/professionalLinks.js";
import WorkoutTemplateForm from "./WorkoutTemplateForm.jsx";

// Utilitários universais pequenos, copiados aqui de propósito (mesmo padrão já
// usado em src/features/professional/ProfessionalView.jsx para `uid`) — evita
// criar um import circular com App.jsx, que é quem carrega esta tela via lazy().
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
const weekdayIndex = (dateStr = today()) => new Date(dateStr + "T12:00:00").getDay();
const startOfWeek = (dateStr) => { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() - d.getDay()); return fmt(d); };
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const uid = () => Math.random().toString(36).slice(2, 10);
const dateLabel = (dateStr, options = { weekday: "short", day: "2-digit", month: "2-digit" }) => {
  if (!dateStr) return "—";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", options);
};
function proCutoffDate(days = PRO_LIMITS.historyDays) {
  return addDays(today(), -Math.max(0, Number(days) || 0));
}
const formatRestCountdown = (seconds = 0) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const min = Math.floor(safe / 60);
  const sec = String(safe % 60).padStart(2, "0");
  return `${min}:${sec}`;
};

// Dia da semana "efetivo" de um treino, considerando profile.workoutScheduleOffsetDays.
// Cópia exata da função homônima em App.jsx (usada também em Hoje/Calendário, que
// ficam lá) — os treinos continuam configurados por dia fixo da semana
// (scheduleDays), mas quando o usuário "puxa" o treino de ontem pra hoje, esse
// deslocamento aumenta em 1, deslizando a agenda inteira um dia pra frente.
function workoutEffectiveWeekday(dateStr, offsetDays) {
  const offset = Number(offsetDays) || 0;
  return weekdayIndex(offset ? addDays(dateStr, -offset) : dateStr);
}

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

// Quando o exercício é trocado só nesse treino (exerciseOverrides), o slot
// (exercise.id) continua o mesmo, mas o exercício de fato mudou — mostrar a
// carga anterior do slot antigo mostraria a carga de um exercício diferente
// com o nome novo. Busca por NOME em toda sessão/slot (considerando trocas
// anteriores), não pelo id do slot, pra achar a última carga já registrada
// para este exercício específico, não importa em qual treino/slot ele foi
// feito. Sem correspondência (nunca feito), retorna null — "deixa em branco".
const workoutLoadHistoryByName = (sessions, templates, exerciseName, beforeDate = null) => {
  const target = normalizeWorkoutExerciseName(exerciseName);
  if (!target) return null;
  const templateById = new Map((templates || []).map((tpl) => [tpl.id, tpl]));

  const matches = [];
  for (const session of sessions || []) {
    if (beforeDate && !(String(session.date || "") < beforeDate)) continue;
    const template = templateById.get(session.templateId);
    if (!template) continue;
    for (const exercise of template.exercises || []) {
      const effectiveName = session.exerciseOverrides?.[exercise.id] || exercise.name;
      if (normalizeWorkoutExerciseName(effectiveName) !== target) continue;
      const rawLoad = session.loads?.[exercise.id];
      if (rawLoad === "" || rawLoad == null || !Number.isFinite(Number(rawLoad))) continue;
      matches.push({
        date: session.date || "",
        stamp: session.completedAt || session.startedAt || "",
        load: Number(rawLoad),
      });
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    if (byDate !== 0) return byDate;
    return String(b.stamp).localeCompare(String(a.stamp));
  });
  return matches[0].load;
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
  profile,
  setProfile,
  templates,
  sessions,
  saveTemplate,
  deleteTemplate,
  reorderTemplates,
  moveTemplateByStep,
  startOrGetSession,
  scheduleWorkoutSession,
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
  const pullingWorkoutRef = useRef(false);
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
  // Uma sessão plannedOnly (pré-visualização, sem startedAt) não conta como "em
  // andamento" — o cronômetro só roda depois que o usuário confirma em "Iniciar agora".
  const workoutInProgress = Boolean(activeSession && !activeSession.completed && activeSession.startedAt);
  const sessionNotStarted = Boolean(activeSession && !activeSession.completed && !activeSession.startedAt);
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
  const workoutScheduleOffsetDays = Number(profile?.workoutScheduleOffsetDays || 0);
  const scheduledToday = templates.filter((template) =>
    (template.scheduleDays || []).includes(workoutEffectiveWeekday(t, workoutScheduleOffsetDays)) ||
    plannedTodayTemplateIds.has(template.id)
  );

  const yesterdayMissed = templates.filter((template) =>
    (template.scheduleDays || []).includes(workoutEffectiveWeekday(yesterday, workoutScheduleOffsetDays)) &&
    !sessions.some((session) =>
      session.templateId === template.id &&
      session.date === yesterday &&
      session.completed
    ) &&
    !sessions.some((session) =>
      session.templateId === template.id &&
      session.date === t
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
        (template.scheduleDays || []).includes(workoutEffectiveWeekday(selectedHistoryDate, workoutScheduleOffsetDays)) ||
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

  // Um treino de verdade em andamento (ou já concluído hoje) sempre tem prioridade
  // sobre o que estava agendado — se o usuário trocou de treino, é esse que importa
  // mostrar como "treino de hoje", mesmo que a agenda automática apontasse outro.
  const activeOrDoneTodayTemplate = templates.find((template) => {
    const session = sessions.find((row) => row.templateId === template.id && row.date === t);
    return session && (session.startedAt || session.completed);
  }) || null;
  // Sem um treino já em andamento/concluído, um treino selecionado manualmente na
  // lista (activeTemplateId) substitui o agendado enquanto essa seleção durar —
  // fechar a pré-visualização sem confirmar "Iniciar agora" volta a mostrar o
  // agendado, já que nada foi de fato assumido como o treino do dia.
  const manuallySelectedTodayTemplate = !activeOrDoneTodayTemplate && activeTemplateId
    ? templates.find((template) => template.id === activeTemplateId) || null
    : null;
  const primaryToday = activeOrDoneTodayTemplate || manuallySelectedTodayTemplate || scheduledToday[0] || null;
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

  // Selecionar um treino (da lista, do card "Hoje" ou de "Puxar pra hoje") abre a
  // pré-visualização e substitui o que aparece como "treino de hoje" — mas NÃO
  // inicia o cronômetro nem cria uma sessão de verdade ainda. scheduleWorkoutSession
  // cria (ou reaproveita, se já existir) uma sessão plannedOnly — sem startedAt —
  // pra só então o usuário confirmar em "Iniciar agora" que vai fazer esse treino.
  const openTodaySession = (template) => {
    setActiveSessionId(null);
    setActiveTemplateId(template.id);
    setSection("today");
    scheduleWorkoutSession(template.id, t, template);
  };

  // Puxa o treino perdido de ontem pra hoje e desliza a sequência inteira um dia pra
  // frente a partir de hoje (profile.workoutScheduleOffsetDays), já que os treinos são
  // agendados por dia fixo da semana — sem esse deslocamento, o treino de amanhã (no
  // calendário real) continuaria sendo o que já era esperado pra amanhã, duplicando ou
  // pulando um treino da rotação.
  const pullYesterdayWorkout = (template) => {
    // Sem essa trava, um duplo toque acidental (comum no mobile) incrementa
    // workoutScheduleOffsetDays duas vezes antes do primeiro re-render
    // remover o botão, deslocando a agenda 2 dias em vez de 1.
    if (pullingWorkoutRef.current) return;
    pullingWorkoutRef.current = true;
    window.setTimeout(() => { pullingWorkoutRef.current = false; }, 1000);

    openTodaySession(template);
    if (typeof setProfile === "function") {
      setProfile((current) => ({
        ...current,
        workoutScheduleOffsetDays: Number(current?.workoutScheduleOffsetDays || 0) + 1,
      }));
    }
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

  const sessionPrExerciseIds = useMemo(
    () => new Set(sessionPrs.map((exercise) => exercise.id)),
    [sessionPrs]
  );

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
                <p className="text-dim text-xs mt-0.5 flex items-center gap-2.5 flex-wrap">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 size={11} className="text-brass" /> feito
                  </span>
                  <span className="flex items-center gap-1">
                    <Circle size={11} className="text-brass" /> programado
                  </span>
                </p>
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
                  (template.scheduleDays || []).includes(workoutEffectiveWeekday(date, workoutScheduleOffsetDays))
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
                    <p className={`text-[10px] mt-1 ${done || scheduled ? "text-brass" : "text-faint"}`}>
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

          {workoutScheduleOffsetDays > 0 && (
            <div className="surface-2 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-[10px] md:text-xs text-dim">
                <RefreshCw size={11} className="inline mr-1 text-brass" />
                Sua rotação está deslocada {workoutScheduleOffsetDays} dia{workoutScheduleOffsetDays === 1 ? "" : "s"} pra frente por causa de um treino puxado.
              </p>
              <button
                className="btn-ghost rounded-lg px-2.5 py-1.5 text-[10px] md:text-xs shrink-0 self-start sm:self-auto"
                onClick={() => {
                  if (typeof setProfile === "function") {
                    setProfile((current) => ({ ...current, workoutScheduleOffsetDays: 0 }));
                  }
                }}
                title="Volta a agenda dos treinos para os dias da semana originais"
              >
                Voltar ao normal
              </button>
            </div>
          )}

          {primaryToday ? (
            <div className="workout-today-hero surface rounded-2xl p-4 md:p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] text-faint uppercase tracking-widest">Treino de hoje</p>
                    {primaryTodaySession?.completed && <span className="chip text-brass">Concluído</span>}
                    {primaryTodaySession && !primaryTodaySession.completed && primaryTodaySession.startedAt && <span className="chip text-brass">Em andamento</span>}
                    {primaryTodaySession && !primaryTodaySession.completed && !primaryTodaySession.startedAt && <span className="chip">Pré-visualização</span>}
                  </div>

                  <p className="font-display text-2xl mt-1 break-words">{primaryToday.name}</p>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="chip">{primaryToday.exercises.length} exercícios</span>
                    <span className="chip">{workoutTotalSetsCount(primaryToday)} séries</span>
                    {/* Não usa workoutSessionDurationMinutes aqui: esse helper exige uma
                        sessão real (com sets concluídos ou timestamps) e retorna 0 sem
                        ela, o que quebraria essa estimativa exibida antes/sem o treino
                        começar. Aqui é só uma projeção a partir do plano (série×2min). */}
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
                    : primaryTodaySession?.startedAt
                      ? "Continuar treino"
                      : primaryTodaySession
                        ? "Ver treino"
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
                onClick={() => pullYesterdayWorkout(yesterdayMissed[0])}
                title="Faz este treino hoje e empurra os próximos um dia pra frente, para não perder a ordem da sua rotação"
              >
                <Repeat2 size={13} /> Puxar pra hoje
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
                  className={`workout-template-card surface interactive rounded-2xl p-4 ${
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
                      {doneToday && <span className="chip text-brass whitespace-nowrap">feito hoje</span>}

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
                                  background: done ? "var(--brass)" : "var(--surface-2)",
                                  border: done ? "1px solid var(--brass)" : "1px solid var(--border)",
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
                    <div key={`${record.name}-${index}`} className="flex items-center gap-3 text-xs">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          background: "color-mix(in srgb, var(--brass) 16%, var(--surface-2))",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <Trophy size={14} className="text-brass" />
                      </div>
                      <span className="truncate flex-1">{record.name}</span>
                      <span className="text-right shrink-0">
                        <span
                          className="font-mono text-brass block"
                          title="Recorde pessoal — maior carga já registrada nesse exercício"
                        >
                          {record.load} kg
                        </span>
                        {record.oneRepMax > 0 && (
                          <span
                            className="font-mono text-faint text-[9px] block"
                            title="Estimativa de carga para 1 repetição máxima, calculada pela fórmula de Epley a partir da carga e repetições registradas"
                          >
                            ~{record.oneRepMax} kg 1RM est.
                          </span>
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
                    className="workout-history-card surface interactive rounded-2xl p-4 text-left w-full"
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
                            ? "color-mix(in srgb, var(--brass) 16%, var(--surface-2))"
                            : "var(--surface-2)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {session.completed
                          ? <CheckCircle2 size={18} className="text-brass" />
                          : <Dumbbell size={17} className="text-faint" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-display text-base break-words">{template?.name || "Treino"}</p>
                          <span className="chip whitespace-nowrap text-brass">
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
                          {session.completed && <span className="chip text-brass">Visualizar treino feito</span>}
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

              {sessionNotStarted && (
                <div className="workout-preview-cta flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-3 mb-3">
                  <div>
                    <p className="text-[9px] text-faint uppercase tracking-widest">Pré-visualização</p>
                    <p className="text-dim text-[11px] mt-0.5">Veja os exercícios e as cargas antes de começar. O cronômetro só conta a partir daqui.</p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary rounded-xl px-4 py-2.5 text-sm whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
                    onClick={() => startOrGetSession(activeTemplate.id)}
                  >
                    <Timer size={14} /> Iniciar agora
                  </button>
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
                    {restTimer.running ? formatRestCountdown(restTimer.remaining) : "—"}
                  </p>
                </div>
              </div>

              {restTimer.running && (
                <div className="workout-rest-active mt-3 pt-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-[9px] text-faint uppercase tracking-widest">Descansando</p>
                    <p className="font-mono text-2xl text-brass">{formatRestCountdown(restTimer.remaining)}</p>
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
                    <div className="flex items-center gap-2 text-brass">
                      <CheckCircle2 size={17} />
                      <p className="text-sm font-medium">Treino concluído</p>
                    </div>
                    <p className="text-dim text-xs mt-1">
                      {sessionSummary?.doneSets || 0} séries · {Math.round(sessionSummary?.volume || 0).toLocaleString("pt-BR")} kg de volume
                      {sessionSummary?.duration ? ` · ${sessionSummary.duration} min` : ""}
                    </p>
                  </div>
                  {sessionPrs.length > 0 && (
                    <span
                      className="chip text-brass"
                      title="PR = recorde pessoal: maior carga já registrada nesse exercício"
                    >
                      {sessionPrs.length} PR
                    </span>
                  )}
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
              const isSwapped = Boolean(activeSession.exerciseOverrides?.[exercise.id]);
              const displayName = activeSession.exerciseOverrides?.[exercise.id] || exercise.name;

              // Exercício trocado só neste treino: o slot (exercise.id) continua o
              // mesmo, mas passou a representar outro exercício. Buscar a carga
              // anterior pelo NOME (em qualquer sessão/slot) em vez de pelo slot
              // evita mostrar a carga do exercício antigo com o nome novo. Sem
              // registro anterior para este nome, fica em branco (null).
              const previousLoad = isSwapped
                ? workoutLoadHistoryByName(sessions, templates, displayName, activeSession.date)
                : workoutPreviousExerciseLoad(sessions, activeTemplate.id, exercise.id, activeSession.date);
              const currentLoad = Number(
                activeSession.loads?.[exercise.id] ??
                (isSwapped ? previousLoad : exercise.load) ??
                0
              );

              // PR já foi calculado uma vez em sessionPrs (evita chamar
              // workoutHistoricalMaxLoad de novo para cada exercício no render).
              const isPr = sessionPrExerciseIds.has(exercise.id);

              // Sugestão de progressão compara as 2 últimas sessões deste SLOT —
              // depois de uma troca, essas sessões são de um exercício diferente,
              // então não faz sentido sugerir progressão com base nelas.
              const lastTwo = isSwapped ? [] : [...sessions]
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
                        disabled={activeSession.completed || sessionNotStarted}
                        onClick={() => toggleExercise(activeSession.id, exercise.id, exercise.sets)}
                        aria-label={`Marcar ${displayName} como concluído`}
                      >
                        {(activeSession.sets?.[exercise.id] || []).length === exercise.sets &&
                        (activeSession.sets?.[exercise.id] || []).every(Boolean)
                          ? <CheckCircle2 size={18} className="text-brass" />
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
                          {isPr && (
                            <span
                              className="chip text-brass"
                              title="Recorde pessoal — maior carga já registrada nesse exercício"
                            >
                              PR
                            </span>
                          )}
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
                        value={activeSession.loads?.[exercise.id] ?? (isSwapped ? (previousLoad ?? "") : (exercise.load ?? ""))}
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
                          : (!isSwapped && exercise.load)
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
                            disabled={activeSession.completed || sessionNotStarted}
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
                              background: on ? "var(--brass)" : "transparent",
                              border: "1px solid var(--border)",
                              color: on ? "var(--brass-ink)" : "var(--text-dim)",
                            }}
                          >
                            {setIndex + 1}
                          </button>
                          {on && (
                            <WorkoutRepsInput
                              value={repsValue}
                              disabled={activeSession.completed || sessionNotStarted}
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
                  disabled={activeSession.completed || sessionNotStarted}
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
            ) : sessionNotStarted ? (
              <button
                type="button"
                className="btn-primary w-full rounded-xl py-3 flex items-center justify-center gap-2"
                onClick={() => startOrGetSession(activeTemplate.id)}
              >
                <Timer size={14} /> Iniciar agora
              </button>
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
                      <span className="chip text-brass">
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

export default WorkoutsView;
