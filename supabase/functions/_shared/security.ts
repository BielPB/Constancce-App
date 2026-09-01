import { createClient } from "npm:@supabase/supabase-js@2";

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const normalizeOrigin = (value: string) => String(value || "").trim().replace(/\/$/, "");

// Origens oficiais controladas pelo Constancce. Mantemos o domínio legado da
// Vercel temporariamente para PWAs instalados antes da migração de domínio não
// perderem sincronização entre dispositivos. Nenhuma origem curinga é aceita.
const TRUSTED_CONSTANCCE_ORIGINS = [
  "https://constancceapp.com",
  "https://www.constancceapp.com",
  "https://app.constancceapp.com",
  "https://constancce-app.vercel.app",
];

export function allowedOrigins() {
  const configured = String(Deno.env.get("CONSTANCCE_ALLOWED_ORIGINS") || Deno.env.get("CONSTANCCE_APP_URL") || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  configured.push(...TRUSTED_CONSTANCCE_ORIGINS);
  if (Deno.env.get("ENVIRONMENT") !== "production") {
    configured.push("http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173");
  }
  return [...new Set(configured)];
}

export function corsHeaders(req: Request) {
  const origin = normalizeOrigin(req.headers.get("origin") || "");
  const allowed = allowedOrigins();
  const selected = origin && allowed.includes(origin) ? origin : (allowed[0] || "null");
  return {
    "Access-Control-Allow-Origin": selected,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export function originAllowed(req: Request) {
  const origin = normalizeOrigin(req.headers.get("origin") || "");
  if (!origin) return true; // server-to-server / native client
  return allowedOrigins().includes(origin);
}

export function preflight(req: Request) {
  if (req.method !== "OPTIONS") return null;
  if (!originAllowed(req)) return new Response("forbidden", { status: 403, headers: corsHeaders(req) });
  return new Response("ok", { headers: corsHeaders(req) });
}

export function getEnv() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRole) throw new Error("server_not_configured");
  return { supabaseUrl, anonKey, serviceRole };
}

export async function requireVerifiedUser(req: Request) {
  const { supabaseUrl, anonKey } = getEnv();
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return { user: null, error: "unauthorized" };

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  const user = data?.user || null;
  if (error || !user?.id) return { user: null, error: "unauthorized" };
  if (!user.email_confirmed_at) return { user: null, error: "email_not_confirmed" };
  return { user, error: null };
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function consumeRateLimit(
  admin: ReturnType<typeof createClient>,
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
) {
  const key = await sha256(`${scope}:${identity}`);
  const { data, error } = await admin.rpc("consume_constancce_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rate-limit error", error);
    return false;
  }
  return data === true;
}

export function clientIdentity(req: Request, userId = "") {
  const forwarded = String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const cf = String(req.headers.get("cf-connecting-ip") || "").trim();
  return userId || cf || forwarded || "unknown";
}

export function safeError(error: unknown) {
  console.error(error);
  return "internal_error";
}
