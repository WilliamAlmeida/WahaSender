# Plano de Melhorias — WahaSender v2.1

Plano consolidado dos 23 itens da análise pós-refactor. Marcado conforme implementação.

## Onda 1 — Críticos / segurança

- [x] 1. Fluxo de claim/reset do usuário legado (CLI + endpoint)
- [x] 2. Webhook WAHA com HMAC assinatura (timing-safe)
- [x] 4. CI GitHub Actions (lint + test + build)
- [x] 5. `/api/health/deep` (DB + Redis) + Bull Board protegido
- [x] 6. Política de senha forte + endpoint change-password + JWT `jti` blocklist
- [x] 22. `trust proxy` configurável

## Onda 2 — Robustez worker / dados

- [x] 7. Lock no re-enqueue do próximo pending (transação)
- [x] 8. Classificação de erros WAHA (retry/pause/backoff)
- [x] 9. Soft-delete em contacts/groups/campaigns + audit_log
- [~] 21. Migrar para Knex migrations CLI — *adiado, sistema atual é idempotente*

## Onda 3 — Testes / observabilidade

- [x] 3. Testes integração (auth, CRUD isolation, upload, webhook)
- [x] Métricas Prometheus `/metrics` (prom-client)

## Onda 4 — Frontend / UX

- [x] 10. Toast global + interceptor de erro padronizado
- [x] 11. Code-splitting com React.lazy por rota
- [x] 16. Importação CSV com mapping

## Onda 5 — Produto

- [x] 12. Multi-instância WAHA (round-robin + fallback)
- [x] 13. Circuit breaker anti-ban por sessão
- [x] 14. Templates reutilizáveis (CRUD)
- [x] 15. Webhooks outbound (campaign.completed etc)
- [x] 17. Agendamento por contato
- [x] 18. API tokens (`Authorization: ApiKey ...`)

## Onda 6 — Operação

- [x] 19. Script de backup (sqlite/postgres)
- [x] 20. Suporte a `*_FROM_FILE` (Docker/K8s secrets)
- [x] 23. Semver + CHANGELOG.md
