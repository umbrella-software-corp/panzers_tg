<script setup>
// Боевой HUD (порт BattleScreen поверх живого Pixi-боя): счёт с ромбиками живых,
// HP-полоса с именем машины, миникарта, килл-фид, индикаторы критов, пауза,
// плавающий джойстик и hazard-кнопка ОГОНЬ с кольцом перезарядки.
import { ref, shallowRef, onMounted, onBeforeUnmount, computed } from 'vue'
import { Game } from '../game/Game.js'
import { DEFAULT_CLASS, CRIT_LABELS } from '../game/config.js'
import { profile, spendGoldAmmo, addBattleResult } from '../store.js'
import { TANK_BY_ID, TANKS, combatStats, GOLD_AMMO_MULT } from '../game/meta.js'
import Results from './Results.vue'
import PzIcon from './ui/PzIcon.vue'

const props = defineProps({
  loadout: { type: Object, default: null },
})
const emit = defineEmits(['exit', 'rematch'])

const stage = ref(null)
const minimap = ref(null)
const game = new Game()

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
  classId: DEFAULT_CLASS,
  damageDealt: 0,
  matchTime: 0,
  matchOver: false,
  result: null,
  scoreLimit: 20,
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
const hpFrac = computed(() => state.value.playerHp / state.value.playerMaxHp)
const hpColor = computed(() => (hpFrac.value > 0.6 ? 'var(--green)' : hpFrac.value > 0.3 ? 'var(--amber)' : 'var(--red)'))

// фаза боя: countdown (стартовый отсчёт) | fighting | result (донесение)
const phase = ref('countdown')
const count = ref(3)
let countTimer = null

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
  const key = Date.now() + Math.random()
  feed.value = [{ key, text: name }, ...feed.value].slice(0, 3)
  setTimeout(() => {
    feed.value = feed.value.filter((f) => f.key !== key)
  }, 4500)
}

// тряска экрана при получении урона
const shaking = ref(false)
let shakeTimer = null
let prevHp = Infinity

let statsCounted = false // статистика матча банкается один раз
game.onState = (s) => {
  if (s.kills > prevKills) showToast('hit', 'УНИЧТОЖЕН')
  if (s.deaths > prevDeaths) showToast('miss', 'ВЫ УНИЧТОЖЕНЫ')
  if (s.playerHp < prevHp && s.playerHp > 0) {
    shaking.value = true
    clearTimeout(shakeTimer)
    shakeTimer = setTimeout(() => (shaking.value = false), 320)
  }
  prevHp = s.playerHp
  prevKills = s.kills
  prevDeaths = s.deaths
  state.value = s
  if (s.matchOver && phase.value === 'fighting') {
    phase.value = 'result'
    if (!statsCounted) {
      statsCounted = true
      addBattleResult(s.result, s.kills)
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
    xp: (win ? 200 : draw ? 120 : 80) + s.kills * 45 + s.hits * 4,
    silver: (win ? 260 : draw ? 150 : 100) + s.kills * 45 + Math.round(s.allyScore * 6),
    kills: s.kills,
    allyScore: s.allyScore,
  }
})

// --- выбор снаряда: обычный / голдовый (урон ×GOLD_AMMO_MULT, тратится) ---
const ammo = ref('std')
function toggleAmmo() {
  if (ammo.value === 'std' && profile.goldAmmo <= 0) return
  ammo.value = ammo.value === 'std' ? 'gold' : 'std'
  game.ammoMult = ammo.value === 'gold' ? GOLD_AMMO_MULT : 1
}
game.onCrit = (slot) => {
  showToast('miss', `${CRIT_LABELS[slot]} ПОВРЕЖДЕНА`)
}
game.onSaved = (kind) => {
  showToast('hit', kind === 'ricochet' ? 'РИКОШЕТ ОТ БРОНИ' : 'БРОНЯ НЕ ПРОБИТА')
}
game.onShot = (r) => {
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
    showToast('hit', 'ПОПАЛ')
  } else if (r.type === 'ricochet') {
    showToast('miss', 'РИКОШЕТ')
  } else if (r.type === 'nopen') {
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
  game.fire()
}

function toHangar() {
  // выход до конца матча = поражение в статистику
  if (phase.value === 'fighting' && !statsCounted) {
    statsCounted = true
    addBattleResult('defeat', state.value.kills)
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
    }
  }, 800)
}

onMounted(async () => {
  // матчмейкинг ±1 тир: боты — конкретные танки соседних уровней
  const myTier = (TANK_BY_ID[profile.selectedTank] || {}).tier || 1
  const pool = TANKS.filter((t) => Math.abs(t.tier - myTier) <= 1).map(combatStats)
  game.setBotTanks(pool)
  // статы до mount: спрайт игрока выбирается по классу лоадаута
  if (props.loadout) game.setStats(props.loadout)
  else game.setClass(DEFAULT_CLASS)
  await game.mount(stage.value)
  game.setMinimap(minimap.value)
  startCountdown()
})
if (import.meta.env.DEV) window.__game = game
onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  clearInterval(countTimer)
  clearTimeout(shakeTimer)
  game.destroy()
})
</script>

