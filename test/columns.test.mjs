// columns.test.mjs — spaltedeling fra bbox-er, portert til node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitColumns } from "../js/columns.mjs";
import { parseRecipe } from "../js/parser.mjs";

const PAGE_W = 1000;

// Bygg syntetiske linjebokser for en side og STOKK dem (OCR garanterer ikke rekkefølge).
function makePage(leftLines, rightLines) {
  const boxes = [];
  leftLines.forEach((text, i) => boxes.push({ text, x0: 60, x1: 440, y0: 100 + i * 40, y1: 130 + i * 40 }));
  rightLines.forEach((text, i) => boxes.push({ text, x0: 560, x1: 940, y0: 100 + i * 40, y1: 130 + i * 40 }));
  for (let i = boxes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [boxes[i], boxes[j]] = [boxes[j], boxes[i]];
  }
  return boxes;
}

const ramenLeft = [
  "* 600 g lårfilet av kylling", "* 3 ss olje til steking", "* 1 ts salt",
  "Kraft", "* 8 tørket shiitakesopp eller", "annen aromatisk sopp", "* 1 ½ dl vann",
  "* 25 g ingefær i strimler", "* 2 vårløk", "* 4 ss soyasaus", "* 2 ss kyllingbuljong",
  "* 2 ss mirin", "* ¼ ts salt", "Ramen-egg", "* 1 egg til hver porsjon",
  "* 1 ½ dl soyasaus", "* 1 dl mirin", "* 1 ss sake (kan sløyfes)",
  "Tilbehør", "* Ramen-nudler eller", "eggnudler", "* Ristede sesamfrø",
];
const ramenRight = [
  "1. Bløtlegg soppen i kokende vann i 20 minutter.",
  "2. Salt kyllingen og stek den i en stekepanne.",
  "3. Stek den hvite delen av vårløken sammen med ingefær.",
  "4. Legg på lokk og la kraften koke i ca. 10 minutter.",
  "5. Sil kraften forsiktig gjennom et dørslag og server.",
];

const sashimiLeft = [
  "1. Kutt opp alle ingrediensene til salaten.",
  "2. Bland sammen ingrediensene til ponzusausen.",
  "3. Varm opp en liten kjele eller stekepanne.",
  "4. Sjekk om oljen er klar.",
  "5. Stek 4–6 rekechips av gangen.",
  "6. Før servering heller du ponzusausen over salaten.",
];
const sashimiRight = [
  "* 400 g laks av sushikvalitet", "i terninger", "* 1 avokado i terninger",
  "* 1 vårløk i ringer", "* ½ mango i terninger", "* 2 ss hakket rødløk",
  "* ½–1 hakket chili", "(kan sløyfes)",
  "Ponzu-saus", "* 2 ss soyasaus", "* 1 ½ ss kaldt vann", "* 1 ss sukker",
  "* 1 ss eddik", "* 1 ss limejuice", "* ½ ss sesamolje",
  "Tilbehør", "* Rekechips", "* Ristede sesamfrø",
];

test("RAMEN: bbox-spalter fra stokket rekkefølge", () => {
  const cols = splitColumns(makePage(ramenLeft, ramenRight), PAGE_W);
  assert.equal(cols.length, 2, "antall spalter");
  const r = parseRecipe({ title: "RAMEN", metaLine: "4–5 porsjoner 40 min", columns: cols });
  assert.deepEqual(r.ingredientGroups.map((g) => g.name), ["Hovedingredienser", "Kraft", "Ramen-egg", "Tilbehør"]);
  assert.equal(r.steps.length, 5, "antall steg");
  assert.equal(r.ingredientGroups.find((g) => g.name === "Kraft").items.length, 8, "Kraft-antall");
});

test("SASHIMI: omvendt layout (ingredienser til høyre)", () => {
  const cols = splitColumns(makePage(sashimiLeft, sashimiRight), PAGE_W);
  assert.equal(cols.length, 2, "antall spalter");
  const r = parseRecipe({ title: "SASHIMISALAT", metaLine: "3–4 porsjoner 15 min", columns: cols });
  assert.deepEqual(r.ingredientGroups.map((g) => g.name), ["Hovedingredienser", "Ponzu-saus", "Tilbehør"]);
  assert.equal(r.steps.length, 6, "antall steg");
  assert.equal(r.ingredientGroups[0].items.length, 6, "Hovedingredienser-antall");
});

test("én spalte når linjene ligger tett", () => {
  const boxes = ["a", "b", "c"].map((text, i) => ({ text, x0: 60, x1: 500, y0: i * 40, y1: 30 + i * 40 }));
  assert.equal(splitColumns(boxes, PAGE_W).length, 1);
});

test("tom side gir én tom spalte", () => {
  assert.deepEqual(splitColumns([], PAGE_W), [[]]);
});
