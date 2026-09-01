/** Pedidos — resolução de preço por tipo (fã/sócio/atleta), criação e pagamento. */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  orders, orderItems, products, productVariants, membershipPlans, ticketBatches, events,
  priceTiers, transactions, pickups, members,
} from "../db/schema.ts";
import { nextNumber } from "../utils/sequence.ts";
import { Errors } from "../utils/response.ts";
import { today } from "../utils/dates.ts";

export type Audience = "public" | "member" | "athlete" | "director";
export interface CartItem { kind: "product" | "ticket" | "plan"; refId: string; quantity: number; variantId?: string; }

async function tierPrice(workspaceId: string, refType: string, refId: string, audience: Audience, base: number) {
  if (audience === "public") return base;
  const t = await db.query.priceTiers.findFirst({
    where: and(eq(priceTiers.workspaceId, workspaceId), eq(priceTiers.refType, refType), eq(priceTiers.refId, refId), eq(priceTiers.audience, audience)),
  });
  return t?.priceCents ?? base;
}

async function resolveItem(workspaceId: string, item: CartItem, audience: Audience) {
  if (item.kind === "product") {
    const p = await db.query.products.findFirst({ where: and(eq(products.id, item.refId), eq(products.workspaceId, workspaceId)) });
    if (!p || !p.active) throw Errors.BadRequest("Produto indisponível");
    let desc = p.name, variantId = item.variantId ?? null;
    if (variantId) {
      const v = await db.query.productVariants.findFirst({ where: and(eq(productVariants.id, variantId), eq(productVariants.productId, p.id)) });
      if (v) desc = `${p.name} · ${v.name}`; else variantId = null;
    }
    const unit = await tierPrice(workspaceId, "product", p.id, audience, p.basePriceCents);
    return { kind: "product" as const, productId: p.id, variantId, batchId: null, planId: null, description: desc, unitPriceCents: unit };
  }
  if (item.kind === "ticket") {
    const b = await db.query.ticketBatches.findFirst({ where: and(eq(ticketBatches.id, item.refId), eq(ticketBatches.workspaceId, workspaceId)) });
    if (!b || !b.active) throw Errors.BadRequest("Lote indisponível");
    const ev = await db.query.events.findFirst({ where: eq(events.id, b.eventId) });
    const unit = await tierPrice(workspaceId, "ticket_batch", b.id, audience, b.priceCents);
    return { kind: "ticket" as const, productId: null, variantId: null, batchId: b.id, planId: null, description: `${ev?.name ?? "Evento"} — ${b.name}`, unitPriceCents: unit };
  }
  const plan = await db.query.membershipPlans.findFirst({ where: and(eq(membershipPlans.id, item.refId), eq(membershipPlans.workspaceId, workspaceId)) });
  if (!plan || !plan.active) throw Errors.BadRequest("Plano indisponível");
  const unit = await tierPrice(workspaceId, "plan", plan.id, audience, plan.priceCents);
  return { kind: "plan" as const, productId: null, variantId: null, batchId: null, planId: plan.id, description: `Plano ${plan.name}`, unitPriceCents: unit };
}

export async function createOrder(opts: {
  workspaceId: string;
  items: CartItem[];
  channel: "store" | "admin";
  audience?: Audience;
  accountId?: string | null;
  buyerMemberId?: string | null;
  buyerName?: string;
  buyerEmail?: string;
}) {
  if (!opts.items?.length) throw Errors.BadRequest("Carrinho vazio");
  const audience: Audience = opts.audience ?? (opts.buyerMemberId ? "member" : "public");

  const resolved = [];
  let total = 0;
  for (const it of opts.items) {
    const r = await resolveItem(opts.workspaceId, it, audience);
    const qty = Math.max(1, it.quantity | 0);
    const subtotal = r.unitPriceCents * qty;
    total += subtotal;
    resolved.push({ ...r, quantity: qty, subtotalCents: subtotal });
  }

  const orderNumber = await nextNumber("orders", "order_number", opts.workspaceId, 2400);
  const [order] = await db.insert(orders).values({
    workspaceId: opts.workspaceId, orderNumber,
    accountId: opts.accountId ?? null,
    buyerMemberId: opts.buyerMemberId ?? null, buyerName: opts.buyerName, buyerEmail: opts.buyerEmail,
    totalCents: total, paymentStatus: "pending", fulfillmentStatus: "open", channel: opts.channel,
  }).returning();

  await db.insert(orderItems).values(resolved.map((r) => ({
    orderId: order.id, kind: r.kind, productId: r.productId, variantId: r.variantId,
    batchId: r.batchId, planId: r.planId, description: r.description,
    unitPriceCents: r.unitPriceCents, quantity: r.quantity, subtotalCents: r.subtotalCents,
  })));

  return { order, items: resolved };
}

/** Marca pedido pago → gera transação de receita (prestação de contas automática). */
export async function payOrder(workspaceId: string, orderId: string, directorId?: string) {
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.workspaceId, workspaceId)) });
  if (!order) throw Errors.NotFound("Pedido não encontrado");
  if (order.paymentStatus === "paid") return order;

  const [updated] = await db.update(orders).set({ paymentStatus: "paid", paidAt: new Date(), fulfillmentStatus: "ready" })
    .where(eq(orders.id, orderId)).returning();

  await db.insert(transactions).values({
    workspaceId, description: `Pedido #${order.orderNumber}${order.buyerName ? " — " + order.buyerName : ""}`,
    amountCents: order.totalCents, type: "income", date: today(), status: "paid", paidAt: new Date(),
    orderId: order.id, paymentMethod: "manual", createdBy: directorId ?? null,
  });
  return updated;
}

/** Entrega (retirada): baixa estoque dos produtos e registra pickup. */
export async function deliverOrder(workspaceId: string, orderId: string, opts: { pickedUpBy?: string; handledBy?: string }) {
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.workspaceId, workspaceId)) });
  if (!order) throw Errors.NotFound("Pedido não encontrado");
  if (order.paymentStatus !== "paid") throw Errors.BadRequest("Pedido ainda não foi pago");

  const items = await db.query.orderItems.findMany({ where: eq(orderItems.orderId, orderId) });
  for (const it of items) {
    if (it.kind === "product" && it.productId) {
      if (it.variantId) {
        const v = await db.query.productVariants.findFirst({ where: eq(productVariants.id, it.variantId) });
        if (v) await db.update(productVariants).set({ stockQuantity: Math.max(0, v.stockQuantity - it.quantity) }).where(eq(productVariants.id, v.id));
      }
      const p = await db.query.products.findFirst({ where: eq(products.id, it.productId) });
      if (p?.trackStock) {
        await db.update(products).set({ stockQuantity: Math.max(0, p.stockQuantity - it.quantity) }).where(eq(products.id, p.id));
      }
    }
    await db.update(orderItems).set({ pickedUpAt: new Date() }).where(eq(orderItems.id, it.id));
  }

  await db.insert(pickups).values({ workspaceId, orderId, pickedUpBy: opts.pickedUpBy, handledBy: opts.handledBy ?? null });
  const [updated] = await db.update(orders).set({ fulfillmentStatus: "delivered" }).where(eq(orders.id, orderId)).returning();
  return updated;
}
