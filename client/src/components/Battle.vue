<script setup>
// Боевой HUD (порт BattleScreen поверх живого Pixi-боя): счёт с ромбиками живых,
// HP-полоса с именем машины, миникарта, килл-фид, индикаторы критов, пауза,
// плавающий джойстик и hazard-кнопка ОГОНЬ с кольцом перезарядки.
import { ref, shallowRef, onMounted, onBeforeUnmount, computed } from 'vue'
import { NetGame } from '../game/NetGame.js'
import { NetGame3D } from '../game/NetGame3D.js'
import { MAP_BY_ID, MAPS } from '../game/maps.js'
import { DEFAULT_CLASS, CRIT_LABELS } from '../game/config.js'
import { profile, party, spendGoldAmmo, addBattleResult, tankCamo } from '../store.js'
import { TANK_BY_ID, PREM_TANK, GOLD_AMMO_MULT } from '../game/meta.js'
import { haptic } from '../tg.js'
import { track } from '../analytics.js'
import { t as tr } from '../i18n.js' // alias: `t` встречается как локальная переменная ниже
import Results from './Results.vue'
import PzIcon from './ui/PzIcon.vue'
import TrainingGuide from './TrainingGuide.vue'

const props = defineProps({
  loadout: { type: Object, default: null },
  mapId: { type: String, default: '' },
  side: { type: Number, default: 0 }, // 0 — юг (синие), 1 — север (красные)
  mode: { type: String, default: 'capture' }, // 'capture' | 'annihilation'
  net: { type: Object, default: null }, // онлайн-матч: { client, mapId, side, youUnit, tickHz, mode }
  training: { type: Boolean, default: false }, // тренировочный первый бой: враги заморожены, поверх — гайд
})
const emit = defineEmits(['exit', 'rematch'])

const stage = ref(null)
const minimap = ref(null)
const isNet = !!props.net
// тренировочный первый бой: поверх живого боя ведём гайд «едь/целься/стреляй»,
// враги заморожены сервером (room.guided), пока активен trainingActive
const isTraining = !!props.training
const trainingActive = ref(isTraining)
// обучающая подсказка прицеливания: только в самом первом бою и до первого выстрела
// (в тренировке учим стрельбе самим гайдом — старую подсказку не показываем)
const firstBattle = (profile.stats?.battles || 0) === 0
const firedOnce = ref(false)
// гайд завершён/пропущен → будим замороженных ботов на сервере и помечаем тренировку
function finishTraining() {
  if (!trainingActive.value) return
  trainingActive.value = false
  try {
    game.client && game.client.send({ type: 'tutorial-done' })
  } catch {
    /* сокет мог закрыться — не критично, сервер разморозит ботов по бэкстопу */
  }
  profile.trainingDone = true // персистится (deep watch в store) — больше не уводим в тренировку
  track('training_guide_finished', { time_sec: battleSec() })
}
// онлайн-онли: бой всегда сетевой (Battle рендерится только после deploy(net)).
// ЭКСПЕРИМЕНТ: ?3d или localStorage.pz3d=1 → 3D-рендер (Three.js) тем же API.
const use3D = (() => { try { return new URLSearchParams(location.search).has('3d') || localStorage.getItem('pz3d') === '1' } catch { return false } })()
const game = use3D ? new NetGame3D(props.net) : new NetGame(props.net)

// цвета команд в HUD: своя/чужая зависят от жребия стороны (онлайн — от сервера)
const mySide = isNet ? props.net.side : props.side
const teamCol = computed(() => (mySide === 1 ? 'var(--red)' : 'var(--blue)'))
const foeCol = computed(() => (mySide === 1 ? 'var(--blue)' : 'var(--red)'))
const mapName = computed(() => tr('game.maps.' + (MAP_BY_ID[isNet ? props.net.mapId : props.mapId] || MAPS[0]).id))

const state = shallowRef({
  kills: 0,
  deaths: 0,
  shots: 0,
  hits: 0,
  accuracy: 0,
  playerHp: 100,
  playerMaxHp: 100,
  allyScore: 0,
  enemyScore: 0,
  alliesAlive: 5,
  enemiesAlive: 5,
  reload01: 1,
  ready: true,
  reloadLeft: 0,
  ourBase: 0,
  enemyBase: 0,
  caps: [],
  winCount: null, // { sec, mine, kind } — отсчёт удержания всех точек до победы

  classId: DEFAULT_CLASS,
  damageDealt: 0,
  spotted: 0,
  revealed: false, // видит ли меня враг (засвет по обзору)
  firedReveal: false, // демаскирован собственным выстрелом
  matchTime: 0,
  matchOver: false,
  result: null,
  scoreLimit: 20,
  mode: 'capture',
  crippled: { gun: 0, turret: 0, engine: 0, tracks: 0, radio: 0 },
})

// слоты модулей для индикатора критов (ключи движка → иконки PzIcon)
const MOD_HUD = [
  { id: 'gun', icon: 'gun' },
  { id: 'turret', icon: 'tur' },
  { id: 'engine', icon: 'eng' },
  { id: 'tracks', icon: 'trk' },
  { id: 'radio', icon: 'rad' },
]

const tankName = computed(() => (TANK_BY_ID[profile.selectedTank] || {}).name || '')
// режим «на уничтожение»: вместо очков захвата — живые бойцы команд
const annihilation = computed(() => state.value.mode === 'annihilation')
// счёт для донесения: захват — очки, уничтожение — оставшиеся в живых
const displayScore = computed(() =>
  annihilation.value
    ? `${state.value.alliesAlive}:${state.value.enemiesAlive}`
    : `${state.value.allyScore}:${state.value.enemyScore}`,
)
const hpFrac = computed(() => state.value.playerHp / state.value.playerMaxHp)
const hpColor = computed(() => (hpFrac.value > 0.6 ? 'var(--green)' : hpFrac.value > 0.3 ? 'var(--amber)' : 'var(--red)'))
// засвет игрока, 3 состояния: РАСКРЫТ (сам себя выдал выстрелом) → ЗАСВЕЧЕН (враг
// видит по обзору) → СКРЫТ (в тумане). Выстрел приоритетнее — он самый срочный.
const spotState = computed(() => (state.value.firedReveal ? 'revealed' : state.value.revealed ? 'spotted' : 'hidden'))
const spotLabel = computed(() => tr('battle.spot.' + spotState.value))
// баннер конца боя: ПОЧЕМУ бой кончился (причина крупно) + исход — перед донесением
const endBanner = computed(() => {
  const r = state.value.result // 'victory'|'defeat'|'draw'
  const reason = state.value.endReason
  const win = r === 'victory'
  const resWord = tr(win ? 'common.victory' : r === 'defeat' ? 'common.defeat' : 'common.draw')
  const color = reason === 'aborted' ? 'var(--amber)' : win ? 'var(--green)' : r === 'defeat' ? 'var(--red)' : 'var(--amber)'
  const done = (w) => (w ? tr('battle.taskDone') + ' · ' + resWord : resWord)
  let title = resWord
  let sub = ''
  switch (reason) {
    case 'caps':
      title = tr(win ? 'battle.end.capsWin' : 'battle.end.capsLose')
      sub = done(win)
      break
    case 'wipe':
      title = tr(win ? 'battle.end.wipeWin' : 'battle.end.wipeLose')
      sub = done(win)
      break
    case 'score':
      title = tr(win ? 'battle.end.scoreWin' : 'battle.end.scoreLose')
      sub = resWord
      break
    case 'time':
      title = tr('battle.end.timeUp')
      sub = resWord
      break
    case 'aborted':
      title = tr('battle.end.aborted')
      sub = tr('battle.end.abortedSub')
      break
    default:
      title = resWord
  }
  return { title, sub, color }
})
// причина смерти для экрана смерти: «Уничтожил: <ник> · <класс> · удар <сторона>»
const deathCause = computed(() => {
  const d = state.value.deathInfo
  if (!d) return ''
  const cls = ['light', 'medium', 'heavy'].includes(d.cls) ? tr('game.classesLower.' + d.cls) : ''
  const dir = d.dir ? tr('battle.dir.' + d.dir) : ''
  return tr('battle.deathBy', { by: d.by, cls, dir })
})

