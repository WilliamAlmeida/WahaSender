# WahaSender

Plataforma **SaaS** de disparo humanizado de mensagens WhatsApp via [WAHA](https://waha.devlike.pro/) — multi-tenant, com fila distribuída, planos de quota mensal, cobrança via **Mercado Pago** e autoatendimento completo para o mercado brasileiro.

> **v3.0**: SaaS completo — cadastro self-service, planos (Free/Starter/Pro/Business), quotas mensais com medição de uso, cobrança Mercado Pago (PreApproval + MOCK), e-mail transacional, verificação de e-mail, redefinição de senha, painel de administração de plataforma, LGPD (export + exclusão de dados), landing page pública com pricing. Veja [CHANGELOG.md](CHANGELOG.md).

> **v2.1**: hardening de segurança (política de senha, JWT `jti` blocklist, HMAC no webhook), multi-sessão WAHA com circuit breaker, soft-delete + audit log, templates, API tokens, webhooks outbound assinados, importação CSV, observabilidade.

## Sumário

- [Planos e Quotas](#planos-e-quotas)
- [Cobrança (Mercado Pago)](#cobrança-mercado-pago)
- [E-mail transacional](#e-mail-transacional)
- [LGPD](#lgpd-portabilidade-e-exclusão-de-dados)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Início rápido (Docker)](#início-rápido-docker)
- [Início rápido (local)](#início-rápido-local)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Fluxo de cadastro self-service](#fluxo-de-cadastro-self-service)
- [Webhook WAHA](#webhook-waha)
- [Testes](#testes)
- [Estrutura](#estrutura)
- [Segurança](#notas-de-segurança-owasp)

## Planos e Quotas

| Plano    | Preço/mês | Mensagens/mês | Contatos  | Sessões | Campanhas |
| -------- | --------- | ------------- | --------- | ------- | --------- |
| Free     | R$ 0      | 100           | 500       | 1       | 3         |
| Starter  | R$ 49     | 2.000         | 5.000     | 2       | 10        |
| Pro      | R$ 99     | 10.000        | 50.000    | 5       | 50        |
| Business | R$ 199    | 50.000        | ilimitado | ilimitado | ilimitado |

- A quota de mensagens é contada por **mês calendário** e reinicia no 1º de cada mês.
- Ao atingir a quota, campanhas são bloqueadas com HTTP 402 (`quota_exceeded`). O worker também detecta a quota esgotada e pausa a campanha automaticamente.
- Administradores da plataforma têm acesso irrestrito.

Os planos são configuráveis via `PUT /api/admin/plans/:id` sem necessidade de redeploy.

## Cobrança (Mercado Pago)

O sistema usa o **SDK oficial do Mercado Pago** (`mercadopago@3`):

- **Cartão de crédito**: PreApproval (assinaturas recorrentes automáticas).
- **Pix / boleto**: cobrança avulsa gerada a cada ciclo.
- O webhook `POST /api/billing/webhook/mercadopago` processa eventos de pagamento e assinatura com **idempotência** (tabela `billing_events`, UNIQUE por `externalId`).

### Modo MOCK (sem credenciais)

Sem `MP_ACCESS_TOKEN`, o checkout ativa o plano localmente de imediato — ideal para desenvolvimento e testes sem conta MP.

```bash
# .env para MOCK
# MP_ACCESS_TOKEN=   (deixe em branco ou omita)
```

### Produção / Sandbox

```bash
# Credenciais de sandbox (https://www.mercadopago.com.br/developers)
MP_ACCESS_TOKEN=TEST-xxxx
MP_PUBLIC_KEY=TEST-xxxx
MP_WEBHOOK_SECRET=seu-segredo-do-webhook
```

Configure o webhook no painel MP apontando para `{APP_PUBLIC_URL}/api/billing/webhook/mercadopago`.

## E-mail transacional

Usado para verificação de e-mail, redefinição de senha e notificações de cobrança.

Configure qualquer provedor SMTP:

```bash
MAIL_HOST=smtp.resend.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USER=resend
MAIL_PASSWORD=re_xxxx
MAIL_FROM="WahaSender <no-reply@seudominio.com>"
```

Sem `MAIL_HOST`, os e-mails são **logados no console** (modo dev). Nenhum e-mail real é enviado — ideal para testes locais.

## LGPD: Portabilidade e Exclusão de Dados

- `GET /api/account/export` — exporta todos os dados do tenant em JSON.
- `POST /api/account/delete` — anonimiza e exclui todos os dados do tenant (requer `{ "confirm": "EXCLUIR" }`). Operação registrada em `audit_log`.

## Arquitetura

```
┌──────────────┐     ┌────────────┐     ┌────────────┐
│  Frontend    │ ──► │   API      │ ──► │ Postgres / │
│  (React/Vite)│     │ (Express)  │     │  SQLite    │
└──────────────┘     └─────┬──────┘     └────────────┘
                           │
                           ▼
                     ┌──────────┐         ┌──────────┐
                     │  Redis   │ ◄─────► │  Worker  │ ──► WAHA
                     │ (BullMQ) │         │  (Node)  │
                     └──────────┘         └──────────┘
```

- **web** (`server.ts`): API REST + serve o frontend; nunca dispara mensagens diretamente.
- **worker** (`worker.ts`): consome a fila `campaign-messages`, chama WAHA, atualiza status e re-enfileira o próximo contato com delay humanizado. Roda também a fila `campaign-scheduler` que ativa campanhas agendadas e recupera campanhas órfãs.
- **Redis**: backend da fila (BullMQ).
- **Postgres** (produção) ou **SQLite** (dev/teste): metadados, contatos, campanhas, logs.

Cada usuário só enxerga e manipula os próprios dados. Uploads ficam em `storage/uploads/{userId}/...` ou em S3 (`STORAGE_TYPE=s3`).

## Stack

| Camada     | Tecnologia                                          |
| ---------- | --------------------------------------------------- |
| Frontend   | React 19, Vite, Tailwind 4, React Router 7          |
| Backend    | Node 20, Express, TypeScript, Knex                  |
| Fila       | BullMQ + Redis 7                                    |
| Banco      | Postgres 16 (prod) / SQLite (dev)                   |
| Auth       | JWT em cookie httpOnly (+ Bearer opcional), bcrypt  |
| Logs       | pino + pino-http                                    |
| Validação  | zod                                                 |
| Storage    | Local FS ou S3 (`@aws-sdk/lib-storage`)             |
| Testes     | Vitest                                              |
| Container  | Docker multi-stage, docker-compose                  |

## Início rápido (Docker)

Pré-requisitos: Docker + Docker Compose.

```bash
cp .env.example .env
# Edite .env e defina pelo menos JWT_SECRET (>= 16 chars, sem prefixo "change-me" em produção)
docker compose up -d --build
```

Acesse `http://localhost:3000` e crie o primeiro administrador.

```bash
docker compose logs -f app worker
```

## Início rápido (local)

Pré-requisitos: Node 20+, Redis na porta 6379 (`docker run -p 6379:6379 redis:7-alpine`).

```bash
npm install
cp .env.example .env  # ajuste JWT_SECRET
npm run dev           # web (porta 3000)
npm run dev:worker    # em outro terminal
```

> Sem Redis o worker não inicia, mas a API ainda sobe — útil para desenvolver UI.

Build de produção:

```bash
npm run build
npm start            # web
npm run start:worker # worker
```

## Variáveis de ambiente

Veja `.env.example` para a lista completa. As mais importantes:

| Variável             | Descrição                                                 | Default                 |
| -------------------- | --------------------------------------------------------- | ----------------------- |
| `NODE_ENV`           | `development` \| `production` \| `test`                   | `development`           |
| `PORT`               | Porta HTTP da API                                         | `3000`                  |
| `APP_URL`            | URL pública (usada pelo CORS)                             | `http://localhost:3000` |
| `DB_CLIENT`          | `sqlite3` ou `pg`                                         | `sqlite3`               |
| `REDIS_HOST/PORT`    | Conexão Redis                                             | `localhost:6379`        |
| `WORKER_CONCURRENCY` | Jobs simultâneos no worker                                | `10`                    |
| `JWT_SECRET`         | Segredo do JWT — **obrigatório em produção**              | —                       |
| `COOKIE_SECURE`      | `true` se servido sob HTTPS                               | `false`                 |
| `STORAGE_TYPE`       | `local` ou `s3`                                           | `local`                 |
| `UPLOAD_MAX_BYTES`   | Tamanho máximo por upload                                 | `26214400` (25 MB)      |
| `WAHA_WEBHOOK_SECRET`| Header `X-Webhook-Secret` exigido em `/api/waha/webhook`  | —                       |
| `WAHA_WEBHOOK_HMAC`  | Verifica HMAC-SHA256 do payload (`X-Hub-Signature-256`)   | `false`                 |
| `TRUST_PROXY`        | `loopback`, `true` ou número de hops                      | `loopback`              |
| `PASSWORD_MIN_LENGTH`| Tamanho mínimo da senha                                   | `10`                    |
| `PASSWORD_REQUIRE_COMPLEXITY` | Exige maiúscula/minúscula/dígito/símbolo          | `true`                  |
| `CIRCUIT_BREAKER_*`  | Threshold / window / cooldown por sessão WAHA             | 5 / 300 s / 900 s       |
| `METRICS_ENABLED`    | Expor `/api/metrics` (Prometheus, somente admin)          | `true`                  |
| `BULL_BOARD_ENABLED` | UI da fila em `/admin/queues` (somente admin)             | `true`                  |
| `DB_FILE`            | Caminho do sqlite (só quando `DB_CLIENT=sqlite3`)         | `./storage/database.sqlite` |
| `APP_PUBLIC_URL`     | URL base para links em e-mails e retorno do checkout      | `http://localhost:3000` |
| `ENABLE_SIGNUP`      | Habilita cadastro self-service público                    | `true`                  |
| `REQUIRE_EMAIL_VERIFICATION` | Bloqueia envios até e-mail verificado           | `false`                 |
| `MAIL_HOST`          | Host SMTP (vazio → loga no console)                       | —                       |
| `MAIL_PORT`          | Porta SMTP                                                | `587`                   |
| `MAIL_USER/PASSWORD` | Credenciais SMTP                                          | —                       |
| `MAIL_FROM`          | Endereço remetente                                        | `WahaSender <no-reply@…>` |
| `MP_ACCESS_TOKEN`    | Token de acesso Mercado Pago (vazio → MOCK mode)          | —                       |
| `MP_PUBLIC_KEY`      | Chave pública MP (frontend checkout)                      | —                       |
| `MP_WEBHOOK_SECRET`  | Segredo para verificação de assinatura do webhook MP      | —                       |

**Docker / K8s secrets:** qualquer variável pode ser carregada de arquivo usando o sufixo `_FROM_FILE`. Ex.: `JWT_SECRET_FROM_FILE=/run/secrets/jwt_secret`.

## Fluxo de cadastro self-service

1. Sobe a aplicação (web + worker + redis + postgres).
2. Acessa `http://localhost:3000`. Se não houver usuários, exibe tela de criação do primeiro administrador (dono da plataforma); o admin é criado com e-mail já verificado.
3. A partir daí, qualquer pessoa pode se cadastrar em `/cadastro` (enquanto `ENABLE_SIGNUP=true`). O novo usuário recebe o **plano Free** automaticamente e um e-mail de verificação (se configurado).
4. Com `REQUIRE_EMAIL_VERIFICATION=true`, o envio de mensagens é bloqueado até a verificação.

### Redefinição de senha

Acesse `/esqueci-senha` → receba link por e-mail → `/redefinir-senha?token=...` → nova senha aplicada.

### Admin de plataforma

Acesse `/admin` (somente usuários com `role=admin`):

- Visão de MRR, usuários ativos, mensagens enviadas no mês.
- Listar/suspender/reativar tenants.
- Alterar plano de qualquer tenant manualmente.
- Configurar planos (preço, quotas, limites).

### Migração do usuário legado (v1 → v2)

No primeiro boot após atualizar do v1, um registro `legacy@local` é criado com `claimable=true`. O primeiro cadastro que usar este e-mail assume todos os dados legados de forma atômica. Para recuperar uma instalação sem acesso, use a CLI:

```bash
npm run admin -- reset-password legacy@local "NovaSenhaForte!1"
# ou para promover alguém a admin:
npm run admin -- set-role user@example.com admin
```

## Tokens de API (M2M)

Gere em **Settings → API Tokens** (UI) ou via `POST /api/api-tokens`. O token aparece **uma única vez** com o prefixo `wks_...`. Use em qualquer endpoint `/api/*` (exceto auth) através de:

```
Authorization: ApiKey wks_xxxxxxxxxxxxxxxxx
# ou
X-Api-Token: wks_xxxxxxxxxxxxxxxxx
```

Tokens podem ser revogados a qualquer momento (`DELETE /api/api-tokens/:id`).

## Webhook WAHA

Aponte o webhook da sua instância WAHA para:

```
POST {APP_URL}/api/waha/webhook
Header: X-Webhook-Secret: <WAHA_WEBHOOK_SECRET>
Body: payload padrão do WAHA (event=message.ack, payload.id, payload.ack)
```

Quando `WAHA_WEBHOOK_HMAC=true`, o mesmo `WAHA_WEBHOOK_SECRET` é usado como chave HMAC-SHA256 e o header `X-Hub-Signature-256: sha256=<hex>` (ou `X-Webhook-Hmac-SHA256`) é verificado de forma timing-safe.

## Webhooks outbound

Cadastre URLs externas em **Settings → Webhooks** ou via `POST /api/outbound-webhooks` para receber eventos: `campaign.started`, `campaign.completed`, `campaign.paused`, `message.sent`, `message.failed`. Cada envio inclui `X-Hub-Signature-256: sha256=<hex>` calculado com o secret do webhook.

## Observabilidade

- `GET /api/health` — liveness simples.
- `GET /api/health/deep` — checa DB + Redis.
- `GET /api/metrics` — métricas Prometheus (somente admin): `jobs_total{outcome}`, `job_latency_ms`, `waha_errors_total{kind}`, `circuit_breaker_state{session}`.
- `GET /admin/queues` — [Bull Board](https://github.com/felixmosh/bull-board) (somente admin).

## Backup

```bash
npm run backup            # gera ./backups/wahasender-YYYYMMDD-HHmm.{sqlite|sql}
```

## Testes

```bash
npm test            # roda uma vez
npm run test:watch  # modo watch
```

Cobertura: spintax, placeholders, normalização de telefone, janelas de envio, fluxo de autenticação (bootstrap/login/logout/JWT blocklist), isolamento multi-tenant, SaaS (signup self-service, quota enforcement, email tokens, entitlements). 24 testes no total.

## Estrutura

```
server/
  config.ts            # parse/validação zod do .env
  logger.ts            # pino
  db.ts                # knex
  migrations.ts        # schema idempotente + seed de planos
  storage.ts           # provider Local / S3 + validação de upload
  auth/
    service.ts         # createUser, login, resetPassword, markEmailVerified
    middleware.ts      # requireAuth, requireAdmin, requireVerifiedEmail
    routes.ts          # login, signup, verify-email, forgot/reset-password
    email-tokens.ts    # tokens SHA256 de uso único (verify/reset)
  billing/
    provider.ts        # interface BillingProvider
    mercadopago.ts     # PreApproval + MOCK mode
    service.ts         # activateSubscription, applyWebhook, cancelSubscription
    webhook.ts         # POST /api/billing/webhook/mercadopago
  routes/
    api.ts             # API REST (rotas isoladas por req.user.id + quota gates)
    billing.ts         # /api/billing/* (plans, subscription, usage, checkout)
    account.ts         # /api/account/export, /api/account/delete (LGPD)
    admin.ts           # /api/admin/* (stats, users, plans)
  lib/
    entitlements.ts    # getEntitlements, getRemainingQuota, incrementUsage
    mailer.ts          # nodemailer + console fallback
    messaging.ts       # placeholders, spintax, JID
    schedule.ts        # janelas + delay humanizado
  queue/               # BullMQ connection + helpers
src/                   # frontend React
  pages/
    Landing.tsx        # landing pública com pricing
    Login.tsx          # login
    Register.tsx       # cadastro self-service (/cadastro)
    EsqueciSenha.tsx   # forgot password
    RedefinirSenha.tsx # reset password
    VerificarEmail.tsx # e-mail verification callback
    Billing.tsx        # plano atual, uso, faturas, upgrade/cancel
    Admin.tsx          # painel de administração de plataforma
worker.ts              # processador BullMQ (+ quota kill-switch + incrementUsage)
server.ts              # composition root da API
tests/                 # vitest (24 testes)
```

## Notas de segurança (OWASP)

- **A01/A07** — JWT em cookie httpOnly + `SameSite=lax` com `jti` blocklist via Redis (logout invalida o token); bcrypt cost 12; política de senha forte; rate-limit em `/api/auth/*` (10 req/min) e geral 300 req/min/IP. Suporte a `trust proxy` para rate-limit correto atrás de reverse proxy.
- **A05** — `helmet()` aplicado (CSP desligado para o SPA inline). CORS restrito a `APP_URL`. Suporte a Docker secrets via `*_FROM_FILE`.
- **A03** — Validação zod em todas as rotas mutadoras; queries via Knex (parametrizadas).
- **A04** — Upload validado por **extensão E magic-bytes** (`file-type`), limite configurável, isolamento por usuário no FS/S3.
- **A08/A09** — Logs estruturados (pino-http) + tabela `audit_log` em todas mutações. Webhook protegido por segredo compartilhado + HMAC-SHA256 opcional (timing-safe). Métricas Prometheus para detecção de anomalias.

## Licença

MIT.
