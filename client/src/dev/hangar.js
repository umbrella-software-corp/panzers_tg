// DEV-ОНЛИ стенд: мини-роутер Главная(Hangar) ↔ Ангар(Tree) с дефолт-профилем (без бэка).
// Цель — проверить чистый главный экран + перенос дерева/камо/«Выбрать» на вкладку Ангар.
import '../style.css'
import { createApp, h, ref } from 'vue'
import Hangar from '../components/Hangar.vue'
import Tree from '../components/Tree.vue'
import { profile } from '../store.js'

// засеять «не первую сессию»: показываются ЗАДАЧИ/ВЗВОД-пилюли и пр.
if (!profile.stats) profile.stats = {}
profile.stats.battles = 50
profile.stats.wins = 25
profile.stats.kills = 80
profile.credits = 6000000
profile.tokens = 10100
profile.premiumUntil = Date.now() + 17 * 86400000

const screen = ref('hangar')
const SCREENS = { hangar: Hangar, tree: Tree }
const Root = {
  setup() {
    return () => h(SCREENS[screen.value] || Hangar, {
      onGo: (s) => { screen.value = s },
      onPlay: () => console.log('В БОЙ →', profile.selectedTank),
    })
  },
}
createApp(Root).mount('#app')
window.__setScreen = (s) => (screen.value = s)
