// Валидатор карт: спавны чистые, точки захвата достижимы с обеих баз (BFS),
// круги захвата не накрыты кустами (стелс-кап) и не запечатаны стенами.
// Запуск: node server/test-maps.js (или pnpm --filter panzer-tg-server test:maps)
import { MAPS } from 'panzer-tg-shared/maps.js'
import { MAP_SIZE, TANK_RADIUS } from 'panzer-tg-shared/config.js'

const C = MAP_SIZE / 2
const GRID = 20 // шаг сетки BFS, px

function blockedAt(map, x, y) {
  if (x < 60 || y < 60 || x > MAP_SIZE - 60 || y > MAP_SIZE - 60) return true
  for (const o of map.obstacles) {
    if (o.kind === 'bush') continue // проходим
    if (Math.hypot(x - (C + o.dx), y - (C + o.dy)) < o.r + TANK_RADIUS) return true
  }
  for (const w of map.walls) {
    const hw = w.w / 2 + TANK_RADIUS
    const hh = w.h / 2 + TANK_RADIUS
    if (Math.abs(x - (C + w.dx)) < hw && Math.abs(y - (C + w.dy)) < hh) return true
  }
  return false
}

// BFS по сетке от точки; возвращает Set достижимых ячеек
function reachableFrom(map, sx, sy) {
  const W = Math.ceil(MAP_SIZE / GRID)
  const key = (cx, cy) => cy * W + cx
  const start = [Math.round(sx / GRID), Math.round(sy / GRID)]
  const seen = new Set([key(...start)])
  const q = [start]
  while (q.length) {
    const [cx, cy] = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx
      const ny = cy + dy
      const k = key(nx, ny)
      if (nx < 0 || ny < 0 || nx >= W || ny >= W || seen.has(k)) continue
      if (blockedAt(map, nx * GRID, ny * GRID)) continue
      seen.add(k)
      q.push([nx, ny])
    }
  }
  return { seen, key, W }
}

// ближайшая свободная ячейка внутри круга (точка может быть прикрыта укрытием по центру)
function circleReachable(map, reach, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y += GRID) {
    for (let x = cx - r; x <= cx + r; x += GRID) {
      if (Math.hypot(x - cx, y - cy) > r) continue
      if (blockedAt(map, x, y)) continue
      if (reach.seen.has(reach.key(Math.round(x / GRID), Math.round(y / GRID)))) return true
    }
  }
  return false
}

// доля площади круга захвата, накрытая кустами (стелс-кап)
function bushCover(map, cx, cy, r) {
  let total = 0
  let bush = 0
  for (let y = cy - r; y <= cy + r; y += 10) {
    for (let x = cx - r; x <= cx + r; x += 10) {
      if (Math.hypot(x - cx, y - cy) > r) continue
      total++
      for (const o of map.obstacles) {
        if (o.kind !== 'bush') continue
        if (Math.hypot(x - (C + o.dx), y - (C + o.dy)) < o.r) {
          bush++
          break
        }
      }
    }
  }
  return total ? bush / total : 0
}

let fail = 0
for (const map of MAPS) {
  const issues = []
  // 1) спавны: 7 слотов на команду, полоса dy=±560, разброс как в sim
  for (const team of [0, 1]) {
    for (let slot = 0; slot < 7; slot++) {
      const spread = ((slot - 3) / 7) * 1000
      const x = C + spread
      const y = team === 0 ? C + 560 : C - 560
      if (blockedAt(map, x, y)) issues.push(`спавн T${team}/слот${slot} (${Math.round(x - C)},${Math.round(y - C)}) заблокирован`)
    }
  }
  // 2) достижимость: с обеих баз до всех точек захвата и до чужой базы
  for (const [bi, base] of map.bases.entries()) {
    const reach = reachableFrom(map, C + base.dx, C + base.dy - (bi === 0 ? 200 : -200))
    for (const cap of map.caps) {
      if (!circleReachable(map, reach, C + cap.dx, C + cap.dy, cap.r)) issues.push(`точка ${cap.id} недостижима с базы ${bi}`)
    }
    const other = map.bases[1 - bi]
    if (!circleReachable(map, reach, C + other.dx, C + other.dy, other.r)) issues.push(`база ${1 - bi} недостижима с базы ${bi}`)
  }
  // 3) кусты на точках: > 30% площади круга — стелс-кап
  for (const cap of map.caps) {
    const cover = bushCover(map, C + cap.dx, C + cap.dy, cap.r)
    if (cover > 0.3) issues.push(`точка ${cap.id}: кусты накрывают ${Math.round(cover * 100)}% круга`)
  }

  if (issues.length) {
    fail++
    console.log(`✗ ${map.id} («${map.name}»)`)
    for (const i of issues) console.log(`   - ${i}`)
  } else {
    console.log(`✓ ${map.id} («${map.name}»)`)
  }
}
console.log(fail ? `\nПроблемных карт: ${fail}` : '\nВсе карты валидны')
process.exit(fail ? 1 : 0)