// фаза боя: countdown (отсчёт) | fighting | result. Отсчёт стартует СРАЗУ и для
// онлайна. Авто-откат онлайн→офлайн приходит как instant=true → сразу fighting
// (без второго «3-2-1»). Игрок никогда не залипает.
const phase = ref(props.instant ? 'fighting' : 'countdown')
const count = ref(3)
const loading = ref(true) // лоадер до прогрузки спрайтов боя
const deathDismissed = ref(false) // игрок закрыл экран смерти и ушёл в наблюдение
let countTimer = null
let endTimer = null // пауза на баннер «почему бой кончился» перед донесением

// пауза по кнопке (поверх фазы fighting)
const paused = ref(false)
function pauseGame() {
  track('pause_opened', {
    time_sec: battleSec(),
    before_first_shot: !battleTelemetry.firstShot,
    match_type: matchType(),
  })
  paused.value = true
  game.setPaused(true)
}
function resumeGame() {
  paused.value = false
  game.setPaused(false)
}

let prevKills = 0
let prevDeaths = 0

// --- телеметрия боя для Amplitude (одноразовые вехи: первый выстрел/урон/смерть) ---
const battleTelemetry = {
  started: false,
  startedAt: 0,
  firstInput: false,
  firstShot: false,
  firstShotSec: null,
  firstShotResult: null,
  firstShotReason: null,
  firstHitSec: null,
  firstDamage: false,
  firstDamageTakenSec: null,
  firstDeath: false,
  firstDeathSec: null,
  firstRevealed: false,
  fireTapsBeforeFirstValidShot: 0,
  blockedFireCountFirstMin: 0,
  exitedEarly: false,
  abandoned: false, // терминальное событие «ушёл до конца боя» отправлено (1 раз)
}
function battleSec() {
  return battleTelemetry.startedAt ? Math.round((performance.now() - battleTelemetry.startedAt) / 1000) : 0
}
// тип матча: онлайн-онли (взвод/обычный онлайн); offline_direct — на случай прямого
// боя с ботами без сети (офлайн-фоллбэк из матчмейкинга выпилен — его тут нет)
function matchType() {
  if (isNet && party.token) return 'squad'
  if (isNet) return 'online'
  return 'offline_direct'
}
function markBattleStarted() {
  if (battleTelemetry.started) return
  battleTelemetry.started = true
  battleTelemetry.startedAt = performance.now()
  track('battle_started', {
    battle_id: props.net?.room || null,
    match_type: matchType(),
    online: isNet,
    map_id: isNet ? props.net.mapId : props.mapId,
    mode: isNet ? props.net.mode : props.mode,
    humans: props.net?.humans || null,
    bots_estimated: props.net?.humans ? Math.max(0, 14 - props.net.humans) : null,
    side: mySide,
    tank_id: profile.selectedTank,
  })
}
function markFirstInput(inputType) {
  if (battleTelemetry.firstInput) return
  battleTelemetry.firstInput = true
  track('battle_first_input', {
    input_type: inputType,
    time_sec: battleSec(),
    match_type: matchType(),
  })
}

const toast = ref(null)
let toastTimer = null
function showToast(kind, text) {
  toast.value = { kind, text }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 700)
}

// килл-фид: последние 3 фрага игрока, тают через 4.5с
const feed = ref([])
game.onKill = (name) => {
  haptic('success') // фраг — ощутимая отдача
  const key = Date.now() + Math.random()
  feed.value = [{ key, text: name }, ...feed.value].slice(0, 3)
  setTimeout(() => {
    feed.value = feed.value.filter((f) => f.key !== key)
  }, 4500)
}

// награды за действия (засвет/захват) — всплывающие подписи «+опыт»
const actionFeed = ref([])
game.onReward = ({ text, xp }) => {
  haptic('light')
  const key = Date.now() + Math.random()
  actionFeed.value = [{ key, text, xp }, ...actionFeed.value].slice(0, 3)
  setTimeout(() => {
    actionFeed.value = actionFeed.value.filter((f) => f.key !== key)
  }, 2200)
}

// тряска экрана при получении урона
const shaking = ref(false)
let shakeTimer = null
let prevHp = Infinity

// индикатор направления урона: красная дуга у танка, указывает, откуда прилетело
// (angle — корпус-относительный угол, 0 = спереди/вверх; экран повёрнут с танком)
const dmgDirs = ref([])
game.onHurt = (angle) => {
  const key = Date.now() + Math.random()
  dmgDirs.value = [...dmgDirs.value, { key, angle }].slice(-3)
  setTimeout(() => {
    dmgDirs.value = dmgDirs.value.filter((x) => x.key !== key)
  }, 850)
  if (!battleTelemetry.firstDamage) {
    battleTelemetry.firstDamage = true
    battleTelemetry.firstDamageTakenSec = battleSec()
    track('battle_first_damage_taken', {
      time_sec: battleTelemetry.firstDamageTakenSec,
      damage_direction_angle: angle,
      revealed_state: !!state.value.revealed,
      match_type: matchType(),
    })
  }
}

// сторож онлайн-старта: если за 5с не пришёл ни один снапшот сервера — показываем
// экран «нет связи» с кнопками (онлайн-онли, в офлайн НЕ сваливаемся).
let netWatchdog = null
function clearNetWatchdog() {
  clearTimeout(netWatchdog)
  netWatchdog = null
}

// снапшоты просели, но сокет жив (короткий iOS-затык на старте боя) — показываем
// плашку и ЖДЁМ возобновления. Снимается, как пошли данные.
const reconnecting = ref(false)
if (isNet) game.onReconnecting = (on) => (reconnecting.value = on)

// связь окончательно потеряна (исчерпаны попытки реконнекта) — экран с кнопками
// «Повторить» (новый поиск) / «В ангар». Никакого офлайна.
const connLost = ref(false)

let statsCounted = false // статистика матча банкается один раз
game.onState = (s) => {
  // пришли данные мира — снимаем сторож «нет связи»
  if (isNet && game.cur) clearNetWatchdog()
  if (s.kills > prevKills) showToast('hit', tr('battle.enemyDestroyed'))
  if (s.revealed && !battleTelemetry.firstRevealed) {
    battleTelemetry.firstRevealed = true
    track('battle_spotted_state_changed', {
      state: true,
      time_sec: battleSec(),
      after_own_shot: !!battleTelemetry.firstShot,
      match_type: matchType(),
    })
  }
  if (s.deaths > prevDeaths) {
    showToast('miss', tr('battle.youDestroyed'))
    deathDismissed.value = false // новая смерть — показываем экран смерти
    if (!battleTelemetry.firstDeath) {
      battleTelemetry.firstDeath = true
      battleTelemetry.firstDeathSec = battleSec()
      track('battle_player_destroyed', {
        time_sec: battleTelemetry.firstDeathSec,
        death_by: s.deathInfo?.by || null,
        death_dir: s.deathInfo?.dir || null,
        was_revealed: !!s.revealed,
        damage_taken_before_death: battleTelemetry.firstDamage,
        first_shot_result: battleTelemetry.firstShotResult,
        match_type: matchType(),
      })
    }
  }
  if (s.playerHp < prevHp && s.playerHp > 0) {
    haptic('heavy') // получил урон — сильный толчок (хорошо ощущается на iOS)
    shaking.value = true
    clearTimeout(shakeTimer)
    shakeTimer = setTimeout(() => (shaking.value = false), 320)
  }
  prevHp = s.playerHp
  prevKills = s.kills
  prevDeaths = s.deaths
  state.value = s
  if (s.matchOver && phase.value === 'fighting') {
    track('battle_finished', {
      battle_id: props.net?.room || null,
      match_type: matchType(),
      online: isNet,
      duration_sec: battleSec(),
      result: s.result,
      end_reason: s.endReason || null,
      mode: s.mode,
      humans: props.net?.humans || null,
      bots_estimated: props.net?.humans ? Math.max(0, 14 - props.net.humans) : null,
      damage_dealt: s.damageDealt || 0,
      kills: s.kills || 0,
      shots: s.shots || 0,
      hits: s.hits || 0,
      accuracy: s.accuracy || 0,
      spotted: s.spotted || 0,
      death_count: s.deaths || 0,
      survived: !s.deaths,
      first_shot_sec: battleTelemetry.firstShotSec,
      first_shot_result: battleTelemetry.firstShotResult,
      first_miss_reason: battleTelemetry.firstShotReason,
      first_hit_sec: battleTelemetry.firstHitSec,
      first_damage_taken_sec: battleTelemetry.firstDamageTakenSec,
      first_death_sec: battleTelemetry.firstDeathSec,
      exited_early: battleTelemetry.exitedEarly,
    })
    // сперва БАННЕР «почему бой кончился» (чтобы не вываливать модалку резко),
    // через ~1.8с — итоговое донесение
    phase.value = 'ending'
    haptic(s.result === 'victory' ? 'success' : s.result === 'defeat' ? 'error' : 'warning')
    clearTimeout(endTimer)
    endTimer = setTimeout(() => {
      if (phase.value === 'ending') phase.value = 'result'
    }, 1800)
    if (!statsCounted) {
      statsCounted = true
      addBattleResult(s.result, s.kills, { score: displayScore.value, tank: tankName.value, damage: s.damageDealt, spot: s.spotted || 0 })
    }
  }
}

