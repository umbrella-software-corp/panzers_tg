<script setup>
// Магазин: ящики и голдовые снаряды за жетоны; паки кредитов/жетонов — за
// Telegram Stars ⭐ (пока мгновенное начисление; invoice через бота — позже).
import { ref } from 'vue'
import { profile, addRewards, spendTokens, buyGoldAmmo, grantRandomSkin, syncProfile, isPremium, premiumDaysLeft } from '../store.js'
import { apiBuy } from '../api.js'
import { GOLD_AMMO_PACKS } from '../game/meta.js'
import { camoCss } from '../game/camo.js'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['go'])

const CRATES = [
  { id: 'c1', name: 'Полевой ящик', sub: '600 кредитов · шанс на камуфляж 10%', icon: 'crate_field', costTokens: 5, gain: 600, drop: 0.1 },
  { id: 'c2', name: 'Офицерский ящик', sub: '1 800 кредитов · камуфляж 35%', icon: 'crate_officer', costTokens: 12, gain: 1800, drop: 0.35 },
  { id: 'c3', name: 'Генеральский ящик', sub: '4 500 кредитов · камуфляж гарантирован', icon: 'crate_general', costTokens: 25, gain: 4500, drop: 1 },
]
const CREDIT_PACKS = [
  { id: 'p1', amount: 1000, price: '50 ⭐' },
  { id: 'p2', amount: 3500, price: '135 ⭐', hot: true },
  { id: 'p3', amount: 9000, price: '299 ⭐' },
]
const TOKEN_PACKS = [
  { id: 't1', amount: 20, price: '65 ⭐' },
  { id: 't2', amount: 60, price: '165 ⭐', hot: true },
  { id: 't3', amount: 150, price: '329 ⭐' },
]

