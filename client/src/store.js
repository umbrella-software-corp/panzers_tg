// Профиль игрока (модель дизайн-прототипа): нация, валюты (кредиты+жетоны),
// купленные танки, выбор, модули {tankId:{slot:level 1..3}}, взвод.
// Реактивный, сохраняется в localStorage.
import { reactive, watch, ref } from 'vue'
import { apiLoadProfile, apiSaveProfile, apiSaveProfileFlush, apiConfig, apiGrantsApply, apiDailyBonus, apiBuyTank, apiSellTank, apiSpendFreeXp, apiUpgradeModule, apiUpgradeCrew, apiBuyCamo, apiBuySkin, apiBuyGoldAmmo, apiSpendGoldAmmo, apiBuyCrate, apiClaimTask, apiClaimRef, apiPushBonus } from './api.js'
import { tgUser, tgUserId } from './tg.js'
import { t } from './i18n.js'

// серверный конфиг (флаги админки: турниры вкл/выкл; бонус за подписку на канал)
export const serverConfig = reactive({ tournaments: false, channel: { on: false, url: '', credits: 0, tokens: 0 }, feedback: { on: false, tokens: 0, credits: 0 }, econAuthority: false, pushBonusTokens: 25 })

// серверно-авторитетная экономика включена? Тогда деньги/танки/модули ведёт СЕРВЕР:
// покупки идут через эндпоинты, награды за бой приходят в pendingGrants, локальные
// начисления (addRewards) — no-op. Флаг приходит из /api/config (admin-тоггл).
export const econOn = () => serverConfig.econAuthority
// принять авторитетный кошелёк/инвентарь из ответа сервера (после покупки/клейма)
function adoptWallet(r) {
  if (!r) return
  if (typeof r.credits === 'number') profile.credits = r.credits
  if (typeof r.tokens === 'number') profile.tokens = r.tokens
  if (typeof r.goldAmmo === 'number') profile.goldAmmo = r.goldAmmo
  if (Array.isArray(r.owned)) profile.owned = r.owned
  if (r.modules && typeof r.modules === 'object') profile.modules = r.modules
  if (r.crew && typeof r.crew === 'object') profile.crew = r.crew
  if (r.branchXp && typeof r.branchXp === 'object') profile.branchXp = r.branchXp // опыт ветки — серверный
  if (typeof r.freeXp === 'number') profile.freeXp = r.freeXp // свободный опыт — серверный
  if (Array.isArray(r.camoOwned)) profile.camoOwned = r.camoOwned
  if (Array.isArray(r.skins)) profile.skins = r.skins
  if (r.camos && typeof r.camos === 'object') profile.camos = r.camos
}

// взвод текущего сеанса (НЕ персистится): token — id командира взвода. Друзья,
// открывшие твою sq-ссылку, ищут бой с тем же token и попадают в одну комнату.
export const party = reactive({ token: null, leader: false })
export function setPartyToken(token, leader = false) {
  party.token = token ? String(token) : null
  party.leader = !!leader
}
export function clearParty() {
  party.token = null
  party.leader = false
}
// режим боя (персистится в профиле): 'capture' — захват точек, 'annihilation' —
// бой до последнего танка. Меняется в ангаре, едет в матчмейкинг и движок.
export function setBattleMode(mode) {
  profile.battleMode = mode === 'annihilation' ? 'annihilation' : 'capture'
}
// схема управления задним ходом (персистится в профиле, читается в Battle.vue →
// NetGame.invertReverseSteer): 'direct' — без инверсии (ДЕФОЛТ): руль одинаков на
// переднем/заднем ходу, налево = перёд влево; 'follow' — руль инвертируется на реверсе,
// корма идёт по джойстику (по тикету @anch_max). Дефолт сменён на 'direct' (#28 «крутится
// сам»); кто привык к инверсии — включает 'follow' тумблером.
export function setReverseSteer(mode) {
  profile.reverseSteer = mode === 'direct' ? 'direct' : 'follow'
}
// VERSION-GATE (#23 «у меня старая экономика/версия»): сервер на НОВОМ билде, а у нас
// вкомпилен СТАРЫЙ __BUILD_ID__ (залип бандл в кэше Telegram/браузера) → разово
// перезагружаемся за свежим. Зовётся на бутстрапе (loadConfig в App.vue) — не в бою,
// работа не теряется. Анти-цикл: помним buildId, для которого уже релоадили (если релоад
// не вытащил новый бандл из кэша — второй раз не дёргаем, пробуем в след. сессии).
function maybeReloadForNewBuild(serverBuildId) {
  if (!serverBuildId || typeof __BUILD_ID__ === 'undefined') return
  if (serverBuildId === __BUILD_ID__) return
  let already = null
  try { already = sessionStorage.getItem('pz_reloaded_for') } catch { /* приватный режим */ }
  if (already === serverBuildId) return
  try { sessionStorage.setItem('pz_reloaded_for', serverBuildId) } catch { /* приватный режим */ }
  try { location.reload() } catch { /* нет window — ок */ }
}
export async function loadConfig() {
  try {
    const c = await apiConfig()
    serverConfig.tournaments = !!c.tournaments
    if (c.channel) serverConfig.channel = c.channel
    if (c.feedback) serverConfig.feedback = c.feedback
    serverConfig.econAuthority = !!c.econAuthority
    if (typeof c.pushBonusTokens === 'number') serverConfig.pushBonusTokens = c.pushBonusTokens
    maybeReloadForNewBuild(c.buildId)
  } catch {
    /* офлайн — оставляем дефолт */
  }
}
import {
  TANK_BY_ID,
  STARTERS,
  NATIONS,
  FREE_XP_SHARE,
  CREW_XP_SHARE,
  nationOf,
  tanksOfNation,
  MODULE_DEFS,
  MODULE_COMBAT,
  moduleCost,
  tankResearchXp,
  modLevel,
  modsMaxedCount,
  REF_MILESTONES,
  SKINS,
  SKIN_BY_ID,
  combatStats,
  RATING_START,
  RATING_DELTA,
  GOLD_AMMO_PACKS,
  CREW_MEMBERS,
  CREW_PERK_MAX,
  crewPerkCost,
  tasksOfDay,
  TASKS_ALL_BONUS,
  MEDALS,
  MEDAL_BY_ID,
  RANKS,
  rankByBattles,
  CAMOS,
  CAMO_BY_ID,
  expectedBattle,
  battleScore,
} from './game/meta.js'

// ключ кеша — ПЕР-АККАУНТ (по tg-id): иначе на одном устройстве два Telegram-аккаунта
// делят один localStorage, и второй акк подтягивает профиль первого («он уже был»,
// первый заход/тренировка не срабатывают). Сервер всё равно авторитетен (syncProfile),
// кеш — лишь для мгновенного старта. Гость/вне Telegram (нет id) → базовый ключ.
const KEY = (() => {
  let id = null
  try {
    id = tgUserId()
  } catch {
    /* нет Telegram — dev/браузер */
  }
  return 'pz.state.v1' + (id ? '.' + id : '')
})()

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    if (s && Array.isArray(s.owned)) return s
  } catch {
    /* нет/битый профиль */
  }
  return null
}

