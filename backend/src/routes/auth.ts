import { Elysia, t } from "elysia";
import { ok } from "../utils/response.ts";
import { loginDirector, loginMember, rotateRefresh, revokeRefresh, registerAtletica, registerMember, registerAccount, loginAccount, unlockDirector, setDirectorPin, verifyEmail, resendVerification, forgotPassword, resetPassword } from "../services/auth.service.ts";
import { onlyDigits, isValidCPF } from "../utils/validators.ts";
import { Errors } from "../utils/response.ts";
import { rateLimit, ipOf } from "../middlewares/rate-limit.ts";
import { authGuard, requireAccount } from "../middlewares/auth.ts";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authGuard)

  // ── Conta unificada (login por e-mail) ──
  .post("/register", async ({ body, headers, server, request }) => {
    const ip = ipOf(server, request);
    await rateLimit(`register:${ip}`, 8, 3600);
    const ctx = { userAgent: headers["user-agent"], ip };
    return ok(await registerAccount(body, ctx), "Conta criada");
  }, {
    body: t.Object({ slug: t.String(), name: t.String(), email: t.String(), password: t.String(), phone: t.Optional(t.String()) }),
  })

  .post("/login", async ({ body, headers, server, request }) => {
    const ip = ipOf(server, request);
    await rateLimit(`login:${ip}`, 12, 60);
    const ctx = { userAgent: headers["user-agent"], ip };
    return ok(await loginAccount(body.email, body.password, body.slug, ctx));
  }, {
    body: t.Object({ email: t.String(), password: t.String(), slug: t.String() }),
  })

  // Destrava o painel da diretoria com o PIN (precisa estar logado na conta)
  .post("/director/unlock", async ({ auth, body, headers, server, request }) => {
    const a = requireAccount(auth);
    const ip = ipOf(server, request);
    await rateLimit(`pin:${a.accountId}`, 6, 300);
    const ctx = { userAgent: headers["user-agent"], ip };
    return ok(await unlockDirector(a, body.pin, ctx), "Painel liberado");
  }, {
    body: t.Object({ pin: t.String() }),
  })

  // Diretor define/reseta o próprio PIN
  .post("/director/pin", async ({ auth, body }) => {
    const a = requireAccount(auth);
    if (!a.directorId) throw Errors.Forbidden("Sua conta não é da diretoria");
    return ok(await setDirectorPin(a.directorId, a.workspaceId, body.pin), "PIN salvo");
  }, {
    body: t.Object({ pin: t.String() }),
  })

  // ── Verificação de e-mail (conta logada) ──
  .post("/verify-email", async ({ auth, body }) => {
    const a = requireAccount(auth);
    return ok(await verifyEmail(a.accountId!, body.code), "E-mail verificado");
  }, { body: t.Object({ code: t.String() }) })

  .post("/resend-verification", async ({ auth, server, request }) => {
    const a = requireAccount(auth);
    await rateLimit(`verif:${a.accountId}`, 4, 600);
    return ok(await resendVerification(a.accountId!), "Código reenviado");
  })

  // ── Esqueci / redefinir senha (público) ──
  .post("/forgot-password", async ({ body, server, request }) => {
    await rateLimit(`forgot:${ipOf(server, request)}`, 6, 600);
    return ok(await forgotPassword(body.email, body.slug), "Se o e-mail existir, enviamos um código");
  }, { body: t.Object({ email: t.String(), slug: t.String() }) })

  .post("/reset-password", async ({ body, server, request }) => {
    await rateLimit(`reset:${ipOf(server, request)}`, 8, 600);
    return ok(await resetPassword(body.email, body.slug, body.code, body.password), "Senha redefinida");
  }, { body: t.Object({ email: t.String(), slug: t.String(), code: t.String(), password: t.String() }) })
  .post("/director/login", async ({ body, headers, server, request }) => {
    const ip = ipOf(server, request);
    await rateLimit(`login:${ip}`, 12, 60);
    const ctx = { userAgent: headers["user-agent"], ip };
    return ok(await loginDirector(body.email, body.password, body.slug, ctx));
  }, {
    body: t.Object({ email: t.String(), password: t.String(), slug: t.String() }),
  })

  .post("/member/login", async ({ body, headers, server, request }) => {
    const ip = ipOf(server, request);
    await rateLimit(`login:${ip}`, 12, 60);
    const cpf = onlyDigits(body.cpf);
    if (!isValidCPF(cpf)) throw Errors.BadRequest("CPF inválido");
    const ctx = { userAgent: headers["user-agent"], ip };
    return ok(await loginMember(cpf, body.password, body.slug, ctx));
  }, {
    body: t.Object({ cpf: t.String(), password: t.String(), slug: t.String() }),
  })

  .post("/refresh", async ({ body, headers, server, request }) => {
    const ctx = { userAgent: headers["user-agent"], ip: server?.requestIP(request)?.address };
    return ok(await rotateRefresh(body.refreshToken, ctx));
  }, {
    body: t.Object({ refreshToken: t.String() }),
  })

  .post("/logout", async ({ body }) => {
    await revokeRefresh(body.refreshToken);
    return ok({ loggedOut: true });
  }, {
    body: t.Object({ refreshToken: t.String() }),
  })

  // Onboarding: nova atlética + primeiro admin
  .post("/register-atletica", async ({ body, headers, server, request }) => {
    const ip = ipOf(server, request);
    await rateLimit(`register:${ip}`, 5, 3600);
    const ctx = { userAgent: headers["user-agent"], ip };
    return ok(await registerAtletica(body, ctx), "Atlética criada");
  }, {
    body: t.Object({ name: t.String(), slug: t.String(), university: t.Optional(t.String()), adminName: t.String(), adminEmail: t.String(), adminPassword: t.String() }),
  })

  // Auto-cadastro de sócio
  .post("/member/register", async ({ body, headers, server, request }) => {
    const ip = ipOf(server, request);
    await rateLimit(`register:${ip}`, 8, 3600);
    const cpf = onlyDigits(body.cpf);
    if (!isValidCPF(cpf)) throw Errors.BadRequest("CPF inválido");
    const ctx = { userAgent: headers["user-agent"], ip };
    return ok(await registerMember({ ...body, cpf }, ctx), "Cadastro realizado");
  }, {
    body: t.Object({ slug: t.String(), cpf: t.String(), name: t.String(), password: t.String(), email: t.Optional(t.String()), course: t.Optional(t.String()), registrationNumber: t.Optional(t.String()), phone: t.Optional(t.String()) }),
  });
