<script setup>
// Шторка настроек (из шестерёнки в шапке ангара). Содержит:
//  • чекбокс «реверсивное управление» — на заднем ходу руль идёт по джойстику (инверсия,
//    по тикету @anch_max). Вкл → invert ('follow'); ВЫКЛ (дефолт) → 'direct' без инверсии
//    (сменили дефолт по #28 «крутится сам»). Значение в профиле (store.setReverseSteer).
//  • строку «Поддержка» — открывает саппорт-бот (раньше была иконкой в шапке ангара).
// Teleport в body — чтобы модалка не срывалась на мобиле (как у FeedbackSheet).
import { computed, ref } from 'vue'
import { profile, setReverseSteer } from '../store.js'
import { haptic, openSupport, isTester3D } from '../tg.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'

const emit = defineEmits(['close'])

// 3D-графика (бета): галочка пишет localStorage.pz3d, который Battle.vue читает на старте
// боя (use3D). Виден только тем, кому доступен 3D-эксперимент (isTester3D).
const canUse3D = isTester3D()
const render3dOn = ref((() => { try { return localStorage.getItem('pz3d') === '1' } catch { return false } })())
function toggle3d() {
  render3dOn.value = !render3dOn.value
  try { localStorage.setItem('pz3d', render3dOn.value ? '1' : '0') } catch { /* приватный режим */ }
  haptic('select')
  track('settings_3d_changed', { on: render3dOn.value })
}

// чекбокс отмечен = режим 'follow' (инверсия руля на реверсе); снят = 'direct' (дефолт, классика)
const reverseOn = computed(() => profile.reverseSteer !== 'direct')

function toggleReverse() {
  const mode = reverseOn.value ? 'direct' : 'follow'
  setReverseSteer(mode)
  haptic('select')
  track('settings_reverse_changed', { mode })
}

function support() {
  track('support_opened', { from_screen: 'settings', before_first_battle: (profile.stats?.battles || 0) === 0 })
  haptic('light')
  openSupport()
}
</script>

<template>
  <Teleport to="body">
    <div class="set-overlay" @click.self="emit('close')">
      <div class="set-card pz-plate pz-brackets" style="--bk: var(--amber)">
        <button class="set-x" @click="emit('close')">✕</button>
        <div class="pz-display set-title">⚙ {{ t('settings.title') }}</div>

        <!-- 3D-графика (бета): чекбокс — пишет localStorage.pz3d, Battle.vue читает на старте боя -->
        <button v-if="canUse3D" class="set-check" :class="{ on: render3dOn }" @click="toggle3d">
          <span class="set-check-txt">
            <span class="set-check-label">{{ t('settings.render3dLabel') }}</span>
            <span class="set-check-hint">{{ t('settings.render3dHint') }}</span>
          </span>
          <span class="set-box" :class="{ on: render3dOn }" aria-hidden="true">
            <svg v-if="render3dOn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
        </button>

        <!-- реверсивное управление: чекбокс -->
        <button class="set-check" :class="{ on: reverseOn }" @click="toggleReverse">
          <span class="set-check-txt">
            <span class="set-check-label">{{ t('settings.reverseLabel') }}</span>
            <span class="set-check-hint">{{ t('settings.reverseHint') }}</span>
          </span>
          <span class="set-box" :class="{ on: reverseOn }" aria-hidden="true">
            <svg v-if="reverseOn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
        </button>
        <div class="set-apply">{{ t('settings.applyNote') }}</div>

        <div class="set-divider"></div>

        <!-- поддержка -->
        <button class="set-link" @click="support">
          <svg class="set-link-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
            <rect x="2.5" y="13" width="4" height="6" rx="1.6" />
            <rect x="17.5" y="13" width="4" height="6" rx="1.6" />
            <path d="M20 18v.5a3.5 3.5 0 0 1-3.5 3.5H13" />
          </svg>
          <span class="set-link-txt">
            <span class="set-link-label">{{ t('settings.support') }}</span>
            <span class="set-link-sub">{{ t('settings.supportSub') }}</span>
          </span>
          <span class="set-chev">›</span>
        </button>

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
/* чекбокс-строка */
.set-check {
  width: 100%;
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: 11px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.set-check.on {
  border-color: var(--amber);
  background: rgba(255, 176, 32, 0.08);
}
.set-check-txt {
  flex: 1;
  min-width: 0;
}
.set-check-label {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
}
.set-check-hint {
  display: block;
  margin-top: 3px;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--ink-dim);
}
.set-box {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1.5px solid var(--line-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1a1208;
  transition: background 0.15s, border-color 0.15s;
}
.set-box.on {
  background: var(--amber);
  border-color: var(--amber);
}
.set-apply {
  margin-top: 9px;
  font-size: 11.5px;
  color: var(--amber);
}
.set-divider {
  height: 1px;
  margin: 16px 0 0;
  background: var(--line-strong);
  opacity: 0.6;
}
/* строка-ссылка (поддержка) */
.set-link {
  width: 100%;
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: 11px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--ink);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.set-link:active {
  background: rgba(255, 255, 255, 0.05);
}
.set-link-ico {
  flex-shrink: 0;
  color: var(--amber);
}
.set-link-txt {
  flex: 1;
  min-width: 0;
}
.set-link-label {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
}
.set-link-sub {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ink-faint);
}
.set-chev {
  flex-shrink: 0;
  font-size: 20px;
  color: var(--ink-faint);
  line-height: 1;
}
.set-cta {
  width: 100%;
  margin-top: 18px;
  font-size: 15px;
  padding: 12px;
}
</style>
