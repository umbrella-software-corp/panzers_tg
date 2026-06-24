// ============ ЭКОНОМИКА — серверный источник правды ============
// Сервер авторитетен по экономике (credits/owned/modules): начисляет награды из
// СВОИХ боевых чисел и валидирует покупки. Эти таблицы — ПЛОСКОЕ зеркало
// client/src/game/meta.js (там те же числа + i18n-обёртки defLoc). При изменении
// цен/наград — менять В ОБОИХ местах (как DAILY_REWARDS в daily.js). Клиент по-
// прежнему читает meta.js для отображения; сервер — этот файл для начисления/списания.

// ---------- цены исследуемых танков по тиру (одинаково для всех наций) ----------
export const TIER_COST = { 1: 0, 2: 1500, 3: 4000, 4: 10000, 5: 25000, 6: 62000, 7: 155000, 8: 390000, 9: 980000, 10: 2500000 }
export const tankCost = (tier) => TIER_COST[tier] || 0

// ---------- ИССЛЕДОВАНИЕ: стоимость в опыте ветки по тиру (WoT-модель) ----------
// Опыт ветки (branchXp[нация]) копится в боях на танках нации и ТРАТИТСЯ при открытии
// след. танка — отдельно от кредитов. ЗЕРКАЛО client/src/game/meta.js TIER_XP.
export const TIER_XP = { 1: 0, 2: 450, 3: 2200, 4: 6000, 5: 14000, 6: 30000, 7: 55000, 8: 95000, 9: 150000, 10: 240000 }
export const tankResearchXp = (tier) => TIER_XP[tier] || 0

// ---------- СВОБОДНЫЙ ОПЫТ (free XP) ----------
// Доля боевого опыта, уходящая в СВОБОДНЫЙ пул (а не в ветку/экипаж). Свободный опыт
// можно вложить в ЛЮБУЮ нацию для исследования (см. spendFreeXp). ЗЕРКАЛО meta.js.
export const FREE_XP_SHARE = 0.1
// Доля боевого опыта (от остатка после свободного), уходящая в ЭКИПАЖ; остальное — в
// ветку. Было 0.5 — экипаж качался слишком быстро (фидбек #26); срезали до 0.3, а
// высвобожденное идёт в ветку (танки открываются чуть быстрее). ЗЕРКАЛО meta.js.
export const CREW_XP_SHARE = 0.3
// id наций (для валидации вложения свободного опыта). ЗЕРКАЛО meta.js NATIONS.
export const NATION_IDS = ['ussr', 'ger', 'usa']

// ---------- модули: 5 слотов × 3 уровня ----------
export const MODULE_SLOTS = ['gun', 'tur', 'eng', 'trk', 'rad']
export const MODULE_MAX = 3
// цена модуля растёт КВАДРАТично по тиру (награда за бой тоже растёт) — ощутимый слив, не копейки.
// tier²·50/110: т5 1250/2750, т7 2450/5390, т10 5000/11000. ЗЕРКАЛО meta.js — менять В ОБОИХ.
export const moduleCost = (tier, level) => Math.round(tier * tier * (level === 2 ? 50 : 110))
export const modLevel = (modules, tankId, modId) => ((modules || {})[tankId] || {})[modId] || 1
export const modsMaxedCount = (modules, tankId) => MODULE_SLOTS.filter((m) => modLevel(modules, tankId, m) >= MODULE_MAX).length