export const profile = reactive(
  load() || {
    nation: 'ussr',
    selectedTank: 't26',
    credits: 500,
    tokens: 10,
    goldAmmo: 5,
    premTankBattles: 0, // счётчик боёв на премиум-танках (каждый 10-й → кристаллы)
    owned: [...STARTERS],
    modules: {}, // { tankId: { gun:1..3, tur, eng, trk, rad } }
    party: [],
  },
)
// миграции/страховки
if (!profile.modules || typeof profile.modules !== 'object') profile.modules = {}
if (profile.clanId === undefined) profile.clanId = null // членство в клане (ведёт сервер)
if (profile.clanTag === undefined) profile.clanTag = null
if (!Array.isArray(profile.party)) profile.party = []
if (!Array.isArray(profile.referrals)) profile.referrals = []
if (!Array.isArray(profile.claimedRef)) profile.claimedRef = []
if (typeof profile.goldAmmo !== 'number') profile.goldAmmo = 5
if (!profile.stats || typeof profile.stats !== 'object')
  profile.stats = { battles: 0, wins: 0, kills: 0, rating: RATING_START }
// статы ПО КАЖДОМУ танку: { tankId: { battles, wins, kills } }. Копятся с обновления
// (легаси-игрокам не реконструируем — растёт от боёв вперёд). Показываются в ангаре.
if (!profile.tankStats || typeof profile.tankStats !== 'object') profile.tankStats = {}
// агрегаты боевого рейтинга (урон/фраги факт + ожидаемые). У существующих игроков
// сидим из доступной истории боёв (танк берём текущий — приблизительно), новым — 0.
if (typeof profile.stats.sumDmg !== 'number') {
  const s = profile.stats
  const hist = Array.isArray(profile.history) ? profile.history : []
  s.sumDmg = hist.reduce((a, h) => a + (h.damage || 0), 0)
  s.sumFrag = hist.reduce((a, h) => a + (h.kills || 0), 0)
  const t = TANK_BY_ID[profile.selectedTank] || TANK_BY_ID[STARTERS[0]] || TANK_BY_ID.t26
  const e = expectedBattle(t)
  const n = Math.max(hist.length, 1)
  s.expDmg = (e.dmg || 1) * n
  s.expFrag = (e.frag || 1) * n
  s.wn8 = battleScore(s)
}
// засвет в рейтинг (добавлен позже) — досидим агрегат тем, у кого его нет ещё.
// Ретроспективно засвет не восстановить (в истории его нет) → стартуем с 0 факта,
// ожидаемое по числу боёв; дальше копится точно из боя.
if (typeof profile.stats.expSpot !== 'number') {
  const s = profile.stats
  s.sumSpot = s.sumSpot || 0
  const t = TANK_BY_ID[profile.selectedTank] || TANK_BY_ID.t26
  s.expSpot = (expectedBattle(t).spot || 1) * Math.max(s.battles || 0, 1)
  s.wn8 = battleScore(s)
}
if (!profile.daily || typeof profile.daily !== 'object') profile.daily = { last: '', streak: 0 }
if (!Array.isArray(profile.history)) profile.history = [] // последние бои
if (!profile.crew || typeof profile.crew !== 'object') profile.crew = { xp: 0 } // экипаж один на все танки
if (!profile.crew.skills || typeof profile.crew.skills !== 'object') profile.crew.skills = {} // перки специалистов { memberId: 0..3 }
if (!profile.branchXp || typeof profile.branchXp !== 'object') profile.branchXp = {} // опыт по веткам наций
if (typeof profile.freeXp !== 'number') profile.freeXp = 0 // свободный опыт (вкладывается в любую нацию)
if (!profile.medals || typeof profile.medals !== 'object') profile.medals = {} // { medalId: счётчик получений }
if (!profile.camos || typeof profile.camos !== 'object') profile.camos = {} // { tankId: camoId } — надетый камуфляж
if (!Array.isArray(profile.camoOwned)) {
  profile.camoOwned = [] // купленные камо: ['tankId_camoId', ...]
  // грандфазер: уже надетые камо (из бесплатной эпохи) — считаем купленными
  for (const [tid, cid] of Object.entries(profile.camos)) if (cid) profile.camoOwned.push(`${tid}_${cid}`)
}
// звание: rankClaimed — индекс последнего выданного звания. Существующим игрокам
// ставим текущее (без задним числом награды за все ступени сразу), новым — 0.
if (typeof profile.rankClaimed !== 'number') profile.rankClaimed = rankByBattles((profile.stats || {}).battles || 0).index
if (typeof profile.name !== 'string' || !profile.name) profile.name = t('game.defaultName')
if (typeof profile.nameCustom !== 'boolean') profile.nameCustom = false // имя сменено платно (за звёзды)
if (!Array.isArray(profile.skins)) profile.skins = ['std'] // купленные камуфляжи
if (!profile.tasks || typeof profile.tasks !== 'object') profile.tasks = { date: '', progress: {}, claimed: [] } // задачи дня
if (typeof profile.skin !== 'string') profile.skin = 'std'
if (typeof profile.premiumUntil !== 'number') profile.premiumUntil = 0 // премиум активен, пока > Date.now()
if (profile.battleMode !== 'annihilation') profile.battleMode = 'capture' // режим боя: захват точек / на уничтожение
// схема заднего хода. Дефолт 'direct' — руль НЕ инвертируется (налево = перёд влево всегда,
// интуитивно). Прежний дефолт 'follow' (инверсия на реверсе) путал (#28: «налево — танк
// направо, крутится сам»). РАЗОВАЯ миграция всех на 'direct' (флаг reverseSteerV2); тумблер
// оставлен — кто хочет инверсию (@anch_max), включит, и выбор сохранится после миграции.
if (!profile.reverseSteerV2) { profile.reverseSteer = 'direct'; profile.reverseSteerV2 = true }
else if (profile.reverseSteer !== 'follow' && profile.reverseSteer !== 'direct') profile.reverseSteer = 'direct'
// тур по ангару показываем один раз самому новому игроку; уже игравшим — нет
if (typeof profile.onboarded !== 'boolean') profile.onboarded = (profile.stats?.battles || 0) > 0
// тренировочный первый бой (соло + замороженные боты, гайд «едь/целься/стреляй»)
// проходим один раз самому первому запуску; уже игравшим — считаем пройденным
if (typeof profile.trainingDone !== 'boolean') profile.trainingDone = (profile.stats?.battles || 0) > 0
// подарок «выбери второй танк» (тир-2) после первого боя — один раз самому новому
if (typeof profile.secondTankChosen !== 'boolean') profile.secondTankChosen = (profile.stats?.battles || 0) > 0
// бонус за первый бой выдаём только новичку; у кого уже есть бои — считаем выданным
if (typeof profile.firstBattleRewarded !== 'boolean') profile.firstBattleRewarded = (profile.stats?.battles || 0) > 0
// разрешение боту на пуши (requestWriteAccess) спрашиваем ОДИН раз — иначе бот не
// может писать вебапп-юзерам (Telegram: нельзя инициировать чат без /start)
if (typeof profile.pushAsked !== 'boolean') profile.pushAsked = false
if (typeof profile.pushBonusClaimed !== 'boolean') profile.pushBonusClaimed = false // бонус за включение уведомлений (разовый, серверный)
if (typeof profile.used3D !== 'boolean') profile.used3D = false // включал 3D-режим хоть раз (метрика эксперимента)

// имя по умолчанию — ник из Telegram; платное (за звёзды) имя не трогаем
applyTgName()

// КРИТИЧНО против «прогресс пропал»: на сервер НЕ пишем, пока хоть раз НЕ синканулись
// успешно (serverSynced). Иначе на свежем устройстве / после чистки кэша профиль
// стартует с ДЕФОЛТОВ (500 кредитов, стартовые танки), и если первый syncProfile()
// упал (флейки-сеть Telegram, таймаут, заморозка webview) — дебаунс-сейв и flush
// POST-ят эти дефолты, а сервер (index.js merge) берёт credits/owned/modules ИЗ ТЕЛА
// → настоящий прогресс затирается дефолтами НАВСЕГДА. localStorage пишем всегда (он
// пер-аккаунт и безопасен), а пуш на сервер гейтим успешным синком.
export const serverSynced = ref(false)

