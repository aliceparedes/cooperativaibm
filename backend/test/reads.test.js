const assert = require("assert");
const reads = require("../src/reads");
const dataapi = require("../src/dataapi");

// --- fake store ---
function createStore() {
  const state = { socios: [], changes: [] };
  return {
    state,
    async getSocio(docume) {
      return state.socios.find((s) => String(s.DOCUME) === String(docume)) || null;
    },
    async listChanges() {
      return state.changes;
    },
    async updateChangeStatus(id, status) {
      const c = state.changes.find((x) => x.id === id);
      if (c) c.status = status;
      return c;
    }
  };
}

function change(over = {}) {
  return { id: "c-1", docume: "100001", field: "TELCEL", value: "999888777", status: "PENDING", ...over };
}

let allOk = true;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log("  ok  " + name))
    .catch((e) => {
      allOk = false;
      console.error("FAIL  " + name + "\n      " + e.message);
    });
}

console.log("reads.test — fuente autoritativa (db2 vs mirror) y overlay de pendientes\n");

check("DATAAPI_ENABLED=false: lee del mirror local (source local)", async () => {
  dataapi.isEnabled = () => false;
  const store = createStore();
  store.state.socios.push({ DOCUME: "100001", TELCEL: "999111222" });

  const read = await reads.readSocio(store, "100001");
  assert.strictEqual(read.source, "local");
  assert.strictEqual(read.socio.TELCEL, "999111222");
  assert.strictEqual(read.overlaid, undefined);
});

check("db2 200 sin pendientes: source db2 y sin overlay", async () => {
  dataapi.isEnabled = () => true;
  dataapi.readSocio = async () => ({
    status: "ok",
    socio: { DOCUME: "100001", TIPDID: "1", TELCEL: "999000111", NOMBC2: "a@x.com" }
  });
  const store = createStore();

  const read = await reads.readSocio(store, "100001");
  assert.strictEqual(read.source, "db2");
  assert.strictEqual(read.socio.TELCEL, "999000111");
  assert.strictEqual(read.overlaid.length, 0);
  assert.strictEqual(read.autoCleared.length, 0);
});

check("db2 200 + pendiente distinto: overlay campo a campo sobre la base db2", async () => {
  dataapi.isEnabled = () => true;
  dataapi.readSocio = async () => ({
    status: "ok",
    socio: { DOCUME: "100001", TIPDID: "1", TELCEL: "999000111", NOMBC2: "a@x.com" }
  });
  const store = createStore();
  store.state.changes.push(
    change({ id: "c1", field: "TELCEL", value: "999888777" }),
    change({ id: "c2", field: "NOMBC2", value: "b@x.com" })
  );

  const read = await reads.readSocio(store, "100001");
  assert.strictEqual(read.source, "db2");
  // base db2 sin tocar salvo los campos con pendiente
  assert.strictEqual(read.socio.TIPDID, "1");
  assert.strictEqual(read.socio.TELCEL, "999888777");
  assert.strictEqual(read.socio.NOMBC2, "b@x.com");
  assert.deepStrictEqual(read.overlaid.sort(), ["NOMBC2", "TELCEL"].sort());
  assert.strictEqual(read.autoCleared.length, 0);
});

check("auto-clear: db2 ya refleja el valor -> COMPLETED y sin overlay para ese campo", async () => {
  dataapi.isEnabled = () => true;
  dataapi.readSocio = async () => ({
    status: "ok",
    socio: { DOCUME: "100001", TIPDID: "1", TELCEL: "999888777", NOMBC2: "a@x.com" }
  });
  const store = createStore();
  store.state.changes.push(
    change({ id: "c1", field: "TELCEL", value: "999888777" }), // ya está en db2
    change({ id: "c2", field: "NOMBC2", value: "b@x.com" })     // aún no
  );

  const read = await reads.readSocio(store, "100001");
  assert.strictEqual(read.socio.TELCEL, "999888777");
  assert.strictEqual(read.socio.NOMBC2, "b@x.com");
  assert.deepStrictEqual(read.overlaid, ["NOMBC2"]);
  assert.deepStrictEqual(read.autoCleared, ["c1"]);
  assert.strictEqual(store.state.changes.find((c) => c.id === "c1").status, "COMPLETED");
  assert.strictEqual(store.state.changes.find((c) => c.id === "c2").status, "PENDING");
});

check("db2 200 + pendiente de un campo ausente en la respuesta: se omite, no revienta", async () => {
  dataapi.isEnabled = () => true;
  dataapi.readSocio = async () => ({
    status: "ok",
    // DIRECC no viene en la respuesta db2 (parcial/nula): el overlay no debe
    // inventarlo, ni lanzar, ni marcarlo COMPLETED.
    socio: { DOCUME: "100001", TIPDID: "1", TELCEL: "999000111" }
  });
  const store = createStore();
  store.state.changes.push(
    change({ id: "c1", field: "TELCEL", value: "999888777" }), // presente -> overlay
    change({ id: "c2", field: "DIRECC", value: "AV. NUEVA 999" }) // ausente -> skip
  );

  const read = await reads.readSocio(store, "100001");
  assert.strictEqual(read.source, "db2");
  assert.strictEqual(read.socio.TELCEL, "999888777");   // se superpone
  assert.strictEqual(read.socio.DIRECC, undefined);     // no se inventa
  assert.deepStrictEqual(read.overlaid, ["TELCEL"]);    // solo el presente
  assert.strictEqual(read.autoCleared.length, 0);
  assert.strictEqual(store.state.changes.find((c) => c.id === "c1").status, "PENDING");
  assert.strictEqual(store.state.changes.find((c) => c.id === "c2").status, "PENDING");
});

check("404 en db2: fallback al mirror con source 'local (not yet migrated)'", async () => {
  dataapi.isEnabled = () => true;
  dataapi.readSocio = async () => ({ status: "not_found" });
  const store = createStore();
  store.state.socios.push({ DOCUME: "100001", TELCEL: "999111222" });

  const read = await reads.readSocio(store, "100001");
  assert.strictEqual(read.source, "local (not yet migrated)");
  assert.strictEqual(read.socio.TELCEL, "999111222");
});

check("503/timeout: lanza error y NUNCA cae al mirror en silencio", async () => {
  dataapi.isEnabled = () => true;
  dataapi.readSocio = async () => ({ status: "unavailable", error: "timeout tras 5000ms" });
  const store = createStore();
  store.state.socios.push({ DOCUME: "100001", TELCEL: "999111222" });

  let threw = null;
  try {
    await reads.readSocio(store, "100001");
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "debe lanzar en fallo real del dataapi");
  assert.strictEqual(threw.status, 503);
  assert.ok(/db2/.test(threw.message));
});

if (!allOk) {
  console.error("\nFAILURES — revisa reads.js.");
  process.exit(1);
}
console.log("\nTODO OK — lectura autoritativa y overlay funcionan.");
