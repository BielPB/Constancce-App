import { createClient } from "npm:@supabase/supabase-js@2";

const PRODUCT_CODE = "constancce_founder_lifetime";
const EXPECTED_AMOUNT = 37.90;
const EXPECTED_CURRENCY = "BRL";

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validateSignature(req: Request, dataId: string, secret: string) {
  const signature = req.headers.get("x-signature") || "";
  const requestId = req.headers.get("x-request-id") || "";
  const parts: Record<string, string> = {};
  for (const piece of signature.split(",")) {
    const [key, value] = piece.trim().split("=", 2);
    if (key && value) parts[key] = value;
  }
  const ts = parts.ts || "";
  const received = (parts.v1 || "").toLowerCase();
  if (!ts || !received || !requestId || !dataId) return false;

  const normalizedId = /[a-zA-Z]/.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${normalizedId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  return constantTimeEqual(bytesToHex(signed), received);
}

const response = (text: string, status = 200) => new Response(text, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return response("ok", 200);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
    const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET") || "";
    if (!supabaseUrl || !serviceRole || !mpAccessToken || !webhookSecret) return response("not configured", 500);

    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const dataId = String(url.searchParams.get("data.id") || body?.data?.id || "").slice(0, 100);
    const eventType = String(body?.type || url.searchParams.get("type") || "");
    if (eventType && eventType !== "payment") return response("ok", 200);
    if (!dataId) return response("ok", 200);

    if (!(await validateSignature(req, dataId, webhookSecret))) {
      return response("invalid signature", 401);
    }

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}`, Accept: "application/json" },
    });
    const payment = await paymentRes.json().catch(() => ({}));
    if (!paymentRes.ok) {
      console.error("payment lookup failed", { status: paymentRes.status, id: dataId });
      return response("payment lookup failed", 502);
    }

    const paymentId = String(payment?.id || dataId);
    const userId = String(payment?.external_reference || payment?.metadata?.user_id || "");
    const checkoutSessionId = String(payment?.metadata?.checkout_session_id || "");
    const product = String(payment?.metadata?.product || "");
    const amount = Number(payment?.transaction_amount || 0);
    const currency = String(payment?.currency_id || "");
    const status = String(payment?.status || "unknown");

    if (!userId || !checkoutSessionId || product !== PRODUCT_CODE || currency !== EXPECTED_CURRENCY || Math.abs(amount - EXPECTED_AMOUNT) > 0.001) {
      console.error("payment product mismatch", { paymentId, userId: Boolean(userId), checkoutSessionId: Boolean(checkoutSessionId), product, amount, currency });
      return response("payment not recognized", 400);
    }

    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const { data: checkout, error: checkoutError } = await admin
      .from("constancce_checkout_sessions")
      .select("id,user_id,product_code,amount,currency,preference_id,status")
      .eq("id", checkoutSessionId)
      .maybeSingle();

    if (checkoutError || !checkout || checkout.user_id !== userId || checkout.product_code !== PRODUCT_CODE || checkout.currency !== EXPECTED_CURRENCY || Math.abs(Number(checkout.amount) - EXPECTED_AMOUNT) > 0.001) {
      console.error("checkout session mismatch", { paymentId, checkoutSessionId });
      return response("checkout not recognized", 400);
    }

    const sanitizedPayload = {
      status,
      status_detail: String(payment?.status_detail || "").slice(0, 120),
      date_created: payment?.date_created || null,
      date_approved: payment?.date_approved || null,
      transaction_amount: amount,
      currency_id: currency,
      payment_method_id: String(payment?.payment_method_id || "").slice(0, 80),
    };

    await admin.from("constancce_payment_events").upsert({
      payment_id: paymentId,
      checkout_session_id: checkout.id,
      user_id: userId,
      preference_id: checkout.preference_id || null,
      status,
      amount,
      currency,
      payload: sanitizedPayload,
      updated_at: new Date().toISOString(),
    }, { onConflict: "payment_id" });

    await admin.from("constancce_checkout_sessions").update({
      payment_id: paymentId,
      status,
      updated_at: new Date().toISOString(),
    }).eq("id", checkout.id);

    if (status === "approved") {
      await admin.from("constancce_access").upsert({
        user_id: userId,
        plan: "lifetime",
        trial_started_at: null,
        trial_ends_at: null,
        payment_status: "approved",
        preference_id: checkout.preference_id || null,
        payment_id: paymentId,
        payment_amount: amount,
        purchased_at: payment?.date_approved || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    } else if (["refunded", "charged_back"].includes(status)) {
      // Revoga apenas se ESTE pagamento foi o que concedeu o vitalício.
      const { data: current } = await admin
        .from("constancce_access")
        .select("payment_id,payment_status")
        .eq("user_id", userId)
        .maybeSingle();
      if (String(current?.payment_id || "") === paymentId) {
        await admin.from("constancce_access").update({
          plan: "free",
          trial_started_at: null,
          trial_ends_at: null,
          payment_status: status,
          purchased_at: null,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
      }
    }

    return response("ok", 200);
  } catch (error) {
    console.error("mercadopago-webhook", error);
    return response("internal error", 500);
  }
});
