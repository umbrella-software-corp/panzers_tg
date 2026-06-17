<script setup>
// Результаты боя (порт ResultsScreen): крафт-донесение со штампом, два листа
// как в макете — «Сводка» и «По целям» (по-целевой лог урона из движка).
// Опыт расписан: половина в ветку нации танка, половина экипажу.
import { computed, ref, onMounted } from 'vue'
import { profile, battleEarnedMedals, grantFirstBattleReward } from '../store.js'
import { TANK_BY_ID, NATIONS, nationOf, ratingBand, MEDAL_BY_ID } from '../game/meta.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'
import PzIcon from './ui/PzIcon.vue'
import Medal from './ui/Medal.vue'
import MedalSheet from './MedalSheet.vue'

const selMedal = ref(null) // открытая модалка медали (тап по значку)
const firstBonus = ref(0) // бонус за первый завершённый бой (выдаётся один раз тут)
const props = defineProps({
  // снапшот матча из Battle: result/kills/deaths/damageDealt/accuracy/allyScore/enemyScore
  state: { type: Object, required: true },
  // награда { xp, silver }
  reward: { type: Object, required: true },
})
const emit = defineEmits(['rematch', 'hangar'])

const page = ref(0) // 0 — Сводка, 1 — По бойцам (таблица урона обеих команд)
// итоговая таблица урона: все бойцы, отсортированы по урону (сверху — топ)
const scoreboard = computed(() => props.state.scoreboard || [])
const tankName = computed(() => (TANK_BY_ID[profile.selectedTank] || {}).name || '')
const log = computed(() => props.state.damageLog || [])
const totalDmg = computed(() => log.value.reduce((a, x) => a + x.dmg, 0))
const tankOf = (id) => (TANK_BY_ID[id] || {}).name || ''
// сплит опыта: как в bankBattleXp (половина экипажу, половина ветке)
const crewXp = computed(() => Math.round(props.reward.xp / 2))
const branchXp = computed(() => props.reward.xp - crewXp.value)
const branchLabel = computed(() => (NATIONS.find((n) => n.id === nationOf(profile.selectedTank)) || {}).label || '')
const won = computed(() => props.state.result === 'victory')
// изменение боевого рейтинга за этот бой (wn8 уже пересчитан в store)
const ratingDelta = computed(() => profile.stats.lastWn8Delta || 0)
const ratingNow = computed(() => profile.stats.wn8 || 0)
const ratingCol = computed(() => ratingBand(ratingNow.value).color)
const stamp = computed(() =>
  props.state.result === 'victory' ? t('common.victory') : props.state.result === 'defeat' ? t('common.defeat') : t('common.draw'),
)
// почему бой завершился — короткая строка под штампом («Задача выполнена/провалена»)
const reasonText = computed(() => {
  const win = props.state.result === 'victory'
  switch (props.state.endReason) {
    case 'caps':
      return win ? t('results.reasonCapsWin') : t('results.reasonCapsLose')
    case 'wipe':
      return win ? t('results.reasonWipeWin') : t('results.reasonWipeLose')
    case 'score':
      return win ? t('results.reasonScoreWin') : t('results.reasonScoreLose')
    case 'time':
      return win ? t('results.reasonTimeWin') : t('results.reasonTimeLose')
    case 'aborted':
      return t('results.reasonAborted')
    default:
      return ''
  }
})
// строка режима+счёта: захват — «счёт A:B»; уничтожение — «уничтожение · живых A:B»
const modeScore = computed(() =>
  props.state.mode === 'annihilation'
    ? t('results.modeAnnihilation', { a: props.state.alliesAlive, b: props.state.enemiesAlive })
    : t('results.modeScore', { a: props.state.allyScore, b: props.state.enemyScore }),
)
const rows = computed(() => [
  [t('results.statKills'), props.state.kills],
  [t('results.statDeaths'), props.state.deaths],
  [t('results.statDamage'), props.state.damageDealt],
  [t('results.statAccuracy'), props.state.accuracy + '%'],
])
// медали, заработанные в этом бою (считаются до начисления — флаг «впервые» точен)
const medals = computed(() =>
  battleEarnedMedals({
    kills: props.reward.kills,
    damage: props.reward.damage,
    blocked: props.reward.blocked,
    lightKills: props.reward.lightKills,
    survived: props.reward.survived,
    victory: props.reward.victory,
  })
    .map((e) => ({ ...e, def: MEDAL_BY_ID[e.id] }))
    .filter((e) => e.def),
)

