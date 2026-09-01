const TACO_CSV_URL =
  "https://raw.githubusercontent.com/brolesi/taco/refs/heads/main/data/processed/taco/taco_composicao.csv";

const TACO_CACHE_KEY = "constancce_taco_food_base_v1";
const TACO_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const numberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  // Na TACO, 1e-05 representa "Tr" (traço).
  if (Math.abs(number) <= 0.00001) return 0;
  return number;
};

const round1 = (value) => {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value) * 10) / 10;
};

export function parseTacoCsv(text = "") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

const cleanDescription = (description = "") =>
  String(description)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

const makeAliases = (description = "") => {
  const parts = String(description)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return [];

  const aliases = new Set([
    parts.join(" "),
    parts[0],
    parts.slice(0, 2).join(" "),
    parts.filter((part) => !/^(cru|crua|cozido|cozida|assado|assada|frito|frita|grelhado|grelhada|refogado|refogada)$/i.test(part)).join(" "),
  ]);

  const joined = parts.join(" ").toLowerCase();

  if (joined.includes("mandioca") || joined.includes("aipim")) {
    aliases.add("macaxeira");
    aliases.add("aipim");
    aliases.add("mandioca");
  }
  if (joined.includes("tangerina")) {
    aliases.add("mexerica");
  }
  if (joined.includes("pão francês")) {
    aliases.add("pao");
    aliases.add("pão");
  }
  if (joined.includes("feijão")) {
    aliases.add("feijao");
    aliases.add("feijão");
  }
  if (joined.includes("cereais, milho, flocos") || joined.includes("milho flocos")) {
    aliases.add("flocão");
    aliases.add("flocao");
    aliases.add("cuscuz");
  }

  return [...aliases].filter(Boolean);
};

export function tacoRowsToFoods(rows = []) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const header = rows[0];
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const get = (row, key) => row[index[key]] ?? "";

  return rows
    .slice(1)
    .filter((row) => row?.length >= 5)
    .map((row) => {
      const id = String(get(row, "numero_alimento") || "").trim();
      const description = cleanDescription(get(row, "descricao"));
      const calories = numberOrNull(get(row, "energia_kcal"));

      if (!id || !description || calories === null) return null;

      return {
        id: `taco-${id}`,
        source: "taco",
        sourceId: `taco-${id}`,
        sourceLabel: "TACO 4ª ed. · NEPA/UNICAMP",
        category: String(get(row, "categoria") || "").trim(),
        name: description,
        aliases: makeAliases(description),
        baseQuantity: 100,
        unit: "g",
        calories: round1(calories),
        protein: round1(numberOrNull(get(row, "proteina_g"))),
        carbs: Math.max(0, round1(numberOrNull(get(row, "carboidrato_g")))),
        fat: Math.max(0, round1(numberOrNull(get(row, "lipideos_g")))),
        fiber: Math.max(0, round1(numberOrNull(get(row, "fibra_g")))),
        sodium: Math.max(0, Math.round(numberOrNull(get(row, "sodio_mg")) || 0)),
        // Açúcares totais não fazem parte da composição centesimal da TACO.
        sugar: null,
        sugarAvailable: false,
        measures: [{ label: "100 g", amount: 100 }],
      };
    })
    .filter(Boolean);
}

const readCache = () => {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(TACO_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.foods) || parsed.foods.length < 500) return null;

    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (foods) => {
  if (typeof window === "undefined" || !Array.isArray(foods) || foods.length < 500) return;

  try {
    localStorage.setItem(
      TACO_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        foods,
      })
    );
  } catch {
    // Se o navegador limitar storage, a base continua funcionando em memória.
  }
};

export async function loadTacoFoodBase({ forceRefresh = false } = {}) {
  const cached = readCache();

  if (
    !forceRefresh &&
    cached?.foods?.length >= 500 &&
    Date.now() - Number(cached.cachedAt || 0) < TACO_CACHE_MAX_AGE_MS
  ) {
    return cached.foods;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(TACO_CSV_URL, {
      method: "GET",
      cache: "force-cache",
      signal: controller.signal,
      headers: { Accept: "text/csv,text/plain,*/*" },
    });

    if (!response.ok) throw new Error(`taco_http_${response.status}`);

    const text = await response.text();
    const foods = tacoRowsToFoods(parseTacoCsv(text));

    if (foods.length < 500) throw new Error(`taco_incomplete_${foods.length}`);

    writeCache(foods);
    return foods;
  } catch (error) {
    if (cached?.foods?.length >= 500) return cached.foods;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export { TACO_CSV_URL };
