// service-worker.js — caches the app shell so the app opens offline.
// NB: For FULL offline OCR you must also host Tesseract locally and add its
// files (tesseract.min.js, worker.min.js, tesseract-core*.wasm, nor.traineddata)
// to SHELL below, then point workerPath/corePath/langPath at them in index.html.
const CACHE = "oppskrifter-v1";
const SHELL = ["index.html", "manifest.json", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // let CDN/traineddata go to network
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
