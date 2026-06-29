# Деплой Panzer TG (GHCR + Docker Compose)

Картинки собираются в CI и пушатся в **GitHub Container Registry**, на сервер они
только **скачиваются и запускаются** (`docker compose pull && up`). Никакой сборки
на сервере, никакого rsync исходников.

```
push в main        →  staging    (stg.panzers.tg, 206.223.241.30)
tag panzers/X.Y.Z   →  production (app.panzers.tg, 206.223.241.25)
```

Два образа на окружение:
- `ghcr.io/<owner>/panzers_tg-server` — Node (API + WS, :8080), данные в volume.
- `ghcr.io/<owner>/panzers_tg-web` — Caddy: статика клиента + reverse-proxy на
  сервер + first-party Amplitude-прокси + авто-TLS Let's Encrypt.

`VITE_*` зашиты в бандл на этапе сборки → образы stg и prod **разные** даже на одном
коммите (разные домены/ключи).

---

## Конфигурация — только в GitHub Environments

Всё разнесено по двум окружениям (Settings → Environments): `staging` и
`production`. Ничего на repo-level. В workflow `secrets.*` / `vars.*` резолвятся
по `environment:` джобы.

### Variables (не секреты)

| Переменная             | staging                                  | production                          |
|------------------------|------------------------------------------|-------------------------------------|
| `SSH_HOST`             | `206.223.241.30`                           | `206.223.241.25`                      |
| `DOMAIN`               | `stg.panzers.tg`                         | `app.panzers.tg`                    |
| `WEBAPP_URL`           | `https://stg.panzers.tg`                 | `https://app.panzers.tg`                |
| `VITE_API_URL`         | `https://stg.panzers.tg`                 | `https://app.panzers.tg`                |
| `VITE_WS_URL`          | `wss://stg.panzers.tg/ws`                | `wss://app.panzers.tg/ws`               |
| `VITE_AMPLITUDE_PROXY` | `https://stg.panzers.tg/amp/2/httpapi`   | `https://app.panzers.tg/amp/2/httpapi`  |
| `AMPLITUDE_API_KEY`    | `c25c3ca61f4fa6d58a4b95a8293425e0`       | `c25c3ca61f4fa6d58a4b95a8293425e0`  |
| `BOT_USERNAME`         | `panzers_stg_bot`                        | `panzers_bot`                       |
| `SUPPORT_BOT_USERNAME` | (опц.)                                   | (опц.)                              |
| `CHANNEL_ID`           | (пусто — фича выкл.)                      | напр. `@panzers_channel` / `-100…`  |
| `CHANNEL_URL`          | (пусто)                                  | напр. `https://t.me/panzers_channel`|

`AMPLITUDE_API_KEY` — **публичный** ключ (и так попадает в клиент-бандл), поэтому
он variable, а не secret. Один и тот же на оба окружения.

### Secrets

| Секрет             | Что это                                                                 |
|--------------------|-------------------------------------------------------------------------|
| `DEPLOY_SSH_KEY`   | Приватный ключ CI (его публичная часть кладётся на сервер через bootstrap). |
| `BOT_TOKEN`        | Токен бота Telegram. **stg и prod — РАЗНЫЕ боты** (см. ниже).            |
| `ADMIN_KEY`        | Ключ входа в `/admin`. Любая случайная строка (`openssl rand -hex 16`). На проде — взять существующий со старого сервера. |
| `SUPPORT_BOT_TOKEN`| Токен саппорт-бота (опц., пусто = саппорт выключен).                     |
| `SUPPORT_CHAT_ID`  | Чат разработчиков для саппорта (опц.).                                   |

> ⚠️ **stg и prod обязаны использовать РАЗНЫЕ `BOT_TOKEN`.** Сервер крутит
> `getUpdates` long-polling (платежи Stars, /start). Telegram допускает только
> ОДНОГО потребителя `getUpdates` на токен — общий токен → 409 Conflict, апдейты и
> платежи воруются между окружениями. Для staging заведён отдельный
> `@panzers_stg_bot`. Если отдельного бота нет — оставь `BOT_TOKEN` пустым:
> staging уйдёт в dev-режим (мгновенные «оплаты», stub-авторизация).

