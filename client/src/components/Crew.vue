<script setup>
// Экипаж: уровень и опыт (общие на все танки), очки навыка (+1 за уровень
// после первого) и перки пяти специалистов — ранг за очко + кредиты.
import { ref, computed } from 'vue'
import {
  profile,
  crewLevel,
  crewProgress,
  crewPerkLevel,
  crewPointsFree,
  crewPointsSpent,
  upgradeCrewPerk,
  CREW_LEVEL_XP,
  CREW_MAX_LEVEL,
} from '../store.js'
import { CREW_MEMBERS, CREW_PERK_MAX, crewPerkCost } from '../game/meta.js'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['go'])
const fmt = (n) => (n || 0).toLocaleString('ru-RU')

const lvl = computed(() => crewLevel())
const maxed = computed(() => lvl.value >= CREW_MAX_LEVEL)
const xpInto = computed(() => (maxed.value ? CREW_LEVEL_XP : profile.crew.xp % CREW_LEVEL_XP))
// уровень экипажа, на котором откроется следующее очко навыка
const nextPointAt = computed(() => crewPointsSpent() + 2)

// итоговый бафф (приближённо-аддитивно — для витрины достаточно)
const totals = computed(() => {
  const sk = profile.crew.skills || {}
  const base = lvl.value - 1 + (sk.cmd || 0)
  return {
    dmg: (sk.gnr || 0) * 3,
    reload: base + (sk.lod || 0) * 3,
    run: base + (sk.drv || 0) * 3,
    vision: base + (sk.rad || 0) * 4,
  }
})

const toast = ref(null)
const flashId = ref(null)
let toastTimer = null
function showToast(text, bad = false) {
  toast.value = { text, bad }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 2200)
}

