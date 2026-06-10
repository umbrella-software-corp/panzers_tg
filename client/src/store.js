// Профиль игрока (модель дизайн-прототипа): нация, валюты (кредиты+жетоны),
// купленные танки, выбор, модули {tankId:{slot:level 1..3}}, взвод.
// Реактивный, сохраняется в localStorage.
import { reactive, watch } from 'vue'
import { TANK_CLASSES } from './game/config.js'
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
    credits: 1450,
    tokens: 30,
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
export function loadoutStats(tankId) {
  const tank = TANK_BY_ID[tankId] || TANK_BY_ID[STARTERS[0]]
  const base = { ...TANK_CLASSES[tank.classId] }
  base.damage *= MODULE_COMBAT.gun[tankModLevel(tank.id, 'gun') - 1]
  const eng = MODULE_COMBAT.eng[tankModLevel(tank.id, 'eng') - 1]
  base.maxSpeed *= eng
  base.accel *= eng
  base.turnRate *= MODULE_COMBAT.trk[tankModLevel(tank.id, 'trk') - 1]
  base.vision *= MODULE_COMBAT.rad[tankModLevel(tank.id, 'rad') - 1]
  return base
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
