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

// Рельеф/стены/базы/точки переехали в shared/maps.js (6 карт);
// карту боя выбирает сервер при старте комнаты.
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
