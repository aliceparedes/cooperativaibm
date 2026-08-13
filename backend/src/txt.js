// Delimited TXT serializer for socios data updates (track 2).
// 21 fields per row, semicolon-delimited ("campo;campo;campo..."), UTF-8, CRLF.
// An empty field means the value did not change (no tocar). Rows have exactly
// 21 fields (20 separators, no trailing ";") — matches the prod loader,
// which splits on ";" and requires exactly 21 parts.

const CATALOGS = {
  TIPDID: new Set(["1", "4", "7"]),
  NACION: new Set(["1", "2"]),
  ESTCIV: new Set(["S", "C", "V", "D"])
};

const LAYOUT = [
  { key: "DOCUME", field: "DOCUME", length: 6, type: "char", note: "clave — código del socio (nunca editable)" },
  { key: "TIPDID", field: "TIPDID", length: 1, type: "char" },
  { key: "DOCIDE", field: "DOCIDE", length: 11, type: "zoned" },
  { key: "APEPAT", field: "APEPAT", length: 20, type: "char" },
  { key: "APEMAT", field: "APEMAT", length: 20, type: "char" },
  { key: "NOMBRE", field: "NOMBRE", length: 30, type: "char" },
  { key: "DIRECC", field: "DIRECC", length: 80, type: "char" },
  { key: "LOCALI", field: "LOCALI", length: 40, type: "char" },
  { key: "PROVIN", field: "PROVIN", length: 40, type: "char" },
  { key: "DEPART", field: "DEPART", length: 40, type: "char" },
  { key: "NCOMPL", field: "NCOMPL", length: 60, type: "char" },
  { key: "NOMBC2", field: "NOMBC2", length: 50, type: "char" },
  { key: "TELCEL", field: "TELCEL", length: 9, type: "zoned" },
  { key: "NACION", field: "NACION", length: 1, type: "char", note: "nacionalidad — 1=Peruana, 2=Extranjera" },
  { key: "CCIUDA", field: "CCIUDA", length: 6, type: "zoned", note: "ciudad de trabajo (Ubigeo)" },
  { key: "NOMCON", field: "NOMCON", length: 40, type: "char" },
  { key: "DNICY", field: "DNICY", length: 8, type: "zoned", note: "DNI del cónyuge" },
  { key: "ESTCIV", field: "ESTCIV", length: 1, type: "char" },
  { key: "CARGAM", field: "CARGAM", length: 2, type: "zoned" },
  { key: "OFICIO", field: "OFICIO", length: 20, type: "char" },
  { key: "SECTO1", field: "SECTO1", length: 2, type: "zoned" }
];

const NO_TOUCH = "";

function byteLen(s) {
  return Buffer.byteLength(s, "utf8");
}

// In the delimited format an empty field means "no tocar".
function isNoTouch(v) {
  return v == null || v === "";
}

function hasFieldBreaks(raw) {
  return raw.includes(";") || /[\r\n]/.test(raw);
}

function normalizeCatalogValue(raw) {
  return String(raw).trim().toUpperCase();
}

// Returns [] when ok, or [{ key, field, msg }].
function validateRow(row) {
  const errors = [];
  const docume = row && row.DOCUME != null ? String(row.DOCUME) : "";

  if (docume.trim() === "") {
    errors.push({ key: "DOCUME", field: "DOCUME", msg: "DOCUME es obligatorio (clave del socio)." });
  } else if (byteLen(docume) > 6) {
    errors.push({ key: "DOCUME", field: "DOCUME", msg: "DOCUME excede 6 bytes." });
  } else if (hasFieldBreaks(docume)) {
    errors.push({ key: "DOCUME", field: "DOCUME", msg: "DOCUME no puede contener ';' ni saltos de linea." });
  }

  for (const col of LAYOUT) {
    if (col.key === "DOCUME") continue;
    const raw = row && row[col.key] != null ? String(row[col.key]) : "";
    if (isNoTouch(raw)) continue;
    if (raw.includes(";")) {
      errors.push({ key: col.key, field: col.field, msg: col.field + " no puede contener el caracter ';' (separador)." });
      continue;
    }
    if (/[\r\n]/.test(raw)) {
      errors.push({ key: col.key, field: col.field, msg: col.field + " no puede contener saltos de linea." });
      continue;
    }
    if (CATALOGS[col.key]) {
      if (!CATALOGS[col.key].has(normalizeCatalogValue(raw))) {
        const allowed = Array.from(CATALOGS[col.key]).join(", ");
        errors.push({ key: col.key, field: col.field, msg: col.field + " debe ser uno de: " + allowed + "." });
      }
      continue;
    }
    if (col.type === "zoned") {
      if (!/^\d+$/.test(raw)) {
        errors.push({ key: col.key, field: col.field, msg: col.field + " debe ser numerico (zoned)." });
      } else if (raw.length > col.length) {
        errors.push({ key: col.key, field: col.field, msg: col.field + " excede " + col.length + " digitos." });
      }
    } else if (byteLen(raw) > col.length) {
      errors.push({ key: col.key, field: col.field, msg: col.field + " excede " + col.length + " bytes." });
    }
  }

  return errors;
}

function serializeRow(row) {
  const parts = [];
  for (const col of LAYOUT) {
    const raw = row && row[col.key] != null ? String(row[col.key]) : "";
    const value = CATALOGS[col.key] ? normalizeCatalogValue(raw) : raw;
    parts.push(isNoTouch(raw) ? "" : value);
  }
  return parts.join(";");
}

// Returns { hasErrors, report: [{row, docume, errors[]}], txt }.
function build(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const serialized = [];
  const report = [];
  let hasErrors = false;

  list.forEach((row, i) => {
    const errs = validateRow(row);
    if (errs.length) {
      hasErrors = true;
      report.push({ row: i + 1, docume: (row && row.DOCUME) || "", errors: errs });
    } else {
      serialized.push(serializeRow(row));
    }
  });

  return { hasErrors, report, txt: serialized.join("\r\n") };
}

module.exports = { LAYOUT, CATALOGS, NO_TOUCH, byteLen, isNoTouch, validateRow, serializeRow, build };