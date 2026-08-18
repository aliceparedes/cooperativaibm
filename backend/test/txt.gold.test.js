const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { build, serializeRow, validateRow } = require("../src/txt");

const GOLD = fs.readFileSync(
  path.join(__dirname, "fixtures", "cooperativa-txt-prueba.gold.txt"),
  "utf8"
);

// Delta rows: read-only fields (TIPDID, DOCIDE, NACION, DNICY) are never part of
// a real portal delta — pickSocioFields() strips them — so they're absent here.
const rows = [
  {
    DOCUME: "B00003", APEPAT: "BURGOS", APEMAT: "RAMOS", NOMBRE: "JUAN HECTOR",
    DIRECC: "CALLE EL CARMEN 118 LT 9A PPJJ", LOCALI: "PISCO",
    PROVIN: "ICA", DEPART: "ICA", NCOMPL: "BURGOS RAMOS JUAN HECTOR",
    NOMBC2: "juan.burgos@bluetab.net", TELCEL: "953693912",
    CCIUDA: "110102", NOMCON: "", ESTCIV: "S", CARGAM: "3", OFICIO: "ING DE SIST E INFORM", SECTO1: "0"
  },
  {
    DOCUME: "888888", ESTCIV: "S", OFICIO: "INGENIERO"
  },
  {
    DOCUME: "B00008", APEPAT: "NAMUCHE", APEMAT: "MALDONADO", NOMBRE: "LUIS EDUARDO",
    DIRECC: "JR RICARDO AICARDI 345 DPTO 101", LOCALI: "STGO SURCO",
    PROVIN: "LIMA", DEPART: "LIMA", NCOMPL: "NAMUCHE MALDONADO LUIS EDUARDO",
    NOMBC2: "LUIS.NAMUCHE@BLUETAB.NET", TELCEL: "966881929",
    CCIUDA: "150140", NOMCON: "", ESTCIV: "S", CARGAM: "1", OFICIO: "INGENIERO", SECTO1: "0"
  },
  {
    DOCUME: "999001", ESTCIV: "C"
  }
];

let allOk = true;
function check(name, fn) {
  try {
    fn();
    console.log("  ok  " + name);
  } catch (e) {
    allOk = false;
    console.error("FAIL  " + name + "\n      " + e.message);
  }
}

console.log("txt.gold.test — formato delimitado (21 campos, CRLF, vacío = no tocar)\n");

check("build() reproduce el gold byte a byte", () => {
  const { hasErrors, report, txt } = build(rows);
  assert.strictEqual(hasErrors, false, "no debería haber errores: " + JSON.stringify(report));
  assert.strictEqual(txt, GOLD);
});

check("campo vacío = no tocar (sin padding)", () => {
  const r = build([{ DOCUME: "888888", ESTCIV: "S", OFICIO: "INGENIERO" }]);
  assert.strictEqual(r.txt, "888888;;;;;;;;;;;;;;;;;S;;INGENIERO;");
});

check("fila tiene 21 campos (20 separadores) y usa CRLF", () => {
  const r = build([{ DOCUME: "999999" }]);
  assert.strictEqual(r.txt.split(";").length, 21, "la fila debe tener exactamente 21 campos");
  assert.strictEqual(r.txt, "999999;;;;;;;;;;;;;;;;;;;;");
  const two = build([{ DOCUME: "100000" }, { DOCUME: "100001" }]);
  assert.strictEqual(two.txt, "100000;;;;;;;;;;;;;;;;;;;;\r\n100001;;;;;;;;;;;;;;;;;;;;");
});

check("validación: exceso de longitud en char", () => {
  const bad = build([{ DOCUME: "999999", NOMBRE: "A".repeat(31) }]);
  assert.strictEqual(bad.hasErrors, true);
  assert.ok(bad.report[0].errors.some((e) => e.key === "NOMBRE"));
  assert.strictEqual(bad.txt, "");
});

check("validación: zoned no numérico", () => {
  const bad = build([{ DOCUME: "999999", TELCEL: "12x" }]);
  assert.strictEqual(bad.hasErrors, true);
  const err = bad.report[0].errors.find((e) => e.key === "TELCEL");
  assert.ok(err && /numerico/.test(err.msg));
});

