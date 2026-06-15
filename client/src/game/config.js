// Параметры классов танков для механики сведения.
// Прямая проверка дизайн-гипотезы из ГДД:
//   лёгкий  — широкий сектор + быстрая линия  -> попадать СЛОЖНЕЕ
//   тяжёлый — узкий сектор  + медленная линия -> попадать ПРОЩЕ
//
// sectorDeg   — полная ширина сектора стрельбы (градусы)
// sweepPeriod — время одного полного прохода линии туда-обратно (сек)
// toleranceDeg— угловой допуск попадания вокруг линии (градусы)
// reload      — перезарядка между выстрелами (сек)
// damage      — урон по врагу за попадание
// range       — дальность стрельбы (px = длина сектора)
// maxSpeed    — максимальная скорость хода (px/сек, двигатель)
// accel       — ускорение (px/сек^2, двигатель)
// turnRate    — скорость поворота корпуса (рад/сек, гусеницы)
const DEG = Math.PI / 180

export const TANK_CLASSES = {
  light: {
    id: 'light',
    label: 'Лёгкий',
    sectorDeg: 58,
    sweepPeriod: 1.9,
    toleranceDeg: 5.5,
    reload: 2.2,
    damage: 160, // крупные числа ×DMG_SCALE(7.25) — синхрон с meta.js/shared
    hp: 1160, // ×HP_SCALE(14.5)
    range: 560,
    vision: 520,
    maxSpeed: 160,
    accel: 380,
    turnRate: 1.6,
  },
  medium: {
    id: 'medium',
    label: 'Средний',
    sectorDeg: 46,
    sweepPeriod: 2.5,
    toleranceDeg: 4,
    reload: 3.4,
    damage: 247, // ×DMG_SCALE(7.25)
    hp: 1740, // ×HP_SCALE(14.5)
    range: 600,
    vision: 440,
    maxSpeed: 120,
    accel: 270,
    turnRate: 1.2,
  },
  heavy: {
    id: 'heavy',
    label: 'Тяжёлый',
    sectorDeg: 30,
    sweepPeriod: 3.8,
    toleranceDeg: 3.5,
    reload: 5.0,
    damage: 377, // ×DMG_SCALE(7.25)
    hp: 2610, // ×HP_SCALE(14.5)
    range: 640,
    vision: 360,
    maxSpeed: 85,
    accel: 190,
    turnRate: 0.85,
  },
}

export const DEFAULT_CLASS = 'medium'
export const MAP_SIZE = 2400 // карта больше экрана; камера едет за танком
export const VISION_RADIUS = 560 // радиус обзора (туман войны)

// Рельеф, стены, базы и точки захвата теперь живут в maps.js (6 карт);
// какая карта в бою — решает жребий в App.play().

export const TEAM_SIZE = 7 // 7v7: игрок + (TEAM_SIZE-1) союзных ботов против TEAM_SIZE врагов
export const ALLY_VISION = 480 // обзор союзного бота (для засвета врагов команде)
export const PROX_SPOT = 150 // проксимити-засвет: вплотную видно сквозь куст/стену

export const CAP_TIME = 6 // сек удержания для захвата точки
export const CAP_TICK = 8 // каждые N сек +1 очко команде с БОЛЬШИНСТВОМ точек

// Условия матча (Фаза 4): бой кончается, когда команда набирает SCORE_LIMIT
// очков ИЛИ истекает MATCH_TIME — побеждает команда с большим счётом.
export const SCORE_LIMIT = 25
export const MATCH_TIME = 240 // сек (4 минуты)
// захват ВСЕХ точек не заканчивает бой мгновенно — идёт отсчёт удержания: победа
// через WIN_HOLD_SEC сек, если враг не отобьёт точку и не собьёт отсчёт.
export const WIN_HOLD_SEC = 30
// Одна жизнь за бой: возрождений нет, уничтоженная команда
// проигрывает сразу — см. Game._checkMatchEnd.

// Повреждение модулей (Фаза 5): попадание по игроку с шансом CRIT_CHANCE
// выводит случайный исправный модуль из строя на CRIT_TIME секунд (чинится сам).
// Эффекты: gun — нельзя стрелять, engine — нет хода вперёд, tracks — нет поворота,
// turret — линия сведения замирает (теряется тайминг), radio — обзор × RADIO_CRIT_MULT.
export const CRIT_CHANCE = 0.35
export const CRIT_TIME = 4.5
export const RADIO_CRIT_MULT = 0.5
export const CRIT_SLOTS = ['gun', 'turret', 'engine', 'tracks', 'radio']
export const CRIT_LABELS = {
  gun: 'ПУШКА',
  turret: 'БАШНЯ',
  engine: 'ДВИГАТЕЛЬ',
  tracks: 'ГУСЕНИЦЫ',
  radio: 'РАЦИЯ',
}

// Общие параметры ИИ ботов. Боевые статы (hp/урон/скорость/перезарядка)
// бот берёт из СВОЕГО класса TANK_CLASSES — состав команды в BOT_CLASS_MIX.
export const ENEMY_AI = {
  vision: 620,
  idealRange: 360, // держит дистанцию
  sectorHalfDeg: 26,
  hitChance: 0.45,
  radius: 18,
}
// Состав команды ботов по индексу (5 слотов) и понижающие коэффициенты
// (бот стреляет стабильно по кд, поэтому слабее игрока на выстрел).
export const BOT_CLASS_MIX = ['light', 'medium', 'heavy', 'medium', 'light']
export const BOT_DMG_MULT = 0.45
export const BOT_SPEED_MULT = 0.85

// Перевод параметров класса в радианы для движка.
export function classToRadians(cls) {
  return {
    ...cls,
    sectorHalf: (cls.sectorDeg * DEG) / 2,
    tolerance: cls.toleranceDeg * DEG,
  }
}
