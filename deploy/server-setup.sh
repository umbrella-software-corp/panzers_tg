#!/usr/bin/env bash
# Установка/обновление Panzer TG ПРЯМО НА СЕРВЕРЕ (для веб-консоли VPS, когда
# SSH-порт закрыт хостером). Запускать из-под root на сервере:
#
#   apt-get update && apt-get install -y git
#   git clone https://github.com/Blagovav/panzers_tg.git /opt/panzers || (cd /opt/panzers && git pull)
#   cd /opt/panzers
#   BOT_TOKEN='ваш_токен_бота' bash deploy/server-setup.sh
#
# Секреты НЕ хранятся в репозитории: BOT_TOKEN передаётся переменной окружения,
# ADMIN_KEY генерируется автоматически и печатается один раз.
set -euo pipefail

DIR=/opt/panzers
DOMAIN=panzertg.online
EMAIL=blagov94@gmail.com

cd "$DIR"

echo "== 1/6 свежий код =="
# Жёсткая синхронизация на origin/main вместо merge: ПЕРЕЖИВАЕТ untracked-конфликты
# (дев-стенды вроде client/public/_*.html), на которых `git pull` отваливался с "would be
# overwritten, Aborting", а скрипт молча шёл дальше и СОБИРАЛ СТАРЫЙ КОД (инцидент 22.06 —
# бандл не менялся). server/.env и server/data гитигнорятся → НЕ затрагиваются.
git fetch origin --quiet
git reset --hard origin/main
echo "  HEAD: $(git rev-parse --short HEAD) — $(git log -1 --format=%s | head -c 60)"

echo "== 2/6 окружение (один раз) =="
command -v node >/dev/null || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs)
command -v pnpm >/dev/null || npm i -g pnpm@9
command -v nginx >/dev/null || (apt-get update -qq && apt-get install -y nginx)
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx

echo "== 3/6 .env (токен бота + ключ админки) =="
if [ ! -s server/.env ]; then
  if [ -z "${BOT_TOKEN:-}" ]; then
    echo "!! BOT_TOKEN не задан. Запусти так: BOT_TOKEN='...' bash deploy/server-setup.sh" >&2
    exit 1
  fi
  ADMIN_KEY="${ADMIN_KEY:-$(openssl rand -hex 16)}"
  # SUPPORT_* — саппорт-бот (отдельный токен) + id группы разработчиков; пустые =
  # саппорт выключен. Заполни вручную после первого деплоя (см. README/деплой-доку).
  # CHANNEL_ID — «подпишись на канал → бонус»: @username ИЛИ -100…; пусто = фича
  # выключена. ВАЖНО: бота @panzers_bot надо сделать админом этого канала, иначе
  # getChatMember не вернёт статус подписки. Размер награды — CHANNEL_BONUS_* (по
  # умолчанию 5000 кредитов + 50 жетонов, если не задано).
  printf 'BOT_TOKEN=%s\nADMIN_KEY=%s\nSUPPORT_BOT_TOKEN=%s\nSUPPORT_CHAT_ID=%s\nCHANNEL_ID=%s\nCHANNEL_URL=%s\n' \
    "$BOT_TOKEN" "$ADMIN_KEY" "${SUPPORT_BOT_TOKEN:-}" "${SUPPORT_CHAT_ID:-}" "${CHANNEL_ID:-}" "${CHANNEL_URL:-}" > server/.env
  echo ">> ADMIN_KEY (сохрани для входа в /admin): $ADMIN_KEY"
else
  echo "server/.env уже есть — не трогаю (SUPPORT_*/CHANNEL_ID добавь вручную: саппорт и бонус за канал)"
fi
# серверная аналитика Amplitude (ПУБЛИЧНЫЙ API key) — дозаписываем, если ещё нет
grep -q '^AMPLITUDE_API_KEY=' server/.env 2>/dev/null || echo 'AMPLITUDE_API_KEY=c25c3ca61f4fa6d58a4b95a8293425e0' >> server/.env

echo "== 4/6 зависимости и сборка клиента =="
pnpm install --silent
# VITE_AMPLITUDE_API_KEY — ПУБЛИЧНЫЙ ключ Amplitude (попадает в клиент-бандл, не секрет).
(cd client && VITE_API_URL="https://$DOMAIN" VITE_AMPLITUDE_API_KEY=c25c3ca61f4fa6d58a4b95a8293425e0 VITE_AMPLITUDE_PROXY="https://$DOMAIN/amp/2/httpapi" pnpm build)

echo "== 5/6 systemd + nginx =="
cp deploy/panzers.service /etc/systemd/system/panzers.service
systemctl daemon-reload
systemctl enable panzers >/dev/null 2>&1 || true
systemctl restart panzers
sleep 1 && systemctl is-active panzers
cp deploy/nginx-panzertg.conf /etc/nginx/sites-available/panzertg.conf
ln -sf /etc/nginx/sites-available/panzertg.conf /etc/nginx/sites-enabled/panzertg.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "== 6/6 SSL (Let's Encrypt) =="
# нужна A-запись $DOMAIN → этот сервер
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --agree-tos -m "$EMAIL" -n || \
  echo "!! SSL не выпустился — проверь, что A-запись $DOMAIN указывает на этот сервер, и повтори: certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect --agree-tos -m $EMAIL -n"

echo "== Готово: https://$DOMAIN · бот @panzers_bot · админка /admin =="
