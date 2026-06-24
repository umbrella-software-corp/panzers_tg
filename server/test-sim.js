// Headless-тест BattleSim 7x7: полные матчи ботов + бенчмарк тика.
// Запуск: pnpm --filter panzer-tg-server test:sim
import { BattleSim } from 'panzer-tg-shared'

const DT = 1 / 20

// --- 5 полных матчей ботов ---
const matches = []
for (let i = 0; i < 5; i++) {
  const sim = new BattleSim({ teamSize: 7 })
  const t0 = performance.now()
  let steps = 0
  while (!sim.matchOver && steps < 20 * 400) {
    sim.step(DT)
    sim.takeEvents()
    steps++
  }
  matches.push({
    durationSec: Math.round(240 - sim.matchTime),
    winner: sim.winner,
    score: sim.score.join(':'),
    alive: `${sim.aliveCount(0)}v${sim.aliveCount(1)}`,
    wallMs: Math.round(performance.now() - t0),
  })
}

// --- бенчмарк: сколько стоит один тик 7x7 ---
const sim = new BattleSim({ teamSize: 7 })
const N = 5000
const t0 = performance.now()
for (let i = 0; i < N; i++) {
  sim.step(DT)
  sim.takeEvents()
  if (sim.matchOver) break
}
const perTickMs = (performance.now() - t0) / N

// --- размер снапшота ---
const sim2 = new BattleSim({ teamSize: 7 })
for (let i = 0; i < 60; i++) sim2.step(DT)
const snapBytes = JSON.stringify(sim2.snapshotForTeam(0)).length

console.log(JSON.stringify({ matches, perTickMs: +perTickMs.toFixed(4), snapshotBytes: snapBytes }, null, 2))

// --- смоук: человек выходит из боя посреди матча (humanLeft) → ИИ доигрывает без падений ---
// ex-человек не имеет brain; _stepBot создаёт его лениво. Проверяем: нет throw, конвертит
// получает мозг/роль/состояние (командир подхватывает его на следующем плане).
let smokeOk = false
try {
  const sim = new BattleSim({ teamSize: 7, humans: [{ id: 'h1', team: 0, name: 'Тест' }] })
  for (let i = 0; i < 20 * 40 && !sim.matchOver; i++) {
    sim.step(DT)
    sim.takeEvents()
    if (i === 20 * 20) sim.humanLeft('h1') // на ~20-й секунде игрок выходит → бот доигрывает
  }
  const conv = sim.units.find((u) => u.id === 1) // ex-человек (первый юнит команды 0)
  smokeOk = !!(conv && !conv.human && conv.brain && conv.brain.role && conv.brain.state)
  console.log(JSON.stringify({ humanLeftSmoke: { ok: smokeOk, role: conv && conv.brain ? conv.brain.role : null, state: conv && conv.brain ? conv.brain.state : null } }))
} catch (e) {
  console.log('humanLeftSmoke THREW:', (e && e.message) || e)
}

const durOk = matches.every((m) => m.durationSec > 45 && m.durationSec <= 245)
process.exit(durOk && smokeOk ? 0 : 1)
