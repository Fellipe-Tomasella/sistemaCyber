/** Storage de objetos (MinIO / S3) via cliente nativo do Bun. */
import { S3Client } from "bun";
import { env } from "../config/env.ts";
import { randomToken } from "./crypto.ts";

const enabled = !!(env.MINIO_ENDPOINT && env.MINIO_ACCESS_KEY && env.MINIO_SECRET_KEY);

const client = enabled
  ? new S3Client({
      endpoint: env.MINIO_ENDPOINT!,
      accessKeyId: env.MINIO_ACCESS_KEY!,
      secretAccessKey: env.MINIO_SECRET_KEY!,
      bucket: env.MINIO_BUCKET,
      region: "us-east-1",
    })
  : null;

export const storageEnabled = enabled;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf",
};

/** Sobe um arquivo e retorna a chave. */
export async function putObject(workspaceId: string, prefix: string, file: File): Promise<string> {
  if (!client) throw new Error("Storage não configurado");
  const ext = EXT[file.type] || "bin";
  const key = `ws/${workspaceId}/${prefix}/${randomToken(12)}.${ext}`;
  await client.write(key, await file.arrayBuffer(), { type: file.type });
  return key;
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
};
function typeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  return MIME[ext] || "application/octet-stream";
}

/** Lê um objeto (para servir via backend). */
export async function getObject(key: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  if (!client) return null;
  const f = client.file(key);
  if (!(await f.exists())) return null;
  const t = f.type && f.type !== "application/octet-stream" ? f.type : typeFromKey(key);
  return { bytes: await f.arrayBuffer(), type: t };
}

export async function deleteObject(key: string): Promise<void> {
  if (!client) return;
  try { await client.delete(key); } catch { /* ignore */ }
}
