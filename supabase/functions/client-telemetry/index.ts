import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIdentity, consumeRateLimit, corsHeaders, getEnv, json, originAllowed, preflight, requireVerifiedUser } from "../_shared/security.ts";

const safeString = (value: unknown, max = 500) => String(value ?? "").slice(0, max);
const sanitizeProperties = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  Object.entries(value as Record<string, unknown>).slice(0, 20).forEach(([key, item]) => {
    if (item === null || ["string", "number", "boolean"].includes(typeof item)) {
      result[safeString(key, 80)] = typeof item === "string" ? safeString(item, 300) : item as number | boolean | null;
    }
  });
  return result;
};

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const headers = corsHeaders(req);
  if (!originAllowed(req)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  try {
    const { supabaseUrl, serviceRole } = getEnv();
    const { user, error: authError } = await requireVerifiedUser(req);
    if (!user) return json({ error: authError }, authError === "email_not_confirmed" ? 403 : 401, headers);
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    if (!(await consumeRateLimit(admin, "telemetry", clientIdentity(req, user.id), 30, 60))) {
      return json({ error: "too_many_requests" }, 429, { ...headers, "Retry-After": "60" });
    }
    const raw = await req.text();
    if (raw.length > 120_000) return json({ error: "payload_too_large" }, 413, headers);
    const body = JSON.parse(raw || "{}");
    const events = Array.isArray(body?.events) ? body.events.slice(0, 50) : [];
    if (!events.length) return json({ accepted: 0 }, 200, headers);
    const rows = events.map((event: Record<string, unknown>) => ({
      user_id: user.id,
      kind: event?.kind === "error" ? "error" : "analytics",
      event_name: safeString(event?.name || "unknown", 120),
      properties: {
        ...sanitizeProperties(event?.properties),
        ...(event?.kind === "error" ? {
          error_message: safeString(event?.message, 500),
          error_stack: safeString(event?.stack, 4000),
          error_module: safeString((event?.context as Record<string, unknown>)?.module, 80),
          error_action: safeString((event?.context as Record<string, unknown>)?.action, 120),
        } : {}),
      },
      client_created_at: event?.createdAt ? safeString(event.createdAt, 40) : null,
      app_version: "1.1.16",
    }));
    const { error } = await admin.from("constancce_events").insert(rows);
    if (error) return json({ error: "telemetry_insert_failed" }, 503, headers);
    return json({ accepted: rows.length }, 200, headers);
  } catch (error) {
    console.error("client-telemetry error", error);
    return json({ error: "telemetry_failed" }, 500, headers);
  }
});