// ---------- реестр исследуемых танков (id → tier/nation) для валидации ----------
// ЗЕРКАЛО meta.js TANKS_BY_NATION. Премиум-танки сюда НЕ входят — они только за ⭐.
export const RESEARCH_TANKS = {
  t26: { tier: 1, nation: 'ussr' }, bt7: { tier: 2, nation: 'ussr' }, t34: { tier: 3, nation: 'ussr' }, t3485: { tier: 4, nation: 'ussr' }, kv1: { tier: 5, nation: 'ussr' }, is2: { tier: 6, nation: 'ussr' }, t72: { tier: 7, nation: 'ussr' }, t90: { tier: 8, nation: 'ussr' }, t80u: { tier: 9, nation: 'ussr' }, t14: { tier: 10, nation: 'ussr' },
  pz2: { tier: 1, nation: 'ger' }, pz3: { tier: 2, nation: 'ger' }, pz4: { tier: 3, nation: 'ger' }, pnt: { tier: 4, nation: 'ger' }, tgr: { tier: 5, nation: 'ger' }, tgr2: { tier: 6, nation: 'ger' }, leo1: { tier: 7, nation: 'ger' }, leo2: { tier: 8, nation: 'ger' }, leo2a7: { tier: 9, nation: 'ger' }, kf51: { tier: 10, nation: 'ger' },
  m2l: { tier: 1, nation: 'usa' }, stu: { tier: 2, nation: 'usa' }, sher: { tier: 3, nation: 'usa' }, e8: { tier: 4, nation: 'usa' }, per: { tier: 5, nation: 'usa' }, m48: { tier: 6, nation: 'usa' }, m60: { tier: 7, nation: 'usa' }, abr: { tier: 8, nation: 'usa' }, m1a2: { tier: 9, nation: 'usa' }, abrx: { tier: 10, nation: 'usa' },
}
export const STARTERS = ['t26', 'pz2', 'm2l']

// премиум-танки (только за ⭐, не исследуются) — тир для стоимости модулей/тир-брекета
export const PREMIUM_TANK_IDS = ['t28', 't54', 'pz4h', 'maus', 'ram', 'sper']
export const PREMIUM_TANK_TIER = { t28: 4, t54: 8, pz4h: 4, maus: 8, ram: 4, sper: 8 }
export const PREMIUM_TANK_NATION = { t28: 'ussr', t54: 'ussr', pz4h: 'ger', maus: 'ger', ram: 'usa', sper: 'usa' }
export const isPremiumTank = (id) => PREMIUM_TANK_TIER[id] != null
// нация танка (для начисления опыта ветки за бой) — исследуемый/премиум; иначе ussr
export const tankNation = (id) => (RESEARCH_TANKS[id] && RESEARCH_TANKS[id].nation) || PREMIUM_TANK_NATION[id] || 'ussr'
export const tankTier = (id) => (RESEARCH_TANKS[id] && RESEARCH_TANKS[id].tier) || PREMIUM_TANK_TIER[id] || 1
// танк существует (исследуемый или премиум) — для валидации id из клиента
export const tankExists = (id) => !!RESEARCH_TANKS[id] || PREMIUM_TANK_TIER[id] != null

// ---------- ПРОДАЖА ТАНКА (#26: «танки 1 ур. лежат без дела, хочу продать») ----------
// Возврат = доля кредитовой цены. Тир-1 (стартеры, цена 0) → возврат 0: иначе чит-цикл
// «продал стартер (+кр) → бесплатно вернул → снова продал». ЗЕРКАЛО client store.js.
export const SELL_REFUND = 0.5
export const tankSellPrice = (tier) => Math.round((TIER_COST[tier] || 0) * SELL_REFUND)
// продать можно, если: владеешь, НЕ прем (куплен за ⭐), НЕ текущий боевой, и в нации
// есть КУПЛЕННЫЙ танк ВЫШЕ тиром → этот не фронтир ветки, продажа не блокирует
// исследование (owned остаётся рабочим префиксом дерева). ЗЕРКАЛО store.js canSell.
export function canSellTank(owned, tankId, selectedTank) {
  if (!Array.isArray(owned) || !owned.includes(tankId)) return false
  if (isPremiumTank(tankId) || tankId === selectedTank) return false
  const nat = tankNation(tankId)
  const tier = tankTier(tankId)
  return owned.some((id) => id !== tankId && tankNation(id) === nat && tankTier(id) > tier)
}

// предыдущий по тиру танк в той же нации (для гейта разблокировки)
export function prevTankId(tankId) {
  const t = RESEARCH_TANKS[tankId]
  if (!t || t.tier <= 1) return null
  return Object.keys(RESEARCH_TANKS).find((id) => RESEARCH_TANKS[id].nation === t.nation && RESEARCH_TANKS[id].tier === t.tier - 1) || null
}

