// Сервер Panzer TG: HTTP API (профили + платежи Stars) и authoritative
// WS-бой N×N на одном порту. Профили — файловое хранилище, авторизация —
// подпись Telegram initData (без BOT_TOKEN — dev-гости и мгновенные «оплаты»).
import http from 'http'
import { WebSocketServer } from 'ws'
import { BattleSim, MAP_SIZE, randomMap } from 'panzer-tg-shared'
import { authRequest, hasBot } from './auth.js'
import { loadProfile, saveProfile, listProfiles, listPayments, leaderboard, playerByRank, getSetting, setSetting } from './db.js'
import { PRODUCTS, createInvoice, grantProduct, refundPayment, startPaymentsLoop } from './payments.js'
import { adminPage } from './admin.js'

const ADMIN_KEY = process.env.ADMIN_KEY || ''

const PORT = +(process.env.PORT || 8080)

// страховки процесса: одиночный сбой логируем, сервер с сотней боёв не роняем
process.on('uncaughtException', (e) => console.error('[srv] uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('[srv] unhandledRejection:', e))

// ---------- HTTP API ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-init-data, x-guest-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS })
  res.end(JSON.stringify(obj))
}
const BODY_LIMIT = 64 * 1024 // профиль — десятки КБ максимум
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > BODY_LIMIT) {
        resolve({})
        req.destroy()
      }
    })
    req.on('error', () => resolve({}))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })

// ---------- админка: статистика, профили, покупки (x-admin-key) ----------
async function handleAdmin(req, res) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return json(res, 401, { error: 'unauthorized' })
  if (req.url === '/api/admin/tournaments' && req.method === 'POST') {
    const { on } = await readBody(req)
    await setSetting('tournamentsOn', !!on)
    return json(res, 200, { tournaments: !!on })
  }
  if (req.url === '/api/admin/stats' && req.method === 'GET') {
    const payments = await listPayments()
    return json(res, 200, {
      now: Date.now(),
      online: wss.clients.size,
      tournaments: !!(await getSetting('tournamentsOn', false)),
      rooms: [...rooms.values()].map((r) => ({
        id: r.id,
        started: r.started,
        mapId: r.sim ? r.sim.mapId : null,
        humans: r.humans.map((h) => ({ id: h.id, name: h.name })),
        score: r.sim ? r.sim.score : null,
      })),
      profilesCount: (await listProfiles()).length,
      payments,
      revenueStars: payments.reduce((s, p) => s + (p.stars || 0), 0),
      products: PRODUCTS,
      payMode: hasBot() ? 'stars' : 'dev',
    })
  }
  if (req.url === '/api/admin/profiles' && req.method === 'GET') {
    return json(res, 200, { profiles: await listProfiles() })
  }
  if (req.url === '/api/admin/refund' && req.method === 'POST') {
    const { charge } = await readBody(req)
    if (!charge) return json(res, 400, { error: 'нет charge' })
    const out = await refundPayment(String(charge))
    return json(res, out.ok ? 200 : 400, out)
  }
  json(res, 404, { error: 'not found' })
}

// засчёт реферала: игрок (user) открыл игру по ссылке игрока с tg-id <ref>.
// Привязка одноразовая (referredBy у новичка), реферер получает рекрута в referrals.
// Дедуп на стороне реферера по uid — повторный заход по ссылке рекрута не задваивает.
async function registerReferral(user, ref) {
  const refId = String(ref || '').replace(/[^0-9]/g, '').slice(0, 20)
  if (!refId) return { ok: false, reason: 'no-ref' }
  const inviterUid = `tg_${refId}`
  if (inviterUid === user.uid) return { ok: false, reason: 'self' }
  const me = (await loadProfile(user.uid)) || {}
  if (me.referredBy) return { ok: false, reason: 'already' }
  me.referredBy = inviterUid
  await saveProfile(user.uid, me)
  const inviter = await loadProfile(inviterUid)
  if (!inviter) return { ok: true, credited: false } // реферер ещё не заходил в игру
  if (!Array.isArray(inviter.referrals)) inviter.referrals = []
  if (!Array.isArray(inviter.referralIds)) inviter.referralIds = []
  if (!inviter.referralIds.includes(user.uid)) {
    inviter.referralIds.push(user.uid)
    inviter.referrals.push(user.name || 'Боец')
    await saveProfile(inviterUid, inviter)
  }
  return { ok: true, credited: true }
}

