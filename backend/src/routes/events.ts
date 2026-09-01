import { Elysia, t } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { events, ticketBatches, tickets, guestLists, guestListEntries, transactions } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";

export const eventRoutes = new Elysia({ prefix: "/events" })
  .use(authGuard)

  .get("/", async ({ auth }) => {
    const a = requireDirector(auth);
    return ok({ events: await db.query.events.findMany({ where: eq(events.workspaceId, a.workspaceId), orderBy: [desc(events.eventDate)] }) });
  })

  .get("/:id", async ({ auth, params }) => {
    const a = requireDirector(auth);
    const ev = await db.query.events.findFirst({ where: and(eq(events.id, params.id), eq(events.workspaceId, a.workspaceId)) });
    if (!ev) throw Errors.NotFound("Evento não encontrado");
    const batches = await db.query.ticketBatches.findMany({ where: eq(ticketBatches.eventId, ev.id) });
    const lists = await db.query.guestLists.findMany({ where: eq(guestLists.eventId, ev.id) });
    const soldRows = await db.query.tickets.findMany({ where: eq(tickets.eventId, ev.id) });
    const sold = soldRows.length;
    const checkedIn = soldRows.filter((t) => t.status === "used").length;
    return ok({ event: ev, batches, lists, stats: { sold, checkedIn } });
  })

  .post("/", async ({ auth, body }) => {
    const a = requireModule(auth, "eventos");
    const [ev] = await db.insert(events).values({
      workspaceId: a.workspaceId, name: body.name, description: body.description,
      location: body.location, eventDate: body.eventDate ? new Date(body.eventDate) : null,
      capacity: body.capacity, costCenterId: body.costCenterId, status: (body.status ?? "draft") as any,
    }).returning();
    return ok({ event: ev }, "Evento criado");
  }, {
    body: t.Object({
      name: t.String(), description: t.Optional(t.String()), location: t.Optional(t.String()),
      eventDate: t.Optional(t.String()), capacity: t.Optional(t.Number()),
      costCenterId: t.Optional(t.String()), status: t.Optional(t.String()),
    }),
  })

  .patch("/:id", async ({ auth, params, body }) => {
    const a = requireModule(auth, "eventos");
    const [ev] = await db.update(events).set({
      name: body.name, description: body.description, location: body.location,
      eventDate: body.eventDate ? new Date(body.eventDate) : undefined,
      capacity: body.capacity, status: body.status as any,
    }).where(and(eq(events.id, params.id), eq(events.workspaceId, a.workspaceId))).returning();
    if (!ev) throw Errors.NotFound("Evento não encontrado");
    return ok({ event: ev });
  }, {
    body: t.Object({
      name: t.Optional(t.String()), description: t.Optional(t.String()), location: t.Optional(t.String()),
      eventDate: t.Optional(t.String()), capacity: t.Optional(t.Number()), status: t.Optional(t.String()),
    }),
  })

  /* ---- Lotes ---- */
  .post("/:id/batches", async ({ auth, params, body }) => {
    const a = requireModule(auth, "eventos");
    const ev = await db.query.events.findFirst({ where: and(eq(events.id, params.id), eq(events.workspaceId, a.workspaceId)) });
    if (!ev) throw Errors.NotFound("Evento não encontrado");
    const [b] = await db.insert(ticketBatches).values({
      workspaceId: a.workspaceId, eventId: ev.id, name: body.name, priceCents: body.priceCents, quantityTotal: body.quantityTotal ?? 0,
    }).returning();
    return ok({ batch: b }, "Lote criado");
  }, { body: t.Object({ name: t.String(), priceCents: t.Number(), quantityTotal: t.Optional(t.Number()) }) })

  /* ---- Ingressos (emitir; pending até pagamento) ---- */
  .get("/:id/tickets", async ({ auth, params }) => {
    const a = requireDirector(auth);
    return ok({ tickets: await db.query.tickets.findMany({ where: and(eq(tickets.eventId, params.id), eq(tickets.workspaceId, a.workspaceId)) }) });
  })
  .post("/:id/tickets", async ({ auth, params, body }) => {
    const a = requireModule(auth, "eventos");
    const b = await db.query.ticketBatches.findFirst({ where: and(eq(ticketBatches.id, body.batchId), eq(ticketBatches.eventId, params.id)) });
    if (!b) throw Errors.NotFound("Lote não encontrado");
    const [tk] = await db.insert(tickets).values({
      workspaceId: a.workspaceId, eventId: params.id, batchId: b.id,
      buyerName: body.buyerName, buyerEmail: body.buyerEmail, buyerMemberId: body.buyerMemberId,
      priceCents: b.priceCents, status: "valid", paymentStatus: (body.paid ? "paid" : "pending") as any,
    }).returning();
    await db.update(ticketBatches).set({ quantitySold: b.quantitySold + 1 }).where(eq(ticketBatches.id, b.id));
    if (body.paid) {
      await db.insert(transactions).values({ workspaceId: a.workspaceId, description: `Ingresso — ${b.name}`, amountCents: b.priceCents, type: "income", date: new Date().toISOString().slice(0, 10), status: "paid", paidAt: new Date(), eventId: params.id, createdBy: a.sub });
    }
    return ok({ ticket: tk }, "Ingresso emitido");
  }, { body: t.Object({ batchId: t.String(), buyerName: t.Optional(t.String()), buyerEmail: t.Optional(t.String()), buyerMemberId: t.Optional(t.String()), paid: t.Optional(t.Boolean()) }) })

  /* ---- Prestação de contas ---- */
  .get("/:id/settlement", async ({ auth, params }) => {
    const a = requireDirector(auth);
    const txs = await db.query.transactions.findMany({ where: and(eq(transactions.workspaceId, a.workspaceId), eq(transactions.eventId, params.id)) });
    let income = 0, expense = 0;
    for (const t of txs) t.type === "income" ? (income += t.amountCents) : (expense += t.amountCents);
    return ok({ income, expense, result: income - expense, entries: txs });
  });

