// Одноразовый идемпотентный импорт JSON-файлов → Postgres.
// Читает server/data/{profiles,clans,payments.json,settings.json,tournaments.json} и
// заливает в таблицы (ON CONFLICT DO UPDATE — безопасно к повтору; для финального догона
// при cutover можно прогнать ещё раз). В конце печатает сверку счётчиков.
//
// Запуск (из каталога server):
//   DATABASE_URL=postgres://panzers:***@127.0.0.1:5432/panzers node scripts/backfill.mjs
// Опц.: DATA_DIR=/путь/к/data (по умолчанию ../data относительно этого файла).
import { readFile, readdir } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const DATA = process.env.DATA_DIR || path.join(__dir, '..', 'data')
const MIGRATION = path.join(__dir, '..', 'migrations', '001_init.sql')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL обязателен. Пример:\n  DATABASE_URL=postgres://panzers:***@127.0.0.1:5432/panzers node scripts/backfill.mjs')
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: url })

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}
async function listJsonFiles(dir) {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
}

async function main() {
  console.log('== backfill JSON → Postgres ==')
  console.log('  DATA_DIR:', DATA)

  // 0) схема (идемпотентно)
  await pool.query(await readFile(MIGRATION, 'utf8'))

  // 1) профили
  let profFiles = await listJsonFiles(path.join(DATA, 'profiles'))
  let profOk = 0
  for (const f of profFiles) {
    const uid = f.replace(/\.json$/, '')
    const data = await readJSON(path.join(DATA, 'profiles', f), null)
    if (!data) { console.warn('  ! битый профиль, пропуск:', f); continue }
    const updatedAt = data._updatedAt || Date.now()
    await pool.query(
      `INSERT INTO profiles (uid, data, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (uid) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [uid, data, updatedAt]
    )
    profOk++
  }

  // 2) кланы
  let clanFiles = await listJsonFiles(path.join(DATA, 'clans'))
  let clanOk = 0
  for (const f of clanFiles) {
    const id = f.replace(/\.json$/, '')
    const data = await readJSON(path.join(DATA, 'clans', f), null)
    if (!data) { console.warn('  ! битый клан, пропуск:', f); continue }
    await pool.query(
      `INSERT INTO clans (id, data, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [id, data, data.createdAt || Date.now()]
    )
    clanOk++
  }

  // 3) платежи (совместимость: старый формат — массив строк charge id, новый — объекты)
  const payRaw = await readJSON(path.join(DATA, 'payments.json'), [])
  const payments = (Array.isArray(payRaw) ? payRaw : []).map((p) => (typeof p === 'string' ? { charge: p } : p))
  let payOk = 0
  for (const rec of payments) {
    if (!rec || !rec.charge) continue
    await pool.query(
      `INSERT INTO payments (charge, uid, product_id, stars, ts, refunded, refunded_at, info)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (charge) DO UPDATE SET
           uid = EXCLUDED.uid, product_id = EXCLUDED.product_id, stars = EXCLUDED.stars,
           ts = EXCLUDED.ts, refunded = EXCLUDED.refunded, refunded_at = EXCLUDED.refunded_at,
           info = EXCLUDED.info`,
      [rec.charge, rec.uid ?? null, rec.productId ?? null, rec.stars ?? null,
       rec.ts ?? null, !!rec.refunded, rec.refundedAt ?? null, rec]
    )
    payOk++
  }

  // 4) настройки → kv setting:*
  const settings = await readJSON(path.join(DATA, 'settings.json'), {})
  let setOk = 0
  for (const [k, v] of Object.entries(settings || {})) {
    await pool.query(
      `INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
      ['setting:' + k, JSON.stringify(v)]
    )
    setOk++
  }

  // 5) заявки на турниры → kv tournRegs (вся карта одной записью)
  const tourn = await readJSON(path.join(DATA, 'tournaments.json'), null)
  if (tourn && typeof tourn === 'object') {
    await pool.query(
      `INSERT INTO kv (k, v) VALUES ('tournRegs', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
      [JSON.stringify(tourn)]
    )
  }

  // ── сверка ──
  const cnt = async (sql) => (await pool.query(sql)).rows[0].n
  const dbProf = await cnt('SELECT count(*)::int AS n FROM profiles')
  const dbClan = await cnt('SELECT count(*)::int AS n FROM clans')
  const dbPay = await cnt('SELECT count(*)::int AS n FROM payments')

  console.log('\n== сверка (файлов → залито → в БД) ==')
  console.log(`  профили:  ${profFiles.length} → ${profOk} → ${dbProf}  ${dbProf >= profOk ? 'OK' : '⚠️'}`)
  console.log(`  кланы:    ${clanFiles.length} → ${clanOk} → ${dbClan}  ${dbClan >= clanOk ? 'OK' : '⚠️'}`)
  console.log(`  платежи:  ${payments.length} → ${payOk} → ${dbPay}  ${dbPay >= payOk ? 'OK' : '⚠️'}`)
  console.log(`  настройки: ${setOk}, турниры: ${tourn ? 'есть' : 'нет'}`)

  const mismatch = profOk !== profFiles.length || clanOk !== clanFiles.length
  await pool.end()
  if (mismatch) {
    console.error('\n⚠️ часть файлов не залита (битые JSON выше) — разберись перед cutover')
    process.exit(2)
  }
  console.log('\n✅ backfill завершён')
}

main().catch((e) => { console.error('backfill упал:', e); process.exit(1) })
