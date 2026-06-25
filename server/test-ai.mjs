// Юнит-тесты честности/обороны ИИ ботов (по ревью Codex). Детерминированные сценарии:
// чистим obstacles/walls, ставим юниты руками, проверяем НАМЕРЕНИЕ (brain/plan), а не геометрию карт.
// Запуск: node server/test-ai.mjs
import { BattleSim } from 'panzer-tg-shared'

let failed = 0
const ok = (name, cond, extra = '') => { console.log(`${cond ? '✓' : '✗ FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++ }
const step = (sim, n, dt = 1 / 20) => { for (let i = 0; i < n; i++) { sim.step(dt); sim.takeEvents() } }

// 1) ЧЕСТНАЯ ПАМЯТЬ: цель ушла из вида → lastSeen остаётся у ПОСЛЕДНЕЙ виденной точки, не у живых координат
{
  const sim = new BattleSim({ teamSize: 1, mode: 'annihilation' })
  sim.obstacles = []; sim.walls = [] // чистая LOS — тестируем память, а не стены
  const A = sim.units.find((u) => u.team === 0), B = sim.units.find((u) => u.team === 1)
  A.x = 1000; A.y = 1000; A.hull = 0; B.x = 1000; B.y = 1300 // 300px, в зоне видимости (500), LOS чиста
  step(sim, 40, 1 / 30) // коммит цели (think ~каждые 0.4с)
  const committed = !!(A.brain && A.brain.targetId === B.id && A.brain.lastSeen)
  B.x = 100; B.y = 1000 // ТЕЛЕПОРТ вбок, далеко вне видимости A (~900px > vision)
  step(sim, 6, 1 / 30) // в пределах giveUpSec — цель ещё «в памяти»
  const ls = A.brain.lastSeen
  const stillTarget = A.brain.targetId === B.id
  const memoryNotLive = ls && Math.abs(ls.x - B.x) > 400 && Math.abs(ls.x - 1000) < 300 // у старой колонны (~1000), не у новой (100)
  ok('bot_memory_uses_last_seen_not_live_coords', committed && stillTarget && memoryNotLive, `lastSeen.x=${ls ? Math.round(ls.x) : 'null'} liveB.x=${B.x}`)
}

// 2) НЕТ «магической» обороны: враг рядом со своей точкой, но НЕ в засвете и НЕ contest'ит → defend НЕ включается
{
  const sim = new BattleSim({ teamSize: 7, mode: 'capture' })
  sim.obstacles = []; sim.walls = []
  const cap = sim.caps[0]; cap.owner = 0; cap.capper = null
  for (const u of sim.units) { u.x = 60; u.y = 60 } // паркуем всех в угол (никто никого не видит у точки)
  const enemy = sim.units.find((u) => u.team === 1 && u.alive)
  enemy.x = cap.x + cap.r * 1.5; enemy.y = cap.y // в радиусе cap.r·2, но ВНЕ cap.r и вне чужого обзора
  step(sim, 1) // директор строит план (первый тик: _spotted ещё пуст → честно «не видим»)
  const defended = sim.director && sim.director.team[0] && sim.director.team[0].defend.has(cap.id)
  ok('hidden_enemy_near_cap_no_magic_defense', defended === false, `defend.has(cap)=${defended}`)
}

// 3) Contested точка → defend ВКЛЮЧАЕТСЯ (честный объективный сигнал режима), даже без личной цели
{
  const sim = new BattleSim({ teamSize: 7, mode: 'capture' })
  sim.obstacles = []; sim.walls = []
  const cap = sim.caps[0]; cap.owner = 0
  for (const u of sim.units) { u.x = 60; u.y = 60 }
  const enemy = sim.units.find((u) => u.team === 1 && u.alive)
  enemy.x = cap.x + cap.r * 0.5; enemy.y = cap.y // ФИЗИЧЕСКИ в круге → contested (объективно обеим сторонам)
  step(sim, 1)
  const defended = sim.director && sim.director.team[0] && sim.director.team[0].defend.has(cap.id)
  ok('contested_cap_triggers_defense', defended === true, `defend.has(cap)=${defended}`)
}

// 4) ИНВАРИАНТ ЧЕСТНОСТИ: бот НЕ стреляет по человеку до грейса (graceSec)
{
  const sim = new BattleSim({ teamSize: 1, humans: [{ id: 'h', team: 0, name: 'H' }] })
  sim.obstacles = []; sim.walls = []
  const H = sim.units.find((u) => u.human), B = sim.units.find((u) => !u.human && u.team === 1)
  H.x = 1000; H.y = 1000; B.x = 1000; B.y = 1080 // в упор, чистая LOS — соблазн выстрелить
  const grace = sim.ai.graceSec
  let firedAtHumanEarly = false
  const ticks = Math.floor((grace - 0.5) * 20) // до грейса
  for (let i = 0; i < ticks; i++) { sim.step(1 / 20); for (const e of sim.takeEvents()) if (e.type === 'shot' && e.unit === B.id && e.target === H.id) firedAtHumanEarly = true }
  ok('bot_never_fires_at_human_before_grace', !firedAtHumanEarly, `grace=${grace}s`)
}

// 5) СТАБИЛЬНОСТЬ focus-стрелков: при ОДНОМ приказе (тот же targetId) состав не подменяется целиком
{
  const sim = new BattleSim({ teamSize: 7, mode: 'annihilation' })
  let prev = null, fullSwaps = 0, samples = 0
  for (let i = 0; i < 20 * 60 && !sim.matchOver; i++) {
    sim.step(1 / 20); sim.takeEvents()
    const f = sim.director && sim.director.team[0] && sim.director.team[0].focus
    if (f && prev && f.targetId === prev.targetId && f.shooters.size > 0) {
      const kept = [...f.shooters].filter((id) => prev.shooters.has(id)).length
      if (kept === 0) fullSwaps++ // полная замена состава при том же приказе = плохо
      samples++
    }
    prev = f ? { targetId: f.targetId, shooters: new Set(f.shooters) } : null
  }
  ok('focus_shooters_stable_during_order', samples > 0 && fullSwaps === 0, `samples=${samples} fullSwaps=${fullSwaps}`)
}

console.log(failed ? `\n${failed} тест(ов) упало` : '\nВсе AI-тесты прошли')
process.exit(failed ? 1 : 0)
