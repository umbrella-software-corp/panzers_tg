// ДЕКОР-УКРЫТИЯ военных карт. Генерится ДЕТЕРМИНИРОВАННО (общий seed по id карты),
// поэтому позиции совпадают на сервере и в клиентском предикте — иначе танк дёргался бы
// у препятствий. Возвращает obstacles в dx/dy (как в maps.js):
//   { dx, dy, r, kind:'block', prop }
// kind:'block' → sim._collide толкает танк (твёрдое), а _lineBlocked режет выстрел/обзор
// (крупные = реальное укрытие, мелкие почти не мешают). prop → клиент рисует GLB-модель
// (NetGame3D) и прячет точку с миникарты. Координаты dx/dy — в системе MAP_SIZE (±1200),
// r — в пикселях (как у штатных obstacles, не масштабируется sc).
import { MAP_SIZE } from './config.js'

// набор укрытий по карте: [prop, count]. Только военные карты; природные — чистые.
const SETS = {
  desert: [['barrel', 4], ['hedgehog', 3], ['crate', 3], ['tent', 2], ['wreck', 1]],
  ruins: [['wreck', 2], ['tires', 3], ['barrel', 3], ['hedgehog', 2], ['crate', 2]],
  eisenstadt: [['hedgehog', 4], ['tires', 3], ['wreck', 1], ['barrel', 3]],
  city: [['hedgehog', 3], ['tires', 3], ['wreck', 1], ['barrel', 2], ['crate', 2]],
  heights: [['barrel', 3], ['hedgehog', 3], ['bunker', 2], ['tires', 2]],
}
// радиус коллизии/укрытия (px). Мелкие почти не режут луч, крупные держат снаряд.
const RAD = { barrel: 13, crate: 18, hedgehog: 26, tires: 18, tent: 34, wreck: 46, bunker: 40 }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(s) { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }

export function decorObstacles(map) {
  const set = SETS[map.id]
  if (!set) return []
  const half = MAP_SIZE / 2 // dx/dy всегда ±1200 (sc растягивает в актуальные px)
  const rnd = mulberry32((hash(map.id) ^ 0x9e3779b9) >>> 0)
  const out = []
  const okay = (x, y, r) => {
    if (Math.abs(x) > half - 130 || Math.abs(y) > half - 130) return false
    for (const b of map.bases) if (Math.hypot(x - b.dx, y - b.dy) < b.r + r + 70) return false
    for (const p of map.caps) if (Math.hypot(x - p.dx, y - p.dy) < p.r + r + 45) return false
    // полосы спавна (dy≈±560, |dx|≲460) держим свободными — иначе танк рождается в укрытии
    if (Math.abs(x) < 470 && Math.abs(Math.abs(y) - 560) < 200) return false
    for (const o of map.obstacles) {
      if (o.prop) continue // не на уже поставленном декоре
      if (o.kind === 'water' && Math.hypot(x - o.dx, y - o.dy) < o.r + r + 20) return false
    }
    for (const w of map.walls) {
      if (x > w.dx - w.w / 2 - r - 20 && x < w.dx + w.w / 2 + r + 20 && y > w.dy - w.h / 2 - r - 20 && y < w.dy + w.h / 2 + r + 20) return false
    }
    for (const d of out) if (Math.hypot(x - d.dx, y - d.dy) < d.r + r + 26) return false
    return true
  }
  for (const [prop, count] of set) {
    const r = RAD[prop] || 20
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, ok = false, tries = 0
      do { x = (rnd() * 2 - 1) * (half - 130); y = (rnd() * 2 - 1) * (half - 130); ok = okay(x, y, r); tries++ } while (!ok && tries < 40)
      if (!ok) continue
      out.push({ dx: Math.round(x), dy: Math.round(y), r, kind: 'block', prop })
    }
  }
  return out
}

// единожды дополнить карты декором (идемпотентно — защита от повторного импорта/HMR)
export function applyDecor(maps) {
  for (const m of maps) {
    if (m.__decorApplied) continue
    m.__decorApplied = true
    const d = decorObstacles(m)
    if (d.length) m.obstacles.push(...d)
  }
}
