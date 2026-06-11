<script setup>
import { ref, computed, onMounted } from 'vue'
import Hangar from './components/Hangar.vue'
import Tree from './components/Tree.vue'
import Crew from './components/Crew.vue'
import Shop from './components/Shop.vue'
import Rating from './components/Rating.vue'
import Matchmaking from './components/Matchmaking.vue'
import Battle from './components/Battle.vue'
import DailyReward from './components/DailyReward.vue'
import { profile, addRewards, bankBattleXp, bankTaskProgress, loadoutStats, dailyAvailable, syncProfile, applyTgName } from './store.js'
import { randomMap } from './game/maps.js'

// экраны: hangar | tree | crew | shop | rating | matchmaking | battle
const screen = ref('hangar')
const battleKey = ref(0) // смена пересоздаёт Battle (реванш)
const loadout = computed(() => loadoutStats(profile.selectedTank))
// жребий боя: карта и сторона (0 — юг/синие, 1 — север/красные); реванш — там же
const draw = ref({ mapId: 'polygon', side: 0 })
// онлайн-матч от матчмейкинга ({client, mapId, side, youUnit, tickHz}); null — офлайн с ботами
const netMatch = ref(null)

// старт: подтянуть профиль с сервера, потом ежедневный вход
const daily = ref(false)
onMounted(async () => {
  await syncProfile() // офлайн — молча остаёмся на локальном кеше
  applyTgName() // серверный профиль мог вернуть старое имя — обновляем ником TG
  if (dailyAvailable()) daily.value = true
})

function go(to) {
  screen.value = to
}
function play() {
  draw.value = { mapId: randomMap().id, side: Math.random() < 0.5 ? 0 : 1 }
  screen.value = 'matchmaking'
}
function deploy(net) {
  netMatch.value = net || null // онлайн, если матчмейкинг нашёл сервер
  battleKey.value++ // каждый матч — свежий бой
  screen.value = 'battle'
}
// награда боя + прогресс задач дня
function bankBattle(reward) {
  if (!reward) return
  addRewards(reward.silver || 0)
  bankBattleXp(reward.xp) // 50% в ветку танка, 50% экипажу
  bankTaskProgress({
    damage: reward.damage,
    kills: reward.kills,
    lightKills: reward.lightKills,
    blocked: reward.blocked,
    wins: reward.victory ? 1 : 0,
    battles: 1,
  })
}
function exitBattle(reward) {
  bankBattle(reward)
  netMatch.value = null
  screen.value = 'hangar'
}
function rematch(reward) {
  bankBattle(reward)
  if (netMatch.value) {
    // онлайн: соединение матча уже закрыто — реванш через новый поиск
    netMatch.value = null
    play()
  } else {
    battleKey.value++
  }
}
</script>

<template>
  <Hangar v-if="screen === 'hangar'" @play="play" @go="go" />
  <Tree v-else-if="screen === 'tree'" @go="go" />
  <Crew v-else-if="screen === 'crew'" @go="go" />
  <Shop v-else-if="screen === 'shop'" @go="go" />
  <Rating v-else-if="screen === 'rating'" @go="go" />
  <Matchmaking v-else-if="screen === 'matchmaking'" :map-id="draw.mapId" :side="draw.side" @battle="deploy" @cancel="go('hangar')" />
  <Battle v-else-if="screen === 'battle'" :key="battleKey" :loadout="loadout" :map-id="draw.mapId" :side="draw.side" :net="netMatch" @exit="exitBattle" @rematch="rematch" />

  <DailyReward v-if="daily && screen !== 'battle'" @close="daily = false" />
</template>
