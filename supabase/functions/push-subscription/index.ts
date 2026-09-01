import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIdentity, consumeRateLimit, corsHeaders, getEnv, json, originAllowed, preflight, requireVerifiedUser } from "../_shared/security.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const headers = corsHeaders(req);
  if (!originAllowed(req)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  try {
    const { supabaseUrl, serviceRole } = getEnv();
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const { user, error: authError } = await requireVerifiedUser(req);
    if (!user) return json({ error: authError }, authError === "email_not_confirmed" ? 403 : 401, headers);
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    if (!(await consumeRateLimit(admin, "push-subscription", clientIdentity(req, user.id), 30, 600))) {
      return json({ error: "too_many_requests" }, 429, { ...headers, "Retry-After": "600" });
    }
    const raw = await req.text();
    if (raw.length > 60_000) return json({ error: "payload_too_large" }, 413, headers);
    const body = JSON.parse(raw || "{}");
    const action = String(body?.action || "config");
    if (action === "config") {
      if (!vapidPublicKey) return json({ error: "vapid_not_configured" }, 500, headers);
      return json({ public_key: vapidPublicKey }, 200, headers);
    }
    if (action === "save") {
      const subscription = body?.subscription;
      const endpoint = String(subscription?.endpoint || "").slice(0, 2048);
      const p256dh = String(subscription?.keys?.p256dh || "").slice(0, 512);
      const auth = String(subscription?.keys?.auth || "").slice(0, 512);
      if (!endpoint.startsWith("https://") || !p256dh || !auth) return json({ error: "invalid_subscription" }, 400, headers);
      const timezone = String(body?.timezone || "UTC").slice(0, 80);
      const userAgent = String(body?.user_agent || "").slice(0, 300) || null;
      const { error } = await admin.from("push_subscriptions").upsert({
        user_id: user.id, endpoint, subscription, timezone, user_agent: userAgent,
        enabled: true, updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (error) return json({ error: "subscription_save_failed" }, 500, headers);
      return json({ ok: true }, 200, headers);
    }
    if (action === "remove") {
      const endpoint = String(body?.endpoint || "").slice(0, 2048);
      let query = admin.from("push_subscriptions").delete().eq("user_id", user.id);
      if (endpoint) query = query.eq("endpoint", endpoint);
      const { error } = await query;
      if (error) return json({ error: "subscription_remove_failed" }, 500, headers);
      return json({ ok: true }, 200, headers);
    }
    return json({ error: "invalid_action" }, 400, headers);
  } catch (error) {
    console.error("push-subscription", error);
    return json({ error: "internal_error" }, 500, headers);
  }
});
