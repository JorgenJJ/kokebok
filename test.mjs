// test.mjs — run with: node test.mjs
import { parseRecipe } from "./parser.mjs";

// --- Fixtures: OCR text split into columns (bullets kept as "*") -------------

const ramen = {
  title: "RAMEN",
  stamp: "NUDLER OG SUPPER · JAPAN",
  metaLine: "4–5 porsjoner    40 min (20 min til å bløtlegge soppen)",
  columns: [
    [ // ingredients column (left on this page)
      "* 600 g lårfilet av kylling",
      "* 3 ss olje til steking",
      "* 1 ts salt",
      "Kraft",
      "* 8 tørket shiitakesopp eller",
      "annen aromatisk sopp",
      "* 1 ½ dl vann",
      "* 25 g ingefær i strimler",
      "* 2 vårløk",
      "* 4 ss soyasaus",
      "* 2 ss kyllingbuljong",
      "* 2 ss mirin",
      "* ¼ ts salt",
      "Ramen-egg",
      "* 1 egg til hver porsjon",
      "* 1 ½ dl soyasaus",
      "* 1 dl mirin",
      "* 1 ss sake (kan sløyfes)",
      "Tilbehør",
      "* Ramen-nudler eller",
      "eggnudler",
      "* Ristede sesamfrø",
    ],
    [ // steps column (right)
      "1. Bløtlegg soppen i kokende vann i 20 minutter. Skyll den deretter",
      "i kaldt vann og klem ut vannet. Del soppen i skiver.",
      "2. Salt kyllingen og stek den i en stekepanne på middels høy varme",
      "i 5–6 minutter, snu den og stek videre i 3–4 minutter.",
      "3. Stek den hvite delen av vårløken sammen med ingefær i oljen",
      "fra kyllingen.",
      "4. Legg på lokk og la kraften koke på middels høy varme i ca. 10 minutter.",
      "5. Sil kraften forsiktig gjennom et dørslag. Server ramensuppen i dype",
      "boller med nudler nederst, toppet med kylling, egg, vårløk og sesamfrø.",
    ],
  ],
};

const sashimi = {
  title: "SASHIMISALAT",
  stamp: "SMÅRETTER · JAPAN",
  metaLine: "3–4 porsjoner    15 min",
  columns: [
    [ // steps column (LEFT on this page!)
      "1. Kutt opp alle ingrediensene til salaten. Skjær laksen i terninger",
      "på ca. 1 x 1 cm. Ha alt i en bolle.",
      "2. Bland sammen ingrediensene til ponzusausen og rør til",
      "sukkeret er oppløst.",
      "3. Varm opp en liten kjele eller stekepanne på middels høy varme.",
      "4. Sjekk om oljen er klar, ved å legge en liten bit av en rekechips oppi.",
      "5. Avhengig av hvor stor stekepannen din er, kan du steke 4–6 rekechips",
      "av gangen. De sveller når de stekes.",
      "6. Før servering heller du ponzusausen over salaten.",
    ],
    [ // ingredients column (RIGHT on this page!)
      "* 400 g laks av sushikvalitet",
      "i terninger",
      "* 1 avokado i terninger",
      "* 1 vårløk i ringer",
      "* ½ mango i terninger",
      "* 2 ss hakket rødløk",
      "* ½–1 hakket chili",
      "(kan sløyfes)",
      "Ponzu-saus",
      "* 2 ss soyasaus",
      "* 1 ½ ss kaldt vann",
      "* 1 ss sukker",
      "* 1 ss eddik",
      "* 1 ss limejuice",
      "* ½ ss sesamolje",
      "Tilbehør",
      "* Rekechips",
      "* Ristede sesamfrø",
    ],
  ],
};

const teriyaki = {
  title: "KYLLING TERIYAKI",
  stamp: "RIS- OG GRYTERETTER · JAPAN",
  metaLine: "4 porsjoner    30 min",
  columns: [
    [ // ingredients column (left)
      "* 900 g overlår eller lårfilet",
      "av kylling , ca. 8 lår",
      "* 1 brokkoli i buketter",
      "* Pepper",
      "Teriyakisaus",
      "* 1 fedd hakket hvitløk",
      "* 1 dl vann",
      "* 1 dl soyasaus",
      "* 2 ss brunt sukker",
      "* 2 ss flytende honning",
      "* 1 ss riseddik",
      "* 1 ss maisenna",
      "* ½ ts revet ingefær",
    ],
    [ // steps column (right)
      "1. Fileter bort beina i overlårene hvis du kjøper med bein.",
      "2. Brokkolien kan du koke, dampe eller steke som du ønsker.",
      "3. Varm en tørr panne på middels høy varme.",
      "4. La den steke til skinnet er gyllenbrunt og sprøtt, i ca. 6–7 minutter.",
      "5. Snu kyllingen og stek videre i ca. 2–3 minutter til.",
      "6. Ha sausen i pannen på fortsatt middels høy varme. Rør jevnt til den tykner.",
      "7. Server grønnsaker og ris, og topp gjerne med ekstra saus.",
    ],
  ],
};

// --- Expected results --------------------------------------------------------

const expected = {
  RAMEN: {
    cuisine: "Japansk", servings: "4–5", timeMinutes: 40,
    groups: { Hovedingredienser: 3, Kraft: 8, "Ramen-egg": 4, Tilbehør: 2 },
    steps: 5,
  },
  SASHIMISALAT: {
    cuisine: "Japansk", servings: "3–4", timeMinutes: 15,
    groups: { Hovedingredienser: 6, "Ponzu-saus": 6, Tilbehør: 2 },
    steps: 6,
  },
  "KYLLING TERIYAKI": {
    cuisine: "Japansk", servings: "4", timeMinutes: 30,
    groups: { Hovedingredienser: 3, Teriyakisaus: 8 },
    steps: 7,
  },
};

// --- Runner ------------------------------------------------------------------

const cases = [ramen, sashimi, teriyaki];
let pass = 0, fail = 0;
const fails = [];

function check(name, label, got, want) {
  const ok = got === want;
  if (ok) pass++; else { fail++; fails.push(`  ✗ [${name}] ${label}: fikk ${JSON.stringify(got)}, forventet ${JSON.stringify(want)}`); }
  return ok;
}

for (const c of cases) {
  const r = parseRecipe(c);
  const e = expected[r.title];
  console.log(`\n=== ${r.title} ===`);
  console.log(`kjøkken: ${r.cuisine} | porsjoner: ${r.servings} | tid: ${r.timeMinutes} min | steg: ${r.steps.length}`);
  for (const g of r.ingredientGroups) console.log(`  [${g.name}] (${g.items.length}): ${g.items.join(" | ")}`);

  check(r.title, "kjøkken", r.cuisine, e.cuisine);
  check(r.title, "porsjoner", r.servings, e.servings);
  check(r.title, "tid", r.timeMinutes, e.timeMinutes);
  check(r.title, "antall steg", r.steps.length, e.steps);

  const gotGroups = Object.fromEntries(r.ingredientGroups.map((g) => [g.name, g.items.length]));
  check(r.title, "gruppenavn", JSON.stringify(Object.keys(gotGroups)), JSON.stringify(Object.keys(e.groups)));
  for (const [gname, gcount] of Object.entries(e.groups)) {
    check(r.title, `gruppe «${gname}» antall`, gotGroups[gname], gcount);
  }
}

console.log("\n--------------------------------------------------");
console.log(`RESULTAT: ${pass} bestått, ${fail} feilet`);
if (fails.length) { console.log("\nFEIL:"); fails.forEach((f) => console.log(f)); }
else console.log("Alle tester bestått ✓");