// ОФФ-интервал (флаг econAuthority ВЫКЛ): защита от потери прогресса на мобиле, когда
// сейв не доехал до сервера (Telegram убил webview), а на реоткрытии серверный (старый)
// профиль затирал локальный. Храним версию серверной записи (_updatedAt) + метку «есть
// несохранённые правки» (dirty). На реоткрытии (syncProfile): если сервер НЕ продвинулся
// дальше известной нам версии, а локально были несохранённые правки → приоритет ЛОКАЛЬНОМУ
// (не затираем). Если сервер продвинулся (другое устройство/админ-выдача) → берём серверный
// (мульти-девайс безопасен). Под авторитетностью (ON) — выключено: источник правды сервер.
const DIRTY_KEY = KEY + '.dirty'
const SRVAT_KEY = KEY + '.srvAt'
const lcGet = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const lcSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* приватный режим */ } }
const bootDirty = lcGet(DIRTY_KEY) === '1' // были несохранённые правки в прошлой сессии?
const bootSrvAt = +lcGet(SRVAT_KEY) || 0 // последняя известная версия серверной записи
let dirtyRev = 0 // ++ на каждое изменение профиля — точное снятие dirty после сейва
const clearDirtyIf = (rev) => { if (dirtyRev === rev) lcSet(DIRTY_KEY, '0') }
const rememberSrvAt = (at) => { if (at) lcSet(SRVAT_KEY, String(at)) }
// поля «локального прогресса» — их при preferLocal возвращаем поверх старого серверного.
// НЕ включаем серверно-ведомые (referrals/premiumUntil/daily/tasks/pendingGrants/srv*).
const ECON_FIELDS = ['credits', 'tokens', 'goldAmmo', 'owned', 'modules', 'crew', 'branchXp', 'freeXp', 'stats', 'tankStats', 'medals', 'camos', 'camoOwned', 'skins', 'skin', 'premTankBattles', 'rankClaimed', 'claimedRef']

// локальный кеш — мгновенно; на сервер — с дебаунсом (офлайн не мешает игре)
let pushTimer = null
watch(
  profile,
  () => {
    localStorage.setItem(KEY, JSON.stringify(profile))
    dirtyRev++
    lcSet(DIRTY_KEY, '1') // есть локальные правки, ещё не подтверждённые сервером
    if (!serverSynced.value) return // ещё не знаем серверный базис — не затираем его дефолтами
    clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      const rev = dirtyRev
      apiSaveProfile(JSON.parse(JSON.stringify(profile))).then((r) => { if (r && r.ok) { clearDirtyIf(rev); rememberSrvAt(r.updatedAt) } }).catch(() => {})
    }, 1500)
  },
  { deep: true },
)

// КРИТИЧНО против потери прогресса: при сворачивании/закрытии мини-аппа дебаунс-сейв
// (1.5с) Telegram убивает вместе с вебвью — последние правки (прокачка ветки, трата
// кредитов) не доезжают до сервера, и на реоткрытии syncProfile затирает свежий
// localStorage СТАРЫМ серверным профилем → «прогресс пропал». Поэтому на hidden/pagehide
// флашим немедленно с keepalive (переживает выгрузку).
export function flushProfile() {
  clearTimeout(pushTimer)
  const snap = JSON.parse(JSON.stringify(profile))
  try { localStorage.setItem(KEY, JSON.stringify(snap)) } catch { /* приватный режим */ }
  if (!serverSynced.value) return // не синканулись — на сервер не пишем (см. serverSynced выше)
  const rev = dirtyRev
  // на success снимаем dirty + помним версию; на выгрузке .then может не успеть —
  // тогда dirty остаётся, и на реоткрытии локальный прогресс будет предпочтён (безопасно).
  apiSaveProfileFlush(snap).then((r) => { if (r && r.ok) { clearDirtyIf(rev); rememberSrvAt(r.updatedAt) } })
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProfile()
  })
  window.addEventListener('pagehide', flushProfile)
}

// загрузка с сервера при старте: серверный профиль главнее; нет его —
// мигрируем туда локальный (первый вход со старым прогрессом)
// забрать админ-выдачи из очереди pendingGrants. Начисляет их СЕРВЕР атомарно
// (/api/grants-apply: кредиты/жетоны/танки + очистка очереди в одном сейве), мы лишь
// принимаем авторитетный результат. Так нет ни двойного начисления, ни потери при
// обрыве. Премиум сюда не входит — он приходит готовым в premiumUntil.
// окно «🎁 Подарок от администрации» — показываем в ангаре, когда выдача применилась
// (App.vue следит за grantReveal). Для веб-юзеров, кому бот не может написать, это
// единственный способ узнать о подарке.
export const grantReveal = ref(null)
export async function applyPendingGrants() {
  const pend = Array.isArray(profile.pendingGrants) ? profile.pendingGrants : []
  // Под авторитетностью награды за бой (кредиты/опыт) сервер кладёт в pendingGrants, о
  // которых клиент локально ещё НЕ знает → нельзя пропускать запрос по локальной длине
  // очереди, иначе награда за бой не подтянется. Под ON всегда спрашиваем сервер (на
  // пустой очереди он no-op). Под OFF — как было (без лишнего запроса).
  if (!econOn() && !pend.length) return
  try {
    const r = await apiGrantsApply()
    if (r && r.ok) {
      profile.credits = r.credits || 0
      profile.tokens = r.tokens || 0
      if (typeof r.goldAmmo === 'number') profile.goldAmmo = r.goldAmmo // золотые снаряды (награда дня)
      if (Array.isArray(r.owned)) profile.owned = r.owned
      if (econOn() && r.branchXp && typeof r.branchXp === 'object') profile.branchXp = r.branchXp // опыт ветки — серверный (под ON)
      if (econOn() && typeof r.freeXp === 'number') profile.freeXp = r.freeXp // свободный опыт — серверный (под ON)
      profile.pendingGrants = Array.isArray(r.pendingGrants) ? r.pendingGrants : []
      const g = r.got
      if (r.applied && g && (g.credits || g.tokens || (g.tanks && g.tanks.length))) grantReveal.value = g
    }
  } catch {
    /* не вышло — очередь на сервере цела, заберём на следующем синке */
  }
}

