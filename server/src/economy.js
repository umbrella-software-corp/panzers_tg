// ============ СЕРВЕРНО-АВТОРИТЕТНАЯ ЭКОНОМИКА (за флагом econAuthority) ============
// Когда флаг ВЫКЛ (дефолт) — этот модуль не вызывается, поведение игры 1:1 как было.
// Когда ВКЛ — СЕРВЕР единственный, кто меняет деньги/танки/модули: начисляет награды
// из СВОИХ боевых чисел (BattleSim) и валидирует покупки. Клиент только просит и
// принимает авторитетный результат. Это закрывает чит «правлю localStorage → миллионы
// кредитов / все танки» (см. [[panzer-tg-server-authority]]).
// Цифры берём из shared/economy.js (зеркало client/src/game/meta.js).
import { loadProfile, saveProfile, withProfileLock, getSetting, listProfiles } from './db.js'
import { logEvent } from './eventlog.js'
import * as E from 'panzer-tg-shared/economy.js'

let grantSeq = 0
const dayStr = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10)
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)))

// ---------- флаг авторитетности (кэш 5с — не читаем settings.json на каждый сейв/бой) ----------
let flagCache = { v: false, at: 0 }
export async function econAuthority() {
  const now = Date.now()
  if (now - flagCache.at > 5000) flagCache = { v: !!(await getSetting('econAuthority', false)), at: now }
  return flagCache.v
}
export function setEconFlagCache(v) { flagCache = { v: !!v, at: Date.now() } }
// синхронный доступ к кэшу для горячего пути боя (роутинг тика синхронный). Кэш греется
// частыми /api/config от клиентов и мгновенно бастится админ-тогглом.
export function econAuthorityCached() { return flagCache.v }

// ---------- /api/profile: какие поля ведёт СЕРВЕР (клиентский сейв их НЕ трогает) ----------
// Возвращает объект для подмешивания в merged (по образцу premiumUntil/daily/pendingGrants).
// crew.xp/branchXp/stats/medals/camos оставляем клиенту (это не деньги; фейк безвреден при
// залоченных кредитах) — но crew.skills (перки за кредиты) и инвентарь ведёт сервер.
export function econPreserve(prev, bodyProfile) {
  const bodyCrew = (bodyProfile && bodyProfile.crew && typeof bodyProfile.crew === 'object') ? bodyProfile.crew : {}
  const prevCrew = (prev.crew && typeof prev.crew === 'object') ? prev.crew : {}
  return {
    // НОВЫЙ профиль (поля ещё нет в prev) → сеем КАНОНИЧНЫЕ стартовые значения с сервера
    // (а не 0): иначе новичок под авторитетностью стартовал бы с 0 кредитов/без танков.
    credits: 'credits' in prev ? prev.credits || 0 : E.START_CREDITS,
    tokens: 'tokens' in prev ? prev.tokens || 0 : E.START_TOKENS,
    goldAmmo: typeof prev.goldAmmo === 'number' ? prev.goldAmmo : E.START_GOLD_AMMO,
    owned: Array.isArray(prev.owned) ? prev.owned : [...E.STARTERS],
    modules: prev.modules && typeof prev.modules === 'object' ? prev.modules : {},
    // crew: xp/skills.* приходят с клиента (xp — прогресс), но skills (перки за кредиты) — серверные
    crew: { ...bodyCrew, skills: (prevCrew.skills && typeof prevCrew.skills === 'object') ? prevCrew.skills : {} },
    // опыт ветки — теперь исследовательская ВАЛЮТА (тратится на открытие танков) → серверный
    branchXp: prev.branchXp && typeof prev.branchXp === 'object' ? prev.branchXp : {},
    // свободный опыт — исследовательская валюта (вкладывается в любую нацию) → серверный
    freeXp: typeof prev.freeXp === 'number' ? prev.freeXp : 0,
    camoOwned: Array.isArray(prev.camoOwned) ? prev.camoOwned : [],
    skins: Array.isArray(prev.skins) ? prev.skins : ['std'],
    premTankBattles: prev.premTankBattles | 0,
    // серверные счётчики экономики (для звания/медалей/задач/рефов под авторитетностью)
    srvKills: prev.srvKills | 0,
    rankClaimedSrv: prev.rankClaimedSrv | 0,
    firstBattleRewardedSrv: !!prev.firstBattleRewardedSrv,
    medalsAwarded: Array.isArray(prev.medalsAwarded) ? prev.medalsAwarded : [],
    econTasks: prev.econTasks && typeof prev.econTasks === 'object' ? prev.econTasks : { date: '', claimed: [] },
    claimedRef: Array.isArray(prev.claimedRef) ? prev.claimedRef : [],
  }
}

