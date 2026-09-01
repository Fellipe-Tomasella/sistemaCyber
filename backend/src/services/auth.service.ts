/** Serviço de autenticação — login diretoria/sócio + emissão/rotação de refresh. */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { accounts, directors, members, refreshTokens, workspaces, managementTerms, roles, MODULES, passwordResets } from "../db/schema.ts";
import { genCode, sendVerificationEmail, sendPasswordResetEmail } from "./mailer.ts";
import { verifyPassword, emailLookup, documentLookup, hashDocument, hashPassword, randomToken, sha256 } from "../utils/crypto.ts";
import { signAccess, type AccessClaims } from "../utils/jwt.ts";
import { env } from "../config/env.ts";
import { Errors } from "../utils/response.ts";
import { today } from "../utils/dates.ts";

interface Ctx { userAgent?: string; ip?: string; }

async function issueRefresh(subjectType: "director" | "member" | "account", subjectId: string, workspaceId: string, ctx: Ctx) {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL_DAYS * 86400_000);
  await db.insert(refreshTokens).values({
    subjectType, subjectId, workspaceId,
    tokenHash: sha256(raw), userAgent: ctx.userAgent, ipAddress: ctx.ip, expiresAt,
  });
  return raw;
}

export async function loginDirector(email: string, password: string, slug: string, ctx: Ctx) {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (!ws) throw Errors.NotFound("Atlética não encontrada");

  const dir = await db.query.directors.findFirst({
    where: and(eq(directors.workspaceId, ws.id), eq(directors.emailLookup, emailLookup(email))),
  });
  if (!dir || !dir.active) throw Errors.Unauthorized("Credenciais inválidas");
  if (!(await verifyPassword(password, dir.passwordHash))) throw Errors.Unauthorized("Credenciais inválidas");

  const accessToken = signAccess({ sub: dir.id, scope: "director", workspaceId: ws.id, role: dir.role });
  const refreshToken = await issueRefresh("director", dir.id, ws.id, ctx);
  return {
    accessToken, refreshToken,
    director: { id: dir.id, name: dir.name, email: dir.email, role: dir.role, cargoLabel: dir.cargoLabel },
    workspace: { id: ws.id, name: ws.name, slug: ws.slug, university: ws.university },
  };
}

export async function loginMember(cpf: string, password: string, slug: string, ctx: Ctx) {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (!ws) throw Errors.NotFound("Atlética não encontrada");

  const m = await db.query.members.findFirst({
    where: and(eq(members.workspaceId, ws.id), eq(members.cpfLookup, documentLookup(cpf))),
  });
  if (!m || !m.passwordHash) throw Errors.Unauthorized("Credenciais inválidas");
  if (!(await verifyPassword(password, m.passwordHash))) throw Errors.Unauthorized("Credenciais inválidas");

  const accessToken = signAccess({ sub: m.id, scope: "member", workspaceId: ws.id });
  const refreshToken = await issueRefresh("member", m.id, ws.id, ctx);
  return {
    accessToken, refreshToken,
    member: { id: m.id, name: m.name, status: m.status, cardUuid: m.cardUuid },
    workspace: { id: ws.id, name: ws.name, slug: ws.slug },
  };
}

/** Rotaciona: invalida o refresh usado e emite um novo. */
export async function rotateRefresh(raw: string, ctx: Ctx) {
  const hash = sha256(raw);
  const stored = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, hash) });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) throw Errors.Unauthorized("Sessão expirada");

  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, stored.id));

  let claims: Omit<AccessClaims, "exp" | "iat">;
  if (stored.subjectType === "account") {
    const acc = await db.query.accounts.findFirst({ where: eq(accounts.id, stored.subjectId) });
    if (!acc || !acc.active) throw Errors.Unauthorized("Sessão expirada");
    const { member, director } = await accountProfiles(acc.id);
    claims = {
      scope: "account", sub: acc.id, workspaceId: stored.workspaceId, accountId: acc.id,
      memberId: member?.id ?? null, directorId: director?.id ?? null, isSuperAdmin: acc.isSuperAdmin,
    };
  } else if (stored.subjectType === "director") {
    const dir = await db.query.directors.findFirst({ where: eq(directors.id, stored.subjectId) });
    if (!dir) throw Errors.Unauthorized("Sessão expirada");
    const acc = await directorAccess(dir);
    claims = { scope: "director", sub: stored.subjectId, workspaceId: stored.workspaceId, role: dir.role, modules: acc.modules, isAdmin: acc.isAdmin };
  } else {
    claims = { scope: "member", sub: stored.subjectId, workspaceId: stored.workspaceId };
  }
  const accessToken = signAccess(claims);
  const refreshToken = await issueRefresh(stored.subjectType, stored.subjectId, stored.workspaceId, ctx);
  return { accessToken, refreshToken };
}

