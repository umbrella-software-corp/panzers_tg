<script setup>
// «Подпишись на канал → бонус» (набор тестеров). Двухшаговый флоу:
// 1) «Открыть канал» (openTelegramLink) → 2) «Я подписался — забрать».
// Проверку подписки и начисление делает СЕРВЕР (getChatMember + флаг), клиент после
// успеха дёргает syncProfile() и подтягивает новый баланс — как после покупки за Stars.
import { ref } from 'vue'
import { serverConfig, syncProfile } from '../store.js'
import { apiChannelBonus } from '../api.js'
import { openTelegramLink, haptic } from '../tg.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['close'])
const ch = serverConfig.channel
const status = ref('idle') // idle | checking | notYet | done | already | error
const opened = ref(false) // нажал ли «Открыть канал» (подсветка кнопки «Забрать»)

track('channel_bonus_opened', { credits: ch.credits, tokens: ch.tokens })

function subscribe() {
  track('channel_subscribe_click')
  haptic('light')
  openTelegramLink(ch.url)
  opened.value = true
}

async function claim() {
  if (status.value === 'checking' || status.value === 'done') return
  status.value = 'checking'
  try {
    const r = await apiChannelBonus()
    if (r.ok) {
      track('channel_bonus_claimed', { credits: ch.credits, tokens: ch.tokens })
      await syncProfile() // подтянуть новый баланс + флаг channelBonusClaimed
      haptic('success')
      status.value = 'done'
      setTimeout(() => emit('close'), 1600)
    } else if (r.already) {
      await syncProfile()
      status.value = 'already'
      setTimeout(() => emit('close'), 1600)
    } else if (r.subscribed === false) {
      track('channel_bonus_not_subscribed')
      haptic('error')
      status.value = 'notYet'
    } else {
      status.value = 'error'
    }
  } catch {
    status.value = 'error'
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="pz-plate pz-brackets sheet" style="--bk: var(--amber)">
      <div class="pz-stencil-h" style="justify-content: center">{{ t('channel.title') }}</div>
      <div style="font-size: 11.5px; color: var(--ink-dim); text-align: center; font-weight: 500; margin-top: -2px">
        {{ t('channel.sub') }}
      </div>

      <!-- награда -->
      <div class="reward">
        <div class="reward-label">{{ t('channel.reward') }}</div>
        <div class="reward-row">
          <span v-if="ch.credits" class="rchip"><PzIcon name="coin" :size="18" /> {{ ch.credits }}</span>
          <span v-if="ch.tokens" class="rchip"><PzIcon name="token" :size="18" /> {{ ch.tokens }}</span>
        </div>
      </div>

      <!-- успех / уже получено -->
      <div v-if="status === 'done'" class="note ok">{{ t('channel.done') }}</div>
      <div v-else-if="status === 'already'" class="note ok">{{ t('channel.already') }}</div>
      <template v-else>
        <div v-if="status === 'notYet'" class="note warn">{{ t('channel.notYet') }}</div>
        <div v-else-if="status === 'error'" class="note warn">{{ t('channel.error') }}</div>

        <button class="pz-btn2" style="border-color: var(--amber); color: var(--amber)" @click="subscribe">
          {{ t('channel.subscribe') }}
        </button>
        <button class="pz-cta" :class="{ glow: opened }" :disabled="status === 'checking'" @click="claim">
          {{ status === 'checking' ? t('channel.checking') : t('channel.check') }}
        </button>
      </template>

      <button class="pz-btn2" style="opacity: 0.8" @click="emit('close')">{{ t('common.close') }}</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(5, 7, 4, 0.7);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.sheet {
  width: 100%;
  max-width: 330px;
  padding: 18px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: pz-pop 0.25s ease;
}
.reward {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  padding: 10px;
  text-align: center;
}
.reward-label {
  font-size: 10.5px;
  color: var(--ink-dim);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.reward-row {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 6px;
}
.rchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 18px;
  font-weight: 800;
  color: var(--ink);
}
.note {
  font-size: 11.5px;
  font-weight: 600;
  text-align: center;
  padding: 2px 0;
}
.note.ok {
  color: var(--green);
}
.note.warn {
  color: var(--amber);
}
.glow {
  animation: pz-glow 1.3s ease-in-out infinite;
}
@keyframes pz-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(255, 193, 7, 0);
  }
  50% {
    box-shadow: 0 0 14px 1px rgba(255, 193, 7, 0.45);
  }
}
</style>
