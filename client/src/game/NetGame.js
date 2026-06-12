import { Application, Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js'
import { TANK_CLASSES, DEFAULT_CLASS, MAP_SIZE, SCORE_LIMIT, classToRadians } from './config.js'
import { MAP_BY_ID, MAPS } from './maps.js'
import { SKIN_BY_ID } from './meta.js'
import { applyCamo } from './camo.js'

// камуфляж с узором (для скинов-оттенков и неизвестных id — null)
const camoOf = (skinId) => (skinId && SKIN_BY_ID[skinId] ? SKIN_BY_ID[skinId].camo || null : null)

// маркер класса над танком: лёгкий ▲ / средний ◆ / тяжёлый ■
const CLS_MARK = { light: '▲', medium: '◆', heavy: '■' }

// Палитры команд — как в локальном Game: юг (team 0) синие, север (team 1) красные.
const TEAM_PALETTE = {
  blue: { main: 0x4da3ff, hp: 0x5b9cff, muzzle: 0x9fd0ff, tint: 0x9ab8ff, body: 0x4a82c8, dark: 0x1b3a5c, sprite: 'blue', css: '#5b9cff' },
  red: { main: 0xff8d7d, hp: 0xff5a4a, muzzle: 0xff7043, tint: 0xffa090, body: 0xd8543f, dark: 0x6e1f12, sprite: 'red', css: '#ff6a6a' },
}

/**
 * Сетевой бой (PvP): рендер авторитетных снапшотов сервера тем же API,
 * что у локального Game — Battle.vue не различает режимы.
 * Сервер шлёт 20Гц state{units,score,caps,events,you}; позиция рисуется
 * с лерпом между двумя последними снапшотами.
 */
export class NetGame {
  constructor({ client, mapId, side = 0, youUnit = null, tickHz = 20, mode = 'capture' }) {
    this.net = true
    this.app = new Application()
    this.client = client
    this.map = MAP_BY_ID[mapId] || MAPS[0]
    this.mapSize = this.map.size || MAP_SIZE // размер карты (большие — больше места)
    this.mode = mode === 'annihilation' ? 'annihilation' : 'capture'
    this.side = side === 1 ? 1 : 0
    this.youUnit = youUnit
    this.tickDt = 1 / (tickHz || 20)
    this.colors = this.side === 0
      ? { ally: TEAM_PALETTE.blue, enemy: TEAM_PALETTE.red }
      : { ally: TEAM_PALETTE.red, enemy: TEAM_PALETTE.blue }

    this.setClass(DEFAULT_CLASS)
    this.playerTankId = null
    this.playerTint = 0xffffff
    this.playerSkin = null // id узорного камуфляжа своей машины
    this.ammoMult = 1 // голды в PvP нет — поле для совместимости с Battle

    // снапшоты сервера
    this.prev = null
    this.cur = null
    this.recvAt = 0
    this.you = null // личная добавка (hp/перезарядка/криты/счётчики)
    this.matchOver = false
    this.result = null
    this.finalStats = null
    this.deaths = 0
    this.lightKills = 0 // для задач дня
    this.damageLog = new Map()

    // ввод
    this.joystick = { x: 0, y: 0, active: false }
    this.keys = { fwd: false, back: false, left: false, right: false }
    this.paused = false
    this._lastSent = { throttle: 0, steer: 0, at: 0 }
    this.specCam = null // после гибели — свободная камера наблюдения по карте

    // эффекты
    this.shells = []
    this.booms = []
    this.muzzles = []
    this.flash = new Map() // unitId -> сек подсветки попадания
    this.hurtFlash = 0
    this.sweepFrozen = null

    // статика карты (координаты растягиваем под размер карты — как на сервере)
    const c = this.mapSize / 2
    const sc = this.mapSize / MAP_SIZE
    this.obstacles = this.map.obstacles.map((o) => ({ x: c + o.dx * sc, y: c + o.dy * sc, r: o.r, kind: o.kind }))
    this.walls = this.map.walls.map((w) => ({ cx: c + w.dx * sc, cy: c + w.dy * sc, hw: w.w / 2, hh: w.h / 2 }))
    this.bases = this.map.bases.map((b, i) => ({ team: i, x: c + b.dx * sc, y: c + b.dy * sc, r: b.r }))
    this.capPos = Object.fromEntries(this.map.caps.map((p) => [p.id, { x: c + p.dx * sc, y: c + p.dy * sc, r: p.r }]))

    this.minimap = null
    this.minimapCtx = null
    this.onState = () => {}
    this.onShot = () => {}
    this.onCrit = () => {}
    this.onKill = () => {}
    this.onStall = null // связь ОКОНЧАТЕЛЬНО умерла посреди боя → Battle откатит в офлайн
    this.onReconnecting = () => {} // снапшоты просели, но сокет жив → «восстанавливаем связь» (НЕ откат)
    this._reconnecting = false
    this.onSaved = () => {} // в PvP брони/рикошетов нет
    this._gridDrawn = false
    this._wantedTex = new Set()

    client.onMessage = (msg) => this._onMessage(msg)
    // снапшоты, пришедшие ДО подписки (гонка матчмейкинг→бой), не теряем —
    // сразу проигрываем последний буферизованный (мир появляется мгновенно)
    if (client.lastState) this._onMessage(client.lastState)
    if (client.lastEnd) this._onMessage(client.lastEnd) // бой успел кончиться до подписки
    // активный сокет оборвался посреди боя — НЕ сдаёмся сразу: пробуем вернуться
    // в тот же бой (см. _tryRecover). В офлайн уходим только после исчерпания попыток.
    client.onSocketClose = (code) => {
      if (this.matchOver) return
      console.warn(`[net] боевой сокет закрыт (code=${code}) — пробую вернуться в бой`)
      this._tryRecover()
    }
  }

  // вернуться в идущий бой при обрыве/мёртвом-но-открытом сокете (iOS). До 3
  // попыток; успех — поток снапшотов возобновится; провал всех — откат в офлайн.
  _tryRecover() {
    if (this.matchOver || this._recoverInFlight || !this.client || !this.client.reconnect) return
    if (this._reconnectTries >= 3) {
      if (this.onStall) {
        const cb = this.onStall
        this.onStall = null
        cb()
      }
      return
    }
    this._recoverInFlight = true
    this._reconnectTries = (this._reconnectTries || 0) + 1
    console.warn(`[net] попытка вернуться в бой #${this._reconnectTries}`)
    this.client
      .reconnect()
      .then(() => {
        this._recoverInFlight = false
        this.recvAt = performance.now() // дать кадр на первые снапшоты нового сокета
      })
      .catch((e) => {
        this._recoverInFlight = false
        this._recoverCooldownUntil = performance.now() + 1200 // пауза перед следующей попыткой
        console.warn('[net] вернуться не удалось:', e && e.message)
        if (this._reconnectTries >= 3 && this.onStall) {
          const cb = this.onStall
          this.onStall = null
          cb()
        }
      })
  }

  // совместимость с Battle: пул ботов набирает сервер
  setBotTanks() {}

  setClass(id) {
    this.setStats(TANK_CLASSES[id] || TANK_CLASSES[DEFAULT_CLASS])
  }

  setStats(base) {
    const src = base && base.sectorDeg ? base : TANK_CLASSES[DEFAULT_CLASS]
    this.cls = classToRadians(src)
  }

  setPaused(v) {
    this.paused = v // мир живёт на сервере; пауза лишь глушит наш ввод
  }

  setMinimap(canvas) {
    this.minimap = canvas
    this.minimapCtx = canvas ? canvas.getContext('2d') : null
  }

  setJoystick(x, y, active) {
    this.joystick = { x, y, active }
  }

  fire() {
    if (this.paused || this.matchOver) return
    this.client.send({ type: 'fire' })
  }

  // --- сеть ---

  _onMessage(msg) {
    if (msg.type === 'state') {
      this.prev = this.cur
      this.cur = msg
      this.recvAt = performance.now()
      if (this._reconnectTries) this._reconnectTries = 0 // поток здоров — следующий затык получит свежие 3 попытки
      if (msg.you) this.you = msg.you
      this._units = new Map(msg.units.map((u) => [u.id, u]))
      for (const u of msg.units) this._wantTex(u.tankId, u.skin)
      for (const ev of msg.events || []) this._onEvent(ev)
      if (msg.matchOver && !this.matchOver) this._finish(msg.winner)
      this._emitState()
    } else if (msg.type === 'match-end') {
      this.finalStats = msg.stats || null
      if (!this.matchOver) this._finish(msg.winner)
      this._emitState()
    }
  }

  _finish(winner) {
    this.matchOver = true
    this.result = winner === null ? 'draw' : winner === this.side ? 'victory' : 'defeat'
    if (this._reconnecting) {
      this._reconnecting = false
      this.onReconnecting(false) // бой кончился пока «восстанавливали связь» — снять плашку
    }
  }

  _onEvent(ev) {
    const mine = ev.unit === this.youUnit
    if (ev.type === 'shot') {
      if (ev.blocked) {
        if (mine) this.onShot({ type: 'blocked', reason: ev.blocked === 'gun' ? 'gun' : undefined })
        return
      }
      const shooter = this._units.get(ev.unit)
      const pal = shooter && shooter.team === this.side ? this.colors.ally : this.colors.enemy
      const col = mine ? 0xffd866 : pal.muzzle
      const a = Math.atan2(ev.y2 - ev.y1, ev.x2 - ev.x1)
      this.muzzles.push({ x: ev.x1 + Math.cos(a) * 40, y: ev.y1 + Math.sin(a) * 40, a, age: 0, color: col })
      this.shells.push({
        x1: ev.x1,
        y1: ev.y1,
        x2: ev.x2,
        y2: ev.y2,
        t: 0,
        dur: Math.max(0.08, Math.hypot(ev.x2 - ev.x1, ev.y2 - ev.y1) / 1400),
        color: col,
        boom: ev.killed ? 'big' : ev.hit ? 'hit' : 'dust',
      })
      if (mine) {
        this.onShot({ type: ev.hit ? 'hit' : 'miss', reason: 'line' })
        if (ev.hit && ev.target && ev.dmg) {
          const t = this._units.get(ev.target)
          const entry = this.damageLog.get(ev.target) || { name: t ? t.name : '—', tankId: t ? t.tankId : null, dmg: 0, killed: false }
          entry.dmg += ev.dmg
          entry.killed = entry.killed || !!ev.killed
          this.damageLog.set(ev.target, entry)
        }
      }
    } else if (ev.type === 'hp') {
      this.flash.set(ev.unit, 0.25)
      if (mine) this.hurtFlash = 0.25
    } else if (ev.type === 'crit') {
      if (mine) this.onCrit(ev.slot)
    } else if (ev.type === 'kill') {
      if (ev.victim === this.youUnit) this.deaths = 1
      if (ev.killer === this.youUnit) {
        const v = this._units.get(ev.victim)
        if (v && v.cls === 'light') this.lightKills++
        this.onKill(v ? v.name : 'враг')
      }
    }
  }

  // отправка ввода: 10Гц либо сразу при заметном изменении
  _sendInput() {
    if (!this.client || this.matchOver) return
    let steer = 0
    let throttle = 0
    if (!this.paused) {
      const j = this.joystick
      if (j.active) {
        steer = Math.abs(j.x) < 0.12 ? 0 : j.x
        const fwd = -j.y
        throttle = Math.abs(fwd) < 0.12 ? 0 : Math.max(-1, Math.min(1, fwd))
      } else {
        const k = this.keys
        steer = (k.right ? 1 : 0) - (k.left ? 1 : 0)
        throttle = (k.fwd ? 1 : 0) - (k.back ? 1 : 0)
      }
    }
    const s = this._lastSent
    const now = performance.now()
    if (Math.abs(steer - s.steer) > 0.04 || Math.abs(throttle - s.throttle) > 0.04 || now - s.at > 300) {
      this._lastSent = { steer, throttle, at: now }
      this.client.send({ type: 'input', throttle, steer })
    }
  }

  // --- pixi ---

  async mount(container) {
    await this.app.init({
      resizeTo: container,
      background: 0x0e1116,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    container.appendChild(this.app.canvas)

    this.tex = {}
    const tankNames = []
    for (const color of ['amber', 'blue', 'red']) {
      tankNames.push(`tank_${color}`)
      for (const cls of ['light', 'heavy']) tankNames.push(`tank_${cls}_${color}`)
    }
    const texNames = ['ground', 'forest', 'rock', 'water', 'hill', 'building', 'explosion', 'smoke', 'muzzle', 'box', ...tankNames]
    const loaded = await Promise.allSettled(texNames.map((n) => Assets.load(`/sprites/${n}.png`)))
    texNames.forEach((n, i) => {
      if (loaded[i].status === 'fulfilled') this.tex[n] = loaded[i].value
    })
    for (const k of Object.keys(this.tex)) {
      if (k.startsWith('tank_')) this.tex[k] = this._chromaKey(this.tex[k])
    }
    // кусты/камни/горы — AI-спрайты с вырезанным фоном (прозрачная альфа)
    if (this.playerTankId) this._wantTex(this.playerTankId, this.playerSkin)

    this.world = new Container()
    this.bg = new Graphics()
    this.terrain = new Graphics()
    this.gfx = new Graphics()
    this.markGfx = new Graphics() // командные «пятаки» свой/чужой ПОД танками
    this.terrLayer = new Container()
    this.tankLayer = new Container()
    this.fxLayer = new Container()
    if (this.tex.ground) {
      this.groundTile = new TilingSprite({ texture: this.tex.ground, width: this.mapSize, height: this.mapSize })
      this.groundTile.tileScale.set(0.55)
      if (this.map.tint) this.groundTile.tint = this.map.tint
      this.world.addChild(this.groundTile)
    }
    this.world.addChild(this.bg, this.terrLayer, this.terrain, this.markGfx, this.tankLayer, this.gfx, this.fxLayer)
    this.app.stage.addChild(this.world)

    this.unitSprites = new Map() // unitId -> Sprite (создаются по мере появления)
    this.fxSprites = []
    // туман войны: слой в мире между террейном и танками — скрывает дальнюю
    // местность, но танки (свои и засвеченные враги) рисуются поверх и видны
    this.fog = new Sprite(Texture.EMPTY)
    this.fog.anchor.set(0.5)
    this._fogKey = ''
    this.world.addChildAt(this.fog, this.world.getChildIndex(this.tankLayer))
    this.labels = new Container()
    this.app.stage.addChild(this.labels)
    this.unitLabels = new Map()

    this._bindKeyboard()
    this._inputTimer = setInterval(() => this._sendInput(), 100)
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
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
    }
    this._onKeyDown = (e) => setKey(e, true)
    this._onKeyUp = (e) => setKey(e, false)
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
  }

  // вырезает фон (магента/зелень) в прозрачную альфу, возвращает canvas
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
    return Texture.from(this._chromaCanvas(tex))
  }

  // ключ текстуры машины: с узорным камуфляжем — отдельная запечённая
  _tankTexKey(tankId, skinId) {
    return camoOf(skinId) ? `unit_${tankId}:${skinId}` : `unit_${tankId}`
  }

  // ленивые текстуры реальных машин игроков (+вариант с узором камуфляжа)
  _wantTex(tankId, skinId = null) {
    if (!tankId) return
    const key = this._tankTexKey(tankId, skinId)
    if (this._wantedTex.has(key)) return
    this._wantedTex.add(key)
    Assets.load(`/sprites/tanks/${tankId}.png`)
      .then((t) => {
        if (!this.tex) return
        const c = this._chromaCanvas(t)
        const camo = camoOf(skinId)
        if (camo) applyCamo(c.getContext('2d'), c.width, camo)
        this.tex[key] = Texture.from(c)
      })
      .catch(() => {})
  }

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

  // --- интерполяция ---

  _lerpUnits() {
    if (!this.cur) return []
    const alpha = Math.max(0, Math.min(1, (performance.now() - this.recvAt) / (this.tickDt * 1000)))
    const prev = this.prev ? new Map(this.prev.units.map((u) => [u.id, u])) : null
    const lerpA = (a, b, t) => {
      let d = (b - a) % (Math.PI * 2)
      if (d > Math.PI) d -= Math.PI * 2
      if (d < -Math.PI) d += Math.PI * 2
      return a + d * t
    }
    return this.cur.units.map((u) => {
      const p = prev && prev.get(u.id)
      if (!p || !u.alive) return u
      return { ...u, x: p.x + (u.x - p.x) * alpha, y: p.y + (u.y - p.y) * alpha, hull: lerpA(p.hull, u.hull, alpha) }
    })
  }

  _own(units) {
    return units.find((u) => u.id === this.youUnit) || null
  }

  // линия сведения — та же формула, что на сервере (по t снапшота)
  _sweepOffset() {
    if (this.you && this.you.crippled && this.you.crippled.turret > 0) {
      return this.sweepFrozen ?? 0
    }
    const t = this.cur ? this.cur.t : 0
    const p = (t % this.cls.sweepPeriod) / this.cls.sweepPeriod
    const tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p
    this.sweepFrozen = this.cls.sectorHalf * tri
    return this.sweepFrozen
  }

  // --- цикл ---

  // после гибели джойстик свободно водит камеру по карте (наблюдение).
  // rotation в _draw тогда 0 (север вверху) — панорама совпадает с экраном.
  _panSpectator(dt) {
    const own = this.cur ? this.cur.units.find((u) => u.id === this.youUnit) : null
    if (!own || own.alive) {
      this.specCam = null
      return
    }
    if (!this.specCam) this.specCam = { x: own.x, y: own.y }
    const j = this.joystick
    if (j.active && !this.paused) {
      const sp = 700 // px/сек
      this.specCam.x = Math.max(0, Math.min(this.mapSize, this.specCam.x + j.x * sp * dt))
      this.specCam.y = Math.max(0, Math.min(this.mapSize, this.specCam.y + j.y * sp * dt))
    }
  }

  _update(dt) {
    dt = Math.min(dt, 0.05)
    // снапшоты сервера могли встать. На iOS WebView боевой сокет на старте боя
    // нередко УМИРАЕТ молча (readyState=open, но данные не идут) — ждать
    // бесполезно, надо ПЕРЕПОДКЛЮЧИТЬСЯ к тому же бою (_tryRecover). Показываем
    // «восстанавливаем связь», пробуем вернуться новым сокетом; снапшоты
    // возобновятся и продолжим в живом бою. В офлайн уходим только когда все
    // попытки возврата исчерпаны (внутри _tryRecover) либо как крайний бэкстоп.
    if (this.recvAt && !this.matchOver) {
      const gap = performance.now() - this.recvAt
      if (gap > 2500) {
        if (!this._reconnecting) {
          this._reconnecting = true
          this.onReconnecting(true)
        }
        // поток встал — пробуем вернуться (с паузой между попытками)
        if (gap > 3500 && performance.now() > (this._recoverCooldownUntil || 0)) {
          this._tryRecover()
        }
      } else if (this._reconnecting) {
        this._reconnecting = false
        this.onReconnecting(false)
      }
      // крайний бэкстоп: если возврат недоступен и поток мёртв очень долго
      if (this.onStall && gap > 25000) {
        const cb = this.onStall
        this.onStall = null
        cb()
        return
      }
    }
    this._panSpectator(dt)
    for (const s of this.shells) {
      s.t += dt
      if (s.t >= s.dur) {
        this.booms.push({ x: s.x2, y: s.y2, age: 0, big: s.boom === 'big', dust: s.boom === 'dust' })
        if (s.boom === 'hit') this._spawnFx(s.x2, s.y2, 0.7)
        if (s.boom === 'big') this._spawnFx(s.x2, s.y2, 1.7)
      }
    }
    this.shells = this.shells.filter((s) => s.t < s.dur)
    for (const bm of this.booms) bm.age += dt
    this.booms = this.booms.filter((bm) => bm.age <= (bm.big ? 0.7 : 0.45))
    for (const m of this.muzzles) m.age += dt
    this.muzzles = this.muzzles.filter((m) => m.age <= 0.09)
    for (const [id, v] of this.flash) {
      const nv = v - dt
      if (nv <= 0) this.flash.delete(id)
      else this.flash.set(id, nv)
    }
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt)
    if (this.fxSprites.length) {
      for (const f of this.fxSprites) {
        f.age += dt
        const k = Math.min(1, f.age / f.life)
        if (f.smoke) {
          f.s.scale.set(f.base * (0.6 + k * 1.5))
          f.s.alpha = 0.7 * (1 - k)
          f.s.y -= dt * 18
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
    this._draw()
  }

  // --- отрисовка ---

  _draw() {
    if (!this.world) return
    const w = this.app.screen.width
    const h = this.app.screen.height
    if (!this._gridDrawn) {
      this._drawMap()
      this._drawTerrain()
      this._gridDrawn = true
    }

    const units = this._lerpUnits()
    const own = this._own(units)
    const dead = !!(own && !own.alive)
    const ox = own ? own.x : this.mapSize / 2
    const oy = own ? own.y : this.mapSize / 2
    const ohull = own ? own.hull : (-Math.PI / 2) * (this.side === 0 ? 1 : -1)

    // жив — камера следует за танком (танк смотрит вверх); мёртв — свободная
    // камера наблюдения (specCam), карта развёрнута севером вверх без вращения
    const camX = dead && this.specCam ? this.specCam.x : ox
    const camY = dead && this.specCam ? this.specCam.y : oy
    this.world.pivot.set(camX, camY)
    this.world.position.set(w / 2, h * 0.66)
    this.world.rotation = dead ? 0 : -Math.PI / 2 - ohull

    const g = this.gfx
    g.clear()
    const mg = this.markGfx
    mg.clear()

    // точки захвата
    const caps = this.cur ? this.cur.caps : []
    for (const cap of caps) {
      const pos = this.capPos[cap.id]
      if (!pos) continue
      const own_ = cap.owner === this.side ? this.colors.ally.hp : cap.owner !== null ? this.colors.enemy.hp : 0x7b8694
      g.circle(pos.x, pos.y, pos.r).fill({ color: own_, alpha: 0.1 })
      g.circle(pos.x, pos.y, pos.r).stroke({ width: 3, color: own_, alpha: 0.55 })
      if (cap.p > 0 && cap.p < 1) {
        const pc = cap.capper === this.side ? this.colors.ally.hp : this.colors.enemy.hp
        g.moveTo(pos.x, pos.y)
        g.arc(pos.x, pos.y, pos.r * 0.72, -Math.PI / 2, -Math.PI / 2 + cap.p * Math.PI * 2)
        g.lineTo(pos.x, pos.y)
        g.fill({ color: pc, alpha: 0.25 })
      }
    }

    // сектор и линия сведения у живого своего танка
    const aliveSelf = own && own.alive
    if (aliveSelf) {
      const half = this.cls.sectorHalf
      const L = this.cls.vision // длина прицела = дальность обнаружения (совпадает с туманом)
      g.moveTo(ox, oy)
      g.arc(ox, oy, L, ohull - half, ohull + half)
      g.lineTo(ox, oy)
      g.fill({ color: 0xf2a50c, alpha: 0.05 })
      for (const a of [ohull - half, ohull + half]) {
        g.moveTo(ox, oy)
          .lineTo(ox + Math.cos(a) * L, oy + Math.sin(a) * L)
          .stroke({ width: 1.5, color: 0xf2a50c, alpha: 0.22 })
      }
      // главная — яркая движущаяся линия сведения с наконечником-маркером
      const lineA = ohull + this._sweepOffset()
      const ex = ox + Math.cos(lineA) * L
      const ey = oy + Math.sin(lineA) * L
      const ready = !!(this.you && this.you.ready)
      const col = ready ? 0xffe066 : 0x9aa0ad
      g.moveTo(ox, oy).lineTo(ex, ey).stroke({ width: 9, color: col, alpha: ready ? 0.16 : 0.08, cap: 'round' })
      g.moveTo(ox, oy).lineTo(ex, ey).stroke({ width: 4, color: col, alpha: ready ? 1 : 0.5, cap: 'round' })
      const tick = ready ? 15 : 10
      const px = -Math.sin(lineA)
      const py = Math.cos(lineA)
      g.moveTo(ex - px * tick, ey - py * tick)
        .lineTo(ex + px * tick, ey + py * tick)
        .stroke({ width: ready ? 4 : 3, color: col, alpha: ready ? 1 : 0.5, cap: 'round' })
    }

    // личный туман войны: живой враг, засвеченный сервером (командой), но вне
    // ЛИЧНОГО обзора игрока — не рисуется. Мёртв игрок — наблюдение, видно всех.
    const PROX = 150
    const vis = this.cls.vision
    const meAlive = own && own.alive
    this._hiddenEnemy = new Set()
    if (meAlive) {
      for (const u of units) {
        if (!u.alive || u.team === this.side) continue
        const d = Math.hypot(u.x - ox, u.y - oy)
        if (d > PROX && d > vis) this._hiddenEnemy.add(u.id)
      }
    }

    // юниты
    const seen = new Set()
    for (const u of units) {
      const isSelf = u.id === this.youUnit
      const isAlly = u.team === this.side
      // скрытый туманом враг — прячем спрайт и пропускаем
      if (!isAlly && u.alive && this._hiddenEnemy.has(u.id)) {
        const hs = this.unitSprites.get(u.id)
        if (hs) hs.visible = false
        continue
      }
      seen.add(u.id)
      const pal = isAlly ? this.colors.ally : this.colors.enemy
      const spr = this._unitSprite(u, isSelf, pal)

      if (!u.alive) {
        g.circle(u.x, u.y, 30).fill({ color: 0x000000, alpha: 0.35 })
        if (spr) {
          spr.visible = true
          spr.position.set(u.x, u.y)
          spr.rotation = u.hull - Math.PI / 2
          spr.tint = 0x3c3c34
        } else {
          this._drawTank(g, u.x, u.y, u.hull, { body: 0x2c2f27, dark: 0x16180f }, 0.85)
        }
        continue
      }

      const flash = this.flash.get(u.id) > 0
      // «пятак» под танком убран по фидбеку: команду видно по цвету ника и HP-бара
      if (spr) {
        spr.visible = true
        spr.position.set(u.x, u.y)
        spr.rotation = u.hull - Math.PI / 2
        // узорный камуфляж уже запечён в текстуру — поверх не тонируем; командный
        // оттенок НЕ накладываем: танк в своём камо/окраске, команду даёт «пятак»
        const baked = spr._texKey && spr._texKey.includes(':')
        spr.tint = baked ? 0xffffff : isSelf ? this.playerTint || 0xffffff : u.tint || 0xffffff
        if (flash) g.circle(u.x, u.y, 30).fill({ color: 0xffffff, alpha: 0.45 })
        if (isSelf && this.hurtFlash > 0) g.circle(u.x, u.y, 36).fill({ color: 0xff6a5a, alpha: 0.4 })
      } else {
        const c = isSelf
          ? { body: this.hurtFlash > 0 ? 0xff8a8a : 0xf2a50c, dark: 0x3d3110, outline: 0xffd866 }
          : { body: flash ? 0xffffff : pal.body, dark: pal.dark }
        this._drawTank(g, u.x, u.y, u.hull, c, isSelf ? 1 : 0.85)
      }

      // ХП-полоска
      const bw = 48
      g.rect(u.x - bw / 2 - 1, u.y - 37, bw + 2, 7).fill({ color: 0x000000, alpha: 0.65 })
      g.rect(u.x - bw / 2, u.y - 36, bw * (Math.max(0, u.hp) / (u.maxHp || 1)), 5).fill(isSelf ? 0xf2a50c : pal.hp)
    }

    // спрайты/подписи пропавших из снапшота (незасвеченные враги) — прячем
    for (const [id, spr] of this.unitSprites) {
      if (!seen.has(id)) spr.visible = false
    }

    // снаряды
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
    for (const m of this.muzzles) {
      const k = 1 - m.age / 0.09
      g.circle(m.x, m.y, 9 * k).fill({ color: 0xffffff, alpha: 0.8 * k })
      g.moveTo(m.x, m.y)
        .lineTo(m.x + Math.cos(m.a) * 22 * k, m.y + Math.sin(m.a) * 22 * k)
        .stroke({ width: 5 * k, color: m.color, alpha: 0.9 * k })
    }
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

    // куст, в котором стоит игрок, становится полупрозрачным
    if (this.bushSprites) {
      const meAlive = own && own.alive
      for (const b of this.bushSprites) {
        const inside = meAlive && Math.hypot(ox - b.x, oy - b.y) < b.r * 0.95
        const target = inside ? 0.32 : 1
        b.s.alpha += (target - b.s.alpha) * 0.18
      }
    }

    this._updateFog(own)
    this._updateLabels(units)
    this._drawMinimap(units)
  }

  // туман войны: спрайт в мире, центр на своём танке; скрывает местность вне обзора
  _updateFog(own) {
    if (!own || !own.alive) {
      this.fog.visible = false
      return
    }
    this.fog.visible = true
    const w = this.app.screen.width
    const h = this.app.screen.height
    const vision = this.cls.vision
    const radius = Math.ceil(Math.hypot(w / 2, h * 0.66) + 40)
    const key = `${radius}:${Math.round(vision)}`
    if (key !== this._fogKey) {
      this._fogKey = key
      const S = 1024
      const c = document.createElement('canvas')
      c.width = c.height = S
      const ctx = c.getContext('2d')
      const frac = Math.max(0.18, Math.min(0.78, vision / radius))
      const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
      grad.addColorStop(0, 'rgba(7,9,13,0)')
      grad.addColorStop(frac, 'rgba(7,9,13,0)')
      grad.addColorStop(Math.min(1, frac + 0.1), 'rgba(7,9,13,0.55)')
      grad.addColorStop(1, 'rgba(7,9,13,0.9)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, S, S)
      this.fog.texture = Texture.from(c)
      this.fog.width = this.fog.height = radius * 2
    }
    this.fog.position.set(own.x, own.y)
  }

  // спрайт юнита: реальная машина игрока (с узором камуфляжа) → классовый
  // цветной → null (вектор). Запечённая текстура могла прийти позже создания
  // спрайта — тогда подменяем на месте.
  _unitSprite(u, isSelf, pal) {
    if (!this.unitSprites || !this.tex) return null
    const skinId = isSelf ? this.playerSkin : u.skin
    const wantKey = u.tankId ? this._tankTexKey(u.tankId, skinId) : null
    const want = wantKey && this.tex[wantKey]
    const size = isSelf ? 96 : u.cls === 'heavy' ? 92 : u.cls === 'light' ? 76 : 84
    let spr = this.unitSprites.get(u.id)
    if (spr) {
      if (want && spr._texKey !== wantKey) {
        spr.texture = want
        spr._texKey = wantKey
        spr.scale.set(size / spr.texture.height)
      }
      return spr
    }
    const color = isSelf ? 'amber' : pal.sprite
    const byClass = this.tex[`tank_${u.cls}_${color}`] || this.tex[`tank_${color}`]
    const tex = want || byClass
    if (!tex) return null
    spr = new Sprite(tex)
    spr._texKey = want ? wantKey : null
    spr.anchor.set(0.5)
    spr.scale.set(size / spr.texture.height)
    this.tankLayer.addChild(spr)
    this.unitSprites.set(u.id, spr)
    return spr
  }

  _updateLabels(units) {
    if (!this.unitLabels) return
    const seen = new Set()
    for (const u of units) {
      if (!u.alive) continue
      // скрытый туманом враг — без имени
      if (u.team !== this.side && this._hiddenEnemy && this._hiddenEnemy.has(u.id)) continue
      seen.add(u.id)
      let t = this.unitLabels.get(u.id)
      if (!t) {
        t = this._makeNamePlate(u)
        this.labels.addChild(t)
        this.unitLabels.set(u.id, t)
      }
      t.visible = true
      const p = this.world.toGlobal({ x: u.x, y: u.y })
      t.position.set(p.x, p.y - 50)
    }
    for (const [id, t] of this.unitLabels) {
      if (!seen.has(id)) t.visible = false
    }
  }

  // плашка ника над танком: тёмный фон + рамка цвета команды (своя — янтарь),
  // чтобы ник читался на любой местности
  _makeNamePlate(u) {
    const isYou = u.id === this.youUnit
    const pal = u.team === this.side ? this.colors.ally : this.colors.enemy
    const txt = new Text({
      text: `${CLS_MARK[u.cls] || ''} ${u.name}`,
      style: {
        fontFamily: 'Russo One, sans-serif',
        fontSize: 12.5,
        fill: isYou ? 0xffd54a : 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        letterSpacing: 0.5,
      },
    })
    txt.anchor.set(0.5, 0.5)
    const bw = txt.width + 14
    const bh = txt.height + 5
    const border = isYou ? 0xf2a50c : pal.main
    const bg = new Graphics()
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 5).fill({ color: 0x05070a, alpha: 0.6 })
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 5).stroke({ width: 1.5, color: border, alpha: 0.85 })
    const c = new Container()
    c.addChild(bg, txt)
    return c
  }

  _drawMinimap(units) {
    const ctx = this.minimapCtx
    if (!ctx) return
    const S = this.minimap.width
    const k = S / this.mapSize
    ctx.clearRect(0, 0, S, S)
    ctx.fillStyle = '#0c0f14'
    ctx.fillRect(0, 0, S, S)

    ctx.fillStyle = 'rgba(150,160,175,0.4)'
    for (const w of this.walls) ctx.fillRect((w.cx - w.hw) * k, (w.cy - w.hh) * k, w.hw * 2 * k, w.hh * 2 * k)
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
    for (const b of this.bases) {
      ctx.strokeStyle = (b.team === this.side ? this.colors.ally : this.colors.enemy).css
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(b.x * k, b.y * k, b.r * k, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.font = `bold ${Math.round(S * 0.075)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const cap of this.cur ? this.cur.caps : []) {
      const pos = this.capPos[cap.id]
      if (!pos) continue
      const col = cap.owner === this.side ? this.colors.ally.css : cap.owner !== null ? this.colors.enemy.css : '#9aa3b0'
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(pos.x * k, pos.y * k, Math.max(5, pos.r * k * 0.55), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0c0f14'
      ctx.fillText(cap.id, pos.x * k, pos.y * k)
    }
    for (const u of units) {
      if (!u.alive || u.id === this.youUnit) continue
      // скрытый туманом враг не светится на миникарте
      if (u.team !== this.side && this._hiddenEnemy && this._hiddenEnemy.has(u.id)) continue
      ctx.fillStyle = (u.team === this.side ? this.colors.ally : this.colors.enemy).css
      ctx.beginPath()
      ctx.arc(u.x * k, u.y * k, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    const own = this._own(units)
    if (own) {
      const px = own.x * k
      const py = own.y * k
      const a = own.hull
      ctx.fillStyle = '#f2a50c'
      ctx.beginPath()
      ctx.moveTo(px + Math.cos(a) * 7, py + Math.sin(a) * 7)
      ctx.lineTo(px + Math.cos(a + 2.5) * 5, py + Math.sin(a + 2.5) * 5)
      ctx.lineTo(px + Math.cos(a - 2.5) * 5, py + Math.sin(a - 2.5) * 5)
      ctx.closePath()
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1)
  }

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
    g.poly(rectPoly(0, -21, 32, 5)).fill(c.dark)
    g.poly(rectPoly(0, 21, 32, 5)).fill(c.dark)
    const hullPoly = rectPoly(0, 0, 30, 16)
    g.poly(hullPoly).fill(c.body)
    if (c.outline) g.poly(hullPoly).stroke({ width: 2.5, color: c.outline })
    else g.poly(hullPoly).stroke({ width: 2, color: 0x000000, alpha: 0.35 })
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

  // растворяет края текстуры в прозрачность (мягкий радиальный край)
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

  // бетонная стена-укрытие: секции, светлая кромка, тень снизу
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
    g.rect(x, y, ww, edge).fill({ color: 0x878d94, alpha: 0.8 })
    g.rect(x, y + hh - edge, ww, edge).fill({ color: 0x2c3036, alpha: 0.7 })
    g.rect(x, y, ww, hh).stroke({ width: 3, color: 0x2c3036 })
  }

  _drawTerrain() {
    const g = this.terrain
    g.clear()
    this.bushSprites = [] // кусты для динамической прозрачности при заезде
    for (const o of this.obstacles) {
      if (o.kind === 'water') {
        const sprited = this._terrainPatch('water', o.x, o.y, o.r)
        if (!sprited) g.circle(o.x, o.y, o.r).fill({ color: 0x1d4a66, alpha: 0.9 })
        g.circle(o.x, o.y, o.r).stroke({ width: 3, color: 0x2e6e8e })
      } else if (o.kind === 'hill') {
        if (!this._terrainSprite('hill', o.x, o.y, o.r)) {
          g.circle(o.x, o.y, o.r).fill(0x47502f)
          g.circle(o.x, o.y, o.r).stroke({ width: 3, color: 0x2f3520 })
        }
      } else {
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
    for (const b of this.bases) {
      const col = (b.team === this.side ? this.colors.ally : this.colors.enemy).hp
      g.circle(b.x, b.y, b.r).fill({ color: col, alpha: 0.08 })
      g.circle(b.x, b.y, b.r).stroke({ width: 4, color: col, alpha: 0.4 })
      g.circle(b.x, b.y, 14).fill(col)
    }
  }

  // --- состояние для HUD (форма как у локального Game) ---

  // итоговая таблица: все бойцы обеих команд по урону (из match-end сервера)
  _scoreboard() {
    if (!this.finalStats) return null
    return this.finalStats
      .map((u) => ({ name: u.name, ally: u.team === this.side, damage: u.damage || 0, kills: u.kills || 0, you: u.id === this.youUnit }))
      .sort((a, b) => b.damage - a.damage)
  }

  _emitState() {
    const you = this.you || {}
    const units = this.cur ? this.cur.units : []
    const ownUnit = units.find((u) => u.id === this.youUnit)
    const shots = you.shots || 0
    const reload01 = you.reload01 ?? 1
    this.onState({
      kills: you.kills || 0,
      lightKills: this.lightKills,
      blocked: 0, // брони в PvP пока нет
      deaths: this.deaths,
      shots,
      hits: you.hits || 0,
      accuracy: shots ? Math.round(((you.hits || 0) / shots) * 100) : 0,
      playerHp: Math.max(0, you.hp ?? (ownUnit ? ownUnit.hp : this.cls.hp)),
      playerMaxHp: ownUnit ? ownUnit.maxHp : this.cls.hp,
      allyScore: this.cur ? this.cur.score[this.side] : 0,
      enemyScore: this.cur ? this.cur.score[1 - this.side] : 0,
      alliesAlive: this.cur && this.cur.alive ? this.cur.alive[this.side] : 7,
      enemiesAlive: this.cur && this.cur.alive ? this.cur.alive[1 - this.side] : 7,
      reload01,
      ready: !!you.ready,
      reloadLeft: you.ready ? 0 : Math.ceil((1 - reload01) * this.cls.reload * 10) / 10,
      ourBase: 0,
      enemyBase: 0,
      caps: (this.cur ? this.cur.caps : []).map((c) => ({
        id: c.id,
        own: c.owner === null ? null : c.owner === this.side ? 'ally' : 'enemy',
        cap: c.capper === null ? null : c.capper === this.side ? 'ally' : 'enemy',
        p: c.p,
      })),
      classId: this.cls.id,
      damageDealt: you.damageDealt || 0,
      spotted: you.spotted || 0, // засветов за бой (боевой рейтинг)
      damageLog: [...this.damageLog.values()].sort((a, b) => b.dmg - a.dmg),
      scoreboard: this._scoreboard(),
      matchTime: this.cur ? this.cur.matchTime : 0,
      matchOver: this.matchOver,
      result: this.result,
      scoreLimit: SCORE_LIMIT,
      mode: this.cur ? this.cur.mode || this.mode : this.mode, // сервер авторитетен по режиму
      teamRed: this.side === 1,
      mapName: this.map.name,
      crippled: you.crippled || { gun: 0, turret: 0, engine: 0, tracks: 0, radio: 0 },
    })
  }

  destroy() {
    clearInterval(this._inputTimer)
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    if (this.client) {
      this.client.onMessage = null
      this.client.onSocketClose = null // сами закрываем — это не «сервер пропал»
      this.client.close()
    }
    this.app.destroy(true, { children: true })
  }
}
