import { createClient } from "npm:@supabase/supabase-js@2";
import {
  clientIdentity,
  consumeRateLimit,
  corsHeaders,
  getEnv,
  json,
  originAllowed,
  preflight,
  requireVerifiedUser,
  safeError,
} from "../_shared/security.ts";

const PRODUCT = {
  code: "constancce_founder_lifetime",
  itemId: "constancce-founder-lifetime",
  title: "Constancce PRO Founder — Acesso Vitalício",
  description: "Constancce PRO vitalício. Pagamento único, sem mensalidade.",
  amount: 37.90,
  currency: "BRL",
};

function isMercadoPagoCheckoutUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (
      host === "mercadopago.com" || host.endsWith(".mercadopago.com") ||
      host === "mercadopago.com.br" || host.endsWith(".mercadopago.com.br")
    );
  } catch (_) {
    return false;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const headers = corsHeaders(req);
  if (!originAllowed(req)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);

  try {
    const { supabaseUrl, serviceRole } = getEnv();
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
    const configuredAppUrl = String(Deno.env.get("CONSTANCCE_APP_URL") || "").replace(/\/$/, "");
    if (!mpAccessToken || !configuredAppUrl) return json({ error: "payment_not_configured" }, 503, headers);

    const { user, error: authError } = await requireVerifiedUser(req);
    if (!user) return json({ error: authError }, authError === "email_not_confirmed" ? 403 : 401, headers);

    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const allowed = await consumeRateLimit(admin, "checkout", clientIdentity(req, user.id), 6, 600);
    if (!allowed) return json({ error: "too_many_requests" }, 429, { ...headers, "Retry-After": "600" });

    const { data: access, error: accessError } = await admin
      .from("constancce_access")
      .select("plan")
      .eq("user_id", user.id)
      .maybeSingle();
    if (accessError) return json({ error: "access_check_failed" }, 503, headers);
    if (access?.plan === "lifetime") return json({ error: "already_lifetime" }, 409, headers);

    const appUrl = new URL(configuredAppUrl);
    if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost") {
      return json({ error: "invalid_app_url" }, 500, headers);
    }

    const { data: checkout, error: checkoutError } = await admin
      .from("constancce_checkout_sessions")
      .insert({
        user_id: user.id,
        product_code: PRODUCT.code,
        amount: PRODUCT.amount,
        currency: PRODUCT.currency,
        status: "creating",
      })
      .select("id")
      .single();
    if (checkoutError || !checkout?.id) return json({ error: "checkout_session_failed" }, 503, headers);

    const preference = {
      items: [{
        id: PRODUCT.itemId,
        title: PRODUCT.title,
        description: PRODUCT.description,
        quantity: 1,
        currency_id: PRODUCT.currency,
        unit_price: PRODUCT.amount,
      }],
      payer: { email: user.email },
      external_reference: user.id,
      metadata: {
        user_id: user.id,
        product: PRODUCT.code,
        checkout_session_id: checkout.id,
      },
      back_urls: {
        success: `${configuredAppUrl}/?payment=approved`,
        failure: `${configuredAppUrl}/?payment=failure`,
        pending: `${configuredAppUrl}/?payment=pending`,
      },
      auto_return: "approved",
      notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook`,
      statement_descriptor: "CONSTANCCE",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": String(checkout.id),
      },
      body: JSON.stringify(preference),
    });
    const mpData = await mpRes.json().catch(() => ({}));

    if (!mpRes.ok || !mpData?.id || !isMercadoPagoCheckoutUrl(mpData?.init_point)) {
      console.error("Mercado Pago preference error", { status: mpRes.status, body: mpData });
      await admin.from("constancce_checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id);
      return json({ error: "payment_creation_failed" }, 502, headers);
    }

    await Promise.all([
      admin.from("constancce_checkout_sessions").update({
        preference_id: String(mpData.id),
        status: "pending",
        updated_at: new Date().toISOString(),
      }).eq("id", checkout.id),
      // Não muda payment_status aqui: um trial manual continua válido enquanto o usuário paga.
      admin.from("constancce_access").update({
        preference_id: String(mpData.id),
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id),
    ]);

    return json({
      preference_id: String(mpData.id),
      init_point: String(mpData.init_point),
    }, 200, headers);
  } catch (error) {
    safeError(error);
    return json({ error: "internal_error" }, 500, corsHeaders(req));
  }
});
