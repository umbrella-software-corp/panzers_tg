<script setup>
// Лёгкий тур по ангару для самого первого входа (battles===0, !profile.onboarded).
// 3 шага-коачмарка: подсвечиваем элемент в ангаре (танк → режим → В БОЙ), рядом
// карточка с пояснением. Последний шаг запускает первый бой. Есть «Пропустить» —
// тур не должен стать новой точкой отвала (см. воронку). Подсветку наводим по
// data-tut-атрибутам в Hangar.vue через getBoundingClientRect (без жёстких координат).
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { haptic } from '../tg.js'
import { track } from '../analytics.js'

const emit = defineEmits(['play', 'skip'])

const STEPS = [
  {
    sel: '[data-tut="tank"]',
    title: 'Это твой танк',
    body: 'Твоя боевая машина. Внизу — вся техника: листай, выбирай, открывай новую в «Развитии».',
    pad: 14,
    cta: 'Дальше ▸',
  },
  {
    sel: '[data-tut="mode"]',
    title: 'Режим боя',
    body: 'ЗАХВАТ — быстрая катка на точки, самое то для старта. НА УНИЧТОЖЕНИЕ — бой до последнего.',
    pad: 8,
    cta: 'Дальше ▸',
  },
  {
    sel: '[data-tut="play"]',
    title: 'Заверши первый бой → +1000 кредитов',
    body: 'Жми — и поехали. Первые бои лёгкие: целься в зелёную рамку и стреляй. Доведи бой до конца — получишь награду.',
    pad: 8,
    cta: 'В БОЙ ▸',
  },
]

const i = ref(0)
const rect = ref(null) // прямоугольник подсветки (с паддингом) или null → центр
const step = computed(() => STEPS[i.value])
const isLast = computed(() => i.value === STEPS.length - 1)

function measure() {
  const el = document.querySelector(STEPS[i.value].sel)
  if (!el) {
    rect.value = null
    return
  }
  const r = el.getBoundingClientRect()
  const p = STEPS[i.value].pad || 8
  rect.value = {
    left: r.left - p,
    top: r.top - p,
    width: r.width + 2 * p,
    height: r.height + 2 * p,
    bottom: r.bottom + p,
  }
}

// замер после отрисовки (раскладка ангара успела лечь) + повтор на следующем кадре
function remeasure() {
  nextTick(() => {
    measure()
    requestAnimationFrame(measure)
  })
}

const holeStyle = computed(() => {
  const r = rect.value
  if (!r) return { display: 'none' }
  return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }
})

// карточку ставим по другую сторону от подсветки, чтобы не перекрывать её
const cardStyle = computed(() => {
  const r = rect.value
  const h = window.innerHeight || 800
  if (!r) return { top: '50%', left: '14px', right: '14px', transform: 'translateY(-50%)' }
  const below = r.top < h * 0.5
  return below
    ? { top: r.bottom + 16 + 'px', left: '14px', right: '14px' }
    : { bottom: h - r.top + 16 + 'px', left: '14px', right: '14px' }
})

function next() {
  haptic('light')
  if (isLast.value) {
    track('tutorial_completed', { steps: STEPS.length })
    emit('play')
    return
  }
  i.value++
}
function skip() {
  haptic('light')
  track('tutorial_skipped', { at_step: i.value })
  emit('skip')
}

watch(i, (n) => {
  track('tutorial_step', { step: n, step_name: STEPS[n].sel })
  remeasure()
})

onMounted(() => {
  track('tutorial_started', {})
  remeasure()
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))
</script>

<template>
  <div class="tut-root">
    <!-- ловушка тапов: глушим клики мимо карточки (на ангар), действие — только кнопками -->
    <div class="tut-catch" @click.self="() => {}"></div>
    <!-- сплошной скрим, если цель шага не нашлась (никогда не прозрачно) -->
    <div v-if="!rect" class="tut-scrim"></div>
    <!-- «дырка»-подсветка: огромный box-shadow затемняет всё, кроме выреза -->
    <div v-else class="tut-hole" :style="holeStyle"></div>

    <!-- карточка-пояснение -->
    <div class="tut-card" :style="cardStyle">
      <div class="tut-step pz-pixel">ШАГ {{ i + 1 }}/{{ STEPS.length }}</div>
      <div class="tut-title pz-display">{{ step.title }}</div>
      <div class="tut-body">{{ step.body }}</div>
      <div class="tut-row">
        <button class="tut-skip" @click="skip">Пропустить</button>
        <button class="pz-cta tut-next" :class="{ 'pz-cta--hazard': isLast }" @click="next">{{ step.cta }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tut-root {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.tut-catch {
  position: absolute;
  inset: 0;
}
.tut-scrim {
  position: absolute;
  inset: 0;
  background: rgba(8, 9, 6, 0.78);
}
.tut-hole {
  position: absolute;
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(8, 9, 6, 0.8);
  border: 2px solid var(--amber);
  pointer-events: none;
  transition: all 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.1);
  animation: tut-pulse 1.6s ease-in-out infinite;
}
@keyframes tut-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 9999px rgba(8, 9, 6, 0.8), 0 0 0 0 rgba(242, 165, 12, 0.5);
  }
  50% {
    box-shadow: 0 0 0 9999px rgba(8, 9, 6, 0.8), 0 0 0 6px rgba(242, 165, 12, 0);
  }
}
.tut-card {
  position: absolute;
  max-width: 420px;
  margin: 0 auto;
  padding: 14px 16px 12px;
  background: linear-gradient(180deg, rgba(26, 30, 20, 0.98), rgba(16, 19, 12, 0.98));
  border: 1px solid var(--amber);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  animation: tut-in 0.25s ease;
}
@keyframes tut-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.tut-step {
  font-size: 8px;
  letter-spacing: 0.14em;
  color: var(--amber);
  margin-bottom: 5px;
}
.tut-title {
  font-size: 20px;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.tut-body {
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink-dim);
}
.tut-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.tut-skip {
  flex-shrink: 0;
  padding: 9px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-faint);
  background: transparent;
  border: none;
  cursor: pointer;
}
.tut-skip:active {
  color: var(--ink-dim);
}
.tut-next {
  flex: 1;
  padding: 11px 14px;
  font-size: 15px;
}
</style>