async function handleApi(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }
  if (req.url.startsWith('/api/admin/')) return handleAdmin(req, res)
  const user = authRequest(req)
  if (!user) return json(res, 401, { error: 'unauthorized' })

  if (req.url === '/api/profile' && req.method === 'GET') {
    return json(res, 200, { uid: user.uid, profile: await loadProfile(user.uid) })
  }
  if (req.url === '/api/leaderboard' && req.method === 'GET') {
    return json(res, 200, { top: await leaderboard(20) })
  }
  if (req.url.startsWith('/api/player') && req.method === 'GET') {
    const rank = +new URL(req.url, 'http://x').searchParams.get('rank')
    if (!rank || rank < 1) return json(res, 400, { error: 'bad rank' })
    const player = await playerByRank(rank)
    return player ? json(res, 200, { player }) : json(res, 404, { error: 'not found' })
  }
  if (req.url === '/api/config' && req.method === 'GET') {
    return json(res, 200, { tournaments: !!(await getSetting('tournamentsOn', false)) })
  }
  if (req.url === '/api/profile' && req.method === 'POST') {
    const body = await readBody(req)
    if (!body || typeof body.profile !== 'object') return json(res, 400, { error: 'bad profile' })
    // серверные поля (рефералы/реферер) ведёт сервер — клиент их НЕ перезаписывает,
    // иначе сейв профиля затирал бы засчитанных рекрутов. Берём прежние из хранилища.
    const prev = (await loadProfile(user.uid)) || {}
    const merged = {
      ...body.profile,
      referrals: Array.isArray(prev.referrals) ? prev.referrals : [],
      referralIds: Array.isArray(prev.referralIds) ? prev.referralIds : [],
      referredBy: prev.referredBy || null,
    }
    await saveProfile(user.uid, merged)
    return json(res, 200, { ok: true })
  }
  if (req.url === '/api/referred' && req.method === 'POST') {
    const { ref } = await readBody(req)
    return json(res, 200, await registerReferral(user, ref))
  }
  if (req.url === '/api/invoice' && req.method === 'POST') {
    const { productId, name } = await readBody(req)
    const out = await createInvoice(user.uid, productId, { name })
    if (out.error) return json(res, 400, out)
    // dev-режим: токена нет — начисляем сразу, фронт покажет «куплено (dev)»
    if (out.dev) {
      const granted = await grantProduct(user.uid, productId, { name })
      return json(res, 200, { dev: true, granted })
    }
    return json(res, 200, out)
  }
  if (req.url === '/api/products' && req.method === 'GET') {
    return json(res, 200, { products: PRODUCTS, payments: hasBot() ? 'stars' : 'dev' })
  }
  json(res, 404, { error: 'not found' })
}

const httpServer = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res).catch((e) => json(res, 500, { error: e.message }))
  if (req.url === '/admin' || req.url === '/admin/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(adminPage())
  }
  res.writeHead(200, CORS)
  res.end('Panzer TG server')
})
const TEAM_SIZE = +(process.env.TEAM_SIZE || 7)
// сколько комната ждёт живых игроков, прежде чем добрать ботов
const WAIT_MS = +(process.env.WAIT_MS || 8000)
// стартовый отсчёт «3-2-1»: мир на сервере застыл, пока клиент считает (Battle.vue
// крутит 3с). Чуть больше 3с — с поправкой на пинг игрок дочитывает раньше, чем
// боты тронутся (а не «боты поехали на цифре 3»).
const COUNTDOWN_MS = +(process.env.COUNTDOWN_MS || 3200)
// 60Гц симуляция+поток — максимальная плавность/отзывчивость (шаг интерп. ~16мс,
// задержка рендера ~20мс). Частота НЕ была причиной iOS-проблемы (сокет тянул и
// 20Гц; корень — сорванный push, лечится pull-очередью в NetGame). Это ТЕСТОВЫЙ
// сервер (мало игроков), поэтому жмём на максимум. Для прода с толпой комнат
// снизить env'ом: TICK_HZ=30 (баланс) или 20 (экономно) — нагрузка линейна по Hz.
const TICK_HZ = +(process.env.TICK_HZ || 60)
const TICK_DT = 1 / TICK_HZ
// можно слать РЕЖЕ, чем считаем (SNAP_EVERY=2 → половина потока) для слабых сетей
const SNAP_EVERY = Math.max(1, +(process.env.SNAP_EVERY || 1))
const SNAP_HZ = TICK_HZ / SNAP_EVERY

