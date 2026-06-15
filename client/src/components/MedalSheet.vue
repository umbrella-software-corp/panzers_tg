<script setup>
// Модалка медали: тап по значку (витрина/профиль/результаты) → что это за
// медаль, КАК ПОЛУЧИТЬ (условие), награда за первое получение и статус
// (получена N раз / ещё нет). Стиль — как PlayerCard (плашка с кронштейнами).
import { computed } from 'vue'
import { MEDAL_TIER_COLOR } from '../game/meta.js'
import { t } from '../i18n.js'
import Medal from './ui/Medal.vue'
import PzIcon from './ui/PzIcon.vue'

const props = defineProps({
  medal: { type: Object, required: true }, // запись из MEDALS
  count: { type: Number, default: 0 }, // сколько раз получена
})
const emit = defineEmits(['close'])

const tierColor = computed(() => MEDAL_TIER_COLOR[props.medal.tier] || MEDAL_TIER_COLOR.bronze)
const tierName = computed(() => t(`game.medalTiers.${props.medal.tier}`) || '')
const career = computed(() => props.medal.kind === 'career')
const earned = computed(() => props.count > 0)
const reward = computed(() => props.medal.reward || {})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="card pz-plate pz-brackets" :style="{ '--bk': tierColor }">
      <button class="x" @click="emit('close')">✕</button>

      <div class="hero" :class="{ off: !earned }">
        <Medal :medal="medal" :size="92" :locked="!earned" />
      </div>
      <div class="name pz-display" :style="{ color: tierColor }">{{ medal.name }}</div>
      <div class="chips">
        <span class="chip" :style="{ color: tierColor, borderColor: tierColor }">{{ tierName }}</span>
        <span class="chip dim">{{ career ? t('medals.typeCareer') : t('medals.typeBattle') }}</span>
      </div>

      <div class="block">
        <div class="pz-pixel blabel">{{ t('medals.howTo') }}</div>
        <div class="cond">{{ medal.desc }}</div>
        <div class="hint">{{ career ? t('medals.hintCareer') : t('medals.hintBattle') }}</div>
      </div>

      <div v-if="reward.credits || reward.tokens" class="block">
        <div class="pz-pixel blabel">{{ t('medals.reward') }} <span class="rsub">{{ t('medals.rewardSub') }}</span></div>
        <div class="rrow">
          <span v-if="reward.credits" class="ritem"><PzIcon name="coin" :size="15" />{{ reward.credits.toLocaleString('ru-RU') }}</span>
          <span v-if="reward.tokens" class="ritem"><PzIcon name="token" :size="15" />{{ reward.tokens }}</span>
        </div>
      </div>

      <div class="status" :class="{ on: earned }">
        <template v-if="earned">{{ career ? t('medals.earnedOnce') : t('medals.timesGot', { n: count }) }}</template>
        <template v-else>{{ t('medals.notEarned') }}</template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(6, 9, 14, 0.72);
  backdrop-filter: blur(4px);
}
.card {
  position: relative;
  width: 100%;
  max-width: 300px;
  padding: 24px 18px 16px;
  animation: pz-pop 0.25s ease;
}
.x {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--line-strong);
  color: var(--ink-dim);
  cursor: pointer;
  font-size: 13px;
}
.hero {
  display: flex;
  justify-content: center;
  margin: 4px 0 12px;
}
.hero.off {
  opacity: 0.85;
}
.name {
  text-align: center;
  font-size: 20px;
  line-height: 1.1;
}
.chips {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
}
.chip {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 9px;
  border-radius: 11px;
  border: 1px solid var(--line-strong);
  text-transform: uppercase;
}
.chip.dim {
  color: var(--ink-dim);
}
.block {
  margin-top: 14px;
  padding: 11px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
}
.blabel {
  font-size: 7px;
  color: var(--ink-faint);
  letter-spacing: 0.1em;
}
.rsub {
  color: var(--ink-faint);
  letter-spacing: 0.06em;
}
.cond {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.25;
}
.hint {
  margin-top: 5px;
  font-size: 11px;
  color: var(--ink-dim);
  line-height: 1.3;
}
.rrow {
  display: flex;
  gap: 16px;
  margin-top: 7px;
}
.ritem {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 16px;
  font-weight: 700;
  color: var(--amber);
}
.status {
  margin-top: 14px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--ink-faint);
}
.status.on {
  color: var(--green, #6fcf5f);
}
</style>
