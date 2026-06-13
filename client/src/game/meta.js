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

// Статы 0..10 (dmg/rof/spd/mnv/view/hp) — шкала растянута на 10 уровней
// до новейших машин: тир-1 — честное днище (1-3), топ-10 — 9-10.
// Профильные просадки только у тяжёлых: темп/ход в обмен на dmg+hp.
// Из них же считаются РЕАЛЬНЫЕ боевые статы (combatStats) — у каждого
// танка свой бой, а не общий по классу.
export const MAX_TIER = 10
export const TANKS_BY_NATION = {
  ussr: [
    { id: 't26', name: 'Т-26', tier: 1, cls: 'Лёгкий', desc: 'Учебная парта танкиста. Лёгкий, простой, везде успевает.', stats: { dmg: 1, rof: 3, spd: 3, mnv: 3, view: 2, hp: 1 } },
    { id: 'bt7', name: 'БТ-7', tier: 2, cls: 'Лёгкий', desc: 'Самый быстрый в довоенной линейке. Жалит и уходит.', stats: { dmg: 2, rof: 4, spd: 5, mnv: 4, view: 3, hp: 2 }, cost: 200 },
    { id: 't34', name: 'Т-34', tier: 3, cls: 'Средний', desc: 'Золотая середина: броня, ход и орудие без слабых мест.', stats: { dmg: 3, rof: 5, spd: 5, mnv: 4, view: 4, hp: 3 }, cost: 600 },
    { id: 't3485', name: 'Т-34-85', tier: 4, cls: 'Средний', desc: 'Тот же корпус — новая башня. Пробивает то, что Т-34 не брал.', stats: { dmg: 4, rof: 5, spd: 5, mnv: 5, view: 5, hp: 4 }, cost: 1500 },
    { id: 'kv1', name: 'КВ-1', tier: 5, cls: 'Тяжёлый', desc: 'Стальная стена. Медленный, но держит удар за всю команду.', stats: { dmg: 6, rof: 3, spd: 3, mnv: 3, view: 4, hp: 6 }, cost: 9000 },
    { id: 'is2', name: 'ИС-2', tier: 6, cls: 'Тяжёлый', desc: 'Зверобой. 122-мм аргумент, после которого спор окончен.', stats: { dmg: 7, rof: 3, spd: 4, mnv: 4, view: 5, hp: 7 }, cost: 28000 },
    { id: 't72', name: 'Т-72', tier: 7, cls: 'Средний', desc: 'Рабочая лошадь холодной войны: автомат заряжания, низкий силуэт.', stats: { dmg: 7, rof: 6, spd: 7, mnv: 6, view: 7, hp: 6 }, cost: 75000 },
    { id: 't90', name: 'Т-90', tier: 8, cls: 'Средний', desc: 'Современный ОБТ: тепловизор, динамическая защита, точность.', stats: { dmg: 8, rof: 7, spd: 8, mnv: 7, view: 9, hp: 7 }, cost: 190000 },
    { id: 't80u', name: 'Т-80У', tier: 9, cls: 'Средний', desc: 'Газотурбинная молния. Врывается первым и уходит до ответа.', stats: { dmg: 8, rof: 7, spd: 9, mnv: 8, view: 8, hp: 7 }, cost: 430000 },
    { id: 't14', name: 'Т-14 Армата', tier: 10, cls: 'Тяжёлый', desc: 'Необитаемая башня, «Афганит». Танк из будущего — уже здесь.', stats: { dmg: 10, rof: 7, spd: 8, mnv: 7, view: 10, hp: 10 }, cost: 1000000 },
  ],
  ger: [
    { id: 'pz2', name: 'Pz. II', tier: 1, cls: 'Лёгкий', desc: 'Скорострельная малокалиберка. Шквал огня на ближней дистанции.', stats: { dmg: 1, rof: 4, spd: 3, mnv: 3, view: 2, hp: 1 } },
    { id: 'pz3', name: 'Pz. III', tier: 2, cls: 'Лёгкий', desc: 'Точный и дисциплинированный. Дуэлянт на средней дистанции.', stats: { dmg: 2, rof: 4, spd: 4, mnv: 4, view: 3, hp: 2 }, cost: 200 },
    { id: 'pz4', name: 'Pz. IV', tier: 3, cls: 'Средний', desc: 'Рабочая лошадь вермахта. Стабильный урон в любой ситуации.', stats: { dmg: 3, rof: 4, spd: 4, mnv: 4, view: 4, hp: 3 }, cost: 600 },
    { id: 'pnt', name: 'Panther', tier: 4, cls: 'Средний', desc: 'Длинная пушка, точность снайпера. Контроль линии огня.', stats: { dmg: 4, rof: 4, spd: 5, mnv: 4, view: 6, hp: 4 }, cost: 1500 },
    { id: 'tgr', name: 'Tiger', tier: 5, cls: 'Тяжёлый', desc: 'Легенда страха. Один выстрел решает перестрелку.', stats: { dmg: 6, rof: 3, spd: 3, mnv: 3, view: 5, hp: 6 }, cost: 9000 },
    { id: 'tgr2', name: 'Tiger II', tier: 6, cls: 'Тяжёлый', desc: 'Королевский тигр: лоб, который не пробивается в принципе.', stats: { dmg: 7, rof: 3, spd: 4, mnv: 3, view: 5, hp: 7 }, cost: 28000 },
    { id: 'leo1', name: 'Leopard 1', tier: 7, cls: 'Средний', desc: 'Скорость вместо брони. Стреляй первым — и тебя не достанут.', stats: { dmg: 7, rof: 6, spd: 8, mnv: 7, view: 7, hp: 5 }, cost: 75000 },
    { id: 'leo2', name: 'Leopard 2', tier: 8, cls: 'Средний', desc: 'Эталон современного ОБТ: оптика, стабилизация, немецкая точность.', stats: { dmg: 8, rof: 7, spd: 8, mnv: 7, view: 9, hp: 8 }, cost: 190000 },
    { id: 'leo2a7', name: 'Leopard 2A7', tier: 9, cls: 'Средний', desc: 'Цифровое поле боя: видит всё, попадает с первого выстрела.', stats: { dmg: 9, rof: 7, spd: 8, mnv: 7, view: 9, hp: 8 }, cost: 430000 },
    { id: 'kf51', name: 'KF51 Panther', tier: 10, cls: 'Средний', desc: 'Новая «Пантера»: 130-мм орудие и дроны-разведчики на борту.', stats: { dmg: 10, rof: 8, spd: 9, mnv: 8, view: 10, hp: 8 }, cost: 1000000 },
  ],
  usa: [
    { id: 'm2l', name: 'M2 Light', tier: 1, cls: 'Лёгкий', desc: 'Юркий разведчик. Пулемётный шквал по лёгкой броне.', stats: { dmg: 1, rof: 4, spd: 4, mnv: 3, view: 2, hp: 1 } },
    { id: 'stu', name: 'Stuart', tier: 2, cls: 'Лёгкий', desc: 'Быстрый фланговый нож. Кружи и жаль в корму.', stats: { dmg: 2, rof: 5, spd: 5, mnv: 5, view: 3, hp: 2 }, cost: 200 },
    { id: 'sher', name: 'Sherman', tier: 3, cls: 'Средний', desc: 'Массовый и надёжный. Стабильная линия огня команды.', stats: { dmg: 3, rof: 4, spd: 4, mnv: 4, view: 4, hp: 3 }, cost: 600 },
    { id: 'e8', name: 'Easy 8', tier: 4, cls: 'Средний', desc: 'Шерман на максималках: ход, стабилизация, темп.', stats: { dmg: 4, rof: 5, spd: 5, mnv: 5, view: 5, hp: 4 }, cost: 1500 },
    { id: 'per', name: 'Pershing', tier: 5, cls: 'Тяжёлый', desc: 'Ответ Тигру. Тяжёлая башня, убойный первый выстрел.', stats: { dmg: 5, rof: 4, spd: 4, mnv: 4, view: 5, hp: 5 }, cost: 9000 },
    { id: 'm48', name: 'M48 Patton', tier: 6, cls: 'Средний', desc: 'Универсал поствоенной школы: всего по чуть-чуть, и всё работает.', stats: { dmg: 6, rof: 5, spd: 5, mnv: 5, view: 6, hp: 5 }, cost: 28000 },
    { id: 'm60', name: 'M60', tier: 7, cls: 'Средний', desc: 'Патруль холодной войны. Надёжный, зоркий, везде успевает.', stats: { dmg: 7, rof: 6, spd: 6, mnv: 6, view: 7, hp: 6 }, cost: 75000 },
    { id: 'abr', name: 'M1 Abrams', tier: 8, cls: 'Тяжёлый', desc: 'Газотурбинный монстр: композитная броня и убойный темп.', stats: { dmg: 9, rof: 6, spd: 7, mnv: 6, view: 9, hp: 9 }, cost: 190000 },
    { id: 'm1a2', name: 'M1A2 SEP', tier: 9, cls: 'Тяжёлый', desc: 'Абрамс с цифровой начинкой: тепловизоры третьего поколения.', stats: { dmg: 9, rof: 6, spd: 7, mnv: 7, view: 9, hp: 9 }, cost: 430000 },
    { id: 'abrx', name: 'AbramsX', tier: 10, cls: 'Тяжёлый', desc: 'Гибридный прототип: тише, злее, автомат заряжания на 30 тонн легче.', stats: { dmg: 10, rof: 8, spd: 8, mnv: 7, view: 10, hp: 9 }, cost: 1000000 },
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
  const maxSpeed = 42 + s.spd * 8.5 // танки тяжелее, не «гоночные» (порезано ~28%)
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

// ---------- экипаж: 5 специалистов, у каждого перк 0..3 ранга ----------
// Ранг перка стоит 1 очко навыка (+1 очко за уровень экипажа после первого,
// см. store) и кредиты. Очков меньше, чем рангов всего, — выбор имеет цену.
export const CREW_MEMBERS = [
  { id: 'cmd', role: 'Командир', name: 'к-н Орлов', icon: 'star', perk: 'Боевое братство', effect: '+1% к темпу, обзору, ходу и манёвру за ранг' },
  { id: 'gnr', role: 'Наводчик', name: 'ст. с-т Зайцев', icon: 'gun', perk: 'Снайпер', effect: '+3% к урону за ранг' },
  { id: 'lod', role: 'Заряжающий', name: 'ефр. Котов', icon: 'ammo', perk: 'Досылатель', effect: '−3% к перезарядке за ранг' },
  { id: 'drv', role: 'Мехвод', name: 'с-т Громов', icon: 'trk', perk: 'Виртуоз', effect: '+3% к ходу и манёвру за ранг' },
  { id: 'rad', role: 'Радист', name: 'мл. с-т Соколов', icon: 'rad', perk: 'Орлиный глаз', effect: '+4% к обзору за ранг' },
]
export const CREW_PERK_MAX = 3
export const CREW_PERK_COSTS = [800, 2000, 4500] // кредиты за ранг I/II/III
export const crewPerkCost = (curLevel) => CREW_PERK_COSTS[curLevel] ?? Infinity

// ---------- рефералы (взвод/друзья — через реальные Telegram deep-link'и, без фейка) ----------
export const REF_MILESTONES = [
  { need: 1, label: '500 кредитов', credits: 500, tokens: 0 },
  // оф-ящик: реальный дроп камуфляжа + кредиты+жетоны (crate:true в claimRefMilestone)
  { need: 3, label: 'Офицерский ящик', credits: 1000, tokens: 5, crate: true },
  { need: 5, label: '25 жетонов', credits: 0, tokens: 25 },
]

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
  { id: 'dmg600', label: 'Нанеси 600 урона', goal: 600, key: 'damage', credits: 400 },
  { id: 'kills3', label: 'Уничтожь 3 машины', goal: 3, key: 'kills', credits: 500 },
  { id: 'light2', label: 'Уничтожь 2 лёгких танка', goal: 2, key: 'lightKills', tokens: 5 },
  { id: 'block3', label: 'Заблокируй 3 снаряда бронёй', goal: 3, key: 'blocked', credits: 350 },
  { id: 'win1', label: 'Одержи победу', goal: 1, key: 'wins', credits: 600 },
  { id: 'battles3', label: 'Сыграй 3 боя', goal: 3, key: 'battles', credits: 300 },
]
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
  { id: 'std', name: 'Штатный', tint: 0xffffff, costTokens: 0 },
  { id: 'winter', name: 'Зимний', tint: 0xdce8ff, costTokens: 15, camo: { type: 'spots', colors: ['#e9eef5', '#b9c6d6', '#8794a6'], alpha: 0.6 } },
  { id: 'desert', name: 'Пустынный', tint: 0xffd9a0, costTokens: 15, camo: { type: 'spots', colors: ['#d8b87c', '#b08a50', '#8a683c'], alpha: 0.55 } },
  { id: 'forest', name: 'Лесной', tint: 0xa8cc8e, costTokens: 15, camo: { type: 'spots', colors: ['#5e7a3e', '#3c572c', '#7d6a45'], alpha: 0.55 } },
  { id: 'night', name: 'Ночной', tint: 0x9aa0ad, costTokens: 25, camo: { type: 'digital', colors: ['#3a4150', '#262c38', '#4d5666'], alpha: 0.62 } },
  { id: 'digital', name: 'Цифра', tint: 0xa9bba1, costTokens: 35, camo: { type: 'digital', colors: ['#7d8f72', '#55654e', '#a3b39a'], alpha: 0.6 } },
  { id: 'urban', name: 'Городской', tint: 0xc4c8cf, costTokens: 35, camo: { type: 'digital', colors: ['#9aa0a8', '#686d74', '#c9ced6'], alpha: 0.6 } },
  { id: 'tiger', name: 'Тигровый', tint: 0xd8b56a, costTokens: 45, camo: { type: 'stripes', colors: ['#c8a35e', '#332c1e'], alpha: 0.62 } },
  { id: 'gold', name: 'Парадный', tint: 0xffd24a, costTokens: 60 },
]
export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]))

