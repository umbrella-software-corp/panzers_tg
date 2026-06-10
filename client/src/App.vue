<script setup>
import { ref, computed, onMounted } from 'vue'
import Hangar from './components/Hangar.vue'
import Tree from './components/Tree.vue'
import Shop from './components/Shop.vue'
import Rating from './components/Rating.vue'
import Matchmaking from './components/Matchmaking.vue'
import Battle from './components/Battle.vue'
import DailyReward from './components/DailyReward.vue'
import { profile, addRewards, addCrewXp, loadoutStats, dailyAvailable } from './store.js'

// экраны: hangar | tree | shop | rating | matchmaking | battle
const screen = ref('hangar')
const battleKey = ref(0) // смена пересоздаёт Battle (реванш)
const loadout = computed(() => loadoutStats(profile.selectedTank))

// ежедневный вход — предлагаем при запуске
const daily = ref(false)
onMounted(() => {
  if (dailyAvailable()) daily.value = true
})

function go(to) {
  screen.value = to
}
function play() {
  screen.value = 'matchmaking'
}
function deploy() {
  battleKey.value++ // каждый матч — свежий бой
  screen.value = 'battle'
}
function exitBattle(reward) {
  if (reward) {
    addRewards(reward.silver || 0)
    addCrewXp(reward.xp) // опыт боя качает экипаж
  }
  screen.value = 'hangar'
}
function rematch(reward) {
  if (reward) {
    addRewards(reward.silver || 0)
    addCrewXp(reward.xp)
  }
  battleKey.value++
}
</script>

<template>
  <Hangar v-if="screen === 'hangar'" @play="play" @go="go" />
  <Tree v-else-if="screen === 'tree'" @go="go" />
  <Shop v-else-if="screen === 'shop'" @go="go" />
  <Rating v-else-if="screen === 'rating'" @go="go" />
  <Matchmaking v-else-if="screen === 'matchmaking'" @battle="deploy" @cancel="go('hangar')" />
  <Battle v-else-if="screen === 'battle'" :key="battleKey" :loadout="loadout" @exit="exitBattle" @rematch="rematch" />

  <DailyReward v-if="daily && screen !== 'battle'" @close="daily = false" />
</template>
