// Headless-проверка authoritative-сервера: два клиента, пейринг, движение, выстрел.
import WebSocket from 'ws'

const URL = process.env.URL || 'ws://127.0.0.1:8080'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function client() {
  const ws = new WebSocket(URL)
  const log = { init: null, matchStart: false, states: [], shots: [], err: null }
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    if (m.type === 'init') log.init = m
    else if (m.type === 'match-start') log.matchStart = true
    else if (m.type === 'state') log.states.push(m)
    else if (m.type === 'shot') log.shots.push(m)
  })
  ws.on('error', (e) => (log.err = e.message))
  return { ws, log, send: (o) => ws.readyState === 1 && ws.send(JSON.stringify(o)) }
}

const opened = (c) =>
  new Promise((res, rej) => {
    c.ws.on('open', res)
    c.ws.on('error', rej)
  })

// аварийный таймаут, чтобы тест не висел
const watchdog = setTimeout(() => {
  console.log('TIMEOUT — тест не завершился')
  process.exit(2)
}, 7000)

async function main() {
  const a = client()
  const b = client()
  await Promise.all([opened(a), opened(b)])
  await sleep(400) // init + match-start

  const lastA = () => a.log.states.at(-1)?.players.find((p) => p.id === a.log.init?.id)
  const yStart = lastA()?.y

  const drive = setInterval(() => a.send({ type: 'input', throttle: 1, steer: 0 }), 50)
  await sleep(1500)
  clearInterval(drive)
  a.send({ type: 'input', throttle: 0, steer: 0 })
  const yEnd = lastA()?.y

  a.send({ type: 'fire' })
  await sleep(250)

  const results = {
    bothInit: !!a.log.init && !!b.log.init,
    distinctSlots: a.log.init?.slot !== b.log.init?.slot,
    matchStarted: a.log.matchStart && b.log.matchStart,
    statesFlow: a.log.states.length > 20 && b.log.states.length > 20,
    twoPlayers: (a.log.states.at(-1)?.players.length || 0) === 2,
    movedForward: yStart != null && yEnd != null && yStart - yEnd > 100,
    shotBroadcast: a.log.shots.length > 0 && b.log.shots.length > 0,
  }
  const ok = Object.values(results).every(Boolean)
  console.log(
    JSON.stringify(
      { ok, movedBy: yStart != null && yEnd != null ? yStart - yEnd : null, statesA: a.log.states.length, ...results },
      null,
      2,
    ),
  )
  clearTimeout(watchdog)
  a.ws.close()
  b.ws.close()
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.log('ERROR', e.message)
  process.exit(3)
})
