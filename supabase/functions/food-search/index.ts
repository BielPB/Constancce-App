import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIdentity, consumeRateLimit, corsHeaders, getEnv, json, originAllowed, preflight, requireVerifiedUser } from "../_shared/security.ts";

const userAgent = "Constancce/1.0 (food-search)";

const numberOrZero = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const cleanName = (value: unknown) => String(value || "").trim();

const parseServing = (servingSize: unknown) => {
  const raw = cleanName(servingSize);
  if (!raw) return null;
  const match = raw.match(/([\d.,]+)\s*(g|ml)\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    label: raw.length <= 32 ? raw : `${amount}${match[2].toLowerCase()}`,
    amount,
  };
};

const productToFood = (product: Record<string, any>) => {
  const nutriments = product?.nutriments || {};
  const energyKcal = numberOrZero(
    nutriments["energy-kcal_100g"] ??
    nutriments["energy-kcal"] ??
    (numberOrZero(nutriments.energy_100g) > 0 ? numberOrZero(nutriments.energy_100g) / 4.184 : 0),
  );
  const protein = numberOrZero(nutriments.proteins_100g);
  const carbs = numberOrZero(nutriments.carbohydrates_100g);
  const fat = numberOrZero(nutriments.fat_100g);
  const fiber = numberOrZero(nutriments.fiber_100g);
  const sugar = numberOrZero(nutriments.sugars_100g);
  const sodiumMg = numberOrZero(nutriments.sodium_100g) * 1000;

  const name =
    cleanName(product.product_name_pt) ||
    cleanName(product.product_name) ||
    cleanName(product.generic_name_pt) ||
    cleanName(product.generic_name);

  if (!name) return null;
  if (energyKcal <= 0 && protein <= 0 && carbs <= 0 && fat <= 0) return null;

  const serving = parseServing(product.serving_size);
  const measures = [{ label: "100 g", amount: 100 }];
  if (serving && Math.abs(serving.amount - 100) > 0.1) measures.unshift(serving);

  return {
    id: `off-${product.code || crypto.randomUUID()}`,
    source: "openfoodfacts",
    sourceId: String(product.code || ""),
    barcode: String(product.code || ""),
    name,
    brand: cleanName(product.brands),
    baseQuantity: 100,
    unit: "g",
    calories: Math.round(energyKcal * 10) / 10,
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    fiber: Math.round(fiber * 10) / 10,
    sodium: Math.round(sodiumMg),
    sugar: Math.round(sugar * 10) / 10,
    measures,
    imageUrl: cleanName(product.image_front_small_url),
  };
};

const fetchJson = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`open_food_facts_${response.status}`);
  return data;
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
    if (!(await consumeRateLimit(admin, "food-search", clientIdentity(req, user.id), 45, 60))) {
      return json({ error: "too_many_requests" }, 429, { ...headers, "Retry-After": "60" });
    }

    const { data: access, error: accessError } = await admin
      .from("constancce_access")
      .select("plan,trial_ends_at,payment_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (accessError) {
      console.error("food-search access error", accessError);
      return Response.json({ error: "access_check_failed" }, { status: 503, headers });
    }

    const trialEnd = access?.trial_ends_at ? new Date(access.trial_ends_at).getTime() : NaN;
    const isPro =
      access?.plan === "lifetime" ||
      (access?.plan === "trial" &&
        access?.payment_status === "complimentary_trial" &&
        Number.isFinite(trialEnd) &&
        Date.now() < trialEnd);

    if (!isPro) {
      return Response.json({ error: "pro_required" }, { status: 403, headers });
    }

    const body = await req.json().catch(() => ({}));
    const barcode = String(body?.barcode || "").replace(/\D/g, "").slice(0, 32);
    const query = String(body?.query || "").trim().slice(0, 120);

    if (barcode) {
      if (barcode.length < 6) {
        return Response.json({ error: "invalid_barcode" }, { status: 400, headers });
      }

      const fields = [
        "code",
        "product_name",
        "product_name_pt",
        "generic_name",
        "generic_name_pt",
        "brands",
        "serving_size",
        "nutriments",
        "image_front_small_url",
      ].join(",");

      const data = await fetchJson(
        `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}?fields=${encodeURIComponent(fields)}`,
      );

      const food = productToFood(data?.product || data);
      return Response.json(
        { foods: food ? [food] : [] },
        { headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    if (query.length < 2) {
      return Response.json({ error: "query_too_short" }, { status: 400, headers });
    }

    // Open Food Facts currently uses its legacy full-text search endpoint for plain-text queries.
    const params = new URLSearchParams({
      search_terms: query,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: "18",
      lc: "pt",
      cc: "br",
      fields: [
        "code",
        "product_name",
        "product_name_pt",
        "generic_name",
        "generic_name_pt",
        "brands",
        "serving_size",
        "nutriments",
        "image_front_small_url",
      ].join(","),
    });

    const data = await fetchJson(`https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`);
    const foods = (Array.isArray(data?.products) ? data.products : [])
      .map(productToFood)
      .filter(Boolean)
      .slice(0, 15);

    return Response.json(
      { foods },
      { headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("food-search error", error);
    return Response.json(
      { error: "food_search_failed" },
      { status: 502, headers: { ...headers, "Content-Type": "application/json" } },
    );
  }
});
