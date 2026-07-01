// Хранилище состояния игры на Postgres (JSONB) + Redis (кэш/распр. лок).
// Раньше это были JSON-файлы (data/profiles/<uid>.json и т.д.); см. историю git и
// server/migrations/001_init.sql. Экспортируемый API НЕ менялся — остальные файлы
// сервера зовут те же функции с теми же сигнатурами и возвратами.
//
// Документо-ориентированно: профиль/клан кладутся как JSONB-блоб 1-в-1 с прежней формой.
// Горячие выборки (лидерборд/рейтинг) идут по generated-колонкам + индексу, а не сканом.
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { query, queryOne } from './pg.js'
import { cacheGetJSON, cacheSetJSON, cacheDel, withRedisLock } from './redis.js'

// минимум боёв для попадания в рейтинг/лидерборд (фидбек: «чел с 3 боёв и 100% винрейта
// выше всех» — WN8 на малой выборке раздувается). ЗЕРКАЛО client meta.js И SQL-индекса
// profiles_rank_idx (battles >= 5) в migrations/001_init.sql.
const RATING_MIN_BATTLES = 5

// ── авто-применение схемы на старте (идемпотентно, IF NOT EXISTS) ──────────────
// Раньше db.js делал top-level `await fs.mkdir(...)`; здесь аналогично гарантируем,
// что таблицы есть. На проде это no-op (схему уже накатил db-setup.sh/backfill),
// в деве — «просто работает» без отдельного шага миграции.
// PG jsonb ОТВЕРГАЕТ непарные UTF-16 суррогаты (обрезанные эмодзи в именах игроков из
// Telegram — файловый JSON их проглатывал, PG нет: «low surrogate must follow a high
// surrogate»). Вырезаем перед вставкой — иначе saveProfile упадёт и игрок ПОТЕРЯЕТ прогресс.
// ВАЖНО: JSON.stringify (well-formed, ES2019+) сам экранирует одиночный суррогат в текст
// `\udXXX`, поэтому чистим ИМЕННО escape-последовательности в готовом JSON (валидные пары
// эмодзи stringify выводит литералом и НЕ экранирует → их не трогаем). Второй replace —
// защита на случай сырых код-юнитов. Отдаём JSON-строку под ::jsonb-каст.
const toJsonb = (obj) =>
  JSON.stringify(obj)
    .replace(/\\ud[89a-f][0-9a-f]{2}/gi, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')

const __dir = path.dirname(fileURLToPath(import.meta.url))
async function ensureSchema() {
  const sql = await readFile(path.join(__dir, '..', 'migrations', '001_init.sql'), 'utf8')
  await query(sql)
}
await ensureSchema()

// ════════════════════════ ПРОФИЛИ ════════════════════════

export async function loadProfile(uid) {
  const row = await queryOne('SELECT data FROM profiles WHERE uid = $1', [String(uid)])
  return row ? row.data : null
}

// возвращает версию записи (серверные часы, ms) — клиент сверяет её на реоткрытии.
// _updatedAt кладём в сам JSON (как прежде) для обратной совместимости с клиентом,
// и дублируем в колонку updated_at для сортировок/индексов.
export async function saveProfile(uid, profile) {
  const stamp = Date.now()
  const data = { ...profile, _updatedAt: stamp }
  await query(
    `INSERT INTO profiles (uid, data, updated_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (uid) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [String(uid), toJsonb(data), stamp]
  )
  return stamp
}

// КРИТИЧЕСКАЯ СЕКЦИЯ НА ОДИН uid: сериализует ВЕСЬ цикл load→mutate→save. Без неё два
// писателя одного профиля делают lost-update (так пропадали награды и админ-выдачи).
// Два слоя: (1) in-process promise-цепочка по uid — порядок и сериализация ВНУТРИ процесса
// (как было в файловой версии); (2) Redis-лок plock:<uid> — сериализация МЕЖДУ процессами
// (на будущее, под 2+ инстанса). Redis недоступен → слой (2) деградирует, корректность на
// одиночном инстансе держит слой (1).
// ВАЖНО: внутри fn НЕЛЬЗЯ брать лок на ДРУГОЙ uid (дедлок) — для двух профилей берём локи
// последовательно, не вложенно (см. registerReferral).
const profileLocks = new Map()
export function withProfileLock(uid, fn) {
  const key = String(uid)
  const prev = profileLocks.get(key) || Promise.resolve()
  const guarded = () => withRedisLock('plock:' + key, fn)
  const run = prev.then(guarded, guarded) // продолжаем цепочку и после ошибки предыдущего
  const tail = run.then(() => {}, () => {})
  profileLocks.set(key, tail)
  tail.then(() => { if (profileLocks.get(key) === tail) profileLocks.delete(key) }) // не копим Map
  return run
}

// удаление профиля. Живой сервер сам профили НЕ удаляет — это для обслуживающих скриптов
// (deploy/purge-ghosts.mjs — чистка реф-фермы, deploy/wipe-player.mjs — сброс игрока).
// Инвалидируем кэш сводки и карту рейтинга, чтобы админка/лидерборд обновились сразу.
export async function deleteProfile(uid) {
  const res = await query('DELETE FROM profiles WHERE uid = $1', [String(uid)])
  await cacheDel(PROFILES_LIST_KEY, 'rank:map')
  return res.rowCount > 0
}

// серверно-авторитетный «дошёл до боя»: помечаем профиль вошедшего в бой. reachedMem гасит
// повторные записи в рамках процесса. Нет профиля ещё — НЕ кэшируем (пометим в след. бой).
const reachedMem = new Set()
export async function markReachedBattle(uid) {
  if (!uid || reachedMem.has(uid)) return
  return withProfileLock(uid, async () => {
    try {
      const p = await loadProfile(uid)
      if (!p) return
      reachedMem.add(uid)
      if (p.reachedBattle) return
      p.reachedBattle = true
      if (!p.firstBattleAt) p.firstBattleAt = Date.now()
      await saveProfile(uid, p)
      await cacheDel(PROFILES_LIST_KEY) // сводка админки обновится сразу, не через 5с
    } catch {
      /* профиль битый/гонка — не критично, пометим в следующий бой */
    }
  })
}

// серверный СЧЁТЧИК боёв: +1 при КАЖДОМ входе в бой (без reachedMem — считаем каждый матч).
export async function recordBattleEntry(uid) {
  if (!uid) return
  return withProfileLock(uid, async () => {
    try {
      const p = await loadProfile(uid)
      if (!p) return
      p.reachedBattle = true
      const nowTs = Date.now()
      if (!p.firstBattleAt) p.firstBattleAt = nowTs
      p.lastBattleAt = nowTs // для «сыграли бой сегодня» (МСК)
      p.srvBattles = (p.srvBattles | 0) + 1
      await saveProfile(uid, p)
      await cacheDel(PROFILES_LIST_KEY)
    } catch {
      /* гонка/битый профиль — не критично */
    }
  })
}

// проекция профиля для админ-сводки (тот же набор полей, что отдавала файловая версия).
function profileSummary(uid, p) {
  return {
    uid,
    name: p.name || '',
    credits: p.credits || 0,
    tokens: p.tokens || 0,
    goldAmmo: p.goldAmmo || 0,
    battles: (p.stats && p.stats.battles) || 0,
    wins: (p.stats && p.stats.wins) || 0,
    rating: (p.stats && p.stats.rating) || 0,
    wn8: (p.stats && p.stats.wn8) || 0, // боевой рейтинг по эффективности
    crewXp: (p.crew && p.crew.xp) || 0,
    tanks: Array.isArray(p.owned) ? p.owned.length : 0,
    premiumUntil: p.premiumUntil || 0,
    updatedAt: p._updatedAt || 0,
    src: p.src || null,
    referredBy: p.referredBy || null,
    reachedBattle: !!p.reachedBattle,
    srvBattles: p.srvBattles | 0,
    pushBlocked: !!p.pushBlocked,
    pushOff: !!p.pushOff,
    used3D: !!p.used3D,
    firstSeen: p.firstSeen || p._updatedAt || 0,
    lastSeen: p.lastSeen || p._updatedAt || 0,
    lastBattleAt: p.lastBattleAt || 0,
    firstBattleAt: p.firstBattleAt || 0,
  }
}

// сводка всех профилей для админки; кэш 5с (Redis, общий для инстансов; промах при отсутствии
// Redis = прямой запрос к PG). Свежие сверху — как сортировка по _updatedAt в файловой версии.
const PROFILES_LIST_KEY = 'profiles:list'
export async function listProfiles() {
  const cached = await cacheGetJSON(PROFILES_LIST_KEY)
  if (cached) return cached
  const { rows } = await query('SELECT uid, data FROM profiles ORDER BY updated_at DESC')
  const out = rows.map((r) => profileSummary(r.uid, r.data))
  await cacheSetJSON(PROFILES_LIST_KEY, out, 5)
  return out
}

// ════════════════════════ ЛИДЕРБОРД / РЕЙТИНГ ════════════════════════

// топ игроков по боевому рейтингу (wn8) — индексированная выборка (profiles_rank_idx).
// КОРОНА ♛: активный премиум (premium_until > now); premiumUntil server-authoritative
// (защищён в merge index.js, клиент не проставит сам) → доверяем напрямую.
export async function leaderboard(limit = 20) {
  const now = Date.now()
  const { rows } = await query(
    `SELECT name, wn8, battles,
            COALESCE(NULLIF(data->'stats'->>'wins','')::int, 0) AS wins,
            premium_until
       FROM profiles
      WHERE name IS NOT NULL AND name <> '' AND battles >= $1
      ORDER BY wn8 DESC
      LIMIT $2`,
    [RATING_MIN_BATTLES, limit]
  )
  return rows.map((r, i) => ({
    place: i + 1,
    name: r.name,
    rating: r.wn8 || 0,
    battles: r.battles,
    wins: r.wins,
    premium: (r.premium_until || 0) > now,
  }))
}

// МЕСТО игрока в рейтинге (множитель кредитов за бой). Полная сортировка дорога на каждый
// бой → кэшируем карту uid→место на 60с (Redis, общий + per-process быстрый путь).
let _rankMap = null
let _rankAt = 0
async function rankMap() {
  const now = Date.now()
  if (_rankMap && now - _rankAt < 60000) return _rankMap // быстрый путь в процессе
  const cached = await cacheGetJSON('rank:map')
  if (cached) {
    _rankMap = new Map(Object.entries(cached))
    _rankAt = now
    return _rankMap
  }
  const { rows } = await query(
    `SELECT uid FROM profiles
      WHERE name IS NOT NULL AND name <> '' AND battles >= $1
      ORDER BY wn8 DESC`,
    [RATING_MIN_BATTLES]
  )
  const obj = {}
  rows.forEach((r, i) => { obj[r.uid] = i + 1 })
  _rankMap = new Map(Object.entries(obj))
  _rankAt = now
  await cacheSetJSON('rank:map', obj, 60)
  return _rankMap
}
export async function ratingRankOf(uid) {
  const m = await rankMap()
  return m.get(String(uid)) || Infinity // нет в таблице (мало боёв) → без бонуса
}

// набор uid с РЕАЛЬНО оплаченным премиумом (платёж prem, не возвращён) — для короны в карточке
async function paidPremiumUids() {
  const { rows } = await query(
    `SELECT uid FROM payments WHERE product_id = 'prem' AND refunded = false AND uid IS NOT NULL`
  )
  return new Set(rows.map((r) => r.uid))
}

// публичный профиль игрока по МЕСТУ в таблице (без утечки tg-id): стата + любимая техника
export async function playerByRank(rank) {
  const row = await queryOne(
    `SELECT uid, data FROM profiles
      WHERE name IS NOT NULL AND name <> '' AND battles >= $1
      ORDER BY wn8 DESC OFFSET $2 LIMIT 1`,
    [RATING_MIN_BATTLES, Math.max(0, rank - 1)]
  )
  if (!row) return null
  const p = row.data || {}
  const s = p.stats || {}
  const paid = await paidPremiumUids()
  let favoriteTank = null
  if (Array.isArray(p.history) && p.history.length) {
    const c = {}
    for (const h of p.history) if (h.tank) c[h.tank] = (c[h.tank] || 0) + 1
    favoriteTank = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  }
  return {
    place: rank,
    name: p.name || 'Боец',
    rating: s.wn8 ?? 0, // боевой рейтинг по эффективности
    battles: s.battles ?? 0,
    wins: s.wins ?? 0,
    kills: s.kills || 0,
    tank: p.selectedTank || null,
    favoriteTank,
    medals: p.medals || {},
    premium: (p.premiumUntil || 0) > Date.now() && paid.has(row.uid),
  }
}

// метка источника трафика из start_param (?startapp=…): ref_/sq_ — НЕ трафик
// (игрок-реферал/взвод), всё прочее — источник; срезаем префикс src_/s_, чистим
export function srcTag(sp) {
  if (!sp || typeof sp !== 'string') return null
  if (/^(ref|sq)_/i.test(sp)) return null
  const tag = sp
    .replace(/^s(rc)?[-_]/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32)
  return tag || null
}

// ════════════════════════ ПЛАТЕЖИ ════════════════════════
// журнал платежей: идемпотентность по charge id + записи для админки.

export async function paymentSeen(chargeId) {
  const row = await queryOne('SELECT 1 FROM payments WHERE charge = $1', [chargeId])
  return !!row
}

export async function markPayment(chargeId, info = {}) {
  const ts = Date.now()
  const rec = { charge: chargeId, ts, ...info } // полная запись в info (как прежний объект)
  await query(
    `INSERT INTO payments (charge, uid, product_id, stars, ts, info)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (charge) DO NOTHING`,
    [chargeId, info.uid ?? null, info.productId ?? null, info.stars ?? null, ts, rec]
  )
}

// свежие сверху; форма записи = прежняя ({charge, uid, productId, stars, ts, refunded?, refundedAt?})
export async function listPayments() {
  const { rows } = await query('SELECT info, refunded, refunded_at FROM payments ORDER BY ts DESC')
  return rows.map((r) => ({ ...r.info, refunded: r.refunded, refundedAt: r.refunded_at || undefined }))
}

// пометить платёж возвращённым (admin-рефанд) — чтобы не вернуть дважды
export async function markRefunded(chargeId) {
  const res = await query(
    'UPDATE payments SET refunded = true, refunded_at = $2 WHERE charge = $1',
    [chargeId, Date.now()]
  )
  return res.rowCount > 0
}

// ════════════════════════ НАСТРОЙКИ (kv: setting:*) ════════════════════════

export async function getSetting(key, def = null) {
  const row = await queryOne('SELECT v FROM kv WHERE k = $1', ['setting:' + key])
  return row ? row.v : def
}

// возвращает полную карту настроек (как файловая версия возвращала весь settings-объект)
async function allSettings() {
  const { rows } = await query("SELECT k, v FROM kv WHERE k LIKE 'setting:%'")
  const s = {}
  for (const r of rows) s[r.k.slice('setting:'.length)] = r.v
  return s
}
export async function setSetting(key, value) {
  await query(
    `INSERT INTO kv (k, v) VALUES ($1, $2)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
    ['setting:' + key, JSON.stringify(value)]
  )
  return allSettings()
}

// ════════════════════════ ТУРНИРЫ (kv: tournRegs) ════════════════════════
// каталог форматов статичен (в коде); тут только КТО нажал «участвую»: { [tournId]: [uid, ...] }

export async function getTournRegs() {
  const row = await queryOne('SELECT v FROM kv WHERE k = $1', ['tournRegs'])
  return row ? row.v : {}
}
export async function saveTournRegs(map) {
  await query(
    `INSERT INTO kv (k, v) VALUES ('tournRegs', $1)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
    [JSON.stringify(map)]
  )
  return map
}

// ════════════════════════ КЛАНЫ ════════════════════════

export async function loadClan(id) {
  const row = await queryOne('SELECT data FROM clans WHERE id = $1', [String(id)])
  return row ? row.data : null
}
export async function saveClan(id, clan) {
  await query(
    `INSERT INTO clans (id, data, updated_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [String(id), toJsonb(clan), Date.now()]
  )
  await cacheDel(CLANS_LIST_KEY) // инвалидируем кэш списка
}
export async function deleteClan(id) {
  await query('DELETE FROM clans WHERE id = $1', [String(id)])
  await cacheDel(CLANS_LIST_KEY)
}
// все кланы (кэш 5с) — для списка/таблицы кланов
const CLANS_LIST_KEY = 'clans:list'
export async function listClans() {
  const cached = await cacheGetJSON(CLANS_LIST_KEY)
  if (cached) return cached
  const { rows } = await query('SELECT data FROM clans')
  const out = rows.map((r) => r.data)
  await cacheSetJSON(CLANS_LIST_KEY, out, 5)
  return out
}
