import { Application, Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js'
import {
  TANK_CLASSES,
  DEFAULT_CLASS,
  MAP_SIZE,
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
import { MAPS, MAP_BY_ID } from './maps.js'

// Палитры команд: юг всегда воюет синим, север — красным; чья из них «наша» —
// решает жребий стороны (side). Игрок при этом остаётся янтарным.
const TEAM_PALETTE = {
  blue: { main: 0x4da3ff, hp: 0x5b9cff, muzzle: 0x9fd0ff, tint: 0x9ab8ff, body: 0x4a82c8, dark: 0x1b3a5c, sprite: 'blue', css: '#5b9cff' },
  red: { main: 0xff8d7d, hp: 0xff5a4a, muzzle: 0xff7043, tint: 0xffa090, body: 0xd8543f, dark: 0x6e1f12, sprite: 'red', css: '#ff6a6a' },
}

const WATER_DEEP = 0.6 // доля радиуса воды = смертельная глубина (центр), кромка — брод
const WATER_SLOW = 0.45 // множитель скорости в мелководье (брод)
const REVEAL_S = 4 // сек видимости после выстрела — «выстрел снимает маскировку» из куста

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

// маркер класса над танком: лёгкий ▲ / средний ◆ / тяжёлый ■
const CLS_MARK = { light: '▲', medium: '◆', heavy: '■' }

/**
 * 5v5: игрок + союзные боты против вражеских ботов на карте с препятствиями,
 * стенами-укрытиями и туманом войны. Механика наведения через линию сведения.
 */
export class Game {
  constructor(opts = {}) {
    this.app = new Application()
    this.t = 0
    this._baked = [] // текстуры, запечённые из canvas — убиваем в destroy()
    this._hudAcc = 0 // троттлинг снапшота HUD (Vue не перерисовываем 60 раз/с)

    // карта боя и жребий стороны: 0 — юг (синие), 1 — север (красные)
    this.map = MAP_BY_ID[opts.mapId] || MAPS[0]
    this.mapSize = this.map.size || MAP_SIZE // размер карты (большие — больше места)
    this.mapScale = this.mapSize / MAP_SIZE // растяжение координат фич/спавнов
    // режим боя: 'capture' — захват точек до лимита; 'annihilation' — до последнего танка
    this.mode = opts.mode === 'annihilation' ? 'annihilation' : 'capture'
    this.side = opts.side === 1 ? 1 : 0
    this.ySign = this.side === 0 ? 1 : -1 // множитель «вниз» для нашей половины
    this.colors = this.side === 0
      ? { ally: TEAM_PALETTE.blue, enemy: TEAM_PALETTE.red }
      : { ally: TEAM_PALETTE.red, enemy: TEAM_PALETTE.blue }

    this.tank = { x: this.mapSize / 2, y: this.mapSize / 2 + 700 * this.mapScale * this.ySign }
    this.hullAngle = (-Math.PI / 2) * this.ySign
    this.speed = 0
    this.joystick = { x: 0, y: 0, active: false }
    this.specCam = null // после гибели — свободная камера наблюдения по карте
    this.keys = { fwd: false, back: false, left: false, right: false }
    this.tankRadius = 22

    this.setClass(DEFAULT_CLASS)
    this.ready = true
    this.reloadRemaining = 0
    this.revealT = 0 // >0 — игрок недавно стрелял, маскировка кустом снята (видят боты)
    this.ammoMult = 1 // 1 = обычный снаряд, GOLD_AMMO_MULT = голдовый

    const c = this.mapSize / 2
    const sc = this.mapScale // координаты фич растягиваем под размер карты
    this.obstacles = this.map.obstacles.map((o) => ({ x: c + o.dx * sc, y: c + o.dy * sc, r: o.r, kind: o.kind }))
    this.walls = this.map.walls.map((w) => ({
      cx: c + w.dx * sc,
      cy: c + w.dy * sc,
      hw: w.w / 2,
      hh: w.h / 2,
      hp: w.hp || Infinity,
      destructible: !!w.hp,
    }))
    // базы: [юг, север] из карты; своя — на нашей стороне жребия
    this.bases = this.map.bases.map((b, i) => ({
      team: i === this.side ? TEAM.ALLY : TEAM.ENEMY,
      x: c + b.dx * sc,
      y: c + b.dy * sc,
      r: b.r,
      progress: 0,
    }))
    this.caps = this.map.caps.map((p) => ({
      id: p.id,
      x: c + p.dx * sc,
      y: c + p.dy * sc,
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
    this.lightKills = 0 // фраги лёгких — для задач дня
    this.blocked = 0 // снаряды, которые держала наша броня (рикошет/непробитие)
    this.deaths = 0
    this.shots = 0
    this.hits = 0
    this.damageDealt = 0
    this.damageLog = new Map() // по-целевой лог урона игрока (лист «По целям»)
    this.score = { ally: 0, enemy: 0 }
    this.bonusXp = 0 // доп. опыт за засвет/захват (плюсуется к награде боя)
    this.spotScored = new Set() // id врагов, за чей засвет уже дали опыт (без спама)

    // матч (Фаза 4). Аннигиляция — короче (дезматч не тянем 4 минуты)
    this.matchTime = this.mode === 'annihilation' ? 150 : MATCH_TIME
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
    // союзники на нашей половине (жребий стороны), враги напротив; разносим по горизонтали.
    // Спавны растягиваем под размер карты (большие карты — команды дальше друг от друга)
    const c = this.mapSize / 2
    const sc = this.mapScale
    const spread = ((i - (n - 1) / 2) / Math.max(1, n)) * 900 * sc
    const y = team === TEAM.ALLY ? c + 560 * sc * this.ySign : c - 560 * sc * this.ySign
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
      hull: (team === TEAM.ALLY ? -Math.PI / 2 : Math.PI / 2) * this.ySign,
      hp: cls.hp,
      maxHp: cls.hp,
      damage: Math.round(cls.damage * BOT_DMG_MULT),
      reload: cls.reload,
      vision: cls.vision, // обзор/дальность стрельбы = как у игрока на этом классе (не всевидящие)
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
    const texNames = ['ground', 'forest', 'rock', 'water', 'hill', 'building', 'explosion', 'smoke', 'muzzle', 'box', ...tankNames]
    const loadedTex = await Promise.allSettled(texNames.map((n) => Assets.load(`/sprites/${n}.png`)))
    texNames.forEach((n, i) => {
      if (loadedTex[i].status === 'fulfilled') this.tex[n] = loadedTex[i].value
    })
    for (const k of Object.keys(this.tex)) {
      if (k.startsWith('tank_')) this.tex[k] = this._chromaKey(this.tex[k])
    }
    // кусты/камни/горы — AI-спрайты с вырезанным фоном (прозрачная альфа),
    // рисуются обычным спрайтом без круглой маски и «блина»
    // реальные виды сверху: танк игрока + все машины ботов из пула
    const unitIds = new Set(this.bots.map((b) => b.tankId).filter(Boolean))
    if (this.playerTankId) unitIds.add(this.playerTankId)
    const idList = [...unitIds]
    const unitTex = await Promise.allSettled(idList.map((id) => Assets.load(`/sprites/tanks/${id}.png`)))
    idList.forEach((id, i) => {
      if (unitTex[i].status === 'fulfilled') this.tex[`unit_${id}`] = this._chromaKey(unitTex[i].value)
    })
    if (this.playerTankId && this.tex[`unit_${this.playerTankId}`]) {
      this.tex.player_tank = this.tex[`unit_${this.playerTankId}`]
      // per-tank камуфляж игрока: отдельный перекрашенный AI-спрайт (на той же
      // магенте) → кеим как player_tank; бот на той же машине остаётся заводским
      if (this.playerCamo) {
        try {
          const camTex = await Assets.load(`/sprites/camo/${this.playerTankId}_${this.playerCamo}.png`)
          this.tex.player_tank = this._chromaKey(camTex)
          this.playerCamoBaked = true // тинт поверх не накладываем
        } catch {
          /* камо-спрайт ещё не сгенерён — заводская окраска */
        }
      }
    }

    this.world = new Container()
    this.bg = new Graphics()
    this.terrain = new Graphics()
    this.gfx = new Graphics()
    this.markGfx = new Graphics() // командные «пятаки» свой/чужой ПОД танками
    this.terrLayer = new Container() // текстуры местности под векторными обводками
    this.tankLayer = new Container() // спрайты танков под HUD-графикой (hp-бары и т.п.)
    this.fxLayer = new Container() // аддитивные вспышки взрывов поверх всего
    if (this.tex.ground) {
      this.groundTile = new TilingSprite({ texture: this.tex.ground, width: this.mapSize, height: this.mapSize })
      this.groundTile.tileScale.set(0.55)
      if (this.map.tint) this.groundTile.tint = this.map.tint // характер местности карты
      this.world.addChild(this.groundTile)
    }
    this.world.addChild(this.bg, this.terrLayer, this.terrain, this.markGfx, this.tankLayer, this.gfx, this.fxLayer)
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
        const teamCol = b.team === TEAM.ALLY ? this.colors.ally : this.colors.enemy
        this.unitSprites.set(b.id, mk(real || tankTex(b.classId, teamCol.sprite), size))
        b.realSprite = !!real // реальным нужен командный оттенок tint'ом
      }
    }

    // туман войны: затемняет местность вне зоны обзора. Слой В МИРЕ между
    // террейном и танками — поэтому скрывает землю, но танки (свои и засвеченные
    // враги) рисуются поверх и видны. Виньетка радиально-симметрична, вращение
    // мира её не искажает.
    this.fog = new Sprite(Texture.EMPTY)
    this.fog.anchor.set(0.5)
    this._fogKey = ''
    this.world.addChildAt(this.fog, this.world.getChildIndex(this.tankLayer))

    // имена ботов — экранный слой поверх тумана (мир вращается, текст — нет)
    this.labels = new Container()
    this.app.stage.addChild(this.labels)
    this.botLabels = new Map()
    for (const b of this.bots) {
      const t = this._makeNamePlate(b.name, b.classId, b.team === TEAM.ALLY ? this.colors.ally : this.colors.enemy)
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
  _chromaCanvas(tex) {
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
    return c
  }

  _chromaKey(tex) {
    return this._bake(Texture.from(this._chromaCanvas(tex)))
  }

  // canvas-текстуры оседают в глобальном кэше Pixi и переживают app.destroy —
  // без учёта каждый бой утекают мегабайты
  _bake(tex) {
    this._baked.push(tex)
    return tex
  }

  // взрыв-спрайт (аддитивный) в мировых координатах; крупный взрыв (гибель) —
  // ещё и облако дыма (обычное смешивание, медленно тает и всплывает)
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
    if (scale > 1.4 && this.tex.smoke) {
      const sm = new Sprite(this.tex.smoke)
      sm.anchor.set(0.5)
      sm.position.set(x, y)
      const sbase = (110 * scale) / sm.texture.height
      sm.scale.set(sbase * 0.6)
      this.fxLayer.addChild(sm)
      this.fxSprites.push({ s: sm, age: 0, life: 1.5, base: sbase, smoke: true })
    }
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

  // прокси игрока как боевой единицы (для таргетинга ботов). revealT прокидываем —
  // выстрелив, игрок становится видим ботам даже из куста
  _playerUnit() {
    return { isPlayer: true, team: TEAM.ALLY, x: this.tank.x, y: this.tank.y, hp: this.hp, revealT: this.revealT }
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
    this.revealT = REVEAL_S // выстрел снимает маскировку: пару секунд тебя видно из куста

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
        // снаряд бьёт БЛИЖАЙШЕГО на линии (не «ровнее по углу» дальнего)
        if (!best || dist < best.dist) best = { b, err, dist }
      }
    }

    // вспышка у среза ствола
    this.muzzles.push({ x: tx + Math.cos(lineAngle) * 40, y: ty + Math.sin(lineAngle) * 40, a: lineAngle, age: 0, color: 0xffd866 })

    let killed = false
    let pen = null
    if (best) {
      this.hits++ // попадание есть, даже если броня не пробита
      this._alertBot(best.b, tx, ty) // получил по броне — реагирует, даже если стрелка не видит
      pen = this._penetration(lineAngle, best.b.classId, best.b.hull, this.ammoMult > 1)
      const dmg = Math.round(this.cls.damage * this.ammoMult * pen.mult)
      if (dmg > 0) {
        const actual = Math.min(dmg, best.b.hp)
        this.damageDealt += actual
        best.b.hp -= dmg
        best.b.flash = 0.25
        if (best.b.hp <= 0) {
          this.kills++
          if (best.b.classId === 'light') this.lightKills++
          this.score.ally++
          this._killBot(best.b)
          this.onKill(best.b.name)
          killed = true
        }
        // лог «По целям»
        const entry = this.damageLog.get(best.b.id) || { name: best.b.name, tankId: best.b.tankId, dmg: 0, killed: false }
        entry.dmg += actual
        entry.killed = entry.killed || killed
        this.damageLog.set(best.b.id, entry)
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

  // блокировка ВЫСТРЕЛА: рельеф + стены. Куст и вода — мягкие: снаряд проходит
  // (куст только скрывает силуэт, см. _visionBlocked; стену/камень/холм снаряд держит)
  _lineBlocked(x1, y1, x2, y2) {
    for (const o of this.obstacles) {
      if (o.kind === 'water' || o.kind === 'bush') continue
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
      // куст, в котором СТОИТ наблюдатель, не слепит его — видно наружу (WoT-«свет
      // из кустов»); куст у цели её по-прежнему скрывает (он далеко от x1,y1)
      if (o.kind === 'bush' && Math.hypot(o.x - x1, o.y - y1) <= o.r) continue
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
      if (this.terrLayer) for (const ch of this.terrLayer.removeChildren()) ch.destroy()
      this._drawTerrain()
    }
  }

  // танк-в-танк: после движения всех машин разводим перекрытия (игрок + боты),
  // чтобы не набивались в одну точку. Пара расталкивается симметрично.
  _separateUnits() {
    const minD = this.tankRadius * 2.0 // танки держат больше дистанции (плотнее коллизия)
    const all = []
    if (this.hp > 0) all.push(this.tank)
    for (const b of this.bots) if (b.alive) all.push(b)
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= minD) continue
        if (d < 0.001) {
          dx = 1
          dy = 0
          d = 1
        }
        const push = (minD - d) / 2
        a.x -= (dx / d) * push
        a.y -= (dy / d) * push
        b.x += (dx / d) * push
        b.y += (dy / d) * push
      }
    }
    for (const u of all) this._resolveCollisions(u, this.tankRadius)
  }

  // ТАРАН: игрок на разгоне врезается во врага — урон по скорости и «массе»
  // класса; сам таранщик получает треть. Не чаще раза в 0.5с на одну цель.
  _ramDamage() {
    if (this.hp <= 0) return
    const spd = Math.abs(this.speed)
    if (spd < this.cls.maxSpeed * 0.4) return // нужен разгон
    const reach = this.tankRadius * 2.1
    const massK = { light: 0.8, medium: 1.1, heavy: 1.5 }[this.cls.id] || 1
    for (const b of this.bots) {
      if (!b.alive || b.team === TEAM.ALLY) continue
      if (Math.hypot(b.x - this.tank.x, b.y - this.tank.y) > reach) continue
      if (b._ramAt && this.t - b._ramAt < 0.5) continue
      b._ramAt = this.t
      // урон тарана урезан ~на 62% (коэф. 16→6, фидбек Романа: таран был слишком злой)
      const dmg = Math.round((spd / this.cls.maxSpeed) * 6 * massK)
      if (dmg <= 0) continue
      this._damageUnit(b, dmg, TEAM.ALLY) // урон врагу
      this.booms.push({ x: (this.tank.x + b.x) / 2, y: (this.tank.y + b.y) / 2, age: 0, big: false })
      this.onShot && this.onShot({ type: 'ram' })
      if (this.hp > 0) this._damageUnit({ isPlayer: true }, Math.round(dmg * 0.35), TEAM.ENEMY) // отдача (через смерть-логику)
    }
  }

  _resolveCollisions(pos, radius) {
    for (const o of this.obstacles) {
      if (o.kind === 'bush' || o.kind === 'water') continue // лес и вода проходимы (вода — брод/глубина в _waterState); block/hill — нет
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
    pos.x = Math.max(m, Math.min(this.mapSize - m, pos.x))
    pos.y = Math.max(m, Math.min(this.mapSize - m, pos.y))
  }

  // состояние воды под танком: 'deep' — глубина (топит), 'shallow' — брод (тормозит),
  // null — суша. Боты НЕ топятся: их выталкиваем на кромку глубокой воды (не топим
  // стадо ботов), игрок же сам решает соваться ли в глубину.
  _waterState(u, isPlayer) {
    for (const o of this.obstacles) {
      if (o.kind !== 'water') continue
      const dx = u.x - o.x
      const dy = u.y - o.y
      const d = Math.hypot(dx, dy) || 0.0001
      if (d >= o.r) continue
      if (d < o.r * WATER_DEEP) {
        if (isPlayer) return 'deep'
        u.x = o.x + (dx / d) * o.r * WATER_DEEP // бот: выталкиваем на кромку глубины
        u.y = o.y + (dy / d) * o.r * WATER_DEEP
      }
      return 'shallow' // мелководье ИЛИ вытолкнутый на кромку бот — брод (замедление)
    }
    return null
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
    if (this.mode === 'annihilation') {
      // бой до последнего: лимита очков нет; вышло время — больше живых побеждает
      if (this.matchTime > 0) return
      this.matchOver = true
      this.result = alliesAlive > enemiesAlive ? 'victory' : alliesAlive < enemiesAlive ? 'defeat' : 'draw'
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
    this._separateUnits() // танк-в-танк: машины не набиваются в одну точку
    this._ramDamage() // таран: игрок на разгоне врезается во врага
    // захват точек только в режиме захвата. Захват БАЗЫ выключен в боях с ботами
    // (фидбек: имба — мгновенная победа/поражение зергом базы; «только с юзерами»).
    // Офлайн всегда против ботов, онлайн-sim захвата базы и так не имеет → _updateBases
    // оставлен для будущего человек-vs-человек PvP, но здесь не вызывается.
    if (this.mode === 'capture') this._updateCaptures(dt)

    // засвет врагов для ОТРИСОВКИ: КОМАНДНЫЙ туман войны — видно врага, если его
    // светит игрок ИЛИ любой живой союзник (как в Блице). Мёртв — видно всех.
    for (const b of this.bots) {
      if (b.team !== TEAM.ENEMY) continue
      const byMe = this.hp > 0 && this._spottedByPlayer(b)
      // бот выстрелил (revealT) и он в пределах твоего обзора — видно даже из куста
      const byFire = b.revealT > 0 && this.hp > 0 && Math.hypot(b.x - this.tank.x, b.y - this.tank.y) <= this._vision()
      b.spotted = b.alive && (this.hp <= 0 || byMe || byFire || this._spottedByAllies(b))
      // опыт за РАЗВЕДКУ: первый ЛИЧНЫЙ засвет каждого живого врага (без спама)
      if (byMe && b.alive && !this.spotScored.has(b.id)) {
        this.spotScored.add(b.id)
        this._awardXp(12, 'ЗАСВЕТ')
      }
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
        if (f.smoke) {
          f.s.scale.set(f.base * (0.6 + k * 1.5))
          f.s.alpha = 0.7 * (1 - k)
          f.s.y -= dt * 18 // дым всплывает
        } else {
          f.s.scale.set(f.base * (0.5 + k * 1.2))
          f.s.alpha = 1 - k
        }
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
    // HUD обновляем 20 раз/с — глаз не отличит, а Vue-перерендер втрое реже
    this._hudAcc += dt
    if (this._hudAcc >= 0.05 || this.matchOver) {
      this._hudAcc = 0
      this.onState(this._snapshot())
    }
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

    // War Thunder style: каждая удержанная точка тикает очко владельцу —
    // больше точек = быстрее счёт. Обе команды копят независимо.
    this.capTimer += dt
    if (this.capTimer >= CAP_TICK) {
      this.capTimer -= CAP_TICK
      for (const c of this.caps) {
        if (c.owner === TEAM.ALLY) {
          this.score.ally++
          // опыт за УДЕРЖАНИЕ: игрок жив и стоит на нашей точке в момент тика
          if (this.hp > 0 && Math.hypot(this.tank.x - c.x, this.tank.y - c.y) <= c.r) this._awardXp(15, 'ЗАХВАТ')
        } else if (c.owner === TEAM.ENEMY) this.score.enemy++
      }
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

  // личный обзор игрока: вплотную (PROX_SPOT) видно сквозь куст/стену,
  // иначе — в радиусе обзора и без преграды (куст/холм/камень)
  _spottedByPlayer(enemy) {
    if (this.hp <= 0) return false
    const d = Math.hypot(enemy.x - this.tank.x, enemy.y - this.tank.y)
    if (d <= PROX_SPOT) return true
    return d <= this._vision() && !this._visionBlocked(this.tank.x, this.tank.y, enemy.x, enemy.y)
  }

  // командный засвет: враг виден, если его светит ЛЮБОЙ живой союзник
  _spottedByAllies(enemy) {
    for (const a of this.bots) {
      if (a.team !== TEAM.ALLY || !a.alive) continue
      const d = Math.hypot(enemy.x - a.x, enemy.y - a.y)
      if (d <= PROX_SPOT) return true
      if (d <= ALLY_VISION && !this._visionBlocked(a.x, a.y, enemy.x, enemy.y)) return true
    }
    return false
  }

  // доп. опыт за действие (засвет/захват) + всплывающая подпись в HUD
  _awardXp(amount, label) {
    this.bonusXp += amount
    if (this.onReward) this.onReward({ text: label, xp: amount })
  }

  _moveTank(dt) {
    if (this.hp <= 0) {
      // уничтожен — джойстик свободно водит камеру наблюдения по карте
      if (!this.specCam) this.specCam = { x: this.tank.x, y: this.tank.y }
      const j = this.joystick
      if (j.active && !this.paused) {
        const sp = 700 // px/сек
        this.specCam.x = Math.max(0, Math.min(this.mapSize, this.specCam.x + j.x * sp * dt))
        this.specCam.y = Math.max(0, Math.min(this.mapSize, this.specCam.y + j.y * sp * dt))
      }
      return
    }
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

    if (this.revealT > 0) this.revealT -= dt // маскировка кустом восстанавливается после выстрела
    // вода: заехал в глубину — тонешь; брод — едешь медленно (уязвим)
    const water = this._waterState(this.tank, true)
    if (water === 'deep') this._drownPlayer()
    else if (water === 'shallow') {
      const cap = this.cls.maxSpeed * WATER_SLOW
      this.speed = Math.max(-cap, Math.min(cap, this.speed))
    }
  }

  // утонул в глубокой воде: выбываем как от смертельного урона (одна жизнь)
  _drownPlayer() {
    if (this.hp <= 0) return
    this.hp = 0
    this.deaths++
    this.score.enemy++
    this.speed = 0
    this.booms.push({ x: this.tank.x, y: this.tank.y, age: 0, big: true })
    this._spawnFx(this.tank.x, this.tank.y, 1.9)
    this._emitState() // onState покажет «ВЫ УНИЧТОЖЕНЫ» и тряску
  }

  // --- ИИ бота (общий для обеих команд) ---

  _updateBot(b, dt) {
    const ai = ENEMY_AI
    if (!b.alive) return // одна жизнь — обломки лежат до конца боя

    // ближайший живой враг своей команды
    const foes = this._enemiesOf(b.team)
    const vision = b.vision || ai.vision // обзор = как у игрока на классе
    const ideal = vision * 0.5 // держит дистанцию ВДВОЕ ближе обзора (близкий бой)
    // стреляет по ЛЮБОМУ засвеченному врагу (точность сама падает с дистанцией в
    // _botFire) — иначе бот игнорил «пикера» на средней дальности и казался тупым
    const fireRange = vision * 0.92
    let target = null
    let bestD = Infinity
    for (const f of foes) {
      const d = Math.hypot(f.x - b.x, f.y - b.y)
      if (d > vision || d >= bestD) continue // не дальше своего обзора, ближайшая цель
      if (this._lineBlocked(b.x, b.y, f.x, f.y)) continue // камень/холм/стена держат снаряд
      // куст СКРЫВАЕТ цель, пока она не выстрелила: revealT>0 — видно сквозь куст
      if (!(f.revealT > 0) && this._visionBlocked(b.x, b.y, f.x, f.y)) continue
      bestD = d
      target = f
    }

    if (b.fireCd > 0) b.fireCd -= dt
    const px = b.x
    const py = b.y
    let wantMove = true

    // Засёк врага → ВСЕГДА доворачиваем корпус на него и стреляем (бот защищается,
    // не подставляет корму — иначе кажется тупым). А вот ПРЕСЛЕДУЕМ (едем на
    // сближение) только врага вблизи: дальнего «пикера» из куста не гоним по всей
    // карте (анти-кайт, фидбек Романа) — стоим и отстреливаемся.
    const engageRange = vision * 0.7
    if (b.reverseT > 0) {
      // экстренный задний ход: зажало в препятствии — сдаём назад и доворачиваем в
      // сторону, чтобы оторваться от стены/камня и не залипнуть АФК
      b.hull += (b.avoidDir || 1) * b.turnRate * dt
      this._botDrive(b, -0.7, dt)
      if (target) this._botFire(b, target, bestD, fireRange) // отстреливается и на ходу назад
    } else if (target) {
      const ang = Math.atan2(target.y - b.y, target.x - b.x)
      const near = bestD <= engageRange
      // вблизи — лёгкое вилянье курсом (боком не ездят); издали — ровно на цель
      const steerA = near ? (b.avoidT > 0 ? ang + b.avoidDir * 1.5 : ang + Math.sin(this.t * 0.9 + b.id) * 0.18) : ang
      const diff = angleDiff(steerA, b.hull)
      const turnEff = b.turnRate * (1 - 0.35 * Math.min(1, Math.abs(b.vel) / b.speed))
      const maxTurn = turnEff * dt
      b.hull += Math.max(-maxTurn, Math.min(maxTurn, diff))

      let move = 0
      if (near) {
        if (b.hp < b.maxHp * 0.3) move = -1 // мало хп — отступаем, продолжая отстреливаться
        else if (bestD > ideal * 1.1) move = 1 // далеко в зоне боя — чуть на сближение
        else if (bestD < ideal * 0.55) move = -0.5 // совсем вплотную — чуть назад
      }
      wantMove = move !== 0
      this._botDrive(b, move, dt)
      this._botFire(b, target, bestD, fireRange)
    } else if (b.alertT > 0) {
      // получил урон от стрелка ВНЕ обзора → выдвигаемся на источник, чтобы засветить
      // и не стоять мишенью (фидбек: КВ-1 отстреливает с дистанции больше обзора бота)
      let a = Math.atan2(b.alertY - b.y, b.alertX - b.x)
      if (b.avoidT > 0) a += b.avoidDir * 1.5
      const diff = angleDiff(a, b.hull)
      const turnEff = b.turnRate * (1 - 0.35 * Math.min(1, Math.abs(b.vel) / b.speed))
      b.hull += Math.max(-turnEff * dt, Math.min(turnEff * dt, diff))
      this._botDrive(b, 1, dt) // на полном ходу сближается со стрелком
    } else {
      // нет видимого врага и тревоги — к объективу: открытая точка / защита своей базы
      const goal = this._botGoal(b)
      const c = this.mapSize / 2
      let a = Math.atan2((goal ? goal.y : c) - b.y, (goal ? goal.x : c) - b.x)
      if (b.avoidT > 0) a += b.avoidDir * 1.5
      const diff = angleDiff(a, b.hull)
      const turnEff = b.turnRate * (1 - 0.35 * Math.min(1, Math.abs(b.vel) / b.speed))
      b.hull += Math.max(-turnEff * dt, Math.min(turnEff * dt, diff))
      this._botDrive(b, 0.6, dt)
    }

    this._resolveCollisions(b, ai.radius)
    // вода: бот не топится (выталкивается на кромку глубины), но в броде тормозит
    if (this._waterState(b, false) === 'shallow') {
      const cap = b.speed * WATER_SLOW
      b.vel = Math.max(-cap, Math.min(cap, b.vel))
    }

    // тревога, маскировка и таймеры объезда тают
    if (b.alertT > 0) b.alertT -= dt
    if (b.revealT > 0) b.revealT -= dt
    if (b.avoidT > 0) b.avoidT -= dt
    if (b.reverseT > 0) b.reverseT -= dt
    // антизастревание: упёрся — объезд дугой; упёрся ПОВТОРНО — задний ход и разворот
    const moved = Math.hypot(b.x - px, b.y - py)
    if (wantMove && moved < Math.abs(b.vel) * dt * 0.25) b.stuckT = (b.stuckT || 0) + dt
    else b.stuckT = 0
    if (moved > Math.abs(b.vel) * dt * 0.6) b.stuckHits = 0 // поехал нормально — серия сброшена
    if (b.stuckT > 0.45) {
      b.stuckT = 0
      const fresh = b.avoidT <= 0
      if (fresh) b.avoidDir = Math.random() < 0.5 ? -1 : 1 // новая попытка — выбираем сторону
      b.stuckHits = fresh ? 1 : (b.stuckHits || 0) + 1
      if (b.stuckHits >= 2) {
        b.reverseT = 0.45 // объезд не помог — сдаём назад, ломаем контакт с препятствием
        b.avoidT = 1.6
        b.stuckHits = 0
      } else {
        b.avoidT = 1.0
      }
    }
  }

  // объектив бота: защита своей базы под захватом, иначе ближайшая открытая точка
  // (распределяем по id, чтобы не кучковались на одной)
  _botGoal(b) {
    const ownBase = this.bases.find((bs) => bs.team === b.team && bs.progress > 8)
    if (ownBase) return ownBase
    const open = this.caps.filter((cap) => cap.owner !== b.team)
    open.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))
    if (open.length) return open[b.id % open.length]
    // нет точек (аннигиляция) — охота на живых врагов (навигация всеведущая, огонь
    // по-прежнему по засвету). РАСПРЕДЕЛЯЕМ по разным целям из ближайших (выбор по
    // id), а не все на одного — иначе боты сбиваются в кучу («снова тупые»)
    if (this.mode === 'annihilation') {
      const enemies = this._allUnits().filter((u) => u.team !== b.team)
      if (!enemies.length) return null
      enemies.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))
      return enemies[b.id % Math.min(enemies.length, 3)]
    }
    return null
  }

  // бот получил урон от (возможно невидимого) стрелка: запоминаем источник и на
  // несколько секунд выдвигаемся к нему — чтобы не стоять мишенью под дальним огнём
  _alertBot(b, fromX, fromY) {
    if (!b || !b.alive) return
    b.alertT = 4
    b.alertX = fromX
    b.alertY = fromY
  }

  // выстрел бота по цели, если она в секторе и дальности стрельбы и огонь готов
  _botFire(b, target, bestD, fireRange) {
    if (b.fireCd > 0 || bestD > fireRange) return
    const ang = Math.atan2(target.y - b.y, target.x - b.x)
    if (Math.abs(angleDiff(ang, b.hull)) > (ENEMY_AI.sectorHalfDeg * Math.PI) / 180) return
    b.fireCd = b.reload
    b.revealT = REVEAL_S // бот выстрелил — виден игроку даже из куста (засветился)
    const col = (b.team === TEAM.ALLY ? this.colors.ally : this.colors.enemy).muzzle
    this.muzzles.push({ x: b.x + Math.cos(b.hull) * 34, y: b.y + Math.sin(b.hull) * 34, a: b.hull, age: 0, color: col })
    // точность падает с дистанцией: в упор полная, у края дальности ~0.45
    const accFalloff = 1 - 0.55 * Math.min(1, bestD / fireRange)
    const hit = Math.random() < ENEMY_AI.hitChance * accFalloff
    let pierced = false
    if (hit) {
      const tCls = target.isPlayer ? this.cls.id : target.classId
      const tHull = target.isPlayer ? this.hullAngle : target.hull
      const shotA = Math.atan2(target.y - b.y, target.x - b.x)
      const pen = this._penetration(shotA, tCls, tHull, false)
      pierced = pen.pen
      const dmg = Math.round(b.damage * pen.mult)
      if (dmg > 0) {
        this._damageUnit(target, dmg, b.team)
        b.damageDealt = (b.damageDealt || 0) + dmg
      }
      if (target.isPlayer && !pen.pen) {
        this.blocked++
        this.onSaved(pen.kind)
      }
    }
    this._spawnShell(b.x, b.y, target.x, target.y, col, hit && pierced ? 'hit' : 'dust')
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
    // попадание по тому, кто захватывает ЧУЖУЮ базу — сбивает прогресс захвата
    // (Романов фидбек: «когда тебя атакуют — минусовать время захвата»)
    const ux = unit.isPlayer ? this.tank.x : unit.x
    const uy = unit.isPlayer ? this.tank.y : unit.y
    const uteam = unit.isPlayer ? TEAM.ALLY : unit.team
    for (const base of this.bases) {
      if (base.team !== uteam && base.progress > 0 && Math.hypot(ux - base.x, uy - base.y) <= base.r) {
        base.progress = Math.max(0, base.progress - 20) // каждый удар −20% захвата
      }
    }
  }

  _emitState() {
    this.onState(this._snapshot())
  }

  // итоговая таблица: все бойцы обеих команд по урону (для донесения)
  _scoreboard() {
    const rows = [{ name: 'ВЫ', ally: true, damage: Math.round(this.damageDealt || 0), kills: this.kills || 0, you: true }]
    for (const b of this.bots) {
      rows.push({ name: b.name, ally: b.team === TEAM.ALLY, damage: Math.round(b.damageDealt || 0), kills: b.kills || 0, you: false })
    }
    return rows.sort((a, b) => b.damage - a.damage)
  }

  _snapshot() {
    const reload01 = this.ready ? 1 : 1 - this.reloadRemaining / this.cls.reload
    return {
      kills: this.kills,
      lightKills: this.lightKills,
      bonusXp: Math.round(this.bonusXp),
      blocked: this.blocked,
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
      // точки захвата для HUD: own/cap — 'ally'|'enemy'|null, p — прогресс 0..1
      // (аннигиляция — точек нет, пустой список → HUD/рендер скрывают захват)
      caps: this.mode === 'annihilation' ? [] : this.caps.map((c) => ({
        id: c.id,
        own: c.owner === null ? null : c.owner === TEAM.ALLY ? 'ally' : 'enemy',
        cap: c.capper === null ? null : c.capper === TEAM.ALLY ? 'ally' : 'enemy',
        p: +c.progress.toFixed(2),
      })),
      classId: this.cls.id,
      damageDealt: Math.round(this.damageDealt),
      spotted: this.spotScored.size, // засветов за бой (для боевого рейтинга)
      damageLog: [...this.damageLog.values()]
        .map((e) => ({ ...e, dmg: Math.round(e.dmg) }))
        .sort((a, b) => b.dmg - a.dmg),
      scoreboard: this.matchOver ? this._scoreboard() : null, // итоговая таблица урона обеих команд
      matchTime: Math.ceil(this.matchTime),
      matchOver: this.matchOver,
      result: this.result,
      teamRed: this.side === 1, // мы за красных (север); иначе — за синих (юг)
      mapName: this.map.name,
      mode: this.mode,
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
    // жив — камера за танком (танк вверх); мёртв — свободная камера наблюдения
    // (specCam), карта севером вверх без вращения
    const dead = this.hp <= 0
    const px = dead && this.specCam ? this.specCam.x : this.tank.x
    const py = dead && this.specCam ? this.specCam.y : this.tank.y
    this.world.pivot.set(px, py)
    this.world.position.set(camX, camY)
    this.world.rotation = dead ? 0 : -Math.PI / 2 - this.hullAngle

    const g = this.gfx
    g.clear()
    const mg = this.markGfx
    mg.clear()

    const tx = this.tank.x
    const ty = this.tank.y
    const hull = this.hullAngle
    const half = this._sectorHalfEff() // разброс: стоя — уже, на ходу — шире
    const L = this._vision() // длина прицела = дальность обнаружения (совпадает с туманом)

    // точки захвата (под всем) — в аннигиляции точек нет, круги не рисуем
    for (const cap of this.mode === 'annihilation' ? [] : this.caps) {
      const own = cap.owner === TEAM.ALLY ? this.colors.ally.hp : cap.owner === TEAM.ENEMY ? this.colors.enemy.hp : 0x7b8694
      g.circle(cap.x, cap.y, cap.r).fill({ color: own, alpha: 0.1 })
      g.circle(cap.x, cap.y, cap.r).stroke({ width: 3, color: own, alpha: 0.55 })
      if (cap.progress > 0 && cap.progress < 1) {
        const pc = cap.capper === TEAM.ALLY ? this.colors.ally.hp : this.colors.enemy.hp
        g.moveTo(cap.x, cap.y)
        g.arc(cap.x, cap.y, cap.r * 0.72, -Math.PI / 2, -Math.PI / 2 + cap.progress * Math.PI * 2)
        g.lineTo(cap.x, cap.y)
        g.fill({ color: pc, alpha: 0.25 })
      }
    }

    // прицельные визуалы только у живого танка — обломки не целятся.
    // Сектор приглушён, ГЛАВНОЕ — яркая движущаяся линия сведения (фишка боя):
    // поймай врага этой линией в момент прохода — и попадёшь.
    if (this.hp > 0) {
      g.moveTo(tx, ty)
      g.arc(tx, ty, L, hull - half, hull + half)
      g.lineTo(tx, ty)
      g.fill({ color: 0xf2a50c, alpha: 0.05 })
      for (const a of [hull - half, hull + half]) {
        g.moveTo(tx, ty)
          .lineTo(tx + Math.cos(a) * L, ty + Math.sin(a) * L)
          .stroke({ width: 1.5, color: 0xf2a50c, alpha: 0.22 })
      }

      const lineA = hull + this._sweepOffset()
      const ex = tx + Math.cos(lineA) * L
      const ey = ty + Math.sin(lineA) * L
      const ready = this.ready
      const col = ready ? 0xffe066 : 0x9aa0ad // готов — золотая, на перезарядке — серая
      // свечение под линией
      g.moveTo(tx, ty).lineTo(ex, ey).stroke({ width: 9, color: col, alpha: ready ? 0.16 : 0.08, cap: 'round' })
      // основная линия сведения
      g.moveTo(tx, ty).lineTo(ex, ey).stroke({ width: 4, color: col, alpha: ready ? 1 : 0.5, cap: 'round' })
      // поперечная засечка-прицел на конце линии (вместо набалдашника)
      const tick = ready ? 15 : 10
      const px = -Math.sin(lineA)
      const py = Math.cos(lineA)
      g.moveTo(ex - px * tick, ey - py * tick)
        .lineTo(ex + px * tick, ey + py * tick)
        .stroke({ width: ready ? 4 : 3, color: col, alpha: ready ? 1 : 0.5, cap: 'round' })
      // «блайнд»-зона: пушка добивает ДАЛЬШЕ обзора — продолжаем линию тускло-пунктиром
      // до макс. дальности, чтобы было видно, где стрельба идёт вслепую (фидбек Романа)
      if (this.cls.range > L + 24) {
        const bx = tx + Math.cos(lineA) * this.cls.range
        const by = ty + Math.sin(lineA) * this.cls.range
        for (let s = 0; s < 5; s += 2) {
          g.moveTo(ex + (bx - ex) * (s / 5), ey + (by - ey) * (s / 5))
            .lineTo(ex + (bx - ex) * ((s + 1) / 5), ey + (by - ey) * ((s + 1) / 5))
            .stroke({ width: 2, color: col, alpha: ready ? 0.22 : 0.12, cap: 'round' })
        }
        g.moveTo(bx - px * 9, by - py * 9).lineTo(bx + px * 9, by + py * 9).stroke({ width: 2, color: col, alpha: 0.28 })
      }
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
      const teamCol = isAlly ? this.colors.ally : this.colors.enemy
      // «пятак» под танком убран по фидбеку: команду и так видно по цвету ника и HP-бара
      // классовый фоллбэк-спрайт уже окрашен в текстуре под команду; реальный — нет
      if (useSpr && placeSpr(b.id, b.x, b.y, b.hull, 0xffffff)) {
        if (b.flash > 0) g.circle(b.x, b.y, 30).fill({ color: 0xffffff, alpha: 0.45 })
      } else {
        const c = { body: teamCol.body, dark: teamCol.dark }
        if (b.flash > 0) c.body = 0xffffff
        this._drawTank(g, b.x, b.y, b.hull, c, 0.85)
      }
      // ХП-полоски в цвет команды — с подложкой
      const bw = 48
      const hpCol = teamCol.hp
      g.rect(b.x - bw / 2 - 1, b.y - 37, bw + 2, 7).fill({ color: 0x000000, alpha: 0.65 })
      g.rect(b.x - bw / 2, b.y - 36, bw * (Math.max(0, b.hp) / b.maxHp), 5).fill(hpCol)
    }

    // игрок: живой — в своём камуфляже, уничтожен — обломки
    if (this.hp > 0) {
      if (useSpr && placeSpr('player', tx, ty, hull, this.playerCamoBaked ? 0xffffff : this.playerTint || 0xffffff)) {
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

    // куст, в котором стоит игрок, становится полупрозрачным (видно машину)
    if (this.bushSprites) {
      for (const b of this.bushSprites) {
        const inside = this.hp > 0 && Math.hypot(this.tank.x - b.x, this.tank.y - b.y) < b.r * 0.95
        const target = inside ? 0.32 : 1
        b.s.alpha += (target - b.s.alpha) * 0.18
      }
    }

    this._updateFog()
    this._updateLabels()
    this._drawMinimap()
  }

  // плашка ника над танком: тёмный фон + рамка цвета команды — читается на любой местности
  _makeNamePlate(name, classId, pal) {
    const txt = new Text({
      text: `${CLS_MARK[classId] || ''} ${name}`,
      style: {
        fontFamily: 'Russo One, sans-serif',
        fontSize: 12.5,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        letterSpacing: 0.5,
      },
    })
    txt.anchor.set(0.5, 0.5)
    const bw = txt.width + 14
    const bh = txt.height + 5
    const bg = new Graphics()
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 5).fill({ color: 0x05070a, alpha: 0.6 })
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 5).stroke({ width: 1.5, color: pal.main, alpha: 0.85 })
    const c = new Container()
    c.addChild(bg, txt)
    return c
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

  // туман войны: затемняет местность за радиусом обзора. Спрайт в мире,
  // центр на танке; радиус виньетки покрывает экран (камера держит танк в w/2,h*0.66).
  // Текстуру пересоздаём только при смене размера экрана/обзора.
  _updateFog() {
    if (this.hp <= 0) {
      this.fog.visible = false // уничтожен — наблюдение без тумана
      return
    }
    this.fog.visible = true
    const w = this.app.screen.width
    const h = this.app.screen.height
    const vision = this._vision()
    const radius = Math.ceil(Math.hypot(w / 2, h * 0.66) + 40) // до дальнего угла экрана
    const key = `${radius}:${Math.round(vision)}`
    if (key !== this._fogKey) {
      this._fogKey = key
      const S = 1024
      const c = document.createElement('canvas')
      c.width = c.height = S
      const ctx = c.getContext('2d')
      const frac = Math.max(0.18, Math.min(0.78, vision / radius)) // прозрачная зона = обзор
      const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
      grad.addColorStop(0, 'rgba(7,9,13,0)')
      grad.addColorStop(frac, 'rgba(7,9,13,0)')
      grad.addColorStop(Math.min(1, frac + 0.1), 'rgba(7,9,13,0.55)')
      grad.addColorStop(1, 'rgba(7,9,13,0.9)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, S, S)
      const old = this.fog.texture
      this.fog.texture = Texture.from(c)
      if (old && old !== Texture.EMPTY) old.destroy(true) // ресайз/крит рации не копит 1024²-текстуры
      this.fog.width = this.fog.height = radius * 2
    }
    this.fog.position.set(this.tank.x, this.tank.y) // центр виньетки = танк (в мире)
  }

  _drawMinimap() {
    const ctx = this.minimapCtx
    if (!ctx) return
    const S = this.minimap.width
    const k = S / this.mapSize
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
      ctx.strokeStyle = (b.team === TEAM.ALLY ? this.colors.ally : this.colors.enemy).css
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(b.x * k, b.y * k, b.r * k, 0, Math.PI * 2)
      ctx.stroke()
    }
    // точки захвата с буквами (в аннигиляции точек нет)
    ctx.font = `bold ${Math.round(S * 0.075)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const cap of this.mode === 'annihilation' ? [] : this.caps) {
      const col = cap.owner === TEAM.ALLY ? this.colors.ally.css : cap.owner === TEAM.ENEMY ? this.colors.enemy.css : '#9aa3b0'
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
      ctx.fillStyle = (b.team === TEAM.ALLY ? this.colors.ally : this.colors.enemy).css
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
    if (!this.groundTile) g.rect(0, 0, this.mapSize, this.mapSize).fill(0x10141b)
    const step = 80
    for (let x = 0; x <= this.mapSize; x += step) g.moveTo(x, 0).lineTo(x, this.mapSize)
    for (let y = 0; y <= this.mapSize; y += step) g.moveTo(0, y).lineTo(this.mapSize, y)
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.05 })
    g.rect(0, 0, this.mapSize, this.mapSize).stroke({ width: 6, color: 0xffb000, alpha: 0.25 })
  }

  // круглый текстурный участок местности (лес/камень/вода) с маской
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

  // растворяет края текстуры в прозрачность (мягкий радиальный край):
  // центр до ~62% радиуса полностью непрозрачен, дальше плавно в 0
  _featherTex(tex) {
    const c = document.createElement('canvas')
    const S = (c.width = c.height = tex.width)
    const ctx = c.getContext('2d')
    ctx.drawImage(tex.source.resource, 0, 0, S, S)
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.31, S / 2, S / 2, S * 0.5)
    g.addColorStop(0, 'rgba(0,0,0,1)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
    return Texture.from(c)
  }

  // 3D-спрайт с прозрачным фоном — без маски и обводки. Возвращает спрайт.
  _terrainSprite(texName, x, y, r, scale = 2.5) {
    const tex = this.tex && this.tex[texName]
    if (!tex) return null
    const s = new Sprite(tex)
    s.anchor.set(0.5)
    s.position.set(x, y)
    s.width = s.height = r * scale
    this.terrLayer.addChild(s)
    return s
  }

  // бетонная стена-укрытие: секции, светлая кромка, тень снизу (для длинных стен)
  _drawConcreteWall(g, w) {
    const x = w.cx - w.hw
    const y = w.cy - w.hh
    const ww = w.hw * 2
    const hh = w.hh * 2
    g.rect(x, y, ww, hh).fill(0x6b7178)
    const seg = 64
    if (w.hw >= w.hh) {
      for (let sx = x + seg; sx < x + ww - 4; sx += seg)
        g.moveTo(sx, y).lineTo(sx, y + hh).stroke({ width: 1.5, color: 0x3f444b, alpha: 0.6 })
    } else {
      for (let sy = y + seg; sy < y + hh - 4; sy += seg)
        g.moveTo(x, sy).lineTo(x + ww, sy).stroke({ width: 1.5, color: 0x3f444b, alpha: 0.6 })
    }
    const edge = Math.min(6, hh * 0.25)
    g.rect(x, y, ww, edge).fill({ color: 0x878d94, alpha: 0.8 }) // свет сверху
    g.rect(x, y + hh - edge, ww, edge).fill({ color: 0x2c3036, alpha: 0.7 }) // тень снизу
    g.rect(x, y, ww, hh).stroke({ width: 3, color: 0x2c3036 })
  }

  _drawTerrain() {
    const g = this.terrain
    g.clear()
    this.bushSprites = [] // кусты для динамической прозрачности при заезде
    for (const o of this.obstacles) {
      if (o.kind === 'water') {
        // вода — круглый патч с маской (фон спрайта однородный). Кромка — брод
        // (тормозит), тёмное ядро — глубина (топит): рисуем ядро, чтобы читалась опасность
        const sprited = this._terrainPatch('water', o.x, o.y, o.r)
        if (!sprited) g.circle(o.x, o.y, o.r).fill({ color: 0x1d4a66, alpha: 0.9 })
        g.circle(o.x, o.y, o.r).stroke({ width: 3, color: 0x2e6e8e })
        g.circle(o.x, o.y, o.r * WATER_DEEP).fill({ color: 0x0a2233, alpha: 0.5 })
        g.circle(o.x, o.y, o.r * WATER_DEEP).stroke({ width: 2, color: 0x08151f, alpha: 0.55 })
      } else if (o.kind === 'hill') {
        // гора — спрайт с прозрачным фоном, чуть крупнее круга коллизии
        if (!this._terrainSprite('hill', o.x, o.y, o.r)) {
          g.circle(o.x, o.y, o.r).fill(0x47502f)
          g.circle(o.x, o.y, o.r).stroke({ width: 3, color: 0x2f3520 })
        }
      } else {
        // кусты/камни/ящики — AI-спрайт с прозрачным фоном (контент ~70% кадра)
        const tex = o.kind === 'bush' ? 'forest' : o.kind === 'box' ? 'box' : 'rock'
        const s = this._terrainSprite(tex, o.x, o.y, o.r, 2.8)
        if (s) {
          if (o.kind === 'bush') this.bushSprites.push({ s, x: o.x, y: o.y, r: o.r })
        } else {
          const col = o.kind === 'bush' ? 0x2f6b3a : o.kind === 'box' ? 0x6b5436 : 0x4a4f57
          g.circle(o.x, o.y, o.r).fill({ color: col, alpha: 0.85 })
        }
      }
    }
    // стены-укрытия: квадратные — крыши зданий-спрайтов, длинные — бетон
    for (const w of this.walls) {
      const aspect = w.hw / w.hh
      if (this.tex && this.tex.building && aspect > 0.45 && aspect < 2.2) {
        const s = new Sprite(this.tex.building)
        s.anchor.set(0.5)
        s.position.set(w.cx, w.cy)
        s.width = w.hw * 2
        s.height = w.hh * 2
        this.terrLayer.addChild(s)
        g.rect(w.cx - w.hw, w.cy - w.hh, w.hw * 2, w.hh * 2).stroke({ width: 3, color: 0x33373d })
      } else {
        this._drawConcreteWall(g, w)
      }
    }
    // базы команд
    for (const b of this.bases) {
      const col = (b.team === TEAM.ALLY ? this.colors.ally : this.colors.enemy).hp
      g.circle(b.x, b.y, b.r).fill({ color: col, alpha: 0.08 })
      g.circle(b.x, b.y, b.r).stroke({ width: 4, color: col, alpha: 0.4 })
      g.circle(b.x, b.y, 14).fill(col)
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    const fogTex = this.fog && this.fog.texture
    this.app.destroy(true, { children: true })
    // запечённые из canvas текстуры живут в кэше Pixi мимо app.destroy
    if (fogTex && fogTex !== Texture.EMPTY) fogTex.destroy(true)
    for (const t of this._baked) t.destroy(true)
    this._baked = []
    this.tex = null
  }
}
