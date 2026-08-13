# Pending Changes & Batch System - Implementation Guide

## Overview

This document describes the implementation of the socio profile update workflow with pending changes and batch TXT generation for the Cooperativa IBM portal, as specified in PRD 2.

## Architecture

```
Frontend (Portal)
    ↓
Express API
    ↓
Store (File/Cloudant)
    ↓
Changes + Batches
    ↓
TXT Generator
```

## Key Concepts

### 1. Pending Changes

When a socio updates their profile through the portal:
- Changes are **not** applied directly to the socio record
- Each field change creates a **pending change** record
- Changes remain in `PENDING` status until exported

### 2. Consolidation

Multiple changes from the same socio are consolidated:
- **Last value wins** for the same field
- **One socio = one TXT row** regardless of number of changes
- Changes made after a batch export remain pending for the next batch

### 3. Batch Generation

Admin generates batches on demand:
- Fetches all pending changes
- Consolidates by socio (DOCUME)
- Validates consolidated data
- Generates TXT with 21 fields
- Marks changes as `EXPORTED`
- Associates changes with batch ID

### 4. Status Lifecycle

```
PENDING → EXPORTED → APPLIED
                  ↘ ERROR
```

- **PENDING**: Change saved but not yet exported
- **EXPORTED**: Included in a TXT batch
- **APPLIED**: Confirmed loaded into DB2 (future)
- **ERROR**: Failed to load (future)

## Data Models

### Change Record

```javascript
{
  id: "change-123",
  docume: "100001",
  field: "TELCEL",
  value: "999888777",
  previousValue: "999111222",
  status: "PENDING",
  batchId: null,
  createdAt: "2026-08-12T10:30:00Z",
  updatedAt: "2026-08-12T10:30:00Z"
}
```

### Batch Record

```javascript
{
  id: "BATCH-20260812T153045",
  filename: "socios_delta_20260812T153045.txt",
  recordCount: 37,
  status: "EXPORTED",
  createdBy: "admin",
  createdAt: "2026-08-12T15:30:45Z"
}
```

## API Endpoints

### PUT /api/socios/:docume

Updates socio profile by creating pending changes.

**Request:**
```json
{
  "TELCEL": "999888777",
  "NOMBC2": "nuevo@example.com",
  "DIRECC": "Av. Nueva 123"
}
```

**Response:**
```json
{
  "ok": true,
  "socio": { ... },
  "pendingChanges": 3
}
```

### POST /api/socios/txt (Admin)

Generates a batch from pending changes.

**Response:**
```json
{
  "ok": true,
  "batch": {
    "id": "BATCH-20260812T153045",
    "filename": "socios_delta_20260812T153045.txt",
    "recordCount": 37,
    "createdAt": "2026-08-12T15:30:45Z"
  },
  "txt": "100001;1;40123456;...",
  "bytes": 2048
}
```

### GET /api/admin/pending-changes (Admin)

Returns summary of pending changes grouped by socio.

**Response:**
```json
{
  "totalSocios": 12,
  "totalChanges": 37,
  "socios": [
    {
      "docume": "100001",
      "changes": [
        {
          "id": "change-1",
          "field": "TELCEL",
          "value": "999888777",
          "previousValue": "999111222",
          "createdAt": "2026-08-12T10:30:00Z"
        }
      ]
    }
  ]
}
```

### GET /api/admin/batches (Admin)

Returns batch history, newest first.

**Response:**
```json
{
  "batches": [
    {
      "id": "BATCH-20260812T153045",
      "filename": "socios_delta_20260812T153045.txt",
      "recordCount": 37,
      "status": "EXPORTED",
      "createdBy": "admin",
      "createdAt": "2026-08-12T15:30:45Z"
    }
  ]
}
```

### GET /api/admin/batches/:id (Admin)

Returns batch details with associated changes.

## TXT Format

- **21 fields** per row
- **Semicolon-delimited** (`;`)
- **CRLF** line endings (`\r\n`)
- **Empty field** = "no tocar" (don't modify in S400)
- **UTF-8** encoding

Example:
```
100001;1;40123456;PEREZ;GARCIA;JUAN;Av. Test 123;;;;;;;;999888777;1;150131;;;S;;ANALISTA;;
100002;;;;;;;;;;;;;;;;;C;;;;
```

## Consolidation Logic

```javascript
// Group changes by socio
const changesBySocio = {};
for (const change of pendingChanges) {
  if (!changesBySocio[change.docume]) {
    changesBySocio[change.docume] = { DOCUME: change.docume };
  }
  // Last value wins
  changesBySocio[change.docume][change.field] = change.value;
}

// Convert to rows
const rows = Object.values(changesBySocio);
```

## Example Workflow

### 1. Socio Updates Profile

```javascript
// Socio 100001 updates phone
PUT /api/socios/100001
{
  "TELCEL": "999888777"
}

// Creates pending change
{
  id: "change-1",
  docume: "100001",
  field: "TELCEL",
  value: "999888777",
  status: "PENDING"
}
```

### 2. Socio Updates Again

```javascript
// Same socio updates email
PUT /api/socios/100001
{
  "NOMBC2": "nuevo@example.com"
}

// Creates another pending change
{
  id: "change-2",
  docume: "100001",
  field: "NOMBC2",
  value: "nuevo@example.com",
  status: "PENDING"
}
```

### 3. Admin Generates Batch

```javascript
POST /api/socios/txt

// Consolidates both changes into ONE row:
// 100001;;;;;;;;;;;nuevo@example.com;999888777;;;;;;;;;

// Marks both changes as EXPORTED
// Associates with BATCH-20260812T153045
```

### 4. Socio Updates After Export

```javascript
// Socio updates address
PUT /api/socios/100001
{
  "DIRECC": "Av. Nueva 456"
}

// Creates NEW pending change
{
  id: "change-3",
  docume: "100001",
  field: "DIRECC",
  value: "Av. Nueva 456",
  status: "PENDING"
}

// Previous changes remain EXPORTED
// This change will be in the NEXT batch
```

## Testing

Run the test suite:

```bash
node backend/test/pending-changes.test.js
node backend/test/txt.gold.test.js
```

All tests should pass:
- ✓ Pending changes creation
- ✓ Status filtering
- ✓ Consolidation (last value wins)
- ✓ One socio = one row
- ✓ Batch generation
- ✓ Change status updates
- ✓ Post-export pending changes
- ✓ TXT format validation

## Admin UI

The admin interface shows:

1. **Pending Changes Summary**
   - Total changes count
   - Total socios affected
   - List of changes by socio

2. **Batch Generation**
   - "Generar Batch TXT" button
   - Disabled when no pending changes
   - Downloads TXT file
   - Updates summary after generation

3. **Batch History**
   - List of all generated batches
   - Batch ID, filename, record count, date
   - Download button for each batch

### Future: DB2 Integration

When DB2 integration is added:
- Portal will read authoritative data from COOPESOCIOS table
- Changes will still go through pending → exported → applied flow
- Status will update to APPLIED after DB2 confirms the update