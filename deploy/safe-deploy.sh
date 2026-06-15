#!/usr/bin/env bash
# Безопасный деплой: НЕ рестартит сервер, если идут бои (рестарт = обрыв боя).
# Запускать НА ПРОДЕ из /opt/panzers:  bash deploy/safe-deploy.sh
# Обойти защиту (катить несмотря на бои):  FORCE=1 bash deploy/safe-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=$(grep -oE '^ADMIN_KEY=.*' server/.env | head -1 | cut -d= -f2- || true)
ACTIVE=""
if [ -n "${KEY:-}" ]; then
  ACTIVE=$(curl -s --max-time 5 -H "x-admin-key: $KEY" http://127.0.0.1:8080/api/admin/stats \
    | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(sum(1 for r in d.get("rooms",[]) if r.get("started")))
except Exception:
    print("")' 2>/dev/null || true)
fi

if [ -n "$ACTIVE" ] && [ "$ACTIVE" -gt 0 ] 2>/dev/null; then
  if [ "${FORCE:-0}" = "1" ]; then
    echo "⚠️  идёт боёв: $ACTIVE — FORCE=1, катим несмотря на игроков"
  else
    echo "⛔ СТОП: идёт боёв: $ACTIVE — рестарт оборвёт игроков. Подожди или FORCE=1." >&2
    exit 3
  fi
elif [ -z "$ACTIVE" ]; then
  echo "⚠️  не смог опросить активные бои (нет ключа/сервер недоступен) — продолжаю осторожно"
else
  echo "✅ активных боёв 0 — катим"
fi

exec bash deploy/server-setup.sh
