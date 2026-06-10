<script setup>
// Ежедневный вход: оверлей с серией дней (цикл 7) и кнопкой «Забрать».
// Показывается из App.vue, когда dailyAvailable().
import { computed, ref } from 'vue'
import { profile, claimDaily } from '../store.js'
import { DAILY_REWARDS } from '../game/meta.js'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['close'])

// какой день серии предлагается (вчера заходил → +1, иначе 1)
const dayStr = (d = new Date()) => d.toISOString().slice(0, 10)
const nextDay = computed(() => {
  const yesterday = dayStr(new Date(Date.now() - 86400e3))
  return profile.daily.last === yesterday ? profile.daily.streak + 1 : 1
})
const claimed = ref(null)

function claim() {
  claimed.value = claimDaily()
  setTimeout(() => emit('close'), 1100)
}

const fmtReward = (r) =>
  [r.credits && `${r.credits} кредитов`, r.tokens && `${r.tokens} жетонов`, r.gold && `★${r.gold} голд`]
    .filter(Boolean)
    .join(' + ')
</script>

<template>
  <div class="overlay">
    <div class="pz-plate pz-brackets card" style="--bk: var(--amber)">
      <div class="pz-stencil-h" style="justify-content: center">ЕЖЕДНЕВНОЕ ДОВОЛЬСТВИЕ</div>
      <div style="font-size: 12px; color: var(--ink-dim); text-align: center; font-weight: 500">
        День {{ nextDay }} серии — заходи каждый день, награды растут
      </div>

      <div class="days">
        <div
          v-for="(r, i) in DAILY_REWARDS"
          :key="i"
          class="day"
          :class="{ on: i + 1 === ((nextDay - 1) % 7) + 1, past: i + 1 < ((nextDay - 1) % 7) + 1 }"
        >
          <span class="pz-pixel" style="font-size: 7px">{{ i + 1 }}</span>
          <PzIcon v-if="r.tokens && !r.credits" name="token" :size="14" />
          <PzIcon v-else name="coin" :size="14" />
          <span class="amt">{{ r.credits || r.tokens }}{{ r.gold ? '+★' : '' }}</span>
        </div>
      </div>

      <button v-if="!claimed" class="pz-cta" style="font-size: 15px; padding: 12px 16px" @click="claim">
        ЗАБРАТЬ · {{ fmtReward(DAILY_REWARDS[(nextDay - 1) % 7]) }}
      </button>
      <div v-else class="pz-display got">+ {{ fmtReward(claimed.reward) }} ✓</div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 7, 4, 0.72);
  backdrop-filter: blur(3px);
}
.card {
  width: min(86vw, 330px);
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: pz-pop 0.3s ease;
}
.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 7px 2px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--line);
  color: var(--ink-dim);
}
.day.on {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.12);
  color: var(--ink);
}
.day.past {
  opacity: 0.45;
}
.amt {
  font-size: 9px;
  font-weight: 700;
}
.got {
  text-align: center;
  font-size: 15px;
  color: var(--green);
  padding: 12px 0;
  animation: pz-pop 0.3s ease;
}
</style>
