#!/usr/bin/env bash
# Одноразовый провижининг Postgres + Redis на VPS (Ubuntu/Debian, systemd) и накат схемы.
# Запускать из-под root НА СЕРВЕРЕ, из каталога репозитория (/opt/panzers):
#
#   cd /opt/panzers && bash deploy/db-setup.sh
#
# Идемпотентно: повторный запуск не ломает существующие БД/роль (создаёт, только если нет),
# схему накатывает через IF NOT EXISTS. Пароль БД генерируется один раз и дописывается в
# server/.env (DATABASE_URL/REDIS_URL). PG и Redis слушают только 127.0.0.1 (без внешнего
# доступа — БД на том же хосте, что и сервер).
set -euo pipefail

DIR=/opt/panzers
ENV_FILE="$DIR/server/.env"
DB_NAME=panzers
DB_USER=panzers

echo "== 1/5 установка postgresql + redis (один раз) =="
command -v psql  >/dev/null || (apt-get update -qq && apt-get install -y postgresql postgresql-contrib)
command -v redis-server >/dev/null || apt-get install -y redis-server
systemctl enable --now postgresql
systemctl enable --now redis-server

echo "== 2/5 роль и база $DB_NAME (если ещё нет) =="
# пароль: берём из уже существующего DATABASE_URL в .env, иначе генерируем новый
if [ -f "$ENV_FILE" ] && grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  DB_PASS="$(grep '^DATABASE_URL=' "$ENV_FILE" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"
  echo "  DATABASE_URL уже в .env — переиспользую пароль роли"
else
  DB_PASS="$(openssl rand -hex 24)"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE $DB_USER PASSWORD '$DB_PASS';
  END IF;
END
\$\$;
SELECT 'create db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
SQL
# создаём БД отдельной командой (CREATE DATABASE нельзя в DO-блоке/транзакции)
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

echo "== 3/5 строки подключения в server/.env =="
touch "$ENV_FILE"
DATABASE_URL="postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME"
REDIS_URL="redis://127.0.0.1:6379"
grep -q '^DATABASE_URL=' "$ENV_FILE" || echo "DATABASE_URL=$DATABASE_URL" >> "$ENV_FILE"
grep -q '^REDIS_URL='    "$ENV_FILE" || echo "REDIS_URL=$REDIS_URL"       >> "$ENV_FILE"
echo "  DATABASE_URL/REDIS_URL прописаны (пароль роли — в .env, в логи не печатаем)"

echo "== 4/5 накат схемы (idempotent) =="
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$DIR/server/migrations/001_init.sql"

echo "== 5/5 проверка =="
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT 'tables: '||count(*) FROM information_schema.tables WHERE table_name IN ('profiles','clans','payments','kv');"
redis-cli ping

echo "== Готово. Дальше: финальный бэкфилл данных =="
echo "   systemctl stop panzers"
echo "   cd $DIR/server && node scripts/backfill.mjs"
echo "   systemctl start panzers"
