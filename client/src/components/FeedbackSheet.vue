<script setup>
// «Нам важно ваше мнение»: напиши в саппорт-бот → +N жетонов (разово). Открывается из
// баннера в ангаре. «Написать» → openSupport (личка саппорт-бота). «Я написал — забрать»
// → /api/feedback-bonus: сервер проверяет флаг wroteSupport (его ставит support.js при
// входящем сообщении игрока) и начисляет. Награду показываем тут же. Teleport в body —
// чтоб модалка не срывалась на мобиле (как было с окном ящика).
import { ref, computed } from 'vue'
import { profile, serverConfig, syncProfile } from '../store.js'
import { openSupport, haptic } from '../tg.js'
import { apiFeedbackBonus } from '../api.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['close'])
const busy = ref(false)
const note = ref('') // подсказка «сначала напиши»
const reward = ref(null) // { tokens, credits } после успешной выдачи
const tokens = computed(() => serverConfig.feedback.tokens || 0)

function write() {
  haptic('light')
  track('feedback_write_clicked', {})
  openSupport()
}

async function claim() {
  if (busy.value) return
  busy.value = true
  note.value = ''
  try {
    const r = await apiFeedbackBonus()
    if (r && r.ok && r.granted) {
      haptic('success')
      reward.value = r.granted
      profile.feedbackClaimed = true // мгновенно прячем баннер
      track('feedback_bonus_granted', { tokens: r.granted.tokens, credits: r.granted.credits })
      await syncProfile() // подтянуть начисленный баланс
    } else if (r && r.already) {
      profile.feedbackClaimed = true
      emit('close')
    } else {
      note.value = t('feedback.notYet') // wrote:false — ещё не писал в поддержку
      track('feedback_bonus_not_yet', {})
    }
  } catch {
    note.value = t('feedback.error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fb-overlay" @click.self="emit('close')">
      <div class="fb-card pz-plate pz-brackets" style="--bk: var(--amber)">
        <button class="fb-x" @click="emit('close')">✕</button>
        <template v-if="!reward">
          <div class="fb-emoji">💬</div>
          <div class="pz-display fb-title">{{ t('feedback.title') }}</div>
          <div class="fb-text">{{ t('feedback.body', { n: tokens }) }}</div>
          <button class="pz-cta fb-cta" @click="write">{{ t('feedback.write') }}</button>
          <button class="pz-btn2 fb-claim" :disabled="busy" @click="claim">{{ busy ? '…' : t('feedback.claim', { n: tokens }) }}</button>
          <div v-if="note" class="fb-note">{{ note }}</div>
        </template>
        <template v-else>
          <div class="fb-emoji">🎉</div>
          <div class="pz-display fb-title">{{ t('feedback.thanks') }}</div>
          <div class="fb-reward"><PzIcon name="token" :size="22" /> +{{ reward.tokens }}</div>
          <button class="pz-cta fb-cta" @click="emit('close')">{{ t('common.continue') }}</button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fb-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(6, 9, 14, 0.74);
  backdrop-filter: blur(4px);
}
.fb-card {
  position: relative;
  width: 100%;
  max-width: 330px;
  padding: 22px 18px 18px;
  text-align: center;
  animation: pz-pop 0.25s ease;
}
.fb-x {
  position: absolute;
  top: 8px;
  right: 10px;
  background: none;
  border: none;
  color: var(--ink-faint);
  font-size: 16px;
  cursor: pointer;
}
.fb-emoji {
  font-size: 34px;
}
.fb-title {
  font-size: 19px;
  margin-top: 6px;
  color: var(--ink);
}
.fb-text {
  margin-top: 8px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink-dim);
}
.fb-cta {
  width: 100%;
  margin-top: 16px;
  font-size: 15px;
  padding: 12px;
}
.fb-claim {
  width: 100%;
  margin-top: 9px;
}
.fb-note {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--amber);
}
.fb-reward {
  margin-top: 12px;
  font-size: 24px;
  font-weight: 700;
  color: var(--amber);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
</style>
