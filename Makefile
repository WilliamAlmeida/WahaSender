SHELL := /bin/bash

ROOT_DIR := $(shell pwd)
PM2_ECOSYSTEM := $(ROOT_DIR)/ecosystem.config.cjs
PM2_WEB_NAME := wahasender-web
PM2_WORKER_NAME := wahasender-worker

NODE_MAJOR ?= 20
NPM ?= npm
DOCKER_COMPOSE ?= docker compose
LOG_DIR ?= $(ROOT_DIR)/storage/logs

.PHONY: help setup-vps install-node install-pm2 install-deps clean build lint test typecheck format format-check dev-web dev-worker start-web start-worker docker-up docker-down docker-logs pm2-start-web pm2-start-worker pm2-start-all pm2-stop-all pm2-delete-all pm2-restart-all pm2-status pm2-logs pm2-save pm2-startup deploy-web deploy-worker deploy-all bootstrap

help:
	@echo "Comandos disponiveis:"
	@echo "  make setup-vps      -> Instala Node.js e PM2"
	@echo "  make install-deps   -> Instala dependencias (npm ci ou npm install)"
	@echo "  make clean          -> Remove artefatos de build (dist)"
	@echo "  make build          -> Build do frontend + server + worker"
	@echo "  make lint           -> Typecheck + ESLint"
	@echo "  make test           -> Executa testes (Vitest)"
	@echo "  make typecheck      -> Executa tsc --noEmit"
	@echo "  make dev-web        -> Sobe web em modo desenvolvimento"
	@echo "  make dev-worker     -> Sobe worker em modo desenvolvimento"
	@echo "  make start-web      -> Sobe web em modo producao (dist/server.cjs)"
	@echo "  make start-worker   -> Sobe worker em modo producao (dist/worker.cjs)"
	@echo "  make docker-up      -> Sobe stack Docker (postgres, redis, app, worker)"
	@echo "  make docker-down    -> Derruba stack Docker"
	@echo "  make docker-logs    -> Logs da stack Docker"
	@echo "  make pm2-start-web  -> Sobe web no PM2"
	@echo "  make pm2-start-worker -> Sobe worker no PM2"
	@echo "  make pm2-start-all  -> Sobe web + worker no PM2"
	@echo "  make pm2-restart-all -> Reinicia web + worker no PM2"
	@echo "  make deploy-web     -> Build + restart do web no PM2"
	@echo "  make deploy-worker  -> Build + restart do worker no PM2"
	@echo "  make deploy-all     -> Build + restart web e worker no PM2"
	@echo "  make pm2-stop-all   -> Para todos os processos do projeto"
	@echo "  make pm2-delete-all -> Remove todos os processos do projeto"
	@echo "  make pm2-status     -> Mostra status dos processos"
	@echo "  make pm2-logs       -> Mostra logs dos processos do projeto"
	@echo "  make pm2-save       -> Salva estado atual do PM2"
	@echo "  make pm2-startup    -> Configura startup do PM2 no boot"
	@echo "  make bootstrap      -> Setup completo (SO + deps + build + pm2 + save)"
	@echo ""
	@echo "Observacao: migrations e seed rodam automaticamente no boot do web (server.ts)."

setup-vps: install-node install-pm2
	@echo "Ambiente base da VPS pronto."

install-node:
	@echo "Instalando Node.js $(NODE_MAJOR).x..."
	sudo apt-get update
	sudo apt-get install -y ca-certificates curl gnupg build-essential make git unzip
	@if command -v node >/dev/null 2>&1; then \
		echo "Node ja instalado: $$(node -v)"; \
	else \
		curl -fsSL https://deb.nodesource.com/setup_$(NODE_MAJOR).x | sudo -E bash -; \
		sudo apt-get install -y nodejs; \
		echo "Node instalado: $$(node -v)"; \
	fi

install-pm2:
	@echo "Instalando PM2 globalmente..."
	sudo npm install -g pm2
	@pm2 -v

install-deps:
	@echo "Instalando dependencias..."
	@if [ -f package-lock.json ]; then \
		$(NPM) ci; \
	else \
		$(NPM) install; \
	fi

clean:
	@$(NPM) run clean

build:
	@$(NPM) run build

lint:
	@$(NPM) run lint

test:
	@$(NPM) test

typecheck:
	@npx tsc --noEmit

format:
	@$(NPM) run format

format-check:
	@$(NPM) run format:check

dev-web:
	@$(NPM) run dev

dev-worker:
	@$(NPM) run dev:worker

start-web:
	@$(NPM) start

start-worker:
	@$(NPM) run start:worker

docker-up:
	@$(DOCKER_COMPOSE) up -d --build

docker-down:
	@$(DOCKER_COMPOSE) down

docker-logs:
	@$(DOCKER_COMPOSE) logs -f app worker

pm2-start-web:
	@if [ ! -f "$(ROOT_DIR)/dist/server.cjs" ]; then $(MAKE) build; fi
	@mkdir -p "$(LOG_DIR)"
	@pm2 delete $(PM2_WEB_NAME) >/dev/null 2>&1 || true
	@pm2 start "$(PM2_ECOSYSTEM)" --only "$(PM2_WEB_NAME)"

pm2-start-worker:
	@if [ ! -f "$(ROOT_DIR)/dist/worker.cjs" ]; then $(MAKE) build; fi
	@mkdir -p "$(LOG_DIR)"
	@pm2 delete $(PM2_WORKER_NAME) >/dev/null 2>&1 || true
	@pm2 start "$(PM2_ECOSYSTEM)" --only "$(PM2_WORKER_NAME)"

pm2-start-all: pm2-start-web pm2-start-worker
	@echo "Todos os processos foram iniciados no PM2."
	@pm2 list

pm2-stop-all:
	-@pm2 stop "$(PM2_WEB_NAME)"
	-@pm2 stop "$(PM2_WORKER_NAME)"

pm2-delete-all:
	-@pm2 delete "$(PM2_WEB_NAME)"
	-@pm2 delete "$(PM2_WORKER_NAME)"

pm2-restart-all:
	@$(MAKE) pm2-start-web
	@$(MAKE) pm2-start-worker

deploy-web:
	@$(MAKE) pm2-start-web

deploy-worker:
	@$(MAKE) pm2-start-worker

deploy-all: build deploy-web deploy-worker
	@echo "Deploy completo concluido."

pm2-status:
	@pm2 list

pm2-logs:
	@pm2 logs $(PM2_WEB_NAME) $(PM2_WORKER_NAME)

pm2-save:
	@pm2 save

pm2-startup:
	@pm2 startup

bootstrap: setup-vps install-deps build pm2-start-all pm2-save
	@echo "Bootstrap concluido."
