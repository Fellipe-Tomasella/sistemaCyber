/** Área da conta (login unificado): compra atribuída + histórico de compras. */
import { Elysia, t } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { orders, orderItems, members, accounts, workspaces } from "../db/schema.ts";
import { authGuard, requireAccount } from "../middlewares/auth.ts";
import { ok } from "../utils/response.ts";
import { createOrder, type CartItem } from "../services/order.service.ts";
import { signQr } from "../utils/crypto.ts";
import { sendOrderEmail } from "../services/mailer.ts";

export const accountRoutes = new Elysia({ prefix: "/account" })
  .use(authGuard)

  // Checkout da conta logada → pedido atribuído (preço de sócio se for sócio ativo)
  .post("/orders", async ({ auth, body }) => {
    const a = requireAccount(auth);
    const acc = await db.query.accounts.findFirst({ where: eq(accounts.id, a.accountId!) });
    const m = a.memberId ? await db.query.members.findFirst({ where: eq(members.id, a.memberId) }) : null;
    const activeMember = m && m.status === "active" ? m : null;
    const result = await createOrder({
      workspaceId: a.workspaceId, channel: "store", items: body.items as CartItem[],
      accountId: a.accountId, buyerMemberId: activeMember ? activeMember.id : null,
      buyerName: acc?.name, buyerEmail: acc?.email ?? undefined,
      audience: activeMember ? "member" : "public",
    });
    // confirmação por e-mail (fire-and-forget)
    if (acc?.email) {
      const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, a.workspaceId) });
      sendOrderEmail(acc.email, acc.name, {
        orderNumber: result.order.orderNumber, totalCents: result.order.totalCents,
        items: result.items.map((i) => ({ description: i.description, quantity: i.quantity, subtotalCents: i.subtotalCents })),
      }, ws?.name || "AtléticaHub").catch(() => {});
    }
    return ok({ orderId: result.order.id, orderNumber: result.order.orderNumber, totalCents: result.order.totalCents }, "Pedido criado");
  }, {
    body: t.Object({ items: t.Array(t.Object({ kind: t.String(), refId: t.String(), quantity: t.Number(), variantId: t.Optional(t.String()) })) }),
  })

  // Minhas compras
  .get("/orders", async ({ auth }) => {
    const a = requireAccount(auth);
    const rows = await db.query.orders.findMany({
      where: and(eq(orders.accountId, a.accountId!), eq(orders.workspaceId, a.workspaceId)),
      orderBy: [desc(orders.createdAt)],
    });
    const withItems = await Promise.all(rows.map(async (o) => ({
      id: o.id, orderNumber: o.orderNumber, totalCents: o.totalCents,
      paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus,
      createdAt: o.createdAt, qr: `${o.qrUuid}.${signQr(o.qrUuid)}`,
      items: await db.query.orderItems.findMany({ where: eq(orderItems.orderId, o.id) }),
    })));
    return ok({ orders: withItems });
  });
