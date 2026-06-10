// Headless-проверка 7x7 через настоящий WS: 3 «человека» + добор ботами.
// Меряем поток состояния, полосу на клиента, ход/выстрелы, доезд до конца.
// Запуск: WAIT_MS=1500 node src/index.js & затем node smoke.js
import WebSocket from 'ws'

const URL = process.env.URL || 'ws://127.0.0.1:8080'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function client(name) {
  const ws = new WebSocket(URL)
  const log = { name, init: null, start: null, states: 0, bytes: 0, events: [], end: null, you: null, err: null }
  ws.on('message', (d) => {
    log.bytes += d.length
    const m = JSON.parse(d.toString())
    if (m.type === 'init') log.init = m
    else if (m.type === 'match-start') log.start = m
    else if (m.type === 'state') {
      log.states++
      log.lastState = m
      log.you = m.you
      for (const e of m.events || []) if (e.type === 'shot' || e.type === 'kill') log.events.push(e)
    } else if (m.type === 'match-end') log.end = m
  })
  ws.on('error', (e) => (log.err = e.message))
  return { ws, log, send: (o) => ws.readyState === 1 && ws.send(JSON.stringify(o)) }
}

const opened = (c) => new Promise((res, rej) => { c.ws.on('open', res); c.ws.on('error', rej) })

const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ ok: false, reason: 'TIMEOUT' }))
  process.exit(2)
}, 30000)

async function main() {
  const clients = [client('a'), client('b'), client('c')]
  await Promise.all(clients.map(opened))
  // ждём старта (сервер добирает ботами через WAIT_MS)
  while (!clients.every((c) => c.log.start)) await sleep(100)

  const a = clients[0]
  // едем вперёд и постреливаем 6 секунд
  const drive = setInterval(() => a.send({ type: 'input', throttle: 1, steer: 0 }), 100)
  const guns = setInterval(() => clients.forEach((c) => c.send({ type: 'fire' })), 1300)
  const t0 = Date.now()
  const bytes0 = a.log.bytes
  await sleep(6000)
  clearInterval(drive)
  clearInterval(guns)
  a.send({ type: 'input', throttle: 0, steer: 0 })

  const secs = (Date.now() - t0) / 1000
  const kbps = (a.log.bytes - bytes0) / 1024 / secs

  const st = a.log.lastState
  const me = st.units.find((u) => u.id === a.log.start.youUnit)
  const results = {
    started: clients.every((c) => !!c.log.start),
    teamsSplit: new Set(clients.map((c) => c.log.start.youTeam)).size === 2,
    unitsVisible: st.units.length, // свои 7 + засвеченные враги + обломки
    fullRoster: st.units.filter((u) => u.team === a.log.start.youTeam).length === 7,
    statesFlow: a.log.states > 80, // ~20Гц × 6с
    moved: me && Math.abs(me.y - 1760) > 150, // спавн команды 0: y=c+560
    shotsSeen: a.log.events.filter((e) => e.type === 'shot').length,
    youPersonal: !!a.log.you && typeof a.log.you.reload01 === 'number',
    kbPerSecPerClient: +kbps.toFixed(1),
  }
  const ok = results.started && results.teamsSplit && results.fullRoster && results.statesFlow && results.moved && results.shotsSeen > 0 && results.youPersonal
  console.log(JSON.stringify({ ok, ...results }, null, 2))
  clearTimeout(watchdog)
  clients.forEach((c) => c.ws.close())
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }))
  process.exit(3)
})
