// Профиль игрока (модель дизайн-прототипа): нация, валюты (кредиты+жетоны),
// купленные танки, выбор, модули {tankId:{slot:level 1..3}}, взвод.
// Реактивный, сохраняется в localStorage.
import { reactive, watch } from 'vue'
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
  SKIN_BY_ID,
  RENAME_COST_TOKENS,
  combatStats,
  DAILY_REWARDS,
  RATING_START,
  RATING_DELTA,
  GOLD_AMMO_PACKS,
} from './game/meta.js'

const KEY = 'pz.state.v1'

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
if (!Array.isArray(profile.party)) profile.party = []
if (!Array.isArray(profile.referrals)) profile.referrals = []
if (!Array.isArray(profile.claimedRef)) profile.claimedRef = []
if (typeof profile.goldAmmo !== 'number') profile.goldAmmo = 5
if (!profile.stats || typeof profile.stats !== 'object')
  profile.stats = { battles: 0, wins: 0, kills: 0, rating: RATING_START }
if (!profile.daily || typeof profile.daily !== 'object') profile.daily = { last: '', streak: 0 }
if (!Array.isArray(profile.history)) profile.history = [] // последние бои
if (!profile.crew || typeof profile.crew !== 'object') profile.crew = { xp: 0 } // экипаж один на все танки
if (!profile.branchXp || typeof profile.branchXp !== 'object') profile.branchXp = {} // опыт по веткам наций
if (typeof profile.name !== 'string' || !profile.name) profile.name = 'Боец'
if (!Array.isArray(profile.skins)) profile.skins = ['std'] // купленные камуфляжи
if (typeof profile.skin !== 'string') profile.skin = 'std'

watch(profile, () => localStorage.setItem(KEY, JSON.stringify(profile)), { deep: true })

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
function prevTank(tank) {
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
  if (prev && !isOwned(prev.id)) return `Исследуйте ${prev.name}`
  if (prev && modsMaxedCount(profile.modules, prev.id) < 5)
    return `Изучите модули ${prev.name} (${modsMaxedCount(profile.modules, prev.id)}/5)`
  return null
}

export function buyTank(tank) {
  if (!canUnlock(tank) || profile.credits < (tank.cost || 0)) return false
  profile.credits -= tank.cost || 0
  profile.owned.push(tank.id)
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
  base.reload = +(base.reload / ck).toFixed(2)
  base.vision *= ck
  base.maxSpeed *= ck
  base.turnRate *= ck
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

// платная смена позывного
export function renamePlayer(name) {
  const clean = String(name || '').trim().slice(0, 16)
  if (clean.length < 3) return false
  if (!spendTokens(RENAME_COST_TOKENS)) return false
  profile.name = clean
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
export function addBattleResult(result, kills = 0, extra = {}) {
  const s = profile.stats
  s.battles++
  if (result === 'victory') s.wins++
  s.kills += kills
  s.rating = Math.max(100, s.rating + (RATING_DELTA[result] ?? RATING_DELTA.defeat))
  profile.history.unshift({
    t: Date.now(),
    result,
    kills,
    score: extra.score || '',
    tank: extra.tank || '',
  })
  if (profile.history.length > 12) profile.history.length = 12
}

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

// ---------- взвод и рефералы ----------
export function setParty(ids) {
  profile.party = ids.slice(0, 2) // максимум 2 напарника (взвод 3/3 с командиром)
}

export function addReferral(name) {
  if (profile.referrals.length >= 5) return false
  profile.referrals.push(name)
  return true
}

// забрать награду рубежа рефералов (i — индекс REF_MILESTONES)
export function claimRefMilestone(i) {
  const m = REF_MILESTONES[i]
  if (!m || profile.claimedRef.includes(i) || profile.referrals.length < m.need) return false
  profile.claimedRef.push(i)
  addRewards(m.credits, m.tokens)
  return true
}