onMounted(() => {
  // экран итогов = бой ЗАВЕРШЁН → выдаём морковку за первый бой (один раз, по флагу)
  firstBonus.value = grantFirstBattleReward()
  if (firstBonus.value > 0) track('first_battle_bonus_granted', { credits: firstBonus.value, result: props.state.result })
  track('results_shown', {
    result: props.state.result,
    end_reason: props.state.endReason || null,
    duration_sec: props.state.matchTime || null,
    damage: props.state.damageDealt || 0,
    kills: props.state.kills || 0,
    deaths: props.state.deaths || 0,
    accuracy: props.state.accuracy || 0,
    xp: props.reward.xp || 0,
    silver: props.reward.silver || 0,
    medals_count: medals.value.length,
  })
})
function setPage(i) {
  page.value = i
  track('results_tab_changed', {
    tab: i === 0 ? 'summary' : 'scoreboard',
    result: props.state.result,
  })
}
</script>

<template>
  <div class="wrap">
    <!-- донесение на крафт-бумаге -->
    <div class="card">
      <!-- дырки от дырокола -->
      <div class="holes"><span></span><span></span></div>

      <div class="head">
        <div class="pz-display" style="font-size: 13px; letter-spacing: 0.3em; opacity: 0.65">{{ t('results.title') }}</div>
        <div style="font-size: 11px; margin-top: 3px; opacity: 0.55; font-weight: 500">
          {{ t('results.crewLine', { tank: tankName, score: modeScore }) }}
        </div>
      </div>

      <!-- листы донесения (как скреплённые страницы) -->
      <div style="display: flex; gap: 6px; justify-content: center; margin-top: 10px">
        <button v-for="(label, i) in [t('results.tabSummary'), t('results.tabBySoldier')]" :key="label" class="pz-display sheet-tab" :class="{ on: page === i }" @click="setPage(i)">
          {{ label }} <span style="opacity: 0.55">· {{ t('results.sheet', { n: i + 1 }) }}</span>
        </button>
      </div>

      <template v-if="page === 0">
        <!-- штамп -->
        <div style="display: flex; justify-content: center; padding: 14px 0 4px">
          <div class="pz-display stamp" :style="{ color: won ? '#9a1f10' : '#3a3326', borderColor: won ? '#9a1f10' : '#3a3326' }">
            {{ stamp }}
          </div>
        </div>
        <div v-if="reasonText" class="reason">{{ reasonText }}</div>

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
            <div class="cell-sub">{{ t('results.credits') }}</div>
          </div>
          <div class="cell">
            <div class="pz-display" style="font-size: 18px">+{{ reward.xp }} <span style="font-size: 11px; opacity: 0.6">{{ t('common.xp') }}</span></div>
            <div class="cell-sub">{{ t('results.battleXp') }}</div>
          </div>
        </div>
        <!-- куда ушёл опыт -->
        <div style="font-size: 11.5px; font-weight: 600; opacity: 0.75; text-align: center; margin-top: 8px">
          {{ t('results.branchLine', { branch: branchLabel, branchXp, crewXp }) }}
        </div>
        <!-- прем-танк: кристаллы (💎) — выдача этого боя или счётчик до следующей -->
        <div v-if="reward.gems" class="prem-gems">
          <PzIcon name="token" :size="16" />
          <span class="pz-display">+{{ reward.gems }} {{ t('results.crystals') }}</span>
        </div>
        <div v-else-if="reward.premTank" class="prem-gems prem-gems-hint">
          <PzIcon name="token" :size="14" />
          <span>{{ t('results.crystalsIn', { n: reward.gemsIn }) }}</span>
        </div>
        <!-- морковка за первый завершённый бой (показываем только когда выдана) -->
        <div v-if="firstBonus" class="first-bonus">
          <PzIcon name="coin" :size="16" />
          <span class="pz-display">{{ t('results.firstBattleBonus', { n: firstBonus }) }}</span>
        </div>
        <!-- изменение боевого рейтинга -->
        <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1.5px dashed rgba(33, 29, 18, 0.35)">
          <span style="font-size: 12.5px; font-weight: 600; opacity: 0.7">{{ t('results.battleRating') }}</span>
          <span class="pz-display" style="font-size: 16px" :style="{ color: ratingCol }">{{ ratingNow }}</span>
          <span class="pz-display" style="font-size: 14px" :style="{ color: ratingDelta >= 0 ? '#2f7a1f' : '#9a1f10' }">{{ ratingDelta >= 0 ? '+' : '' }}{{ ratingDelta }}</span>
        </div>

        <!-- медали за бой -->
        <div v-if="medals.length" class="medals-strip">
          <div class="pz-display medals-cap">{{ t('results.medalsEarned') }}</div>
          <div class="medals-row">
            <div v-for="m in medals" :key="m.id" class="medal-item" @click="selMedal = { def: m.def, count: Math.max(1, profile.medals[m.id] || 0) }">
              <Medal :medal="m.def" :size="46" :is-new="m.isNew" />
              <div class="medal-name">{{ m.def.name }}</div>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- лист 2: по бойцам — урон обеих команд, сверху больше всего -->
        <div style="padding: 12px 2px 4px">
          <div v-if="!scoreboard.length" style="text-align: center; font-size: 13px; opacity: 0.6; padding: 24px 0; font-weight: 500">
            {{ t('results.counting') }}
          </div>
          <div v-else class="pz-noscroll" style="display: flex; flex-direction: column; gap: 3px; max-height: 46vh; overflow-y: auto">
            <div class="sb-row sb-head">
              <span class="sb-place">#</span><span class="sb-dot" style="visibility: hidden"></span>
              <span class="sb-name">{{ t('results.colSoldier') }}</span><span class="sb-dmg">{{ t('results.colDamage') }}</span>
            </div>
            <div v-for="(r, i) in scoreboard" :key="i" class="sb-row" :class="{ me: r.you }">
              <span class="sb-place">{{ i + 1 }}</span>
              <span class="sb-dot" :style="{ background: r.ally ? '#2f6ea0' : '#9a1f10' }"></span>
              <span class="sb-name">{{ r.you ? profile.name : r.name }}<span v-if="r.kills" style="opacity: 0.5; font-weight: 500"> · {{ t('results.frags', { n: r.kills }) }}</span></span>
              <span class="pz-display sb-dmg">{{ r.damage }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- действия -->
    <div style="width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 10px; margin-top: 18px">
      <button class="pz-cta pz-cta--hazard" @click="emit('rematch')">{{ t('results.rematch') }}</button>
      <button class="pz-btn2" @click="track('results_hangar_clicked', { result: state.result, end_reason: state.endReason || null }); emit('hangar')">{{ t('common.toHangar') }}</button>
    </div>

    <!-- модалка медали: что это и как получить -->
    <transition name="pz-fade">
      <MedalSheet v-if="selMedal" :medal="selMedal.def" :count="selMedal.count" @close="selMedal = null" />
    </transition>
  </div>
</template>

<style scoped>
/* медали за бой — на крафт-бумаге донесения */
.medals-strip {
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1.5px dashed rgba(33, 29, 18, 0.35);
}
.medals-cap {
  font-size: 11px;
  letter-spacing: 0.2em;
  text-align: center;
  color: var(--paper-ink);
  opacity: 0.6;
  margin-bottom: 10px;
}
.medals-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 14px;
}
.medal-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 62px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.medal-name {
  margin-top: 5px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.1;
  text-align: center;
  color: var(--paper-ink);
  opacity: 0.82;
}

