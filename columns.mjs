// columns.mjs — split OCR line-boxes into reading-ordered columns by x-position.
// Input: lines = [{ text, x0, x1, y0, y1 }]  (as Tesseract.js gives per line)
// Output: array of columns (left->right), each an array of text lines (top->bottom).

export function splitColumns(lines, pageWidth) {
  if (lines.length === 0) return [[]];
  const xc = lines.map((l) => (l.x0 + l.x1) / 2);

  // 1D k-means, k=2, init at extremes
  let c0 = Math.min(...xc), c1 = Math.max(...xc);
  for (let it = 0; it < 20; it++) {
    const g0 = [], g1 = [];
    xc.forEach((x, i) => (Math.abs(x - c0) <= Math.abs(x - c1) ? g0 : g1).push(i));
    const m0 = g0.length ? g0.reduce((s, i) => s + xc[i], 0) / g0.length : c0;
    const m1 = g1.length ? g1.reduce((s, i) => s + xc[i], 0) / g1.length : c1;
    if (m0 === c0 && m1 === c1) break;
    c0 = m0; c1 = m1;
  }

  // accept two columns only if centroids are clearly separated
  const gap = Math.abs(c1 - c0);
  const twoCols = gap > 0.18 * pageWidth;

  const assign = (i) => (Math.abs(xc[i] - c0) <= Math.abs(xc[i] - c1) ? 0 : 1);
  const buckets = twoCols ? [[], []] : [[]];
  lines.forEach((l, i) => buckets[twoCols ? assign(i) : 0].push(l));

  // order columns left->right, and lines within a column top->bottom
  return buckets
    .filter((b) => b.length)
    .sort((a, b) => avgX(a) - avgX(b))
    .map((b) => b.slice().sort((p, q) => p.y0 - q.y0).map((l) => l.text));
}

function avgX(lines) {
  return lines.reduce((s, l) => s + (l.x0 + l.x1) / 2, 0) / lines.length;
}
