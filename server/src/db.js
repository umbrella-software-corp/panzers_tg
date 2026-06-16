// Файловое хранилище профилей: data/profiles/<uid>.json (атомарная запись).
// Без внешних зависимостей; на рост — заменить на SQLite/Postgres за тем же API.
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const PROFILES = path.join(ROOT, 'profiles')
const CLANS = path.join(ROOT, 'clans')
const PAYMENTS = path.join(ROOT, 'payments.json')
const SETTINGS = path.join(ROOT, 'settings.json')

await fs.mkdir(PROFILES, { recursive: true })
await fs.mkdir(CLANS, { recursive: true })

// настройки сервера (флаги админки: турниры вкл/выкл и т.п.)
let settings = null
async function loadSettings() {
  if (settings) return settings
  try {
    settings = JSON.parse(await fs.readFile(SETTINGS, 'utf8'))
  } catch {
    settings = {}
  }
  return settings
}
export async function getSetting(key, def = null) {
  const s = await loadSettings()
  return key in s ? s[key] : def
}
export async function setSetting(key, value) {
  const s = await loadSettings()
  s[key] = value
  const tmp = `${SETTINGS}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(s))
  await fs.rename(tmp, SETTINGS)
  return s
}

// заявки на турниры: data/tournaments.json = { [tournamentId]: [uid, ...] }.
// Каталог форматов статичен (в коде), здесь храним только КТО нажал «участвую».
const TOURNAMENTS = path.join(ROOT, 'tournaments.json')
let tourn = null
export async function getTournRegs() {
  if (tourn) return tourn
  try {
    tourn = JSON.parse(await fs.readFile(TOURNAMENTS, 'utf8'))
  } catch {
    tourn = {}
  }
  return tourn
}
export async function saveTournRegs(map) {
  tourn = map
  const tmp = `${TOURNAMENTS}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(map))
  await fs.rename(tmp, TOURNAMENTS)
  return map
}

// набор uid с РЕАЛЬНО оплаченным премиумом (платёж prem, не возвращён). Корона ♛
// выдаётся только при наличии платежа: premiumUntil клиент мог проставить себе
// сам сейвом профиля (дыра закрыта в index.js), а старые фейки гасим этой сверкой.
async function paidPremiumUids() {
  const set = new Set()
  for (const pay of await listPayments()) if (pay.productId === 'prem' && !pay.refunded) set.add(pay.uid)
  return set
}

// топ игроков по боевому рейтингу (по эффективности — wn8) для живой таблицы лидеров.
// Поле rating в ответе = wn8 (клиент показывает его как «боевой рейтинг»).
export async function leaderboard(limit = 20) {
  const all = await listProfiles()
  const paid = await paidPremiumUids()
  const now = Date.now()
  return all
    .filter((p) => p.name)
    .sort((a, b) => (b.wn8 || 0) - (a.wn8 || 0))
    .slice(0, limit)
    .map((p, i) => ({ place: i + 1, name: p.name, rating: p.wn8 || 0, battles: p.battles, wins: p.wins, premium: (p.premiumUntil || 0) > now && paid.has(p.uid) }))
}

// публичный профиль игрока по МЕСТУ в таблице (без утечки tg-id наружу):
// стата + любимая техника (самая частая в истории боёв)
export async function playerByRank(rank) {
  const sorted = (await listProfiles()).filter((p) => p.name).sort((a, b) => (b.wn8 || 0) - (a.wn8 || 0))
  const row = sorted[rank - 1]
  if (!row) return null
  const paid = await paidPremiumUids()
  const p = (await loadProfile(row.uid)) || {}
  const s = p.stats || {}
  let favoriteTank = null
  if (Array.isArray(p.history) && p.history.length) {
    const c = {}
    for (const h of p.history) if (h.tank) c[h.tank] = (c[h.tank] || 0) + 1
    favoriteTank = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  }
  return {
    place: rank,
    name: p.name || row.name || 'Боец',
    rating: s.wn8 ?? row.wn8 ?? 0, // боевой рейтинг по эффективности

    battles: s.battles ?? row.battles ?? 0,
    wins: s.wins ?? row.wins ?? 0,
    kills: s.kills || 0,
    tank: p.selectedTank || null, // id текущей машины (для спрайта)
    favoriteTank, // имя самой частой машины в истории
    medals: p.medals || {}, // медали игрока (карточка показывает их в гриде)
    premium: (p.premiumUntil || 0) > Date.now() && paid.has(row.uid),
  }
}

const safe = (uid) => String(uid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)

// метка источника трафика из start_param (?startapp=…): ref_/sq_ — это НЕ трафик
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

export async function loadProfile(uid) {
  try {
    return JSON.parse(await fs.readFile(path.join(PROFILES, safe(uid) + '.json'), 'utf8'))
  } catch {
    return null
  }
}

