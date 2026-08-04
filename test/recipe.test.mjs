// recipe.test.mjs — datamodell, migrering, søk/filtrering og eksport/import.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  migrateRecipe, normalizeGroups, filterRecipes, matchesQuery,
  toExport, fromExport, scaleGroups, servingsNumber, SCHEMA_VERSION,
} from "../js/recipe.mjs";

const v1 = {
  id: "abc",
  title: "  Ramen ",
  cuisine: "Japansk",
  servings: "4–5",
  timeMinutes: "40",
  ingredientGroups: [{ name: "Kraft", items: ["2 dl vann", "1 ½ dl soyasaus", ""] }],
  steps: ["Kok opp.", "  "],
  created: 1700000000000,
};

test("migrering v1 -> v2 løfter items til objekter og fyller nye felter", () => {
  const r = migrateRecipe(v1);
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.title, "Ramen");
  assert.equal(r.timeMinutes, 40);
  assert.equal(r.favorite, false);
  assert.deepEqual(r.tags, []);
  assert.equal(r.photo, null);
  assert.equal(r.createdAt, 1700000000000);
  assert.equal(r.updatedAt, 1700000000000);
  assert.deepEqual(r.source, { type: "scan", ocrConfidence: null });
  assert.equal(r.steps.length, 1);

  const item = r.ingredientGroups[0].items[1];
  assert.deepEqual(item, { raw: "1 ½ dl soyasaus", qty: 1.5, qtyMax: null, unit: "dl", name: "soyasaus" });
});

test("migrering er idempotent", () => {
  const once = migrateRecipe(v1);
  const twice = migrateRecipe(once);
  assert.deepEqual(twice, once);
});

test("tomme grupper og tomme linjer fjernes", () => {
  const groups = normalizeGroups([{ name: "Tom", items: ["", "   "] }, { name: "", items: ["2 egg"] }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Ingredienser");
});

const lib = [
  migrateRecipe({ id: "1", title: "Ramen", cuisine: "Japansk", timeMinutes: 40, created: 3, ingredientGroups: [{ name: "H", items: ["2 ss soyasaus"] }] }),
  migrateRecipe({ id: "2", title: "Pasta pesto", cuisine: "Italiensk", timeMinutes: 20, created: 2, favorite: true }),
  migrateRecipe({ id: "3", title: "Tacos", cuisine: "Meksikansk", timeMinutes: null, created: 1 }),
];

test("fritekstsøk treffer tittel og ingredienser", () => {
  assert.equal(matchesQuery(lib[0], "soyasaus"), true);
  assert.equal(matchesQuery(lib[0], "ramen soyasaus"), true);
  assert.equal(matchesQuery(lib[0], "pasta"), false);
  assert.equal(matchesQuery(lib[1], ""), true);
});

test("filtrering og sortering", () => {
  assert.deepEqual(filterRecipes(lib, {}).map((r) => r.id), ["1", "2", "3"]);
  assert.deepEqual(filterRecipes(lib, { sort: "tittel" }).map((r) => r.id), ["2", "1", "3"]);
  assert.deepEqual(filterRecipes(lib, { sort: "tid" }).map((r) => r.id), ["2", "1", "3"]);
  assert.deepEqual(filterRecipes(lib, { cuisine: "Japansk" }).map((r) => r.id), ["1"]);
  assert.deepEqual(filterRecipes(lib, { onlyFavorites: true }).map((r) => r.id), ["2"]);
  assert.deepEqual(filterRecipes(lib, { maxTime: 30 }).map((r) => r.id), ["2"]);
  assert.deepEqual(filterRecipes(lib, { query: "taco" }).map((r) => r.id), ["3"]);
});

test("skalering av ingrediensgrupper", () => {
  const groups = normalizeGroups([{ name: "Kraft", items: ["2 dl vann", "Salt etter smak"] }]);
  assert.deepEqual(scaleGroups(groups, 2)[0].items, ["4 dl vann", "Salt etter smak"]);
  assert.equal(servingsNumber("4–5"), 4);
  assert.equal(servingsNumber(""), null);
});

test("eksport -> import gir identisk bibliotek", () => {
  const data = JSON.parse(JSON.stringify(toExport(lib)));
  const back = fromExport(data);
  assert.deepEqual(back, lib);
});

test("import avviser ukjent format", () => {
  assert.throws(() => fromExport({ hello: "world" }), /Ukjent filformat/);
});
