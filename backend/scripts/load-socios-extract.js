// Loader del extracto de socios en COOPESOCIOS — replica la validación del
// loader prod (CoopeCargaFiles): 22 campos `;`, MAX_LENGTHS por campo,
// DNICY ≤ 8, UPDATE por TRIM(DOCUME) = TRIM(CODEMPLEADO).
// Uso: node scripts/load-socios-extract.js <archivo> [--apply]
//   sin --apply → dry-run (cuenta lo que haría, no escribe nada)

require("dotenv").config();
const ibmdb = require("ibm_db");
const fs = require("fs");
const path = require("path");

// MAX_LENGTHS del contrato (§5.2), índice = posición 1-based
const MAX_LENGTHS = [
  6,   // 1  DOCUME
  1,   // 2  TIPDID
  11,  // 3  DOCIDE
  20,  // 4  APEPAT
  20,  // 5  APEMAT
  30,  // 6  NOMBRE
  80,  // 7  DIRECC
  40,  // 8  LOCALI
  40,  // 9  PROVIN
  40,  // 10 DEPART
  60,  // 11 NCOMPL
  50,  // 12 NOMBC2
  9,   // 13 TELCEL
  1,   // 14 NACION
  6,   // 15 CCIUDA
  40,  // 16 NOMCON
  8,   // 17 DNICY
  1,   // 18 ESTCIV
  2,   // 19 CARGAM
  20,  // 20 OFICIO
  2,   // 21 SECTO1
  6,   // 22 LUGNAC
];
const DNICY_IDX = 17; // 1-based
const N_FIELDS = 22;

// columnas de COOPESOCIOS (personal, V11) en el mismo orden que el extracto
// NOTA: LUGNAC (#22 del layout) NO existe como columna en db2 (verificado 3-sep-26) —
// el extracto lo trae pero no se puede cargar; se ignora.
const COLS = [
  "DOCUME", "TIPDID", "DOCIDE", "APEPAT", "APEMAT", "NOMBRE", "DIRECC",
  "LOCALI", "PROVIN", "DEPART", "NCOMPL", "NOMBC2", "TELCEL", "NACION",
  "CCIUDA", "NOMCON", "DNICY", "ESTCIV", "CARGAM", "OFICIO", "SECTO1",
];
const N_COLS = COLS.length; // 21 columnas reales (sin LUGNAC)

function validateRow(parts) {
  if (parts.length !== N_FIELDS) return { ok: false, reason: `campos: ${parts.length} (esperaba 22)` };
  const docume = (parts[0] || "").trim();
  if (!docume || docume === "\x1a") return { ok: false, reason: "DOCUME vacío/EOF" };
  if (docume.length > MAX_LENGTHS[0]) return { ok: false, reason: `DOCUME len ${docume.length} > 6` };
  // los numéricos/ubigeo vienen con padding de espacios a la izquierda (§5.1) — se hace trim
  // antes de validar longitud; el valor final también va con trim (sin padding)
  const values = parts.map((p) => (p == null ? "" : String(p).trim()));
  for (let i = 0; i < N_FIELDS; i++) {
    const v = values[i];
    const max = MAX_LENGTHS[i];
    if (v.length > max) return { ok: false, reason: `campo ${i + 1} (${COLS[i]}) len ${v.length} > ${max}` };
  }
  if (values[DNICY_IDX - 1].length > 8) return { ok: false, reason: "DNICY > 8" };
  return { ok: true, docume, values };
}

async function run() {
  const extractPath = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!extractPath) { console.error("Uso: node scripts/load-socios-extract.js <archivo> [--apply]"); process.exit(1); }
  if (!process.env.DB2_PASSWORD) { console.error("ERROR: DB2_PASSWORD no está seteado (carga .env)"); process.exit(1); }

  const connStr = process.env.DB2_CONNECTION_STRING;
  if (!connStr) { console.error("ERROR: DB2_CONNECTION_STRING no está"); process.exit(1); }

  const content = fs.readFileSync(extractPath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  const valid = [];
  const rejected = [];
  for (const line of lines) {
    const parts = line.split(";");
    const r = validateRow(parts);
    if (r.ok) valid.push(r.values);
    else rejected.push({ docume: (parts[0] || "").trim() || "(vacío)", reason: r.reason });
  }

  console.log(`Extracto: ${lines.length} líneas`);
  console.log(`Válidas: ${valid.length} · Rechazadas: ${rejected.length}`);
  const rejCounts = {};
  for (const r of rejected) rejCounts[r.reason] = (rejCounts[r.reason] || 0) + 1;
  for (const [k, v] of Object.entries(rejCounts)) console.log(`  rechazada: ${k} (${v})`);

  const conn = await ibmdb.open(connStr);

  // Cruzar DOCUME vs CODEMPLEADO
  const documes = valid.map((v) => v[0]);
  const placeholders = documes.map(() => "?").join(",");
  const existing = new Set();
  const chunks = [];
  const CHUNK = 200;
  for (let i = 0; i < documes.length; i += CHUNK) {
    const chunk = documes.slice(i, i + CHUNK);
    const ph = chunk.map(() => "?").join(",");
    const rows = await conn.query(
      `SELECT TRIM(CODEMPLEADO) AS D FROM COOPESOCIOS WHERE TRIM(CODEMPLEADO) IN (${ph})`,
      chunk
    );
    for (const r of rows) existing.add(r.D.trim());
  }
  const toUpdate = valid.filter((v) => existing.has(v[0].trim()));
  const noMatch = valid.filter((v) => !existing.has(v[0].trim()));

  console.log(`Existen en COOPESOCIOS: ${toUpdate.length} · Sin match: ${noMatch.length}`);

  if (!apply) {
    console.log("\n[MODO DRY-RUN] no se escribió nada. Para aplicar: node scripts/load-socios-extract.js <archivo> --apply");
    console.log("Sin match (no se actualizan):", noMatch.slice(0, 10).map((v) => v[0]).join(", "));
    await conn.close();
    return;
  }

  // UPDATE por DOCUME
  const setClause = COLS.slice(1).map((c) => `${c} = ?`).join(", ");
  const sql = `UPDATE COOPESOCIOS SET ${setClause} WHERE TRIM(CODEMPLEADO) = ?`;
  let updated = 0;
  const errors = [];
  for (const values of toUpdate) {
    // values tiene 22 campos (extracto); se usan los primeros 21 (sin LUGNAC idx 22)
    const params = [...values.slice(1, N_COLS), values[0]];
    try {
      await conn.query(sql, params);
      updated++;
    } catch (e) {
      errors.push({ docume: values[0], error: e.message });
    }
  }
  console.log(`\nUPDATE completado: ${updated}/${toUpdate.length}`);
  if (errors.length) {
    console.log("Errores:");
    for (const e of errors.slice(0, 10)) console.log(`  ${e.docume}: ${e.error}`);
  }

  const check = await conn.query(
    "SELECT COUNT(*) AS TOT, COUNT(NOMBRE) AS CON_NOMBRE, COUNT(DIRECC) AS CON_DIRECC FROM COOPESOCIOS"
  );
  console.log("Verificación:", JSON.stringify(check[0]));
  await conn.close();
}

run().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });