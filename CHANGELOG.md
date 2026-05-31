# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
