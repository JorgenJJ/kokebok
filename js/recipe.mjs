// recipe.mjs — RENT: datamodell, normalisering og migrering (schemaVersion 2).
// Holdes fri for DOM/IndexedDB slik at migreringen kan enhetstestes.

import { parseIngredient, scaleIngredient } from "./quantity.mjs";

export const SCHEMA_VERSION = 2;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

/** «rå» ingrediens (string eller objekt) -> { raw, qty, qtyMax, unit, name } */
export function normalizeItem(item) {
  if (item && typeof item === "object") {
    const raw = item.raw != null ? item.raw : item.name || "";
    const parsed = parseIngredient(raw);
    return {
      raw: parsed.raw,
      qty: item.qty !== undefined && item.qty !== null ? item.qty : parsed.qty,
      qtyMax: item.qtyMax !== undefined && item.qtyMax !== null ? item.qtyMax : parsed.qtyMax,
      unit: item.unit || parsed.unit,
      name: item.name && item.raw ? item.name : parsed.name,
    };
  }
  return parseIngredient(item);
}

export function normalizeGroups(groups) {
  return (groups || [])
    .map((g) => ({
      name: (g && g.name ? String(g.name) : "Ingredienser").trim() || "Ingredienser",
      items: ((g && g.items) || []).map(normalizeItem).filter((i) => i.raw),
    }))
    .filter((g) => g.items.length);
}

/**
 * Fyll ut en (eventuelt gammel) post til gjeldende skjema.
 * Migrering v1 -> v2: items løftes fra string til objekt, nye felter får
 * standardverdier, created -> createdAt.
 */
export function migrateRecipe(rec) {
  const r = rec || {};
  const createdAt = r.createdAt || r.created || Date.now();
  return {
    id: r.id || (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(createdAt)),
    schemaVersion: SCHEMA_VERSION,
    title: (r.title || "").trim(),
    cuisine: r.cuisine || "Ukjent",
    tags: Array.isArray(r.tags) ? r.tags.slice() : [],
    servings: r.servings == null ? "" : String(r.servings),
    timeMinutes: num(r.timeMinutes),
    ingredientGroups: normalizeGroups(r.ingredientGroups),
    steps: (r.steps || []).map((s) => String(s).trim()).filter(Boolean),
    photo: r.photo || null,
    favorite: !!r.favorite,
    createdAt,
    updatedAt: r.updatedAt || createdAt,
    source: {
      type: (r.source && r.source.type) || "scan",
      ocrConfidence: (r.source && r.source.ocrConfidence) ?? null,
    },
  };
}

/** Første tall i «4–5» – brukt som utgangspunkt for skalering. */
export function servingsNumber(servings) {
  const m = String(servings || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Ingrediensgrupper skalert med en faktor (uskalerbare linjer beholdes). */
export function scaleGroups(groups, factor) {
  return (groups || []).map((g) => ({
    name: g.name,
    items: (g.items || []).map((it) => scaleIngredient(it, factor)),
  }));
}

/** Fritekstsøk over tittel, kjøkken, tagger og ingredienser. */
export function matchesQuery(recipe, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    recipe.title, recipe.cuisine, (recipe.tags || []).join(" "),
    ...(recipe.ingredientGroups || []).flatMap((g) => [g.name, ...g.items.map((i) => i.raw || i)]),
  ].join("\n").toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export const SORTS = {
  nyeste: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  eldste: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
  tittel: (a, b) => (a.title || "").localeCompare(b.title || "", "nb"),
  tid: (a, b) => (a.timeMinutes ?? 1e9) - (b.timeMinutes ?? 1e9),
};

/** Filtrer + sorter et bibliotek. */
export function filterRecipes(recipes, { query = "", cuisine = "", maxTime = null, onlyFavorites = false, sort = "nyeste" } = {}) {
  const cmp = SORTS[sort] || SORTS.nyeste;
  return (recipes || [])
    .filter((r) => (!cuisine || r.cuisine === cuisine))
    .filter((r) => (!onlyFavorites || r.favorite))
    .filter((r) => (maxTime == null || (r.timeMinutes != null && r.timeMinutes <= maxTime)))
    .filter((r) => matchesQuery(r, query))
    .sort(cmp);
}

/** Bibliotek -> JSON-klar struktur (foto utelates som standard). */
export function toExport(recipes, { includePhotos = false } = {}) {
  return {
    format: "oppskriftsboka",
    version: SCHEMA_VERSION,
    exportedAt: Date.now(),
    recipes: recipes.map((r) => {
      const { photo, ...rest } = r;
      return includePhotos && photo ? { ...rest, photo } : rest;
    }),
  };
}

/** JSON -> liste med gyldige poster. Kaster ved ukjent format. */
export function fromExport(data) {
  if (!data || data.format !== "oppskriftsboka" || !Array.isArray(data.recipes)) {
    throw new Error("Ukjent filformat – forventet en eksport fra Oppskriftsboka.");
  }
  return data.recipes.map(migrateRecipe);
}
