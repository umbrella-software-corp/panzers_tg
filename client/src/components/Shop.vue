<script setup>
// Магазин: ящики и голдовые снаряды за жетоны; паки кредитов/жетонов — за
// Telegram Stars ⭐ (пока мгновенное начисление; invoice через бота — позже).
import { ref, onMounted } from 'vue'
import { profile, addRewards, spendTokens, buyGoldAmmo, syncProfile, isPremium, premiumDaysLeft, isOwned, selectTank, grantRandomCamo } from '../store.js'
import { apiBuy } from '../api.js'
import { track } from '../analytics.js'
// `t` алиасим в `tr`: в шаблоне/скрипте уже есть локальные `t` (v-for="t in
// PREMIUM_TANKS", premStats(t), buyPremTank(t)) — танк, не переводчик.
import { t as tr, fmtNum } from '../i18n.js'
import { GOLD_AMMO_PACKS, PREMIUM_TANKS, STAT_LABELS, combatStats, statReal } from '../game/meta.js'
import { haptic } from '../tg.js'
import TankImg from './ui/TankImg.vue'
import StatRow from './ui/StatRow.vue'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['go'])

const CRATES = [
  { id: 'c1', nameKey: 'crateFieldName', subKey: 'crateFieldSub', icon: 'crate_field', costTokens: 5, gain: 600, drop: 0.1, bonus: 3 },
  { id: 'c2', nameKey: 'crateOfficerName', subKey: 'crateOfficerSub', icon: 'crate_officer', costTokens: 12, gain: 1800, drop: 0.35, bonus: 5 },
  { id: 'c3', nameKey: 'crateGeneralName', subKey: 'crateGeneralSub', icon: 'crate_general', costTokens: 25, gain: 4500, drop: 1, bonus: 8 },
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
  track('shop_item_clicked', {
    item_id: c.id,
    item_type: 'crate',
    price: c.costTokens,
    currency: 'tokens',
  })
  if (!spendTokens(c.costTokens)) {
    showToast(tr('shop.notEnoughTokens'), true)
    return
  }
  addRewards(c.gain, 0)
  // ящик: кредиты + (по шансу drop) случайный ЗАПЕРТЫЙ камуфляж на одном из твоих
  // танков. Все камо уже открыты → компенсируем жетонами (как и обещает локаль
  // rewardTokens «…камуфляжи собраны»). Генеральский (drop:1) даёт камо гарантированно.
  let camo = null
  let tokens = 0
  if (Math.random() < c.drop) {
    camo = grantRandomCamo()
    if (!camo) {
      tokens = c.bonus || 3
      addRewards(0, tokens)
    }
  }
  haptic('success') // вскрытие ящика — приятная отдача
  track('crate_opened', {
    crate_id: c.id,
    credits: c.gain,
    camo: camo ? `${camo.tankId}_${camo.camoId}` : null,
    tokens_bonus: tokens,
  })
  reveal.value = { name: tr('shop.' + c.nameKey), credits: c.gain, camo, tokens }
}
// паки за Stars: инвойс с сервера → openInvoice → после оплаты тянем профиль.
// Без BOT_TOKEN сервер начисляет сразу (dev-режим).
async function buyPack(p, label) {
  track('purchase_started', { product_id: p.id, label })
  try {
    const r = await apiBuy(p.id)
    if (r.granted) {
      await syncProfile()
      track('purchase_completed', {
        product_id: p.id,
        dev: !!r.dev,
        payment_type: r.dev ? 'dev_grant' : 'stars',
      })
      showToast(tr('shop.granted', { label, dev: !!r.dev }))
    } else if (r.link && window.Telegram?.WebApp?.openInvoice) {
      window.Telegram.WebApp.openInvoice(r.link, async (status) => {
        if (status === 'paid') {
          track('purchase_completed', {
            product_id: p.id,
            dev: false,
            payment_type: 'stars',
          })
          setTimeout(async () => {
            await syncProfile()
            showToast(tr('shop.paid', { label }))
          }, 1200) // даём поллингу зачислить
        }
      })
    } else {
      showToast(tr('shop.payUnavailable'), true)
    }
  } catch {
    track('purchase_failed', { product_id: p.id, reason: 'api_error' })
    showToast(tr('shop.serverUnavailable'), true)
  }
}
const buyCredits = (p) => buyPack(p, tr('shop.creditsLabel', { disp: fmtNum(p.amount), n: p.amount }))
const buyTokens = (p) => buyPack(p, tr('shop.tokensLabel', { n: p.amount }))
const buyPremium = () => buyPack({ id: 'prem' }, tr('shop.premiumLabel'))
const premSel = ref(null) // развёрнутый ТТХ прем-танка в магазине
const premStats = (t) => {
  const cs = combatStats(t) // реальные боевые числа (крупные) для ТТХ
  return Object.entries(t.stats).map(([k, v]) => ({ key: k, label: STAT_LABELS[k] || k, value: v, display: statReal(cs, k) }))
}
// прем-танк за ⭐: продукт pt_<id> → grantProduct кладёт в гараж (как в «Развитии»)
async function buyPremTank(t) {
  await buyPack({ id: 'pt_' + t.id }, tr('shop.premTankLabel', { name: t.name }))
  if (isOwned(t.id)) selectTank(t.id) // dev-grant: сразу выбираем
}
function buyGold(p) {
  if (!buyGoldAmmo(p.id)) {
    showToast(tr('shop.notEnoughTokens'), true)
    return
  }
  showToast(tr('shop.goldGot', { n: p.amount }))
}
const fmt = (n) => fmtNum(n)

