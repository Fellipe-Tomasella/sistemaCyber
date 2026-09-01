import { Elysia, t } from "elysia";
import { authGuard, requireDirector } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";
import { putObject, getObject, storageEnabled } from "../utils/storage.ts";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX = 5 * 1024 * 1024; // 5MB

export const uploadRoutes = new Elysia()
  .use(authGuard)
  // Upload (diretoria) → retorna a chave + URL para exibir
  .post("/uploads", async ({ auth, body }) => {
    const a = requireDirector(auth);
    if (!storageEnabled) throw Errors.BadRequest("Storage não configurado (MinIO)");
    const file = body.file as File;
    if (!file) throw Errors.BadRequest("Arquivo ausente");
    if (!ALLOWED.includes(file.type)) throw Errors.BadRequest("Tipo não permitido (use JPG, PNG, WEBP, GIF ou PDF)");
    if (file.size > MAX) throw Errors.BadRequest("Arquivo maior que 5MB");
    const prefix = (body.prefix || "misc").replace(/[^a-z0-9-]/gi, "");
    const key = await putObject(a.workspaceId, prefix, file);
    return ok({ key, url: `/api/v1/files/${key}` });
  }, {
    body: t.Object({ file: t.File(), prefix: t.Optional(t.String()) }),
  });

// Servir arquivos (público — imagens em <img>). Chave aleatória e imprevisível.
export const fileRoutes = new Elysia()
  .get("/files/*", async ({ params, set }) => {
    const key = (params as any)["*"];
    const obj = await getObject(key);
    if (!obj) { set.status = 404; return "not found"; }
    set.headers["content-type"] = obj.type;
    set.headers["cache-control"] = "public, max-age=86400";
    return new Response(obj.bytes, { headers: { "content-type": obj.type, "cache-control": "public, max-age=86400" } });
  });
