// service-worker.js — full offline: app-skall + moduler + selv-hostet Tesseract.
// Tre cacher:
//   SHELL  – små filer, precaches ved install (cache-first + bakgrunnsoppdatering)
//   VENDOR – store OCR-filer (wasm/traineddata), cache-first, hentes ved behov
//   SHARE  – midlertidig lager for bilder delt inn i appen (Web Share Target)
const VERSION = "v3";
const SHELL_CACHE = `oppskrifter-shell-${VERSION}`;
const VENDOR_CACHE = `oppskrifter-vendor-${VERSION}`;
const SHARE_CACHE = "share-target";

const SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "js/app.mjs",
  "js/db.mjs",
  "js/camera.mjs",
  "js/ocr.mjs",
  "js/layout.mjs",
  "js/columns.mjs",
  "js/parser.mjs",
  "js/quantity.mjs",
  "js/recipe.mjs",
];

// Store filer som må ligge i cache for at OCR skal virke i flymodus.
const VENDOR = [
  "vendor/tesseract/tesseract.min.js",
  "vendor/tesseract/worker.min.js",
  "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract/tesseract-core-simd-lstm.wasm",
  "vendor/tesseract/tesseract-core-lstm.wasm.js",
  "vendor/tesseract/tesseract-core-lstm.wasm",
  "vendor/tesseract/nor.traineddata.gz",
];

const isVendor = (url) => url.pathname.includes("/vendor/tesseract/");

/** Hent OCR-filene i bakgrunnen (én gang) slik at første offline-skann virker. */
async function warmVendorCache() {
  const cache = await caches.open(VENDOR_CACHE);
  for (const file of VENDOR) {
    if (await cache.match(file)) continue;
    try {
      const res = await fetch(file, { cache: "no-cache" });
      if (res && res.ok) await cache.put(file, res.clone());
    } catch (_) { /* prøver igjen neste gang appen åpnes */ }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith("oppskrifter-") && k !== SHELL_CACHE && k !== VENDOR_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  if (type === "PRECACHE_VENDOR") event.waitUntil(warmVendorCache());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Web Share Target: ta imot et delt bilde og send brukeren inn i skanneflyten.
  if (request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith((async () => {
      try {
        const form = await request.formData();
        const file = form.get("image") || form.get("file");
        if (file) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put("shared-image", new Response(file, {
            headers: { "Content-Type": file.type || "image/jpeg" },
          }));
        }
      } catch (_) { /* faller tilbake til vanlig oppstart */ }
      return Response.redirect("./?share=1", 303);
    })());
    return;
  }

  if (request.method !== "GET" || url.origin !== location.origin) return;

  // Navigasjon: server app-skallet fra cache når nettet er borte.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match("index.html")) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  const cacheName = isVendor(url) ? VENDOR_CACHE : SHELL_CACHE;

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request);
    if (hit) {
      // Vendor-filene er store og versjonerte – ikke oppdater dem i bakgrunnen.
      if (!isVendor(url)) {
        event.waitUntil(fetch(request).then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
        }).catch(() => {}));
      }
      return hit;
    }
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  })());
});
