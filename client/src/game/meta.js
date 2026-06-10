// ============ PANZER TG — мета-данные (порт дизайн-прототипа ui.jsx) ============
// Каждый танк несёт боевой архетип classId (light/medium/heavy из config
// TANK_CLASSES) — он управляет поведением в Pixi-бою. Поля name/tier/cls/desc/
// stats/cost — для мета-экранов (ангар/прокачка).

const CLS = { Лёгкий: 'light', Средний: 'medium', Тяжёлый: 'heavy' }
const withClass = (t) => ({ ...t, classId: CLS[t.cls] || 'medium' })

export const NATIONS = [
  { id: 'ussr', label: 'СССР' },
  { id: 'ger', label: 'ГЕРМАНИЯ' },
  { id: 'usa', label: 'США' },
]

// Статы 0..10 (dmg/rof/spd/mnv/view/hp) — шкала растянута на 8 уровней
// до современных машин: тир-1 — честное днище (1-3), топ — 7-10.
// Профильные просадки только у тяжёлых: темп/ход в обмен на dmg+hp.
// Из них же считаются РЕАЛЬНЫЕ боевые статы (combatStats) — у каждого
// танка свой бой, а не общий по классу.
export const MAX_TIER = 8
export const TANKS_BY_NATION = {
  ussr: [
    { id: 't26', name: 'Т-26', tier: 1, cls: 'Лёгкий', desc: 'Учебная парта танкиста. Лёгкий, простой, везде успевает.', stats: { dmg: 1, rof: 3, spd: 3, mnv: 3, view: 2, hp: 1 } },
    { id: 'bt7', name: 'БТ-7', tier: 2, cls: 'Лёгкий', desc: 'Самый быстрый в довоенной линейке. Жалит и уходит.', stats: { dmg: 2, rof: 4, spd: 5, mnv: 4, view: 3, hp: 2 }, cost: 1500 },
    { id: 't34', name: 'Т-34', tier: 3, cls: 'Средний', desc: 'Золотая середина: броня, ход и орудие без слабых мест.', stats: { dmg: 3, rof: 5, spd: 5, mnv: 4, view: 4, hp: 3 }, cost: 4500 },
    { id: 't3485', name: 'Т-34-85', tier: 4, cls: 'Средний', desc: 'Тот же корпус — новая башня. Пробивает то, что Т-34 не брал.', stats: { dmg: 4, rof: 5, spd: 5, mnv: 5, view: 5, hp: 4 }, cost: 12000 },
    { id: 'kv1', name: 'КВ-1', tier: 5, cls: 'Тяжёлый', desc: 'Стальная стена. Медленный, но держит удар за всю команду.', stats: { dmg: 6, rof: 3, spd: 3, mnv: 3, view: 4, hp: 6 }, cost: 30000 },
    { id: 'is2', name: 'ИС-2', tier: 6, cls: 'Тяжёлый', desc: 'Зверобой. 122-мм аргумент, после которого спор окончен.', stats: { dmg: 7, rof: 3, spd: 4, mnv: 4, view: 5, hp: 7 }, cost: 70000 },
    { id: 't72', name: 'Т-72', tier: 7, cls: 'Средний', desc: 'Рабочая лошадь холодной войны: автомат заряжания, низкий силуэт.', stats: { dmg: 7, rof: 6, spd: 7, mnv: 6, view: 7, hp: 6 }, cost: 150000 },
    { id: 't90', name: 'Т-90', tier: 8, cls: 'Средний', desc: 'Современный ОБТ: тепловизор, динамическая защита, точность.', stats: { dmg: 8, rof: 7, spd: 8, mnv: 7, view: 9, hp: 7 }, cost: 300000 },
  ],
  ger: [
    { id: 'pz2', name: 'Pz. II', tier: 1, cls: 'Лёгкий', desc: 'Скорострельная малокалиберка. Шквал огня на ближней дистанции.', stats: { dmg: 1, rof: 4, spd: 3, mnv: 3, view: 2, hp: 1 } },
    { id: 'pz3', name: 'Pz. III', tier: 2, cls: 'Лёгкий', desc: 'Точный и дисциплинированный. Дуэлянт на средней дистанции.', stats: { dmg: 2, rof: 4, spd: 4, mnv: 4, view: 3, hp: 2 }, cost: 1500 },
    { id: 'pz4', name: 'Pz. IV', tier: 3, cls: 'Средний', desc: 'Рабочая лошадь вермахта. Стабильный урон в любой ситуации.', stats: { dmg: 3, rof: 4, spd: 4, mnv: 4, view: 4, hp: 3 }, cost: 4500 },
    { id: 'pnt', name: 'Panther', tier: 4, cls: 'Средний', desc: 'Длинная пушка, точность снайпера. Контроль линии огня.', stats: { dmg: 4, rof: 4, spd: 5, mnv: 4, view: 6, hp: 4 }, cost: 12000 },
    { id: 'tgr', name: 'Tiger', tier: 5, cls: 'Тяжёлый', desc: 'Легенда страха. Один выстрел решает перестрелку.', stats: { dmg: 6, rof: 3, spd: 3, mnv: 3, view: 5, hp: 6 }, cost: 30000 },
    { id: 'tgr2', name: 'Tiger II', tier: 6, cls: 'Тяжёлый', desc: 'Королевский тигр: лоб, который не пробивается в принципе.', stats: { dmg: 7, rof: 3, spd: 4, mnv: 3, view: 5, hp: 7 }, cost: 70000 },
    { id: 'leo1', name: 'Leopard 1', tier: 7, cls: 'Средний', desc: 'Скорость вместо брони. Стреляй первым — и тебя не достанут.', stats: { dmg: 7, rof: 6, spd: 8, mnv: 7, view: 7, hp: 5 }, cost: 150000 },
    { id: 'leo2', name: 'Leopard 2', tier: 8, cls: 'Средний', desc: 'Эталон современного ОБТ: оптика, стабилизация, немецкая точность.', stats: { dmg: 8, rof: 7, spd: 8, mnv: 7, view: 9, hp: 8 }, cost: 300000 },
  ],
  usa: [
    { id: 'm2l', name: 'M2 Light', tier: 1, cls: 'Лёгкий', desc: 'Юркий разведчик. Пулемётный шквал по лёгкой броне.', stats: { dmg: 1, rof: 4, spd: 4, mnv: 3, view: 2, hp: 1 } },
    { id: 'stu', name: 'Stuart', tier: 2, cls: 'Лёгкий', desc: 'Быстрый фланговый нож. Кружи и жаль в корму.', stats: { dmg: 2, rof: 5, spd: 5, mnv: 5, view: 3, hp: 2 }, cost: 1500 },
    { id: 'sher', name: 'Sherman', tier: 3, cls: 'Средний', desc: 'Массовый и надёжный. Стабильная линия огня команды.', stats: { dmg: 3, rof: 4, spd: 4, mnv: 4, view: 4, hp: 3 }, cost: 4500 },
    { id: 'e8', name: 'Easy 8', tier: 4, cls: 'Средний', desc: 'Шерман на максималках: ход, стабилизация, темп.', stats: { dmg: 4, rof: 5, spd: 5, mnv: 5, view: 5, hp: 4 }, cost: 12000 },
    { id: 'per', name: 'Pershing', tier: 5, cls: 'Тяжёлый', desc: 'Ответ Тигру. Тяжёлая башня, убойный первый выстрел.', stats: { dmg: 5, rof: 4, spd: 4, mnv: 4, view: 5, hp: 5 }, cost: 30000 },
    { id: 'm48', name: 'M48 Patton', tier: 6, cls: 'Средний', desc: 'Универсал поствоенной школы: всего по чуть-чуть, и всё работает.', stats: { dmg: 6, rof: 5, spd: 5, mnv: 5, view: 6, hp: 5 }, cost: 70000 },
    { id: 'm60', name: 'M60', tier: 7, cls: 'Средний', desc: 'Патруль холодной войны. Надёжный, зоркий, везде успевает.', stats: { dmg: 7, rof: 6, spd: 6, mnv: 6, view: 7, hp: 6 }, cost: 150000 },
    { id: 'abr', name: 'M1 Abrams', tier: 8, cls: 'Тяжёлый', desc: 'Газотурбинный монстр: композитная броня и убойный темп.', stats: { dmg: 9, rof: 6, spd: 7, mnv: 6, view: 9, hp: 9 }, cost: 300000 },
  ],
}