<template>
  <div class="root" :class="{ shaken: shaking }">
    <div class="stage" ref="stage"></div>

    <!-- ===== верхний HUD ===== -->
    <div class="top">
      <button class="pausebtn" :disabled="phase !== 'fighting'" @click="pauseGame">
        <PzIcon name="pause" :size="18" />
      </button>

      <div class="mid-col">
        <!-- счёт: очки + ромбики живых -->
        <div class="scoreplate">
          <span class="pz-pixel num ally">{{ state.allyScore }}</span>
          <span class="dmnds">
            <i v-for="i in 5" :key="i" :class="{ on: i <= state.alliesAlive }" class="d ally"></i>
          </span>
          <span class="pz-display timer">{{ fmtTime(state.matchTime) }}</span>
          <span class="dmnds">
            <i v-for="i in 5" :key="i" :class="{ on: i <= state.enemiesAlive }" class="d enemy"></i>
          </span>
          <span class="pz-pixel num enemy">{{ state.enemyScore }}</span>
        </div>
        <!-- HP -->
        <div class="hpbar">
          <div class="hp-fill" :style="{ width: hpFrac * 100 + '%', background: hpColor }"></div>
          <span class="pz-display hp-text">{{ tankName }} · {{ state.playerHp }} HP</span>
        </div>
      </div>

      <canvas class="minimap" ref="minimap" width="240" height="240"></canvas>
    </div>

    <!-- индикаторы модулей: краснеют с отсчётом починки при крите -->
    <div v-show="phase === 'fighting'" class="modrow">
      <div v-for="m in MOD_HUD" :key="m.id" class="modchip" :class="{ down: state.crippled[m.id] > 0 }">
        <PzIcon :name="m.icon" :size="14" />
        <span v-if="state.crippled[m.id] > 0" class="mt">{{ state.crippled[m.id] }}</span>
      </div>
    </div>

    <!-- килл-фид -->
    <div class="feed">
      <div v-for="f in feed" :key="f.key" class="feed-row"><span style="color: var(--amber)">ВЫ</span> ▸ {{ f.text }}</div>
    </div>

    <transition name="pop">
      <div v-if="toast" class="toast pz-display" :class="toast.kind">{{ toast.text }}</div>
    </transition>

    <!-- уничтожен: режим наблюдения -->
    <div v-if="phase === 'fighting' && state.playerHp <= 0" class="dead-banner pz-display">
      ВЫ УНИЧТОЖЕНЫ · НАБЛЮДЕНИЕ
    </div>

    <!-- зона движения: джойстик появляется под пальцем -->
    <div
      v-show="phase === 'fighting' && !paused && state.playerHp > 0"
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

    <!-- выбор снаряда -->
    <button
      v-show="phase === 'fighting' && !paused && state.playerHp > 0"
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
      <span class="pz-display flabel">{{ state.ready ? 'ОГОНЬ' : '···' }}</span>
    </button>

    <!-- стартовый отсчёт -->
    <transition name="fade">
      <div v-if="phase === 'countdown'" class="overlay countdown">
        <div class="cd-num pz-display">{{ count > 0 ? count : 'В БОЙ!' }}</div>
        <div class="cd-sub">до {{ state.scoreLimit }} очков · {{ fmtTime(state.matchTime) }}</div>
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

    <!-- результат: боевое донесение -->
    <transition name="fade">
      <div v-if="phase === 'result'" class="overlay result">
        <Results :state="state" :reward="reward" @rematch="rematch" @hangar="toHangar" />
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
.dead-banner {
  position: absolute;
  top: 30%;
  left: 50%;
  transform: translateX(-50%);
  font-size: 15px;
  letter-spacing: 0.18em;
  color: var(--red);
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--red-deep);
  border-radius: 8px;
  padding: 8px 16px;
  white-space: nowrap;
  z-index: 4;
  pointer-events: none;
  animation: pz-slide-up 0.3s ease;
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
  justify-content: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 5px 12px;
}
.scoreplate .num {
  font-size: 13px;
}
.scoreplate .num.ally {
  color: var(--blue);
}
.scoreplate .num.enemy {
  color: var(--red);
}
.scoreplate .timer {
  font-size: 11px;
  color: var(--ink-dim);
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
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
  background: var(--blue);
}
.dmnds .d.enemy.on {
  background: var(--red);
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
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
}

/* индикаторы критов */
.modrow {
  position: absolute;
  top: calc(var(--safe-top) + 76px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  z-index: 3;
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
.movezone {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 62%;
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
