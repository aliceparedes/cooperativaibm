// verify.js — IBM Cloud App ID OIDC integration (Authorization Code flow).
//
// Flujo:
//   GET /api/auth/verify/login     → redirect a App ID + cookie firmado state
//   GET /api/auth/verify/callback  → validar state → exchange code → validateIdToken → socioLogin
//
// Seguridad (§13.3):
//   1. ID token validado con jose (createRemoteJWKSet + jwtVerify): issuer, aud, exp
//   2. JWT interno en cookie httpOnly; Secure; SameSite=lax (no URL, no localStorage)
//   3. State CSRF: cookie firmada HMAC-SHA256 + timingSafeEqual en callback
//
// Endpoints: obtenidos de OIDC discovery (/.well-known/openid-configuration).
// NO hardcodear URLs — el discovery document es la fuente de autoridad.
//
// App ID discovery (us-south, tenant 524049aa):
//   authorization_endpoint: .../authorization (NOT /authorize)
//   token_endpoint:         .../token
//   jwks_uri:               .../publickeys  (NOT /jwk)
//   userinfo_endpoint:      .../userinfo
//   scopes_supported:       ["openid"]
//   claims_supported:       iss, aud, exp, tenant, iat, sub, nonce, amr, oauth_client
//   ⚠️ email NOT in claims_supported — may need userinfo fallback

const { createRemoteJWKSet, jwtVerify } = require("jose");
const crypto = require("crypto");
const ibmdb = require("ibm_db");
const { socioLogin } = require("./auth");

// ─── env vars ───────────────────────────────────────────────────────────────
const ISSUER = (process.env.APP_ID_OAUTH_SERVER_URL || "").replace(/\/+$/, "");
const CLIENT_ID = process.env.APP_ID_CLIENT_ID || "";
const CLIENT_SECRET = process.env.APP_ID_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.APP_ID_REDIRECT_URI || "";
const STATE_SECRET = process.env.STATE_SECRET || "";

// ─── DB2 direct connection ──────────────────────────────────────────────────
const DB2_CONN_STR = process.env.DB2_CONNECTION_STRING || "";
const DB2_HOST = process.env.DB2_HOST || "";
const DB2_PORT = process.env.DB2_PORT || "30426";
const DB2_USER = process.env.DB2_USER || "";
const DB2_PASSWORD = process.env.DB2_PASSWORD || "";
const DB2_DATABASE = process.env.DB2_DATABASE || "bludb";

let _db2Conn = null;

function getDb2Conn() {
  if (_db2Conn) return _db2Conn;

  const connStr = DB2_CONN_STR || (
    DB2_HOST && DB2_USER
      ? `DATABASE=${DB2_DATABASE};HOSTNAME=${DB2_HOST};PORT=${DB2_PORT};PROTOCOL=TCPIP;UID=${DB2_USER};PWD=${DB2_PASSWORD};Security=SSL;`
      : ""
  );

  if (!connStr) {
    console.warn("[verify] DB2 env vars not set — direct lookup disabled");
    return null;
  }

  _db2Conn = ibmdb.openSync(connStr);
  console.log("[verify] DB2 connection opened");
  return _db2Conn;
}

// DB2 COOPESOCIOS keys socios by CODEMPLEADO, not DOCUME (verified: no DOCUME
// column). Mirrors dataapi.js DB2_TO_S400 so the direct path exposes DOCUME the
// same way the dataapi read path does (socioLogin + frontend expect it).
function rowToSocio(row) {
  const socio = {};
  for (const [key, val] of Object.entries(row)) {
    socio[key.toUpperCase()] = val;
  }
  if (socio.DOCUME == null && socio.CODEMPLEADO != null) {
    socio.DOCUME = socio.CODEMPLEADO;
  }
  return socio;
}

/**
 * Direct DB2 lookup: email → full socio record.
 * Tries NOMBC2 first (primary IBM email), then EMAILEMPLEADO (alternate).
 * Returns { status: 'ok', socio } | { status: 'not_found' }
 */
