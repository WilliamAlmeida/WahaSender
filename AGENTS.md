# AGENTS.md — Instruções para agentes de IA no WahaSender

## Regra principal

**Não suba o servidor.** Não execute `npm run dev`, `npm start`, `npm run dev:worker` nem qualquer comando que inicie o processo Express ou o worker BullMQ. Se precisar confirmar comportamento em runtime, solicite ao usuário que rode o servidor e descreva o que deve ser observado. (Só faça isso caso o usuário não tenha pedido para rodar o servidor anteriormente para você.)

---

## Visão geral do projeto

**WahaSender** é uma plataforma SaaS multi-tenant para disparo de mensagens WhatsApp em massa. Usa a API WAHA como gateway de WhatsApp.

**Processos em runtime:**
- `npm run dev` — servidor Express (API + frontend estático em produção)
- `npm run dev:worker` — worker BullMQ (processa filas de envio, separado do servidor)

**Stack:**
- Frontend: React 19, Vite, Tailwind CSS, React Router v7
- Backend: Node.js, Express, Knex (query builder), Zod (validação)
- Banco: SQLite (dev/teste) ou PostgreSQL (produção)
- Filas: BullMQ + Redis
- Build: esbuild (server/worker), Vite (frontend)
- Testes: Vitest

---

## Estrutura de pastas

```
WahaSender/
├── server/               # Backend Express
│   ├── auth/             # JWT, middleware, tokens de e-mail, HMAC
│   ├── billing/          # Mercado Pago, assinaturas, webhooks de cobrança
│   ├── lib/              # Utilitários: entitlements, messaging, schedule, csv, etc.
│   ├── queue/            # Fábricas BullMQ + conexão Redis
│   ├── routes/           # Handlers de rota (api.ts, admin.ts, billing.ts, etc.)
│   ├── config.ts         # Validação de env vars com Zod
│   ├── db.ts             # Instância Knex (sqlite3 ou pg)
│   ├── migrations.ts     # Migrations idempotentes inline (sem arquivos .js separados)
│   ├── redis.ts          # Cliente ioredis
│   ├── storage.ts        # Upload local ou S3
│   └── logger.ts         # Pino
├── src/                  # Frontend React
│   ├── pages/            # Uma página por rota
│   ├── components/       # Componentes reutilizáveis (Modal, etc.)
│   └── lib/              # api.ts (Axios), auth.tsx (context), utils.ts
├── tests/                # Testes de integração Vitest
│   ├── setup.ts          # SQLite em memória + ioredis-mock
│   └── *.test.ts         # auth, isolation, saas, entitlements, messaging, schedule
├── server.ts             # Entry point do servidor
└── worker.ts             # Entry point do worker
```

---

## Banco de dados e migrations

- Em desenvolvimento/teste: **SQLite** (`storage/database.sqlite`)
- Em produção: **PostgreSQL** (variáveis `DB_*`)
- As migrations ficam em `server/migrations.ts` como código TypeScript inline, não em arquivos numerados. São **idempotentes** — verificam existência antes de criar.
- O servidor roda as migrations automaticamente no boot (`runMigrations()` em `server.ts:32`).
- Para adicionar uma migration: inclua um novo bloco no final da função `runMigrations()`, usando os helpers `ensureColumn` e `safeIndex` já existentes.

---

## Autenticação

- JWT em cookie HTTP-only (`waha_session`), com blocklist de JTIs no Redis.
- Middleware `requireAuth` em todos os endpoints de `/api/*`, exceto `/api/auth/*` e webhooks.
- Roles: `admin` (dono da plataforma, bypass de quotas) e `user` (tenant).
- Senhas com bcrypt. Reset via token de e-mail (`email_tokens`).

---

## Filas e worker

- BullMQ com Redis. Dois processos independentes: servidor e worker.
- O worker consome a fila `campaign-jobs` e envia mensagens via WAHA.
- Circuit breaker por usuário+sessão (anti-ban) implementado em `server/lib/circuit-breaker.ts`.
- Não modifique a estrutura de jobs na fila sem revisar `server/queue/index.ts` e `worker.ts`.

---

## Entitlements e quotas de plano

- Lógica em `server/lib/entitlements.ts`.
- Cada tenant tem um plano com limites: `maxContacts`, `maxCampaigns`, `maxSessions`, `monthlyMessageQuota`.
- `admin` bypassa todos os limites.
- A função `checkLimit` em `server/routes/api.ts` deve ser chamada antes de inserções que consumam quota.

---

## Testes

```bash
npx vitest run            # Todos os testes
npx vitest run tests/auth.test.ts   # Arquivo específico
npx tsc --noEmit          # Typecheck sem compilar
```

- Os testes usam SQLite em memória (arquivo temporário por processo) e `ioredis-mock`.
- Não requerem Redis ou WAHA rodando.
- Sempre rode `npx tsc --noEmit` após qualquer alteração de código antes de considerar a tarefa concluída.
- Se algum teste falhar, investigue antes de prosseguir — não pule testes.

---

## Convenções de código

- **TypeScript estrito** — sem `any` desnecessário; prefira tipos explícitos em interfaces públicas.
- **Sem comentários explicando o quê** — nomes de variáveis/funções devem ser autoexplicativos. Comente apenas o *porquê* quando não for óbvio.
- **Sem tratamento defensivo desnecessário** — não adicione try/catch para cenários que não podem ocorrer, não valide dados internos que já foram validados na entrada.
- **Sem features extras** — implemente exatamente o que foi pedido, sem refatorar código ao redor nem adicionar abstrações preventivas.
- **Estilo de rotas**: handlers assíncronos com try/catch, `res.status(4xx/5xx).json({ error: err.message })` em erros.
- **Frontend**: componentes funcionais com hooks. Sem CSS-in-JS — use Tailwind. Formulários controlados com `useState`.

---

## Variáveis de ambiente

Copie `.env.example` para `.env`. Principais:

| Variável | Descrição |
|---|---|
| `NODE_ENV` | `development` / `production` / `test` |
| `DB_CLIENT` | `sqlite3` (padrão) ou `pg` |
| `JWT_SECRET` | Mínimo 16 caracteres |
| `REDIS_HOST` | Host do Redis (necessário para filas e JWT blocklist) |
| `WAHA_WEBHOOK_SECRET` | Segredo para validar webhooks recebidos do WAHA |
| `ENABLE_SIGNUP` | `true` para permitir auto-cadastro de novos tenants |
| `MP_ACCESS_TOKEN` | Token Mercado Pago (billing) |

Variáveis sensíveis aceitam sufixo `_FROM_FILE` para Docker/K8s secrets (ex: `JWT_SECRET_FROM_FILE=/run/secrets/jwt`).

---

## O que não fazer

- Não rode o servidor ou o worker — peça ao usuário.
- Não use `git push --force`, `git reset --hard` ou operações destrutivas sem confirmação explícita do usuário.
- Não faça commit sem o usuário pedir explicitamente.
- Não instale pacotes sem confirmar com o usuário.
- Não modifique `tests/setup.ts` para silenciar falhas.
- Não use `console.log` no código de servidor — use `logger.info/warn/error` (Pino).
- Não exponha dados sensíveis em logs (senhas, tokens, chaves de API completas).
