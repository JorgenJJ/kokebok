// layout.test.mjs — bildeparsing nivå 1: syntetiske linjebokser -> layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLayout, linesFromText, linesFromTesseract, linesFromWords,
  findGutter, mergeLayouts, averageConfidence,
} from "../js/layout.mjs";
import { parseRecipe } from "../js/parser.mjs";

const PAGE = { width: 1000, height: 1400 };

function box(text, { x0, x1, y0, h = 30 }) {
  return { text, x0, x1, y0, y1: y0 + h, h };
}

/** To-spaltet side med tittel og metalinje øverst. */
function page({ title = "RAMEN", meta = "4–5 porsjoner · 40 min", left = [], right = [], mirrored = false } = {}) {
  const lines = [];
  if (title) lines.push(box(title, { x0: 80, x1: 520, y0: 60, h: 70 }));
  if (meta) lines.push(box(meta, { x0: 80, x1: 420, y0: 170, h: 24 }));
  const colA = mirrored ? { x0: 540, x1: 940 } : { x0: 60, x1: 460 };
  const colB = mirrored ? { x0: 60, x1: 460 } : { x0: 540, x1: 940 };
  left.forEach((t, i) => lines.push(box(t, { ...colA, y0: 300 + i * 40 })));
  right.forEach((t, i) => lines.push(box(t, { ...colB, y0: 300 + i * 40 })));
  // OCR gir ikke garantert rekkefølge
  return lines.sort(() => Math.random() - 0.5);
}

const ING = ["* 600 g kylling", "* 2 ss soyasaus", "Kraft", "* 2 dl vann", "* 2 ss mirin"];
const STEG = [
  "1. Bløtlegg soppen i kokende vann i 20 minutter.",
  "2. Stek kyllingen i 5 minutter.",
  "3. Server med nudler.",
];

test("tittel = høyeste linje i øverste tredjedel", () => {
  const l = extractLayout(page({ left: ING, right: STEG }), PAGE);
  assert.equal(l.title, "RAMEN");
});

test("metalinje plukkes fra toppen", () => {
  const l = extractLayout(page({ left: ING, right: STEG }), PAGE);
  assert.equal(l.metaLine, "4–5 porsjoner · 40 min");
});

test("felle: et steg med «20 minutter» blir ikke metalinje (F2)", () => {
  const lines = page({ meta: "", left: ING, right: STEG });
  const l = extractLayout(lines, PAGE);
  assert.equal(l.metaLine, "");
  const r = parseRecipe(l);
  assert.equal(r.steps.length, 3, "steget skal fortsatt være med i fremgangsmåten");
  assert.match(r.steps[0], /Bløtlegg soppen/);
});

test("kroppslinjer filtreres på identitet, ikke tekstlikhet (F3)", () => {
  // «* 1 ts salt» finnes to ganger på siden – begge skal overleve.
  const dup = ["* 1 ts salt", "* 1 ts salt", "* 2 dl vann"];
  const l = extractLayout(page({ left: dup, right: STEG }), PAGE);
  const r = parseRecipe(l);
  assert.equal(r.ingredientGroups[0].items.filter((i) => i === "1 ts salt").length, 2);
});

test("to spalter gjenkjennes, og speilvendt layout gir samme resultat", () => {
  const normal = parseRecipe(extractLayout(page({ left: ING, right: STEG }), PAGE));
  const mirrored = parseRecipe(extractLayout(page({ left: ING, right: STEG, mirrored: true }), PAGE));
  assert.equal(normal.steps.length, 3);
  assert.deepEqual(mirrored.steps, normal.steps);
  assert.deepEqual(
    mirrored.ingredientGroups.map((g) => g.name),
    normal.ingredientGroups.map((g) => g.name),
  );
});

test("én-spaltet side", () => {
  const lines = page({ left: [...ING, ...STEG], right: [] });
  const l = extractLayout(lines, PAGE);
  assert.equal(l.columns.length, 1);
  const r = parseRecipe(l);
  assert.equal(r.steps.length, 3);
  assert.equal(r.ingredientGroups.length, 2);
});

test("tom side gir tomt resultat uten å krasje", () => {
  const l = extractLayout([], PAGE);
  assert.deepEqual(l, { title: "", metaLine: "", columns: [[]], titleLine: null, metaLineBox: null });
  const r = parseRecipe(l);
  assert.deepEqual(r.steps, []);
  assert.deepEqual(r.ingredientGroups, []);
});

