// Клиент взвод-лобби: WS-соединение в режиме лобби (до боя), реалтайм состав +
// готовность. Командир жмёт старт → onLaunch у всех участников → каждый заходит в
// бой с party=squadId (сервер сводит одинаковые токены в одну команду).
import { reactive, watch } from 'vue'
import { tgUserId } from '../tg.js'
import { profile, selectedTank, clearParty } from '../store.js'

export const MAX_TIER_SPREAD = 9 // ВРЕМЕННО: взвод на любых уровнях техники (1-10) —
// чтобы люди играли вместе под наплыв; баланс правим позже. Вернуть в 1 для ±1.
// моя текущая техника для взвода: { id, tier, name }
function tankInfo() {
  const t = selectedTank()
  return t ? { id: t.id, tier: t.tier, name: t.name } : null
}

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws') + '/ws'
    : `ws://${location.hostname}:8080/ws`)

// реактивное состояние лобби для UI
export const squad = reactive({
  active: false, // в лобби?
  squadId: null, // tg-id командира
  members: [], // [{ id, name, ready, leader }]
  full: false, // взвод полон (3/3)
  onLaunch: null, // колбэк App: старт боя с party=squadId
  onDisband: null, // колбэк: командир распустил
  onWarn: null, // колбэк UI: сервер отклонил действие (напр. разный уровень техники)
})

export const inSquad = () => squad.active
export const isSquadLeader = () => squad.active && String(squad.squadId) === String(tgUserId())
export const myReady = () => {
  const me = squad.members.find((m) => String(m.id) === String(tgUserId()))
  return me ? me.ready : false
}
export const allReady = () => squad.members.length > 0 && squad.members.every((m) => m.ready)

// --- проверка уровней техники (взвод только в пределах ±1) ---
const myTier = () => {
  const t = selectedTank()
  return t ? t.tier : null
}
// моя техника совместима со всеми остальными (в пределах ±1 уровня)?
export function myTankCompatible() {
  const mt = myTier()
  if (mt == null) return true
  const me = String(tgUserId())
  return squad.members.every((m) => String(m.id) === me || !m.tank || Math.abs(m.tank.tier - mt) <= MAX_TIER_SPREAD)
}
// уровень техники tier совместим с остальными участниками (в пределах ±1)? —
// для пикера смены танка во взводе: помечаем, какие из моих танков подходят
export function tierFitsSquad(tier) {
  if (tier == null) return true
  const me = String(tgUserId())
  return squad.members.every((m) => String(m.id) === me || !m.tank || Math.abs(m.tank.tier - tier) <= MAX_TIER_SPREAD)
}
// весь взвод в пределах ±1 уровня?
export function squadTierOk() {
  const tiers = squad.members.map((m) => m.tank && m.tank.tier).filter((t) => t != null)
  if (tiers.length < 2) return true
  return Math.max(...tiers) - Math.min(...tiers) <= MAX_TIER_SPREAD
}
// у конкретного участника техника выбивается из диапазона (для подсветки)?
export function memberTierBad(m) {
  if (!m || !m.tank) return false
  return squad.members.some((o) => o.tank && String(o.id) !== String(m.id) && Math.abs(o.tank.tier - m.tank.tier) > MAX_TIER_SPREAD)
}

let ws = null

// подключиться к лобби взвода squadId как игрок tgUserId() (имя — name)
export function connectSquad(squadId, name) {
  const me = tgUserId()
  if (!squadId || !me) return false
  closeSquad()
  squad.active = true
  squad.squadId = String(squadId)
  squad.members = []
  squad.full = false
  let sock
  try {
    sock = new WebSocket(`${WS_URL}?squad=${encodeURIComponent(squad.squadId)}`)
  } catch {
    squad.active = false
    return false
  }
  ws = sock // WS держим в модуле, НЕ в реактивном объекте (Vue не должен его проксировать)
  sock.onopen = () => sock.send(JSON.stringify({ type: 'squad-join', id: me, name: name || 'Боец', tank: tankInfo() }))
  sock.onmessage = (e) => {
    let m
    try {
      m = JSON.parse(e.data)
    } catch {
      return
    }
    if (m.type === 'squad') {
      squad.members = m.members || []
      squad.full = false
    } else if (m.type === 'squad-full') {
      squad.full = true
    } else if (m.type === 'squad-launch') {
      if (squad.onLaunch) squad.onLaunch(m) // App: setPartyToken + в бой
    } else if (m.type === 'squad-warn') {
      if (squad.onWarn) squad.onWarn(m.reason)
    } else if (m.type === 'squad-disband') {
      if (squad.onDisband) squad.onDisband()
      closeSquad()
    }
  }
  sock.onclose = () => {
    if (ws !== sock) return // уже пересозданное/закрытое нами соединение — не трогаем
    ws = null
    // сокет умер, а лобби считалось живым (рестарт сервера/обрыв) — выходим из
    // взвода явно, иначе UI висит с мёртвым составом и не-работающими кнопками
    if (squad.active) {
      if (squad.onDisband) squad.onDisband()
      closeSquad()
    }
  }
  sock.onerror = () => {}
  return true
}

export function squadSetReady(ready) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'ready', ready: !!ready }))
}

// отправить серверу свою текущую технику (для проверки уровней)
export function squadSetTank() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'squad-tank', tank: tankInfo() }))
}
// сменил танк в ангаре, пока во взводе → шлём обновление (уровни пересчитаются у всех)
watch(
  () => profile.selectedTank,
  () => {
    if (squad.active) squadSetTank()
  },
)

export function squadLaunch(mode) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'launch', mode }))
}

export function closeSquad() {
  if (ws) {
    try {
      ws.close()
    } catch {
      /* ок */
    }
  }
  ws = null
  squad.active = false
  squad.squadId = null
  squad.members = []
  squad.full = false
  clearParty() // вышли из взвода → больше не в party (следующий бой — соло)
}
