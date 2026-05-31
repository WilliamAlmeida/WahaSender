# WahaSender

Plataforma multi-usuário para disparo humanizado de mensagens WhatsApp via [WAHA](https://waha.devlike.pro/), com fila distribuída, controle de janelas de envio, spintax e segregação total de dados por usuário.

> **Migração v1 → v2**: a versão antiga era monousuário com fila in-memory. A nova usa BullMQ + Redis, autenticação JWT e separação web/worker. Ao iniciar pela primeira vez, todos os dados existentes em `data.json` são migrados automaticamente para o banco e associados a um usuário legado (`legacy@local`, login desabilitado até reset de senha).

## Sumário

- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Início rápido (Docker)](#início-rápido-docker)
- [Início rápido (local)](#início-rápido-local)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Fluxo de primeiro login](#fluxo-de-primeiro-login)
- [Webhook WAHA](#webhook-waha)
- [Testes](#testes)
- [Estrutura](#estrutura)
- [Segurança](#notas-de-segurança-owasp)

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

## Fluxo de primeiro login

1. Sobe a aplicação (web + worker + redis + postgres).
2. Acessa `http://localhost:3000`. O frontend chama `GET /api/auth/needs-bootstrap` — sem usuários, mostra "Criar primeiro administrador".
3. Após criado o admin, novos cadastros públicos são bloqueados (`POST /api/auth/register` passa a retornar 403). Para criar mais usuários, insira diretamente no banco ou exponha um endpoint admin.

## Webhook WAHA

Aponte o webhook da sua instância WAHA para:

```
POST {APP_URL}/api/waha/webhook
Header: X-Webhook-Secret: <WAHA_WEBHOOK_SECRET>
Body: payload padrão do WAHA (event=message.ack, payload.id, payload.ack)
```

O servidor atualiza `message_status` (`pending → sent → delivered → read`) e ajusta `failedCount` da campanha quando o status final for `failed`.

## Testes

```bash
npm test            # roda uma vez
npm run test:watch  # modo watch
```

Cobertura atual: spintax, placeholders, normalização de telefone, janelas de envio.

## Estrutura

```
server/
  config.ts          # parse/validação zod do .env
  logger.ts          # pino
  db.ts              # knex
  migrations.ts      # schema idempotente + backfill legado
  storage.ts         # provider Local / S3 + validação de upload
  auth/              # service, middleware, routes
  routes/api.ts      # API REST (todas as rotas isoladas por req.user.id)
  queue/             # BullMQ connection + helpers
  lib/messaging.ts   # placeholders, spintax, JID
  lib/schedule.ts    # janelas + delay humanizado
src/                 # frontend React
worker.ts            # processador BullMQ
server.ts            # composition root da API
tests/               # vitest
```

## Notas de segurança (OWASP)

- **A01/A07** — JWT em cookie httpOnly + `SameSite=lax`; bcrypt cost 12; rate-limit em `/api/auth/*` (10 req/min) e geral 300 req/min/IP.
- **A05** — `helmet()` aplicado (CSP desligado para o SPA inline). CORS restrito a `APP_URL`.
- **A03** — Validação zod em todas as rotas mutadoras; queries via Knex (parametrizadas).
- **A04** — Upload validado por **extensão E magic-bytes** (`file-type`), limite configurável, isolamento por usuário no FS/S3.
- **A08/A09** — Logs estruturados (pino-http). Webhook protegido por segredo compartilhado.

## Licença

MIT.