function buy(m) {
  if (upgradeCrewPerk(m.id)) {
    showToast(`${m.role}: «${m.perk}» — ранг ${crewPerkLevel(m.id)}`)
    return
  }
  flashId.value = m.id
  setTimeout(() => (flashId.value = null), 600)
  if (crewPointsFree() < 1) showToast('Нет очков навыка — качайте уровень экипажа в боях', true)
  else showToast('Не хватает кредитов', true)
}
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.9), rgba(13, 15, 10, 0.95)), url('/sprites/hangar.png') center / cover no-repeat">
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px">
      <div class="pz-display" style="font-size: 17px">ЭКИПАЖ</div>
      <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" @shop="emit('go', 'shop')" />
    </header>

    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 8px 14px 12px; display: flex; flex-direction: column; gap: 10px">
      <!-- уровень и опыт -->
      <div class="pz-plate" style="padding: 12px 14px; display: flex; gap: 12px; align-items: center">
        <div class="lvl-dot pz-display">{{ lvl }}</div>
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px">
            <span class="pz-display" style="font-size: 15px">УРОВЕНЬ {{ lvl }}<span v-if="maxed" style="color: var(--amber)"> · МАКС</span></span>
            <span style="font-size: 10.5px; color: var(--ink-dim); font-weight: 500">{{ maxed ? 'предел подготовки' : `${fmt(xpInto)} / ${fmt(CREW_LEVEL_XP)} ОП` }}</span>
          </div>
          <div class="xp-track"><b :style="{ width: crewProgress() * 100 + '%' }"></b></div>
          <div style="font-size: 10.5px; color: var(--ink-dim); font-weight: 500; margin-top: 4px">
            Уровень даёт +1% к темпу, обзору, ходу и манёвру — и 1 очко навыка.
          </div>
        </div>
      </div>

      <!-- очки и итоговый бафф -->
      <div style="display: flex; gap: 6px; flex-wrap: wrap">
        <span class="pz-chip" :style="{ color: crewPointsFree() > 0 ? 'var(--amber)' : 'var(--ink-dim)', borderColor: crewPointsFree() > 0 ? 'var(--amber)' : 'var(--line-strong)' }">
          <PzIcon name="star" :size="12" :color="crewPointsFree() > 0 ? 'var(--amber)' : 'var(--ink-faint)'" />
          Очки навыка: {{ crewPointsFree() }}
        </span>
        <span class="pz-chip" style="font-size: 11px; color: var(--ink-dim)">урон +{{ totals.dmg }}%</span>
        <span class="pz-chip" style="font-size: 11px; color: var(--ink-dim)">темп +{{ totals.reload }}%</span>
        <span class="pz-chip" style="font-size: 11px; color: var(--ink-dim)">ход +{{ totals.run }}%</span>
        <span class="pz-chip" style="font-size: 11px; color: var(--ink-dim)">обзор +{{ totals.vision }}%</span>
      </div>

      <div class="pz-stencil-h" style="margin-top: 2px">Специалисты</div>

      <!-- специалисты -->
      <div
        v-for="m in CREW_MEMBERS"
        :key="m.id"
        class="pz-plate mrow"
        :style="{ borderColor: crewPerkLevel(m.id) >= CREW_PERK_MAX ? 'rgba(242,165,12,.4)' : 'var(--line)' }"
      >
        <div class="m-dot" :style="{ borderColor: crewPerkLevel(m.id) > 0 ? 'var(--amber)' : 'var(--line-strong)', color: crewPerkLevel(m.id) > 0 ? 'var(--amber)' : 'var(--ink-faint)' }">
          <PzIcon :name="m.icon" :size="18" />
        </div>

        <div style="min-width: 0">
          <div style="display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap">
            <span class="pz-display" style="font-size: 14px">{{ m.role }}</span>
            <span style="font-size: 10.5px; color: var(--ink-faint); font-weight: 500">{{ m.name }}</span>
          </div>
          <div style="font-size: 11px; color: var(--ink-dim); font-weight: 500; margin-top: 2px">«{{ m.perk }}» · {{ m.effect }}</div>
          <div style="display: flex; gap: 3px; margin-top: 5px">
            <span
              v-for="r in CREW_PERK_MAX"
              :key="r"
              class="pip"
              :style="{ background: r <= crewPerkLevel(m.id) ? 'var(--amber)' : 'rgba(255,255,255,.14)' }"
            ></span>
          </div>
        </div>

        <span v-if="crewPerkLevel(m.id) >= CREW_PERK_MAX" class="pz-chip" style="color: var(--amber); font-size: 10.5px">МАКС ★</span>
        <button
          v-else-if="crewPointsFree() > 0"
          class="pz-btn2"
          style="padding: 7px 11px; font-size: 11px; gap: 4px; border-color: var(--amber); color: var(--amber)"
          :style="{ animation: flashId === m.id ? 'pz-shake .3s linear 2' : 'none' }"
          @click="buy(m)"
        >
          <PzIcon name="coin" :size="12" /> {{ fmt(crewPerkCost(crewPerkLevel(m.id))) }}
        </button>
        <span v-else class="pz-chip" style="color: var(--ink-faint); font-size: 10.5px">
          <PzIcon name="lock" :size="10" /> очко на ур. {{ nextPointAt }}
        </span>
      </div>

      <div style="font-size: 11px; color: var(--ink-faint); font-weight: 500; line-height: 1.5; padding: 0 2px">
        Экипаж один на все машины и получает половину опыта каждого боя. Очков навыка меньше, чем рангов, — выбирайте специализацию с умом.
      </div>
    </div>

    <div v-if="toast" class="toast" :style="{ borderColor: toast.bad ? 'var(--red)' : 'var(--amber)', color: toast.bad ? 'var(--red)' : 'var(--ink)' }">{{ toast.text }}</div>

    <BottomNav screen="crew" @go="emit('go', $event)" />
  </div>
</template>

<style scoped>
.lvl-dot {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid var(--amber);
  background: rgba(242, 165, 12, 0.1);
  color: var(--amber);
  font-size: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.xp-track {
  height: 7px;
  margin-top: 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line);
  overflow: hidden;
}
.xp-track b {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--amber-deep), var(--amber) 70%, var(--amber-hi));
  transition: width 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.mrow {
  display: grid;
  grid-template-columns: 42px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.m-dot {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--line-strong);
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pip {
  width: 14px;
  height: 5px;
  border-radius: 2px;
}
.toast {
  position: absolute;
  bottom: 96px;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: var(--bg-2);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  z-index: 5;
  animation: pz-slide-up 0.25s ease;
}
</style>
