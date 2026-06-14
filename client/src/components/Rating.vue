<script setup>
// Рейтинг: вкладки Профиль (всё про меня: имя, статистика, история) /
// Рейтинг (таблица лидеров) / Кланы и Турниры (СКОРО). Смена имени платная.
// Соперники пока фейковые вокруг моего рейтинга (бэкенда нет) — но
// стабильные между заходами, чтобы таблица не скакала.
import { computed, ref, onMounted, watch } from 'vue'
import { profile, setCustomName, syncProfile, serverConfig, medalsEarnedCount, medalsTotal, isPremium, premiumDaysLeft, playerRank } from '../store.js'
import { RATING_RIVALS, RENAME_COST_STARS, MEDALS, ratingBand, CLAN_EMBLEMS } from '../game/meta.js'
import { apiRename, apiLeaderboard, apiPlayer, apiClans, apiCreateClan, apiJoinClan, apiLeaveClan, apiTournaments, apiJoinTournament, apiLeaveTournament } from '../api.js'
import { haptic, tgUserId } from '../tg.js'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'
import PlayerCard from './PlayerCard.vue'
import Medal from './ui/Medal.vue'
import MedalSheet from './MedalSheet.vue'
import PzIcon from './ui/PzIcon.vue'
import ClanEmblem from './ui/ClanEmblem.vue'

const emit = defineEmits(['go'])
const tab = ref(0)
const selMedal = ref(null) // открытая модалка медали (витрина)
const TABS = ['ПРОФИЛЬ', 'РЕЙТИНГ', 'КЛАНЫ', 'ТУРНИРЫ']
// кланы и турниры пока «Скоро» — не палим недоделанное на трафике. Весь функционал
// ниже сохранён, прячется за этим флагом; запуск — поставить false.
const COMING_SOON = true
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
      premium: p.name === profile.name ? isPremium() : !!p.premium, // ★ прем-игрок
      live: true,
    }))
    if (!rows.some((r) => r.you)) rows.push({ name: profile.name, rating: profile.stats.wn8, you: true, premium: isPremium(), live: false }) // я вне топа
    return rows
  }
  // фоллбэк: детерминированные «соперники» вокруг моего рейтинга
  const mine = profile.stats.wn8
  const rows = RATING_RIVALS.map((name, i) => {
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997
    const delta = ((h % 21) - 10) * 18 + (i - RATING_RIVALS.length / 2) * 9
    return { name, rating: Math.max(120, Math.round(mine + delta)), you: false, premium: h % 5 === 0, live: false }
  })
  rows.push({ name: profile.name, rating: mine, you: true, premium: isPremium(), live: false })
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
    rating: profile.stats.wn8,
    battles: profile.stats.battles,
    wins: profile.stats.wins,
    kills: profile.stats.kills,
    tank: profile.selectedTank,
    favoriteTank: null,
    medals: { ...profile.medals },
    premium: isPremium(),
  }
}
// витрина медалей: весь каталог, полученные — ярко со счётчиком, остальные тусклые
const medalShelf = computed(() => MEDALS.map((d) => ({ def: d, count: profile.medals[d.id] || 0 })))
const myPlace = computed(() => board.value.findIndex((r) => r.you) + 1)
// турнир активен (вкладка ТУРНИРЫ + включён в админке)
const tournamentLive = computed(() => tab.value === 3 && serverConfig.tournaments)

// ===== кланы =====
const clanLoading = ref(false)
const clans = ref([]) // список кланов (таблица)
const myClan = ref(null) // мой клан (карточка) или null
const clanBusy = ref(false)
const createOpen = ref(false)
const cForm = ref({ name: '', tag: '', emblem: 'e1' })
const myUid = computed(() => String(tgUserId() || ''))
const clanErr = ref('')
let clanErrTimer = null
function showClanErr(t) {
  clanErr.value = t
  haptic('error')
  clearTimeout(clanErrTimer)
  clanErrTimer = setTimeout(() => (clanErr.value = ''), 2600)
}
const clanErrText = (e) =>
  ({ 'tag taken': 'Такой тег уже занят', 'bad tag': 'Тег — 2–5 букв/цифр', 'bad name': 'Название — минимум 3 символа', 'bad emblem': 'Выбери эмблему', 'already in clan': 'Ты уже в клане', full: 'Клан заполнен', 'no profile': 'Профиль не найден' })[e] || 'Не получилось'

