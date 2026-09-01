/**
 * Backfill idempotente: cria a tabela de CONTAS a partir dos diretores/sócios
 * já existentes, sem apagar dados demo (homepage, galeria etc.).
 *  - define o e-mail oficial (super-admin) da atlética cyber
 *  - cria conta do super-admin
 *  - cria conta pra cada diretor + PIN demo, liga directors.accountId
 *  - cria conta pra cada sócio (e-mail sintetizado se faltar), liga members.accountId
 */
import { and, eq } from "drizzle-orm";
import { db, sql } from "./client.ts";
import { workspaces, directors, members, accounts } from "./schema.ts";
import { env } from "../config/env.ts";
import { hashPassword, emailLookup } from "../utils/crypto.ts";

const OFFICIAL = "cyberatletica@gmail.com";
const SUPER_PW = "Cyber@2026!";
const MEM_PW = "Socio@2026!";
const DEMO_PIN = "2468";

async function ensureAccount(workspaceId: string, opts: { name: string; email: string; password: string; isSuperAdmin?: boolean }) {
  const email = opts.email.trim().toLowerCase();
  const lookup = emailLookup(email);
  const found = await db.query.accounts.findFirst({ where: and(eq(accounts.workspaceId, workspaceId), eq(accounts.emailLookup, lookup)) });
  if (found) return found;
  const [acc] = await db.insert(accounts).values({
    workspaceId, name: opts.name, email, emailLookup: lookup,
    passwordHash: await hashPassword(opts.password), isSuperAdmin: !!opts.isSuperAdmin,
  }).returning();
  return acc;
}

async function run() {
  const wss = await db.query.workspaces.findMany();
  for (const ws of wss) {
    // e-mail oficial + super-admin (por enquanto só na atlética demo 'cyber')
    let official = ws.officialEmail;
    if (!official && ws.slug === env.SEED_ATLETICA_SLUG) {
      await db.update(workspaces).set({ officialEmail: OFFICIAL }).where(eq(workspaces.id, ws.id));
      official = OFFICIAL;
    }
    if (official) await ensureAccount(ws.id, { name: "Cyber Atlética", email: official, password: SUPER_PW, isSuperAdmin: true });

    // diretores → conta + PIN
    const dirs = await db.query.directors.findMany({ where: eq(directors.workspaceId, ws.id) });
    for (const d of dirs) {
      if (d.accountId) continue;
      const acc = await ensureAccount(ws.id, { name: d.name, email: d.email, password: env.SEED_ADMIN_PASSWORD });
      const patch: any = { accountId: acc.id };
      if (!d.pinHash) { patch.pinHash = await hashPassword(DEMO_PIN); patch.pinSetAt = new Date(); }
      await db.update(directors).set(patch).where(eq(directors.id, d.id));
    }

    // sócios → conta (e-mail sintetizado se não houver)
    const mems = await db.query.members.findMany({ where: eq(members.workspaceId, ws.id) });
    const used = new Set<string>();
    for (const m of mems) {
      if (m.accountId) continue;
      let email = m.email?.trim().toLowerCase() || "";
      if (!email) {
        const base = m.name.trim().toLowerCase().split(/\s+/)[0].normalize("NFD").replace(/[^a-z0-9]/g, "") || "socio";
        let cand = `${base}@cyber.demo`, i = 1;
        while (used.has(cand)) cand = `${base}${++i}@cyber.demo`;
        email = cand;
      }
      used.add(email);
      const acc = await ensureAccount(ws.id, { name: m.name, email, password: MEM_PW });
      await db.update(members).set({ accountId: acc.id, email, emailLookup: emailLookup(email) }).where(eq(members.id, m.id));
    }
    console.log(`✔ ${ws.slug}: contas vinculadas (${dirs.length} diretor(es), ${mems.length} sócio(s))`);
  }
  console.log("\n✅ Backfill concluído.");
  console.log(`   Super-admin: ${OFFICIAL} / ${SUPER_PW}`);
  console.log(`   Diretor (ex.): ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD} · PIN ${DEMO_PIN}`);
  console.log(`   Sócio (ex.): marina@cyber.demo / ${MEM_PW}`);
}

try { await run(); } catch (e) { console.error("❌ backfill falhou:", e); process.exitCode = 1; } finally { await sql.end(); }
