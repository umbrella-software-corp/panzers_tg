// Профиль игрока (модель дизайн-прототипа): нация, валюты (кредиты+жетоны),
// купленные танки, выбор, модули {tankId:{slot:level 1..3}}, взвод.
// Реактивный, сохраняется в localStorage.
import { reactive, watch } from 'vue'
import { apiLoadProfile, apiSaveProfile, apiConfig } from './api.js'
import { tgUser, tgUserId } from './tg.js'
import { t } from './i18n.js'

// серверный конфиг (флаги админки: турниры вкл/выкл; бонус за подписку на канал)
export const serverConfig = reactive({ tournaments: false, channel: { on: false, url: '', credits: 0, tokens: 0 } })

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
export async function loadConfig() {
  try {
    const c = await apiConfig()
    serverConfig.tournaments = !!c.tournaments
    if (c.channel) serverConfig.channel = c.channel
  } catch {
    /* офлайн — оставляем дефолт */
  }
}
import {
  TANK_BY_ID,
  STARTERS,
  nationOf,
  MODULE_DEFS,
  MODULE_COMBAT,
  moduleCost,
  modLevel,
  modsMaxedCount,
  REF_MILESTONES,
  SKINS,
  SKIN_BY_ID,
  combatStats,
  DAILY_REWARDS,
  RATING_START,
  RATING_DELTA,
  GOLD_AMMO_PACKS,
  CREW_MEMBERS,
  CREW_PERK_MAX,
  crewPerkCost,
  tasksOfDay,
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

// имя по умолчанию — ник из Telegram; платное (за звёзды) имя не трогаем
applyTgName()

// локальный кеш — мгновенно; на сервер — с дебаунсом (офлайн не мешает игре)
let pushTimer = null
watch(
  profile,
  () => {
    localStorage.setItem(KEY, JSON.stringify(profile))
    clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      apiSaveProfile(JSON.parse(JSON.stringify(profile))).catch(() => {})
    }, 1500)
  },
  { deep: true },
)

