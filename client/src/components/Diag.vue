<script setup>
// ДИАГНОСТИКА ВХОДА. Скрытая панель для кейса «играю, но не залогинен» (@Z_86_V):
// показывает РОВНО где рвётся авторизация (SDK/initData/хеш/сервер), чтобы игрок прислал
// один скриншот вместо переписки. НИЧЕГО не меняет в поведении — только читает состояние.
// Открытие: 5 быстрых тапов в левом-верхнем углу экрана (слушатель пассивный — не
// перехватывает нажатия под собой, обычным игрокам невидим).
import { onMounted, onUnmounted, ref } from 'vue'
import { tgInitData, isFromTelegram, tgUserId } from '../tg.js'
import { serverSynced, authRejected, serverConfig } from '../store.js'
import { apiLoadProfile } from '../api.js'
import { openSupport } from '../tg.js'

const open = ref(false)
const rows = ref([])
const probe = ref('')
const copied = ref(false)

const clientBuild = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?'

function snapshot() {
  const wa = (window.Telegram && window.Telegram.WebApp) || null
  const sdkInit = (wa && wa.initData) || ''
  const hash = window.__PZ_TG_HASH || ''
  const eff = tgInitData() || ''
  const fromTg = isFromTelegram()
  const uid = tgUserId()
  let guest = ''
  try { guest = localStorage.getItem('pz.guest') || '' } catch { /* приватный режим */ }
  const sameBuild = serverConfig.buildId ? serverConfig.buildId === clientBuild : null
  rows.value = [
    mk('билд клиента', clientBuild),
    mk('билд сервера', serverConfig.buildId || '— (не загружен)'),
    mk('билды совпадают', sameBuild == null ? '—' : sameBuild ? 'ДА' : '⚠ НЕТ (старый бандл)', sameBuild === false),
    mk('SDK Telegram', wa ? 'есть' : 'НЕТ', !wa),
    mk('платформа', (wa && wa.platform) || '—'),
    mk('версия SDK', (wa && wa.version) || '—'),
    mk('SDK initData, длина', sdkInit.length),
    mk('launch-хеш захвачен', hash ? 'да' : 'НЕТ', !hash),
    mk('хеш с tgWebAppData', hash.includes('tgWebAppData') ? 'да' : 'НЕТ', !hash.includes('tgWebAppData')),
    mk('initData эффект., длина', eff.length, eff.length === 0),
    mk('isFromTelegram()', fromTg ? 'да' : 'НЕТ', !fromTg),
    mk('tgUserId()', uid != null ? String(uid) : '— (null)', uid == null),
    mk('guest-id', guest || '—'),
    mk('serverSynced', serverSynced.value ? 'да' : 'НЕТ', !serverSynced.value),
    mk('authRejected (401)', authRejected.value ? 'ДА' : 'нет', authRejected.value),
    mk('проверка /api/profile', probe.value || '— (нажми «Проверить вход»)', /^[45]\d\d|нет ответа/.test(probe.value)),
  ]
}
const mk = (k, v, bad = false) => ({ k, v: String(v), bad })

async function checkAuth() {
  probe.value = '…'
  snapshot()
  try {
    await apiLoadProfile()
    probe.value = '200 OK — сервер принял'
  } catch (e) {
    probe.value = (e && e.status ? e.status : 'нет ответа') + (e && e.message ? ' · ' + e.message : '')
  }
  snapshot()
}

function asText() {
  return rows.value.map((r) => r.k + ': ' + r.v).join('\n') + '\nUA: ' + (navigator.userAgent || '')
}
async function copyAll() {
  try {
    await navigator.clipboard.writeText(asText())
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}

// 5 тапов в левом-верхнем углу за 3с → открыть. Слушатель пассивный, в углу, обычные
// нажатия под ним продолжают работать (мы только считаем, ничего не глотаем).
let taps = []
function onTap(e) {
  const x = e.clientX != null ? e.clientX : (e.touches && e.touches[0] && e.touches[0].clientX)
  const y = e.clientY != null ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY)
  if (x == null || y == null || x > 80 || y > 110) return
  const now = Date.now()
  taps = taps.filter((t) => now - t < 3000)
  taps.push(now)
  if (taps.length >= 5) {
    taps = []
    snapshot()
    open.value = true
  }
}
onMounted(() => window.addEventListener('pointerdown', onTap, { passive: true, capture: true }))
onUnmounted(() => window.removeEventListener('pointerdown', onTap, { capture: true }))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="diag-ovl" @click.self="open = false">
      <div class="diag-card">
        <div class="diag-head">
          <b>Диагностика входа</b>
          <button class="diag-x" @click="open = false">✕</button>
        </div>
        <div class="diag-rows">
          <div v-for="(r, i) in rows" :key="i" class="diag-row">
            <span class="diag-k">{{ r.k }}</span>
            <span class="diag-v" :class="{ bad: r.bad }">{{ r.v }}</span>
          </div>
        </div>
        <div class="diag-btns">
          <button class="diag-btn" @click="checkAuth">Проверить вход</button>
          <button class="diag-btn" @click="copyAll">{{ copied ? 'Скопировано ✓' : 'Копировать' }}</button>
          <button class="diag-btn" @click="openSupport">В саппорт</button>
        </div>
        <div class="diag-hint">Сделай скриншот этого экрана и пришли в саппорт.</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.diag-ovl {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.72);
  padding: 16px;
}
.diag-card {
  width: 100%;
  max-width: 420px;
  max-height: 86vh;
  overflow: auto;
  background: #14180f;
  border: 1px solid #3a4128;
  border-radius: 12px;
  padding: 14px 14px 12px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: #e8e6da;
}
.diag-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 15px;
}
.diag-x {
  width: auto;
  padding: 4px 10px;
  background: #2a3019;
  color: #e8e6da;
  border: none;
  border-radius: 6px;
  font-size: 14px;
}
.diag-rows {
  font-size: 12.5px;
  line-height: 1.5;
}
.diag-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.diag-k {
  color: #8b9470;
  flex: 0 0 auto;
}
.diag-v {
  color: #cfe0a8;
  text-align: right;
  word-break: break-all;
}
.diag-v.bad {
  color: #ff6b5e;
  font-weight: 700;
}
.diag-btns {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}
.diag-btn {
  flex: 1;
  padding: 9px 6px;
  background: #2a3019;
  color: #f2a50c;
  border: 1px solid #3a4128;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
}
.diag-hint {
  margin-top: 10px;
  font-size: 11.5px;
  color: #8b9470;
  text-align: center;
}
</style>