// записи одного uid сериализуем цепочкой, tmp-файл уникален — конкурентные
// сейвы не делят файл и не портят друг друга
const saveChain = new Map()
let tmpSeq = 0
export async function saveProfile(uid, profile) {
  const key = safe(uid)
  const prev = saveChain.get(key) || Promise.resolve()
  const job = prev.then(async () => {
    const file = path.join(PROFILES, key + '.json')
    const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`
    const data = JSON.stringify({ ...profile, _updatedAt: Date.now() })
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, file) // атомарно — не побьём профиль при падении
  })
  saveChain.set(key, job.catch(() => {}))
  if (saveChain.size > 5000) {
    // не копим завершённые цепочки вечно
    for (const [k, p] of saveChain) {
      if (p !== job) saveChain.delete(k)
      if (saveChain.size <= 2500) break
    }
  }
  return job
}

// серверно-авторитетный «дошёл до боя»: помечаем профиль вошедшего в бой (по uid),
// чтобы воронка не зависела от того, до-сохранил ли клиент stats.battles (а он часто
// не доезжает → реально игравшие падали в «завис без боя»). reachedMem гасит повторные
// записи. Нет профиля ещё — НЕ кэшируем в reachedMem, пометим при следующем бое.
const reachedMem = new Set()
export async function markReachedBattle(uid) {
  if (!uid || reachedMem.has(uid)) return
  try {
    const p = await loadProfile(uid)
    if (!p) return
    reachedMem.add(uid)
    if (p.reachedBattle) return
    p.reachedBattle = true
    if (!p.firstBattleAt) p.firstBattleAt = Date.now()
    profilesCache = null // сводка для админки обновится сразу, не через 5с
    await saveProfile(uid, p)
  } catch {
    /* профиль битый/гонка — не критично, пометим в следующий бой */
  }
}

// журнал платежей: и идемпотентность по charge id, и записи для админки.
// Совместимость: старый формат — массив строк charge id, новый — объекты
// { charge, uid, productId, stars, ts }.
let paid = null
async function loadPaid() {
  if (paid) return paid
  try {
    const raw = JSON.parse(await fs.readFile(PAYMENTS, 'utf8'))
    paid = raw.map((p) => (typeof p === 'string' ? { charge: p } : p))
  } catch {
    paid = []
  }
  return paid
}

export async function paymentSeen(chargeId) {
  return (await loadPaid()).some((p) => p.charge === chargeId)
}

export async function markPayment(chargeId, info = {}) {
  const list = await loadPaid()
  list.push({ charge: chargeId, ts: Date.now(), ...info })
  // атомарно: журнал оплат терять при падении нельзя
  const tmp = `${PAYMENTS}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(list))
  await fs.rename(tmp, PAYMENTS)
}

export async function listPayments() {
  return [...(await loadPaid())].reverse() // свежие сверху
}

// пометить платёж возвращённым (admin-рефанд) — чтобы не вернуть дважды
export async function markRefunded(chargeId) {
  const list = await loadPaid()
  const rec = list.find((p) => p.charge === chargeId)
  if (!rec) return false
  rec.refunded = true
  rec.refundedAt = Date.now()
  const tmp = `${PAYMENTS}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(list))
  await fs.rename(tmp, PAYMENTS)
  return true
}

// сводка профилей для админки; чтение всех файлов кэшируем на 5с —
// поллинг админки не должен молотить диск на каждый запрос
let profilesCache = null
let profilesCacheAt = 0
export async function listProfiles() {
  if (profilesCache && Date.now() - profilesCacheAt < 5000) return profilesCache
  const out = await listProfilesUncached()
  profilesCache = out
  profilesCacheAt = Date.now()
  return out
}

// ===== кланы: data/clans/<id>.json (атомарная запись, как у профилей) =====
let clansCache = null
let clansCacheAt = 0
export async function loadClan(id) {
  try {
    return JSON.parse(await fs.readFile(path.join(CLANS, safe(id) + '.json'), 'utf8'))
  } catch {
    return null
  }
}
const clanChain = new Map()
export async function saveClan(id, clan) {
  clansCache = null // инвалидируем кэш списка
  const key = safe(id)
  const prev = clanChain.get(key) || Promise.resolve()
  const job = prev.then(async () => {
    const file = path.join(CLANS, key + '.json')
    const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`
    await fs.writeFile(tmp, JSON.stringify(clan))
    await fs.rename(tmp, file)
  })
  clanChain.set(key, job.catch(() => {}))
  return job
}
export async function deleteClan(id) {
  clansCache = null
  try {
    await fs.unlink(path.join(CLANS, safe(id) + '.json'))
  } catch {
    /* нет файла — ок */
  }
}
// все кланы (кэш 5с) — для списка/таблицы кланов
export async function listClans() {
  if (clansCache && Date.now() - clansCacheAt < 5000) return clansCache
  let files = []
  try {
    files = (await fs.readdir(CLANS)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const f of files) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(CLANS, f), 'utf8')))
    } catch {
      /* битый файл — пропускаем */
    }
  }
  clansCache = out
  clansCacheAt = Date.now()
  return out
}

async function listProfilesUncached() {
  let files = []
  try {
    files = (await fs.readdir(PROFILES)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const f of files) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(PROFILES, f), 'utf8'))
      out.push({
        uid: f.replace(/\.json$/, ''),
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
        premiumUntil: p.premiumUntil || 0, // для отметки ★ премиум в таблице лидеров
        updatedAt: p._updatedAt || 0,
        src: p.src || null, // метка источника трафика (атрибуция)
        referredBy: p.referredBy || null, // кто привёл (tg_<id> реферера) — для воронки по реф-ссылке
        reachedBattle: !!p.reachedBattle, // серверный факт входа в бой (надёжнее клиентского battles)
        firstSeen: p.firstSeen || p._updatedAt || 0,
        lastSeen: p.lastSeen || p._updatedAt || 0,
      })
    } catch {
      /* битый файл — пропускаем */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}
