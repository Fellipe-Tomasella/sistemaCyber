/** Portal do sócio — escopo member. */
import { Elysia, t } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { members, memberPayments, memberships, workspaces, orders, tickets, membershipPlans, ticketBatches } from "../db/schema.ts";
import { authGuard, requireMember } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { signQr } from "../utils/crypto.ts";
import { today, addMonths } from "../utils/dates.ts";
import { createOrder, type CartItem } from "../services/order.service.ts";

export const meRoutes = new Elysia({ prefix: "/me" })
  .use(authGuard)

  .get("/", async ({ auth }) => {
    const a = requireMember(auth);
    const m = await db.query.members.findFirst({ where: eq(members.id, a.sub) });
    if (!m) throw Errors.NotFound("Sócio não encontrado");
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, a.workspaceId) });
    return ok({
      member: { id: m.id, name: m.name, course: m.course, registrationNumber: m.registrationNumber, status: m.status, memberNumber: m.memberNumber, memberSince: m.memberSince },
      workspace: ws && { name: ws.name, slug: ws.slug, logoKey: ws.logoKey, primaryColor: ws.primaryColor, accentColor: ws.accentColor },
    });
  })

  .get("/card", async ({ auth }) => {
    const a = requireMember(auth);
    const m = await db.query.members.findFirst({ where: eq(members.id, a.sub) });
    if (!m) throw Errors.NotFound("Sócio não encontrado");
    return ok({ cardUuid: m.cardUuid, qr: `${m.cardUuid}.${signQr(m.cardUuid)}`, name: m.name, memberNumber: m.memberNumber, status: m.status, registrationNumber: m.registrationNumber });
  })

  .get("/payments", async ({ auth }) => {
    const a = requireMember(auth);
    const rows = await db.query.memberPayments.findMany({ where: and(eq(memberPayments.memberId, a.sub), eq(memberPayments.workspaceId, a.workspaceId)), orderBy: [desc(memberPayments.dueDate)] });
    return ok({ payments: rows });
  })

  .get("/orders", async ({ auth }) => {
    const a = requireMember(auth);
    const rows = await db.query.orders.findMany({ where: and(eq(orders.buyerMemberId, a.sub), eq(orders.workspaceId, a.workspaceId)), orderBy: [desc(orders.createdAt)] });
    return ok({ orders: rows });
  })

  .get("/tickets", async ({ auth }) => {
    const a = requireMember(auth);
    const rows = await db.query.tickets.findMany({ where: and(eq(tickets.buyerMemberId, a.sub), eq(tickets.workspaceId, a.workspaceId)), orderBy: [desc(tickets.createdAt)] });
    return ok({ tickets: rows.map((t) => ({ ...t, qr: `${t.qrUuid}.${signQr(t.qrUuid)}` })) });
  })

  // Compra na loja atribuída ao sócio logado (aparece em /me/orders)
  .post("/store-orders", async ({ auth, body }) => {
    const a = requireMember(auth);
    const m = await db.query.members.findFirst({ where: eq(members.id, a.sub) });
    const result = await createOrder({
      workspaceId: a.workspaceId, channel: "store", items: body.items as CartItem[],
      buyerMemberId: a.sub, buyerName: m?.name, buyerEmail: m?.email ?? undefined,
      audience: m?.status === "active" ? "member" : "public",
    });
    return ok({ orderId: result.order.id, orderNumber: result.order.orderNumber, totalCents: result.order.totalCents }, "Pedido criado");
  }, {
    body: t.Object({ items: t.Array(t.Object({ kind: t.String(), refId: t.String(), quantity: t.Number(), variantId: t.Optional(t.String()) })) }),
  })

  // Solicitar renovação → cria adesão + cobrança pendente (diretoria confirma)
  .post("/renew", async ({ auth, body }) => {
    const a = requireMember(auth);
    const plan = await db.query.membershipPlans.findFirst({ where: and(eq(membershipPlans.id, body.planId), eq(membershipPlans.workspaceId, a.workspaceId)) });
    if (!plan) throw Errors.NotFound("Plano não encontrado");
    const start = today(), end = addMonths(start, plan.durationMonths);
    const [ms] = await db.insert(memberships).values({ workspaceId: a.workspaceId, memberId: a.sub, planId: plan.id, startDate: start, endDate: end, priceCents: plan.priceCents, status: "pending" }).returning();
    await db.insert(memberPayments).values({ workspaceId: a.workspaceId, membershipId: ms.id, memberId: a.sub, amountCents: plan.priceCents, dueDate: today(), status: "pending" });
    return ok({ membership: ms }, "Renovação solicitada — aguardando pagamento");
  }, { body: t.Object({ planId: t.String() }) })

  // Solicitar ingresso → ticket pendente (diretoria confirma pagamento)
  .post("/events/:id/tickets", async ({ auth, params, body }) => {
    const a = requireMember(auth);
    const b = await db.query.ticketBatches.findFirst({ where: and(eq(ticketBatches.id, body.batchId), eq(ticketBatches.eventId, params.id), eq(ticketBatches.workspaceId, a.workspaceId)) });
    if (!b) throw Errors.NotFound("Lote não encontrado");
    const m = await db.query.members.findFirst({ where: eq(members.id, a.sub) });
    const [tk] = await db.insert(tickets).values({ workspaceId: a.workspaceId, eventId: params.id, batchId: b.id, buyerMemberId: a.sub, buyerName: m?.name, priceCents: b.priceCents, status: "valid", paymentStatus: "pending" }).returning();
    return ok({ ticket: tk }, "Ingresso reservado — aguardando pagamento");
  }, { body: t.Object({ batchId: t.String() }) });
