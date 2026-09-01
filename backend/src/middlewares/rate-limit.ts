/**
 * Rate limit por janela fixa. Usa Redis se REDIS_URL estiver setado e acessível;
 * senão cai para um contador em memória (single-instance).
 */
import { RedisClient } from "bun";
import { env } from "../config/env.ts";
import { ApiError, Errors } from "../utils/response.ts";

let redis: RedisClient | null = null;
if (env.REDIS_URL) {
  try { redis = new RedisClient(env.REDIS_URL); } catch { redis = null; }
}

const mem = new Map<string, { count: number; reset: number }>();

/** Lança 429 se exceder `limit` requisições em `windowSec`. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const rkey = `rl:${key}`;
  if (redis) {
    try {
      const n = await redis.incr(rkey);
      if (n === 1) await redis.expire(rkey, windowSec);
      if (n > limit) throw Errors.TooMany();
      return;
    } catch (e) {
      if (e instanceof ApiError) throw e;      // é o 429 — propaga
      // Redis indisponível → usa memória
    }
  }
  const now = Date.now();
  const rec = mem.get(key);
  if (!rec || rec.reset < now) { mem.set(key, { count: 1, reset: now + windowSec * 1000 }); return; }
  rec.count++;
  if (rec.count > limit) throw Errors.TooMany();
}

/** Chave de IP a partir do contexto Elysia. */
export function ipOf(server: any, request: Request): string {
  return server?.requestIP?.(request)?.address || "unknown";
}
