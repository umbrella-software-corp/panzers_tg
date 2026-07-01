// Массовая чистка «мёртвых» профилей (реф-ферма: зашёл <1 мин, НИ ОДНОГО боя, не вернулся).
// Это те самые «зашёл-и-исчез (<1мин)» из воронки админки — боты/фейк-клики, что раздувают
// тоталы и «привёл». У такого профиля НОЛЬ прогресса (дефолт 500 кр), поэтому удаление
// безопасно: даже если это был живой человек, на следующем заходе он получит чистый старт
// (идентично тому, что было). Критерий «firstSeen старше N часов» исключает тех, кто открыл
// прямо сейчас и ещё в сессии.
//
// DRY-RUN ПО УМОЛЧАНИЮ (только отчёт, НИЧЕГО не удаляет). Запуск НА ПРОДЕ из /opt/panzers:
//   node deploy/purge-ghosts.mjs                      # отчёт: сколько ghosts всего
//   node deploy/purge-ghosts.mjs --ref 485427336      # отчёт по конкретному рефереру
//   node deploy/purge-ghosts.mjs --apply              # РЕАЛЬНО удалить (все ghosts)
//   node deploy/purge-ghosts.mjs --apply --ref 485427336      # удалить только от реферера
//   node deploy/purge-ghosts.mjs --min-age-h 48 --dwell-s 60   # подстройка порогов
//
// Критерий «ghost» (ВСЕ условия): 0 боёв (reachedBattle=false и stats.battles=0) +
// dwell (lastSeen-firstSeen) < dwell-s + firstSeen старше min-age-h + НЕ премиум +
// нет невыданных pendingGrants. Платежи не трогаем.
//
// Хранилище — Postgres (DATABASE_URL берём из server/.env автоматически).
import { loadEnv, importServer } from './_env.mjs'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const APPLY = has('--apply')
const REF = String(val('--ref', '')).replace(/[^0-9]/g, '')
const MIN_AGE_MS = Math.max(0, +val('--min-age-h', '24')) * 3600e3
const DWELL_MS = Math.max(0, +val('--dwell-s', '60')) * 1000

await loadEnv()
const { query } = await importServer('src/pg.js')
const { deleteProfile } = await importServer('src/db.js')

const now = Date.now()
const refDigits = (v) => String(v || '').replace(/[^0-9]/g, '')

const { rows } = await query('SELECT uid, data FROM profiles')

const dead = []
let scanned = 0, battled = 0, lingered = 0, fresh = 0, premium = 0, grants = 0, otherRef = 0
for (const { uid, data: p } of rows) {
  scanned++
  if (!!p.reachedBattle || (p.stats && p.stats.battles > 0)) { battled++; continue } // играл — не трогаем
  const dwell = (p.lastSeen || 0) - (p.firstSeen || 0)
  if (dwell >= DWELL_MS) { lingered++; continue }                  // полазил ≥ порога — «завис-без-боя», не ghost
  if ((p.firstSeen || 0) > now - MIN_AGE_MS) { fresh++; continue } // открыл недавно — мог ещё не успеть
  if ((p.premiumUntil || 0) > now) { premium++; continue }         // премиум — НИКОГДА не удаляем
  if (Array.isArray(p.pendingGrants) && p.pendingGrants.length) { grants++; continue } // есть невыданная награда
  if (REF && refDigits(p.referredBy) !== REF) { otherRef++; continue } // фильтр по рефереру
  dead.push(uid)
}

console.log('═══ ЧИСТКА ПРИЗРАКОВ ═══')
console.log(`критерий: 0 боёв + dwell<${DWELL_MS / 1000}с + firstSeen старше ${MIN_AGE_MS / 3600e3}ч + не премиум + без pendingGrants${REF ? ` + реферер ${REF}` : ' (все рефереры)'}`)
console.log(`просканировано профилей: ${scanned}`)
console.log(`  играли (пропуск):        ${battled}`)
console.log(`  завис-без-боя (пропуск): ${lingered}`)
console.log(`  свежие <порога (пропуск):${fresh}`)
console.log(`  премиум (пропуск):       ${premium}`)
console.log(`  с грантами (пропуск):    ${grants}`)
if (REF) console.log(`  др. реферер (пропуск):   ${otherRef}`)
console.log(`🎯 ПОД УДАЛЕНИЕ (ghosts):  ${dead.length}`)
console.log('примеры:', dead.slice(0, 12).join(', ') || '—')

if (!APPLY) {
  console.log('\n⚠️  DRY-RUN — ничего НЕ удалено. Чтобы реально удалить, добавь --apply')
  process.exit(0)
}

let del = 0
for (const uid of dead) {
  try { if (await deleteProfile(uid)) del++ } catch { /* гонка — ок */ }
}
console.log(`\n✅ УДАЛЕНО: ${del} из ${dead.length}`)
process.exit(0)
