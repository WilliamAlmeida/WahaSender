# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-06

### Added — SaaS completo (Brasil / Mercado Pago)

#### Identidade & Self-service
- **Cadastro self-service** (`POST /api/auth/signup`): o 1º usuário vira admin verificado; os demais recebem o plano Free automaticamente.
- **Verificação de e-mail** (`POST /api/auth/verify-email`, `/api/auth/resend-verification`): tokens SHA256 de uso único com TTL, armazenados com hash na tabela `email_tokens`.
- **Redefinição de senha** (`POST /api/auth/forgot-password`, `/api/auth/reset-password`): mesmo mecanismo de tokens; sem enumeração de e-mails.
- **Gate de conta suspensa**: `requireAuth` retorna 403 para usuários com `status='suspended'`.
- **`requireVerifiedEmail`** middleware opcional (controlado por `REQUIRE_EMAIL_VERIFICATION`).

#### Planos, Assinaturas & Quotas
- Tabelas: `plans`, `subscriptions`, `usage_counters`, `payments`, `billing_events`.
- **Seed automático** dos planos padrão via migration idempotente: Free (R$0/100msg), Starter (R$49/2k), Pro (R$99/10k), Business (R$199/50k).
- **`server/lib/entitlements.ts`**: `getEntitlements`, `getRemainingQuota`, `incrementUsage`, `assignFreePlan`.
- **Enforcement na API**: criação de campanha valida `maxCampaigns`/`maxSessions`; importação CSV valida `maxContacts`; toggle Draft→Running verifica quota restante (retorna 402 + `code: 'quota_exceeded'`).
- **Kill-switch no worker**: antes de cada envio, verifica quota; ao esgotar, pausa a campanha e dispara evento outbound.
- **Medição de uso**: após cada mensagem enviada com sucesso, `incrementUsage(userId, 1)` faz upsert em `usage_counters` por período (`YYYY-MM`).

#### Cobrança (Mercado Pago)
- **`server/billing/`**: interface `BillingProvider`, implementação `MercadoPagoProvider` (PreApproval para cartão).
- **MOCK mode**: sem `MP_ACCESS_TOKEN`, o checkout ativa o plano localmente — fluxo completo testável sem credenciais.
- **Webhook idempotente** (`POST /api/billing/webhook/mercadopago`): valida assinatura `x-signature` (HMAC-SHA256), desduplicação via `billing_events.externalId` UNIQUE.
- **Rotas REST de billing** (`/api/billing/plans`, `/subscription`, `/usage`, `/invoices`, `/checkout`, `/cancel`).
- **Rota pública** `GET /api/public/plans` (sem autenticação) para landing page.

#### E-mail Transacional
- **`server/lib/mailer.ts`**: abstração nodemailer com fallback para console quando `MAIL_HOST` não está definido.
- Templates em pt-BR para verificação de e-mail e redefinição de senha.

#### Admin de Plataforma
- `GET /api/admin/stats` — MRR, usuários ativos, mensagens do mês.
- `GET /api/admin/users` — lista de tenants com plano, uso e status.
- `POST /api/admin/users/:id/status` — suspender / reativar tenant.
- `POST /api/admin/users/:id/plan` — alterar plano manualmente.
- `GET/PUT /api/admin/plans` — gerenciar catálogo de planos.

#### LGPD
- `GET /api/account/export` — dump completo de dados do tenant em JSON.
- `POST /api/account/delete` — anonimização e exclusão de dados (requer `confirm: "EXCLUIR"`), registrado em `audit_log`.

#### Frontend
- **Landing page pública** (`/`) com hero, features e pricing (fetch dos planos via API).
- **`/cadastro`** — tela de cadastro self-service.
- **`/esqueci-senha`** e **`/redefinir-senha`** — fluxo de recuperação de senha.
- **`/verificar-email`** — callback de verificação (auto-executa ao carregar).
- **`/billing`** — plano atual, barra de uso (color-coded), upgrade, faturas, cancelamento.
- **`/admin`** — painel de plataforma com stats e gestão de tenants.
- `VerifyBanner` global exibida para usuários com e-mail não verificado.
- Itens de navegação "Plano e Cobrança" e "Administração" no sidebar.

### Tests
- `tests/entitlements.test.ts` — Free plan, incremento de uso, upgrade Pro, Business ilimitado.
- `tests/saas.test.ts` — signup admin/tenant, quota enforcement (402), email tokens single-use.
- Total: 24 testes passando.

### Breaking Changes
- `POST /api/auth/register` mantém comportamento de bootstrap (apenas 1º usuário). Use `/api/auth/signup` para autoatendimento.
- Novas colunas em `users` (`emailVerifiedAt`, `status`) — migration idempotente aplicada automaticamente.

## [2.1.0] - 2025-12

### Added — v2.1 hardening wave

- **Auth:** strong password policy (`PASSWORD_MIN_LENGTH`, `PASSWORD_REQUIRE_COMPLEXITY`), JWT `jti` blocklist via Redis, `POST /api/auth/change-password`, role column on `users`.
- **Legacy migration:** legacy owner is now `claimable=true` — first registration with the legacy email atomically takes ownership of all legacy data. CLI `npm run admin -- reset-password <email> <pwd>` for offline recovery.
- **Webhook hardening:** optional HMAC-SHA256 signature verification (`WAHA_WEBHOOK_HMAC=true`, timing-safe).
- **API tokens:** machine-to-machine integration via `Authorization: ApiKey <token>` or `X-Api-Token`. CRUD endpoints in `/api/api-tokens`.
- **Templates:** reusable message templates per user (`/api/templates`).
- **Outbound webhooks:** subscribe URLs to `campaign.started`, `campaign.completed`, `campaign.paused`, `message.failed` (HMAC-signed).
- **CSV import:** `/api/contacts/import-csv` accepts text/csv with header mapping.
- **Observability:** Prometheus `/api/metrics` (admin), Bull Board UI at `/admin/queues` (admin), `/api/health/deep` checks DB + Redis.
- **Worker resilience:** WAHA error classifier, per-(user,session) circuit breaker, multi-session round-robin/random with automatic skip of open breakers, soft-delete columns on `contacts`/`groups`/`campaigns`, optional per-contact `scheduledAt`.
- **Audit log:** every mutation auditable through `audit_log` table.
- **DevOps:** `TRUST_PROXY` env, `*_FROM_FILE` Docker/K8s secrets, GitHub Actions CI (lint+test+build+docker), backup script (`npm run backup`), admin CLI (`npm run admin`), `CHANGELOG.md`.

### Frontend

- React Hot Toast global with axios interceptor.
- Routes lazily code-split with `React.lazy` + `<Suspense>`.
- CSV import page (preview + mapping).
- New pages: Templates, API Tokens, Outbound Webhooks.

### Tests

- Vitest integration suite (auth flow, per-user isolation, API token lifecycle, webhook HMAC) — 18/18 passing.

## [2.0.0] - 2025-12

### Added

- Multi-tenant rewrite (per-user data isolation).
- Authentication (JWT cookie + bcrypt).
- BullMQ + Redis worker separated from API.
- Storage providers (Local / S3 with magic-bytes validation).
- Docker compose stack (app + worker + postgres + redis).
- Vitest tests.

## [1.0.0]

- Initial single-user release with in-memory queue.
