/**
 * Motor de e-mail (SMTP). Conecta no Gmail com senha de app (env SMTP_*).
 * Se o SMTP não estiver configurado, cai num fallback que só LOGA no console
 * (útil em dev: o código de verificação aparece no log).
 */
import nodemailer from "nodemailer";
import { randomInt } from "node:crypto";
import { env } from "../config/env.ts";

let _tx: nodemailer.Transporter | null = null;
function transporter() {
  if (_tx) return _tx;
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  _tx = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,          // 465 = SSL; 587 = STARTTLS
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return _tx;
}
export const mailEnabled = () => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
const FROM = () => env.SMTP_FROM || (env.SMTP_USER ? `AtléticaHub <${env.SMTP_USER}>` : "AtléticaHub <no-reply@atleticahub.app>");

/** Código numérico de 6 dígitos (verificação / recuperação). */
export const genCode = () => String(randomInt(100000, 1000000));

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }) {
  const tx = transporter();
  if (!tx) {
    const preview = opts.text || opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    console.log(`\n📧 [mailer:dev] SMTP não configurado — e-mail NÃO enviado.\n   Para: ${opts.to}\n   Assunto: ${opts.subject}\n   Prévia: ${preview}\n`);
    return { sent: false };
  }
  try {
    await tx.sendMail({ from: FROM(), to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
    return { sent: true };
  } catch (e) {
    console.error("📧 [mailer] falha ao enviar:", (e as Error).message);
    return { sent: false, error: (e as Error).message };
  }
}

/* ---------------- Templates (HTML inline, compatível com clientes de e-mail) ---------------- */
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const brl = (c: number) => "R$ " + ((c || 0) / 100).toFixed(2).replace(".", ",");

function layout(brand: string, heading: string, body: string) {
  return `<div style="background:#0a0d13;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#0d1117;border:1px solid #1b2740;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(120deg,#0f3c66,#0b1a2c);padding:20px 28px">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#00bfff;font-weight:bold">${esc(brand)}</div>
      </div>
      <div style="padding:26px 28px;color:#c9d6e5;font-size:15px;line-height:1.6">
        <h1 style="color:#ffffff;font-size:22px;margin:0 0 14px">${esc(heading)}</h1>
        ${body}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #1b2740;color:#5a6b80;font-size:12px">Enviado por ${esc(brand)} · feito com AtléticaHub</div>
    </div>
  </div>`;
}
const codeBox = (code: string) => `<div style="margin:18px 0;padding:16px;border:1px solid #17456f;border-radius:12px;background:#0f1a26;text-align:center;font-size:30px;letter-spacing:8px;color:#ffffff;font-weight:bold">${esc(code)}</div>`;

export function sendVerificationEmail(to: string, name: string | undefined, code: string, brand: string) {
  const hi = name ? ", " + esc(name.split(" ")[0]) : "";
  const body = `<p>Olá${hi}! Bem-vindo(a) à ${esc(brand)}.</p><p>Use o código abaixo pra confirmar seu e-mail:</p>${codeBox(code)}<p style="color:#8a9bb0;font-size:13px">O código vale por 30 minutos. Se não foi você que criou a conta, ignore este e-mail.</p>`;
  return sendMail({ to, subject: `${brand} · confirme seu e-mail`, html: layout(brand, "Confirme seu e-mail", body), text: `Seu código de verificação: ${code}` });
}

export function sendPasswordResetEmail(to: string, name: string | undefined, code: string, brand: string) {
  const body = `<p>Recebemos um pedido pra redefinir sua senha.</p><p>Use este código pra criar uma nova:</p>${codeBox(code)}<p style="color:#8a9bb0;font-size:13px">Vale por 30 minutos. Se não foi você, ignore — sua senha continua a mesma.</p>`;
  return sendMail({ to, subject: `${brand} · recuperação de senha`, html: layout(brand, "Recuperar senha", body), text: `Seu código de recuperação: ${code}` });
}

export function sendOrderEmail(to: string, name: string | undefined, order: { orderNumber: number | null; totalCents: number; items?: { description: string; quantity: number; subtotalCents: number }[] }, brand: string) {
  const hi = name ? ", " + esc(name.split(" ")[0]) : "";
  const rows = (order.items || []).map((i) => `<tr><td style="padding:6px 0;color:#c9d6e5">${esc(i.description)}${i.quantity > 1 ? " × " + i.quantity : ""}</td><td style="padding:6px 0;text-align:right;color:#c9d6e5">${brl(i.subtotalCents)}</td></tr>`).join("");
  const body = `<p>Olá${hi}! Recebemos seu pedido <b>#${order.orderNumber}</b>.</p>
    <table style="width:100%;border-collapse:collapse;margin:14px 0">${rows}<tr><td style="padding:10px 0 0;border-top:1px solid #1b2740;color:#fff;font-weight:bold">Total</td><td style="padding:10px 0 0;border-top:1px solid #1b2740;text-align:right;color:#fff;font-weight:bold">${brl(order.totalCents)}</td></tr></table>
    <p style="color:#8a9bb0;font-size:13px">Assim que o pagamento for confirmado, a diretoria libera a retirada. Acompanhe em "Minhas compras".</p>`;
  return sendMail({ to, subject: `${brand} · pedido #${order.orderNumber} recebido`, html: layout(brand, "Pedido recebido 🎉", body), text: `Pedido #${order.orderNumber} — total ${brl(order.totalCents)}` });
}
