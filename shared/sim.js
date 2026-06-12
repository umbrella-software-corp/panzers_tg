// ============ PANZER TG — авторитетная симуляция боя N×N ============
// Чистая логика без рендера (порт правил из client Game.js): движение людей
// по вводу, ИИ ботов (цели/точки/антизастревание), линия сведения, хитскан,
// одна жизнь, точки захвата с большинством, криты модулей у людей.
// Используется сервером (источник истины); клиент перейдёт на неё для PvE.
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
  BOT_CLASS_MIX,
  BOT_TANK_IDS,
  BOT_DMG_MULT,
  BOT_SPEED_MULT,
  BOT_SPOT_VISION,
  TANK_RADIUS,
  BOT_NAMES,
  classToRadians,
} from './config.js'
import { angleDiff, segHitsCircle, segHitsRect } from './geometry.js'
import { MAPS, MAP_BY_ID } from './maps.js'

export class BattleSim {
  /**
   * humans: [{ id, team: 0|1, name, stats? }] — stats в deg-форме (лоадаут
   * клиента) или null → DEFAULT_CLASS. Обе команды добираются ботами до teamSize.
   */
  constructor({ teamSize = 7, humans = [], mapId = null, mode = 'capture' } = {}) {
    this.teamSize = teamSize
    this.map = MAP_BY_ID[mapId] || MAPS[0]
    this.mapId = this.map.id
    this.mapSize = this.map.size || MAP_SIZE // размер карты (большие карты — больше места)
    // режим боя: 'capture' — захват точек до лимита очков; 'annihilation' —
    // бой до последнего танка (точки выключены, победа по вайпу/живым на таймауте)
    this.mode = mode === 'annihilation' ? 'annihilation' : 'capture'
    this.t = 0
    // аннигиляция — короче и злее (дезматч не тянем 4 минуты; таймаут решает по живым)
    this.matchTime = this.mode === 'annihilation' ? 150 : MATCH_TIME
    this.matchOver = false
    this.winner = null // 0 | 1 | null (ничья)
    this.endReason = null // 'caps' | 'wipe' | 'score' | 'time' — почему бой кончился
    this.score = [0, 0]
    this.capTimer = 0
    this.events = [] // копятся за шаг, забираются takeEvents()

    const c = this.mapSize / 2
    // координаты фич/спавнов растягиваем на размер карты (большие карты —
    // фичи разнесены шире, а не кучкуются в центре с пустыми краями)
    const sc = this.mapSize / MAP_SIZE
    this.obstacles = this.map.obstacles.map((o) => ({ x: c + o.dx * sc, y: c + o.dy * sc, r: o.r, kind: o.kind }))
    // в PvP все стены капитальные (разрушаемость — клиентская фича PvE)
    this.walls = this.map.walls.map((w) => ({ cx: c + w.dx * sc, cy: c + w.dy * sc, hw: w.w / 2, hh: w.h / 2 }))
    // базы карты: [юг, север] — команда 0 всегда юг, команда 1 — север
    this.bases = this.map.bases.map((b, i) => ({ team: i, x: c + b.dx * sc, y: c + b.dy * sc, r: b.r }))
    this.caps = this.map.caps.map((p) => ({
      id: p.id,
      x: c + p.dx * sc,
      y: c + p.dy * sc,
      r: p.r,
      owner: null,
      capper: null,
      progress: 0,
    }))

    // юниты: сначала люди, затем боты до полного состава
    this.units = []
    let uid = 1
    for (const team of [0, 1]) {
      const teamHumans = humans.filter((h) => h.team === team)
      let slot = 0
      for (const h of teamHumans.slice(0, teamSize)) {
        this.units.push(this._makeUnit(uid++, team, slot++, true, h))
      }
      for (let i = 0; slot < teamSize; i++) {
        this.units.push(this._makeUnit(uid++, team, slot++, false, null))
      }
    }
    this.byId = new Map(this.units.map((u) => [u.id, u]))
    // владелец-человек: внешний id → unit
    this.byOwner = new Map(this.units.filter((u) => u.human).map((u) => [u.ownerId, u]))

    this._spotted = [new Set(), new Set()] // [team] -> Set(unitId врагов)
  }

