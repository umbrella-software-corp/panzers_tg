<script setup>
// Шторка настроек (из шестерёнки в шапке ангара). Пока единственная настройка —
// схема управления задним ходом: после фикса инверсии руля часть игроков попросила
// вернуть старое поведение, поэтому даём выбор. Значение персистится в профиле
// (store.setReverseSteer), Battle.vue читает его на старте боя → NetGame.invertReverseSteer.
// Teleport в body — чтобы модалка не срывалась на мобиле (как у FeedbackSheet).
import { profile, setReverseSteer } from '../store.js'
import { haptic } from '../tg.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'

const emit = defineEmits(['close'])

function pickReverse(mode) {
  if (profile.reverseSteer === mode) return
  setReverseSteer(mode)
  haptic('select')
  track('settings_reverse_changed', { mode })
}
</script>

<template>
  <Teleport to="body">
    <div class="set-overlay" @click.self="emit('close')">
      <div class="set-card pz-plate pz-brackets" style="--bk: var(--amber)">
        <button class="set-x" @click="emit('close')">✕</button>
        <div class="pz-display set-title">⚙ {{ t('settings.title') }}</div>

        <div class="set-row">
          <div class="set-label">{{ t('settings.reverseTitle') }}</div>
          <div class="set-hint">{{ t('settings.reverseHint') }}</div>
          <div class="set-opts">
            <button class="set-opt" :class="{ on: profile.reverseSteer !== 'direct' }" @click="pickReverse('follow')">
              <span class="set-opt-name">{{ t('settings.reverseFollow') }}</span>
              <span class="set-opt-sub">{{ t('settings.reverseFollowSub') }}</span>
            </button>
            <button class="set-opt" :class="{ on: profile.reverseSteer === 'direct' }" @click="pickReverse('direct')">
              <span class="set-opt-name">{{ t('settings.reverseDirect') }}</span>
              <span class="set-opt-sub">{{ t('settings.reverseDirectSub') }}</span>
            </button>
          </div>
          <div class="set-apply">{{ t('settings.applyNote') }}</div>
        </div>

        <button class="pz-cta set-cta" @click="emit('close')">{{ t('settings.done') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.set-overlay {
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
.set-card {
  position: relative;
  width: 100%;
  max-width: 360px;
  padding: 22px 18px 18px;
  animation: pz-pop 0.25s ease;
}
.set-x {
  position: absolute;
  top: 8px;
  right: 10px;
  background: none;
  border: none;
  color: var(--ink-faint);
  font-size: 16px;
  cursor: pointer;
}
.set-title {
  font-size: 19px;
  color: var(--ink);
  text-align: center;
}
.set-row {
  margin-top: 16px;
}
.set-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}
.set-hint {
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-dim);
}
.set-opts {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.set-opt {
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--ink-dim);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.set-opt.on {
  border-color: var(--amber);
  color: var(--ink);
  background: rgba(255, 176, 32, 0.08);
}
.set-opt-name {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
}
.set-opt-sub {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--ink-faint);
}
.set-apply {
  margin-top: 9px;
  font-size: 11.5px;
  color: var(--amber);
}
.set-cta {
  width: 100%;
  margin-top: 18px;
  font-size: 15px;
  padding: 12px;
}
</style>
