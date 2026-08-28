const fs = require("fs");
const path = require("path");

const DEFAULT_DATA = {
  tasas: { "sola-firma": 13, consumo: 13, "largo-plazo": 12, automotriz: 8.0, hipotecario: 8, garantia: 11, academico: 8.75 },
  changes: [],
  batches: [],
  anuncios: [
    {
      id: "seed-1",
      author: "Cooperativa IBM",
      role: "Administrador",
      tag: "Anuncio",
      text: "📢 ¡Bienvenido al panel de anuncios! Los mensajes que publiques aquí como administrador se mostrarán a todos los visitantes del sitio.",
      createdAt: new Date().toISOString()
    }
  ],
  proveedores: [
    { id: "seed-1", name: "Rímac Seguros", cat: "Seguro de Autos", desc: "Mejor tarifa del mercado, descuento de la prima en 18 meses sin recargo de intereses.", disc: "Tarifa corporativa" },
    { id: "seed-2", name: "Oncosalud", cat: "Salud", desc: "Convenio corporativo para socios y familiares directos.", disc: "18% dcto." }
  ],
  historia: [
    { id: "seed-1", date: "18 jul. 1942", text: "Fundada como \"Asociación de Empleados\"." },
    { id: "seed-2", date: "12 dic. 1963", text: "Reconocida oficialmente como \"Cooperativa de Servicios Múltiples\"." },
    { id: "seed-3", date: "4 ene. 1995", text: "Registrada como \"Cooperativa de Ahorro y Crédito de los Empleados de IBM\"." },
    { id: "seed-4", date: "7 feb. 2019", text: "Inscrita en el Registro Nacional de Cooperativas de Ahorro y Crédito, supervisada por la SBS." }
  ],
  productos: {
    bebidas: { title: "Bebidas", cat: "Licores y bebidas", desc: "Lista de precios de nuestro proveedor de licores para socios: whisky, vinos, piscos, ron y más." },
    rimac: { title: "Rímac Seguros", cat: "Seguro de Autos", desc: "Programa de seguro vehicular corporativo para socios de la Cooperativa." },
    movistar: { title: "Movistar", cat: "Telefonía celular", desc: "Contrato corporativo con planes de datos, LDI y descuentos en equipos. La línea pasa a ser corporativa y se descuenta por planilla." },
    perufarma: { title: "Perufarma", cat: "Farmacias", desc: "Catálogo corporativo con precios preferenciales en dermocosmética, cuidado personal y más." },
    smartfit: { title: "Smart Fit", cat: "Gimnasio", desc: "Plan Black Corporativo, exclusivo para colaboradores de la Cooperativa." },
    oncosalud: { title: "Oncosalud", cat: "Salud", desc: "Convenio corporativo para socios y familiares directos." }
  },
  servicios: {
    "seguro-autos": { title: "Seguro de Autos", desc: "Convenio con Rímac que garantiza la mejor tarifa del mercado. Descuento de la prima en 18 meses sin recargo de intereses, con descuento por planilla." },
    "fondo-sepelio": { title: "Fondo de Sepelio", desc: "Cubre los gastos de sepelio del socio, cónyuge, hijos menores de 25 años y padres. Aporte de $5 mensuales (no reembolsable) y cobertura hasta $3,000 con Jardines de la Paz y Campo Fe." },
    oncosalud: { title: "Oncosalud", desc: "Convenio corporativo para socios y familiares directos, con 18% de descuento sobre la tarifa de mercado." }
  },
  prestamos: {
    "sola-firma": { title: "Préstamos a Solo Firma", desc: "Hasta S/3,000 a pagar en 6 meses. Aprobación rápida, sin garantías adicionales.", montoMin: 500, montoMax: 3000, montoStep: 100, plazoMin: 3, plazoMax: 6, plazoStep: 1, bank: 22, defMonto: 1500, defPlazo: 6 },
    consumo: { title: "Consumo", desc: "Hasta S/10,000 a pagar en 12 meses. Requiere mínimo 6 meses como socio.", montoMin: 1000, montoMax: 10000, montoStep: 500, plazoMin: 3, plazoMax: 12, plazoStep: 1, bank: 24, defMonto: 5000, defPlazo: 12 },
    "largo-plazo": { title: "Largo Plazo", desc: "Hasta S/60,000 a pagar en 48 meses. Requiere mínimo 6 meses como socio.", montoMin: 2000, montoMax: 60000, montoStep: 1000, plazoMin: 6, plazoMax: 48, plazoStep: 6, bank: 20, defMonto: 20000, defPlazo: 36 },
    automotriz: { title: "Crédito Automotriz", desc: "Hasta el 80% del valor del auto, monto máximo equivalente a US$40,000, a pagar en 60 meses. Requiere mínimo 6 meses como socio.", montoMin: 5000, montoMax: 150000, montoStep: 5000, plazoMin: 6, plazoMax: 60, plazoStep: 6, bank: 15, defMonto: 50000, defPlazo: 48 },
    hipotecario: { title: "Crédito Hipotecario", desc: "Hasta el 80% del valor del inmueble, monto máximo S/900,000, a pagar en hasta 216 meses (18 años). Requiere 12 meses como socio.", montoMin: 20000, montoMax: 900000, montoStep: 10000, plazoMin: 12, plazoMax: 216, plazoStep: 12, bank: 13, defMonto: 300000, defPlazo: 180 },
    garantia: { title: "Garantía Hipotecaria", desc: "Hasta S/900,000, a pagar en hasta 216 meses (18 años). Requiere 12 meses como socio.", montoMin: 20000, montoMax: 900000, montoStep: 10000, plazoMin: 12, plazoMax: 216, plazoStep: 12, bank: 16, defMonto: 300000, defPlazo: 180 },
    academico: { title: "Crédito Académico", desc: "Hasta S/50,000 a pagar en 48 meses. Requiere mínimo 6 meses como socio.", montoMin: 2000, montoMax: 50000, montoStep: 1000, plazoMin: 6, plazoMax: 48, plazoStep: 6, bank: 15, defMonto: 15000, defPlazo: 36 }
  },
  docLinks: {
    estatuto: { label: "Estatuto", url: "" },
    memorias: { label: "Memorias", url: "" },
    directiva: { label: "Directiva", url: "" }
  },
  ahorroInfo: {
    simple: {
      title: "Ahorro Simple",
      items: ["Ahorro mensual que se descuenta por planilla", "Monto mínimo S/50", "Es de libre disponibilidad"]
    },
    plazoFijo: {
      title: "Depósitos a Plazo Fijo",
      items: ["Plazos de 90, 180, 360 y 720 días", "Monto mínimo para abrir depósitos: S/3,000 ó $1,000"]
    }
  },
  ahorroTasas: [
    { id: "seed-1", plazo: "Ahorro", soles: "2.00%", dolares: "0.25%" },
    { id: "seed-2", plazo: "90 días", soles: "4.00%", dolares: "0.75%" },
    { id: "seed-3", plazo: "180 días", soles: "4.50%", dolares: "1.50%" },
    { id: "seed-4", plazo: "360 días", soles: "5.25%", dolares: "2.00%" },
    { id: "seed-5", plazo: "720 días", soles: "5.50%", dolares: "2.50%" }
  ],
  socios: [
    {
      DOCUME: "100001",
      TIPDID: "1",
      DOCIDE: "40123456",
      APEPAT: "PEREZ",
      APEMAT: "GARCIA",
      NOMBRE: "JUANA MARIA",
      DIRECC: "Av. Las Palmeras 123",
      LOCALI: "LIMA",
      PROVIN: "LIMA",
      DEPART: "LIMA",
      NCOMPL: "PEREZ GARCIA JUANA MARIA",
      NOMBC2: "juanamaria@example.com",
      TELCEL: "999888777",
      NACION: "1",
      CCIUDA: "150131",
      NOMCON: "",
      ESTCIV: "S",
      CARGAM: "0",
      OFICIO: "ANALISTA",
      SECTO1: "0"
    }
  ],
  sectionUpdatedAt: {},
  updatedAt: new Date().toISOString()
};

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Bumps the global updatedAt and, when a section name is given, the per-section
// timestamp exposed through /api/content so each table can show when it last changed.
function touch(container, section) {
  const now = new Date().toISOString();
  container.updatedAt = now;
  if (section) {
    container.sectionUpdatedAt = container.sectionUpdatedAt || {};
    container.sectionUpdatedAt[section] = now;
  }
}

