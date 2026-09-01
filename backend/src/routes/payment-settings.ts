import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workspaces } from "../db/schema.ts";
import { authGuard, requireModule, requireAdmin } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { encryptSecret } from "../utils/crypto.ts";

export const paymentSettingsRoutes = new Elysia({ prefix: "/payment-settings" })
  .use(authGuard)
  .get("/", async ({ auth }) => {
    const a = requireModule(auth, "financeiro");
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, a.workspaceId) });
    if (!ws) throw Errors.NotFound("Atlética não encontrada");
    return ok({
      provider: ws.paymentProvider,
      hasToken: !!ws.paymentAccessTokenEnc,
      publicKey: ws.paymentPublicKey,
      sandbox: ws.paymentSandbox,
      cardFeeBp: ws.cardFeeBp,
      cardFeePass: ws.cardFeePass,
      pixEnabled: ws.pixEnabled,
      cardEnabled: ws.cardEnabled,
    });
  })
  .patch("/", async ({ auth, body }) => {
    const a = requireAdmin(auth);
    const set: Record<string, unknown> = {};
    if (body.provider !== undefined) set.paymentProvider = body.provider || null;
    if (body.accessToken) set.paymentAccessTokenEnc = encryptSecret(body.accessToken); // só troca se enviar
    if (body.publicKey !== undefined) set.paymentPublicKey = body.publicKey || null;
    if (body.sandbox !== undefined) set.paymentSandbox = body.sandbox;
    if (body.cardFeeBp !== undefined) set.cardFeeBp = body.cardFeeBp;
    if (body.cardFeePass !== undefined) set.cardFeePass = body.cardFeePass;
    if (body.pixEnabled !== undefined) set.pixEnabled = body.pixEnabled;
    if (body.cardEnabled !== undefined) set.cardEnabled = body.cardEnabled;
    await db.update(workspaces).set(set).where(eq(workspaces.id, a.workspaceId));
    return ok({ saved: true }, "Configuração de pagamento salva");
  }, {
    body: t.Object({
      provider: t.Optional(t.String()),
      accessToken: t.Optional(t.String()),
      publicKey: t.Optional(t.String()),
      sandbox: t.Optional(t.Boolean()),
      cardFeeBp: t.Optional(t.Number()),
      cardFeePass: t.Optional(t.Boolean()),
      pixEnabled: t.Optional(t.Boolean()),
      cardEnabled: t.Optional(t.Boolean()),
    }),
  });