check("validación: valor no puede contener ';'", () => {
  const bad = build([{ DOCUME: "999999", APEPAT: "NUÑEZ;X" }]);
  assert.strictEqual(bad.hasErrors, true);
  const err = bad.report[0].errors.find((e) => e.key === "APEPAT");
  assert.ok(err && /separador/.test(err.msg));
});

check("validación: DNICY admite máx 8 dígitos", () => {
  const ok = validateRow({ DOCUME: "999999", DNICY: "12345678" });
  assert.deepStrictEqual(ok, []);
  const bad = build([{ DOCUME: "999999", DNICY: "123456789" }]);
  assert.strictEqual(bad.hasErrors, true);
  assert.ok(bad.report[0].errors.some((e) => e.key === "DNICY" && /8/.test(e.msg)));
});

check("validación: DOCUME obligatorio y máx 6", () => {
  const bad = build([{ NOMBRE: "SIN CLAVE" }]);
  assert.strictEqual(bad.hasErrors, true);
  const err = bad.report[0].errors.find((e) => e.key === "DOCUME");
  assert.ok(err && /obligatorio/.test(err.msg));
  const bad2 = build([{ DOCUME: "1234567" }]);
  assert.strictEqual(bad2.hasErrors, true);
});

check("validación: aislar fila con error (no tira el resto)", () => {
  const res = build([
    { DOCUME: "999003", ESTCIV: "S" },
    { DOCUME: "999005", NOMBRE: "X".repeat(31) }
  ]);
  assert.strictEqual(res.hasErrors, true);
  assert.strictEqual(res.report.length, 1, "solo la fila 2 falla");
  assert.strictEqual(res.report[0].row, 2);
  assert.ok(/999003/.test(res.txt), "la fila buena sigue presente");
});

check("validacion: catalogos cerrados del TXT", () => {
  const badTipdid = build([{ DOCUME: "999999", TIPDID: "2" }]);
  assert.strictEqual(badTipdid.hasErrors, true);
  assert.ok(badTipdid.report[0].errors.some((e) => e.key === "TIPDID"));

  const badNacion = build([{ DOCUME: "999999", NACION: "150101" }]);
  assert.strictEqual(badNacion.hasErrors, true);
  assert.ok(badNacion.report[0].errors.some((e) => e.key === "NACION"));

  const badEstciv = build([{ DOCUME: "999999", ESTCIV: "X" }]);
  assert.strictEqual(badEstciv.hasErrors, true);
  assert.ok(badEstciv.report[0].errors.some((e) => e.key === "ESTCIV"));
});

check("serializacion: catalogos se normalizan antes de salir", () => {
  const r = build([{ DOCUME: "999999", ESTCIV: "c" }]);
  assert.strictEqual(r.hasErrors, false);
  assert.strictEqual(r.txt, "999999;;;;;;;;;;;;;;;;;C;;;");
});

check("readOnly: serializeRow nunca transmite identidad/nacionalidad en delta", () => {
  const out = serializeRow({
    DOCUME: "999999", TIPDID: "1", DOCIDE: "12345678", NACION: "1", DNICY: "87654321",
    APEPAT: "NUÑEZ"
  });
  const fields = out.split(";");
  assert.strictEqual(fields[0], "999999", "DOCUME (clave) sobrevive");
  assert.strictEqual(fields[1], "", "TIPDID no se transmite");
  assert.strictEqual(fields[2], "", "DOCIDE no se transmite");
  assert.strictEqual(fields[3], "NUÑEZ", "campo editable se serializa");
  assert.strictEqual(fields[13], "", "NACION no se transmite");
  assert.strictEqual(fields[16], "", "DNICY no se transmite");
});

check("validateRow acepta valores readOnly del socio base (estado completo)", () => {
  const row = {
    DOCUME: "999999", TIPDID: "1", DOCIDE: "12345678", NACION: "1"
  };
  assert.deepStrictEqual(validateRow(row), [], "el estado base mergeado debe validar");
});

check("catalogo TIPDID cerrado a DNI (1)", () => {
  const bad = build([{ DOCUME: "999999", TIPDID: "2" }]);
  assert.strictEqual(bad.hasErrors, true);
  assert.ok(bad.report[0].errors.some((e) => e.key === "TIPDID"));
});
if (!allOk) {
  console.error("\nFAILURES — revisa el módulo o el fixture.");
  process.exit(1);
}
console.log("\nTODO OK — el serializador reproduce el TXT delimitado de José.");