// снимок кошелька/инвентаря для клиента (после покупки/клейма он принимает это авторитетно)
function wallet(p) {
  return {
    credits: p.credits || 0,
    tokens: p.tokens || 0,
    goldAmmo: p.goldAmmo || 0,
    owned: Array.isArray(p.owned) ? p.owned : [],
    modules: p.modules || {},
    crew: p.crew || { xp: 0, skills: {} },
    branchXp: p.branchXp && typeof p.branchXp === 'object' ? p.branchXp : {}, // опыт ветки — исследовательская валюта
    freeXp: typeof p.freeXp === 'number' ? p.freeXp : 0, // свободный опыт — в любую нацию
    camoOwned: Array.isArray(p.camoOwned) ? p.camoOwned : [],
    skins: Array.isArray(p.skins) ? p.skins : ['std'],
  }
}

// ---------- НАЧИСЛЕНИЕ ЗА БОЙ (вызывается из matchOver, когда флаг ВКЛ) ----------
// h.uid/h.tankId + авторитетные числа боя из sim. Кладёт кредиты/жетоны в pendingGrants
// (kind 'battle' — применяется без окна «подарок»). XP клиент копит сам по своему reward
// (xp/опыт ветки/экипажа — не деньги). result: 'victory'|'draw'|'defeat'.
export async function grantBattle(h, { result, kills = 0, damage = 0, allyScore = 0, survived = false }, roomId = '') {
  if (!h || !h.uid) return null
  return withProfileLock(h.uid, async () => {
    const p = await loadProfile(h.uid)
    if (!p) return null
    let credits = 0, tokens = 0
    const r = E.battleReward({ result, kills, damage })
    // опыт за боевые медали этого боя (повторяемый, не разовый) — складывается в общий
    // опыт боя, как на клиенте. blockedDmg/lightKills сервер из sim не знает → 0 (как ниже).
    const medalXp = E.battleMedalXp({ kills, damage, blockedDmg: 0, lightKills: 0, survived, victory: result === 'victory' })
    let m = 1
    if ((p.premiumUntil || 0) > Date.now()) m += E.PREMIUM_BONUS
    const premTank = E.isPremiumTank(h.tankId)
    if (premTank) m += E.PREM_TANK.creditMult
    credits += Math.round((r.xp + medalXp) * 1.25 * m) // кредиты ∝ опыту (база+медали), как silver=xp*1.25
    // ОПЫТ БОЯ за бой (с премиум-множителем). Делёж как у клиента: 10% в СВОБОДНЫЙ опыт
    // (в любую нацию), остаток — пополам ветка текущей нации / экипаж (экипаж клиентский).
    // Опыт ветки и свободный — серверные исследовательские валюты (тратятся на открытие).
    const xpTotal = Math.round((r.xp + medalXp) * m)
    const freeShare = Math.round(xpTotal * E.FREE_XP_SHARE)
    const rest = Math.max(0, xpTotal - freeShare)
    // crew-доля срезана (CREW_XP_SHARE 0.5→0.3): экипаж качался слишком быстро (#26),
    // высвобожденное идёт в ветку → танки открываются чуть быстрее. ЗЕРКАЛО client bankBattleXp.
    const crewShare = Math.round(rest * E.CREW_XP_SHARE)
    const branchShare = rest - crewShare
    // экипаж на МАКСЕ — крю-доля (её излишек до капа) НЕ пропадает: конвертится в КРЕДИТЫ
    // (xp×1.25, как silver) — фидбек #26 «экипаж фулл за 25 боёв, зато кредитов не хватает».
    // crew.xp ведёт клиент; берём его последнее значение. ЗЕРКАЛО client bankBattleXp.
    const crewRoom = Math.max(0, (E.CREW_MAX_LEVEL - 1) * E.CREW_LEVEL_XP - ((p.crew && p.crew.xp) || 0))
    const crewOverflow = Math.max(0, crewShare - crewRoom)
    credits += Math.round(crewOverflow * 1.25) // экипаж на максе → кредиты вместо «в никуда»
    if (freeShare > 0) p.freeXp = (typeof p.freeXp === 'number' ? p.freeXp : 0) + freeShare
    if (branchShare > 0) {
      if (!p.branchXp || typeof p.branchXp !== 'object') p.branchXp = {}
      const nat = E.tankNation(h.tankId)
      p.branchXp[nat] = (p.branchXp[nat] || 0) + branchShare
    }
    // прем-танк: каждый 10-й бой гарантированно +жетоны (детерминированно)
    if (premTank) {
      p.premTankBattles = (p.premTankBattles | 0) + 1
      if (p.premTankBattles % E.PREM_TANK.gemEvery === 0) tokens += E.PREM_TANK.gems
    }
    // бонус за ПЕРВЫЙ завершённый бой (один раз)
    if (!p.firstBattleRewardedSrv) { p.firstBattleRewardedSrv = true; credits += E.FIRST_BATTLE_BONUS }
    // звания — по серверному числу боёв (srvBattles уже +1 на входе в бой)
    const reached = E.rankIndexByBattles(p.srvBattles | 0)
    let rc = p.rankClaimedSrv | 0
    while (rc < reached) { rc++; const rk = E.RANKS[rc]; if (rk) { credits += rk.credits || 0 } } // алмазы за звания убраны — фарм только премами (#26)
    p.rankClaimedSrv = rc
    // медали: боевые по итогам + карьерные по серверным агрегатам (награда за первое получение)
    p.srvKills = (p.srvKills | 0) + (kills || 0)
    const awarded = new Set(Array.isArray(p.medalsAwarded) ? p.medalsAwarded : [])
    // blockedDmg/lightKills/rating сервер из sim не знает → эти медали под авторитетностью
    // не начисляются (мелочь, ~200-300 кр; уточним позже отдельным каналом)
    const earned = [
      ...E.battleMedalIds({ kills, damage, blockedDmg: 0, lightKills: 0, survived, victory: result === 'victory' }),
      ...E.careerMedalIds({ battles: p.srvBattles | 0, kills: p.srvKills | 0, rating: 0 }),
    ]
    for (const id of earned) {
      if (awarded.has(id)) continue
      awarded.add(id)
      const md = E.MEDAL_BY_ID[id]
      if (md && md.reward) { credits += md.reward.credits || 0 } // алмазы за медали в бою убраны — фарм только премами (#26)
    }
    p.medalsAwarded = [...awarded]
    if (credits || tokens) {
      if (!Array.isArray(p.pendingGrants)) p.pendingGrants = []
      p.pendingGrants.push({ id: 'battle.' + roomId + '.' + h.uid + '.' + Date.now() + '.' + ++grantSeq, kind: 'battle', credits, tokens, tanks: [], at: Date.now() })
    }
    await saveProfile(h.uid, p)
    return { credits, tokens }
  })
}