async function loadClans() {
  clanLoading.value = true
  try {
    const r = await apiClans()
    clans.value = (r && r.clans) || []
    myClan.value = (r && r.mine) || null
  } catch {
    /* офлайн — молча */
  } finally {
    clanLoading.value = false
  }
}
watch(tab, (t) => {
  if (COMING_SOON) return // «Скоро» — данные не тянем
  if (t === 2) loadClans()
  else if (t === 3) loadTournaments()
})

// ===== турниры =====
const CLS_INFO = {
  light: { label: 'Лёгкие', col: '#5fd35f' },
  medium: { label: 'Средние', col: '#4aa3ff' },
  heavy: { label: 'Тяжёлые', col: '#e0853c' },
  any: { label: 'Все классы', col: 'var(--amber)' },
}
const clsInfo = (c) => CLS_INFO[c] || CLS_INFO.any
const tournaments = ref([])
const tournLoading = ref(false)
const tournBusy = ref('') // id турнира в процессе записи
async function loadTournaments() {
  tournLoading.value = true
  try {
    const r = await apiTournaments()
    tournaments.value = (r && r.tournaments) || []
  } catch {
    /* офлайн */
  } finally {
    tournLoading.value = false
  }
}
async function toggleTournament(t) {
  if (tournBusy.value) return
  tournBusy.value = t.id
  try {
    const r = t.joined ? await apiLeaveTournament(t.id) : await apiJoinTournament(t.id)
    if (r.tournament) {
      haptic(t.joined ? 'select' : 'success')
      const i = tournaments.value.findIndex((x) => x.id === t.id)
      if (i >= 0) tournaments.value[i] = r.tournament
    } else if (r.error) {
      showClanErr('Не получилось')
    }
  } catch {
    showClanErr('Сервер недоступен')
  } finally {
    tournBusy.value = ''
  }
}

async function doCreateClan() {
  const name = cForm.value.name.trim()
  const tag = cForm.value.tag.trim()
  if (name.length < 3) return showClanErr('Название — минимум 3 символа')
  if (!/^[A-Za-zА-Яа-я0-9]{2,5}$/.test(tag)) return showClanErr('Тег — 2–5 букв/цифр')
  clanBusy.value = true
  try {
    const r = await apiCreateClan(name, tag, cForm.value.emblem)
    if (r.error) {
      showClanErr(clanErrText(r.error))
      return
    }
    haptic('success')
    createOpen.value = false
    cForm.value = { name: '', tag: '', emblem: 'e1' }
    await syncProfile()
    await loadClans()
  } catch {
    showClanErr('Сервер недоступен')
  } finally {
    clanBusy.value = false
  }
}
async function doJoinClan(id) {
  if (clanBusy.value) return
  clanBusy.value = true
  try {
    const r = await apiJoinClan(id)
    if (r.error) {
      showClanErr(clanErrText(r.error))
      return
    }
    haptic('success')
    await syncProfile()
    await loadClans()
  } catch {
    showClanErr('Сервер недоступен')
  } finally {
    clanBusy.value = false
  }
}
async function doLeaveClan() {
  if (clanBusy.value || !window.confirm('Выйти из клана?')) return
  clanBusy.value = true
  try {
    await apiLeaveClan()
    haptic('select')
    await syncProfile()
    await loadClans()
  } catch {
    showClanErr('Сервер недоступен')
  } finally {
    clanBusy.value = false
  }
}

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
      <button
        v-for="(t, i) in TABS"
        :key="t"
        class="pz-display tabbtn"
        :class="{ on: tab === i, soon: COMING_SOON && i >= 2 }"
        @click="haptic('select'); tab = i"
      >
        {{ t }}<i v-if="COMING_SOON && i >= 2" class="soon-tag">скоро</i>
      </button>
    </div>

    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 16px">
      <!-- ===== КЛАНЫ / ТУРНИРЫ — пока «Скоро» (тизер) ===== -->
      <section v-if="COMING_SOON && (tab === 2 || tab === 3)" class="soon-screen">
        <div class="soon-stamp pz-display">СКОРО</div>
        <div class="soon-feat pz-display">{{ tab === 2 ? 'КЛАНЫ' : 'ТУРНИРЫ' }}</div>
        <p class="soon-text">
          {{
            tab === 2
              ? 'Создавай клан, собирай состав и поднимай клановый рейтинг. Уже на подходе — готовь отряд.'
              : 'Турниры 2×2, 3×3 и 5×5 по классам техники. Совсем скоро — точи машину.'
          }}
        </p>
      </section>

      <!-- ===== ТУРНИРЫ: запись + счётчик «участвую» ===== -->
      <section v-if="tab === 3 && !COMING_SOON" class="clans">
        <p class="hint" style="margin-bottom: 4px">Жми «УЧАСТВУЮ» в нужном формате — как наберётся состав, турнир стартует. Видно, сколько уже записалось.</p>
        <div v-if="tournLoading" class="clan-empty">загрузка…</div>
        <div v-else style="display: flex; flex-direction: column; gap: 8px">
          <div v-for="t in tournaments" :key="t.id" class="tour-card" :class="{ joined: t.joined }">
            <div class="tour-top">
              <span class="tour-fmt pz-display">{{ t.teamSize }}×{{ t.teamSize }}</span>
              <div style="flex: 1; min-width: 0">
                <div class="tour-name">{{ t.name }}</div>
                <div class="tour-cls" :style="{ color: clsInfo(t.cls).col }">{{ clsInfo(t.cls).label }}</div>
              </div>
              <span class="tour-count"><b>{{ t.count }}</b><i>/{{ t.need }}</i></span>
            </div>
            <div class="tour-bar"><b :style="{ width: Math.min(100, (t.count / t.need) * 100) + '%', background: t.count >= t.need ? 'var(--green)' : 'var(--amber)' }"></b></div>
            <div class="tour-foot">
              <span class="tour-status" :style="{ color: t.count >= t.need ? 'var(--green)' : 'var(--ink-dim)' }">
                {{ t.count >= t.need ? '✓ состав набран — ждём старта' : `нужно ещё ${t.need - t.count}` }}
              </span>
              <button class="tour-btn" :class="{ on: t.joined }" :disabled="tournBusy === t.id" @click="toggleTournament(t)">
                {{ t.joined ? 'ВЫ В ЗАЯВКЕ ✓' : 'УЧАСТВУЮ' }}
              </button>
            </div>
          </div>
        </div>
        <transition name="pz-fade"><div v-if="clanErr" class="clan-err">{{ clanErr }}</div></transition>
      </section>

      <!-- ===== КЛАНЫ ===== -->
      <section v-if="tab === 2 && !COMING_SOON" class="clans">
        <!-- я уже в клане -->
        <template v-if="myClan">
          <div class="pz-plate pz-brackets clan-card" style="--bk: var(--amber)">
            <div class="clan-head">
              <ClanEmblem :emblem="myClan.emblem" :size="54" />
              <div style="flex: 1; min-width: 0">
                <div class="clan-name pz-display">{{ myClan.name }} <span class="clan-tag">[{{ myClan.tag }}]</span></div>
                <div class="clan-sub">рейтинг <b style="color: var(--amber)">{{ myClan.rating }}</b> · {{ myClan.size }}/20 бойцов</div>
              </div>
            </div>
            <div class="pz-stencil-h" style="margin: 14px 0 8px">СОСТАВ</div>
            <div class="clan-members">
              <div v-for="m in myClan.members" :key="m.uid" class="cmem" :class="{ me: m.uid === myUid }">
                <PzIcon v-if="m.leader" name="star" :size="12" color="var(--amber)" />
                <span class="cmem-name">{{ m.name }}<span v-if="m.uid === myUid" style="color: var(--ink-faint)"> · ты</span></span>
                <span class="cmem-rating pz-display">{{ m.rating }}</span>
              </div>
            </div>
            <button class="pz-btn2" style="width: 100%; margin-top: 14px" :disabled="clanBusy" @click="doLeaveClan">Покинуть клан</button>
          </div>
        </template>

        <!-- не в клане: создать + список -->
        <template v-else>
          <button v-if="!createOpen" class="pz-cta" style="width: 100%; gap: 8px; font-size: 14px; padding: 13px 16px" @click="haptic('select'); createOpen = true">
            <PzIcon name="star" :size="15" color="currentColor" /> Создать клан
          </button>

          <!-- форма создания -->
          <div v-else class="pz-plate clan-create">
            <div class="pz-stencil-h" style="margin-bottom: 10px">НОВЫЙ КЛАН</div>
            <input v-model="cForm.name" class="cinput" maxlength="22" placeholder="Название клана" />
            <input v-model="cForm.tag" class="cinput" maxlength="5" placeholder="Тег · 2–5 символов (СТК)" style="margin-top: 8px; text-transform: uppercase" />
            <div class="pz-pixel emb-label">ЭМБЛЕМА</div>
            <div class="emblems">
              <button v-for="e in CLAN_EMBLEMS" :key="e.id" class="emb-pick" :class="{ on: cForm.emblem === e.id }" @click="cForm.emblem = e.id">
                <ClanEmblem :emblem="e.id" :size="40" />
              </button>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 14px">
              <button class="pz-btn2" style="flex: 1" @click="createOpen = false">Отмена</button>
              <button class="pz-cta" style="flex: 1.5; padding: 11px" :disabled="clanBusy" @click="doCreateClan">Создать</button>
            </div>
          </div>

          <!-- таблица кланов -->
          <div class="pz-stencil-h" style="margin: 16px 0 8px">КЛАНЫ <span v-if="clans.length" style="color: var(--amber)">{{ clans.length }}</span></div>
          <div v-if="clanLoading" class="clan-empty">загрузка…</div>
          <div v-else-if="!clans.length" class="clan-empty">Кланов пока нет — создай первый!</div>
          <div v-else style="display: flex; flex-direction: column; gap: 6px">
            <div v-for="(c, i) in clans" :key="c.id" class="clan-row">
              <span class="pz-pixel cr-place" :style="{ color: i < 3 ? 'var(--amber)' : 'var(--ink-faint)' }">{{ i + 1 }}</span>
              <ClanEmblem :emblem="c.emblem" :size="32" />
              <div style="flex: 1; min-width: 0">
                <div class="cr-name">{{ c.name }} <span class="clan-tag">[{{ c.tag }}]</span></div>
                <div class="cr-sub">{{ c.size }}/20 · рейтинг {{ c.rating }}</div>
              </div>
              <button class="pz-btn2 cr-join" :disabled="clanBusy" @click="doJoinClan(c.id)">Вступить</button>
            </div>
          </div>
        </template>

        <transition name="pz-fade"><div v-if="clanErr" class="clan-err">{{ clanErr }}</div></transition>
      </section>

      <!-- ===== ПРОФИЛЬ: всё про меня ===== -->
      <section v-if="tab === 0">
        <div class="pz-stencil-h">ПОЗЫВНОЙ</div>
        <div class="pz-plate" style="margin-top: 10px; padding: 12px 14px; display: flex; align-items: center; gap: 10px">
          <span class="pz-display" style="font-size: 18px" :style="{ color: isPremium() ? 'var(--amber-hi)' : 'var(--ink)' }">
            <span v-if="isPremium()" class="prem-crown">♛</span>{{ profile.name }}
          </span>
          <span v-if="isPremium()" class="prem-badge pz-pixel">ПРЕМИУМ · {{ premiumDaysLeft() }} дн</span>
          <span style="flex: 1"></span>
          <button class="pz-btn2" style="padding: 7px 12px; font-size: 11px" :disabled="renaming" @click="rename">Сменить · {{ RENAME_COST_STARS }} ⭐</button>
        </div>
        <button v-if="!isPremium()" class="prem-cta pz-display" @click="emit('go', 'shop')">★ ОФОРМИТЬ ПРЕМИУМ — бонусы к опыту и кредитам</button>
      </section>

      <!-- моя карточка (тап — открыть карточку профиля) -->
      <section v-if="tab === 0">
        <div class="pz-stencil-h">МОЯ СТАТИСТИКА</div>
        <div class="pz-plate pz-brackets me" style="--bk: var(--amber); cursor: pointer" @click="openMe">
          <div style="display: flex; align-items: center; gap: 12px">
            <img src="/sprites/trophy.png" class="rank-badge" style="object-fit: cover" />
            <div style="flex: 1">
              <div style="display: flex; align-items: baseline; gap: 8px">
                <div class="pz-display" style="font-size: 22px" :style="{ color: ratingBand(profile.stats.wn8).color }">{{ profile.stats.wn8 }}</div>
                <span class="pz-display" style="font-size: 10px; letter-spacing: 0.08em" :style="{ color: ratingBand(profile.stats.wn8).color }">{{ ratingBand(profile.stats.wn8).label }}</span>
                <span class="pz-display" style="font-size: 12px; color: var(--amber)">{{ playerRank().name }}</span>
              </div>
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

      <!-- витрина медалей -->
      <section v-if="tab === 0">
        <div class="pz-stencil-h">МЕДАЛИ <span style="color: var(--amber)">{{ medalsEarnedCount() }}</span><span style="color: var(--ink-faint)">/{{ medalsTotal() }}</span></div>
        <div class="medal-shelf">
          <div v-for="m in medalShelf" :key="m.def.id" class="shelf-item" @click="haptic('select'); selMedal = m">
            <Medal :medal="m.def" :count="m.count" :size="46" :locked="m.count === 0" />
            <div class="shelf-name" :class="{ off: m.count === 0 }">{{ m.def.name }}</div>
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
            <span class="lb-name" :style="{ color: r.premium ? 'var(--amber-hi)' : r.you ? 'var(--amber)' : 'var(--ink)' }">
              <span v-if="r.premium" class="prem-crown" title="Премиум">♛</span>{{ r.name }}
            </span>
            <span v-if="r.live" style="font-size: 10.5px; color: var(--ink-dim); font-weight: 600; margin-right: 6px">{{ r.winrate }}%</span>
            <span class="pz-display" :style="{ fontSize: '13.5px', color: ratingBand(r.rating).color }">{{ r.rating }}</span>
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

    <!-- модалка медали: что это и как получить -->
    <transition name="pz-fade">
      <MedalSheet v-if="selMedal" :medal="selMedal.def" :count="selMedal.count" @close="selMedal = null" />
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
  position: relative;
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
.tabbtn.soon:not(.on) {
  opacity: 0.72;
}
/* мини-бейдж «скоро» в углу таба (не влияет на раскладку — absolute) */
.soon-tag {
  position: absolute;
  top: -6px;
  right: -2px;
  font-size: 6.5px;
  letter-spacing: 0.02em;
  font-style: normal;
  font-weight: 700;
  padding: 1px 4px 0;
  border-radius: 6px;
  background: var(--amber);
  color: #1d1604;
  pointer-events: none;
}
.tabbtn.on .soon-tag {
  background: #1d1604;
  color: var(--amber);
}

/* экран-тизер «Скоро» для кланов/турниров */
.soon-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 12px;
  padding: 48px 24px;
}
.soon-stamp {
  font-size: 30px;
  letter-spacing: 0.2em;
  color: var(--amber);
  border: 3px solid var(--amber);
  border-radius: 12px;
  padding: 8px 26px 6px;
  transform: rotate(-7deg);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
}
.soon-feat {
  font-size: 22px;
  letter-spacing: 0.08em;
  color: var(--ink);
  margin-top: 10px;
}
.soon-text {
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-dim);
  max-width: 290px;
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
.prem-crown {
  color: var(--amber-hi);
  margin-right: 4px;
  text-shadow: 0 0 6px rgba(242, 165, 12, 0.6);
}
.prem-badge {
  font-size: 7px;
  letter-spacing: 0.08em;
  color: #1d1604;
  background: linear-gradient(180deg, var(--amber-hi), var(--amber));
  padding: 3px 6px;
  border-radius: 5px;
  white-space: nowrap;
}
.prem-cta {
  width: 100%;
  margin-top: 8px;
  padding: 9px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--amber);
  background: rgba(242, 165, 12, 0.08);
  border: 1px solid var(--amber);
  border-radius: 8px;
  cursor: pointer;
}
.place {
  font-size: 9px;
  width: 22px;
  flex-shrink: 0;
  text-align: center;
}
.medal-shelf {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px 6px;
  margin-top: 12px;
  padding: 14px 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.shelf-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.1s ease;
}
.shelf-item:active {
  transform: scale(0.92);
}
.shelf-name {
  margin-top: 5px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.15;
  text-align: center;
  color: var(--ink);
}
.shelf-name.off {
  color: var(--ink-faint);
  opacity: 0.7;
}

/* ===== кланы ===== */
.clans {
  position: relative;
  display: flex;
  flex-direction: column;
}
.clan-card {
  padding: 16px 14px 14px;
}
.clan-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.clan-name {
  font-size: 17px;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clan-tag {
  color: var(--amber);
  font-size: 0.82em;
}
.clan-sub {
  font-size: 11.5px;
  color: var(--ink-dim);
  font-weight: 600;
  margin-top: 3px;
}
.clan-members {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cmem {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.cmem.me {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.08);
}
.cmem-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmem-rating {
  font-size: 13px;
  color: var(--amber);
}
.clan-create {
  padding: 14px;
  border-radius: 12px;
}
.cinput {
  width: 100%;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
  outline: none;
}
.cinput:focus {
  border-color: var(--amber);
}
.emb-label {
  font-size: 7px;
  color: var(--ink-faint);
  letter-spacing: 0.1em;
  margin: 14px 0 7px;
}
.emblems {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.emb-pick {
  display: flex;
  justify-content: center;
  padding: 6px;
  background: rgba(0, 0, 0, 0.3);
  border: 1.5px solid var(--line-strong);
  border-radius: 10px;
  cursor: pointer;
}
.emb-pick.on {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.1);
}
.clan-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
  border-radius: 9px;
}
.cr-place {
  font-size: 10px;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}
.cr-name {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cr-sub {
  font-size: 10.5px;
  color: var(--ink-dim);
  font-weight: 500;
  margin-top: 1px;
}
.cr-join {
  flex-shrink: 0;
  padding: 7px 12px;
  font-size: 11px;
}
.clan-empty {
  text-align: center;
  font-size: 12px;
  color: var(--ink-faint);
  font-weight: 500;
  padding: 14px 0;
}
.clan-err {
  position: sticky;
  bottom: 6px;
  align-self: center;
  margin-top: 10px;
  background: var(--bg-3, #1a1410);
  border: 1px solid var(--red);
  color: #ff9a8a;
  font-size: 12px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
}

/* ===== турниры ===== */
.tour-card {
  padding: 12px 13px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line-strong);
  border-radius: 11px;
}
.tour-card.joined {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.07);
}
.tour-top {
  display: flex;
  align-items: center;
  gap: 11px;
}
.tour-fmt {
  font-size: 19px;
  color: var(--amber);
  width: 50px;
  text-align: center;
  flex-shrink: 0;
}
.tour-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tour-cls {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  margin-top: 1px;
}
.tour-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--ink-faint);
}
.tour-count b {
  font-size: 18px;
  color: var(--ink);
  font-weight: 700;
}
.tour-bar {
  height: 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.45);
  overflow: hidden;
  margin: 10px 0 8px;
}
.tour-bar b {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.tour-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.tour-status {
  font-size: 10.5px;
  font-weight: 600;
}
.tour-btn {
  flex-shrink: 0;
  padding: 8px 16px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: 8px;
  cursor: pointer;
  color: #1d1604;
  background: linear-gradient(180deg, var(--amber-hi), var(--amber));
  border: 1px solid transparent;
}
.tour-btn.on {
  color: var(--green);
  background: rgba(141, 184, 74, 0.14);
  border-color: var(--green);
}
.tour-btn:disabled {
  opacity: 0.6;
}
</style>
