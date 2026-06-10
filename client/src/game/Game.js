import { Application, Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js'
import {
  TANK_CLASSES,
  DEFAULT_CLASS,
  MAP_SIZE,
  OBSTACLES,
  WALLS,
  BASES,
  CAPTURE_POINTS,
  CAP_TIME,
  CAP_TICK,
  SCORE_LIMIT,
  MATCH_TIME,
  CRIT_CHANCE,
  CRIT_TIME,
  RADIO_CRIT_MULT,
  CRIT_SLOTS,
  ENEMY_AI,
  TEAM_SIZE,
  ALLY_VISION,
  PROX_SPOT,
  BOT_CLASS_MIX,
  BOT_DMG_MULT,
  BOT_SPEED_MULT,
  classToRadians,
} from './config.js'

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function segHitsCircle(x1, y1, x2, y2, cx, cy, r) {
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
function segHitsRect(x1, y1, x2, y2, minx, miny, maxx, maxy) {
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

const DEG = 180 / Math.PI
const TEAM = { ALLY: 0, ENEMY: 1 }

// позывные ботов (дизайн-прототип): союзники — экипажи ИИ, враги — «живые» ники
const ALLY_NAMES = ['ст. сержант Ефимов', 'ефрейтор Козлов', 'мл. сержант Орлов', 'рядовой Багиров', 'сержант Чистяков']
const ENEMY_NAMES = ['Hans_77', 'Wolf_K', 'Otto_Panzer', 'Schnell88', 'Gretta_X', 'Fritz_22', 'Klaus_M', 'Dieter_9']

/**
 * 5v5: игрок + союзные боты против вражеских ботов на карте с препятствиями,
 * стенами-укрытиями и туманом войны. Механика наведения через линию сведения.
 */
export class Game {
  constructor() {
    this.app = new Application()
    this.t = 0

    this.tank = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 + 700 }
    this.hullAngle = -Math.PI / 2
    this.speed = 0
    this.joystick = { x: 0, y: 0, active: false }
    this.keys = { fwd: false, back: false, left: false, right: false }
    this.tankRadius = 22

    this.setClass(DEFAULT_CLASS)
    this.ready = true
    this.reloadRemaining = 0
    this.ammoMult = 1 // 1 = обычный снаряд, GOLD_AMMO_MULT = голдовый

    const c = MAP_SIZE / 2
    this.obstacles = OBSTACLES.map((o) => ({ x: c + o.dx, y: c + o.dy, r: o.r, kind: o.kind }))
    this.walls = WALLS.map((w) => ({
      cx: c + w.dx,
      cy: c + w.dy,
      hw: w.w / 2,
      hh: w.h / 2,
      hp: w.hp || Infinity,
      destructible: !!w.hp,
    }))
    this.bases = BASES.map((b) => ({ team: b.team, x: c + b.dx, y: c + b.dy, r: b.r, progress: 0 }))
    this.caps = CAPTURE_POINTS.map((p) => ({
      id: p.id,
      x: c + p.dx,
      y: c + p.dy,
      r: p.r,
      owner: null, // null | 0 (союз) | 1 (враг)
      capper: null, // кто сейчас захватывает
      progress: 0, // 0..1
    }))
    this.capTimer = 0

    // миникарта (2D-канвас из Battle.vue)
    this.minimap = null
    this.minimapCtx = null

    // команды: ALLY — игрок + (TEAM_SIZE-1) ботов, ENEMY — TEAM_SIZE ботов
    this.bots = []
    let id = 1
    for (let i = 0; i < TEAM_SIZE - 1; i++) {
      this.bots.push(this._makeBot(id++, TEAM.ALLY, i, TEAM_SIZE - 1))
    }
    for (let i = 0; i < TEAM_SIZE; i++) {
      this.bots.push(this._makeBot(id++, TEAM.ENEMY, i, TEAM_SIZE))
    }
    // эффекты выстрелов: летящие снаряды, взрывы, вспышки у ствола
    this.shells = [] // {x1,y1,x2,y2,t,dur,color,boom}
    this.booms = [] // {x,y,age,big}
    this.muzzles = [] // {x,y,a,age,color}

    this.kills = 0
    this.deaths = 0
    this.shots = 0
    this.hits = 0
    this.damageDealt = 0
    this.score = { ally: 0, enemy: 0 }

    // матч (Фаза 4)
    this.matchTime = MATCH_TIME
    this.matchOver = false
    this.result = null // 'victory' | 'defeat' | 'draw'
    this.paused = false // стартовый отсчёт держит бой на паузе

    // повреждение модулей (Фаза 5): секунды до починки на каждый слот (0 = исправен)
    this.crippled = { gun: 0, turret: 0, engine: 0, tracks: 0, radio: 0 }
    this.sweep = 0 // текущее смещение линии сведения (замирает при крите башни)

    this.hurtFlash = 0

    this.onState = () => {}
    this.onShot = () => {}
    this.onCrit = () => {}
    this.onKill = () => {} // фраг игрока → имя жертвы (килл-фид HUD)
    this.onSaved = () => {} // броня игрока спасла: 'ricochet' | 'nopen'
    this._gridDrawn = false
  }

  _spawnPoint(team, i, n) {
    // союзники снизу карты, враги сверху; разносим по горизонтали
    const c = MAP_SIZE / 2
    const spread = ((i - (n - 1) / 2) / Math.max(1, n)) * 900
    const y = team === TEAM.ALLY ? c + 560 : c - 560
    return { x: c + spread, y }
  }

  // src — боевые статы танка бота (deg-форма с hp); по умолчанию класс из микса
  _makeBot(id, team, i, n, src) {
    const p = this._spawnPoint(team, i, n)
    const cls = src || TANK_CLASSES[BOT_CLASS_MIX[i % BOT_CLASS_MIX.length]]
    return {
      id,
      team,
      classId: cls.id,
      tankId: cls.tankId || null, // конкретная машина из пула матчмейкинга
      name: team === TEAM.ALLY ? ALLY_NAMES[i % ALLY_NAMES.length] : ENEMY_NAMES[i % ENEMY_NAMES.length],
      x: p.x,
      y: p.y,
      i,
      n,
      hull: team === TEAM.ALLY ? -Math.PI / 2 : Math.PI / 2,
      hp: cls.hp,
      maxHp: cls.hp,
      damage: Math.round(cls.damage * BOT_DMG_MULT),
      reload: cls.reload,
      speed: cls.maxSpeed * BOT_SPEED_MULT,
      accel: (cls.accel || cls.maxSpeed * 1.1) * BOT_SPEED_MULT,
      vel: 0, // текущая скорость — боты разгоняются, а не телепортируются
      turnRate: cls.turnRate * 0.9,
      alive: true,
      fireCd: 1 + i * 0.2,
      flash: 0,
      spotted: false,
      stuckT: 0, // антизастревание (см. конец _updateBot)
      avoidT: 0,
      avoidDir: 1,
    }
  }

  setClass(id) {
    const base = TANK_CLASSES[id] || TANK_CLASSES[DEFAULT_CLASS]
    this.setStats(base)
  }

  // боты из пула конкретных танков (матчмейкинг ±1 тир); звать ДО mount
  setBotTanks(pool) {
    if (!pool || !pool.length) return
    const pick = () => pool[Math.floor(Math.random() * pool.length)]
    let id = 1
    this.bots = []
    for (let i = 0; i < TEAM_SIZE - 1; i++) this.bots.push(this._makeBot(id++, TEAM.ALLY, i, TEAM_SIZE - 1, pick()))
    for (let i = 0; i < TEAM_SIZE; i++) this.bots.push(this._makeBot(id++, TEAM.ENEMY, i, TEAM_SIZE, pick()))
  }

  // Принимает deg-форму статов (класс + модификаторы модулей, см. store.loadoutStats).
  setStats(base) {
    const src = base && base.sectorDeg ? base : TANK_CLASSES[DEFAULT_CLASS]
    this.cls = classToRadians(src)
    this.maxHp = src.hp || TANK_CLASSES[DEFAULT_CLASS].hp
    this.hp = this.maxHp
    this.ready = true
    this.reloadRemaining = 0
  }

  async mount(container) {
    await this.app.init({
      resizeTo: container,
      background: 0x0e1116,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    container.appendChild(this.app.canvas)

    // спрайты (AI-ассеты); без файлов всё рисуется вектором, как раньше
    this.tex = {}
    const tankNames = []
    for (const color of ['amber', 'blue', 'red']) {
      tankNames.push(`tank_${color}`) // средний/базовый
      for (const cls of ['light', 'heavy']) tankNames.push(`tank_${cls}_${color}`)
    }
    const texNames = ['ground', 'forest', 'rock', 'water', 'hill', 'building', 'explosion', ...tankNames]
    const loadedTex = await Promise.allSettled(texNames.map((n) => Assets.load(`/sprites/${n}.png`)))
    texNames.forEach((n, i) => {
      if (loadedTex[i].status === 'fulfilled') this.tex[n] = loadedTex[i].value
    })
    for (const k of Object.keys(this.tex)) {
      if (k.startsWith('tank_')) this.tex[k] = this._chromaKey(this.tex[k])
    }
    // реальные виды сверху: танк игрока + все машины ботов из пула
    const unitIds = new Set(this.bots.map((b) => b.tankId).filter(Boolean))
    if (this.playerTankId) unitIds.add(this.playerTankId)
    const idList = [...unitIds]
    const unitTex = await Promise.allSettled(idList.map((id) => Assets.load(`/sprites/tanks/${id}.png`)))
    idList.forEach((id, i) => {
      if (unitTex[i].status === 'fulfilled') this.tex[`unit_${id}`] = this._chromaKey(unitTex[i].value)
    })
    if (this.playerTankId && this.tex[`unit_${this.playerTankId}`])
      this.tex.player_tank = this.tex[`unit_${this.playerTankId}`]

    this.world = new Container()
    this.bg = new Graphics()
    this.terrain = new Graphics()
    this.gfx = new Graphics()
    this.terrLayer = new Container() // текстуры местности под векторными обводками
    this.tankLayer = new Container() // спрайты танков под HUD-графикой (hp-бары и т.п.)
    this.fxLayer = new Container() // аддитивные вспышки взрывов поверх всего
    if (this.tex.ground) {
      this.groundTile = new TilingSprite({ texture: this.tex.ground, width: MAP_SIZE, height: MAP_SIZE })
      this.groundTile.tileScale.set(0.55)
      this.world.addChild(this.groundTile)
    }
    this.world.addChild(this.bg, this.terrLayer, this.terrain, this.tankLayer, this.gfx, this.fxLayer)
    this.app.stage.addChild(this.world)

    // спрайты юнитов: игрок янтарный, союзники синие, враги красные
    this.unitSprites = null
    this.fxSprites = []
    if (this.tex.tank_amber && this.tex.tank_blue && this.tex.tank_red) {
      this.unitSprites = new Map()
      // спрайт по классу танка с фоллбэком на базовый цветовой
      const tankTex = (clsId, color) => this.tex[`tank_${clsId}_${color}`] || this.tex[`tank_${color}`]
      const mk = (tex, size) => {
        const s = new Sprite(tex)
        s.anchor.set(0.5)
        s.scale.set(size / s.texture.height)
        s.visible = false
        this.tankLayer.addChild(s)
        return s
      }
      this.unitSprites.set('player', mk(this.tex.player_tank || tankTex(this.cls.id, 'amber'), 96))
      for (const b of this.bots) {
        const size = b.classId === 'heavy' ? 92 : b.classId === 'light' ? 76 : 84
        // реальная машина бота; фоллбэк — классовый цветной спрайт
        const real = b.tankId && this.tex[`unit_${b.tankId}`]
        this.unitSprites.set(b.id, mk(real || tankTex(b.classId, b.team === TEAM.ALLY ? 'blue' : 'red'), size))
        b.realSprite = !!real // реальным нужен командный оттенок tint'ом
      }
    }

    // визуального тумана нет (по фидбеку — было темно): скрытность врагов
    // работает через засвет (не засвечен — просто не отрисован), баланс —
    // через обзор и дальность выстрела

    // имена ботов — экранный слой поверх тумана (мир вращается, текст — нет)
    this.labels = new Container()
    this.app.stage.addChild(this.labels)
    this.botLabels = new Map()
    for (const b of this.bots) {
      const t = new Text({
        text: b.name,
        style: {
          fontFamily: 'Russo One, sans-serif',
          fontSize: 11,
          fill: b.team === TEAM.ALLY ? 0x4da3ff : 0xff8d7d,
          stroke: { color: 0x000000, width: 3 },
          letterSpacing: 0.5,
        },
      })
      t.anchor.set(0.5, 1)
      t.visible = false
      this.labels.addChild(t)
      this.botLabels.set(b.id, t)
    }

    this._bindKeyboard()
    this.app.ticker.add((ticker) => this._update(ticker.deltaMS / 1000))
    this._emitState()
  }

  _bindKeyboard() {
    const setKey = (e, down) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.fwd = down; break
        case 'KeyS':
        case 'ArrowDown':
          this.keys.back = down; break
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = down; break
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = down; break
        case 'Space':
          if (down) this.fire()
          e.preventDefault(); break
        default:
          return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
        e.preventDefault()
    }
    this._onKeyDown = (e) => setKey(e, true)
    this._onKeyUp = (e) => setKey(e, false)
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
  }

  // вырезает chroma-key фон у спрайта танка; тип фона (зелёный/магента)
  // определяется по углу картинки — правило ловит и затенённый фон
  _chromaKey(tex) {
    const c = document.createElement('canvas')
    c.width = tex.width
    c.height = tex.height
    const ctx = c.getContext('2d')
    ctx.drawImage(tex.source.resource, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height)
    const p = d.data
    const i0 = (3 * c.width + 3) * 4
    const magenta = p[i0] > p[i0 + 1] * 1.3 && p[i0 + 2] > p[i0 + 1] * 1.1
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i]
      const g = p[i + 1]
      const b = p[i + 2]
      const isBg = magenta ? r > g * 1.5 && b > g * 1.2 : g > 80 && g > r * 1.25 && g > b * 1.25
      if (isBg) p[i + 3] = 0
    }
    ctx.putImageData(d, 0, 0)
    return Texture.from(c)
  }

  // взрыв-спрайт (аддитивный) в мировых координатах
  _spawnFx(x, y, scale = 1) {
    if (!this.tex || !this.tex.explosion || !this.fxLayer) return
    const s = new Sprite(this.tex.explosion)
    s.anchor.set(0.5)
    s.blendMode = 'add'
    s.position.set(x, y)
    const base = (130 * scale) / s.texture.height
    s.scale.set(base * 0.5)
    this.fxLayer.addChild(s)
    this.fxSprites.push({ s, age: 0, life: 0.55, base })
  }

  // --- управление ---

  setJoystick(x, y, active) {
    this.joystick.x = x
    this.joystick.y = y
    this.joystick.active = active
  }

  setMinimap(canvas) {
    this.minimap = canvas
    this.minimapCtx = canvas ? canvas.getContext('2d') : null
  }

  // все живые юниты (игрок + боты) — для захвата точек
  _allUnits() {
    const out = []
    if (this.hp > 0) out.push({ team: TEAM.ALLY, x: this.tank.x, y: this.tank.y, isPlayer: true })
    for (const b of this.bots) if (b.alive) out.push(b)
    return out
  }

  // прокси игрока как боевой единицы (для таргетинга ботов)
  _playerUnit() {
    return { isPlayer: true, team: TEAM.ALLY, x: this.tank.x, y: this.tank.y, hp: this.hp }
  }

  _enemiesOf(team) {
    const out = []
    if (team !== TEAM.ALLY && this.hp > 0) out.push(this._playerUnit())
    for (const b of this.bots) if (b.alive && b.team !== team) out.push(b)
    return out
  }

  fire() {
    if (this.matchOver || this.paused || this.hp <= 0) return
    if (this.crippled.gun > 0) {
      this.onShot({ type: 'blocked', reason: 'gun' })
      return
    }
    if (!this.ready) {
      this.onShot({ type: 'blocked' })
      return
    }
    this.ready = false
    this.reloadRemaining = this.cls.reload
    this.shots++

    const tx = this.tank.x
    const ty = this.tank.y
    const lineAngle = this.hullAngle + this._sweepOffset()
    const halfEff = this._sectorHalfEff()
    let best = null
    let anyInRange = false
    let anyInSector = false
    let anyLos = false

    for (const b of this.bots) {
      if (!b.alive || b.team === TEAM.ALLY) continue // бьём только врагов
      const ang = Math.atan2(b.y - ty, b.x - tx)
      const dist = Math.hypot(b.x - tx, b.y - ty)
      const inRange = dist <= this.cls.range
      const inSector = inRange && Math.abs(angleDiff(ang, this.hullAngle)) <= halfEff + 0.01
      const los = !this._lineBlocked(tx, ty, b.x, b.y)
      const err = Math.abs(angleDiff(ang, lineAngle))
      if (inRange) anyInRange = true
      if (inSector) anyInSector = true
      if (inSector && los) anyLos = true
      if (inSector && los && err <= this.cls.tolerance) {
        if (!best || err < best.err) best = { b, err }
      }
    }

    // вспышка у среза ствола
    this.muzzles.push({ x: tx + Math.cos(lineAngle) * 40, y: ty + Math.sin(lineAngle) * 40, a: lineAngle, age: 0, color: 0xffd866 })

    let killed = false
    let pen = null
    if (best) {
      this.hits++ // попадание есть, даже если броня не пробита
      pen = this._penetration(lineAngle, best.b.classId, best.b.hull, this.ammoMult > 1)
      const dmg = Math.round(this.cls.damage * this.ammoMult * pen.mult)
      if (dmg > 0) {
        this.damageDealt += Math.min(dmg, best.b.hp)
        best.b.hp -= dmg
        best.b.flash = 0.25
        if (best.b.hp <= 0) {
          this.kills++
          this.score.ally++
          this._killBot(best.b)
          this.onKill(best.b.name)
          killed = true
        }
      }
    }

    // визуальный снаряд: летит к цели, в препятствие (стене достаётся) или
    // в конец линии при чистом промахе
    let ex
    let ey
    if (best) {
      ex = best.b.x
      ey = best.b.y
    } else {
      const stop = this._shellStop(tx, ty, lineAngle, this.cls.range)
      if (stop) {
        ex = stop.x
        ey = stop.y
        this._damageWall(stop.wall)
      } else {
        ex = tx + Math.cos(lineAngle) * this.cls.range
        ey = ty + Math.sin(lineAngle) * this.cls.range
      }
    }
    const boomKind = best ? (killed ? 'big' : pen && !pen.pen ? 'dust' : 'hit') : 'dust'
    this._spawnShell(tx, ty, ex, ey, 0xffd866, boomKind)

    let reason = 'far'
    if (anyLos) reason = 'line'
    else if (anyInSector) reason = 'los'
    else if (anyInRange) reason = 'sector'

    this.onShot({
      type: best ? (pen.pen ? 'hit' : pen.kind) : 'miss',
      inRange: anyInRange,
      inSector: anyInSector,
      los: anyLos,
      reason,
    })
    this._emitState()
  }

  // --- геометрия препятствий ---

  // блокировка ВЫСТРЕЛА: рельеф + стены
  _lineBlocked(x1, y1, x2, y2) {
    for (const o of this.obstacles) {
      if (o.kind === 'water') continue // поверх воды видно и стреляется
      if (segHitsCircle(x1, y1, x2, y2, o.x, o.y, o.r)) return true
    }
    for (const w of this.walls) {
      if (segHitsRect(x1, y1, x2, y2, w.cx - w.hw, w.cy - w.hh, w.cx + w.hw, w.cy + w.hh)) return true
    }
    return false
  }

  // блокировка ЗАСВЕТА: только рельеф (куст/камень/холм) — за стеной
  // не спрячешься, силуэт виден, но выстрел она держит
  _visionBlocked(x1, y1, x2, y2) {
    for (const o of this.obstacles) {
      if (o.kind === 'water') continue
      if (segHitsCircle(x1, y1, x2, y2, o.x, o.y, o.r)) return true
    }
    return false
  }

  // точка, где снаряд упрётся в препятствие (для визуала и урона стенам)
  _shellStop(x1, y1, angle, range) {
    const step = 24
    for (let d = step; d <= range; d += step) {
      const x = x1 + Math.cos(angle) * d
      const y = y1 + Math.sin(angle) * d
      if (this._lineBlocked(x1, y1, x, y)) return { x, y, wall: this._wallAt(x, y, step) }
    }
    return null
  }

  _wallAt(x, y, pad = 10) {
    for (const w of this.walls) {
      if (x >= w.cx - w.hw - pad && x <= w.cx + w.hw + pad && y >= w.cy - w.hh - pad && y <= w.cy + w.hh + pad)
        return w
    }
    return null
  }

  // попадание по стене: разрушаемая теряет hp и в конце осыпается
  _damageWall(w) {
    if (!w || !w.destructible) return
    w.hp--
    if (w.hp <= 0) {
      this.walls = this.walls.filter((x) => x !== w)
      this.booms.push({ x: w.cx, y: w.cy, age: 0, big: true })
      this._spawnFx(w.cx, w.cy, 1.5)
      if (this.terrLayer) this.terrLayer.removeChildren()
      this._drawTerrain()
    }
  }

  _resolveCollisions(pos, radius) {
    for (const o of this.obstacles) {
      if (o.kind === 'bush') continue // лес проходим; block/hill/water — нет
      const dx = pos.x - o.x
      const dy = pos.y - o.y
      const d = Math.hypot(dx, dy)
      const min = o.r + radius
      if (d < min && d > 0.0001) {
        pos.x = o.x + (dx / d) * min
        pos.y = o.y + (dy / d) * min
      }
    }
    for (const w of this.walls) {
      const minx = w.cx - w.hw
      const maxx = w.cx + w.hw
      const miny = w.cy - w.hh
      const maxy = w.cy + w.hh
      const nx = Math.max(minx, Math.min(pos.x, maxx))
      const ny = Math.max(miny, Math.min(pos.y, maxy))
      const dx = pos.x - nx
      const dy = pos.y - ny
      const d = Math.hypot(dx, dy)
      if (d > 0.0001 && d < radius) {
        pos.x = nx + (dx / d) * radius
        pos.y = ny + (dy / d) * radius
      } else if (d <= 0.0001) {
        // центр внутри стены — выталкиваем по ближайшей грани
        const left = pos.x - minx
        const right = maxx - pos.x
        const top = pos.y - miny
        const bottom = maxy - pos.y
        const m = Math.min(left, right, top, bottom)
        if (m === left) pos.x = minx - radius
        else if (m === right) pos.x = maxx + radius
        else if (m === top) pos.y = miny - radius
        else pos.y = maxy + radius
      }
    }
    const m = 60
    pos.x = Math.max(m, Math.min(MAP_SIZE - m, pos.x))
    pos.y = Math.max(m, Math.min(MAP_SIZE - m, pos.y))
  }

  // одна жизнь: убитый танк остаётся обломками до конца боя
  _killBot(b) {
    b.alive = false
    b.hp = 0
    this.booms.push({ x: b.x, y: b.y, age: 0, big: true })
    this._spawnFx(b.x, b.y, 1.7)
  }

  // снаряд: визуально летит из (x1,y1) в (x2,y2), по прибытии — эффект boom
  _spawnShell(x1, y1, x2, y2, color, boom) {
    const dist = Math.hypot(x2 - x1, y2 - y1)
    this.shells.push({ x1, y1, x2, y2, t: 0, dur: Math.max(0.08, dist / 1400), color, boom })
  }

  // Бронепробитие: шанс рикошета/непробития зависит от класса цели и угла
  // встречи (лоб держит, корма — нет). gold — голдовый снаряд прошивает.
  // Возвращает { pen, kind?, mult }: рикошет — 0 урона, непробитие — 20%.
  _penetration(shotAngle, targetClassId, targetHull, gold) {
    const armorBase = { light: 0.1, medium: 0.2, heavy: 0.3 }[targetClassId] ?? 0.15
    const rel = Math.abs(angleDiff(shotAngle, targetHull))
    const facing = (1 - Math.cos(rel)) / 2 // 1 — снаряд в лоб, 0 — в корму
    let chance = Math.min(0.35, armorBase * facing * 1.2)
    if (gold) chance *= 0.4
    if (Math.random() >= chance) return { pen: true, mult: 1 }
    return Math.random() < 0.5
      ? { pen: false, kind: 'ricochet', mult: 0 }
      : { pen: false, kind: 'nopen', mult: 0.2 }
  }

  // выводит случайный исправный модуль из строя на CRIT_TIME секунд
  _critPlayer() {
    const free = CRIT_SLOTS.filter((s) => this.crippled[s] <= 0)
    if (!free.length) return
    const slot = free[Math.floor(Math.random() * free.length)]
    this.crippled[slot] = CRIT_TIME // огонь блокируется в fire() пока gun повреждён
    this.onCrit(slot)
  }

  // --- цикл ---

  // разброс: на месте сектор сжимается до 55%, на полном ходу — полный
  _sectorHalfEff() {
    const k = Math.min(1, Math.abs(this.speed) / this.cls.maxSpeed)
    return this.cls.sectorHalf * (0.55 + 0.45 * k)
  }

  _sweepOffset() {
    // при крите башни линия замирает (this.sweep не обновляется в _update)
    if (this.crippled.turret > 0) return this.sweep
    const p = (this.t % this.cls.sweepPeriod) / this.cls.sweepPeriod
    const tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p
    this.sweep = this._sectorHalfEff() * tri
    return this.sweep
  }

  _vision() {
    return this.cls.vision * (this.crippled.radio > 0 ? RADIO_CRIT_MULT : 1)
  }

  setPaused(v) {
    this.paused = v
  }

  _checkMatchEnd() {
    if (this.matchOver) return
    // уничтожение команды решает бой сразу (одна жизнь)
    const alliesAlive = (this.hp > 0 ? 1 : 0) + this.bots.filter((b) => b.team === TEAM.ALLY && b.alive).length
    const enemiesAlive = this.bots.filter((b) => b.team === TEAM.ENEMY && b.alive).length
    if (alliesAlive === 0 || enemiesAlive === 0) {
      this.matchOver = true
      this.result =
        enemiesAlive === 0 && alliesAlive > 0
          ? 'victory'
          : alliesAlive === 0 && enemiesAlive > 0
            ? 'defeat'
            : 'draw'
      return
    }
    const limitHit = this.score.ally >= SCORE_LIMIT || this.score.enemy >= SCORE_LIMIT
    if (!limitHit && this.matchTime > 0) return
    this.matchOver = true
    this.result =
      this.score.ally > this.score.enemy
        ? 'victory'
        : this.score.ally < this.score.enemy
          ? 'defeat'
          : 'draw'
  }

  _update(dt) {
    dt = Math.min(dt, 0.05)
    // на паузе (стартовый отсчёт) или после конца матча — только рисуем
    if (this.paused || this.matchOver) {
      this._draw()
      return
    }
    this.t += dt
    this.matchTime = Math.max(0, this.matchTime - dt)

    for (const s of CRIT_SLOTS) {
      if (this.crippled[s] > 0) this.crippled[s] = Math.max(0, this.crippled[s] - dt)
    }

    this._moveTank(dt)
    for (const b of this.bots) this._updateBot(b, dt)
    this._updateCaptures(dt)
    this._updateBases(dt)

    // засвет врагов: видит игрок или любой живой союзник
    for (const b of this.bots) {
      if (b.team !== TEAM.ENEMY) continue
      b.spotted = b.alive && this._spottedByTeam(b)
    }

    if (!this.ready) {
      this.reloadRemaining -= dt
      if (this.reloadRemaining <= 0) {
        this.reloadRemaining = 0
        this.ready = true
        this._emitState()
      }
    }

    // снаряды: по прибытии — взрыв/фонтан земли
    for (const s of this.shells) {
      s.t += dt
      if (s.t >= s.dur) {
        this.booms.push({ x: s.x2, y: s.y2, age: 0, big: s.boom === 'big', dust: s.boom === 'dust' })
        if (s.boom === 'hit') this._spawnFx(s.x2, s.y2, 0.7)
      }
    }
    this.shells = this.shells.filter((s) => s.t < s.dur)
    for (const bm of this.booms) bm.age += dt
    this.booms = this.booms.filter((bm) => bm.age <= (bm.big ? 0.7 : 0.45))
    // спрайтовые вспышки взрывов (аддитивные)
    if (this.fxSprites && this.fxSprites.length) {
      for (const f of this.fxSprites) {
        f.age += dt
        const k = Math.min(1, f.age / f.life)
        f.s.scale.set(f.base * (0.5 + k * 1.2))
        f.s.alpha = 1 - k
      }
      this.fxSprites = this.fxSprites.filter((f) => {
        if (f.age >= f.life) {
          f.s.destroy()
          return false
        }
        return true
      })
    }
    for (const m of this.muzzles) m.age += dt
    this.muzzles = this.muzzles.filter((m) => m.age <= 0.09)
    for (const b of this.bots) if (b.flash > 0) b.flash = Math.max(0, b.flash - dt)
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt)

    this._checkMatchEnd()
    this._draw()
    this.onState(this._snapshot())
  }

  _updateCaptures(dt) {
    const units = this._allUnits()
    for (const cap of this.caps) {
      let ally = 0
      let enemy = 0
      for (const u of units) {
        if (Math.hypot(u.x - cap.x, u.y - cap.y) <= cap.r) {
          if (u.team === TEAM.ALLY) ally++
          else enemy++
        }
      }
      // захватывает только команда, что одна на точке
      let capTeam = null
      if (ally > 0 && enemy === 0) capTeam = TEAM.ALLY
      else if (enemy > 0 && ally === 0) capTeam = TEAM.ENEMY

      if (capTeam !== null && cap.owner !== capTeam) {
        if (cap.capper === capTeam) {
          cap.progress += dt / CAP_TIME
          if (cap.progress >= 1) {
            cap.progress = 1
            cap.owner = capTeam
          }
        } else {
          // перебиваем чужой прогресс, потом копим свой
          cap.progress -= dt / CAP_TIME
          if (cap.progress <= 0) {
            cap.progress = 0
            cap.capper = capTeam
          }
        }
      }
    }

    // доминирование: очко каждые CAP_TICK сек получает команда,
    // удерживающая БОЛЬШЕ точек (равенство — никому). Так фраги (+1 сразу)
    // весят наравне с захватом и матч не сгорает за минуту.
    this.capTimer += dt
    if (this.capTimer >= CAP_TICK) {
      this.capTimer -= CAP_TICK
      const ally = this.caps.filter((c) => c.owner === TEAM.ALLY).length
      const enemy = this.caps.filter((c) => c.owner === TEAM.ENEMY).length
      if (ally > enemy) this.score.ally++
      else if (enemy > ally) this.score.enemy++
    }
  }

  // захват БАЗЫ: враги в круге без защитников тикают прогресс 0..100;
  // 100 — мгновенная победа захватчиков. Пусто — прогресс спадает.
  _updateBases(dt) {
    const units = this._allUnits()
    for (const base of this.bases) {
      let attackers = 0
      let defenders = 0
      for (const u of units) {
        if (Math.hypot(u.x - base.x, u.y - base.y) > base.r) continue
        if (u.team === base.team) defenders++
        else attackers++
      }
      if (attackers > 0 && defenders === 0) {
        base.progress = Math.min(100, base.progress + dt * 6 * Math.min(2, attackers))
        if (base.progress >= 100 && !this.matchOver) {
          this.matchOver = true
          this.result = base.team === TEAM.ENEMY ? 'victory' : 'defeat'
        }
      } else {
        base.progress = Math.max(0, base.progress - dt * 12)
      }
    }
  }

  _spottedByTeam(enemy) {
    // игрок: вплотную (PROX_SPOT) видно сквозь любой куст/стену
    if (this.hp > 0) {
      const d = Math.hypot(enemy.x - this.tank.x, enemy.y - this.tank.y)
      if (d <= PROX_SPOT) return true
      if (d <= this._vision() && !this._visionBlocked(this.tank.x, this.tank.y, enemy.x, enemy.y)) return true
    }
    // союзные боты
    for (const a of this.bots) {
      if (!a.alive || a.team !== TEAM.ALLY) continue
      const d = Math.hypot(enemy.x - a.x, enemy.y - a.y)
      if (d <= PROX_SPOT) return true
      if (d <= ALLY_VISION && !this._visionBlocked(a.x, a.y, enemy.x, enemy.y)) return true
    }
    return false
  }

  _moveTank(dt) {
    if (this.hp <= 0) return // уничтожен — наблюдает
    const j = this.joystick
    let steer = 0
    let throttle = 0 // -1..1, минус — задний ход
    if (j.active) {
      steer = Math.abs(j.x) < 0.12 ? 0 : j.x
      const fwd = -j.y
      throttle = Math.abs(fwd) < 0.12 ? 0 : Math.max(-1, Math.min(1, fwd))
    } else {
      const k = this.keys
      steer = (k.right ? 1 : 0) - (k.left ? 1 : 0)
      throttle = (k.fwd ? 1 : 0) - (k.back ? 1 : 0)
    }

    if (this.crippled.tracks > 0) steer *= 0.35 // сбита гусеница — еле ворочается
    if (this.crippled.engine > 0) throttle *= 0.35 // двигатель чадит — ползём

    // на полном ходу руль тяжелеет — дуга поворота широкая, как у танка
    const turnEff = this.cls.turnRate * (1 - 0.35 * Math.min(1, Math.abs(this.speed) / this.cls.maxSpeed))
    this.hullAngle += steer * turnEff * dt

    // задний ход вдвое медленнее переднего
    const speedTarget = this.cls.maxSpeed * (throttle >= 0 ? throttle : throttle * 0.5)
    const da = this.cls.accel * dt
    if (this.speed < speedTarget) this.speed = Math.min(speedTarget, this.speed + da)
    else this.speed = Math.max(speedTarget, this.speed - da * 1.4)

    this.tank.x += Math.cos(this.hullAngle) * this.speed * dt
    this.tank.y += Math.sin(this.hullAngle) * this.speed * dt
    this._resolveCollisions(this.tank, this.tankRadius)
  }

  // --- ИИ бота (общий для обеих команд) ---

  _updateBot(b, dt) {
    const ai = ENEMY_AI
    if (!b.alive) return // одна жизнь — обломки лежат до конца боя

    // ближайший живой враг своей команды
    const foes = this._enemiesOf(b.team)
    let target = null
    let bestD = Infinity
    for (const f of foes) {
      const d = Math.hypot(f.x - b.x, f.y - b.y)
      // боты не всевидящие: цель только в пределах обзора ИИ
      if (d <= ai.vision && d < bestD && !this._lineBlocked(b.x, b.y, f.x, f.y)) {
        bestD = d
        target = f
      }
    }

    if (b.fireCd > 0) b.fireCd -= dt
    const px = b.x
    const py = b.y
    let wantMove = true

    if (target) {
      const ang = Math.atan2(target.y - b.y, target.x - b.x)
      // при объезде временно целимся в сторону; лёгкое вилянье курсом вместо
      // прежнего «краба» (боком танки не ездят)
      let steerA = b.avoidT > 0 ? ang + b.avoidDir * 1.5 : ang + Math.sin(this.t * 0.9 + b.id) * 0.18
      const diff = angleDiff(steerA, b.hull)
      // на ходу руль тяжелеет — как у игрока
      const turnEff = b.turnRate * (1 - 0.35 * Math.min(1, Math.abs(b.vel) / b.speed))
      const maxTurn = turnEff * dt
      b.hull += Math.max(-maxTurn, Math.min(maxTurn, diff))

      let move = 0
      if (bestD > ai.idealRange * 1.15) move = 1
      else if (bestD < ai.idealRange * 0.5) move = -0.5 // пятится только в упор
      wantMove = move !== 0

      this._botDrive(b, move, dt)

      const fireDiff = angleDiff(ang, b.hull)
      const inArc = Math.abs(fireDiff) <= (ai.sectorHalfDeg * Math.PI) / 180
      if (inArc && b.fireCd <= 0) {
        b.fireCd = b.reload
        const col = b.team === TEAM.ALLY ? 0x9fd0ff : 0xff7043
        this.muzzles.push({ x: b.x + Math.cos(b.hull) * 34, y: b.y + Math.sin(b.hull) * 34, a: b.hull, age: 0, color: col })
        const hit = Math.random() < ai.hitChance
        let pierced = false
        if (hit) {
          // броня цели может срикошетить и ботский снаряд
          const tCls = target.isPlayer ? this.cls.id : target.classId
          const tHull = target.isPlayer ? this.hullAngle : target.hull
          const shotA = Math.atan2(target.y - b.y, target.x - b.x)
          const pen = this._penetration(shotA, tCls, tHull, false)
          pierced = pen.pen
          const dmg = Math.round(b.damage * pen.mult)
          if (dmg > 0) this._damageUnit(target, dmg, b.team)
          if (target.isPlayer && !pen.pen) this.onSaved(pen.kind)
        }
        this._spawnShell(b.x, b.y, target.x, target.y, col, hit && pierced ? 'hit' : 'dust')
      }
    } else {
      // никого не видит — играет от целей: едет к ближайшей не своей точке
      let goal = null
      let gBest = Infinity
      for (const cap of this.caps) {
        if (cap.owner === b.team) continue
        const d = Math.hypot(cap.x - b.x, cap.y - b.y)
        if (d < gBest) {
          gBest = d
          goal = cap
        }
      }
      const c = MAP_SIZE / 2
      let a = Math.atan2((goal ? goal.y : c) - b.y, (goal ? goal.x : c) - b.x)
      if (b.avoidT > 0) a += b.avoidDir * 1.5
      const diff = angleDiff(a, b.hull)
      const turnEff = b.turnRate * (1 - 0.35 * Math.min(1, Math.abs(b.vel) / b.speed))
      b.hull += Math.max(-turnEff * dt, Math.min(turnEff * dt, diff))
      this._botDrive(b, 0.6, dt)
    }

    this._resolveCollisions(b, ai.radius)

    // антизастревание: хотел ехать, но упёрся — объезд по дуге случайной стороной
    if (b.avoidT > 0) b.avoidT -= dt
    const moved = Math.hypot(b.x - px, b.y - py)
    if (wantMove && moved < Math.abs(b.vel) * dt * 0.25) b.stuckT = (b.stuckT || 0) + dt
    else b.stuckT = 0
    if (b.stuckT > 0.5) {
      b.stuckT = 0
      b.avoidT = 0.9
      b.avoidDir = Math.random() < 0.5 ? -1 : 1
    }
  }

  // ход бота с инерцией: скорость стремится к move×speed, движение — только
  // вдоль корпуса (никакого «краба»)
  _botDrive(b, move, dt) {
    const target = b.speed * move
    const da = b.accel * dt
    if (b.vel < target) b.vel = Math.min(target, b.vel + da)
    else b.vel = Math.max(target, b.vel - da * 1.4)
    b.x += Math.cos(b.hull) * b.vel * dt
    b.y += Math.sin(b.hull) * b.vel * dt
  }

  _damageUnit(unit, dmg, byTeam) {
    if (unit.isPlayer) {
      this.hp -= dmg
      this.hurtFlash = 0.25
      if (this.hp > 0 && Math.random() < CRIT_CHANCE) this._critPlayer()
      if (this.hp <= 0) {
        // одна жизнь: игрок выбывает до конца боя (наблюдение)
        this.hp = 0
        this.deaths++
        this.score.enemy++
        this.speed = 0
        this.booms.push({ x: this.tank.x, y: this.tank.y, age: 0, big: true })
        this._spawnFx(this.tank.x, this.tank.y, 1.9)
        this._emitState()
      }
    } else {
      unit.hp -= dmg
      unit.flash = 0.25
      if (unit.hp <= 0) {
        if (byTeam === TEAM.ALLY) this.score.ally++
        else this.score.enemy++
        this._killBot(unit)
      }
    }
  }

  _emitState() {
    this.onState(this._snapshot())
  }

  _snapshot() {
    const reload01 = this.ready ? 1 : 1 - this.reloadRemaining / this.cls.reload
    return {
      kills: this.kills,
      deaths: this.deaths,
      shots: this.shots,
      hits: this.hits,
      accuracy: this.shots ? Math.round((this.hits / this.shots) * 100) : 0,
      playerHp: Math.max(0, Math.round(this.hp)),
      playerMaxHp: this.maxHp,
      allyScore: this.score.ally,
      enemyScore: this.score.enemy,
      alliesAlive: (this.hp > 0 ? 1 : 0) + this.bots.filter((b) => b.team === TEAM.ALLY && b.alive).length,
      enemiesAlive: this.bots.filter((b) => b.team === TEAM.ENEMY && b.alive).length,
      reload01,
      ready: this.ready,
      reloadLeft: this.ready ? 0 : Math.ceil(this.reloadRemaining * 10) / 10,
      // прогресс захвата баз: ourBase — нашу захватывают, enemyBase — мы их
      ourBase: Math.round((this.bases.find((b) => b.team === TEAM.ALLY) || {}).progress || 0),
      enemyBase: Math.round((this.bases.find((b) => b.team === TEAM.ENEMY) || {}).progress || 0),
      classId: this.cls.id,
      damageDealt: Math.round(this.damageDealt),
      matchTime: Math.ceil(this.matchTime),
      matchOver: this.matchOver,
      result: this.result,
      scoreLimit: SCORE_LIMIT,
      crippled: {
        gun: Math.ceil(this.crippled.gun),
        turret: Math.ceil(this.crippled.turret),
        engine: Math.ceil(this.crippled.engine),
        tracks: Math.ceil(this.crippled.tracks),
        radio: Math.ceil(this.crippled.radio),
      },
    }
  }

  // --- отрисовка ---

  _draw() {
    const w = this.app.screen.width
    const h = this.app.screen.height

    if (!this._gridDrawn) {
      this._drawMap()
      this._drawTerrain()
      this._gridDrawn = true
    }

    const camX = w / 2
    const camY = h * 0.66
    this.world.pivot.set(this.tank.x, this.tank.y)
    this.world.position.set(camX, camY)
    this.world.rotation = -Math.PI / 2 - this.hullAngle

    const g = this.gfx
    g.clear()

    const tx = this.tank.x
    const ty = this.tank.y
    const hull = this.hullAngle
    const half = this._sectorHalfEff() // разброс: стоя — уже, на ходу — шире
    const L = this.cls.range

    // точки захвата (под всем)
    for (const cap of this.caps) {
      const own = cap.owner === 0 ? 0x5b9cff : cap.owner === 1 ? 0xff6a6a : 0x7b8694
      g.circle(cap.x, cap.y, cap.r).fill({ color: own, alpha: 0.1 })
      g.circle(cap.x, cap.y, cap.r).stroke({ width: 3, color: own, alpha: 0.55 })
      if (cap.progress > 0 && cap.progress < 1) {
        const pc = cap.capper === 0 ? 0x5b9cff : 0xff6a6a
        g.moveTo(cap.x, cap.y)
        g.arc(cap.x, cap.y, cap.r * 0.72, -Math.PI / 2, -Math.PI / 2 + cap.progress * Math.PI * 2)
        g.lineTo(cap.x, cap.y)
        g.fill({ color: pc, alpha: 0.25 })
      }
    }

    // прицельные визуалы только у живого танка — обломки не целятся
    if (this.hp > 0) {
      g.moveTo(tx, ty)
      g.arc(tx, ty, L, hull - half, hull + half)
      g.lineTo(tx, ty)
      g.fill({ color: 0xf2a50c, alpha: 0.07 })
      for (const a of [hull - half, hull + half]) {
        g.moveTo(tx, ty)
          .lineTo(tx + Math.cos(a) * L, ty + Math.sin(a) * L)
          .stroke({ width: 2, color: 0xf2a50c, alpha: 0.35 })
      }

      const lineA = hull + this._sweepOffset()
      g.moveTo(tx, ty)
        .lineTo(tx + Math.cos(lineA) * L, ty + Math.sin(lineA) * L)
        .stroke({ width: 4, color: 0xffd866, alpha: 0.95, cap: 'round' })
    }

    // спрайтовый режим: каждый кадр прячем все и включаем только видимых
    const useSpr = !!this.unitSprites
    if (useSpr) for (const sp of this.unitSprites.values()) sp.visible = false
    const placeSpr = (key, x, y, a, tint) => {
      const s = this.unitSprites.get(key)
      if (!s) return false
      s.visible = true
      s.position.set(x, y)
      s.rotation = a - Math.PI / 2 // в текстуре ствол смотрит вниз
      s.tint = tint
      return true
    }

    // обломки уничтоженных (видны всем — ориентиры боя)
    for (const b of this.bots) {
      if (b.alive) continue
      g.circle(b.x, b.y, 30).fill({ color: 0x000000, alpha: 0.35 }) // гарь
      if (!useSpr || !placeSpr(b.id, b.x, b.y, b.hull, 0x3c3c34))
        this._drawTank(g, b.x, b.y, b.hull, { body: 0x2c2f27, dark: 0x16180f }, 0.85)
    }

    // боты: союзники видны всегда, враги — только при засвете; все — танки
    for (const b of this.bots) {
      if (!b.alive) continue
      const isAlly = b.team === TEAM.ALLY
      if (!isAlly && !b.spotted) continue
      // реальные машины подкрашиваем командным оттенком, классовые уже цветные
      const aliveTint = b.realSprite ? (isAlly ? 0x9ab8ff : 0xffa090) : 0xffffff
      if (useSpr && placeSpr(b.id, b.x, b.y, b.hull, aliveTint)) {
        if (b.flash > 0) g.circle(b.x, b.y, 30).fill({ color: 0xffffff, alpha: 0.45 })
      } else {
        const c = isAlly ? { body: 0x4a82c8, dark: 0x1b3a5c } : { body: 0xd8543f, dark: 0x6e1f12 }
        if (b.flash > 0) c.body = 0xffffff
        this._drawTank(g, b.x, b.y, b.hull, c, 0.85)
      }
      // ХП: союзники синие, враги красные — заметные полоски с подложкой
      const bw = 48
      const hpCol = isAlly ? 0x5b9cff : 0xff5a4a
      g.rect(b.x - bw / 2 - 1, b.y - 37, bw + 2, 7).fill({ color: 0x000000, alpha: 0.65 })
      g.rect(b.x - bw / 2, b.y - 36, bw * (Math.max(0, b.hp) / b.maxHp), 5).fill(hpCol)
    }

    // игрок: живой — янтарный, уничтожен — обломки
    if (this.hp > 0) {
      if (useSpr && placeSpr('player', tx, ty, hull, 0xffffff)) {
        if (this.hurtFlash > 0) g.circle(tx, ty, 36).fill({ color: 0xff6a5a, alpha: 0.4 })
      } else {
        this._drawTank(
          g,
          tx,
          ty,
          hull,
          { body: this.hurtFlash > 0 ? 0xff8a8a : 0xf2a50c, dark: 0x3d3110, outline: 0xffd866 },
          1,
        )
      }
    } else {
      g.circle(tx, ty, 34).fill({ color: 0x000000, alpha: 0.35 })
      if (!useSpr || !placeSpr('player', tx, ty, hull, 0x3c3c34))
        this._drawTank(g, tx, ty, hull, { body: 0x3a3526, dark: 0x1b180e }, 1)
    }

    // летящие снаряды: болванка + короткий хвост
    for (const s of this.shells) {
      const k = s.t / s.dur
      const sx = s.x1 + (s.x2 - s.x1) * k
      const sy = s.y1 + (s.y2 - s.y1) * k
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      g.moveTo(sx - Math.cos(a) * 22, sy - Math.sin(a) * 22)
        .lineTo(sx, sy)
        .stroke({ width: 3, color: s.color, alpha: 0.45 })
      g.circle(sx, sy, 3.5).fill(s.color)
    }

    // вспышки у среза ствола
    for (const m of this.muzzles) {
      const k = 1 - m.age / 0.09
      g.circle(m.x, m.y, 9 * k).fill({ color: 0xffffff, alpha: 0.8 * k })
      g.moveTo(m.x, m.y)
        .lineTo(m.x + Math.cos(m.a) * 22 * k, m.y + Math.sin(m.a) * 22 * k)
        .stroke({ width: 5 * k, color: m.color, alpha: 0.9 * k })
    }

    // взрывы: big — гибель танка, dust — фонтан земли при промахе
    for (const bm of this.booms) {
      const life = bm.big ? 0.7 : 0.45
      const k = Math.min(1, bm.age / life)
      const fade = 1 - k
      if (bm.dust) {
        g.circle(bm.x, bm.y, 8 + k * 26).fill({ color: 0x8a7a55, alpha: 0.4 * fade })
        g.circle(bm.x, bm.y, 4 + k * 14).fill({ color: 0xb8a878, alpha: 0.5 * fade })
      } else {
        const r = bm.big ? 16 + k * 110 : 10 + k * 56
        g.circle(bm.x, bm.y, r).fill({ color: 0xff7a3c, alpha: 0.3 * fade })
        g.circle(bm.x, bm.y, r * 0.55).fill({ color: 0xffd866, alpha: 0.5 * fade })
        g.circle(bm.x, bm.y, r * 0.25).fill({ color: 0xffffff, alpha: 0.85 * fade })
        if (bm.big) g.circle(bm.x, bm.y, r * 1.15).stroke({ width: 3 * fade + 1, color: 0xff7a3c, alpha: 0.5 * fade })
      }
    }

    this._updateLabels()
    this._drawMinimap()
  }

  // имена над танками: союзники всегда, враги при засвете
  _updateLabels() {
    if (!this.botLabels) return
    for (const b of this.bots) {
      const t = this.botLabels.get(b.id)
      if (!t) continue
      const show = b.alive && (b.team === TEAM.ALLY || b.spotted)
      t.visible = show
      if (show) {
        const p = this.world.toGlobal({ x: b.x, y: b.y })
        t.position.set(p.x, p.y - 52) // выше ХП-полоски, не перекрывают друг друга
      }
    }
  }

  _drawMinimap() {
    const ctx = this.minimapCtx
    if (!ctx) return
    const S = this.minimap.width
    const k = S / MAP_SIZE
    ctx.clearRect(0, 0, S, S)
    ctx.fillStyle = '#0c0f14'
    ctx.fillRect(0, 0, S, S)

    // стены
    ctx.fillStyle = 'rgba(150,160,175,0.4)'
    for (const w of this.walls) ctx.fillRect((w.cx - w.hw) * k, (w.cy - w.hh) * k, w.hw * 2 * k, w.hh * 2 * k)
    // препятствия
    const OBST_COLORS = {
      bush: 'rgba(70,140,80,0.45)',
      water: 'rgba(46,110,142,0.55)',
      hill: 'rgba(105,115,65,0.5)',
      block: 'rgba(120,128,140,0.45)',
    }
    for (const o of this.obstacles) {
      ctx.fillStyle = OBST_COLORS[o.kind] || OBST_COLORS.block
      ctx.beginPath()
      ctx.arc(o.x * k, o.y * k, o.r * k, 0, Math.PI * 2)
      ctx.fill()
    }
    // базы
    for (const b of this.bases) {
      ctx.strokeStyle = b.team === 0 ? 'rgba(91,156,255,0.85)' : 'rgba(255,106,106,0.85)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(b.x * k, b.y * k, b.r * k, 0, Math.PI * 2)
      ctx.stroke()
    }
    // точки захвата с буквами
    ctx.font = `bold ${Math.round(S * 0.075)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const cap of this.caps) {
      const col = cap.owner === 0 ? '#5b9cff' : cap.owner === 1 ? '#ff6a6a' : '#9aa3b0'
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(cap.x * k, cap.y * k, Math.max(5, cap.r * k * 0.55), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0c0f14'
      ctx.fillText(cap.id, cap.x * k, cap.y * k)
    }
    // юниты-боты
    for (const b of this.bots) {
      if (!b.alive) continue
      if (b.team === TEAM.ENEMY && !b.spotted) continue
      ctx.fillStyle = b.team === TEAM.ALLY ? '#5b9cff' : '#ff5252'
      ctx.beginPath()
      ctx.arc(b.x * k, b.y * k, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    // игрок (треугольник по курсу)
    const px = this.tank.x * k
    const py = this.tank.y * k
    const a = this.hullAngle
    ctx.fillStyle = '#f2a50c'
    ctx.beginPath()
    ctx.moveTo(px + Math.cos(a) * 7, py + Math.sin(a) * 7)
    ctx.lineTo(px + Math.cos(a + 2.5) * 5, py + Math.sin(a + 2.5) * 5)
    ctx.lineTo(px + Math.cos(a - 2.5) * 5, py + Math.sin(a - 2.5) * 5)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1)
  }

  // танк top-down (гусеницы + корпус + ствол + башня), нос — вдоль угла a.
  // c: { body, dark, outline? }; s — масштаб (боты чуть меньше игрока).
  _drawTank(g, x, y, a, c, s = 1) {
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const P = (lx, ly) => [x + (lx * cos - ly * sin) * s, y + (lx * sin + ly * cos) * s]
    const rectPoly = (cx, cy, hl, hw) => [
      ...P(cx + hl, cy - hw),
      ...P(cx + hl, cy + hw),
      ...P(cx - hl, cy + hw),
      ...P(cx - hl, cy - hw),
    ]
    // гусеницы
    g.poly(rectPoly(0, -21, 32, 5)).fill(c.dark)
    g.poly(rectPoly(0, 21, 32, 5)).fill(c.dark)
    // корпус
    const hullPoly = rectPoly(0, 0, 30, 16)
    g.poly(hullPoly).fill(c.body)
    if (c.outline) g.poly(hullPoly).stroke({ width: 2.5, color: c.outline })
    else g.poly(hullPoly).stroke({ width: 2, color: 0x000000, alpha: 0.35 })
    // ствол, затем башня поверх
    const [mx, my] = P(38, 0)
    g.moveTo(x, y)
      .lineTo(mx, my)
      .stroke({ width: 6 * s + 1, color: c.dark, cap: 'round' })
    g.circle(x, y, 13 * s).fill(c.dark)
    g.circle(x, y, 5.5 * s).fill(c.body)
  }

  _drawMap() {
    const g = this.bg
    g.clear()
    if (!this.groundTile) g.rect(0, 0, MAP_SIZE, MAP_SIZE).fill(0x10141b)
    const step = 80
    for (let x = 0; x <= MAP_SIZE; x += step) g.moveTo(x, 0).lineTo(x, MAP_SIZE)
    for (let y = 0; y <= MAP_SIZE; y += step) g.moveTo(0, y).lineTo(MAP_SIZE, y)
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.05 })
    g.rect(0, 0, MAP_SIZE, MAP_SIZE).stroke({ width: 6, color: 0xffb000, alpha: 0.25 })
  }

  // круглый текстурный участок местности (лес/камень/вода/холм) с маской
  _terrainPatch(texName, x, y, r) {
    const tex = this.tex && this.tex[texName]
    if (!tex) return false
    const s = new Sprite(tex)
    s.anchor.set(0.5)
    s.position.set(x, y)
    s.width = s.height = r * 2.05
    const m = new Graphics().circle(x, y, r).fill(0xffffff)
    s.mask = m
    this.terrLayer.addChild(s, m)
    return true
  }

  _drawTerrain() {
    const g = this.terrain
    g.clear()
    const TKIND = { bush: 'forest', block: 'rock', water: 'water', hill: 'hill' }
    for (const o of this.obstacles) {
      const sprited = this._terrainPatch(TKIND[o.kind], o.x, o.y, o.r)
      if (o.kind === 'bush') {
        if (!sprited) g.circle(o.x, o.y, o.r).fill({ color: 0x2f6b3a, alpha: 0.85 })
        g.circle(o.x, o.y, o.r).stroke({ width: 2, color: 0x224f2c })
      } else if (o.kind === 'water') {
        if (!sprited) g.circle(o.x, o.y, o.r).fill({ color: 0x1d4a66, alpha: 0.9 })
        g.circle(o.x, o.y, o.r).stroke({ width: 3, color: 0x2e6e8e })
        if (!sprited) g.circle(o.x, o.y, o.r * 0.62).stroke({ width: 2, color: 0x2e6e8e, alpha: 0.4 })
      } else if (o.kind === 'hill') {
        if (!sprited) g.circle(o.x, o.y, o.r).fill(0x47502f)
        g.circle(o.x, o.y, o.r).stroke({ width: 3, color: 0x2f3520 })
        if (!sprited) g.circle(o.x, o.y, o.r * 0.55).stroke({ width: 2, color: 0x5a6540, alpha: 0.7 })
      } else {
        if (!sprited) g.circle(o.x, o.y, o.r).fill(0x4a4f57)
        g.circle(o.x, o.y, o.r).stroke({ width: 3, color: 0x2c3036 })
      }
    }
    // стены-укрытия: почти квадратные — крыши зданий, длинные — бетон
    for (const w of this.walls) {
      const aspect = w.hw / w.hh
      if (this.tex && this.tex.building && aspect > 0.4 && aspect < 2.5) {
        const s = new Sprite(this.tex.building)
        s.anchor.set(0.5)
        s.position.set(w.cx, w.cy)
        s.width = w.hw * 2
        s.height = w.hh * 2
        this.terrLayer.addChild(s)
      } else {
        g.rect(w.cx - w.hw, w.cy - w.hh, w.hw * 2, w.hh * 2).fill(0x5a6068)
      }
      g.rect(w.cx - w.hw, w.cy - w.hh, w.hw * 2, w.hh * 2).stroke({ width: 3, color: 0x33373d })
    }
    // базы команд
    for (const b of this.bases) {
      const col = b.team === 0 ? 0x5b9cff : 0xff6a6a
      g.circle(b.x, b.y, b.r).fill({ color: col, alpha: 0.08 })
      g.circle(b.x, b.y, b.r).stroke({ width: 4, color: col, alpha: 0.4 })
      g.circle(b.x, b.y, 14).fill(col)
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    this.app.destroy(true, { children: true })
  }
}