// ---------- камуфляжи (3 на КАЖДЫЙ танк, AI-спрайты, не CSS) ----------
// Реальная перекраска машины: спрайт /sprites/camo/<tankId>_<camoId>.png
// (наш танк top-down, перекрашенный flux-kontext, на той же магенте — кеится
// в рантайме как обычный танк). id '' — заводская окраска (базовый спрайт).
export const CAMOS = [
  { id: '', name: 'Заводская', short: 'СТД', cost: 0 },
  { id: 'woodland', name: 'Лес', short: 'ЛЕС', cost: 25 },
  { id: 'desert', name: 'Пустыня', short: 'ПУСТ', cost: 25 },
  { id: 'winter', name: 'Зима', short: 'ЗИМА', cost: 25 },
  { id: 'tiger', name: 'Тигр', short: 'ТИГР', cost: 40 },
  { id: 'predator', name: 'Хищник', short: 'ХИЩ', cost: 40 },
  { id: 'magma', name: 'Магма', short: 'МАГМА', cost: 40 },
]
export const CAMO_BY_ID = Object.fromEntries(CAMOS.map((c) => [c.id, c]))
export const CAMO_IDS = CAMOS.map((c) => c.id).filter(Boolean)
// смена позывного — за Telegram Stars (цена авторитетна на сервере, PRODUCTS.rename)
export const RENAME_COST_STARS = 50

