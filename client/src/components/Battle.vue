<script setup>
// Боевой HUD (порт BattleScreen поверх живого Pixi-боя): счёт с ромбиками живых,
// HP-полоса с именем машины, миникарта, килл-фид, индикаторы критов, пауза,
// плавающий джойстик и hazard-кнопка ОГОНЬ с кольцом перезарядки.
import { ref, shallowRef, onMounted, onBeforeUnmount, computed } from 'vue'
import { Game } from '../game/Game.js'
import { NetGame } from '../game/NetGame.js'
import { MAP_BY_ID, MAPS } from '../game/maps.js'
import { DEFAULT_CLASS, CRIT_LABELS } from '../game/config.js'
import { profile, spendGoldAmmo, addBattleResult, tankCamo } from '../store.js'
import { TANK_BY_ID, TANKS, combatStats, GOLD_AMMO_MULT } from '../game/meta.js'
import { haptic } from '../tg.js'
import Results from './Results.vue'
import PzIcon from './ui/PzIcon.vue'

const props = defineProps({
  loadout: { type: Object, default: null },
  mapId: { type: String, default: '' },
  side: { type: Number, default: 0 }, // 0 — юг (синие), 1 — север (красные)
  mode: { type: String, default: 'capture' }, // 'capture' | 'annihilation' — для офлайн-боя
  net: { type: Object, default: null }, // онлайн-матч: { client, mapId, side, youUnit, tickHz, mode }
  instant: { type: Boolean, default: false }, // авто-откат онлайн→офлайн: сразу в бой, без отсчёта
})
const emit = defineEmits(['exit', 'rematch', 'netfail'])

const stage = ref(null)
const minimap = ref(null)
const isNet = !!props.net
const game = isNet ? new NetGame(props.net) : new Game({ mapId: props.mapId, side: props.side, mode: props.mode })

