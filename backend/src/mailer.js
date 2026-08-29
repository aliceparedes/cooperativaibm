// Envío de correo (SMTP / nodemailer).
//
// Se usa para notificar a los socios cada vez que se publica un anuncio.
// Config por env vars:
//   SMTP_HOST       host del servidor SMTP           (obligatorio para enviar)
//   SMTP_PORT       puerto (default 587)
//   SMTP_SECURE     "true" para TLS directo (puerto 465); default false (STARTTLS)
//   SMTP_USER       usuario SMTP                       (obligatorio para enviar)
//   SMTP_PASS       contraseña SMTP                    (obligatorio para enviar)
//   MAIL_FROM       remitente, ej. "Cooperativa IBM <noreply@coopibm.pe>"
//                   (default: SMTP_USER)
//
// Si falta configuración, sendAnuncioEmail() no lanza: registra un aviso y
// devuelve { sent: 0, skipped: true } para no romper la publicación del anuncio.

const nodemailer = require("nodemailer");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let cachedTransport;

function getTransport() {
  if (cachedTransport !== undefined) return cachedTransport;

  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    cachedTransport = null;
    return null;
  }

  cachedTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return cachedTransport;
}

function fromAddress() {
  return process.env.MAIL_FROM || process.env.SMTP_USER;
}

// Extrae correos válidos y únicos de la lista de socios (campo NOMBC2).
function recipientsFromSocios(socios) {
  const seen = new Set();
  const out = [];
  for (const s of socios || []) {
    const email = String((s && s.NOMBC2) || "").trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function renderAnuncio(anuncio) {
  const frontend = process.env.FRONTEND_URL || "";
  const text =
    `${anuncio.text}\n\n` +
    `— ${anuncio.author || "Cooperativa IBM"}` +
    (frontend ? `\n\nVer más en ${frontend}` : "");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2933;line-height:1.6">` +
    `<p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(anuncio.text)}</p>` +
    `<p style="margin:0;color:#52606d">— ${escapeHtml(anuncio.author || "Cooperativa IBM")}</p>` +
    (frontend
      ? `<p style="margin:16px 0 0"><a href="${escapeHtml(frontend)}" style="color:#0043ce">Ver en el portal</a></p>`
      : "") +
    `</div>`;
  return { text, html };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderProveedor(prov) {
  const frontend = process.env.FRONTEND_URL || "";
  const lines = [
    `Nuevo proveedor con convenio: ${prov.name}`,
    prov.cat ? `Categoría: ${prov.cat}` : "",
    prov.disc ? `Beneficio: ${prov.disc}` : "",
    prov.desc || "",
    prov.link ? `Más info: ${prov.link}` : "",
    frontend ? `\nVer todos los convenios en ${frontend}` : ""
  ].filter(Boolean);
  const text = lines.join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2933;line-height:1.6">` +
    `<p style="margin:0 0 8px;font-weight:700">Nuevo proveedor con convenio: ${escapeHtml(prov.name)}</p>` +
    (prov.cat ? `<p style="margin:0 0 4px;color:#52606d">Categoría: ${escapeHtml(prov.cat)}</p>` : "") +
    (prov.disc ? `<p style="margin:0 0 4px;color:#52606d">Beneficio: ${escapeHtml(prov.disc)}</p>` : "") +
    (prov.desc ? `<p style="white-space:pre-wrap;margin:12px 0 0">${escapeHtml(prov.desc)}</p>` : "") +
    (prov.link
      ? `<p style="margin:12px 0 0"><a href="${escapeHtml(prov.link)}" style="color:#0043ce">Más información</a></p>`
      : "") +
    (frontend
      ? `<p style="margin:16px 0 0"><a href="${escapeHtml(frontend)}" style="color:#0043ce">Ver todos los convenios en el portal</a></p>`
      : "") +
    `</div>`;
  return { text, html };
}

// Envía un correo (BCC) a todos los socios con email válido.
// No lanza: cualquier error se registra y se refleja en el resultado.
// `kind` y `id` solo se usan para los mensajes de log.
async function sendToSocios({ subject, text, html }, socios, kind = "mensaje", id = "") {
  const transport = getTransport();
  if (!transport) {
    console.warn(
      `[mailer] SMTP no configurado (SMTP_HOST/SMTP_USER/SMTP_PASS) — ${kind} no notificado por correo.`
    );
    return { sent: 0, skipped: true };
  }

  const recipients = recipientsFromSocios(socios);
  if (!recipients.length) {
    console.warn(`[mailer] no hay socios con correo válido — ${kind} no notificado.`);
    return { sent: 0, skipped: false };
  }

  try {
    await transport.sendMail({
      from: fromAddress(),
      to: fromAddress(), // destinatario visible = remitente; socios en BCC
      bcc: recipients,
      subject,
      text,
      html
    });
    console.log(`[mailer] ${kind} ${id} notificado a ${recipients.length} socio(s).`);
    return { sent: recipients.length, skipped: false };
  } catch (e) {
    console.error(`[mailer] fallo al enviar ${kind} ${id}: ${e.message}`);
    return { sent: 0, skipped: false, error: e.message };
  }
}

// Notifica a los socios de un nuevo anuncio.
function sendAnuncioEmail(anuncio, socios) {
  const { text, html } = renderAnuncio(anuncio);
  const subject = `📢 Nuevo anuncio — ${anuncio.author || "Cooperativa IBM"}`;
  return sendToSocios({ subject, text, html }, socios, "anuncio", anuncio.id);
}

// Notifica a los socios de un nuevo proveedor / convenio.
function sendProveedorEmail(prov, socios) {
  const { text, html } = renderProveedor(prov);
  const subject = `🤝 Nuevo convenio para socios — ${prov.name}`;
  return sendToSocios({ subject, text, html }, socios, "proveedor", prov.id);
}

module.exports = {
  sendAnuncioEmail,
  sendProveedorEmail,
  sendToSocios,
  recipientsFromSocios,
  getTransport
};
