-- Panzer TG — схема хранилища (перенос с JSON-файлов на Postgres).
-- Документо-ориентированная: профиль/клан кладутся как JSONB-блоб 1-в-1 с прежней
-- файловой формой; горячие запросы (лидерборд/рейтинг) идут по generated-колонкам + индексу,
-- а не по скану всех строк. Идемпотентна — можно применять повторно (IF NOT EXISTS).

-- ── профили игроков (бывшее data/profiles/<uid>.json) ──────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  uid           text   PRIMARY KEY,
  data          jsonb  NOT NULL,
  -- серверный ms последней записи (== data._updatedAt); клиент сверяет на реоткрытии
  updated_at    bigint NOT NULL,
  -- generated-колонки для индексируемых выборок; источник истины — JSONB.
  -- battles/wn8 лежат в data.stats (как и собирал прежний listProfilesUncached).
  name          text   GENERATED ALWAYS AS (data->>'name') STORED,
  battles       int    GENERATED ALWAYS AS (COALESCE(NULLIF(data->'stats'->>'battles','')::int, 0)) STORED,
  wn8           double precision GENERATED ALWAYS AS (COALESCE(NULLIF(data->'stats'->>'wn8','')::float8, 0)) STORED,
  premium_until bigint GENERATED ALWAYS AS (COALESCE(NULLIF(data->>'premiumUntil','')::bigint, 0)) STORED
);

-- лидерборд/рейтинг: тот же фильтр, что у leaderboard()/ratingRankOf() — имя задано и
-- боёв >= 5 (RATING_MIN_BATTLES). Частичный индекс по wn8 DESC → топ за O(log n).
CREATE INDEX IF NOT EXISTS profiles_rank_idx ON profiles (wn8 DESC)
  WHERE name IS NOT NULL AND name <> '' AND battles >= 5;

-- админ-сводка отдаёт профили свежими сверху (как сортировка по _updatedAt в файлах)
CREATE INDEX IF NOT EXISTS profiles_updated_idx ON profiles (updated_at DESC);

-- ── кланы (бывшее data/clans/<id>.json) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clans (
  id         text   PRIMARY KEY,
  data       jsonb  NOT NULL,
  updated_at bigint NOT NULL
);

-- ── журнал платежей Telegram Stars (бывшее data/payments.json) ──────────────────
-- charge = идемпотентный ключ. Колонки продублированы из info для запросов/отчётов,
-- info хранит полную запись (форвард-совместимость с любыми будущими полями).
CREATE TABLE IF NOT EXISTS payments (
  charge      text   PRIMARY KEY,
  uid         text,
  product_id  text,
  stars       int,
  ts          bigint,
  refunded    boolean NOT NULL DEFAULT false,
  refunded_at bigint,
  info        jsonb
);
CREATE INDEX IF NOT EXISTS payments_ts_idx ON payments (ts DESC);

-- ── единый kv: настройки админки (settings.json) И заявки на турниры (tournaments.json) ──
-- обе сущности — «прочитать/заменить карту целиком», поэтому одна таблица:
--   k = 'setting:<key>'  → значение настройки
--   k = 'tournRegs'      → вся карта { [tournamentId]: [uid, ...] }
CREATE TABLE IF NOT EXISTS kv (
  k text  PRIMARY KEY,
  v jsonb NOT NULL
);
