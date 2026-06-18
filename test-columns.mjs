// test-columns.mjs — run with: node test-columns.mjs
import { splitColumns } from "./columns.mjs";
import { parseRecipe } from "./parser.mjs";

const PAGE_W = 1000;

// Build synthetic line-boxes for a page given a left-column and right-column
// list of text lines, then SHUFFLE them (OCR doesn't guarantee order).
function makePage(leftLines, rightLines) {
  const boxes = [];
  leftLines.forEach((text, i) => boxes.push({ text, x0: 60, x1: 440, y0: 100 + i * 40, y1: 130 + i * 40 }));
  rightLines.forEach((text, i) => boxes.push({ text, x0: 560, x1: 940, y0: 100 + i * 40, y1: 130 + i * 40 }));
  // shuffle
  for (let i = boxes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [boxes[i], boxes[j]] = [boxes[j], boxes[i]];
  }
  return boxes;
}

// Ramen: ingredients LEFT, steps RIGHT
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

// Sashimi: steps LEFT, ingredients RIGHT (reversed layout!)
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

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "✓" : "✗"} ${label}` + (ok ? "" : ` (fikk ${JSON.stringify(got)})`));
  ok ? pass++ : fail++;
}

console.log("=== RAMEN: bbox-spalter fra stokket rekkefølge ===");
{
  const cols = splitColumns(makePage(ramenLeft, ramenRight), PAGE_W);
  eq("antall spalter", cols.length, 2);
  const r = parseRecipe({ title: "RAMEN", metaLine: "4–5 porsjoner 40 min", columns: cols });
  eq("gruppenavn", r.ingredientGroups.map((g) => g.name), ["Hovedingredienser", "Kraft", "Ramen-egg", "Tilbehør"]);
  eq("antall steg", r.steps.length, 5);
  eq("Kraft-antall", r.ingredientGroups.find((g) => g.name === "Kraft").items.length, 8);
}

console.log("\n=== SASHIMI: omvendt layout (ingredienser til høyre) ===");
{
  const cols = splitColumns(makePage(sashimiLeft, sashimiRight), PAGE_W);
  eq("antall spalter", cols.length, 2);
  const r = parseRecipe({ title: "SASHIMISALAT", metaLine: "3–4 porsjoner 15 min", columns: cols });
  eq("gruppenavn", r.ingredientGroups.map((g) => g.name), ["Hovedingredienser", "Ponzu-saus", "Tilbehør"]);
  eq("antall steg", r.steps.length, 6);
  eq("Hovedingredienser-antall", r.ingredientGroups[0].items.length, 6);
}

console.log("\n--------------------------------------------------");
console.log(`RESULTAT: ${pass} bestått, ${fail} feilet`);