const fmtTime = (sec) => {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// награда за матч: результат решает (победа ощутимо жирнее поражения)
const reward = computed(() => {
  const s = state.value
  const win = s.result === 'victory'
  const draw = s.result === 'draw'
  // прем-танк: ПРОГНОЗ кристаллов для экрана итогов (фактически начисляет bankBattle по
  // тому же счётчику — формула одна, расходиться не могут). gems>0 → этот бой даёт 💎;
  // gemsIn — через сколько боёв следующая выдача (для подсказки игроку).
  const premTank = !!(TANK_BY_ID[profile.selectedTank] && TANK_BY_ID[profile.selectedTank].premium)
  const premAfter = premTank ? (profile.premTankBattles || 0) + 1 : 0
  return {
    xp: (win ? 200 : draw ? 120 : 80) + s.kills * 45 + s.hits * 4 + (s.bonusXp || 0),
    silver: (win ? 260 : draw ? 150 : 100) + s.kills * 45 + Math.round(s.allyScore * 6),
    kills: s.kills,
    allyScore: s.allyScore,
    // для задач дня
    damage: s.damageDealt || 0,
    lightKills: s.lightKills || 0,
    blocked: s.blocked || 0, // число отражённых снарядов (задача дня)
    blockedDmg: s.blockedDmg || 0, // урон, спасённый бронёй (медаль «wall»)
    victory: win,
    survived: !s.deaths, // одна жизнь: дожил до конца боя
    premTank,
    gems: premTank && premAfter % PREM_TANK.gemEvery === 0 ? PREM_TANK.gems : 0,
    gemsIn: premTank ? PREM_TANK.gemEvery - (premAfter % PREM_TANK.gemEvery) : 0,
  }
})

// --- выбор снаряда: обычный / голдовый (урон ×GOLD_AMMO_MULT, тратится) ---
const ammo = ref('std')
function toggleAmmo() {
  if (ammo.value === 'std' && profile.goldAmmo <= 0) return
  ammo.value = ammo.value === 'std' ? 'gold' : 'std'
  game.ammoMult = ammo.value === 'gold' ? GOLD_AMMO_MULT : 1
  track('ammo_toggle_used', {
    time_sec: battleSec(),
    ammo_to: ammo.value,
    first_battle: (profile.stats?.battles || 0) === 0,
  })
}
// корректные по роду/числу фразы повреждений модулей берём из словаря (battle.crit)
game.onCrit = (slot) => {
  const known = ['gun', 'turret', 'engine', 'tracks', 'radio'].includes(slot)
  showToast('miss', known ? tr('battle.crit.' + slot) : tr('battle.critFallback', { label: CRIT_LABELS[slot] }))
}
game.onSaved = (kind) => {
  showToast('hit', tr(kind === 'ricochet' ? 'battle.savedRicochet' : 'battle.savedNopen'))
}
game.onShot = (r) => {
  // --- телеметрия: первый выстрел и первый РЕЗУЛЬТАТ (до игровой реакции ниже) ---
  const _sec = battleSec()
  if (!battleTelemetry.firstShot) {
    battleTelemetry.firstShot = true
    battleTelemetry.firstShotSec = _sec
    track('battle_first_shot', {
      time_sec: _sec,
      match_type: matchType(),
      blocked: r.type === 'blocked',
      reason: r.reason || null,
    })
  }
  if (_sec <= 60 && r.type === 'blocked') battleTelemetry.blockedFireCountFirstMin++
  if (!battleTelemetry.firstShotResult && r.type !== 'blocked') {
    battleTelemetry.firstShotResult = r.type
    battleTelemetry.firstShotReason = r.reason || null
    if (r.type === 'hit' || r.type === 'ricochet' || r.type === 'nopen') battleTelemetry.firstHitSec = _sec
    track('battle_first_shot_result', {
      time_sec: _sec,
      result: r.type,
      reason: r.reason || null,
      in_range: !!r.inRange,
      in_sector: !!r.inSector,
      los: !!r.los,
      fire_taps_before_first_valid_shot: battleTelemetry.fireTapsBeforeFirstValidShot,
      blocked_fire_count_first_min: battleTelemetry.blockedFireCountFirstMin,
      match_type: matchType(),
    })
  }
  if (r.type === 'ram') {
    haptic('rigid') // таран — жёсткий толчок
    showToast('hit', tr('battle.ram'))
    return
  }
  if (r.type === 'blocked') {
    if (r.reason === 'gun') showToast('miss', tr('battle.gunJammed'))
    return
  }
  // голдовый снаряд тратится на каждый состоявшийся выстрел
  if (ammo.value === 'gold') {
    spendGoldAmmo(1)
    if (profile.goldAmmo <= 0) {
      ammo.value = 'std'
      game.ammoMult = 1
    }
  }
  if (r.type === 'hit') {
    haptic('medium') // пробитие — отдача попадания
    showToast('hit', tr('battle.penetration'))
  } else if (r.type === 'ricochet') {
    haptic('light') // снаряд лизнул броню — лёгкий тик
    showToast('miss', tr('battle.ricochet'))
  } else if (r.type === 'nopen') {
    haptic('light') // попал, но не пробил — лёгкий тик
    showToast('miss', tr('battle.nopen'))
  } else if (r.type === 'miss') {
    const txt =
      r.reason === 'far'
        ? tr('battle.missFar')
        : r.reason === 'sector'
          ? tr('battle.missSector')
          : r.reason === 'los'
            ? tr('battle.missLos')
            : tr('battle.miss')
    showToast('miss', txt)
  }
}

// --- плавающий джойстик (появляется под пальцем) ---
const joyVisible = ref(false)
const joyOrigin = ref({ x: 0, y: 0 })
const knob = ref({ x: 0, y: 0 })
let joyActive = false
let joyPointer = null
const JOY_R = 52

function joyStart(e) {
  markFirstInput('joystick')
  joyActive = true
  joyPointer = e.pointerId
  joyOrigin.value = { x: e.clientX, y: e.clientY }
  knob.value = { x: 0, y: 0 }
  joyVisible.value = true
  e.currentTarget.setPointerCapture(e.pointerId)
  game.setJoystick(0, 0, true)
}
function joyMove(e) {
  if (!joyActive || e.pointerId !== joyPointer) return
  let dx = e.clientX - joyOrigin.value.x
  let dy = e.clientY - joyOrigin.value.y
  const mag = Math.hypot(dx, dy)
  if (mag > JOY_R) {
    dx = (dx / mag) * JOY_R
    dy = (dy / mag) * JOY_R
  }
  knob.value = { x: dx, y: dy }
  game.setJoystick(dx / JOY_R, dy / JOY_R, true)
}
function joyEnd(e) {
  if (e && joyPointer !== null && e.pointerId !== joyPointer) return
  joyActive = false
  joyPointer = null
  joyVisible.value = false
  game.setJoystick(0, 0, false)
}

function onFire() {
  if (!battleTelemetry.firstShotResult) battleTelemetry.fireTapsBeforeFirstValidShot++
  firedOnce.value = true // выстрелил — убираем обучающую подсказку прицеливания
  haptic('medium') // тап по «огонь» — ощутимая отдача выстрела
  game.fire()
}

// терминальное событие для тех, кто ушёл ДО конца боя. Закрывает перекос
// «battle_finished только у выживших/победителей» (Drop #2 в воронке): теперь у
// каждого боя есть финальное событие — либо battle_finished, либо battle_abandoned.
// НЕ вешаем на visibility/pagehide: кратковременный уход в фон Telegram ≠ выход.
function logAbandon(reason) {
  if (battleTelemetry.abandoned || !battleTelemetry.started) return
  if (phase.value !== 'fighting') return // после matchOver терминал — это battle_finished
  battleTelemetry.abandoned = true
  const s = state.value
  track('battle_abandoned', {
    battle_id: props.net?.room || null,
    match_type: matchType(),
    online: isNet,
    reason, // 'exit_button' — явный выход во время боя
    duration_sec: battleSec(),
    player_alive: s.playerHp > 0,
    died: battleTelemetry.firstDeath, // ушёл после гибели (основной кейс Drop #2)
    result: s.result || 'defeat', // не доиграл = поражение
    mode: s.mode,
    kills: s.kills || 0,
    damage_dealt: s.damageDealt || 0,
    shots: s.shots || 0,
    accuracy: s.accuracy || 0,
    death_count: s.deaths || 0,
    first_shot_result: battleTelemetry.firstShotResult,
    first_death_sec: battleTelemetry.firstDeathSec,
    was_revealed: !!s.revealed,
  })
}

function toHangar() {
  battleTelemetry.exitedEarly = phase.value === 'fighting'
  track('battle_exit_clicked', {
    before_finish: phase.value === 'fighting',
    time_sec: battleSec(),
    player_alive: state.value.playerHp > 0,
    result_known: !!state.value.result,
    match_type: matchType(),
  })
  logAbandon('exit_button') // no-op, если бой уже завершён (phase !== 'fighting')
  // выход до конца матча = поражение в статистику
  if (phase.value === 'fighting' && !statsCounted) {
    statsCounted = true
    addBattleResult('defeat', state.value.kills, {
      score: `${state.value.allyScore}:${state.value.enemyScore}`,
      tank: tankName.value,
      damage: state.value.damageDealt,
    })
  }
  emit('exit', reward.value)
}
function rematch() {
  emit('rematch', reward.value)
}

const RING = 2 * Math.PI * 34
const ringOffset = computed(() => RING * (1 - state.value.reload01))

function startCountdown() {
  phase.value = 'countdown'
  count.value = 3
  game.setPaused(true)
  countTimer = setInterval(() => {
    count.value -= 1
    if (count.value <= 0) {
      clearInterval(countTimer)
      countTimer = null
      phase.value = 'fighting'
      game.setPaused(false)
      markBattleStarted()
      // онлайн: match-end мог прийти ВО ВРЕМЯ отсчёта (сервер ушёл на рестарт) —
      // onState с matchOver тогда отгейтился фазой; переигрываем состояние
      if (isNet) game._emitState()
    }
  }, 800)
}

onMounted(async () => {
  // матчмейкинг ±1 тир: HP/урон/спрайт ботов под тир игрока набирает СЕРВЕР
  // (sim.js anchorTier по msg.tier из Matchmaking). Клиент шлёт только свой тир.
  game.playerTankId = profile.selectedTank // реальный спрайт своей машины
  game.playerCamo = tankCamo(profile.selectedTank) // per-tank камуфляж (перекрашенный спрайт)
  // статы до mount: спрайт игрока выбирается по классу лоадаута
  if (props.loadout) game.setStats(props.loadout)
  else game.setClass(DEFAULT_CLASS)
  const _t0 = performance.now()
  await game.mount(stage.value)
  // лоадер держим минимум 700мс — иначе на кэшированных спрайтах он мелькает и
  // «не виден»; игрок должен застать экран загрузки, а не пустой кадр
  const _el = performance.now() - _t0
  if (_el < 700) await new Promise((r) => setTimeout(r, 700 - _el))
  loading.value = false // спрайты прогружены — снимаем лоадер
  game.setMinimap(minimap.value)
  track('battle_countdown_started', {
    starts_in_ms: 2400,
    online: isNet,
    map_id: isNet ? props.net.mapId : props.mapId,
    mode: isNet ? props.net.mode : props.mode,
  })
  startCountdown() // отсчёт сразу (NetGame рисует мир по мере прихода снапшотов)
  if (isNet) {
    // за 5с не пришло НИ ОДНОГО снапшота — экран «нет связи» с кнопками (не офлайн)
    netWatchdog = setTimeout(() => {
      netWatchdog = null
      if (!game.cur) {
        console.warn('[battle] онлайн-бой: 5с без снапшотов — экран «нет связи»')
        connLost.value = true
      }
    }, 5000)
    // связь оборвалась ПОСРЕДИ боя: NetGame делает 3 попытки вернуться (onReconnecting
    // рисует плашку), исчерпал — onStall → экран «нет связи» с кнопками
    game.onStall = () => {
      console.warn('[battle] онлайн-бой: связь потеряна (попытки исчерпаны) — экран «нет связи»')
      connLost.value = true
    }
  }
})
// диагностика прода: состояние боя доступно из консоли (window.__pz)
window.__pz = game
onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  clearInterval(countTimer)
  clearTimeout(shakeTimer)
  clearTimeout(endTimer)
  clearNetWatchdog()
  // ушли из боя, не докрутив гайд (выход/реванш) — на всякий будим ботов на сервере
  if (isTraining && trainingActive.value) {
    try {
      game.client && game.client.send({ type: 'tutorial-done' })
    } catch {
      /* ок */
    }
  }
  game.destroy()
})
</script>

