import { Application, Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js'
import { TANK_CLASSES, DEFAULT_CLASS, MAP_SIZE, SCORE_LIMIT, REVERSE_MULT, classToRadians } from './config.js'
import { MAP_BY_ID, MAPS } from './maps.js'
import { SKIN_BY_ID } from './meta.js'
import { applyCamo } from './camo.js'
import { t as tr } from '../i18n.js' // alias: `t` уже занят под юнит-переменные в этом файле

// камуфляж с узором (для скинов-оттенков и неизвестных id — null)
const camoOf = (skinId) => (skinId && SKIN_BY_ID[skinId] ? SKIN_BY_ID[skinId].camo || null : null)

// уступить поток событий: тяжёлую обработку текстур на старте боя дробим, чтобы
// между кусками успевал отработать приём WS-снапшотов (иначе на iOS Telegram
// WebView единый синхронный спайк забивал поток и боевой сокет умирал)
const frameYield = () => new Promise((r) => setTimeout(r, 0))

const TANK_RADIUS = 22 // как на сервере (для клиентского предикта коллизий)

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
    this.playerSkin = null // id узорного камуфляжа своей машины (легаси)
    this.playerCamo = null // per-tank камуфляж своей машины (перекрашенный спрайт /sprites/camo/<tank>_<camo>.png)
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
    this.blockedShells = 0 // снарядов отражено моей бронёй (рикошет/непробитие) — задача дня «заблокируй N»
    this.damageLog = new Map()

    // ввод
    this.joystick = { x: 0, y: 0, active: false }
    this.keys = { fwd: false, back: false, left: false, right: false }
    this.paused = false
    // схема заднего хода (Battle.vue ставит из profile.reverseSteer): true — инвертируем
    // руль на реверсе, корма идёт по джойстику; false — без инверсии (старое управление)
    this.invertReverseSteer = true
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
    this.onSaved = () => {} // дефолт-нооп; Battle.vue вешает тост «РИКОШЕТ/БРОНЯ НЕ ПРОБИТА» (отскок от меня)
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

  // легаси-нооп: статы/спрайты ботов под тир игрока теперь набирает сервер
  // (sim.js anchorTier). Оставлен для совместимости API (вызовов больше нет).
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
      // t-дедуп: один и тот же снапшот может прийти и push'ем (client.onMessage),
      // и из очереди (слив в _update) — обрабатываем строго по разу, по серверному
      // времени t. Иначе двойная обработка раздувала бы _snapBuf/события.
      if (msg.t != null && this._lastProcT != null && msg.t <= this._lastProcT) return
      this._lastProcT = msg.t
      this.prev = this.cur
      this.cur = msg
      this.recvAt = performance.now()
      if (this._reconnectTries) this._reconnectTries = 0 // поток здоров — следующий затык получит свежие 3 попытки
      if (msg.you) this.you = msg.you
      this._units = new Map(msg.units.map((u) => [u.id, u]))
      // буфер позиций для интерполяции по СЕРВЕРНОМУ времени: рендерим мир чуть в
      // прошлом и плавно лерпим между снапшотами — движение гладкое даже когда
      // кадры проседают/сеть джиттерит (на iOS половина снапшотов терялась → дёрг)
      if (!this._snapBuf) this._snapBuf = []
      this._snapBuf.push({ t: msg.t || 0, units: new Map(msg.units.map((u) => [u.id, { x: u.x, y: u.y, hull: u.hull }])) })
      if (this._snapBuf.length > 16) this._snapBuf.shift()
      for (const u of msg.units) this._wantTex(u.tankId, u.skin, u.id === this.youUnit ? this.playerCamo : u.camo)
      for (const ev of msg.events || []) this._onEvent(ev)
      if (msg.matchOver && !this.matchOver) this._finish(msg.winner)
      // позиции танков интерполируются из this.cur каждый КАДР (плавно), а
      // _emitState — это апдейт Vue-HUD (счёт/HP/перезарядка): его душим до ~12Гц,
      // чтобы 20Гц снапшотов не грузили реактивность вдвое и не роняли fps на iOS
      const now = performance.now()
      if (now - (this._lastEmit || 0) > 80 || msg.matchOver) {
        this._lastEmit = now
        this._emitState()
      }
    } else if (msg.type === 'match-end') {
      this.finalStats = msg.stats || null
      this.endReason = msg.reason || null
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
      // выстрел ПО мне: ПОПАДАНИЕ ведём в МОЮ предсказанную позицию (чтобы пришло
      // туда, где я себя вижу). ПРОМАХ — оставляем серверный увод в сторону (театр
      // промахов: вижу, как снаряд просвистел мимо, а не «прилетело из ниоткуда»).
      let ex = ev.x2
      let ey = ev.y2
      if (ev.hit && ev.target === this.youUnit && this._pred) {
        ex = this._pred.x
        ey = this._pred.y
      }
      // кто и откуда меня бьёт — для экрана смерти (последнее попадание по мне)
      if (ev.hit && ev.target === this.youUnit) {
        const sh = this._units.get(ev.unit)
        this._lastHitBy = { name: sh ? sh.name : tr('game.enemy'), cls: sh ? sh.cls : null, x: ev.x1, y: ev.y1 }
        // индикатор направления урона в HUD: угол на стрелявшего относительно
        // корпуса (0 = спереди). Камера повёрнута с танком → угол сразу экранный.
        const own = this._units.get(this.youUnit)
        if (own && this.onHurt) {
          let d = Math.atan2(ev.y1 - own.y, ev.x1 - own.x) - (own.hull || 0)
          while (d > Math.PI) d -= 2 * Math.PI
          while (d < -Math.PI) d += 2 * Math.PI
          this.onHurt(d)
        }
      }
      const a = Math.atan2(ey - ev.y1, ex - ev.x1)
      this.muzzles.push({ x: ev.x1 + Math.cos(a) * 40, y: ev.y1 + Math.sin(a) * 40, a, age: 0, color: col })
      this.shells.push({
        x1: ev.x1,
        y1: ev.y1,
        x2: ex,
        y2: ey,
        t: 0,
        dur: Math.max(0.08, Math.hypot(ex - ev.x1, ey - ev.y1) / 1400),
        color: col,
        boom: ev.killed ? 'big' : ev.hit ? 'hit' : 'dust',
        ricochet: ev.outcome === 'ricochet', // срикошетит: искра + полетит дальше под углом
      })
      if (mine) {
        // outcome брони: 'ricochet'/'nopen' → свой фидбек, иначе hit/miss
        this.onShot({ type: ev.outcome || (ev.hit ? 'hit' : 'miss'), reason: 'line' })
        if (ev.hit && ev.target && ev.dmg) {
          const t = this._units.get(ev.target)
          const entry = this.damageLog.get(ev.target) || { name: t ? t.name : '—', tankId: t ? t.tankId : null, dmg: 0, killed: false }
          entry.dmg += ev.dmg
          entry.killed = entry.killed || !!ev.killed
          this.damageLog.set(ev.target, entry)
        }
      } else if (ev.outcome && ev.target === this.youUnit) {
        // вражеский снаряд отскочил от МОЕЙ брони → «РИКОШЕТ ОТ БРОНИ»/«БРОНЯ НЕ ПРОБИТА»
        this.onSaved(ev.outcome)
        this.blockedShells++ // считаем КАЖДЫЙ отражённый снаряд → задача дня «заблокируй N бронёй»
      }
    } else if (ev.type === 'hp') {
      this.flash.set(ev.unit, 0.25)
      if (mine) this.hurtFlash = 0.25
    } else if (ev.type === 'crit') {
      if (mine) this.onCrit(ev.slot)
    } else if (ev.type === 'kill') {
      if (ev.victim === this.youUnit) {
        this.deaths = 1
        // экран смерти: кем и с какой стороны (по последнему попаданию по мне)
        const own = this._units.get(this.youUnit)
        const killer = this._units.get(ev.killer)
        const src = this._lastHitBy
        let dir = null
        if (own && src) {
          let d = Math.atan2(src.y - own.y, src.x - own.x) - own.hull
          while (d > Math.PI) d -= 2 * Math.PI
          while (d < -Math.PI) d += 2 * Math.PI
          const ad = Math.abs(d)
          // ключ направления (front/rear/right/left) — слово подставит Battle.vue по локали
          dir = ad < Math.PI / 4 ? 'front' : ad > (3 * Math.PI) / 4 ? 'rear' : d > 0 ? 'right' : 'left'
        }
        this._deathInfo = { by: (killer && killer.name) || (src && src.name) || tr('game.enemy'), cls: (killer && killer.cls) || (src && src.cls) || null, dir }
      }
      if (ev.killer === this.youUnit) {
        const v = this._units.get(ev.victim)
        if (v && v.cls === 'light') this.lightKills++
        this.onKill(v ? v.name : tr('game.enemy'))
      }
    }
  }

  // текущий ввод игрока (джойстик/клавиши) — общий для отправки и предикта
  _computeInput() {
    if (this.paused) return { throttle: 0, steer: 0 }
    let throttle, steer
    const j = this.joystick
    if (j.active) {
      steer = Math.abs(j.x) < 0.12 ? 0 : j.x
      const fwd = -j.y
      throttle = Math.abs(fwd) < 0.12 ? 0 : Math.max(-1, Math.min(1, fwd))
    } else {
      const k = this.keys
      throttle = (k.fwd ? 1 : 0) - (k.back ? 1 : 0)
      steer = (k.right ? 1 : 0) - (k.left ? 1 : 0)
    }
    // ЗАДНИЙ ХОД: инвертируем руль. Танк едет кормой вперёд, поэтому при том же повороте
    // корпуса корма уходит в противоположную от пальца сторону — игрок жмёт «назад-влево»,
    // а едет назад-вправо. Меняем знак стира на реверсе → разворачивается по интуиции.
    // Делаем В ИСТОЧНИКЕ ввода (а не в физике): и предикт (_predict), и отправка на сервер
    // (_sendInput) зовут _computeInput → оба получают исправленный steer, физика NetGame и
    // shared/sim.js остаётся ОДНОЙ формулой, рассинхрона предикта с сервером нет.
    // Под флагом: часть игроков привыкла к старому управлению (profile.reverseSteer='direct').
    if (throttle < 0 && this.invertReverseSteer) steer = -steer
    return { throttle, steer }
  }

  // коллизия предсказанного своего танка с препятствиями/стенами/границами —
  // ТОЧНАЯ копия серверного _collide (кусты не блокируют), чтобы предикт НЕ
  // расходился с сервером у стен (иначе «я не там, где меня бьют»).
  _collidePred(p, radius) {
    for (const o of this.obstacles) {
      if (o.kind === 'bush') continue
      const dx = p.x - o.x
      const dy = p.y - o.y
      const d = Math.hypot(dx, dy)
      const min = o.r + radius
      if (d < min && d > 0.0001) {
        p.x = o.x + (dx / d) * min
        p.y = o.y + (dy / d) * min
      }
    }
    for (const w of this.walls) {
      const minx = w.cx - w.hw
      const maxx = w.cx + w.hw
      const miny = w.cy - w.hh
      const maxy = w.cy + w.hh
      const nx = Math.max(minx, Math.min(p.x, maxx))
      const ny = Math.max(miny, Math.min(p.y, maxy))
      const dx = p.x - nx
      const dy = p.y - ny
      const d = Math.hypot(dx, dy)
      if (d > 0.0001 && d < radius) {
        p.x = nx + (dx / d) * radius
        p.y = ny + (dy / d) * radius
      } else if (d <= 0.0001) {
        const left = p.x - minx
        const right = maxx - p.x
        const top = p.y - miny
        const bottom = maxy - p.y
        const m = Math.min(left, right, top, bottom)
        if (m === left) p.x = minx - radius
        else if (m === right) p.x = maxx + radius
        else if (m === top) p.y = miny - radius
        else p.y = maxy + radius
      }
    }
    const m = 60
    p.x = Math.max(m, Math.min(this.mapSize - m, p.x))
    p.y = Math.max(m, Math.min(this.mapSize - m, p.y))
  }

  // КЛИЕНТСКИЙ ПРЕДИКТ своего танка «по-взрослому»: интегрируем текущий ввод
  // локально каждый кадр ТОЙ ЖЕ физикой, что сервер (_stepHuman + _collide) →
  // руль/камера мгновенны, движение гладкое (не зависит от рваной доставки и
  // пинга). Сервер авторитетен: мягко корректируем дрейф (corr мал, без резинки),
  // снап при большом расхождении (расталкивание танков/респаун). Коллизия стен
  // ВОСПРОИЗВЕДЕНА → у стен предикт совпадает с сервером, бой честный.
  _predictOwn(dt) {
    const srv = this._units && this.youUnit != null ? this._units.get(this.youUnit) : null
    if (!srv || !srv.alive) {
      this._pred = null
      return
    }
    if (!this._pred || Math.hypot(this._pred.x - srv.x, this._pred.y - srv.y) > 100) {
      this._pred = { x: srv.x, y: srv.y, hull: srv.hull, speed: srv.speed || 0 } // старт/снап
      return
    }
    const corr = 0.04 // мягкая коррекция дрейфа к серверу (без рывков)
    this._pred.x += (srv.x - this._pred.x) * corr
    this._pred.y += (srv.y - this._pred.y) * corr
    let dh = (srv.hull - this._pred.hull) % (Math.PI * 2)
    if (dh > Math.PI) dh -= Math.PI * 2
    if (dh < -Math.PI) dh += Math.PI * 2
    this._pred.hull += dh * corr
    let { throttle, steer } = this._computeInput()
    const cr = this.you && this.you.crippled
    if (cr && cr.tracks > 0) steer = 0
    if (cr && cr.engine > 0) throttle = 0
    const cls = this.cls
    this._pred.hull += steer * cls.turnRate * dt
    const target = cls.maxSpeed * (throttle >= 0 ? throttle : throttle * REVERSE_MULT)
    const da = cls.accel * dt
    if (this._pred.speed < target) this._pred.speed = Math.min(target, this._pred.speed + da)
    else this._pred.speed = Math.max(target, this._pred.speed - da * 1.4)
    this._pred.x += Math.cos(this._pred.hull) * this._pred.speed * dt
    this._pred.y += Math.sin(this._pred.hull) * this._pred.speed * dt
    this._collidePred(this._pred, TANK_RADIUS)
  }

  // отправка ввода серверу: при заметном изменении либо раз в 300мс
  _sendInput() {
    if (!this.client || this.matchOver) return
    const { throttle, steer } = this._computeInput()
    const s = this._lastSent
    const now = performance.now()
    if (Math.abs(steer - s.steer) > 0.04 || Math.abs(throttle - s.throttle) > 0.04 || now - s.at > 300) {
      this._lastSent = { steer, throttle, at: now }
      this.client.send({ type: 'input', throttle, steer })
    }
  }


  // --- pixi ---

  async mount(container) {
    // antialias ВКЛ везде: резолюция капнута на 2×, а телефоны 2–3× → даунскейла,
    // который сгладил бы сам, НЕТ (на 3× вообще апскейл = мыло). Без MSAA на мобиле
    // края «лесенкой». Гладкая картинка важнее, прицел/мир уже плавные по _renderT.
    const _dpr = window.devicePixelRatio || 1
    await this.app.init({
      resizeTo: container,
      background: 0x0e1116,
      antialias: true,
      powerPreference: 'high-performance',
      // на retina-iPhone devicePixelRatio=3 → ×9 пикселей, fps проседает и
      // движение дёргается. Кап до 2 почти вдвое снижает работу GPU (на телефоне
      // 2× и 3× визуально неотличимы), кадры ровнее → плавнее.
      resolution: Math.min(2, _dpr),
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
    // хромакей баз танков — ПО ОДНОЙ с уступкой потоку: единый синхронный кусок
    // на старте боя блокировал главный поток (и приём снапшотов) → на iOS сокет
    // умирал. Дробление даёт WS-сообщениям проскочить между текстурами.
    for (const k of Object.keys(this.tex)) {
      if (k.startsWith('tank_')) {
        this.tex[k] = this._chromaKey(this.tex[k])
        await frameYield()
      }
    }
    // кусты/камни/горы — AI-спрайты с вырезанным фоном (прозрачная альфа)
    if (this.playerTankId) this._wantTex(this.playerTankId, this.playerSkin, this.playerCamo)
    // снапшоты, пришедшие ДО mount (гонка матчмейкинг→бой), просили текстуры,
    // когда this.tex ещё не было → их пропустили. Теперь tex готов — печём
    // реальные машины ВСЕХ уже видимых юнитов (свои/тиммейты/засвеченные враги),
    // иначе тиммейт ждал бы СЛЕДУЮЩЕГО снапшота и до него рисовался фолбэком.
    if (this.cur) for (const u of this.cur.units) this._wantTex(u.tankId, u.skin, u.id === this.youUnit ? this.playerCamo : u.camo)

    this.world = new Container()
    this.bg = new Graphics()
    this.terrain = new Graphics()
    this.gfx = new Graphics()
    this.markGfx = new Graphics() // командные «пятаки» свой/чужой ПОД танками
    this.terrLayer = new Container()
    this.tankLayer = new Container()
    this.fxLayer = new Container()
    if (this.tex.ground) {
      const th = this.map.theme || {}
      this.groundTile = new TilingSprite({ texture: this.tex.ground, width: this.mapSize, height: this.mapSize })
      this.groundTile.tileScale.set(th.groundScale || 0.55)
      this.groundTile.tint = th.ground || this.map.tint || 0xffffff
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
    this.ownGfx = new Graphics() // HUD у своего танка: HP-полоска, рамка «ты», иконка видимости
    this.labels.addChildAt(this.ownGfx, 0) // под ник-плашками
    this.unitLabels = new Map()
    this.hpLabels = new Map() // число HP под ником у каждого танка (свой — current/max)

    // снапшоты, накопившиеся в очереди ПОКА грузился mount, сбрасываем: мир уже
    // показан (lastState в конструкторе), а слив пачки тут выстрелил бы кучей
    // старых событий (взрывы) разом. Тикер дальше сливает только свежие.
    if (this.client && this.client.stateQueue) this.client.stateQueue.length = 0

    this._bindKeyboard()
    this._inputTimer = setInterval(() => this._sendInput(), 50) // 20Гц: сервер ближе к предикту, меньше коррекций
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

  // ключ текстуры машины: per-tank камуфляж (перекрашенный спрайт) > узорный
  // камуфляж (запечённый) > заводская
  _tankTexKey(tankId, skinId, camoId) {
    if (camoId) return `unit_${tankId}~${camoId}`
    return camoOf(skinId) ? `unit_${tankId}:${skinId}` : `unit_${tankId}`
  }

  // ленивые текстуры реальных машин игроков (+вариант с узором камуфляжа / перекраской)
  _wantTex(tankId, skinId = null, camoId = null) {
    if (!tankId) return
    // this.tex появляется только в mount(); если снапшот пришёл РАНЬШЕ (гонка
    // матчмейкинг→бой: NetGame создаётся, _onMessage(lastState) бежит в
    // конструкторе ДО mount), печь некуда — НЕ помечаем ключ загруженным, иначе
    // повторный вызов после mount уйдёт в short-circuit и текстура тиммейта
    // (его реальная машина) НИКОГДА не запечётся → он рисуется фолбэк-спрайтом
    // класса. Свой танк спасал отдельный _wantTex в mount с другим ключом —
    // тиммейту такого спасения нет. Пускаем печь только когда tex готов.
    if (!this.tex) return
    const key = this._tankTexKey(tankId, skinId, camoId)
    if (this._wantedTex.has(key)) return
    this._wantedTex.add(key)
    if (camoId) {
      // перекрашенный спрайт камуфляжа (узор уже впечён) — грузим как есть, на той же
      // магенте → тот же chroma-key. Нет файла для этого танка+камо → откат к заводскому
      // под ТЕМ ЖЕ ключом, чтобы танк всё равно отрисовался (а не остался фолбэком класса).
      Assets.load(`/sprites/camo/${tankId}_${camoId}.png`)
        .then((t) => { if (this.tex) this.tex[key] = this._chromaKey(t) })
        .catch(() =>
          Assets.load(`/sprites/tanks/${tankId}.png`)
            .then((t) => { if (this.tex) this.tex[key] = this._chromaKey(t) })
            .catch(() => {}),
        )
      return
    }
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

  // позиции по часам интерполяции (this._renderT): берём два снапшота из буфера,
  // что обрамляют renderT, и лерпим между ними. Гладко при дропах кадров и
  // джиттере сети (рендерим чуть в прошлом, всегда есть «следующий» снапшот).
  _lerpUnits() {
    if (!this.cur) return []
    const lerpA = (p, q, t) => {
      let d = (q - p) % (Math.PI * 2)
      if (d > Math.PI) d -= Math.PI * 2
      if (d < -Math.PI) d += Math.PI * 2
      return p + d * t
    }
    const buf = this._snapBuf
    const rt = this._renderT
    const haveBuf = buf && buf.length >= 2 && rt != null
    let a, b, f
    if (haveBuf) {
      a = buf[0]
      b = buf[buf.length - 1]
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].t <= rt) a = buf[i]
        if (buf[i].t >= rt) { b = buf[i]; break }
      }
      const span = b.t - a.t
      f = span > 1e-6 ? Math.max(0, Math.min(1, (rt - a.t) / span)) : 0
    }
    return this.cur.units.map((u) => {
      // свой танк — из клиентского предикта (мгновенно по вводу)
      if (u.id === this.youUnit && this._pred && u.alive) {
        return { ...u, x: this._pred.x, y: this._pred.y, hull: this._pred.hull }
      }
      if (!haveBuf || !u.alive) return u // мало данных/обломок — последняя позиция
      const pa = a.units.get(u.id)
      const pb = b.units.get(u.id)
      if (!pa || !pb) return u
      return { ...u, x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, hull: lerpA(pa.hull, pb.hull, f) }
    })
  }

  _own(units) {
    return units.find((u) => u.id === this.youUnit) || null
  }

  // разброс прицела от скорости: стоя сектор сжат до 55%, на ходу — до 100%
  // (та же формула, что на сервере; скорость берём из предсказанного своего танка
  // → конус «дышит» мгновенно при разгоне/торможении). Совпадает с серверным
  // выстрелом, т.к. амплитуда у обоих почти равна (предикт держит скорость близко).
  _sectorHalfEff() {
    const v = this._pred ? Math.abs(this._pred.speed || 0) : 0
    const k = Math.min(1, v / (this.cls.maxSpeed || 1))
    return this.cls.sectorHalf * (0.55 + 0.45 * k)
  }

  // линия сведения. ВРЕМЯ берём из ПЛАВНЫХ интерп-часов _renderT (по ним же едет
  // весь мир), а не из дискретного this.cur.t — иначе маяк прицела «скачет» по
  // снапшотам, пока танки едут гладко (рассинхрон → дёрганый прицел).
  _sweepOffset() {
    if (this.you && this.you.crippled && this.you.crippled.turret > 0) {
      return this.sweepFrozen ?? 0
    }
    const t = this._renderT != null ? this._renderT : this.cur ? this.cur.t : 0
    const p = (((t % this.cls.sweepPeriod) + this.cls.sweepPeriod) % this.cls.sweepPeriod) / this.cls.sweepPeriod
    const tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p
    this.sweepFrozen = this._sectorHalfEff() * tri
    return this.sweepFrozen
  }

  // --- прицельный ассист: геометрия (зеркало shared/geometry, чтобы не тащить
  // shared в клиентский бандл — как и дублированный config.js) ---
  _angDiff(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b))
  }
  // линия взгляда заблокирована стеной/камнем? (вода и кусты не блокируют — мягкое
  // укрытие, как на сервере). Совпадает с BattleSim._lineBlocked.
  _losBlocked(x1, y1, x2, y2) {
    for (const o of this.obstacles) {
      if (o.kind === 'water' || o.kind === 'bush') continue
      if (this._segCircle(x1, y1, x2, y2, o.x, o.y, o.r)) return true
    }
    for (const w of this.walls) {
      if (this._segRect(x1, y1, x2, y2, w.cx - w.hw, w.cy - w.hh, w.cx + w.hw, w.cy + w.hh)) return true
    }
    return false
  }
  _segCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1
    const dy = y2 - y1
    const l2 = dx * dx + dy * dy
    let t = l2 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    const px = x1 + t * dx
    const py = y1 + t * dy
    return Math.hypot(px - cx, py - cy) <= r
  }
  _segRect(x1, y1, x2, y2, minx, miny, maxx, maxy) {
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
  // рамка-«захват»: четыре уголка вокруг цели (в мировых координатах — крутится
  // с сектором/линией, как и остальная прицельная разметка)
  _drawTargetBracket(g, x, y, r, color, alpha) {
    const arm = r * 0.42
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = x + sx * r
        const cy = y + sy * r
        g.moveTo(cx, cy).lineTo(cx - sx * arm, cy).stroke({ width: 2.5, color, alpha, cap: 'round' })
        g.moveTo(cx, cy).lineTo(cx, cy - sy * arm).stroke({ width: 2.5, color, alpha, cap: 'round' })
      }
    }
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
    // СЛИВАЕМ всю очередь принятых снапшотов (net.js пишет КАЖДЫЙ state в
    // client.stateQueue). Раньше тянули только последний lastState — на мобиле
    // снапшоты приходят бурстами (несколько за кадр), и промежуточные терялись →
    // дыры в буфере интерполяции → дёрг. Теперь обрабатываем ВСЕ по порядку
    // (push на iOS не доходит — pull-очередь гарантия). t-дедуп в _onMessage
    // снимает двойную обработку, если push всё же сработал.
    const c = this.client
    if (c && !this.matchOver) {
      if (c.stateQueue && c.stateQueue.length) {
        for (const m of c.stateQueue) this._onMessage(m)
        c.stateQueue.length = 0
      }
      if (c.lastEnd) this._onMessage(c.lastEnd) // конец боя тоже тянем (push мог не дойти)
    }

    // часы интерполяции: рендерим мир с задержкой ~1.5 снапшота в СЕРВЕРНОМ
    // времени и двигаем их реальным dt — позиции плавно лерпятся между
    // снапшотами независимо от того, сколько кадров отрисовал телефон.
    const buf = this._snapBuf
    if (buf && buf.length) {
      const latest = buf[buf.length - 1].t
      // задержка рендера ЧУЖИХ танков: свой теперь предсказан (мгновенный), поэтому
      // тут можно дать запас под рваную доставку (замер прода: p95 разрыв ~54мс) —
      // чужие будут гладкими даже при бурстах. ~2 тика (33мс@60Гц) + очередь без дыр.
      const delay = this.tickDt * 2
      if (this._renderT == null || this._renderT > latest || this._renderT < latest - this.tickDt * 8) {
        this._renderT = latest - delay // (ре)синхрон: старт / после столла / убегание
      } else {
        this._renderT += dt
        const hi = latest - this.tickDt * 0.5 // оставляем «впереди» снапшот для лерпа
        if (this._renderT > hi) this._renderT = hi
      }
    }

    // СВОЙ танк — клиентский предикт (мгновенный руль/камера, гладко, независимо
    // от пинга и рваной доставки). Коллизия стен воспроизведена → совпадает с
    // сервером, а трассеры по мне пере-наводятся на предикт (см. _onEvent) — бой честный.
    this._predictOwn(dt)

    // снапшоты сервера могли встать (реально мёртвый сокет/сеть) — тогда
    // _tryRecover пробует вернуться в тот же бой новым сокетом; показываем
    // «восстанавливаем связь». В офлайн уходим, лишь когда возврат исчерпан.
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
    const ricoTails = []
    for (const s of this.shells) {
      s.t += dt
      if (s.t >= s.dur) {
        if (s.ricochet) {
          // РИКОШЕТ: искра в точке отскока + снаряд УЛЕТАЕТ ДАЛЬШЕ под углом
          this._spawnFx(s.x2, s.y2, 0.5)
          const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) // входящее направление
          const defl = a + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5) // увод ±25–50°
          const len = 220 + Math.random() * 200
          ricoTails.push({ x1: s.x2, y1: s.y2, x2: s.x2 + Math.cos(defl) * len, y2: s.y2 + Math.sin(defl) * len, t: 0, dur: Math.max(0.06, len / 1700), color: s.color, boom: 'dust' })
        } else {
          this.booms.push({ x: s.x2, y: s.y2, age: 0, big: s.boom === 'big', dust: s.boom === 'dust' })
          if (s.boom === 'hit') this._spawnFx(s.x2, s.y2, 0.7)
          if (s.boom === 'big') this._spawnFx(s.x2, s.y2, 1.7)
        }
      }
    }
    this.shells = this.shells.filter((s) => s.t < s.dur)
    if (ricoTails.length) this.shells.push(...ricoTails) // срикошетившие «хвосты» — отдельными трассерами
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

    // дальности тумана/обзора нужны и прицельному ассисту, и скрытию врага ниже
    const PROX = 150
    // крит рации режет обзор (как сервер RADIO_CRIT_MULT=0.5): кольцо/туман сжимаются — игрок ЧУВСТВУЕТ потерю рации
    const radioMul = this.you && this.you.crippled && this.you.crippled.radio > 0 ? 0.5 : 1
    const vis = this.cls.vision * radioMul
    // сектор и линия сведения у живого своего танка
    const aliveSelf = own && own.alive
    this._aimLock = false // «захват» цели (зелёная линия) пересчитывается каждый кадр
    if (aliveSelf) {
      const half = this._sectorHalfEff() // разброс дышит со скоростью (стоя уже, на ходу шире)
      const L = vis // длина прицела = дальность обнаружения (совпадает с туманом, с учётом крита рации)
      // КОЛЬЦО ОБЗОРА — полный радиус личного засвета (где я вижу/могу быть полезен,
      // совпадает с туманом). РАСКРЫТ выстрелом → кольцо краснеет: ты демаскирован.
      const litSelf = !!(this.you && this.you.firedReveal)
      g.circle(ox, oy, L).stroke({ width: litSelf ? 2.5 : 1.5, color: litSelf ? 0xff4b33 : 0xf2a50c, alpha: litSelf ? 0.5 : 0.14 })
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

      // АССИСТ ПРИЦЕЛИВАНИЯ: ищем ближайшую валидную цель в секторе — в дальности
      // орудия, не в тумане, без стены/камня на линии (та же проверка, что у
      // серверного выстрела). Рисуем на ней рамку-«захват». Когда ствол заряжен И
      // линия сведения легла на цель — линия, наконечник и рамка ЗЕЛЕНЕЮТ: явный
      // сигнал «жми ОГОНЬ». Это читаемый момент выстрела — лечит 44% первых мимо
      // без авто-аима (тайминг остаётся за игроком, окно просто видно).
      let target = null
      let targetD = Infinity
      for (const u of units) {
        if (!u.alive || u.team === this.side) continue
        const dx = u.x - ox
        const dy = u.y - oy
        const d = Math.hypot(dx, dy)
        if (d > this.cls.range) continue // вне дальности орудия
        if (d > PROX && d > vis) continue // в тумане — не наводимся
        const ang = Math.atan2(dy, dx)
        if (Math.abs(this._angDiff(ang, ohull)) > half) continue // вне сектора
        if (this._losBlocked(ox, oy, u.x, u.y)) continue // стена/камень на линии
        if (d < targetD) {
          targetD = d
          target = { x: u.x, y: u.y, ang }
        }
      }
      const onLine = !!target && Math.abs(this._angDiff(target.ang, lineA)) <= this.cls.tolerance
      const locked = ready && onLine
      this._aimLock = locked // в HUD: подсветка кнопки ОГОНЬ

      const col = locked ? 0x46e08a : ready ? 0xffe066 : 0x9aa0ad // зелёный — «захват»
      g.moveTo(ox, oy).lineTo(ex, ey).stroke({ width: 9, color: col, alpha: ready ? 0.16 : 0.08, cap: 'round' })
      g.moveTo(ox, oy).lineTo(ex, ey).stroke({ width: 4, color: col, alpha: ready ? 1 : 0.5, cap: 'round' })
      const tick = ready ? 15 : 10
      const px = -Math.sin(lineA)
      const py = Math.cos(lineA)
      g.moveTo(ex - px * tick, ey - py * tick)
        .lineTo(ex + px * tick, ey + py * tick)
        .stroke({ width: ready ? 4 : 3, color: col, alpha: ready ? 1 : 0.5, cap: 'round' })

      // рамка-«захват» вокруг наведённой цели: нейтральная при наводке, зелёная
      // в момент захвата (ствол готов + линия на цели)
      if (target) {
        this._drawTargetBracket(g, target.x, target.y, 26, locked ? 0x46e08a : 0xffe066, locked ? 1 : 0.55)
      }
    }

    // личный туман войны: живой враг, засвеченный сервером (командой), но вне
    // ЛИЧНОГО обзора игрока — не рисуется. Мёртв игрок — наблюдение, видно всех.
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

      // ХП-полоска над танком (у своего — по здоровью: зелёная→жёлтая→красная)
      const bw = 48
      const hpFr = Math.max(0, u.hp) / (u.maxHp || 1)
      const hpClr = isSelf ? (hpFr > 0.5 ? 0x6fcf4a : hpFr > 0.25 ? 0xf2c20c : 0xff4b33) : pal.hp
      g.rect(u.x - bw / 2 - 1, u.y - 37, bw + 2, 7).fill({ color: 0x000000, alpha: 0.65 })
      g.rect(u.x - bw / 2, u.y - 36, bw * hpFr, 5).fill(hpClr)
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
    this._updateOwnHud(this._own(units))
    // миникарта — полная перерисовка canvas; 60Гц не нужно, душим до ~12Гц (разгрузка кадра на iOS)
    const nowMs = performance.now()
    if (nowMs - (this._lastMini || 0) > 80) {
      this._lastMini = nowMs
      this._drawMinimap(units)
    }
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
    // крит рации сжимает туман (как сервер RADIO_CRIT_MULT) — обзор реально падает
    const radioMul = this.you && this.you.crippled && this.you.crippled.radio > 0 ? 0.5 : 1
    const vision = this.cls.vision * radioMul
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
    const camoId = isSelf ? this.playerCamo : u.camo || null
    const wantKey = u.tankId ? this._tankTexKey(u.tankId, skinId, camoId) : null
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
      // живого врага в тумане не подписываем; ПОДБИТЫЙ танк (обломки) — подписываем
      // полупрозрачным ником, чтобы было видно «кто тут лёг»
      if (u.alive && u.team !== this.side && this._hiddenEnemy && this._hiddenEnemy.has(u.id)) continue
      seen.add(u.id)
      let t = this.unitLabels.get(u.id)
      if (!t) {
        t = this._makeNamePlate(u)
        this.labels.addChild(t)
        this.unitLabels.set(u.id, t)
      }
      t.visible = true
      t.alpha = u.alive ? 1 : 0.42 // мёртвый — приглушённый ник над обломками
      const p = this.world.toGlobal({ x: u.x, y: u.y })
      // свой танк: ник выше (под ним влезает HP-полоска own-HUD)
      const off = u.id === this.youUnit && u.alive ? 66 : u.alive ? 50 : 40
      t.position.set(p.x, p.y - off)
      // ЧИСЛО HP под ником (просили цифры — без них «хрень играть»). Свой —
      // current/max и по здоровью (зелёный→жёлтый→красный); чужой — текущее белым.
      if (u.alive) {
        let h = this.hpLabels.get(u.id)
        if (!h) {
          h = this._makeHpText()
          this.labels.addChild(h)
          this.hpLabels.set(u.id, h)
        }
        const isYou = u.id === this.youUnit
        const hp = Math.max(0, Math.round(u.hp))
        const maxHp = u.maxHp || hp
        h.text = `${hp}/${maxHp}` // current/max у всех — видно, сколько осталось добить
        const fr = hp / (maxHp || 1)
        const fill = isYou ? (fr > 0.5 ? 0x8ee06a : fr > 0.25 ? 0xffd24a : 0xff6a5a) : 0xeef2f6
        if (h._fill !== fill) {
          h.style.fill = fill
          h._fill = fill
        }
        h.visible = true
        h.position.set(p.x, p.y - off + 15)
      } else {
        const h = this.hpLabels.get(u.id)
        if (h) h.visible = false
      }
    }
    for (const [id, t] of this.unitLabels) {
      if (!seen.has(id)) t.visible = false
    }
    for (const [id, h] of this.hpLabels) {
      if (!seen.has(id)) h.visible = false
    }
  }

  // маленький текст числа HP под ником (экранный слой — всегда прямой, как ники)
  _makeHpText() {
    const t = new Text({
      text: '',
      style: {
        fontFamily: 'Russo One, sans-serif',
        fontSize: 12,
        fill: 0xeef2f6,
        stroke: { color: 0x000000, width: 3 },
        letterSpacing: 0.3,
      },
    })
    t.anchor.set(0.5, 0.5)
    return t
  }

  // own-HUD у своего танка (дизайн Макса): HP-полоска сверху, пунктирная рамка-
  // уголки «ты», иконка видимости снизу (скрыт=глаз перечёркнут / засвечен / раскрыт).
  // Экранные координаты (world scale=1), перерисовка каждый кадр.
  _updateOwnHud(own) {
    const g = this.ownGfx
    if (!g) return
    g.clear()
    if (!own || !own.alive || !this.you) return
    const p = this.world.toGlobal({ x: own.x, y: own.y })
    const hw = 28
    const hh = 46
    const L = p.x - hw
    const R = p.x + hw
    const T = p.y - hh
    const B = p.y + hh
    const cn = 11 // длина уголка рамки
    g.moveTo(L, T + cn).lineTo(L, T).lineTo(L + cn, T)
    g.moveTo(R - cn, T).lineTo(R, T).lineTo(R, T + cn)
    g.moveTo(R, B - cn).lineTo(R, B).lineTo(R - cn, B)
    g.moveTo(L + cn, B).lineTo(L, B).lineTo(L, B - cn)
    g.stroke({ width: 2.5, color: 0xf2d24a, alpha: 0.9 })
    // HP рисуется общим баром над танком (см. _drawUnits) — здесь НЕ дублируем
    // иконка видимости под танком
    const fired = !!this.you.firedReveal
    const seenByFoe = !!this.you.revealed
    const col = fired ? 0xff4b33 : seenByFoe ? 0xf2a50c : 0xffd24a
    const cx = p.x
    const cy = B + 16
    g.roundRect(cx - 15, cy - 12, 30, 24, 7).fill({ color: 0x05070a, alpha: 0.72 })
    g.roundRect(cx - 15, cy - 12, 30, 24, 7).stroke({ width: 1.5, color: col, alpha: 0.9 })
    g.ellipse(cx, cy, 8, 4.6).stroke({ width: 1.6, color: col })
    g.circle(cx, cy, 2.3).fill({ color: col })
    if (!seenByFoe && !fired) g.moveTo(cx - 9, cy + 7).lineTo(cx + 9, cy - 7).stroke({ width: 2, color: col }) // скрыт → перечёркнут
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
    // ЦЕЛЬ «куда ехать» (подсказка): ближайшая НЕ наша точка (нейтрал/враг). Точек
    // нет (на уничтожение) → ближайший засвеченный враг. Помогает новичку.
    const own = this._own(units)
    const caps = this.cur ? this.cur.caps : []
    let target = null
    if (own) {
      let best = Infinity
      if (caps.length) {
        for (const cap of caps) {
          if (cap.owner === this.side) continue // уже наша — не цель
          const pos = this.capPos[cap.id]
          if (!pos) continue
          const d = (pos.x - own.x) ** 2 + (pos.y - own.y) ** 2
          if (d < best) (best = d), (target = { x: pos.x, y: pos.y })
        }
      } else {
        for (const u of units) {
          if (!u.alive || u.team === this.side) continue
          if (this._hiddenEnemy && this._hiddenEnemy.has(u.id)) continue
          const d = (u.x - own.x) ** 2 + (u.y - own.y) ** 2
          if (d < best) (best = d), (target = { x: u.x, y: u.y })
        }
      }
    }
    this.minimapT = (this.minimapT || 0) + 0.5
    const pulse = 0.5 + 0.5 * Math.sin(this.minimapT) // плавная пульсация цели/линии

    // линия-подсказка «куда ехать»: пунктир от своего танка к цели
    if (own && target) {
      ctx.strokeStyle = `rgba(242,165,12,${0.3 + 0.3 * pulse})`
      ctx.lineWidth = 1.6
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(own.x * k, own.y * k)
      ctx.lineTo(target.x * k, target.y * k)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // точки захвата: своя — залита, врага — красная, нейтрал — серое кольцо. Крупнее + буква.
    ctx.font = `bold ${Math.round(S * 0.085)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const cap of caps) {
      const pos = this.capPos[cap.id]
      if (!pos) continue
      const r = Math.max(7, pos.r * k * 0.6)
      const mine = cap.owner === this.side
      const enemy = cap.owner !== null && !mine
      ctx.beginPath()
      ctx.arc(pos.x * k, pos.y * k, r, 0, Math.PI * 2)
      if (mine) (ctx.fillStyle = this.colors.ally.css), ctx.fill()
      else if (enemy) (ctx.fillStyle = this.colors.enemy.css), ctx.fill()
      else {
        ctx.fillStyle = 'rgba(154,163,176,0.25)'
        ctx.fill()
        ctx.strokeStyle = '#9aa3b0'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.fillStyle = mine || enemy ? '#0c0f14' : '#cfd6e0'
      ctx.fillText(cap.id, pos.x * k, pos.y * k)
    }

    // пульсирующее кольцо на ЦЕЛИ (куда ехать) — поверх точек/врага
    if (target) {
      ctx.strokeStyle = `rgba(242,165,12,${0.5 + 0.45 * pulse})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(target.x * k, target.y * k, 8 + 5 * pulse, 0, Math.PI * 2)
      ctx.stroke()
    }

    for (const u of units) {
      if (!u.alive || u.id === this.youUnit) continue
      // скрытый туманом враг не светится на миникарте
      if (u.team !== this.side && this._hiddenEnemy && this._hiddenEnemy.has(u.id)) continue
      ctx.fillStyle = (u.team === this.side ? this.colors.ally : this.colors.enemy).css
      ctx.beginPath()
      ctx.arc(u.x * k, u.y * k, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
    // свой танк: ЯРКАЯ амбер-стрелка по направлению корпуса + светлый ореол (сразу видно себя)
    if (own) {
      const px = own.x * k
      const py = own.y * k
      const a = own.hull
      ctx.beginPath() // светлый ореол под маркером
      ctx.arc(px, py, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,210,100,0.45)'
      ctx.fill()
      ctx.beginPath() // крупная яркая стрелка направления
      ctx.moveTo(px + Math.cos(a) * 12, py + Math.sin(a) * 12)
      ctx.lineTo(px + Math.cos(a + 2.5) * 8, py + Math.sin(a + 2.5) * 8)
      ctx.lineTo(px + Math.cos(a - 2.5) * 8, py + Math.sin(a - 2.5) * 8)
      ctx.closePath()
      ctx.fillStyle = '#ffcf5a'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 1.3
      ctx.stroke()
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
    const th = this.map.theme || {}
    if (!this.groundTile) g.rect(0, 0, this.mapSize, this.mapSize).fill(0x10141b)
    // тематический слой поверх земли: заливка (асфальт/снег — то, что тинтом по
    // оливковой текстуре не выходит) + улицы города
    if (th.overlay != null) g.rect(0, 0, this.mapSize, this.mapSize).fill({ color: th.overlay, alpha: th.overlayAlpha ?? 0.5 })
    if (this.map.roads && this.map.roads.length) {
      const c = this.mapSize / 2
      const sc = this.mapSize / MAP_SIZE
      for (const r of this.map.roads) {
        g.rect(c + (r.dx - r.w / 2) * sc, c + (r.dy - r.h / 2) * sc, r.w * sc, r.h * sc).fill({ color: th.road ?? 0x555b64, alpha: 0.5 })
      }
    }
    const step = 80
    for (let x = 0; x <= this.mapSize; x += step) g.moveTo(x, 0).lineTo(x, this.mapSize)
    for (let y = 0; y <= this.mapSize; y += step) g.moveTo(0, y).lineTo(this.mapSize, y)
    g.stroke({ width: 1, color: th.grid ?? 0xffffff, alpha: th.gridAlpha ?? 0.05 })
    g.rect(0, 0, this.mapSize, this.mapSize).stroke({ width: 6, color: th.edge ?? 0xffb000, alpha: 0.25 })
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

  // процедурная вода: радиальный градиент глубины (тёмный омут в центре →
  // бирюзовая мель к берегу), мягкая рябь и растворённый край — БЕЗ жёсткого
  // кольца «венна». Кэшируется на инстанс, рисуется одним спрайтом на озеро.
  _waterTexture() {
    if (this._waterTex) return this._waterTex
    const S = 256
    const c = document.createElement('canvas')
    c.width = c.height = S
    const ctx = c.getContext('2d')
    const cx = S / 2
    const cy = S / 2
    const R = S / 2
    const g = ctx.createRadialGradient(cx, cy, R * 0.08, cx, cy, R)
    g.addColorStop(0, '#0d3243')
    g.addColorStop(0.55, '#16475f')
    g.addColorStop(0.85, '#236a86')
    g.addColorStop(1, '#2f7e9b')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()
    // рябь: несколько светлых дуг-бликов на воде
    ctx.strokeStyle = 'rgba(180,225,240,0.10)'
    ctx.lineWidth = 2
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath()
      ctx.arc(cx, cy, R * (0.3 + i * 0.18), Math.PI * 0.18, Math.PI * 0.82)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(205,238,250,0.14)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.76, Math.PI * 1.08, Math.PI * 1.5)
    ctx.stroke()
    // мягкий берег: растворяем альфу к ободу
    const fade = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R)
    fade.addColorStop(0, 'rgba(0,0,0,1)')
    fade.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, S, S)
    this._waterTex = Texture.from(c)
    return this._waterTex
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
        const s = new Sprite(this._waterTexture())
        s.anchor.set(0.5)
        s.position.set(o.x, o.y)
        s.width = s.height = o.r * 2.16 // мягкий край заходит чуть за берег
        s.alpha = 0.94
        this.terrLayer.addChild(s)
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
      blocked: this.blockedShells, // ЧИСЛО отражённых снарядов (задача дня «заблокируй N»)
      blockedDmg: you.blocked || 0, // УРОН, спасённый бронёй (сервер: sim.js u.blocked) — для медали «wall»
      deaths: this.deaths,
      revealed: !!(you && you.revealed), // засвечен ли я врагом сейчас (чип «скрыт/виден»)
      firedReveal: !!(you && you.firedReveal), // РАСКРЫТ собственным выстрелом (чип, кольцо)
      deathInfo: this._deathInfo || null, // кем и откуда меня убили (экран смерти)
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
      aimLock: !!this._aimLock, // линия сведения легла на цель + ствол готов — кнопка ОГОНЬ зеленеет
      reloadLeft: you.ready ? 0 : Math.ceil((1 - reload01) * this.cls.reload * 10) / 10,
      ourBase: 0,
      enemyBase: 0,
      caps: (this.cur ? this.cur.caps : []).map((c) => ({
        id: c.id,
        own: c.owner === null ? null : c.owner === this.side ? 'ally' : 'enemy',
        cap: c.capper === null ? null : c.capper === this.side ? 'ally' : 'enemy',
        p: c.p,
      })),
      // отсчёт удержания всех точек до победы (сервер шлёт capLock { team, sec })
      winCount:
        this.cur && this.cur.capLock ? { sec: this.cur.capLock.sec, mine: this.cur.capLock.team === this.side, kind: 'caps' } : null,
      classId: this.cls.id,
      damageDealt: you.damageDealt || 0,
      spotted: you.spotted || 0, // засветов за бой (боевой рейтинг)
      damageLog: [...this.damageLog.values()].sort((a, b) => b.dmg - a.dmg),
      scoreboard: this._scoreboard(),
      matchTime: this.cur ? this.cur.matchTime : 0,
      matchOver: this.matchOver,
      result: this.result,
      endReason: this.endReason || null, // 'caps'|'wipe'|'score'|'time' — для экрана победы
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