function lookupSocioByEmailDirect(email) {
  return new Promise((resolve) => {
    const conn = getDb2Conn();
    if (!conn) return resolve({ status: "unavailable", error: "DB2 connection not initialized" });

    // Try NOMBC2 first (primary IBM email used for OIDC)
    const sqlNombc2 = `SELECT * FROM MSZ77777.COOPESOCIOS WHERE LOWER(TRIM(NOMBC2)) = LOWER(TRIM(?)) FETCH FIRST 2 ROWS ONLY`;

    try {
      conn.query(sqlNombc2, [email], (err, rows) => {
        if (err) {
          console.error("[verify] DB2 lookup error (nombc2):", err.message);
          return resolve({ status: "unavailable", error: err.message });
        }
        if (rows && rows.length > 0) {
          if (rows.length > 1) {
            console.warn("[verify] ambiguous email in nombc2 — multiple rows:", rows.length);
          }
          const socio = rowToSocio(rows[0]);
          return resolve({ status: "ok", socio });
        }

        // Fallback: try EMAILEMPLEADO (alternate email, used by jubilados and others)
        console.log("[verify] not found in nombc2, trying emailempleado for:", email);
        const sqlAlt = `SELECT * FROM MSZ77777.COOPESOCIOS WHERE LOWER(TRIM(EMAILEMPLEADO)) = LOWER(TRIM(?)) FETCH FIRST 2 ROWS ONLY`;

        conn.query(sqlAlt, [email], (err2, rows2) => {
          if (err2) {
            console.error("[verify] DB2 lookup error (emailempleado):", err2.message);
            return resolve({ status: "unavailable", error: err2.message });
          }
          if (!rows2 || rows2.length === 0) {
            return resolve({ status: "not_found" });
          }
          if (rows2.length > 1) {
            console.warn("[verify] ambiguous email in emailempleado — multiple rows:", rows2.length);
          }
          const socio = rowToSocio(rows2[0]);
          resolve({ status: "ok", socio });
        });
      });
    } catch (e) {
      console.error("[verify] DB2 lookup exception:", e.message);
      resolve({ status: "unavailable", error: e.message });
    }
  });
}

// ─── OIDC discovery (fetch endpoints from .well-known) ─────────────────────
let _discovery = null;

async function getDiscovery() {
  if (_discovery) return _discovery;

  if (!ISSUER) throw new Error("APP_ID_OAUTH_SERVER_URL not configured");

  const url = `${ISSUER}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}): ${await res.text()}`);
  }

  _discovery = await res.json();

  const required = ["authorization_endpoint", "token_endpoint", "jwks_uri", "issuer"];
  for (const field of required) {
    if (!_discovery[field]) {
      throw new Error(`OIDC discovery missing required field: ${field}`);
    }
  }

  console.log("[verify] OIDC discovery loaded:", {
    issuer: _discovery.issuer,
    authorization_endpoint: _discovery.authorization_endpoint,
    token_endpoint: _discovery.token_endpoint,
    jwks_uri: _discovery.jwks_uri,
    userinfo_endpoint: _discovery.userinfo_endpoint,
  });

  return _discovery;
}

// ─── JWKS remote key set (cached by jose) ──────────────────────────────────
let _jwks = null;

async function getJwks() {
  if (_jwks) return _jwks;

  const discovery = await getDiscovery();
  _jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  return _jwks;
}

// ─── state helpers (HMAC-SHA256 signed cookie) ──────────────────────────────
function signState(state) {
  const hmac = crypto.createHmac("sha256", STATE_SECRET);
  hmac.update(state);
  return `${state}.${hmac.digest("hex")}`;
}

function verifyState(signed, queryState) {
  const dot = signed.lastIndexOf(".");
  if (dot < 0) return false;
  const raw = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);

  if (raw !== queryState) return false;

  const hmac = crypto.createHmac("sha256", STATE_SECRET);
  hmac.update(raw);
  const expectedSig = hmac.digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"));
  } catch {
    return false;
  }
}

// ─── build authorization URL ────────────────────────────────────────────────
async function buildAuthUrl() {
  const discovery = await getDiscovery();
  const state = crypto.randomBytes(24).toString("hex");
  const nonce = crypto.randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    state,
    nonce,
  });
  return { url: `${discovery.authorization_endpoint}?${params}`, state, nonce };
}

// ─── exchange authorization code for tokens ─────────────────────────────────
async function exchangeCode(code) {
  const discovery = await getDiscovery();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── get authenticated identity (single function) ──────────────────────────
// Identity flow:
//   1. Validate ID token (signature, issuer, audience, expiration)
//   2. Extract sub (OIDC subject identifier — most stable)
//   3. Extract email from ID token if present
//   4. If no email, call /userinfo as fallback
//   5. Normalize email (lowercase, trim)
//
// The sub claim is the authoritative OIDC subject identifier.
// Email is derived, not the primary identity key.
async function getAuthenticatedIdentity(idToken, accessToken) {
  const jwks = await getJwks();
  const discovery = await getDiscovery();

  // 1. Validate ID token (signature, issuer, audience, expiration)
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: discovery.issuer,
    audience: CLIENT_ID,
  });

  const sub = payload.sub;
  if (!sub) {
    throw new Error("ID token missing sub claim");
  }

  // 2. Try email from ID token
  let email = payload.email || payload.preferred_username || null;

  // 3. Fallback to /userinfo if email not in ID token
  if (!email && accessToken && discovery.userinfo_endpoint) {
    console.log("[verify] email not in ID token, trying userinfo...");
    try {
      const res = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const info = await res.json();
        email = info.email || info.preferred_username || null;
      }
    } catch (e) {
      console.warn("[verify] userinfo request failed:", e.message);
    }
  }

  if (!email) {
    throw new Error("No email found in ID token or userinfo");
  }

  // 4. Normalize email
  const normalizedEmail = email.trim().toLowerCase();

  return { sub, email: normalizedEmail, payload };
}