  _makeUnit(id, team, slot, human, h) {
    const botClsId = BOT_CLASS_MIX[slot % BOT_CLASS_MIX.length]
    const cls = human
      ? h.stats && h.stats.sectorDeg
        ? h.stats
        : TANK_CLASSES[DEFAULT_CLASS]
      : TANK_CLASSES[botClsId]
    const stats = classToRadians(cls)
    // боту — реальная машина его класса (вместо классовой болванки в цвете
    // команды): разнообразие по id+team, своя у каждой стороны
    const botPool = BOT_TANK_IDS[botClsId] || BOT_TANK_IDS.medium
    const botTankId = botPool[(id + team * 3) % botPool.length]
    const sc = this.mapSize / MAP_SIZE // спавны тоже растягиваем под размер карты
    const spread = ((slot - (this.teamSize - 1) / 2) / Math.max(1, this.teamSize)) * 1000 * sc
    const c = this.mapSize / 2
    return {
      id,
      team,
      slot,
      human,
      ownerId: human ? h.id : null,
      tankId: human ? h.tankId || null : botTankId, // реальная машина (игрок — своя, бот — по классу)
      tint: human ? h.tint || 0 : 0, // оттенок камуфляжа игрока
      skin: human ? h.skin || null : null, // id узорного камуфляжа (рендер у клиентов)
      name: human ? h.name || `Игрок ${id}` : BOT_NAMES[team][slot % BOT_NAMES[team].length],
      classId: stats.id,
      stats,
      x: c + spread,
      y: team === 0 ? c + 560 * sc : c - 560 * sc,
      hull: team === 0 ? -Math.PI / 2 : Math.PI / 2,
      speed: 0,
      hp: stats.hp,
      maxHp: stats.hp,
      alive: true,
      input: { throttle: 0, steer: 0 }, // люди
      reload: 0, // люди: сек до готовности
      sweep: 0,
      crippled: { gun: 0, turret: 0, engine: 0, tracks: 0, radio: 0 },
      kills: 0,
      damageDealt: 0,
      shots: 0,
      hits: 0,
      spots: 0, // засветов за бой (для боевого рейтинга)
      spotSeen: new Set(), // id врагов, чей первый засвет уже зачтён
      // боты
      botDamage: Math.round(stats.damage * BOT_DMG_MULT),
      botSpeed: stats.maxSpeed * BOT_SPEED_MULT,
      botTurn: stats.turnRate * 0.9,
      fireCd: 1 + slot * 0.2,
      stuckT: 0,
      avoidT: 0,
      avoidDir: 1,
      _blockT: -1, // тик последнего события «выстрел заблокирован»
    }
  }

  // --- внешний API ---

  setInput(ownerId, throttle, steer) {
    const u = this.byOwner.get(ownerId)
    if (!u || !u.alive) return
    u.input.throttle = Math.max(-1, Math.min(1, +throttle || 0))
    u.input.steer = Math.max(-1, Math.min(1, +steer || 0))
  }

