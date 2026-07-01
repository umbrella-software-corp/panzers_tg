// Пул соединений с Postgres + тонкий query-хелпер. Конфиг — из env DATABASE_URL
// (как и всё остальное на сервере, через systemd EnvironmentFile; без dotenv).
import pg from 'pg'

const { Pool } = pg

// bigint (int8) по умолчанию приходит строкой — для updated_at/ts нам нужны числа.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)))

const url = process.env.DATABASE_URL
if (!url) {
  // Падаем рано и явно: без БД сервер не должен молча стартовать (раньше было файловое
  // хранилище-фоллбэк, теперь источник истины — PG).
  console.error('[pg] DATABASE_URL не задан — укажи строку подключения в server/.env')
  throw new Error('DATABASE_URL is required')
}

export const pool = new Pool({
  connectionString: url,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
})

// не роняем процесс из-за разрыва простаивающего соединения — пул переподнимет
pool.on('error', (err) => console.error('[pg] idle client error:', err.message))

// query(text, params) → result. Тонкая обёртка, чтобы не тащить pool по всему db.js.
export function query(text, params) {
  return pool.query(text, params)
}

// удобный геттер одной строки (или null)
export async function queryOne(text, params) {
  const { rows } = await pool.query(text, params)
  return rows[0] || null
}

// проверка доступности БД на старте (вызывается из index.js при желании)
export async function pgPing() {
  await pool.query('SELECT 1')
}