// ─── cookie helpers ─────────────────────────────────────────────────────────
const IS_LOCAL = process.env.NODE_ENV !== "production" && !process.env.APP_ID_REDIRECT_URI?.includes("https");

const COOKIE_OPTS = {
  httpOnly: true,
  secure: !IS_LOCAL,
  sameSite: IS_LOCAL ? "lax" : "none",
  path: "/",
  maxAge: 12 * 60 * 60 * 1000, // 12h
};

function setAuthCookie(res, token) {
  res.cookie("auth_token", token, COOKIE_OPTS);
}

function clearAuthCookie(res) {
  res.clearCookie("auth_token", { path: "/" });
}

// ─── middleware: cookie → Authorization header ──────────────────────────────
function cookieToAuth(req, _res, next) {
  if (!req.headers.authorization && req.cookies && req.cookies.auth_token) {
    req.headers.authorization = `Bearer ${req.cookies.auth_token}`;
  }
  next();
}

// ─── express handlers ──────────────────────────────────────────────────────
async function verifyLoginHandler(req, res) {
  try {
    const { url, state, nonce } = await buildAuthUrl();
    const signed = signState(state);

    res.cookie("verify_state", signed, {
      httpOnly: true,
      secure: !IS_LOCAL,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000,
    });

    res.cookie("verify_nonce", nonce, {
      httpOnly: true,
      secure: !IS_LOCAL,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000,
    });

    res.redirect(url);
  } catch (e) {
    console.error("[verify/login]", e.message);
    return res.status(500).json({ error: "Error iniciando autenticación: " + e.message });
  }
}

async function verifyCallbackHandler(req, res) {
  const { code, state } = req.query;

  const signedState = req.cookies && req.cookies.verify_state;
  if (!signedState || !state || !verifyState(signedState, state)) {
    return res.status(403).json({ error: "State inválido — posible CSRF." });
  }

  if (!code) {
    return res.status(400).json({ error: "Falta el code de autorización." });
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.id_token) {
      return res.status(401).json({ error: "No se recibió id_token." });
    }

    const { sub, email, payload } = await getAuthenticatedIdentity(tokens.id_token, tokens.access_token);
    console.log("[verify] authenticated:", { sub, email });

    // Direct DB2 lookup — bypasses dataapi /by-email endpoint which returns incomplete data
    console.log("[verify/callback] looking up email:", email);
    const read = await lookupSocioByEmailDirect(email);
    console.log("[verify/callback] DB2 result:", read.status, read.socio ? read.socio.DOCUME : "no socio");

    if (read.status === "not_found") {
      console.error("[verify/callback] not_found for email:", email);
      return res.status(404).json({
        error: `No se encontró socio con correo ${email}. Verifica que tu correo esté registrado en la cooperativa.`,
      });
    }

    if (read.status === "ambiguous") {
      console.error("[verify/callback] ambiguous for email:", email);
      return res.status(409).json({
        error: `Tu correo ${email} está registrado en múltiples socios. Contacta a la cooperativa para resolver esta ambigüedad.`,
      });
    }

    if (read.status === "unavailable") {
      console.error("[verify/callback] unavailable for email:", email);
      return res.status(503).json({ error: "Base de datos no disponible — intenta de nuevo." });
    }

    const token = socioLogin(read.socio);
    console.log("[verify/callback] token generated, redirecting to frontend");

    setAuthCookie(res, token);
    res.clearCookie("verify_state", { path: "/" });
    res.clearCookie("verify_nonce", { path: "/" });

    const frontendUrl = process.env.FRONTEND_URL || "https://coop-frontend.2dfzriph4wl8.us-south.codeengine.appdomain.cloud";
    // El token viaja solo en la cookie httpOnly (auth_token), nunca en el URL
    // (§13.3: token en query param = logs/history/analytics).
    const redirectUrl = `${frontendUrl}/?auth=success`;
    console.log("[verify/callback] redirecting to:", redirectUrl.substring(0, 80) + "...");
    res.redirect(redirectUrl);
  } catch (e) {
    console.error("[verify/callback]", e.message);
    res.clearCookie("verify_state", { path: "/" });
    res.clearCookie("verify_nonce", { path: "/" });
    return res.status(500).json({ error: "Error en la autenticación: " + e.message });
  }
}

module.exports = {
  getDiscovery,
  buildAuthUrl,
  exchangeCode,
  getAuthenticatedIdentity,
  lookupSocioByEmailDirect,
  verifyLoginHandler,
  verifyCallbackHandler,
  cookieToAuth,
  setAuthCookie,
  clearAuthCookie,
};
