// parser.mjs
// Rule-based, offline recipe parser (the "non-LLM track").
// Input model mirrors what we get AFTER splitting Tesseract output into columns
// by bounding-box x-position (se layout.mjs):
//   { title, metaLine, stamp, columns: [ [line, line, ...], [line, ...] ] }
// Each column is an array of OCR text lines (bullets kept as a leading "*").
//
// The parser:
//   1. decides which column is ingredients vs steps (by content, not position)
//   2. parses grouped ingredients (sub-headers like "Kraft", "Ponzu-saus")
//   3. parses numbered steps (joining wrapped lines)
//   4. extracts servings + time from the meta line
//   5. guesses cuisine from keywords/stamp (placeholder for embeddings later)
//
// Modulen er ren: ingen DOM, ingen nettverk – 100 % enhetstestbar.

const BULLET = /^[\s]*[\*✱•·◦‣✶✷]+\s*/;            // leading bullet marker
const STARTS_QTY = /^[\s]*[\*✱•·◦‣✶✷]?\s*([0-9¼½¾⅓⅔⅛]|[0-9]+\s*\/\s*[0-9]+)/; // starts with a number/fraction
const STEP_START = /^[\s]*(\d{1,2})[.)]\s+/;       // "1. " or "1) "
const CONTINUATION = /^[\s]*[(a-zæøå]/;            // wrapped line: starts lowercase or "("

// Vektede nøkkelord: 2 = særegent for kjøkkenet, 1 = svakt signal.
// API-et (guessCuisine(text) -> string) holdes stabilt slik at en
// embeddings-basert klassifiserer kan byttes inn senere uten UI-endringer.
const CUISINE_KEYWORDS = {
  Japansk: {
    soyasaus: 1, soya: 1, mirin: 2, sake: 2, teriyaki: 2, sashimi: 2, sushi: 2,
    miso: 2, dashi: 2, nori: 2, edamame: 2, ponzu: 2, wasabi: 2, ramen: 2,
    sesamolje: 1, riseddik: 2, shiitake: 2, japan: 2, japansk: 2, tempura: 2,
  },
  Italiensk: {
    pasta: 1, spaghetti: 2, parmesan: 2, basilikum: 1, mozzarella: 2,
    risotto: 2, pesto: 2, italia: 2, italiensk: 2, gnocchi: 2, prosciutto: 2,
    ricotta: 2, oregano: 1, "olivenolje": 1,
  },
  Indisk: {
    "garam masala": 2, karri: 2, curry: 2, tandoori: 2, ghee: 2, paneer: 2,
    india: 2, indisk: 2, naan: 2, chapati: 2, gurkemeie: 1, spisskummen: 1,
    kardemomme: 1,
  },
  Meksikansk: {
    tortilla: 2, tortillas: 2, taco: 2, tacos: 2, salsa: 1, jalapeño: 2,
    lime: 1, koriander: 1, mexico: 2, meksikansk: 2, guacamole: 2,
    quesadilla: 2, chipotle: 2, "svarte bønner": 1,
  },
  Fransk: {
    "creme fraiche": 1, "crème fraîche": 1, baguette: 2, ratatouille: 2,
    "beurre blanc": 2, dijonsennep: 2, estragon: 1, frankrike: 2, fransk: 2,
    gratin: 1, timian: 1,
  },
  Thai: {
    "fish sauce": 2, fiskesaus: 2, kokosmelk: 1, sitrongress: 2, galangal: 2,
    "rød karripasta": 2, thai: 2, thailandsk: 2, "pad thai": 2, limeblader: 2,
  },
};

// Terskel for å tørre å gjette – under dette blir svaret «Ukjent».
const CUISINE_MIN_SCORE = 2;

function stripBullet(line) {
  return line.replace(BULLET, "").trim();
}

function isStepColumn(lines) {
  const stepHits = lines.filter((l) => STEP_START.test(l)).length;
  const ingHits = lines.filter((l) => BULLET.test(l) || STARTS_QTY.test(l)).length;
  return { stepHits, ingHits };
}

/**
 * Del én enkelt spalte i ingredienser + steg: alt før første nummererte steg
 * er ingredienser, resten er fremgangsmåte. Brukes for én-spalters sider.
 */
function splitSingleColumn(lines) {
  const firstStep = lines.findIndex((l) => STEP_START.test(l));
  if (firstStep === -1) {
    const { stepHits, ingHits } = isStepColumn(lines);
    return stepHits > ingHits
      ? { ingredients: [], steps: lines }
      : { ingredients: lines, steps: [] };
  }
  return { ingredients: lines.slice(0, firstStep), steps: lines.slice(firstStep) };
}

export function classifyColumns(columns) {
  const nonEmpty = (columns || []).filter((c) => Array.isArray(c) && c.length);
  if (!nonEmpty.length) return { ingredients: [], steps: [] };
  if (nonEmpty.length === 1) return splitSingleColumn(nonEmpty[0]);

  // Score hver spalte: mange nummererte steg og få kulepunkter => steg-spalte.
  const scored = nonEmpty.map((c) => {
    const { stepHits, ingHits } = isStepColumn(c);
    return { lines: c, score: stepHits - ingHits, stepHits, ingHits };
  });
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  // Ingen spalte har nummererte steg: la spalten med flest ingrediensmarkører
  // være ingredienser, resten er fremgangsmåte i løpende tekst.
  if (best.stepHits === 0) {
    const byIng = scored.slice().sort((a, b) => b.ingHits - a.ingHits);
    return {
      ingredients: byIng[0].lines,
      steps: byIng.slice(1).flatMap((s) => s.lines),
    };
  }

  return {
    ingredients: scored.slice(1).flatMap((s) => s.lines),
    steps: best.lines,
  };
}

export function parseIngredients(lines) {
  const groups = [];
  let current = { name: "Hovedingredienser", items: [] };
  groups.push(current);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const hasBullet = BULLET.test(raw);
    const startsQty = STARTS_QTY.test(raw);

    if (hasBullet || startsQty) {
      // new ingredient line
      current.items.push(stripBullet(line));
    } else if (CONTINUATION.test(line) && current.items.length) {
      // wrapped continuation of the previous ingredient
      current.items[current.items.length - 1] += " " + line;
    } else {
      // short, capitalized, no bullet -> a new sub-header
      current = { name: line.replace(/[:]$/, ""), items: [] };
      groups.push(current);
    }
  }
  // drop an empty leading "Hovedingredienser" if the list started with a header
  return groups.filter((g) => g.items.length > 0);
}