export async function syncProfile() {
  try {
    const res = await apiLoadProfile()
    if (res && res.profile) {
      const { _updatedAt, ...rest } = res.profile
      const srvAt = +_updatedAt || 0
      // ОФФ-интервал: локальный прогресс новее серверного? Да — если сервер НЕ продвинулся
      // дальше известной нам версии (bootSrvAt), а локально были несохранённые правки
      // (bootDirty). Тогда НЕ даём старому серверному профилю затереть локальный.
      const preferLocal = !econOn() && bootDirty && bootSrvAt > 0 && srvAt > 0 && srvAt <= bootSrvAt
      const localEcon = preferLocal ? JSON.parse(JSON.stringify(profile)) : null
      const localDaily = profile.daily // claim мог не успеть уехать на сервер до перезапуска
      const localTasks = profile.tasks // то же про ЗАДАЧИ ДНЯ — клейм мог не доехать
      const localSel = profile.selectedTank // выбранный танк — защищаем от отката (см. ниже)
      const localSelDirty = lcGet(DIRTY_KEY) === '1' // были несохранённые локальные правки?
      Object.assign(profile, rest)
      // НЕ даём СТАРОМУ серверному daily.last затереть свежий локальный: иначе после
      // claim'а (POST debounced) перезапуск мини-аппа воскрешал дейлик и давал пере-клейм
      // со взвинчиванием стрика. Даты YYYY-MM-DD сравниваются как строки = хронологически.
      if (localDaily && (localDaily.last || '') > ((profile.daily && profile.daily.last) || '')) profile.daily = localDaily
      // АНАЛОГИЧНО для задач дня: серверная копия tasks могла быть СТАРЕЕ свежего клейма
      // (POST дебаунсится 1.5с, Telegram рвёт вебвью раньше) → задача снова показывала
      // «ЗАБРАТЬ» и забиралась повторно (баг «забираю 8 раз в день»). Тот же день —
      // ОБЪЕДИНЯЕМ клеймы и берём max прогресса, чтобы ни одна устаревшая копия не
      // воскресила уже забранную задачу. Новее локальный день — берём его целиком.
      const srvTasks = profile.tasks
      if (localTasks && localTasks.date) {
        if (!srvTasks || !srvTasks.date || localTasks.date > srvTasks.date) {
          profile.tasks = localTasks
        } else if (localTasks.date === srvTasks.date) {
          const claimed = [...new Set([...(srvTasks.claimed || []), ...(localTasks.claimed || [])])]
          const progress = { ...(srvTasks.progress || {}) }
          for (const [k, v] of Object.entries(localTasks.progress || {})) progress[k] = Math.max(progress[k] || 0, v || 0)
          const metaClaimed = !!(srvTasks.metaClaimed || localTasks.metaClaimed) // не воскрешаем мета-бонус
          profile.tasks = { date: localTasks.date, progress, claimed, metaClaimed }
        }
      }
      // ЗАЩИТА ВЫБРАННОГО ТАНКА: свежий локальный выбор (есть несохранённые правки) НЕ
      // откатываем к старому серверному selectedTank. Иначе «выбрал Т26 — а в бой едет КВ1»:
      // сейв профиля дебаунсится 1.5с, и sync между пиком и сейвом затирал выбор сервером.
      // Берём локальный, если он валиден и СВОЙ; иначе серверный (свежее устройство → его танк).
      if (localSelDirty && localSel && TANK_BY_ID[localSel] && profile.owned.includes(localSel)) {
        profile.selectedTank = localSel
        profile.nation = nationOf(localSel)
      }
      // старые серверные профили без перков — дорастить форму
      if (!profile.crew.skills || typeof profile.crew.skills !== 'object') profile.crew.skills = {}
      // Онбординг-флаги выводим из СЕРВЕРНЫХ battles, если сервер их не прислал (легаси-
      // профиль). Иначе после пер-аккаунт ключа пустой локальный init дал бы false →
      // существующему игроку (battles>0) всплыл бы «выбери 2-й танк» и повторный бонус
      // за первый бой. Сервер прислал флаг — уважаем его как есть.
      const b = (profile.stats && profile.stats.battles) || 0
      if (!('onboarded' in rest)) profile.onboarded = b > 0
      if (!('trainingDone' in rest)) profile.trainingDone = b > 0
      if (!('secondTankChosen' in rest)) profile.secondTankChosen = b > 0
      if (!('firstBattleRewarded' in rest)) profile.firstBattleRewarded = b > 0
      // ОФФ-интервал: локальный прогресс новее → возвращаем его поверх старого серверного
      // и СРАЗУ пушим на сервер (ДО applyPendingGrants — иначе grants-apply наложит выдачу
      // на старый серверный баланс и затрёт восстановленный локальный).
      if (preferLocal && localEcon) {
        for (const f of ECON_FIELDS) if (f in localEcon) profile[f] = localEcon[f]
        try {
          const r = await apiSaveProfile(JSON.parse(JSON.stringify(profile)))
          if (r && r.ok) { clearDirtyIf(dirtyRev); rememberSrvAt(r.updatedAt) }
        } catch { /* офлайн — запушим обычным сейвом позже */ }
      } else {
        rememberSrvAt(srvAt) // приняли серверный — помним его версию
      }
      // серверный базис получен — теперь пуши на сервер безопасны (см. serverSynced)
      serverSynced.value = true
      await applyPendingGrants() // забрать админ-выдачи (кредиты/жетоны/танки) из очереди
    } else {
      // сервер ЯВНО вернул «профиля нет» (новый игрок) → мигрируем локальный вверх.
      // Это легитимный первый пуш, после него сервер авторитетен.
      const r = await apiSaveProfile(JSON.parse(JSON.stringify(profile)))
      if (r && r.ok) { clearDirtyIf(dirtyRev); rememberSrvAt(r.updatedAt) }
      serverSynced.value = true
    }
    return true
  } catch {
    return false // сервер недоступен — играем на локальном кеше, на сервер НЕ пишем
  }
}

// первый синк при старте + фоновый ретрай: пока он не прошёл, serverSynced=false и
// клиент НЕ пишет на сервер (чтобы дефолты свежего устройства не затёрли серверный
// прогресс). Если сеть вернётся — досинкаемся и пуши включатся сами.
let syncRetryTimer = null
export async function bootSync() {
  const ok = await syncProfile()
  if (!ok && !serverSynced.value) {
    clearTimeout(syncRetryTimer)
    const retry = async (attempt) => {
      if (serverSynced.value) return
      const done = await syncProfile()
      if (!done && !serverSynced.value && attempt < 6)
        syncRetryTimer = setTimeout(() => retry(attempt + 1), Math.min(30000, 2000 * 2 ** attempt))
    }
    syncRetryTimer = setTimeout(() => retry(0), 2000)
  }
  return ok
}

// забрать РАЗОВЫЙ бонус за включение уведомлений. Вызывать ПОСЛЕ успешного
// requestWriteAccess (caller). Сервер верифицирует доступ реальной отправкой и кладёт
// жетоны в pendingGrants; syncProfile подтягивает их + флаги. Возвращает { tokens } или null.
export async function claimPushBonus() {
  if (profile.pushBonusClaimed) return null
  const r = await apiPushBonus().catch(() => null)
  if (!r) return null
  if (r.already) { profile.pushBonusClaimed = true; return null }
  if (!r.ok) return null // 'not-granted' — доступа реально нет, НЕ помечаем (можно повторить)
  profile.pushBonusClaimed = true
  await syncProfile() // подтянуть начисленные жетоны + серверные флаги (pushBlocked снят)
  return r.granted || null
}

// ---------- танки ----------
export const isOwned = (id) => profile.owned.includes(id)
export const selectedTank = () => TANK_BY_ID[profile.selectedTank] || TANK_BY_ID[STARTERS[0]]

export function setNation(nation) {
  profile.nation = nation
  // выбрать первый танк нации, если текущий из другой ветки
  if (nationOf(profile.selectedTank) !== nation) {
    const first = Object.values(TANK_BY_ID).find((t) => nationOf(t.id) === nation && t.tier === 1)
    if (first) profile.selectedTank = first.id
  }
}

// выбор/просмотр танка в ангаре (можно смотреть и закрытые; бой гейтится isOwned)
export function selectTank(id) {
  if (TANK_BY_ID[id]) profile.selectedTank = id
}

// предыдущий по тиру танк в той же нации (для условия разблокировки)
export function prevTank(tank) {
  const nation = nationOf(tank.id)
  return Object.values(TANK_BY_ID).find((t) => nationOf(t.id) === nation && t.tier === tank.tier - 1)
}

// можно ли купить танк: предыдущий куплен и его топ-модули собраны 5/5
// опыт ветки этого танка (нации) и сколько нужно на исследование
export const branchXpOf = (tank) => (profile.branchXp || {})[nationOf(tank.id)] || 0
export const researchXpNeed = (tank) => tankResearchXp(tank.tier)
export const hasResearchXp = (tank) => branchXpOf(tank) >= researchXpNeed(tank)

