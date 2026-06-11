<script setup>
// Рейтинг: вкладки Профиль (всё про меня: имя, статистика, история) /
// Рейтинг (таблица лидеров) / Кланы и Турниры (СКОРО). Смена имени платная.
// Соперники пока фейковые вокруг моего рейтинга (бэкенда нет) — но
// стабильные между заходами, чтобы таблица не скакала.
import { computed, ref, onMounted } from 'vue'
import { profile, setCustomName, syncProfile, serverConfig } from '../store.js'
import { RATING_RIVALS, RENAME_COST_STARS } from '../game/meta.js'
import { apiRename, apiLeaderboard, apiPlayer } from '../api.js'
import { haptic } from '../tg.js'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'
import PlayerCard from './PlayerCard.vue'

const emit = defineEmits(['go'])
const tab = ref(0)
const TABS = ['ПРОФИЛЬ', 'РЕЙТИНГ', 'КЛАНЫ', 'ТУРНИРЫ']
const renaming = ref(false)

// смена позывного за Telegram Stars: имя → инвойс сервера → openInvoice.
// Без бота (dev/браузер) сервер ставит имя сразу. Цена авторитетна на сервере.
async function rename() {
  if (renaming.value) return
  const name = window.prompt(`Новый позывной (3–16 символов) — ${RENAME_COST_STARS} ⭐:`, profile.name)
  if (name === null) return
  const clean = String(name).trim().slice(0, 16)
  if (clean.length < 3) {
    window.alert('Слишком короткий позывной (минимум 3 символа)')
    return
  }
  if (clean === profile.name) return
  renaming.value = true
  try {
    const r = await apiRename(clean)
    if (r.granted) {
      // dev-режим: сервер уже сохранил имя — фиксируем локально
      setCustomName(clean)
      await syncProfile()
      window.alert(`Позывной изменён${r.dev ? ' (dev)' : ''}`)
    } else if (r.link && window.Telegram?.WebApp?.openInvoice) {
      window.Telegram.WebApp.openInvoice(r.link, (status) => {
        if (status === 'paid') {
          setCustomName(clean) // мгновенно в UI; сервер ставит то же имя по факту оплаты
          setTimeout(() => syncProfile(), 1200) // даём поллингу зачислить
        }
      })
    } else if (r.error) {
      window.alert(`Не вышло: ${r.error === 'bad name' ? 'недопустимый позывной' : r.error}`)
    } else {
      window.alert('Оплата звёздами недоступна')
    }
  } catch {
    window.alert('Сервер недоступен')
  } finally {
    renaming.value = false
  }
}

const winrate = computed(() => {
  const s = profile.stats
  return s.battles ? Math.round((s.wins / s.battles) * 100) : 0
})

// живая таблица лидеров с сервера (топ по рейтингу); офлайн/пусто → фоллбэк
const liveTop = ref(null)
onMounted(async () => {
  try {
    const r = await apiLeaderboard()
    if (r && Array.isArray(r.top) && r.top.length) liveTop.value = r.top
  } catch {
    /* офлайн — останется фейковый board */
  }
})

const board = computed(() => {
  // живой топ с сервера — строки кликабельны (place → карточка игрока)
  if (liveTop.value) {
    const rows = liveTop.value.map((p) => ({
      place: p.place,
      name: p.name,
      rating: p.rating,
      winrate: p.battles ? Math.round((p.wins / p.battles) * 100) : 0,
      you: p.name === profile.name,
      live: true,
    }))
    if (!rows.some((r) => r.you)) rows.push({ name: profile.name, rating: profile.stats.rating, you: true, live: false }) // я вне топа
    return rows
  }
  // фоллбэк: детерминированные «соперники» вокруг моего рейтинга
  const mine = profile.stats.rating
  const rows = RATING_RIVALS.map((name, i) => {
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997
    const delta = ((h % 21) - 10) * 18 + (i - RATING_RIVALS.length / 2) * 9
    return { name, rating: Math.max(120, Math.round(mine + delta)), you: false, live: false }
  })
  rows.push({ name: profile.name, rating: mine, you: true, live: false })
  rows.sort((a, b) => b.rating - a.rating)
  return rows
})

