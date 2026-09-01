# Deploy — AtléticaHub (Docker Swarm + GHCR + Traefik)

Fluxo: você faz **push no GitHub** → o **GitHub Actions** builda as imagens e publica no **GHCR** → a **VPS (Swarm)** puxa as imagens e sobe com **Traefik + HTTPS** automático.

---

## 1) Conectar ao GitHub (na sua máquina)

```bash
cd C:\atletica
git init
git add .
git commit -m "AtléticaHub — deploy inicial"
git branch -M main
git remote add origin https://github.com/OWNER/atletica.git   # crie o repo vazio antes
git push -u origin main
```

O push dispara o workflow `.github/workflows/deploy.yml`, que builda e publica:
`ghcr.io/OWNER/atletica-backend:latest` e `ghcr.io/OWNER/atletica-web:latest`.
> Em **Settings → Actions → General**, garanta "Read and write permissions" pro `GITHUB_TOKEN`.
> Em **Packages** (no perfil), você pode deixar as 2 imagens **públicas** (mais simples) — ou manter privadas e logar no GHCR na VPS (passo 4).

---

## 2) Provisionar a VPS (Hetzner)

1. Crie um servidor **Ubuntu 24.04** (CX22 já roda de boa — 2 vCPU / 4 GB).
2. Aponte no seu DNS um **registro A**: `atletica.seudominio.com.br → IP_DA_VPS` (o Traefik precisa disso pro certificado).
3. Acesse por SSH e instale o Docker + inicie o Swarm:

```bash
curl -fsSL https://get.docker.com | sh
docker swarm init --advertise-addr SEU_IP
```

---

## 3) Levar os arquivos de deploy pra VPS

```bash
mkdir -p /opt/atletica && cd /opt/atletica
git clone https://github.com/OWNER/atletica.git .
cp .env.prod.example .env.prod
nano .env.prod    # preencha DOMÍNIO, REGISTRY=ghcr.io/OWNER, senhas e segredos
```

Gere os segredos (rode 1x cada e cole no `.env.prod`):
```bash
openssl rand -hex 32   # JWT_SECRET, JWT_REFRESH_SECRET, DOCUMENT_HASH_PEPPER
openssl rand -hex 32   # AES_ENCRYPTION_KEY (precisa ter 64 hex chars)
```

---

## 4) (Se as imagens forem privadas) logar no GHCR na VPS

```bash
echo SEU_TOKEN_GITHUB | docker login ghcr.io -u OWNER --password-stdin
```
> Token = PAT do GitHub com escopo `read:packages`.

---

## 5) Subir a stack

```bash
cd /opt/atletica
set -a; source .env.prod; set +a
docker stack deploy -c docker-stack.yml atletica --with-registry-auth --resolve-image always
docker stack services atletica       # acompanhe até tudo com 1/1
```

### Primeira vez: criar o schema no banco
```bash
BE=$(docker ps --filter name=atletica_backend -q | head -1)
docker exec $BE bun run db:push          # cria as tabelas
```
Depois crie sua atlética real pelo onboarding (uma vez):
```bash
curl -s -X POST https://atletica.seudominio.com.br/api/v1/auth/register-atletica \
  -H "Content-Type: application/json" \
  -d '{"name":"A.A.A.S.I. Cyber","slug":"cyber","university":"UNEMAT Sinop","adminName":"SEU NOME","adminEmail":"presidente@suaatletica.com","adminPassword":"UMA_SENHA_FORTE"}'
```
> Pra tornar um e-mail super-admin (gestão de usuários), defina o `official_email` da atlética (via SQL no `atletica_workspaces` ou criando a conta com esse e-mail).

Acesse **https://atletica.seudominio.com.br** — o Traefik emite o certificado no primeiro acesso.

---

## 6) Deploy contínuo (opcional, automático)

Nos **Secrets do repositório** (Settings → Secrets → Actions) adicione:
`VPS_HOST` (IP), `VPS_USER` (ex.: root), `VPS_SSH_KEY` (chave privada com acesso à VPS).

A partir daí, todo `git push` na `main` builda **e** redeploya sozinho (job `deploy`).
Sem esses secrets, o deploy é manual: repita o passo 5 (`git pull` + `docker stack deploy`).

---

## Manutenção rápida
- Ver logs:        `docker service logs -f atletica_backend`
- Redeploy 1 svc:  `docker service update --image ghcr.io/OWNER/atletica-backend:latest atletica_backend --with-registry-auth`
- Backup do banco: `docker exec $(docker ps -qf name=atletica_postgres) pg_dump -U atletica atletica_hub > backup.sql`
