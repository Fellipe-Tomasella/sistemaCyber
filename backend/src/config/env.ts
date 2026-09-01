/**
 * Validação de ambiente com Zod — falha cedo se algo faltar.
 */
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),

  // Segredos (openssl rand -hex ...)
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  AES_ENCRYPTION_KEY: z.string().length(64, "AES key deve ter 64 hex chars (32 bytes)"),
  DOCUMENT_HASH_PEPPER: z.string().min(32),

  // Tempo de vida
  ACCESS_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().default(7),

  // Workspace demo / seed
  SEED_ATLETICA_NAME: z.string().default("A.A.A.S.I. Cyber"),
  SEED_ATLETICA_SLUG: z.string().default("cyber"),
  SEED_ADMIN_EMAIL: z.string().email().default("presidente@cyber.demo"),
  SEED_ADMIN_PASSWORD: z.string().default("Atletica@2026!"),

  // Infra opcional (ainda não usada nas primeiras rotas)
  REDIS_URL: z.string().optional(),
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET: z.string().default("atletica-hub"),

  CORS_ORIGIN: z.string().default("*"),

  // E-mail (SMTP — Gmail com senha de app). Se faltar, o mailer só loga no console.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),   // ex.: "A.A.A.S.I. Cyber <cyberatletica@gmail.com>"
  APP_URL: z.string().optional(),     // base do site, p/ links (ex.: http://localhost:4599)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Variáveis de ambiente inválidas:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