export async function revokeRefresh(raw: string) {
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha256(raw)));
}

/** Onboarding de nova atlética: cria workspace + gestão + primeiro admin. */
export async function registerAtletica(input: { name: string; slug: string; university?: string; adminName: string; adminEmail: string; adminPassword: string }, ctx: Ctx) {
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (slug.length < 2) throw Errors.BadRequest("Slug inválido");
  const exists = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (exists) throw Errors.Conflict("Já existe atlética com esse slug");

  const [ws] = await db.insert(workspaces).values({ name: input.name, slug, university: input.university }).returning();
  const [term] = await db.insert(managementTerms).values({ workspaceId: ws.id, name: "Gestão atual", isCurrent: true, startDate: today() }).returning();
  const [dir] = await db.insert(directors).values({
    workspaceId: ws.id, termId: term.id, name: input.adminName, email: input.adminEmail, emailLookup: emailLookup(input.adminEmail),
    passwordHash: await hashPassword(input.adminPassword), role: "admin", cargoLabel: "Presidente",
  }).returning();

  const accessToken = signAccess({ sub: dir.id, scope: "director", workspaceId: ws.id, role: "admin" });
  const refreshToken = await issueRefresh("director", dir.id, ws.id, ctx);
  return { accessToken, refreshToken, workspace: { id: ws.id, name: ws.name, slug: ws.slug } };
}

/** Auto-cadastro de sócio numa atlética (fica pending até 1º pagamento). */
export async function registerMember(input: { slug: string; cpf: string; name: string; email?: string; password: string; course?: string; registrationNumber?: string; phone?: string }, ctx: Ctx) {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, input.slug) });
  if (!ws) throw Errors.NotFound("Atlética não encontrada");
  const lookup = documentLookup(input.cpf);
  const dup = await db.query.members.findFirst({ where: and(eq(members.workspaceId, ws.id), eq(members.cpfLookup, lookup)) });
  if (dup) throw Errors.Conflict("Já existe sócio com esse CPF");

  const [m] = await db.insert(members).values({
    workspaceId: ws.id, cpfHash: await hashDocument(input.cpf), cpfLookup: lookup, name: input.name,
    email: input.email, emailLookup: input.email ? emailLookup(input.email) : null,
    passwordHash: await hashPassword(input.password), course: input.course,
    registrationNumber: input.registrationNumber, phone: input.phone, status: "pending", memberSince: today(),
  }).returning();

  const accessToken = signAccess({ sub: m.id, scope: "member", workspaceId: ws.id });
  const refreshToken = await issueRefresh("member", m.id, ws.id, ctx);
  return { accessToken, refreshToken, member: { id: m.id, name: m.name, status: m.status, cardUuid: m.cardUuid } };
}

/* ═══════════════════ Conta unificada (login por e-mail) ═══════════════════ */

/** Perfis (sócio/diretor) ligados a uma conta. */
async function accountProfiles(accountId: string) {
  const member = await db.query.members.findFirst({ where: eq(members.accountId, accountId) });
  const director = await db.query.directors.findFirst({
    where: and(eq(directors.accountId, accountId), eq(directors.active, true)),
  });
  return { member, director };
}

/** Visão pública da conta (sem hashes) pro frontend decidir o que carregar. */
function accountView(acc: typeof accounts.$inferSelect, member: any, director: any) {
  return {
    id: acc.id, name: acc.name, email: acc.email, isSuperAdmin: acc.isSuperAdmin, emailVerified: acc.emailVerified,
    member: member ? { id: member.id, status: member.status, cardUuid: member.cardUuid } : null,
    director: director
      ? { id: director.id, role: director.role, cargoLabel: director.cargoLabel, pinSet: !!director.pinHash, permissions: director.permissions ?? [] }
      : null,
  };
}