test("fallback uten bokser: rå tekst blir én spalte", () => {
  const text = ["RAMEN", "4 porsjoner 40 min", "* 2 dl vann", "1. Kok opp vannet."].join("\n");
  const l = extractLayout(linesFromText(text), { width: 1000, height: 4 });
  assert.equal(l.title, "RAMEN");
  assert.equal(l.metaLine, "4 porsjoner 40 min");
  const r = parseRecipe(l);
  assert.equal(r.servings, "4");
  assert.equal(r.timeMinutes, 40);
  assert.equal(r.steps.length, 1);
});

test("linesFromTesseract normaliserer bbox og faller tilbake til data.text", () => {
  const data = {
    lines: [{ text: "RAMEN\n", bbox: { x0: 10, x1: 200, y0: 5, y1: 60 }, confidence: 92 }],
    text: "ubrukt",
  };
  const lines = linesFromTesseract(data, PAGE);
  assert.equal(lines[0].text, "RAMEN");
  assert.equal(lines[0].h, 55);
  assert.equal(averageConfidence(lines), 92);

  const fallback = linesFromTesseract({ lines: [], text: "A\nB" }, PAGE);
  assert.equal(fallback.length, 2);
  assert.equal(averageConfidence(fallback), null);
});

// --- ordbokser: Tesseract limer ofte sammen to spalter til én «linje» -------

function words(text, { x, y, size = 26 }) {
  let cursor = x;
  return text.split(" ").map((t) => {
    const w = t.length * size * 0.55;
    const box = { text: t, bbox: { x0: cursor, x1: cursor + w, y0: y, y1: y + size } };
    cursor += w + size * 0.4;
    return box;
  });
}

test("findGutter finner kolonnegaten på en to-spaltet side", () => {
  const ws = [
    ...words("600 g kylling", { x: 60, y: 300 }),
    ...words("2 ss soyasaus", { x: 60, y: 350 }),
    ...words("1. Kok opp vannet", { x: 620, y: 300 }),
    ...words("2. Stek kyllingen godt", { x: 620, y: 350 }),
  ];
  const g = findGutter(ws.map((w) => w.bbox), 1000);
  assert.ok(g > 400 && g < 640, `fant gate på ${g}`);
});

test("findGutter gir null for én-spaltet side", () => {
  const ws = Array.from({ length: 10 }, (_, i) => words("en ganske lang linje med mange ord her", { x: 60, y: 300 + i * 40 })).flat();
  assert.equal(findGutter(ws.map((w) => w.bbox), 1000), null);
});

test("linesFromWords holder spaltene fra hverandre (ingen sammenlimte linjer)", () => {
  const ws = [
    ...words("600 g kylling", { x: 60, y: 600 }),
    ...words("1. Kok opp vannet", { x: 620, y: 602 }),
    ...words("2 ss soyasaus", { x: 60, y: 650 }),
    ...words("2. Stek kyllingen godt", { x: 620, y: 651 }),
  ];
  const lines = linesFromWords(ws, { width: 1000, height: 1400 });
  assert.deepEqual(lines.map((l) => l.text).sort(), [
    "1. Kok opp vannet", "2 ss soyasaus", "2. Stek kyllingen godt", "600 g kylling",
  ]);

  const r = parseRecipe(extractLayout(lines, { width: 1000, height: 1400 }));
  assert.equal(r.steps.length, 2);
  assert.deepEqual(r.ingredientGroups[0].items, ["600 g kylling", "2 ss soyasaus"]);
});

test("linesFromTesseract foretrekker ordbokser framfor sammenlimte linjer", () => {
  const data = {
    words: [
      ...words("600 g kylling", { x: 60, y: 600 }),
      ...words("1. Kok opp vannet", { x: 620, y: 600 }),
      ...words("2 ss soyasaus", { x: 60, y: 650 }),
      ...words("2. Stek kyllingen", { x: 620, y: 650 }),
    ].map((w) => ({ ...w, confidence: 90 })),
    lines: [{ text: "600 g kylling 1. Kok opp vannet", bbox: { x0: 60, x1: 940, y0: 600, y1: 630 } }],
  };
  const lines = linesFromTesseract(data, { width: 1000, height: 1400 });
  assert.equal(lines.length, 4);
  assert.equal(averageConfidence(lines), 90);
});

test("flersides skann flettes uten at side 2s steg blir ingredienser", () => {
  const p1 = extractLayout(page({ left: ING, right: STEG }), PAGE);
  const p2 = extractLayout(page({ title: "", meta: "", left: ["4. Topp med sesamfrø."], right: [] }), PAGE);
  const merged = mergeLayouts([p1, p2]);
  const r = parseRecipe(merged);
  assert.equal(r.title, "RAMEN");
  assert.equal(r.steps.length, 4);
  assert.match(r.steps[3], /sesamfrø/);
});
