<script setup>
import { ref, computed, onMounted, watch, markRaw } from 'vue'
import { setBackButton, startParam, tgUserId, requestWriteAccess } from './tg.js'
import { apiReferred, apiPushAllow } from './api.js'
import Hangar from './components/Hangar.vue'
import Tree from './components/Tree.vue'
import Crew from './components/Crew.vue'
import Shop from './components/Shop.vue'
import Rating from './components/Rating.vue'
import Matchmaking from './components/Matchmaking.vue'
import Battle from './components/Battle.vue'
import DailyReward from './components/DailyReward.vue'
import Onboarding from './components/Onboarding.vue'
import SecondTankChoice from './components/SecondTankChoice.vue'
import { profile, party, addRewards, bankBattleXp, bankTaskProgress, bankMedals, loadoutStats, dailyAvailable, syncProfile, applyTgName, isPremium, PREMIUM_BONUS, loadConfig, setPartyToken, setBattleMode, grantFreeTank, grantReveal } from './store.js'
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
// «только что вышел из боя» — баннер фидбека показываем лишь в ангаре сразу после боя
// (на эмоциях), а не висящим постоянно. Сбрасывается при любой навигации/новом бое.
const cameFromBattle = ref(false)
// первый запуск новичка: ведём сразу в тренировочный бой (соло + замороженные боты,
// гайд «едь/целься/стреляй»), минуя ангар. Флаг едет в Matchmaking → Battle.
const training = ref(false)

// старт: подтянуть профиль с сервера, потом ежедневный вход
const daily = ref(false)
const booting = ref(true) // стартовый сплэш-лоадер (БЕТА) — держим, пока тянем профиль

// Дейлик показываем максимум один раз за сессию и НЕ на первом входе новичка:
// при 0 боёв вход не перехватываем — попап всплывёт при возврате в ангар после
// первого боя (battles уже >0). У возвращающихся — как раньше, сразу на входе.
let dailyShown = false
// дейлик показываем НЕ ЧАЩЕ раза в день на устройство — маркер в localStorage, ВНЕ
// синкаемого профиля. dailyShown сбрасывается на каждой перезагрузке мини-аппа (а TG
// перезапускает webview часто), а claim уезжает на сервер debounce'ом — если перезапуск
// случился раньше отправки, syncProfile() делал Object.assign старого daily.last поверх
// локального → попап всплывал снова и снова (это и были «3 раза», вдобавок давало
// пере-клейм со взвинчиванием стрика). Маркер показа закрывает это независимо от гонки.
const DAILY_PROMPT_KEY = 'pz.dailyPrompt'
const todayStr = () => new Date().toISOString().slice(0, 10)
function dailyPromptedToday() {
  try {
    return localStorage.getItem(DAILY_PROMPT_KEY) === todayStr()
  } catch {
    return false
  }
}
function maybeShowDaily() {
  if (dailyShown || daily.value || dailyPromptedToday()) return
  if (!dailyAvailable() || (profile.stats?.battles || 0) === 0) return
  if (!profile.secondTankChosen) return // сначала выбор второго танка + тур, дейлик — позже
  dailyShown = true
  try {
    localStorage.setItem(DAILY_PROMPT_KEY, todayStr())
  } catch {}
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
  maybeStartTraining() // самый первый запуск → сразу тренировочный бой (мимо ангара)
  maybeAskPush() // вовлечённому (battles>0) — разрешение боту на пуши; новичка спросим после первого боя
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
  cameFromBattle.value = false // ушёл листать ангар/другие экраны — фидбек-баннер прячем
  screen.value = to
}

// После первого боя в ангаре подряд: (1) подарок «выбери второй танк», затем
// (2) тур-«добро пожаловать». Тур ждёт выбора танка (secondTankChosen) — чтобы шаг
// «Это твой танк» подсветил уже новую, выбранную машину, а не стартовую.
const showTankChoice = computed(
  () => !booting.value && screen.value === 'hangar' && (profile.stats?.battles || 0) >= 1 && !profile.secondTankChosen,
)
function pickSecondTank(id) {
  grantFreeTank(id) // выдаём бесплатно, делаем выбранным, нация → его ветка, флаг secondTankChosen
}

// тур по ангару = «добро пожаловать в ангар» ПОСЛЕ первого (тренировочного) боя и
// после выбора второго танка. Лёгкий и пропускаемый (танк → режим → В БОЙ).
const showOnboarding = computed(
  () => !booting.value && screen.value === 'hangar' && (profile.stats?.battles || 0) >= 1 && profile.secondTankChosen && !profile.onboarded,
)
function finishOnboarding(launch) {
  profile.onboarded = true // персистится сам (deep watch в store)
  if (launch) play()
}

// самый первый запуск: уводим новичка прямо в тренировочный бой (мимо ангара).
// НЕ перехватываем, если зашёл по приглашению во взвод (sq_) — пусть идёт к друзьям.
function maybeStartTraining() {
  if ((profile.stats?.battles || 0) !== 0 || profile.trainingDone) return
  if (party.token || /^sq_\d{3,}$/.test(startParam() || '')) return
  training.value = true
  draw.value = { mapId: randomMap().id, side: 0 }
  screen.value = 'matchmaking'
  track('training_first_launch', {})
}
// отмена поиска тренировочного боя — в ангар, тренировку сбрасываем (обычный поток)
function cancelMatchmaking() {
  training.value = false
  go('hangar')
}

