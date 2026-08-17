// Unified socio read path (Fase B + C).
// - DATAAPI_ENABLED=false -> mirror local (source 'local').
// - DATAAPI_ENABLED=true:
//     * 200 (db2)         -> base = db2 + overlay de cambios pendientes (source 'db2')
//     * 404 (no migrado)  -> fallback al mirror local (source 'local (not yet migrated)')
//     * 503/timeout/conn  -> error, sin fallback silencioso
//
// Overlay (Fase C): campo a campo, solo los campos con cambios pendientes
// (status activo = aún no confirmados en db2). Auto-clear barato: si db2 ya
// refleja el valor del cambio, el cambio se marca COMPLETED y se suelta el
// overlay para ese campo.

const dataapi = require("./dataapi");

// Estados activos = cualquier cambio aún no reflejado en db2. Terminal = COMPLETED / ERROR.
const ACTIVE_STATUSES = new Set([
  "PENDING",
  "EXPORTED",
  "GENERATED",
  "SENT",
  "LOADED_TO_S400",
  "SYNCED_TO_DB2",
]);

function isActive(change) {
  return change && ACTIVE_STATUSES.has(change.status);
}

function fieldEquals(a, b) {
  if (a == null && (b == null || b === "")) return true;
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}

// Aplica el overlay de cambios pendientes sobre una base ya obtenida.
// Solo compara contra los valores de la base (que es db2, fuente autoritativa).
// Devuelve { socio, overlaid: [field...], autoCleared: [changeId...] }.
async function applyOverlay(store, base, docume) {
  const all = await store.listChanges();
  const mine = all.filter((c) => String(c.docume) === String(docume) && isActive(c));

  const socio = { ...base };
  const overlaid = [];
  const autoCleared = [];

  for (const change of mine) {
    const field = change.field;
    if (field === "DOCUME" || !(field in socio)) continue;
    if (fieldEquals(base[field], change.value)) {
      // db2 ya tiene el valor -> el cambio se aplicó; cierra el ciclo sin job.
      await store.updateChangeStatus(change.id, "COMPLETED");
      autoCleared.push(change.id);
    } else {
      socio[field] = change.value;
      overlaid.push(field);
    }
  }

  return { socio, overlaid, autoCleared };
}

// Lee el socio por DOCUME aplicando la semántica de fuentes del plan.
// Lanza { status: 503 } solo ante fallo real del dataapi.
async function readSocio(store, docume) {
  const key = String(docume || "").trim();
  if (!key) {
    const err = new Error("Falta el código de socio (DOCUME).");
    err.status = 400;
    throw err;
  }

  if (!dataapi.isEnabled()) {
    const socio = await store.getSocio(key);
    return { source: "local", socio };
  }

  const result = await dataapi.readSocio(key);
  if (result.status === "ok" && result.socio) {
    const base = result.socio;
    const { socio, overlaid, autoCleared } = await applyOverlay(store, base, key);
    return { source: "db2", socio, overlaid, autoCleared };
  }

  if (result.status === "not_found") {
    console.log(`[dataapi] DOCUME ${key} no está en db2 (404) — sirviendo mirror local.`);
    const socio = await store.getSocio(key);
    return { source: "local (not yet migrated)", socio };
  }

  // Fallo real: nunca servir el mirror en silencio.
  console.error(`[dataapi] fallo al leer DOCUME ${key}: ${result.error}`);
  const err = new Error("El sistema central (db2) no está disponible. Inténtalo más tarde.");
  err.status = 503;
  throw err;
}

module.exports = { readSocio, applyOverlay, isActive, ACTIVE_STATUSES };