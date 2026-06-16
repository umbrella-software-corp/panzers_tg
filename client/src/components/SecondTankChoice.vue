<script setup>
// «Выбери второй танк» (тир-2) после первого боя: дарим бесплатно один из трёх —
// СССР bt7 / Германия pz3 / США stu. Эмитит 'pick' с id; выдачу делает App.vue
// (grantFreeTank — в обход обычного гейта прокачки). Остальные открываются позже
// обычным путём в «Развитии», так что выбор не эксклюзивный, просто «первый бесплатно».
import { ref, computed } from 'vue'
import { TANK_BY_ID, nationOf, STAT_LABELS } from '../game/meta.js'
import { haptic } from '../tg.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'
import TankImg from './ui/TankImg.vue'
import StatRow from './ui/StatRow.vue'

const emit = defineEmits(['pick'])

const OPTIONS = ['bt7', 'pz3', 'stu'].map((id) => TANK_BY_ID[id]).filter(Boolean)
const sel = ref(OPTIONS[0] ? OPTIONS[0].id : null)
const selTank = computed(() => TANK_BY_ID[sel.value] || OPTIONS[0])
const nationLabel = (id) => t('game.nations.' + nationOf(id))
const stats = computed(() => Object.entries(selTank.value.stats).map(([k, v]) => ({ key: k, label: STAT_LABELS[k] || k, value: v })))

function choose(id) {
  haptic('light')
  sel.value = id
}
function confirm() {
  haptic('medium')
  track('second_tank_chosen', { tank_id: sel.value, nation: nationOf(sel.value) })
  emit('pick', sel.value)
}
</script>

<template>
  <div class="st-root">
    <div class="st-card pz-plate pz-brackets" style="--bk: var(--amber)">
      <div class="st-free pz-pixel">{{ t('onboarding.secondTank.free') }}</div>
      <div class="st-title pz-display">{{ t('onboarding.secondTank.title') }}</div>
      <div class="st-sub">{{ t('onboarding.secondTank.sub') }}</div>

      <div class="st-row">
        <button v-for="tk in OPTIONS" :key="tk.id" class="st-opt" :class="{ on: sel === tk.id }" @click="choose(tk.id)">
          <TankImg :tank-id="tk.id" :size="60" />
          <div class="st-name pz-display">{{ tk.name }}</div>
          <div class="st-meta">{{ t('game.classes.' + tk.classId) }} · {{ nationLabel(tk.id) }}</div>
        </button>
      </div>

      <div class="st-stats">
        <StatRow v-for="s in stats" :key="s.key" :label="s.label" :value="s.value" />
      </div>

      <button class="pz-cta st-cta" @click="confirm">{{ t('onboarding.secondTank.cta', { name: selTank.name }) }} ▸</button>
    </div>
  </div>
</template>

<style scoped>
.st-root {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(8, 9, 6, 0.82);
}
.st-card {
  width: min(94%, 380px);
  max-height: 92vh;
  overflow-y: auto;
  padding: 16px 16px 14px;
  text-align: center;
  animation: pz-pop 0.28s ease;
}
.st-free {
  display: inline-block;
  font-size: 8px;
  letter-spacing: 0.16em;
  color: #1d1604;
  background: var(--amber);
  border-radius: 5px;
  padding: 2px 7px 1px;
  margin-bottom: 8px;
}
.st-title {
  font-size: 22px;
  letter-spacing: 0.03em;
  color: var(--ink);
}
.st-sub {
  margin-top: 5px;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--ink-dim);
}
.st-row {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.st-opt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px 9px;
  background: rgba(0, 0, 0, 0.32);
  border: 1.5px solid var(--line);
  border-radius: 11px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;
}
.st-opt.on {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.1);
  transform: translateY(-2px);
}
.st-name {
  font-size: 13px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.st-meta {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.st-stats {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}
.st-cta {
  margin-top: 16px;
  width: 100%;
  font-size: 15px;
  padding: 13px;
}
</style>
