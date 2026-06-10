<script setup>
// Результаты боя (порт ResultsScreen): крафт-донесение со штампом
// ПОБЕДА/ПОРАЖЕНИЕ/НИЧЬЯ, статы матча, полоса наград, ЕЩЁ БОЙ / В ангар.
// Лист «По целям» появится, когда движок начнёт вести по-целевой лог
// (вместе с именованными врагами в новом боевом HUD).
import { computed } from 'vue'
import { profile } from '../store.js'
import { TANK_BY_ID } from '../game/meta.js'
import PzIcon from './ui/PzIcon.vue'

const props = defineProps({
  // снапшот матча из Battle: result/kills/deaths/damageDealt/accuracy/allyScore/enemyScore
  state: { type: Object, required: true },
  // награда { xp, silver }
  reward: { type: Object, required: true },
})
const emit = defineEmits(['rematch', 'hangar'])

const tankName = computed(() => (TANK_BY_ID[profile.selectedTank] || {}).name || '')
const won = computed(() => props.state.result === 'victory')
const stamp = computed(() =>
  props.state.result === 'victory' ? 'ПОБЕДА' : props.state.result === 'defeat' ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ',
)
const rows = computed(() => [
  ['Уничтожено машин', props.state.kills],
  ['Подбит раз', props.state.deaths],
  ['Урон по противнику', props.state.damageDealt],
  ['Точность', props.state.accuracy + '%'],
])
</script>

<template>
  <div class="wrap">
    <!-- донесение на крафт-бумаге -->
    <div class="card">
      <!-- дырки от дырокола -->
      <div class="holes"><span></span><span></span></div>

      <div class="head">
        <div class="pz-display" style="font-size: 13px; letter-spacing: 0.3em; opacity: 0.65">БОЕВОЕ ДОНЕСЕНИЕ</div>
        <div style="font-size: 11px; margin-top: 3px; opacity: 0.55; font-weight: 500">
          экипаж · {{ tankName }} · бой 7×7 · счёт {{ state.allyScore }}:{{ state.enemyScore }}
        </div>
      </div>

      <!-- штамп -->
      <div style="display: flex; justify-content: center; padding: 18px 0 6px">
        <div class="pz-display stamp" :style="{ color: won ? '#9a1f10' : '#3a3326', borderColor: won ? '#9a1f10' : '#3a3326' }">
          {{ stamp }}
        </div>
      </div>

      <!-- статы -->
      <div style="display: flex; flex-direction: column; gap: 7px; padding: 10px 4px 14px; font-size: 14px; font-weight: 500">
        <div v-for="[k, v] in rows" :key="k" style="display: flex; align-items: baseline; gap: 8px">
          <span style="opacity: 0.7">{{ k }}</span>
          <span style="flex: 1; border-bottom: 1.5px dotted rgba(33, 29, 18, 0.4); transform: translateY(-3px)"></span>
          <span class="pz-display" style="font-size: 15px">{{ v }}</span>
        </div>
      </div>

      <!-- награды -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-top: 1.5px dashed rgba(33, 29, 18, 0.35); padding-top: 12px">
        <div class="cell">
          <div class="pz-display" style="display: flex; align-items: center; justify-content: center; gap: 5px">
            <PzIcon name="coin" :size="15" /> <span style="font-size: 18px">+{{ reward.silver }}</span>
          </div>
          <div class="cell-sub">КРЕДИТЫ</div>
        </div>
        <div class="cell">
          <div class="pz-display" style="font-size: 18px">+{{ reward.xp }} <span style="font-size: 11px; opacity: 0.6">ОП</span></div>
          <div class="cell-sub">ОПЫТ ЭКИПАЖА</div>
        </div>
      </div>
    </div>

    <!-- действия -->
    <div style="width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 10px; margin-top: 18px">
      <button class="pz-cta pz-cta--hazard" @click="emit('rematch')">ЕЩЁ БОЙ</button>
      <button class="pz-btn2" @click="emit('hangar')">В ангар</button>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px;
}
.card {
  width: 100%;
  max-width: 340px;
  position: relative;
  background:
    linear-gradient(175deg, rgba(242, 232, 207, 0.92), rgba(230, 217, 184, 0.94) 80%),
    url('/sprites/paper.png') center / cover;
  color: var(--paper-ink);
  border-radius: 4px;
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.6),
    inset 0 0 60px rgba(120, 90, 30, 0.18);
  padding: 22px 22px 18px;
  animation: pz-slide-up 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  font-family: var(--font-body);
}
.holes {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 130px;
}
.holes span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--bg-1);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7);
}
.head {
  text-align: center;
  border-bottom: 1.5px dashed rgba(33, 29, 18, 0.35);
  padding-bottom: 10px;
}
.stamp {
  font-size: 34px;
  letter-spacing: 0.06em;
  border: 3.5px solid;
  border-radius: 6px;
  padding: 4px 18px;
  opacity: 0.88;
  animation: pz-stamp 0.45s 0.15s ease both;
  -webkit-mask-image: radial-gradient(circle at 30% 60%, #000 60%, rgba(0, 0, 0, 0.72));
  mask-image: radial-gradient(circle at 30% 60%, #000 60%, rgba(0, 0, 0, 0.72));
}
.cell {
  text-align: center;
  background: rgba(33, 29, 18, 0.07);
  border-radius: 4px;
  padding: 8px 4px;
}
.cell-sub {
  font-size: 10.5px;
  opacity: 0.6;
  margin-top: 2px;
  font-weight: 600;
  letter-spacing: 0.08em;
}
</style>
