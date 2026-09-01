import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIdentity, consumeRateLimit, corsHeaders, getEnv, json, originAllowed, preflight, requireVerifiedUser } from "../_shared/security.ts";

const ALLOWED_EVENTS = new Set(["habit_completed", "task_completed", "workout_completed", "goal_completed"]);

const safeMetadata = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    if (item === null || ["string", "number", "boolean"].includes(typeof item)) {
      result[String(key).slice(0, 80)] = typeof item === "string" ? item.slice(0, 240) : item as number | boolean | null;
    }
  }
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
    if (!(await consumeRateLimit(admin, "activity-event", clientIdentity(req, user.id), 180, 60))) {
      return json({ error: "too_many_requests" }, 429, { ...headers, "Retry-After": "60" });
    }
    const raw = await req.text();
    if (raw.length > 20_000) return json({ error: "payload_too_large" }, 413, headers);
    const body = JSON.parse(raw || "{}");
    const eventType = String(body?.eventType || "").slice(0, 80);
    const eventKey = String(body?.eventKey || "").slice(0, 180);
    if (!ALLOWED_EVENTS.has(eventType) || !eventKey) return json({ error: "invalid_event" }, 400, headers);
    const { error } = await admin.from("constancce_activity_events").upsert({
      user_id: user.id,
      event_type: eventType,
      event_key: eventKey,
      occurred_at: new Date().toISOString(),
      metadata: safeMetadata(body?.metadata),
    }, { onConflict: "user_id,event_key", ignoreDuplicates: true });
    if (error) return json({ error: "activity_event_failed" }, 503, headers);
    return json({ accepted: true }, 200, headers);
  } catch (error) {
    console.error("activity-event error", error);
    return json({ error: "activity_event_failed" }, 500, headers);
  }
});
