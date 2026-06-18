// recipe-parser.mjs
// Rule-based, offline recipe parser (the "non-LLM track").
// Input model mirrors what we get AFTER splitting Tesseract output into columns
// by bounding-box x-position:
//   { title, metaLine, stamp, columns: [ [line, line, ...], [line, ...] ] }
// Each column is an array of OCR text lines (bullets kept as a leading "*").
//
// The parser:
//   1. decides which column is ingredients vs steps (by content, not position)
//   2. parses grouped ingredients (sub-headers like "Kraft", "Ponzu-saus")
//   3. parses numbered steps (joining wrapped lines)
//   4. extracts servings + time from the meta line
//   5. guesses cuisine from keywords/stamp (placeholder for embeddings later)

// --- Norwegian units, used as a *secondary* signal if a bullet is missing ---
const UNITS = ["g", "kg", "dl", "l", "ml", "ss", "ts", "stk", "fedd", "boks", "pk", "pakke", "never", "klype"];

const BULLET = /^[\s]*[\*✱•·◦‣✶✷]+\s*/;            // leading bullet marker
const STARTS_QTY = /^[\s]*[\*✱•·◦‣✶✷]?\s*([0-9¼½¾⅓⅔⅛]|[0-9]+\s*\/\s*[0-9]+)/; // starts with a number/fraction
const STEP_START = /^[\s]*(\d{1,2})[.)]\s+/;       // "1. " or "1) "
const CONTINUATION = /^[\s]*[(a-zæøå]/;            // wrapped line: starts lowercase or "("

const CUISINE_KEYWORDS = {
  Japansk: ["soyasaus", "soya", "mirin", "sake", "teriyaki", "sashimi", "sushi",
            "miso", "dashi", "nori", "edamame", "ponzu", "wasabi", "ramen",
            "sesamolje", "riseddik", "shiitake", "japan"],
  Italiensk: ["pasta", "parmesan", "basilikum", "mozzarella", "risotto", "pesto", "italia"],
  Indisk: ["garam masala", "karri", "curry", "tandoori", "ghee", "paneer", "india"],
  Meksikansk: ["tortilla", "taco", "salsa", "jalapeño", "lime", "koriander", "mexico"],
};

function stripBullet(line) {
  return line.replace(BULLET, "").trim();
}

function isStepColumn(lines) {
  const stepHits = lines.filter((l) => STEP_START.test(l)).length;
  const ingHits = lines.filter((l) => BULLET.test(l) || STARTS_QTY.test(l)).length;
  return { stepHits, ingHits };
}

function classifyColumns(columns) {
  // Score each column; the one with more numbered-step lines is "steps".
  const scored = columns.map((c) => ({ lines: c, ...isStepColumn(c) }));
  scored.sort((a, b) => b.stepHits - a.stepHits);
  const steps = scored[0].lines;
  const ingredients = scored.slice(1).flatMap((s) => s.lines);
  return { ingredients, steps };
}

function parseIngredients(lines) {
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

function parseSteps(lines) {
  const steps = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (STEP_START.test(line)) {
      steps.push(line.replace(STEP_START, "").trim());
    } else if (steps.length) {
      steps[steps.length - 1] += " " + line;
    }
  }
  return steps;
}

function parseServings(metaLine) {
  const m = metaLine.match(/(\d+(?:\s*[–-]\s*\d+)?)\s*porsjoner/i);
  return m ? m[1].replace(/\s/g, "") : null;
}

function parseTime(metaLine) {
  const m = metaLine.match(/(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) : null;
}

function guessCuisine(text) {
  const hay = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const [cuisine, words] of Object.entries(CUISINE_KEYWORDS)) {
    const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { best = cuisine; bestScore = score; }
  }
  return best || "Ukjent";
}

export function parseRecipe(input) {
  const { title, metaLine = "", stamp = "", columns } = input;
  const { ingredients, steps } = classifyColumns(columns);
  const allText = [title, stamp, ...columns.flat()].join("\n");

  return {
    title: title.trim(),
    cuisine: guessCuisine(allText),
    servings: parseServings(metaLine),
    timeMinutes: parseTime(metaLine),
    ingredientGroups: parseIngredients(ingredients),
    steps: parseSteps(steps),
  };
}
