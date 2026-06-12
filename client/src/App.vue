<script setup>
import { ref, computed, onMounted, watch, markRaw } from 'vue'
import { setBackButton, startParam, tgUserId } from './tg.js'
import { apiReferred } from './api.js'
import Hangar from './components/Hangar.vue'
import Tree from './components/Tree.vue'
import Crew from './components/Crew.vue'
import Shop from './components/Shop.vue'
import Rating from './components/Rating.vue'
import Matchmaking from './components/Matchmaking.vue'
import Battle from './components/Battle.vue'
import DailyReward from './components/DailyReward.vue'
import { profile, addRewards, bankBattleXp, bankTaskProgress, bankMedals, loadoutStats, dailyAvailable, syncProfile, applyTgName, isPremium, PREMIUM_BONUS, loadConfig, setPartyToken, setBattleMode } from './store.js'
import { randomMap } from './game/maps.js'
import { squad, connectSquad, closeSquad } from './game/squad.js'

// экраны: hangar | tree | crew | shop | rating | matchmaking | battle
const screen = ref('hangar')
const battleKey = ref(0) // смена пересоздаёт Battle (реванш)
const loadout = computed(() => loadoutStats(profile.selectedTank))
// жребий боя: карта и сторона (0 — юг/синие, 1 — север/красные); реванш — там же
const draw = ref({ mapId: 'polygon', side: 0 })
// онлайн-матч от матчмейкинга ({client, mapId, side, youUnit, tickHz}); null — офлайн с ботами
const netMatch = ref(null)
// мгновенный старт боя БЕЗ отсчёта — для авто-отката онлайн→офлайн (нет второго «3-2-1»)
const instantDeploy = ref(false)

// старт: подтянуть профиль с сервера, потом ежедневный вход
const daily = ref(false)
onMounted(async () => {
  await syncProfile() // офлайн — молча остаёмся на локальном кеше
  applyTgName() // серверный профиль мог вернуть старое имя — обновляем ником TG
  loadConfig() // флаг турниров и пр. (не блокируем старт)
  // взвод-лобби: командир жмёт старт → все участники сюда → в бой с party=squadId
  squad.onLaunch = (m) => {
    setPartyToken(m.squadId, String(m.squadId) === String(tgUserId()))
    if (m.mode) setBattleMode(m.mode)
    closeSquad()
    play()
  }
  squad.onDisband = () => {} // UI взвода сам покажет роспуск
  handleStartParam() // deep-link: реферал ref_<id> / приглашение во взвод sq_<id>
  if (dailyAvailable()) daily.value = true
})

// разбор start_param из пригласительной ссылки. ref_<id> — засчитать реферера на
// сервере (один раз). sq_<id> — встать во взвод командира <id> на этот сеанс.
async function handleStartParam() {
  const m = /^(ref|sq)_(\d{3,})$/.exec(startParam() || '')
  if (!m) return
  const kind = m[1]
  const id = m[2]
  if (String(id) === String(tgUserId())) return // свою же ссылку игнорируем
  if (kind === 'sq') {
    connectSquad(id, profile.name) // приглашён — заходим в лобби взвода командира id
  } else {
    try {
      await apiReferred(id) // сервер привяжет реферера и добавит меня ему в рекруты
    } catch {
      /* офлайн — реферал не засчитан; повторно засчитывать не пытаемся */
    }
  }
}

function go(to) {
  screen.value = to
}

// кнопка «Назад» Telegram: на корне (ангар) и в бою — спрятана (там свои
// выходы), на остальных экранах ведёт в ангар вместо сворачивания мини-аппа
watch(
  screen,
  (s) => setBackButton(s === 'hangar' || s === 'battle' ? null : () => go('hangar')),
  { immediate: true },
)
function play() {
  draw.value = { mapId: randomMap().id, side: Math.random() < 0.5 ? 0 : 1 }
  screen.value = 'matchmaking'
}
function deploy(net) {
  // markRaw: НЕ оборачивать клиент (ws + onMessage-подписка) в реактивный прокси —
  // иначе net.js (сырой объект) и NetGame (прокси) расходятся, снапшоты не доходят
  netMatch.value = net ? markRaw(net) : null // онлайн, если матчмейкинг нашёл сервер
  // фиксируем сторону онлайн-боя в жребий: если связь оборвётся ПОСРЕДИ боя и будет
  // откат в офлайн — игрок останется за ту же команду (без смены синие↔красные)
  if (net) draw.value = { ...draw.value, side: net.side }
  instantDeploy.value = false // обычный старт с отсчётом
  battleKey.value++ // каждый матч — свежий бой
  screen.value = 'battle'
}
// онлайн-бой не получил снапшоты — пересобираем бой офлайн с ботами МГНОВЕННО
// (без второго отсчёта), со свежей картой. Игрок никогда не залипает на «нет связи».
function netFail() {
  draw.value = { mapId: randomMap().id, side: draw.value.side }
  netMatch.value = null
  instantDeploy.value = true // сразу в бой, без «3-2-1»
  battleKey.value++ // смена ключа пересоздаёт Battle уже в офлайн-режиме
}
// награда боя + прогресс задач дня
function bankBattle(reward) {
  if (!reward) return
  // премиум: +15% к кредитам и опыту (экипаж + ветка техники) за бой
  const m = isPremium() ? 1 + PREMIUM_BONUS : 1
  addRewards(Math.round((reward.silver || 0) * m))
  bankBattleXp(Math.round(reward.xp * m)) // 50% в ветку танка, 50% экипажу
  bankTaskProgress({
    damage: reward.damage,
    kills: reward.kills,
    lightKills: reward.lightKills,
    blocked: reward.blocked,
    wins: reward.victory ? 1 : 0,
    battles: 1,
  })
  // медали по итогам боя (награда за первое получение начисляется внутри);
  // карьерные рубежи считаются от уже обновлённой addBattleResult статистики
  bankMedals({
    kills: reward.kills,
    damage: reward.damage,
    blocked: reward.blocked,
    lightKills: reward.lightKills,
    survived: reward.survived,
    victory: reward.victory,
  })
}
function exitBattle(reward) {
  bankBattle(reward)
  netMatch.value = null
  screen.value = 'hangar'
}
function rematch(reward) {
  bankBattle(reward)
  // каждый «ЕЩЁ БОЙ» — через ПОИСК нового боя (как первый раз): попытка найти
  // живых/друзей, затем добор ботами. Не кидаем мгновенно в офлайн-бой.
  netMatch.value = null
  play()
}
</script>

<template>
  <Hangar v-if="screen === 'hangar'" @play="play" @go="go" />
  <Tree v-else-if="screen === 'tree'" @go="go" />
  <Crew v-else-if="screen === 'crew'" @go="go" />
  <Shop v-else-if="screen === 'shop'" @go="go" />
  <Rating v-else-if="screen === 'rating'" @go="go" />
  <Matchmaking v-else-if="screen === 'matchmaking'" :map-id="draw.mapId" :side="draw.side" @battle="deploy" @cancel="go('hangar')" />
  <Battle v-else-if="screen === 'battle'" :key="battleKey" :loadout="loadout" :map-id="draw.mapId" :side="draw.side" :mode="profile.battleMode" :net="netMatch" :instant="instantDeploy" @exit="exitBattle" @rematch="rematch" @netfail="netFail" />

  <DailyReward v-if="daily && screen !== 'battle'" @close="daily = false" />
</template>
