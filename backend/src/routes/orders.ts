import { Elysia, t } from "elysia";
import { and, eq, desc, or } from "drizzle-orm";
import { db } from "../db/client.ts";
import { orders, orderItems, members } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { createOrder, payOrder, deliverOrder, type CartItem } from "../services/order.service.ts";
import { onlyDigits } from "../utils/validators.ts";
import { documentLookup } from "../utils/crypto.ts";

export const orderRoutes = new Elysia({ prefix: "/orders" })
  .use(authGuard)

  .get("/", async ({ auth, query }) => {
    const a = requireDirector(auth);
    const where = query.fulfillment
      ? and(eq(orders.workspaceId, a.workspaceId), eq(orders.fulfillmentStatus, query.fulfillment as any))
      : query.payment
        ? and(eq(orders.workspaceId, a.workspaceId), eq(orders.paymentStatus, query.payment as any))
        : eq(orders.workspaceId, a.workspaceId);
    const rows = await db.query.orders.findMany({ where, orderBy: [desc(orders.createdAt)], limit: 500 });
    return ok({ orders: rows });
  }, { query: t.Object({ payment: t.Optional(t.String()), fulfillment: t.Optional(t.String()) }) })

  .get("/:id", async ({ auth, params }) => {
    const a = requireDirector(auth);
    const order = await db.query.orders.findFirst({ where: and(eq(orders.id, params.id), eq(orders.workspaceId, a.workspaceId)) });
    if (!order) throw Errors.NotFound("Pedido não encontrado");
    const items = await db.query.orderItems.findMany({ where: eq(orderItems.orderId, order.id) });
    return ok({ order, items });
  })

  // Criar pedido manual (balcão)
  .post("/", async ({ auth, body }) => {
    const a = requireModule(auth, "pedidos");
    const result = await createOrder({
      workspaceId: a.workspaceId, channel: "admin", items: body.items as CartItem[],
      buyerMemberId: body.buyerMemberId ?? null, buyerName: body.buyerName, buyerEmail: body.buyerEmail,
      audience: body.audience as any,
    });
    return ok(result, "Pedido criado");
  }, {
    body: t.Object({
      items: t.Array(t.Object({ kind: t.String(), refId: t.String(), quantity: t.Number(), variantId: t.Optional(t.String()) })),
      buyerName: t.Optional(t.String()), buyerEmail: t.Optional(t.String()),
      buyerMemberId: t.Optional(t.String()), audience: t.Optional(t.String()),
    }),
  })

  // Marcar pago (1 clique) → gera receita
  .post("/:id/pay", async ({ auth, params }) => {
    const a = requireModule(auth, "pedidos");
    return ok({ order: await payOrder(a.workspaceId, params.id, a.sub) }, "Pagamento confirmado");
  })

  // Entregar (retirada) → baixa estoque + registra pickup
  .post("/:id/deliver", async ({ auth, params, body }) => {
    const a = requireModule(auth, "pedidos");
    return ok({ order: await deliverOrder(a.workspaceId, params.id, { pickedUpBy: body?.pickedUpBy, handledBy: a.sub }) }, "Produtos entregues");
  }, { body: t.Optional(t.Object({ pickedUpBy: t.Optional(t.String()) })) });

/* ---- Retirada: busca por QR / nº do pedido / CPF ---- */
export const pickupRoutes = new Elysia({ prefix: "/pickup" })
  .use(authGuard)
  .get("/lookup", async ({ auth, query }) => {
    const a = requireDirector(auth);
    const q = (query.q || "").trim();
    if (!q) throw Errors.BadRequest("Informe QR, nº do pedido ou CPF");

    let order = null;
    const digits = onlyDigits(q);
    if (/^[0-9a-f-]{36}$/i.test(q)) {
      order = await db.query.orders.findFirst({ where: and(eq(orders.qrUuid, q), eq(orders.workspaceId, a.workspaceId)) });
    } else if (digits.length === 11) {
      const m = await db.query.members.findFirst({ where: and(eq(members.workspaceId, a.workspaceId), eq(members.cpfLookup, documentLookup(digits))) });
      if (m) order = await db.query.orders.findFirst({ where: and(eq(orders.buyerMemberId, m.id), eq(orders.paymentStatus, "paid")), orderBy: [desc(orders.createdAt)] });
    } else if (digits) {
      order = await db.query.orders.findFirst({ where: and(eq(orders.workspaceId, a.workspaceId), eq(orders.orderNumber, Number(digits))) });
    }
    if (!order) throw Errors.NotFound("Pedido não encontrado");
    const items = await db.query.orderItems.findMany({ where: eq(orderItems.orderId, order.id) });
    return ok({ order, items });
  }, { query: t.Object({ q: t.String() }) })

  // Fila de retirada (pagos, ainda não entregues)
  .get("/queue", async ({ auth }) => {
    const a = requireDirector(auth);
    const rows = await db.query.orders.findMany({
      where: and(eq(orders.workspaceId, a.workspaceId), eq(orders.paymentStatus, "paid"), or(eq(orders.fulfillmentStatus, "open"), eq(orders.fulfillmentStatus, "ready"))),
      orderBy: [desc(orders.createdAt)], limit: 200,
    });
    return ok({ queue: rows });
  });
