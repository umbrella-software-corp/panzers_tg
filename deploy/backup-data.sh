#!/usr/bin/env bash
# Ежедневный бэкап файловых данных игроков (docker-volume panzers_server_data:
# profiles/clans/payments/settings/support — JSON) в Timeweb S3
# (umbrella-db-backups/panzers/). Запускается cron'ом под юзером deploy.
#
# Панцеры хранят «БД» файлами, а не в Postgres → дамп = tar.gz содержимого volume.
# Паттерн Q-470: дамп в ФАЙЛ, потом upload (части файла ретраятся на flaky-S3;
# стримом пайпом НЕ грузим). Креды/конфиг — в /home/deploy/.panzers-backup.env.
#
# Ручной запуск:        bash backup-data.sh
# Restore (на сервере): см. deploy/DEPLOY.md → «Бэкапы / восстановление».
set -euo pipefail

ENVF="${PANZERS_BACKUP_ENV:-/home/deploy/.panzers-backup.env}"
[ -f "$ENVF" ] || { echo "backup-data: $ENVF не найден" >&2; exit 1; }
set -a; . "$ENVF"; set +a

: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_PREFIX:?}" "${DATA_VOLUME:?}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
S3_REGION="${S3_REGION:-ru-1}"
LOCAL_KEEP="${LOCAL_KEEP:-14}"
LOCAL_DIR="${LOCAL_DIR:-/home/deploy/panzers-backups}"

# До cutover volume ещё не существует — не падаем, чтобы cron оставался зелёным.
if ! docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
	echo "backup-data: volume $DATA_VOLUME ещё нет — пропускаю (до cutover это норма)"
	exit 0
fi

DATE="$(date +%F)"
TS="$(date +%F_%H%M%S)"
FILE="panzers-data-${TS}.tar.gz"
mkdir -p "$LOCAL_DIR"
OUT="$LOCAL_DIR/$FILE"

# Дамп volume → файл (без серверных логов).
docker run --rm -v "$DATA_VOLUME":/data:ro -v "$LOCAL_DIR":/out alpine \
	tar czf "/out/$FILE" -C /data --exclude='./logs' .

# Upload файла. Адаптивные ретраи под flaky Timeweb S3 (урок Q-470).
AWS_MAX_ATTEMPTS=10 AWS_RETRY_MODE=adaptive \
	aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" --cli-read-timeout 0 \
	s3 cp "$OUT" "s3://$S3_BUCKET/$S3_PREFIX/$DATE/$FILE" --only-show-errors

echo "backup-data: залит s3://$S3_BUCKET/$S3_PREFIX/$DATE/$FILE ($(du -h "$OUT" | cut -f1))"

# Локальная ротация: оставляем последние LOCAL_KEEP. S3 чистит lifecycle (7д).
ls -1t "$LOCAL_DIR"/panzers-data-*.tar.gz 2>/dev/null | tail -n +"$((LOCAL_KEEP + 1))" | xargs -r rm -f
