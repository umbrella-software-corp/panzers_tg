// Лёгкий пер-игроковый журнал событий для админки: «когда заходил, что делал».
// Пишем построчно в data/logs/<uid>.jsonl, держим последние MAX строк (кольцо).
// Это НЕ аналитика (для неё Amplitude) — это быстрый взгляд на одного игрока:
// сессии (open), бои (старт/итог), покупки, выдачи. Гостей (g_) и ботов не пишем.
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const LOGS = path.join(ROOT, 'logs')
const MAX = 400 // строк на игрока (кольцо)
const safe = (uid) => String(uid || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64)

let dirReady = null
const ensureDir = () => (dirReady ||= fs.mkdir(LOGS, { recursive: true }).catch(() => {}))

// очередь записи на каждый файл — чтобы append и подрезка не гонялись
const chain = new Map()

// записать событие игрока. type — короткий код, data — произвольные поля.
// Не throw'ит и не блокирует основной поток: best-effort, ошибки глотаем.
export function logEvent(uid, type, data = {}) {
  const key = safe(uid)
  if (!key.startsWith('tg_')) return // только реальные tg-игроки
  const line = JSON.stringify({ t: Date.now(), type, ...data }) + '\n'
  const prev = chain.get(key) || ensureDir()
  const job = Promise.resolve(prev)
    .then(async () => {
      const file = path.join(LOGS, key + '.jsonl')
      await fs.appendFile(file, line)
      await trimIfBig(file)
    })
    .catch(() => {})
  chain.set(key, job)
  return job
}

// подрезаем хвост, только когда файл реально разросся (stat дёшев; чтение — нет)
async function trimIfBig(file) {
  try {
    const st = await fs.stat(file)
    if (st.size < MAX * 240) return // ~240 байт/строка с запасом
    const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean)
    if (lines.length <= MAX) return
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, lines.slice(-MAX).join('\n') + '\n')
    await fs.rename(tmp, file) // атомарно
  } catch {
    /* нет файла / гонка — не страшно */
  }
}

// прочитать последние limit событий игрока, новые сверху
export async function readEvents(uid, limit = 250) {
  const key = safe(uid)
  if (!key) return []
  try {
    const lines = (await fs.readFile(path.join(LOGS, key + '.jsonl'), 'utf8')).split('\n').filter(Boolean)
    const out = []
    for (const l of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(l))
      } catch {
        /* битая строка */
      }
    }
    return out.reverse()
  } catch {
    return []
  }
}
