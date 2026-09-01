import { Elysia, t } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { memberPayments, members, transactions } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { today } from "../utils/dates.ts";

export const paymentRoutes = new Elysia({ prefix: "/member-payments" })
  .use(authGuard)

  .get("/", async ({ auth, query }) => {
    const a = requireDirector(auth);
    const where = query.status
      ? and(eq(memberPayments.workspaceId, a.workspaceId), eq(memberPayments.status, query.status as any))
      : eq(memberPayments.workspaceId, a.workspaceId);
    const rows = await db.query.memberPayments.findMany({ where, orderBy: [desc(memberPayments.dueDate)], limit: 500 });
    // junta nome do sócio
    const withNames = await Promise.all(rows.map(async (p) => {
      const m = await db.query.members.findFirst({ where: eq(members.id, p.memberId) });
      return { ...p, memberName: m?.name };
    }));
    const openTotal = rows.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amountCents, 0);
    return ok({ payments: withNames, openTotalCents: openTotal });
  }, { query: t.Object({ status: t.Optional(t.String()) }) })

  .post("/", async ({ auth, body }) => {
    const a = requireModule(auth, "cobrancas");
    const [p] = await db.insert(memberPayments).values({
      workspaceId: a.workspaceId, memberId: body.memberId, membershipId: body.membershipId,
      amountCents: body.amountCents, dueDate: body.dueDate, status: "pending",
    }).returning();
    return ok({ payment: p }, "Cobrança criada");
  }, { body: t.Object({ memberId: t.String(), amountCents: t.Number(), dueDate: t.String(), membershipId: t.Optional(t.String()) }) })

  // Marcar pago (1 clique) → gera receita + reativa sócio
  .post("/:id/pay", async ({ auth, params, body }) => {
    const a = requireModule(auth, "cobrancas");
    const pay = await db.query.memberPayments.findFirst({ where: and(eq(memberPayments.id, params.id), eq(memberPayments.workspaceId, a.workspaceId)) });
    if (!pay) throw Errors.NotFound("Cobrança não encontrada");
    if (pay.status === "paid") return ok({ payment: pay });

    const [updated] = await db.update(memberPayments).set({ status: "paid", paidAt: new Date(), method: body?.method ?? "manual" }).where(eq(memberPayments.id, pay.id)).returning();
    await db.update(members).set({ status: "active" }).where(eq(members.id, pay.memberId));

    const m = await db.query.members.findFirst({ where: eq(members.id, pay.memberId) });
    await db.insert(transactions).values({
      workspaceId: a.workspaceId, description: `Mensalidade — ${m?.name ?? "sócio"}`, amountCents: pay.amountCents,
      type: "income", date: today(), status: "paid", paidAt: new Date(), memberPaymentId: pay.id, paymentMethod: body?.method ?? "manual", createdBy: a.sub,
    });
    return ok({ payment: updated }, "Pagamento confirmado");
  }, { body: t.Optional(t.Object({ method: t.Optional(t.String()) })) });
