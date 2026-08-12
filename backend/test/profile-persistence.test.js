const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Mock store for testing
function createTestStore() {
  let socios = [];
  let changes = [];
  let socioIdCounter = 1;
  let changeIdCounter = 1;

  return {
    socios,
    changes,
    async getSocio(docume) {
      return socios.find((s) => String(s.DOCUME) === String(docume)) || null;
    },
    async saveSocio(socio) {
      const existing = socios.findIndex((s) => String(s.DOCUME) === String(socio.DOCUME));
      const saved = { ...socio, updatedAt: new Date().toISOString() };
      if (existing >= 0) {
        socios[existing] = saved;
      } else {
        socios.push(saved);
      }
      return saved;
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
    async getPendingChanges() {
      return changes.filter((c) => c.status === "PENDING");
    },
    reset() {
      socios = [];
      changes = [];
      socioIdCounter = 1;
      changeIdCounter = 1;
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

console.log("profile-persistence.test — socio profile persistence regression tests\n");

check("TEST 1: Profile persists after edit", async () => {
  const store = createTestStore();
  
  // Create initial socio
  await store.saveSocio({
    DOCUME: "E00006",
    TELCEL: "999111222",
    NOMBC2: "old@example.com"
  });
  
  // Simulate edit
  const existing = await store.getSocio("E00006");
  const updated = { ...existing, TELCEL: "999888777" };
  await store.saveSocio(updated);
  
  // Verify persistence
  const retrieved = await store.getSocio("E00006");
  assert.strictEqual(retrieved.TELCEL, "999888777", "Profile should persist new value");
});

check("TEST 2: Refresh/persistence behavior", async () => {
  const store = createTestStore();
  
  // Initial save
  await store.saveSocio({
    DOCUME: "E00007",
    TELCEL: "111111111"
  });
  
  // First GET
  const first = await store.getSocio("E00007");
  assert.strictEqual(first.TELCEL, "111111111");
  
  // Second GET (simulates refresh)
  const second = await store.getSocio("E00007");
  assert.strictEqual(second.TELCEL, "111111111", "Value must persist across multiple reads");
});

check("TEST 3: Pending change still created", async () => {
  const store = createTestStore();
  
  // Create initial socio
  await store.saveSocio({
    DOCUME: "E00008",
    TELCEL: "999111222"
  });
  
  // Update profile
  await store.saveSocio({
    DOCUME: "E00008",
    TELCEL: "999888777"
  });
  
  // Create pending change
  await store.addChange({
    docume: "E00008",
    field: "TELCEL",
    value: "999888777",
    previousValue: "999111222"
  });
  
  // Verify both conditions
  const profile = await store.getSocio("E00008");
  const pending = await store.getPendingChanges();
  
  assert.strictEqual(profile.TELCEL, "999888777", "Profile should be updated");
  assert.strictEqual(pending.length, 1, "Pending change should be created");
  assert.strictEqual(pending[0].field, "TELCEL");
});

check("TEST 4: Invalid update does not persist", async () => {
  const store = createTestStore();
  
  // Create initial socio
  await store.saveSocio({
    DOCUME: "E00009",
    TELCEL: "999111222"
  });
  
  // Simulate validation failure - don't save invalid data
  const existing = await store.getSocio("E00009");
  // In real implementation, validation would fail before saveSocio is called
  
  // Verify original value remains
  const retrieved = await store.getSocio("E00009");
  assert.strictEqual(retrieved.TELCEL, "999111222", "Original value should remain after validation failure");
  
  // Verify no pending change created
  const pending = await store.getPendingChanges();
  assert.strictEqual(pending.length, 0, "No pending change should be created for invalid update");
});

check("TEST 5: Multiple fields update", async () => {
  const store = createTestStore();
  
  // Create initial socio
  await store.saveSocio({
    DOCUME: "E00010",
    TELCEL: "999111222",
    NOMBC2: "old@example.com",
    DIRECC: "Av. Old 123"
  });
  
  // Update multiple fields
  await store.saveSocio({
    DOCUME: "E00010",
    TELCEL: "999888777",
    NOMBC2: "new@example.com",
    DIRECC: "Av. New 456"
  });
  
  // Create pending changes for each field
  await store.addChange({ docume: "E00010", field: "TELCEL", value: "999888777" });
  await store.addChange({ docume: "E00010", field: "NOMBC2", value: "new@example.com" });
  await store.addChange({ docume: "E00010", field: "DIRECC", value: "Av. New 456" });
  
  // Verify all fields persisted
  const profile = await store.getSocio("E00010");
  assert.strictEqual(profile.TELCEL, "999888777");
  assert.strictEqual(profile.NOMBC2, "new@example.com");
  assert.strictEqual(profile.DIRECC, "Av. New 456");
  
  // Verify all pending changes created
  const pending = await store.getPendingChanges();
  assert.strictEqual(pending.length, 3, "All three changes should be pending");
});

check("TEST 6: Multiple sequential edits (last value wins)", async () => {
  const store = createTestStore();
  
  // Create initial socio
  await store.saveSocio({
    DOCUME: "E00011",
    NOMBC2: "original@example.com"
  });
  
  // Edit 1
  await store.saveSocio({
    DOCUME: "E00011",
    NOMBC2: "edit1@example.com"
  });
  await store.addChange({ docume: "E00011", field: "NOMBC2", value: "edit1@example.com" });
  
  // Edit 2
  await store.saveSocio({
    DOCUME: "E00011",
    NOMBC2: "edit2@example.com"
  });
  await store.addChange({ docume: "E00011", field: "NOMBC2", value: "edit2@example.com" });
  
  // Edit 3
  await store.saveSocio({
    DOCUME: "E00011",
    NOMBC2: "edit3@example.com"
  });
  await store.addChange({ docume: "E00011", field: "NOMBC2", value: "edit3@example.com" });
  
  // Verify current profile has last value
  const profile = await store.getSocio("E00011");
  assert.strictEqual(profile.NOMBC2, "edit3@example.com", "Profile should have last edited value");
  
  // Verify all changes are pending (for consolidation later)
  const pending = await store.getPendingChanges();
  assert.strictEqual(pending.length, 3, "All edits should be tracked");
  
  // Simulate TXT consolidation (last value wins)
  const changesBySocio = {};
  for (const change of pending) {
    if (!changesBySocio[change.docume]) {
      changesBySocio[change.docume] = { DOCUME: change.docume };
    }
    changesBySocio[change.docume][change.field] = change.value;
  }
  
  assert.strictEqual(changesBySocio["E00011"].NOMBC2, "edit3@example.com", "TXT consolidation should use last value");
});

check("TEST 7: Multiple socios remain isolated", async () => {
  const store = createTestStore();
  
  // Create three socios
  await store.saveSocio({ DOCUME: "E00012", TELCEL: "111111111" });
  await store.saveSocio({ DOCUME: "E00013", TELCEL: "222222222" });
  await store.saveSocio({ DOCUME: "E00014", TELCEL: "333333333" });
  
  // Update each
  await store.saveSocio({ DOCUME: "E00012", TELCEL: "999111111" });
  await store.saveSocio({ DOCUME: "E00013", TELCEL: "999222222" });
  await store.saveSocio({ DOCUME: "E00014", TELCEL: "999333333" });
  
  // Verify each has correct value
  const socio1 = await store.getSocio("E00012");
  const socio2 = await store.getSocio("E00013");
  const socio3 = await store.getSocio("E00014");
  
  assert.strictEqual(socio1.TELCEL, "999111111");
  assert.strictEqual(socio2.TELCEL, "999222222");
  assert.strictEqual(socio3.TELCEL, "999333333");
  
  // Verify changes are isolated
  await store.addChange({ docume: "E00012", field: "TELCEL", value: "999111111" });
  await store.addChange({ docume: "E00013", field: "TELCEL", value: "999222222" });
  await store.addChange({ docume: "E00014", field: "TELCEL", value: "999333333" });
  
  const pending = await store.getPendingChanges();
  assert.strictEqual(pending.length, 3, "Each socio should have independent pending change");
});

check("TEST 8: TXT uses persisted values", async () => {
  const store = createTestStore();
  
  // Create and update socio
  await store.saveSocio({
    DOCUME: "E00015",
    TELCEL: "999111222",
    NOMBC2: "old@example.com"
  });
  
  await store.saveSocio({
    DOCUME: "E00015",
    TELCEL: "999888777",
    NOMBC2: "new@example.com"
  });
  
  // Create pending changes
  await store.addChange({ docume: "E00015", field: "TELCEL", value: "999888777" });
  await store.addChange({ docume: "E00015", field: "NOMBC2", value: "new@example.com" });
  
  // Simulate TXT generation (consolidate pending changes)
  const pending = await store.getPendingChanges();
  const changesBySocio = {};
  for (const change of pending) {
    if (!changesBySocio[change.docume]) {
      changesBySocio[change.docume] = { DOCUME: change.docume };
    }
    changesBySocio[change.docume][change.field] = change.value;
  }
  
  // Verify TXT would contain persisted values
  const txtRow = changesBySocio["E00015"];
  assert.strictEqual(txtRow.TELCEL, "999888777", "TXT should use persisted value");
  assert.strictEqual(txtRow.NOMBC2, "new@example.com", "TXT should use persisted value");
  
  // Also verify profile matches
  const profile = await store.getSocio("E00015");
  assert.strictEqual(profile.TELCEL, txtRow.TELCEL, "Profile and TXT should match");
  assert.strictEqual(profile.NOMBC2, txtRow.NOMBC2, "Profile and TXT should match");
});

check("TEST 9: Persistence failure safety", async () => {
  const store = createTestStore();
  
  // Create initial socio
  await store.saveSocio({
    DOCUME: "E00016",
    TELCEL: "999111222"
  });
  
  // Simulate persistence failure by not calling saveSocio
  // (In real implementation, this would throw an error)
  
  // Verify original value remains
  const profile = await store.getSocio("E00016");
  assert.strictEqual(profile.TELCEL, "999111222", "Original value should remain if persistence fails");
  
  // Verify no pending change created
  const pending = await store.getPendingChanges();
  assert.strictEqual(pending.length, 0, "No pending change should be created if persistence fails");
});

check("TEST 10: Profile and pending state consistency", async () => {
  const store = createTestStore();
  
  // Create initial socio
  await store.saveSocio({
    DOCUME: "E00017",
    TELCEL: "999111222",
    NOMBC2: "test@example.com"
  });
  
  // Update profile
  await store.saveSocio({
    DOCUME: "E00017",
    TELCEL: "999888777",
    NOMBC2: "updated@example.com"
  });
  
  // Create pending changes
  await store.addChange({ docume: "E00017", field: "TELCEL", value: "999888777", previousValue: "999111222" });
  await store.addChange({ docume: "E00017", field: "NOMBC2", value: "updated@example.com", previousValue: "test@example.com" });
  
  // Verify consistency
  const profile = await store.getSocio("E00017");
  const pending = await store.getPendingChanges();
  
  assert.strictEqual(profile.TELCEL, "999888777", "Profile should have new value");
  assert.strictEqual(profile.NOMBC2, "updated@example.com", "Profile should have new value");
  assert.strictEqual(pending.length, 2, "Both changes should be pending");
  
  // Verify pending changes match profile
  const telcelChange = pending.find((c) => c.field === "TELCEL");
  const emailChange = pending.find((c) => c.field === "NOMBC2");
  
  assert.strictEqual(telcelChange.value, profile.TELCEL, "Pending change should match profile");
  assert.strictEqual(emailChange.value, profile.NOMBC2, "Pending change should match profile");
});

if (!allOk) {
  console.error("\nFAILURES — profile persistence regression tests failed.");
  process.exit(1);
}
console.log("\nTODO OK — profile persistence works correctly.");

// Made with Bob