// открыть = предыдущий куплен + его 5 модулей макс + опыт ветки ≥ стоимости исследования
export function canUnlock(tank) {
  if (isOwned(tank.id)) return false
  if (!hasResearchXp(tank)) return false
  const prev = prevTank(tank)
  if (!prev) return true // tier 1
  return isOwned(prev.id) && modsMaxedCount(profile.modules, prev.id) >= 5
}

export function unlockReason(tank) {
  const prev = prevTank(tank)
  if (prev && !isOwned(prev.id)) return t('game.unlock.research', { name: prev.name })
  if (prev && modsMaxedCount(profile.modules, prev.id) < 5)
    return t('game.unlock.modules', { name: prev.name, n: modsMaxedCount(profile.modules, prev.id) })
  if (!hasResearchXp(tank)) return t('game.unlock.xp', { have: Math.floor(branchXpOf(tank)).toLocaleString('ru-RU'), need: researchXpNeed(tank).toLocaleString('ru-RU') })
  return null
}

// «СЛЕДУЮЩАЯ ЦЕЛЬ» — краткосрочный хук удержания (чип в ангаре + строка в итогах боя):
// явный следующий шаг, который тянет «ещё бой». Приоритет: забрать задачи дня → открыть
// готовый к исследованию танк → копить опыт на след. танк → вложить свободный опыт.
// Возвращает {kind, ...} или null; текст собирает nextGoalText (локализованно).
export function nextGoal() {
  if (tasksClaimable() > 0) return { kind: 'tasks', n: tasksClaimable() }
  const next = tanksOfNation(nationOf(profile.selectedTank)).find((tk) => !isOwned(tk.id))
  if (next) {
    if (canUnlock(next)) return { kind: 'unlock', name: next.name }
    return { kind: 'research', name: next.name, left: Math.max(0, researchXpNeed(next) - Math.floor(branchXpOf(next))) }
  }
  if ((profile.freeXp || 0) >= 1) return { kind: 'freexp', n: Math.floor(profile.freeXp) }
  return null
}
export function nextGoalText(g) {
  if (!g) return ''
  if (g.kind === 'tasks') return t('hangar.goalTasks', { n: g.n })
  if (g.kind === 'unlock') return t('hangar.goalUnlock', { name: g.name })
  if (g.kind === 'research') return t('hangar.goalResearch', { name: g.name, n: g.left.toLocaleString('ru-RU') })
  if (g.kind === 'freexp') return t('hangar.goalFreeXp', { n: g.n.toLocaleString('ru-RU') })
  return ''
}

export async function buyTank(tank) {
  if (econOn()) {
    const r = await apiBuyTank(tank.id).catch(() => null)
    if (!r || !r.ok) return false
    adoptWallet(r)
    return true
  }
  if (!canUnlock(tank) || profile.credits < (tank.cost || 0)) return false
  profile.credits -= tank.cost || 0
  // списываем и опыт ветки (исследование), и кредиты (покупка)
  const nat = nationOf(tank.id)
  profile.branchXp[nat] = Math.max(0, (profile.branchXp[nat] || 0) - researchXpNeed(tank))
  profile.owned.push(tank.id)
  return true
}

// продажа танка (#26): возврат 50% кредитовой цены (стартер-тир1 = 0, только убрать).
// ЗЕРКАЛО shared canSellTank/tankSellPrice. Дерево не ломается: продаём только «позади
// фронтира» — в нации есть владеемый ВЫШЕ тиром, значит этот не нужен для исследования.
export const tankSellPrice = (tank) => Math.round(((tank && tank.cost) || 0) * 0.5)
export const canSell = (tank) => {
  if (!tank || !isOwned(tank.id) || tank.premium || tank.id === profile.selectedTank) return false
  const nat = nationOf(tank.id)
  return profile.owned.some((id) => id !== tank.id && nationOf(id) === nat && ((TANK_BY_ID[id] || {}).tier || 0) > tank.tier)
}
export async function sellTank(tank) {
  if (!canSell(tank)) return false
  if (econOn()) {
    const r = await apiSellTank(tank.id).catch(() => null)
    if (!r || !r.ok) return false
    adoptWallet(r)
    return true
  }
  profile.owned = profile.owned.filter((id) => id !== tank.id)
  profile.credits += tankSellPrice(tank)
  return true
}

// бесплатный подарок танка (онбординг: «выбери второй танк» после первого боя) —
// в ОБХОД обычного гейта (топ-модули прева 5/5 + кредиты). Добавляем во владение,
// делаем выбранным и переключаем нацию ангара на его ветку. Идемпотентна.
export function grantFreeTank(id) {
  const tank = TANK_BY_ID[id]
  if (!tank) return false
  if (!isOwned(id)) profile.owned.push(id)
  profile.selectedTank = id
  profile.nation = nationOf(id)
  profile.secondTankChosen = true
  return true
}

// ---------- модули ----------
export const tankModLevel = (tankId, modId) => modLevel(profile.modules, tankId, modId)

export async function upgradeModule(tankId, modId) {
  if (econOn()) {
    const r = await apiUpgradeModule(tankId, modId).catch(() => null)
    if (!r || !r.ok) return false
    adoptWallet(r)
    return true
  }
  const tank = TANK_BY_ID[tankId]
  const lvl = tankModLevel(tankId, modId)
  if (!tank || lvl >= 3) return false
  const cost = moduleCost(tank.tier, lvl + 1)
  if (profile.credits < cost) return false
  profile.credits -= cost
  if (!profile.modules[tankId]) profile.modules[tankId] = {}
  profile.modules[tankId][modId] = lvl + 1
  return true
}

// ---------- премиум-аккаунт (Stars): +15% к опыту экипажа/ветки и кредитам ----------
export const PREMIUM_BONUS = 0.15
export const isPremium = () => profile.premiumUntil > Date.now()
// сколько дней премиума осталось (для бейджа); 0 — нет
export const premiumDaysLeft = () => Math.max(0, Math.ceil((profile.premiumUntil - Date.now()) / 86400000))

// ---------- валюта ----------
export function addRewards(credits = 0, tokens = 0) {
  if (econOn()) return // СЕРВЕР — источник денег: локально не начисляем (придёт через
  // applyPendingGrants после боя / адопт кошелька после покупки). Этот гейт автоматически
  // обнуляет ВСЕ локальные начисления (награда за бой, звания, медали, первый бой).
  profile.credits += credits
  profile.tokens += tokens
}

export function spendTokens(n) {
  if (profile.tokens < n) return false
  profile.tokens -= n
  return true
}

// морковка за ПЕРВЫЙ ЗАКОНЧЕННЫЙ бой (главная утечка воронки — постреляли и слились).
// Обещаем в туре, выдаём один раз на экране итогов первого боя. Возвращает сумму
// бонуса (для показа), либо 0 если уже выдано.
export const FIRST_BATTLE_BONUS = 1000 // кредитов за первый завершённый бой
export function grantFirstBattleReward() {
  if (profile.firstBattleRewarded) return 0
  profile.firstBattleRewarded = true
  addRewards(FIRST_BATTLE_BONUS)
  return FIRST_BATTLE_BONUS
}

