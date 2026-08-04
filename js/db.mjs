// db.mjs — IndexedDB: åpne/migrere/CRUD + varig lagring.
// Alle feil bobler opp som Error med lesbar norsk tekst (F11).

import { migrateRecipe, SCHEMA_VERSION } from "./recipe.mjs";

const DB_NAME = "oppskrifter";
const DB_VERSION = 2;
const STORE = "r";

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis) || !globalThis.indexedDB) {
      reject(new Error("Nettleseren din tilbyr ikke lokal lagring (IndexedDB)."));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new Error("Kunne ikke åpne den lokale databasen: " + e.message));
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      // v1 -> v2: løft eksisterende poster til gjeldende skjema
      if (event.oldVersion >= 1 && event.oldVersion < 2 && tx) {
        const store = tx.objectStore(STORE);
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          try {
            cursor.update(migrateRecipe(cursor.value));
          } catch (_) { /* hopp over ødelagte poster */ }
          cursor.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(
      "Får ikke tilgang til lokal lagring. Bruker du privat nettlesing? " +
      "Da kan ikke oppskriftene lagres.",
    ));
    req.onblocked = () => reject(new Error("Databasen er i bruk i en annen fane. Lukk den og prøv igjen."));
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap(request, failMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(failMessage + " (" + (request.error && request.error.message) + ")"));
  });
}

export async function putRecipe(recipe) {
  const db = await openDB();
  const record = { ...migrateRecipe(recipe), schemaVersion: SCHEMA_VERSION, updatedAt: Date.now() };
  await wrap(tx(db, "readwrite").put(record), "Klarte ikke å lagre oppskriften");
  return record;
}

export async function putMany(recipes) {
  const db = await openDB();
  const store = tx(db, "readwrite");
  const saved = [];
  for (const r of recipes) {
    const record = migrateRecipe(r);
    store.put(record);
    saved.push(record);
  }
  await new Promise((resolve, reject) => {
    store.transaction.oncomplete = resolve;
    store.transaction.onerror = () => reject(new Error("Klarte ikke å importere alle oppskriftene."));
  });
  return saved;
}

export async function getRecipe(id) {
  const db = await openDB();
  const rec = await wrap(tx(db, "readonly").get(id), "Klarte ikke å hente oppskriften");
  return rec ? migrateRecipe(rec) : null;
}

export async function allRecipes() {
  const db = await openDB();
  const rows = await wrap(tx(db, "readonly").getAll(), "Klarte ikke å hente oppskriftene");
  return (rows || []).map(migrateRecipe);
}

export async function deleteRecipe(id) {
  const db = await openDB();
  await wrap(tx(db, "readwrite").delete(id), "Klarte ikke å slette oppskriften");
}

export async function clearAll() {
  const db = await openDB();
  await wrap(tx(db, "readwrite").clear(), "Klarte ikke å tømme biblioteket");
}

/** Be om varig lagring slik at OS ikke rydder bort biblioteket. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (_) { /* ignorer */ }
  return false;
}
