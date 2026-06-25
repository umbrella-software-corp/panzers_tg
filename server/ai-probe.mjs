// Метрика «дёрганья» ботов: гоняем матрицу матчей (все карты × оба режима × разные teamSize)
// и считаем для каждого бота, как часто он МЕНЯЕТ намерение — развороты курса (смена знака
// угловой скорости), реверсы хода (газ +↔−) и переключения цели. Меньше = осмысленнее/спокойнее.
// Методика смены цели ТА ЖЕ, что в BattleSim.aiSummary(): A→B (реальное метание) отдельно от
// null↔цель (вход/выход из контакта). Запуск: node server/ai-probe.mjs
import { BattleSim, MAPS } from 'panzer-tg-shared'

const DT = 1 / 30

// матрица прогонов: джиттер не должен зависеть от карты/режима/размера команды
function buildMatrix() {
  const runs = []
  for (const map of MAPS) for (const mode of ['capture', 'annihilation']) runs.push({ mapId: map.id, mode, teamSize: 7 })
  for (const teamSize of [3, 5]) for (const mode of ['capture', 'annihilation']) runs.push({ mapId: MAPS[0].id, mode, teamSize })
  return runs
}

function probe() {
  const matrix = buildMatrix()
  let turnFlips = 0, moveFlips = 0, targetSwitches = 0, acquireRelease = 0
  let botSeconds = 0
  for (const cfg of matrix) {
    const sim = new BattleSim({ teamSize: cfg.teamSize, mapId: cfg.mapId, mode: cfg.mode })
    const prev = new Map() // id -> { dSign, mSign, tId }
    let steps = 0
    while (!sim.matchOver && steps < 30 * 240) {
      sim.step(DT)
      sim.takeEvents()
      steps++
      for (const b of sim.units) {
        if (b.human || !b.alive) { prev.delete(b.id); continue }
        const px = b._probe || (b._probe = { x: b.x, y: b.y, hull: b.hull })
        const dHull = angNorm(b.hull - px.hull)
        // знак изменения курса (порог, чтобы микродрожь не считать)
        const dSign = Math.abs(dHull) > 0.004 ? Math.sign(dHull) : 0
        // знак хода: сравниваем смещение с направлением корпуса (вперёд/назад)
        const mvx = b.x - px.x, mvy = b.y - px.y
        const along = mvx * Math.cos(b.hull) + mvy * Math.sin(b.hull)
        const mSign = Math.abs(along) > 0.3 ? Math.sign(along) : 0
        const tId = b.brain ? b.brain.targetId : null
        const p = prev.get(b.id)
        if (p) {
          if (dSign !== 0 && p.dSign !== 0 && dSign !== p.dSign) turnFlips++
          if (mSign !== 0 && p.mSign !== 0 && mSign !== p.mSign) moveFlips++
          if (tId !== p.tId) {
            if (tId != null && p.tId != null) targetSwitches++ // A→B — реальное метание
            else acquireRelease++ // null↔цель — вход/выход из контакта
          }
          botSeconds += DT
        }
        prev.set(b.id, { dSign: dSign || (p ? p.dSign : 0), mSign: mSign || (p ? p.mSign : 0), tId })
        px.x = b.x; px.y = b.y; px.hull = b.hull
      }
    }
  }
  const perBotMin = botSeconds / 60
  return {
    runs: matrix.length,
    botMinutes: +perBotMin.toFixed(1),
    turnFlipsPerBotMin: +(turnFlips / perBotMin).toFixed(1),
    moveFlipsPerBotMin: +(moveFlips / perBotMin).toFixed(1),
    targetSwitchesPerBotMin: +(targetSwitches / perBotMin).toFixed(1), // A→B (реальное метание цели)
    acquireReleasePerBotMin: +(acquireRelease / perBotMin).toFixed(1), // null↔цель (вход/выход из контакта)
  }
}

function angNorm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }

console.log(JSON.stringify(probe(), null, 2))
