/**
 * Backfill idempotente dos CARGOS (RBAC): cria o cargo de sistema "Presidência"
 * (acesso total) + cargos demo, e vincula os diretores existentes pelo enum legado.
 */
import { and, eq } from "drizzle-orm";
import { db, sql } from "./client.ts";
import { workspaces, directors, roles, MODULES } from "./schema.ts";

async function ensureRole(workspaceId: string, name: string, modules: string[], isSystem = false) {
  const found = await db.query.roles.findFirst({ where: and(eq(roles.workspaceId, workspaceId), eq(roles.name, name)) });
  if (found) return found;
  const [r] = await db.insert(roles).values({ workspaceId, name, modules, isSystem }).returning();
  return r;
}

async function run() {
  const wss = await db.query.workspaces.findMany();
  for (const ws of wss) {
    const pres = await ensureRole(ws.id, "Presidência", [...MODULES], true);
    const fin = await ensureRole(ws.id, "Diretoria Financeira", ["financeiro", "cobrancas", "socios", "planos", "pedidos", "produtos"]);
    const eve = await ensureRole(ws.id, "Diretoria de Eventos", ["eventos", "produtos", "pedidos", "loja"]);
    const map: Record<string, string | null> = { admin: pres.id, finance: fin.id, events: eve.id, viewer: null };

    const dirs = await db.query.directors.findMany({ where: eq(directors.workspaceId, ws.id) });
    let linked = 0;
    for (const d of dirs) {
      if (d.roleId) continue;
      const rid = Object.prototype.hasOwnProperty.call(map, d.role) ? map[d.role] : pres.id;
      await db.update(directors).set({ roleId: rid }).where(eq(directors.id, d.id));
      linked++;
    }
    console.log(`✔ ${ws.slug}: cargos ok (Presidência[sistema]/Financeira/Eventos) · ${linked} diretor(es) vinculados`);
  }
  console.log("\n✅ Backfill de cargos concluído.");
}

try { await run(); } catch (e) { console.error("❌ backfill-roles falhou:", e); process.exitCode = 1; } finally { await sql.end(); }
