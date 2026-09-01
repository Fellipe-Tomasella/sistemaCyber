/**
 * Cripto — segue o padrão DynCash.
 * - Documentos (CPF/CNPJ): argon2id + pepper (Bun.password) + lookup HMAC-SHA256
 * - Senhas: bcrypt 12 rounds (Bun.password)
 * - Segredos em repouso: AES-256-GCM
 * - Tokens de refresh: SHA-256 (armazenado hasheado)
 */
import { createHmac, createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { env } from "../config/env.ts";

/* ---------- Senhas ---------- */
export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost: 12 });
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}

/* ---------- Documentos (CPF/CNPJ) ---------- */
export function hashDocument(digits: string): Promise<string> {
  return Bun.password.hash(digits + env.DOCUMENT_HASH_PEPPER, { algorithm: "argon2id" });
}
export function verifyDocument(digits: string, hash: string): Promise<boolean> {
  return Bun.password.verify(digits + env.DOCUMENT_HASH_PEPPER, hash);
}
/** Coluna determinística para WHERE no login (HMAC com pepper). */
export function documentLookup(digits: string): string {
  return createHmac("sha256", env.DOCUMENT_HASH_PEPPER).update(digits).digest("hex");
}
/** E-mail também é indexado por lookup (case-insensitive). */
export function emailLookup(email: string): string {
  return createHmac("sha256", env.DOCUMENT_HASH_PEPPER).update(email.trim().toLowerCase()).digest("hex");
}

/* ---------- Tokens ---------- */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("hex");
}
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/* ---------- AES-256-GCM (segredos em repouso, ex.: token de gateway) ---------- */
const AES_KEY = Buffer.from(env.AES_ENCRYPTION_KEY, "hex");
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", AES_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}
export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = createDecipheriv("aes-256-gcm", AES_KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

/* ---------- Assinatura de QR (carteirinha / ingresso / pedido) ---------- */
export function signQr(uuid: string): string {
  return createHmac("sha256", env.DOCUMENT_HASH_PEPPER).update("qr:" + uuid).digest("hex").slice(0, 16);
}
export function verifyQr(uuid: string, sig: string): boolean {
  return signQr(uuid) === sig;
}