// ---------- ПОКУПКИ/КЛЕЙМЫ (валидируются на сервере; флаг проверяет вызывающий) ----------
const ok = (p, extra = {}) => ({ ok: true, ...wallet(p), ...extra })
const err = (e) => ({ ok: false, error: e })

export function buyTank(uid, tankId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    const t = E.RESEARCH_TANKS[tankId]
    if (!t) return err('bad-tank') // премиум — только за ⭐, не тут
    if (!Array.isArray(p.owned)) p.owned = [...E.STARTERS]
    if (p.owned.includes(tankId)) return ok(p, { already: true })
    // гейт: предыдущий куплен + его модули 5/5 + опыт ветки ≥ стоимости исследования
    if (!E.canUnlockTank(p.owned, p.modules || {}, tankId, p.branchXp || {})) return err('locked')
    const cost = E.tankCost(t.tier)
    if ((p.credits || 0) < cost) return err('funds')
    const xpCost = E.tankResearchXp(t.tier)
    // списываем И опыт ветки, И кредиты (canUnlockTank уже проверил, что опыта хватает)
    p.credits -= cost
    if (!p.branchXp || typeof p.branchXp !== 'object') p.branchXp = {}
    p.branchXp[t.nation] = Math.max(0, (p.branchXp[t.nation] || 0) - xpCost)
    p.owned.push(tankId)
    await saveProfile(uid, p)
    logEvent(uid, 'buy_tank', { tank: tankId, cost, xp: xpCost })
    return ok(p, { bought: tankId })
  })
}

