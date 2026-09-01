import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workspaces, directors, managementTerms } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule, requireAdmin } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { hashPassword, emailLookup } from "../utils/crypto.ts";

export const workspaceRoutes = new Elysia()
  .use(authGuard)

  /* ---- Workspace / branding (white-label) ---- */
  .get("/workspace", async ({ auth }) => {
    const a = requireDirector(auth);
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, a.workspaceId) });
    if (!ws) throw Errors.NotFound("Atlética não encontrada");
    return ok({ workspace: ws });
  })
  .patch("/workspace", async ({ auth, body }) => {
    const a = requireModule(auth, "loja");
    const [ws] = await db.update(workspaces).set({
      name: body.name, university: body.university, logoKey: body.logoKey,
      primaryColor: body.primaryColor, accentColor: body.accentColor, currentSemester: body.currentSemester,
    }).where(eq(workspaces.id, a.workspaceId)).returning();
    return ok({ workspace: ws }, "Atlética atualizada");
  }, {
    body: t.Object({
      name: t.Optional(t.String()), university: t.Optional(t.String()), logoKey: t.Optional(t.String()),
      primaryColor: t.Optional(t.String()), accentColor: t.Optional(t.String()), currentSemester: t.Optional(t.String()),
    }),
  })

  /* ---- Diretoria ---- */
  .get("/directors", async ({ auth }) => {
    const a = requireDirector(auth);
    const rows = await db.query.directors.findMany({ where: eq(directors.workspaceId, a.workspaceId) });
    return ok({ directors: rows.map((d) => ({ id: d.id, name: d.name, email: d.email, role: d.role, cargoLabel: d.cargoLabel, active: d.active, termId: d.termId })) });
  })
  .post("/directors", async ({ auth, body }) => {
    const a = requireAdmin(auth);
    const dup = await db.query.directors.findFirst({ where: and(eq(directors.workspaceId, a.workspaceId), eq(directors.emailLookup, emailLookup(body.email))) });
    if (dup) throw Errors.Conflict("E-mail já cadastrado");
    const [d] = await db.insert(directors).values({
      workspaceId: a.workspaceId, name: body.name, email: body.email, emailLookup: emailLookup(body.email),
      passwordHash: await hashPassword(body.password), role: (body.role ?? "viewer") as any, cargoLabel: body.cargoLabel, termId: body.termId,
    }).returning();
    return ok({ director: { id: d.id, name: d.name, email: d.email, role: d.role } }, "Diretor adicionado");
  }, {
    body: t.Object({ name: t.String(), email: t.String(), password: t.String(), role: t.Optional(t.String()), cargoLabel: t.Optional(t.String()), termId: t.Optional(t.String()) }),
  })
  .patch("/directors/:id", async ({ auth, params, body }) => {
    const a = requireAdmin(auth);
    const [d] = await db.update(directors).set({ name: body.name, role: body.role as any, cargoLabel: body.cargoLabel, active: body.active })
      .where(and(eq(directors.id, params.id), eq(directors.workspaceId, a.workspaceId))).returning();
    if (!d) throw Errors.NotFound("Diretor não encontrado");
    return ok({ director: { id: d.id, name: d.name, role: d.role, active: d.active } });
  }, { body: t.Object({ name: t.Optional(t.String()), role: t.Optional(t.String()), cargoLabel: t.Optional(t.String()), active: t.Optional(t.Boolean()) }) })

  /* ---- Gestões (mandatos) ---- */
  .get("/terms", async ({ auth }) => {
    const a = requireDirector(auth);
    return ok({ terms: await db.query.managementTerms.findMany({ where: eq(managementTerms.workspaceId, a.workspaceId) }) });
  })
  .post("/terms", async ({ auth, body }) => {
    const a = requireAdmin(auth);
    if (body.isCurrent) {
      await db.update(managementTerms).set({ isCurrent: false }).where(eq(managementTerms.workspaceId, a.workspaceId));
    }
    const [term] = await db.insert(managementTerms).values({
      workspaceId: a.workspaceId, name: body.name, startDate: body.startDate, endDate: body.endDate, isCurrent: body.isCurrent ?? false,
    }).returning();
    return ok({ term }, "Gestão criada");
  }, { body: t.Object({ name: t.String(), startDate: t.Optional(t.String()), endDate: t.Optional(t.String()), isCurrent: t.Optional(t.Boolean()) }) });