// пределы против флуда: вход больше 2КБ боевому клиенту не нужен
const MAX_SOCKETS = +(process.env.MAX_SOCKETS || 1200)
const MAX_PER_IP = +(process.env.MAX_PER_IP || 30)
const MSG_RATE = 40 // сообщений/с на сокет (ввод 10Гц + огонь + пинг — с запасом)
const MSG_BURST = 80
const SEND_BUFFER_LIMIT = 256 * 1024 // backpressure: дальше кадры дропаем

// perMessageDeflate выключен: сжатие мелких 60Гц-кадров копит их и добавляет
// латентность — для риалтайма вредно (поток должен идти ровно, а не пачками)
const wss = new WebSocketServer({ server: httpServer, maxPayload: 2048, perMessageDeflate: false })
wss.on('error', (e) => console.error('[ws] server error:', e.message))

const ipCount = new Map()

// валидация боевых статов из клиентского лоадаута: только известные числовые
// поля, каждое зажато в честный диапазон (читы и NaN не проходят)
const STAT_CLAMP = {
  sectorDeg: [20, 80],
  sweepPeriod: [1.2, 6],
  toleranceDeg: [2, 12],
  reload: [1.2, 8],
  damage: [10, 80],
  hp: [40, 320],
  range: [300, 800],
  vision: [200, 800],
  maxSpeed: [40, 220],
  accel: [80, 400],
  turnRate: [0.4, 4],
}
function sanitizeStats(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  for (const [k, [lo, hi]] of Object.entries(STAT_CLAMP)) {
    const v = +raw[k]
    if (!Number.isFinite(v)) return null
    out[k] = Math.max(lo, Math.min(hi, v))
  }
  out.id = typeof raw.id === 'string' && /^[a-z]{1,12}$/.test(raw.id) ? raw.id : 'medium'
  return out
}
const ID_RE = /^[a-z0-9_]{1,16}$/

let nextId = 1
const rooms = new Map()
// ждущие комнаты — свои на каждый режим: игроки с разными режимами (захват/
// уничтожение) НЕ попадают в одну комнату. PvP: комната копит до TEAM_SIZE*2 людей
// (две команды живых), взводы держатся вместе при делении (см. assignTeams).
const waitingRooms = { capture: null, annihilation: null }

// ---------- взвод-лобби (до боя): реалтайм состав + готовность ----------
// squadId = tg-id командира. Участники держат WS в режиме лобби (?squad=<id>).
// Командир жмёт «старт» → всем squad-launch → каждый заходит в бой с party=squadId
// (готовая группировка assignTeams сводит их в одну команду).
const squads = new Map() // squadId -> { id, members: Map(memberId -> {id, name, ready, ws, tank}) }
const SQUAD_MAX = 3 // командир + 2
const MAX_TIER_SPREAD = 1 // взвод только в пределах ±1 уровня техники

// техника участника от клиента: { id, tier, name } — чистим перед хранением
function sanitizeTank(t) {
  if (!t || typeof t !== 'object') return null
  const tier = Math.round(+t.tier || 0)
  if (!(tier >= 1 && tier <= 10)) return null
  return { id: String(t.id || '').slice(0, 16), tier, name: String(t.name || '').slice(0, 24) }
}

function squadRoster(sq) {
  return [...sq.members.values()].map((m) => ({ id: m.id, name: m.name, ready: m.ready, leader: m.id === sq.id, tank: m.tank || null }))
}
function broadcastSquad(sq) {
  const members = squadRoster(sq)
  for (const m of sq.members.values()) send(m.ws, { type: 'squad', squadId: sq.id, members })
}
function squadJoin(squadId, memberId, name, tank, ws) {
  let sq = squads.get(squadId)
  if (!sq) {
    sq = { id: squadId, members: new Map() }
    squads.set(squadId, sq)
  }
  if (!sq.members.has(memberId) && sq.members.size >= SQUAD_MAX) {
    send(ws, { type: 'squad-full' })
    return
  }
  sq.members.set(memberId, { id: memberId, name: (name || 'Боец').slice(0, 24), ready: false, ws, tank: sanitizeTank(tank) })
  ws.squad = sq
  ws.squadMemberId = memberId
  broadcastSquad(sq)
}
// разброс уровней техники во взводе превышает допустимый ±1?
function squadTierBad(sq) {
  const tiers = [...sq.members.values()].map((m) => m.tank && m.tank.tier).filter((t) => t != null)
  return tiers.length >= 2 && Math.max(...tiers) - Math.min(...tiers) > MAX_TIER_SPREAD
}
function squadLeave(ws) {
  const sq = ws.squad
  if (!sq) return
  ws.squad = null
  sq.members.delete(ws.squadMemberId)
  // командир ушёл → взвод распускаем (всем squad-disband)
  if (ws.squadMemberId === sq.id) {
    for (const m of sq.members.values()) send(m.ws, { type: 'squad-disband' })
    squads.delete(sq.id)
  } else if (sq.members.size === 0) {
    squads.delete(sq.id)
  } else {
    broadcastSquad(sq)
  }
}