// продажа танка: возврат кредитов (tankSellPrice). canSellTank гарантирует, что
// продаётся не премиум, не боевой и не фронтир ветки → дерево не ломается. Опыт ветки
// при продаже НЕ возвращаем (это исследование, не покупка).
export function sellTank(uid, tankId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    if (!Array.isArray(p.owned)) p.owned = [...E.STARTERS]
    if (!E.canSellTank(p.owned, tankId, p.selectedTank)) return err('cant-sell')
    const refund = E.tankSellPrice(E.tankTier(tankId))
    p.owned = p.owned.filter((id) => id !== tankId)
    p.credits = (p.credits || 0) + refund
    await saveProfile(uid, p)
    logEvent(uid, 'sell_tank', { tank: tankId, refund })
    return ok(p, { sold: tankId, refund })
  })
}

// вложить свободный опыт в ветку ЛЮБОЙ нации (исследовательская валюта). Клиент шлёт
// nation + amount; сервер клампит к доступному и переносит freeXp → branchXp[nation].
export function spendFreeXp(uid, nation, amount) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    const nat = String(nation || '')
    if (!E.NATION_IDS.includes(nat)) return err('bad-arg')
    const have = typeof p.freeXp === 'number' ? p.freeXp : 0
    const amt = clampInt(amount, 0, have)
    if (amt <= 0) return err('funds')
    p.freeXp = have - amt
    if (!p.branchXp || typeof p.branchXp !== 'object') p.branchXp = {}
    p.branchXp[nat] = (p.branchXp[nat] || 0) + amt
    await saveProfile(uid, p)
    logEvent(uid, 'spend_free_xp', { nation: nat, amount: amt })
    return ok(p)
  })
}

export function upgradeModule(uid, tankId, modId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    if (!E.tankExists(tankId) || !E.MODULE_SLOTS.includes(modId)) return err('bad-arg')
    if (!Array.isArray(p.owned)) p.owned = [...E.STARTERS]
    if (!p.owned.includes(tankId)) return err('not-owned')
    const lvl = E.modLevel(p.modules, tankId, modId)
    if (lvl >= E.MODULE_MAX) return err('maxed')
    const cost = E.moduleCost(E.tankTier(tankId), lvl + 1)
    if ((p.credits || 0) < cost) return err('funds')
    p.credits -= cost
    if (!p.modules || typeof p.modules !== 'object') p.modules = {}
    if (!p.modules[tankId]) p.modules[tankId] = {}
    p.modules[tankId][modId] = lvl + 1
    await saveProfile(uid, p)
    return ok(p)
  })
}

