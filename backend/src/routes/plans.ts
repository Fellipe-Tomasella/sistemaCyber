import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { membershipPlans } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";

export const planRoutes = new Elysia({ prefix: "/plans" })
  .use(authGuard)
  .get("/", async ({ auth }) => {
    const a = requireDirector(auth);
    const rows = await db.query.membershipPlans.findMany({ where: eq(membershipPlans.workspaceId, a.workspaceId) });
    return ok({ plans: rows });
  })
  .post("/", async ({ auth, body }) => {
    const a = requireModule(auth, "planos");
    const [p] = await db.insert(membershipPlans).values({
      workspaceId: a.workspaceId,
      name: body.name, period: body.period as any, priceCents: body.priceCents,
      durationMonths: body.durationMonths, benefits: body.benefits ?? [],
    }).returning();
    return ok({ plan: p }, "Plano criado");
  }, {
    body: t.Object({
      name: t.String(), period: t.String(), priceCents: t.Number(),
      durationMonths: t.Number(), benefits: t.Optional(t.Array(t.String())),
    }),
  })
  .patch("/:id", async ({ auth, params, body }) => {
    const a = requireModule(auth, "planos");
    const [p] = await db.update(membershipPlans).set({
      name: body.name, priceCents: body.priceCents, durationMonths: body.durationMonths,
      benefits: body.benefits, active: body.active,
    }).where(and(eq(membershipPlans.id, params.id), eq(membershipPlans.workspaceId, a.workspaceId))).returning();
    if (!p) throw Errors.NotFound("Plano não encontrado");
    return ok({ plan: p });
  }, {
    body: t.Object({
      name: t.Optional(t.String()), priceCents: t.Optional(t.Number()),
      durationMonths: t.Optional(t.Number()), benefits: t.Optional(t.Array(t.String())),
      active: t.Optional(t.Boolean()),
    }),
  });