function newRoom() {
  const room = {
    id: `r${nextId++}`,
    humans: [], // { id, name, team, ws }
    mode: 'capture', // 'capture' | 'annihilation' — задаётся первым вошедшим
    sim: null,
    timer: null,
    waitTimer: null,
    started: false,
    // телеметрия тика
    tickAccMs: 0,
    tickN: 0,
  }
  rooms.set(room.id, room)
  return room
}

function getJoinRoom(mode) {
  // PvP: ВСЕ (взводы + соло) идут в ОБЩУЮ комнату на режим, до TEAM_SIZE*2 людей —
  // чтобы живые встречали живых, а не только ботов. Взвод (один party-токен) остаётся
  // в одной команде при делении (assignTeams в startRoom). Чужие режимы не сводятся.
  const wr = waitingRooms[mode]
  if (wr && !wr.started && wr.humans.length < TEAM_SIZE * 2) return wr
  const nr = newRoom()
  nr.mode = mode
  waitingRooms[mode] = nr
  return nr
}

// делим людей комнаты на 2 команды: взвод (один party-токен) ЦЕЛИКОМ в одну команду,
// соло раскидываем для баланса (жадно — каждую группу в команду с меньшим числом людей,
// не превышая TEAM_SIZE). Так друзья всегда вместе, но против живого врага, когда он есть.
function assignTeams(humans) {
  const groups = new Map()
  for (const h of humans) {
    const key = h.party || `s${h.id}` // взвод по токену, соло — уникальный ключ
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(h)
  }
  const count = [0, 0]
  for (const g of [...groups.values()].sort((a, b) => b.length - a.length)) {
    let t = count[0] <= count[1] ? 0 : 1
    if (count[t] + g.length > TEAM_SIZE) t = 1 - t // не влезает — в другую команду
    for (const h of g) h.team = t
    count[t] += g.length
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

// горячий путь тика: строка уже собрана; при забитом буфере кадр дропаем —
// клиент интерполирует, а сервер не копит чужие мегабайты в памяти
function sendRaw(ws, str) {
  if (ws.readyState === ws.OPEN && ws.bufferedAmount < SEND_BUFFER_LIMIT) ws.send(str)
}

// лобби ожидающим: кто уже в комнате (живые игроки видны в матчмейкинге)
function broadcastLobby(room) {
  if (room.started) return
  const players = room.humans.map((h) => ({ id: h.id, name: h.name, battles: h.battles || 0 }))
  const startsIn = Math.max(0, room.deadline ? room.deadline - Date.now() : WAIT_MS)
  for (const h of room.humans) send(h.ws, { type: 'lobby', players, you: h.id, startsIn })
}

// грейс перед закрытием опустевшей живой комнаты: даём игроку вернуться
// (iOS-сокет умирает молча на старте боя — нужен запас на переподключение)
const RECONNECT_GRACE_MS = +(process.env.RECONNECT_GRACE_MS || 30000)
const genKey = () => Math.random().toString(36).slice(2, 10)

// опустела живая комната — не убиваем сразу, ждём реконнект; вернулся игрок —
// таймер снимаем (cancelRoomEnd при добавлении человека)
function scheduleRoomEnd(room) {
  if (room.endTimer || !room.started) return
  room.endTimer = setTimeout(() => {
    room.endTimer = null
    if (room.humans.length === 0) {
      console.log(`[ws] ${room.id}: никто не вернулся за ${RECONNECT_GRACE_MS}мс — закрываю`)
      endRoom(room)
    }
  }, RECONNECT_GRACE_MS)
}
function cancelRoomEnd(room) {
  if (room.endTimer) {
    clearTimeout(room.endTimer)
    room.endTimer = null
  }
}

// общий обработчик боевого сокета (свежий вход И реконнект): ввод/огонь/пинг,
// свой токен-бакет от флуда, корректное закрытие. Закрытие удаляет ИМЕННО этот
// сокет (human.ws === ws): после реконнекта human.ws уже указывает на новый
// сокет, и close мёртвого старого ничего не ломает.
function setupBattleSocket(ws, room, human, ip) {
  let tokens = MSG_BURST
  let lastRefill = Date.now()
  ws.on('message', (raw) => {
    const now = Date.now()
    tokens = Math.min(MSG_BURST, tokens + ((now - lastRefill) / 1000) * MSG_RATE)
    lastRefill = now
    if (--tokens < 0) {
      console.log(`[ws] ${human.id}: флуд (${ip}), разрываю`)
      ws.terminate()
      return
    }
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'name' && typeof msg.name === 'string') {
      human.name = msg.name.slice(0, 24)
      broadcastLobby(room)
    } else if (msg.type === 'join') {
      // профиль бойца: имя, машина, камуфляж и боевые статы лоадаута —
      // всё с клиента, поэтому формат и диапазоны проверяем жёстко
      if (typeof msg.name === 'string' && msg.name.trim()) human.name = msg.name.trim().slice(0, 24)
      if (typeof msg.tankId === 'string' && ID_RE.test(msg.tankId)) human.tankId = msg.tankId
      if (typeof msg.tint === 'number' && Number.isFinite(msg.tint)) human.tint = msg.tint & 0xffffff
      if (typeof msg.skin === 'string' && ID_RE.test(msg.skin)) human.skin = msg.skin
      if (typeof msg.battles === 'number' && Number.isFinite(msg.battles)) human.battles = Math.max(0, Math.min(1e6, msg.battles | 0))
      human.stats = sanitizeStats(msg.stats)
      broadcastLobby(room)
    } else if (!room.sim) {
      return
    } else if (msg.type === 'input') {
      room.sim.setInput(human.id, msg.throttle, msg.steer)
    } else if (msg.type === 'fire') {
      room.sim.fire(human.id)
    } else if (msg.type === 'ping') {
      send(ws, { type: 'pong', ts: msg.ts })
    }
  })
  ws.on('close', () => {
    const n = (ipCount.get(ip) || 1) - 1
    if (n <= 0) ipCount.delete(ip)
    else ipCount.set(ip, n)
    // реконнект мог увести human на новый сокет — тогда этот close уже не наш
    if (human.ws !== ws) return
    console.log(`[ws] ${human.id} вышел из ${room.id}`)
    room.humans = room.humans.filter((h) => h !== human)
    if (room.sim) room.sim.humanLeft(human.id) // ИИ доигрывает за него
    if (!room.started) {
      broadcastLobby(room)
      if (room.humans.length === 0) endRoom(room)
    } else if (room.humans.length === 0) {
      scheduleRoomEnd(room) // живой бой — даём шанс вернуться, не рубим сразу
    }
  })
}

// возврат в идущий бой по ?rejoin=<roomId>&unit=<id>&rkey=<токен>: находим живой
// юнит, привязываем к нему новый сокет (human.ws), снапшоты возобновляются.
function doRejoin(ws, ip, roomId, unitId, rkey) {
  const room = rooms.get(roomId)
  if (!room || !room.started || !room.sim || room.sim.matchOver) {
    send(ws, { type: 'rejoin-fail' })
    return ws.close(1000, 'no-room')
  }
  if (!room.rejoinKeys || room.rejoinKeys.get(unitId) !== rkey) {
    send(ws, { type: 'rejoin-fail' })
    return ws.close(1000, 'bad-key')
  }
  const unit = room.sim.byId.get(unitId)
  if (!unit) {
    send(ws, { type: 'rejoin-fail' })
    return ws.close(1000, 'no-unit')
  }
  cancelRoomEnd(room)
  unit.human = true
  room.sim.byOwner.set(unit.ownerId, unit)
  let human = room.humans.find((h) => h.id === unit.ownerId)
  if (human) {
    human.ws = ws // увели на новый сокет — старый close станет no-op
  } else {
    human = { id: unit.ownerId, party: null, name: unit.name, team: unit.team, ws, stats: unit.stats, tankId: unit.tankId, tint: unit.tint, skin: unit.skin, battles: 0, rkey }
    room.humans.push(human)
  }
  ws.playerId = unit.ownerId
  ws.room = room
  setupBattleSocket(ws, room, human, ip)
  send(ws, {
    type: 'match-start',
    rejoined: true, // клиент: это не новый бой, а возврат в текущий — не пересобирать
    youTeam: unit.team,
    youUnit: unit.id,
    teamSize: TEAM_SIZE,
    map: room.sim.mapSize,
    mapId: room.sim.mapId,
    mode: room.mode,
    humans: room.humans.length,
    tickHz: SNAP_HZ, // частота снапшотов (для интерполяции у клиента)
    room: room.id,
    rkey,
  })
  console.log(`[ws] ${unit.ownerId} ВЕРНУЛСЯ в ${room.id} (юнит ${unit.id})`)
}

function startRoom(room) {
  if (room.started) return
  room.started = true
  clearTimeout(room.waitTimer)
  if (waitingRooms[room.mode] === room) waitingRooms[room.mode] = null

  // PvP: делим живых на 2 команды (взводы цело, соло — балансом). Каждая команда
  // добирается ботами в sim. Соло против соло = настоящий бой человек-vs-человек.
  assignTeams(room.humans)
  const map = randomMap()
  room.sim = new BattleSim({
    teamSize: TEAM_SIZE,
    mapId: map.id,
    mode: room.mode,
    humans: room.humans.map((h) => ({ id: h.id, team: h.team, name: h.name, stats: h.stats, tankId: h.tankId, tint: h.tint, skin: h.skin })),
  })

  // стартовый отсчёт: мир застыл до этого момента (см. roomTick) — синхронно с «3-2-1»
  room.startAt = Date.now() + COUNTDOWN_MS

  // ключи реконнекта: по unitId, переживают отвал сокета (для возврата в бой)
  room.rejoinKeys = new Map()
  for (const h of room.humans) {
    const u = room.sim.byOwner.get(h.id)
    const rkey = genKey()
    h.rkey = rkey
    if (u) room.rejoinKeys.set(u.id, rkey)
    send(h.ws, {
      type: 'match-start',
      youTeam: h.team,
      youUnit: u ? u.id : null,
      teamSize: TEAM_SIZE,
      map: room.sim.mapSize, // размер карты (большие карты — больше места)
      mapId: map.id,
      mode: room.mode,
      humans: room.humans.length,
      startsIn: COUNTDOWN_MS, // длительность стартового отсчёта (мир застыл столько)
      tickHz: SNAP_HZ, // частота снапшотов (для интерполяции у клиента)
      room: room.id, // для реконнекта: куда возвращаться, если сокет умрёт
      rkey, // токен возврата в этот бой за свой юнит
    })
  }
  console.log(
    `[ws] ${room.id}: старт ${TEAM_SIZE}x${TEAM_SIZE} на «${map.name}», люди ${room.humans.filter((h) => h.team === 0).length}vs${room.humans.filter((h) => h.team === 1).length}, остальное — боты`,
  )

  room.timer = setInterval(() => {
    try {
      roomTick(room)
    } catch (e) {
      // комната не должна ронять процесс с остальными боями
      console.error(`[ws] ${room.id}: tick error, закрываю комнату`, e)
      for (const h of room.humans) send(h.ws, { type: 'match-end', winner: null, score: room.sim ? room.sim.score : [0, 0], stats: [] })
      endRoom(room)
    }
  }, 1000 / TICK_HZ)
}

function roomStats(room) {
  return room.sim.units.map((u) => ({
    id: u.id,
    team: u.team,
    name: u.name,
    human: u.human,
    kills: u.kills,
    damage: Math.round(u.damageDealt),
    alive: u.alive,
  }))
}

function roomTick(room) {
    const t0 = process.hrtime.bigint()
    // СТАРТОВЫЙ ОТСЧЁТ: клиент крутит «3-2-1» (Battle.vue), и пока он идёт — мир
    // на сервере ЗАСТЫЛ (боты не едут и не стреляют, время t не идёт). Снапшоты
    // всё равно шлём — поле видно за оверлеем отсчёта. Размораживаемся в startAt.
    const warming = room.startAt && Date.now() < room.startAt
    if (!warming) {
      room.sim.step(TICK_DT)
      // события копим между отправками: шлём реже тика, но НИ ОДНО не теряем
      // (выстрелы/попадания/киллы с пропущенных тиков уходят со следующим снапшотом)
      if (!room.evBuf) room.evBuf = []
      const ev = room.sim.takeEvents()
      if (ev.length) room.evBuf.push(...ev)
    }
    room.sinceSnap = (room.sinceSnap || 0) + 1

    if (room.sinceSnap >= SNAP_EVERY || room.sim.matchOver) {
      room.sinceSnap = 0
      const events = room.evBuf
      room.evBuf = []
      // сериализация один раз на команду: личная добавка подклеивается строкой
      const teamStr = [0, 1].map((t) =>
        JSON.stringify({ ...room.sim.snapshotForTeam(t), events: room.sim.eventsForTeam(events, t) }),
      )
      for (const h of room.humans) {
        const you = JSON.stringify(room.sim.personalFor(h.id))
        sendRaw(h.ws, teamStr[h.team].slice(0, -1) + ',"you":' + you + '}')
      }
    }
    room.tickAccMs += Number(process.hrtime.bigint() - t0) / 1e6
    room.tickN++

    if (room.sim.matchOver) {
      const stats = roomStats(room)
      for (const h of room.humans) {
        send(h.ws, { type: 'match-end', winner: room.sim.winner, score: room.sim.score, reason: room.sim.endReason, stats })
      }
      console.log(
        `[ws] ${room.id}: конец, счёт ${room.sim.score.join(':')}, winner=${room.sim.winner}, средний тик ${(room.tickAccMs / Math.max(1, room.tickN)).toFixed(3)}мс`,
      )
      endRoom(room)
    }
}

function endRoom(room) {
  clearInterval(room.timer)
  clearTimeout(room.waitTimer)
  clearTimeout(room.endTimer)
  rooms.delete(room.id)
  if (waitingRooms[room.mode] === room) waitingRooms[room.mode] = null
  // сокеты не рвём — клиент сам уходит после match-end
}

// heartbeat: полуоткрытые сокеты (мобильная сеть пропала) добиваем сами
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
}, 30000)
wss.on('close', () => clearInterval(heartbeat))

