// ============ PANZER TG — мета-данные (порт дизайн-прототипа ui.jsx) ============
// Каждый танк несёт боевой архетип classId (light/medium/heavy из config
// TANK_CLASSES) — он управляет поведением в Pixi-бою. Поля name/tier/cls/desc/
// stats/cost — для мета-экранов (ангар/прокачка).

import { t } from '../i18n.js'

// привязать локализованные поля к объекту через геттеры: при чтении o.name (и т.п.)
// берётся строка из словаря активного языка (locales/game.js). getters —
// { поле: (o) => 'ключ-в-словаре' }. Это даёт двуязычие без правок компонентов:
// они по-прежнему читают tank.name / medal.desc / rank.name, но значение —
// локализованное. Язык фиксируется на старте (initLocale в main.js).
function defLoc(obj, getters) {
  for (const field in getters) {
    const keyOf = getters[field]
    Object.defineProperty(obj, field, { enumerable: true, configurable: true, get: () => t(keyOf(obj)) })
  }
  return obj
}

const CLS = { Лёгкий: 'light', Средний: 'medium', Тяжёлый: 'heavy' }
const withClass = (tk) =>
  defLoc({ ...tk, classId: CLS[tk.cls] || 'medium' }, {
    name: (o) => `game.tanks.${o.id}.name`,
    desc: (o) => `game.tanks.${o.id}.desc`,
  })

export const NATIONS = [{ id: 'ussr' }, { id: 'ger' }, { id: 'usa' }].map((n) => defLoc(n, { label: (o) => `game.nations.${o.id}` }))

