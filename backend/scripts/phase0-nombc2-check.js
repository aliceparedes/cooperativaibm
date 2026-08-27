#!/usr/bin/env node
// Fase 0: validar cobertura y unicidad de NOMBC2 (correo) en db2.
// Ejecutar: node scripts/phase0-nombc2-check.js
// Requiere env vars: DB2_HOST, DB2_PORT, DB2_USER, DB2_PASSWORD, DB2_DATABASE, DB2_SCHEMA
// ⚠️ NUNCA hardcodear la pwd — usar process.env o secret de CE.

require("dotenv").config();
const ibmdb = require("ibm_db");

const connStr = `DATABASE=${process.env.DB2_DATABASE};HOSTNAME=${process.env.DB2_HOST};PORT=${process.env.DB2_PORT};PROTOCOL=TCPIP;UID=${process.env.DB2_USER};PWD=${process.env.DB2_PASSWORD};SCHEMA=${process.env.DB2_SCHEMA};Security=SSL;`;

async function run() {
  if (!process.env.DB2_PASSWORD) {
    console.error("ERROR: DB2_PASSWORD no está seteado. Rotar la pwd y setear el env var antes de correr esto.");
    process.exit(1);
  }

  const conn = await ibmdb.open(connStr);

  // 1. Cobertura: cuántos de los 529 migrados tienen NOMBC2 no vacío
  const coverage = await conn.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN NOMBC2 IS NOT NULL AND TRIM(NOMBC2) <> '' THEN 1 ELSE 0 END) AS con_correo,
      SUM(CASE WHEN NOMBC2 IS NULL OR TRIM(NOMBC2) = '' THEN 1 ELSE 0 END) AS sin_correo
    FROM COOPESOCIOS
  `);

  console.log("=== COBERTURA NOMBC2 ===");
  console.log(coverage[0]);

  // 2. Unicidad: codempleado duplicados por NOMBC2 (un correo → 2 socios = problema)
  const duplicates = await conn.query(`
    SELECT NOMBC2, COUNT(*) AS repeticiones,
           LISTAGG(CODEMPLEADO, ', ') WITHIN GROUP (ORDER BY CODEMPLEADO) AS documentos
    FROM COOPESOCIOS
    WHERE NOMBC2 IS NOT NULL AND TRIM(NOMBC2) <> ''
    GROUP BY NOMBC2
    HAVING COUNT(*) > 1
    ORDER BY repeticiones DESC
  `);

  console.log("\n=== DUPLICADOS (un correo → múltiples DOCUME) ===");
  if (duplicates.length === 0) {
    console.log("✅ No hay duplicados — cada correo mapea a un solo DOCUME.");
  } else {
    console.log(`⚠️  ${duplicates.length} correo(s) mapean a más de un DOCUME:`);
    for (const d of duplicates) {
      console.log(`  ${d.NOMBC2.trim()} → ${d.REPICIONES} socios: ${d.DOCUMENTOS}`);
    }
  }

  // 3. Muestra de correos (para verificar formato)
  const sample = await conn.query(`
    SELECT CODEMPLEADO, NOMBC2
    FROM COOPESOCIOS
    WHERE NOMBC2 IS NOT NULL AND TRIM(NOMBC2) <> ''
    ORDER BY CODEMPLEADO
    FETCH FIRST 10 ROWS ONLY
  `);

  console.log("\n=== MUESTRA (10 primeros) ===");
  for (const s of sample) {
    console.log(`  ${s.CODEMPLEADO.trim()} → ${s.NOMBC2.trim()}`);
  }

  await conn.close();
  console.log("\n✅ Query completada.");
}

run().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