wss.on('connection', (ws, req) => {
  // x-real-ip ставит наш nginx (доверенный); клиентский x-forwarded-for — только
  // фоллбэк без прокси. Иначе за nginx все игроки = 127.0.0.1 и MAX_PER_IP
  // превращается в глобальный потолок сокетов на весь сервер.
  const ip =
    String(req.headers['x-real-ip'] || '').trim() ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '?'
  if (wss.clients.size > MAX_SOCKETS || (ipCount.get(ip) || 0) >= MAX_PER_IP) {
    ws.close(1013, 'busy')
    return
  }
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1)
  // TCP_NODELAY: слать каждый снапшот СРАЗУ, а не копить Нэйглом в пачки (иначе
  // 60Гц поток приходит рывками раз в ~RTT → дёрг). Критично для риалтайма.
  try { req.socket.setNoDelay(true) } catch {}
  ws.isAlive = true
  ws.on('pong', () => (ws.isAlive = true))
  ws.on('error', (e) => console.error(`[ws] socket error:`, e.message)) // без хендлера 'error' валит процесс

  // токен взвода из query (?party=<id командира>) — группирует друзей в одну
  // комнату; режим (?mode=annihilation) — какой бой искать (захват по умолчанию)
  let party = null
  let mode = 'capture'
  let squadId = null
  let rejoinRoom = null
  let rejoinUnit = 0
  let rejoinKey = ''
  try {
    const q = new URL(req.url, 'http://x').searchParams
    party = (q.get('party') || '').replace(/[^0-9]/g, '').slice(0, 20) || null
    mode = q.get('mode') === 'annihilation' ? 'annihilation' : 'capture'
    squadId = (q.get('squad') || '').replace(/[^0-9]/g, '').slice(0, 20) || null
    rejoinRoom = (q.get('rejoin') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || null
    rejoinUnit = (q.get('unit') || '').replace(/[^0-9]/g, '').slice(0, 6) | 0
    rejoinKey = (q.get('rkey') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16)
  } catch {
    party = null
  }

  // ===== РЕКОННЕКТ (?rejoin=<roomId>&unit=<id>&rkey=<токен>): возврат в идущий бой =====
  if (rejoinRoom) {
    doRejoin(ws, ip, rejoinRoom, rejoinUnit, rejoinKey)
    return
  }

  // ===== режим ВЗВОД-ЛОББИ (?squad=<id командира>): состав до боя, в бой НЕ заходим =====
  if (squadId) {
    let tk = MSG_BURST
    let lr = Date.now()
    ws.on('message', (raw) => {
      const now = Date.now()
      tk = Math.min(MSG_BURST, tk + ((now - lr) / 1000) * MSG_RATE)
      lr = now
      if (--tk < 0) return ws.terminate()
      let m
      try {
        m = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (m.type === 'squad-join' && m.id) {
        squadJoin(squadId, String(m.id).replace(/[^0-9]/g, '').slice(0, 20), m.name, m.tank, ws)
      } else if (m.type === 'squad-tank') {
        // сменил технику в ангаре, пока во взводе — обновляем уровень для проверки
        const me = ws.squad && ws.squad.members.get(ws.squadMemberId)
        if (me) {
          me.tank = sanitizeTank(m.tank)
          broadcastSquad(ws.squad)
        }
      } else if (m.type === 'ready') {
        const me = ws.squad && ws.squad.members.get(ws.squadMemberId)
        if (me) {
          me.ready = !!m.ready
          broadcastSquad(ws.squad)
        }
      } else if (m.type === 'launch' && ws.squad && ws.squadMemberId === ws.squad.id) {
        // гейт уровня: разная техника (> ±1) — старт запрещён (страховка к UI-блоку)
        if (squadTierBad(ws.squad)) {
          send(ws, { type: 'squad-warn', reason: 'tier' })
          return
        }
        // только командир стартует — всем участникам команда зайти в бой
        const lmode = m.mode === 'annihilation' ? 'annihilation' : 'capture'
        for (const mem of ws.squad.members.values()) send(mem.ws, { type: 'squad-launch', squadId: ws.squad.id, mode: lmode })
      }
    })
    ws.on('close', () => {
      const n = (ipCount.get(ip) || 1) - 1
      if (n <= 0) ipCount.delete(ip)
      else ipCount.set(ip, n)
      squadLeave(ws)
    })
    return
  }

  const id = `p${nextId++}`
  const room = getJoinRoom(mode)
  // party-токен храним на игроке — по нему делим на команды в startRoom (взвод цело)
  const human = { id, party, name: `Игрок ${id}`, team: 0, ws, stats: null, tankId: null, tint: 0, skin: null, battles: 0 }
  room.humans.push(human)
  ws.playerId = id
  ws.room = room

  send(ws, { type: 'init', id, map: MAP_SIZE, tickHz: TICK_HZ, teamSize: TEAM_SIZE, waitMs: WAIT_MS })
  console.log(`[ws] ${id} → ${room.id} (${room.humans.length} чел.)`)

  if (room.humans.length === 1) {
    room.deadline = Date.now() + WAIT_MS
    room.waitTimer = setTimeout(() => startRoom(room), WAIT_MS)
  }
  broadcastLobby(room)
  if (room.humans.length >= TEAM_SIZE * 2) startRoom(room) // обе команды живых заполнены — старт

  // ввод/огонь/пинг + корректное закрытие (общий путь со входом-реконнектом)
  setupBattleSocket(ws, room, human, ip)
})

// мягкое выключение (деплой делает systemctl restart): бои живут в памяти,
// поэтому перед смертью рассылаем match-end (клиент покажет итог) и закрываем
// сокеты кодом 1001 — иначе игроки 5с смотрят на замёрзший кадр и молча
// проваливаются в офлайн-бой с ботами «взвод не работает»
let shuttingDown = false
function shutdown(sig) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[srv] ${sig}: мягкое выключение — боёв ${rooms.size}, взводов ${squads.size}`)
  for (const room of [...rooms.values()]) {
    if (room.sim) {
      for (const h of room.humans) send(h.ws, { type: 'match-end', winner: null, score: room.sim.score, stats: roomStats(room) })
    }
    endRoom(room)
  }
  for (const sq of [...squads.values()]) {
    for (const m of sq.members.values()) send(m.ws, { type: 'squad-disband' })
  }
  squads.clear()
  for (const ws of wss.clients) {
    try {
      ws.close(1001, 'restart')
    } catch {
      /* уже закрыт */
    }
  }
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref() // сокеты не успели — всё равно выходим
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

httpServer.listen(PORT, () => {
  console.log(`[srv] Panzer TG: HTTP API + WS ${TEAM_SIZE}x${TEAM_SIZE} на :${PORT} (${TICK_HZ}Hz, добор ботами через ${WAIT_MS}мс)`)
  startPaymentsLoop()
})
