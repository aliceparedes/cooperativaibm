// Corrige códigos de socios en db2 según indicación de José (3-sep-26):
//  1. Rename COOPESOCIOS: K03348→K00334, K01568→K01546, 071015→P71015
//  2. Insert COOPESOCIOS: 026400 (ESPINOZA, del extracto P26400), K01121 (PRADA)
//  3. Rename MAESTROCLIENTESSALDOS: P26400→026400
// Uso: node scripts/fix-socios-codes.js [--apply]
//   sin --apply → dry-run (backup a archivo + muestra lo que haría)
//   con --apply → ejecuta y deja backup en scripts/data/backup-socios-codes-<ts>.json

require("dotenv").config();
const ibmdb = require("ibm_db");
const fs = require("fs");
const path = require("path");

const cs = process.env.DB2_CONNECTION_STRING;

const RENAMES_COOP = [
  ["K03348", "K00334"],
  ["K01568", "K01546"],
  ["071015", "P71015"],
];

// Nuevos socios: { codigo, extractFile: { docume, ... } } — datos tomados del extracto
// (22 campos). Código correcto según José. Se inserta con ACTIVO=true, CODPAIS=815.
const NEW_SOCIOS = [
  { codigo: "026400", fromExtract: "P26400" },
  { codigo: "K01121", fromExtract: "K01121" },
];

const EXTRACT_PATH = "C:/Users/abiga/Downloads/Datos-socios202608.txt (1).csv";

// columnas personales V11 en el orden del extracto (sin LUGNAC, no existe en db2)
const PERSONAL_COLS = [
  "TIPDID", "DOCIDE", "APEPAT", "APEMAT", "NOMBRE", "DIRECC", "LOCALI",
  "PROVIN", "DEPART", "NCOMPL", "NOMBC2", "TELCEL", "NACION", "CCIUDA",
  "NOMCON", "DNICY", "ESTCIV", "CARGAM", "OFICIO", "SECTO1",
];

function readExtract() {
  const content = fs.readFileSync(EXTRACT_PATH, "utf-8");
  const map = {};
  for (const line of content.split(/\r?\n/).filter((l) => l.trim())) {
    const parts = line.split(";");
    const docume = (parts[0] || "").trim();
    if (docume && docume !== "\x1a") map[docume] = parts.map((p) => (p == null ? "" : String(p).trim()));
  }
  return map;
}

