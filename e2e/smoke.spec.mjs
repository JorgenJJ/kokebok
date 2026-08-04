// smoke.spec.mjs — ende-til-ende: fixturbilde inn i filvelgeren (omgår kamera),
// OCR i nettleseren, skjemaet fylles, lagring havner i listen.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "ramen.png");

test("skann → skjema → lagre → lesevisning", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/index.html");
  await expect(page.locator("#list")).toHaveClass(/active/);
  await expect(page.locator("#cards")).toContainText("Ingen oppskrifter ennå");

  await page.locator("#goScan").click();
  await page.locator("#file").setInputFiles(FIXTURE);

  // OCR kjører lokalt (vendor/tesseract) – gi den god tid.
  await expect(page.locator("#result")).toHaveClass(/active/, { timeout: 150_000 });
  await expect(page.locator("#f-title")).toHaveValue(/RAMEN/i);
  await expect(page.locator("#f-serv")).toHaveValue("4-5");
  await expect(page.locator("#f-time")).toHaveValue("40");
  expect(await page.locator("#steps textarea").count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator("#groups .group").first()).toContainText("");

  await page.locator("#save").click();

  // Lagring sender oss til lesevisningen
  await expect(page.locator("#detail")).toHaveClass(/active/);
  await expect(page.locator("#dTitle")).toHaveText(/RAMEN/i);
  await expect(page.locator("#dSteps li")).not.toHaveCount(0);

  // Porsjonsskalering
  const firstIngredient = page.locator("#dIngredients li").first();
  const before = await firstIngredient.textContent();
  await page.locator("#servPlus").click();
  await expect(page.locator("#servOut")).toHaveText("5 porsjoner");
  expect(await firstIngredient.textContent()).not.toBe(before);

  // Kokkemodus
  await page.locator("#startCook").click();
  await expect(page.locator("#cook")).toHaveClass(/active/);
  await expect(page.locator("#cookCount")).toContainText("Steg 1 av");
  await page.locator("#cookNext").click();
  await expect(page.locator("#cookCount")).toContainText("Steg 2 av");
  await page.locator("#cookExit").click();

  // Tilbake i listen skal oppskriften ligge
  await page.locator("#detailBack").click();
  await expect(page.locator("#cards .card")).toHaveCount(1);

  // Søk filtrerer
  await page.locator("#q").fill("finnesikke");
  await expect(page.locator("#cards")).toContainText("Ingen oppskrifter passer søket");
  await page.locator("#q").fill("ramen");
  await expect(page.locator("#cards .card")).toHaveCount(1);

  // Sletting med bekreftelse + angre
  page.once("dialog", (d) => d.accept());
  await page.locator("#cards .card").click();
  await page.locator("#dDelete").click();
  await expect(page.locator("#list")).toHaveClass(/active/);
  await expect(page.locator("#snackMsg")).toContainText("slettet");
  await page.locator("#snackAction").click();
  await expect(page.locator("#cards .card")).toHaveCount(1);

  // Oppskriften overlever en omlasting (IndexedDB)
  await page.reload();
  await expect(page.locator("#cards .card")).toHaveCount(1);

  expect(errors, "ingen ubehandlede JS-feil").toEqual([]);
});

test("flymodus: appen åpner og skanner uten nett etter første besøk", async ({ page, context }) => {
  const scan = async () => {
    await page.locator("#goScan").click();
    await page.locator("#file").setInputFiles(FIXTURE);
    await expect(page.locator("#result")).toHaveClass(/active/, { timeout: 150_000 });
    await expect(page.locator("#f-title")).toHaveValue(/RAMEN/i);
  };

  await page.goto("/index.html");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });

  // Første skann med nett – service workeren legger OCR-filene i cachen.
  await scan();
  await page.locator("#discard").click();

  await context.setOffline(true);
  // Alt serveres nå fra cachen; ingen nettverkskall skal trenges.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#list h1")).toHaveText("Oppskriftsboka");

  await scan();
  await context.setOffline(false);
});