// карточка игрока: тап по живой строке таблицы → публичный профиль с сервера
const viewing = ref(null)
async function openPlayer(row) {
  if (!row.live || !row.place) return
  haptic('select')
  try {
    const r = await apiPlayer(row.place)
    if (r && r.player) viewing.value = r.player
  } catch {
    /* офлайн — молча */
  }
}
// моя карточка — из локального профиля (без запроса)
function openMe() {
  haptic('select')
  viewing.value = {
    name: profile.name,
    place: myPlace.value,
    rating: profile.stats.rating,
    battles: profile.stats.battles,
    wins: profile.stats.wins,
    kills: profile.stats.kills,
    tank: profile.selectedTank,
    favoriteTank: null,
  }
}
const myPlace = computed(() => board.value.findIndex((r) => r.you) + 1)
// турнир активен (вкладка ТУРНИРЫ + включён в админке)
const tournamentLive = computed(() => tab.value === 3 && serverConfig.tournaments)

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

    <!-- вкладки -->
    <div style="display: flex; gap: 6px; padding: 0 14px 8px">
      <button v-for="(t, i) in TABS" :key="t" class="pz-display tabbtn" :class="{ on: tab === i }" @click="haptic('select'); tab = i">{{ t }}</button>
    </div>

    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 16px">
      <!-- ===== КЛАНЫ / ТУРНИРЫ ===== -->
      <section v-if="tab >= 2" style="flex: 1; display: flex; align-items: center; justify-content: center">
        <div class="pz-plate pz-brackets" :style="{ '--bk': tournamentLive ? 'var(--green)' : 'var(--amber)', padding: '26px 30px', textAlign: 'center' }">
          <div class="pz-display" style="font-size: 20px; letter-spacing: 0.14em">{{ TABS[tab] }}</div>
          <div class="pz-pixel" style="font-size: 9px; margin-top: 10px" :style="{ color: tournamentLive ? 'var(--green)' : 'var(--amber)' }">
            {{ tournamentLive ? '● ИДЁТ СЕЙЧАС' : 'СКОРО' }}
          </div>
          <div style="font-size: 11.5px; color: var(--ink-dim); margin-top: 8px; font-weight: 500">
            {{ tab === 2 ? 'Собирай взвод — клан будет его продолжением' : tournamentLive ? 'Турнир в эфире — врывайся в бой и поднимай рейтинг!' : 'Сетевые бои 7×7 уже на подходе' }}
          </div>
        </div>
      </section>

      <!-- ===== ПРОФИЛЬ: всё про меня ===== -->
      <section v-if="tab === 0">
        <div class="pz-stencil-h">ПОЗЫВНОЙ</div>
        <div class="pz-plate" style="margin-top: 10px; padding: 12px 14px; display: flex; align-items: center; gap: 10px">
          <span class="pz-display" style="flex: 1; font-size: 18px">{{ profile.name }}</span>
          <button class="pz-btn2" style="padding: 7px 12px; font-size: 11px" :disabled="renaming" @click="rename">Сменить · {{ RENAME_COST_STARS }} ⭐</button>
        </div>
      </section>

      <!-- моя карточка (тап — открыть карточку профиля) -->
      <section v-if="tab === 0">
        <div class="pz-stencil-h">МОЯ СТАТИСТИКА</div>
        <div class="pz-plate pz-brackets me" style="--bk: var(--amber); cursor: pointer" @click="openMe">
          <div style="display: flex; align-items: center; gap: 12px">
            <img src="/sprites/trophy.png" class="rank-badge" style="object-fit: cover" />
            <div style="flex: 1">
              <div class="pz-display" style="font-size: 22px">{{ profile.stats.rating }}</div>
              <div style="font-size: 11px; color: var(--ink-dim); font-weight: 500">боевой рейтинг · место {{ myPlace }} · открыть профиль ▸</div>
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
      <section v-if="tab === 0">
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
            <span style="font-size: 11px; color: var(--ink-dim); font-weight: 600">урон {{ h.damage ?? 0 }}</span>
            <span style="font-size: 10px; color: var(--ink-faint); font-weight: 500">{{ fmtTime(h.t) }}</span>
          </div>
        </div>
      </section>

      <!-- таблица -->
      <section v-if="tab === 1">
        <div class="pz-stencil-h">ТАБЛИЦА ЛИДЕРОВ</div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px">
          <div v-for="(r, i) in board" :key="r.name + '-' + i" class="row" :class="{ you: r.you, tappable: r.live }" @click="openPlayer(r)">
            <span class="pz-pixel place" :style="{ color: i < 3 ? 'var(--amber)' : 'var(--ink-faint)' }">{{ i + 1 }}</span>
            <span class="lb-name" :style="{ color: r.you ? 'var(--amber)' : 'var(--ink)' }">{{ r.name }}</span>
            <span v-if="r.live" style="font-size: 10.5px; color: var(--ink-dim); font-weight: 600; margin-right: 6px">{{ r.winrate }}%</span>
            <span class="pz-display" style="font-size: 13.5px">{{ r.rating }}</span>
          </div>
        </div>
        <div style="font-size: 10.5px; color: var(--ink-faint); margin-top: 8px; font-weight: 500; text-align: center">
          победа +24 · ничья +2 · поражение −16
        </div>
      </section>
    </div>

    <BottomNav screen="rating" @go="emit('go', $event)" />

    <!-- карточка профиля игрока -->
    <transition name="pz-fade">
      <PlayerCard v-if="viewing" :player="viewing" @close="viewing = null" />
    </transition>
  </div>
</template>

<style>
.pz-fade-enter-active,
.pz-fade-leave-active {
  transition: opacity 0.2s ease;
}
.pz-fade-enter-from,
.pz-fade-leave-to {
  opacity: 0;
}
</style>

<style scoped>
.tabbtn {
  flex: 1;
  padding: 7px 0 6px;
  font-size: 9.5px;
  letter-spacing: 0.12em;
  cursor: pointer;
  color: var(--ink-dim);
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
}
.tabbtn.on {
  color: #1d1604;
  background: linear-gradient(180deg, var(--amber-hi), var(--amber));
  border-color: transparent;
}
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
.row.tappable {
  cursor: pointer;
}
.row.tappable:active {
  background: rgba(255, 255, 255, 0.06);
}
.lb-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.place {
  font-size: 9px;
  width: 22px;
  flex-shrink: 0;
  text-align: center;
}
</style>