async function run() {
  const apply = process.argv.includes("--apply");
  const extract = readExtract();
  const conn = await ibmdb.open(cs);
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupPath = path.join(__dirname, "data", `backup-socios-codes-${ts}.json`);
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

  const backup = { ts, renames: {}, inserts: {}, saldos: {} };

  // ── 1. Backups de las filas afectadas ───────────────────────────────
  const codesToBackup = ["K03348", "K01568", "071015", "P26400", "026400", "K01121", "K00334", "K01546", "P71015"];
  const ph = codesToBackup.map(() => "?").join(",");
  const coopRows = await conn.query(
    `SELECT * FROM COOPESOCIOS WHERE TRIM(CODEMPLEADO) IN (${ph})`,
    codesToBackup
  );
  backup.renames.coopesocios = coopRows;
  const saldosRows = await conn.query(
    `SELECT * FROM MAESTROCLIENTESSALDOS WHERE TRIM(CODEMPLEADO) IN (${ph})`,
    codesToBackup
  );
  backup.saldos.all = saldosRows;
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backup guardado: ${backupPath} (${coopRows.length} coop + ${saldosRows.length} saldos)`);

  // ── 2. Validaciones de pre-condición ────────────────────────────────
  const existingTargets = new Set(coopRows.map((r) => r.CODEMPLEADO.trim()));
  // Para renames: el destino debe existir YA SOLO si proviene del mismo origen
  // (rename ya aplicado en una corrida previa). Si el destino existe con otro
  // origen, sería un choque real y abortamos.
  for (const [from, to] of RENAMES_COOP) {
    const fromExists = coopRows.some((r) => r.CODEMPLEADO.trim() === from);
    const toExists = existingTargets.has(to);
    if (toExists && fromExists) {
      console.error(`ERROR: destino ${to} ya existe Y el origen ${from} sigue presente — choque, abortando`);
      await conn.close(); process.exit(1);
    }
    // si destino existe y origen NO existe → ya se aplicó, ok (idempotente)
  }
  for (const n of NEW_SOCIOS) {
    if (existingTargets.has(n.codigo)) {
      console.error(`ERROR: ${n.codigo} ya existe — abortando`);
      await conn.close(); process.exit(1);
    }
  }

  // ── 3. Ejecutar ─────────────────────────────────────────────────────
  console.log("\n── Renames COOPESOCIOS ──");
  for (const [from, to] of RENAMES_COOP) {
    const has = coopRows.some((r) => r.CODEMPLEADO.trim() === from);
    console.log(`  ${from} → ${to} ${has ? "(existe)" : "(NO existe — se omite)"}`);
    if (apply && has) {
      await conn.query(`UPDATE COOPESOCIOS SET CODEMPLEADO = ? WHERE TRIM(CODEMPLEADO) = ?`, [to, from]);
    }
  }

  console.log("\n── Inserts COOPESOCIOS (nuevos socios) ──");
  const { randomUUID } = require("crypto");
  for (const n of NEW_SOCIOS) {
    const src = extract[n.fromExtract];
    if (!src) { console.log(`  ${n.codigo}: no se encontró ${n.fromExtract} en extracto — omitido`); continue; }
    const values = {};
    PERSONAL_COLS.forEach((col, i) => { values[col] = src[i + 1] || ""; }); // offset por DOCUME (idx 0)
    // metadata (columnas NOT NULL y contexto corporativo)
    values.NOMBREEMPLEADO = src[10] || src[5] || ""; // NCOMPL como nombre completo corporativo
    values.UUID = randomUUID();
    values.ACTIVO = true;
    values.CODPAIS = "815";
    values.INBLUEPAGES = false; // no está en BluePages (correo personal/kyndryl)
    values.ISADMIN = false;
    const exists = coopRows.some((r) => r.CODEMPLEADO.trim() === n.codigo);
    console.log(`  ${n.codigo} (de ${n.fromExtract}): ${values.NOMBRE} — ${exists ? "YA EXISTE (omitido)" : "a insertar"}`);
    if (apply && !exists) {
      const extraCols = ["NOMBREEMPLEADO", "UUID", "ACTIVO", "INBLUEPAGES", "ISADMIN", "CODPAIS"];
      const cols = ["CODEMPLEADO", ...PERSONAL_COLS, ...extraCols];
      const ph2 = cols.map(() => "?").join(",");
      const params = [
        n.codigo,
        ...PERSONAL_COLS.map((c) => values[c]),
        values.NOMBREEMPLEADO, values.UUID, values.ACTIVO, values.INBLUEPAGES, values.ISADMIN, values.CODPAIS,
      ];
      await conn.query(`INSERT INTO COOPESOCIOS (${cols.join(",")}) VALUES (${ph2})`, params);
    }
  }

  console.log("\n── Rename MAESTROCLIENTESSALDOS ──");
  const p26400Count = saldosRows.filter((r) => r.CODEMPLEADO.trim() === "P26400").length;
  console.log(`  P26400 → 026400 (${p26400Count} filas de saldos)`);
  if (apply && p26400Count > 0) {
    await conn.query(`UPDATE MAESTROCLIENTESSALDOS SET CODEMPLEADO = ? WHERE TRIM(CODEMPLEADO) = ?`, ["026400", "P26400"]);
  }

  await conn.close();

  console.log(`\n${apply ? "✅ APLICADO" : "🔍 DRY-RUN (no escribió nada)"} — backup en ${backupPath}`);
  if (!apply) console.log("Para aplicar: node scripts/fix-socios-codes.js --apply");
}

run().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });