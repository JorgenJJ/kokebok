# Plan: Oppskriftsboka – komplett versjon

Dette dokumentet er veikartet fra dagens prototype til en komplett, robust og
fullt offline oppskrifts-app. Det er basert på en gjennomgang av koden per
august 2026 og er organisert som milepæler som kan gjennomføres i rekkefølge –
hver milepæl etterlater appen i en fungerende tilstand.

## 1. Målbilde

En offline-first PWA der du:

1. Skanner en kokeboksside med kameraet (eller velger et bilde fra galleriet).
2. Får teksten gjenkjent lokalt (Tesseract.js, norsk språkmodell) – uten nett.
3. Får oppskriften automatisk strukturert: tittel, porsjoner, tid, kjøkken,
   ingrediensgrupper og nummererte steg.
4. Retter opp eventuelle feil i et redigeringsskjema og lagrer lokalt
   (IndexedDB), med originalfotoet vedlagt.
5. Finner igjen, leser, skalerer, lager mat etter, eksporterer og sletter
   oppskrifter – alt uten konto, server eller nettilgang.

Prinsipp som beholdes: **ingen byggetrinn, ingen rammeverk, ingen backend.**
Statisk side med ES-moduler, publisert via GitHub Pages (deploy fra branch).

## 2. Nå-situasjon

Fungerer i dag:

- Kamera/galleri → beskjæring → OCR (Tesseract fra CDN) → regelbasert parser
  → redigeringsskjema → IndexedDB → liste.
- Regelbasert parser og kolonnesplitting finnes som testede moduler
  (`parser.mjs`, `columns.mjs`; 32 enhetstester passerer).
- App-skallet caches av service worker.

### 2.1 Kjente feil og svakheter (funnet i kodegjennomgang)

Disse rettes i M0/M1 og er listet med referanse:

| # | Problem | Hvor |
| --- | --- | --- |
| F1 | Parserlogikken er **duplisert** i `index.html` og har allerede driftet fra de testede modulene (bl.a. mangler `lime` i Meksikansk-nøkkelordene, og `servings`/`timeMinutes` har andre returtyper enn i `parser.mjs`). | `index.html:196–270` vs `parser.mjs` |
| F2 | Metalinje-gjenkjenningen `/porsjon|\d+\s*min/i` søker i **hele** siden og kan plukke et framgangsmåtesteg («… i 20 minutter») som metalinje, som da fjernes fra stegene. | `index.html:299` |
| F3 | Kroppslinjer filtreres bort ved **tekstlikhet** med metalinjen i stedet for objektidentitet – alle linjer med samme tekst forsvinner. | `index.html:301` |
| F4 | `classifyColumns` bruker aldri `ingHits` – ved null nummererte steg velges «steg-kolonnen» vilkårlig, og en tom kolonneliste krasjer (`scored[0]` er `undefined`). | `parser.mjs:42–49` |
| F5 | Service workeren cacher ikke rot-URL-en (`./`) – navigasjon til `/kokebok/` offline feiler selv om `index.html` ligger i cache. Parser-modulene caches heller ikke. | `service-worker.js:6` |
| F6 | `parseServings` krever «porsjoner» og bommer på «1 porsjon»; `parseTime` forstår ikke timer («1 time 15 min» → 15). | `parser.mjs:93–101` |
| F7 | `URL.createObjectURL` uten `revokeObjectURL` ved galleivalg – minnelekkasje. | `index.html:379` |
| F8 | `ctx.filter` (gråtone/kontrast før OCR) støttes ikke i Safari/iOS – forbedringen forsvinner stille på hovedplattformen. | `index.html:353` |
| F9 | README beskriver en GitHub Actions-workflow (`.github/workflows/pages.yml`) som **ikke finnes** – repoet bruker deploy-fra-branch. | `README.md:27–31` |
| F10 | Oppskrifter kan aldri **slettes** – appen har lagre og rediger, men ingen sletting. | `index.html` (mangler) |
| F11 | «Forkast» kaster endringer uten bekreftelse; feil ved åpning av IndexedDB (f.eks. privat modus) vises ikke til brukeren. | `index.html:424, 441` |
| F12 | `guessCuisine` bruker substring-treff («sake» treffer i «saken»); teller `soya` dobbelt via «soyasaus». Lav presisjon ved få nøkkelord. | `parser.mjs:103–111` |

### 2.2 Manglende funksjonalitet mot målbildet

- Ingen tester for **bildeparsing** (OCR-utdata → tittel/metalinje/kolonner);
  logikken ligger utestet inne i `index.html`.
- Ikke full offline: Tesseract + `nor.traineddata` hentes fra CDN.
- Ingen søk, filtrering, favoritter, detalj-/lesevisning, kokkemodus,
  porsjonsskalering, eksport/import eller lagring av originalfoto.
- Ingen CI som kjører testene, ingen ende-til-ende-test.

## 3. Arkitektur for komplett versjon

### 3.1 Filstruktur (fortsatt uten byggetrinn)

