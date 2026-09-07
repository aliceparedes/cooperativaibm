# Cooperativa Portal

Portal web de la **Cooperativa de Empleados de IBM Perú** — autoservicio de datos personales para socios.

## qué hace

- **Login con IBMid** (OIDC via IBM Cloud App ID) — los socios entran con su correo corporativo de IBM, sin DOCUME
- **Perfil del socio**: ver y editar datos personales (dirección, teléfono, correo, profesión, estado civil, etc.)
- **TXT delta para el S400**: los cambios quedan pendientes → el admin genera un batch TXT de 22 campos → se carga al S400 → el batch diario devuelve los datos actualizados
- **Panel admin**: contenido (anuncios, proveedores, tasas, préstamos, historia), gestión de cambios pendientes y batches

## arquitectura

```
SOCIO ──edita──► PORTAL ──TXT delta──► S400 (fuente de verdad)
                              ▲
                              │  batch diario (15º archivo)
      PORTAL ◄── DB2 ◄───────┘
```

- el **S400 es la fuente de verdad** — nada escribe directo, todo pasa por el mecanismo de archivos
- el portal **lee de db2** (`COOPESOCIOS`) vía un dataapi LoopBack
- los datos de identidad (`DOCUME`, `TIPDID`, `NACION`) son **solo lectura**

## estructura

```
backend/          backend Express (API)
  src/verify.js     OIDC IBMid (App ID)
  src/reads.js      lectura del perfil + overlay de cambios pendientes
  src/txt.js        serializer TXT delta (22 campos)
  src/dataapi.js    cliente del dataapi db2
  src/mailer.js     notificaciones (SMTP — pendiente de configurar)
  scripts/          loader del extracto de socios + fix de códigos
index.html          frontend (estático, nginx)
flyway/            migraciones
```

## correr local

```bash
cd backend
cp .env.example .env    # completar credenciales
npm install
npm start               # puerto 8080
```

frontend: servir `index.html` (apunta a `apiBase` en el estado del componente).

## deploy

- imágenes Docker: `abigailbrionesa/coop-api` y `abigailbrionesa/coop-frontend` (Docker Hub)
- apps en Code Engine (`coop-backend`): `coop-api`, `coop-frontend`, `coop-dataapi`
- `min=1` instancia (evita cold start) · `ALLOW_SOCIO_LOGIN=false` (login solo por IBMid)

## docs

ver `cooperativa-update-socio-prd.md` para el PRD completo.