### Быстрая установка через `gh` (не-секретные variables)

```bash
# staging
gh variable set SSH_HOST            -e staging -b "206.223.241.30"
gh variable set DOMAIN              -e staging -b "stg.panzers.tg"
gh variable set WEBAPP_URL          -e staging -b "https://stg.panzers.tg"
gh variable set VITE_API_URL        -e staging -b "https://stg.panzers.tg"
gh variable set VITE_WS_URL         -e staging -b "wss://stg.panzers.tg/ws"
gh variable set VITE_AMPLITUDE_PROXY -e staging -b "https://stg.panzers.tg/amp/2/httpapi"
gh variable set AMPLITUDE_API_KEY   -e staging -b "c25c3ca61f4fa6d58a4b95a8293425e0"
gh variable set BOT_USERNAME        -e staging -b "panzers_stg_bot"
# (production — то же с app.panzers.tg / panzers_bot)

# секреты:
gh secret set DEPLOY_SSH_KEY -e staging < deploy_key       # приватный ключ
printf '%s' "<stg-bot-token>" | gh secret set BOT_TOKEN -e staging
printf '%s' "$(openssl rand -hex 16)" | gh secret set ADMIN_KEY -e staging
```

---

## Первичная установка сервера (один раз)

1. Сгенерировать ключ-пару деплоя (одну на оба сервера или по одной на каждый):
   ```bash
   ssh-keygen -t ed25519 -f deploy_key -N "" -C "panzers-ci"
   ```
   Приватную часть → `DEPLOY_SSH_KEY` (secret окружения), публичную → bootstrap.

2. Прогнать bootstrap на сервере (ставит docker, юзера `deploy`, ufw, гасит
   дефолтные apache2/nginx, создаёт `/opt/panzers`):
   ```bash
   ssh root@<host> 'bash -s' < deploy/bootstrap.sh "$(cat deploy_key.pub)"
   ```

3. DNS: A-запись домена → IP сервера (`stg.panzers.tg → 206.223.241.30`,
   `app.panzers.tg → 206.223.241.25`). Caddy сам выпустит сертификат при первом старте.
   Голый `panzers.tg` — под будущий лендинг (пока нет), прод-апп живёт на `app.panzers.tg`.

После этого деплой полностью автоматический.

---

## Релиз

- **Staging** — мёрж в `main`. CI собирает образы (`:sha-…` + `:staging`) и
  раскатывает на 206.223.241.30.
- **Production** — тег `panzers/X.Y.Z` на нужном коммите:
  ```bash
  git tag panzers/1.0.0 <sha> && git push origin panzers/1.0.0
  ```
  CI собирает `:1.0.0` + `:production` и раскатывает на 206.223.241.25
  автоматически — без ручного апрува; момент выката контролируется тем, когда
  поставлен тег.

Откат: перетегировать предыдущую версию, либо на сервере
`IMAGE_TAG=<старый> docker compose -f docker-compose.prod.yml up -d`.

---

## Миграция живого прода (cutover — в самом конце)

Реальные данные игроков сейчас на СТАРОМ прод-сервере (`/opt/panzers/server/data`,
systemd `panzers`). Новый прод 206.223.241.25 — чистый. Порядок переключения:

1. Развернуть и проверить staging (как выше) — паттерн на чистом сервере.
2. Bootstrap нового прод-сервера 206.223.241.25.
3. Скопировать данные со старого сервера в volume нового, при выключенном сервере:
   ```bash
   # на новом сервере поднять стек (создаст volume panzers_server_data), затем:
   docker compose -f /opt/panzers/docker-compose.prod.yml stop server
   rsync -az root@<OLD_HOST>:/opt/panzers/server/data/ /tmp/data/
   docker run --rm -v panzers_server_data:/dst -v /tmp/data:/src alpine \
     sh -c 'cp -a /src/. /dst/'
   docker compose -f /opt/panzers/docker-compose.prod.yml start server
   ```
   (`ADMIN_KEY` на проде взять из старого `server/.env`, чтобы вход в `/admin` не
   менялся.)
