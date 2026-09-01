/**
 * Em dev usamos `drizzle-kit push`. Este arquivo aplica migrations SQL
 * geradas em ./drizzle quando existirem (produção).
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.ts";

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✅ Migrations aplicadas");
} catch (e) {
  console.error("❌ Falha nas migrations:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
