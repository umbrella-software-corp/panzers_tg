<script setup>
// Гайд первого боя ПОВЕРХ живого боя: 3 шага-коачмарка (едь → целься → огонь).
// Враги в это время заморожены сервером (room.guided) — стоят мишенями. Шаги
// продвигаются АВТОМАТИЧЕСКИ по реальным действиям игрока (поехал / навёлся /
// выстрелил), у каждого есть бэкстоп-таймер, чтобы не залипнуть (нет чистой линии,
// далеко до врага и т.п.). «Пропустить обучение» → emit('skip'). Корень
// pointer-events:none → джойстик и кнопка ОГОНЬ работают СКВОЗЬ гайд.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { haptic } from '../tg.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'

const props = defineProps({ game: { type: Object, required: true } })
const emit = defineEmits(['done', 'skip'])

const TOTAL = 3
const i = ref(0) // 0 — едь, 1 — целься, 2 — огонь
const step = computed(() => t('onboarding.train')[i.value] || {})
const fireRect = ref(null) // рамка-подсветка кнопки ОГОНЬ (шаг «огонь»)

const g = props.game
// позиция своего танка: предикт (мгновенный) или последний снапшот
const ownPos = () => {
  if (g._pred) return { x: g._pred.x, y: g._pred.y }
  const u = g.cur && g.youUnit != null ? g.cur.units.find((x) => x.id === g.youUnit) : null
  return u ? { x: u.x, y: u.y } : null
}
const shots = () => (g.you && g.you.shots) || 0

let poll = null
let stepStart = 0
let driveFrom = null
let fireBase = 0

function measureFire() {
  const el = document.querySelector('.fire')
  if (!el) return (fireRect.value = null)
  const r = el.getBoundingClientRect()
  fireRect.value = { left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 }
}

function enterStep(n) {
  i.value = n
  stepStart = performance.now()
  if (n === 0) driveFrom = ownPos()
  if (n === 2) {
    fireBase = shots()
    measureFire()
  } else {
    fireRect.value = null
  }
  track('training_guide_step', { step: n })
}

function advance() {
  haptic('light')
  if (i.value >= TOTAL - 1) {
    track('training_guide_done', {})
    emit('done')
    return
  }
  enterStep(i.value + 1)
}

// опрос состояния боя ~10Гц: продвигаем шаг по факту действия (или по бэкстопу)
function tick() {
  const elapsed = performance.now() - stepStart
  if (i.value === 0) {
    const p = ownPos()
    if (driveFrom && p) {
      if (Math.hypot(p.x - driveFrom.x, p.y - driveFrom.y) > 130) return advance() // поехал
    } else if (p) {
      driveFrom = p // танк появился позже — берём стартовую точку сейчас
    }
    if (elapsed > 22000) advance() // бэкстоп: не стоим вечно
  } else if (i.value === 1) {
    if (g._aimLock || elapsed > 8000) return advance() // зелёный «захват» (или авто, если нет чистой линии)
  } else if (i.value === 2) {
    measureFire() // кнопка «дышит» перезарядкой — держим рамку на месте
    if (shots() > fireBase || elapsed > 15000) return advance() // выстрелил
  }
}

onMounted(() => {
  track('training_guide_started', {})
  enterStep(0)
  poll = setInterval(tick, 100)
  window.addEventListener('resize', measureFire)
})
onBeforeUnmount(() => {
  clearInterval(poll)
  window.removeEventListener('resize', measureFire)
})

function skip() {
  haptic('light')
  track('training_guide_skipped', { at_step: i.value })
  emit('skip')
}
</script>

<template>
  <div class="tg-root">
    <!-- подсветка кнопки ОГОНЬ на шаге «огонь» (без затемнения — бой должно быть видно) -->
    <div
      v-if="i === 2 && fireRect"
      class="tg-firering"
      :style="{ left: fireRect.left + 'px', top: fireRect.top + 'px', width: fireRect.width + 'px', height: fireRect.height + 'px' }"
    ></div>

    <!-- анимированная подсказка «тащи палец» на шаге «едь» -->
    <div v-if="i === 0" class="tg-drive">
      <div class="tg-arrow pz-display">↑</div>
      <div class="tg-finger"></div>
    </div>

    <!-- карточка-пояснение вверху по центру (контролы внизу остаются свободны) -->
    <div class="tg-card">
      <div class="tg-step pz-pixel">{{ t('onboarding.step', { n: i + 1, total: TOTAL }) }}</div>
      <div class="tg-title pz-display">{{ step.title }}</div>
      <div class="tg-body">{{ step.body }}</div>
      <button class="tg-skip" @click="skip">{{ t('onboarding.trainSkip') }}</button>
    </div>
  </div>
</template>

<style scoped>
.tg-root {
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: none; /* джойстик/ОГОНЬ работают СКВОЗЬ гайд */
}
.tg-card {
  position: absolute;
  top: calc(var(--safe-top, 0px) + 96px);
  left: 50%;
  transform: translateX(-50%);
  width: min(86%, 360px);
  pointer-events: auto;
  padding: 12px 15px 10px;
  text-align: center;
  background: linear-gradient(180deg, rgba(26, 30, 20, 0.97), rgba(16, 19, 12, 0.97));
  border: 1px solid var(--amber);
  border-radius: 13px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6);
  animation: tg-in 0.25s ease;
}
@keyframes tg-in {
  from {
    opacity: 0;
    transform: translate(-50%, -8px);
  }
}
.tg-step {
  font-size: 8px;
  letter-spacing: 0.14em;
  color: var(--amber);
  margin-bottom: 4px;
}
.tg-title {
  font-size: 19px;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.tg-body {
  margin-top: 5px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ink-dim);
}
.tg-skip {
  margin-top: 10px;
  padding: 6px 12px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-faint);
  background: transparent;
  border: none;
  cursor: pointer;
}
.tg-skip:active {
  color: var(--ink-dim);
}
/* рамка-подсветка кнопки ОГОНЬ */
.tg-firering {
  position: absolute;
  border: 2px solid var(--amber);
  border-radius: 50%;
  pointer-events: none;
  animation: tg-pulse 1.2s ease-in-out infinite;
}
@keyframes tg-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(242, 165, 12, 0.55);
  }
  50% {
    box-shadow: 0 0 0 9px rgba(242, 165, 12, 0);
  }
}
/* подсказка движения над зоной джойстика */
.tg-drive {
  position: absolute;
  left: 50%;
  bottom: calc(var(--safe-bottom, 0px) + 118px);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}
.tg-arrow {
  font-size: 26px;
  color: var(--amber);
  animation: tg-up 1.1s ease-in-out infinite;
}
.tg-finger {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(242, 165, 12, 0.25);
  border: 2px solid var(--amber);
  animation: tg-up 1.1s ease-in-out infinite;
}
@keyframes tg-up {
  0%,
  100% {
    transform: translateY(6px);
    opacity: 0.55;
  }
  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}
</style>
