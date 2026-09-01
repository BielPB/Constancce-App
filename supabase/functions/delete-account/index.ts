import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIdentity, consumeRateLimit, corsHeaders, getEnv, json, originAllowed, preflight, requireVerifiedUser } from "../_shared/security.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const headers = corsHeaders(req);
  if (!originAllowed(req)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  try {
    const { supabaseUrl, serviceRole } = getEnv();
    const { user, error: authError } = await requireVerifiedUser(req);
    if (!user) return json({ error: authError }, authError === "email_not_confirmed" ? 403 : 401, headers);
    const raw = await req.text();
    if (raw.length > 10_000) return json({ error: "payload_too_large" }, 413, headers);
    const body = JSON.parse(raw || "{}");
    const password = String(body?.password || "");
    if (!password || password.length > 200) return json({ error: "reauth_required" }, 403, headers);

    // Exclusão é destrutiva: exige reautenticação real, não apenas um JWT roubado/antigo.
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const reauthClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { error: reauthError } = await reauthClient.auth.signInWithPassword({ email: user.email || "", password });
    if (reauthError) return json({ error: "reauth_failed" }, 403, headers);

    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    if (!(await consumeRateLimit(admin, "delete-account", clientIdentity(req, user.id), 3, 3600))) {
      return json({ error: "too_many_requests" }, 429, { ...headers, "Retry-After": "3600" });
    }

    await Promise.allSettled([
      admin.from("push_notification_log").delete().eq("user_id", user.id),
      admin.from("push_subscriptions").delete().eq("user_id", user.id),
      admin.from("constancce_domain_sync").delete().eq("user_id", user.id),
      admin.from("constancce_activity_events").delete().eq("user_id", user.id),
      admin.from("constancce_events").delete().eq("user_id", user.id),
      admin.from("constancce_checkout_sessions").delete().eq("user_id", user.id),
      admin.from("constancce_payment_events").delete().eq("user_id", user.id),
      admin.from("device_sync").delete().eq("user_id", user.id),
      admin.from("constancce_profiles").delete().eq("user_id", user.id),
      admin.from("constancce_friendships").delete().or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
    ]);

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("delete user failed", error);
      return json({ error: "delete_failed" }, 500, headers);
    }
    return json({ ok: true }, 200, headers);
  } catch (error) {
    console.error("delete-account", error);
    return json({ error: "internal_error" }, 500, headers);
  }
});