// можно ли РАЗБЛОКИРОВАТЬ танк: предыдущий куплен + его 5 модулей собраны (3/3) +
// накоплен опыт ветки ≥ стоимости исследования. owned — массив id, modules —
// { tankId: { slot: 1..3 } }, branchXp — { nation: xp }. Деньги НЕ проверяет (отдельно).
export function canUnlockTank(owned, modules, tankId, branchXp) {
  const t = RESEARCH_TANKS[tankId]
  if (!t) return false
  if ((owned || []).includes(tankId)) return false
  const xpOk = ((branchXp || {})[t.nation] || 0) >= tankResearchXp(t.tier)
  const prev = prevTankId(tankId)
  if (!prev) return xpOk // тир-1 (xp=0 → true; но стартеры и так owned)
  return (owned || []).includes(prev) && modsMaxedCount(modules, prev) >= MODULE_SLOTS.length && xpOk
}

// ---------- награда за бой из АВТОРИТЕТНЫХ серверных чисел ----------
// result: 'victory'|'draw'|'defeat'; kills/damage — из sim; allyScore — счёт команды.
// Возвращает { credits, xp } (БЕЗ премиум-множителей — их накидывает сервер по premiumUntil/прем-танку).
export function battleReward({ result, kills = 0, damage = 0 }) {
  // ЗЕРКАЛО client Battle.vue reward. Опыт решает РЕЗУЛЬТАТ боя (урон/фраги), не флэт-база
  // (фидбек: «давалось одинаково и немного»). Кредиты ∝ опыту. Опыт за медали — отдельно
  // (battleMedalXp), складывается в grantBattle (сервер) / reward (клиент).
  const win = result === 'victory'
  const draw = result === 'draw'
  const baseXp = win ? 150 : draw ? 90 : 60
  // делитель урона 22→8: после ресейла урона ×0.375 (DMG_SCALE 16→6) член damage/22 просел
  // на −62% → XP/кредиты за бой упали (фидбек #23 «начисление опыта/кредитов хромает»).
  // 22×0.375≈8 восстанавливает XP-от-урона к доресейловому уровню. ЗЕРКАЛО Battle.vue.
  const xp = Math.max(0, baseXp + kills * 55 + Math.round((damage || 0) / 8))
  return { credits: Math.round(xp * 1.25), xp }
}
// суммарный опыт за боевые медали этого боя. ЗЕРКАЛО meta.js battleMedalXp.
export function battleMedalXp(b) {
  let xp = 0
  for (const m of MEDALS) {
    if (m.kind !== 'battle' || !m.reward || !m.reward.xp) continue
    const ok = m.metric === 'triumph' ? (!!b.survived && !!b.victory)
      : m.metric === 'survived' ? !!b.survived
      : (+b[m.metric] || 0) >= m.need
    if (ok) xp += m.reward.xp
  }
  return xp
}
export const PREMIUM_BONUS = 0.5 // премиум-аккаунт: +50% к кредитам/опыту (бенчмарк Blitz, тикет #29)
export const PREM_TANK = { xpMult: 0.05, creditMult: 0.05, gemEvery: 10, gems: 10 }

// ---------- воинские звания (по серверному числу боёв srvBattles) ----------
// ЗЕРКАЛО meta.js RANKS. Награда за каждое новое звание — один раз.
export const RANKS = [
  { battles: 0, credits: 0 }, { battles: 5, credits: 300 }, { battles: 15, credits: 600 }, { battles: 30, credits: 1000, tokens: 2 },
  { battles: 50, credits: 1500, tokens: 3 }, { battles: 80, credits: 2200, tokens: 4 }, { battles: 120, credits: 3000, tokens: 5 },
  { battles: 175, credits: 4200, tokens: 6 }, { battles: 250, credits: 5800, tokens: 8 }, { battles: 350, credits: 7500, tokens: 10 },
  { battles: 500, credits: 9500, tokens: 12 }, { battles: 700, credits: 13000, tokens: 16 }, { battles: 1000, credits: 18000, tokens: 22 }, { battles: 1500, credits: 28000, tokens: 35 },
]
export function rankIndexByBattles(battles) {
  let idx = 0
  for (let i = 0; i < RANKS.length; i++) if ((battles || 0) >= RANKS[i].battles) idx = i
  return idx
}

