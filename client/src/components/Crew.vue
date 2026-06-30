<script setup>
// Экипаж: уровень и опыт (общие на все танки), очки навыка (1 за 2 уровня
// экипажа) и перки пяти специалистов — ранг за очко + кредиты.
import { ref, computed } from 'vue'
import {
  profile,
  crewLevel,
  crewProgress,
  crewPerkLevel,
  crewPointsFree,
  crewPointsSpent,
  upgradeCrewPerk,
  crewXpInto,
  crewXpNeed,
  CREW_MAX_LEVEL,
} from '../store.js'
import { CREW_MEMBERS, CREW_PERK_MAX, crewPerkCost } from '../game/meta.js'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'
import PzIcon from './ui/PzIcon.vue'
import { t, fmtNum } from '../i18n.js'

const emit = defineEmits(['go'])
const fmt = (n) => fmtNum(n || 0)

const lvl = computed(() => crewLevel())
const maxed = computed(() => lvl.value >= CREW_MAX_LEVEL)
const xpInto = computed(() => (maxed.value ? crewXpNeed() : crewXpInto()))
const xpNeed = computed(() => crewXpNeed())
// уровень экипажа, на котором откроется СЛЕДУЮЩЕЕ очко навыка.
// Очки идут 1 за 2 уровня (crewPointsFree = round((lvl-1)/2) - spent), т.е. k-е очко
// открывается ровно на уровне 2k. Следующее (spent+1-е) → на уровне (spent+1)*2.
// (Раньше было `spent + 2` — верно для СТАРОЙ схемы «+1 очко/уровень»; при переходе на
// «1 за 2 уровня» формулу забыли поправить → показывало бред вроде «очко на ур.17» у
// игрока 30 ур. Тикет #27.)
const nextPointAt = computed(() => Math.min(CREW_MAX_LEVEL, (crewPointsSpent() + 1) * 2))

// итоговый бафф (приближённо-аддитивно — для витрины достаточно)
// итоговый бафф для чипов (зеркало loadoutStats, аддитивная аппроксимация): пассив
// +0.15%/ур + перки (cmd +0.3, gnr/lod/drv +0.9, rad +1.2 за ранг). Округляем.
const totals = computed(() => {
  const sk = profile.crew.skills || {}
  const passive = (lvl.value - 1) * 0.15 + (sk.cmd || 0) * 0.3
  return {
    dmg: Math.round((sk.gnr || 0) * 0.9),
    reload: Math.round(passive + (sk.lod || 0) * 0.9),
    run: Math.round(passive + (sk.drv || 0) * 0.9),
    vision: Math.round(passive + (sk.rad || 0) * 1.2),
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

async function buy(m) {
  if (await upgradeCrewPerk(m.id)) {
    showToast(t('crew.rankToast', { role: m.role, perk: m.perk, rank: crewPerkLevel(m.id) }))
    return
  }
  flashId.value = m.id
  setTimeout(() => (flashId.value = null), 600)
  if (crewPointsFree() < 1) showToast(t('crew.noPoints'), true)
  else showToast(t('crew.noCredits'), true)
}
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.9), rgba(13, 15, 10, 0.95)), url('/sprites/hangar.png') center / cover no-repeat">
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px">
      <div class="pz-display" style="font-size: 17px">{{ t('crew.title') }}</div>
      <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" @shop="emit('go', 'shop')" />
    </header>

    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 8px 14px 12px; display: flex; flex-direction: column; gap: 10px">
      <!-- уровень и опыт -->
      <div class="pz-plate" style="padding: 12px 14px; display: flex; gap: 12px; align-items: center">
        <div class="lvl-dot pz-display">{{ lvl }}</div>
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px">
            <span class="pz-display" style="font-size: 15px">{{ t('crew.level', { lvl }) }}<span v-if="maxed" style="color: var(--amber)">{{ t('crew.max') }}</span></span>
            <span style="font-size: 10.5px; color: var(--ink-dim); font-weight: 500">{{ maxed ? t('crew.trainingCap') : t('crew.xpLine', { into: fmt(xpInto), need: fmt(xpNeed) }) }}</span>
          </div>
          <div class="xp-track"><b :style="{ width: crewProgress() * 100 + '%' }"></b></div>
          <div style="font-size: 10.5px; color: var(--ink-dim); font-weight: 500; margin-top: 4px">
            {{ t('crew.levelBuff') }}
          </div>
        </div>
      </div>

      <!-- очки и итоговый бафф -->
      <div style="display: flex; gap: 6px; flex-wrap: wrap">
        <span class="pz-chip" :style="{ color: crewPointsFree() > 0 ? 'var(--amber)' : 'var(--ink-dim)', borderColor: crewPointsFree() > 0 ? 'var(--amber)' : 'var(--line-strong)' }">
          <PzIcon name="star" :size="12" :color="crewPointsFree() > 0 ? 'var(--amber)' : 'var(--ink-faint)'" />
          {{ t('crew.skillPoints', { n: crewPointsFree() }) }}
        </span>
        <span class="pz-chip" style="font-size: 11px; color: var(--ink-dim)">{{ t('crew.buffDmg', { n: totals.dmg }) }}</span>
        <span class="pz-chip" style="font-size: 11px; color: var(--ink-dim)">{{ t('crew.buffReload', { n: totals.reload }) }}</span>
        <span class="pz-chip" style="font-size: 11px; color: var(--ink-dim)">{{ t('crew.buffRun', { n: totals.run }) }}</span>
        <span class="pz-chip" style="font-size: 11px; color: var(--ink-dim)">{{ t('crew.buffVision', { n: totals.vision }) }}</span>
      </div>

      <div class="pz-stencil-h" style="margin-top: 2px">{{ t('crew.specialists') }}</div>

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
          <div style="font-size: 11px; color: var(--ink-dim); font-weight: 500; margin-top: 2px">{{ t('crew.perkLine', { perk: m.perk, effect: m.effect }) }}</div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px">
            <div class="rank-track"><b :style="{ width: (crewPerkLevel(m.id) / CREW_PERK_MAX) * 100 + '%' }"></b></div>
            <span class="pz-display" style="font-size: 11px; color: var(--amber); flex-shrink: 0">{{ crewPerkLevel(m.id) }}/{{ CREW_PERK_MAX }}</span>
          </div>
        </div>

        <span v-if="crewPerkLevel(m.id) >= CREW_PERK_MAX" class="pz-chip" style="color: var(--amber); font-size: 10.5px">{{ t('crew.maxRank') }}</span>
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
          <PzIcon name="lock" :size="10" /> {{ t('crew.pointAt', { lvl: nextPointAt }) }}
        </span>
      </div>

      <div style="font-size: 11px; color: var(--ink-faint); font-weight: 500; line-height: 1.5; padding: 0 2px">
        {{ t('crew.note') }}
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
/* полоса рангов перка (10 рангов — число + бар вместо точек) */
.rank-track {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line);
  overflow: hidden;
}
.rank-track b {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--amber-deep), var(--amber) 70%, var(--amber-hi));
  transition: width 0.3s ease;
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
