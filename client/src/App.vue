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
import Onboarding from './components/Onboarding.vue'
import { profile, party, addRewards, bankBattleXp, bankTaskProgress, bankMedals, loadoutStats, dailyAvailable, syncProfile, applyTgName, isPremium, PREMIUM_BONUS, loadConfig, setPartyToken, setBattleMode } from './store.js'
import { randomMap } from './game/maps.js'
import { TANK_BY_ID, PREM_TANK } from './game/meta.js'
import { squad, connectSquad, closeSquad } from './game/squad.js'
import { track, trackScreen, setAnalyticsUserId, identifyUser, identifyAcquisition } from './analytics.js'
import { t } from './i18n.js'

// экраны: hangar | tree | crew | shop | rating | matchmaking | battle
const screen = ref('hangar')
const battleKey = ref(0) // смена пересоздаёт Battle (реванш)
const loadout = computed(() => loadoutStats(profile.selectedTank))
// жребий боя: карта и сторона (0 — юг/синие, 1 — север/красные); реванш — там же
const draw = ref({ mapId: 'polygon', side: 0 })
// онлайн-матч от матчмейкинга ({client, mapId, side, youUnit, tickHz}). Игра онлайн-онли:
// матчмейкинг входит в бой только с живым клиентом, офлайн-фоллбэка нет.
const netMatch = ref(null)

// старт: подтянуть профиль с сервера, потом ежедневный вход
const daily = ref(false)
const booting = ref(true) // стартовый сплэш-лоадер (БЕТА) — держим, пока тянем профиль

// Дейлик показываем максимум один раз за сессию и НЕ на первом входе новичка:
// при 0 боёв вход не перехватываем — попап всплывёт при возврате в ангар после
// первого боя (battles уже >0). У возвращающихся — как раньше, сразу на входе.
let dailyShown = false
function maybeShowDaily() {
  if (dailyShown || daily.value) return
  if (!dailyAvailable() || (profile.stats?.battles || 0) === 0) return
  dailyShown = true
  track('daily_reward_shown', {
    screen: screen.value,
    battles_count: profile.stats?.battles || 0,
  })
  daily.value = true
}
onMounted(async () => {
  const t0 = Date.now()
  const finishBoot = () => (booting.value = false)
  setTimeout(finishBoot, 3000) // предохранитель: не зависаем на сплэше при медленной сети
  await syncProfile() // офлайн — молча остаёмся на локальном кеше
  applyTgName() // серверный профиль мог вернуть старое имя — обновляем ником TG
  loadConfig() // флаг турниров и пр. (не блокируем старт)
  // профиль загружен — связываем юзера и шлём срез прогрессии в Amplitude
  setAnalyticsUserId(tgUserId() ? `tg_${tgUserId()}` : null)
  identifyAcquisition() // стики-атрибуция источника (реф-ферма vs живые) на весь lifecycle
  identifyUser({
    battles_count: profile.stats?.battles || 0,
    owned_tanks_count: Array.isArray(profile.owned) ? profile.owned.length : 0,
    selected_tank: profile.selectedTank,
    battle_mode: profile.battleMode,
  })
  track('profile_loaded', {
    battles_count: profile.stats?.battles || 0,
    owned_tanks_count: Array.isArray(profile.owned) ? profile.owned.length : 0,
    selected_tank: profile.selectedTank,
    battle_mode: profile.battleMode,
  })
  // взвод-лобби: командир жмёт старт → все участники сюда → в бой с party=squadId
  squad.onLaunch = (m) => {
    // взвод НЕ закрываем — он живёт через бои: сыграли, вернулись в ангар,
    // командир снова жмёт «В БОЙ» тем же составом. party-токен чистится только
    // при реальном выходе из взвода (closeSquad → clearParty).
    setPartyToken(m.squadId, String(m.squadId) === String(tgUserId()))
    if (m.mode) setBattleMode(m.mode)
    play()
  }
  squad.onDisband = () => {} // UI взвода сам покажет роспуск
  handleStartParam() // deep-link: реферал ref_<id> / приглашение во взвод sq_<id>
  maybeShowDaily() // первую сессию (0 боёв) НЕ перехватываем — дейлик всплывёт после первого боя
  // сплэш держим минимум ~750мс, чтобы не моргал на быстром старте
  setTimeout(finishBoot, Math.max(0, 900 - (Date.now() - t0)))
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
    track('squad_deeplink_opened', {
      squad_id_present: true,
      from_start_param: true,
    })
  } else {
    try {
      const out = await apiReferred(id) // сервер привяжет реферера и добавит меня ему в рекруты
      track('referral_registered', {
        result: out?.ok ? 'ok' : 'failed',
        credited: !!out?.credited,
        reason: out?.reason || null,
      })
    } catch {
      /* офлайн — реферал не засчитан; повторно засчитывать не пытаемся */
    }
  }
}

function go(to) {
  screen.value = to
}

// тур по ангару: только самому первому входу (0 боёв, ещё не проходил), после
// того как сплэш ушёл и мы в ангаре. Главную дыру воронки лечат тупые боты, а
// тур — лёгкий и пропускаемый, чтобы не добавлять трения до боя.
const showOnboarding = computed(
  () => !booting.value && screen.value === 'hangar' && (profile.stats?.battles || 0) === 0 && !profile.onboarded,
)
function finishOnboarding(launch) {
  profile.onboarded = true // персистится сам (deep watch в store)
  if (launch) play()
}

