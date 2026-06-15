<script setup>
// Строка статы 0..10 с сегментным баром. value — итог с прокачкой; base —
// исходное (если задано и ниже value, рисуем метку базы и «+прирост»).
defineProps({
  label: { type: String, required: true },
  value: { type: Number, required: true }, // 0..10 — заполнение бара (визуал-сравнение)
  base: { type: Number, default: null },
  // display — РЕАЛЬНОЕ боевое число (крупное: HP 2088, урон 297…). Если задано,
  // показываем его вместо шкалы 1-10; displayUp — реальный прирост от прокачки.
  display: { type: [Number, String], default: null },
  displayUp: { type: [Number, String], default: null },
})
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
</script>

<template>
  <div class="pz-stat">
    <div class="pz-stat-label">{{ label }}</div>
    <div class="pz-stat-track">
      <div class="pz-stat-fill" :style="{ width: Math.min(100, value * 10) + '%' }"></div>
      <i v-if="base !== null && value - base > 0.05" class="pz-stat-base" :style="{ left: Math.min(100, base * 10) + '%' }"></i>
    </div>
    <div class="pz-stat-num">
      <template v-if="display !== null">{{ display }}<span v-if="displayUp" class="up">+{{ displayUp }}</span></template>
      <template v-else>{{ fmt(value) }}<span v-if="base !== null && value - base > 0.05" class="up">+{{ fmt(value - base) }}</span></template>
    </div>
  </div>
</template>

<style scoped>
/* метка исходного уровня — видно, сколько добрала прокачка */
.pz-stat-base {
  position: absolute;
  top: -1px;
  bottom: -1px;
  width: 2px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 1px;
}
.pz-stat-num .up {
  margin-left: 3px;
  font-size: 10px;
  color: var(--green);
}
</style>
