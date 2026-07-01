// Redis: распределённый лок (межпроцессный) + кэш горячих выборок.
// ВАЖНЫЙ ПРИНЦИП — graceful degrade: Redis НЕ точка отказа. Если он недоступен,
// каждая операция тихо деградирует:
//   • лок  → просто выполняем fn (на одиночном инстансе порядок уже даёт in-process
//            очередь в db.js; Redis-лок нужен лишь при 2+ инстансах);
//   • кэш  → промах (вызывающий идёт прямо в Postgres).
// Так одиночный сервер переживает падение/отсутствие Redis без простоя.
import Redis from 'ioredis'

const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

let ready = false
let warned = false

// enableOfflineQueue:false — команды при обрыве сразу реджектятся (а не копятся/висят),
// чтобы мы могли мгновенно деградировать, а не блокировать запрос игрока.
export const redis = new Redis(url, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  lazyConnect: false,
  retryStrategy: (times) => Math.min(times * 200, 5000), // переподнимаемся в фоне
})

redis.on('ready', () => {
  ready = true
  warned = false
  console.log('[redis] connected', url.replace(/:\/\/.*@/, '://***@'))
})
redis.on('error', (err) => {
  ready = false
  if (!warned) {
    warned = true
    console.warn('[redis] недоступен — работаем в degraded-режиме (без распр. лока/кэша):', err.message)
  }
})
redis.on('end', () => { ready = false })

export function redisReady() {
  return ready
}

// ── кэш JSON (TTL в секундах). Любая ошибка/недоступность → промах, не кидаем. ──
export async function cacheGetJSON(key) {
  if (!ready) return null
  try {
    const raw = await redis.get(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function cacheSetJSON(key, value, ttlSec) {
  if (!ready) return
  try {
    await redis.set(key, JSON.stringify(value), 'EX', Math.max(1, ttlSec | 0))
  } catch {
    /* кэш — best-effort */
  }
}

export async function cacheDel(...keys) {
  if (!ready || !keys.length) return
  try {
    await redis.del(...keys)
  } catch {
    /* best-effort */
  }
}

// атомарное снятие лока только своим токеном (чужой/протухший не трогаем)
const UNLOCK = 'if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end'

// withRedisLock(key, fn, opts): держим межпроцессный лок на время fn.
// ttlMs — авто-протухание (страховка от мёртвого держателя), waitMs — сколько ждём захват.
// Если Redis недоступен ИЛИ за waitMs не захватили — выполняем fn БЕЗ распр. лока
// (degrade): корректность на одиночном инстансе обеспечивает in-process очередь в db.js.
export async function withRedisLock(key, fn, { ttlMs = 15000, waitMs = 10000 } = {}) {
  if (!ready) return fn()

  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const deadline = Date.now() + waitMs
  let held = false

  try {
    while (Date.now() < deadline) {
      let ok = null
      try {
        ok = await redis.set(key, token, 'PX', ttlMs, 'NX')
      } catch {
        return fn() // Redis отвалился в процессе — деградируем
      }
      if (ok === 'OK') { held = true; break }
      await new Promise((r) => setTimeout(r, 25 + Math.floor(Math.random() * 25)))
    }
  } catch {
    return fn()
  }

  if (!held) {
    // не дождались (редкая контеншн/затык) — не блокируем игрока, идём без распр. лока
    console.warn('[redis] lock wait timeout, degrade:', key)
    return fn()
  }

  try {
    return await fn()
  } finally {
    try { await redis.eval(UNLOCK, 1, key, token) } catch { /* протухнет по TTL */ }
  }
}