```
index.html            app-skall + skjermer (markup/CSS), <script type="module" src="js/app.mjs">
js/
  app.mjs             oppstart, navigasjon mellom skjermer
  db.mjs              IndexedDB: åpne/migrere/CRUD (put, getAll, delete), persist()
  camera.mjs          getUserMedia, beskjæring, bildeforbehandling (manuell gråtone)
  ocr.mjs             Tesseract-worker: init, progresjon, gjenkjenning → linjebokser
  layout.mjs          RENT: linjebokser → { title, metaLine, columns }  ← ny modul
  columns.mjs         RENT: bokser → kolonner (flyttes fra rota)
  parser.mjs          RENT: strukturert tekst → oppskrift (flyttes fra rota)
  ui/…                skjema-, liste- og kokkemodus-komponenter etter behov
vendor/tesseract/     selv-hostet tesseract.min.js, worker, wasm, nor.traineddata
test/                 alle tester (node --test)
PLAN.md, README.md, manifest.json, service-worker.js, ikoner
```

Nøkkelgrep: **all** logikk som kan testes uten nettleser ligger i rene
ES-moduler (`layout.mjs`, `columns.mjs`, `parser.mjs`), og `index.html`
importerer dem i stedet for å duplisere dem (fjerner F1 permanent).
Bildepipelinen blir da: `ocr.mjs` (eneste Tesseract-avhengighet) →
`layout.mjs` → `parser.mjs`, der de to siste er 100 % enhetstestbare.

### 3.2 Datamodell (IndexedDB, med migrering)

```js
{
  id: string,            // crypto.randomUUID()
  schemaVersion: 2,
  title: string,
  cuisine: string,
  tags: string[],
  servings: string,      // "4–5"
  timeMinutes: number|null,
  ingredientGroups: [{ name, items: [{ raw, qty|null, unit|null, name }] }],
  steps: string[],
  photo: Blob|null,      // beskåret skann, JPEG ~0.7
  favorite: boolean,
  createdAt: number, updatedAt: number,
  source: { type: "scan"|"manual", ocrConfidence: number|null }
}
```

Migrering v1→v2 i `db.mjs` (`onupgradeneeded`): eksisterende poster får
`schemaVersion`, `items` løftes fra `string` til `{ raw }`, nye felter får
standardverdier. Be om varig lagring med `navigator.storage.persist()`.

## 4. Milepæler

### M0 – Feilretting og avduplisering (liten)

- Rett F1–F9, F12: `index.html` importerer modulene; `layout.mjs` skilles ut
  med fikset metalinje-logikk (søk kun i øvre tredjedel, foretrekk
  «porsjon»-treff, filtrer på objektidentitet); `classifyColumns` bruker
  `stepHits − ingHits` med fallback; `porsjon(er)?` og timer+minutter;
  `./` + moduler inn i service worker-cachen med ny cacheversjon; README
  oppdateres til deploy-fra-branch.
- Akseptkriterier: eksisterende 32 tester passerer uendret; appen fungerer
  identisk manuelt; `index.html` inneholder ingen kopi av parserlogikk.

### M1 – Testfundament, inkl. bildeparsing (middels)

- `node --test`-baserte tester i `test/` (behold dagens som de er inntil de
  porteres):
  - **`test/layout.test.mjs` (bildeparsing, nivå 1):** syntetiske
    Tesseract-linjebokser for hele sider – tittel = høyeste linje i øvre
    tredjedel, metalinje-deteksjon (inkl. felle: steg med «20 minutter» skal
    *ikke* bli metalinje), fallback uten bokser, én- og to-kolonne, speilvendt
    layout, tom side.
  - **`test/ocr-integration.test.mjs` (bildeparsing, nivå 2):** ekte OCR mot
    innsjekkede PNG-fixturer av gjengitte oppskriftssider
    (`test/fixtures/*.png`), kjørt med `tesseract.js` som dev-avhengighet og
    lokalt cachet traineddata. Testen **hopper over seg selv** (skip) hvis
    avhengigheten/nettet mangler, så `node --test` alltid er grønn lokalt.
  - Ende-til-ende på fixtursiden: PNG → OCR → layout → parser → forventet
    strukturert oppskrift (med toleranse for OCR-støy: sammenlign normalisert).
- `package.json` med `"test"`-script og `tesseract.js` som devDependency;
  `node_modules/` i `.gitignore`. Selve appen forblir avhengighetsfri.
- GitHub Actions CI-workflow som kjører `npm test` på push/PR (kun test –
  Pages fortsetter som deploy-fra-branch).
- Akseptkriterier: CI grønn; en bevisst innført layout-feil fanges av testene.

### M2 – Full offline-OCR (middels)

- Selv-host `tesseract.min.js`, `worker.min.js`, `tesseract-core*.wasm` og
  `nor.traineddata.gz` under `vendor/tesseract/`; pek `workerPath`/`corePath`/
  `langPath` dit.
- Service worker: precache app-skall + moduler; cache-first med
  bakgrunnsoppdatering for vendor-filer (de er store – egen cache);
  «Ny versjon tilgjengelig – oppdater»-banner ved ny SW.