export function upgradeCrewPerk(uid, memberId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    if (!E.CREW_MEMBER_IDS.includes(memberId)) return err('bad-arg')
    if (!p.crew || typeof p.crew !== 'object') p.crew = { xp: 0, skills: {} }
    if (!p.crew.skills || typeof p.crew.skills !== 'object') p.crew.skills = {}
    const lvl = p.crew.skills[memberId] || 0
    if (lvl >= E.CREW_PERK_MAX) return err('maxed')
    if (E.crewPointsFree(p.crew) < 1) return err('no-points')
    const cost = E.crewPerkCost(lvl)
    if ((p.credits || 0) < cost) return err('funds')
    p.credits -= cost
    p.crew.skills[memberId] = lvl + 1
    await saveProfile(uid, p)
    return ok(p)
  })
}

export function buyCamo(uid, tankId, camoId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    if (!E.tankExists(tankId) || !(camoId in E.CAMO_COST) || !camoId) return err('bad-arg')
    if (!Array.isArray(p.camoOwned)) p.camoOwned = []
    const key = `${tankId}_${camoId}`
    if (!p.camoOwned.includes(key)) {
      const cost = E.CAMO_COST[camoId] || 0
      if ((p.tokens || 0) < cost) return err('funds')
      p.tokens -= cost
      p.camoOwned.push(key)
    }
    if (!p.camos || typeof p.camos !== 'object') p.camos = {}
    p.camos[tankId] = camoId // надеваем
    await saveProfile(uid, p)
    return ok(p, { camos: p.camos })
  })
}

export function buySkin(uid, skinId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    if (!(skinId in E.SKIN_COST)) return err('bad-arg')
    if (!Array.isArray(p.skins)) p.skins = ['std']
    if (!p.skins.includes(skinId)) {
      const cost = E.SKIN_COST[skinId] || 0
      if ((p.tokens || 0) < cost) return err('funds')
      p.tokens -= cost
      p.skins.push(skinId)
    }
    p.skin = skinId
    await saveProfile(uid, p)
    return ok(p)
  })
}

export function buyGoldAmmo(uid, packId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    const pack = E.GOLD_AMMO_PACKS[packId]; if (!pack) return err('bad-arg')
    if ((p.tokens || 0) < pack.costTokens) return err('funds')
    p.tokens -= pack.costTokens
    p.goldAmmo = (p.goldAmmo || 0) + pack.amount
    await saveProfile(uid, p)
    return ok(p)
  })
}

// расход голд-снарядов за бой (клиент шлёт число использованных; сервер клампит к owned,
// в минус не уходит). Голд-ammo — мелкий расходник, не валюта — доверие к счётчику ок.
export function spendGoldAmmo(uid, n) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    const use = Math.max(0, Math.min(p.goldAmmo || 0, Math.round(+n || 0)))
    p.goldAmmo = (p.goldAmmo || 0) - use
    await saveProfile(uid, p)
    return ok(p, { used: use })
  })
}

// ящик (лутбокс): тратит жетоны → кредиты + шанс камуфляжа. RNG на СЕРВЕРЕ. ЗЕРКАЛО
// CRATES из client/src/components/Shop.vue.
// gain — ДИАПАЗОН кредитов [min,max], катится при вскрытии (фидбек #26: «пусть падает по
// разному»). ЗЕРКАЛО client Shop.vue CRATES. rollCrateGain совместим со старым числом.
const CRATES = { c1: { costTokens: 15, gain: [400, 900], drop: 0.1, bonus: 3 }, c2: { costTokens: 40, gain: [1000, 2500], drop: 0.35, bonus: 5 }, c3: { costTokens: 75, gain: [3000, 5000], drop: 1, bonus: 8 } }
const rollCrateGain = (g) => (Array.isArray(g) ? g[0] + Math.floor(Math.random() * (g[1] - g[0] + 1)) : g)
export function buyCrate(uid, crateId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    const c = CRATES[crateId]; if (!c) return err('bad-arg')
    if ((p.tokens || 0) < c.costTokens) return err('funds')
    p.tokens -= c.costTokens
    const gain = rollCrateGain(c.gain)
    p.credits = (p.credits || 0) + gain
    let camo = null, tokens = 0
    if (Math.random() < c.drop) { camo = dropRandomCamo(p); if (!camo) { tokens = c.bonus || 3; p.tokens += tokens } }
    await saveProfile(uid, p)
    return ok(p, { reward: { credits: gain, camo, tokens } })
  })
}

