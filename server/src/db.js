// Файловое хранилище профилей: data/profiles/<uid>.json (атомарная запись).
// Без внешних зависимостей; на рост — заменить на SQLite/Postgres за тем же API.
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const PROFILES = path.join(ROOT, 'profiles')
const PAYMENTS = path.join(ROOT, 'payments.json')

await fs.mkdir(PROFILES, { recursive: true })

const safe = (uid) => String(uid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)

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
        crewXp: (p.crew && p.crew.xp) || 0,
        tanks: Array.isArray(p.owned) ? p.owned.length : 0,
        updatedAt: p._updatedAt || 0,
      })
    } catch {
      /* битый файл — пропускаем */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}