// ---------- медали ----------
// ЗЕРКАЛО meta.js MEDALS (только id/kind/metric/need/reward — i18n не нужен серверу).
export const MEDALS = [
  { id: 'warrior', kind: 'battle', metric: 'kills', need: 3, reward: { credits: 150, xp: 120 } },
  { id: 'sniper', kind: 'battle', metric: 'kills', need: 5, reward: { credits: 500, tokens: 2, xp: 300 } },
  { id: 'firestorm', kind: 'battle', metric: 'damage', need: 3000, reward: { credits: 300, tokens: 1, xp: 250 } },
  { id: 'wall', kind: 'battle', metric: 'blockedDmg', need: 750, reward: { credits: 300, tokens: 1, xp: 200 } },
  { id: 'scout', kind: 'battle', metric: 'lightKills', need: 2, reward: { credits: 200, xp: 150 } },
  { id: 'survivor', kind: 'battle', metric: 'survived', need: 1, reward: { credits: 150, xp: 100 } },
  { id: 'triumph', kind: 'battle', metric: 'triumph', need: 1, reward: { credits: 600, tokens: 3, xp: 400 } },
  { id: 'kingslayer', kind: 'battle', metric: 'kills', need: 7, reward: { credits: 900, tokens: 4, xp: 500 } },
  { id: 'devastator', kind: 'battle', metric: 'damage', need: 5600, reward: { credits: 600, tokens: 2, xp: 400 } },
  { id: 'bastion', kind: 'battle', metric: 'blockedDmg', need: 1500, reward: { credits: 500, tokens: 2, xp: 350 } },
  { id: 'pathfinder', kind: 'battle', metric: 'lightKills', need: 4, reward: { credits: 350, tokens: 1, xp: 250 } },
  { id: 'recruit', kind: 'career', metric: 'battles', need: 10, reward: { credits: 200 } },
  { id: 'veteran', kind: 'career', metric: 'battles', need: 100, reward: { credits: 600, tokens: 2 } },
  { id: 'guards', kind: 'career', metric: 'battles', need: 500, reward: { credits: 1500, tokens: 5 } },
  { id: 'hunter', kind: 'career', metric: 'kills', need: 100, reward: { credits: 600, tokens: 2 } },
  { id: 'ace', kind: 'career', metric: 'kills', need: 1000, reward: { credits: 2000, tokens: 8 } },
  { id: 'legend', kind: 'career', metric: 'rating', need: 1500, reward: { credits: 1500, tokens: 5 } },
  { id: 'executioner', kind: 'career', metric: 'kills', need: 300, reward: { credits: 1000, tokens: 3 } },
  { id: 'marshal', kind: 'career', metric: 'battles', need: 1000, reward: { credits: 3000, tokens: 10 } },
  { id: 'grandmaster', kind: 'career', metric: 'rating', need: 1800, reward: { credits: 2500, tokens: 8 } },
]
export const MEDAL_BY_ID = Object.fromEntries(MEDALS.map((m) => [m.id, m]))
// медали за ОДИН бой по его итогам b={kills,damage,blockedDmg,lightKills,survived,victory}
export function battleMedalIds(b) {
  return MEDALS.filter((m) => m.kind === 'battle').filter((m) => {
    if (m.metric === 'triumph') return !!b.survived && !!b.victory
    if (m.metric === 'survived') return !!b.survived
    return (+b[m.metric] || 0) >= m.need
  }).map((m) => m.id)
}
// карьерные медали по суммарной стате s={battles,kills,rating}
export function careerMedalIds(s) {
  return MEDALS.filter((m) => m.kind === 'career').filter((m) => (+(s || {})[m.metric] || 0) >= m.need).map((m) => m.id)
}