// ---------- боевые статы с учётом модулей (для Pixi-движка) ----------
// База — combatStats(танка): у каждой машины свой бой, модули сверху.
export function loadoutStats(tankId) {
  const tank = TANK_BY_ID[tankId] || TANK_BY_ID[STARTERS[0]]
  const base = combatStats(tank)
  base.damage *= MODULE_COMBAT.gun[tankModLevel(tank.id, 'gun') - 1]
  base.hp = Math.round(base.hp * MODULE_COMBAT.tur[tankModLevel(tank.id, 'tur') - 1])
  const eng = MODULE_COMBAT.eng[tankModLevel(tank.id, 'eng') - 1]
  base.maxSpeed *= eng
  base.accel *= eng
  base.turnRate *= MODULE_COMBAT.trk[tankModLevel(tank.id, 'trk') - 1]
  base.vision *= MODULE_COMBAT.rad[tankModLevel(tank.id, 'rad') - 1]
  // экипаж: +1% к темпу/обзору/ходу/манёвру за уровень после первого
  const ck = 1 + (crewLevel() - 1) * 0.01
  base.vision *= ck
  base.maxSpeed *= ck
  base.turnRate *= ck
  // перки специалистов: командир добавляет всего понемногу, остальные — своё
  const sk = profile.crew.skills || {}
  const cmd = 1 + (sk.cmd || 0) * 0.01
  base.damage *= 1 + (sk.gnr || 0) * 0.03
  base.reload = +(base.reload / (ck * cmd * (1 + (sk.lod || 0) * 0.03))).toFixed(2)
  const run = cmd * (1 + (sk.drv || 0) * 0.03)
  base.maxSpeed *= run
  base.accel *= run
  base.turnRate *= run
  base.vision *= cmd * (1 + (sk.rad || 0) * 0.04)
  return base
}

// ---------- экипаж: один на все танки, опыт из боёв, бафф к статам ----------
export const CREW_LEVEL_XP = 600 // опыта на уровень
// макс уровень = 16 → даёт 15 очков навыка (level−1), ровно на 5 спецов × 3 ранга (полная
// прокачка экипажа). Сверх макса крю-доля опыта боя льётся в свободный (см. bankBattleXp).
// ЗЕРКАЛО shared/economy.js CREW_MAX_LEVEL — менять В ОБОИХ местах.
export const CREW_MAX_LEVEL = 16

export const crewLevel = () =>
  Math.min(CREW_MAX_LEVEL, 1 + Math.floor(profile.crew.xp / CREW_LEVEL_XP))

// прогресс к следующему уровню 0..1 (на максимуме всегда 1)
export const crewProgress = () =>
  crewLevel() >= CREW_MAX_LEVEL ? 1 : (profile.crew.xp % CREW_LEVEL_XP) / CREW_LEVEL_XP

export function addCrewXp(xp) {
  profile.crew.xp += Math.max(0, Math.round(xp || 0))
}

// перки специалистов: ранг стоит 1 очко навыка + кредиты.
// Очки навыка даёт уровень экипажа: +1 за каждый уровень после первого.
export const crewPerkLevel = (id) => (profile.crew.skills || {})[id] || 0
export const crewPointsSpent = () => CREW_MEMBERS.reduce((s, m) => s + crewPerkLevel(m.id), 0)
export const crewPointsFree = () => Math.max(0, crewLevel() - 1 - crewPointsSpent())

export async function upgradeCrewPerk(id) {
  if (econOn()) {
    const r = await apiUpgradeCrew(id).catch(() => null)
    if (!r || !r.ok) return false
    adoptWallet(r)
    return true
  }
  const lvl = crewPerkLevel(id)
  if (!CREW_MEMBERS.some((m) => m.id === id) || lvl >= CREW_PERK_MAX) return false
  if (crewPointsFree() < 1) return false
  const cost = crewPerkCost(lvl)
  if (profile.credits < cost) return false
  profile.credits -= cost
  if (!profile.crew.skills || typeof profile.crew.skills !== 'object') profile.crew.skills = {}
  profile.crew.skills[id] = lvl + 1
  return true
}

// опыт ветки нации (копится с боёв на её танках)
export function addBranchXp(nation, xp) {
  if (econOn()) return // под авторитетностью опыт ветки начисляет СЕРВЕР (grantBattle) → клиент подтянет через applyPendingGrants
  profile.branchXp[nation] = (profile.branchXp[nation] || 0) + Math.max(0, Math.round(xp || 0))
}

// свободный опыт: исследовательская валюта, вкладывается в ЛЮБУЮ нацию (см. spendFreeXp).
// Под авторитетностью начисляет СЕРВЕР (grantBattle) → клиент подтянет; локально не копим.
export function addFreeXp(xp) {
  if (econOn()) return
  profile.freeXp = (profile.freeXp || 0) + Math.max(0, Math.round(xp || 0))
}

// сплит опыта боя: 10% в свободный опыт, остаток CREW_XP_SHARE экипажу, прочее в ветку.
// Экипаж на МАКСЕ — излишек крю-доли НЕ пропадает: конвертится в КРЕДИТЫ (xp×1.25, как
// silver) — фидбек #26 «экипаж фулл за 25 боёв, зато кредитов не хватает». ЗЕРКАЛО server.
export function bankBattleXp(xp) {
  const total = Math.max(0, xp || 0)
  let free = Math.round(total * FREE_XP_SHARE)
  const rest = Math.max(0, total - free)
  let crew = Math.round(rest * CREW_XP_SHARE) // было /2 (0.5) — экипаж качался слишком быстро (#26)
  const branch = Math.max(0, rest - crew)
  const crewRoom = Math.max(0, (CREW_MAX_LEVEL - 1) * CREW_LEVEL_XP - (profile.crew.xp || 0))
  let crewCredits = 0
  if (crew > crewRoom) { crewCredits = Math.round((crew - crewRoom) * 1.25); crew = crewRoom } // максовый экипаж → кредиты
  addCrewXp(crew)
  addBranchXp(nationOf(profile.selectedTank), branch)
  addFreeXp(free)
  if (crewCredits) addRewards(crewCredits, 0) // под econOn — no-op (кредиты начислит сервер)
  return { crew, branch, free, crewCredits }
}

// вложить свободный опыт в ветку выбранной нации (для исследования любой ветки/нации).
// Под авторитетностью списывает/начисляет СЕРВЕР; иначе — локально. false при нехватке.
export async function spendFreeXp(nation, amount) {
  const nat = String(nation || '')
  if (!NATIONS.some((n) => n.id === nat)) return false
  const amt = Math.max(0, Math.round(amount || 0))
  if (amt <= 0 || (profile.freeXp || 0) < amt) return false
  if (econOn()) {
    const r = await apiSpendFreeXp(nat, amt).catch(() => null)
    if (!r || !r.ok) return false
    adoptWallet(r)
    return true
  }
  profile.freeXp -= amt
  if (!profile.branchXp || typeof profile.branchXp !== 'object') profile.branchXp = {}
  profile.branchXp[nat] = (profile.branchXp[nat] || 0) + amt
  return true
}

// ---------- камуфляжи и имя ----------
export async function buySkin(skinId) {
  const s = SKIN_BY_ID[skinId]
  if (!s || profile.skins.includes(skinId)) return false
  if (econOn()) {
    const r = await apiBuySkin(skinId).catch(() => null)
    if (!r || !r.ok) return false
    adoptWallet(r)
    profile.skin = skinId
    return true
  }
  if (!spendTokens(s.costTokens)) return false
  profile.skins.push(skinId)
  profile.skin = skinId
  return true
}

export function setSkin(skinId) {
  if (profile.skins.includes(skinId)) profile.skin = skinId
}