// клейм задачи дня. Завершённость гейтит клиентский UI (он знает lightKills/blocked,
// которых сервер из sim не видит); сервер обеспечивает ИДЕМПОТЕНТНОСТЬ (раз в сутки на
// задачу) и владеет начислением. Задачи дают копейки (~1400/день максимум на все 3) —
// на чит «миллионы» не влияет, поэтому завершённость серверно не перепроверяем.
export function claimTask(uid, taskId) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    const day = dayStr()
    if (!p.econTasks || p.econTasks.date !== day) p.econTasks = { date: day, claimed: [] }
    if (!Array.isArray(p.econTasks.claimed)) p.econTasks.claimed = []
    const task = E.tasksOfDay(day).find((t) => t.id === taskId)
    if (!task) return err('not-today')
    if (p.econTasks.claimed.includes(taskId)) return ok(p, { already: true })
    p.econTasks.claimed.push(taskId)
    p.credits = (p.credits || 0) + (task.credits || 0)
    p.tokens = (p.tokens || 0) + (task.tokens || 0)
    await saveProfile(uid, p)
    return ok(p, { reward: { credits: task.credits || 0, tokens: task.tokens || 0 } })
  })
}

// клейм рубежа рефералов — число рекрутов ведёт сервер (prev.referrals)
export function claimRefMilestone(uid, idx) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    const m = E.REF_MILESTONES[idx]; if (!m) return err('bad-arg')
    if (!Array.isArray(p.claimedRef)) p.claimedRef = []
    if (p.claimedRef.includes(idx)) return ok(p, { already: true })
    const refs = Array.isArray(p.referrals) ? p.referrals.length : 0
    if (refs < m.need) return err('not-enough')
    p.claimedRef.push(idx)
    let credits = m.credits || 0
    let tokens = m.tokens || 0
    let camo = null
    if (m.crate) { camo = dropRandomCamo(p); if (!camo) tokens += 15 } // всё открыто → компенсируем жетонами
    p.credits = (p.credits || 0) + credits
    p.tokens = (p.tokens || 0) + tokens
    await saveProfile(uid, p)
    return ok(p, { reward: { credits, tokens, camo } })
  })
}

// ---------- ДОНАТ-КРЕЙТЫ (крутка за Telegram Stars): честный ролл по нации ----------
// У каждой нации t4-прем + t8-прем (= GRANT_TANKS). Шансы ОПУБЛИКОВАНЫ (CRATE_ODDS).
// Pity: CRATE_PITY-я крутка без t8 → гарантированный t8. Дубль уже-открытого танка →
// кристаллы. Ролл вызывается в /api/grants-apply (авторитетно, под локом профиля): p
// мутируется (баланс/owned/camoOwned/pity), клиент адаптирует результат + показывает ревил.
const CRATE_TANKS = {
  ussr: { t4: 't28', t8: 't54' },
  ger: { t4: 'pz4h', t8: 'maus' },
  usa: { t4: 'ram', t8: 'sper' },
}
export const CRATE_NATIONS = Object.keys(CRATE_TANKS)
export const CRATE_STARS = 10 // цена одной крутки (★) — ЗЕРКАЛО payments.PRODUCTS.crate_*.stars
export const CRATE_PITY = 15 // круток без t8 → гарантия t8
export const CRATE_ODDS = { t8: 0.005, t4: 0.03, camo: 0.12, crystals: 0.2, freeXp: 0.15 } // остальное (0.495) → кредиты
const CRATE_DUP = { t8: 250, t4: 100 } // дубль танка → столько кристаллов (tokens)
const CRATE_FREEXP = [150, 500] // диапазон свободного опыта в крейте (исследовательская валюта)
export const CRYSTAL_TO_FREEXP = 10 // ОБМЕН: 1 кристалл = 10 своб. опыта (10★=100, фидбек владельца «качать за кристаллы»)
const crnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))

