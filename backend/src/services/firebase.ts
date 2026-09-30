/**
 * Verificação de ID token do Firebase (login com Google) — SEM dependência externa.
 * Usa as chaves públicas do Google (JWKS) + Web Crypto do Bun.
 * Verificar um ID token precisa só do FIREBASE_PROJECT_ID (público) — a chave de
 * serviço NÃO é necessária (ela só serve pra ações admin/mint de token).
 */
import { env } from "../config/env.ts";
import { Errors } from "../utils/response.ts";

// JWKS (formato JWK) das chaves do securetoken do Firebase
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cache: { keys: Record<string, JsonWebKey>; exp: number } | null = null;

async function getKeys(force = false): Promise<Record<string, JsonWebKey>> {
  if (!force && cache && cache.exp > Date.now()) return cache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw Errors.BadRequest("Não foi possível validar o login (chaves do Google)");
  const body = (await res.json()) as { keys: Array<{ kid: string; kty: string; n: string; e: string }> };
  const keys: Record<string, JsonWebKey> = {};
  for (const k of body.keys || []) keys[k.kid] = { kty: k.kty, n: k.n, e: k.e };
  const cc = res.headers.get("cache-control") || "";
  const m = cc.match(/max-age=(\d+)/);
  const ttl = m ? parseInt(m[1], 10) * 1000 : 3600_000;
  cache = { keys, exp: Date.now() + Math.min(Math.max(ttl, 60_000), 6 * 3600_000) };
  return keys;
}

function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? 4 - (norm.length % 4) : 0;
  return Uint8Array.from(atob(norm + "=".repeat(pad)), (c) => c.charCodeAt(0));
}
function b64urlToJSON(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

export interface GoogleUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** Verifica um ID token do Firebase e devolve os dados do usuário Google. */
export async function verifyFirebaseIdToken(idToken: string): Promise<GoogleUser> {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw Errors.BadRequest("Login com Google não está configurado");

  const parts = (idToken || "").split(".");
  if (parts.length !== 3) throw Errors.Unauthorized("Token inválido");
  const [h, p, sig] = parts;

  let header: any, payload: any;
  try { header = b64urlToJSON(h); payload = b64urlToJSON(p); }
  catch { throw Errors.Unauthorized("Token inválido"); }
  if (header.alg !== "RS256" || !header.kid) throw Errors.Unauthorized("Token inválido");

  let jwk = (await getKeys())[header.kid];
  if (!jwk) jwk = (await getKeys(true))[header.kid]; // chave pode ter rotacionado
  if (!jwk) throw Errors.Unauthorized("Token inválido (chave desconhecida)");

  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key,
    b64urlToBytes(sig) as BufferSource,
    new TextEncoder().encode(`${h}.${p}`) as BufferSource,
  );
  if (!ok) throw Errors.Unauthorized("Assinatura do token inválida");

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw Errors.Unauthorized("Token de outro projeto");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw Errors.Unauthorized("Emissor inválido");
  if (typeof payload.exp !== "number" || payload.exp < now - 10) throw Errors.Unauthorized("Token expirado");
  if (typeof payload.iat === "number" && payload.iat > now + 300) throw Errors.Unauthorized("Token inválido (iat)");
  if (!payload.sub) throw Errors.Unauthorized("Token inválido (sub)");

  return {
    uid: String(payload.sub),
    email: payload.email ? String(payload.email).toLowerCase() : null,
    emailVerified: !!payload.email_verified,
    name: payload.name ? String(payload.name) : null,
    picture: payload.picture ? String(payload.picture) : null,
  };
}