// Статы 0..10 (dmg/rof/spd/mnv/view/hp) — шкала растянута на 10 уровней
// до новейших машин: тир-1 — честное днище (1-3), топ-10 — 9-10.
// Профильные просадки только у тяжёлых: темп/ход в обмен на dmg+hp.
// Из них же считаются РЕАЛЬНЫЕ боевые статы (combatStats) — у каждого
// танка свой бой, а не общий по классу.
export const MAX_TIER = 10
export const TANKS_BY_NATION = {
  ussr: [
    { id: 't26', tier: 1, cls: 'Лёгкий', stats: { dmg: 1, rof: 3, spd: 3, mnv: 3, view: 2, hp: 1 } },
    { id: 'bt7', tier: 2, cls: 'Лёгкий', stats: { dmg: 2, rof: 4, spd: 5, mnv: 4, view: 3, hp: 2 }, cost: 200 },
    { id: 't34', tier: 3, cls: 'Средний', stats: { dmg: 3, rof: 5, spd: 5, mnv: 4, view: 4, hp: 3 }, cost: 600 },
    { id: 't3485', tier: 4, cls: 'Средний', stats: { dmg: 4, rof: 5, spd: 5, mnv: 5, view: 5, hp: 4 }, cost: 1500 },
    { id: 'kv1', tier: 5, cls: 'Тяжёлый', stats: { dmg: 6, rof: 3, spd: 3, mnv: 3, view: 4, hp: 6 }, cost: 25000 },
    { id: 'is2', tier: 6, cls: 'Тяжёлый', stats: { dmg: 7, rof: 3, spd: 4, mnv: 4, view: 5, hp: 7 }, cost: 70000 },
    { id: 't72', tier: 7, cls: 'Средний', stats: { dmg: 7, rof: 6, spd: 7, mnv: 6, view: 7, hp: 6 }, cost: 200000 },
    { id: 't90', tier: 8, cls: 'Средний', stats: { dmg: 8, rof: 7, spd: 8, mnv: 7, view: 9, hp: 7 }, cost: 550000 },
    { id: 't80u', tier: 9, cls: 'Средний', stats: { dmg: 8, rof: 7, spd: 9, mnv: 8, view: 8, hp: 7 }, cost: 1400000 },
    { id: 't14', tier: 10, cls: 'Тяжёлый', stats: { dmg: 10, rof: 7, spd: 8, mnv: 7, view: 10, hp: 10 }, cost: 3500000 },
  ],
  ger: [
    { id: 'pz2', tier: 1, cls: 'Лёгкий', stats: { dmg: 1, rof: 4, spd: 3, mnv: 3, view: 2, hp: 1 } },
    { id: 'pz3', tier: 2, cls: 'Лёгкий', stats: { dmg: 2, rof: 4, spd: 4, mnv: 4, view: 3, hp: 2 }, cost: 200 },
    { id: 'pz4', tier: 3, cls: 'Средний', stats: { dmg: 3, rof: 4, spd: 4, mnv: 4, view: 4, hp: 3 }, cost: 600 },
    { id: 'pnt', tier: 4, cls: 'Средний', stats: { dmg: 4, rof: 4, spd: 5, mnv: 4, view: 6, hp: 4 }, cost: 1500 },
    { id: 'tgr', tier: 5, cls: 'Тяжёлый', stats: { dmg: 6, rof: 3, spd: 3, mnv: 3, view: 5, hp: 6 }, cost: 25000 },
    { id: 'tgr2', tier: 6, cls: 'Тяжёлый', stats: { dmg: 7, rof: 3, spd: 4, mnv: 3, view: 5, hp: 7 }, cost: 70000 },
    { id: 'leo1', tier: 7, cls: 'Средний', stats: { dmg: 7, rof: 6, spd: 8, mnv: 7, view: 7, hp: 5 }, cost: 200000 },
    { id: 'leo2', tier: 8, cls: 'Средний', stats: { dmg: 8, rof: 7, spd: 8, mnv: 7, view: 9, hp: 8 }, cost: 550000 },
    { id: 'leo2a7', tier: 9, cls: 'Средний', stats: { dmg: 9, rof: 7, spd: 8, mnv: 7, view: 9, hp: 8 }, cost: 1400000 },
    { id: 'kf51', tier: 10, cls: 'Средний', stats: { dmg: 10, rof: 8, spd: 9, mnv: 8, view: 10, hp: 8 }, cost: 3500000 },
  ],
  usa: [
    { id: 'm2l', tier: 1, cls: 'Лёгкий', stats: { dmg: 1, rof: 4, spd: 4, mnv: 3, view: 2, hp: 1 } },
    { id: 'stu', tier: 2, cls: 'Лёгкий', stats: { dmg: 2, rof: 5, spd: 5, mnv: 5, view: 3, hp: 2 }, cost: 200 },
    { id: 'sher', tier: 3, cls: 'Средний', stats: { dmg: 3, rof: 4, spd: 4, mnv: 4, view: 4, hp: 3 }, cost: 600 },
    { id: 'e8', tier: 4, cls: 'Средний', stats: { dmg: 4, rof: 5, spd: 5, mnv: 5, view: 5, hp: 4 }, cost: 1500 },
    { id: 'per', tier: 5, cls: 'Тяжёлый', stats: { dmg: 5, rof: 4, spd: 4, mnv: 4, view: 5, hp: 5 }, cost: 25000 },
    { id: 'm48', tier: 6, cls: 'Средний', stats: { dmg: 6, rof: 5, spd: 5, mnv: 5, view: 6, hp: 5 }, cost: 70000 },
    { id: 'm60', tier: 7, cls: 'Средний', stats: { dmg: 7, rof: 6, spd: 6, mnv: 6, view: 7, hp: 6 }, cost: 200000 },
    { id: 'abr', tier: 8, cls: 'Тяжёлый', stats: { dmg: 9, rof: 6, spd: 7, mnv: 6, view: 9, hp: 9 }, cost: 550000 },
    { id: 'm1a2', tier: 9, cls: 'Тяжёлый', stats: { dmg: 9, rof: 6, spd: 7, mnv: 7, view: 9, hp: 9 }, cost: 1400000 },
    { id: 'abrx', tier: 10, cls: 'Тяжёлый', stats: { dmg: 10, rof: 8, spd: 8, mnv: 7, view: 10, hp: 9 }, cost: 3500000 },
  ],
}