// мутирует p, возвращает дескриптор награды для ревила: { nation, type, tank?, tier?, camo?, crystals?, credits? }
export function rollNationCrate(p, nation) {
  const pool = CRATE_TANKS[nation]
  if (!pool) return null
  if (!p.cratePity || typeof p.cratePity !== 'object') p.cratePity = {}
  const pulls = (p.cratePity[nation] | 0) + 1 // круток с последнего t8, включая текущую
  const o = CRATE_ODDS
  let kind
  if (pulls >= CRATE_PITY) kind = 't8' // pity-гарант
  else {
    const r = Math.random()
    if (r < o.t8) kind = 't8'
    else if (r < o.t8 + o.t4) kind = 't4'
    else if (r < o.t8 + o.t4 + o.camo) kind = 'camo'
    else if (r < o.t8 + o.t4 + o.camo + o.crystals) kind = 'crystals'
    else if (r < o.t8 + o.t4 + o.camo + o.crystals + o.freeXp) kind = 'freeXp'
    else kind = 'credits'
  }
  p.cratePity[nation] = kind === 't8' ? 0 : pulls // t8 сбрасывает pity-счётчик

  const reward = { nation, type: kind }
  if (kind === 't8' || kind === 't4') {
    const tankId = pool[kind]
    if (!Array.isArray(p.owned)) p.owned = []
    if (p.owned.includes(tankId)) {
      const c = CRATE_DUP[kind] // уже есть → дубль в кристаллы
      p.tokens = (p.tokens || 0) + c
      reward.type = 'dup'; reward.tank = tankId; reward.tier = kind; reward.crystals = c
    } else {
      p.owned.push(tankId)
      reward.tank = tankId; reward.tier = kind
    }
  } else if (kind === 'camo') {
    const camo = dropRandomCamo(p)
    if (camo) reward.camo = camo
    else { const c = 60; p.tokens = (p.tokens || 0) + c; reward.type = 'crystals'; reward.crystals = c } // всё камо открыто → кристаллы
  } else if (kind === 'crystals') {
    const c = crnd(20, 60); p.tokens = (p.tokens || 0) + c; reward.crystals = c
  } else if (kind === 'freeXp') {
    const c = crnd(CRATE_FREEXP[0], CRATE_FREEXP[1]); p.freeXp = (typeof p.freeXp === 'number' ? p.freeXp : 0) + c; reward.freeXp = c
  } else {
    const c = crnd(2000, 9000); p.credits = (p.credits || 0) + c; reward.credits = c
  }
  return reward
}

// ОБМЕН кристаллов (tokens) на свободный опыт: 1 кристалл → CRYSTAL_TO_FREEXP опыта.
// «Качать за кристаллы, если опыта не хватает» (фидбек владельца). Серверно-авторитетно.
export function convertToFreeXp(uid, crystals) {
  return withProfileLock(uid, async () => {
    const p = await loadProfile(uid); if (!p) return err('no-profile')
    const have = typeof p.tokens === 'number' ? p.tokens : 0
    const c = clampInt(crystals, 0, have)
    if (c <= 0) return err('funds')
    p.tokens = have - c
    p.freeXp = (typeof p.freeXp === 'number' ? p.freeXp : 0) + c * CRYSTAL_TO_FREEXP
    await saveProfile(uid, p)
    logEvent(uid, 'convert_free_xp', { crystals: c, freeXp: c * CRYSTAL_TO_FREEXP })
    return ok(p)
  })
}

