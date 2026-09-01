/** Seed demo — Atlética Cyber (A.A.A.S.I. Cyber). */
import { eq } from "drizzle-orm";
import { db, sql } from "./client.ts";
import {
  workspaces, managementTerms, directors, membershipPlans, members, memberships,
  memberPayments, costCenters, transactions, events, ticketBatches,
} from "./schema.ts";
import { env } from "../config/env.ts";
import { hashPassword, hashDocument, documentLookup, emailLookup } from "../utils/crypto.ts";
import { today, addMonths } from "../utils/dates.ts";

async function seed() {
  const existing = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, env.SEED_ATLETICA_SLUG) });
  if (existing) {
    console.log("ℹ️  Seed já aplicado (workspace existe). Abortando para não duplicar.");
    return;
  }

  const [ws] = await db.insert(workspaces).values({
    name: env.SEED_ATLETICA_NAME, slug: env.SEED_ATLETICA_SLUG,
    university: "UNEMAT Sinop", primaryColor: "#0077ff", accentColor: "#00bfff",
    currentSemester: "2026.2",
  }).returning();

  const [term] = await db.insert(managementTerms).values({
    workspaceId: ws.id, name: "Gestão 25/26", isCurrent: true,
    startDate: "2025-08-01", endDate: "2026-07-31",
  }).returning();

  const pw = await hashPassword(env.SEED_ADMIN_PASSWORD);
  await db.insert(directors).values([
    { workspaceId: ws.id, termId: term.id, name: "Rafael Moura", email: env.SEED_ADMIN_EMAIL, emailLookup: emailLookup(env.SEED_ADMIN_EMAIL), passwordHash: pw, role: "admin", cargoLabel: "Presidente" },
    { workspaceId: ws.id, termId: term.id, name: "Bianca Reis", email: "financeiro@cyber.demo", emailLookup: emailLookup("financeiro@cyber.demo"), passwordHash: pw, role: "finance", cargoLabel: "Diretora Financeira" },
    { workspaceId: ws.id, termId: term.id, name: "Léo Prado", email: "eventos@cyber.demo", emailLookup: emailLookup("eventos@cyber.demo"), passwordHash: pw, role: "events", cargoLabel: "Diretor de Eventos" },
  ]);

  const [semestral, anual] = await db.insert(membershipPlans).values([
    { workspaceId: ws.id, name: "Semestral", period: "semester", priceCents: 8900, durationMonths: 6, benefits: ["Ingresso no lote sócio", "Desconto na loja", "Carteirinha digital"] },
    { workspaceId: ws.id, name: "Anual", period: "annual", priceCents: 14900, durationMonths: 12, benefits: ["Tudo do semestral", "Prioridade em delegações", "Camiseta de boas-vindas"] },
  ]).returning();

  const demoMembers = [
    ["11144477735", "Marina Alves de Souza", "Sistemas de Informação", "active", semestral],
    ["22255588846", "Diego Ferraz Lima", "Sistemas de Informação", "active", anual],
    ["33366699957", "Bruna Kaori Tanaka", "Engenharia Florestal", "overdue", semestral],
    ["45566677788", "Otávio Menezes", "Sistemas de Informação", "overdue", semestral],
    ["56677788899", "Larissa Prado", "Agronomia", "active", anual],
  ] as const;

  let n = 148;
  for (const [cpf, name, course, status, plan] of demoMembers) {
    const [m] = await db.insert(members).values({
      workspaceId: ws.id, cpfHash: await hashDocument(cpf), cpfLookup: documentLookup(cpf),
      name, course, status: status as any, memberNumber: n++, memberSince: "2025-03-12",
      passwordHash: await hashPassword("Socio@2026!"),
    }).returning();
    const start = today(), end = addMonths(start, plan.durationMonths);
    const [ms] = await db.insert(memberships).values({
      workspaceId: ws.id, memberId: m.id, planId: plan.id, startDate: start, endDate: end,
      priceCents: plan.priceCents, status: status as any,
    }).returning();
    await db.insert(memberPayments).values({
      workspaceId: ws.id, membershipId: ms.id, memberId: m.id, amountCents: plan.priceCents,
      dueDate: status === "overdue" ? "2026-08-05" : end,
      status: status === "overdue" ? "overdue" : "paid",
      paidAt: status === "overdue" ? null : new Date(), method: "pix",
    });
  }

  const [ccEvento, ccLoja, ccEsporte, ccAdmin] = await db.insert(costCenters).values([
    { workspaceId: ws.id, name: "Cyber Night", color: "#00bfff", kind: "event" },
    { workspaceId: ws.id, name: "Loja", color: "#a78bfa", kind: "general" },
    { workspaceId: ws.id, name: "Interunemat", color: "#fbbf24", kind: "sport" },
    { workspaceId: ws.id, name: "Administrativo", color: "#8fa3bb", kind: "admin" },
  ]).returning();

  await db.insert(transactions).values([
    { workspaceId: ws.id, description: "Ingressos Cyber Night — 1º lote (48 un.)", amountCents: 120000, type: "income", date: "2026-08-21", costCenterId: ccEvento.id, status: "paid", paidAt: new Date() },
    { workspaceId: ws.id, description: "Locação de som e luz — Hangar 33", amountCents: 340000, type: "expense", date: "2026-08-20", costCenterId: ccEvento.id, status: "paid", paidAt: new Date() },
    { workspaceId: ws.id, description: "Mensalidades semestrais (14 sócios)", amountCents: 124600, type: "income", date: "2026-08-19", costCenterId: ccAdmin.id, status: "paid", paidAt: new Date() },
    { workspaceId: ws.id, description: "Kit Calourada — lote de camisetas", amountCents: 280000, type: "expense", date: "2026-08-18", costCenterId: ccLoja.id, status: "paid", paidAt: new Date() },
    { workspaceId: ws.id, description: "Patrocínio — Byte Tech Sinop", amountCents: 125000, type: "income", date: "2026-08-15", costCenterId: ccAdmin.id, status: "paid", paidAt: new Date() },
    { workspaceId: ws.id, description: "Ônibus delegação Interunemat", amountCents: 190000, type: "expense", date: "2026-08-16", costCenterId: ccEsporte.id, status: "paid", paidAt: new Date() },
  ]);

  const [ev] = await db.insert(events).values({
    workspaceId: ws.id, name: "Cyber Night — Open Bar", location: "Hangar 33 · Sinop",
    eventDate: new Date("2026-08-29T23:00:00Z"), status: "selling", costCenterId: ccEvento.id, capacity: 400,
  }).returning();
  await db.insert(ticketBatches).values([
    { workspaceId: ws.id, eventId: ev.id, name: "1º lote", priceCents: 4000, quantityTotal: 200, quantitySold: 188 },
    { workspaceId: ws.id, eventId: ev.id, name: "2º lote", priceCents: 5000, quantityTotal: 200, quantitySold: 100 },
  ]);

  console.log("✅ Seed concluído — atlética 'cyber'");
  console.log(`   Diretoria: ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}`);
  console.log(`   Sócio demo: CPF 111.444.777-35 / Socio@2026!`);
}

try {
  await seed();
} catch (e) {
  console.error("❌ Seed falhou:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
