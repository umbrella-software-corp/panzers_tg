#!/usr/bin/env bash
# Ежедневный бэкап БД panzers (Postgres) в Timeweb S3 (umbrella-db-backups/panzers/).
# Запускается cron'ом под юзером deploy. Паттерн Q-470: pg_dump -Fc в ФАЙЛ, потом
# upload (части файла ретраятся на flaky-S3; стримом пайпом НЕ грузим).
# Redis НЕ бэкапим — это кэш/распр-лок (производное от Postgres). Restore — pg_restore
# (см. deploy/DEPLOY.md → «Бэкапы / восстановление»). Креды/конфиг — в
# /home/deploy/.panzers-backup.env.
#
# Ручной запуск: bash backup-data.sh
set -euo pipefail

ENVF="${PANZERS_BACKUP_ENV:-/home/deploy/.panzers-backup.env}"
[ -f "$ENVF" ] || { echo "backup-data: $ENVF не найден" >&2; exit 1; }
set -a; . "$ENVF"; set +a

: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_PREFIX:?}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
S3_REGION="${S3_REGION:-ru-1}"
PG_CONTAINER="${PG_CONTAINER:-panzers-postgres-1}"
PG_DB="${PG_DB:-panzers}"
PG_USER="${PG_DUMP_USER:-panzers}"    # суперюзер образа (POSTGRES_USER); локальный сокет → trust
LOCAL_KEEP="${LOCAL_KEEP:-14}"
LOCAL_DIR="${LOCAL_DIR:-/home/deploy/panzers-backups}"

# До cutover postgres-контейнера ещё нет — не падаем, чтобы cron оставался зелёным.
CID="$(docker ps -q -f "name=^${PG_CONTAINER}$" | head -1)"
if [ -z "$CID" ]; then
	echo "backup-data: контейнер $PG_CONTAINER не запущен — пропускаю (до cutover это норма)"
	exit 0
fi

DATE="$(date +%F)"
TS="$(date +%F_%H%M%S)"
FILE="panzers-${TS}.dump"
mkdir -p "$LOCAL_DIR"
OUT="$LOCAL_DIR/$FILE"

# pg_dump custom-формат (-Fc) в файл → restore через pg_restore.
docker exec "$CID" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$OUT"

# Upload файла. Адаптивные ретраи под flaky Timeweb S3 (урок Q-470).
AWS_MAX_ATTEMPTS=10 AWS_RETRY_MODE=adaptive \
	aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" --cli-read-timeout 0 \
	s3 cp "$OUT" "s3://$S3_BUCKET/$S3_PREFIX/$DATE/$FILE" --only-show-errors

echo "backup-data: залит s3://$S3_BUCKET/$S3_PREFIX/$DATE/$FILE ($(du -h "$OUT" | cut -f1))"

# Локальная ротация: оставляем последние LOCAL_KEEP. S3 чистит lifecycle (7д).
ls -1t "$LOCAL_DIR"/panzers-*.dump 2>/dev/null | tail -n +"$((LOCAL_KEEP + 1))" | xargs -r rm -f
