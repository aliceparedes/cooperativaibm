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
// el TXT de ancho fijo con todos los socios desde la BD (~4 veces al año).

const SOCIO_KEYS = txt.LAYOUT.map((c) => c.key).filter((k) => k !== "DOCUME");

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

  const saved = await store.saveSocio(next);
  res.json({ ok: true, socio: saved });
});

// genera el TXT de ancho fijo con todos los socios (admin, oculto)
app.post("/api/socios/txt", requireAdmin, async (req, res) => {
  const socios = await store.listSocios();
  if (!socios.length) return res.status(400).json({ error: "No hay socios." });
  const result = txt.build(socios);
  if (result.hasErrors) {
    return res.status(422).json({ error: "Hay filas con errores.", report: result.report });
  }
  res.json({ ok: true, txt: result.txt, bytes: Buffer.byteLength(result.txt, "utf8") });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cooperativa IBM backend listening on port ${port}`));
