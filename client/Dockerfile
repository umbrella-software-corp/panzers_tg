# syntax=docker/dockerfile:1
# Web edge image: builds the Vite SPA (pnpm workspace — client depends on
# `shared`) and serves it via Caddy, which ALSO reverse-proxies /api,/ws,/admin
# to the server container, first-party-proxies /amp → Amplitude, and fronts
# everything with automatic Let's Encrypt TLS. Build context = repo root.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# All workspace manifests first (see server/Dockerfile for the frozen-lockfile note).
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter "panzer-tg-client..."

COPY shared shared
COPY client client

# VITE_* are baked into the SPA bundle AT BUILD TIME, so a stg image and a prod
# image differ even at the same source SHA (different API_URL/domain). These map
# to client/src: VITE_API_URL (api.js), VITE_WS_URL (game/net.js, optional —
# derived from API_URL if empty), VITE_AMPLITUDE_* (analytics.js), VITE_BOT_USERNAME
# (tg.js), VITE_SUPPORT_BOT (tg.js). VITE_BUILD_ID feeds the version-gate (#23).
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_AMPLITUDE_API_KEY
ARG VITE_AMPLITUDE_PROXY
ARG VITE_BOT_USERNAME
ARG VITE_SUPPORT_BOT
ARG VITE_BUILD_ID
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_AMPLITUDE_API_KEY=$VITE_AMPLITUDE_API_KEY \
    VITE_AMPLITUDE_PROXY=$VITE_AMPLITUDE_PROXY \
    VITE_BOT_USERNAME=$VITE_BOT_USERNAME \
    VITE_SUPPORT_BOT=$VITE_SUPPORT_BOT \
    VITE_BUILD_ID=$VITE_BUILD_ID
RUN pnpm --filter panzer-tg-client run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/client/dist /srv