/* таблица «По бойцам» — на крафт-бумаге донесения */
.sb-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--paper-ink);
}
.sb-row.me {
  background: rgba(154, 31, 16, 0.12);
  box-shadow: inset 0 0 0 1px rgba(154, 31, 16, 0.35);
}
.sb-head {
  font-size: 10px;
  letter-spacing: 0.14em;
  opacity: 0.5;
  position: sticky;
  top: 0;
}
.sb-place {
  width: 16px;
  text-align: center;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.sb-dot {
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: 50%;
}
.sb-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-dmg {
  min-width: 46px;
  text-align: right;
  font-size: 15px;
}
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
.sheet-tab {
  font-size: 11px;
  letter-spacing: 0.12em;
  padding: 5px 14px 4px;
  cursor: pointer;
  background: transparent;
  color: rgba(33, 29, 18, 0.6);
  border: 1.5px solid rgba(33, 29, 18, 0.5);
  border-radius: 3px;
}
.sheet-tab.on {
  background: rgba(33, 29, 18, 0.85);
  color: #ede3c8;
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
.reason {
  text-align: center;
  font-size: 12.5px;
  font-weight: 600;
  color: #5a4a2e;
  margin: 2px 0 0;
  letter-spacing: 0.02em;
}
.first-bonus {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 10px;
  padding: 9px 10px;
  border: 1.5px solid #9a6b10;
  border-radius: 6px;
  background: rgba(154, 107, 16, 0.14);
  color: #5a3e08;
  font-size: 14px;
  animation: pz-pop 0.4s 0.3s ease both;
}
/* прем-кристаллы: выдача этого боя (синий акцент) */
.prem-gems {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1.5px solid #2f6f93;
  border-radius: 6px;
  background: rgba(47, 111, 147, 0.14);
  color: #1d4663;
  font-size: 14px;
  animation: pz-pop 0.4s 0.35s ease both;
}
/* подсказка «до кристаллов N боёв» — тише, без рамки-акцента */
.prem-gems-hint {
  border: none;
  background: none;
  padding: 4px 0 0;
  margin-top: 4px;
  font-size: 11.5px;
  font-weight: 600;
  opacity: 0.7;
  animation: none;
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
