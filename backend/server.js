require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { login, requireAdmin } = require("./src/auth");
const store = require("./src/store");

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
  const allowed = ["sola-firma", "consumo", "largo-plazo", "automotriz", "hipotecario", "garantia", "academico"];
  const patch = {};
  for (const k of allowed) {
    const v = req.body && req.body[k];
    if (typeof v === "number" && !Number.isNaN(v)) patch[k] = v;
  }
  const tasas = await store.updateTasas(patch);
  res.json(tasas);
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cooperativa IBM backend listening on port ${port}`));
