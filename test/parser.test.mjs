// parser.test.mjs — de opprinnelige parser-testene, portert til node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecipe, parseServings, parseTime, guessCuisine, classifyColumns } from "../js/parser.mjs";

// --- Fixtures: OCR text split into columns (bullets kept as "*") -------------

const ramen = {
  title: "RAMEN",
  stamp: "NUDLER OG SUPPER · JAPAN",
  metaLine: "4–5 porsjoner    40 min (20 min til å bløtlegge soppen)",
  columns: [
    [
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
    [
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
    [
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
    [
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
    [
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
    [
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

for (const page of [ramen, sashimi, teriyaki]) {
  test(`parseRecipe: ${page.title}`, () => {
    const r = parseRecipe(page);
    const e = expected[r.title];

    assert.equal(r.cuisine, e.cuisine, "kjøkken");
    assert.equal(r.servings, e.servings, "porsjoner");
    assert.equal(r.timeMinutes, e.timeMinutes, "tid");
    assert.equal(r.steps.length, e.steps, "antall steg");

    const got = Object.fromEntries(r.ingredientGroups.map((g) => [g.name, g.items.length]));
    assert.deepEqual(Object.keys(got), Object.keys(e.groups), "gruppenavn");
    for (const [name, count] of Object.entries(e.groups)) {
      assert.equal(got[name], count, `gruppe «${name}»`);
    }
  });
}

test("steg beholder hele teksten når linjer brytes", () => {
  const r = parseRecipe(ramen);
  assert.match(r.steps[0], /Bløtlegg soppen i kokende vann i 20 minutter\. Skyll den deretter i kaldt vann/);
});

test("parseServings forstår entall, intervall og «personer»", () => {
  assert.equal(parseServings("1 porsjon"), "1");
  assert.equal(parseServings("4 porsjoner"), "4");
  assert.equal(parseServings("4–5 porsjoner  40 min"), "4–5");
  assert.equal(parseServings("Til 4 personer"), "4");
  assert.equal(parseServings("For 2 pers."), "2");
  assert.equal(parseServings("40 min"), null);
});

test("parseTime forstår timer, minutter og kombinasjoner", () => {
  assert.equal(parseTime("40 min"), 40);
  assert.equal(parseTime("1 time 15 min"), 75);
  assert.equal(parseTime("ca. 1 t 15 min"), 75);
  assert.equal(parseTime("2 timer"), 120);
  assert.equal(parseTime("45 minutter"), 45);
  assert.equal(parseTime("4 porsjoner"), null);
});

test("guessCuisine bruker ordgrenser (ikke delstrenger)", () => {
  // «sake» skal ikke treffe inni «saken», og «soyasaus» skal ikke telles to
  // ganger via «soya».
  assert.equal(guessCuisine("Vi kommer til bunns i saken med pasta og pesto"), "Italiensk");
  assert.equal(guessCuisine("2 ss soyasaus"), "Ukjent");
  assert.equal(guessCuisine("mirin, soyasaus og nori"), "Japansk");
  assert.equal(guessCuisine("tortilla med jalapeño"), "Meksikansk");
  assert.equal(guessCuisine("brød og smør"), "Ukjent");
});

test("classifyColumns takler tomme spalter uten å krasje", () => {
  assert.deepEqual(classifyColumns([]), { ingredients: [], steps: [] });
  assert.deepEqual(classifyColumns([[]]), { ingredients: [], steps: [] });
});

test("classifyColumns bruker ingHits når ingen spalte har nummererte steg", () => {
  const ingredientCol = ["* 2 dl fløte", "* 1 ts salt", "* 3 egg"];
  const proseCol = ["Visp fløten stiv.", "Bland inn eggene.", "Stek i pannen."];
  const r = classifyColumns([ingredientCol, proseCol]);
  assert.deepEqual(r.ingredients, ingredientCol);
});

test("én-spalters side deles i ingredienser og steg", () => {
  const r = parseRecipe({
    title: "PANNEKAKER",
    metaLine: "4 porsjoner 20 min",
    columns: [[
      "* 3 dl mel", "* 5 dl melk", "* 3 egg",
      "1. Bland mel og melk.", "2. Stek pannekakene.",
    ]],
  });
  assert.equal(r.ingredientGroups[0].items.length, 3);
  assert.equal(r.steps.length, 2);
});
