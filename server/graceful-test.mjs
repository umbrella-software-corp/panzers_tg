// E2E-тест мягкого выключения (запуск: node graceful-test.mjs из server/).
// Взводный флоу + SIGTERM посреди боя — как systemctl restart при деплое.
// Ожидаем: оба боевых клиента получают match-end и close code=1001,
// участник лобби получает squad-disband. Печатает TEST_PASS/TEST_FAIL.
import { WebSocket } from 'ws'
import { spawn } from 'child_process'

const PORT = 8131
const WS_URL = `ws://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const srv = spawn('node', ['src/index.js'], {
  cwd: new URL('.', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), WAIT_MS: '3000' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let srvLog = ''
srv.stdout.on('data', (d) => (srvLog += d))
srv.stderr.on('data', (d) => (srvLog += d))
await sleep(700)

const mkSquad = (id, name) =>
  new Promise((resolve) => {
    const s = new WebSocket(`${WS_URL}/?squad=111`)
    const st = { ws: s, launch: false, disband: false, closeCode: null }
    s.on('open', () => s.send(JSON.stringify({ type: 'squad-join', id, name })))
    s.on('message', (raw) => {
      const m = JSON.parse(raw)
      if (m.type === 'squad') resolve(st)
      if (m.type === 'squad-launch') st.launch = true
      if (m.type === 'squad-disband') st.disband = true
    })
    s.on('close', (code) => (st.closeCode = code))
  })

const mkBattle = (name) =>
  new Promise((resolve) => {
    const s = new WebSocket(`${WS_URL}/?party=111`)
    const st = { ws: s, states: 0, matchStart: false, matchEnd: null, closeCode: null }
    s.on('open', () => s.send(JSON.stringify({ type: 'join', name, tankId: 'tx', tint: 0, skin: null, battles: 1, stats: null })))
    s.on('message', (raw) => {
      const m = JSON.parse(raw)
      if (m.type === 'init') resolve(st)
      if (m.type === 'state') st.states++
      if (m.type === 'match-start') st.matchStart = true
      if (m.type === 'match-end') st.matchEnd = m
    })
    s.on('close', (code) => (st.closeCode = code))
  })

// 1. взвод-лобби: командир + участник, командир жмёт launch
const sqA = await mkSquad('111', 'Commander')
const sqB = await mkSquad('222', 'Friend')
await sleep(100)
sqA.ws.send(JSON.stringify({ type: 'ready', ready: true }))
sqB.ws.send(JSON.stringify({ type: 'ready', ready: true }))
await sleep(100)
sqA.ws.send(JSON.stringify({ type: 'launch', mode: 'capture' }))
await sleep(200)
console.log('squad-launch получен:', sqA.launch, sqB.launch)

// командир закрывает лобби-сокет (как реальный клиент), участник ОСТАЁТСЯ в
// лобби — проверим, что на выключении ему придёт squad-disband.
// (в реальном клиенте оба закрывают; держим B специально для проверки)
sqA.ws.close()

// 2. боевые сокеты с тем же party
const bA = await mkBattle('Commander')
const bB = await mkBattle('Friend')
await sleep(3600) // WAIT_MS=3000 + запас: match-start + первые снапшоты
console.log('match-start:', bA.matchStart, bB.matchStart, '| снапшоты:', bA.states, bB.states)

// 3. SIGTERM посреди боя — как systemctl restart при деплое
srv.kill('SIGTERM')
await sleep(1200)

const ok =
  bA.matchStart && bB.matchStart &&
  bA.states > 10 && bB.states > 10 &&
  !!bA.matchEnd && !!bB.matchEnd &&
  bA.closeCode === 1001 && bB.closeCode === 1001 &&
  sqB.disband === true
console.log('match-end:', JSON.stringify(bA.matchEnd && { winner: bA.matchEnd.winner, score: bA.matchEnd.score, stats: bA.matchEnd.stats.length }),
  '| close-коды:', bA.closeCode, bB.closeCode, '| squad-disband участнику:', sqB.disband)
console.log('--- лог сервера ---\n' + srvLog.split('\n').filter(Boolean).slice(-6).join('\n'))
console.log(ok ? 'TEST_PASS' : 'TEST_FAIL')
process.exit(ok ? 0 : 1)
