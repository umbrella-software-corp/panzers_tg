<script setup>
import { ref, computed, onMounted, watch, markRaw } from 'vue'
import { setBackButton, startParam, tgUserId, requestWriteAccess, tgConfirm, openSupport } from './tg.js'
import { apiReferred, apiPushAllow } from './api.js'
import Hangar from './components/Hangar.vue'
import Tree from './components/Tree.vue'
import Crew from './components/Crew.vue'
import Shop from './components/Shop.vue'
import Rating from './components/Rating.vue'
import Matchmaking from './components/Matchmaking.vue'
import Battle from './components/Battle.vue'
import DailyReward from './components/DailyReward.vue'
import ChannelSheet from './components/ChannelSheet.vue'
import Onboarding from './components/Onboarding.vue'
import SecondTankChoice from './components/SecondTankChoice.vue'
import { profile, party, addRewards, bankBattleXp, bankTaskProgress, bankMedals, loadoutStats, dailyAvailable, bootSync, applyTgName, isPremium, PREMIUM_BONUS, loadConfig, setPartyToken, setBattleMode, grantFreeTank, grantReveal, econOn, applyPendingGrants, serverConfig, claimPushBonus } from './store.js'
import { randomMap } from './game/maps.js'
import { TANK_BY_ID, PREM_TANK } from './game/meta.js'
import { preloadCritical, preloadRest } from './game/preload.js'
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
const channelPopup = ref(false) // окно «подпишись на канал → собирай взвод → бонус» после 2-3 боя
const booting = ref(true) // стартовый сплэш-лоадер (БЕТА) — держим, пока тянем профиль
const bootProgress = ref(0) // прогресс прогрева критичных ассетов 0..1 (бар на сплэше)

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
  setTimeout(finishBoot, 6000) // предохранитель: не зависаем на сплэше при медленной сети
  // ПРОГРЕВ АССЕТОВ: сплэш больше не крутится вхолостую — параллельно с синком тянем
  // критичные спрайты (ангар) в кэш и показываем прогресс баром. Остальное (бой/карты/
  // фоны) догреваем фоном после сплэша — к «В БОЙ» уже готово (см. game/preload.js).
  const crit = preloadCritical(profile, (p) => (bootProgress.value = p))
  await bootSync() // синк + фоновый ретрай; пока не синканёмся — на сервер НЕ пишем (анти-клоббер)
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
  // разрешение боту на пуши. Если есть ежедневная награда — НЕ просим на входе: спросим в
  // высокоинтентный момент её забора (onDailyClaimed), иначе — на входе как раньше.
  if (!daily.value) offerPushBonus('boot')
  // ДЕРЖИМ сплэш, пока реально не прогреты визуалы первого экрана (фон ангара + спрайты
  // твоих танков) — иначе юзер ловит «полусобранный» ангар. Предохранитель 6с (выше)
  // страхует от зависания на флейки-сети; preloadCritical всегда резолвится (ошибки глушит).
  await crit.catch(() => {})
  preloadRest(profile) // остальное (бой/карты/фоны) — в фоне, не блокирует уход со сплэша
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

// ВКЛЮЧИ УВЕДОМЛЕНИЯ → БОНУС: большинство открывают Mini-App по ссылке и НЕ жмут /start,
// поэтому бот не может им писать (рассылка возврата уходит «в 0», ~94% недосягаемы).
// Перегоняем в «доступные» через requestWriteAccess + морковку: сначала свой текст с
// выгодой (нативный confirm), потом нативный запрос доступа, при согласии сервер
// верифицирует доступ реальной отправкой и начисляет жетоны. Спрашиваем максимум раз
// за сессию, только после тренировки (не в лоб новичку), и не нудим забравшему.
const PUSH_PROMPT_KEY = 'pz.pushPrompt'
let pushOffered = false
// reason: 'boot' (на входе) | 'daily' (после забора ежедневной награды — высокоинтентный
// момент: уведомления = «не пропусти завтрашнюю награду/серию» → выше согласие = выше охват).
async function offerPushBonus(reason = 'boot') {
  if (profile.pushBonusClaimed || pushOffered || !tgUserId() || !profile.trainingDone) return
  // НЕ чаще раза в 5 дней (а не каждый заход) — кто отказался, того не нудим (маркер в
  // localStorage переживает перезапуск; pushOffered один — сессионный, сбрасывался каждый раз)
  try {
    if (Date.now() - +(localStorage.getItem(PUSH_PROMPT_KEY) || 0) < 5 * 86400000) return
  } catch { return }
  pushOffered = true
  try { localStorage.setItem(PUSH_PROMPT_KEY, String(Date.now())) } catch {}
  const n = serverConfig.pushBonusTokens || 25
  track('push_bonus_offered', { tokens: n, reason })
  const msg = reason === 'daily'
    ? `🔔 Напоминать про ежедневную награду и серию, чтобы не сгорела? Включи уведомления.\n\nБонус за включение: +${n} 💎`
    : `🔔 Включи уведомления — не пропусти награды и события.\n\nБонус за включение: +${n} 💎`
  const wants = await tgConfirm(msg)
  if (!wants) { track('push_bonus_declined', { stage: 'confirm' }); return }
  const ok = await requestWriteAccess()
  track('push_access_result', { granted: !!ok })
  if (!ok) { track('push_bonus_declined', { stage: 'access' }); return }
  const granted = await claimPushBonus() // сервер верифицирует доступ + начислит жетоны
  if (granted && granted.tokens) track('push_bonus_claimed', { tokens: granted.tokens })
}
// забрал ежедневную награду → высокоинтентный момент попросить вкл. уведомлений (охват
// пушей): пауза, чтобы прошла анимация «получено» и модалка закрылась (~1.1с), потом ask.
function onDailyClaimed() {
  setTimeout(() => offerPushBonus('daily'), 1400)
}