// ---------- воинские звания (по числу боёв) ----------
// Награда (credits/tokens) выдаётся ОДИН раз за каждое новое звание. Звание
// видно в карточке игрока, профиле и поиске боя.
export const RANKS = [
  { name: 'Рядовой', battles: 0, credits: 0 },
  { name: 'Ефрейтор', battles: 5, credits: 300 },
  { name: 'Мл. сержант', battles: 15, credits: 600 },
  { name: 'Сержант', battles: 30, credits: 1000, tokens: 2 },
  { name: 'Ст. сержант', battles: 50, credits: 1500, tokens: 3 },
  { name: 'Старшина', battles: 80, credits: 2200, tokens: 4 },
  { name: 'Прапорщик', battles: 120, credits: 3000, tokens: 5 },
  { name: 'Лейтенант', battles: 175, credits: 4200, tokens: 6 },
  { name: 'Ст. лейтенант', battles: 250, credits: 5800, tokens: 8 },
  { name: 'Капитан', battles: 350, credits: 7500, tokens: 10 },
  { name: 'Майор', battles: 500, credits: 9500, tokens: 12 },
  { name: 'Подполковник', battles: 700, credits: 13000, tokens: 16 },
  { name: 'Полковник', battles: 1000, credits: 18000, tokens: 22 },
  { name: 'Генерал', battles: 1500, credits: 28000, tokens: 35 },
]
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
  { min: 2900, label: 'АС', color: '#c64bff' },
  { min: 2000, label: 'ОТЛИЧНО', color: '#4aa3ff' },
  { min: 1500, label: 'ХОРОШО', color: '#5fd35f' },
  { min: 900, label: 'СРЕДНЕ', color: '#f2c14b' },
  { min: 400, label: 'НИЖЕ СРЕДНЕГО', color: '#e0853c' },
  { min: 0, label: 'НОВИЧОК', color: '#c2553f' },
]
export const ratingBand = (score) => RATING_BANDS.find((b) => score >= b.min) || RATING_BANDS[RATING_BANDS.length - 1]

