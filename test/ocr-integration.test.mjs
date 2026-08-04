// ocr-integration.test.mjs — bildeparsing nivå 2: ekte OCR på en innsjekket
// PNG-fixtur, hele veien PNG -> OCR -> layout -> parser.
//
// Testen HOPPER OVER seg selv hvis tesseract.js eller de selv-hostede
// språkfilene mangler, slik at `npm test` alltid er grønn uten nett.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractLayout, linesFromTesseract } from "../js/layout.mjs";
import { parseRecipe } from "../js/parser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FIXTURE = path.join(HERE, "fixtures", "ramen.png");
const LANG_PATH = path.join(ROOT, "vendor", "tesseract");

async function loadTesseract() {
  if (!fs.existsSync(FIXTURE)) return null;
  if (!fs.existsSync(path.join(LANG_PATH, "nor.traineddata.gz"))) return null;
  try {
    return await import("tesseract.js");
  } catch (_) {
    return null;
  }
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9æøå]+/g, " ").trim();

test("PNG -> OCR -> layout -> parser gir strukturert oppskrift", async (t) => {
  const Tesseract = await loadTesseract();
  if (!Tesseract) {
    t.skip("tesseract.js eller språkfilene mangler – hopper over OCR-testen");
    return;
  }

  const worker = await Tesseract.createWorker("nor", 1, { langPath: LANG_PATH, gzip: true, cachePath: os.tmpdir() });
  let result;
  try {
    result = await worker.recognize(FIXTURE);
  } finally {
    await worker.terminate();
  }

  const lines = linesFromTesseract(result.data, { width: 1240, height: 1754 });
  assert.ok(lines.length > 10, "OCR fant for få linjer");

  const layout = extractLayout(lines, { width: 1240, height: 1754 });
  const recipe = parseRecipe(layout);

  assert.equal(norm(recipe.title), "ramen");
  assert.equal(recipe.servings, "4-5");
  assert.equal(recipe.timeMinutes, 40);
  assert.equal(recipe.cuisine, "Japansk");

  // OCR-støy: sammenlign normalisert og med rom for noen tegnfeil.
  assert.ok(recipe.steps.length >= 4 && recipe.steps.length <= 6, `fikk ${recipe.steps.length} steg`);
  assert.match(norm(recipe.steps[0]), /blotlegg soppen/);

  const items = recipe.ingredientGroups.flatMap((g) => g.items).map(norm);
  assert.ok(items.some((i) => /600 g/.test(i)), "fant ikke «600 g …»");
  assert.ok(
    recipe.ingredientGroups.some((g) => /kraft/i.test(g.name)),
    "fant ikke undergruppen «Kraft»",
  );
});
