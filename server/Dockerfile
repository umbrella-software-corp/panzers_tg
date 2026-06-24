# syntax=docker/dockerfile:1
# Panzer TG game server: HTTP API + WS battles (node src/index.js on :8080).
# pnpm workspace — `server` depends on `shared` (workspace:*). Build context =
# repo root so the whole workspace is visible. Image stays tiny: the only real
# runtime dep is `ws` (shared is pure JS).
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Lockfile + EVERY workspace manifest first: `--frozen-lockfile` validates the
# whole workspace against pnpm-lock.yaml, so client/server/shared package.json
# must all be present even though we only install the server subtree below.
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN pnpm install --frozen-lockfile --prod --filter "panzer-tg-server..."

COPY shared shared
COPY server server

WORKDIR /app/server
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
# server/data (profiles/clans/payments) is a Docker volume mounted here — see
# docker-compose.prod.yml. db.js mkdir's it on boot; the volume keeps it across
# redeploys.
CMD ["node", "src/index.js"]
