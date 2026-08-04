// ocr.mjs — eneste modulen som kjenner Tesseract.
// Alt er selv-hostet under vendor/tesseract/, så appen fungerer uten nett.

import { linesFromTesseract, extractLayout, averageConfidence } from "./layout.mjs";

const VENDOR = new URL("../vendor/tesseract/", import.meta.url).href;

export const TESSERACT_PATHS = {
  workerPath: VENDOR + "worker.min.js",
  corePath: VENDOR,
  langPath: VENDOR,
  gzip: true,
};

let tesseractPromise = null;

/** Last tesseract.min.js én gang (klassisk script – eksponerer window.Tesseract). */
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = VENDOR + "tesseract.min.js";
    s.onload = () => resolve(globalThis.Tesseract);
    s.onerror = () => reject(new Error("Fikk ikke lastet tekstgjenkjenningen."));
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

/**
 * Kjør OCR på et canvas/bilde.
 * onProgress(andel 0–1, melding)
 * -> { layout, lines, confidence, text }
 */
export async function recognize(image, onProgress = () => {}) {
  const Tesseract = await loadTesseract();
  onProgress(0.1, "Klargjør tekstgjenkjenning …");

  const worker = await Tesseract.createWorker("nor", 1, {
    ...TESSERACT_PATHS,
    logger: (m) => {
      if (m.status === "recognizing text") onProgress(0.35 + 0.6 * m.progress, "Leser tekst …");
      else if (m.status && m.status.includes("traineddata")) onProgress(0.2, "Laster språkmodell …");
      else if (m.status) onProgress(0.3, "Klargjør …");
    },
  });

  try {
    const { data } = await worker.recognize(image);
    const page = { width: image.width || 1000, height: image.height || 1000 };
    const lines = linesFromTesseract(data, page);
    onProgress(1, "Ferdig");
    return {
      lines,
      text: data.text || "",
      confidence: averageConfidence(lines),
      layout: extractLayout(lines, page),
    };
  } finally {
    await worker.terminate();
  }
}
