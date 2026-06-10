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
const ok = matches.every((m) => m.durationSec > 45 && m.durationSec <= 245)
process.exit(ok ? 0 : 1)
