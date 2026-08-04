// layout.mjs — RENT: OCR-linjebokser -> { title, metaLine, columns }
// Ingen Tesseract-, DOM- eller nettverksavhengighet, slik at hele
// «bildeparsingen» over OCR-nivå kan enhetstestes.
//
// Input:  lines = [{ text, x0, x1, y0, y1 }]  (Tesseract line.bbox)
//         page  = { width, height }
// Output: { title, metaLine, columns, titleLine, metaLineBox }

import { splitColumns } from "./columns.mjs";
import { classifyColumns } from "./parser.mjs";

// En metalinje ser ut som «4 porsjoner · 40 min» / «Til 4 personer, ca 1 t».
const META_STRONG = /porsjon|\bpers(?:on|oner)?\b|\bstk\b\s*$/i;
const META_TIME = /\b\d+\s*(?:min(?:utt(?:er)?)?|t|tim(?:e|er))\b/i;
// Et fremgangsmåtesteg («2. Kok i 20 minutter») skal ALDRI bli metalinje.
const STEP_LINE = /^\s*\d{1,2}[.)]\s+\S/;

const TOP_FRACTION = 0.33;   // tittel/meta søkes bare i øverste tredjedel

/** Bygg linjebokser fra rå tekst (fallback når OCR ikke gir bbox). */
export function linesFromText(text, pageWidth = 1000) {
  return String(text || "")
    .split("\n")
    .map((t, i) => ({ text: t.trim(), x0: 0, x1: pageWidth, y0: i, y1: i + 1, h: 1 }))
    .filter((l) => l.text);
}

/**
 * Finn en tydelig loddrett luftespalte (kolonnegate) i midtpartiet av siden.
 * Returnerer x-posisjonen for delingen, eller null hvis siden er én-spaltet.
 * Tesseract slår ofte sammen to spalter til én linje; da må vi dele selv.
 */
export function findGutter(boxes, pageWidth) {
  if (!boxes || boxes.length < 8 || !pageWidth) return null;
  const BUCKETS = 200;
  const occupied = new Array(BUCKETS).fill(false);
  for (const b of boxes) {
    const from = Math.max(0, Math.floor((b.x0 / pageWidth) * BUCKETS));
    const to = Math.min(BUCKETS - 1, Math.ceil((b.x1 / pageWidth) * BUCKETS));
    for (let i = from; i <= to; i++) occupied[i] = true;
  }
  const MIN_RUN = Math.max(3, Math.round(BUCKETS * 0.03)); // minst 3 % av bredden
  const LO = Math.round(BUCKETS * 0.25), HI = Math.round(BUCKETS * 0.75);

  let best = null, run = 0;
  for (let i = 0; i <= BUCKETS; i++) {
    if (i < BUCKETS && !occupied[i]) { run++; continue; }
    if (run >= MIN_RUN) {
      const start = i - run, center = start + run / 2;
      if (center >= LO && center <= HI && (!best || run > best.run)) best = { run, center };
    }
    run = 0;
  }
  return best ? (best.center / BUCKETS) * pageWidth : null;
}

/** Ordbokser -> linjer, gruppert per spalte og deretter per tekstlinje. */
export function linesFromWords(words, page = {}) {
  const boxes = (words || [])
    .map((w) => ({
      text: String(w.text || "").trim(),
      x0: w.bbox ? w.bbox.x0 : w.x0, x1: w.bbox ? w.bbox.x1 : w.x1,
      y0: w.bbox ? w.bbox.y0 : w.y0, y1: w.bbox ? w.bbox.y1 : w.y1,
      confidence: typeof w.confidence === "number" ? w.confidence : null,
    }))
    .filter((w) => w.text && Number.isFinite(w.x0));
  if (!boxes.length) return [];

  const width = page.width || Math.max(...boxes.map((b) => b.x1));
  const gutter = findGutter(boxes, width);
  const groups = gutter == null
    ? [boxes]
    : [boxes.filter((b) => (b.x0 + b.x1) / 2 < gutter), boxes.filter((b) => (b.x0 + b.x1) / 2 >= gutter)];

  const lines = [];
  for (const group of groups) {
    if (!group.length) continue;
    const sorted = group.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    let current = null;
    for (const w of sorted) {
      const wc = (w.y0 + w.y1) / 2;
      const tol = Math.max(6, (w.y1 - w.y0) * 0.6);
      if (current && Math.abs(wc - current.center) <= tol) {
        current.words.push(w);
        current.center = (current.center * (current.words.length - 1) + wc) / current.words.length;
      } else {
        current = { center: wc, words: [w] };
        lines.push(current);
      }
    }
  }

  return lines
    .map((l) => {
      const ws = l.words.slice().sort((a, b) => a.x0 - b.x0);
      const conf = ws.map((w) => w.confidence).filter((c) => typeof c === "number");
      return {
        text: ws.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim(),
        x0: Math.min(...ws.map((w) => w.x0)),
        x1: Math.max(...ws.map((w) => w.x1)),
        y0: Math.min(...ws.map((w) => w.y0)),
        y1: Math.max(...ws.map((w) => w.y1)),
        h: Math.max(...ws.map((w) => w.y1 - w.y0)),
        confidence: conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : null,
      };
    })
    .filter((l) => l.text)
    .sort((a, b) => a.y0 - b.y0);
}

