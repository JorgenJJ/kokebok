// app.mjs — oppstart, skjermnavigasjon og all UI-logikk.
// All parsing/lagring ligger i egne moduler; denne filen limer dem sammen.

import * as db from "./db.mjs";
import * as cam from "./camera.mjs";
import { recognize } from "./ocr.mjs";
import { mergeLayouts } from "./layout.mjs";
import { parseRecipe } from "./parser.mjs";
import {
  migrateRecipe, filterRecipes, scaleGroups, servingsNumber,
  toExport, fromExport, normalizeGroups,
} from "./recipe.mjs";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const screens = {
  list: $("#list"), scan: $("#scan"), work: $("#work-screen"),
  result: $("#result"), detail: $("#detail"), cook: $("#cook"),
};
let currentScreen = "list";

function show(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  currentScreen = name;
  window.scrollTo(0, 0);
  if (name !== "cook") releaseWakeLock();
}

// ---------------------------------------------------------------- snackbar
let snackTimer = null;
function snack(message, actionLabel, onAction) {
  const bar = $("#snack"), btn = $("#snackAction");
  $("#snackMsg").textContent = message;
  btn.hidden = !actionLabel;
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.onclick = () => { hideSnack(); onAction && onAction(); };
  }
  bar.classList.add("show");
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnack, actionLabel ? 8000 : 3500);
}
function hideSnack() { $("#snack").classList.remove("show"); clearTimeout(snackTimer); }
function fail(error) {
  console.error(error);
  snack(error && error.message ? error.message : "Noe gikk galt.");
}

// ---------------------------------------------------------------- bibliotek
let library = [];
const view = { query: "", cuisine: "", maxTime: null, onlyFavorites: false, sort: "nyeste" };

async function loadLibrary() {
  try {
    library = await db.allRecipes();
  } catch (e) {
    library = [];
    fail(e);
  }
  renderList();
}

function renderList() {
  const items = filterRecipes(library, view);
  const el = $("#cards");
  el.innerHTML = "";

  const cuisines = [...new Set(library.map((r) => r.cuisine).filter(Boolean))].sort();
  const sel = $("#fCuisine");
  if (sel.dataset.list !== cuisines.join("|")) {
    sel.dataset.list = cuisines.join("|");
    sel.innerHTML = '<option value="">Alle kjøkken</option>' +
      cuisines.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    sel.value = view.cuisine;
  }

  if (!items.length) {
    el.innerHTML = library.length
      ? '<div class="empty">Ingen oppskrifter passer søket.</div>'
      : '<div class="empty">Ingen oppskrifter ennå. Trykk på stempelet for å skanne den første siden fra en av bøkene dine.</div>';
    renderLibraryTools();
    return;
  }

  items.forEach((r, i) => {
    const b = document.createElement("button");
    b.className = "card";
    b.type = "button";
    const meta = [r.cuisine, r.servings && r.servings + " porsj.", r.timeMinutes && r.timeMinutes + " min"]
      .filter(Boolean).join(" · ");
    b.innerHTML =
      `<span class="no" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>` +
      `<span><h3>${esc(r.title || "Uten navn")}</h3><div class="meta">${esc(meta)}</div></span>` +
      (r.favorite ? '<span class="fav" aria-label="Favoritt">★</span>' : "");
    b.setAttribute("aria-label", `${r.title || "Uten navn"}${meta ? ", " + meta : ""}`);
    b.onclick = () => openDetail(r.id);
    el.appendChild(b);
  });
  renderLibraryTools();
}

function renderLibraryTools() {
  const el = $("#cards");
  const tools = document.createElement("div");
  tools.style.cssText = "margin-top:28px;display:flex;gap:16px;flex-wrap:wrap";
  const exportBtn = document.createElement("button");
  exportBtn.className = "linkbtn"; exportBtn.type = "button";
  exportBtn.textContent = "Eksporter biblioteket";
  exportBtn.onclick = exportLibrary;
  const importLabel = document.createElement("label");
  importLabel.className = "linkbtn";
  importLabel.style.cursor = "pointer";
  importLabel.textContent = "Importer fra fil";
  const importInput = document.createElement("input");
  importInput.type = "file"; importInput.accept = "application/json,.json"; importInput.hidden = true;
  importInput.onchange = (e) => importLibrary(e.target.files[0]).finally(() => { importInput.value = ""; });
  importLabel.appendChild(importInput);
  tools.append(exportBtn, importLabel);
  el.appendChild(tools);
}