// кнопка «Назад» Telegram: на корне (ангар) и в бою — спрятана (там свои
// выходы), на остальных экранах ведёт в ангар вместо сворачивания мини-аппа
watch(
  screen,
  (s, prev) => {
    setBackButton(s === 'hangar' || s === 'battle' ? null : () => go('hangar'))
    trackScreen(s, prev)
  },
  { immediate: true },
)
function play() {
  track('play_clicked', {
    from_screen: screen.value,
    battle_mode: profile.battleMode,
    tank_id: profile.selectedTank,
    party_present: !!party.token,
    battles_count: profile.stats?.battles || 0,
  })
  draw.value = { mapId: randomMap().id, side: Math.random() < 0.5 ? 0 : 1 }
  screen.value = 'matchmaking'
}
function deploy(net) {
  track('battle_loading_started', {
    online: !!net,
    match_type: net ? (party.token ? 'squad' : 'online') : 'offline_fallback',
    map_id: net?.mapId || draw.value.mapId,
    mode: net?.mode || profile.battleMode,
    party_present: !!party.token,
    humans: net?.humans || null,
  })
  // markRaw: НЕ оборачивать клиент (ws + onMessage-подписка) в реактивный прокси —
  // иначе net.js (сырой объект) и NetGame (прокси) расходятся, снапшоты не доходят
  netMatch.value = net ? markRaw(net) : null
  if (net) draw.value = { ...draw.value, side: net.side } // сторона из серверного лобби
  battleKey.value++ // каждый матч — свежий бой
  screen.value = 'battle'
}
// награда боя + прогресс задач дня
function bankBattle(reward) {
  if (!reward) return
  // премиум-танк (играли в этом бою): +5% опыт/кредиты + шанс кристаллов
  const premTank = !!(TANK_BY_ID[profile.selectedTank] && TANK_BY_ID[profile.selectedTank].premium)
  track('battle_reward_banked', {
    xp: reward.xp || 0,
    silver: reward.silver || 0,
    damage: reward.damage || 0,
    kills: reward.kills || 0,
    victory: !!reward.victory,
    survived: !!reward.survived,
    premium_bonus: isPremium() ? PREMIUM_BONUS : 0,
    prem_tank: premTank,
  })
  // премиум-аккаунт (+15%) и премиум-танк (+5%) к кредитам и опыту — стакаются
  let m = 1
  if (isPremium()) m += PREMIUM_BONUS
  if (premTank) m += PREM_TANK.creditMult
  addRewards(Math.round((reward.silver || 0) * m))
  bankBattleXp(Math.round(reward.xp * m)) // 50% в ветку танка, 50% экипажу
  // прем-танк: 1 из 10 боёв — синие кристаллы (жетоны)
  if (premTank && Math.random() < PREM_TANK.gemChance) {
    addRewards(0, PREM_TANK.gems)
    track('prem_tank_gem_drop', { tank_id: profile.selectedTank, gems: PREM_TANK.gems })
  }
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
  track('battle_exit_to_hangar', {
    had_reward: !!reward,
    result: reward?.victory ? 'victory' : null,
    damage: reward?.damage || 0,
    kills: reward?.kills || 0,
  })
  screen.value = 'hangar'
  maybeShowDaily() // после первого боя (battles>0) дейлик всплывает здесь, а не на входе
}
function rematch(reward) {
  track('rematch_clicked', {
    result: reward?.victory ? 'victory' : null,
    damage: reward?.damage || 0,
    kills: reward?.kills || 0,
    survived: !!reward?.survived,
  })
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
  <Battle v-else-if="screen === 'battle'" :key="battleKey" :loadout="loadout" :map-id="draw.mapId" :side="draw.side" :mode="profile.battleMode" :net="netMatch" @exit="exitBattle" @rematch="rematch" />

  <DailyReward v-if="daily && screen !== 'battle'" @close="daily = false" />

  <!-- тур по ангару для самого первого входа (lazy: остальным даже не грузится) -->
  <Onboarding v-if="showOnboarding" @play="finishOnboarding(true)" @skip="finishOnboarding(false)" />

  <!-- стартовый сплэш-лоадер с пометкой БЕТА (пока тянем профиль) -->
  <transition name="boot-fade">
    <div v-if="booting" class="bootsplash">
      <div class="boot-mid">
        <div class="boot-logo pz-display">PANZER <b>TG</b><span class="boot-beta pz-display">{{ t('common.beta') }}</span></div>
        <div class="boot-spin"></div>
        <div class="boot-sub">{{ t('common.bootSub') }}</div>
      </div>
      <div class="boot-foot">{{ t('common.bootFoot') }}</div>
    </div>
  </transition>
</template>

<style scoped>
.bootsplash {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #090b08; /* сплошной непрозрачный фон (перекрывает ангар) */
  background-image: radial-gradient(120% 75% at 50% 30%, rgba(48, 60, 36, 0.5), transparent 68%);
}
.boot-mid {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.boot-logo {
  position: relative;
  font-size: 38px;
  letter-spacing: 0.06em;
  color: var(--ink);
}
.boot-logo b {
  color: var(--amber);
}
.boot-beta {
  position: absolute;
  top: -10px;
  right: -42px;
  font-size: 10px;
  letter-spacing: 0.16em;
  color: #1d1604;
  background: var(--amber);
  border-radius: 6px;
  padding: 2px 7px 1px;
  transform: rotate(7deg);
}
.boot-spin {
  margin-top: 30px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 3px solid rgba(242, 165, 12, 0.18);
  border-top-color: var(--amber);
  animation: boot-rot 0.8s linear infinite;
}
.boot-sub {
  margin-top: 16px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  font-weight: 500;
}
.boot-foot {
  position: absolute;
  bottom: calc(var(--safe-bottom, 0px) + 22px);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
}
@keyframes boot-rot {
  to {
    transform: rotate(360deg);
  }
}
.boot-fade-leave-active {
  transition: opacity 0.45s ease;
}
.boot-fade-leave-to {
  opacity: 0;
}
</style>
