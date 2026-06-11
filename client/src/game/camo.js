// ============ Узорные камуфляжи ============
// Детерминированный генератор узора на canvas: один и тот же seed даёт один
// и тот же рисунок у всех клиентов (узор игрока видят все). Узор кладётся
// поверх уже вырезанного в альфу спрайта танка через source-atop с альфой —
// тени и блики исходного рендера просвечивают, машина не превращается в пятно.

// mulberry32 — крошечный сидируемый PRNG
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// пятна: базовый цвет + капли остальных цветов (классический «лесной»)
function drawSpots(ctx, S, colors, rnd) {
  ctx.fillStyle = colors[0]
  ctx.fillRect(0, 0, S, S)
  for (let ci = 1; ci < colors.length; ci++) {
    ctx.fillStyle = colors[ci]
    for (let b = 0; b < 11; b++) {
      const x = rnd() * S
      const y = rnd() * S
      const r = S * (0.05 + rnd() * 0.08)
      ctx.beginPath()
      // капля из нескольких перекрывающихся кругов — рваный край
      for (let k = 0; k < 4; k++) {
        const a = rnd() * Math.PI * 2
        const d = r * 0.6 * rnd()
        const cx = x + Math.cos(a) * d
        const cy = y + Math.sin(a) * d
        ctx.moveTo(cx + r, cy)
        ctx.arc(cx, cy, r * (0.5 + rnd() * 0.5), 0, Math.PI * 2)
      }
      ctx.fill()
    }
  }
}

// цифра: пиксельная сетка, кластеры соседних клеток одного цвета
function drawDigital(ctx, S, colors, rnd) {
  const cell = Math.max(4, Math.round(S / 20))
  ctx.fillStyle = colors[0]
  ctx.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const c = colors[Math.floor(rnd() * colors.length)]
      ctx.fillStyle = c
      ctx.fillRect(x, y, cell, cell)
      // случайный «отросток» — кластеры выглядят связно, а не шумом
      if (rnd() < 0.4) ctx.fillRect(x + cell, y, cell, cell)
      if (rnd() < 0.4) ctx.fillRect(x, y + cell, cell, cell)
    }
  }
}

// тигровые полосы: диагональные рваные ленты второго цвета по базе
function drawStripes(ctx, S, colors, rnd) {
  ctx.fillStyle = colors[0]
  ctx.fillRect(0, 0, S, S)
  ctx.save()
  ctx.translate(S / 2, S / 2)
  ctx.rotate(-Math.PI / 5)
  const W = S * 1.6
  ctx.fillStyle = colors[1]
  let y = -W / 2
  while (y < W / 2) {
    const h = S * (0.045 + rnd() * 0.05)
    ctx.beginPath()
    ctx.moveTo(-W / 2, y)
    const seg = W / 7
    for (let x = -W / 2; x <= W / 2; x += seg) ctx.lineTo(x + seg, y + (rnd() - 0.5) * h)
    for (let x = W / 2; x >= -W / 2; x -= seg) ctx.lineTo(x - seg, y + h * (0.4 + rnd() * 0.9))
    ctx.closePath()
    ctx.fill()
    y += h + S * (0.06 + rnd() * 0.05)
  }
  ctx.restore()
}

// узор камуфляжа на весь канвас S×S (для свотчей и наложения)
export function drawCamoPattern(ctx, S, camo, seed = 7) {
  const rnd = makeRng(seed)
  if (camo.type === 'digital') drawDigital(ctx, S, camo.colors, rnd)
  else if (camo.type === 'stripes') drawStripes(ctx, S, camo.colors, rnd)
  else drawSpots(ctx, S, camo.colors, rnd)
}

// наложить узор на канвас с танком (фон уже вырезан в альфу)
export function applyCamo(ctx, S, camo, seed = 7) {
  const pat = document.createElement('canvas')
  pat.width = pat.height = S
  drawCamoPattern(pat.getContext('2d'), S, camo, seed)
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  ctx.globalAlpha = camo.alpha ?? 0.55
  ctx.drawImage(pat, 0, 0)
  ctx.restore()
}

// CSS-превью узора для свотчей в ангаре (фоллбэк — ровный цвет tint)
export function camoCss(skin) {
  if (!skin.camo) return '#' + (skin.tint ?? 0xffffff).toString(16).padStart(6, '0')
  const [a, b, c] = skin.camo.colors
  if (skin.camo.type === 'stripes') return `repeating-linear-gradient(125deg, ${a} 0 4px, ${b} 4px 6px)`
  if (skin.camo.type === 'digital') return `conic-gradient(${a} 0 25%, ${b} 25% 50%, ${a} 50% 75%, ${c || b} 75%)`
  return `radial-gradient(circle at 30% 35%, ${b} 0 28%, transparent 28%), radial-gradient(circle at 70% 70%, ${c || b} 0 26%, transparent 26%), linear-gradient(${a}, ${a})`
}
