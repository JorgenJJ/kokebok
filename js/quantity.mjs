// quantity.mjs — RENT: én ingredienslinje -> { raw, qty, unit, name }.
// Brukes til porsjonsskalering og (senere) handleliste. Ingen DOM-avhengighet.

const VULGAR = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 1 / 3, "⅔": 2 / 3,
  "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
  "⅙": 1 / 6, "⅚": 5 / 6,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

// Kjente norske mål. Lengste først slik at «ss» ikke spiser «stk».
export const UNITS = [
  "kg", "hg", "g", "dl", "cl", "ml", "l",
  "ss", "ts", "krm", "stk", "fedd", "boks", "bokser", "pk", "pakke", "pakker",
  "never", "klype", "klyper", "porsjon", "porsjoner", "skive", "skiver",
  "kopp", "kopper", "bunt", "stilk", "stilker", "blad", "ark", "plate", "plater",
];

const DASH = "[-–—]";
const NUMWORD = `(?:\\d+(?:[.,]\\d+)?|[${Object.keys(VULGAR).join("")}])`;
// «1 ½», «1,5», «½», «1 1/2»
const AMOUNT = `${NUMWORD}(?:\\s*\\/\\s*\\d+)?(?:\\s+[${Object.keys(VULGAR).join("")}])?`;
const UNIT_RE = new RegExp(`^(?:${UNITS.join("|")})\\.?$`, "i");

const QTY_RE = new RegExp(`^\\s*(${AMOUNT})(?:\\s*${DASH}\\s*(${AMOUNT}))?\\s*`, "u");

/** «1 ½» / «1,5» / «½» / «1/2» -> tall. Returnerer null hvis ikke tall. */
export function parseAmount(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!s) return null;

  // brøk på formen «1/2» eller «1 1/2»
  const frac = s.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const whole = frac[1] ? parseInt(frac[1], 10) : 0;
    const den = parseInt(frac[3], 10);
    if (!den) return null;
    return whole + parseInt(frac[2], 10) / den;
  }

  let total = 0;
  let sawNumber = false;
  for (const part of s.split(/\s+/)) {
    if (part in VULGAR) { total += VULGAR[part]; sawNumber = true; continue; }
    const n = Number(part.replace(",", "."));
    if (Number.isFinite(n)) { total += n; sawNumber = true; continue; }
    return null; // ukjent token -> ikke en ren mengde
  }
  return sawNumber ? total : null;
}

/**
 * Del en ingredienslinje i mengde, enhet og navn.
 * «1 ½ dl soyasaus»  -> { qty: 1.5, qtyMax: null, unit: "dl", name: "soyasaus" }
 * «½–1 hakket chili» -> { qty: 0.5, qtyMax: 1, unit: null, name: "hakket chili" }
 * «Salt etter smak»  -> { qty: null, unit: null, name: "Salt etter smak" }
 */
export function parseIngredient(raw) {
  const line = String(raw == null ? "" : raw).trim();
  const out = { raw: line, qty: null, qtyMax: null, unit: null, name: line };
  if (!line) return out;

  const m = line.match(QTY_RE);
  if (!m) return out;

  const qty = parseAmount(m[1]);
  if (qty === null) return out;

  out.qty = qty;
  if (m[2]) {
    const hi = parseAmount(m[2]);
    if (hi !== null) out.qtyMax = hi;
  }

  let rest = line.slice(m[0].length).trim();
  const firstWord = rest.split(/\s+/)[0] || "";
  if (UNIT_RE.test(firstWord)) {
    out.unit = firstWord.replace(/\.$/, "").toLowerCase();
    rest = rest.slice(firstWord.length).trim();
  }
  out.name = rest || line;
  return out;
}

/** Pen visning av et tall: 1.5 -> «1 ½», 0.25 -> «¼», 2 -> «2». */
export function formatAmount(n) {
  if (n == null || !Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  const whole = Math.floor(rounded + 1e-9);
  const frac = rounded - whole;
  // Bare de vanlige brøkene brukes i visning – resten skrives som desimaltall.
  const PRETTY = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  const glyph = Object.entries(PRETTY).find(([, v]) => Math.abs(v - frac) < 0.02);
  if (glyph) {
    if (whole === 0) return glyph[0];
    return `${whole} ${glyph[0]}`;
  }
  if (Math.abs(frac) < 0.02) return String(whole);
  return String(rounded).replace(".", ",");
}

/** Skaler én ingredienslinje med en faktor. Uskalerbare linjer returneres uendret. */
export function scaleIngredient(item, factor) {
  const parsed = item && typeof item === "object" && "raw" in item ? item : parseIngredient(item);
  if (parsed.qty == null || !Number.isFinite(factor) || factor === 1) return parsed.raw;
  const lo = formatAmount(parsed.qty * factor);
  const hi = parsed.qtyMax == null ? null : formatAmount(parsed.qtyMax * factor);
  const amount = hi ? `${lo}–${hi}` : lo;
  return [amount, parsed.unit, parsed.name].filter(Boolean).join(" ");
}
