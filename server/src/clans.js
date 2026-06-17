// Кланы (простые): название, тег, эмблема, рейтинг (средний боевой рейтинг
// участников), состав. Один клан на игрока (profile.clanId). Серверная истина:
// членство меняют ТОЛЬКО эти функции, обычный сейв профиля clanId не трогает.
import { loadClan, saveClan, deleteClan, listClans, loadProfile, saveProfile, withProfileLock, listProfiles } from './db.js'

const MAX_MEMBERS = 20
const TAG_RE = /^[A-Za-zА-Яа-я0-9]{2,5}$/
const EMBLEMS = new Set(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'])

const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 22)
const cleanTag = (s) => String(s || '').trim().slice(0, 5)
const newId = () => 'clan_' + Math.random().toString(36).slice(2, 10)

// uid -> { wn8, name } из сводки профилей (кэш 5с) — чтобы не грузить файлы по одному
async function statMap() {
  const m = new Map()
  for (const p of await listProfiles()) m.set(p.uid, { rating: p.wn8 || 0, name: p.name || '' })
  return m
}

// клан с актуальными именами/рейтингами участников + средний рейтинг клана
function viewClan(clan, sm) {
  const members = (clan.members || []).map((mem) => {
    const s = sm.get(mem.uid)
    return { uid: mem.uid, name: (s && s.name) || mem.name || 'Боец', rating: s ? s.rating : mem.rating || 0, leader: mem.uid === clan.leader }
  })
  members.sort((a, b) => b.rating - a.rating)
  const rating = members.length ? Math.round(members.reduce((acc, x) => acc + x.rating, 0) / members.length) : 0
  return { id: clan.id, name: clan.name, tag: clan.tag, emblem: clan.emblem, leader: clan.leader, rating, size: members.length, members }
}

// публичная карточка клана (без tg-id наружу в списке — оставляем uid только тут)
export async function getClan(id) {
  const clan = await loadClan(String(id || ''))
  if (!clan) return null
  return viewClan(clan, await statMap())
}

// клан текущего игрока (или null)
export async function myClan(uid) {
  const p = await loadProfile(uid)
  if (!p || !p.clanId) return null
  return getClan(p.clanId)
}

// список кланов для таблицы (по среднему рейтингу), без состава
export async function listClansView(limit = 30) {
  const sm = await statMap()
  return (await listClans())
    .map((c) => {
      const v = viewClan(c, sm)
      return { id: v.id, name: v.name, tag: v.tag, emblem: v.emblem, rating: v.rating, size: v.size }
    })
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit)
}

export async function createClan(uid, name, tag, emblem) {
  const nm = cleanName(name)
  const tg = cleanTag(tag)
  if (nm.length < 3) return { error: 'bad name' }
  if (!TAG_RE.test(tg)) return { error: 'bad tag' }
  if (!EMBLEMS.has(emblem)) return { error: 'bad emblem' }
  const p = await loadProfile(uid)
  if (!p) return { error: 'no profile' }
  if (p.clanId) return { error: 'already in clan' }
  // тег уникален (без регистра)
  const taken = (await listClans()).some((c) => c.tag.toLowerCase() === tg.toLowerCase())
  if (taken) return { error: 'tag taken' }
  const id = newId()
  const clan = { id, name: nm, tag: tg, emblem, leader: uid, members: [{ uid, name: p.name || 'Боец' }], createdAt: Date.now() }
  await saveClan(id, clan)
  // профиль перечитываем ПОД локом и пишем свежий — иначе сейв затёр бы параллельную
  // выдачу/прогресс (clanId/clanTag — единственное, что меняем)
  await withProfileLock(uid, async () => {
    const pr = (await loadProfile(uid)) || p
    pr.clanId = id
    pr.clanTag = tg
    await saveProfile(uid, pr)
  })
  return viewClan(clan, await statMap())
}

export async function joinClan(uid, clanId) {
  const clan = await loadClan(String(clanId || ''))
  if (!clan) return { error: 'not found' }
  const p = await loadProfile(uid)
  if (!p) return { error: 'no profile' }
  if (p.clanId && p.clanId !== clan.id) return { error: 'already in clan' }
  if (!clan.members.some((m) => m.uid === uid)) {
    if (clan.members.length >= MAX_MEMBERS) return { error: 'full' }
    clan.members.push({ uid, name: p.name || 'Боец' })
    await saveClan(clan.id, clan)
  }
  await withProfileLock(uid, async () => {
    const pr = (await loadProfile(uid)) || p
    pr.clanId = clan.id
    pr.clanTag = clan.tag
    await saveProfile(uid, pr)
  })
  return viewClan(clan, await statMap())
}

export async function leaveClan(uid) {
  const p = await loadProfile(uid)
  if (!p || !p.clanId) return { ok: true }
  const clan = await loadClan(p.clanId)
  await withProfileLock(uid, async () => {
    const pr = (await loadProfile(uid)) || p
    pr.clanId = null
    pr.clanTag = null
    await saveProfile(uid, pr)
  })
  if (!clan) return { ok: true }
  clan.members = clan.members.filter((m) => m.uid !== uid)
  if (clan.members.length === 0) {
    await deleteClan(clan.id) // последний вышел — клан расформирован
  } else {
    if (clan.leader === uid) clan.leader = clan.members[0].uid // командир ушёл — передаём старшинство
    await saveClan(clan.id, clan)
  }
  return { ok: true }
}
