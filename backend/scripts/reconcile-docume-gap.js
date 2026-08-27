#!/usr/bin/env node
// Reconcile DOCUME gap: identify DOCUME codes in José's extract that don't exist in COOPESOCIOS.
// Usage: node scripts/reconcile-docume-gap.js <path-to-extract-file>
// Extract file format: semicolon-delimited, 22 fields, first field = DOCUME
// Requires env vars: DB2_HOST, DB2_PORT, DB2_USER, DB2_PASSWORD, DB2_DATABASE, DB2_SCHEMA

require("dotenv").config();
const ibmdb = require("ibm_db");
const fs = require("fs");
const path = require("path");

const connStr = `DATABASE=${process.env.DB2_DATABASE};HOSTNAME=${process.env.DB2_HOST};PORT=${process.env.DB2_PORT};PROTOCOL=TCPIP;UID=${process.env.DB2_USER};PWD=${process.env.DB2_PASSWORD};SCHEMA=${process.env.DB2_SCHEMA};Security=SSL;`;

async function run() {
  const extractPath = process.argv[2];
  if (!extractPath) {
    console.error("Usage: node reconcile-docume-gap.js <path-to-extract-file>");
    process.exit(1);
  }

  if (!process.env.DB2_PASSWORD) {
    console.error("ERROR: DB2_PASSWORD no está seteado.");
    process.exit(1);
  }

  // 1. Parse extract file — get all DOCUME codes
  const content = fs.readFileSync(extractPath, "utf-8");
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const extractDocumes = new Set();
  for (const line of lines) {
    const parts = line.split(";");
    const docume = (parts[0] || "").trim();
    if (docume && docume.length <= 6) {
      extractDocumes.add(docume);
    }
  }
  console.log(`Extract: ${extractDocumes.size} DOCUME codes (from ${lines.length} lines)`);

  // 2. Query COOPESOCIOS — get all CODEMPLEADO values
  const conn = await ibmdb.open(connStr);
  const rows = await conn.query(`SELECT TRIM(CODEMPLEADO) AS DOCUME FROM COOPESOCIOS`);
  const dbDocumes = new Set(rows.map(r => r.DOCUME.trim()));
  console.log(`DB2: ${dbDocumes.size} CODEMPLEADO values in COOPESOCIOS`);

  // 3. Find DOCUME in extract but NOT in DB2
  const missing = [];
  for (const docume of extractDocumes) {
    if (!dbDocumes.has(docume)) {
      missing.push(docume);
    }
  }

  console.log(`\n=== RESULT: ${missing.length} DOCUME codes in extract but NOT in COOPESOCIOS ===`);
  if (missing.length === 0) {
    console.log("✅ No gap — all extract DOCUME codes exist in DB2.");
  } else {
    for (const d of missing.sort()) {
      console.log(`  ${d}`);
    }
    console.log(`\nThese ${missing.length} codes are in José's S400 extract but have no matching record in COOPESOCIOS.`);
    console.log("Ask José: are these inactive/closed accounts, or records that should exist in DB2?");
  }

  // 4. Also check: DOCUME in DB2 but NOT in extract (new socios since extract)
  const dbOnly = [];
  for (const docume of dbDocumes) {
    if (!extractDocumes.has(docume)) {
      dbOnly.push(docume);
    }
  }
  if (dbOnly.length > 0) {
    console.log(`\n=== BONUS: ${dbOnly.length} DOCUME in DB2 but NOT in extract (new since extract) ===`);
    for (const d of dbOnly.sort()) {
      console.log(`  ${d}`);
    }
  }

  await conn.close();
  console.log("\n✅ Reconciliation complete.");
}

run().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
