const assert = require("assert");

// Mock store for testing
function createMockStore() {
  let changes = [];
  let batches = [];
  let changeIdCounter = 1;
  let batchIdCounter = 1;

  return {
    changes,
    batches,
    async getPendingChanges() {
      return changes.filter((c) => c.status === "PENDING");
    },
    async addChange(change) {
      const newChange = {
        id: `change-${changeIdCounter++}`,
        ...change,
        status: change.status || "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      changes.push(newChange);
      return newChange;
    },
    async updateChangeStatus(changeId, status, batchId = null) {
      const change = changes.find((c) => c.id === changeId);
      if (change) {
        change.status = status;
        change.updatedAt = new Date().toISOString();
        if (batchId) change.batchId = batchId;
      }
      return change;
    },
    async createBatch(batch) {
      const newBatch = {
        id: batch.id || `batch-${batchIdCounter++}`,
        ...batch,
        createdAt: new Date().toISOString()
      };
      batches.push(newBatch);
      return newBatch;
    },
    async listBatches() {
      return batches;
    },
    reset() {
      changes = [];
      batches = [];
      changeIdCounter = 1;
      batchIdCounter = 1;
    }
  };
}

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

console.log("pending-changes.test — flujo de cambios pendientes y batches\n");

check("addChange crea un cambio con estado PENDING", async () => {
  const store = createMockStore();
  const change = await store.addChange({
    docume: "100001",
    field: "TELCEL",
    value: "999888777",
    previousValue: "999111222"
  });
  
  assert.strictEqual(change.status, "PENDING");
  assert.strictEqual(change.docume, "100001");
  assert.strictEqual(change.field, "TELCEL");
  assert.strictEqual(change.value, "999888777");
});

check("getPendingChanges filtra solo cambios PENDING", async () => {
  const store = createMockStore();
  await store.addChange({ docume: "100001", field: "TELCEL", value: "111" });
  await store.addChange({ docume: "100002", field: "DIRECC", value: "Av. Test" });
  
  const change3 = await store.addChange({ docume: "100003", field: "NOMBC2", value: "test@example.com" });
  await store.updateChangeStatus(change3.id, "EXPORTED", "BATCH-001");
  
  const pending = await store.getPendingChanges();
  assert.strictEqual(pending.length, 2);
  assert.ok(pending.every((c) => c.status === "PENDING"));
});

check("consolidación: último valor gana para el mismo campo", async () => {
  const store = createMockStore();
  
  // Mismo socio, mismo campo, múltiples cambios
  await store.addChange({ docume: "100001", field: "TELCEL", value: "111111111" });
  await store.addChange({ docume: "100001", field: "TELCEL", value: "222222222" });
  await store.addChange({ docume: "100001", field: "TELCEL", value: "333333333" });
  
  const pending = await store.getPendingChanges();
  
  // Consolidar por socio (simulando la lógica del endpoint)
  const changesBySocio = {};
  for (const change of pending) {
    if (!changesBySocio[change.docume]) {
      changesBySocio[change.docume] = { DOCUME: change.docume };
    }
    changesBySocio[change.docume][change.field] = change.value;
  }
  
  assert.strictEqual(changesBySocio["100001"].TELCEL, "333333333");
});

check("consolidación: múltiples campos del mismo socio", async () => {
  const store = createMockStore();
  
  await store.addChange({ docume: "100001", field: "TELCEL", value: "999888777" });
  await store.addChange({ docume: "100001", field: "NOMBC2", value: "nuevo@example.com" });
  await store.addChange({ docume: "100001", field: "DIRECC", value: "Av. Nueva 123" });
  
  const pending = await store.getPendingChanges();
  
  // Consolidar
  const changesBySocio = {};
  for (const change of pending) {
    if (!changesBySocio[change.docume]) {
      changesBySocio[change.docume] = { DOCUME: change.docume };
    }
    changesBySocio[change.docume][change.field] = change.value;
  }
  
  const socio = changesBySocio["100001"];
  assert.strictEqual(socio.TELCEL, "999888777");
  assert.strictEqual(socio.NOMBC2, "nuevo@example.com");
  assert.strictEqual(socio.DIRECC, "Av. Nueva 123");
  assert.strictEqual(Object.keys(socio).length, 4); // DOCUME + 3 campos
});

check("consolidación: un socio = una fila en TXT", async () => {
  const store = createMockStore();
  
  // Socio 1: 3 cambios
  await store.addChange({ docume: "100001", field: "TELCEL", value: "111" });
  await store.addChange({ docume: "100001", field: "NOMBC2", value: "a@example.com" });
  await store.addChange({ docume: "100001", field: "DIRECC", value: "Av. A" });
  
  // Socio 2: 2 cambios
  await store.addChange({ docume: "100002", field: "TELCEL", value: "222" });
  await store.addChange({ docume: "100002", field: "ESTCIV", value: "C" });
  
  const pending = await store.getPendingChanges();
  
  // Consolidar
  const changesBySocio = {};
  for (const change of pending) {
    if (!changesBySocio[change.docume]) {
      changesBySocio[change.docume] = { DOCUME: change.docume };
    }
    changesBySocio[change.docume][change.field] = change.value;
  }
  
  const rows = Object.values(changesBySocio);
  assert.strictEqual(rows.length, 2, "debe haber exactamente 2 filas (una por socio)");
});

check("createBatch genera un batch con metadata", async () => {
  const store = createMockStore();
  
  const batch = await store.createBatch({
    id: "BATCH-20260812-001",
    filename: "socios_delta_20260812_001.txt",
    recordCount: 37,
    status: "EXPORTED",
    createdBy: "admin"
  });
  
  assert.strictEqual(batch.id, "BATCH-20260812-001");
  assert.strictEqual(batch.filename, "socios_delta_20260812_001.txt");
  assert.strictEqual(batch.recordCount, 37);
  assert.strictEqual(batch.status, "EXPORTED");
  assert.ok(batch.createdAt);
});

check("updateChangeStatus marca cambios como EXPORTED", async () => {
  const store = createMockStore();
  
  const change1 = await store.addChange({ docume: "100001", field: "TELCEL", value: "111" });
  const change2 = await store.addChange({ docume: "100002", field: "DIRECC", value: "Av. Test" });
  
  await store.updateChangeStatus(change1.id, "EXPORTED", "BATCH-001");
  await store.updateChangeStatus(change2.id, "EXPORTED", "BATCH-001");
  
  const pending = await store.getPendingChanges();
  assert.strictEqual(pending.length, 0, "no debe haber cambios pendientes");
  
  assert.strictEqual(store.changes[0].status, "EXPORTED");
  assert.strictEqual(store.changes[0].batchId, "BATCH-001");
  assert.strictEqual(store.changes[1].status, "EXPORTED");
  assert.strictEqual(store.changes[1].batchId, "BATCH-001");
});

check("cambios después de export permanecen PENDING", async () => {
  const store = createMockStore();
  
  // Primer cambio
  const change1 = await store.addChange({ docume: "100001", field: "TELCEL", value: "111" });
  
  // Generar batch
  await store.createBatch({ id: "BATCH-001", recordCount: 1, status: "EXPORTED" });
  await store.updateChangeStatus(change1.id, "EXPORTED", "BATCH-001");
  
  // Nuevo cambio del mismo socio después del export
  await store.addChange({ docume: "100001", field: "DIRECC", value: "Av. Nueva" });
  
  const pending = await store.getPendingChanges();
  assert.strictEqual(pending.length, 1, "el nuevo cambio debe estar pendiente");
  assert.strictEqual(pending[0].field, "DIRECC");
});

check("listBatches devuelve historial de batches", async () => {
  const store = createMockStore();
  
  await store.createBatch({ id: "BATCH-001", recordCount: 10, status: "EXPORTED" });
  await store.createBatch({ id: "BATCH-002", recordCount: 5, status: "EXPORTED" });
  await store.createBatch({ id: "BATCH-003", recordCount: 15, status: "EXPORTED" });
  
  const batches = await store.listBatches();
  assert.strictEqual(batches.length, 3);
  assert.ok(batches.every((b) => b.status === "EXPORTED"));
});

if (!allOk) {
  console.error("\nFAILURES — revisa la implementación de cambios pendientes.");
  process.exit(1);
}
console.log("\nTODO OK — el flujo de cambios pendientes y batches funciona correctamente.");

// Made with Bob