// фейковые соперники лидерборда (бэкенда пока нет)
export const RATING_RIVALS = ['Kolyan_T34', 'дед_максим', 'Shtorm_88', 'Виталя_98', 'KOT_B_TANKE', 'Лёха77', 'sn1per_x', 'Бородач', 'MaxPower', 'Кефир']
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
  { id: 'warrior', name: 'Воин', desc: '3+ фрага за бой', tier: 'bronze', glyph: '✪', kind: 'battle', metric: 'kills', need: 3, reward: { credits: 150 } },
  { id: 'sniper', name: 'Снайпер раунда', desc: '5+ фрагов за бой', tier: 'gold', glyph: '✹', kind: 'battle', metric: 'kills', need: 5, reward: { credits: 500, tokens: 2 } },
  { id: 'firestorm', name: 'Огневой вал', desc: '1200+ урона за бой', tier: 'silver', glyph: '✸', kind: 'battle', metric: 'damage', need: 1200, reward: { credits: 300, tokens: 1 } },
  { id: 'wall', name: 'Стальная стена', desc: '300+ урона отражено бронёй', tier: 'silver', glyph: '⛨', kind: 'battle', metric: 'blocked', need: 300, reward: { credits: 300, tokens: 1 } },
  { id: 'scout', name: 'Орлиный глаз', desc: '2+ фрага по засвеченным', tier: 'bronze', glyph: '◉', kind: 'battle', metric: 'lightKills', need: 2, reward: { credits: 200 } },
  { id: 'survivor', name: 'Уцелевший', desc: 'Выжил в бою (одна жизнь)', tier: 'bronze', glyph: '✠', kind: 'battle', metric: 'survived', need: 1, reward: { credits: 150 } },
  { id: 'triumph', name: 'Чистая победа', desc: 'Победа без потери машины', tier: 'gold', glyph: '★', kind: 'battle', metric: 'triumph', need: 1, reward: { credits: 600, tokens: 3 } },
  // карьерные — рубежи
  { id: 'recruit', name: 'Новобранец', desc: '10 боёв', tier: 'bronze', glyph: '➀', kind: 'career', metric: 'battles', need: 10, reward: { credits: 200 } },
  { id: 'veteran', name: 'Ветеран', desc: '100 боёв', tier: 'silver', glyph: '➁', kind: 'career', metric: 'battles', need: 100, reward: { credits: 600, tokens: 2 } },
  { id: 'guards', name: 'Гвардеец', desc: '500 боёв', tier: 'gold', glyph: '➂', kind: 'career', metric: 'battles', need: 500, reward: { credits: 1500, tokens: 5 } },
  { id: 'hunter', name: 'Истребитель', desc: '100 уничтоженных машин', tier: 'silver', glyph: '⊗', kind: 'career', metric: 'kills', need: 100, reward: { credits: 600, tokens: 2 } },
  { id: 'ace', name: 'Ас войны', desc: '1000 уничтоженных машин', tier: 'gold', glyph: '✺', kind: 'career', metric: 'kills', need: 1000, reward: { credits: 2000, tokens: 8 } },
  { id: 'legend', name: 'Легенда', desc: 'Рейтинг 1500', tier: 'gold', glyph: '♛', kind: 'career', metric: 'rating', need: 1500, reward: { credits: 1500, tokens: 5 } },
]
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
