// E2E-тест реконнекта (запуск: node reconnect-test.mjs из server/).
// Бой стартует → боевой сокет «умирает» → новый сокет с ?rejoin= возвращает в ТУ
// ЖЕ комнату за тот же юнит, снапшоты возобновляются, время боя идёт дальше.
// На iOS боевой WS молча умирает на старте боя — это лечит именно реконнект.
import { WebSocket } from 'ws'
import { spawn } from 'child_process'

const PORT = 8137
const WS = `ws://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const srv = spawn('node', ['src/index.js'], {
  cwd: new URL('.', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), WAIT_MS: '2500' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
srv.stdout.on('data', (d) => (log += d))
srv.stderr.on('data', (d) => (log += d))
await sleep(700)

// первый боевой сокет: входим, ждём match-start + снапшоты
function battle(onState) {
  return new Promise((resolve) => {
    const s = new WebSocket(`${WS}/?party=555`)
    const st = { ws: s, start: null, states: 0, lastMT: null, end: null }
    s.on('open', () => s.send(JSON.stringify({ type: 'join', name: 'Tester', tankId: 'tx', tint: 0, skin: null, battles: 1, stats: null })))
    s.on('message', (raw) => {
      const m = JSON.parse(raw)
      if (m.type === 'init') resolve(st)
      else if (m.type === 'match-start') st.start = m
      else if (m.type === 'state') { st.states++; st.lastMT = m.matchTime; onState && onState(st, m) }
      else if (m.type === 'match-end') st.end = m
    })
  })
}

const a = await battle()
await sleep(3200) // WAIT_MS=2500 + запас: match-start + первые снапшоты
const start = a.start
const beforeStates = a.states
const beforeMT = a.lastMT
console.log('старт:', !!start, '| room=' + (start && start.room), 'unit=' + (start && start.youUnit), 'rkey=' + (start && start.rkey ? 'есть' : 'нет'), '| снапшотов', beforeStates, 'matchTime', beforeMT)

// сокет «умирает» — закрываем, как мёртвый iOS-сокет
a.ws.close()
await sleep(400)

// реконнект: новый сокет с rejoin → должен вернуть в ту же комнату за тот же юнит
const r = await new Promise((resolve) => {
  const url = `${WS}/?rejoin=${start.room}&unit=${start.youUnit}&rkey=${start.rkey}`
  const s = new WebSocket(url)
  const st = { ws: s, rejoined: null, states: 0, lastMT: null }
  s.on('open', () => {})
  s.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.type === 'match-start' && m.rejoined) { st.rejoined = m; resolve(st) }
    else if (m.type === 'rejoin-fail') { st.fail = true; resolve(st) }
    else if (m.type === 'state') { st.states++; st.lastMT = m.matchTime }
  })
  s.on('close', () => resolve(st))
})

await sleep(1500) // дать снапшотам потечь на новый сокет
srv.kill('SIGKILL')
await sleep(300)

const ok =
  !!start && !!start.room && !!start.rkey &&
  !r.fail && !!r.rejoined &&
  r.rejoined.room === start.room && r.rejoined.youUnit === start.youUnit &&
  r.states > 5 && r.lastMT < beforeMT // время боя идёт дальше — это ТОТ ЖЕ живой бой

console.log('реконнект:', r.rejoined ? `вернулись в ${r.rejoined.room} за юнит ${r.rejoined.youUnit}` : (r.fail ? 'rejoin-fail' : 'нет ответа'),
  '| новых снапшотов', r.states, '| matchTime', beforeMT, '→', r.lastMT, '(идёт дальше:', r.lastMT < beforeMT, ')')
console.log('--- сервер ---\n' + log.split('\n').filter((l) => /ВЕРНУЛСЯ|старт|вышел/.test(l)).slice(-4).join('\n'))
console.log(ok ? 'TEST_PASS' : 'TEST_FAIL')
process.exit(ok ? 0 : 1)
