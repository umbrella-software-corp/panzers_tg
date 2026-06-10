// Authoritative WS-сервер для 1v1.
// Клиент шлёт ввод (throttle/steer/fire) — сервер считает мир и рассылает снапшоты.
// Комната на 2 игроков; матч стартует, когда оба подключились.
import { WebSocketServer } from 'ws'
import {
  MAP_SIZE,
  TICK_HZ,
  TICK_DT,
  makePlayer,
  applyInput,
  step,
  tryFire,
  snapshot,
} from './sim.js'

const PORT = process.env.PORT || 8080
const wss = new WebSocketServer({ port: PORT })

let nextId = 1
const rooms = new Map() // roomId -> room
let waitingRoom = null

function getJoinRoom() {
  if (waitingRoom && Object.keys(waitingRoom.players).length < 2) return waitingRoom
  const room = {
    id: `r${nextId++}`,
    t: 0,
    players: {},
    sockets: new Map(),
    started: false,
    timer: null,
  }
  rooms.set(room.id, room)
  waitingRoom = room
  return room
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg)
  for (const ws of room.sockets.values()) {
    if (ws.readyState === ws.OPEN) ws.send(data)
  }
}

function startRoom(room) {
  room.started = true
  if (waitingRoom === room) waitingRoom = null
  broadcast(room, { type: 'match-start', map: MAP_SIZE })
  room.timer = setInterval(() => {
    step(room, TICK_DT)
    broadcast(room, snapshot(room))
  }, 1000 / TICK_HZ)
}

function endRoom(room) {
  if (room.timer) clearInterval(room.timer)
  rooms.delete(room.id)
  if (waitingRoom === room) waitingRoom = null
}

wss.on('connection', (ws) => {
  const id = `p${nextId++}`
  const room = getJoinRoom()
  const slot = Object.keys(room.players).length
  const player = makePlayer(id, slot)
  room.players[id] = player
  room.sockets.set(id, ws)
  ws.playerId = id
  ws.roomId = room.id

  ws.send(JSON.stringify({ type: 'init', id, slot, map: MAP_SIZE, tickHz: TICK_HZ }))
  console.log(`[ws] ${id} joined ${room.id} (slot ${slot})`)

  if (Object.keys(room.players).length === 2 && !room.started) startRoom(room)

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    const p = room.players[id]
    if (!p) return
    if (msg.type === 'input') {
      applyInput(p, msg)
    } else if (msg.type === 'fire') {
      const ev = tryFire(room, p)
      broadcast(room, ev)
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }))
    }
  })

  ws.on('close', () => {
    console.log(`[ws] ${id} left ${room.id}`)
    delete room.players[id]
    room.sockets.delete(id)
    broadcast(room, { type: 'player-left', id })
    if (Object.keys(room.players).length === 0) endRoom(room)
  })
})

console.log(`[ws] Panzer TG authoritative server on :${PORT} (${TICK_HZ}Hz)`)
