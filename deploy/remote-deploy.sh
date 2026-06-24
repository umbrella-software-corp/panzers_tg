#!/usr/bin/env bash
# Server-side deploy, invoked by GitHub Actions over SSH after it has rsynced
# docker-compose.prod.yml + this script into /opt/panzers and scp'd .env there.
#
# Only GHCR_USER + GHCR_TOKEN are passed at invocation (the workflow's short-lived
# GITHUB_TOKEN). Everything else lives in /opt/panzers/.env, which docker compose
# reads itself.
set -euo pipefail

cd /opt/panzers

if [[ ! -f .env ]]; then
	echo "remote-deploy.sh: /opt/panzers/.env missing — CI must scp it first" >&2
	exit 1
fi

: "${GHCR_USER:?GHCR_USER env var required}"
: "${GHCR_TOKEN:?GHCR_TOKEN env var required}"

echo "==> Logging in to GHCR"
echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin

echo "==> Pulling images"
docker compose -f docker-compose.prod.yml pull

echo "==> Starting services"
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "==> Pruning dangling images"
docker image prune -f >/dev/null
docker logout ghcr.io >/dev/null

echo "==> Status"
docker compose -f docker-compose.prod.yml ps
