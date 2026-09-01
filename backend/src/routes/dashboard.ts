import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { members, transactions, events, memberPayments, costCenters } from "../db/schema.ts";
import { authGuard, requireDirector } from "../middlewares/auth.ts";
import { ok } from "../utils/response.ts";

export const dashboardRoutes = new Elysia({ prefix: "/dashboard" })
  .use(authGuard)
  .get("/", async ({ auth }) => {
    const a = requireDirector(auth);
    const ws = a.workspaceId;

    const allMembers = await db.query.members.findMany({ where: eq(members.workspaceId, ws) });
    const byStatus = { active: 0, overdue: 0, expired: 0, pending: 0, cancelled: 0 };
    for (const m of allMembers) (byStatus as any)[m.status]++;

    const txs = await db.query.transactions.findMany({ where: eq(transactions.workspaceId, ws) });
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let monthIncome = 0, balance = 0;
    const bySource: Record<string, number> = {};
    for (const t of txs) {
      const sign = t.type === "income" ? 1 : -1;
      if (t.status === "paid") balance += sign * t.amountCents;
      if (t.type === "income" && t.date.startsWith(monthKey)) monthIncome += t.amountCents;
    }

    // Fontes de receita (por centro de custo) + série 6 meses
    for (const t of txs) {
      if (t.type === "income" && t.status === "paid") {
        const key = t.costCenterId ?? "outros";
        bySource[key] = (bySource[key] ?? 0) + t.amountCents;
      }
    }
    const centers = await db.query.costCenters.findMany({ where: eq(costCenters.workspaceId, ws) });
    const centerName = (id: string) => centers.find(c => c.id === id)?.name ?? "Outros";
    const totalIncome = Object.values(bySource).reduce((s, v) => s + v, 0) || 1;
    const sources = Object.entries(bySource)
      .map(([id, v]) => ({ label: centerName(id), cents: v, pct: Math.round((v / totalIncome) * 100) }))
      .sort((a, b) => b.cents - a.cents).slice(0, 4);

    const months: { key: string; label: string; income: number; expense: number }[] = [];
    const labels = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: labels[d.getMonth()], income: 0, expense: 0 });
    }
    for (const t of txs) {
      if (t.status !== "paid") continue;
      const m = months.find(x => t.date.startsWith(x.key));
      if (m) (t.type === "income" ? (m.income += t.amountCents) : (m.expense += t.amountCents));
    }

    const openPayments = await db.query.memberPayments.findMany({ where: eq(memberPayments.workspaceId, ws) });
    const overdueAmount = openPayments.filter(p => p.status !== "paid").reduce((s, p) => s + p.amountCents, 0);

    const upcoming = await db.query.events.findMany({ where: eq(events.workspaceId, ws), limit: 5 });

    return ok({
      kpis: {
        activeMembers: byStatus.active,
        overdueMembers: byStatus.overdue,
        monthIncomeCents: monthIncome,
        balanceCents: balance,
        overdueAmountCents: overdueAmount,
      },
      membersByStatus: byStatus,
      revenueByMonth: months,
      revenueBySources: sources,
      upcomingEvents: upcoming,
    });
  });
