import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "constancce_workout_rest_";

const storageKey = (userId) => `${STORAGE_PREFIX}${userId || "anonymous"}`;

const safeTimer = (value) => {
  if (!value || typeof value !== "object") return null;

  const total = Math.max(30, Math.min(300, Number(value.total) || 90));
  const endAt = Number(value.endAt || 0);

  if (!Number.isFinite(endAt) || endAt <= 0) return null;

  return {
    id: String(value.id || `${endAt}`),
    status: value.status === "finished" ? "finished" : "running",
    total,
    startedAt: Number(value.startedAt || Math.max(0, endAt - total * 1000)),
    endAt,
    finishedAt: Number(value.finishedAt || 0) || null,
    sessionId: value.sessionId || null,
    templateId: value.templateId || null,
    exerciseId: value.exerciseId || null,
    exerciseName: String(value.exerciseName || "").slice(0, 120),
  };
};

const readTimer = (userId) => {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? safeTimer(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeTimer = (userId, value) => {
  if (!userId || typeof window === "undefined") return;
  try {
    if (!value) window.localStorage.removeItem(storageKey(userId));
    else window.localStorage.setItem(storageKey(userId), JSON.stringify(value));
  } catch {
    // O descanso continua em memória mesmo se o storage estiver indisponível.
  }
};

export function useWorkoutRestTimer(userId) {
  const [timer, setTimer] = useState(null);
  const [finishedTimer, setFinishedTimer] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const finish = useCallback((source) => {
    if (!source) return;
    const finished = {
      ...source,
      status: "finished",
      finishedAt: Date.now(),
    };
    setTimer(null);
    setFinishedTimer(finished);
    writeTimer(userId, finished);

    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([180, 80, 180]);
    }
  }, [userId]);

  useEffect(() => {
    setTimer(null);
    setFinishedTimer(null);
    setNow(Date.now());

    if (!userId) return;

    const stored = readTimer(userId);
    if (!stored) return;

    if (stored.status === "finished" || stored.endAt <= Date.now()) {
      const finished = {
        ...stored,
        status: "finished",
        finishedAt: stored.finishedAt || Date.now(),
      };
      setFinishedTimer(finished);
      writeTimer(userId, finished);
      return;
    }

    setTimer(stored);
  }, [userId]);

  useEffect(() => {
    if (!timer?.endAt) return;

    let stopped = false;

    const refresh = () => {
      if (stopped) return;
      const currentNow = Date.now();
      setNow(currentNow);

      if (currentNow >= timer.endAt) {
        stopped = true;
        finish(timer);
      }
    };

    refresh();

    const interval = window.setInterval(refresh, 500);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onFocus = () => refresh();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [timer?.id, timer?.endAt, finish]);

  const start = useCallback((seconds = 90, metadata = {}) => {
    const total = Math.max(30, Math.min(300, Number(seconds) || 90));
    const startedAt = Date.now();
    const next = {
      id: `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
      status: "running",
      total,
      startedAt,
      endAt: startedAt + total * 1000,
      finishedAt: null,
      sessionId: metadata.sessionId || null,
      templateId: metadata.templateId || null,
      exerciseId: metadata.exerciseId || null,
      exerciseName: String(metadata.exerciseName || "").slice(0, 120),
    };

    setFinishedTimer(null);
    setNow(startedAt);
    setTimer(next);
    writeTimer(userId, next);
    return next;
  }, [userId]);

  const cancel = useCallback(() => {
    setTimer(null);
    setFinishedTimer(null);
    writeTimer(userId, null);
  }, [userId]);

  const acknowledgeFinished = useCallback(() => {
    setFinishedTimer(null);
    writeTimer(userId, null);
  }, [userId]);

  const remaining = useMemo(() => {
    if (!timer?.endAt) return 0;
    return Math.max(0, Math.ceil((timer.endAt - now) / 1000));
  }, [timer?.endAt, now]);

  return {
    timer,
    finishedTimer,
    remaining,
    running: Boolean(timer && remaining > 0),
    total: Number(timer?.total || 0),
    start,
    cancel,
    acknowledgeFinished,
  };
}