  // выстрел человека; событие уходит в общий поток events
  fire(ownerId) {
    const u = this.byOwner.get(ownerId)
    if (!u || !u.alive || this.matchOver) return
    // заблокированный выстрел — максимум одно событие за тик: спам «fire»
    // не должен раздувать рассылку всей комнате
    if (u.crippled.gun > 0) {
      if (u._blockT !== this.t) {
        u._blockT = this.t
        this.events.push({ type: 'shot', unit: u.id, blocked: 'gun' })
      }
      return
    }
    if (u.reload > 0) {
      if (u._blockT !== this.t) {
        u._blockT = this.t
        this.events.push({ type: 'shot', unit: u.id, blocked: 'reload' })
      }
      return
    }
    u.reload = u.stats.reload
    u.shots++

    const lineAngle = u.hull + this._sweepOffset(u)
    const halfEff = this._sectorHalfEff(u) // разброс: стоя уже, на ходу шире
    let best = null
    for (const e of this.units) {
      if (!e.alive || e.team === u.team) continue
      const ang = Math.atan2(e.y - u.y, e.x - u.x)
      const dist = Math.hypot(e.x - u.x, e.y - u.y)
      if (dist > u.stats.range) continue
      if (Math.abs(angleDiff(ang, u.hull)) > halfEff + 0.01) continue
      if (this._lineBlocked(u.x, u.y, e.x, e.y)) continue
      const err = Math.abs(angleDiff(ang, lineAngle))
      // снаряд летит по прямой → бьёт БЛИЖАЙШЕГО на линии (а не «ровнее по углу»
      // дальнего). Иначе «стреляю по первому, попадаю по тем, кто сзади».
      if (err <= u.stats.tolerance && (!best || dist < best.dist)) best = { e, err, dist }
    }

    let killed = false
    let dealt = 0
    if (best) {
      u.hits++
      dealt = Math.min(u.stats.damage, best.e.hp)
      u.damageDealt += dealt
      killed = this._applyDamage(best.e, u.stats.damage, u)
    }
    const ex = best ? best.e.x : u.x + Math.cos(lineAngle) * u.stats.range
    const ey = best ? best.e.y : u.y + Math.sin(lineAngle) * u.stats.range
    this.events.push({
      type: 'shot',
      unit: u.id,
      hit: !!best,
      killed,
      dmg: Math.round(dealt),
      target: best ? best.e.id : null,
      x1: Math.round(u.x),
      y1: Math.round(u.y),
      x2: Math.round(ex),
      y2: Math.round(ey),
    })
  }

  takeEvents() {
    const ev = this.events
    this.events = []
    return ev
  }

  // события с учётом тумана команды: трассеры и киллы — всем (механика),
  // а хп/криты незасвеченных врагов команде не утекают (анти-wallhack)
  eventsForTeam(events, team) {
    const seen = this._spotted[team]
    return events.filter((ev) => {
      if (ev.type === 'hp') {
        const u = this.byId.get(ev.unit)
        return !u || u.team === team || !u.alive || seen.has(u.id)
      }
      if (ev.type === 'crit') {
        const u = this.byId.get(ev.unit)
        return !u || u.team === team
      }
      return true
    })
  }

  // отключившийся человек становится ботом (ИИ доигрывает)
  humanLeft(ownerId) {
    const u = this.byOwner.get(ownerId)
    if (!u) return
    u.human = false
    this.byOwner.delete(ownerId)
  }

  aliveCount(team) {
    return this.units.filter((u) => u.team === team && u.alive).length
  }

  // --- шаг ---

  step(dt) {
    if (this.matchOver) return
    this.t += dt
    this.matchTime = Math.max(0, this.matchTime - dt)

    for (const u of this.units) {
      if (!u.alive) continue
      if (u.human) this._stepHuman(u, dt)
      else this._stepBot(u, dt)
    }
    this._separateUnits() // танк-в-танк: не дать машинам набиться в одну точку
    if (this.mode === 'capture') this._stepCaptures(dt) // аннигиляция — без точек
    this._stepSpotting()
    this._checkEnd()
  }