// плоские каталоги
export const TANKS = Object.values(TANKS_BY_NATION).flat().map(withClass)
export const TANK_BY_ID = Object.fromEntries(TANKS.map((t) => [t.id, t]))
export const tanksOfNation = (nation) => (TANKS_BY_NATION[nation] || []).map(withClass)
// танк, разблокированный с самого начала в каждой нации (tier 1)
export const STARTERS = ['t26', 'pz2', 'm2l']
export const nationOf = (tankId) =>
  Object.keys(TANKS_BY_NATION).find((n) => TANKS_BY_NATION[n].some((t) => t.id === tankId)) || 'ussr'

export const STAT_LABELS = { dmg: 'Урон', rof: 'Скорострельность', spd: 'Скорость', mnv: 'Манёвр', view: 'Обзор', hp: 'Прочность' }

// ---------- реальные боевые статы танка (deg-форма для движка) ----------
// Сектор/линия сведения/допуск — характер класса; остальное считается из
// дисплейных статов 0..10, так что КАЖДЫЙ танк в бою ощущается по-своему.
import { TANK_CLASSES } from './config.js'
export function combatStats(tank) {
  const s = tank.stats
  const cls = TANK_CLASSES[tank.classId] || TANK_CLASSES.medium
  const maxSpeed = 55 + s.spd * 12
  return {
    ...cls, // id/label/sectorDeg/sweepPeriod/toleranceDeg/range — профиль класса
    damage: Math.round(14 + s.dmg * 4.5),
    reload: +(6.4 - s.rof * 0.5).toFixed(2),
    maxSpeed,
    accel: Math.round(maxSpeed * 1.1), // разгон ~1с до полной — масса чувствуется
    turnRate: +(0.55 + s.mnv * 0.12).toFixed(2), // танк, а не машинка
    vision: 280 + s.view * 32,
    hp: 60 + s.hp * 14,
  }
}

