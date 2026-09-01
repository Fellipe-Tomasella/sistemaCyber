import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workspaces, type HomepageContent } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";

const DEFAULTS: HomepageContent = { carousel: [], board: [], gallery: [], contact: {} };

export const homepageRoutes = new Elysia({ prefix: "/homepage" })
  .use(authGuard)
  .get("/", async ({ auth }) => {
    const a = requireDirector(auth);
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, a.workspaceId) });
    if (!ws) throw Errors.NotFound("Atlética não encontrada");
    return ok({ homepage: { ...DEFAULTS, ...(ws.homepage || {}) } });
  })
  .patch("/", async ({ auth, body }) => {
    const a = requireModule(auth, "loja");
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, a.workspaceId) });
    if (!ws) throw Errors.NotFound("Atlética não encontrada");
    const next = { ...DEFAULTS, ...(ws.homepage || {}), ...(body.homepage as HomepageContent) };
    await db.update(workspaces).set({ homepage: next }).where(eq(workspaces.id, a.workspaceId));
    return ok({ homepage: next }, "Página inicial salva");
  }, {
    body: t.Object({ homepage: t.Any() }),
  });
