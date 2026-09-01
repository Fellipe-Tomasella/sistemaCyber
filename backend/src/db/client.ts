import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.ts";
import * as schema from "./schema.ts";

export const sql = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