// ---------- модули: 5 слотов × 3 уровня (штатный → топ) ----------
export const MODULE_DEFS = [
  { id: 'gun', label: 'Пушка', levels: ['Штатная', 'Улучшенная', 'Длинноствольная'], stats: ['базовое оснащение', 'урон +10%', 'урон +22%'] },
  { id: 'tur', label: 'Башня', levels: ['Штатная', 'Усиленная', 'Командирская'], stats: ['базовое оснащение', 'прочность +8%', 'прочность +18%'] },
  { id: 'eng', label: 'Двигатель', levels: ['Штатный', 'Форсированный', 'Дизельный'], stats: ['базовое оснащение', 'скорость +8%', 'скорость +16%'] },
  { id: 'trk', label: 'Гусеницы', levels: ['Штатные', 'Усиленные', 'Маневровые'], stats: ['базовое оснащение', 'манёвр +8%', 'манёвр +16%'] },
  { id: 'rad', label: 'Рация', levels: ['Штатная', 'Дальняя', 'Командирская'], stats: ['базовое оснащение', 'обзор +12%', 'обзор +24%'] },
]

// множители на боевые статы класса по уровню модуля (1=штатный)
export const MODULE_COMBAT = {
  gun: [1, 1.1, 1.22], // урон
  tur: [1, 1.08, 1.18], // прочность (HP танка в бою)
  eng: [1, 1.08, 1.16], // скорость + ускорение
  trk: [1, 1.08, 1.16], // поворот
  rad: [1, 1.12, 1.24], // обзор
}

// ---------- взвод и рефералы (порт screen-squad) ----------
export const FRIENDS = [
  { id: 'f1', name: 'Серый_152', tank: 'КВ-1', status: 'online' },
  { id: 'f2', name: 'MaxPower', tank: 'Т-34', status: 'online' },
  { id: 'f3', name: 'Кефир', tank: 'БТ-7', status: 'battle' },
  { id: 'f4', name: 'Danila_PRO', tank: 'Pz. IV', status: 'online' },
  { id: 'f5', name: 'штурман77', tank: 'Т-26', status: 'offline' },
]
export const FRIEND_STATUS = {
  online: { label: 'В сети', color: 'var(--green)' },
  battle: { label: 'В бою', color: 'var(--red)' },
  offline: { label: 'Не в сети', color: 'var(--ink-faint)' },
}
export const REF_NAMES = ['Виталя_98', 'KOT_B_TANKE', 'Лёха77', 'sn1per_x', 'Бородач']
export const REF_MILESTONES = [
  { need: 1, label: '500 кредитов', credits: 500, tokens: 0 },
  { need: 3, label: 'Офицерский ящик', credits: 1800, tokens: 0 },
  { need: 5, label: '25 жетонов', credits: 0, tokens: 25 },
]

export const moduleCost = (tier, level) => tier * (level === 2 ? 350 : 700)

// ---------- голдовые снаряды ----------
export const GOLD_AMMO_MULT = 1.35 // множитель урона голдового снаряда
export const GOLD_AMMO_PACKS = [
  { id: 'g1', amount: 10, costTokens: 12 },
  { id: 'g2', amount: 30, costTokens: 30 },
]

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

// ---------- рейтинг ----------
export const RATING_START = 1000
export const RATING_DELTA = { victory: 24, draw: 2, defeat: -16 }
// фейковые соперники лидерборда (бэкенда пока нет)
export const RATING_RIVALS = ['Kolyan_T34', 'дед_максим', 'Shtorm_88', 'Виталя_98', 'KOT_B_TANKE', 'Лёха77', 'sn1per_x', 'Бородач', 'MaxPower', 'Кефир']
export const modLevel = (modules, tankId, modId) => ((modules || {})[tankId] || {})[modId] || 1
export const modsMaxed = (modules, tankId) => MODULE_DEFS.every((m) => modLevel(modules, tankId, m.id) >= 3)
export const modsMaxedCount = (modules, tankId) => MODULE_DEFS.filter((m) => modLevel(modules, tankId, m.id) >= 3).length