onMounted(() => {
  track('shop_viewed', {
    credits: profile.credits || 0,
    tokens: profile.tokens || 0,
    premium: isPremium(),
    battles_count: profile.stats?.battles || 0,
    before_first_battle: (profile.stats?.battles || 0) === 0,
  })
})
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.88), rgba(13, 15, 10, 0.94)), url('/sprites/bg_shop.png') center / cover no-repeat">
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 8px">
      <div class="pz-display" style="font-size: 17px">{{ tr('shop.title') }}</div>
      <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" />
    </header>

    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 16px">
      <!-- премиум-аккаунт -->
      <section>
        <div class="pz-stencil-h">{{ tr('shop.premiumHead') }}</div>
        <div class="pz-plate pz-brackets" style="--bk: var(--amber); margin-top: 10px; padding: 13px 14px; display: flex; align-items: center; gap: 12px">
          <PzIcon name="star" :size="38" color="var(--amber)" />
          <div style="flex: 1; min-width: 0">
            <div class="pz-display" style="font-size: 15px; color: var(--amber)">{{ tr('shop.premiumTitle') }}</div>
            <div style="font-size: 11.5px; color: var(--ink-dim); margin-top: 3px; font-weight: 500; line-height: 1.4">
              {{ tr('shop.premiumDesc') }}
            </div>
            <div v-if="isPremium()" class="pz-pixel" style="font-size: 8px; color: var(--green); margin-top: 5px; letter-spacing: 0.1em">
              {{ tr('shop.premiumActive', { n: premiumDaysLeft() }) }}
            </div>
          </div>
          <button class="pz-cta" style="padding: 11px 15px; font-size: 14px; white-space: nowrap; width: auto; flex-shrink: 0" @click="buyPremium">99 ⭐</button>
        </div>
      </section>

      <!-- премиум-техника -->
      <section>
        <div class="pz-stencil-h">{{ tr('shop.premTanksHead') }}</div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px">
          <div v-for="t in PREMIUM_TANKS" :key="t.id" class="pz-plate" style="padding: 0; overflow: hidden">
            <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer" @click="premSel = premSel === t.id ? null : t.id">
              <TankImg :tank-id="t.id" :size="46" :style="{ filter: isOwned(t.id) ? 'none' : 'grayscale(0.85) brightness(0.6)', flexShrink: 0 }" />
              <div style="flex: 1; min-width: 0">
                <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap">
                  <span class="pz-display" style="font-size: 14.5px">{{ t.name }}</span>
                  <span v-if="t.legend" class="pz-pixel" style="font-size: 7px; color: #1d1604; background: var(--amber); border-radius: 5px; padding: 2px 5px 1px">{{ tr('shop.legend') }}</span>
                  <span class="pz-pixel" style="font-size: 7px; color: var(--ink-faint)">{{ tr('shop.stats') }} {{ premSel === t.id ? '▾' : '▸' }}</span>
                </div>
                <div style="font-size: 11px; color: var(--ink-dim); margin-top: 2px; font-weight: 500">{{ tr('shop.premTankSub', { cls: tr('game.classes.' + t.classId), tier: t.tier }) }}</div>
              </div>
              <span v-if="isOwned(t.id)" class="pz-chip" style="color: #7cc05a; flex-shrink: 0">{{ tr('shop.inGarage') }}</span>
              <button v-else class="pz-cta" style="padding: 9px 13px; font-size: 13px; white-space: nowrap; width: auto; flex-shrink: 0" @click.stop="buyPremTank(t)">{{ t.stars }} ⭐</button>
            </div>
            <div v-if="premSel === t.id" style="display: flex; flex-direction: column; gap: 6px; padding: 4px 14px 12px; border-top: 1px solid var(--line)">
              <StatRow v-for="sx in premStats(t)" :key="sx.key" :label="sx.label" :value="sx.value" :display="sx.display" />
              <div style="font-size: 11px; color: var(--ink-dim); line-height: 1.4; margin-top: 2px">{{ t.desc }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ящики -->
      <section>
        <div class="pz-stencil-h">{{ tr('shop.cratesHead') }}</div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px">
          <div v-for="c in CRATES" :key="c.id" class="pz-plate" style="display: flex; align-items: center; gap: 12px; padding: 10px 12px">
            <img :src="`/sprites/${c.icon}.png`" style="width: 52px; height: 52px; border-radius: 8px; object-fit: cover" />
            <div style="flex: 1; min-width: 0">
              <div class="pz-display" style="font-size: 14.5px">{{ tr('shop.' + c.nameKey) }}</div>
              <div style="font-size: 11px; color: var(--ink-dim); margin-top: 2px; font-weight: 500">{{ tr('shop.' + c.subKey, { credits: fmt(c.gain) }) }}</div>
            </div>
            <button class="pz-btn2" style="padding: 9px 12px; font-size: 12.5px; gap: 5px" @click="buyCrate(c)">
              <PzIcon name="token" :size="13" /> {{ c.costTokens }}
            </button>
          </div>
        </div>
      </section>

      <!-- голдовые снаряды -->
      <section>
        <div class="pz-stencil-h">{{ tr('shop.goldHead') }}</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px">
          <button v-for="p in GOLD_AMMO_PACKS" :key="p.id" class="pz-plate pack" @click="buyGold(p)">
            <img src="/sprites/icon_gold.png" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover" />
            <span class="pz-display" style="font-size: 16px; color: var(--amber)">★ ×{{ p.amount }}</span>
            <span style="font-size: 11px; color: var(--ink-dim); font-weight: 500">{{ tr('shop.goldDesc') }}</span>
            <span class="pz-chip" style="font-size: 11px; margin-top: 2px"><PzIcon name="token" :size="12" /> {{ p.costTokens }}</span>
          </button>
        </div>
        <div style="font-size: 10.5px; color: var(--ink-faint); margin-top: 6px; font-weight: 500; text-align: center">
          {{ tr('shop.goldInStock', { n: profile.goldAmmo }) }}
        </div>
      </section>

      <!-- кредиты -->
      <section>
        <div class="pz-stencil-h">{{ tr('shop.creditsHead') }}</div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px">
          <button
            v-for="p in CREDIT_PACKS"
            :key="p.id"
            class="pz-plate pack"
            :class="{ 'pz-brackets': p.hot }"
            :style="{ '--bk': 'var(--amber)', borderColor: p.hot ? 'var(--amber)' : 'var(--line)' }"
            @click="buyCredits(p)"
          >
            <span v-if="p.hot" class="pz-pixel hot" style="background: var(--amber); color: #1d1604">{{ tr('shop.hot') }}</span>
            <img src="/sprites/icon_credits.png" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover" />
            <span class="pz-display" style="font-size: 15px">{{ fmt(p.amount) }}</span>
            <span style="font-size: 11.5px; color: var(--ink-dim); font-weight: 600">{{ p.price }}</span>
          </button>
        </div>
      </section>

      <!-- жетоны -->
      <section>
        <div class="pz-stencil-h">{{ tr('shop.tokensHead') }}</div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px">
          <button
            v-for="p in TOKEN_PACKS"
            :key="p.id"
            class="pz-plate pack"
            :class="{ 'pz-brackets': p.hot }"
            :style="{ '--bk': 'var(--blue)', borderColor: p.hot ? 'var(--blue)' : 'var(--line)' }"
            @click="buyTokens(p)"
          >
            <span v-if="p.hot" class="pz-pixel hot" style="background: var(--blue); color: #0a1c30">{{ tr('shop.hot') }}</span>
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

    <!-- окно-награда: что именно выпало из ящика. Teleport в body — иначе в мобильном
         Telegram-WebView position:fixed внутри #app (relative+overflow) срывается и
         модалка не видна (на десктопе работала, на телефоне — нет) -->
    <Teleport to="body">
    <transition name="pz-fade">
      <div v-if="reveal" class="reveal-overlay" @click.self="reveal = null">
        <div class="reveal-card pz-plate pz-brackets" style="--bk: var(--amber)">
          <div class="pz-display" style="font-size: 17px; letter-spacing: 0.06em; text-align: center">{{ reveal.name }}</div>
          <div class="pz-pixel" style="font-size: 8px; color: var(--amber); margin-top: 6px; letter-spacing: 0.14em; text-align: center">{{ tr('shop.youGot') }}</div>
          <div class="reveal-items">
            <div class="reveal-item">
              <PzIcon name="coin" :size="20" />
              <span class="pz-display" style="font-size: 18px">+{{ fmt(reveal.credits) }}</span>
              <span style="color: var(--ink-dim); font-size: 12px">{{ tr('shop.rewardCredits') }}</span>
            </div>
            <div v-if="reveal.camo" class="reveal-item">
              <TankImg :tank-id="reveal.camo.tankId" :camo="reveal.camo.camoId" :size="40" />
              <span class="pz-display" style="font-size: 14px; flex: 1; line-height: 1.25">{{ tr('shop.rewardCamo', { name: reveal.camo.name }) }}<br><span style="color: var(--ink-dim); font-size: 11px">{{ reveal.camo.tankName }}</span></span>
              <span class="pz-pixel" style="font-size: 7px; color: var(--green)">{{ tr('shop.rewardNew') }}</span>
            </div>
            <div v-if="reveal.tokens" class="reveal-item">
              <PzIcon name="token" :size="18" />
              <span class="pz-display" style="font-size: 16px">+{{ reveal.tokens }}</span>
              <span style="color: var(--ink-dim); font-size: 12px">{{ tr('shop.rewardTokens') }}</span>
            </div>
          </div>
          <button class="pz-cta" style="width: 100%; margin-top: 14px" @click="reveal = null">{{ tr('shop.claim') }}</button>
        </div>
      </div>
    </transition>
    </Teleport>

    <BottomNav screen="shop" @go="emit('go', $event)" />
  </div>
</template>

<style scoped>
.reveal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
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
