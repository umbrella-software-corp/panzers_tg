// Authoritative WS-сервер боя N×N (по умолчанию 7×7).
// Клиенты шлют только ввод (input/fire) — мир считает BattleSim из shared.
// Комната копит людей WAIT_MS от первого входа (или до полного состава),
// потом добирает ботами и стартует. Отключившегося доигрывает ИИ.
import { WebSocketServer } from 'ws'
import { BattleSim, MAP_SIZE } from 'panzer-tg-shared'

const PORT = +(process.env.PORT || 8080)
const TEAM_SIZE = +(process.env.TEAM_SIZE || 7)
const WAIT_MS = +(process.env.WAIT_MS || 6000)
const TICK_HZ = +(process.env.TICK_HZ || 20)
const TICK_DT = 1 / TICK_HZ

const wss = new WebSocketServer({ port: PORT })

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

function startRoom(room) {
  if (room.started) return
  room.started = true
  clearTimeout(room.waitTimer)
  if (waitingRoom === room) waitingRoom = null

  // команды: чередуем по порядку входа (0,1,0,1…)
  room.humans.forEach((h, i) => (h.team = i % 2))
  room.sim = new BattleSim({
    teamSize: TEAM_SIZE,
    humans: room.humans.map((h) => ({ id: h.id, team: h.team, name: h.name })),
  })

  for (const h of room.humans) {
    const u = room.sim.byOwner.get(h.id)
    send(h.ws, {
      type: 'match-start',
      youTeam: h.team,
      youUnit: u ? u.id : null,
      teamSize: TEAM_SIZE,
      map: MAP_SIZE,
      tickHz: TICK_HZ,
    })
  }
  console.log(`[ws] ${room.id}: старт ${TEAM_SIZE}x${TEAM_SIZE}, людей ${room.humans.length}, ботов ${TEAM_SIZE * 2 - room.humans.length}`)

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
  const human = { id, name: `Игрок ${id}`, team: 0, ws }
  room.humans.push(human)
  ws.playerId = id
  ws.room = room

  send(ws, { type: 'init', id, map: MAP_SIZE, tickHz: TICK_HZ, teamSize: TEAM_SIZE, waitMs: WAIT_MS })
  console.log(`[ws] ${id} → ${room.id} (${room.humans.length} чел.)`)

  if (room.humans.length === 1) {
    room.waitTimer = setTimeout(() => startRoom(room), WAIT_MS)
  }
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
    if (!room.started && room.humans.length === 0) endRoom(room)
    if (room.started && room.humans.length === 0) endRoom(room) // некому слать
  })
})

console.log(`[ws] Panzer TG ${TEAM_SIZE}x${TEAM_SIZE} authoritative server on :${PORT} (${TICK_HZ}Hz, добор ботами через ${WAIT_MS}мс)`)