// плоские каталоги
// Премиум-техника: покупается за ⭐ (Telegram Stars, см. payments PRODUCTS pt_<id>),
// НЕ исследуется. В бою даёт бонусы (PREM_TANK: +5% опыт/кредиты, КАЖДЫЙ 10-й бой +10 💎).
// nation/tier — для тир-брекета и группировки; спрайт <id>.png уже в sprites/tanks.
// gemEvery — кристаллы начисляются ДЕТЕРМИНИРОВАННО раз в N боёв на премиуме (а не
// рандомом 1/10 — рандом стрик'ал: игрок мог отыграть 15+ боёв без кристаллов и решить,
// что обещание из карточки не выполняется).
export const PREM_TANK = { xpMult: 0.05, creditMult: 0.05, gemEvery: 10, gems: 10 }
export const PREMIUM_TANKS = [
  { id: 't28', nation: 'ussr', tier: 4, cls: 'Средний', premium: true, legend: true, stars: 99, stats: { dmg: 4, rof: 6, spd: 4, mnv: 4, view: 5, hp: 5 } },
  { id: 't54', nation: 'ussr', tier: 8, cls: 'Средний', premium: true, stars: 99, stats: { dmg: 8, rof: 7, spd: 7, mnv: 6, view: 8, hp: 8 } },
  { id: 'pz4h', nation: 'ger', tier: 4, cls: 'Средний', premium: true, stars: 99, stats: { dmg: 4, rof: 5, spd: 5, mnv: 4, view: 5, hp: 4 } },
  { id: 'maus', nation: 'ger', tier: 8, cls: 'Тяжёлый', premium: true, stars: 99, stats: { dmg: 8, rof: 2, spd: 2, mnv: 2, view: 5, hp: 8 } },
  { id: 'ram', nation: 'usa', tier: 4, cls: 'Средний', premium: true, stars: 99, stats: { dmg: 3, rof: 6, spd: 5, mnv: 5, view: 4, hp: 4 } },
  { id: 'sper', nation: 'usa', tier: 8, cls: 'Тяжёлый', premium: true, stars: 99, stats: { dmg: 9, rof: 5, spd: 5, mnv: 4, view: 6, hp: 9 } },
].map(withClass) // withClass: classId + локализованные геттеры name/desc (прем-танки тоже)
export const TANKS = [...Object.values(TANKS_BY_NATION).flat(), ...PREMIUM_TANKS].map(withClass)
export const TANK_BY_ID = Object.fromEntries(TANKS.map((t) => [t.id, t]))
export const tanksOfNation = (nation) => (TANKS_BY_NATION[nation] || []).map(withClass)
export const premiumOfNation = (nation) => PREMIUM_TANKS.filter((t) => t.nation === nation).map(withClass)
// танк, разблокированный с самого начала в каждой нации (tier 1)
export const STARTERS = ['t26', 'pz2', 'm2l']
export const nationOf = (tankId) =>
  Object.keys(TANKS_BY_NATION).find((n) => TANKS_BY_NATION[n].some((t) => t.id === tankId)) ||
  (TANK_BY_ID[tankId] && TANK_BY_ID[tankId].nation) || // прем-танки лежат вне TANKS_BY_NATION
  'ussr'

export const STAT_LABELS = {}
for (const k of ['dmg', 'rof', 'spd', 'mnv', 'view', 'hp']) Object.defineProperty(STAT_LABELS, k, { enumerable: true, get: () => t(`game.stats.${k}`) })

