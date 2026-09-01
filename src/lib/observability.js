const ERROR_KEY = "constancce_client_errors";
const MAX_ERRORS = 20;

const sanitizeDiagnosticText = (value, max = 1200) =>
  String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/https?:\/\/[^\s)]+/gi, "[url]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [token]")
    .slice(0, max);

const safeStorage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

export function captureClientError(error, context = {}) {
  const event = {
    id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    kind: "error",
    name: String(error?.name || "Error").slice(0, 120),
    message: sanitizeDiagnosticText(error?.message || error || "unknown_error", 360),
    stack: sanitizeDiagnosticText(error?.stack || "", 1600),
    context: {
      module: String(context?.module || "").slice(0, 80),
      action: String(context?.action || "").slice(0, 120),
    },
    createdAt: new Date().toISOString(),
  };
  console.error("[Constancce]", event.name, event.message, context);
  const current = safeStorage.get(ERROR_KEY);
  safeStorage.set(ERROR_KEY, [event, ...current].slice(0, MAX_ERRORS));
  return event;
}

export function consumeQueuedErrors() {
  const current = safeStorage.get(ERROR_KEY);
  safeStorage.set(ERROR_KEY, []);
  return current;
}

export async function sendTelemetry({ supabaseUrl, anonKey, session, events }) {
  if (!supabaseUrl || !anonKey || !session?.access_token || !Array.isArray(events) || !events.length) return false;
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/client-telemetry`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ events: events.slice(0, 50) }),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function analyticsEvent(name, properties = {}) {
  return {
    id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    kind: "analytics",
    name: String(name || "").slice(0, 120),
    properties,
    createdAt: new Date().toISOString(),
  };
}