const PRODUCTO_KEYS = ["bebidas", "rimac", "movistar", "perufarma", "smartfit", "oncosalud"];
const SERVICIO_KEYS = ["seguro-autos", "fondo-sepelio", "oncosalud"];
const PRESTAMO_KEYS = ["sola-firma", "consumo", "largo-plazo", "automotriz", "hipotecario", "garantia", "academico"];
const DOCLINK_KEYS = ["estatuto", "memorias", "directiva"];
const AHORRO_INFO_KEYS = ["simple", "plazoFijo"];

// ---------- File-backed store: default, good for local dev / small deployments ----------
function makeFileStore() {
  const DATA_FILE = process.env.DATA_FILE
    ? path.resolve(process.env.DATA_FILE)
    : path.join(__dirname, "..", "data.json");

  function read() {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
  function write(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }

  function patchKeyedMap(collectionName, allowedKeys) {
    return async (key, patch) => {
      if (!allowedKeys.includes(key)) return null;
      const data = read();
      data[collectionName] = data[collectionName] || {};
      data[collectionName][key] = { ...data[collectionName][key], ...patch };
      touch(data, collectionName);
      write(data);
      return data[collectionName][key];
    };
  }

  return {
    async getAll() {
      return read();
    },
    async addAnuncio(text) {
      const data = read();
      const post = {
        id: newId(),
        author: "Cooperativa IBM",
        role: "Administrador",
        tag: "Anuncio",
        text,
        createdAt: new Date().toISOString()
      };
      data.anuncios.unshift(post);
      touch(data, "anuncios");
      write(data);
      return post;
    },
    async removeAnuncio(id) {
      const data = read();
      data.anuncios = data.anuncios.filter((a) => a.id !== id);
      touch(data, "anuncios");
      write(data);
    },
    async addProveedor(p) {
      const data = read();
      const prov = { id: newId(), ...p };
      data.proveedores.push(prov);
      touch(data, "proveedores");
      write(data);
      return prov;
    },
    async updateProveedor(id, patch) {
      const data = read();
      const idx = data.proveedores.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      data.proveedores[idx] = { ...data.proveedores[idx], ...patch, id };
      touch(data, "proveedores");
      write(data);
      return data.proveedores[idx];
    },
    async removeProveedor(id) {
      const data = read();
      data.proveedores = data.proveedores.filter((p) => p.id !== id);
      touch(data, "proveedores");
      write(data);
    },
    async updateTasas(patch) {
      const data = read();
      data.tasas = { ...data.tasas, ...patch };
      touch(data, "tasas");
      write(data);
      return data.tasas;
    },
    updateProducto: patchKeyedMap("productos", PRODUCTO_KEYS),
    updateServicio: patchKeyedMap("servicios", SERVICIO_KEYS),
    updateLoanProduct: patchKeyedMap("prestamos", PRESTAMO_KEYS),
    updateDocLink: patchKeyedMap("docLinks", DOCLINK_KEYS),
    updateAhorroInfo: patchKeyedMap("ahorroInfo", AHORRO_INFO_KEYS),
    async addHistoria(item) {
      const data = read();
      const h = { id: newId(), ...item };
      data.historia = data.historia || [];
      data.historia.push(h);
      touch(data, "historia");
      write(data);
      return h;
    },
    async updateHistoria(id, patch) {
      const data = read();
      const idx = (data.historia || []).findIndex((h) => h.id === id);
      if (idx === -1) return null;
      data.historia[idx] = { ...data.historia[idx], ...patch, id };
      touch(data, "historia");
      write(data);
      return data.historia[idx];
    },
    async removeHistoria(id) {
      const data = read();
      data.historia = (data.historia || []).filter((h) => h.id !== id);
      touch(data, "historia");
      write(data);
    },
    async addAhorroTasa(item) {
      const data = read();
      const t = { id: newId(), ...item };
      data.ahorroTasas = data.ahorroTasas || [];
      data.ahorroTasas.push(t);
      touch(data, "ahorroTasas");
      write(data);
      return t;
    },
    async updateAhorroTasa(id, patch) {
      const data = read();
      const idx = (data.ahorroTasas || []).findIndex((t) => t.id === id);
      if (idx === -1) return null;
      data.ahorroTasas[idx] = { ...data.ahorroTasas[idx], ...patch, id };
      touch(data, "ahorroTasas");
      write(data);
      return data.ahorroTasas[idx];
    },
    async removeAhorroTasa(id) {
      const data = read();
      data.ahorroTasas = (data.ahorroTasas || []).filter((t) => t.id !== id);
      touch(data, "ahorroTasas");
      write(data);
    },
    async listSocios() {
      const data = read();
      return data.socios || [];
    },
    async getSocio(docume) {
      const data = read();
      return (data.socios || []).find((s) => String(s.DOCUME) === String(docume)) || null;
    },
    async saveSocio(socio) {
      const data = read();
      const list = data.socios || [];
      const i = list.findIndex((s) => String(s.DOCUME) === String(socio.DOCUME));
      const next = { ...socio, updatedAt: new Date().toISOString() };
      if (i >= 0) list[i] = next;
      else list.push(next);
      data.socios = list;
      data.updatedAt = new Date().toISOString();
      write(data);
      return next;
    },
    async listChanges() {
      const data = read();
      return data.changes || [];
    },
    async getPendingChanges() {
      const data = read();
      return (data.changes || []).filter((c) => c.status === "PENDING");
    },
    async addChange(change) {
      const data = read();
      const newChange = {
        id: newId(),
        ...change,
        status: change.status || "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.changes = data.changes || [];
      data.changes.push(newChange);
      data.updatedAt = new Date().toISOString();
      write(data);
      return newChange;
    },
    async updateChangeStatus(changeId, status, batchId = null) {
      const data = read();
      const change = (data.changes || []).find((c) => c.id === changeId);
      if (change) {
        change.status = status;
        change.updatedAt = new Date().toISOString();
        if (batchId) change.batchId = batchId;
        data.updatedAt = new Date().toISOString();
        write(data);
      }
      return change;
    },
    async listBatches() {
      const data = read();
      return data.batches || [];
    },
    async getBatch(batchId) {
      const data = read();
      return (data.batches || []).find((b) => b.id === batchId) || null;
    },
    async createBatch(batch) {
      const data = read();
      const newBatch = {
        id: newId(),
        ...batch,
        createdAt: new Date().toISOString()
      };
      data.batches = data.batches || [];
      data.batches.push(newBatch);
      data.updatedAt = new Date().toISOString();
      write(data);
      return newBatch;
    }
  };
}

// ---------- Cloudant-backed store: recommended for real IBM Cloud deployments ----------
function makeCloudantStore() {
  const { CloudantV1 } = require("@ibm-cloud/cloudant");
  // Reads CLOUDANT_URL / CLOUDANT_APIKEY / CLOUDANT_AUTH_TYPE from env automatically
  // (IBM Cloud SDK convention: service name "CLOUDANT").
  const client = CloudantV1.newInstance({ serviceName: "CLOUDANT" });
  const dbName = process.env.CLOUDANT_DB || "cooperativa-ibm";
  const DOC_ID = "content";

  async function ensureDb() {
    try {
      await client.getDatabaseInformation({ db: dbName });
    } catch (e) {
      await client.putDatabase({ db: dbName });
    }
  }

  async function getDoc() {
    await ensureDb();
    try {
      const res = await client.getDocument({ db: dbName, docId: DOC_ID });
      return res.result;
    } catch (e) {
      const doc = { _id: DOC_ID, ...DEFAULT_DATA };
      const created = await client.putDocument({ db: dbName, docId: DOC_ID, document: doc });
      doc._rev = created.result.rev;
      return doc;
    }
  }

  async function saveDoc(doc) {
    const res = await client.putDocument({ db: dbName, docId: DOC_ID, document: doc });
    doc._rev = res.result.rev;
    return doc;
  }

  function patchKeyedMap(collectionName, allowedKeys) {
    return async (key, patch) => {
      if (!allowedKeys.includes(key)) return null;
      const doc = await getDoc();
      doc[collectionName] = doc[collectionName] || {};
      doc[collectionName][key] = { ...doc[collectionName][key], ...patch };
      touch(doc, collectionName);
      await saveDoc(doc);
      return doc[collectionName][key];
    };
  }

  return {
    async getAll() {
      const doc = await getDoc();
      const { _id, _rev, ...rest } = doc;
      return rest;
    },
    async addAnuncio(text) {
      const doc = await getDoc();
      const post = {
        id: newId(),
        author: "Cooperativa IBM",
        role: "Administrador",
        tag: "Anuncio",
        text,
        createdAt: new Date().toISOString()
      };
      doc.anuncios.unshift(post);
      touch(doc, "anuncios");
      await saveDoc(doc);
      return post;
    },
    async removeAnuncio(id) {
      const doc = await getDoc();
      doc.anuncios = doc.anuncios.filter((a) => a.id !== id);
      touch(doc, "anuncios");
      await saveDoc(doc);
    },
    async addProveedor(p) {
      const doc = await getDoc();
      const prov = { id: newId(), ...p };
      doc.proveedores.push(prov);
      touch(doc, "proveedores");
      await saveDoc(doc);
      return prov;
    },
    async updateProveedor(id, patch) {
      const doc = await getDoc();
      const idx = doc.proveedores.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      doc.proveedores[idx] = { ...doc.proveedores[idx], ...patch, id };
      touch(doc, "proveedores");
      await saveDoc(doc);
      return doc.proveedores[idx];
    },
    async removeProveedor(id) {
      const doc = await getDoc();
      doc.proveedores = doc.proveedores.filter((p) => p.id !== id);
      touch(doc, "proveedores");
      await saveDoc(doc);
    },
    async updateTasas(patch) {
      const doc = await getDoc();
      doc.tasas = { ...doc.tasas, ...patch };
      touch(doc, "tasas");
      await saveDoc(doc);
      return doc.tasas;
    },
    updateProducto: patchKeyedMap("productos", PRODUCTO_KEYS),
    updateServicio: patchKeyedMap("servicios", SERVICIO_KEYS),
    updateLoanProduct: patchKeyedMap("prestamos", PRESTAMO_KEYS),
    updateDocLink: patchKeyedMap("docLinks", DOCLINK_KEYS),
    updateAhorroInfo: patchKeyedMap("ahorroInfo", AHORRO_INFO_KEYS),
    async addHistoria(item) {
      const doc = await getDoc();
      const h = { id: newId(), ...item };
      doc.historia = doc.historia || [];
      doc.historia.push(h);
      touch(doc, "historia");
      await saveDoc(doc);
      return h;
    },
    async updateHistoria(id, patch) {
      const doc = await getDoc();
      const idx = (doc.historia || []).findIndex((h) => h.id === id);
      if (idx === -1) return null;
      doc.historia[idx] = { ...doc.historia[idx], ...patch, id };
      touch(doc, "historia");
      await saveDoc(doc);
      return doc.historia[idx];
    },
    async removeHistoria(id) {
      const doc = await getDoc();
      doc.historia = (doc.historia || []).filter((h) => h.id !== id);
      touch(doc, "historia");
      await saveDoc(doc);
    },
    async addAhorroTasa(item) {
      const doc = await getDoc();
      const t = { id: newId(), ...item };
      doc.ahorroTasas = doc.ahorroTasas || [];
      doc.ahorroTasas.push(t);
      touch(doc, "ahorroTasas");
      await saveDoc(doc);
      return t;
    },
    async updateAhorroTasa(id, patch) {
      const doc = await getDoc();
      const idx = (doc.ahorroTasas || []).findIndex((t) => t.id === id);
      if (idx === -1) return null;
      doc.ahorroTasas[idx] = { ...doc.ahorroTasas[idx], ...patch, id };
      touch(doc, "ahorroTasas");
      await saveDoc(doc);
      return doc.ahorroTasas[idx];
    },
    async removeAhorroTasa(id) {
      const doc = await getDoc();
      doc.ahorroTasas = (doc.ahorroTasas || []).filter((t) => t.id !== id);
      touch(doc, "ahorroTasas");
      await saveDoc(doc);
    },
    async listSocios() {
      const doc = await getDoc();
      return doc.socios || [];
    },
    async getSocio(docume) {
      const doc = await getDoc();
      return (doc.socios || []).find((s) => String(s.DOCUME) === String(docume)) || null;
    },
    async saveSocio(socio) {
      const doc = await getDoc();
      const list = doc.socios || [];
      const i = list.findIndex((s) => String(s.DOCUME) === String(socio.DOCUME));
      const next = { ...socio, updatedAt: new Date().toISOString() };
      if (i >= 0) list[i] = next;
      else list.push(next);
      doc.socios = list;
      doc.updatedAt = new Date().toISOString();
      await saveDoc(doc);
      return next;
    },
    async listChanges() {
      const doc = await getDoc();
      return doc.changes || [];
    },
    async getPendingChanges() {
      const doc = await getDoc();
      return (doc.changes || []).filter((c) => c.status === "PENDING");
    },
    async addChange(change) {
      const doc = await getDoc();
      const newChange = {
        id: newId(),
        ...change,
        status: change.status || "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      doc.changes = doc.changes || [];
      doc.changes.push(newChange);
      doc.updatedAt = new Date().toISOString();
      await saveDoc(doc);
      return newChange;
    },
    async updateChangeStatus(changeId, status, batchId = null) {
      const doc = await getDoc();
      const change = (doc.changes || []).find((c) => c.id === changeId);
      if (change) {
        change.status = status;
        change.updatedAt = new Date().toISOString();
        if (batchId) change.batchId = batchId;
        doc.updatedAt = new Date().toISOString();
        await saveDoc(doc);
      }
      return change;
    },
    async listBatches() {
      const doc = await getDoc();
      return doc.batches || [];
    },
    async getBatch(batchId) {
      const doc = await getDoc();
      return (doc.batches || []).find((b) => b.id === batchId) || null;
    },
    async createBatch(batch) {
      const doc = await getDoc();
      const newBatch = {
        id: newId(),
        ...batch,
        createdAt: new Date().toISOString()
      };
      doc.batches = doc.batches || [];
      doc.batches.push(newBatch);
      doc.updatedAt = new Date().toISOString();
      await saveDoc(doc);
      return newBatch;
    }
  };
}

const STORAGE = process.env.STORAGE || "file";
module.exports = STORAGE === "cloudant" ? makeCloudantStore() : makeFileStore();
