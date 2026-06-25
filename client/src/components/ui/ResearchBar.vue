<script setup>
// Видимая полоса прогресса к СЛЕДУЮЩЕМУ танку ветки: «X / need» + сколько осталось.
// Убирает корень жалобы «опыт не начисляется» (#29) — игрок ВИДИТ, как полоса растёт.
// В итогах боя передаём gained (опыт ветки за этот бой) → подсвечиваем прирост.
import { computed } from 'vue'
import { t } from '../../i18n.js'

const props = defineProps({
  prog: { type: Object, required: true }, // researchProgress(): { name, have, need, left, pct, ready }
  gained: { type: Number, default: 0 }, // опыт ветки за последний бой (подсветка прироста)
})

const fmt = (n) => Math.round(n).toLocaleString('ru-RU')
// часть полосы, набранная ИМЕННО в этом бою — рисуем ярче на конце заполнения
const gainedPct = computed(() => {
  if (!props.gained || props.prog.need <= 0) return 0
  return Math.min(props.prog.pct, props.gained / props.prog.need)
})
const basePct = computed(() => Math.max(0, props.prog.pct - gainedPct.value))
</script>

<template>
  <div class="rbar" :class="{ ready: prog.ready }">
    <div class="rbar-top">
      <span class="rbar-cap">{{ t('hangar.toNextTank') }}</span>
      <span class="rbar-name">{{ prog.name }}</span>
    </div>
    <div class="rbar-track">
      <div class="rbar-base" :style="{ width: basePct * 100 + '%' }"></div>
      <div v-if="gainedPct > 0" class="rbar-gain" :style="{ width: gainedPct * 100 + '%' }"></div>
    </div>
    <div class="rbar-bot">
      <span class="rbar-have">{{ fmt(prog.have) }} / {{ fmt(prog.need) }}</span>
      <span class="rbar-left" :class="{ ready: prog.ready }">
        <template v-if="prog.ready">✓ {{ t('hangar.researchReady') }}</template>
        <template v-else>{{ t('hangar.researchLeft', { n: fmt(prog.left) }) }}</template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.rbar {
  width: 100%;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(220, 170, 90, 0.28);
  border-radius: 8px;
  padding: 8px 10px 9px;
}
.rbar-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.rbar-cap {
  font-size: 8px;
  letter-spacing: 0.14em;
  color: var(--amber);
  font-family: var(--pz-pixel, monospace);
  text-transform: uppercase;
  opacity: 0.85;
}
.rbar-name {
  font-family: var(--pz-display, sans-serif);
  font-size: 14px;
  color: var(--amber-hi);
  text-align: right;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rbar-track {
  position: relative;
  display: flex;
  height: 9px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.34);
  overflow: hidden;
}
.rbar-base {
  height: 100%;
  background: linear-gradient(90deg, rgba(200, 150, 70, 0.85), rgba(225, 180, 95, 0.9));
  transition: width 0.5s ease;
}
.rbar-gain {
  height: 100%;
  background: linear-gradient(90deg, #ffd56a, #ffe9a8);
  box-shadow: 0 0 7px rgba(255, 213, 106, 0.8);
  animation: rbar-pulse 1.1s ease-in-out infinite;
}
@keyframes rbar-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.62; }
}
.rbar.ready .rbar-track {
  box-shadow: 0 0 9px rgba(120, 230, 120, 0.5);
}
.rbar.ready .rbar-base {
  background: linear-gradient(90deg, #5fb45f, #8fe08f);
}
.rbar-bot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 11px;
}
.rbar-have {
  font-family: var(--pz-display, sans-serif);
  color: var(--ink-dim, #b9b09a);
}
.rbar-left {
  color: var(--ink-dim, #b9b09a);
}
.rbar-left.ready {
  color: #8fe08f;
  font-weight: 700;
}
</style>
