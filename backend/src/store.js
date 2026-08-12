const fs = require("fs");
const path = require("path");

const DEFAULT_DATA = {
  tasas: { hipotecario: 8.9, vehicular: 11.5, educativo: 9.5, salud: 10.0 },
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
    { id: "seed-1", name: "Plaza Vea", cat: "Supermercados", desc: "Descuento en compras y días de socio exclusivos.", disc: "Hasta 10% dcto." },
    { id: "seed-2", name: "Inkafarma", cat: "Farmacias", desc: "Precios preferenciales en medicamentos y cuidado personal.", disc: "15% dcto." }
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
  updatedAt: new Date().toISOString()
};

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

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
      data.updatedAt = new Date().toISOString();
      write(data);
      return post;
    },
    async removeAnuncio(id) {
      const data = read();
      data.anuncios = data.anuncios.filter((a) => a.id !== id);
      data.updatedAt = new Date().toISOString();
      write(data);
    },
    async addProveedor(p) {
      const data = read();
      const prov = { id: newId(), ...p };
      data.proveedores.push(prov);
      data.updatedAt = new Date().toISOString();
      write(data);
      return prov;
    },
    async removeProveedor(id) {
      const data = read();
      data.proveedores = data.proveedores.filter((p) => p.id !== id);
      data.updatedAt = new Date().toISOString();
      write(data);
    },
    async updateTasas(patch) {
      const data = read();
      data.tasas = { ...data.tasas, ...patch };
      data.updatedAt = new Date().toISOString();
      write(data);
      return data.tasas;
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
      doc.updatedAt = new Date().toISOString();
      await saveDoc(doc);
      return post;
    },
    async removeAnuncio(id) {
      const doc = await getDoc();
      doc.anuncios = doc.anuncios.filter((a) => a.id !== id);
      doc.updatedAt = new Date().toISOString();
      await saveDoc(doc);
    },
    async addProveedor(p) {
      const doc = await getDoc();
      const prov = { id: newId(), ...p };
      doc.proveedores.push(prov);
      doc.updatedAt = new Date().toISOString();
      await saveDoc(doc);
      return prov;
    },
    async removeProveedor(id) {
      const doc = await getDoc();
      doc.proveedores = doc.proveedores.filter((p) => p.id !== id);
      doc.updatedAt = new Date().toISOString();
      await saveDoc(doc);
    },
    async updateTasas(patch) {
      const doc = await getDoc();
      doc.tasas = { ...doc.tasas, ...patch };
      doc.updatedAt = new Date().toISOString();
      await saveDoc(doc);
      return doc.tasas;
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
    }
  };
}

const STORAGE = process.env.STORAGE || "file";
module.exports = STORAGE === "cloudant" ? makeCloudantStore() : makeFileStore();
