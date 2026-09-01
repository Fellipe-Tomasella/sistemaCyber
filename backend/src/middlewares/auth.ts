/**
 * Middleware de autenticação — deriva `auth` do Bearer token.
 * Uso nas rotas: .use(authGuard) e depois `requireDirector(auth)` / `requireRole(auth, 'admin')`.
 */
import { Elysia } from "elysia";
import { verifyAccess, type AccessClaims } from "../utils/jwt.ts";
import { Errors } from "../utils/response.ts";

export const authGuard = new Elysia({ name: "auth" }).derive({ as: "global" }, ({ headers }) => {
  const header = headers["authorization"] || headers["Authorization"];
  let auth: AccessClaims | null = null;
  if (header?.startsWith("Bearer ")) {
    auth = verifyAccess(header.slice(7));
  }
  return { auth };
});

export function requireDirector(auth: AccessClaims | null): AccessClaims {
  if (!auth || auth.scope !== "director") throw Errors.Unauthorized();
  return auth;
}

/** Conta logada (login unificado por e-mail). Base de todo mundo. */
export function requireAccount(auth: AccessClaims | null): AccessClaims {
  if (!auth || auth.scope !== "account") throw Errors.Unauthorized();
  return auth;
}

/** Super-admin = conta do e-mail oficial da atlética (gerencia usuários). */
export function requireSuperAdmin(auth: AccessClaims | null): AccessClaims {
  const a = requireAccount(auth);
  if (!a.isSuperAdmin) throw Errors.Forbidden("Acesso restrito ao e-mail oficial da atlética");
  return a;
}

/** Aceita o token de sócio (legado) OU a conta unificada com perfil de sócio.
 *  Normaliza `sub` para o memberId, então as rotas do portal do sócio não mudam. */
export function requireMember(auth: AccessClaims | null): AccessClaims {
  if (!auth) throw Errors.Unauthorized();
  if (auth.scope === "member") return auth;
  if (auth.scope === "account" && auth.memberId) return { ...auth, sub: auth.memberId };
  throw Errors.Forbidden("Você ainda não é sócio");
}

export function requireRole(auth: AccessClaims | null, ...roles: string[]): AccessClaims {
  const a = requireDirector(auth);
  if (a.role === "admin" || a.isAdmin) return a;  // admin faz tudo
  if (!roles.includes(a.role || "")) throw Errors.Forbidden();
  return a;
}

/** Diretor cujo CARGO libera este módulo (cargo admin/sistema libera tudo). */
export function requireModule(auth: AccessClaims | null, moduleKey: string): AccessClaims {
  const a = requireDirector(auth);
  if (a.isAdmin) return a;
  if ((a.modules || []).includes(moduleKey)) return a;
  throw Errors.Forbidden("Seu cargo não tem acesso a este módulo");
}

/** Ações exclusivas do cargo de administração (equipe, configurações, aparência). */
export function requireAdmin(auth: AccessClaims | null): AccessClaims {
  const a = requireDirector(auth);
  if (!a.isAdmin) throw Errors.Forbidden("Ação restrita ao cargo de administração");
  return a;
}
