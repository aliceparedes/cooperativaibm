// batch-download.test.js — Historical batch download tests

const store = require("../src/store");
const txt = require("../src/txt");

// Helper to create a socio with all fields
function createSocio(docume) {
  return {
    DOCUME: docume,
    TIPDID: "1",
    DOCIDE: "12345678",
    APEPAT: "PEREZ",
    APEMAT: "GARCIA",
    NOMBRE: "JUAN",
    DIRECC: "Av. Test 123",
    LOCALI: "LIMA",
    PROVIN: "LIMA",
    DEPART: "LIMA",
    NCOMPL: "PEREZ GARCIA JUAN",
    NOMBC2: "juan@test.com",
    TELCEL: "999888777",
    NACION: "1",
    CCIUDA: "150101",
    NOMCON: "",
    DNICY: "",
    ESTCIV: "S",
    CARGAM: "0",
    OFICIO: "INGENIERO",
    SECTO1: "0"
  };
}

async function runTests() {
  console.log("batch-download.test — Historical batch download tests\n");

  let passed = 0;
  let failed = 0;

  // TEST 1: Download existing batch
  try {
    console.log("TEST 1: Download existing batch");
    
    // Create socio and change
    const socio1 = createSocio("100001");
    await store.saveSocio(socio1);
    await store.addChange({
      docume: "100001",
      field: "TELCEL",
      value: "999111222",
      previousValue: "999888777"
    });

    // Generate batch
    const pendingChanges = await store.getPendingChanges();
    const changesBySocio = {};
    for (const change of pendingChanges) {
      if (!changesBySocio[change.docume]) {
        changesBySocio[change.docume] = { DOCUME: change.docume };
      }
      changesBySocio[change.docume][change.field] = change.value;
    }
    
    const rows = Object.values(changesBySocio);
    const result = txt.build(rows);
    
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const batch = await store.createBatch({
      id: `BATCH-${timestamp}`,
      filename: `socios_delta_${timestamp}.txt`,
      recordCount: rows.length,
      status: "EXPORTED",
      createdBy: "test",
      txt: result.txt
    });

    // Mark changes as exported
    for (const change of pendingChanges) {
      await store.updateChangeStatus(change.id, "EXPORTED", batch.id);
    }

    // Download batch
    const downloadedBatch = await store.getBatch(batch.id);
    
    if (!downloadedBatch) {
      throw new Error("Batch not found");
    }
    
    if (!downloadedBatch.txt) {
      throw new Error("Batch TXT not stored");
    }
    
    if (downloadedBatch.txt !== result.txt) {
      throw new Error("Downloaded TXT does not match original");
    }
    
    if (downloadedBatch.filename !== batch.filename) {
      throw new Error("Filename does not match");
    }

    console.log("  ok  Download returns exact historical TXT");
    passed++;
  } catch (e) {
    console.log("  FAIL  " + e.message);
    failed++;
  }

  // TEST 2: Download does NOT create new batch
  try {
    console.log("\nTEST 2: Download does NOT create new batch");
    
    const batchesBefore = await store.listBatches();
    const countBefore = batchesBefore.length;
    
    // Download the last batch (simulating the download action)
    const lastBatch = batchesBefore[batchesBefore.length - 1];
    const downloadedBatch = await store.getBatch(lastBatch.id);
    
    const batchesAfter = await store.listBatches();
    const countAfter = batchesAfter.length;
    
    if (countAfter !== countBefore) {
      throw new Error(`Batch count changed: ${countBefore} -> ${countAfter}`);
    }

    console.log("  ok  Download does not create new batch");
    passed++;
  } catch (e) {
    console.log("  FAIL  " + e.message);
    failed++;
  }

  // TEST 3: Download does NOT consume pending changes
  try {
    console.log("\nTEST 3: Download does NOT consume pending changes");
    
    // Create a new pending change
    await store.addChange({
      docume: "100001",
      field: "NOMBC2",
      value: "newemail@test.com",
      previousValue: "juan@test.com"
    });
    
    const pendingBefore = await store.getPendingChanges();
    const countBefore = pendingBefore.length;
    
    // Download a historical batch
    const batches = await store.listBatches();
    const lastBatch = batches[batches.length - 1];
    await store.getBatch(lastBatch.id);
    
    const pendingAfter = await store.getPendingChanges();
    const countAfter = pendingAfter.length;
    
    if (countAfter !== countBefore) {
      throw new Error(`Pending changes count changed: ${countBefore} -> ${countAfter}`);
    }

    console.log("  ok  Download does not consume pending changes");
    passed++;
  } catch (e) {
    console.log("  FAIL  " + e.message);
    failed++;
  }

  // TEST 4: Download nonexistent batch
  try {
    console.log("\nTEST 4: Download nonexistent batch");
    
    const batch = await store.getBatch("NONEXISTENT-BATCH-ID");
    
    if (batch !== null) {
      throw new Error("Expected null for nonexistent batch");
    }

    console.log("  ok  Returns null for nonexistent batch");
    passed++;
  } catch (e) {
    console.log("  FAIL  " + e.message);
    failed++;
  }

  // TEST 5: Historical immutability
  try {
    console.log("\nTEST 5: Historical immutability");
    
    // Create socio and first batch
    const socio2 = createSocio("100002");
    await store.saveSocio(socio2);
    await store.addChange({
      docume: "100002",
      field: "TELCEL",
      value: "111111111",
      previousValue: ""
    });

    const pending1 = await store.getPendingChanges();
    const changes1 = {};
    for (const change of pending1) {
      if (!changes1[change.docume]) {
        changes1[change.docume] = { DOCUME: change.docume };
      }
      changes1[change.docume][change.field] = change.value;
    }
    
    const rows1 = Object.values(changes1);
    const result1 = txt.build(rows1);
    
    const timestamp1 = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const batchA = await store.createBatch({
      id: `BATCH-A-${timestamp1}`,
      filename: `socios_delta_A_${timestamp1}.txt`,
      recordCount: rows1.length,
      status: "EXPORTED",
      createdBy: "test",
      txt: result1.txt
    });

    for (const change of pending1) {
      await store.updateChangeStatus(change.id, "EXPORTED", batchA.id);
    }

    // Modify socio and create second batch
    await store.addChange({
      docume: "100002",
      field: "TELCEL",
      value: "222222222",
      previousValue: "111111111"
    });

    const pending2 = await store.getPendingChanges();
    const changes2 = {};
    for (const change of pending2) {
      if (!changes2[change.docume]) {
        changes2[change.docume] = { DOCUME: change.docume };
      }
      changes2[change.docume][change.field] = change.value;
    }
    
    const rows2 = Object.values(changes2);
    const result2 = txt.build(rows2);
    
    const timestamp2 = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const batchB = await store.createBatch({
      id: `BATCH-B-${timestamp2}`,
      filename: `socios_delta_B_${timestamp2}.txt`,
      recordCount: rows2.length,
      status: "EXPORTED",
      createdBy: "test",
      txt: result2.txt
    });

    for (const change of pending2) {
      await store.updateChangeStatus(change.id, "EXPORTED", batchB.id);
    }

    // Download Batch A
    const downloadedA = await store.getBatch(batchA.id);
    
    if (downloadedA.txt !== result1.txt) {
      throw new Error("Batch A content changed");
    }
    
    if (downloadedA.txt.includes("222222222")) {
      throw new Error("Batch A contains changes from Batch B");
    }

    console.log("  ok  Historical batch remains immutable");
    passed++;
  } catch (e) {
    console.log("  FAIL  " + e.message);
    failed++;
  }

  // TEST 6: Batch without TXT (old batch)
  try {
    console.log("\nTEST 6: Batch without TXT (old batch simulation)");
    
    // Create a batch without TXT (simulating old batches)
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const oldBatch = await store.createBatch({
      id: `BATCH-OLD-${timestamp}`,
      filename: `socios_delta_old_${timestamp}.txt`,
      recordCount: 1,
      status: "EXPORTED",
      createdBy: "test"
      // Note: no txt property
    });

    const downloaded = await store.getBatch(oldBatch.id);
    
    if (downloaded.txt) {
      throw new Error("Old batch should not have TXT");
    }

    console.log("  ok  Old batches without TXT are handled correctly");
    passed++;
  } catch (e) {
    console.log("  FAIL  " + e.message);
    failed++;
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log("\nTODO OK — batch download functionality works correctly.");
  } else {
    console.log("\nSOME TESTS FAILED — review implementation.");
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Test suite error:", e);
  process.exit(1);
});

// Made with Bob
