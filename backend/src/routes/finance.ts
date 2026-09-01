import { Elysia, t } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { transactions, costCenters, financeCategories, recurringTransactions } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { today } from "../utils/dates.ts";

const pad = (n: number) => String(n).padStart(2, "0");
/** Gera as pendências do mês pras recorrências ativas (idempotente por mês). */
async function runRecurring(workspaceId: string) {
  const now = new Date();
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const rules = await db.query.recurringTransactions.findMany({ where: and(eq(recurringTransactions.workspaceId, workspaceId), eq(recurringTransactions.active, true)) });
  for (const r of rules) {
    if (r.lastRunMonth === month) continue;
    const date = `${month}-${pad(Math.min(28, Math.max(1, r.dayOfMonth)))}`;
    await db.insert(transactions).values({
      workspaceId, description: r.description, amountCents: r.amountCents, type: r.type,
      date, dueDate: date, status: "pending", costCenterId: r.costCenterId, categoryId: r.categoryId,
    });
    await db.update(recurringTransactions).set({ lastRunMonth: month }).where(eq(recurringTransactions.id, r.id));
  }
}

export const financeRoutes = new Elysia()
  .use(authGuard)

  /* ---- Lançamentos recorrentes (contas fixas) ---- */
  .get("/recurring", async ({ auth }) => {
    const a = requireDirector(auth);
    return ok({ recurring: await db.query.recurringTransactions.findMany({ where: eq(recurringTransactions.workspaceId, a.workspaceId) }) });
  })
  .post("/recurring", async ({ auth, body }) => {
    const a = requireModule(auth, "financeiro");
    const [r] = await db.insert(recurringTransactions).values({
      workspaceId: a.workspaceId, description: body.description, amountCents: body.amountCents,
      type: (body.type ?? "expense") as any, dayOfMonth: Math.min(28, Math.max(1, body.dayOfMonth ?? 1)),
      costCenterId: body.costCenterId, categoryId: body.categoryId,
    }).returning();
    return ok({ recurring: r }, "Recorrência criada");
  }, { body: t.Object({ description: t.String(), amountCents: t.Number(), type: t.Optional(t.String()), dayOfMonth: t.Optional(t.Number()), costCenterId: t.Optional(t.String()), categoryId: t.Optional(t.String()) }) })
  .patch("/recurring/:id", async ({ auth, params, body }) => {
    const a = requireModule(auth, "financeiro");
    const set: Record<string, unknown> = {};
    if (body.active !== undefined) set.active = body.active;
    if (body.description !== undefined) set.description = body.description;
    if (body.amountCents !== undefined) set.amountCents = body.amountCents;
    if (body.dayOfMonth !== undefined) set.dayOfMonth = Math.min(28, Math.max(1, body.dayOfMonth));
    const [r] = await db.update(recurringTransactions).set(set).where(and(eq(recurringTransactions.id, params.id), eq(recurringTransactions.workspaceId, a.workspaceId))).returning();
    if (!r) throw Errors.NotFound("Recorrência não encontrada");
    return ok({ recurring: r }, "Recorrência atualizada");
  }, { body: t.Object({ active: t.Optional(t.Boolean()), description: t.Optional(t.String()), amountCents: t.Optional(t.Number()), dayOfMonth: t.Optional(t.Number()) }) })
  .delete("/recurring/:id", async ({ auth, params }) => {
    const a = requireModule(auth, "financeiro");
    await db.delete(recurringTransactions).where(and(eq(recurringTransactions.id, params.id), eq(recurringTransactions.workspaceId, a.workspaceId)));
    return ok({ deleted: true }, "Recorrência removida");
  })

  /* ---- Centros de custo ---- */
  .get("/cost-centers", async ({ auth }) => {
    const a = requireDirector(auth);
    return ok({ costCenters: await db.query.costCenters.findMany({ where: eq(costCenters.workspaceId, a.workspaceId) }) });
  })
  .post("/cost-centers", async ({ auth, body }) => {
    const a = requireModule(auth, "financeiro");
    const [c] = await db.insert(costCenters).values({
      workspaceId: a.workspaceId, name: body.name, color: body.color, kind: (body.kind ?? "general") as any,
    }).returning();
    return ok({ costCenter: c }, "Centro de custo criado");
  }, { body: t.Object({ name: t.String(), color: t.Optional(t.String()), kind: t.Optional(t.String()) }) })

  /* ---- Categorias financeiras ---- */
  .get("/finance-categories", async ({ auth }) => {
    const a = requireDirector(auth);
    return ok({ categories: await db.query.financeCategories.findMany({ where: eq(financeCategories.workspaceId, a.workspaceId) }) });
  })
  .post("/finance-categories", async ({ auth, body }) => {
    const a = requireModule(auth, "financeiro");
    const [c] = await db.insert(financeCategories).values({
      workspaceId: a.workspaceId, name: body.name, type: (body.type ?? "expense") as any, color: body.color,
    }).returning();
    return ok({ category: c }, "Categoria criada");
  }, { body: t.Object({ name: t.String(), type: t.Optional(t.String()), color: t.Optional(t.String()) }) })
  .delete("/finance-categories/:id", async ({ auth, params }) => {
    const a = requireModule(auth, "financeiro");
    await db.delete(financeCategories).where(and(eq(financeCategories.id, params.id), eq(financeCategories.workspaceId, a.workspaceId)));
    return ok({ deleted: true }, "Categoria excluída");
  })

  /* ---- Lançamentos ---- */
  .get("/transactions", async ({ auth }) => {
    const a = requireDirector(auth);
    await runRecurring(a.workspaceId);   // gera as pendências recorrentes do mês
    const rows = await db.query.transactions.findMany({
      where: eq(transactions.workspaceId, a.workspaceId),
      orderBy: [desc(transactions.date)], limit: 500,
    });
    let income = 0, expense = 0;
    for (const r of rows) (r.type === "income" ? (income += r.amountCents) : (expense += r.amountCents));
    return ok({ transactions: rows, summary: { income, expense, result: income - expense } });
  })
  .post("/transactions", async ({ auth, body }) => {
    const a = requireModule(auth, "financeiro");
    const [tx] = await db.insert(transactions).values({
      workspaceId: a.workspaceId,
      description: body.description, amountCents: body.amountCents, type: body.type as any,
      date: body.date ?? today(), dueDate: body.dueDate, costCenterId: body.costCenterId,
      categoryId: body.categoryId, paymentMethod: body.paymentMethod,
      status: body.status as any ?? "paid",
      paidAt: (body.status ?? "paid") === "paid" ? new Date() : null,
      createdBy: a.sub,
    }).returning();
    return ok({ transaction: tx }, "Lançamento criado");
  }, {
    body: t.Object({
      description: t.String(), amountCents: t.Number(), type: t.String(),
      date: t.Optional(t.String()), dueDate: t.Optional(t.String()),
      costCenterId: t.Optional(t.String()), categoryId: t.Optional(t.String()),
      paymentMethod: t.Optional(t.String()), status: t.Optional(t.String()),
    }),
  })
  // Marcar pago (1 clique)
  .post("/transactions/:id/pay", async ({ auth, params }) => {
    const a = requireModule(auth, "financeiro");
    const [tx] = await db.update(transactions).set({ status: "paid", paidAt: new Date() })
      .where(and(eq(transactions.id, params.id), eq(transactions.workspaceId, a.workspaceId))).returning();
    if (!tx) throw Errors.NotFound("Lançamento não encontrado");
    return ok({ transaction: tx }, "Marcado como pago");
  })

  // Editar lançamento
  .patch("/transactions/:id", async ({ auth, params, body }) => {
    const a = requireModule(auth, "financeiro");
    const set: Record<string, unknown> = {};
    if (body.description !== undefined) set.description = body.description;
    if (body.amountCents !== undefined) set.amountCents = body.amountCents;
    if (body.type !== undefined) set.type = body.type;
    if (body.date !== undefined) set.date = body.date;
    if (body.dueDate !== undefined) set.dueDate = body.dueDate || null;
    if (body.costCenterId !== undefined) set.costCenterId = body.costCenterId || null;
    if (body.categoryId !== undefined) set.categoryId = body.categoryId || null;
    if (body.paymentMethod !== undefined) set.paymentMethod = body.paymentMethod;
    if (body.status !== undefined) { set.status = body.status; set.paidAt = body.status === "paid" ? new Date() : null; }
    const [tx] = await db.update(transactions).set(set)
      .where(and(eq(transactions.id, params.id), eq(transactions.workspaceId, a.workspaceId))).returning();
    if (!tx) throw Errors.NotFound("Lançamento não encontrado");
    return ok({ transaction: tx }, "Lançamento atualizado");
  }, {
    body: t.Object({
      description: t.Optional(t.String()), amountCents: t.Optional(t.Number()), type: t.Optional(t.String()),
      date: t.Optional(t.String()), dueDate: t.Optional(t.String()), costCenterId: t.Optional(t.String()),
      categoryId: t.Optional(t.String()), paymentMethod: t.Optional(t.String()), status: t.Optional(t.String()),
    }),
  })

  // Excluir lançamento
  .delete("/transactions/:id", async ({ auth, params }) => {
    const a = requireModule(auth, "financeiro");
    const [tx] = await db.delete(transactions)
      .where(and(eq(transactions.id, params.id), eq(transactions.workspaceId, a.workspaceId))).returning();
    if (!tx) throw Errors.NotFound("Lançamento não encontrado");
    return ok({ deleted: true }, "Lançamento excluído");
  })

  // Excluir centro de custo
  .delete("/cost-centers/:id", async ({ auth, params }) => {
    const a = requireModule(auth, "financeiro");
    await db.delete(costCenters).where(and(eq(costCenters.id, params.id), eq(costCenters.workspaceId, a.workspaceId)));
    return ok({ deleted: true }, "Centro de custo excluído");
  });