<template>
  <div class="root" :class="{ shaken: shaking }" :style="{ '--team': teamCol, '--foe': foeCol }">
    <div class="stage" ref="stage"></div>

    <!-- ===== верхний HUD ===== -->
    <div class="top">
      <!-- левая колонка-группа: пауза · карточка матча · точки · фраги/засвет · модули -->
      <div class="hud-left">
        <button class="pausebtn" :disabled="phase !== 'fighting'" @click="pauseGame">
          <PzIcon name="pause" :size="18" />
        </button>

        <!-- карточка матча: таймер + живые экипажи (синие/красные) + тонкая HP -->
        <div class="matchcard">
          <span class="pz-display timer" :class="{ low: state.matchTime <= 60 }">⏱ {{ fmtTime(state.matchTime) }}</span>
          <div class="alive">
            <span class="dmnds"><i v-for="i in 7" :key="'a' + i" :class="{ on: i <= state.alliesAlive }" class="d ally"></i></span>
            <span v-if="!annihilation" class="pz-pixel sc"><b class="ally">{{ state.allyScore }}</b>:<b class="enemy">{{ state.enemyScore }}</b></span>
            <span class="dmnds"><i v-for="i in 7" :key="'e' + i" :class="{ on: i <= state.enemiesAlive }" class="d enemy"></i></span>
          </div>
          <!-- HP-полоска переехала НАД танк (own-HUD, дизайн Макса) — в карточке убрана, чтоб не дублировать -->
        </div>

        <!-- точки захвата / режим -->
        <div v-if="annihilation" class="modetag pz-display">{{ tr('common.modeAnnihilation') }}</div>
        <div v-else-if="state.caps && state.caps.length" class="caps">
          <span v-for="c in state.caps" :key="c.id" class="cap" :class="[c.own, { capping: c.cap && c.cap !== c.own }]">{{ c.id }}<i v-if="c.cap && c.cap !== c.own && c.p > 0" class="capbar"><b :style="{ width: c.p * 100 + '%' }"></b></i></span>
        </div>

        <!-- индикаторы модулей: краснеют с отсчётом починки при крите -->
        <div v-show="phase === 'fighting'" class="modrow">
          <div v-for="m in MOD_HUD" :key="m.id" class="modchip" :class="{ down: state.crippled[m.id] > 0 }">
            <PzIcon :name="m.icon" :size="14" />
            <span v-if="state.crippled[m.id] > 0" class="mt">{{ state.crippled[m.id] }}</span>
          </div>
        </div>
      </div>

      <!-- правая колонка: миникарта + статы боя под ней -->
      <div class="hud-right">
        <canvas class="minimap" ref="minimap" width="240" height="240"></canvas>
        <div v-show="phase === 'fighting'" class="mapstats">
          <span class="ms" :title="tr('battle.tipDamage')"><b>💥</b> {{ state.damageDealt }}</span>
          <span class="ms" :title="tr('battle.tipKills')"><b>💀</b> {{ state.kills }}</span>
          <span class="ms" :title="tr('battle.tipSpotted')"><b>👁</b> {{ state.spotted }}</span>
        </div>
      </div>
    </div>

    <!-- статус видимости (скрыт/засвечен/раскрыт) теперь иконкой ПОД своим танком
         (own-HUD в NetGame, как в дизайне Макса) — верхний чип убран -->


    <!-- захват базы: отсчёт 0-100 -->
    <div v-if="state.enemyBase > 0" class="basecap pz-display" style="color: var(--amber); border-color: var(--amber)">
      {{ tr('battle.baseCapEnemy', { n: state.enemyBase }) }}
    </div>
    <div v-if="state.ourBase > 0" class="basecap ours pz-display">{{ tr('battle.baseCapOurs', { n: state.ourBase }) }}</div>

    <!-- отсчёт удержания всех точек до победы: мы атакуем (mine) — янтарный
         «ПОБЕДА ЧЕРЕЗ N»; теряем — тревожный красный «ОТБЕЙТЕ ТОЧКИ N» -->
    <transition name="wc-pop">
      <div v-if="state.winCount && phase === 'fighting'" class="wincount" :class="{ foe: !state.winCount.mine }">
        <div class="wc-label pz-display">{{ tr(state.winCount.mine ? 'battle.winHoldMine' : 'battle.winHoldFoe') }}</div>
        <div class="wc-sec pz-pixel">{{ state.winCount.sec }}</div>
      </div>
    </transition>

    <!-- индикатор направления урона: красная дуга у танка «откуда прилетело» -->
    <div v-show="phase === 'fighting' && state.playerHp > 0" class="dmg-dirs">
      <div v-for="d in dmgDirs" :key="d.key" class="dmg-dir" :style="{ transform: `rotate(${d.angle}rad)` }">
        <i class="dd-arc"></i>
      </div>
    </div>

    <!-- килл-фид -->
    <div class="feed">
      <div v-for="f in feed" :key="f.key" class="feed-row"><span style="color: var(--amber)">{{ tr('battle.you') }}</span> ▸ {{ f.text }}</div>
    </div>

    <!-- награды за действия: засвет/захват -->
    <div class="actfeed">
      <transition-group name="pop">
        <div v-for="f in actionFeed" :key="f.key" class="actfeed-row pz-display">{{ f.text }} <span class="ax">+{{ f.xp }} {{ tr('common.xp') }}</span></div>
      </transition-group>
    </div>

    <transition name="pop">
      <div v-if="toast" class="toast pz-display" :class="toast.kind">{{ toast.text }}</div>
    </transition>

    <!-- ЭКРАН СМЕРТИ 2.0: причина + понятные действия (не тупик «наблюдение») -->
    <transition name="fade">
      <div v-if="phase === 'fighting' && state.playerHp <= 0 && !deathDismissed" class="overlay death">
        <div class="death-card pz-plate pz-brackets" style="--bk: var(--red)">
          <div class="death-title pz-display">{{ tr('battle.youDestroyed') }}</div>
          <div v-if="deathCause" class="death-cause">{{ deathCause }}</div>
          <div class="death-actions">
            <button class="pz-btn2" @click="deathDismissed = true">{{ tr('battle.deathObserve') }}</button>
            <button class="pz-cta pz-cta--hazard" style="padding: 12px" @click="toHangar">{{ tr('battle.deathExit') }}</button>
          </div>
        </div>
      </div>
    </transition>
    <!-- наблюдение после закрытия экрана смерти — компактная плашка с выходом -->
    <div v-if="phase === 'fighting' && state.playerHp <= 0 && deathDismissed" class="obs-chip">
      <span class="pz-display">{{ tr('battle.observing') }}</span>
      <button class="obs-exit" @click="toHangar">{{ tr('battle.obsExit') }}</button>
    </div>

    <!-- связь просела (сокет жив) — ждём снапшоты, бой идёт на сервере -->
    <div v-if="reconnecting && !state.matchOver" class="reconnect pz-display">
      <span class="rc-spin"></span> {{ tr('battle.reconnecting') }}
    </div>

    <!-- связь окончательно потеряна (исчерпаны попытки) — кнопки, без офлайна -->
    <div v-if="connLost" class="overlay connlost">
      <div class="pz-plate pz-brackets cl-plate" style="--bk: var(--red)">
        <div class="pz-stencil-h" style="justify-content: center; color: var(--red)">{{ tr('battle.connLost') }}</div>
        <p class="cl-text">{{ tr('battle.connLostText') }}</p>
        <button class="pz-cta" style="font-size: 15px; padding: 13px" @click="emit('rematch')">{{ tr('common.retry') }}</button>
        <button class="pz-btn2" @click="emit('exit')">{{ tr('common.toHangar') }}</button>
      </div>
    </div>

    <!-- зона движения: джойстик появляется под пальцем. После гибели джойстик
         водит камеру наблюдения по карте (огонь скрыт, движок панорамирует) -->
    <div
      v-show="phase === 'fighting' && !paused"
      class="movezone"
      @pointerdown="joyStart"
      @pointermove="joyMove"
      @pointerup="joyEnd"
      @pointercancel="joyEnd"
    >
      <!-- статичная подсказка джойстика, пока палец не на экране -->
      <div v-if="!joyVisible" class="joy-hint">
        <div class="joy-dash"></div>
        <div class="joy-knob"></div>
      </div>
      <div v-if="joyVisible" class="joy-float" :style="{ left: joyOrigin.x + 'px', top: joyOrigin.y + 'px' }">
        <div class="joy-dash"></div>
        <div class="joy-knob live" :style="{ transform: `translate(${knob.x}px, ${knob.y}px)` }"></div>
      </div>
    </div>

    <!-- выбор снаряда (в онлайне снаряд решает сервер — голды пока нет) -->
    <button
      v-show="!isNet && phase === 'fighting' && !paused && state.playerHp > 0"
      class="ammo pz-display"
      :class="{ gold: ammo === 'gold' }"
      @click="toggleAmmo"
    >
      <template v-if="ammo === 'gold'">{{ tr('battle.ammoGold', { n: profile.goldAmmo }) }}</template>
      <template v-else>{{ tr('battle.ammoAP') }} <span style="opacity: 0.6">· ★{{ profile.goldAmmo }}</span></template>
    </button>

    <!-- подсказка прицеливания в первом бою: учим ловить зелёный «захват» -->
    <transition name="fade">
      <div v-if="firstBattle && !firedOnce && !isTraining && phase === 'fighting' && state.playerHp > 0" class="aim-hint pz-display">
        {{ tr('battle.aimPre') }}<b>{{ tr('battle.fire') }}</b>{{ tr('battle.aimMid') }}<b class="g">{{ tr('battle.green') }}</b>
      </div>
    </transition>

    <!-- ГАЙД ПЕРВОГО БОЯ (тренировка): враги заморожены сервером, ведём «едь → целься
         → огонь» поверх живого боя. Завершил/пропустил → будим ботов (finishTraining) -->
    <TrainingGuide
      v-if="isTraining && trainingActive && phase === 'fighting' && !paused && state.playerHp > 0"
      :game="game"
      @done="finishTraining"
      @skip="finishTraining"
    />

    <!-- ОГОНЬ -->
    <button v-show="phase === 'fighting' && !paused && state.playerHp > 0" class="fire" :class="{ cold: !state.ready, locked: state.aimLock }" @pointerdown.prevent="onFire">
      <svg class="ring" width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r="34" class="ring-bg" />
        <circle cx="46" cy="46" r="34" class="ring-fg" :stroke-dasharray="RING" :stroke-dashoffset="ringOffset" />
      </svg>
      <span class="pz-display flabel">{{ state.ready ? tr('battle.fire') : state.reloadLeft.toFixed(1) + tr('battle.secShort') }}</span>
    </button>

    <!-- стартовый отсчёт -->
    <transition name="fade">
      <div v-if="phase === 'countdown'" class="overlay countdown">
        <div class="cd-num pz-display">{{ count > 0 ? count : tr('battle.go') }}</div>
        <div class="cd-sub">
          {{ mapName }} · {{ tr('battle.youOn') }}<b :style="{ color: teamCol }">{{ mySide === 1 ? tr('battle.sideRed') : tr('battle.sideBlue') }}</b>
          <template v-if="isNet">{{ tr('battle.onlineSuffix') }}</template>
        </div>
        <div class="cd-sub">{{ annihilation ? tr('battle.toLast') : tr('battle.toScore', { n: state.scoreLimit }) }} · {{ fmtTime(state.matchTime) }}</div>
      </div>
    </transition>

    <!-- пауза -->
    <div v-if="paused" class="overlay pause">
      <div class="pz-plate pz-brackets pauseplate" style="--bk: var(--amber)">
        <div class="pz-stencil-h" style="justify-content: center">{{ tr('battle.pause') }}</div>
        <button class="pz-cta" style="font-size: 16px; padding: 13px 16px" @click="resumeGame">{{ tr('common.continue') }}</button>
        <button class="pz-btn2" @click="toHangar">{{ tr('battle.leaveBattle') }}</button>
      </div>
    </div>

    <!-- БАННЕР КОНЦА БОЯ: причина крупно, ПЕРЕД донесением (не вываливаем модалку резко) -->
    <transition name="fade">
      <div v-if="phase === 'ending'" class="overlay endbanner">
        <div class="eb-title pz-display" :style="{ color: endBanner.color }">{{ endBanner.title }}</div>
        <div v-if="endBanner.sub" class="eb-sub pz-display">{{ endBanner.sub }}</div>
      </div>
    </transition>

    <!-- результат: боевое донесение -->
    <transition name="fade">
      <div v-if="phase === 'result'" class="overlay result">
        <Results :state="state" :reward="reward" @rematch="rematch" @hangar="toHangar" />
      </div>
    </transition>

    <!-- лоадер: пока грузятся спрайты — игрок заходит на готовенькое -->
    <transition name="fade">
      <div v-if="loading" class="overlay loader">
        <div class="ld-spin"></div>
        <div class="pz-display ld-text">{{ tr('battle.loadTitle') }}</div>
        <div class="ld-sub">{{ tr('battle.loadSub') }}</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.root {
  position: absolute; /* внутри портретной колонки #app, не во всё окно (портретный замок) */
  inset: 0;
  overflow: hidden;
  background: #0c0f0a;
}
.root.shaken {
  animation: pz-shake 0.3s linear;
}
.death {
  z-index: 7;
  background: radial-gradient(60% 50% at 50% 45%, rgba(40, 6, 6, 0.55), rgba(0, 0, 0, 0.5));
}
.death-card {
  width: min(86%, 320px);
  padding: 20px 18px 16px;
  text-align: center;
  animation: pz-pop 0.28s ease;
}
.death-title {
  font-size: 24px;
  letter-spacing: 0.12em;
  color: var(--red);
}
.death-cause {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-dim);
  line-height: 1.35;
}
.death-actions {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 18px;
}
.endbanner {
  z-index: 7;
  pointer-events: none;
  background: radial-gradient(60% 45% at 50% 45%, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.25));
}
.eb-title {
  font-size: 34px;
  letter-spacing: 0.1em;
  text-align: center;
  padding: 0 18px;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.7);
  animation: cd-pop 0.5s ease-out;
}
.eb-sub {
  margin-top: 8px;
  font-size: 13px;
  letter-spacing: 0.14em;
  color: var(--ink-dim);
  text-align: center;
  animation: pz-slide-up 0.4s ease 0.15s both;
}
.obs-chip {
  position: absolute;
  top: calc(var(--safe-top) + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  padding: 6px 8px 6px 12px;
}
.obs-chip .pz-display {
  font-size: 12px;
  letter-spacing: 0.16em;
  color: var(--ink-dim);
}
.obs-exit {
  font-size: 11px;
  font-weight: 700;
  color: var(--amber);
  background: rgba(242, 165, 12, 0.12);
  border: 1px solid var(--amber);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.spotchip {
  align-self: center;
  margin-top: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 11px;
  border-radius: 11px;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}
/* СКРЫТ — в тени, зелёный (безопасно) */
.spotchip.hidden {
  color: #7fd06a;
  background: rgba(95, 211, 95, 0.1);
  border: 1px solid rgba(95, 211, 95, 0.4);
}
/* ЗАСВЕЧЕН — враг видит по обзору, янтарь (внимание) */
.spotchip.spotted {
  color: var(--amber-hi);
  background: rgba(242, 165, 12, 0.14);
  border: 1px solid rgba(242, 165, 12, 0.55);
}
/* РАСКРЫТ — сам себя выдал выстрелом, красный мигающий (опасно) */
.spotchip.revealed {
  color: #ff8a7a;
  background: rgba(226, 75, 74, 0.16);
  border: 1px solid rgba(226, 75, 74, 0.6);
  animation: pz-blink 1.1s linear infinite;
}
.reconnect {
  position: absolute;
  top: 42%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  letter-spacing: 0.14em;
  color: var(--amber);
  background: rgba(0, 0, 0, 0.62);
  border: 1px solid var(--amber);
  border-radius: 8px;
  padding: 9px 16px;
  white-space: nowrap;
  z-index: 5;
  pointer-events: none;
  animation: pz-pop 0.2s ease;
}
.rc-spin {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid rgba(242, 165, 12, 0.3);
  border-top-color: var(--amber);
  animation: rc-rot 0.7s linear infinite;
}
@keyframes rc-rot {
  to {
    transform: rotate(360deg);
  }
}
.stage {
  position: absolute;
  inset: 0;
}

/* ===== верхний HUD ===== */
.top {
  position: absolute;
  top: calc(var(--safe-top) + 8px);
  left: calc(var(--safe-left) + 12px);
  right: calc(var(--safe-right) + 12px);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  z-index: 3;
}
.pausebtn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  color: var(--ink-dim);
  cursor: pointer;
}
.pausebtn:disabled {
  opacity: 0.4;
}
.mid-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
/* ===== редизайн HUD: левая колонка-группа ===== */
.hud-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.matchcard {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  padding: 6px 9px;
}
.matchcard .timer {
  font-size: 14px;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.matchcard .timer.low {
  color: var(--red);
  animation: pz-blink 1s linear infinite;
}
.alive {
  display: flex;
  align-items: center;
  gap: 6px;
}
.alive .sc {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
}
.alive .sc .ally {
  color: var(--team);
}
.alive .sc .enemy {
  color: var(--foe);
}
.hpmini {
  width: 100%;
  height: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
}
.hpmini i {
  display: block;
  height: 100%;
  transition: width 0.2s ease;
}
.combaticons {
  display: flex;
  gap: 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  padding-left: 2px;
}
.combaticons .cic {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.top-chip {
  position: absolute;
  top: calc(var(--safe-top, 0px) + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
}
.hud-right {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}
.mapstats {
  width: 96px;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 3px 6px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 5px 7px;
}
.mapstats .ms {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.mapstats .ms b {
  font-size: 11px;
  font-weight: 400;
}
.scoreplate {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 5px 10px;
  align-self: center; /* по контенту и по центру — иначе на широком экране счёт уезжает к краям */
  max-width: 100%;
  overflow: hidden; /* числа теперь у таймера (внутри) и не сжимаются; если узко — */
  /* подрезается крайний ромбик по скруглению, а не выезжает цифра счёта за край */
}
.scoreplate .side {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* числа счёта не сжимаются: при нехватке места отдаём пиксели зазорам, а не
   выдавливаем цифры за скруглённый край плашки */
.scoreplate .num {
  flex-shrink: 0;
}
.scoreplate .side.left {
  justify-content: flex-end;
}
.scoreplate .side.right {
  justify-content: flex-start;
}
.scoreplate .timer {
  flex-shrink: 0;
}
.scoreplate .num {
  font-size: 13px;
}
.scoreplate .num.ally {
  color: var(--team);
}
.scoreplate .num.enemy {
  color: var(--foe);
}
.scoreplate .timer {
  font-size: 14px;
  color: var(--ink);
  letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.scoreplate .timer.low {
  color: var(--red);
  animation: pz-blink 1s linear infinite;
}
.caps {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}
.modetag {
  text-align: center;
  margin-top: 4px;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--amber);
  opacity: 0.92;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
}
.cap {
  position: relative;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-family: var(--font-display);
  font-size: 11px;
  color: var(--ink);
  background: rgba(0, 0, 0, 0.55);
  border: 1.5px solid var(--ink-faint);
}
.cap.ally {
  border-color: var(--team);
  background: color-mix(in oklab, var(--team) 25%, rgba(0, 0, 0, 0.55));
}
.cap.enemy {
  border-color: var(--foe);
  background: color-mix(in oklab, var(--foe) 25%, rgba(0, 0, 0, 0.55));
}
.cap.capping {
  animation: pz-blink 0.7s linear infinite;
}
.cap .capbar {
  position: absolute;
  left: 1px;
  right: 1px;
  bottom: -4px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
}
.cap .capbar b {
  display: block;
  height: 100%;
  background: var(--amber);
}
.dmnds {
  display: flex;
  gap: 2px;
}
.dmnds .d {
  width: 6px;
  height: 6px;
  border-radius: 1px;
  transform: rotate(45deg);
  background: rgba(255, 255, 255, 0.12);
}
.dmnds .d.ally.on {
  background: var(--team);
}
.dmnds .d.enemy.on {
  background: var(--foe);
}
.hpbar {
  position: relative;
  height: 16px;
  /* центрируем и ограничиваем ширину — иначе на широком экране (ПК/ландшафт)
     HP-бар тянется во всю ширину и наезжает влево на инфо-плашку урона */
  align-self: center;
  width: 100%;
  max-width: 320px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  overflow: hidden;
}
.hp-fill {
  height: 100%;
  transition: width 0.3s ease;
  -webkit-mask: repeating-linear-gradient(90deg, #000 0 8.5%, transparent 8.5% 10%);
  mask: repeating-linear-gradient(90deg, #000 0 8.5%, transparent 8.5% 10%);
}
.hp-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  letter-spacing: 0.15em;
  color: var(--ink);
  text-shadow: 0 1px 2px #000;
}
.minimap {
  width: 96px;
  height: 96px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  opacity: 0.92;
}

/* индикаторы критов */
.modrow {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin-top: 1px;
  pointer-events: none;
}
.modchip {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 7px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line);
  color: var(--ink-faint);
  opacity: 0.6;
  transition:
    opacity 0.15s,
    background 0.15s;
}
.modchip.down {
  opacity: 1;
  color: #ffd1d1;
  background: rgba(194, 47, 29, 0.4);
  border-color: var(--red);
}
.modchip .mt {
  font-size: 11px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* захват базы */
.basecap {
  position: absolute;
  top: calc(var(--safe-top) + 112px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  letter-spacing: 0.12em;
  padding: 6px 14px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  white-space: nowrap;
  z-index: 3;
  pointer-events: none;
  animation: pz-blink 1.4s linear infinite;
}
.basecap.ours {
  top: calc(var(--safe-top) + 148px);
  color: var(--red);
  border-color: var(--red);
}

/* отсчёт удержания всех точек до победы — крупный баннер по центру сверху */
.wincount {
  position: absolute;
  top: 23%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 24px;
  border-radius: 14px;
  background: rgba(8, 12, 6, 0.82);
  border: 2px solid var(--amber);
  box-shadow:
    0 8px 26px rgba(0, 0, 0, 0.55),
    0 0 0 4px rgba(0, 0, 0, 0.22);
  text-align: center;
  pointer-events: none;
  white-space: nowrap;
}
.wincount.foe {
  border-color: var(--red);
  animation: wc-alarm 0.9s ease-in-out infinite;
}
.wc-label {
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--amber);
}
.wincount.foe .wc-label {
  color: var(--red);
}
.wc-sec {
  font-size: 30px;
  line-height: 1;
  color: #fff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
  animation: wc-pulse 1s ease-in-out infinite;
}
@keyframes wc-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.12);
    opacity: 0.82;
  }
}
@keyframes wc-alarm {
  0%,
  100% {
    box-shadow:
      0 8px 26px rgba(0, 0, 0, 0.55),
      0 0 0 4px rgba(193, 39, 39, 0.18);
  }
  50% {
    box-shadow:
      0 8px 26px rgba(0, 0, 0, 0.55),
      0 0 0 7px rgba(193, 39, 39, 0.42);
  }
}
.wc-pop-enter-active {
  transition:
    transform 0.32s cubic-bezier(0.2, 1.4, 0.4, 1),
    opacity 0.32s ease;
}
.wc-pop-leave-active {
  transition:
    transform 0.22s ease,
    opacity 0.22s ease;
}
.wc-pop-enter-from {
  opacity: 0;
  transform: translateX(-50%) scale(0.6);
}
.wc-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) scale(0.9);
}

/* индикатор направления урона — якорь в экранной позиции танка (50% / 66%) */
.dmg-dirs {
  position: absolute;
  left: 50%;
  top: 66%;
  width: 0;
  height: 0;
  z-index: 6;
  pointer-events: none;
}
.dmg-dir {
  position: absolute;
  left: 0;
  top: 0;
}
/* красная дуга-сегмент (~70°) у верха кольца (= спереди); поворот .dmg-dir целит
   её на стрелявшего. conic — узкий красный сектор сверху, маска — только обод */
.dd-arc {
  position: absolute;
  width: 196px;
  height: 196px;
  left: -98px;
  top: -98px;
  border-radius: 50%;
  background: conic-gradient(
    rgba(255, 72, 46, 0.95) 0deg 34deg,
    transparent 34deg 326deg,
    rgba(255, 72, 46, 0.95) 326deg 360deg
  );
  -webkit-mask: radial-gradient(circle, transparent 80px, #000 82px);
  mask: radial-gradient(circle, transparent 80px, #000 82px);
  filter: drop-shadow(0 0 6px rgba(255, 48, 26, 0.8));
  animation: dd-fade 0.85s ease-out forwards;
}
@keyframes dd-fade {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  16% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(1.08);
  }
}

/* килл-фид */
.feed {
  position: absolute;
  top: calc(var(--safe-top) + 112px);
  left: calc(var(--safe-left) + 12px);
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
  z-index: 3;
}
.feed-row {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-dim);
  background: rgba(0, 0, 0, 0.5);
  padding: 3px 8px;
  border-radius: 4px;
  border-left: 2px solid var(--amber);
  animation: pz-slide-up 0.25s ease;
}

/* награды за действия (засвет/захват) — под счётом, по центру сверху */
.actfeed {
  position: absolute;
  top: calc(var(--safe-top) + 188px);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
  z-index: 3;
}
.actfeed-row {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--ink);
  background: rgba(0, 0, 0, 0.55);
  padding: 4px 12px;
  border-radius: 14px;
  border: 1px solid var(--green);
}
.actfeed-row .ax {
  color: var(--green);
  font-size: 11px;
}

.toast {
  position: absolute;
  top: 38%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 28px;
  letter-spacing: 0.08em;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  z-index: 4;
}
.toast.hit {
  color: var(--green);
}
.toast.miss {
  color: var(--red);
}
.pop-enter-active {
  transition: all 0.12s ease-out;
}
.pop-leave-active {
  transition: all 0.4s ease-in;
}
.pop-enter-from {
  opacity: 0;
  transform: translate(-50%, -40%) scale(0.7);
}
.pop-leave-to {
  opacity: 0;
  transform: translate(-50%, -65%) scale(1.1);
}

/* ===== управление ===== */
/* джойстик появляется там, где палец коснулся экрана — зона на весь бой;
   кнопки (огонь/снаряд/пауза) лежат выше по z-index и перехватывают свои тапы */
.movezone {
  position: absolute;
  inset: 0;
  z-index: 1;
  touch-action: none;
}
.joy-hint {
  position: absolute;
  left: calc(var(--safe-left) + 22px);
  bottom: calc(var(--safe-bottom) + 26px);
  width: 108px;
  height: 108px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.75;
  pointer-events: none;
}
.joy-float {
  position: fixed;
  width: 120px;
  height: 120px;
  margin-left: -60px;
  margin-top: -60px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.joy-dash {
  position: absolute;
  inset: 26px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.12);
}
.joy-knob {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: linear-gradient(180deg, #2c3326, #181d15);
  border: 1px solid var(--line-strong);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.6);
}
.joy-knob.live {
  background: linear-gradient(180deg, var(--amber-hi), var(--amber-deep));
  border-color: #1d1604;
}

.ammo {
  position: absolute;
  right: calc(var(--safe-right) + 22px);
  bottom: calc(var(--safe-bottom) + 128px);
  padding: 7px 12px;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--ink-dim);
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  cursor: pointer;
  z-index: 3;
}
.ammo.gold {
  color: #1d1604;
  background: linear-gradient(180deg, var(--amber-hi), var(--amber));
  border-color: transparent;
  box-shadow: 0 0 14px rgba(242, 165, 12, 0.45);
}
.fire {
  position: absolute;
  right: calc(var(--safe-right) + 22px);
  bottom: calc(var(--safe-bottom) + 26px);
  width: 92px;
  height: 92px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: radial-gradient(circle at 35% 30%, var(--red), var(--red-deep));
  box-shadow:
    0 0 26px rgba(255, 75, 51, 0.4),
    0 6px 0 #6e1a0e;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
  z-index: 3;
  transition: all 0.15s ease;
}
.fire.cold {
  background: radial-gradient(circle at 35% 30%, #4a4f42, #23271e);
  box-shadow: none;
  transform: translateY(4px);
}
/* «захват»: ствол готов и линия сведения легла на цель — кнопка зеленеет и
   пульсирует, синхронно с зелёной линией в поле: явный сигнал «жми ОГОНЬ» */
.fire.locked {
  background: radial-gradient(circle at 35% 30%, #57e69a, #1f9d63);
  box-shadow:
    0 0 32px rgba(70, 224, 138, 0.6),
    0 6px 0 #146b41;
  animation: firepulse 0.5s ease-in-out infinite;
}
@keyframes firepulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.07);
  }
}
.aim-hint {
  position: absolute;
  left: 50%;
  bottom: calc(var(--safe-bottom) + 132px);
  transform: translateX(-50%);
  max-width: 280px;
  text-align: center;
  font-size: 12px;
  line-height: 1.4;
  letter-spacing: 0.02em;
  color: var(--ink-dim);
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 8px 12px;
  z-index: 3;
  pointer-events: none;
}
.aim-hint b {
  color: #fff;
  font-weight: 700;
}
.aim-hint b.g {
  color: #57e69a;
}
.fire .flabel {
  position: relative;
  z-index: 1;
  font-size: 14px;
  letter-spacing: 0.1em;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.fire.cold .flabel {
  color: rgba(255, 255, 255, 0.35);
}
.ring {
  position: absolute;
  inset: 0;
  margin: auto;
  transform: rotate(-90deg);
}
.ring-bg {
  fill: none;
  stroke: rgba(0, 0, 0, 0.3);
  stroke-width: 4;
}
.ring-fg {
  fill: none;
  stroke: var(--amber-hi);
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.06s linear;
}

/* ===== оверлеи ===== */
.overlay {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.countdown {
  pointer-events: none;
  background: radial-gradient(60% 40% at 50% 50%, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.15));
}
.cd-num {
  font-size: 72px;
  color: var(--amber);
  text-shadow: 0 0 30px rgba(242, 165, 12, 0.5);
  animation: cd-pop 0.8s ease-out;
}
.cd-sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--ink-dim);
  font-weight: 500;
  letter-spacing: 0.06em;
}
.loader {
  z-index: 8;
  background: #0e1116;
}
.ld-spin {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 3px solid rgba(242, 165, 12, 0.18);
  border-top-color: var(--amber);
  animation: rc-rot 0.8s linear infinite;
}
.ld-text {
  margin-top: 16px;
  font-size: 16px;
  letter-spacing: 0.14em;
  color: var(--amber);
}
.ld-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-dim);
  font-weight: 500;
}
.combatinfo {
  position: absolute;
  /* ниже центрального блока HUD (счёт/точки/HP/модули): на узкой портретной
     колонке центрированный HP-бар занимает всю ширину и пересёкся бы с этой
     панелью по вертикали — поэтому уводим её под кластер, слева над полем */
  top: calc(var(--safe-top) + 150px);
  left: calc(var(--safe-left) + 12px);
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 9px;
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  pointer-events: none;
}
.ci-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 96px;
}
.ci-l {
  font-size: 8px;
  letter-spacing: 0.1em;
  font-weight: 700;
  color: var(--ink-faint);
}
.ci-v {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.ci-v.dmg {
  color: var(--amber);
}
@keyframes cd-pop {
  0% {
    transform: scale(1.6);
    opacity: 0;
  }
  30% {
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.pause {
  background: rgba(5, 7, 4, 0.78);
  backdrop-filter: blur(3px);
}
.pauseplate {
  width: 270px;
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: pz-pop 0.25s ease;
}
.connlost {
  z-index: 9;
  background: rgba(6, 8, 5, 0.86);
  backdrop-filter: blur(3px);
}
.cl-plate {
  width: 280px;
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: pz-pop 0.25s ease;
}
.cl-text {
  margin: 2px 0 6px;
  font-size: 12.5px;
  line-height: 1.5;
  font-weight: 500;
  color: var(--ink-dim);
  text-align: center;
}

.result {
  background: rgba(6, 9, 14, 0.72);
  backdrop-filter: blur(6px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
