// Полный сброс игрока (как новый): удаляет профиль и чистит связи (клан, реф-ссылки
// на него). Запуск НА ПРОДЕ из /opt/panzers:
//
//   node deploy/wipe-player.mjs 8870476515
//
// ВАЖНО — два обязательных условия, иначе сброс «не прилипнет»:
//  1) Игрок должен быть НЕ в сети (закрыть мини-апу). Живой сервер держит профиль в
//     памяти и может пересоздать файл из сессии. Порядок: закрыл апу → запустил скрипт.
//  2) На УСТРОЙСТВЕ игрока очистить localStorage — иначе клиент перезальёт старый
//     профиль обратно на сервер при следующем заходе (см. syncProfile). В мини-апе:
//        localStorage.clear(); location.reload()
//  Платежи (payments.json) НЕ трогаем — это финансовый аудит / идемпотентность.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const id = (process.argv[2] || '').replace(/[^0-9]/g, '')
if (!id) {
  console.error('Использование: node deploy/wipe-player.mjs <tg_id>   (напр. 8870476515)')
  process.exit(1)
}
const uid = 'tg_' + id
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data')
const PROFILES = path.join(ROOT, 'profiles')
const CLANS = path.join(ROOT, 'clans')
const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'))
const log = []

// 0) читаем профиль ДО удаления (нужен clanId)
let prof = null
try {
  prof = await readJson(path.join(PROFILES, uid + '.json'))
} catch {
  /* профиля нет — ок, всё равно подчистим хвосты */
}

// 1) удаляем профиль
try {
  await fs.unlink(path.join(PROFILES, uid + '.json'))
  log.push('✓ удалён профиль ' + uid + '.json')
} catch {
  log.push('• профиля ' + uid + '.json не было')
}

// 2) убираем из клана (роспуск пустого / передача старшинства — как leaveClan)
if (prof && prof.clanId) {
  const cf = path.join(CLANS, String(prof.clanId) + '.json')
  try {
    const clan = await readJson(cf)
    clan.members = (clan.members || []).filter((m) => m.uid !== uid)
    if (clan.members.length === 0) {
      await fs.unlink(cf)
      log.push('✓ распущен опустевший клан ' + prof.clanId)
    } else {
      if (clan.leader === uid) clan.leader = clan.members[0].uid // командир ушёл → старшинство первому
      await fs.writeFile(cf, JSON.stringify(clan))
      log.push('✓ убран из клана ' + prof.clanId)
    }
  } catch {
    log.push('• клан ' + prof.clanId + ' не найден')
  }
}

// 3) подчищаем ссылки на него в ЧУЖИХ профилях (referredBy + referralIds)
let scrubbed = 0
try {
  for (const f of (await fs.readdir(PROFILES)).filter((f) => f.endsWith('.json'))) {
    const pp = path.join(PROFILES, f)
    let p
    try {
      p = await readJson(pp)
    } catch {
      continue
    }
    let changed = false
    if (p.referredBy === uid) {
      p.referredBy = null
      changed = true
    }
    if (Array.isArray(p.referralIds) && p.referralIds.includes(uid)) {
      p.referralIds = p.referralIds.filter((x) => x !== uid)
      changed = true
    }
    if (changed) {
      await fs.writeFile(pp, JSON.stringify(p))
      scrubbed++
    }
  }
} catch {
  /* нет папки профилей — нечего чистить */
}
if (scrubbed) log.push('✓ подчищены реф-ссылки на него в ' + scrubbed + ' чужих профилях')

console.log('Сброс игрока ' + uid + ':')
for (const l of log) console.log('  ' + l)
console.log('\n⚠️  Теперь на УСТРОЙСТВЕ игрока очисти localStorage (иначе клиент перезальёт профиль):')
console.log('    localStorage.clear(); location.reload()')
console.log('⚠️  Если игрок был онлайн при сбросе — повтори скрипт после того, как он закроет апу.')
