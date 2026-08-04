// camera.mjs — getUserMedia, beskjæring og bildeforbehandling.
// Gråtone/kontrast gjøres manuelt på pikselnivå fordi ctx.filter ikke støttes
// i Safari/iOS (F8) – der ville forbedringen ellers forsvinne stille.

let stream = null;

export async function startCamera(videoEl) {
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

export function cameraActive() {
  return !!stream;
}

// Samme relative ramme som hjelpelinjene i søkeren: x 5–95 %, y 8–95 %.
export const FRAME = { x: 0.05, y: 0.08, w: 0.90, h: 0.87 };

const MAX_WIDTH = 1600; // tak for fart/nøyaktighet

function cropCanvas(srcW, srcH, draw) {
  const x = srcW * FRAME.x, y = srcH * FRAME.y;
  const w = srcW * FRAME.w, h = srcH * FRAME.h;
  const scale = Math.min(1, MAX_WIDTH / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  draw(ctx, x, y, w, h, canvas.width, canvas.height);
  return canvas;
}

/**
 * Manuell gråtone + kontrastøkning (virker i alle nettlesere, også iOS).
 * factor > 1 gir mer kontrast; midtpunktet holdes på 128.
 */
export function enhance(canvas, factor = 1.25) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let img;
  try {
    img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (_) {
    return canvas; // f.eks. tainted canvas – hopp over forbedringen
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let v = (g - 128) * factor + 128;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function captureFromVideo(videoEl) {
  if (!videoEl.videoWidth) return null;
  const canvas = cropCanvas(videoEl.videoWidth, videoEl.videoHeight,
    (ctx, x, y, w, h, cw, ch) => ctx.drawImage(videoEl, x, y, w, h, 0, 0, cw, ch));
  return enhance(canvas);
}

/** Les en fil fra galleriet -> beskåret, forbedret canvas. Rydder opp object-URL (F7). */
export function canvasFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = cropCanvas(img.width, img.height,
          (ctx, x, y, w, h, cw, ch) => ctx.drawImage(img, x, y, w, h, 0, 0, cw, ch));
        resolve(enhance(canvas));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Klarte ikke å lese bildet.")); };
    img.src = url;
  });
}

/** Canvas -> JPEG-blob for lagring sammen med oppskriften. */
export function canvasToBlob(canvas, quality = 0.7) {
  return new Promise((resolve) => {
    if (!canvas.toBlob) { resolve(null); return; }
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}