// дроп случайного ЗАПЕРТОГО камуфляжа — ТОЛЬКО на АКТИВНУЮ технику игрока: выбранный
// танк, затем недавние из истории, и лишь как запас — прочие купленные. Иначе дроп
// уходил на стартеры чужих наций (которыми не играешь) и ощущался как «на чужой танк».
function dropRandomCamo(p) {
  if (!Array.isArray(p.camoOwned)) p.camoOwned = []
  const owned = Array.isArray(p.owned) ? p.owned : []
  const recent = Array.isArray(p.history) ? p.history.map((h) => h && h.tank).filter(Boolean) : []
  const order = []
  const seen = new Set()
  for (const tid of [p.selectedTank, ...recent, ...owned]) {
    // премы без камо-системы — камо на них пропадает впустую (фидбек #26)
    if (tid && owned.includes(tid) && !seen.has(tid) && !E.isPremiumTank(tid)) { seen.add(tid); order.push(tid) }
  }
  const cids = Object.keys(E.CAMO_COST).filter(Boolean)
  for (const tid of order) {
    const pool = cids.filter((cid) => !p.camoOwned.includes(`${tid}_${cid}`))
    if (pool.length) {
      const cid = pool[Math.floor(Math.random() * pool.length)] // сервер (Node) — Math.random ок
      const pick = `${tid}_${cid}`
      p.camoOwned.push(pick)
      return pick
    }
  }
  return null
}

// ---------- НОРМАЛИЗАЦИЯ «невозможных» профилей (для админ-эндпоинта, dry-run) ----------
// Стрипает из owned ИССЛЕДУЕМЫЕ танки, которые НЕ может оправдать серверное число боёв:
// потолок заработка ≈ srvBattles × per-battle + админ-кредиты (передаются вызывающим, т.к.
// журнал выдач — кольцо). По умолчанию НЕ трогает кредиты (админ может дарить их тестерам).
// Премиум-танки не трогаем никогда (они только за ⭐, не чит).
// ЩЕДРЫЙ потолок честного заработка за бой (премиум + отличный бой + медали + дейлики
// амортизированно). Намеренно завышен: нормализация должна ловить ТОЛЬКО вопиющее
// (миллионы кредитов / топ-тир за 15 боёв) и НИКОГДА не резать честного игрока —
// ложное срабатывание хуже, чем пропущенный пограничный чит. Тонкая настройка — через
// dry-run админ-эндпоинта (+ adminCredits на тестеров с подарками).
const MAX_CREDITS_PER_BATTLE = 3000
export function diagnoseProfile(p, adminCredits = 0) {
  const srvBattles = p.srvBattles | 0
  const owned = Array.isArray(p.owned) ? p.owned : []
  const earnable = E.START_CREDITS + srvBattles * MAX_CREDITS_PER_BATTLE + (adminCredits || 0)
  // суммарная стоимость исследуемых купленных танков (старшие тиры — дорогие)
  const researchOwned = owned.filter((id) => E.RESEARCH_TANKS[id] && !E.STARTERS.includes(id))
  const spentOnTanks = researchOwned.reduce((s, id) => s + E.tankCost(E.tankTier(id)), 0)
  const impossible = spentOnTanks > earnable * 1.05 // 5% запас
  return { srvBattles, earnable, spentOnTanks, researchOwned, impossible }
}

// оставить из owned столько ИССЛЕДУЕМЫХ танков, сколько влезает в бюджет (от младших
// тиров к старшим, по веткам — чтобы не разорвать цепочку). Стартеры/премиум — всегда.
export function trimResearchByBudget(owned, budget) {
  const list = Array.isArray(owned) ? owned : []
  const keep = []
  const research = []
  for (const id of list) {
    if (E.RESEARCH_TANKS[id] && !E.STARTERS.includes(id)) research.push(id)
    else keep.push(id) // стартеры, премиум, прочее — не трогаем
  }
  research.sort((a, b) => E.tankTier(a) - E.tankTier(b)) // младшие первыми
  let spent = 0
  for (const id of research) {
    const c = E.tankCost(E.tankTier(id))
    if (spent + c <= budget) { spent += c; keep.push(id) }
    // не влез — дропаем (и всё старше тоже не пройдёт по бюджету)
  }
  return keep
}
