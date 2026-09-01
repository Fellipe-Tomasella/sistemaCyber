/** Liga o gateway ao domínio: cria cobrança pra um pedido e concilia quando paga. */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { charges, orders } from "../db/schema.ts";
import { getWorkspacePayment, providerFor } from "./payments.ts";
import { payOrder } from "./order.service.ts";
import { Errors } from "../utils/response.ts";

/** Taxa do cartão a repassar (se configurado). Retorna o acréscimo em centavos. */
export function cardFeeAmount(cfg: { cardFeeBp: number; cardFeePass: boolean }, baseCents: number) {
  if (!cfg.cardFeePass) return 0;
  return Math.round(baseCents * (cfg.cardFeeBp / 10000));
}

export async function createPixForOrder(workspaceId: string, orderId: string, payer: { name?: string; email?: string }) {
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.workspaceId, workspaceId)) });
  if (!order) throw Errors.NotFound("Pedido não encontrado");
  if (order.paymentStatus === "paid") throw Errors.BadRequest("Pedido já está pago");
  const cfg = await getWorkspacePayment(workspaceId);
  if (!cfg.pixEnabled) throw Errors.BadRequest("Pix indisponível");
  const provider = providerFor(cfg);
  if (!provider) throw Errors.BadRequest("Pagamento online não configurado nesta atlética");

  const pix = await provider.createPix({
    amountCents: order.totalCents,
    description: `Pedido #${order.orderNumber}`,
    payerEmail: payer.email || order.buyerEmail || undefined,
    payerName: payer.name || order.buyerName || undefined,
  });
  const [charge] = await db.insert(charges).values({
    workspaceId, provider: cfg.provider!, externalId: pix.externalId, kind: "order", refId: order.id,
    method: "pix", amountCents: order.totalCents, status: pix.status,
    pixCopyPaste: pix.copyPaste, pixQrBase64: pix.qrBase64,
  }).returning();

  if (pix.status === "paid") await settleCharge(charge.id);
  return { chargeId: charge.id, copyPaste: pix.copyPaste, qrBase64: pix.qrBase64, externalId: pix.externalId };
}

export async function createCardForOrder(workspaceId: string, orderId: string, card: { cardToken: string; installments: number; paymentMethodId: string; email: string }) {
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.workspaceId, workspaceId)) });
  if (!order) throw Errors.NotFound("Pedido não encontrado");
  if (order.paymentStatus === "paid") throw Errors.BadRequest("Pedido já está pago");
  const cfg = await getWorkspacePayment(workspaceId);
  if (!cfg.cardEnabled) throw Errors.BadRequest("Cartão indisponível");
  const provider = providerFor(cfg);
  if (!provider || !provider.createCard) throw Errors.BadRequest("Cartão não configurado nesta atlética");

  const total = order.totalCents + cardFeeAmount(cfg, order.totalCents);
  const r = await provider.createCard({
    amountCents: total, description: `Pedido #${order.orderNumber}`,
    cardToken: card.cardToken, installments: card.installments, paymentMethodId: card.paymentMethodId, payerEmail: card.email,
  });
  const [charge] = await db.insert(charges).values({
    workspaceId, provider: cfg.provider!, externalId: r.externalId, kind: "order", refId: order.id,
    method: "credit", amountCents: total, status: r.status,
  }).returning();

  if (r.status === "paid") await settleCharge(charge.id);
  return { chargeId: charge.id, status: r.status };
}

/** Concilia uma cobrança: se paga, aplica o efeito no domínio (paga o pedido → gera receita). */
export async function settleCharge(chargeId: string) {
  const charge = await db.query.charges.findFirst({ where: eq(charges.id, chargeId) });
  if (!charge || charge.status === "paid") return;
  await db.update(charges).set({ status: "paid", paidAt: new Date() }).where(eq(charges.id, charge.id));
  if (charge.kind === "order") {
    await payOrder(charge.workspaceId, charge.refId);   // já gera a transaction de receita
  }
}

/** Recebe notificação do gateway: acha a cobrança pelo externalId, consulta status e concilia. */
export async function handleWebhook(provider: string, externalId: string) {
  const charge = await db.query.charges.findFirst({ where: eq(charges.externalId, externalId) });
  if (!charge) return { handled: false };
  const cfg = await getWorkspacePayment(charge.workspaceId);
  const p = providerFor(cfg);
  if (!p) return { handled: false };
  const status = await p.getStatus(externalId);
  if (status === "paid") await settleCharge(charge.id);
  else if (status === "failed") await db.update(charges).set({ status: "failed" }).where(eq(charges.id, charge.id));
  return { handled: true, status };
}
