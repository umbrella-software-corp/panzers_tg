// Массовая чистка «мёртвых» профилей (реф-ферма: зашёл <1 мин, НИ ОДНОГО боя, не вернулся).
// Это те самые «зашёл-и-исчез (<1мин)» из воронки админки — боты/фейк-клики, что раздувают
// тоталы и «привёл». У такого профиля НОЛЬ прогресса (дефолт 500 кр), поэтому удаление
// безопасно: даже если это был живой человек, на следующем заходе он получит чистый старт
// (идентично тому, что было). Рестарт сервера НЕ нужен — сервер не кэширует профили
// (loadProfile читает файл каждый раз), а критерий «firstSeen старше N часов» исключает
// тех, кто открыл прямо сейчас и ещё в сессии.
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
// нет невыданных pendingGrants. Платежи (payments.json) не трогаем.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const APPLY = has('--apply')
const REF = String(val('--ref', '')).replace(/[^0-9]/g, '')
const MIN_AGE_MS = Math.max(0, +val('--min-age-h', '24')) * 3600e3
const DWELL_MS = Math.max(0, +val('--dwell-s', '60')) * 1000

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data')
const PROFILES = path.join(ROOT, 'profiles')
const now = Date.now()
const refDigits = (v) => String(v || '').replace(/[^0-9]/g, '')

let files = []
try {
  files = (await fs.readdir(PROFILES)).filter((f) => f.endsWith('.json'))
} catch (e) {
  console.error('Не нашёл папку профилей:', PROFILES, '—', e.message)
  process.exit(1)
}

const dead = []
let scanned = 0, battled = 0, lingered = 0, fresh = 0, premium = 0, grants = 0, otherRef = 0
for (const f of files) {
  let p
  try { p = JSON.parse(await fs.readFile(path.join(PROFILES, f), 'utf8')) } catch { continue }
  scanned++
  const uid = f.replace(/\.json$/, '')
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
  try { await fs.unlink(path.join(PROFILES, uid + '.json')); del++ } catch { /* уже нет — ок */ }
}
console.log(`\n✅ УДАЛЕНО: ${del} из ${dead.length}`)