// ---------------------------------------------------------------- eksport/import
function exportLibrary() {
  try {
    const data = toExport(library);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `oppskriftsboka-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    snack(`Eksporterte ${library.length} oppskrifter.`);
  } catch (e) { fail(e); }
}

async function importLibrary(file) {
  if (!file) return;
  try {
    const recipes = fromExport(JSON.parse(await file.text()));
    await db.putMany(recipes);
    await loadLibrary();
    snack(`Importerte ${recipes.length} oppskrifter.`);
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- skanning
let pendingLayouts = [];   // flersides skann
let pendingPhoto = null;   // blob av første side
let pendingConfidence = null;

async function startScan() {
  show("scan");
  try {
    await cam.startCamera($("#video"));
  } catch (_) {
    $("#file").click(); // ingen kameratilgang – bruk galleriet
  }
}

function setBar(p, msg) {
  $("#barFill").style.width = Math.round(p * 100) + "%";
  if (msg) $("#workMsg").textContent = msg;
}

async function processCanvas(canvas) {
  show("work");
  setBar(0.05, "Klargjør tekstgjenkjenning …");
  try {
    const result = await recognize(canvas, setBar);
    pendingLayouts.push(result.layout);
    pendingConfidence = result.confidence;
    if (!pendingPhoto) pendingPhoto = await cam.canvasToBlob(canvas);

    const recipe = parseRecipe(mergeLayouts(pendingLayouts));
    openForm({
      ...recipe,
      photo: pendingPhoto,
      source: { type: "scan", ocrConfidence: result.confidence },
    }, { fromScan: true });
    if (result.confidence != null && result.confidence < 70) {
      snack("Teksten var utydelig – sjekk ekstra nøye før du lagrer.");
    }
  } catch (e) {
    fail(e);
    setBar(0, "Klarte ikke å lese siden. Prøv et skarpere bilde.");
    setTimeout(() => show("list"), 1800);
  }
}

// ---------------------------------------------------------------- skjema
let editing = null;
let formDirty = false;
let scanningExtraPage = false;

function markDirty() { formDirty = true; }

function openForm(recipe, { fromScan = false } = {}) {
  editing = migrateRecipe(recipe);
  if (fromScan) editing.source = recipe.source || editing.source;
  $("#f-title").value = editing.title || "";
  $("#f-serv").value = editing.servings || "";
  $("#f-time").value = editing.timeMinutes ?? "";
  $("#f-cuisine").value = editing.cuisine || "";
  $("#f-tags").value = (editing.tags || []).join(", ");
  $("#cuisinePill").textContent = editing.cuisine || "kjøkken";
  renderGroups(editing.ingredientGroups);
  renderSteps(editing.steps);
  $("#scanMore").hidden = !fromScan;
  formDirty = false;
  show("result");
  $("#f-title").focus({ preventScroll: true });
}

function itemNode(value) {
  const row = document.createElement("div"); row.className = "item";
  const input = document.createElement("input");
  input.value = value; input.setAttribute("aria-label", "Ingrediens");
  input.oninput = markDirty;
  const x = document.createElement("button");
  x.type = "button"; x.className = "x"; x.textContent = "×";
  x.setAttribute("aria-label", "Fjern ingrediens");
  x.onclick = () => { row.remove(); markDirty(); };
  row.append(input, x);
  return row;
}

function groupNode(group) {
  const wrap = document.createElement("div"); wrap.className = "group";
  const name = document.createElement("input");
  name.className = "gname"; name.value = group.name;
  name.setAttribute("aria-label", "Gruppenavn");
  name.oninput = markDirty;
  wrap.appendChild(name);
  const items = document.createElement("div");
  (group.items || []).forEach((it) => items.appendChild(itemNode(it.raw ?? it)));
  wrap.appendChild(items);
  const add = document.createElement("button");
  add.type = "button"; add.className = "add"; add.textContent = "+ Ingrediens";
  add.onclick = () => { items.appendChild(itemNode("")); markDirty(); };
  wrap.appendChild(add);
  return wrap;
}

function stepNode(value, n) {
  const row = document.createElement("div"); row.className = "step";
  const no = document.createElement("div"); no.className = "step-no"; no.textContent = n + ".";
  const ta = document.createElement("textarea");
  ta.value = value; ta.setAttribute("aria-label", `Steg ${n}`);
  ta.oninput = markDirty;
  const x = document.createElement("button");
  x.type = "button"; x.className = "x"; x.textContent = "×";
  x.setAttribute("aria-label", `Fjern steg ${n}`);
  x.onclick = () => { row.remove(); renumber(); markDirty(); };
  row.append(no, ta, x);
  return row;
}

function renderGroups(groups) {
  const el = $("#groups"); el.innerHTML = "";
  (groups && groups.length ? groups : [{ name: "Hovedingredienser", items: [] }])
    .forEach((g) => el.appendChild(groupNode(g)));
}
function renderSteps(steps) {
  const el = $("#steps"); el.innerHTML = "";
  (steps && steps.length ? steps : [""]).forEach((s, i) => el.appendChild(stepNode(s, i + 1)));
}
function renumber() {
  [...$("#steps").children].forEach((row, i) => {
    row.querySelector(".step-no").textContent = (i + 1) + ".";
    row.querySelector("textarea").setAttribute("aria-label", `Steg ${i + 1}`);
  });
}

function collectForm() {
  const groups = [...$("#groups").children].map((g) => ({
    name: g.querySelector(".gname").value.trim() || "Ingredienser",
    items: [...g.querySelectorAll(".item input")].map((i) => i.value.trim()).filter(Boolean),
  }));
  return {
    ...editing,
    title: $("#f-title").value.trim(),
    servings: $("#f-serv").value.trim(),
    timeMinutes: $("#f-time").value.trim(),
    cuisine: $("#f-cuisine").value.trim() || "Ukjent",
    tags: $("#f-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    ingredientGroups: normalizeGroups(groups),
    steps: [...$("#steps").querySelectorAll("textarea")].map((t) => t.value.trim()).filter(Boolean),
  };
}

async function saveForm() {
  try {
    const saved = await db.putRecipe(collectForm());
    resetScan();
    await loadLibrary();
    openDetail(saved.id);
    snack("Lagret.");
  } catch (e) { fail(e); }
}

function resetScan() {
  pendingLayouts = [];
  pendingPhoto = null;
  pendingConfidence = null;
  scanningExtraPage = false;
}

function discardForm() {
  if (formDirty && !confirm("Forkaste endringene?")) return;
  resetScan();
  show("list");
}

// ---------------------------------------------------------------- detaljvisning
let viewing = null;
let scaleServings = null;

function openDetail(id) {
  const recipe = library.find((r) => r.id === id);
  if (!recipe) { show("list"); return; }
  viewing = recipe;
  scaleServings = servingsNumber(recipe.servings);
  $("#dTitle").textContent = recipe.title || "Uten navn";
  $("#dMeta").textContent = [
    recipe.cuisine,
    recipe.servings && `${recipe.servings} porsjoner`,
    recipe.timeMinutes && `${recipe.timeMinutes} min`,
    ...(recipe.tags || []),
  ].filter(Boolean).join(" · ");

  const img = $("#dPhoto");
  if (img.dataset.url) { URL.revokeObjectURL(img.dataset.url); delete img.dataset.url; }
  if (recipe.photo) {
    const url = URL.createObjectURL(recipe.photo);
    img.src = url; img.dataset.url = url; img.hidden = false;
  } else {
    img.removeAttribute("src"); img.hidden = true;
  }

  $("#dFav").textContent = recipe.favorite ? "★ Favoritt" : "☆ Favoritt";
  $("#dFav").setAttribute("aria-pressed", String(!!recipe.favorite));

  const steps = $("#dSteps");
  steps.innerHTML = "";
  recipe.steps.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s;
    steps.appendChild(li);
  });

  renderScaledIngredients();
  show("detail");
}

function scaleFactor() {
  const base = servingsNumber(viewing.servings);
  if (!base || !scaleServings) return 1;
  return scaleServings / base;
}

function renderScaledIngredients() {
  const base = servingsNumber(viewing.servings);
  const scaler = $(".scaler");
  scaler.style.display = base ? "flex" : "none";
  $("#servOut").textContent = base ? `${scaleServings} porsjoner` : "";

  const host = $("#dIngredients");
  host.innerHTML = "";
  const groups = scaleGroups(viewing.ingredientGroups, scaleFactor());
  if (!groups.length) {
    host.innerHTML = '<p class="detail-meta">Ingen ingredienser registrert.</p>';
    return;
  }
  groups.forEach((g) => {
    const wrap = document.createElement("div"); wrap.className = "ing-group";
    const h = document.createElement("h3"); h.textContent = g.name;
    const ul = document.createElement("ul"); ul.className = "ing-list";
    g.items.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    });
    wrap.append(h, ul); host.appendChild(wrap);
  });
}

async function toggleFavorite() {
  try {
    const updated = await db.putRecipe({ ...viewing, favorite: !viewing.favorite });
    library = library.map((r) => (r.id === updated.id ? updated : r));
    viewing = updated;
    $("#dFav").textContent = updated.favorite ? "★ Favoritt" : "☆ Favoritt";
    $("#dFav").setAttribute("aria-pressed", String(updated.favorite));
    renderList();
  } catch (e) { fail(e); }
}

async function deleteViewing() {
  const doomed = viewing;
  if (!doomed) return;
  if (!confirm(`Slette «${doomed.title || "Uten navn"}»?`)) return;
  try {
    await db.deleteRecipe(doomed.id);
    await loadLibrary();
    show("list");
    snack("Oppskriften er slettet.", "Angre", async () => {
      try {
        await db.putRecipe(doomed);
        await loadLibrary();
        snack("Angret – oppskriften er tilbake.");
      } catch (e) { fail(e); }
    });
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- kokkemodus
let cookIndex = 0;
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (_) { wakeLock = null; }
}
function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch (_) { /* ignorer */ } wakeLock = null; }
}

function startCook() {
  if (!viewing || !viewing.steps.length) { snack("Ingen fremgangsmåte å følge."); return; }
  cookIndex = 0;
  $("#cookTitle").textContent = viewing.title || "Uten navn";
  const host = $("#cookIngredients");
  host.innerHTML = "";
  scaleGroups(viewing.ingredientGroups, scaleFactor()).forEach((g) => {
    const h = document.createElement("h3"); h.textContent = g.name;
    const ul = document.createElement("ul"); ul.className = "ing-list";
    g.items.forEach((line) => { const li = document.createElement("li"); li.textContent = line; ul.appendChild(li); });
    host.append(h, ul);
  });
  renderCookStep();
  show("cook");
  requestWakeLock();
}

function renderCookStep() {
  $("#cookCount").textContent = `Steg ${cookIndex + 1} av ${viewing.steps.length}`;
  $("#cookStep").textContent = viewing.steps[cookIndex];
  $("#cookPrev").disabled = cookIndex === 0;
  $("#cookNext").textContent = cookIndex === viewing.steps.length - 1 ? "Ferdig" : "Neste";
}

// ---------------------------------------------------------------- hendelser
$("#goScan").onclick = () => { resetScan(); startScan(); };
$("#camCancel").onclick = () => { cam.stopCamera(); show(scanningExtraPage ? "result" : "list"); scanningExtraPage = false; };
$("#shutter").onclick = async () => {
  const canvas = cam.captureFromVideo($("#video"));
  if (!canvas) { $("#file").click(); return; }
  cam.stopCamera();
  await processCanvas(canvas);
};
$("#file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  cam.stopCamera();
  try {
    await processCanvas(await cam.canvasFromFile(file));
  } catch (err) { fail(err); show("list"); }
};

$("#addGroup").onclick = () => { $("#groups").appendChild(groupNode({ name: "Ny gruppe", items: [""] })); markDirty(); };
$("#addStep").onclick = () => { $("#steps").appendChild(stepNode("", $("#steps").children.length + 1)); markDirty(); };
$("#nextPage").onclick = () => {
  editing = migrateRecipe(collectForm());
  scanningExtraPage = true;
  startScan();
};
$("#discard").onclick = discardForm;
$("#save").onclick = saveForm;
["#f-title", "#f-serv", "#f-time", "#f-cuisine", "#f-tags"].forEach((sel) => { $(sel).oninput = markDirty; });

$("#detailBack").onclick = () => show("list");
$("#dEdit").onclick = () => openForm(viewing);
$("#dFav").onclick = toggleFavorite;
$("#dDelete").onclick = deleteViewing;
$("#startCook").onclick = startCook;
$("#servMinus").onclick = () => { scaleServings = Math.max(1, (scaleServings || 1) - 1); renderScaledIngredients(); };
$("#servPlus").onclick = () => { scaleServings = Math.min(99, (scaleServings || 1) + 1); renderScaledIngredients(); };

$("#cookExit").onclick = () => { releaseWakeLock(); show("detail"); };
$("#cookPrev").onclick = () => { if (cookIndex > 0) { cookIndex--; renderCookStep(); } };
$("#cookNext").onclick = () => {
  if (cookIndex < viewing.steps.length - 1) { cookIndex++; renderCookStep(); }
  else { releaseWakeLock(); show("detail"); snack("Vel bekomme!"); }
};

$("#q").oninput = (e) => { view.query = e.target.value; renderList(); };
$("#fCuisine").onchange = (e) => { view.cuisine = e.target.value; renderList(); };
$("#fTime").onchange = (e) => { view.maxTime = e.target.value ? parseInt(e.target.value, 10) : null; renderList(); };
$("#fSort").onchange = (e) => { view.sort = e.target.value; renderList(); };
$("#fFav").onclick = (e) => {
  view.onlyFavorites = !view.onlyFavorites;
  e.currentTarget.setAttribute("aria-pressed", String(view.onlyFavorites));
  renderList();
};

document.addEventListener("keydown", (e) => {
  if (currentScreen !== "cook") return;
  if (e.key === "ArrowRight") $("#cookNext").click();
  if (e.key === "ArrowLeft") $("#cookPrev").click();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentScreen === "cook") requestWakeLock();
});

window.addEventListener("beforeunload", (e) => {
  if (currentScreen === "result" && formDirty) { e.preventDefault(); e.returnValue = ""; }
});

// ---------------------------------------------------------------- service worker
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("service-worker.js");
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          $("#updateBanner").classList.add("show");
        }
      });
    });
    $("#reloadApp").onclick = () => {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      location.reload();
    };
    // Varm opp OCR-filene i bakgrunnen slik at første skann virker i flymodus.
    const sw = await navigator.serviceWorker.ready;
    if (sw.active && navigator.onLine !== false) sw.active.postMessage({ type: "PRECACHE_VENDOR" });
  } catch (_) { /* uten SW virker appen fortsatt, bare ikke offline */ }
}

/** Del et bilde til appen (Web Share Target) – service workeren legger det i cache. */
async function handleShareTarget() {
  if (!new URLSearchParams(location.search).has("share")) return;
  history.replaceState(null, "", location.pathname);
  try {
    const cache = await caches.open("share-target");
    const res = await cache.match("shared-image");
    if (!res) return;
    await cache.delete("shared-image");
    const blob = await res.blob();
    resetScan();
    await processCanvas(await cam.canvasFromFile(new File([blob], "delt.jpg", { type: blob.type })));
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- oppstart
(async function boot() {
  await loadLibrary();
  db.requestPersistence();
  registerServiceWorker();
  handleShareTarget();
})();
