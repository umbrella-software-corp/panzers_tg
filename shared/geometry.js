// Геометрия боя (общая для клиента и сервера).

export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export function segHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const px = x1 + t * dx
  const py = y1 + t * dy
  return Math.hypot(px - cx, py - cy) <= r
}

// пересечение отрезка с осевым прямоугольником (Liang–Barsky)
export function segHitsRect(x1, y1, x2, y2, minx, miny, maxx, maxy) {
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  const clip = (p, q) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (!clip(-dx, x1 - minx)) return false
  if (!clip(dx, maxx - x1)) return false
  if (!clip(-dy, y1 - miny)) return false
  if (!clip(dy, maxy - y1)) return false
  return t0 <= t1
}