// загрузка с сервера при старте: серверный профиль главнее; нет его —
// мигрируем туда локальный (первый вход со старым прогрессом)
export async function syncProfile() {
  try {
    const res = await apiLoadProfile()
    if (res && res.profile) {
      const { _updatedAt, ...rest } = res.profile
      const localDaily = profile.daily // claim мог не успеть уехать на сервер до перезапуска
      Object.assign(profile, rest)
      // НЕ даём СТАРОМУ серверному daily.last затереть свежий локальный: иначе после
      // claim'а (POST debounced) перезапуск мини-аппа воскрешал дейлик и давал пере-клейм
      // со взвинчиванием стрика. Даты YYYY-MM-DD сравниваются как строки = хронологически.
      if (localDaily && (localDaily.last || '') > ((profile.daily && profile.daily.last) || '')) profile.daily = localDaily
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
    } else {
      await apiSaveProfile(JSON.parse(JSON.stringify(profile)))
    }
    return true
  } catch {
    return false // сервер недоступен — играем на локальном кеше
  }
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
export function canUnlock(tank) {
  if (isOwned(tank.id)) return false
  const prev = prevTank(tank)
  if (!prev) return true // tier 1
  return isOwned(prev.id) && modsMaxedCount(profile.modules, prev.id) >= 5
}

export function unlockReason(tank) {
  const prev = prevTank(tank)
  if (prev && !isOwned(prev.id)) return t('game.unlock.research', { name: prev.name })
  if (prev && modsMaxedCount(profile.modules, prev.id) < 5)
    return t('game.unlock.modules', { name: prev.name, n: modsMaxedCount(profile.modules, prev.id) })
  return null
}

export function buyTank(tank) {
  if (!canUnlock(tank) || profile.credits < (tank.cost || 0)) return false
  profile.credits -= tank.cost || 0
  profile.owned.push(tank.id)
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

export function upgradeModule(tankId, modId) {
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
export const CREW_MAX_LEVEL = 10

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

export function upgradeCrewPerk(id) {
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
  profile.branchXp[nation] = (profile.branchXp[nation] || 0) + Math.max(0, Math.round(xp || 0))
}

// сплит опыта боя: половина в ветку текущего танка, половина экипажу
export function bankBattleXp(xp) {
  const crew = Math.round((xp || 0) / 2)
  const branch = Math.max(0, (xp || 0) - crew)
  addCrewXp(crew)
  addBranchXp(nationOf(profile.selectedTank), branch)
  return { crew, branch }
}

// ---------- камуфляжи и имя ----------
export function buySkin(skinId) {
  const s = SKIN_BY_ID[skinId]
  if (!s || profile.skins.includes(skinId)) return false
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
export function buyCamo(tankId, camoId) {
  const def = CAMO_BY_ID[camoId]
  if (!def || !camoId) return false
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

// дроп случайного ЗАПЕРТОГО камуфляжа на одном из купленных танков (оф-ящик).
// Всё открыто — возвращаем null (вызывающий компенсирует жетонами).
export function grantRandomCamo() {
  const pool = []
  for (const tid of profile.owned) {
    for (const c of CAMOS) {
      if (c.id && !camoUnlocked(tid, c.id)) pool.push({ tankId: tid, camoId: c.id })
    }
  }
  if (!pool.length) return null
  const pick = pool[Math.floor(Math.random() * pool.length)]
  profile.camoOwned.push(`${pick.tankId}_${pick.camoId}`)
  return { ...pick, name: (CAMO_BY_ID[pick.camoId] || {}).name || pick.camoId, tankName: (TANK_BY_ID[pick.tankId] || {}).name || pick.tankId }
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
export function buyGoldAmmo(packId) {
  const p = GOLD_AMMO_PACKS.find((x) => x.id === packId)
  if (!p || !spendTokens(p.costTokens)) return false
  profile.goldAmmo += p.amount
  return true
}

export function spendGoldAmmo(n = 1) {
  if (profile.goldAmmo < n) return false
  profile.goldAmmo -= n
  return true
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
    if (r) addRewards(r.credits || 0, r.tokens || 0)
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
}

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
    if (first && r) addRewards(r.credits || 0, r.tokens || 0)
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

// забрать награду дня; возвращает { day, reward } или null
export function claimDaily() {
  if (!dailyAvailable()) return null
  const yesterday = dayStr(new Date(Date.now() - 86400e3))
  profile.daily.streak = profile.daily.last === yesterday ? profile.daily.streak + 1 : 1
  profile.daily.last = dayStr()
  const reward = DAILY_REWARDS[(profile.daily.streak - 1) % DAILY_REWARDS.length]
  addRewards(reward.credits || 0, reward.tokens || 0)
  if (reward.gold) profile.goldAmmo += reward.gold
  return { day: profile.daily.streak, reward }
}

// ---------- ежедневные задачи: 3 в день, прогресс из итогов боя ----------
function ensureTasksDay() {
  const d = dayStr()
  if (profile.tasks.date !== d) profile.tasks = { date: d, progress: {}, claimed: [] }
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

export function claimTask(id) {
  const t = dailyTasksList().find((x) => x.id === id)
  if (!t || !t.done || t.claimed) return false
  profile.tasks.claimed.push(id)
  addRewards(t.credits || 0, t.tokens || 0)
  return true
}

// ---------- рефералы ----------
// referrals/referralIds/referredBy ведёт СЕРВЕР (защищены от затирания при сейве
// профиля), клиент их только читает. Локального fake-addReferral больше нет.

// забрать награду рубежа рефералов (i — индекс REF_MILESTONES). Возвращает что
// выпало { credits, tokens, camo } для тоста, либо false если забрать нельзя.
export function claimRefMilestone(i) {
  const m = REF_MILESTONES[i]
  if (!m || profile.claimedRef.includes(i) || profile.referrals.length < m.need) return false
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