// цвета команд в HUD: своя/чужая зависят от жребия стороны (онлайн — от сервера)
const mySide = isNet ? props.net.side : props.side
const teamCol = computed(() => (mySide === 1 ? 'var(--red)' : 'var(--blue)'))
const foeCol = computed(() => (mySide === 1 ? 'var(--blue)' : 'var(--red)'))
const mapName = computed(() => (MAP_BY_ID[isNet ? props.net.mapId : props.mapId] || MAPS[0]).name)

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
  classId: DEFAULT_CLASS,
  damageDealt: 0,
  spotted: 0,
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
// баннер конца боя: ПОЧЕМУ бой кончился (причина крупно) + исход — перед донесением
const endBanner = computed(() => {
  const r = state.value.result // 'victory'|'defeat'|'draw'
  const reason = state.value.endReason
  const win = r === 'victory'
  const resWord = win ? 'ПОБЕДА' : r === 'defeat' ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ'
  const color = reason === 'aborted' ? 'var(--amber)' : win ? 'var(--green)' : r === 'defeat' ? 'var(--red)' : 'var(--amber)'
  let title = resWord
  let sub = ''
  switch (reason) {
    case 'caps':
      title = win ? 'ТОЧКИ ЗАХВАЧЕНЫ' : 'ТОЧКИ ПОТЕРЯНЫ'
      sub = win ? 'ЗАДАЧА ВЫПОЛНЕНА · ' + resWord : resWord
      break
    case 'wipe':
      title = win ? 'ПРОТИВНИК УНИЧТОЖЕН' : 'ВЗВОД УНИЧТОЖЕН'
      sub = win ? 'ЗАДАЧА ВЫПОЛНЕНА · ' + resWord : resWord
      break
    case 'score':
      title = win ? 'ЛИМИТ ОЧКОВ ВЗЯТ' : 'ВРАГ НАБРАЛ ЛИМИТ'
      sub = resWord
      break
    case 'time':
      title = 'ВРЕМЯ ВЫШЛО'
      sub = resWord
      break
    case 'aborted':
      title = 'БОЙ ПРЕРВАН'
      sub = 'сервер обновляется'
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
  const cls = d.cls === 'light' ? 'лёгкий' : d.cls === 'heavy' ? 'тяжёлый' : d.cls === 'medium' ? 'средний' : ''
  return `Уничтожил ${d.by}${cls ? ` · ${cls}` : ''}${d.dir ? ` · удар ${d.dir}` : ''}`
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
  paused.value = true
  game.setPaused(true)
}
function resumeGame() {
  paused.value = false
  game.setPaused(false)
}

let prevKills = 0
let prevDeaths = 0

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

// сторож онлайн-старта: если за 8с не пришёл ни один снапшот сервера —
// откатываемся в бой с ботами, чтобы не висеть вечно на 0:00 (фриз у части
// WebKit-клиентов). Снимается, как только пришли первые данные мира.
let netWatchdog = null
function clearNetWatchdog() {
  clearTimeout(netWatchdog)
  netWatchdog = null
}

// снапшоты просели, но сокет жив (короткий iOS-затык на старте боя) — показываем
// плашку и ЖДЁМ возобновления, не сваливаясь в офлайн. Снимается, как пошли данные.
const reconnecting = ref(false)
if (isNet) game.onReconnecting = (on) => (reconnecting.value = on)

let statsCounted = false // статистика матча банкается один раз
game.onState = (s) => {
  // пришли данные мира — снимаем сторож «нет связи»
  if (isNet && game.cur) clearNetWatchdog()
  if (s.kills > prevKills) showToast('hit', 'УНИЧТОЖЕН')
  if (s.deaths > prevDeaths) {
    showToast('miss', 'ВЫ УНИЧТОЖЕНЫ')
    deathDismissed.value = false // новая смерть — показываем экран смерти
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
  return {
    xp: (win ? 200 : draw ? 120 : 80) + s.kills * 45 + s.hits * 4 + (s.bonusXp || 0),
    silver: (win ? 260 : draw ? 150 : 100) + s.kills * 45 + Math.round(s.allyScore * 6),
    kills: s.kills,
    allyScore: s.allyScore,
    // для задач дня
    damage: s.damageDealt || 0,
    lightKills: s.lightKills || 0,
    blocked: s.blocked || 0,
    victory: win,
    survived: !s.deaths, // одна жизнь: дожил до конца боя
  }
})

// --- выбор снаряда: обычный / голдовый (урон ×GOLD_AMMO_MULT, тратится) ---
const ammo = ref('std')
function toggleAmmo() {
  if (ammo.value === 'std' && profile.goldAmmo <= 0) return
  ammo.value = ammo.value === 'std' ? 'gold' : 'std'
  game.ammoMult = ammo.value === 'gold' ? GOLD_AMMO_MULT : 1
}
// корректные по роду/числу фразы повреждений модулей
const CRIT_PHRASE = {
  gun: 'ПУШКА ПОВРЕЖДЕНА',
  turret: 'БАШНЯ ПОВРЕЖДЕНА',
  engine: 'ДВИГАТЕЛЬ ПОВРЕЖДЁН',
  tracks: 'ГУСЕНИЦЫ ПОВРЕЖДЕНЫ',
  radio: 'РАЦИЯ ПОВРЕЖДЕНА',
}
game.onCrit = (slot) => {
  showToast('miss', CRIT_PHRASE[slot] || `${CRIT_LABELS[slot]} ПОВРЕЖДЕНА`)
}
game.onSaved = (kind) => {
  showToast('hit', kind === 'ricochet' ? 'РИКОШЕТ ОТ БРОНИ' : 'БРОНЯ НЕ ПРОБИТА')
}
game.onShot = (r) => {
  if (r.type === 'ram') {
    haptic('rigid') // таран — жёсткий толчок
    showToast('hit', 'ТАРАН!')
    return
  }
  if (r.type === 'blocked') {
    if (r.reason === 'gun') showToast('miss', 'ПУШКА ЗАКЛИНИЛА')
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
    showToast('hit', 'ПРОБИТИЕ')
  } else if (r.type === 'ricochet') {
    haptic('light') // снаряд лизнул броню — лёгкий тик
    showToast('miss', 'РИКОШЕТ')
  } else if (r.type === 'nopen') {
    haptic('light') // попал, но не пробил — лёгкий тик
    showToast('miss', 'НЕ ПРОБИЛ')
  } else if (r.type === 'miss') {
    const txt =
      r.reason === 'far'
        ? 'ДАЛЕКО'
        : r.reason === 'sector'
          ? 'ВНЕ СЕКТОРА'
          : r.reason === 'los'
            ? 'НЕТ ОБЗОРА'
            : 'МИМО'
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
  haptic('medium') // тап по «огонь» — ощутимая отдача выстрела
  game.fire()
}

function toHangar() {
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
      // онлайн: match-end мог прийти ВО ВРЕМЯ отсчёта (сервер ушёл на рестарт) —
      // onState с matchOver тогда отгейтился фазой; переигрываем состояние
      if (isNet) game._emitState()
    }
  }, 800)
}