// ---------- камуфляж на танк (3 схемы, разблокировка за жетоны) ----------
export const tankCamo = (tankId) => profile.camos[tankId] || ''
// камо разблокирован для танка? Заводская (id '') — всегда бесплатно.
export const camoUnlocked = (tankId, camoId) => !camoId || profile.camoOwned.includes(`${tankId}_${camoId}`)
export function setCamo(tankId, camoId) {
  if (camoId && !camoUnlocked(tankId, camoId)) return false // не куплен — не ставим
  if (camoId) profile.camos[tankId] = camoId
  else delete profile.camos[tankId]
  return true
}
// купить камо для танка за жетоны и сразу надеть; false — не хватило/уже есть
export async function buyCamo(tankId, camoId) {
  const def = CAMO_BY_ID[camoId]
  if (!def || !camoId) return false
  if (econOn()) {
    if (camoUnlocked(tankId, camoId)) { setCamo(tankId, camoId); return true } // уже куплен — просто надеть (локально)
    const r = await apiBuyCamo(tankId, camoId).catch(() => null)
    if (!r || !r.ok) return false
    adoptWallet(r)
    return true
  }
  if (camoUnlocked(tankId, camoId)) {
    setCamo(tankId, camoId)
    return true
  }
  if (!spendTokens(def.cost)) return false
  profile.camoOwned.push(`${tankId}_${camoId}`)
  profile.camos[tankId] = camoId
  return true
}

export function grantRandomSkin() {
  const pool = SKINS.filter((s) => s.id !== 'std' && !profile.skins.includes(s.id))
  if (!pool.length) return null
  const s = pool[Math.floor(Math.random() * pool.length)]
  profile.skins.push(s.id)
  return s
}

// дроп случайного ЗАПЕРТОГО камуфляжа — ТОЛЬКО на АКТИВНУЮ технику: выбранный танк,
// затем недавние из истории, и лишь запасом — прочие купленные. Иначе камо падало на
// стартеры чужих наций, которыми не играешь («камо на танк которого у меня нет»).
// Если у активных всё открыто — возвращаем null (вызывающий компенсирует жетонами).
export function grantRandomCamo() {
  const recent = Array.isArray(profile.history) ? profile.history.map((h) => h && h.tank).filter(Boolean) : []
  const order = []
  const seen = new Set()
  for (const tid of [profile.selectedTank, ...recent, ...profile.owned]) {
    // премы без камо-системы (top-down, без скинов) — камо на них = подарок в пустоту (фидбек #26)
    if (tid && profile.owned.includes(tid) && !seen.has(tid) && !(TANK_BY_ID[tid] || {}).premium) { seen.add(tid); order.push(tid) }
  }
  for (const tid of order) {
    const pool = CAMOS.filter((c) => c.id && !camoUnlocked(tid, c.id))
    if (pool.length) {
      const c = pool[Math.floor(Math.random() * pool.length)]
      profile.camoOwned.push(`${tid}_${c.id}`)
      return { tankId: tid, camoId: c.id, name: (CAMO_BY_ID[c.id] || {}).name || c.id, tankName: (TANK_BY_ID[tid] || {}).name || tid }
    }
  }
  return null
}

// имя из Telegram: подставляем ник профиля, пока игрок не сменил позывной
// платно (за звёзды). Кастомное имя приоритетнее ника TG.
export function applyTgName() {
  if (profile.nameCustom) return
  const u = tgUser()
  if (u && u.name) profile.name = u.name.slice(0, 16)
}

// зафиксировать платно сменённый позывной локально (после оплаты звёздами).
// Сервер уже сохранил то же имя — это для мгновенного отклика UI.
export function setCustomName(name) {
  const clean = String(name || '').trim().slice(0, 16)
  if (clean.length < 3) return false
  profile.name = clean
  profile.nameCustom = true
  return true
}

// ---------- голдовые снаряды ----------
export async function buyGoldAmmo(packId) {
  if (econOn()) {
    const r = await apiBuyGoldAmmo(packId).catch(() => null)
    if (!r || !r.ok) return false
    adoptWallet(r)
    return true
  }
  const p = GOLD_AMMO_PACKS.find((x) => x.id === packId)
  if (!p || !spendTokens(p.costTokens)) return false
  profile.goldAmmo += p.amount
  return true
}

export function spendGoldAmmo(n = 1) {
  if (profile.goldAmmo < n) return false
  profile.goldAmmo -= n // локально списываем сразу (мгновенный UI в бою)
  // авторитетный учёт: сервер спишет из owned (клампит, в минус не уйдёт). Fire-and-forget —
  // не тормозим выстрел; при ВЫКЛ флаге не зовём (поле едет обычным сейвом профиля).
  if (econOn()) apiSpendGoldAmmo(n).then(adoptWallet).catch(() => {})
  return true
}

// ящик (лутбокс): при авторитетности RNG/начисление на сервере; иначе локально (в Shop).
// Возвращает { credits, camo, tokens } для окна-награды, либо null.
export async function buyCrateServer(crateId) {
  const r = await apiBuyCrate(crateId).catch(() => null)
  if (!r || !r.ok) return null
  adoptWallet(r)
  const reward = r.reward || {}
  // сервер отдаёт camo строкой 'tankId_camoId' — разворачиваем в объект для тоста/окна
  let camo = null
  if (reward.camo) {
    const [tid, cid] = String(reward.camo).split('_')
    camo = { tankId: tid, camoId: cid, name: (CAMO_BY_ID[cid] || {}).name || cid, tankName: (TANK_BY_ID[tid] || {}).name || tid }
  }
  return { credits: reward.credits || 0, tokens: reward.tokens || 0, camo }
}

// ---------- статистика, рейтинг и история боёв ----------
// текущее звание игрока (по числу боёв)
export const playerRank = () => rankByBattles(profile.stats.battles)

export function addBattleResult(result, kills = 0, extra = {}) {
  const s = profile.stats
  s.battles++
  if (result === 'victory') s.wins++
  s.kills += kills
  s.rating = Math.max(100, s.rating + (RATING_DELTA[result] ?? RATING_DELTA.defeat))
  // боевой рейтинг (по эффективности): копим факт/ожид. урон+фраги на сыгранном
  // танке и пересчитываем career-агрегат. Это и есть «рейтинг», что видит игрок.
  const ratedTank = TANK_BY_ID[profile.selectedTank] || TANK_BY_ID.t26
  const exp = expectedBattle(ratedTank)
  const prevWn8 = s.wn8 || 0
  s.sumDmg = (s.sumDmg || 0) + (extra.damage || 0)
  s.sumFrag = (s.sumFrag || 0) + kills
  s.sumSpot = (s.sumSpot || 0) + (extra.spot || 0)
  s.expDmg = (s.expDmg || 0) + exp.dmg
  s.expFrag = (s.expFrag || 0) + exp.frag
  s.expSpot = (s.expSpot || 0) + exp.spot
  s.wn8 = battleScore(s)
  s.lastWn8Delta = s.wn8 - prevWn8 // для показа изменения в донесении
  // повышение в звании: награда за каждую новую ступень (обычно одну за бой)
  const reached = rankByBattles(s.battles).index
  while (profile.rankClaimed < reached) {
    profile.rankClaimed++
    const r = RANKS[profile.rankClaimed]
    if (r) addRewards(r.credits || 0, 0) // алмазы (жетоны) в бою больше не капают — только прем-танки фармят (#26)
  }
  profile.history.unshift({
    t: Date.now(),
    result,
    kills,
    damage: Math.round(extra.damage || 0),
    score: extra.score || '',
    tank: extra.tank || '',
  })
  if (profile.history.length > 12) profile.history.length = 12
  // статы по сыгранному танку (бои/победы/фраги именно на нём)
  const playedTank = extra.tank || profile.selectedTank
  if (playedTank) {
    if (!profile.tankStats || typeof profile.tankStats !== 'object') profile.tankStats = {}
    const ts = profile.tankStats[playedTank] || { battles: 0, wins: 0, kills: 0 }
    ts.battles++
    if (result === 'victory') ts.wins++
    ts.kills += kills
    profile.tankStats[playedTank] = ts
  }
}
// статы конкретного танка (для ангара) — всегда объект, дефолт нули
export const tankStat = (id) => (profile.tankStats || {})[id] || { battles: 0, wins: 0, kills: 0 }

