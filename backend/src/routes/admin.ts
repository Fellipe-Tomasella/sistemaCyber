/** Super-admin (e-mail oficial): gerencia CARGOS (RBAC) e USUÁRIOS da atlética. */
import { Elysia, t } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { accounts, directors, members, roles, MODULES } from "../db/schema.ts";
import { authGuard, requireSuperAdmin } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { hashPassword, emailLookup, randomToken } from "../utils/crypto.ts";

const validMods = (arr?: string[]) => (arr || []).filter((m) => (MODULES as readonly string[]).includes(m));

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .use(authGuard)

  // Catálogo de módulos (a UI monta os checkboxes)
  .get("/modules", ({ auth }) => { requireSuperAdmin(auth); return ok({ modules: MODULES }); })

  /* ───────────── Cargos (RBAC) ───────────── */
  .get("/roles", async ({ auth }) => {
    const a = requireSuperAdmin(auth);
    const rows = await db.query.roles.findMany({ where: eq(roles.workspaceId, a.workspaceId) });
    const dirs = await db.query.directors.findMany({ where: and(eq(directors.workspaceId, a.workspaceId), eq(directors.active, true)) });
    return ok({ roles: rows.map((r) => ({
      id: r.id, name: r.name, isSystem: r.isSystem,
      modules: r.isSystem ? [...MODULES] : (r.modules || []),
      count: dirs.filter((d) => d.roleId === r.id).length,
    })) });
  })
  .post("/roles", async ({ auth, body }) => {
    const a = requireSuperAdmin(auth);
    if (!body.name.trim()) throw Errors.BadRequest("Dê um nome ao cargo");
    const [r] = await db.insert(roles).values({ workspaceId: a.workspaceId, name: body.name.trim(), modules: validMods(body.modules) }).returning();
    return ok({ role: r }, "Cargo criado");
  }, { body: t.Object({ name: t.String(), modules: t.Optional(t.Array(t.String())) }) })
  .patch("/roles/:id", async ({ auth, params, body }) => {
    const a = requireSuperAdmin(auth);
    const r = await db.query.roles.findFirst({ where: and(eq(roles.id, params.id), eq(roles.workspaceId, a.workspaceId)) });
    if (!r) throw Errors.NotFound("Cargo não encontrado");
    if (r.isSystem) throw Errors.BadRequest("O cargo de administração não pode ser editado");
    const patch: any = {};
    if (body.name != null) patch.name = body.name.trim();
    if (body.modules != null) patch.modules = validMods(body.modules);
    const [u] = await db.update(roles).set(patch).where(eq(roles.id, r.id)).returning();
    return ok({ role: u }, "Cargo atualizado");
  }, { body: t.Object({ name: t.Optional(t.String()), modules: t.Optional(t.Array(t.String())) }) })
  .delete("/roles/:id", async ({ auth, params }) => {
    const a = requireSuperAdmin(auth);
    const r = await db.query.roles.findFirst({ where: and(eq(roles.id, params.id), eq(roles.workspaceId, a.workspaceId)) });
    if (!r) throw Errors.NotFound("Cargo não encontrado");
    if (r.isSystem) throw Errors.BadRequest("O cargo de administração não pode ser removido");
    await db.update(directors).set({ roleId: null, active: false }).where(eq(directors.roleId, r.id));
    await db.delete(roles).where(eq(roles.id, r.id));
    return ok({ deleted: true }, "Cargo removido");
  })

  /* ───────────── Usuários ───────────── */
  .get("/users", async ({ auth }) => {
    const a = requireSuperAdmin(auth);
    const [accs, dirs, mems, roleRows] = await Promise.all([
      db.query.accounts.findMany({ where: eq(accounts.workspaceId, a.workspaceId), orderBy: [desc(accounts.createdAt)] }),
      db.query.directors.findMany({ where: eq(directors.workspaceId, a.workspaceId) }),
      db.query.members.findMany({ where: eq(members.workspaceId, a.workspaceId) }),
      db.query.roles.findMany({ where: eq(roles.workspaceId, a.workspaceId) }),
    ]);
    const roleName = (id: string | null) => { const r = roleRows.find((x) => x.id === id); return r ? r.name : null; };
    return ok({ users: accs.map((ac) => {
      const d = dirs.find((x) => x.accountId === ac.id && x.active);
      const m = mems.find((x) => x.accountId === ac.id);
      return {
        id: ac.id, name: ac.name, email: ac.email, isSuperAdmin: ac.isSuperAdmin,
        member: m ? { id: m.id, status: m.status } : null,
        director: d ? { id: d.id, roleId: d.roleId, roleName: roleName(d.roleId) || d.cargoLabel, pinSet: !!d.pinHash } : null,
      };
    }) });
  })
  // Atribui/atualiza cargo de diretor a um usuário
  .post("/users/:id/director", async ({ auth, params, body }) => {
    const a = requireSuperAdmin(auth);
    const ac = await db.query.accounts.findFirst({ where: and(eq(accounts.id, params.id), eq(accounts.workspaceId, a.workspaceId)) });
    if (!ac) throw Errors.NotFound("Usuário não encontrado");
    const role = await db.query.roles.findFirst({ where: and(eq(roles.id, body.roleId), eq(roles.workspaceId, a.workspaceId)) });
    if (!role) throw Errors.BadRequest("Cargo inválido");
    const enumRole = role.isSystem ? "admin" : "viewer";
    let d = await db.query.directors.findFirst({ where: and(eq(directors.accountId, ac.id), eq(directors.workspaceId, a.workspaceId)) });
    if (d) {
      [d] = await db.update(directors).set({ roleId: role.id, role: enumRole as any, cargoLabel: role.name, active: true }).where(eq(directors.id, d.id)).returning();
    } else {
      [d] = await db.insert(directors).values({
        workspaceId: a.workspaceId, accountId: ac.id, roleId: role.id, name: ac.name, email: ac.email, emailLookup: emailLookup(ac.email),
        passwordHash: await hashPassword(randomToken()), role: enumRole as any, cargoLabel: role.name,
      }).returning();
    }
    return ok({ director: { id: d.id, roleId: d.roleId, cargoLabel: d.cargoLabel, pinSet: !!d.pinHash } }, "Cargo atribuído");
  }, { body: t.Object({ roleId: t.String() }) })
  // Remove o perfil de diretor
  .delete("/users/:id/director", async ({ auth, params }) => {
    const a = requireSuperAdmin(auth);
    const d = await db.query.directors.findFirst({ where: and(eq(directors.accountId, params.id), eq(directors.workspaceId, a.workspaceId)) });
    if (!d) throw Errors.NotFound("Este usuário não é diretor");
    await db.update(directors).set({ active: false, roleId: null }).where(eq(directors.id, d.id));
    return ok({ removed: true }, "Diretoria removida do usuário");
  })
  // Reseta o PIN (o diretor cria um novo no próximo acesso)
  .post("/users/:id/reset-pin", async ({ auth, params }) => {
    const a = requireSuperAdmin(auth);
    const d = await db.query.directors.findFirst({ where: and(eq(directors.accountId, params.id), eq(directors.workspaceId, a.workspaceId), eq(directors.active, true)) });
    if (!d) throw Errors.NotFound("Este usuário não é diretor");
    await db.update(directors).set({ pinHash: null, pinSetAt: null }).where(eq(directors.id, d.id));
    return ok({ reset: true }, "PIN resetado");
  })
  // Liga/desliga super-admin
  .patch("/users/:id", async ({ auth, params, body }) => {
    const a = requireSuperAdmin(auth);
    const ac = await db.query.accounts.findFirst({ where: and(eq(accounts.id, params.id), eq(accounts.workspaceId, a.workspaceId)) });
    if (!ac) throw Errors.NotFound("Usuário não encontrado");
    if (body.isSuperAdmin === false && ac.id === a.accountId) throw Errors.BadRequest("Você não pode remover seu próprio acesso de administrador");
    if (body.isSuperAdmin != null) await db.update(accounts).set({ isSuperAdmin: body.isSuperAdmin }).where(eq(accounts.id, ac.id));
    return ok({ ok: true }, "Usuário atualizado");
  }, { body: t.Object({ isSuperAdmin: t.Optional(t.Boolean()) }) });