4. Перевести DNS `app.panzers.tg` (+ `grafana.panzers.tg`, см. ниже) → 206.223.241.25,
   дождаться TLS от Caddy.
5. Обновить у @BotFather домен Mini App / ссылки бота на `app.panzers.tg`.
6. Поднять мониторинг (см. ниже).
7. Погасить старый сервер.

---

## Мониторинг нагрузки (Grafana, только прод)

Отдельный стек `deploy/monitoring/` (cadvisor + node-exporter + victoriametrics +
grafana) — нагрузка контейнеров и хоста. Не в app-пайплайне, поднимается вручную
ПОСЛЕ прод app-стека (grafana цепляется к его сети `panzers_edge`). Наружу — через
тот же Caddy на `grafana.panzers.tg` (переменная `GRAFANA_DOMAIN` в окружении
`production`; на стейдже не задана → блок Grafana в Caddy инертен). Подробно —
[monitoring/README.md](monitoring/README.md).

На cutover: DNS `grafana.panzers.tg → 206.223.241.25`; затем
```bash
rsync -az deploy/monitoring/ deploy@206.223.241.25:/opt/panzers-monitoring/
ssh deploy@206.223.241.25 'cd /opt/panzers-monitoring && cp .env.example .env && \
  sed -i "s/replace-with-strong-password/$(openssl rand -hex 16)/" .env && \
  docker compose --env-file .env up -d'
```
App-метрик (RPS, бои, WS) пока нет — сервер не инструментирован (`/metrics`).

---

## Бэкапы данных (прод) — Q-470

«БД» panzers — файлы в volume `panzers_server_data` (профили/кланы/платежи/настройки
JSON), не Postgres → бэкап = `tar.gz` содержимого volume в общий Timeweb S3
(`umbrella-db-backups`, endpoint `https://s3.twcstorage.ru`, регион `ru-1`), префикс
`panzers/`, lifecycle 7 дней (как у city/holop/minipoly/birds/lobsters).

Настроено на проде `206.223.241.25` (aws-cli v2; cron `deploy` `30 3 * * *` →
[backup-data.sh](backup-data.sh); креды в `/home/deploy/.panzers-backup.env`, 600).
До cutover скрипт корректно пропускает отсутствующий volume. Restore-дрилл пройден.

**Восстановление** (на проде):
```bash
set -a; . /home/deploy/.panzers-backup.env; set +a
DATE=2026-06-29   # нужная дата
KEY=$(aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" \
  s3 ls "s3://$S3_BUCKET/panzers/$DATE/" | awk '{print $4}' | tail -1)
aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" \
  s3 cp "s3://$S3_BUCKET/panzers/$DATE/$KEY" /tmp/restore.tar.gz
docker compose -f /opt/panzers/docker-compose.prod.yml stop server
docker run --rm -v panzers_server_data:/d -v /tmp:/in alpine \
  sh -c 'cd /d && tar xzf /in/restore.tar.gz'     # поверх; для чистого — сперва очистить /d
docker compose -f /opt/panzers/docker-compose.prod.yml start server
```
Новый сервер (смена IP) — добавить `cron` (Ubuntu 26.04 minimal без него; bootstrap
ставит), aws-cli, `.panzers-backup.env`, и правило `panzers/` в bucket lifecycle
(`put-bucket-lifecycle-configuration` ЗАМЕНЯЕТ всё — указывать ВСЕ префиксы разом).

---

## Смена домена потом

Домен нигде не захардкожен. Чтобы сменить:
1. Поправить в окружении `DOMAIN`, `WEBAPP_URL`, `VITE_API_URL`, `VITE_WS_URL`,
   `VITE_AMPLITUDE_PROXY`.
2. Передеплоить (web-образ пересоберётся с новым `VITE_API_URL`, Caddy выпустит
   сертификат на новый домен).
3. Обновить DNS и домен Mini App у @BotFather.
