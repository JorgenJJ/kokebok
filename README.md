# Oppskriftsboka

En offline-first PWA som skanner oppskrifter fra kokebøker med tekstgjenkjenning
(Tesseract.js), tolker dem med en regelbasert parser og lagrer dem lokalt på
telefonen (IndexedDB). Ingen konto, ingen server, ingen byggetrinn – bare
statiske filer og ES-moduler.

**Alt fungerer uten nett**, også første gang du skanner: Tesseract og den norske
språkmodellen er selv-hostet under `vendor/tesseract/` og legges i service
worker-cachen rett etter første besøk.

## Hva appen kan

- Skanne en kokeboksside med kameraet, eller velge/dele inn et bilde fra galleriet
- Kjenne igjen teksten lokalt og strukturere den: tittel, porsjoner, tid,
  kjøkken, ingrediensgrupper og nummererte steg
- Flersides oppskrifter («Skann neste side»)
- Rette opp i et redigeringsskjema før lagring, med originalfotoet vedlagt
- Søk, filtrering (kjøkken, tid, favoritter), sortering
- Lesevisning med porsjonsskalering («1 ½ dl» → «3 dl»)
- Kokkemodus: ett steg om gangen, stor skrift, skjermen holdes våken
- Sletting med bekreftelse og angre-knapp
- Eksport/import av hele biblioteket som JSON

## Kjøre lokalt

Statisk side – server rota med en hvilken som helst webserver:

```bash
npm run serve      # python3 -m http.server 8000
# åpne http://localhost:8000
```

> Kamera/`getUserMedia`, service worker og deling krever `https://` eller `localhost`.

## Tester

```bash
npm install        # kun devDependencies (tesseract.js + playwright) – appen selv er avhengighetsfri
npm test           # enhetstester + OCR-integrasjonstest (node --test)
npm run test:e2e   # Playwright-røyktest av hele flyten i en ekte nettleser
```

`test/ocr-integration.test.mjs` kjører ekte OCR mot en innsjekket PNG-fixtur og
**hopper over seg selv** hvis `tesseract.js` eller språkfilene mangler, slik at
`npm test` alltid er grønn. Fixturene kan gjenskapes med
`python3 test/fixtures/make-fixtures.py` (krever Pillow).

CI (`.github/workflows/test.yml`) kjører begge settene på push og pull request.

## GitHub Pages

Siden publiseres med **deploy fra branch** (Settings → Pages → Deploy from a
branch → `main` / rot). Push til `main` oppdaterer appen; det finnes ingen
Pages-workflow. `.nojekyll` sørger for at alle mapper serveres som de er.

## Filer

| Fil | Beskrivelse |
| --- | --- |
| `index.html` | App-skall: markup og CSS for alle skjermene |
| `js/app.mjs` | Oppstart, navigasjon og UI-logikk |
| `js/db.mjs` | IndexedDB: åpne/migrere/CRUD, varig lagring |
| `js/camera.mjs` | Kamera, beskjæring og bildeforbehandling (manuell gråtone – virker i Safari) |
| `js/ocr.mjs` | Eneste Tesseract-avhengighet: bilde → linjebokser |
| `js/layout.mjs` | RENT: linjebokser → tittel, metalinje og spalter |
| `js/columns.mjs` | RENT: bokser → spalter etter x-posisjon |
| `js/parser.mjs` | RENT: strukturert tekst → oppskrift |
| `js/quantity.mjs` | RENT: «1 ½ dl soyasaus» → mengde, enhet, navn (skalering) |
| `js/recipe.mjs` | RENT: datamodell, migrering, søk/filtrering, eksport/import |
| `manifest.json` | PWA-manifest, inkl. Web Share Target |
| `service-worker.js` | Precache av app-skall, egen cache for OCR-filene, delingsmottak |
| `vendor/tesseract/` | Selv-hostet Tesseract + `nor.traineddata.gz` |
| `test/`, `e2e/` | Enhets-, integrasjons- og røyktester |
| `PLAN.md` | Veikartet fra prototype til komplett app |
