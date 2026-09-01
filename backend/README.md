# AtléticaHub — Backend

Bun + Elysia + Drizzle ORM + PostgreSQL. Multi-tenant (workspace por atlética). Dois escopos de auth: **diretoria** (e-mail+senha) e **sócio** (CPF+senha), com JWT 15min + refresh 7d rotacionado.

## Rodar (com Docker)
```bash
# na raiz do projeto (C:\atletica) — precisa do Docker Desktop aberto
docker compose up -d postgres redis minio
cd backend
cp .env.example .env            # ajuste os segredos
bun install
bun run db:push                 # cria as tabelas (drizzle-kit push)
bun run db:seed                 # popula a atlética demo "cyber"
bun run dev                     # API em http://localhost:3200
```

Ou tudo em container:
```bash
docker compose up -d --build
docker compose exec backend bun run db:push
docker compose exec backend bun run db:seed
# web em http://localhost:8082  ·  API em http://localhost:3200
```

## Credenciais demo (após seed)
- **Diretoria (presidente):** `presidente@cyber.demo` / `Atletica@2026!` · slug `cyber`
- **Financeiro:** `financeiro@cyber.demo` · **Eventos:** `eventos@cyber.demo`
- **Sócio:** CPF `111.444.777-35` / `Socio@2026!` · slug `cyber`

## Endpoints (`/api/v1`)
| Método | Rota | Escopo |
|---|---|---|
| POST | `/auth/director/login` · `/auth/member/login` · `/auth/refresh` · `/auth/logout` | público |
| POST | `/auth/register-atletica` (onboarding) · `/auth/member/register` | público |
| GET/POST | `/store/:slug` · `/store/:slug/orders` (checkout → pedido pending) | público (loja) |
| GET | `/me` · `/me/card` (QR assinado) · `/me/payments` · `/me/orders` · `/me/tickets` | sócio |
| POST | `/me/renew` · `/me/events/:id/tickets` (reservar) | sócio |
| GET/PATCH | `/workspace` (branding white-label) | diretoria (admin) |
| GET/POST/PATCH | `/directors` · `/terms` (gestões) | diretoria (admin) |
| GET/POST | `/members` · GET `/members/:id` · POST `/members/:id/renew` | diretoria |
| GET/POST/PATCH | `/plans` | diretoria |
| GET/POST | `/member-payments` (cobranças) · POST `/member-payments/:id/pay` | diretoria |
| GET/POST/PATCH | `/products` · PUT `/products/:id/price-tier` (preço por tipo) | diretoria |
| GET/POST | `/orders` · GET `/orders/:id` · POST `/orders/:id/pay` · `/orders/:id/deliver` | diretoria |
| GET | `/pickup/lookup?q=` (QR/CPF/nº) · `/pickup/queue` (fila retirada) | diretoria |
| GET/POST/PATCH | `/events` · GET `/events/:id` · POST `/events/:id/batches` | diretoria |
| GET/POST | `/events/:id/tickets` · POST `/tickets/:uuid/checkin` · `/events/:id/lists` | diretoria |
| GET | `/events/:id/settlement` (prestação de contas) | diretoria |
| GET/POST | `/cost-centers` · `/transactions` · POST `/transactions/:id/pay` | diretoria |
| GET | `/dashboard` | diretoria |

Regra de receita: pagar pedido / cobrança / ingresso gera automaticamente uma `transaction` de receita → o Financeiro e a prestação de contas ficam consistentes sem lançamento manual.

## Portas
API `3200` · Postgres `5434` · Redis `6381` · MinIO `9200/9201` · Web `8082` · Banco `atletica_hub`.

## Segurança
CPF/CNPJ argon2id + pepper + coluna `_lookup` (HMAC) · senhas bcrypt 12r (`Bun.password`) · JWT HS256 · refresh SHA-256 rotacionado · QR (carteirinha/ingresso/pedido) assinado HMAC · `workspace_id` filtrado no handler via `auth.workspaceId`.

## Status
Rotas do MVP **completas e testadas end-to-end** (auth, workspace/diretoria/gestões, sócios, planos, cobranças, produtos, pedidos, retirada, eventos/ingressos/check-in, financeiro, dashboard, loja pública, portal do sócio).

Fora do MVP / próximos: upload de anexos e imagens no **MinIO**, rate-limit no Redis, e conectar o **frontend** à API (`web/js/api.js`).
