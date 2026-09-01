import { Elysia, t } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { members, memberships, membershipPlans } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { onlyDigits, isValidCPF, maskCPF } from "../utils/validators.ts";
import { hashDocument, documentLookup, hashPassword } from "../utils/crypto.ts";
import { today, addMonths } from "../utils/dates.ts";

export const memberRoutes = new Elysia({ prefix: "/members" })
  .use(authGuard)

  // Lista (filtro opcional ?status=)
  .get("/", async ({ auth, query }) => {
    const a = requireDirector(auth);
    const rows = await db.query.members.findMany({
      where: query.status
        ? and(eq(members.workspaceId, a.workspaceId), eq(members.status, query.status as any))
        : eq(members.workspaceId, a.workspaceId),
      orderBy: [desc(members.createdAt)],
      limit: 500,
    });
    const counts = { total: 0, active: 0, overdue: 0, expired: 0, pending: 0, cancelled: 0 };
    const all = await db.query.members.findMany({ where: eq(members.workspaceId, a.workspaceId) });
    counts.total = all.length;
    for (const m of all) (counts as any)[m.status]++;
    return ok({ members: rows.map(publicMember), counts });
  }, { query: t.Object({ status: t.Optional(t.String()) }) })

  // Detalhe
  .get("/:id", async ({ auth, params }) => {
    const a = requireDirector(auth);
    const m = await db.query.members.findFirst({
      where: and(eq(members.id, params.id), eq(members.workspaceId, a.workspaceId)),
    });
    if (!m) throw Errors.NotFound("Sócio não encontrado");
    const history = await db.query.memberships.findMany({
      where: eq(memberships.memberId, m.id), orderBy: [desc(memberships.createdAt)],
    });
    return ok({ member: publicMember(m), memberships: history });
  })

  // Criar sócio (diretoria)
  .post("/", async ({ auth, body }) => {
    const a = requireModule(auth, "socios");
    const cpf = onlyDigits(body.cpf);
    if (!isValidCPF(cpf)) throw Errors.BadRequest("CPF inválido");

    const dup = await db.query.members.findFirst({
      where: and(eq(members.workspaceId, a.workspaceId), eq(members.cpfLookup, documentLookup(cpf))),
    });
    if (dup) throw Errors.Conflict("Já existe sócio com esse CPF");

    const [created] = await db.insert(members).values({
      workspaceId: a.workspaceId,
      cpfHash: await hashDocument(cpf),
      cpfLookup: documentLookup(cpf),
      name: body.name,
      email: body.email,
      registrationNumber: body.registrationNumber,
      course: body.course,
      phone: body.phone,
      passwordHash: body.password ? await hashPassword(body.password) : null,
      status: "pending",
      memberSince: today(),
    }).returning();

    return ok({ member: publicMember(created) }, "Sócio cadastrado");
  }, {
    body: t.Object({
      cpf: t.String(), name: t.String(),
      email: t.Optional(t.String()), registrationNumber: t.Optional(t.String()),
      course: t.Optional(t.String()), phone: t.Optional(t.String()),
      password: t.Optional(t.String()),
    }),
  })

  // Renovar/adesão a um plano → cria membership + volta status active
  .post("/:id/renew", async ({ auth, params, body }) => {
    const a = requireModule(auth, "socios");
    const m = await db.query.members.findFirst({
      where: and(eq(members.id, params.id), eq(members.workspaceId, a.workspaceId)),
    });
    if (!m) throw Errors.NotFound("Sócio não encontrado");
    const plan = await db.query.membershipPlans.findFirst({
      where: and(eq(membershipPlans.id, body.planId), eq(membershipPlans.workspaceId, a.workspaceId)),
    });
    if (!plan) throw Errors.NotFound("Plano não encontrado");

    const start = today();
    const end = addMonths(start, plan.durationMonths);
    const [ms] = await db.insert(memberships).values({
      workspaceId: a.workspaceId, memberId: m.id, planId: plan.id,
      startDate: start, endDate: end, priceCents: plan.priceCents, status: "active",
    }).returning();
    await db.update(members).set({ status: "active" }).where(eq(members.id, m.id));
    return ok({ membership: ms }, "Adesão registrada");
  }, { body: t.Object({ planId: t.String() }) });

function publicMember(m: typeof members.$inferSelect) {
  return {
    id: m.id, name: m.name, email: m.email, course: m.course,
    registrationNumber: m.registrationNumber, status: m.status,
    cpfMasked: m.cpfLookup ? "***" : "***", cpf: undefined,
    isAthlete: m.isAthlete, cardUuid: m.cardUuid, memberSince: m.memberSince,
  };
}
