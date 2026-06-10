// Сервер Panzer TG: HTTP API (профили + платежи Stars) и authoritative
// WS-бой N×N на одном порту. Профили — файловое хранилище, авторизация —
// подпись Telegram initData (без BOT_TOKEN — dev-гости и мгновенные «оплаты»).
import http from 'http'
import { WebSocketServer } from 'ws'
import { BattleSim, MAP_SIZE, randomMap } from 'panzer-tg-shared'
import { authRequest, hasBot } from './auth.js'
import { loadProfile, saveProfile, listProfiles, listPayments } from './db.js'
import { PRODUCTS, createInvoice, grantProduct, startPaymentsLoop } from './payments.js'
import { adminPage } from './admin.js'

const ADMIN_KEY = process.env.ADMIN_KEY || ''

const PORT = +(process.env.PORT || 8080)

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
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
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
  if (req.url === '/api/admin/stats' && req.method === 'GET') {
    const payments = await listPayments()
    return json(res, 200, {
      now: Date.now(),
      online: wss.clients.size,
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
  json(res, 404, { error: 'not found' })
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
  if (req.url === '/api/profile' && req.method === 'POST') {
    const body = await readBody(req)
    if (!body || typeof body.profile !== 'object') return json(res, 400, { error: 'bad profile' })
    await saveProfile(user.uid, body.profile)
    return json(res, 200, { ok: true })
  }
  if (req.url === '/api/invoice' && req.method === 'POST') {
    const { productId } = await readBody(req)
    const out = await createInvoice(user.uid, productId)
    // dev-режим: токена нет — начисляем сразу, фронт покажет «куплено (dev)»
    if (out.dev) {
      await grantProduct(user.uid, productId)
      return json(res, 200, { dev: true, granted: true })
    }
    return json(res, out.error ? 400 : 200, out)
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
const WAIT_MS = +(process.env.WAIT_MS || 20000)
const TICK_HZ = +(process.env.TICK_HZ || 20)
const TICK_DT = 1 / TICK_HZ

const wss = new WebSocketServer({ server: httpServer })

let nextId = 1
const rooms = new Map()
let waitingRoom = null

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

function getJoinRoom() {
  if (waitingRoom && !waitingRoom.started && waitingRoom.humans.length < TEAM_SIZE * 2) return waitingRoom
  waitingRoom = newRoom()
  return waitingRoom
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

// лобби ожидающим: кто уже в комнате (живые игроки видны в матчмейкинге)
function broadcastLobby(room) {
  if (room.started) return
  const players = room.humans.map((h) => ({ id: h.id, name: h.name }))
  const startsIn = Math.max(0, room.deadline ? room.deadline - Date.now() : WAIT_MS)
  for (const h of room.humans) send(h.ws, { type: 'lobby', players, you: h.id, startsIn })
}

function startRoom(room) {
  if (room.started) return
  room.started = true
  clearTimeout(room.waitTimer)
  if (waitingRoom === room) waitingRoom = null

  // команды: чередуем по порядку входа (0,1,0,1…); карта — жребий комнаты
  room.humans.forEach((h, i) => (h.team = i % 2))
  const map = randomMap()
  room.sim = new BattleSim({
    teamSize: TEAM_SIZE,
    mapId: map.id,
    humans: room.humans.map((h) => ({ id: h.id, team: h.team, name: h.name, stats: h.stats, tankId: h.tankId, tint: h.tint })),
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
    const t0 = process.hrtime.bigint()
    room.sim.step(TICK_DT)
    const events = room.sim.takeEvents()
    const snaps = [room.sim.snapshotForTeam(0), room.sim.snapshotForTeam(1)]
    for (const h of room.humans) {
      send(h.ws, { ...snaps[h.team], events, you: room.sim.personalFor(h.id) })
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
  }, 1000 / TICK_HZ)
}

function endRoom(room) {
  clearInterval(room.timer)
  clearTimeout(room.waitTimer)
  rooms.delete(room.id)
  if (waitingRoom === room) waitingRoom = null
  // сокеты не рвём — клиент сам уходит после match-end
}

wss.on('connection', (ws) => {
  const id = `p${nextId++}`
  const room = getJoinRoom()
  const human = { id, name: `Игрок ${id}`, team: 0, ws, stats: null, tankId: null, tint: 0 }
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
  if (room.humans.length >= TEAM_SIZE * 2) startRoom(room)

  ws.on('message', (raw) => {
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
      // профиль бойца: имя, машина, камуфляж и боевые статы лоадаута
      if (typeof msg.name === 'string' && msg.name.trim()) human.name = msg.name.trim().slice(0, 24)
      if (typeof msg.tankId === 'string') human.tankId = msg.tankId.slice(0, 16)
      if (typeof msg.tint === 'number') human.tint = msg.tint
      if (msg.stats && typeof msg.stats === 'object' && typeof msg.stats.sectorDeg === 'number') human.stats = msg.stats
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
