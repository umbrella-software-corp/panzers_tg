<script setup>
// Магазин (порт ShopScreen): ящики снабжения за жетоны, паки кредитов и
// жетонов «за деньги» (пока мгновенное начисление — без реальных платежей).
import { ref } from 'vue'
import { profile, addRewards, spendTokens } from '../store.js'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'
import CrateIcon from './ui/CrateIcon.vue'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['go'])

const CRATES = [
  { id: 'c1', name: 'Полевой ящик', sub: '600 кредитов · обычные модули', tone: '#7d6434', costTokens: 5, gain: 600 },
  { id: 'c2', name: 'Офицерский ящик', sub: '1 800 кредитов · шанс на камуфляж', tone: '#6f7d8a', costTokens: 12, gain: 1800 },
  { id: 'c3', name: 'Генеральский ящик', sub: '4 500 кредитов · гарантия редкости', tone: '#9a5a2c', costTokens: 25, gain: 4500 },
]
const CREDIT_PACKS = [
  { id: 'p1', amount: 1000, price: '79 ₽' },
  { id: 'p2', amount: 3500, price: '229 ₽', hot: true },
  { id: 'p3', amount: 9000, price: '479 ₽' },
]
const TOKEN_PACKS = [
  { id: 't1', amount: 20, price: '99 ₽' },
  { id: 't2', amount: 60, price: '249 ₽', hot: true },
  { id: 't3', amount: 150, price: '499 ₽' },
]

const toast = ref(null) // { key, text, bad }
let toastTimer = null
function showToast(text, bad = false) {
  toast.value = { key: Date.now(), text, bad }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 1800)
}
function buyCrate(c) {
  if (!spendTokens(c.costTokens)) {
    showToast('Не хватает жетонов', true)
    return
  }
  addRewards(c.gain, 0)
  showToast(`${c.name} — получено!`)
}
function buyCredits(p) {
  addRewards(p.amount, 0)
  showToast(`${p.amount.toLocaleString('ru-RU')} кредитов — получено!`)
}
function buyTokens(p) {
  addRewards(0, p.amount)
  showToast(`${p.amount} жетонов — получено!`)
}
const fmt = (n) => n.toLocaleString('ru-RU')
</script>

<template>
  <div class="pz-screen">
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 8px">
      <div class="pz-display" style="font-size: 17px">МАГАЗИН</div>
      <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" />
    </header>

    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 16px">
      <!-- ящики -->
      <section>
        <div class="pz-stencil-h">ЯЩИКИ СНАБЖЕНИЯ</div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px">
          <div v-for="c in CRATES" :key="c.id" class="pz-plate" style="display: flex; align-items: center; gap: 12px; padding: 10px 12px">
            <CrateIcon :size="48" :tone="c.tone" star="var(--amber)" />
            <div style="flex: 1; min-width: 0">
              <div class="pz-display" style="font-size: 14.5px">{{ c.name }}</div>
              <div style="font-size: 11px; color: var(--ink-dim); margin-top: 2px; font-weight: 500">{{ c.sub }}</div>
            </div>
            <button class="pz-btn2" style="padding: 9px 12px; font-size: 12.5px; gap: 5px" @click="buyCrate(c)">
              <PzIcon name="token" :size="13" /> {{ c.costTokens }}
            </button>
          </div>
        </div>
      </section>

      <!-- кредиты -->
      <section>
        <div class="pz-stencil-h">КРЕДИТЫ</div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px">
          <button
            v-for="p in CREDIT_PACKS"
            :key="p.id"
            class="pz-plate pack"
            :class="{ 'pz-brackets': p.hot }"
            :style="{ '--bk': 'var(--amber)', borderColor: p.hot ? 'var(--amber)' : 'var(--line)' }"
            @click="buyCredits(p)"
          >
            <span v-if="p.hot" class="pz-pixel hot" style="background: var(--amber); color: #1d1604">ХИТ</span>
            <PzIcon name="coin" :size="22" />
            <span class="pz-display" style="font-size: 15px">{{ fmt(p.amount) }}</span>
            <span style="font-size: 11.5px; color: var(--ink-dim); font-weight: 600">{{ p.price }}</span>
          </button>
        </div>
      </section>

      <!-- жетоны -->
      <section>
        <div class="pz-stencil-h">ЖЕТОНЫ</div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px">
          <button
            v-for="p in TOKEN_PACKS"
            :key="p.id"
            class="pz-plate pack"
            :class="{ 'pz-brackets': p.hot }"
            :style="{ '--bk': 'var(--blue)', borderColor: p.hot ? 'var(--blue)' : 'var(--line)' }"
            @click="buyTokens(p)"
          >
            <span v-if="p.hot" class="pz-pixel hot" style="background: var(--blue); color: #0a1c30">ХИТ</span>
            <PzIcon name="token" :size="22" />
            <span class="pz-display" style="font-size: 15px">{{ p.amount }}</span>
            <span style="font-size: 11.5px; color: var(--ink-dim); font-weight: 600">{{ p.price }}</span>
          </button>
        </div>
      </section>
    </div>

    <!-- тост -->
    <div
      v-if="toast"
      :key="toast.key"
      class="toast"
      :style="{
        background: toast.bad ? 'var(--red-deep)' : 'var(--bg-3)',
        borderColor: toast.bad ? 'var(--red)' : 'var(--line-strong)',
      }"
    >
      {{ toast.text }}
    </div>

    <BottomNav screen="shop" @go="emit('go', $event)" />
  </div>
</template>

<style scoped>
.pack {
  padding: 12px 6px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  color: var(--ink);
  position: relative;
}
.hot {
  position: absolute;
  top: -7px;
  font-size: 7px;
  padding: 2px 5px;
  border-radius: 2px;
}
.toast {
  position: absolute;
  bottom: 86px;
  left: 50%;
  transform: translateX(-50%);
  border: 1px solid var(--line-strong);
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  white-space: nowrap;
  animation: pz-slide-up 0.25s ease;
  z-index: 20;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
</style>
