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
const TICK_HZ = +(process.env.TICK_HZ || 20)
const TICK_DT = 1 / TICK_HZ

// пределы против флуда: вход больше 2КБ боевому клиенту не нужен
const MAX_SOCKETS = +(process.env.MAX_SOCKETS || 1200)
const MAX_PER_IP = +(process.env.MAX_PER_IP || 30)
const MSG_RATE = 40 // сообщений/с на сокет (ввод 10Гц + огонь + пинг — с запасом)
const MSG_BURST = 80
const SEND_BUFFER_LIMIT = 256 * 1024 // backpressure: дальше кадры дропаем

const wss = new WebSocketServer({ server: httpServer, maxPayload: 2048 })
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
let waitingRoom = null
// комнаты взводов по токену: игроки с одним party-токеном (= id командира) попадают
// в ОДНУ комнату → друзья гарантированно в одном бою (одна команда живых)
const partyRooms = new Map()

function newRoom() {
  const room = {
    id: `r${nextId++}`,
    humans: [], // { id, name, team, ws }
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

function getJoinRoom(party) {
  // взвод: все с одинаковым токеном — в одну комнату (своя комната на токен)
  if (party) {
    const ex = partyRooms.get(party)
    if (ex && !ex.started && ex.humans.length < TEAM_SIZE) return ex
    const nr = newRoom()
    nr.party = party
    partyRooms.set(party, nr)
    return nr
  }
  // комната = ОДНА команда живых игроков (как обещает UI «ВАША КОМАНДА · X/7»);
  // враг — боты. Поэтому добираем людей до TEAM_SIZE, а не до TEAM_SIZE*2.
  if (waitingRoom && !waitingRoom.started && waitingRoom.humans.length < TEAM_SIZE) return waitingRoom
  waitingRoom = newRoom()
  return waitingRoom
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

function startRoom(room) {
  if (room.started) return
  room.started = true
  clearTimeout(room.waitTimer)
  if (waitingRoom === room) waitingRoom = null
  if (room.party && partyRooms.get(room.party) === room) partyRooms.delete(room.party) // токен свободен для нового взвода

  // ВСЕ живые игроки комнаты — в ОДНУ команду (юг, team 0), как обещает экран
  // поиска «ВАША КОМАНДА»: друзья всегда вместе. Враг — боты (team 1, добор в sim)
  room.humans.forEach((h) => (h.team = 0))
  const map = randomMap()
  room.sim = new BattleSim({
    teamSize: TEAM_SIZE,
    mapId: map.id,
    humans: room.humans.map((h) => ({ id: h.id, team: h.team, name: h.name, stats: h.stats, tankId: h.tankId, tint: h.tint, skin: h.skin })),
  })

  for (const h of room.humans) {
    const u = room.sim.byOwner.get(h.id)
    send(h.ws, {
      type: 'match-start',
      youTeam: h.team,
      youUnit: u ? u.id : null,
      teamSize: TEAM_SIZE,
      map: MAP_SIZE,
      mapId: map.id,
      humans: room.humans.length,
      tickHz: TICK_HZ,
    })
  }
  console.log(`[ws] ${room.id}: старт ${TEAM_SIZE}x${TEAM_SIZE} на «${map.name}», людей ${room.humans.length}, ботов ${TEAM_SIZE * 2 - room.humans.length}`)

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

function roomTick(room) {
    const t0 = process.hrtime.bigint()
    room.sim.step(TICK_DT)
    const events = room.sim.takeEvents()
    // сериализация один раз на команду: личная добавка подклеивается строкой
    const teamStr = [0, 1].map((t) =>
      JSON.stringify({ ...room.sim.snapshotForTeam(t), events: room.sim.eventsForTeam(events, t) }),
    )
    for (const h of room.humans) {
      const you = JSON.stringify(room.sim.personalFor(h.id))
      sendRaw(h.ws, teamStr[h.team].slice(0, -1) + ',"you":' + you + '}')
    }
    room.tickAccMs += Number(process.hrtime.bigint() - t0) / 1e6
    room.tickN++

    if (room.sim.matchOver) {
      const stats = room.sim.units.map((u) => ({
        id: u.id,
        team: u.team,
        name: u.name,
        human: u.human,
        kills: u.kills,
        damage: Math.round(u.damageDealt),
        alive: u.alive,
      }))
      for (const h of room.humans) {
        send(h.ws, { type: 'match-end', winner: room.sim.winner, score: room.sim.score, stats })
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
  rooms.delete(room.id)
  if (waitingRoom === room) waitingRoom = null
  if (room.party && partyRooms.get(room.party) === room) partyRooms.delete(room.party)
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
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'
  if (wss.clients.size > MAX_SOCKETS || (ipCount.get(ip) || 0) >= MAX_PER_IP) {
    ws.close(1013, 'busy')
    return
  }
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1)
  ws.isAlive = true
  ws.on('pong', () => (ws.isAlive = true))
  ws.on('error', (e) => console.error(`[ws] socket error:`, e.message)) // без хендлера 'error' валит процесс

  // токен-бакет на входящие: спамеру — разрыв
  let tokens = MSG_BURST
  let lastRefill = Date.now()

  // токен взвода из query (?party=<id командира>) — группирует друзей в одну комнату
  let party = null
  try {
    party = (new URL(req.url, 'http://x').searchParams.get('party') || '').replace(/[^0-9]/g, '').slice(0, 20) || null
  } catch {
    party = null
  }
  const id = `p${nextId++}`
  const room = getJoinRoom(party)
  const human = { id, name: `Игрок ${id}`, team: 0, ws, stats: null, tankId: null, tint: 0, skin: null, battles: 0 }
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
  if (room.humans.length >= TEAM_SIZE) startRoom(room) // команда живых заполнена — старт

  ws.on('message', (raw) => {
    const now = Date.now()
    tokens = Math.min(MSG_BURST, tokens + ((now - lastRefill) / 1000) * MSG_RATE)
    lastRefill = now
    if (--tokens < 0) {
      console.log(`[ws] ${id}: флуд (${ip}), разрываю`)
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
      room.sim.setInput(id, msg.throttle, msg.steer)
    } else if (msg.type === 'fire') {
      room.sim.fire(id)
    } else if (msg.type === 'ping') {
      send(ws, { type: 'pong', ts: msg.ts })
    }
  })

  ws.on('close', () => {
    const n = (ipCount.get(ip) || 1) - 1
    if (n <= 0) ipCount.delete(ip)
    else ipCount.set(ip, n)
    console.log(`[ws] ${id} вышел из ${room.id}`)
    room.humans = room.humans.filter((h) => h.id !== id)
    if (room.sim) room.sim.humanLeft(id) // ИИ доигрывает за него
    if (!room.started) broadcastLobby(room)
    if (!room.started && room.humans.length === 0) endRoom(room)
    if (room.started && room.humans.length === 0) endRoom(room) // некому слать
  })
})

httpServer.listen(PORT, () => {
  console.log(`[srv] Panzer TG: HTTP API + WS ${TEAM_SIZE}x${TEAM_SIZE} на :${PORT} (${TICK_HZ}Hz, добор ботами через ${WAIT_MS}мс)`)
  startPaymentsLoop()
})