/** Monta a sessão (tokens + visão) a partir de uma conta. */
async function sessionForAccount(acc: typeof accounts.$inferSelect, ws: typeof workspaces.$inferSelect, ctx: Ctx) {
  const { member, director } = await accountProfiles(acc.id);
  const accessToken = signAccess({
    scope: "account", sub: acc.id, workspaceId: ws.id, accountId: acc.id,
    memberId: member?.id ?? null, directorId: director?.id ?? null, isSuperAdmin: acc.isSuperAdmin,
  });
  const refreshToken = await issueRefresh("account", acc.id, ws.id, ctx);
  return {
    accessToken, refreshToken,
    account: accountView(acc, member, director),
    workspace: { id: ws.id, name: ws.name, slug: ws.slug, university: ws.university, modules: ws.modules ?? null },
  };
}

/** Cadastro de conta (qualquer pessoa que vai usar/comprar). */
export async function registerAccount(input: { slug: string; name: string; email: string; password: string; phone?: string }, ctx: Ctx) {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, input.slug) });
  if (!ws) throw Errors.NotFound("Atlética não encontrada");
  const email = input.email.trim().toLowerCase();
  const lookup = emailLookup(email);
  const dup = await db.query.accounts.findFirst({ where: and(eq(accounts.workspaceId, ws.id), eq(accounts.emailLookup, lookup)) });
  if (dup) throw Errors.Conflict("Já existe uma conta com esse e-mail");
  // conta do e-mail oficial da atlética vira super-admin automaticamente
  const isSuper = !!ws.officialEmail && emailLookup(ws.officialEmail) === lookup;
  const [acc] = await db.insert(accounts).values({
    workspaceId: ws.id, name: input.name.trim(), email, emailLookup: lookup,
    passwordHash: await hashPassword(input.password), phone: input.phone, isSuperAdmin: isSuper,
  }).returning();
  // envia código de verificação (não bloqueia o cadastro se o e-mail falhar)
  const code = genCode();
  await db.update(accounts).set({ verifyCodeHash: sha256(code), verifyExpiresAt: new Date(Date.now() + 30 * 60_000) }).where(eq(accounts.id, acc.id));
  sendVerificationEmail(email, acc.name, code, ws.name).catch(() => {});
  return sessionForAccount(acc, ws, ctx);
}

/** Verifica o e-mail com o código enviado no cadastro. */
export async function verifyEmail(accountId: string, code: string) {
  const acc = await db.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
  if (!acc) throw Errors.NotFound("Conta não encontrada");
  if (acc.emailVerified) return { emailVerified: true };
  if (!acc.verifyCodeHash || !acc.verifyExpiresAt || acc.verifyExpiresAt < new Date()) throw Errors.BadRequest("Código expirado — peça um novo");
  if (sha256(code.trim()) !== acc.verifyCodeHash) throw Errors.BadRequest("Código incorreto");
  await db.update(accounts).set({ emailVerified: true, verifyCodeHash: null, verifyExpiresAt: null }).where(eq(accounts.id, acc.id));
  return { emailVerified: true };
}

/** Reenvia o código de verificação. */
export async function resendVerification(accountId: string) {
  const acc = await db.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
  if (!acc) throw Errors.NotFound("Conta não encontrada");
  if (acc.emailVerified) return { emailVerified: true };
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, acc.workspaceId) });
  const code = genCode();
  await db.update(accounts).set({ verifyCodeHash: sha256(code), verifyExpiresAt: new Date(Date.now() + 30 * 60_000) }).where(eq(accounts.id, acc.id));
  await sendVerificationEmail(acc.email, acc.name, code, ws?.name || "AtléticaHub");
  return { sent: true };
}

/** Esqueci a senha: gera código e envia por e-mail (resposta sempre ok, sem vazar se o e-mail existe). */
export async function forgotPassword(email: string, slug: string) {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (!ws) return { ok: true };
  const acc = await db.query.accounts.findFirst({ where: and(eq(accounts.workspaceId, ws.id), eq(accounts.emailLookup, emailLookup(email.trim().toLowerCase()))) });
  if (!acc) return { ok: true };
  const code = genCode();
  await db.insert(passwordResets).values({ subjectType: "account", subjectId: acc.id, tokenHash: sha256(code), expiresAt: new Date(Date.now() + 30 * 60_000) });
  await sendPasswordResetEmail(acc.email, acc.name, code, ws.name);
  return { ok: true };
}

