# AtléticaHub

Plataforma SaaS multi-tenant de gestão para **atléticas universitárias** — sócios, financeiro, eventos/festas e loja pública white-label. Produto independente da família Hyperdinamis (irmão do DynCash), com banco e deploy próprios.

## Status atual — MVP 100% (falta só deploy)
- ✅ **Design system** (direção "Arena": navy + ciano/azul, Anton + Inter, Phosphor).
- ✅ **Backend** (Bun + Elysia + Drizzle + Postgres) — todas as rotas do MVP, testadas end-to-end.
- ✅ **Frontend** — 22+ telas conectadas à API (diretoria + sócio + loja white-label).
- ✅ **Loja** com carrinho + checkout → pedido → confirmação → retirada.
- ✅ **Upload de imagens (MinIO)** — logo white-label e fotos de produto.
- ✅ **Rate-limit (Redis)** no login e cadastro.

## Rodar tudo localmente
```bash
# 1) infra (Docker Desktop aberto)
docker compose up -d postgres redis minio createbuckets

# 2) backend (API :3200)
cd backend && bun install && bun run db:push && bun run db:seed && bun run dev

# 3) frontend (outro terminal) — serve.py dá URLs limpas (sem .html) + 404 personalizado
cd web && python serve.py 4599
# abra http://localhost:4599/  → cai na loja da atlética
```

**Login demo:** diretoria `presidente@cyber.demo` / `Atletica@2026!` · sócio CPF `111.444.777-35` / `Socio@2026!` · slug `cyber`.

## Estrutura
```
web/
├── index.html            índice dev (links de todas as telas)
├── css/
│   ├── variables.css     design tokens (tema dark, cor de marca sobrescrivível)
│   └── main.css          componentes (rail, hero, kpi, tabela, pills, botões…)
├── js/
│   └── layout.js         rail/sidebar da diretoria + dados do workspace
├── assets/               brasão de exemplo (A.A.A.S.I. Cyber)
├── atletica/             painel da diretoria
│   ├── login.html        login split-screen
│   ├── dashboard.html    KPIs + gráficos + pendências + eventos
│   ├── socios.html       lista + painel de detalhe
│   ├── financeiro.html   caixa + DRE + centros de custo
│   └── retirada.html     modo portaria (QR / conferência de itens)
├── loja/
│   └── index.html        loja pública white-label (/{slug}) — desktop + mobile
└── socio/
    └── carteirinha.html  carteirinha digital do sócio (mobile)
```

## Telas ainda a construir (frontend)
Planos · Cobranças · Produtos · Pedidos · Eventos (detalhe + check-in) · Diretoria/Gestões · Loja-config (white-label) · Configurações · Login/Home/Pedidos do sócio.

## Próximos objetivos
1. Completar as telas restantes do frontend.
2. Scaffold do **backend** (Bun/Elysia/Drizzle/Postgres/Redis/MinIO) — portas 3200/8082/5434/6381/9200, banco `atletica_hub`.
3. Auth (diretoria por e-mail, sócio por CPF), schema multi-tenant, seed demo.
4. Conectar frontend à API.

Consulte `DESIGN-BRIEF.md` para a especificação de identidade e telas.