// ПРИЗЫВ ПОДЕЛИТЬСЯ МНЕНИЕМ → саппорт-бот (свободный текст падает в группу «Panzers
// Support», там читаем мнение игроков). Раз в 3 дня на устройство, только вовлечённым
// (≥3 боёв) и НЕ поверх дейлика/пуш-промпта — чтобы не нудить.
const FB_PROMPT_KEY = 'pz.fbPrompt'
let fbOffered = false
async function offerFeedback() {
  if (fbOffered || pushOffered || daily.value || !tgUserId() || (profile.stats?.battles || 0) < 3) return
  try {
    if (Date.now() - +(localStorage.getItem(FB_PROMPT_KEY) || 0) < 3 * 86400000) return // не чаще раза в 3 дня
  } catch { return }
  fbOffered = true
  try { localStorage.setItem(FB_PROMPT_KEY, String(Date.now())) } catch {}
  track('feedback_nudge_shown', {})
  const yes = await tgConfirm('💬 Нам важно твоё мнение! Что нравится, что бесит, что улучшить — напиши нам пару слов.')
  if (yes) { track('feedback_nudge_accepted', {}); openSupport() }
}

// ПОДПИШИСЬ НА КАНАЛ → СОБИРАЙ ВЗВОД → бонус: окно после 2-го и (если не забрал) 3-го
// боя — момент, когда игрок уже втянулся. Переехало из постоянного баннера ангара в
// разовый попап. Фича гейтится сервером (CHANNEL_ID) и снимается при заборе бонуса.
// Не поверх ежедневной награды (другой оверлей) — ей уступаем, словим на след. бою.
function offerChannel() {
  const n = profile.stats?.battles || 0
  if (!serverConfig.channel.on || profile.channelBonusClaimed) return
  if (n !== 2 && n !== 3) return
  if (daily.value) return
  track('channel_popup_shown', { battles: n })
  channelPopup.value = true
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
  rewardBanked = false // новый бой — снимаем гард начисления награды
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
    blockedDmg: reward.blockedDmg, // спасённый бронёй урон (задача armor2000)
    survived: reward.survived ? 1 : 0, // дожил до конца боя (задача survive2)
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
  // АВТОРИТЕТНАЯ ЭКОНОМИКА: деньги начислил СЕРВЕР на match-end (см. economy.grantBattle) —
  // выше addRewards/медали/звания были no-op. Тянем серверный грант в баланс. Грант
  // fire-and-forget с сервера, мог не успеть → повторяем чуть позже (очередь на сервере
  // идемпотентна, второй applyPendingGrants безопасен).
  if (econOn()) {
    applyPendingGrants()
    setTimeout(() => applyPendingGrants(), 1500)
  }
}
// награда боя начисляется ОДИН раз: либо на конце боя (Battle @ended — даже если игрок
// закрыл апп на итогах), либо по тапу выход/реванш (фолбэк). Гард от двойного начисления.
let rewardBanked = false
function bankOnce(reward) {
  if (rewardBanked) return
  rewardBanked = true
  bankBattle(reward)
}
function onBattleEnded(reward) {
  bankOnce(reward) // бой закончился → начисляем СРАЗУ, не дожидаясь тапа
}
function exitBattle(reward) {
  bankOnce(reward)
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
  offerChannel() // после 2-3 боя → «подпишись на канал, собирай взвод» (если фича вкл, бонус не забран)
  offerPushBonus() // после боя/тренировки первый бой → просим разрешение на пуши (один раз)
  offerFeedback() // изредка (раз в 3 дня, вовлечённым) — «напиши нам мнение» → саппорт
}
function rematch(reward) {
  track('rematch_clicked', {
    result: reward?.victory ? 'victory' : null,
    damage: reward?.damage || 0,
    kills: reward?.kills || 0,
    survived: !!reward?.survived,
  })
  bankOnce(reward)
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
  <Battle v-else-if="screen === 'battle'" :key="battleKey" :loadout="loadout" :map-id="draw.mapId" :side="draw.side" :mode="profile.battleMode" :net="netMatch" :training="!!netMatch && !!netMatch.training" @exit="exitBattle" @rematch="rematch" @ended="onBattleEnded" />

  <DailyReward v-if="daily && screen !== 'battle'" @close="daily = false" @claimed="onDailyClaimed" />

  <!-- «Подпишись на канал → собирай взвод → бонус» — попап после 2-3 боя (см. offerChannel) -->
  <ChannelSheet v-if="channelPopup && screen !== 'battle'" @close="channelPopup = false" />

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
        <div class="boot-bar"><b :style="{ width: Math.round(bootProgress * 100) + '%' }"></b></div>
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
.boot-bar {
  margin-top: 18px;
  width: 168px;
  height: 4px;
  border-radius: 3px;
  background: rgba(242, 165, 12, 0.16);
  overflow: hidden;
}
.boot-bar b {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--amber);
  transition: width 0.2s ease;
}
.boot-sub {
  margin-top: 14px;
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
