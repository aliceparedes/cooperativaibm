# Cooperativa Portal

Web portal for the **Cooperativa de Empleados de IBM Perú** — member self-service for personal data management.

## Overview

The portal lets cooperative members view and update their personal information (address, phone, email, profession, marital status, etc.) without direct access to the S400 or DB2 in write mode. All changes flow through the existing file-based mechanism between the portal and the mainframe.

```
MEMBER ──edit──► PORTAL ──TXT delta──► S400 (source of truth)
                          ▲
                          │  daily batch (15th file)
     PORTAL ◄── DB2 ◄─────┘
```

Key design principles:

- **S400 is the source of truth.** Nothing writes to S400 or DB2 outside the file mechanism.
- The portal **reads from DB2** (`COOPESOCIOS`) through a LoopBack data API.
- Identity fields (`DOCUME`, `TIPDID`, `NACION`) are **read-only**.

## Features

- **IBMid login** (OIDC via IBM Cloud App ID) — members sign in with their corporate IBM email; DOCUME is never requested.
- **Member profile** — view and edit personal data (address, phone, email, profession, marital status).
- **TXT delta generation** — pending changes are consolidated into a 22-field, semicolon-delimited TXT batch for the S400 loader.
- **Admin panel** — manage content (announcements, providers, rates, loans, history) and pending-change batches.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Frontend | Static HTML/CSS/JS (served via nginx) |
| Auth | IBM Cloud App ID (OIDC / Authorization Code) |
| Data | DB2 on Cloud (`COOPESOCIOS`), LoopBack data API |
| Storage | Cloudant (mirror / pending changes) |
| Deploy | Docker, IBM Cloud Code Engine |

## Repository Structure

```
backend/
  src/
    verify.js     OIDC IBMid integration (App ID)
    reads.js      profile read + pending-changes overlay
    txt.js        TXT delta serializer (22 fields)
    dataapi.js    DB2 data API client
    mailer.js     email notifications (SMTP — pending configuration)
    auth.js       JWT admin / member auth
    store.js      Cloudant / file store
  scripts/        member extract loader + code-fix utilities
index.html        frontend (static)
Dockerfile        frontend image (nginx)
flyway/           database migrations
```

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for building images)
- Access to IBM Cloud resources (see `backend/.env.example`)

### Local Development

```bash
cd backend
cp .env.example .env    # populate with your credentials
npm install
npm start               # serves on :8080
```

Serve the frontend by opening `index.html` (its `apiBase` points to the backend).

### Environment Variables

See `backend/.env.example` for the full list. Key variables:

| Variable | Purpose |
|---|---|
| `APP_ID_*` | IBM Cloud App ID OIDC configuration |
| `DB2_*` | DB2 connection details |
| `DATAAPI_URL` / `DATAAPI_ENABLED` | DB2 data API endpoint |
| `ALLOW_SOCIO_LOGIN` | Set to `false` in production (IBMid is the only login path) |
| `JWT_SECRET` | Signing secret for internal JWTs |

## Deployment

Images are published to Docker Hub and deployed to IBM Cloud Code Engine.

| App | Image | Notes |
|---|---|---|
| `coop-api` | `abigailbrionesa/coop-api` | Backend (port 8080) |
| `coop-frontend` | `abigailbrionesa/coop-frontend` | Static frontend (nginx) |
| `coop-dataapi` | — | LoopBack data API |

Deployment notes:

- `min=1` instance per app (prevents cold-start latency).
- `ALLOW_SOCIO_LOGIN=false` — member login is IBMid-only.
- Apply the same version tag across `coop-api` and `coop-frontend`.

## License

See `LICENSE`.