const toast = ref(null) // { key, text, bad }
let toastTimer = null
function showToast(text, bad = false) {
  toast.value = { key: Date.now(), text, bad }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 1800)
}
// вскрытие ящика: показываем окно-награду с тем, ЧТО именно выпало
const reveal = ref(null) // { name, credits, skin, tokens }
function buyCrate(c) {
  if (!spendTokens(c.costTokens)) {
    showToast('Не хватает жетонов', true)
    return
  }
  addRewards(c.gain, 0)
  let skin = null
  let tokens = 0
  if (Math.random() < c.drop) {
    skin = grantRandomSkin()
    if (!skin) {
      tokens = 3 // камуфляжи собраны — компенсация жетонами
      addRewards(0, tokens)
    }
  }
  reveal.value = { name: c.name, credits: c.gain, skin, tokens }
}
// паки за Stars: инвойс с сервера → openInvoice → после оплаты тянем профиль.
// Без BOT_TOKEN сервер начисляет сразу (dev-режим).
async function buyPack(p, label) {
  try {
    const r = await apiBuy(p.id)
    if (r.granted) {
      await syncProfile()
      showToast(`${label} — зачислено${r.dev ? ' (dev)' : ''}!`)
    } else if (r.link && window.Telegram?.WebApp?.openInvoice) {
      window.Telegram.WebApp.openInvoice(r.link, async (status) => {
        if (status === 'paid') {
          setTimeout(async () => {
            await syncProfile()
            showToast(`${label} — оплачено!`)
          }, 1200) // даём поллингу зачислить
        }
      })
    } else {
      showToast('Оплата недоступна', true)
    }
  } catch {
    showToast('Сервер недоступен', true)
  }
}
const buyCredits = (p) => buyPack(p, `${p.amount.toLocaleString('ru-RU')} кредитов`)
const buyTokens = (p) => buyPack(p, `${p.amount} жетонов`)
const buyPremium = () => buyPack({ id: 'prem' }, 'Премиум · 7 дней')
function buyGold(p) {
  if (!buyGoldAmmo(p.id)) {
    showToast('Не хватает жетонов', true)
    return
  }
  showToast(`${p.amount} голдовых снарядов — получено!`)
}
const fmt = (n) => n.toLocaleString('ru-RU')
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.88), rgba(13, 15, 10, 0.94)), url('/sprites/bg_shop.png') center / cover no-repeat">
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 8px">
      <div class="pz-display" style="font-size: 17px">МАГАЗИН</div>
      <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" />
    </header>

    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 16px">
      <!-- премиум-аккаунт -->
      <section>
        <div class="pz-stencil-h">ПРЕМИУМ-АККАУНТ</div>
        <div class="pz-plate pz-brackets" style="--bk: var(--amber); margin-top: 10px; padding: 13px 14px; display: flex; align-items: center; gap: 12px">
          <PzIcon name="star" :size="38" color="var(--amber)" />
          <div style="flex: 1; min-width: 0">
            <div class="pz-display" style="font-size: 15px; color: var(--amber)">ПРЕМИУМ · 7 ДНЕЙ</div>
            <div style="font-size: 11.5px; color: var(--ink-dim); margin-top: 3px; font-weight: 500; line-height: 1.4">
              +15% к опыту экипажа, ветке техники и кредитам за каждый бой
            </div>
            <div v-if="isPremium()" class="pz-pixel" style="font-size: 8px; color: var(--green); margin-top: 5px; letter-spacing: 0.1em">
              АКТИВЕН · ОСТАЛОСЬ {{ premiumDaysLeft() }} ДН.
            </div>
          </div>
          <button class="pz-cta" style="padding: 11px 13px; font-size: 13px; white-space: nowrap" @click="buyPremium">99 ⭐</button>
        </div>
      </section>

      <!-- ящики -->
      <section>
        <div class="pz-stencil-h">ЯЩИКИ СНАБЖЕНИЯ</div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px">
          <div v-for="c in CRATES" :key="c.id" class="pz-plate" style="display: flex; align-items: center; gap: 12px; padding: 10px 12px">
            <img :src="`/sprites/${c.icon}.png`" style="width: 52px; height: 52px; border-radius: 8px; object-fit: cover" />
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

      <!-- голдовые снаряды -->
      <section>
        <div class="pz-stencil-h">ГОЛДОВЫЕ СНАРЯДЫ</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px">
          <button v-for="p in GOLD_AMMO_PACKS" :key="p.id" class="pz-plate pack" @click="buyGold(p)">
            <img src="/sprites/icon_gold.png" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover" />
            <span class="pz-display" style="font-size: 16px; color: var(--amber)">★ ×{{ p.amount }}</span>
            <span style="font-size: 11px; color: var(--ink-dim); font-weight: 500">урон +35% за выстрел</span>
            <span class="pz-chip" style="font-size: 11px; margin-top: 2px"><PzIcon name="token" :size="12" /> {{ p.costTokens }}</span>
          </button>
        </div>
        <div style="font-size: 10.5px; color: var(--ink-faint); margin-top: 6px; font-weight: 500; text-align: center">
          в наличии: ★ {{ profile.goldAmmo }} · переключение прямо в бою
        </div>
      </section>

      <!-- кредиты -->
      <section>
        <div class="pz-stencil-h">КРЕДИТЫ · ЗА TG STARS</div>
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
            <img src="/sprites/icon_credits.png" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover" />
            <span class="pz-display" style="font-size: 15px">{{ fmt(p.amount) }}</span>
            <span style="font-size: 11.5px; color: var(--ink-dim); font-weight: 600">{{ p.price }}</span>
          </button>
        </div>
      </section>

      <!-- жетоны -->
      <section>
        <div class="pz-stencil-h">ЖЕТОНЫ · ЗА TG STARS</div>
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
            <img src="/sprites/icon_tokens.png" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover" />
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

    <!-- окно-награда: что именно выпало из ящика -->
    <transition name="pz-fade">
      <div v-if="reveal" class="reveal-overlay" @click.self="reveal = null">
        <div class="reveal-card pz-plate pz-brackets" style="--bk: var(--amber)">
          <div class="pz-display" style="font-size: 17px; letter-spacing: 0.06em; text-align: center">{{ reveal.name }}</div>
          <div class="pz-pixel" style="font-size: 8px; color: var(--amber); margin-top: 6px; letter-spacing: 0.14em; text-align: center">ВЫ ПОЛУЧИЛИ</div>
          <div class="reveal-items">
            <div class="reveal-item">
              <PzIcon name="coin" :size="20" />
              <span class="pz-display" style="font-size: 18px">+{{ reveal.credits.toLocaleString('ru-RU') }}</span>
              <span style="color: var(--ink-dim); font-size: 12px">кредитов</span>
            </div>
            <div v-if="reveal.skin" class="reveal-item">
              <span class="reveal-swatch" :style="{ background: camoCss(reveal.skin) }"></span>
              <span class="pz-display" style="font-size: 15px; flex: 1">Камуфляж «{{ reveal.skin.name }}»</span>
              <span class="pz-pixel" style="font-size: 7px; color: var(--green)">НОВЫЙ</span>
            </div>
            <div v-if="reveal.tokens" class="reveal-item">
              <PzIcon name="token" :size="18" />
              <span class="pz-display" style="font-size: 16px">+{{ reveal.tokens }}</span>
              <span style="color: var(--ink-dim); font-size: 12px">жетона · камуфляжи собраны</span>
            </div>
          </div>
          <button class="pz-cta" style="width: 100%; margin-top: 14px" @click="reveal = null">Забрать</button>
        </div>
      </div>
    </transition>

    <BottomNav screen="shop" @go="emit('go', $event)" />
  </div>
</template>

<style scoped>
.reveal-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(6, 9, 14, 0.72);
  backdrop-filter: blur(4px);
}
.reveal-card {
  width: 100%;
  max-width: 320px;
  padding: 20px 18px;
  animation: pz-pop 0.25s ease;
}
.reveal-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
.reveal-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line-strong);
}
.reveal-swatch {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid rgba(0, 0, 0, 0.5);
}
.pz-fade-enter-active,
.pz-fade-leave-active {
  transition: opacity 0.2s ease;
}
.pz-fade-enter-from,
.pz-fade-leave-to {
  opacity: 0;
}
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
