// Хелпер для обслуживающих скриптов (purge-ghosts / wipe-player): подхватывает DATABASE_URL
// (и REDIS_URL) из server/.env, чтобы запускать их как раньше — `node deploy/xxx.mjs` без
// ручного экспорта переменных. + динамический импорт серверных модулей ПОСЛЕ загрузки env
// (важно: pg.js читает DATABASE_URL на инициализации пула).
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.join(__dir, '..', 'server')

// минимальный парсер .env → process.env (без зависимости dotenv). Уже заданные не трогаем.
export async function loadEnv() {
  try {
    const txt = await fs.readFile(path.join(SERVER, '.env'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      const k = m[1]
      const v = m[2].replace(/^["']|["']$/g, '')
      if (!(k in process.env)) process.env[k] = v
    }
  } catch {
    /* нет .env — положимся на уже заданное окружение */
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL не найден (ни в окружении, ни в server/.env). Сначала: bash deploy/db-setup.sh')
    process.exit(1)
  }
}

// динамический импорт серверного модуля по относительному (от server/) пути
export async function importServer(rel) {
  return import(pathToFileURL(path.join(SERVER, rel)).href)
}
