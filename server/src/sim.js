// Серверная авторитетная симуляция танкового боя 1v1.
// Сервер — источник истины: считает движение и попадания, клиент шлёт только ввод.
// Константы пока для одного класса (средний); позже синхронизируем с client/config.

export const MAP_SIZE = 2400
export const TICK_HZ = 30
export const TICK_DT = 1 / TICK_HZ

const SHIP = {
  maxSpeed: 175,
  accel: 430,
  turnRate: 2.3,
  range: 600,
  sectorHalf: (46 * Math.PI) / 360, // половина сектора, рад
  sweepPeriod: 1.5,
  tolerance: (4 * Math.PI) / 180,
  reload: 3.4,
  damage: 34,
  radius: 22,
  maxHp: 100,
}

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function sweepOffset(t) {
  const p = (t % SHIP.sweepPeriod) / SHIP.sweepPeriod
  const tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p
  return SHIP.sectorHalf * tri
}

export function makePlayer(id, slot) {
  // двое стартуют на противоположных концах арены лицом друг к другу
  const c = MAP_SIZE / 2
  const up = slot === 0
  return {
    id,
    slot,
    x: c,
    y: up ? c + 500 : c - 500,
    hull: up ? -Math.PI / 2 : Math.PI / 2,
    speed: 0,
    hp: SHIP.maxHp,
    alive: true,
    reload: 0,
    input: { throttle: 0, steer: 0 },
    kills: 0,
    deaths: 0,
  }
}

export function applyInput(p, input) {
  // санитизация ввода с клиента
  p.input.throttle = Math.max(0, Math.min(1, +input.throttle || 0))
  p.input.steer = Math.max(-1, Math.min(1, +input.steer || 0))
}

// один шаг симуляции комнаты; events — массив для побочных событий (выстрелы/попадания)
export function step(room, dt) {
  room.t += dt
  const players = Object.values(room.players)

  for (const p of players) {
    if (!p.alive) {
      p.respawn -= dt
      if (p.respawn <= 0) respawn(p)
      continue
    }
    if (p.reload > 0) p.reload -= dt

    p.hull += p.input.steer * SHIP.turnRate * dt
    const speedTarget = SHIP.maxSpeed * p.input.throttle
    const da = SHIP.accel * dt
    if (p.speed < speedTarget) p.speed = Math.min(speedTarget, p.speed + da)
    else p.speed = Math.max(speedTarget, p.speed - da * 1.4)

    p.x += Math.cos(p.hull) * p.speed * dt
    p.y += Math.sin(p.hull) * p.speed * dt
    const m = 60
    p.x = Math.max(m, Math.min(MAP_SIZE - m, p.x))
    p.y = Math.max(m, Math.min(MAP_SIZE - m, p.y))
  }
}

// обработка выстрела игрока p по сопернику; возвращает событие
export function tryFire(room, p) {
  if (!p.alive || p.reload > 0) return { type: 'shot', shooter: p.id, hit: false, reason: 'reload' }
  p.reload = SHIP.reload

  const foe = Object.values(room.players).find((q) => q.id !== p.id && q.alive)
  if (!foe) return { type: 'shot', shooter: p.id, hit: false, reason: 'no-foe' }

  const ang = Math.atan2(foe.y - p.y, foe.x - p.x)
  const dist = Math.hypot(foe.x - p.x, foe.y - p.y)
  const lineAngle = p.hull + sweepOffset(room.t)
  const inRange = dist <= SHIP.range
  const inSector = inRange && Math.abs(angleDiff(ang, p.hull)) <= SHIP.sectorHalf
  const err = Math.abs(angleDiff(ang, lineAngle))
  const hit = inSector && err <= SHIP.tolerance

  if (hit) {
    foe.hp -= SHIP.damage
    if (foe.hp <= 0) {
      foe.hp = 0
      foe.alive = false
      foe.respawn = 2
      foe.deaths++
      p.kills++
    }
  }
  return { type: 'shot', shooter: p.id, target: foe.id, hit, lineAngle }
}

function respawn(p) {
  const c = MAP_SIZE / 2
  const up = p.slot === 0
  p.x = c
  p.y = up ? c + 500 : c - 500
  p.hull = up ? -Math.PI / 2 : Math.PI / 2
  p.hp = SHIP.maxHp
  p.speed = 0
  p.alive = true
}

// компактный снапшот для рассылки клиентам
export function snapshot(room) {
  return {
    type: 'state',
    t: +room.t.toFixed(3),
    players: Object.values(room.players).map((p) => ({
      id: p.id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      hull: +p.hull.toFixed(3),
      hp: p.hp,
      alive: p.alive,
      kills: p.kills,
      deaths: p.deaths,
    })),
  }
}

export const SIM = SHIP