// ---------- реальные боевые статы танка (deg-форма для движка) ----------
// Сектор/линия сведения/допуск — характер класса; остальное считается из
// дисплейных статов 0..10, так что КАЖДЫЙ танк в бою ощущается по-своему.
import { TANK_CLASSES } from './config.js'
// КРУПНЫЕ ЧИСЛА (как в больших танковых играх): HP сильно вверх (×HP_SCALE),
// урон слабее (×DMG_SCALE) → бои «мясистее», ~6-8 выстрелов на килл. Базовые
// аркадные числа в формулах домножаются на масштаб. ТЕ ЖЕ множители зашиты в
// hp/damage классов в shared/config.js и client/src/game/config.js (TANK_CLASSES,
// статы ботов) — менять СИНХРОННО, иначе боты и игроки разъедутся по шкале.
export const HP_SCALE = 14.5
// DMG_SCALE = HP_SCALE → убийство за ~3-4 выстрела (классический темп). Было 7.25
// («мясистее», ~6-8) — оказалось «урона не хватает, тяжело убивать». Урон ИГРОКА
// (combatStats) множится здесь; урон БОТОВ — в TANK_CLASSES.damage (config.js, при
// желании синхронить отдельным серверным деплоем; сейчас боты бьют мягче — в плюс игроку).
export const DMG_SCALE = 14.5
export function combatStats(tank) {
  const s = tank.stats
  const cls = TANK_CLASSES[tank.classId] || TANK_CLASSES.medium
  const maxSpeed = 42 + s.spd * 8.5 // танки тяжелее, не «гоночные» (порезано ~28%)
  return {
    ...cls, // id/label/sectorDeg/sweepPeriod/toleranceDeg/range — профиль класса
    damage: Math.round((14 + s.dmg * 4.5) * DMG_SCALE),
    reload: +(6.4 - s.rof * 0.5).toFixed(2),
    maxSpeed,
    accel: Math.round(maxSpeed * 1.1), // разгон ~1с до полной — масса чувствуется
    turnRate: +(0.55 + s.mnv * 0.12).toFixed(2), // танк, а не машинка
    vision: 240 + s.view * 26, // обзор урезан ~15% (был 280+view*32 — «слишком далеко»); под плейтест
    hp: Math.round((60 + s.hp * 14) * HP_SCALE),
  }
}

// РЕАЛЬНОЕ боевое число статы для ТТХ-панели (крупные числа вместо шкалы 1-10 —
// чтобы танки явно различались и совпадали с боем). cs — combatStats/loadoutStats.
// Темп — выстр/мин, скорость — ед/с, манёвр — °/с, обзор — дальность, урон/HP — как в бою.
export function statReal(cs, key) {
  switch (key) {
    case 'dmg':
      return Math.round(cs.damage)
    case 'rof':
      return +(60 / cs.reload).toFixed(1)
    case 'spd':
      return Math.round(cs.maxSpeed)
    case 'mnv':
      return Math.round((cs.turnRate * 180) / Math.PI)
    case 'view':
      return Math.round(cs.vision)
    case 'hp':
      return Math.round(cs.hp)
    default:
      return 0
  }
}

// ---------- модули: 5 слотов × 3 уровня (штатный → топ) ----------
export const MODULE_DEFS = ['gun', 'tur', 'eng', 'trk', 'rad'].map((id) =>
  defLoc({ id }, {
    label: (o) => `game.modules.${o.id}.label`,
    levels: (o) => `game.modules.${o.id}.levels`,
    stats: (o) => `game.modules.${o.id}.stats`,
  }),
)

// множители на боевые статы класса по уровню модуля (1=штатный)
export const MODULE_COMBAT = {
  gun: [1, 1.1, 1.22], // урон
  tur: [1, 1.08, 1.18], // прочность (HP танка в бою)
  eng: [1, 1.08, 1.16], // скорость + ускорение
  trk: [1, 1.08, 1.16], // поворот
  rad: [1, 1.12, 1.24], // обзор
}

// ---------- экипаж: 5 специалистов, у каждого перк 0..3 ранга ----------
// Ранг перка стоит 1 очко навыка (+1 очко за уровень экипажа после первого,
// см. store) и кредиты. Очков меньше, чем рангов всего, — выбор имеет цену.
const CREW_ICONS = { cmd: 'star', gnr: 'gun', lod: 'ammo', drv: 'trk', rad: 'rad' }
export const CREW_MEMBERS = ['cmd', 'gnr', 'lod', 'drv', 'rad'].map((id) =>
  defLoc({ id, icon: CREW_ICONS[id] }, {
    role: (o) => `game.crew.${o.id}.role`,
    name: (o) => `game.crew.${o.id}.name`,
    perk: (o) => `game.crew.${o.id}.perk`,
    effect: (o) => `game.crew.${o.id}.effect`,
  }),
)
export const CREW_PERK_MAX = 3
export const CREW_PERK_COSTS = [800, 2000, 4500] // кредиты за ранг I/II/III
export const crewPerkCost = (curLevel) => CREW_PERK_COSTS[curLevel] ?? Infinity

