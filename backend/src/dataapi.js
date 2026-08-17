// dataapi client — lee el perfil personal del socio desde db2 (Fase B).
// Contrato de lectura: GET {DATAAPI_URL}/coopesocios/by-docume/{docume}
// devuelve solo los 21 campos personales. La escritura en db2 NO pasa por el
// portal (Regla 1: TXT -> José -> S400 -> db2).
//
// La whitelist de campos se aplica ARRIBA, en el dataapi (pickPersonal /
// PERSONAL_FIELDS del controller). Este cliente es un passthrough: devuelve
// lo que venga sin filtrar. No asumas aquí una validación de campos que no
// existe: cualquier campo nuevo que añada el dataapi llegará al frontend tal
// cual.
//
// Discriminación de resultados:
//   - 200            -> { status: 'ok', socio }
//   - 404            -> { status: 'not_found' }  (aún no migrado a db2)
//   - 5xx/otro/timeout/error de conexión -> { status: 'unavailable', error }

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

// Lee el perfil de un socio. Nunca lanza: devuelve un resultado discriminado.
async function readSocio(docume) {
  const url = `${DATAAPI_URL}/coopesocios/by-docume/${encodeURIComponent(String(docume).trim())}`;
  try {
    const res = await request(url);
    if (res.status === 200) {
      return { status: "ok", socio: res.json };
    }
    if (res.status === 404) {
      return { status: "not_found" };
    }
    return { status: "unavailable", error: `dataapi respondió ${res.status}` };
  } catch (e) {
    return { status: "unavailable", error: `dataapi no disponible: ${e.message}` };
  }
}

module.exports = { isEnabled, readSocio, DATAAPI_URL };