- Manuell gråtone/kontrast i `camera.mjs` (Uint8ClampedArray) i stedet for
  `ctx.filter`, så forbehandlingen også virker på iOS (F8).
- Akseptkriterier: flymodus etter første besøk → skanning fungerer fullt ut;
  Lighthouse PWA-sjekker passerer.

### M3 – Komplett oppskriftshåndtering (middels/stor)

- **Sletting** med bekreftelse (F10) og «angre»-snackbar.
- **Detalj-/lesevisning** adskilt fra redigering (dagens skjema åpnes bare via
  «Rediger»), med originalfoto tilgjengelig.
- **Søk og filtrering**: fritekst på tittel/ingrediens, filter på kjøkken og
  tid, sortering (nyeste, A–Å, tid), favoritter.
- **Kokkemodus**: ett steg om gangen, stor skrift, `navigator.wakeLock`,
  ingredienser tilgjengelig som utfellbar liste.
- **Porsjonsskalering** i lesevisning – krever kvantitetsparsing fra M4, men
  UI-et kan komme først med `raw`-fallback (uskalerbare linjer vises uendret).
- Bekreftelse ved «Forkast» med endringer; synlige feilmeldinger fra `db.mjs`
  (F11).
- Akseptkriterier: alle CRUD-flyter uten blindveier; tastatur-/skjermleser-
  navigerbart (fokusrekkefølge, `aria-label`, kontrast AA).

### M4 – Bedre parsing (middels)

- **Kvantitetsparsing**: `"1 ½ dl soyasaus"` → `{ qty: 1.5, unit: "dl",
  name: "soyasaus", raw }`; unicode-brøker, intervaller («½–1»), «etter smak».
  Ren modul `quantity.mjs` + tester. Muliggjør skalering og handleliste.
- **Metalinje**: flere formater («Til 4 personer», «ca. 1 t 15 min»,
  «Tilberedning: 45 min»).
- **Flersides oppskrifter**: «Skann neste side»-knapp; kolonner/steg fra flere
  skann flettes før parsing.
- **Kjøkkengjetting**: ordgrense-regex i stedet for substring (F12),
  vektede nøkkelord, flere kjøkken; behold dagens API så en
  embeddings-basert klassifiserer kan byttes inn senere uten UI-endring.
- Akseptkriterier: nye parser-tester (inkl. regresjonsfixturer fra ekte
  skann som har feilet) passerer; skalering gir riktige mengder.

### M5 – PWA-finish og deling (liten/middels)

- Eksport/import av hele biblioteket som JSON-fil (uten foto valgfritt).
- Web Share Target: del et bilde fra galleriet direkte inn i appen → OCR.
- Installasjonshint, iOS-quirks (statusbar, `viewport-fit`), maskable-ikoner
  verifisert, `apple-touch-icon`.
- Akseptkriterier: eksport→slett alt→import gir identisk bibliotek; deling av
  bilde fra kamerarull starter skanneflyten.

### M6 – Ende-til-ende-kvalitet (liten, løpende)

- Playwright-røyktest i CI: last appen, injiser fixturbilde i filvelgeren
  (omgår kamera), verifiser at skjemaet fylles og lagring havner i listen.
- Enkel feillogg-skjerm (siste feil, lagret lokalt) for feilsøking på telefon.
- Akseptkriterier: CI kjører enhets-, integrasjons- og røyktester på hver PR.

## 5. Risikoer og avbøtninger

| Risiko | Avbøtning |
| --- | --- |
| OCR-kvalitet varierer med lys/fonter/papir | Forbehandling (M2), redigeringsskjema som sikkerhetsnett, regresjonsfixturer fra ekte feilskann (M4), vis `ocrConfidence` som hint |
| `nor.traineddata` er stor (~10–15 MB) | Egen SW-cache, lastes én gang med progresjon; gzip-versjon; Pages-kvote er uproblematisk |
| Safari-særegenheter (canvas-filter, IndexedDB i privat modus, wake lock) | Manuell pikselbehandling, synlige feilmeldinger, funksjonsdeteksjon med fallback |
| CDN-avhengighet før M2 | M2 fjerner den helt; inntil da er CDN-en pinnet på major-versjon |
| IndexedDB kan tømmes av OS ved lagerpress | `navigator.storage.persist()` + eksport/backup (M5) |
| Regelbasert parser møter layouter den ikke forstår | Testfundamentet (M1) gjør hver ny layout til en fixtur; parseren er ren og lett å utvide |

## 6. Rekkefølge og omfang

| Milepæl | Omfang | Avhenger av |
| --- | --- | --- |
| M0 Feilretting/avduplisering | S | – |
| M1 Testfundament + bildeparsingstester | M | M0 |
| M2 Full offline-OCR | M | M0 |
| M3 Oppskriftshåndtering | M/L | M0 |
| M4 Bedre parsing | M | M1 |
| M5 PWA-finish | S/M | M3 |
| M6 E2E-kvalitet | S | M1 |

M0+M1 er fundamentet og bør tas først; deretter kan M2 og M3 gå parallelt.
Appen er «komplett» i denne planens forstand når M0–M5 er levert og M6 kjører
i CI.
