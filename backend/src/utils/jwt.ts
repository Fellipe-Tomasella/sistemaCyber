/** JWT HS256 mínimo (sem dependências), padrão do projeto. */
import { createHmac } from "node:crypto";
import { env } from "../config/env.ts";

export interface AccessClaims {
  sub: string;                 // accountId (account) | directorId (director) | memberId (member legado)
  scope: "account" | "director" | "member";
  workspaceId: string;
  role?: string;               // scope director (enum legado)
  modules?: string[];          // scope director: módulos que o cargo libera
  isAdmin?: boolean;           // scope director: cargo de acesso total
  // scope "account" (login unificado):
  accountId?: string;
  memberId?: string | null;    // perfil de sócio ligado à conta (se houver)
  directorId?: string | null;  // perfil de diretor ligado à conta (se houver)
  isSuperAdmin?: boolean;      // conta gerencia usuários da atlética
  exp: number;                 // epoch segundos
  iat: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signAccess(payload: Omit<AccessClaims, "exp" | "iat">): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + env.ACCESS_TTL_MIN * 60;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat, exp }));
  const data = `${header}.${body}`;
  const sig = createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyAccess(token: string): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", env.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  if (sig !== expected) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as AccessClaims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