/* ---- Check-in por QR do ingresso ---- */
export const checkinRoutes = new Elysia({ prefix: "/tickets" })
  .use(authGuard)
  .post("/:uuid/checkin", async ({ auth, params }) => {
    const a = requireModule(auth, "eventos");
    const tk = await db.query.tickets.findFirst({ where: and(eq(tickets.qrUuid, params.uuid), eq(tickets.workspaceId, a.workspaceId)) });
    if (!tk) throw Errors.NotFound("Ingresso inválido");
    if (tk.status === "used") throw Errors.Conflict("Ingresso já utilizado");
    if (tk.status === "cancelled") throw Errors.BadRequest("Ingresso cancelado");
    const [updated] = await db.update(tickets).set({ status: "used", checkedInAt: new Date(), checkedInBy: a.sub }).where(eq(tickets.id, tk.id)).returning();
    return ok({ ticket: updated }, "Check-in confirmado");
  });

/* ---- Listas (promoter) ---- */
export const guestListRoutes = new Elysia({ prefix: "/events" })
  .use(authGuard)
  .post("/:id/lists", async ({ auth, params, body }) => {
    const a = requireModule(auth, "eventos");
    const [l] = await db.insert(guestLists).values({ workspaceId: a.workspaceId, eventId: params.id, name: body.name, promoterName: body.promoterName }).returning();
    return ok({ list: l }, "Lista criada");
  }, { body: t.Object({ name: t.String(), promoterName: t.Optional(t.String()) }) })
  .post("/lists/:listId/entries", async ({ auth, params, body }) => {
    requireModule(auth, "eventos");
    const [e] = await db.insert(guestListEntries).values({ listId: params.listId, guestName: body.guestName, guestCpf: body.guestCpf }).returning();
    return ok({ entry: e }, "Convidado adicionado");
  }, { body: t.Object({ guestName: t.String(), guestCpf: t.Optional(t.String()) }) });
