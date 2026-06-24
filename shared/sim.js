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
  WIN_HOLD_SEC,
  CRIT_CHANCE,
  CRIT_TIME,
  RADIO_CRIT_MULT,
  CRIT_SLOTS,
  ENEMY_AI,
  SOFT_START,
  VET,
  ENEMY_EDGE,
  ARMOR,
  BOT_CLASS_MIX,
  BOT_TANK_IDS,
  BOT_TANK_TIER,
  botTierHpMult,
  botTierDmgMult,
  BOT_DMG_MULT,
  BOT_SPEED_MULT,
  HP_MULT,
  ARCHETYPE,
  archetypeOf,
  BOT_SEP_RADIUS,
  BOT_SEP_PUSH,
  BOT_SPOT_VISION,
  FIRE_REVEAL_SEC,
  TANK_RADIUS,
  REVERSE_MULT,
  BOT_NICKS,
  BOT_SKINS,
  BOT_SKIN_CHANCE,
  classToRadians,
} from './config.js'
import { angleDiff, segHitsCircle, segHitsRect } from './geometry.js'
import { MAPS, MAP_BY_ID } from './maps.js'

export class BattleSim {
  /**
   * humans: [{ id, team: 0|1, name, stats? }] — stats в deg-форме (лоадаут
   * клиента) или null → DEFAULT_CLASS. Обе команды добираются ботами до teamSize.
   */
  constructor({ teamSize = 7, humans = [], mapId = null, mode = 'capture', softStart = false, softFactor = null, vet = 0, botNames = [], anchorTier = null } = {}) {
    this.teamSize = teamSize
    // команды, где есть ЖИВЫЕ. Боты на команде БЕЗ людей = чистые враги соло-игрока (PvE) →
    // получают ENEMY_EDGE (челлендж). В PvP (люди в обеих) эджа нет — честная симметрия.
    this.humanTeams = new Set((humans || []).map((h) => h.team))
    // ТИР боя (макс. среди живых, с сервера): боты по нему берут HP/урон и спрайт
    // в пределах ±1. null → старое поведение (плоские классовые боты).
    this.anchorTier = anchorTier && anchorTier >= 1 && anchorTier <= 10 ? Math.round(anchorTier) : null
    this.map = MAP_BY_ID[mapId] || MAPS[0]
    this.mapId = this.map.id
    this.mapSize = this.map.size || MAP_SIZE // размер карты (большие карты — больше места)
    // режим боя: 'capture' — захват точек до лимита очков; 'annihilation' —
    // бой до последнего танка (точки выключены, победа по вайпу/живым на таймауте)
    this.mode = mode === 'annihilation' ? 'annihilation' : 'capture'
    // «Мягкий старт» (см. SOFT_START): больше окно развёртывания (грейс), боты реже
    // попадают и слабее бьют. Сила — softFactor ∈ [0..1] (плавный спад бой1→норма);
    // принимаем и старый булев softStart (true → полное смягчение 1.0). Множители
    // линейно интерполируем к нейтрали (×1) по силе. Готовим ДО создания юнитов
    // (_makeUnit читает this.botDmgMult). ai-инвариант честного засвета не трогаем.
    const sf = Math.max(0, Math.min(1, softFactor == null ? (softStart ? 1 : 0) : softFactor))
    this.softFactor = sf
    this.softStart = sf > 0
    const lerpMul = (mult) => 1 - sf * (1 - mult) // ×mult при sf=1, ×1 при sf=0
    // ВЕТЕРАНСКИЙ СКЕЙЛ: боты умнее/злее по прогрессу игрока. Действует ТОЛЬКО когда
    // мягкий старт уже снят (иначе новичка бы дёргало) — поэтому гейтим vet=0 при softStart.
    this.vet = this.softStart ? 0 : Math.max(0, Math.min(1, +vet || 0))
    this.ai = this.softStart
      ? { ...ENEMY_AI, graceSec: ENEMY_AI.graceSec + SOFT_START.extraGraceSec * sf, hitChance: ENEMY_AI.hitChance * lerpMul(SOFT_START.hitMult) }
      : this.vet > 0
        ? {
            ...ENEMY_AI,
            hitChance: ENEMY_AI.hitChance * (1 + (VET.hitMult - 1) * this.vet), // точнее
            dodgeFactor: ENEMY_AI.dodgeFactor * (1 - VET.dodgeRelief * this.vet), // движение спасает меньше
            graceSec: Math.max(2, ENEMY_AI.graceSec - VET.graceCut * this.vet), // меньше форы на старте
          }
        : ENEMY_AI
    this.botDmgMult = BOT_DMG_MULT * lerpMul(SOFT_START.dmgMult)
    this.aimTolMult = lerpMul(SOFT_START.aimToleranceMult) // ассист прицеливания игроку, тоже плавный
    this.t = 0
    // аннигиляция — короче и злее (дезматч не тянем 4 минуты; таймаут решает по живым)
    this.matchTime = this.mode === 'annihilation' ? 150 : MATCH_TIME
    this.matchOver = false
    this.winner = null // 0 | 1 | null (ничья)
    this.endReason = null // 'caps' | 'wipe' | 'score' | 'time' — почему бой кончился
    this.capLockTeam = null // команда, удерживающая ВСЕ точки (идёт отсчёт до победы)
    this.capLockEnd = 0 // время this.t, когда отсчёт истечёт → победа capLockTeam
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

    // пул ников для ботов: реальные имена (от сервера) + реалистичные ники, без
    // повторов и без имён живых участников этого боя (чтобы не увидеть своё/чужое
    // имя на боте). Перемешан; _nextBotName выдаёт по очереди.
    const takenNames = new Set(humans.map((h) => (h.name || '').trim().toLowerCase()).filter(Boolean))
    const pool = []
    const seenNick = new Set()
    for (const n of [...(botNames || []), ...BOT_NICKS]) {
      const nm = (n || '').trim()
      const key = nm.toLowerCase()
      if (nm && !seenNick.has(key) && !takenNames.has(key)) {
        seenNick.add(key)
        pool.push(nm)
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    this._botNames = pool
    this._botNameI = 0

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

  // следующий ник бота из перемешанного пула; если исчерпан — случайный из BOT_NICKS
  // (на 14 ботов пула с запасом, так что до фоллбэка обычно не доходит)
  _nextBotName() {
    if (this._botNameI < this._botNames.length) return this._botNames[this._botNameI++]
    return BOT_NICKS[(Math.random() * BOT_NICKS.length) | 0]
  }

  _makeUnit(id, team, slot, human, h) {
    const botClsId = BOT_CLASS_MIX[slot % BOT_CLASS_MIX.length]
    const cls = human
      ? h.stats && h.stats.sectorDeg
        ? h.stats
        : TANK_CLASSES[DEFAULT_CLASS]
      : TANK_CLASSES[botClsId]
    const stats = classToRadians(cls)
    // боту — реальная машина его класса (вместо классовой болванки в цвете команды).
    // ТИР боя задан (anchorTier) → бот «весит» по тиру игрока, но НИКОГДА ВЫШЕ: спрайт
    // БЛИЖАЙШЕГО тира + HP/урон по тиру (botTierHpMult/DmgMult). Тир варьируем по слоту
    // ТОЛЬКО ВНИЗ (−1/0), без +1 — иначе враги «сильно жирнее» (фидбек): тир+1 = +11% HP
    // ПЛЮС классовый базовый HP часто выше конкретного танка игрока. Без anchorTier —
    // старое плоское классовое поведение.
    const botPool = BOT_TANK_IDS[botClsId] || BOT_TANK_IDS.medium
    const botTier = !human && this.anchorTier ? Math.max(1, Math.min(10, this.anchorTier + Math.min(0, (slot % 3) - 1))) : null
    let botTankId
    if (botTier) {
      // ближайший по тиру спрайт класса (пул неполон по тирам → точного ±1 может не быть);
      // тай-брейк (id+team) — разнообразие и разные машины у двух сторон
      const dist = (x) => Math.abs((BOT_TANK_TIER[x] || 5) - botTier)
      const best = Math.min(...botPool.map(dist))
      const near = botPool.filter((x) => dist(x) === best)
      botTankId = near[(id + team * 3) % near.length]
    } else {
      botTankId = botPool[(id + team * 3) % botPool.length]
    }
    const hpMult = botTier ? botTierHpMult(botTier) : 1
    const dmgMult = botTier ? botTierDmgMult(botTier) : 1
    // HP: ботам ×HP_MULT (−30% динамика). ЛЮДЯМ НЕ домножаем — у них stats.hp уже ×HP_MULT из
    // клиентского combatStats (иначе двойной минус). hpMult=1 у людей (botTier null).
    const unitHp = Math.round(stats.hp * hpMult * (human ? 1 : HP_MULT))
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
      // боту иногда даём камуфляж — как у прокачанных игроков (часть остаётся «штатной»)
      skin: human ? h.skin || null : Math.random() < BOT_SKIN_CHANCE ? BOT_SKINS[(Math.random() * BOT_SKINS.length) | 0] : null,
      name: human ? h.name || `Игрок ${id}` : this._nextBotName(),
      classId: stats.id,
      stats,
      x: c + spread,
      y: team === 0 ? c + 560 * sc : c - 560 * sc,
      hull: team === 0 ? -Math.PI / 2 : Math.PI / 2,
      speed: 0,
      hp: unitHp,
      maxHp: unitHp,
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
      blocked: 0, // заблокировано бронёй (рикошет/непробитие) — в награду/медали
      spotSeen: new Set(), // id врагов, чей первый засвет уже зачтён
      revealT: 0, // сек демаскировки выстрелом: пока >0 — видно врагу из тумана
      // боты: урон режется softStart-множителем (новичку), но РАСТЁТ с vet (ветерана «не пробивали»)
      botDamage: Math.round(stats.damage * this.botDmgMult * dmgMult * (1 + (VET.dmgMult - 1) * this.vet)),
      botSpeed: stats.maxSpeed * BOT_SPEED_MULT,
      botTurn: stats.turnRate * 0.9,
      // АРХЕТИП поведения (роль машины: штурмовик/танк/снайпер/охотник/поддержка). Только бот.
      arche: human ? null : archetypeOf(botTankId, stats.id),
      fireCd: 1 + slot * 0.2,
      stuckT: 0,
      avoidT: 0,
      avoidDir: 1,
      reverseT: 0, // анти-застревание: сдаём задним ходом, чтобы вылезти из угла/стены
      stuckN: 0, // сколько раз подряд застряли — для эскалации обхода
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
    u.revealT = FIRE_REVEAL_SEC // выстрел демаскирует: теперь видно врагу из тумана

    const lineAngle = u.hull + this._sweepOffset(u)
    const halfEff = this._sectorHalfEff(u) // разброс: стоя уже, на ходу шире
    // «ассист новичку» (мягкий старт): окно сведения у человека шире — больше
    // первых выстрелов засчитывается (телеметрия: 44% первых мимо). Сила плавная
    // (aimTolMult, бой1→норма). На ботов не влияет, на ветеранов — тоже (×1).
    const tol = u.stats.tolerance * this.aimTolMult
    let best = null
    for (const e of this.units) {
      if (!e.alive || e.team === u.team) continue
      const ang = Math.atan2(e.y - u.y, e.x - u.x)
      const dist = Math.hypot(e.x - u.x, e.y - u.y)
      if (dist > u.stats.range) continue
      if (Math.abs(angleDiff(ang, u.hull)) > halfEff + 0.01) continue
      if (this._lineBlocked(u.x, u.y, e.x, e.y)) continue
      if (this._shotBlockedByTank(u, e)) continue // живой танк на линии — снаряд не проходит насквозь
      const err = Math.abs(angleDiff(ang, lineAngle))
      // допуск += угловой РАЗМЕР цели: вблизи танк закрывает большой угол, а err меряет
      // угол до ЦЕНТРА → в УПОР «мимо», хотя целишь в корпус (фидбек #29 «вплотную пишет
      // мимо»). asin(R/dist): в упор ~π/2 (почти не промахнёшься), вдаль ~0 (без изменений).
      const aimR = Math.asin(Math.min(1, TANK_RADIUS / Math.max(1, dist)))
      // снаряд летит по прямой → бьёт БЛИЖАЙШЕГО на линии (а не «ровнее по углу»
      // дальнего). Иначе «стреляю по первому, попадаю по тем, кто сзади».
      if (err <= tol + aimR && (!best || dist < best.dist)) best = { e, err, dist }
    }

    let killed = false
    let dealt = 0
    let outcome = null
    if (best) {
      u.hits++
      const shotA = Math.atan2(best.e.y - u.y, best.e.x - u.x)
      const r = this._resolveHit(u, best.e, u.stats.damage, shotA)
      dealt = r.dealt
      killed = r.killed
      outcome = r.outcome // null=пробил, 'ricochet'|'nopen'=броня
    }
    const ex = best ? best.e.x : u.x + Math.cos(lineAngle) * u.stats.range
    const ey = best ? best.e.y : u.y + Math.sin(lineAngle) * u.stats.range
    this.events.push({
      type: 'shot',
      unit: u.id,
      hit: !!best,
      killed,
      dmg: Math.round(dealt),
      outcome, // броня: 'ricochet'|'nopen' (для фидбека клиента; null — пробитие)
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

  // guided — тренировочный гайд первого боя: боты-враги ЗАМОРОЖЕНЫ (стоят
  // мишенями, не едут и не стреляют), пока сервер держит room.guided. Игрок при
  // этом ездит/целится/стреляет как обычно — учится без угрозы. Снимается, когда
  // клиент шлёт tutorial-done (см. server roomTick). Для обычных боёв guided=false.
  step(dt, guided = false) {
    if (this.matchOver) return
    this.t += dt
    this.matchTime = Math.max(0, this.matchTime - dt)

    for (const u of this.units) {
      if (!u.alive) continue
      if (u.revealT > 0) u.revealT = Math.max(0, u.revealT - dt) // тает демаскировка выстрелом
      if (u.human) this._stepHuman(u, dt)
      else if (!guided) this._stepBot(u, dt) // тренировка: враги стоят, пока идёт гайд
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
    const target = u.stats.maxSpeed * (throttle >= 0 ? throttle : throttle * REVERSE_MULT)
    const da = u.stats.accel * dt
    if (u.speed < target) u.speed = Math.min(target, u.speed + da)
    else u.speed = Math.max(target, u.speed - da * 1.4)
    u.x += Math.cos(u.hull) * u.speed * dt
    u.y += Math.sin(u.hull) * u.speed * dt
    this._collide(u, TANK_RADIUS)
  }

  _stepBot(b, dt) {
    const ai = this.ai // softStart-тюнинг (грейс/шанс) или базовый ENEMY_AI
    // АРХЕТИП: роль машины модулирует дистанцию боя / отход / укрытие / выбор цели / агрессию.
    // idR — предпочитаемая дистанция (кап fireRange*0.95: снайпер не «зависает» вне радиуса огня).
    const arche = b.arche || ARCHETYPE.assault
    const idR = Math.min(ai.fireRange * 0.95, ai.idealRange * arche.distMult)
    // КОНЦОВКА annihilation (<45с): боты ФОКУСИРУЮТ (анти-догпайл off) + прут добивать — иначе
    // бой распыляется без киллов до таймера. Считаем заранее: нужно в выборе цели ниже.
    const rush = this.mode === 'annihilation' && this.matchTime < 45
    // PvE-эдж: бот на команде БЕЗ людей = враг соло-игрока → чуть точнее/злее (см. ENEMY_EDGE).
    // В PvP (люди в обеих командах) эджа нет. Мягкий старт его подавляет (новичка не давим).
    const enemyBot = !this.softStart && !this.humanTeams.has(b.team)
    if (b.fireCd > 0) b.fireCd -= dt
    const px = b.x
    const py = b.y
    let wantMove = true

    // УМНЫЙ ВЫБОР ЦЕЛИ (раньше был тупо ближайший): раненую цель добиваем (она «ближе»
    // по скору), а живого ИГРОКА фокусим тем сильнее, чем выше ветеранство. bestD —
    // настоящая дистанция до выбранной цели (нужна для радиуса/шанса огня ниже).
    let target = null
    let bestScore = Infinity
    let bestD = Infinity
    for (const f of this.units) {
      if (!f.alive || f.team === b.team) continue
      const d = Math.hypot(f.x - b.x, f.y - b.y)
      // бот видит и стреляет только в радиусе своего зрения — не через всю карту
      if (d > ai.vision || this._lineBlocked(b.x, b.y, f.x, f.y)) continue
      const hpFrac = f.maxHp ? Math.max(0, Math.min(1, f.hp / f.maxHp)) : 1
      const hpW = Math.min(0.7, 0.45 * arche.hpFocus) // вес добивания подранка (архетип: охотник-финишер выше)
      let score = d * (1 - hpW + hpW * hpFrac) // ФОКУС-ОГОНЬ: подранок «ближе» по скору → команда добивает вместе
      // фокус на живом игроке: растёт с ветеранством + PvE-враги давят на него сильнее
      if (f.human) score *= Math.max(0.3, 1 - 0.25 * this.vet - (enemyBot ? ENEMY_EDGE.humanFocus : 0))
      // АНТИ-ДОГПАЙЛ (умнее): реже берём цель, которую УЖЕ обступила своя команда — бот
      // ищет менее занятого врага → команда РАСПРЕДЕЛЯЕТ цели по полю, а не наваливается
      // толпой на один танк (фидбек «ботов колбасит как коров на мясокомбинате»). Когда
      // враг ОДИН (концовка), альтернатив нет → все берут его, как и было.
      let mates = 0
      const crowdR2 = (ai.idealRange * 1.5) ** 2
      for (const a of this.units) {
        if (a.alive && a.team === b.team && a.id !== b.id && (a.x - f.x) ** 2 + (a.y - f.y) ** 2 < crowdR2) mates++
      }
      score *= Math.max(0.2, 1 + (rush ? 0 : arche.crowd) * mates) // (+) рассредоточение / (−) поддержка липнет / rush: фокус
      if (score < bestScore) {
        bestScore = score
        bestD = d
        target = f
      }
    }

    // КАППЕР: в режиме захвата ~40% ботов (по id) ДЕРЖАТ точку даже при видимом враге —
    // едут к ней и стоят в круге (= захват), а не бросают её в погоню. По врагу стреляют,
    // если он попал в их сектор (блок стрельбы ниже). Остальные боты — охотники.
    let capGoal = null
    if (this.mode === 'capture' && b.id % 5 < 2) {
      const open = this.caps.filter((cap) => cap.owner !== b.team)
      if (open.length) {
        open.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))
        const cap = open[b.id % open.length]
        const off = ((b.id % 7) / 7) * Math.PI * 2
        const r = cap.r || 70
        capGoal = { cx: cap.x, cy: cap.y, x: cap.x + Math.cos(off) * r * 0.7, y: cap.y + Math.sin(off) * r * 0.7, r }
      }
    }

    // КОНЦОВКА БОЯ (annihilation, rush — объявлен выше): в последние ~45с боты перестают
    // камперить (не ныряют в кусты, не отходят ранеными), ФОКУСИРУЮТ и ПРУТ добивать — иначе
    // недобитые «трусы прячутся и ждут таймер» (#29 @Z_86_V). Это ДВИЖЕНИЕ+фокус, не нарушение
    // честности (бот бьёт человека только из его засвета + после грейса) — её ниже НЕ трогаем.
    if (b.reverseT > 0) {
      // АНТИ-ЗАСТРЕВАНИЕ: пока reverseT — пятимся ЗАДНИМ ХОДОМ + доворот вбок (avoidDir),
      // чтобы вылезти из угла/у стены (#28 «боты стоят и крутятся на месте»). Одного
      // поворота в тупике мало — нужен откат. После — обычный ИИ (цель/точка).
      b.reverseT -= dt
      b.hull += b.botTurn * dt * b.avoidDir
      b.x -= Math.cos(b.hull) * b.botSpeed * REVERSE_MULT * dt
      b.y -= Math.sin(b.hull) * b.botSpeed * REVERSE_MULT * dt
      wantMove = true
    } else if (target) {
      const ang = Math.atan2(target.y - b.y, target.x - b.x)
      if (capGoal) {
        // ЗАЩИТА ТОЧКИ: едем к своей позиции у круга; НА точке — держим место, но
        // разворачиваемся НА ВРАГА и стреляем (а не пялимся в центр круга, пока нас
        // расстреливают). Раньше каппер игнорил стрелка сбоку — главная «тупость».
        const onCap = Math.hypot(b.x - capGoal.cx, b.y - capGoal.cy) <= capGoal.r
        let a = onCap ? ang : Math.atan2(capGoal.y - b.y, capGoal.x - b.x)
        if (b.avoidT > 0) a += b.avoidDir * 1.5
        b.hull += Math.max(-b.botTurn * dt, Math.min(b.botTurn * dt, angleDiff(a, b.hull)))
        wantMove = !onCap
        if (!onCap) {
          b.x += Math.cos(b.hull) * b.botSpeed * 0.6 * dt
          b.y += Math.sin(b.hull) * b.botSpeed * 0.6 * dt
        }
      } else {
        // ОХОТНИК (умный, тактика вместо «прёт в лоб»):
        //  • пока пушка перезаряжается — ныряем в ближний куст (концелмент срезает чужой
        //    шанс ×bushCover), готов выстрел — выходим и бьём → «пик-трейд» как у живых;
        //  • без укрытия заходим с ФЛАНГА (увод вбок к борту/корме, где броня слабее),
        //    вблизи сводим ствол на цель. Лобовой суицид-разгон убран.
        const flank = b.id % 2 ? 1 : -1
        const brave = b.id % 3 === 0 || (this.vet >= 0.5 && b.id % 2 === 1) || (enemyBot && ENEMY_EDGE.braveShare && b.id % 2 === 0)
        // ОТХОД по архетипу: штурмовик/танк (retreatFrac≈0) НЕ отступают; снайпер/охотник/поддержка кайтят
        const retreatHp = b.maxHp * (arche.retreatFrac + (b.id % 5) * 0.012) * (1 - 0.4 * this.vet) * (enemyBot ? ENEMY_EDGE.retreatMult : 1)
        const canRetreat = arche.retreatFrac > 0
        // УКРЫТИЕ по архетипу: снайпер/охотник прячут корпус (cover высок → ищем шире), штурмовик почти нет
        const cover = arche.cover > 0.25 && b.fireCd > 0 && b.hp >= retreatHp && !rush ? this._nearestBush(b.x, b.y, 120 + 200 * arche.cover) : null
        const inCover = cover && Math.hypot(b.x - cover.x, b.y - cover.y) <= cover.r
        // видим ЧЕЛОВЕКА, грейс прошёл, но стрелять нельзя — он нас ещё не засветил (инвариант
        // честности). Не висим пассивно → ПОДЖИМАЕМ засветиться (#28). В грейс новичка НЕ давим.
        const blindToHuman =
          target.human && this.t >= ai.graceSec && !(this._spotted[target.team] && this._spotted[target.team].has(b.id))
        // фланг шире у нежмущих (охотник заходит во фланг/тыл), уже у напористых (штурмовик прямее)
        const flankW = bestD > idR ? 0.3 + 0.4 * (1 - arche.push) : 0.14
        // КОММИТ В ВЫСТРЕЛ: ствол готов (или вот-вот) + цель в радиусе огня → НАВОДИМСЯ на неё,
        // не флангуем и не ныряем в куст. Иначе бот вечно кружит/прячется и почти не стреляет
        // (особенно на низких скоростях новой сетки) → союзники не добивают, бой не решается.
        const commitShot = b.fireCd <= 0.35 && bestD <= ai.fireRange && !this._lineBlocked(b.x, b.y, target.x, target.y)
        let steerA
        if (commitShot) steerA = ang // ствол на цель — стреляем, тактика потом
        else if (cover) steerA = Math.atan2(cover.y - b.y, cover.x - b.x) // на перезарядке — ныряем в куст
        else steerA = ang + flankW * flank // фланговый заход; у дистанции боя — ствол на цель
        if (b.avoidT > 0) steerA += b.avoidDir * 1.5
        const maxTurn = b.botTurn * dt
        b.hull += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(steerA, b.hull)))
        let move = 0
        // ближе этой дистанции держащий-дистанцию (снайпер/поддержка) отъезжает (кайт); штурмовик — почти нет
        const backoff = idR * (0.4 + 0.5 * (1 - arche.push))
        if (canRetreat && !brave && b.hp < retreatHp && !rush) move = -1 // ранен — отходим (танк/штурмовик не отступают)
        else if (blindToHuman && bestD > idR * 0.5) move = 1 // не засвечен у человека → поджимаем (засветиться и стрелять)
        else if (rush && bestD > ai.idealRange * 0.85) move = 1 // концовка: все добивают (архетип не мешает)
        else if (inCover) move = 0 // в кусте — пережидаем перезарядку (выйдем стрелять, когда ствол готов)
        else if (cover) move = 1 // едем в укрытие
        else if (bestD > idR * 1.1) move = 1 // далеко — сближаемся до СВОЕЙ дистанции (с флангом)
        else if (bestD < backoff) move = -0.5 // ближе своей дистанции — отъезжаем (снайпер кайтит, штурмовик почти нет)
        wantMove = move !== 0
        const mag = move < 0 ? Math.abs(move) * REVERSE_MULT : move
        b.x += Math.cos(b.hull) * Math.sign(move) * mag * b.botSpeed * dt
        b.y += Math.sin(b.hull) * Math.sign(move) * mag * b.botSpeed * dt
      }

      const inArc = Math.abs(angleDiff(ang, b.hull)) <= (ai.sectorHalfDeg * Math.PI) / 180
      // СТРЕЛЯЕМ только если: цель в секторе, в радиусе огня (≤ fireRange, не на
      // всю дальность зрения) и — для человека — бот ЗАСВЕЧЕН его командой. Иначе
      // бот бил из тумана со своего респа, а игрок снаряды ловил «из ниоткуда».
      const canFire =
        inArc &&
        b.fireCd <= 0 &&
        bestD <= ai.fireRange &&
        // линия до цели ЧИСТА В МОМЕНТ ВЫСТРЕЛА (вкл. трупы-укрытие) — страховка тикет #28
        // «урон сквозь мёртвые танки»: если труп встал на линию ПОСЛЕ выбора цели, бот не
        // бьёт сквозь него. У выбора цели проверка та же (422), здесь — на момент огня.
        !this._lineBlocked(b.x, b.y, target.x, target.y) &&
        // по человеку: бот ДОЛЖЕН быть им засвечен + прошёл стартовый грейс
        // (первые graceSec секунд боты не фокусят новичка — «честный первый бой»)
        (!target.human || (this.t >= ai.graceSec && this._spotted[target.team].has(b.id)))
      if (canFire) {
        b.fireCd = b.stats.reload
        b.revealT = FIRE_REVEAL_SEC // бот тоже демаскируется выстрелом (симметрия)
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
        if (enemyBot) chance *= ENEMY_EDGE.hitMult // PvE: враги соло-игрока чуть точнее
        const hit = Math.random() < Math.min(0.85, chance) // потолок — не 100% даже в упор

        let killed = false
        let dealt = 0
        let outcome = null
        if (hit) {
          const shotA = Math.atan2(target.y - b.y, target.x - b.x)
          const r = this._resolveHit(b, target, b.botDamage, shotA)
          dealt = r.dealt
          killed = r.killed
          outcome = r.outcome // броня цели: рикошет/непробитие
        }
        // ТЕАТР ПРОМАХОВ: попал — трассер точно в цель; мимо — уходит в сторону и
        // за цель, чтобы игрок ВИДЕЛ промах (а не «прилетело из ниоткуда»).
        let ex = target.x
        let ey = target.y
        if (!hit) {
          const a0 = Math.atan2(target.y - b.y, target.x - b.x)
          const jitter = (0.05 + Math.random() * 0.09) * (Math.random() < 0.5 ? -1 : 1) // ~3–8° вбок
          const far = bestD * (1.04 + Math.random() * 0.12)
          ex = b.x + Math.cos(a0 + jitter) * far
          ey = b.y + Math.sin(a0 + jitter) * far
        }
        this.events.push({
          type: 'shot',
          unit: b.id,
          hit,
          killed,
          dmg: Math.round(dealt),
          outcome, // броня: 'ricochet'|'nopen' (фидбек «отскок от меня» у игрока)
          target: target.id,
          x1: Math.round(b.x),
          y1: Math.round(b.y),
          x2: Math.round(ex),
          y2: Math.round(ey),
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
      // целимся не в ЦЕНТР объекта, а в личную позицию вокруг него (веер по id) —
      // боты держат ПЕРИМЕТР точки, а не стоят толпой за одним ящиком (фидбэк Макса)
      let gx = goal ? goal.x : c
      let gy = goal ? goal.y : c
      if (goal) {
        const off = ((b.id % 7) / 7) * Math.PI * 2
        const rad = (goal.r || 70) * 0.85
        gx += Math.cos(off) * rad
        gy += Math.sin(off) * rad
      }
      let a = Math.atan2(gy - b.y, gx - b.x)
      if (b.avoidT > 0) a += b.avoidDir * 1.5
      const diff = angleDiff(a, b.hull)
      b.hull += Math.max(-b.botTurn * dt, Math.min(b.botTurn * dt, diff))
      b.x += Math.cos(b.hull) * b.botSpeed * (rush ? 0.95 : 0.6) * dt // концовка: быстрее ищем добить
      b.y += Math.sin(b.hull) * b.botSpeed * (rush ? 0.95 : 0.6) * dt
    }

    // РАССРЕДОТОЧЕНИЕ (анти-толпа): мягко расталкиваем СЛИШКОМ близких союзников —
    // в дополнение к жёсткому _collide на касании. Толпа у точки/цели расходится.
    let sepX = 0, sepY = 0
    for (const f of this.units) {
      if (f === b || !f.alive || f.team !== b.team) continue
      const dx = b.x - f.x, dy = b.y - f.y
      const d = Math.hypot(dx, dy)
      if (d > 1 && d < BOT_SEP_RADIUS) { const w = (BOT_SEP_RADIUS - d) / BOT_SEP_RADIUS; sepX += (dx / d) * w; sepY += (dy / d) * w }
    }
    const sepM = Math.hypot(sepX, sepY)
    if (sepM > 0) {
      const k = (Math.min(1.5, sepM) / sepM) * BOT_SEP_PUSH * dt // клампим суммарную силу
      b.x += sepX * k
      b.y += sepY * k
    }

    this._collide(b, ENEMY_AI.radius)

    if (b.avoidT > 0) b.avoidT -= dt
    const moved = Math.hypot(b.x - px, b.y - py)
    if (wantMove && moved < b.botSpeed * dt * 0.25) b.stuckT += dt
    else { b.stuckT = 0; if (moved > b.botSpeed * dt * 0.5) b.stuckN = 0 } // едем нормально — сброс эскалации
    if (b.stuckT > 0.5) {
      b.stuckT = 0
      b.stuckN++
      b.avoidT = 1.0
      b.reverseT = 0.5 // вылезаем ЗАДНИМ ХОДОМ — одного поворота в углу мало (#28)
      // направление обхода ДЕТЕРМИНИРОВАННОЕ (раньше random → дёрг влево-вправо = «кручусь
      // на месте»); при ПОВТОРНОМ застревании пробуем другую сторону (прошлый обход не помог)
      b.avoidDir = (b.id % 2 ? 1 : -1) * (b.stuckN % 2 ? 1 : -1)
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

  // БРОНЯ: по углу встречи снаряда (shotAngle) и классу/корпусу цели — пробил,
  // рикошет или непробитие. Лоб держит, корма — нет (фланг/доворот = награда).
  // Возвращает null (пробил) или { kind:'ricochet'|'nopen', mult } (mult — доля урона).
  _penetration(shotAngle, victim) {
    const base = ARMOR.byClass[victim.classId] ?? ARMOR.byClass.medium
    // a — угол между «направлением на стрелка» и КОРПУСОМ цели: 0 — стрелок строго в лоб,
    // π/2 — в борт, π — в корму. Это угол ВСТРЕЧИ снаряда с лобовой плитой.
    const a = Math.abs(angleDiff(shotAngle + Math.PI, victim.hull))
    // УГОЛ ПОПАДАНИЯ: держит только лобовая полусфера (front), а доворот плиты (slope) даёт
    // максимум бунса при ~45° (РОМБ). В лоб-плоско — слабо, в борт/корму — ноль. Так доворот
    // реально спасает (скилл), а боты, фейсящие тебя плоско, наоборот пробиваются.
    const front = Math.max(0, Math.cos(a)) // 1 фронт → 0 борт/корма
    const slope = Math.max(0, Math.sin(2 * a)) // 0 в лоб-плоско → 1 при ~45° доворота → 0 в борт
    const angleFactor = 0.35 * front + 0.65 * slope
    const chance = Math.min(ARMOR.maxBlock, base * angleFactor)
    if (Math.random() >= chance) return null // пробитие
    return Math.random() < ARMOR.ricochetShare ? { kind: 'ricochet', mult: 0 } : { kind: 'nopen', mult: ARMOR.nopenMult }
  }

  // применить выстрел с учётом брони: пробил → полный урон; рикошет/непробитие →
  // урон×mult, остальное идёт в blocked цели. Возвращает { dealt, killed, outcome }.
  _resolveHit(attacker, victim, fullDmg, shotAngle) {
    const pen = this._penetration(shotAngle, victim)
    const mult = pen ? pen.mult : 1
    const want = Math.min(fullDmg, victim.hp) // потенциальный урон (для blocked)
    let dealt = 0
    let killed = false
    if (mult > 0) {
      dealt = Math.min(fullDmg * mult, victim.hp)
      attacker.damageDealt += dealt
      killed = this._applyDamage(victim, fullDmg * mult, attacker)
    }
    if (pen) victim.blocked += Math.max(0, want - dealt) // спасённое бронёй
    return { dealt, killed, outcome: pen ? pen.kind : null }
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
      // быстрее растёт счёт, обе команды копят независимо
      for (const cap of this.caps) if (cap.owner !== null) this.score[cap.owner]++
    }
  }

  // засвет: враг виден команде, если его видит любой её живой юнит
  _stepSpotting() {
    for (const team of [0, 1]) {
      const seen = new Set()
      for (const e of this.units) {
        if (!e.alive || e.team === team) continue
        // демаскировка выстрелом: стрелявший враг виден этой команде из тумана,
        // без кредита за разведку (он сам себя выдал, его никто не «засветил»)
        if (e.revealT > 0) seen.add(e.id)
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
    // ЗАХВАТ ВСЕХ ТОЧЕК → отсчёт до победы (а не мгновенный конец): команда держит
    // все точки WIN_HOLD_SEC секунд — победа. Враг отбил любую точку → отсчёт сорван.
    if (this.caps.length) {
      const owners = this.caps.map((c) => c.owner)
      const hold = owners.every((o) => o === 0) ? 0 : owners.every((o) => o === 1) ? 1 : null
      if (hold !== null) {
        if (this.capLockTeam !== hold) {
          this.capLockTeam = hold
          this.capLockEnd = this.t + WIN_HOLD_SEC
        } else if (this.t >= this.capLockEnd) {
          this.matchOver = true
          this.endReason = 'caps'
          this.winner = hold
          return
        }
        return // идёт отсчёт удержания — не завершаем бой по лимиту очков/таймауту
      }
      this.capLockTeam = null // удержание сорвано — отсчёт сбрасывается
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

  // ближайший куст в радиусе maxD (для «пик-трейда» ботов: спрятаться на перезарядке).
  // Кусты дают концелмент (чужой шанс попадания ×bushCover) — умный бот их использует.
  _nearestBush(x, y, maxD) {
    let best = null
    let bd = maxD
    for (const o of this.obstacles) {
      if (o.kind !== 'bush') continue
      const d = Math.hypot(o.x - x, o.y - y)
      if (d < bd) { bd = d; best = o }
    }
    return best
  }

  _lineBlocked(x1, y1, x2, y2) {
    for (const o of this.obstacles) {
      // вода и КУСТЫ обзор/стрельбу не блокируют (мягкое укрытие, как офлайн):
      // иначе сидя В кусте упираешься лучом в свой же куст и «никого не видишь»
      if (o.kind === 'water' || o.kind === 'bush') continue
      if (segHitsCircle(x1, y1, x2, y2, o.x, o.y, o.r)) return true
    }
    // ТРУПЫ ТАНКОВ — твёрдое укрытие: подбитый танк блокирует выстрел И обзор (можно
    // прятаться за остовом, снаряды не проходят насквозь). Симметрично всем. Труп у САМОГО
    // начала луча (стрелок стоит на месте чужой гибели) НЕ блокируем — иначе самоослепление.
    for (const u of this.units) {
      if (u.alive) continue
      const dx0 = x1 - u.x, dy0 = y1 - u.y
      if (dx0 * dx0 + dy0 * dy0 <= (TANK_RADIUS + 8) * (TANK_RADIUS + 8)) continue
      if (segHitsCircle(x1, y1, x2, y2, u.x, u.y, TANK_RADIUS)) return true
    }
    for (const w of this.walls) {
      if (segHitsRect(x1, y1, x2, y2, w.cx - w.hw, w.cy - w.hh, w.cx + w.hw, w.cy + w.hh)) return true
    }
    return false
  }

  // живой танк (кроме стрелка и цели) на линии «съедает» снаряд: насквозь корпуса
  // не стреляем (фидбек «снаряды сквозь танки»). Трупы уже учтены в _lineBlocked,
  // а ОБЗОР это не трогает (только стрельба) — иначе живые танки слепили бы друг друга.
  _shotBlockedByTank(shooter, target) {
    for (const u of this.units) {
      if (!u.alive || u === shooter || u === target) continue
      if (segHitsCircle(shooter.x, shooter.y, target.x, target.y, u.x, u.y, TANK_RADIUS)) return true
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
      // отсчёт удержания всех точек до победы (null — не идёт)
      capLock: this.capLockTeam !== null ? { team: this.capLockTeam, sec: Math.max(0, Math.ceil(this.capLockEnd - this.t)) } : null,
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
          // u.human НЕ шлём: это палило бота на клиенте (жёсткая маскировка под игроков)
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
      blocked: Math.round(u.blocked), // урон, заблокированный твоей бронёй (рикошет/непробитие)
      spotted: u.spots, // засветов за бой (для боевого рейтинга)
      // ЗАСВЕЧЕН ли я сейчас врагом (видит ли меня команда противника) — для
      // чипа «скрыт/виден»: игрок понимает, прилетит сейчас или он в тумане.
      revealed: this._spotted[1 - u.team].has(u.id),
      // РАСКРЫТ ли я собственным выстрелом (демаскировка тикает) — для третьего
      // состояния чипа: отличаем «меня засекли по обзору» от «я сам себя выдал».
      firedReveal: u.revealT > 0,
    }
  }
}