/** Redefine a senha com o código recebido por e-mail. */
export async function resetPassword(email: string, slug: string, code: string, newPassword: string) {
  if (!newPassword || newPassword.length < 6) throw Errors.BadRequest("A senha deve ter ao menos 6 caracteres");
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (!ws) throw Errors.BadRequest("Código inválido");
  const acc = await db.query.accounts.findFirst({ where: and(eq(accounts.workspaceId, ws.id), eq(accounts.emailLookup, emailLookup(email.trim().toLowerCase()))) });
  if (!acc) throw Errors.BadRequest("Código inválido");
  const pr = await db.query.passwordResets.findFirst({ where: and(eq(passwordResets.subjectType, "account"), eq(passwordResets.subjectId, acc.id), eq(passwordResets.tokenHash, sha256(code.trim()))) });
  if (!pr || pr.usedAt || pr.expiresAt < new Date()) throw Errors.BadRequest("Código inválido ou expirado");
  await db.update(accounts).set({ passwordHash: await hashPassword(newPassword) }).where(eq(accounts.id, acc.id));
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, pr.id));
  return { ok: true };
}

/** Login unificado por e-mail + senha. */
export async function loginAccount(email: string, password: string, slug: string, ctx: Ctx) {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (!ws) throw Errors.NotFound("Atlética não encontrada");
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.workspaceId, ws.id), eq(accounts.emailLookup, emailLookup(email.trim().toLowerCase()))),
  });
  if (!acc || !acc.active || !acc.passwordHash) throw Errors.Unauthorized("Credenciais inválidas");
  if (!(await verifyPassword(password, acc.passwordHash))) throw Errors.Unauthorized("Credenciais inválidas");
  await db.update(accounts).set({ lastLoginAt: new Date() }).where(eq(accounts.id, acc.id));
  return sessionForAccount(acc, ws, ctx);
}

/** Módulos que o diretor acessa (via cargo; fallback pro enum legado). */
const LEGACY_MODULES: Record<string, string[]> = {
  admin: [...MODULES],
  finance: ["financeiro", "cobrancas", "socios", "planos", "pedidos", "produtos"],
  events: ["eventos", "produtos", "pedidos", "loja"],
  viewer: [],
};
export async function directorAccess(dir: typeof directors.$inferSelect) {
  if (dir.roleId) {
    const role = await db.query.roles.findFirst({ where: eq(roles.id, dir.roleId) });
    if (role) return { modules: role.isSystem ? [...MODULES] : (role.modules || []), isAdmin: role.isSystem, roleName: role.name };
  }
  const isAdmin = dir.role === "admin";
  return { modules: LEGACY_MODULES[dir.role] || [], isAdmin, roleName: dir.cargoLabel || dir.role };
}

/** Destrava o painel da diretoria: valida o PIN da conta-diretor e emite token de diretor. */
export async function unlockDirector(auth: AccessClaims, pin: string, ctx: Ctx) {
  if (!auth.directorId) throw Errors.Forbidden("Sua conta não é da diretoria");
  const dir = await db.query.directors.findFirst({ where: and(eq(directors.id, auth.directorId), eq(directors.active, true)) });
  if (!dir) throw Errors.Forbidden("Perfil de diretor não encontrado");
  if (!dir.pinHash) throw Errors.BadRequest("PIN ainda não configurado");
  if (!(await verifyPassword(pin, dir.pinHash))) throw Errors.Unauthorized("PIN incorreto");
  const acc = await directorAccess(dir);
  const accessToken = signAccess({ scope: "director", sub: dir.id, workspaceId: dir.workspaceId, role: dir.role, modules: acc.modules, isAdmin: acc.isAdmin });
  const refreshToken = await issueRefresh("director", dir.id, dir.workspaceId, ctx);
  return { accessToken, refreshToken, director: { id: dir.id, name: dir.name, role: dir.role, cargoLabel: acc.roleName, modules: acc.modules, isAdmin: acc.isAdmin } };
}

/** Define/reseta o PIN de um diretor (4–8 dígitos). */
export async function setDirectorPin(directorId: string, workspaceId: string, pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw Errors.BadRequest("O PIN deve ter de 4 a 8 dígitos");
  const dir = await db.query.directors.findFirst({ where: and(eq(directors.id, directorId), eq(directors.workspaceId, workspaceId)) });
  if (!dir) throw Errors.NotFound("Diretor não encontrado");
  await db.update(directors).set({ pinHash: await hashPassword(pin), pinSetAt: new Date() }).where(eq(directors.id, directorId));
  return { ok: true };
}
