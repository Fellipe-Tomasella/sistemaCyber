/** Loja pública white-label — sem autenticação, por slug da atlética. */
import { Elysia, t } from "elysia";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workspaces, products, membershipPlans, events, ticketBatches, members, priceTiers, productVariants } from "../db/schema.ts";
import { ok, Errors } from "../utils/response.ts";
import { createOrder, type CartItem } from "../services/order.service.ts";
import { onlyDigits } from "../utils/validators.ts";
import { documentLookup } from "../utils/crypto.ts";
import { getWorkspacePayment } from "../services/payments.ts";
import { createPixForOrder, createCardForOrder } from "../services/charge.service.ts";
import { orders } from "../db/schema.ts";

export const storeRoutes = new Elysia({ prefix: "/store" })
  // Catálogo + branding da atlética
  .get("/:slug", async ({ params }) => {
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, params.slug) });
    if (!ws || !ws.active) throw Errors.NotFound("Loja não encontrada");

    const [prods, plans, evs, tiers] = await Promise.all([
      db.query.products.findMany({ where: and(eq(products.workspaceId, ws.id), eq(products.active, true)) }),
      db.query.membershipPlans.findMany({ where: and(eq(membershipPlans.workspaceId, ws.id), eq(membershipPlans.active, true)) }),
      db.query.events.findMany({ where: and(eq(events.workspaceId, ws.id), eq(events.status, "selling")) }),
      db.query.priceTiers.findMany({ where: and(eq(priceTiers.workspaceId, ws.id), eq(priceTiers.audience, "member")) }),
    ]);
    const memberPrice = (refId: string) => tiers.find((t) => t.refId === refId)?.priceCents ?? null;

    const prodIds = prods.map((p) => p.id);
    const variants = prodIds.length ? await db.query.productVariants.findMany({ where: inArray(productVariants.productId, prodIds) }) : [];
    const variantsOf = (pid: string) => variants.filter((v) => v.productId === pid).map((v) => ({ id: v.id, name: v.name, stockQuantity: v.stockQuantity }));

    const eventsFull = await Promise.all(evs.map(async (ev) => {
      const batches = await db.query.ticketBatches.findMany({ where: and(eq(ticketBatches.eventId, ev.id), eq(ticketBatches.active, true)) });
      return { ...ev, batches: batches.map((b) => ({ ...b, memberPriceCents: memberPrice(b.id), remaining: b.quantityTotal - b.quantitySold })) };
    }));

    const pay = await getWorkspacePayment(ws.id);
    return ok({
      workspace: {
        name: ws.name, slug: ws.slug, university: ws.university,
        logoKey: ws.logoKey, primaryColor: ws.primaryColor, accentColor: ws.accentColor,
      },
      payment: {
        online: !!pay.provider,
        provider: pay.provider,
        pixEnabled: pay.pixEnabled && !!pay.provider,
        cardEnabled: pay.cardEnabled && !!pay.provider && pay.provider !== "mock",
        publicKey: pay.publicKey,
        sandbox: pay.sandbox,
        cardFeeBp: pay.cardFeeBp,
        cardFeePass: pay.cardFeePass,
      },
      homepage: ws.homepage || {},
      products: prods.map((p) => ({ ...p, memberPriceCents: memberPrice(p.id), variants: variantsOf(p.id) })),
      plans: plans.map((p) => ({ ...p, memberPriceCents: memberPrice(p.id) })),
      events: eventsFull,
    });
  })

  // Checkout público → cria pedido "pending" (pagamento manual confirmado pela diretoria)
  .post("/:slug/orders", async ({ params, body }) => {
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, params.slug) });
    if (!ws) throw Errors.NotFound("Loja não encontrada");
    if (!body.items?.length) throw Errors.BadRequest("Carrinho vazio");

    // Se o CPF do comprador for de sócio ativo, aplica preço de sócio
    let buyerMemberId: string | null = null;
    if (body.buyerCpf) {
      const digits = onlyDigits(body.buyerCpf);
      const m = digits.length === 11
        ? await db.query.members.findFirst({ where: and(eq(members.workspaceId, ws.id), eq(members.cpfLookup, documentLookup(digits))) })
        : null;
      if (m && m.status === "active") buyerMemberId = m.id;
    }

    const result = await createOrder({
      workspaceId: ws.id, channel: "store", items: body.items as CartItem[],
      buyerMemberId, buyerName: body.buyerName, buyerEmail: body.buyerEmail,
      audience: buyerMemberId ? "member" : "public",
    });
    return ok({ orderId: result.order.id, orderNumber: result.order.orderNumber, qrUuid: result.order.qrUuid, totalCents: result.order.totalCents }, "Pedido recebido — aguardando pagamento");
  }, {
    body: t.Object({
      buyerName: t.String(), buyerEmail: t.Optional(t.String()), buyerCpf: t.Optional(t.String()),
      items: t.Array(t.Object({ kind: t.String(), refId: t.String(), quantity: t.Number(), variantId: t.Optional(t.String()) })),
    }),
  })

  // Gera cobrança Pix para um pedido → devolve copia-e-cola + QR
  .post("/:slug/orders/:orderId/pix", async ({ params, body }) => {
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, params.slug) });
    if (!ws) throw Errors.NotFound("Loja não encontrada");
    const r = await createPixForOrder(ws.id, params.orderId, { name: body?.buyerName, email: body?.buyerEmail });
    return ok(r, "Pix gerado");
  }, { body: t.Optional(t.Object({ buyerName: t.Optional(t.String()), buyerEmail: t.Optional(t.String()) })) })

  // Cobrança no cartão (token gerado no frontend pelo SDK do gateway)
  .post("/:slug/orders/:orderId/card", async ({ params, body }) => {
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, params.slug) });
    if (!ws) throw Errors.NotFound("Loja não encontrada");
    const r = await createCardForOrder(ws.id, params.orderId, {
      cardToken: body.cardToken, installments: body.installments || 1, paymentMethodId: body.paymentMethodId, email: body.email,
    });
    return ok(r, r.status === "paid" ? "Pagamento aprovado" : "Pagamento não aprovado");
  }, { body: t.Object({ cardToken: t.String(), paymentMethodId: t.String(), installments: t.Optional(t.Number()), email: t.String() }) })

  // Polling do status do pedido (a loja fica checando até virar "paid")
  .get("/:slug/orders/:orderId/status", async ({ params }) => {
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, params.slug) });
    if (!ws) throw Errors.NotFound("Loja não encontrada");
    const order = await db.query.orders.findFirst({ where: and(eq(orders.id, params.orderId), eq(orders.workspaceId, ws.id)) });
    if (!order) throw Errors.NotFound("Pedido não encontrado");
    return ok({ paymentStatus: order.paymentStatus, orderNumber: order.orderNumber });
  });
