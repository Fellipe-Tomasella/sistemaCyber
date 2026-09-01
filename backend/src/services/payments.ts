/**
 * Adaptador de pagamentos — "tomada padrão" pra plugar qualquer gateway.
 * Providers: `mock` (teste sem dinheiro) e `mercadopago` (Pix + cartão).
 * A troca de gateway é só trocar o provider; o resto do sistema não muda.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workspaces } from "../db/schema.ts";
import { decryptSecret, randomToken } from "../utils/crypto.ts";

export type ChargeStatus = "pending" | "paid" | "failed" | "cancelled";

export interface PixResult { externalId: string; copyPaste: string; qrBase64?: string; status: ChargeStatus; }
export interface CardResult { externalId: string; status: ChargeStatus; }

export interface PaymentProvider {
  createPix(o: { amountCents: number; description: string; payerEmail?: string; payerName?: string }): Promise<PixResult>;
  createCard?(o: { amountCents: number; description: string; cardToken: string; installments: number; paymentMethodId: string; payerEmail: string }): Promise<CardResult>;
  getStatus(externalId: string): Promise<ChargeStatus>;
}

/* ---------------- Mock (teste) ---------------- */
const mockStore = new Map<string, ChargeStatus>();
const mock: PaymentProvider = {
  async createPix(o) {
    const id = "mock_" + randomToken(8);
    mockStore.set(id, "pending");
    const copyPaste = `00020126MOCKPIX${id}5204000053039865802BR6009SINOP${String(o.amountCents).padStart(6, "0")}`;
    return { externalId: id, copyPaste, qrBase64: undefined, status: "pending" };
  },
  async createCard(o) {
    const id = "mock_" + randomToken(8);
    // cartão de teste "aprovado" quando token começa com 'APRO'
    const status: ChargeStatus = o.cardToken.startsWith("APRO") ? "paid" : "failed";
    mockStore.set(id, status);
    return { externalId: id, status };
  },
  async getStatus(id) { return mockStore.get(id) ?? "pending"; },
};
/** Usado só no provider mock: simula a confirmação (o "webhook" do banco). */
export function mockConfirm(externalId: string) { mockStore.set(externalId, "paid"); }

/* ---------------- Mercado Pago ---------------- */
const MP_BASE = "https://api.mercadopago.com";
function mpStatus(s: string): ChargeStatus {
  if (s === "approved") return "paid";
  if (s === "rejected" || s === "cancelled") return "failed";
  return "pending";
}
function mercadopago(accessToken: string): PaymentProvider {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  return {
    async createPix(o) {
      const res = await fetch(`${MP_BASE}/v1/payments`, {
        method: "POST",
        headers: { ...headers, "X-Idempotency-Key": randomToken(12) },
        body: JSON.stringify({
          transaction_amount: o.amountCents / 100,
          description: o.description,
          payment_method_id: "pix",
          payer: { email: o.payerEmail || "comprador@atleticahub.app", first_name: o.payerName || "Comprador" },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message || "Falha ao criar Pix no Mercado Pago");
      const td = j.point_of_interaction?.transaction_data || {};
      return { externalId: String(j.id), copyPaste: td.qr_code, qrBase64: td.qr_code_base64, status: mpStatus(j.status) };
    },
    async createCard(o) {
      const res = await fetch(`${MP_BASE}/v1/payments`, {
        method: "POST",
        headers: { ...headers, "X-Idempotency-Key": randomToken(12) },
        body: JSON.stringify({
          transaction_amount: o.amountCents / 100,
          description: o.description,
          token: o.cardToken,
          installments: o.installments,
          payment_method_id: o.paymentMethodId,
          payer: { email: o.payerEmail },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message || "Falha no cartão");
      return { externalId: String(j.id), status: mpStatus(j.status) };
    },
    async getStatus(externalId) {
      const res = await fetch(`${MP_BASE}/v1/payments/${externalId}`, { headers });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message || "Falha ao consultar pagamento");
      return mpStatus(j.status);
    },
  };
}

/* ---------------- Factory ---------------- */
export interface WorkspacePayment {
  provider: string | null;
  accessToken: string | null;
  publicKey: string | null;
  sandbox: boolean;
  cardFeeBp: number;
  cardFeePass: boolean;
  pixEnabled: boolean;
  cardEnabled: boolean;
}

/** Config de pagamento da atlética (com token descriptografado). */
export async function getWorkspacePayment(workspaceId: string): Promise<WorkspacePayment> {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws) throw new Error("Atlética não encontrada");
  let token: string | null = null;
  if (ws.paymentAccessTokenEnc) { try { token = decryptSecret(ws.paymentAccessTokenEnc); } catch { token = null; } }
  return {
    provider: ws.paymentProvider ?? null,
    accessToken: token,
    publicKey: ws.paymentPublicKey ?? null,
    sandbox: ws.paymentSandbox,
    cardFeeBp: ws.cardFeeBp,
    cardFeePass: ws.cardFeePass,
    pixEnabled: ws.pixEnabled,
    cardEnabled: ws.cardEnabled,
  };
}

/** Retorna o provider pronto pra usar, ou null se a atlética não configurou. */
export function providerFor(cfg: WorkspacePayment): PaymentProvider | null {
  if (cfg.provider === "mock") return mock;
  if (cfg.provider === "mercadopago" && cfg.accessToken) return mercadopago(cfg.accessToken);
  return null;
}
