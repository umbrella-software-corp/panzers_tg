<script setup>
// Рейтинг: моя статистика (бои/победы/фраги/рейтинг) + таблица лидеров.
// Соперники пока фейковые вокруг моего рейтинга (бэкенда нет) — но
// стабильные между заходами, чтобы таблица не скакала.
import { computed } from 'vue'
import { profile } from '../store.js'
import { RATING_RIVALS } from '../game/meta.js'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'

const emit = defineEmits(['go'])

const winrate = computed(() => {
  const s = profile.stats
  return s.battles ? Math.round((s.wins / s.battles) * 100) : 0
})

// детерминированные «соперники» вокруг моего рейтинга
const board = computed(() => {
  const mine = profile.stats.rating
  const rows = RATING_RIVALS.map((name, i) => {
    // стабильный псевдослучайный сдвиг от имени
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997
    const delta = ((h % 21) - 10) * 18 + (i - RATING_RIVALS.length / 2) * 9
    return { name, rating: Math.max(120, Math.round(mine + delta)), you: false }
  })
  rows.push({ name: 'ВЫ', rating: mine, you: true })
  rows.sort((a, b) => b.rating - a.rating)
  return rows
})
const myPlace = computed(() => board.value.findIndex((r) => r.you) + 1)

const RES = {
  victory: { label: 'ПОБЕДА', color: 'var(--green)' },
  draw: { label: 'НИЧЬЯ', color: 'var(--ink-dim)' },
  defeat: { label: 'ПОРАЖЕНИЕ', color: 'var(--red)' },
}
const fmtTime = (t) => {
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return today ? hm : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`
}
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.88), rgba(13, 15, 10, 0.94)), url('/sprites/bg_rating.png') center / cover no-repeat">
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 8px">
      <div class="pz-display" style="font-size: 17px">РЕЙТИНГ</div>
      <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" @shop="emit('go', 'shop')" />
    </header>

    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 16px">
      <!-- моя карточка -->
      <section>
        <div class="pz-stencil-h">МОЯ СТАТИСТИКА</div>
        <div class="pz-plate pz-brackets me" style="--bk: var(--amber)">
          <div style="display: flex; align-items: center; gap: 12px">
            <img src="/sprites/trophy.png" class="rank-badge" style="object-fit: cover" />
            <div style="flex: 1">
              <div class="pz-display" style="font-size: 22px">{{ profile.stats.rating }}</div>
              <div style="font-size: 11px; color: var(--ink-dim); font-weight: 500">боевой рейтинг · место {{ myPlace }}</div>
            </div>
          </div>
          <div class="cells">
            <div class="cell"><b class="pz-display">{{ profile.stats.battles }}</b><span>боёв</span></div>
            <div class="cell"><b class="pz-display">{{ profile.stats.wins }}</b><span>побед</span></div>
            <div class="cell"><b class="pz-display">{{ winrate }}%</b><span>винрейт</span></div>
            <div class="cell"><b class="pz-display">{{ profile.stats.kills }}</b><span>фрагов</span></div>
          </div>
        </div>
      </section>

      <!-- история боёв -->
      <section>
        <div class="pz-stencil-h">ИСТОРИЯ БОЁВ</div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px">
          <div v-if="!profile.history.length" style="font-size: 12px; color: var(--ink-faint); text-align: center; padding: 10px 0; font-weight: 500">
            Ещё нет боёв — жми В БОЙ в ангаре
          </div>
          <div v-for="(h, i) in profile.history" :key="i" class="row">
            <span class="pz-display" style="font-size: 10.5px; width: 86px; flex-shrink: 0; letter-spacing: 0.08em" :style="{ color: RES[h.result].color }">
              {{ RES[h.result].label }}
            </span>
            <span style="flex: 1; font-size: 12.5px; font-weight: 600">{{ h.tank }} <span style="color: var(--ink-dim)">· {{ h.score }}</span></span>
            <span style="font-size: 11px; color: var(--ink-dim); font-weight: 600">{{ h.kills }} фр.</span>
            <span style="font-size: 10px; color: var(--ink-faint); font-weight: 500">{{ fmtTime(h.t) }}</span>
          </div>
        </div>
      </section>

      <!-- таблица -->
      <section>
        <div class="pz-stencil-h">ТАБЛИЦА ЛИДЕРОВ</div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px">
          <div v-for="(r, i) in board" :key="r.name" class="row" :class="{ you: r.you }">
            <span class="pz-pixel place" :style="{ color: i < 3 ? 'var(--amber)' : 'var(--ink-faint)' }">{{ i + 1 }}</span>
            <span style="flex: 1; font-size: 13px; font-weight: 600" :style="{ color: r.you ? 'var(--amber)' : 'var(--ink)' }">{{ r.name }}</span>
            <span class="pz-display" style="font-size: 13.5px">{{ r.rating }}</span>
          </div>
        </div>
        <div style="font-size: 10.5px; color: var(--ink-faint); margin-top: 8px; font-weight: 500; text-align: center">
          победа +24 · ничья +2 · поражение −16
        </div>
      </section>
    </div>

    <BottomNav screen="rating" @go="emit('go', $event)" />
  </div>
</template>

<style scoped>
.me {
  margin-top: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rank-badge {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--amber);
  background: rgba(242, 165, 12, 0.12);
  border: 1.5px solid var(--amber);
}
.cells {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.cell {
  text-align: center;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cell b {
  font-size: 15px;
}
.cell span {
  font-size: 9.5px;
  color: var(--ink-dim);
  font-weight: 600;
  letter-spacing: 0.06em;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.row.you {
  background: rgba(242, 165, 12, 0.08);
  border-color: var(--amber);
}
.place {
  font-size: 9px;
  width: 22px;
  flex-shrink: 0;
  text-align: center;
}
</style>
