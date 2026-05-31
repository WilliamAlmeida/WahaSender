# syntax=docker/dockerfile:1.6

# ---------- Build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install build deps for native modules (bcrypt, better-sqlite3 if used)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev deps for runtime copy
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    SERVICE_NAME=web

RUN apk add --no-cache tini && \
    addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/knexfile.ts ./knexfile.ts

RUN mkdir -p /app/storage/uploads && chown -R app:app /app/storage

USER app

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
# Default runs the web server; the worker service overrides with `node dist/worker.cjs`
CMD ["node", "dist/server.cjs"]