  _stepHuman(u, dt) {
    for (const s of CRIT_SLOTS) {
      if (u.crippled[s] > 0) u.crippled[s] = Math.max(0, u.crippled[s] - dt)
    }
    if (u.reload > 0) u.reload = Math.max(0, u.reload - dt)

    let { throttle, steer } = u.input
    if (u.crippled.tracks > 0) steer = 0
    if (u.crippled.engine > 0) throttle = 0

    u.hull += steer * u.stats.turnRate * dt
    const target = u.stats.maxSpeed * (throttle >= 0 ? throttle : throttle * 0.5)
    const da = u.stats.accel * dt
    if (u.speed < target) u.speed = Math.min(target, u.speed + da)
    else u.speed = Math.max(target, u.speed - da * 1.4)
    u.x += Math.cos(u.hull) * u.speed * dt
    u.y += Math.sin(u.hull) * u.speed * dt
    this._collide(u, TANK_RADIUS)
  }

  _stepBot(b, dt) {
    const ai = ENEMY_AI
    if (b.fireCd > 0) b.fireCd -= dt
    const px = b.x
    const py = b.y
    let wantMove = true

    let target = null
    let bestD = Infinity
    for (const f of this.units) {
      if (!f.alive || f.team === b.team) continue
      const d = Math.hypot(f.x - b.x, f.y - b.y)
      // бот видит и стреляет только в радиусе своего зрения — не через всю карту
      if (d < bestD && d <= ai.vision && !this._lineBlocked(b.x, b.y, f.x, f.y)) {
        bestD = d
        target = f
      }
    }

    if (target) {
      const ang = Math.atan2(target.y - b.y, target.x - b.x)
      // лёгкое вилянье курсом вместо «краба» — танки боком не ездят
      const steerA = b.avoidT > 0 ? ang + b.avoidDir * 1.5 : ang + Math.sin(this.t * 0.9 + b.id) * 0.18
      const diff = angleDiff(steerA, b.hull)
      const maxTurn = b.botTurn * dt
      b.hull += Math.max(-maxTurn, Math.min(maxTurn, diff))

      let move = 0
      if (b.hp < b.maxHp * 0.3) move = -1 // мало хп — отступаем, продолжая отстреливаться
      else if (bestD > ai.idealRange * 1.15) move = 1
      else if (bestD < ai.idealRange * 0.5) move = -0.5 // пятится только в упор
      wantMove = move !== 0

      // движение строго вдоль корпуса
      b.x += Math.cos(b.hull) * move * b.botSpeed * dt
      b.y += Math.sin(b.hull) * move * b.botSpeed * dt

      const inArc = Math.abs(angleDiff(ang, b.hull)) <= (ai.sectorHalfDeg * Math.PI) / 180
      // СТРЕЛЯЕМ только если: цель в секторе, в радиусе огня (≤ fireRange, не на
      // всю дальность зрения) и — для человека — бот ЗАСВЕЧЕН его командой. Иначе
      // бот бил из тумана со своего респа, а игрок снаряды ловил «из ниоткуда».
      const canFire =
        inArc &&
        b.fireCd <= 0 &&
        bestD <= ai.fireRange &&
        (!target.human || this._spotted[target.team].has(b.id))
      if (canFire) {
        b.fireCd = b.stats.reload
        // шанс попадания: база режется дистанцией, ходом цели (уворот) и кустом.
        // Сидячая цель в упор на открытом — почти база; летящая боком вдалеке в
        // кусте — мажем честно. Бьём по людям сложнее, чем по статичным болванкам.
        let chance = ai.hitChance
        chance *= 1 - ai.hitFalloff * Math.min(1, bestD / ai.fireRange)
        const moving = Math.min(1, Math.abs(target.speed || 0) / (target.stats.maxSpeed || 120))
        chance *= 1 - ai.dodgeFactor * moving
        if (this.obstacles.some((o) => o.kind === 'bush' && Math.hypot(target.x - o.x, target.y - o.y) <= o.r)) {
          chance *= ai.bushCover
        }
        const hit = Math.random() < chance
        let killed = false
        let dealt = 0
        if (hit) {
          dealt = Math.min(b.botDamage, target.hp)
          b.damageDealt += dealt
          killed = this._applyDamage(target, b.botDamage, b)
        }
        this.events.push({
          type: 'shot',
          unit: b.id,
          hit,
          killed,
          dmg: Math.round(dealt),
          target: target.id,
          x1: Math.round(b.x),
          y1: Math.round(b.y),
          x2: Math.round(target.x),
          y2: Math.round(target.y),
        })
      }
    } else {
      // нет цели — к точке захвата. Боты РАСПРЕДЕЛЯЮТСЯ по точкам (сорт по
      // дистанции, выбор по индексу id), а не ломятся все на ближнюю — кучкуются меньше.
      const open = this.caps.filter((cap) => cap.owner !== b.team)
      open.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))
      let goal = open.length ? open[b.id % open.length] : null
      // аннигиляция (точек нет) — охота на живых врагов; РАСПРЕДЕЛЯЕМ по разным
      // целям из ближайших (выбор по id), а не все на одного — иначе кучкуются
      if (!goal && this.mode === 'annihilation') {
        const enemies = this.units.filter((e) => e.alive && e.team !== b.team)
        if (enemies.length) {
          enemies.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))
          goal = enemies[b.id % Math.min(enemies.length, 3)]
        }
      }
      const c = this.mapSize / 2
      let a = Math.atan2((goal ? goal.y : c) - b.y, (goal ? goal.x : c) - b.x)
      if (b.avoidT > 0) a += b.avoidDir * 1.5
      const diff = angleDiff(a, b.hull)
      b.hull += Math.max(-b.botTurn * dt, Math.min(b.botTurn * dt, diff))
      b.x += Math.cos(b.hull) * b.botSpeed * 0.6 * dt
      b.y += Math.sin(b.hull) * b.botSpeed * 0.6 * dt
    }

    this._collide(b, ENEMY_AI.radius)

    if (b.avoidT > 0) b.avoidT -= dt
    const moved = Math.hypot(b.x - px, b.y - py)
    if (wantMove && moved < b.botSpeed * dt * 0.25) b.stuckT += dt
    else b.stuckT = 0
    if (b.stuckT > 0.5) {
      b.stuckT = 0
      b.avoidT = 0.9
      b.avoidDir = Math.random() < 0.5 ? -1 : 1
    }
  }

  _applyDamage(victim, dmg, attacker) {
    victim.hp -= dmg
    this.events.push({ type: 'hp', unit: victim.id, hp: Math.max(0, Math.round(victim.hp)) })
    // криты модулей — только людям и только если жив
    if (victim.human && victim.hp > 0 && Math.random() < CRIT_CHANCE) {
      const free = CRIT_SLOTS.filter((s) => victim.crippled[s] <= 0)
      if (free.length) {
        const slot = free[Math.floor(Math.random() * free.length)]
        victim.crippled[slot] = CRIT_TIME
        this.events.push({ type: 'crit', unit: victim.id, slot })
      }
    }
    if (victim.hp <= 0) {
      victim.hp = 0
      victim.alive = false
      victim.speed = 0
      attacker.kills++
      this.score[attacker.team]++
      this.events.push({ type: 'kill', killer: attacker.id, victim: victim.id })
      return true
    }
    return false
  }

  _stepCaptures(dt) {
    for (const cap of this.caps) {
      let n = [0, 0]
      for (const u of this.units) {
        if (u.alive && Math.hypot(u.x - cap.x, u.y - cap.y) <= cap.r) n[u.team]++
      }
      let capTeam = null
      if (n[0] > 0 && n[1] === 0) capTeam = 0
      else if (n[1] > 0 && n[0] === 0) capTeam = 1
      if (capTeam !== null && cap.owner !== capTeam) {
        if (cap.capper === capTeam) {
          cap.progress += dt / CAP_TIME
          if (cap.progress >= 1) {
            cap.progress = 1
            cap.owner = capTeam
          }
        } else {
          cap.progress -= dt / CAP_TIME
          if (cap.progress <= 0) {
            cap.progress = 0
            cap.capper = capTeam
          }
        }
      }
    }
    this.capTimer += dt
    if (this.capTimer >= CAP_TICK) {
      this.capTimer -= CAP_TICK
      // каждая удержанная точка тикает очко владельцу — чем больше точек, тем
      // быстрее растёт счёт (War Thunder style), обе команды копят независимо
      for (const cap of this.caps) if (cap.owner !== null) this.score[cap.owner]++
    }
  }

  // засвет: враг виден команде, если его видит любой её живой юнит
  _stepSpotting() {
    for (const team of [0, 1]) {
      const seen = new Set()
      for (const e of this.units) {
        if (!e.alive || e.team === team) continue
        for (const u of this.units) {
          if (!u.alive || u.team !== team) continue
          const vis = u.human
            ? u.stats.vision * (u.crippled.radio > 0 ? RADIO_CRIT_MULT : 1)
            : BOT_SPOT_VISION
          if (Math.hypot(e.x - u.x, e.y - u.y) <= vis && !this._lineBlocked(u.x, u.y, e.x, e.y)) {
            seen.add(e.id)
            // кредит за РАЗВЕДКУ человеку (люди идут в units первыми → первый увидевший
            // = человек, если враг вообще в чьём-то людском обзоре). Боту засвет не в зачёт.
            if (u.human && !u.spotSeen.has(e.id)) {
              u.spotSeen.add(e.id)
              u.spots++
            }
            break
          }
        }
      }
      this._spotted[team] = seen
    }
  }

  _checkEnd() {
    const a0 = this.aliveCount(0)
    const a1 = this.aliveCount(1)
    // вайп команды решает бой в любом режиме (взаимный вайп — по очкам/ничья)
    if (a0 === 0 || a1 === 0) {
      this.matchOver = true
      this.endReason = 'wipe'
      this.winner = a0 === a1 ? (this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1) : a0 > 0 ? 0 : 1
      return
    }
    if (this.mode === 'annihilation') {
      // бой до последнего: лимита очков нет, до таймаута никто не выигрывает;
      // вышло время — победа у команды с бо́льшим числом живых (равно — ничья)
      if (this.matchTime > 0) return
      this.matchOver = true
      this.endReason = 'time'
      this.winner = a0 === a1 ? null : a0 > a1 ? 0 : 1
      return
    }
    // ЗАХВАТ ВСЕХ ТОЧЕК = победа (бой завершается красиво, а не тянется до лимита)
    if (this.caps.length) {
      const owners = this.caps.map((c) => c.owner)
      if (owners.every((o) => o === 0)) {
        this.matchOver = true
        this.endReason = 'caps'
        this.winner = 0
        return
      }
      if (owners.every((o) => o === 1)) {
        this.matchOver = true
        this.endReason = 'caps'
        this.winner = 1
        return
      }
    }
    const limit = this.score[0] >= SCORE_LIMIT || this.score[1] >= SCORE_LIMIT
    if (!limit && this.matchTime > 0) return
    this.matchOver = true
    this.endReason = limit ? 'score' : 'time'
    this.winner = this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1
  }

  // --- геометрия ---

  // разброс прицела от скорости: стоя сектор сжат до 55%, на полном ходу — 100%.
  // Делает стрельбу на ходу менее точной (как офлайн) — стимул притормозить.
  _sectorHalfEff(u) {
    const k = Math.min(1, Math.abs(u.speed || 0) / u.stats.maxSpeed)
    return u.stats.sectorHalf * (0.55 + 0.45 * k)
  }

  _sweepOffset(u) {
    if (u.crippled.turret > 0) return u.sweep
    const p = (this.t % u.stats.sweepPeriod) / u.stats.sweepPeriod
    const tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p
    u.sweep = this._sectorHalfEff(u) * tri
    return u.sweep
  }

  _lineBlocked(x1, y1, x2, y2) {
    for (const o of this.obstacles) {
      // вода и КУСТЫ обзор/стрельбу не блокируют (мягкое укрытие, как офлайн):
      // иначе сидя В кусте упираешься лучом в свой же куст и «никого не видишь»
      if (o.kind === 'water' || o.kind === 'bush') continue
      if (segHitsCircle(x1, y1, x2, y2, o.x, o.y, o.r)) return true
    }
    for (const w of this.walls) {
      if (segHitsRect(x1, y1, x2, y2, w.cx - w.hw, w.cy - w.hh, w.cx + w.hw, w.cy + w.hh)) return true
    }
    return false
  }

  // танк-в-танк: после движения всех машин разводим перекрытия, иначе боты
  // набиваются в одну точку. Пара расталкивается симметрично от центра к центру.
  _separateUnits() {
    const minD = TANK_RADIUS * 1.7 // центр-к-центру; ближе — расталкиваем
    const alive = this.units.filter((u) => u.alive)
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]
        const b = alive[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= minD) continue
        if (d < 0.001) {
          dx = a.id - b.id || 1 // точное совпадение — детерминированный сдвиг
          dy = 0
          d = Math.abs(dx) || 1
        }
        const push = (minD - d) / 2
        a.x -= (dx / d) * push
        a.y -= (dy / d) * push
        b.x += (dx / d) * push
        b.y += (dy / d) * push
      }
    }
    // могли въехать в стену/препятствие при расталкивании — поправляем
    for (const u of alive) this._collide(u, u.human ? TANK_RADIUS : ENEMY_AI.radius)
  }

  _collide(pos, radius) {
    for (const o of this.obstacles) {
      if (o.kind === 'bush') continue
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

  // --- снапшоты ---

  // общий для команды: свои юниты всегда, враги при засвете, обломки всем
  snapshotForTeam(team) {
    const seen = this._spotted[team]
    return {
      type: 'state',
      t: +this.t.toFixed(3),
      mode: this.mode,
      matchTime: Math.ceil(this.matchTime),
      matchOver: this.matchOver,
      winner: this.winner,
      score: this.score,
      alive: [this.aliveCount(0), this.aliveCount(1)],
      // аннигиляция — точек нет, шлём пустой список (HUD/рендер скрывают захват)
      caps: this.mode === 'annihilation' ? [] : this.caps.map((c) => ({ id: c.id, owner: c.owner, capper: c.capper, p: +c.progress.toFixed(2) })),
      units: this.units
        .filter((u) => !u.alive || u.team === team || seen.has(u.id))
        .map((u) => ({
          id: u.id,
          team: u.team,
          x: Math.round(u.x),
          y: Math.round(u.y),
          hull: +u.hull.toFixed(3),
          hp: Math.round(u.hp),
          maxHp: u.maxHp,
          alive: u.alive,
          name: u.name,
          cls: u.classId,
          human: u.human,
          tankId: u.tankId,
          tint: u.tint,
          skin: u.skin,
        })),
    }
  }

  // личная добавка получателю (криты/перезарядка/линия сведения)
  personalFor(ownerId) {
    const u = this.byOwner.get(ownerId)
    if (!u) return null
    return {
      unit: u.id,
      hp: Math.max(0, Math.round(u.hp)),
      alive: u.alive,
      reload01: u.stats.reload ? Math.max(0, Math.min(1, 1 - u.reload / u.stats.reload)) : 1,
      ready: u.reload <= 0,
      crippled: Object.fromEntries(CRIT_SLOTS.map((s) => [s, Math.ceil(u.crippled[s])])),
      kills: u.kills,
      shots: u.shots,
      hits: u.hits,
      damageDealt: Math.round(u.damageDealt),
      spotted: u.spots, // засветов за бой (для боевого рейтинга)
    }
  }
}
