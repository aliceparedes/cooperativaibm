# Cooperativa IBM — backend API

A small Express API that the site's admin login talks to. It provides:

- `POST /api/auth/login` — admin login, returns a JWT
- `GET /api/content` — public: `{ anuncios, proveedores, tasas }`
- `POST /api/anuncios` / `DELETE /api/anuncios/:id` — admin only
- `POST /api/proveedores` / `DELETE /api/proveedores/:id` — admin only
- `PUT /api/tasas` — admin only
- `POST /api/socios/txt` — admin only; serializes partner updates to a fixed-width TXT for the S400

Storage is pluggable: a JSON file by default (fine for local testing), or
IBM Cloudant for a real deployment (`STORAGE=cloudant`).

## 1. Run it locally first

```bash
cd backend
cp .env.example .env
npm install
npm run hash-password -- "choose-a-real-password"   # paste the output into ADMIN_PASSWORD_HASH in .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # paste into JWT_SECRET in .env
npm start
```

The API listens on `http://localhost:8080`. Quick check:

```bash
curl http://localhost:8080/api/health
curl -X POST http://localhost:8080/api/auth/login -H "Content-Type: application/json" \
  -d '{"user":"admin","pass":"choose-a-real-password"}'
```

With `STORAGE=file` (the default), data is kept in `backend/data.json`, created
automatically on first run.

## 2. Deploy to IBM Cloud

This app is designed for **IBM Cloud Code Engine** (serverless containers) +
**IBM Cloudant** (managed database) — no server to patch, scales to zero when idle.

### Install the CLI (once)

```bash
curl -fsSL https://clis.cloud.ibm.com/install/osx | sh   # macOS; see cloud.ibm.com/docs/cli for other OSes
ibmcloud login --sso                                      # or `ibmcloud login -u ...`
ibmcloud target -g Default                                # or your resource group
ibmcloud plugin install code-engine
```

### Create a Cloudant instance (persistent storage)

```bash
ibmcloud resource service-instance-create coop-cloudant cloudantnosqldb lite us-south
ibmcloud resource service-key-create coop-cloudant-key Manager --instance-name coop-cloudant
ibmcloud resource service-key coop-cloudant-key   # note the "url" and "apikey" values
```

`lite` is Cloudant's free tier — fine for this app's traffic.

### Create the Code Engine project and app

```bash
ibmcloud ce project create --name coop-backend
ibmcloud ce project select --name coop-backend

# Build straight from this backend/ folder's source (no Docker needed locally)
ibmcloud ce application create --name coop-api \
  --build-source . \
  --strategy buildpacks \
  --port 8080 \
  --min-scale 0 --max-scale 2 \
  --env STORAGE=cloudant \
  --env CLOUDANT_AUTH_TYPE=IAM \
  --env CLOUDANT_DB=cooperativa-ibm \
  --env ADMIN_USER=admin \
  --env ALLOWED_ORIGIN=https://aliceparedes.github.io

# Store secrets separately (not as plain env vars)
ibmcloud ce secret create --name coop-secrets \
  --from-literal CLOUDANT_URL=<url from service-key output> \
  --from-literal CLOUDANT_APIKEY=<apikey from service-key output> \
  --from-literal ADMIN_PASSWORD_HASH=<output of `npm run hash-password -- "..."`> \
  --from-literal JWT_SECRET=<a long random string>

ibmcloud ce application update --name coop-api --env-from-secret coop-secrets
```

(If you'd rather build a container image yourself, the included `Dockerfile`
works too: `ibmcloud ce application create --name coop-api --image <your-registry-image> --port 8080 ...`
with the same env/secret flags.)

### Get the app's public URL

```bash
ibmcloud ce application get --name coop-api --output url
```

Copy that URL — you'll paste it into the frontend's `apiBase` (see the main
project's HTML file, near the top of the `Component` class) so the site
starts calling your live backend instead of holding admin edits only in the
browser tab.

### Update `ALLOWED_ORIGIN`

Set it to the exact origin your site is served from (e.g.
`https://aliceparedes.github.io` or your custom domain) so only your site can
call the API:

```bash
ibmcloud ce application update --name coop-api --env ALLOWED_ORIGIN=https://your-domain
```

## Autoservicio de socios + export TXT para el S400

Los socios actualizan su propio perfil desde el sitio; el administrador solo
**descarga el TXT bulk** con todos los socios (formato delimitado por `;`, 21
campos, CRLF) para cargarlo en el S400.

### Flujo

1. **Socio** entra a su perfil (login por conectar con IBM Verify) y edita sus
   datos → `GET /api/socios/:docume` para leer su registro y
   `PUT /api/socios/:docume` para guardar cambios.
2. **Admin** entra, nav **Descargar TXT**, y pulsa **Descargar TXT**: baja
   `socios-{YYYYMMDD}.txt` con todos los socios actualizados.
3. Entregar ese archivo a José para cargarlo en el S400.

El admin **no edita socios desde la web**; eso se hace directo en el S400.

### Convenciones del TXT

- Formato de José: filas separadas por `;`, cada fila termina en `;`, line
  endings CRLF, UTF-8.
- **21 campos** en orden fijo (ver `LAYOUT` en `backend/src/txt.js`):
  `DOCUME(6) | TIPDID(1) | DOCIDE(11) | APEPAT(20) | APEMAT(20) | NOMBRE(30) |
  DIRECC(80) | LOCALI(40) | PROVIN(40) | DEPART(40) | NCOMPL(60) |
  NOMBC2(50) | TELCEL(9) | NACION(1) | CCIUDA(6) | NOMCON(40) | DNICY(8, DNI
  del cónyuge) | ESTCIV(1) | CARGAM(2) | OFICIO(20) | SECTO1(2)`.
- **Campo vacío = no tocar** → se escribe como `;` consecutivo (nada entre
  separadores) y el S400 conserva el valor actual.
- La **clave de la fila** es `DOCUME` y siempre se manda (nunca vacío).
- `;` y saltos de línea están prohibidos dentro de cualquier valor (romperían
  el formato delimitado).

### Endpoint

`POST /api/socios/txt` (admin only) — serializa **todos** los socios de la BD
(autoservicio + demo), sin body.

Responde `200 { ok, txt, bytes }` o `422 { error, report }` donde `report`
es una lista de filas con errores, p.ej.:

```json
{
  "error": "Hay filas con errores.",
  "report": [
    { "row": 1, "docume": "100001", "errors": [{ "key": "DNICY", "field": "DNICY", "msg": "..." }] }
  ]
}
```

Las filas con errores se aíslan (el TXT no se genera si alguna falla). El
layout exacto de campos vive en `backend/src/txt.js` (21 campos, delimitado,
CRLF). Los catálogos TIPDID / NACION / ESTCIV están en el frontend y en el
`.dc.html` (constantes `OPTS`). El fixture de referencia
`backend/test/fixtures/cooperativa-txt-prueba.gold.txt` reproduce el formato
acordado con José y se verifica con `node --test` en `backend/`.

## Notes

- The admin account is a single set of credentials (no per-user accounts) —
  matches the site's current "one admin, one public" design.
- Post "likes" stay client-side only (not synced) — only anuncios,
  proveedores, and tasas are persisted through the API.
- With `STORAGE=file`, data lives in a file inside the container. Code
  Engine's filesystem isn't guaranteed to persist across restarts/scaling —
  use `STORAGE=cloudant` for anything beyond local testing.
