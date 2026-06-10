#!/usr/bin/env bash
# Деплой Panzer TG на VPS по SSH (когда порт 22 доступен). Секреты — из env,
# в репозитории их НЕТ. Запуск:
#
#   PASS='пароль_root' BOT_TOKEN='токен_бота' HOST=root@1.2.3.4 bash deploy/deploy.sh
#
# Если SSH-порт закрыт хостером — используй deploy/server-setup.sh через веб-консоль.
set -euo pipefail

HOST="${HOST:?задай HOST=root@IP}"
PASS="${PASS:?задай PASS=пароль_root}"
DIR=/opt/panzers
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SSHP="sshpass -p $PASS"
SSH="$SSHP ssh -o StrictHostKeyChecking=accept-new $HOST"

echo "== 1/6 rsync кода =="
$SSHP rsync -az --delete -e "ssh -o StrictHostKeyChecking=accept-new" \
  --exclude node_modules --exclude .git --exclude client/dist \
  --exclude server/data --exclude design-ref --exclude tools \
  "$REPO/" "$HOST:$DIR/"

echo "== 2/6 окружение (один раз) =="
$SSH 'command -v node >/dev/null || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs)
command -v pnpm >/dev/null || npm i -g pnpm@9
command -v nginx >/dev/null || (apt-get update -qq && apt-get install -y nginx)
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx'

echo "== 3/6 .env (токен бота из env, ключ админки — случайный) =="
$SSH "if [ ! -s $DIR/server/.env ]; then
  printf 'BOT_TOKEN=%s\nADMIN_KEY=%s\n' '${BOT_TOKEN:-}' \$(openssl rand -hex 16) > $DIR/server/.env
  echo 'ADMIN_KEY:' \$(grep ADMIN_KEY $DIR/server/.env | cut -d= -f2)
fi"

echo "== 4/6 зависимости и сборка клиента =="
$SSH "cd $DIR && pnpm install --silent && cd client && VITE_API_URL=https://panzertg.online pnpm build"

echo "== 5/6 systemd + nginx =="
$SSH "cp $DIR/deploy/panzers.service /etc/systemd/system/panzers.service
systemctl daemon-reload && systemctl enable panzers >/dev/null 2>&1 || true
systemctl restart panzers && sleep 1 && systemctl is-active panzers
cp $DIR/deploy/nginx-panzertg.conf /etc/nginx/sites-available/panzertg.conf
ln -sf /etc/nginx/sites-available/panzertg.conf /etc/nginx/sites-enabled/panzertg.conf
rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx"

echo "== 6/6 SSL =="
$SSH "certbot --nginx -d panzertg.online -d www.panzertg.online --redirect --agree-tos -m blagov94@gmail.com -n"

echo "== Готово: https://panzertg.online =="
