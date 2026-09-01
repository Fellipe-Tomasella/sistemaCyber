import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "./config/env.ts";
import { ApiError, fail, ok } from "./utils/response.ts";
import { authRoutes } from "./routes/auth.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import { memberRoutes } from "./routes/members.ts";
import { planRoutes } from "./routes/plans.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { productRoutes } from "./routes/products.ts";
import { orderRoutes, pickupRoutes } from "./routes/orders.ts";
import { eventRoutes, checkinRoutes, guestListRoutes } from "./routes/events.ts";
import { financeRoutes } from "./routes/finance.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { storeRoutes } from "./routes/store.ts";
import { meRoutes } from "./routes/me.ts";
import { uploadRoutes, fileRoutes } from "./routes/uploads.ts";
import { paymentSettingsRoutes } from "./routes/payment-settings.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { homepageRoutes } from "./routes/homepage.ts";
import { adminRoutes } from "./routes/admin.ts";
import { accountRoutes } from "./routes/account.ts";

const app = new Elysia()
  .use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",") }))
  .onError(({ error, set }) => {
    if (error instanceof ApiError) {
      set.status = error.status;
      return fail(error.message, error.code);
    }
    // Erros de validação do Elysia
    if ((error as any)?.code === "VALIDATION") {
      set.status = 400;
      return fail("Requisição inválida", "bad_request");
    }
    console.error("[erro]", error);
    set.status = 500;
    return fail("Erro interno", "internal");
  })
  .get("/health", () => ok({ status: "up", service: "atleticahub", ts: Date.now() }))
  .group("/api/v1", (app) =>
    app
      .use(authRoutes)
      .use(storeRoutes)      // público
      .use(fileRoutes)       // público (imagens)
      .use(webhookRoutes)    // público (gateways)
      .use(meRoutes)         // sócio (legado)
      .use(accountRoutes)    // conta unificada (compras)
      .use(uploadRoutes)     // diretoria
      .use(paymentSettingsRoutes)
      .use(homepageRoutes)
      .use(adminRoutes)      // super-admin (cargos + usuários)
      // diretoria
      .use(workspaceRoutes)
      .use(memberRoutes)
      .use(planRoutes)
      .use(paymentRoutes)
      .use(productRoutes)
      .use(orderRoutes)
      .use(pickupRoutes)
      .use(eventRoutes)
      .use(checkinRoutes)
      .use(guestListRoutes)
      .use(financeRoutes)
      .use(dashboardRoutes)
  )
  .listen(env.PORT);

console.log(`🏆 AtléticaHub API em http://localhost:${env.PORT}  (env: ${env.NODE_ENV})`);

export type App = typeof app;