onMounted(async () => {
  // матчмейкинг ±1 тир: боты — конкретные танки соседних уровней
  const myTier = (TANK_BY_ID[profile.selectedTank] || {}).tier || 1
  const pool = TANKS.filter((t) => Math.abs(t.tier - myTier) <= 1).map((t) => ({ ...combatStats(t), tankId: t.id }))
  game.setBotTanks(pool)
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
  if (props.instant) {
    // авто-откат в офлайн: без отсчёта, сразу в бой
    phase.value = 'fighting'
    game.setPaused(false)
  } else {
    startCountdown() // отсчёт сразу — и в онлайне (NetGame рисует мир по мере прихода снапшотов)
  }
  if (isNet) {
    // если за 5с не пришло НИ ОДНОГО снапшота — авто-откат в бой с ботами
    // (мгновенно, без второго отсчёта). Игрок никогда не залипает на «нет связи».
    netWatchdog = setTimeout(() => {
      netWatchdog = null
      if (!game.cur) {
        console.warn('[battle] онлайн-бой: 5с без снапшотов — авто-откат в офлайн с ботами')
        emit('netfail')
      }
    }, 5000)
    // связь оборвалась ПОСРЕДИ боя (снапшоты шли, потом встали) — тоже в офлайн
    game.onStall = () => {
      console.warn('[battle] онлайн-бой: связь встала посреди боя — откат в офлайн с ботами')
      emit('netfail')
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
  game.destroy()
})
</script>

<template>
  <div class="root" :class="{ shaken: shaking }" :style="{ '--team': teamCol, '--foe': foeCol }">
    <div class="stage" ref="stage"></div>

    <!-- ===== верхний HUD ===== -->
    <div class="top">
      <button class="pausebtn" :disabled="phase !== 'fighting'" @click="pauseGame">
        <PzIcon name="pause" :size="18" />
      </button>

      <div class="mid-col">
        <!-- счёт: очки + ромбики живых. Боковые группы flex:1 → таймер строго
             по центру независимо от ширины счёта (5 vs 11) -->
        <div class="scoreplate">
          <div class="side left">
            <span v-if="!annihilation" class="pz-pixel num ally">{{ state.allyScore }}</span>
            <span class="dmnds">
              <i v-for="i in 7" :key="i" :class="{ on: i <= state.alliesAlive }" class="d ally"></i>
            </span>
          </div>
          <span class="pz-display timer" :class="{ low: state.matchTime <= 60 }">⏱ {{ fmtTime(state.matchTime) }}</span>
          <div class="side right">
            <span class="dmnds">
              <i v-for="i in 7" :key="i" :class="{ on: i <= state.enemiesAlive }" class="d enemy"></i>
            </span>
            <span v-if="!annihilation" class="pz-pixel num enemy">{{ state.enemyScore }}</span>
          </div>
        </div>
        <!-- режим «на уничтожение»: метка вместо точек захвата -->
        <div v-if="annihilation" class="modetag pz-display">НА УНИЧТОЖЕНИЕ</div>
        <!-- точки захвата: цвет владельца, пульс при перехвате -->
        <div v-else-if="state.caps && state.caps.length" class="caps">
          <span
            v-for="c in state.caps"
            :key="c.id"
            class="cap"
            :class="[c.own, { capping: c.cap && c.cap !== c.own }]"
          >{{ c.id }}<i v-if="c.cap && c.cap !== c.own && c.p > 0" class="capbar"><b :style="{ width: c.p * 100 + '%' }"></b></i></span>
        </div>
        <!-- HP -->
        <div class="hpbar">
          <div class="hp-fill" :style="{ width: hpFrac * 100 + '%', background: hpColor }"></div>
          <span class="pz-display hp-text">{{ tankName }} · {{ state.playerHp }} HP</span>
        </div>

        <!-- засвет: понимаю, видит меня враг или я в тумане (прилетит или нет) -->
        <div v-show="isNet && phase === 'fighting' && state.playerHp > 0" class="spotchip" :class="{ lit: state.revealed }">
          {{ state.revealed ? '● ВИДЕН ВРАГУ' : '○ В ТЕНИ' }}
        </div>

        <!-- индикаторы модулей: краснеют с отсчётом починки при крите -->
        <div v-show="phase === 'fighting'" class="modrow">
          <div v-for="m in MOD_HUD" :key="m.id" class="modchip" :class="{ down: state.crippled[m.id] > 0 }">
            <PzIcon :name="m.icon" :size="14" />
            <span v-if="state.crippled[m.id] > 0" class="mt">{{ state.crippled[m.id] }}</span>
          </div>
        </div>
      </div>

      <canvas class="minimap" ref="minimap" width="240" height="240"></canvas>
    </div>

    <!-- инфо боя: урон / засвет / фраги (слева вверху, полупрозрачная плашка) -->
    <div v-show="phase === 'fighting'" class="combatinfo">
      <div class="ci-row"><span class="ci-l">УРОН</span><span class="ci-v dmg">{{ state.damageDealt }}</span></div>
      <div class="ci-row"><span class="ci-l">ЗАСВЕТ</span><span class="ci-v">{{ state.spotted }}</span></div>
      <div class="ci-row"><span class="ci-l">ФРАГИ</span><span class="ci-v">{{ state.kills }}</span></div>
    </div>

    <!-- захват базы: отсчёт 0-100 -->
    <div v-if="state.enemyBase > 0" class="basecap pz-display" style="color: var(--amber); border-color: var(--amber)">
      ЗАХВАТ БАЗЫ {{ state.enemyBase }}%
    </div>
    <div v-if="state.ourBase > 0" class="basecap ours pz-display">НАШУ БАЗУ ЗАХВАТЫВАЮТ {{ state.ourBase }}%</div>

    <!-- килл-фид -->
    <div class="feed">
      <div v-for="f in feed" :key="f.key" class="feed-row"><span style="color: var(--amber)">ВЫ</span> ▸ {{ f.text }}</div>
    </div>

    <!-- награды за действия: засвет/захват -->
    <div class="actfeed">
      <transition-group name="pop">
        <div v-for="f in actionFeed" :key="f.key" class="actfeed-row pz-display">{{ f.text }} <span class="ax">+{{ f.xp }} ОП</span></div>
      </transition-group>
    </div>

    <transition name="pop">
      <div v-if="toast" class="toast pz-display" :class="toast.kind">{{ toast.text }}</div>
    </transition>

    <!-- ЭКРАН СМЕРТИ 2.0: причина + понятные действия (не тупик «наблюдение») -->
    <transition name="fade">
      <div v-if="phase === 'fighting' && state.playerHp <= 0 && !deathDismissed" class="overlay death">
        <div class="death-card pz-plate pz-brackets" style="--bk: var(--red)">
          <div class="death-title pz-display">ВЫ УНИЧТОЖЕНЫ</div>
          <div v-if="deathCause" class="death-cause">{{ deathCause }}</div>
          <div class="death-actions">
            <button class="pz-btn2" @click="deathDismissed = true">Наблюдать за боем</button>
            <button class="pz-cta pz-cta--hazard" style="padding: 12px" @click="toHangar">Выйти в ангар</button>
          </div>
        </div>
      </div>
    </transition>
    <!-- наблюдение после закрытия экрана смерти — компактная плашка с выходом -->
    <div v-if="phase === 'fighting' && state.playerHp <= 0 && deathDismissed" class="obs-chip">
      <span class="pz-display">НАБЛЮДЕНИЕ</span>
      <button class="obs-exit" @click="toHangar">в ангар</button>
    </div>

    <!-- связь просела (сокет жив) — ждём снапшоты, бой идёт на сервере -->
    <div v-if="reconnecting && !state.matchOver" class="reconnect pz-display">
      <span class="rc-spin"></span> ВОССТАНАВЛИВАЕМ СВЯЗЬ…
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
      <template v-if="ammo === 'gold'">★ ГОЛД · {{ profile.goldAmmo }}</template>
      <template v-else>ББ <span style="opacity: 0.6">· ★{{ profile.goldAmmo }}</span></template>
    </button>

    <!-- ОГОНЬ -->
    <button v-show="phase === 'fighting' && !paused && state.playerHp > 0" class="fire" :class="{ cold: !state.ready }" @pointerdown.prevent="onFire">
      <svg class="ring" width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r="34" class="ring-bg" />
        <circle cx="46" cy="46" r="34" class="ring-fg" :stroke-dasharray="RING" :stroke-dashoffset="ringOffset" />
      </svg>
      <span class="pz-display flabel">{{ state.ready ? 'ОГОНЬ' : state.reloadLeft.toFixed(1) + 'с' }}</span>
    </button>

    <!-- стартовый отсчёт -->
    <transition name="fade">
      <div v-if="phase === 'countdown'" class="overlay countdown">
        <div class="cd-num pz-display">{{ count > 0 ? count : 'В БОЙ!' }}</div>
        <div class="cd-sub">
          {{ mapName }} · вы за <b :style="{ color: teamCol }">{{ mySide === 1 ? 'красных' : 'синих' }}</b>
          <template v-if="isNet"> · онлайн</template>
        </div>
        <div class="cd-sub">{{ annihilation ? 'бой до последнего танка' : 'до ' + state.scoreLimit + ' очков' }} · {{ fmtTime(state.matchTime) }}</div>
      </div>
    </transition>

    <!-- пауза -->
    <div v-if="paused" class="overlay pause">
      <div class="pz-plate pz-brackets pauseplate" style="--bk: var(--amber)">
        <div class="pz-stencil-h" style="justify-content: center">ПАУЗА</div>
        <button class="pz-cta" style="font-size: 16px; padding: 13px 16px" @click="resumeGame">Продолжить</button>
        <button class="pz-btn2" @click="toHangar">Покинуть бой</button>
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
        <div class="pz-display ld-text">ЗАГРУЗКА БОЯ</div>
        <div class="ld-sub">готовим технику и поле…</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.root {
  position: fixed;
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
  color: #7fd06a;
  background: rgba(95, 211, 95, 0.1);
  border: 1px solid rgba(95, 211, 95, 0.4);
}
.spotchip.lit {
  color: #ff8a7a;
  background: rgba(226, 75, 74, 0.14);
  border-color: rgba(226, 75, 74, 0.55);
  animation: pz-blink 1.3s linear infinite;
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
.scoreplate {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 5px 12px;
  align-self: center; /* по контенту и по центру — иначе на широком экране счёт уезжает к краям */
  max-width: 100%;
}
.scoreplate .side {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
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
  gap: 3px;
}
.dmnds .d {
  width: 7px;
  height: 7px;
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
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  opacity: 0.9;
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
  top: calc(var(--safe-top) + 52px);
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
