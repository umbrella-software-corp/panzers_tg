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

export const TANKS_BY_NATION = {
  ussr: [
    { id: 't26', name: 'Т-26', tier: 1, cls: 'Лёгкий', desc: 'Широкий сектор, быстрая линия, лучший обзор. Разведка и манёвр.', stats: { dmg: 3, rof: 8, spd: 8, mnv: 8, view: 9 } },
    { id: 'bt7', name: 'БТ-7', tier: 2, cls: 'Лёгкий', desc: 'Самый быстрый в линейке. Жалит и уходит до ответного выстрела.', stats: { dmg: 4, rof: 7, spd: 10, mnv: 9, view: 7 }, cost: 600 },
    { id: 't34', name: 'Т-34', tier: 3, cls: 'Средний', desc: 'Золотая середина: броня, ход и орудие без слабых мест.', stats: { dmg: 6, rof: 6, spd: 7, mnv: 6, view: 6 }, cost: 1200 },
    { id: 't3485', name: 'Т-34-85', tier: 4, cls: 'Средний', desc: 'Тот же корпус — новая башня. Пробивает то, что Т-34 не брал.', stats: { dmg: 7, rof: 5, spd: 7, mnv: 6, view: 6 }, cost: 2600 },
    { id: 'kv1', name: 'КВ-1', tier: 5, cls: 'Тяжёлый', desc: 'Стальная стена. Медленный, но держит удар за всю команду.', stats: { dmg: 8, rof: 3, spd: 3, mnv: 3, view: 4 }, cost: 4800 },
  ],
  ger: [
    { id: 'pz2', name: 'Pz. II', tier: 1, cls: 'Лёгкий', desc: 'Скорострельная малокалиберка. Шквал огня на ближней дистанции.', stats: { dmg: 2, rof: 10, spd: 8, mnv: 8, view: 7 } },
    { id: 'pz3', name: 'Pz. III', tier: 2, cls: 'Лёгкий', desc: 'Точный и дисциплинированный. Дуэлянт на средней дистанции.', stats: { dmg: 4, rof: 7, spd: 7, mnv: 7, view: 7 }, cost: 600 },
    { id: 'pz4', name: 'Pz. IV', tier: 3, cls: 'Средний', desc: 'Рабочая лошадь вермахта. Стабильный урон в любой ситуации.', stats: { dmg: 6, rof: 6, spd: 6, mnv: 6, view: 6 }, cost: 1200 },
    { id: 'pnt', name: 'Panther', tier: 4, cls: 'Средний', desc: 'Длинная пушка, точность снайпера. Контроль линии огня.', stats: { dmg: 7, rof: 5, spd: 7, mnv: 5, view: 8 }, cost: 2600 },
    { id: 'tgr', name: 'Tiger', tier: 5, cls: 'Тяжёлый', desc: 'Легенда страха. Один выстрел решает перестрелку.', stats: { dmg: 10, rof: 3, spd: 4, mnv: 3, view: 5 }, cost: 4800 },
  ],
  usa: [
    { id: 'm2l', name: 'M2 Light', tier: 1, cls: 'Лёгкий', desc: 'Юркий разведчик. Пулемётный шквал по лёгкой броне.', stats: { dmg: 2, rof: 9, spd: 9, mnv: 8, view: 8 } },
    { id: 'stu', name: 'Stuart', tier: 2, cls: 'Лёгкий', desc: 'Быстрый фланговый нож. Кружи и жаль в корму.', stats: { dmg: 3, rof: 8, spd: 9, mnv: 9, view: 7 }, cost: 600 },
    { id: 'sher', name: 'Sherman', tier: 3, cls: 'Средний', desc: 'Массовый и надёжный. Стабильная линия огня команды.', stats: { dmg: 5, rof: 7, spd: 6, mnv: 6, view: 6 }, cost: 1200 },
    { id: 'e8', name: 'Easy 8', tier: 4, cls: 'Средний', desc: 'Шерман на максималках: ход, стабилизация, темп.', stats: { dmg: 6, rof: 7, spd: 7, mnv: 7, view: 7 }, cost: 2600 },
    { id: 'per', name: 'Pershing', tier: 5, cls: 'Тяжёлый', desc: 'Ответ Тигру. Тяжёлая башня, убойный первый выстрел.', stats: { dmg: 9, rof: 4, spd: 5, mnv: 4, view: 6 }, cost: 4800 },
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

export const STAT_LABELS = { dmg: 'Урон', rof: 'Скорострельность', spd: 'Скорость', mnv: 'Манёвр', view: 'Обзор' }

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

export const moduleCost = (tier, level) => tier * (level === 2 ? 120 : 240)
export const modLevel = (modules, tankId, modId) => ((modules || {})[tankId] || {})[modId] || 1
export const modsMaxed = (modules, tankId) => MODULE_DEFS.every((m) => modLevel(modules, tankId, m.id) >= 3)
export const modsMaxedCount = (modules, tankId) => MODULE_DEFS.filter((m) => modLevel(modules, tankId, m.id) >= 3).length
