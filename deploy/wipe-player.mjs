// Полный сброс игрока (как новый): удаляет профиль и чистит связи (клан, реф-ссылки
// на него). Запуск НА ПРОДЕ из /opt/panzers:
//
//   node deploy/wipe-player.mjs 8870476515
//
// ВАЖНО — два обязательных условия, иначе сброс «не прилипнет»:
//  1) Игрок должен быть НЕ в сети (закрыть мини-апу). Живой сервер держит профиль в
//     памяти и может пересоздать запись из сессии. Порядок: закрыл апу → запустил скрипт.
//  2) На УСТРОЙСТВЕ игрока очистить localStorage — иначе клиент перезальёт старый
//     профиль обратно на сервер при следующем заходе (см. syncProfile). В мини-апе:
//        localStorage.clear(); location.reload()
//  Платежи НЕ трогаем — это финансовый аудит / идемпотентность.
//
// Хранилище — Postgres (DATABASE_URL берём из server/.env автоматически).
import { loadEnv, importServer } from './_env.mjs'

const id = (process.argv[2] || '').replace(/[^0-9]/g, '')
if (!id) {
  console.error('Использование: node deploy/wipe-player.mjs <tg_id>   (напр. 8870476515)')
  process.exit(1)
}
const uid = 'tg_' + id

await loadEnv()
const { query } = await importServer('src/pg.js')
const { loadProfile, deleteProfile, saveProfile, loadClan, saveClan, deleteClan } = await importServer('src/db.js')
const { cacheDel } = await importServer('src/redis.js')
const log = []

// 0) читаем профиль ДО удаления (нужен clanId)
const prof = await loadProfile(uid)

// 1) удаляем профиль
if (await deleteProfile(uid)) log.push('✓ удалён профиль ' + uid)
else log.push('• профиля ' + uid + ' не было')

// 2) убираем из клана (роспуск пустого / передача старшинства — как leaveClan)
if (prof && prof.clanId) {
  const clan = await loadClan(prof.clanId)
  if (clan) {
    clan.members = (clan.members || []).filter((m) => m.uid !== uid)
    if (clan.members.length === 0) {
      await deleteClan(prof.clanId)
      log.push('✓ распущен опустевший клан ' + prof.clanId)
    } else {
      if (clan.leader === uid) clan.leader = clan.members[0].uid // командир ушёл → старшинство первому
      await saveClan(prof.clanId, clan)
      log.push('✓ убран из клана ' + prof.clanId)
    }
  } else {
    log.push('• клан ' + prof.clanId + ' не найден')
  }
}

// 3) подчищаем ссылки на него в ЧУЖИХ профилях (referredBy + referralIds)
let scrubbed = 0
const { rows } = await query('SELECT uid, data FROM profiles')
for (const { uid: ouid, data: p } of rows) {
  let changed = false
  if (p.referredBy === uid) { p.referredBy = null; changed = true }
  if (Array.isArray(p.referralIds) && p.referralIds.includes(uid)) {
    p.referralIds = p.referralIds.filter((x) => x !== uid)
    changed = true
  }
  if (changed) { await saveProfile(ouid, p); scrubbed++ }
}
if (scrubbed) log.push('✓ подчищены реф-ссылки на него в ' + scrubbed + ' чужих профилях')

await cacheDel('profiles:list', 'rank:map') // сводка/лидерборд обновятся сразу

console.log('Сброс игрока ' + uid + ':')
for (const l of log) console.log('  ' + l)
console.log('\n⚠️  Теперь на УСТРОЙСТВЕ игрока очисти localStorage (иначе клиент перезальёт профиль):')
console.log('    localStorage.clear(); location.reload()')
console.log('⚠️  Если игрок был онлайн при сбросе — повтори скрипт после того, как он закроет апу.')
process.exit(0)
