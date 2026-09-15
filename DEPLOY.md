# Deploy — AtléticaHub (Portainer + Docker Swarm)

Fluxo: **push no GitHub** → GitHub Actions builda e publica no **Docker Hub** (`nacomberi/atletica-*`) → no **Portainer** você cola o `docker-stack.yml`, preenche as variáveis e sobe a stack. O HTTPS é do **Traefik que já roda na sua VPS** (rede `HDSwarmNet`, resolver `letsencryptresolver`).

> As imagens já foram publicadas 1x na mão, então dá pra subir a stack **agora**, mesmo antes do 1º build do CI.

---

## 1) DNS
No seu provedor de DNS, crie um **registro A**: `atletica.seudominio.com.br → IP_DA_VPS`.
(É o que o Traefik usa pra emitir o certificado HTTPS.)

---

## 2) (opcional) CI — build automático a cada push
Já feito: `.github/workflows/deploy.yml` builda backend+web e publica no Docker Hub.
Pra ligar, crie 2 secrets no repo (**Settings → Secrets and variables → Actions**):
- `DOCKERHUB_USERNAME` = `nacomberi`
- `DOCKERHUB_TOKEN` = Access Token (hub.docker.com → Account Settings → Security)

Deixe os repositórios de imagem **públicos** no Docker Hub (mais simples). Se forem privados, adicione o registry do Docker Hub no Portainer (**Registries**).

---

## 3) Subir a stack no Portainer

1. **Portainer → Stacks → Add stack** → nome `atletica` → **Web editor**.
2. Cole o conteúdo do **`docker-stack.yml`**.
3. Em **Environment variables → Add an environment variable**, adicione (valores em `.env.prod.example`):

| Variável | Valor |
|---|---|
| `DOMAIN` | atletica.seudominio.com.br |
| `POSTGRES_PASSWORD` | senha forte (sem `@ : /`) |
| `MINIO_PASSWORD` | senha forte |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` |
| `AES_ENCRYPTION_KEY` | `openssl rand -hex 32` (64 chars) |
| `DOCUMENT_HASH_PEPPER` | `openssl rand -hex 32` |
| `SMTP_HOST` | smtp.gmail.com |
| `SMTP_PORT` | 465 |
| `SMTP_USER` | cyberatletica@gmail.com |
| `SMTP_PASS` | senha de app do Gmail |
| `SMTP_FROM` | `A.A.A.S.I. Cyber <cyberatletica@gmail.com>` |

4. **Deploy the stack**. Acompanhe até os serviços ficarem `1/1` (o `createbuckets` fica `0/1` = normal, ele roda e sai).

> O **backend cria/atualiza as tabelas sozinho** no start (`db:push`), então **não precisa** rodar migração na mão.

---

## 4) Criar sua atlética (uma vez)
Depois que a stack subir e o HTTPS pegar, acesse **https://atletica.seudominio.com.br** e crie a atlética pelo onboarding — ou por 1 comando:

```bash
curl -s -X POST https://atletica.seudominio.com.br/api/v1/auth/register-atletica \
  -H "Content-Type: application/json" \
  -d '{"name":"A.A.A.S.I. Cyber","slug":"cyber","university":"UNEMAT Sinop","adminName":"SEU NOME","adminEmail":"presidente@suaatletica.com","adminPassword":"UMA_SENHA_FORTE"}'
```
> Super-admin (gestão de usuários/cargos): defina o `official_email` da atlética e crie a conta com esse e-mail.

---

## 5) Atualizar (deploy novo)
- Buildou imagem nova (push no git com os secrets, ou `docker build/push` na mão) → no Portainer, na stack, **Pull and redeploy** (ou **Update the stack**). O Swarm puxa a `:latest` e recria os serviços.

## Manutenção
- Logs: no Portainer, no serviço `atletica_backend` → **Logs**.
- Backup do banco: `docker exec $(docker ps -qf name=atletica_postgres) pg_dump -U atletica atletica_hub > backup.sql`
