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
    sweepPeriod: 1.15,
    toleranceDeg: 5.5,
    reload: 2.2,
    damage: 22,
    range: 560,
    vision: 520,
    maxSpeed: 235,
    accel: 620,
    turnRate: 3.4,
  },
  medium: {
    id: 'medium',
    label: 'Средний',
    sectorDeg: 46,
    sweepPeriod: 1.5,
    toleranceDeg: 4,
    reload: 3.4,
    damage: 34,
    range: 600,
    vision: 440,
    maxSpeed: 175,
    accel: 430,
    turnRate: 2.3,
  },
  heavy: {
    id: 'heavy',
    label: 'Тяжёлый',
    sectorDeg: 30,
    sweepPeriod: 2.4,
    toleranceDeg: 3.5,
    reload: 5.0,
    damage: 52,
    range: 640,
    vision: 360,
    maxSpeed: 120,
    accel: 300,
    turnRate: 1.5,
  },
}

export const DEFAULT_CLASS = 'medium'
export const ENEMY_MAX_HP = 100
export const PLAYER_MAX_HP = 100
export const MAP_SIZE = 2400 // карта больше экрана; камера едет за танком
export const VISION_RADIUS = 560 // радиус обзора (туман войны)

// Модули карты вокруг центра арены (dx/dy от центра карты).
// kind: 'block' — камень/руины (блокирует ход и обзор),
//       'bush'  — лес (проходим, но скрывает обзор/линию огня),
//       'water' — озеро (непроходимо, но стрелять/смотреть поверх можно),
//       'hill'  — холм (непроходим и закрывает обзор, как большой камень).
// Зоны (Фаза 5): лес NW, озеро E, холмы W, камни по центру; город/руины — в WALLS.
export const OBSTACLES = [
  // — лес (северо-запад): плотный массив кустов
  { dx: -700, dy: -460, r: 96, kind: 'bush' },
  { dx: -540, dy: -560, r: 84, kind: 'bush' },
  { dx: -840, dy: -320, r: 78, kind: 'bush' },
  { dx: -560, dy: -360, r: 72, kind: 'bush' },
  { dx: -400, dy: -480, r: 64, kind: 'bush' },
  // — рощицы у середины (фланговые подходы)
  { dx: 300, dy: -120, r: 96, kind: 'bush' },
  { dx: -360, dy: 240, r: 112, kind: 'bush' },
  { dx: 80, dy: -260, r: 60, kind: 'bush' },
  { dx: -140, dy: 460, r: 80, kind: 'bush' },
  // — озеро (восток): стрелять поверх можно, ехать нельзя
  { dx: 860, dy: 60, r: 150, kind: 'water' },
  { dx: 760, dy: -90, r: 110, kind: 'water' },
  { dx: 920, dy: 230, r: 120, kind: 'water' },
  // — холмы (запад)
  { dx: -880, dy: 140, r: 130, kind: 'hill' },
  { dx: -1000, dy: -60, r: 100, kind: 'hill' },
  // — камни по центру
  { dx: -260, dy: -200, r: 72, kind: 'block' },
  { dx: 140, dy: 280, r: 64, kind: 'block' },
  { dx: 440, dy: 340, r: 78, kind: 'block' },
  { dx: -540, dy: -80, r: 84, kind: 'block' },
]

export const TEAM_SIZE = 5 // 5v5: игрок + (TEAM_SIZE-1) союзных ботов против TEAM_SIZE врагов
export const ALLY_VISION = 480 // обзор союзного бота (для засвета врагов команде)

// Стены-укрытия (прямоугольники). dx/dy — центр от центра карты, w/h — размеры.
export const WALLS = [
  // — центр
  { dx: -90, dy: -30, w: 180, h: 44 }, // центральное укрытие
  { dx: -430, dy: 70, w: 44, h: 240 },
  { dx: 400, dy: -110, w: 44, h: 240 },
  { dx: -320, dy: -320, w: 220, h: 44 },
  // — город (северо-восток): квартал зданий
  { dx: 560, dy: -460, w: 110, h: 110 },
  { dx: 740, dy: -460, w: 110, h: 110 },
  { dx: 560, dy: -290, w: 110, h: 110 },
  { dx: 740, dy: -290, w: 110, h: 110 },
  // — руины (юг): обломки стен
  { dx: 70, dy: 380, w: 260, h: 44 },
  { dx: 300, dy: 300, w: 44, h: 200 },
  { dx: 480, dy: 560, w: 160, h: 40 },
  { dx: -260, dy: 620, w: 40, h: 150 },
  { dx: 240, dy: 660, w: 120, h: 40 },
]

// Базы команд (напротив друг друга): союзная снизу, вражеская сверху.
export const BASES = [
  { team: 0, dx: 0, dy: 800, r: 160 },
  { team: 1, dx: 0, dy: -800, r: 160 },
]

// Точки захвата (A/B/C) поперёк центра карты.
export const CAPTURE_POINTS = [
  { id: 'A', dx: -560, dy: 0, r: 130 },
  { id: 'B', dx: 0, dy: 0, r: 140 },
  { id: 'C', dx: 560, dy: 0, r: 130 },
]
export const CAP_TIME = 6 // сек удержания для захвата точки
export const CAP_TICK = 8 // каждые N сек +1 очко команде с БОЛЬШИНСТВОМ точек

// Условия матча (Фаза 4): бой кончается, когда команда набирает SCORE_LIMIT
// очков ИЛИ истекает MATCH_TIME — побеждает команда с большим счётом.
export const SCORE_LIMIT = 25
export const MATCH_TIME = 240 // сек (4 минуты)
export const BOT_RESPAWN = 5 // сек до возрождения бота

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

// Боевые параметры бота-танка (ИИ) — общие для союзных и вражеских.
export const ENEMY_AI = {
  speed: 150,
  turnRate: 2.2,
  vision: 620,
  idealRange: 360, // держит дистанцию
  sectorHalfDeg: 26,
  fireCd: 1.7, // перезарядка бота
  damage: 11,
  hitChance: 0.45,
  radius: 18,
}

// Перевод параметров класса в радианы для движка.
export function classToRadians(cls) {
  return {
    ...cls,
    sectorHalf: (cls.sectorDeg * DEG) / 2,
    tolerance: cls.toleranceDeg * DEG,
  }
}