// ---------- рефералы (взвод/друзья — через реальные Telegram deep-link'и, без фейка) ----------
export const REF_MILESTONES = [
  { need: 1, credits: 500, tokens: 0 },
  // оф-ящик: реальный дроп камуфляжа + кредиты+жетоны (crate:true в claimRefMilestone)
  { need: 3, credits: 1000, tokens: 5, crate: true },
  { need: 5, credits: 0, tokens: 25 },
].map((m, i) => {
  Object.defineProperty(m, 'label', { enumerable: true, get: () => t('game.refMilestones')[i] })
  return m
})

// модули дёшевы (быстрый апгрейд, не гейт прогресса) — вес прогрессии на цене
// танка. Прокачка 5 модулей = 600×tier кредитов (было 5250×tier).
export const moduleCost = (tier, level) => tier * (level === 2 ? 40 : 80)

// ---------- голдовые снаряды ----------
export const GOLD_AMMO_MULT = 1.35 // множитель урона голдового снаряда
export const GOLD_AMMO_PACKS = [
  { id: 'g1', amount: 10, costTokens: 12 },
  { id: 'g2', amount: 30, costTokens: 30 },
]

// ---------- ежедневные задачи (3 в день, ротация по дате) ----------
// key — счётчик из итогов боя (см. bankTaskProgress): damage/kills/lightKills/
// blocked/wins/battles. Блок бронёй копится только в боях с ботами (в PvP
// брони пока нет).
export const DAILY_TASKS = [
  { id: 'dmg600', goal: 4500, key: 'damage', credits: 400 },
  { id: 'kills3', goal: 3, key: 'kills', credits: 500 },
  { id: 'light2', goal: 2, key: 'lightKills', tokens: 5 },
  { id: 'block3', goal: 3, key: 'blocked', credits: 350 },
  { id: 'win1', goal: 1, key: 'wins', credits: 600 },
  { id: 'battles3', goal: 3, key: 'battles', credits: 300 },
].map((d) => defLoc(d, { label: (o) => `game.tasks.${o.id}` }))
export const TASKS_PER_DAY = 3

// детерминированный выбор трёх задач дня (у всех игроков одинаковые)
export function tasksOfDay(dayString) {
  const seed = [...String(dayString)].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const start = seed % DAILY_TASKS.length
  return [0, 1, 2].map((i) => DAILY_TASKS[(start + i * 2) % DAILY_TASKS.length])
}

// ---------- ежедневный вход (цикл 7 дней) ----------
export const DAILY_REWARDS = [
  { credits: 200 },
  { credits: 350 },
  { tokens: 5 },
  { credits: 600 },
  { credits: 800 },
  { tokens: 10 },
  { credits: 1200, tokens: 10, gold: 5 },
]

