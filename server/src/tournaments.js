// Турниры (MVP-регистрация): форматы 2×2 / 3×3 / 5×5 по классам техники.
// Главное на этом шаге — собрать заявки и ВИДЕТЬ, сколько игроков нажали
// «участвую» (перед запуском понимаем, наберётся ли состав). Сетки/проведение
// матчей — следующим шагом, когда заявок хватает.
import { getTournRegs, saveTournRegs } from './db.js'
import { t as tr } from './i18n.js'

// каталог форматов (статичен). cls: 'light'|'medium'|'heavy'|'any'
export const TOURNAMENTS = [
  { id: 't2v2_light', name: 'Лёгкая кавалерия', teamSize: 2, cls: 'light' },
  { id: 't3v3_medium', name: 'Средний клинч', teamSize: 3, cls: 'medium' },
  { id: 't3v3_any', name: 'Тройной удар', teamSize: 3, cls: 'any' },
  { id: 't5v5_heavy', name: 'Стальной вал', teamSize: 5, cls: 'heavy' },
  { id: 't5v5_any', name: 'Большой сбор', teamSize: 5, cls: 'any' },
]
const BY_ID = Object.fromEntries(TOURNAMENTS.map((t) => [t.id, t]))

function view(t, list, uid, lang) {
  return {
    id: t.id,
    name: tr('tournaments.' + t.id, lang), // локализованное имя формата (фоллбэк — t.name)
    teamSize: t.teamSize,
    cls: t.cls,
    count: list.length, // сколько нажали «участвую»
    need: t.teamSize * 2, // минимум на один матч (две команды)
    joined: list.includes(uid),
  }
}

export async function listTournaments(uid, lang) {
  const regs = await getTournRegs()
  return TOURNAMENTS.map((t) => view(t, regs[t.id] || [], uid, lang))
}

export async function joinTournament(uid, tid, lang) {
  const t = BY_ID[tid]
  if (!t) return { error: 'not found' }
  const regs = await getTournRegs()
  const list = regs[tid] || (regs[tid] = [])
  if (!list.includes(uid)) {
    list.push(uid)
    await saveTournRegs(regs)
  }
  return view(t, list, uid, lang)
}

export async function leaveTournament(uid, tid, lang) {
  const t = BY_ID[tid]
  if (!t) return { error: 'not found' }
  const regs = await getTournRegs()
  const list = (regs[tid] = (regs[tid] || []).filter((u) => u !== uid))
  await saveTournRegs(regs)
  return view(t, list, uid, lang)
}
