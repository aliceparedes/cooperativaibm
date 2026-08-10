const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const JWT_SECRET = process.env.JWT_SECRET || "";

if (!JWT_SECRET) {
  console.warn(
    "[WARN] JWT_SECRET is not set. Using an insecure development default — set a real secret before deploying."
  );
}
const secret = JWT_SECRET || "dev-only-insecure-secret-change-me";

if (!ADMIN_PASSWORD_HASH && !ADMIN_PASSWORD) {
  console.warn(
    "[WARN] Neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD is set. Admin login will always fail until one is configured."
  );
}

async function login(user, pass) {
  if (user !== ADMIN_USER) return null;

  let ok = false;
  if (ADMIN_PASSWORD_HASH) {
    ok = await bcrypt.compare(pass, ADMIN_PASSWORD_HASH);
  } else if (ADMIN_PASSWORD) {
    ok = pass === ADMIN_PASSWORD;
  }
  if (!ok) return null;

  return jwt.sign({ role: "admin", user }, secret, { expiresIn: "12h" });
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autorizado." });
  try {
    const payload = jwt.verify(token, secret);
    if (payload.role !== "admin") return res.status(403).json({ error: "Prohibido." });
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o expirada." });
  }
}

module.exports = { login, requireAdmin };