// ---------- камуфляжи (платные скины, видны всем) ----------
// tint — базовый оттенок (фоллбэк и цвет «точки» в ангаре); camo — настоящий
// узор поверх спрайта (см. game/camo.js): spots — пятна, digital — пиксельная
// цифра, stripes — тигровые полосы. colors — палитра узора, alpha — плотность.
export const SKINS = [
  { id: 'std', tint: 0xffffff, costTokens: 0 },
  { id: 'winter', tint: 0xdce8ff, costTokens: 15, camo: { type: 'spots', colors: ['#e9eef5', '#b9c6d6', '#8794a6'], alpha: 0.6 } },
  { id: 'desert', tint: 0xffd9a0, costTokens: 15, camo: { type: 'spots', colors: ['#d8b87c', '#b08a50', '#8a683c'], alpha: 0.55 } },
  { id: 'forest', tint: 0xa8cc8e, costTokens: 15, camo: { type: 'spots', colors: ['#5e7a3e', '#3c572c', '#7d6a45'], alpha: 0.55 } },
  { id: 'night', tint: 0x9aa0ad, costTokens: 25, camo: { type: 'digital', colors: ['#3a4150', '#262c38', '#4d5666'], alpha: 0.62 } },
  { id: 'digital', tint: 0xa9bba1, costTokens: 35, camo: { type: 'digital', colors: ['#7d8f72', '#55654e', '#a3b39a'], alpha: 0.6 } },
  { id: 'urban', tint: 0xc4c8cf, costTokens: 35, camo: { type: 'digital', colors: ['#9aa0a8', '#686d74', '#c9ced6'], alpha: 0.6 } },
  { id: 'tiger', tint: 0xd8b56a, costTokens: 45, camo: { type: 'stripes', colors: ['#c8a35e', '#332c1e'], alpha: 0.62 } },
  { id: 'gold', tint: 0xffd24a, costTokens: 60 },
].map((s) => defLoc(s, { name: (o) => `game.skins.${o.id}` }))
export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]))

// ---------- камуфляжи (3 на КАЖДЫЙ танк, AI-спрайты, не CSS) ----------
// Реальная перекраска машины: спрайт /sprites/camo/<tankId>_<camoId>.png
// (наш танк top-down, перекрашенный flux-kontext, на той же магенте — кеится
// в рантайме как обычный танк). id '' — заводская окраска (базовый спрайт).
export const CAMOS = [
  { id: '', cost: 0 },
  { id: 'woodland', cost: 25 },
  { id: 'desert', cost: 25 },
  { id: 'winter', cost: 25 },
  { id: 'tiger', cost: 40 },
  { id: 'predator', cost: 40 },
  { id: 'magma', cost: 40 },
].map((c) => {
  const key = c.id || 'stock' // заводская окраска (id '') живёт под ключом 'stock'
  return defLoc(c, { name: () => `game.camos.${key}.name`, short: () => `game.camos.${key}.short` })
})
export const CAMO_BY_ID = Object.fromEntries(CAMOS.map((c) => [c.id, c]))
export const CAMO_IDS = CAMOS.map((c) => c.id).filter(Boolean)
// смена позывного — за Telegram Stars (цена авторитетна на сервере, PRODUCTS.rename)
export const RENAME_COST_STARS = 50

// ---------- воинские звания (по числу боёв) ----------
// Награда (credits/tokens) выдаётся ОДИН раз за каждое новое звание. Звание
// видно в карточке игрока, профиле и поиске боя.
export const RANKS = [
  { battles: 0, credits: 0 },
  { battles: 5, credits: 300 },
  { battles: 15, credits: 600 },
  { battles: 30, credits: 1000, tokens: 2 },
  { battles: 50, credits: 1500, tokens: 3 },
  { battles: 80, credits: 2200, tokens: 4 },
  { battles: 120, credits: 3000, tokens: 5 },
  { battles: 175, credits: 4200, tokens: 6 },
  { battles: 250, credits: 5800, tokens: 8 },
  { battles: 350, credits: 7500, tokens: 10 },
  { battles: 500, credits: 9500, tokens: 12 },
  { battles: 700, credits: 13000, tokens: 16 },
  { battles: 1000, credits: 18000, tokens: 22 },
  { battles: 1500, credits: 28000, tokens: 35 },
].map((r, i) => {
  Object.defineProperty(r, 'name', { enumerable: true, get: () => t('game.rankNames')[i] })
  return r
})
// звание по числу боёв (+ индекс в списке)
export function rankByBattles(battles) {
  let idx = 0
  for (let i = 0; i < RANKS.length; i++) if ((battles || 0) >= RANKS[i].battles) idx = i
  return { ...RANKS[idx], index: idx }
}

