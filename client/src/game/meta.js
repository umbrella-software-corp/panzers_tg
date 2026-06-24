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
// ВРЕМЕННО СКРЫТЫЕ нации (display-уровень: переключатель наций / выбор 2-го танка /
// карусель ангара). Танки в данных остаются. США раскрыта 2026-06-22: основная линия
// 1-10 + премы ram/sper получили свои 3D-модели (см. TANK_MODELS). 7 «доп»-танков США
// (EXTRA_TANKS) пока без моделей, но в UI не показываются (extraOfNation не вызывается).
export const HIDDEN_NATIONS = []
export const isHiddenNation = (id) => HIDDEN_NATIONS.includes(id)
export const visibleNations = () => NATIONS.filter((n) => !HIDDEN_NATIONS.includes(n.id))
// скрытые нации показываем «заглушкой» (🔒 скоро), чтобы ветка не «пропадала молча»
// и игрок понимал: прогресс сохранён, просто временно недоступна (фидбек тикет #26).
export const hiddenNations = () => NATIONS.filter((n) => HIDDEN_NATIONS.includes(n.id))

// Статы = АБСОЛЮТНЫЕ боевые числа (role-based сетка владельца 2026-06-24): dmg урон,
// rof выстр/мин, spd скорость (км/ч), mnv манёвр (°/с), view обзор (м), hp прочность.
// Это база на 100% экипаже без модулей/спец. combatStats отдаёт их «как есть»; ТТХ-панель
// показывает ровно эти цифры. Прогрессия тиров заложена в самих числах (т1 ~50 урона /
// 750 hp → т10 ~380 / 5000+). Менять баланс — ТУТ, синхронно с ботами (config.js).
export const MAX_TIER = 10
export const TANKS_BY_NATION = {
  ussr: [
    { id: 't26', tier: 1, cls: 'Лёгкий', stats: { dmg: 50, rof: 14.0, spd: 50, mnv: 45, view: 250, hp: 750 } },
    { id: 'bt7', tier: 2, cls: 'Лёгкий', stats: { dmg: 60, rof: 13.0, spd: 75, mnv: 70, view: 330, hp: 850 }, cost: 1500 },
    { id: 't34', tier: 3, cls: 'Средний', stats: { dmg: 90, rof: 11.0, spd: 60, mnv: 55, view: 300, hp: 1200 }, cost: 4000 },
    { id: 't3485', tier: 4, cls: 'Средний', stats: { dmg: 110, rof: 10.0, spd: 63, mnv: 60, view: 310, hp: 1400 }, cost: 10000 },
    { id: 'kv1', tier: 5, cls: 'Тяжёлый', stats: { dmg: 150, rof: 8.0, spd: 40, mnv: 35, view: 280, hp: 2100 }, cost: 25000 },
    { id: 'is2', tier: 6, cls: 'Тяжёлый', stats: { dmg: 220, rof: 6.5, spd: 38, mnv: 32, view: 280, hp: 2600 }, cost: 62000 },
    { id: 't72', tier: 7, cls: 'Средний', stats: { dmg: 240, rof: 8.0, spd: 68, mnv: 65, view: 350, hp: 3200 }, cost: 155000 },
    { id: 't90', tier: 8, cls: 'Средний', stats: { dmg: 280, rof: 8.5, spd: 62, mnv: 58, view: 360, hp: 3800 }, cost: 390000 },
    { id: 't80u', tier: 9, cls: 'Средний', stats: { dmg: 320, rof: 8.0, spd: 75, mnv: 70, view: 370, hp: 4500 }, cost: 980000 },
    { id: 't14', tier: 10, cls: 'Тяжёлый', stats: { dmg: 360, rof: 7.5, spd: 72, mnv: 68, view: 420, hp: 5500 }, cost: 2500000 },
  ],
  ger: [
    { id: 'pz2', tier: 1, cls: 'Лёгкий', stats: { dmg: 50, rof: 14.5, spd: 48, mnv: 45, view: 260, hp: 750 } },
    { id: 'pz3', tier: 2, cls: 'Лёгкий', stats: { dmg: 70, rof: 13.0, spd: 50, mnv: 50, view: 280, hp: 900 }, cost: 1500 },
    { id: 'pz4', tier: 3, cls: 'Средний', stats: { dmg: 95, rof: 11.0, spd: 48, mnv: 52, view: 300, hp: 1250 }, cost: 4000 },
    { id: 'pnt', tier: 4, cls: 'Средний', stats: { dmg: 130, rof: 9.0, spd: 50, mnv: 55, view: 330, hp: 1500 }, cost: 10000 },
    { id: 'tgr', tier: 5, cls: 'Тяжёлый', stats: { dmg: 160, rof: 8.0, spd: 38, mnv: 40, view: 310, hp: 2200 }, cost: 25000 },
    { id: 'tgr2', tier: 6, cls: 'Тяжёлый', stats: { dmg: 210, rof: 6.5, spd: 35, mnv: 36, view: 300, hp: 2800 }, cost: 62000 },
    { id: 'leo1', tier: 7, cls: 'Средний', stats: { dmg: 240, rof: 7.5, spd: 70, mnv: 70, view: 360, hp: 2300 }, cost: 155000 },
    { id: 'leo2', tier: 8, cls: 'Средний', stats: { dmg: 280, rof: 7.5, spd: 68, mnv: 65, view: 370, hp: 3300 }, cost: 390000 },
    { id: 'leo2a7', tier: 9, cls: 'Средний', stats: { dmg: 330, rof: 7.0, spd: 70, mnv: 68, view: 390, hp: 4200 }, cost: 980000 },
    { id: 'kf51', tier: 10, cls: 'Средний', stats: { dmg: 380, rof: 6.5, spd: 72, mnv: 70, view: 420, hp: 4800 }, cost: 2500000 },
  ],
  usa: [
    { id: 'm2l', tier: 1, cls: 'Лёгкий', stats: { dmg: 50, rof: 14.0, spd: 55, mnv: 55, view: 260, hp: 750 } },
    { id: 'stu', tier: 2, cls: 'Лёгкий', stats: { dmg: 70, rof: 13.0, spd: 70, mnv: 70, view: 320, hp: 950 }, cost: 1500 },
    { id: 'sher', tier: 3, cls: 'Средний', stats: { dmg: 95, rof: 11.0, spd: 55, mnv: 50, view: 300, hp: 1250 }, cost: 4000 },
    { id: 'e8', tier: 4, cls: 'Средний', stats: { dmg: 120, rof: 10.0, spd: 60, mnv: 60, view: 330, hp: 1500 }, cost: 10000 },
    { id: 'per', tier: 5, cls: 'Тяжёлый', stats: { dmg: 160, rof: 8.0, spd: 50, mnv: 45, view: 340, hp: 2150 }, cost: 25000 },
    { id: 'm48', tier: 6, cls: 'Средний', stats: { dmg: 210, rof: 7.5, spd: 52, mnv: 55, view: 370, hp: 2800 }, cost: 62000 },
    { id: 'm60', tier: 7, cls: 'Средний', stats: { dmg: 240, rof: 7.0, spd: 55, mnv: 52, view: 390, hp: 3100 }, cost: 155000 },
    { id: 'abr', tier: 8, cls: 'Тяжёлый', stats: { dmg: 280, rof: 7.0, spd: 65, mnv: 60, view: 410, hp: 3800 }, cost: 390000 },
    { id: 'm1a2', tier: 9, cls: 'Тяжёлый', stats: { dmg: 330, rof: 6.5, spd: 68, mnv: 62, view: 430, hp: 4400 }, cost: 980000 },
    { id: 'abrx', tier: 10, cls: 'Тяжёлый', stats: { dmg: 380, rof: 6.0, spd: 75, mnv: 70, view: 460, hp: 5000 }, cost: 2500000 },
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
  { id: 't28', nation: 'ussr', tier: 4, cls: 'Средний', premium: true, legend: true, stars: 40, stats: { dmg: 160, rof: 16.0, spd: 45, mnv: 40, view: 280, hp: 1250 } },
  { id: 't54', nation: 'ussr', tier: 8, cls: 'Средний', premium: true, stars: 100, stats: { dmg: 240, rof: 8.5, spd: 56, mnv: 58, view: 360, hp: 1800 } },
  { id: 'pz4h', nation: 'ger', tier: 4, cls: 'Средний', premium: true, stars: 40, stats: { dmg: 110, rof: 10.5, spd: 48, mnv: 46, view: 320, hp: 1250 } },
  { id: 'maus', nation: 'ger', tier: 8, cls: 'Тяжёлый', premium: true, stars: 100, stats: { dmg: 490, rof: 4.0, spd: 20, mnv: 18, view: 300, hp: 5000 } },
  { id: 'ram', nation: 'usa', tier: 4, cls: 'Средний', premium: true, stars: 40, stats: { dmg: 160, rof: 15.0, spd: 48, mnv: 50, view: 310, hp: 1300 } },
  { id: 'sper', nation: 'usa', tier: 8, cls: 'Тяжёлый', premium: true, stars: 100, stats: { dmg: 240, rof: 7.5, spd: 45, mnv: 42, view: 340, hp: 2200 } },
].map(withClass) // withClass: classId + локализованные геттеры name/desc (прем-танки тоже)
// ----- ДОП. ТЕХНИКА: ПТ-САУ + лёгкие/тяжёлые из борда (ветки/нации игры) -----
// Пока «просто доступны»: НЕ в TANKS_BY_NATION (линейное дерево исследований не
// трогаем), просто свободно выбираемые в ангаре по нациям. Класс боя td → medium
// (CLS не знает 'ПТ-САУ' → classId по умолчанию 'medium'); метка WWII — только в
// дизайне борда, в экономике отдельной категории нет. Спрайты уже в sprites/.
export const EXTRA_TANKS = [
  // СССР
  { id: 't70', nation: 'ussr', tier: 2, cls: 'Лёгкий', stats: { dmg: 55, rof: 14.3, spd: 78, mnv: 76, view: 330, hp: 700 } },
  { id: 'su76m', nation: 'ussr', tier: 3, cls: 'ПТ-САУ', stats: { dmg: 115, rof: 8.6, spd: 51, mnv: 44, view: 300, hp: 1000 } },
  { id: 'su85', nation: 'ussr', tier: 5, cls: 'ПТ-САУ', stats: { dmg: 195, rof: 6.2, spd: 41, mnv: 34, view: 310, hp: 1700 } },
  { id: 'su100', nation: 'ussr', tier: 6, cls: 'ПТ-САУ', stats: { dmg: 265, rof: 5.3, spd: 39, mnv: 30, view: 300, hp: 2200 } },
  { id: 'kv2', nation: 'ussr', tier: 6, cls: 'Тяжёлый', stats: { dmg: 245, rof: 5.8, spd: 33, mnv: 28, view: 270, hp: 3200 } },
  { id: 'isu152', nation: 'ussr', tier: 7, cls: 'ПТ-САУ', stats: { dmg: 300, rof: 5.7, spd: 66, mnv: 59, view: 370, hp: 2300 } },
  // Германия
  { id: 'stug3', nation: 'ger', tier: 4, cls: 'ПТ-САУ', stats: { dmg: 150, rof: 7.6, spd: 55, mnv: 49, view: 320, hp: 1150 } },
  { id: 'hetzer', nation: 'ger', tier: 4, cls: 'ПТ-САУ', stats: { dmg: 150, rof: 7.6, spd: 55, mnv: 49, view: 320, hp: 1150 } },
  { id: 'nashorn', nation: 'ger', tier: 6, cls: 'ПТ-САУ', stats: { dmg: 265, rof: 5.3, spd: 39, mnv: 30, view: 300, hp: 2200 } },
  { id: 'jagdpanther', nation: 'ger', tier: 7, cls: 'ПТ-САУ', stats: { dmg: 300, rof: 5.7, spd: 66, mnv: 59, view: 370, hp: 2300 } },
  { id: 'ferdinand', nation: 'ger', tier: 8, cls: 'ПТ-САУ', stats: { dmg: 350, rof: 5.6, spd: 62, mnv: 52, view: 380, hp: 2900 } },
  { id: 'grille15', nation: 'ger', tier: 10, cls: 'ПТ-САУ', stats: { dmg: 465, rof: 4.9, spd: 70, mnv: 59, view: 430, hp: 4100 } },
  // США
  { id: 'm3lee', nation: 'usa', tier: 3, cls: 'Средний', stats: { dmg: 95, rof: 11.0, spd: 54, mnv: 52, view: 300, hp: 1250 } },
  { id: 'chaffee', nation: 'usa', tier: 4, cls: 'Лёгкий', stats: { dmg: 95, rof: 10.7, spd: 70, mnv: 70, view: 360, hp: 1150 } },
  { id: 'm10', nation: 'usa', tier: 4, cls: 'ПТ-САУ', stats: { dmg: 150, rof: 7.6, spd: 55, mnv: 49, view: 320, hp: 1150 } },
  { id: 'jumbo', nation: 'usa', tier: 5, cls: 'Тяжёлый', stats: { dmg: 180, rof: 6.8, spd: 34, mnv: 32, view: 280, hp: 2550 } },
  { id: 'm36', nation: 'usa', tier: 5, cls: 'ПТ-САУ', stats: { dmg: 195, rof: 6.2, spd: 41, mnv: 34, view: 310, hp: 1700 } },
  { id: 'hellcat', nation: 'usa', tier: 6, cls: 'ПТ-САУ', stats: { dmg: 265, rof: 5.3, spd: 55, mnv: 50, view: 320, hp: 1700 } },
  { id: 't30', nation: 'usa', tier: 9, cls: 'ПТ-САУ', stats: { dmg: 410, rof: 5.3, spd: 68, mnv: 57, view: 410, hp: 3500 } },
].map((t) => withClass({ ...t, extra: true }))
export const EXTRA_TANK_IDS = new Set(EXTRA_TANKS.map((t) => t.id))
export const TANKS = [...Object.values(TANKS_BY_NATION).flat(), ...PREMIUM_TANKS, ...EXTRA_TANKS].map(withClass)
export const TANK_BY_ID = Object.fromEntries(TANKS.map((t) => [t.id, t]))
export const tanksOfNation = (nation) => (TANKS_BY_NATION[nation] || []).map(withClass)
export const premiumOfNation = (nation) => PREMIUM_TANKS.filter((t) => t.nation === nation).map(withClass)
export const extraOfNation = (nation) => EXTRA_TANKS.filter((t) => t.nation === nation)
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
// АБСОЛЮТНАЯ БАЛАНСНАЯ СЕТКА (role-based, по таблицам владельца 2026-06-24): tank.stats —
// это РЕАЛЬНЫЕ боевые числа, а не шкала 0-10. combatStats отдаёт их «как есть» (+ профиль
// класса). ТТХ-панель (statReal) показывает ровно эти цифры. Базовые = 100% экипаж, без
// модулей/спец — модули/экипаж множат сверху (loadoutStats). Боты (shared+client config.js
// TANK_CLASSES + botTier-мульты) калиброваны под ТУ ЖЕ кривую — менять синхронно.
// Поля stats: dmg урон, rof выстр/мин, spd скорость (км/ч ≈ ед/с сима), mnv манёвр (°/с),
// view обзор (м), hp прочность.
// HP_SCALE/DMG_SCALE — легаси (масштаб 0-10), больше не применяются в combatStats; оставлены
// как экспорт на случай внешних ссылок. Менять баланс — в tank.stats, не тут.
export const HP_SCALE = 19
export const DMG_SCALE = 6
// ДИНАМИКА БОЯ: HP всех танков ×HP_MULT (фидбек 2026-06-24 «никого не убить, TTK ~13 выстрелов,
// динамика просела» — урон ПРАВИЛЬНЫЙ, режем только HP на 30%). tank.stats.hp = сетка владельца
// (5500 и т.д.), а в бой/ТТХ идёт ×0.70 (T-14 5500→3850, T-7 3200→2240 → ~9 выстрелов/килл).
// Боты ×HP_MULT тем же (shared/config.js + sim.js). Хочешь динамичнее/толще — крутить тут+config.
export const HP_MULT = 0.7
export function combatStats(tank) {
  const s = tank.stats // абсолютные боевые числа (см. комментарий выше)
  const cls = TANK_CLASSES[tank.classId] || TANK_CLASSES.medium
  const maxSpeed = s.spd // км/ч таблицы = ед/с сима (тяжи реально медленные — by design)
  return {
    ...cls, // id/label/sectorDeg/sweepPeriod/toleranceDeg/range — профиль класса
    damage: Math.round(s.dmg),
    reload: +(60 / s.rof).toFixed(2), // выстр/мин → секунды перезарядки
    maxSpeed,
    accel: Math.round(maxSpeed * 2.5), // снаппи-разгон: скорости ниже, но старт отзывчивый
    turnRate: +((s.mnv * Math.PI) / 180).toFixed(3), // °/с → рад/с (сим крутит в радианах)
    vision: Math.round(s.view),
    hp: Math.round(s.hp * HP_MULT), // −30% к HP (динамика боя; см. HP_MULT выше)
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

// Нормализация АБСОЛЮТНОГО боевого числа → 0..10 для сегментного бара (StatRow): min стата
// по сетке → ~1 деление, max → 10 (как прежняя шкала 1-10) — танк-1 ≈ 1 бар, топ ≈ 10.
// Нужна, т.к. stats теперь абсолютные (иначе бар value·10% всегда полный). Диапазоны — по
// role-based сетке владельца 2026-06-24 (с запасом на премы/Maus). higher=better у всех 6.
const STAT_BAR_RANGE = { dmg: [50, 400], rof: [4, 16], spd: [20, 80], mnv: [18, 78], view: [240, 470], hp: [700, 5600] }
export function statBar(key, v) {
  const r = STAT_BAR_RANGE[key]
  if (!r) return Math.max(0, Math.min(10, +v || 0))
  return Math.max(0.5, Math.min(10, +(1 + ((v - r[0]) / (r[1] - r[0])) * 9).toFixed(1)))
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
// цена прокачки модуля растёт КВАДРАТично по тиру (награда за бой тоже растёт с тиром →
// модули должны быть ощутимым кредит-сливом, а не копейки). Было tier·40/80 (т10 = 400/800,
// смешно). Стало tier²·50/110: т1 50/110 → т5 1250/2750 → т7 2450/5390 → т10 5000/11000.
// level 2 = улучшенная, level 3 = топ. ЗЕРКАЛО shared/economy.js — менять В ОБОИХ.
export const moduleCost = (tier, level) => Math.round(tier * tier * (level === 2 ? 50 : 110))

// ИССЛЕДОВАНИЕ: стоимость открытия танка в ОПЫТЕ ВЕТКИ по тиру (тратится, отдельно от
// кредитов). ЗЕРКАЛО shared/economy.js TIER_XP — менять В ОБОИХ местах.
export const TIER_XP = { 1: 0, 2: 450, 3: 2200, 4: 6000, 5: 14000, 6: 30000, 7: 55000, 8: 95000, 9: 150000, 10: 240000 }
export const tankResearchXp = (tier) => TIER_XP[tier] || 0

// СВОБОДНЫЙ ОПЫТ: доля опыта боя, уходящая в общий пул (вместо ветки/экипажа). Его
// можно вложить в любую нацию (см. spendFreeXp в store). ЗЕРКАЛО shared/economy.js.
export const FREE_XP_SHARE = 0.1
// доля боевого опыта (от остатка) в ЭКИПАЖ; остальное — в ветку. Срезана 0.5→0.3
// (экипаж качался слишком быстро, фидбек #26). ЗЕРКАЛО shared/economy.js.
export const CREW_XP_SHARE = 0.3

// ---------- голдовые снаряды ----------
export const GOLD_AMMO_MULT = 1.35 // множитель урона голдового снаряда
export const GOLD_AMMO_PACKS = [
  { id: 'g1', amount: 10, costTokens: 12 },
  { id: 'g2', amount: 30, costTokens: 30 },
]

// ---------- ежедневные задачи (TASKS_PER_DAY в день, ротация по дате) ----------
// key — счётчик из итогов боя (см. bankTaskProgress): damage/kills/lightKills/
// blocked/wins/battles/survived/blockedDmg. `blocked` = ЧИСЛО снарядов, отражённых
// твоей бронёй за бой (NetGame.blockedShells, ++ на каждый ricochet/nopen по мне);
// `blockedDmg` = спасённый бронёй УРОН (медаль «wall» — другая единица, не путать);
// `survived` = 1 если дожил до конца боя. Пул-ЗЕРКАЛО в shared/economy.js — порядок
// и id держать идентичными (выбор дня шьётся по индексам).
export const DAILY_TASKS = [
  { id: 'dmg600', goal: 1700, key: 'damage', credits: 400 }, // цель ×0.375 под ресейл урона (была 4500)
  { id: 'kills3', goal: 3, key: 'kills', credits: 500 },
  { id: 'light2', goal: 2, key: 'lightKills', credits: 400 }, // алмазы→кредиты: жетоны фармят только премы (#26)
  { id: 'block3', goal: 3, key: 'blocked', credits: 350 },
  { id: 'win1', goal: 1, key: 'wins', credits: 600 },
  { id: 'battles3', goal: 3, key: 'battles', credits: 300 },
  { id: 'dmg9000', goal: 3400, key: 'damage', credits: 800 }, // цель ×0.375 под ресейл урона (была 9000)
  { id: 'kills5', goal: 5, key: 'kills', credits: 800 },
  { id: 'win3', goal: 3, key: 'wins', credits: 600 }, // было tokens:10 → кредиты (#26)
  { id: 'battles5', goal: 5, key: 'battles', credits: 500 },
  { id: 'survive2', goal: 2, key: 'survived', credits: 450 },
  { id: 'armor2000', goal: 750, key: 'blockedDmg', credits: 450 }, // цель ×0.375 под ресейл урона (была 2000)
  { id: 'light3', goal: 3, key: 'lightKills', credits: 500 }, // было tokens:7 → кредиты (#26)
].map((d) => defLoc(d, { label: (o) => `game.tasks.${o.id}` }))
export const TASKS_PER_DAY = 4
// бонус за выполнение ВСЕХ задач дня (по фидбеку) — ощутимо жирнее любой одиночной.
// ЗЕРКАЛО shared/economy.js TASKS_ALL_BONUS.
export const TASKS_ALL_BONUS = { credits: 1500, tokens: 1 } // +гем за все дейлики дня (#23, мелкий трикл; флаг владельцу — частично возвращает #26)

// детерминированный выбор задач дня (у всех игроков одинаковые): стабильно
// перетасовываем пул по дате и берём первые TASKS_PER_DAY — без повторов при любом
// размере пула. ЗЕРКАЛО в shared/economy.js — менять синхронно (тот же алгоритм+порядок).
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

// ---------- ежедневный вход (цикл 7 дней) ----------
// жетоны убраны из дейли-входа — фарм алмазов только премами (#26); заменены кредитами
export const DAILY_REWARDS = [
  { credits: 200 },
  { credits: 350 },
  { credits: 400 },
  { credits: 600 },
  { credits: 800 },
  { credits: 700 },
  { credits: 1800, gold: 5 },
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
// pattern — процедурный узор для 3D-рендера (camo.js drawCamoPattern: spots/digital/
// stripes). Без него 3D показывал запечённую текстуру модели вместо выбранного камо
// (баг «неправильное отображение камо в ангаре и бою»). 2D по-прежнему берёт спрайты.
export const CAMOS = [
  { id: '', cost: 0 },
  { id: 'woodland', cost: 25, pattern: { type: 'spots', colors: ['#5e7a3e', '#3c572c', '#7d6a45'] } },
  { id: 'desert', cost: 25, pattern: { type: 'spots', colors: ['#cdab73', '#a9824a', '#836237'] } },
  { id: 'winter', cost: 25, pattern: { type: 'spots', colors: ['#e9eef5', '#bcc8d8', '#8a97a8'] } },
  { id: 'tiger', cost: 40, pattern: { type: 'stripes', colors: ['#c4a05c', '#2f2818'] } },
  { id: 'predator', cost: 40, pattern: { type: 'digital', colors: ['#2f3a2c', '#1b231a', '#46563a'] } },
  { id: 'magma', cost: 40, pattern: { type: 'spots', colors: ['#2a1a14', '#c2521f', '#e0902a'] } },
].map((c) => {
  const key = c.id || 'stock' // заводская окраска (id '') живёт под ключом 'stock'
  return defLoc(c, { name: () => `game.camos.${key}.name`, short: () => `game.camos.${key}.short` })
})
export const CAMO_BY_ID = Object.fromEntries(CAMOS.map((c) => [c.id, c]))
export const CAMO_IDS = CAMOS.map((c) => c.id).filter(Boolean)
// смена позывного — за Telegram Stars (цена авторитетна на сервере, PRODUCTS.rename)
export const RENAME_COST_STARS = 25

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
// минимум боёв для попадания в рейтинг (ЗЕРКАЛО server/src/db.js RATING_MIN_BATTLES):
// меньше — WN8 раздут на малой выборке, не ранжируем (фидбек «3 боя = топ»)
export const RATING_MIN_BATTLES = 5
// «доверие» рейтинга по числу боёв: до RATING_FULL_CONF боёв рейтинг ПРОВИЗОРНЫЙ
// (занижен пропорционально), к этому числу выходит на истинную эффективность. Так
// рейтинг учитывает объём — больше боёв = выше (фидбек «учитывать количество боёв»).
export const RATING_FULL_CONF = 25

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
  const raw = 980 * rDMGc + 210 * rDMGc * rFRAGc + 155 * rFRAGc * rSPOTc + 145 * Math.min(1.8, rWINc)
  // «доверие» по числу боёв: рейтинг провизорный (занижен) до RATING_FULL_CONF боёв,
  // затем полный. Учитывает объём — несколько удачных боёв не дают топ (фидбек).
  const conf = Math.min(1, agg.battles / RATING_FULL_CONF)
  return Math.round(raw * conf)
}

// «Боевой рейтинг» как ПРОГРЕССИЯ (заменил кумулятивное среднее). Каждый бой даёт
// дельту очков, которая прибавляется к ТОМУ ЖЕ s.wn8, по которому строится таблица
// лидеров → бой напрямую двигает тебя в топе. Среднее наказывало за каждый бой ниже
// личного потолка («доминировал 6 фрагов → рейтинг −11 = не считается»). Теперь:
// сыграл выше ожидания → плюс, ниже → минус; победа всегда хоть немного в плюс.
// Засвет в формулу не берём — онлайн его не отдаёт честно и он душит тяжёлые танки.
// Средний по эффективности игрок с винрейтом 50% держится около нуля (не накручивает
// рейтинг гриндом) — растут только урон/фраги выше ожидания и победы.
export function battleRatingDelta(b, tank) {
  const exp = expectedBattle(tank)
  const rDMG = exp.dmg > 0 ? (b.damage || 0) / exp.dmg : 0 // 1.0 = ровно ожидание
  const rFRAG = exp.frag > 0 ? (b.frag || 0) / exp.frag : 0
  const winTerm = b.result === 'victory' ? 0.35 : b.result === 'defeat' ? -0.35 : 0
  // вклад фрагов кэпим сверху (+3), чтобы серия фрагов одна не задирала рейтинг
  const perf = 0.6 * (rDMG - 1) + 0.25 * Math.min(3, rFRAG - 1) + winTerm
  let d = Math.round(perf * 80)
  d = Math.max(-40, Math.min(95, d)) // один бой не качает рейтинг слишком сильно
  if (b.result === 'victory') d = Math.max(d, 5) // победа никогда не уводит в минус
  return d
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
  // боевые — за один бой. reward.xp — опыт за медаль (по фидбеку: за медали ощутимо
  // больше опыта; начисляется в reward.xp боя, см. battleMedalXp).
  { id: 'warrior', tier: 'bronze', glyph: '✪', kind: 'battle', metric: 'kills', need: 3, reward: { credits: 150, xp: 120 } },
  { id: 'sniper', tier: 'gold', glyph: '✹', kind: 'battle', metric: 'kills', need: 5, reward: { credits: 500, tokens: 2, xp: 300 } },
  { id: 'firestorm', tier: 'silver', glyph: '✸', kind: 'battle', metric: 'damage', need: 3000, reward: { credits: 300, tokens: 1, xp: 250 } },
  { id: 'wall', tier: 'silver', glyph: '⛨', kind: 'battle', metric: 'blockedDmg', need: 750, reward: { credits: 300, tokens: 1, xp: 200 } },
  { id: 'scout', tier: 'bronze', glyph: '◉', kind: 'battle', metric: 'lightKills', need: 2, reward: { credits: 200, xp: 150 } },
  { id: 'survivor', tier: 'bronze', glyph: '✠', kind: 'battle', metric: 'survived', need: 1, reward: { credits: 150, xp: 100 } },
  { id: 'triumph', tier: 'gold', glyph: '★', kind: 'battle', metric: 'triumph', need: 1, reward: { credits: 600, tokens: 3, xp: 400 } },
  // боевые высшего порядка — стакаются с базовыми за выдающийся бой
  { id: 'kingslayer', tier: 'gold', glyph: '⚔', kind: 'battle', metric: 'kills', need: 7, reward: { credits: 900, tokens: 4, xp: 500 } },
  { id: 'devastator', tier: 'gold', glyph: '☄', kind: 'battle', metric: 'damage', need: 5600, reward: { credits: 600, tokens: 2, xp: 400 } },
  { id: 'bastion', tier: 'gold', glyph: '⛉', kind: 'battle', metric: 'blockedDmg', need: 1500, reward: { credits: 500, tokens: 2, xp: 350 } },
  { id: 'pathfinder', tier: 'silver', glyph: '⊚', kind: 'battle', metric: 'lightKills', need: 4, reward: { credits: 350, tokens: 1, xp: 250 } },
  // карьерные — рубежи
  { id: 'recruit', tier: 'bronze', glyph: '➀', kind: 'career', metric: 'battles', need: 10, reward: { credits: 200 } },
  { id: 'veteran', tier: 'silver', glyph: '➁', kind: 'career', metric: 'battles', need: 100, reward: { credits: 600, tokens: 2 } },
  { id: 'guards', tier: 'gold', glyph: '➂', kind: 'career', metric: 'battles', need: 500, reward: { credits: 1500, tokens: 5 } },
  { id: 'hunter', tier: 'silver', glyph: '⊗', kind: 'career', metric: 'kills', need: 100, reward: { credits: 600, tokens: 2 } },
  { id: 'ace', tier: 'gold', glyph: '✺', kind: 'career', metric: 'kills', need: 1000, reward: { credits: 2000, tokens: 8 } },
  { id: 'legend', tier: 'gold', glyph: '♛', kind: 'career', metric: 'rating', need: 1500, reward: { credits: 1500, tokens: 5 } },
  { id: 'executioner', tier: 'silver', glyph: '⊕', kind: 'career', metric: 'kills', need: 300, reward: { credits: 1000, tokens: 3 } },
  { id: 'marshal', tier: 'gold', glyph: '➃', kind: 'career', metric: 'battles', need: 1000, reward: { credits: 3000, tokens: 10 } },
  { id: 'grandmaster', tier: 'gold', glyph: '♚', kind: 'career', metric: 'rating', need: 1800, reward: { credits: 2500, tokens: 8 } },
].map((m) => defLoc(m, { name: (o) => `game.medals.${o.id}.name`, desc: (o) => `game.medals.${o.id}.desc` }))
export const MEDAL_BY_ID = Object.fromEntries(MEDALS.map((m) => [m.id, m]))
export const MEDAL_TIER_COLOR = { bronze: '#c08349', silver: '#cfd4da', gold: '#f2a50c' }
// суммарный опыт за боевые медали этого боя (b: { kills, damage, blockedDmg, lightKills,
// survived, victory }). ЗЕРКАЛО shared/economy.js battleMedalXp. Входит в reward.xp боя.
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

// ---------- 3D-модели танков (бой за флагом «3D», NetGame3D) ----------
// tankId → файл модели (meshopt+webp 256, client/public/models). ВАЖНО: имена файлов
// исторические — реальное содержимое GLB: tank2 = Abrams, tank3 = Leopard 2.
// Танки БЕЗ своей модели рендерятся фоллбэком по нации. Порт из tanks_mini_3d.
export const TANK_MODELS = {
  t90: '/models/t90_opt.glb', abr: '/models/abr_opt.glb', leo2: '/models/tank3_opt.glb',
  t34: '/models/t34_opt.glb', t3485: '/models/t3485_opt.glb', t80u: '/models/t80u_opt.glb',
  t14: '/models/t14_opt.glb', tgr: '/models/tgr_opt.glb', tgr2: '/models/tgr2_opt.glb',
  is2: '/models/is2_opt.glb', kv1: '/models/kv1_opt.glb', t26: '/models/t26_opt.glb',
  bt7: '/models/bt7_opt.glb', t54: '/models/t54_opt.glb', t28: '/models/t28_opt.glb',
  t72: '/models/t72_opt.glb', pz2: '/models/pz2_opt.glb', pz3: '/models/pz3_opt.glb',
  pnt: '/models/pnt_opt.glb', maus: '/models/maus_opt.glb', pz4: '/models/pz4_opt.glb',
  leo1: '/models/leo1_opt.glb', leo2a7: '/models/leo2a7_opt.glb', kf51: '/models/kf51_opt.glb',
  pz4h: '/models/pz4h_opt.glb',
  // США: реальные 3D-модели (256 JPEG + KHR_mesh_quantization, ~0.8 МБ как остальные)
  m2l: '/models/m2l_opt.glb', stu: '/models/stu_opt.glb', sher: '/models/sher_opt.glb',
  e8: '/models/e8_opt.glb', per: '/models/per_opt.glb', sper: '/models/sper_opt.glb',
  m48: '/models/m48_opt.glb', m60: '/models/m60_opt.glb', ram: '/models/ram_opt.glb',
  m1a2: '/models/m1a2_opt.glb', abrx: '/models/abrx_opt.glb', // abr → abr_opt.glb (выше)
}
// фоллбэк по нации: СССР → Т-90, США → Abrams, Германия → Leopard 2
export const NATION_MODEL_URL = { ussr: '/models/t90_opt.glb', usa: '/models/tank2_opt.glb', ger: '/models/tank3_opt.glb' }
// 3D-модели ОКРУЖЕНИЯ (бой): rock/bush/crate заменяют примитивы препятствий, остальное — декор-скаттер
export const PROP_MODELS = {
  rock: '/models/prop_rock.glb', bush: '/models/prop_bush.glb', crate: '/models/prop_crate.glb',
  barrel: '/models/prop_barrel.glb', sandbags: '/models/prop_sandbags.glb', hedgehog: '/models/prop_hedgehog.glb',
  wreck: '/models/prop_wreck.glb', deadtree: '/models/prop_deadtree.glb', tower: '/models/prop_tower.glb',
  bunker: '/models/prop_bunker.glb', tent: '/models/prop_tent.glb', tires: '/models/prop_tires.glb',
  ruin: '/models/prop_ruin.glb', barrier: '/models/prop_barrier.glb',
  // окружение «оживления» карт (сгенерировано: flux→TRELLIS image→3D, оптимизировано)
  tree: '/models/prop_tree.glb', house: '/models/prop_house.glb', mtn: '/models/prop_mtn.glb', boulder: '/models/prop_boulder.glb',
}
export const hasTankModel = (id) => !!TANK_MODELS[id]
// URL модели для танка: своя → фоллбэк по нации → Т-90
export function tankModelUrl(id, nation) {
  return TANK_MODELS[id] || NATION_MODEL_URL[nation] || '/models/t90_opt.glb'
}
// МОДЕЛИ «ЗАДОМ»: доворот +180° для GLB, смоделированных стволом в −Z.
// 2026-06-22: набор ПЕРЕСОБРАН. Прежний авто-детект (/_idcheck.html, эвристика выступа
// ствола) был НЕНАДЁЖЕН — ПЕРЕ-флипал 12 моделей (ехали задом в бою + кажут зад в ангаре,
// фидбек «все танки задним ходом»). Детерминир. репро (точные трансформы боя
// NetGame3D._normalizeModel+holder.rotation.y=π/2−hull и ангара Tank3DView faceY+flipY,
// стрелка движения/камеры) на ВСЕХ 16: перёд на +Z у всех КРОМЕ stu и tgr2 — у этих двух
// GLB реально стволом в −Z, флип нужен. Менять только сверяясь с репро, не эвристикой.
export const MODEL_FLIP = new Set(['stu', 'tgr2'])
export function modelNeedsFlip(url) {
  const m = /([^/]+)_opt\.glb/.exec(url || '')
  return m ? MODEL_FLIP.has(m[1]) : false
}
// «музейные» размеры: реальная длина КОРПУСА (м) → масштаб = len / SIZE_REF_M
const SIZE_REF_M = 7.3
const TANK_LENGTH_M = {
  t26: 4.62, bt7: 5.66, t34: 5.92, t3485: 6.0, kv1: 6.75, is2: 6.77,
  t72: 6.67, t90: 6.86, t80u: 7.0, t14: 8.7, t28: 7.44, t54: 6.04,
  pz2: 4.81, pz3: 5.52, pz4: 5.89, pnt: 6.87, tgr: 6.32, tgr2: 7.38,
  leo1: 7.09, leo2: 7.72, leo2a7: 7.7, kf51: 7.2, maus: 10.2, abr: 7.93,
  // США (длина корпуса без пушки, м)
  m2l: 4.43, stu: 4.53, sher: 5.89, e8: 6.0, per: 6.33, sper: 6.35,
  m48: 6.42, m60: 6.95, ram: 5.64, m1a2: 7.93, abrx: 7.93,
}
const SIZE_BY_CLASS = { light: 0.8, medium: 1, heavy: 1.22 }
export function tankSizeScale(id) {
  const len = TANK_LENGTH_M[id]
  if (len) return len / SIZE_REF_M
  const t = TANK_BY_ID[id]
  return (t && SIZE_BY_CLASS[t.classId]) || 1
}