// ---------- медали ----------
// b — итоги одного боя: { kills, damage, blocked, lightKills, survived, victory }
function battleMedalIds(b) {
  return MEDALS.filter((m) => m.kind === 'battle')
    .filter((m) => {
      if (m.metric === 'triumph') return !!b.survived && !!b.victory
      if (m.metric === 'survived') return !!b.survived
      return (+b[m.metric] || 0) >= m.need
    })
    .map((m) => m.id)
}
// карьерные рубежи, достигнутые по текущей суммарной статистике
function careerMedalIds() {
  const s = profile.stats
  return MEDALS.filter((m) => m.kind === 'career')
    .filter((m) => (+s[m.metric] || 0) >= m.need)
    .map((m) => m.id)
}
// какие медали заработаны в этом бою (для донесения), с флагом «впервые».
// Боевые показываем за каждый бой; карьерные — только в момент взятия рубежа.
// Считается ДО bankMedals, поэтому profile.medals ещё отражает состояние до боя.
export function battleEarnedMedals(b) {
  const battle = battleMedalIds(b).map((id) => ({ id, isNew: !profile.medals[id] }))
  const career = careerMedalIds()
    .filter((id) => !profile.medals[id])
    .map((id) => ({ id, isNew: true }))
  return [...battle, ...career]
}
// начисляет медали по итогам боя: счётчик +1, награда за ПЕРВОЕ получение каждой
export function bankMedals(b) {
  const earned = battleEarnedMedals(b)
  for (const e of earned) {
    const first = !profile.medals[e.id]
    profile.medals[e.id] = (profile.medals[e.id] || 0) + 1
    const r = MEDAL_BY_ID[e.id]?.reward
    if (first && r) addRewards(r.credits || 0, 0) // алмазы (жетоны) за медали в бою убраны — фарм только премами (#26)
  }
  return earned
}
// витрина: все полученные медали со счётчиком, в порядке каталога
export const ownedMedals = () =>
  MEDALS.filter((m) => (profile.medals[m.id] || 0) > 0).map((m) => ({ ...m, count: profile.medals[m.id] }))
export const medalsTotal = () => MEDALS.length
export const medalsEarnedCount = () => MEDALS.filter((m) => (profile.medals[m.id] || 0) > 0).length

// ---------- ежедневный вход ----------
const dayStr = (d = new Date()) => d.toISOString().slice(0, 10)

export function dailyAvailable() {
  return profile.daily.last !== dayStr()
}

// забрать награду дня — СЕРВЕРНО (день/стрик/выдача решает /api/daily-bonus под локом,
// нельзя забрать дважды с разных устройств). Награда уезжает в pendingGrants, забираем
// её атомарно через applyPendingGrants (credits/tokens/goldAmmo — авторитетно с сервера).
// Возвращает { day, reward } или null (сегодня уже забрано / сеть). Async — caller await'ит.
export async function claimDaily() {
  if (!dailyAvailable()) return null
  const res = await apiDailyBonus().catch(() => null)
  if (!res || !res.ok) {
    // сервер сказал «уже забрано сегодня» (другое устройство) — подтянем его состояние
    if (res && res.already) {
      try { await syncProfile() } catch { /* офлайн — заберём на следующем синке */ }
    }
    return null
  }
  // сервер — источник правды: фиксируем его день/стрик локально (UI закроется, повторно
  // не предложит), награду начисляем из очереди авторитетно
  profile.daily = { last: dayStr(), streak: res.day }
  await applyPendingGrants()
  return { day: res.day, reward: res.reward }
}

// ---------- ежедневные задачи: 3 в день, прогресс из итогов боя ----------
function ensureTasksDay() {
  const d = dayStr()
  if (profile.tasks.date !== d) profile.tasks = { date: d, progress: {}, claimed: [], metaClaimed: false }
}
// мета-задача «выполни все задачи дня» → бонус (TASKS_ALL_BONUS), один раз в день.
export function metaTaskState() {
  const list = dailyTasksList()
  const doneCount = list.filter((t) => t.done).length
  return { doneCount, total: list.length, allDone: list.length > 0 && doneCount >= list.length, claimed: !!profile.tasks.metaClaimed, reward: TASKS_ALL_BONUS }
}
export function claimMetaTask() {
  const st = metaTaskState()
  if (!st.allDone || st.claimed) return false
  profile.tasks.metaClaimed = true
  addRewards(TASKS_ALL_BONUS.credits || 0, TASKS_ALL_BONUS.tokens || 0)
  return true
}

export function dailyTasksList() {
  ensureTasksDay()
  return tasksOfDay(profile.tasks.date).map((t) => {
    const progress = Math.min(t.goal, profile.tasks.progress[t.id] || 0)
    return { ...t, progress, done: progress >= t.goal, claimed: profile.tasks.claimed.includes(t.id) }
  })
}

export const tasksClaimable = () => dailyTasksList().filter((t) => t.done && !t.claimed).length

// итоги боя → прогресс задач дня; stats: { damage, kills, lightKills, blocked, wins, battles }
export function bankTaskProgress(stats) {
  ensureTasksDay()
  for (const t of tasksOfDay(profile.tasks.date)) {
    const inc = Math.max(0, Math.round(+stats[t.key] || 0))
    if (inc) profile.tasks.progress[t.id] = (profile.tasks.progress[t.id] || 0) + inc
  }
}

export async function claimTask(id) {
  const t = dailyTasksList().find((x) => x.id === id)
  if (!t || !t.done || t.claimed) return false
  if (econOn()) {
    const r = await apiClaimTask(id).catch(() => null)
    if (!r || !r.ok) return false
    if (!profile.tasks.claimed.includes(id)) profile.tasks.claimed.push(id) // отметка для UI
    adoptWallet(r)
    return true
  }
  profile.tasks.claimed.push(id)
  addRewards(t.credits || 0, t.tokens || 0)
  return true
}

// ---------- рефералы ----------
// referrals/referralIds/referredBy ведёт СЕРВЕР (защищены от затирания при сейве
// профиля), клиент их только читает. Локального fake-addReferral больше нет.

// забрать награду рубежа рефералов (i — индекс REF_MILESTONES). Возвращает что
// выпало { credits, tokens, camo } для тоста, либо false если забрать нельзя.
export async function claimRefMilestone(i) {
  const m = REF_MILESTONES[i]
  if (!m || profile.claimedRef.includes(i) || profile.referrals.length < m.need) return false
  if (econOn()) {
    const r = await apiClaimRef(i).catch(() => null)
    if (!r || !r.ok) return false
    if (!profile.claimedRef.includes(i)) profile.claimedRef.push(i)
    adoptWallet(r)
    const rw = r.reward || {}
    let camo = null
    if (rw.camo) {
      const [tid, cid] = String(rw.camo).split('_')
      camo = { tankId: tid, camoId: cid, name: (CAMO_BY_ID[cid] || {}).name || cid, tankName: (TANK_BY_ID[tid] || {}).name || tid }
    }
    return { credits: rw.credits || 0, tokens: rw.tokens || 0, camo }
  }
  profile.claimedRef.push(i)
  let credits = m.credits
  let tokens = m.tokens
  let camo = null
  // «офицерский ящик» — настоящий дроп камуфляжа; всё открыто → компенсируем жетонами
  if (m.crate) {
    camo = grantRandomCamo()
    if (!camo) tokens += 15
  }
  addRewards(credits, tokens)
  return { credits, tokens, camo }
}