// ---------- рейтинг ----------
export const RATING_START = 1000
export const RATING_DELTA = { victory: 24, draw: 2, defeat: -16 }

// «Боевой рейтинг» — оценка по эффективности на конкретном танке относительно
// ОЖИДАЕМЫХ значений (а не просто по урону). Структурно как у известного формата:
// урон — главный фактор, фраги усиливают его, победы добавляют сверху. Реальных
// таблиц ожиданий у нас нет → выводим их из тира/класса машины, поэтому ratio
// факт/ожид. тир-нейтрален: новичок на тир-1 и топ на тир-10 сравниваются честно.
// Считаем по CAREER-агрегатам (стабильнее, чем по одному бою). Засвет/защиту в
// v1 не учитываем (онлайн их не отдаёт — было бы нечестно), только урон+фраги+победы.
export function expectedBattle(tank) {
  const cs = combatStats(tank)
  const cls = cs.id || 'medium' // light | medium | heavy
  const hits = cls === 'light' ? 6 : cls === 'heavy' ? 8 : 7 // ожид. результативных попаданий за бой
  return {
    dmg: cs.damage * hits, // ожидаемый урон ≈ урон_выстрела × попадания (растёт с тиром)
    frag: cls === 'light' ? 0.7 : cls === 'heavy' ? 0.95 : 0.85,
    spot: cls === 'light' ? 2.6 : cls === 'medium' ? 1.6 : 1.0, // лёгкие светят больше — им засвет важнее
  }
}

// агрегаты статистики: { battles, wins, sumDmg/Frag/Spot, expDmg/Frag/Spot } → рейтинг
export function battleScore(agg) {
  if (!agg || !agg.battles) return 0
  const rDMG = agg.expDmg > 0 ? agg.sumDmg / agg.expDmg : 0
  const rFRAG = agg.expFrag > 0 ? agg.sumFrag / agg.expFrag : 0
  const rSPOT = agg.expSpot > 0 ? (agg.sumSpot || 0) / agg.expSpot : 0
  const rWIN = agg.wins / agg.battles / 0.5 // ожидаемый винрейт 50%
  const rDMGc = Math.max(0, (rDMG - 0.22) / (1 - 0.22))
  const rFRAGc = Math.max(0, Math.min(rDMGc + 0.2, (rFRAG - 0.12) / (1 - 0.12)))
  const rSPOTc = Math.max(0, Math.min(rDMGc + 0.1, (rSPOT - 0.38) / (1 - 0.38)))
  const rWINc = Math.max(0, (rWIN - 0.71) / (1 - 0.71))
  return Math.round(980 * rDMGc + 210 * rDMGc * rFRAGc + 155 * rFRAGc * rSPOTc + 145 * Math.min(1.8, rWINc))
}

// градации рейтинга — подпись и цвет (наша шкала, откалибрована под expectedBattle)
export const RATING_BANDS = [
  { id: 'ace', min: 2900, color: '#c64bff' },
  { id: 'great', min: 2000, color: '#4aa3ff' },
  { id: 'good', min: 1500, color: '#5fd35f' },
  { id: 'avg', min: 900, color: '#f2c14b' },
  { id: 'below', min: 400, color: '#e0853c' },
  { id: 'novice', min: 0, color: '#c2553f' },
].map((b) => defLoc(b, { label: (o) => `game.ratingBands.${o.id}` }))
export const ratingBand = (score) => RATING_BANDS.find((b) => score >= b.min) || RATING_BANDS[RATING_BANDS.length - 1]

// фейковые соперники лидерборда (бэкенда пока нет) — локализованы (game.ratingRivals)
export const ratingRivals = () => t('game.ratingRivals')
export const modLevel = (modules, tankId, modId) => ((modules || {})[tankId] || {})[modId] || 1
export const modsMaxed = (modules, tankId) => MODULE_DEFS.every((m) => modLevel(modules, tankId, m.id) >= 3)
export const modsMaxedCount = (modules, tankId) => MODULE_DEFS.filter((m) => modLevel(modules, tankId, m.id) >= 3).length