export function parseSteps(lines) {
  const clean = (lines || []).map((l) => l.trim()).filter(Boolean);
  const numbered = clean.some((l) => STEP_START.test(l));

  const steps = [];
  for (const line of clean) {
    if (numbered) {
      if (STEP_START.test(line)) steps.push(line.replace(STEP_START, "").trim());
      else if (steps.length) steps[steps.length - 1] += " " + line;
    } else if (CONTINUATION.test(line) && steps.length) {
      // unummerert fremgangsmåte: brutte linjer limes sammen igjen
      steps[steps.length - 1] += " " + line;
    } else {
      steps.push(stripBullet(line));
    }
  }
  return steps;
}

/**
 * «4–5 porsjoner», «1 porsjon», «Til 4 personer», «For 2 pers.» -> "4–5" / "1" / "4" / "2"
 */
export function parseServings(metaLine) {
  const text = metaLine || "";
  const patterns = [
    /(\d+(?:\s*[–-]\s*\d+)?)\s*porsjon(?:er)?\b/i,
    /(\d+(?:\s*[–-]\s*\d+)?)\s*pers(?:on(?:er)?)?\b\.?/i,
    /\bti[l]?\s+(\d+(?:\s*[–-]\s*\d+)?)\s*stk\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].replace(/\s/g, "");
  }
  return null;
}

/**
 * «40 min», «1 time 15 min», «ca. 1 t 15 min», «1,5 timer» -> minutter (number)
 */
export function parseTime(metaLine) {
  const text = metaLine || "";
  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*(?:t\b|tim(?:e|er)\b)/i);
  const mins = text.match(/(\d+)\s*min(?:utt(?:er)?)?\b/i);
  if (!hours && !mins) return null;
  const h = hours ? parseFloat(hours[1].replace(",", ".")) : 0;
  const m = mins ? parseInt(mins[1], 10) : 0;
  const total = Math.round(h * 60 + m);
  return total > 0 ? total : null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Ordgrense som også virker for æ/ø/å (JS \b gjør ikke det).
function wordHit(hay, word) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(hay);
}

export function guessCuisine(text) {
  const hay = (text || "").toLowerCase();
  let best = null, bestScore = 0;
  for (const [cuisine, words] of Object.entries(CUISINE_KEYWORDS)) {
    let score = 0;
    for (const [word, weight] of Object.entries(words)) {
      if (wordHit(hay, word)) score += weight;
    }
    if (score > bestScore) { best = cuisine; bestScore = score; }
  }
  return bestScore >= CUISINE_MIN_SCORE ? best : "Ukjent";
}

export function parseRecipe(input) {
  const { title = "", metaLine = "", stamp = "", columns = [] } = input || {};
  const { ingredients, steps } = classifyColumns(columns);
  const allText = [title, stamp, metaLine, ...columns.flat()].join("\n");

  return {
    title: (title || "").trim(),
    cuisine: guessCuisine(allText),
    servings: parseServings(metaLine),
    timeMinutes: parseTime(metaLine),
    ingredientGroups: parseIngredients(ingredients),
    steps: parseSteps(steps),
  };
}
