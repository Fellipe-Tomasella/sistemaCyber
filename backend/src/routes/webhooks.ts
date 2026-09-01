/** Webhooks de pagamento (público). */
import { Elysia, t } from "elysia";
import { ok } from "../utils/response.ts";
import { handleWebhook, settleCharge } from "../services/charge.service.ts";
import { mockConfirm } from "../services/payments.ts";
import { db } from "../db/client.ts";
import { charges } from "../db/schema.ts";
import { eq } from "drizzle-orm";

export const webhookRoutes = new Elysia({ prefix: "/webhooks" })
  // Mercado Pago: { type:'payment', data:{ id } } (ou query ?topic=payment&id=)
  .post("/mercadopago", async ({ body, query }) => {
    const id = (body as any)?.data?.id || (query as any)?.id || (query as any)?.["data.id"];
    if (id) await handleWebhook("mercadopago", String(id));
    return ok({ received: true });
  })

  // Mock (teste): simula a confirmação do banco. `externalId` da cobrança.
  .post("/mock/:externalId", async ({ params }) => {
    mockConfirm(params.externalId);
    const c = await db.query.charges.findFirst({ where: eq(charges.externalId, params.externalId) });
    if (c) await settleCharge(c.id);
    return ok({ confirmed: params.externalId });
  });
