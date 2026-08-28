// dataapi client — lee el perfil personal del socio desde db2 (Fase B).
// Usa LoopBack filter API (lowercase field names) en lugar de los endpoints
// custom (/by-docume, /by-email) que devuelven campos incompletos.
//
// LoopBack filter: GET {DATAAPI_URL}/coopesocios?filter={"where":{...}}
// Devuelve array de objetos con todos los campos.
//
// Discriminación de resultados:
//   - 200 con array    -> 0=not_found, 1=ok, >1=ambiguous (409)
//   - 404/otro         -> unavailable

const http = require("http");
const https = require("https");

const DATAAPI_URL = (process.env.DATAAPI_URL || "").replace(/\/+$/, "");
const DATAAPI_ENABLED = process.env.DATAAPI_ENABLED === "true";
const TIMEOUT_MS = Number(process.env.DATAAPI_TIMEOUT_MS || 5000);

function isEnabled() {
  return DATAAPI_ENABLED && DATAAPI_URL.length > 0;
}

function request(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          /* body no es JSON; se ignora */
        }
        resolve({ status: res.statusCode, body, json });
      });
    });
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`timeout tras ${TIMEOUT_MS}ms`));
    });
  });
}

// DB2 (LoopBack) → S400 (PRD) field name mapping.
// LoopBack lowercase → uppercase already done by queryFilter;
// this maps DB2-specific names to the S400 names the rest of the code expects.
const DB2_TO_S400 = {
  CODEMPLEADO: "DOCUME",
  // Add more here if DB2 adds columns with different names
};

function mapToS400(row) {
  const out = { ...row };
  for (const [db2, s400] of Object.entries(DB2_TO_S400)) {
    if (db2 in out) {
      out[s400] = out[db2];
      // keep original too so dataapi lookups still work
    }
  }
  return out;
}

// Helper: query LoopBack filter API, return array of matches
async function queryFilter(filter) {
  const url = `${DATAAPI_URL}/coopesocios?filter=${encodeURIComponent(JSON.stringify(filter))}`;
  try {
    const res = await request(url);
    if (res.status === 200 && Array.isArray(res.json)) {
      // Normalize lowercase LoopBack field names to uppercase for frontend compatibility
      const rows = res.json.map(row => {
        const normalized = {};
        for (const [key, val] of Object.entries(row)) {
          normalized[key.toUpperCase()] = val;
        }
        return mapToS400(normalized);
      });
      return { status: "ok", rows };
    }
    return { status: "unavailable", error: `dataapi respondió ${res.status}` };
  } catch (e) {
    return { status: "unavailable", error: `dataapi no disponible: ${e.message}` };
  }
}

// Lee el perfil de un socio por DOCUME (codempleado, uppercase).
// LoopBack usa campo lowercase 'codempleado' para el DOCUME de DB2.
async function readSocio(docume) {
  const key = String(docume).trim();
  if (!key) return { status: "not_found" };
  const result = await queryFilter({ where: { codempleado: key } });
  if (result.status !== "ok") return result;
  if (result.rows.length === 0) return { status: "not_found" };
  if (result.rows.length > 1) {
    return { status: "ambiguous", error: `Multiple records for docume ${key}` };
  }
  return { status: "ok", socio: result.rows[0] };
}

// Lista TODOS los socios de db2 trayendo solo lo necesario para notificar
// (DOCUME + correo). Se usa para el envío masivo de anuncios/proveedores.
// No es un lookup: devuelve { status: "ok", rows: [...] } o { status:
// "unavailable", error }. El límite es alto y configurable (DATAAPI_LIST_LIMIT)
// para no chocar con el tope por defecto de LoopBack.
async function listAllSocios() {
  const limit = Number(process.env.DATAAPI_LIST_LIMIT || 10000);
  const result = await queryFilter({
    fields: { codempleado: true, nombc2: true },
    limit
  });
  if (result.status !== "ok") return result;
  return { status: "ok", rows: result.rows };
}

// Lee el perfil de un socio por email (NOMBC2).
// LoopBack usa campo lowercase 'nombc2'.
async function readSocioByEmail(email) {
  const key = String(email).trim();
  if (!key) return { status: "not_found" };
  const result = await queryFilter({ where: { nombc2: key } });
  if (result.status !== "ok") return result;
  if (result.rows.length === 0) return { status: "not_found" };
  if (result.rows.length > 1) {
    return { status: "ambiguous", error: `Multiple accounts with email ${key}` };
  }
  return { status: "ok", socio: result.rows[0] };
}

module.exports = { isEnabled, readSocio, readSocioByEmail, listAllSocios, DATAAPI_URL };