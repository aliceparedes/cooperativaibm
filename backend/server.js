require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { login, requireAdmin } = require("./src/auth");
const store = require("./src/store");
const txt = require("./src/txt");

const app = express();
app.use(express.json());

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({ origin: allowedOrigin }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/auth/login", async (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: "Falta usuario o contraseña." });
  const token = await login(user, pass);
  if (!token) return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  res.json({ token });
});

app.get("/api/content", async (req, res) => {
  const data = await store.getAll();
  res.json(data);
});

app.post("/api/anuncios", requireAdmin, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: "El anuncio no puede estar vacío." });
  const post = await store.addAnuncio(text.trim());
  res.status(201).json(post);
});

app.delete("/api/anuncios/:id", requireAdmin, async (req, res) => {
  await store.removeAnuncio(req.params.id);
  res.status(204).end();
});

app.post("/api/proveedores", requireAdmin, async (req, res) => {
  const { name, cat, desc, disc } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Falta el nombre del proveedor." });
  const prov = await store.addProveedor({
    name: name.trim(),
    cat: (cat || "").trim() || "General",
    desc: (desc || "").trim(),
    disc: (disc || "").trim() || "Beneficios"
  });
  res.status(201).json(prov);
});

app.delete("/api/proveedores/:id", requireAdmin, async (req, res) => {
  await store.removeProveedor(req.params.id);
  res.status(204).end();
});

app.put("/api/tasas", requireAdmin, async (req, res) => {
  const allowed = ["hipotecario", "vehicular", "educativo", "salud"];
  const patch = {};
  for (const k of allowed) {
    const v = req.body && req.body[k];
    if (typeof v === "number" && !Number.isNaN(v)) patch[k] = v;
  }
  const tasas = await store.updateTasas(patch);
  res.json(tasas);
});

// ---------- socios: perfiles autoservicio + TXT bulk para el S400 ----------
// Los socios leen/actualizan su propio perfil (login demo) y el admin genera
// el TXT delimitado con todos los socios desde la BD.

function pickSocioFields(body) {
  const out = {};
  for (const col of txt.LAYOUT) {
    const k = col.key;
    if (k === "DOCUME") continue;
    if (body[k] !== undefined) out[k] = body[k] == null ? "" : String(body[k]);
  }
  return out;
}

// lista todos los socios (admin)
app.get("/api/socios", requireAdmin, async (req, res) => {
  const socios = await store.listSocios();
  res.json({ socios });
});

// perfil de un socio
app.get("/api/socios/:docume", async (req, res) => {
  const socio = await store.getSocio(req.params.docume);
  if (!socio) return res.status(404).json({ error: "Socio no encontrado." });
  res.json({ socio });
});

// actualizar perfil de un socio (autoservicio demo)
app.put("/api/socios/:docume", async (req, res) => {
  const docume = String(req.params.docume || "").trim();
  const existing = await store.getSocio(docume);
  const base = existing || { DOCUME: docume };
  const patch = pickSocioFields(req.body || {});
  const next = { ...base, ...patch, DOCUME: docume };

  const errors = txt.validateRow(next);
  if (docume.trim() === "") errors.unshift({ key: "DOCUME", field: "DOCUME", msg: "DOCUME es obligatorio (clave del socio)." });
  if (errors.length) return res.status(422).json({ error: "Hay campos con errores.", report: [{ row: 1, docume, errors }] });

  // Persist the updated profile
  await store.saveSocio(next);

  // Create pending changes for each modified field
  const changes = [];
  for (const [field, value] of Object.entries(patch)) {
    if (field !== "DOCUME" && value !== (existing ? existing[field] : undefined)) {
      const change = await store.addChange({
        docume,
        field,
        value,
        previousValue: existing ? existing[field] : null
      });
      changes.push(change);
    }
  }

  res.json({ ok: true, socio: next, pendingChanges: changes.length });
});

// genera el TXT delimitado con cambios pendientes (admin)
app.post("/api/socios/txt", requireAdmin, async (req, res) => {
  const pendingChanges = await store.getPendingChanges();
  if (!pendingChanges.length) {
    return res.status(400).json({ error: "No hay cambios pendientes." });
  }

  // Consolidate changes by socio (last value wins per field)
  const changesBySocio = {};
  for (const change of pendingChanges) {
    if (!changesBySocio[change.docume]) {
      changesBySocio[change.docume] = { DOCUME: change.docume };
    }
    // Last value wins for the same field
    changesBySocio[change.docume][change.field] = change.value;
  }

  // Build rows from consolidated changes
  const rows = Object.values(changesBySocio);
  const result = txt.build(rows);
  
  if (result.hasErrors) {
    return res.status(422).json({ error: "Hay filas con errores.", report: result.report });
  }

  // Create batch
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  const batchId = `BATCH-${timestamp}`;
  const filename = `socios_delta_${timestamp}.txt`;
  
  const batch = await store.createBatch({
    id: batchId,
    filename,
    recordCount: rows.length,
    status: "EXPORTED",
    createdBy: req.user?.username || "admin",
    txt: result.txt  // Store the TXT content with the batch
  });

  // Mark all pending changes as EXPORTED and associate with batch
  for (const change of pendingChanges) {
    await store.updateChangeStatus(change.id, "EXPORTED", batch.id);
  }

  res.json({
    ok: true,
    batch: {
      id: batch.id,
      filename: batch.filename,
      recordCount: batch.recordCount,
      createdAt: batch.createdAt
    },
    txt: result.txt,
    bytes: Buffer.byteLength(result.txt, "utf8")
  });
});
// admin: ver cambios pendientes
app.get("/api/admin/pending-changes", requireAdmin, async (req, res) => {
  const pendingChanges = await store.getPendingChanges();
  
  // Group by socio for easier display
  const changesBySocio = {};
  for (const change of pendingChanges) {
    if (!changesBySocio[change.docume]) {
      changesBySocio[change.docume] = {
        docume: change.docume,
        changes: []
      };
    }
    changesBySocio[change.docume].changes.push({
      id: change.id,
      field: change.field,
      value: change.value,
      previousValue: change.previousValue,
      createdAt: change.createdAt
    });
  }

  const summary = {
    totalSocios: Object.keys(changesBySocio).length,
    totalChanges: pendingChanges.length,
    socios: Object.values(changesBySocio)
  };

  res.json(summary);
});

// admin: ver historial de batches
app.get("/api/admin/batches", requireAdmin, async (req, res) => {
  const batches = await store.listBatches();
  // Sort by creation date, newest first
  batches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ batches });
});

// admin: obtener un batch específico
app.get("/api/admin/batches/:id", requireAdmin, async (req, res) => {
  const batch = await store.getBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: "Batch no encontrado." });
  
  // Get all changes associated with this batch
  const allChanges = await store.listChanges();
  const batchChanges = allChanges.filter((c) => c.batchId === batch.id);
  
  res.json({ batch, changes: batchChanges });
});

// admin: download historical batch TXT
app.get("/api/admin/batches/:id/download", requireAdmin, async (req, res) => {
  const batch = await store.getBatch(req.params.id);
  
  if (!batch) {
    return res.status(404).json({ error: "Batch no encontrado." });
  }
  
  if (!batch.txt) {
    return res.status(404).json({
      error: "El TXT de este batch no está disponible. Los batches antiguos no almacenaban el contenido."
    });
  }
  
  // Return the historical TXT content
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${batch.filename}"`);
  res.send(batch.txt);
});


const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cooperativa IBM backend listening on port ${port}`));