/**
 * Normaliser Tesseract-utdata til vårt boksformat.
 * Ordbokser foretrekkes, fordi Tesseract ofte limer sammen venstre og høyre
 * spalte til én «linje» – da havner steg blant ingrediensene.
 */
export function linesFromTesseract(data, page) {
  const width = (page && page.width) || 1000;

  const fromWords = linesFromWords(data && data.words, page || {});
  if (fromWords.length) return fromWords;

  const lines = (data && data.lines ? data.lines : [])
    .map((l) => ({
      text: String(l.text || "").replace(/\s*\n\s*/g, " ").trim(),
      x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1,
      h: l.bbox.y1 - l.bbox.y0,
      confidence: typeof l.confidence === "number" ? l.confidence : null,
    }))
    .filter((l) => l.text);
  if (lines.length) return lines;

  return linesFromText(data && data.text, width);
}

function height(line) {
  return typeof line.h === "number" ? line.h : line.y1 - line.y0;
}

/**
 * Tittel = høyeste linje i øverste tredjedel (ved lik høyde: den øverste).
 * Metalinjer og nummererte steg regnes ikke som tittel.
 */
function findTitle(lines, pageHeight) {
  const limit = pageHeight * TOP_FRACTION;
  const candidates = lines.filter((l) => l.y0 < limit);
  const usable = candidates.filter(
    (l) => !STEP_LINE.test(l.text) && !(META_STRONG.test(l.text) && l.text.length < 40),
  );
  // Ingen brukbare kandidater (f.eks. side 2 av en oppskrift, som starter midt
  // i fremgangsmåten) -> ingen tittel, og linjen blir værende i teksten.
  return usable.slice().sort((a, b) => height(b) - height(a) || a.y0 - b.y0)[0] || null;
}

/**
 * Metalinje = linje i øverste tredjedel som nevner porsjoner (sterkest signal)
 * eller tid. Steg-linjer utelukkes, slik at «… i 20 minutter» ikke stjeler
 * plassen (og dermed forsvinner fra fremgangsmåten).
 */
function findMetaLine(lines, pageHeight, titleLine) {
  const limit = pageHeight * TOP_FRACTION;
  const pool = lines.filter(
    (l) => l !== titleLine && l.y0 < limit && !STEP_LINE.test(l.text),
  );
  return (
    pool.find((l) => META_STRONG.test(l.text)) ||
    pool.find((l) => META_TIME.test(l.text) && l.text.length < 60) ||
    null
  );
}

/**
 * Hovedinngang: linjebokser -> struktur klar for parseRecipe().
 */
export function extractLayout(lines, page = {}) {
  const boxes = (lines || []).filter((l) => l && l.text);
  const width = page.width || (boxes.length ? Math.max(...boxes.map((l) => l.x1)) : 1000);
  const height_ = page.height || (boxes.length ? Math.max(...boxes.map((l) => l.y1)) : 1000);

  if (!boxes.length) return { title: "", metaLine: "", columns: [[]], titleLine: null, metaLineBox: null };

  const sorted = boxes.slice().sort((a, b) => a.y0 - b.y0);
  const titleLine = findTitle(sorted, height_);
  const metaLineBox = findMetaLine(sorted, height_, titleLine);

  // Filtrer på objektidentitet, ikke tekstlikhet (ellers forsvinner alle
  // linjer med samme tekst som metalinjen).
  const body = sorted.filter((l) => l !== titleLine && l !== metaLineBox);

  return {
    title: titleLine ? titleLine.text : "",
    metaLine: metaLineBox ? metaLineBox.text : "",
    columns: splitColumns(body, width),
    titleLine,
    metaLineBox,
  };
}

/** Snittkonfidens for linjene, eller null om OCR ikke rapporterte det. */
export function averageConfidence(lines) {
  const vals = (lines || []).map((l) => l.confidence).filter((c) => typeof c === "number");
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * Slå sammen flere skann (flersides oppskrifter) til én struktur.
 * Hver side klassifiseres for seg, slik at side 2s steg ikke havner blant
 * ingrediensene når sidene slås sammen.
 */
export function mergeLayouts(layouts) {
  const list = (layouts || []).filter(Boolean);
  if (!list.length) return { title: "", metaLine: "", columns: [[]] };

  const ingredients = [], steps = [];
  for (const l of list) {
    const c = classifyColumns(l.columns || []);
    ingredients.push(...c.ingredients);
    steps.push(...c.steps);
  }
  const columns = [ingredients, steps].filter((c) => c.length);
  return {
    title: list.map((l) => l.title).find(Boolean) || "",
    metaLine: list.map((l) => l.metaLine).find(Boolean) || "",
    columns: columns.length ? columns : [[]],
  };
}
