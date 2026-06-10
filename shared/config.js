// ============ PANZER TG — общие боевые константы (клиент + сервер) ============
// Скопировано из client/src/game/config.js при выносе симуляции на сервер.
// ВАЖНО: при изменении баланса править ЗДЕСЬ; клиент будет переведён на этот
// пакет следующим шагом (пока его config.js — дубль).
const DEG = Math.PI / 180

export const TANK_CLASSES = {
  light: {
    id: 'light',
    label: 'Лёгкий',
    sectorDeg: 58,
    sweepPeriod: 1.9,
    toleranceDeg: 5.5,
    reload: 2.2,
    damage: 22,
    hp: 80,
    range: 560,
    vision: 520,
    maxSpeed: 160,
    accel: 380,
    turnRate: 2.6,
  },
  medium: {
    id: 'medium',
    label: 'Средний',
    sectorDeg: 46,
    sweepPeriod: 2.5,
    toleranceDeg: 4,
    reload: 3.4,
    damage: 34,
    hp: 120,
    range: 600,
    vision: 440,
    maxSpeed: 120,
    accel: 270,
    turnRate: 1.8,
  },
  heavy: {
    id: 'heavy',
    label: 'Тяжёлый',
    sectorDeg: 30,
    sweepPeriod: 3.8,
    toleranceDeg: 3.5,
    reload: 5.0,
    damage: 52,
    hp: 180,
    range: 640,
    vision: 360,
    maxSpeed: 85,
    accel: 190,
    turnRate: 1.2,
  },
}

export const DEFAULT_CLASS = 'medium'
export const MAP_SIZE = 2400

// Модули карты (см. клиентский config.js — карта Фазы 5):
// block — камень (ход+обзор), bush — лес (только обзор),
// water — озеро (ход, поверх видно), hill — холм (ход+обзор).
export const OBSTACLES = [
  { dx: -700, dy: -460, r: 96, kind: 'bush' },
  { dx: -540, dy: -560, r: 84, kind: 'bush' },
  { dx: -840, dy: -320, r: 78, kind: 'bush' },
  { dx: -560, dy: -360, r: 72, kind: 'bush' },
  { dx: -400, dy: -480, r: 64, kind: 'bush' },
  { dx: 300, dy: -120, r: 96, kind: 'bush' },
  { dx: -360, dy: 240, r: 112, kind: 'bush' },
  { dx: 80, dy: -260, r: 60, kind: 'bush' },
  { dx: -140, dy: 460, r: 80, kind: 'bush' },
  { dx: 860, dy: 60, r: 150, kind: 'water' },
  { dx: 760, dy: -90, r: 110, kind: 'water' },
  { dx: 920, dy: 230, r: 120, kind: 'water' },
  { dx: -880, dy: 140, r: 130, kind: 'hill' },
  { dx: -1000, dy: -60, r: 100, kind: 'hill' },
  { dx: -260, dy: -200, r: 72, kind: 'block' },
  { dx: 140, dy: 280, r: 64, kind: 'block' },
  { dx: 440, dy: 340, r: 78, kind: 'block' },
  { dx: -540, dy: -80, r: 84, kind: 'block' },
]

export const WALLS = [
  { dx: -90, dy: -30, w: 180, h: 44 },
  { dx: -430, dy: 70, w: 44, h: 240 },
  { dx: 400, dy: -110, w: 44, h: 240 },
  { dx: -320, dy: -320, w: 220, h: 44 },
  { dx: 560, dy: -460, w: 110, h: 110 },
  { dx: 740, dy: -460, w: 110, h: 110 },
  { dx: 560, dy: -290, w: 110, h: 110 },
  { dx: 740, dy: -290, w: 110, h: 110 },
  { dx: 70, dy: 380, w: 260, h: 44 },
  { dx: 300, dy: 300, w: 44, h: 200 },
  { dx: 480, dy: 560, w: 160, h: 40 },
  { dx: -260, dy: 620, w: 40, h: 150 },
  { dx: 240, dy: 660, w: 120, h: 40 },
]

export const BASES = [
  { team: 0, dx: 0, dy: 800, r: 160 },
  { team: 1, dx: 0, dy: -800, r: 160 },
]

export const CAPTURE_POINTS = [
  { id: 'A', dx: -560, dy: 0, r: 130 },
  { id: 'B', dx: 0, dy: 0, r: 140 },
  { id: 'C', dx: 560, dy: 0, r: 130 },
]
export const CAP_TIME = 6
export const CAP_TICK = 8

export const SCORE_LIMIT = 25
export const MATCH_TIME = 240

// криты модулей (только людям — у ботов модулей нет)
export const CRIT_CHANCE = 0.35
export const CRIT_TIME = 4.5
export const RADIO_CRIT_MULT = 0.5
export const CRIT_SLOTS = ['gun', 'turret', 'engine', 'tracks', 'radio']

export const ENEMY_AI = {
  vision: 620,
  idealRange: 360,
  sectorHalfDeg: 26,
  hitChance: 0.45,
  radius: 18,
}
export const BOT_CLASS_MIX = ['light', 'medium', 'heavy', 'medium', 'light', 'medium', 'light']
export const BOT_DMG_MULT = 0.45
export const BOT_SPEED_MULT = 0.85
export const BOT_SPOT_VISION = 480 // вклад бота в засвет для команды
export const TANK_RADIUS = 22

export const BOT_NAMES = {
  0: ['ст. сержант Ефимов', 'ефрейтор Козлов', 'мл. сержант Орлов', 'рядовой Багиров', 'сержант Чистяков', 'рядовой Тёркин', 'ефрейтор Махов'],
  1: ['Hans_77', 'Wolf_K', 'Otto_Panzer', 'Schnell88', 'Gretta_X', 'Fritz_22', 'Klaus_M', 'Dieter_9'],
}

export function classToRadians(cls) {
  return {
    ...cls,
    sectorHalf: (cls.sectorDeg * DEG) / 2,
    tolerance: cls.toleranceDeg * DEG,
  }
}