// ---------- ежедневные задачи ----------
// ЗЕРКАЛО meta.js DAILY_TASKS / TASKS_PER_DAY / tasksOfDay — порядок, id и алгоритм
// держать идентичными клиенту (сервер валидирует, что забранная задача — сегодняшняя).
export const DAILY_TASKS = [
  { id: 'dmg600', goal: 1700, key: 'damage', credits: 400 }, // цель урезана ×0.375 под ресейл урона (была 4500)
  { id: 'kills3', goal: 3, key: 'kills', credits: 500 },
  { id: 'light2', goal: 2, key: 'lightKills', credits: 400 }, // алмазы→кредиты: жетоны фармят только премы (#26)
  { id: 'block3', goal: 3, key: 'blocked', credits: 350 },
  { id: 'win1', goal: 1, key: 'wins', credits: 600 },
  { id: 'battles3', goal: 3, key: 'battles', credits: 300 },
  { id: 'dmg9000', goal: 3400, key: 'damage', credits: 800 }, // цель урезана ×0.375 под ресейл урона (была 9000)
  { id: 'kills5', goal: 5, key: 'kills', credits: 800 },
  { id: 'win3', goal: 3, key: 'wins', credits: 600 }, // было tokens:10 → кредиты (#26)
  { id: 'battles5', goal: 5, key: 'battles', credits: 500 },
  { id: 'survive2', goal: 2, key: 'survived', credits: 450 },
  { id: 'armor2000', goal: 750, key: 'blockedDmg', credits: 450 }, // цель урезана ×0.375 под ресейл урона (была 2000)
  { id: 'light3', goal: 3, key: 'lightKills', credits: 500 }, // было tokens:7 → кредиты (#26)
]
export const TASKS_PER_DAY = 4
// бонус за выполнение ВСЕХ задач дня. ЗЕРКАЛО meta.js TASKS_ALL_BONUS. tokens:1 добавлен
// по фидбеку #23 (@basketballaim) — гем за главную задачу «все дейлики дня» (1/день, мелкий
// трикл; частично возвращает #26 «гемы только премами» — флаг владельцу).
export const TASKS_ALL_BONUS = { credits: 1500, tokens: 1 }
export const TASK_BY_ID = Object.fromEntries(DAILY_TASKS.map((t) => [t.id, t]))
export function tasksOfDay(dayString) {
  let s = [...String(dayString)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const idx = DAILY_TASKS.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0
    const j = s % (i + 1)
    const tmp = idx[i]
    idx[i] = idx[j]
    idx[j] = tmp
  }
  return idx.slice(0, TASKS_PER_DAY).map((i) => DAILY_TASKS[i])
}

// ---------- рефералы ----------
export const REF_MILESTONES = [
  { need: 1, credits: 500, tokens: 0 },
  { need: 3, credits: 1000, tokens: 5, crate: true },
  { need: 5, credits: 0, tokens: 25 },
]

// ---------- покупки за жетоны ----------
export const SKIN_COST = { std: 0, winter: 15, desert: 15, forest: 15, night: 25, digital: 35, urban: 35, tiger: 45, gold: 60 }
export const CAMO_COST = { '': 0, woodland: 25, desert: 25, winter: 25, tiger: 40, predator: 40, magma: 40 }
export const GOLD_AMMO_PACKS = { g1: { amount: 10, costTokens: 12 }, g2: { amount: 30, costTokens: 30 } }
export const CREW_PERK_COSTS = [800, 2000, 4500] // кредиты за ранг I/II/III
export const crewPerkCost = (curLevel) => CREW_PERK_COSTS[curLevel] ?? Infinity
export const CREW_PERK_MAX = 3
export const CREW_MEMBER_IDS = ['cmd', 'gnr', 'lod', 'drv', 'rad']
export const CREW_LEVEL_XP = 600
// макс 16 → 15 очков навыка (level−1) = полная прокачка 5 спецов × 3 ранга. ЗЕРКАЛО
// client/src/store.js CREW_MAX_LEVEL — менять синхронно. Сверх макса крю-опыт → свободный.
export const CREW_MAX_LEVEL = 16
export const crewLevel = (xp) => Math.min(CREW_MAX_LEVEL, 1 + Math.floor((xp || 0) / CREW_LEVEL_XP))
// очки навыка: +1 за каждый уровень экипажа после первого, минус уже потраченные
export function crewPointsFree(crew) {
  const skills = (crew && crew.skills) || {}
  const spent = CREW_MEMBER_IDS.reduce((s, id) => s + (skills[id] || 0), 0)
  return Math.max(0, crewLevel((crew && crew.xp) || 0) - 1 - spent)
}

// ---------- стартовые значения профиля ----------
export const START_CREDITS = 500
export const START_TOKENS = 10
export const START_GOLD_AMMO = 5
export const FIRST_BATTLE_BONUS = 1000 // кредитов за первый завершённый бой (онбординг)
export const GOLD_AMMO_MULT = 1.35
