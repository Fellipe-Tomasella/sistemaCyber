import { Elysia, t } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { products, productVariants, priceTiers } from "../db/schema.ts";
import { authGuard, requireDirector, requireModule } from "../middlewares/auth.ts";
import { ok, Errors } from "../utils/response.ts";

export const productRoutes = new Elysia({ prefix: "/products" })
  .use(authGuard)

  .get("/", async ({ auth }) => {
    const a = requireDirector(auth);
    const rows = await db.query.products.findMany({ where: eq(products.workspaceId, a.workspaceId), orderBy: [desc(products.createdAt)] });
    return ok({ products: rows });
  })

  .get("/:id", async ({ auth, params }) => {
    const a = requireDirector(auth);
    const p = await db.query.products.findFirst({ where: and(eq(products.id, params.id), eq(products.workspaceId, a.workspaceId)) });
    if (!p) throw Errors.NotFound("Produto não encontrado");
    const variants = await db.query.productVariants.findMany({ where: eq(productVariants.productId, p.id) });
    const tiers = await db.query.priceTiers.findMany({ where: and(eq(priceTiers.workspaceId, a.workspaceId), eq(priceTiers.refType, "product"), eq(priceTiers.refId, p.id)) });
    return ok({ product: p, variants, priceTiers: tiers });
  })

  .post("/", async ({ auth, body }) => {
    const a = requireModule(auth, "produtos");
    const [p] = await db.insert(products).values({
      workspaceId: a.workspaceId, name: body.name, description: body.description,
      category: body.category, basePriceCents: body.basePriceCents,
      costCents: body.costCents ?? 0, shippingCents: body.shippingCents ?? 0,
      marginType: body.marginType ?? "percent", marginValue: body.marginValue ?? 0, feeBp: body.feeBp ?? 0,
      trackStock: body.trackStock ?? true, stockQuantity: body.stockQuantity ?? 0,
      active: body.active ?? true, imageKey: body.imageKey,
    }).returning();

    if (body.variants?.length) {
      await db.insert(productVariants).values(body.variants.map((v) => ({ productId: p.id, name: v.name, sku: v.sku, stockQuantity: v.stockQuantity ?? 0 })));
    }
    // Preço de sócio (tier) opcional
    if (body.memberPriceCents != null) {
      await db.insert(priceTiers).values({ workspaceId: a.workspaceId, refType: "product", refId: p.id, audience: "member", priceCents: body.memberPriceCents });
    }
    return ok({ product: p }, "Produto criado");
  }, {
    body: t.Object({
      name: t.String(), basePriceCents: t.Number(),
      description: t.Optional(t.String()), category: t.Optional(t.String()),
      costCents: t.Optional(t.Number()), shippingCents: t.Optional(t.Number()),
      marginType: t.Optional(t.String()), marginValue: t.Optional(t.Number()), feeBp: t.Optional(t.Number()),
      trackStock: t.Optional(t.Boolean()), stockQuantity: t.Optional(t.Number()), active: t.Optional(t.Boolean()),
      imageKey: t.Optional(t.String()), memberPriceCents: t.Optional(t.Number()),
      variants: t.Optional(t.Array(t.Object({ name: t.String(), sku: t.Optional(t.String()), stockQuantity: t.Optional(t.Number()) }))),
    }),
  })

  .patch("/:id", async ({ auth, params, body }) => {
    const a = requireModule(auth, "produtos");
    const set: Record<string, unknown> = {};
    for (const k of ["name","description","category","basePriceCents","costCents","shippingCents","marginType","marginValue","feeBp","trackStock","stockQuantity","active","imageKey"] as const) {
      if (body[k] !== undefined) set[k] = body[k];
    }
    const [p] = await db.update(products).set(set)
      .where(and(eq(products.id, params.id), eq(products.workspaceId, a.workspaceId))).returning();
    if (!p) throw Errors.NotFound("Produto não encontrado");
    return ok({ product: p });
  }, {
    body: t.Object({
      name: t.Optional(t.String()), description: t.Optional(t.String()), category: t.Optional(t.String()),
      basePriceCents: t.Optional(t.Number()), costCents: t.Optional(t.Number()), shippingCents: t.Optional(t.Number()),
      marginType: t.Optional(t.String()), marginValue: t.Optional(t.Number()), feeBp: t.Optional(t.Number()),
      trackStock: t.Optional(t.Boolean()), stockQuantity: t.Optional(t.Number()), active: t.Optional(t.Boolean()), imageKey: t.Optional(t.String()),
    }),
  })

  // Excluir produto
  .delete("/:id", async ({ auth, params }) => {
    const a = requireModule(auth, "produtos");
    const [p] = await db.delete(products).where(and(eq(products.id, params.id), eq(products.workspaceId, a.workspaceId))).returning();
    if (!p) throw Errors.NotFound("Produto não encontrado");
    return ok({ deleted: true }, "Produto excluído");
  })

  // Substitui a lista de variantes (tamanhos) do produto
  .put("/:id/variants", async ({ auth, params, body }) => {
    const a = requireModule(auth, "produtos");
    const p = await db.query.products.findFirst({ where: and(eq(products.id, params.id), eq(products.workspaceId, a.workspaceId)) });
    if (!p) throw Errors.NotFound("Produto não encontrado");
    await db.delete(productVariants).where(eq(productVariants.productId, p.id));
    if (body.variants.length) {
      await db.insert(productVariants).values(body.variants.map((v) => ({ productId: p.id, name: v.name, sku: v.sku, stockQuantity: v.stockQuantity ?? 0 })));
    }
    const variants = await db.query.productVariants.findMany({ where: eq(productVariants.productId, p.id) });
    return ok({ variants }, "Variantes salvas");
  }, { body: t.Object({ variants: t.Array(t.Object({ name: t.String(), sku: t.Optional(t.String()), stockQuantity: t.Optional(t.Number()) })) }) })

  // Define/atualiza preço por tipo (fã/sócio/atleta/diretor)
  .put("/:id/price-tier", async ({ auth, params, body }) => {
    const a = requireModule(auth, "produtos");
    const existing = await db.query.priceTiers.findFirst({
      where: and(eq(priceTiers.workspaceId, a.workspaceId), eq(priceTiers.refType, "product"), eq(priceTiers.refId, params.id), eq(priceTiers.audience, body.audience as any)),
    });
    if (existing) {
      await db.update(priceTiers).set({ priceCents: body.priceCents }).where(eq(priceTiers.id, existing.id));
    } else {
      await db.insert(priceTiers).values({ workspaceId: a.workspaceId, refType: "product", refId: params.id, audience: body.audience as any, priceCents: body.priceCents });
    }
    return ok({ ok: true }, "Preço por tipo salvo");
  }, { body: t.Object({ audience: t.String(), priceCents: t.Number() }) });