// ---------- медали (как в Блице, но свои) ----------
// kind: 'battle' — начисляется за каждый подходящий бой, копится счётчик-престиж;
//       'career' — рубеж по суммарной статистике, выдаётся один раз.
// Награда (credits/tokens) выдаётся только за ПЕРВОЕ получение медали.
// metric/need — декларативное условие (см. store.battleMedalIds / careerMedalIds).
// glyph — символ-фоллбэк, если спрайт /sprites/medals/<id>.png ещё не подгрузился.
export const MEDALS = [
  // боевые — за один бой
  { id: 'warrior', tier: 'bronze', glyph: '✪', kind: 'battle', metric: 'kills', need: 3, reward: { credits: 150 } },
  { id: 'sniper', tier: 'gold', glyph: '✹', kind: 'battle', metric: 'kills', need: 5, reward: { credits: 500, tokens: 2 } },
  { id: 'firestorm', tier: 'silver', glyph: '✸', kind: 'battle', metric: 'damage', need: 8000, reward: { credits: 300, tokens: 1 } },
  { id: 'wall', tier: 'silver', glyph: '⛨', kind: 'battle', metric: 'blocked', need: 2000, reward: { credits: 300, tokens: 1 } },
  { id: 'scout', tier: 'bronze', glyph: '◉', kind: 'battle', metric: 'lightKills', need: 2, reward: { credits: 200 } },
  { id: 'survivor', tier: 'bronze', glyph: '✠', kind: 'battle', metric: 'survived', need: 1, reward: { credits: 150 } },
  { id: 'triumph', tier: 'gold', glyph: '★', kind: 'battle', metric: 'triumph', need: 1, reward: { credits: 600, tokens: 3 } },
  // карьерные — рубежи
  { id: 'recruit', tier: 'bronze', glyph: '➀', kind: 'career', metric: 'battles', need: 10, reward: { credits: 200 } },
  { id: 'veteran', tier: 'silver', glyph: '➁', kind: 'career', metric: 'battles', need: 100, reward: { credits: 600, tokens: 2 } },
  { id: 'guards', tier: 'gold', glyph: '➂', kind: 'career', metric: 'battles', need: 500, reward: { credits: 1500, tokens: 5 } },
  { id: 'hunter', tier: 'silver', glyph: '⊗', kind: 'career', metric: 'kills', need: 100, reward: { credits: 600, tokens: 2 } },
  { id: 'ace', tier: 'gold', glyph: '✺', kind: 'career', metric: 'kills', need: 1000, reward: { credits: 2000, tokens: 8 } },
  { id: 'legend', tier: 'gold', glyph: '♛', kind: 'career', metric: 'rating', need: 1500, reward: { credits: 1500, tokens: 5 } },
].map((m) => defLoc(m, { name: (o) => `game.medals.${o.id}.name`, desc: (o) => `game.medals.${o.id}.desc` }))
export const MEDAL_BY_ID = Object.fromEntries(MEDALS.map((m) => [m.id, m]))
export const MEDAL_TIER_COLOR = { bronze: '#c08349', silver: '#cfd4da', gold: '#f2a50c' }

// ---------- кланы ----------
// эмблема клана = символ + цвет (выбор из набора при создании)
export const CLAN_EMBLEMS = [
  { id: 'e1', sym: '★', col: '#f2a50c' },
  { id: 'e2', sym: '⚔', col: '#cfd4da' },
  { id: 'e3', sym: '☠', col: '#e0853c' },
  { id: 'e4', sym: '⛨', col: '#5fd35f' },
  { id: 'e5', sym: '✦', col: '#4aa3ff' },
  { id: 'e6', sym: '⚡', col: '#f2c14b' },
  { id: 'e7', sym: '♛', col: '#c64bff' },
  { id: 'e8', sym: '◆', col: '#ff6a8a' },
]
export const CLAN_EMBLEM_BY_ID = Object.fromEntries(CLAN_EMBLEMS.map((e) => [e.id, e]))