// ОДИН раз спрашиваем у вовлечённого игрока разрешение боту на пуши (нативный попап
// Telegram requestWriteAccess). Без него бот не может писать вебапп-юзерам — рассылка
// возврата уходит «в 0». Разрешил → снимаем pushBlocked на сервере. Спрашиваем после
// первого боя (battles>0), чтобы не в лоб на холодном старте.
async function maybeAskPush() {
  if (profile.pushAsked || (profile.stats?.battles || 0) < 1 || !tgUserId()) return
  profile.pushAsked = true // спрашиваем единожды (персистится), даже если откажет — не нудим
  track('push_access_requested', {})
  const ok = await requestWriteAccess()
  track('push_access_result', { granted: !!ok })
  if (ok) {
    try {
      await apiPushAllow()
    } catch {
      /* офлайн — снимем pushBlocked при следующем заходе/пуше */
    }
  }
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
  cameFromBattle.value = false // ушёл в новый бой — пост-боевой баннер сбрасываем
  training.value = false // обычный бой из ангара — не тренировка
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
  // прем-танк: КАЖДЫЙ 10-й бой гарантированно даёт синие кристаллы (детерминированно,
  // не рандом — иначе игрок мог отыграть много боёв без кристаллов и счесть это обманом).
  // Прогноз этой выдачи показывает Results (reward.gems) по тому же счётчику — сходится.
  if (premTank) {
    profile.premTankBattles = (profile.premTankBattles || 0) + 1
    if (profile.premTankBattles % PREM_TANK.gemEvery === 0) {
      addRewards(0, PREM_TANK.gems)
      track('prem_tank_gem_drop', { tank_id: profile.selectedTank, gems: PREM_TANK.gems, prem_tank_battles: profile.premTankBattles })
    }
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
    blockedDmg: reward.blockedDmg, // медаль «wall» считает спасённый бронёй УРОН (need:2000), не число снарядов
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
  cameFromBattle.value = true // вернулся из боя → показать баннер фидбека (на эмоциях)
  screen.value = 'hangar'
  maybeShowDaily() // после первого боя (battles>0) дейлик всплывает здесь, а не на входе
  maybeAskPush() // только что сыграл первый бой → просим разрешение на пуши (один раз)
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
  <Hangar v-if="screen === 'hangar'" :post-battle="cameFromBattle" @play="play" @go="go" />
  <Tree v-else-if="screen === 'tree'" @go="go" />
  <Crew v-else-if="screen === 'crew'" @go="go" />
  <Shop v-else-if="screen === 'shop'" @go="go" />
  <Rating v-else-if="screen === 'rating'" @go="go" />
  <Matchmaking v-else-if="screen === 'matchmaking'" :map-id="draw.mapId" :side="draw.side" :training="training" @battle="deploy" @cancel="cancelMatchmaking" />
  <Battle v-else-if="screen === 'battle'" :key="battleKey" :loadout="loadout" :map-id="draw.mapId" :side="draw.side" :mode="profile.battleMode" :net="netMatch" :training="!!netMatch && !!netMatch.training" @exit="exitBattle" @rematch="rematch" />

  <DailyReward v-if="daily && screen !== 'battle'" @close="daily = false" />

  <!-- «Подарок от администрации» — когда применилась админ-выдача (pendingGrants).
       Для веб-юзеров, кому бот не может написать, это единственный способ узнать. -->
  <Teleport to="body">
    <transition name="boot-fade">
      <div v-if="grantReveal && screen !== 'battle'" class="gift-ovl" @click.self="grantReveal = null">
        <div class="gift-card pz-plate">
          <div class="gift-emo">🎁</div>
          <div class="pz-display gift-ttl">{{ t('common.adminGiftTitle') }}</div>
          <div class="gift-rows">
            <div v-if="grantReveal.credits" class="pz-display gift-row">+{{ grantReveal.credits.toLocaleString('ru-RU') }} 🪙</div>
            <div v-if="grantReveal.tokens" class="pz-display gift-row">+{{ grantReveal.tokens }} 💎</div>
            <div v-for="tk in grantReveal.tanks || []" :key="tk" class="pz-display gift-row" style="color: var(--green)">{{ t('common.adminGiftTank') }} {{ tk.toUpperCase() }}</div>
          </div>
          <button class="pz-cta" style="width: 100%" @click="grantReveal = null">{{ t('common.adminGiftClaim') }}</button>
        </div>
      </div>
    </transition>
  </Teleport>

  <!-- подарок «выбери второй танк» (тир-2) — один раз после первого боя, перед туром -->
  <SecondTankChoice v-if="showTankChoice" @pick="pickSecondTank" />

  <!-- тур по ангару = «добро пожаловать»: после первого боя и выбора второго танка -->
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
.gift-ovl {
  position: fixed;
  inset: 0;
  z-index: 300; /* выше всего: дейлик/туториал/нав */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.66);
}
.gift-card {
  width: 100%;
  max-width: 300px;
  text-align: center;
  padding: 24px 22px;
  border: 1px solid var(--amber);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 14px 50px rgba(0, 0, 0, 0.55);
}
.gift-emo {
  font-size: 46px;
  line-height: 1;
}
.gift-ttl {
  font-size: 17px;
  color: var(--amber);
  margin-top: 10px;
  letter-spacing: 0.04em;
}
.gift-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0;
}
.gift-row {
  font-size: 19px;
}
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
