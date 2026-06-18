# Oppskriftsboka

En liten offline-first PWA som skanner oppskrifter fra kokebøker med
tekstgjenkjenning (Tesseract.js), tolker dem med en regelbasert parser og
lagrer dem lokalt på telefonen (IndexedDB).

## Kjøre lokalt

Det er en statisk side – server rota med en hvilken som helst webserver:

```bash
python3 -m http.server 8000
# åpne http://localhost:8000
```

> Kamera/`getUserMedia` og service worker krever `https://` eller `localhost`.

## Tester

Den regelbaserte parseren er enhetstestet:

```bash
node test.mjs
node test-columns.mjs
```

## GitHub Pages

Siden publiseres automatisk via GitHub Actions
(`.github/workflows/pages.yml`) ved push. Når deployen er ferdig finner du
appen på prosjektets Pages-URL.

## Filer

| Fil | Beskrivelse |
| --- | --- |
| `index.html` | Hele appen (UI, kamera, OCR, parser, IndexedDB) |
| `manifest.json` | PWA-manifest |
| `service-worker.js` | Cacher app-skallet for offline bruk |
| `parser.mjs` / `columns.mjs` | Regelbasert parser (samme logikk som i appen), brukt av testene |
| `test.mjs` / `test-columns.mjs` | Enhetstester |
| `icon-192.png` / `icon-512.png` | App-ikoner |
