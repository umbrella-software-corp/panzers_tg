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
    damage: 160, // крупные числа: база 22 ×DMG_SCALE(7.25) — синхрон с meta.js
    hp: 1160, // база 80 ×HP_SCALE(14.5) — бои «мясистее» (~6-8 выстрелов)
    range: 560,
    vision: 440, // обзор урезан (был 520 — «слишком далеко»); ЧИСЛА ПОД ПЛЕЙТЕСТ
    maxSpeed: 116,
    accel: 300,
    turnRate: 2.6,
  },
  medium: {
    id: 'medium',
    label: 'Средний',
    sectorDeg: 46,
    sweepPeriod: 2.5,
    toleranceDeg: 4,
    reload: 3.4,
    damage: 247, // база 34 ×DMG_SCALE(7.25)
    hp: 1740, // база 120 ×HP_SCALE(14.5)
    range: 600,
    vision: 380, // обзор урезан (был 440)
    maxSpeed: 88,
    accel: 210,
    turnRate: 1.8,
  },
  heavy: {
    id: 'heavy',
    label: 'Тяжёлый',
    sectorDeg: 30,
    sweepPeriod: 3.8,
    toleranceDeg: 3.5,
    reload: 5.0,
    damage: 377, // база 52 ×DMG_SCALE(7.25)
    hp: 2610, // база 180 ×HP_SCALE(14.5)
    range: 640,
    vision: 310, // обзор урезан (был 360)
    maxSpeed: 62,
    accel: 150,
    turnRate: 1.2,
  },
}

export const DEFAULT_CLASS = 'medium'
export const MAP_SIZE = 2400
// задний ход медленнее переднего, но не вдвое (было ×0.5 — «слишком медленно»).
// ОДИН множитель и игроку, и ботам (sim _stepHuman/_stepBot) + клиентскому предикту
// (NetGame) — держать СИНХРОННО, иначе бот реверсит иначе игрока / предикт дёргает.
export const REVERSE_MULT = 0.7

// Рельеф/стены/базы/точки переехали в shared/maps.js (9 карт);
// карту боя выбирает сервер при старте комнаты.
export const CAP_TIME = 6
// очко начисляется КАЖДОЙ удержанной точке за тик: больше точек — быстрее
// счёт. Тик 10с держит длину матча при 2–3 точках разумной.
export const CAP_TICK = 10

export const SCORE_LIMIT = 25
export const MATCH_TIME = 240
// захват всех точек / вражеской базы не заканчивает бой мгновенно — запускается
// отсчёт удержания: победа атакующих через WIN_HOLD_SEC секунд, если защитники
// не отобьют объект (загонят танк / выбьют атакующих) и не собьют отсчёт.
export const WIN_HOLD_SEC = 30

// криты модулей (только людям — у ботов модулей нет)
export const CRIT_CHANCE = 0.35
export const CRIT_TIME = 4.5
export const RADIO_CRIT_MULT = 0.5
export const CRIT_SLOTS = ['gun', 'turret', 'engine', 'tracks', 'radio']

export const ENEMY_AI = {
  // зрение бота урезано до уровня игрока (раньше 620 — больше любого класса
  // 360–520, поэтому бот лупил из тумана: его танк тебе даже не отрисован, а
  // снаряды «из ниоткуда»). Теперь бот доезжает на дистанцию, где ты его видишь.
  vision: 500, // на этой дистанции бот замечает и едет к цели
  fireRange: 430, // СТРЕЛЯЕТ только в этом радиусе (≤ твой обзор → ты видишь стрелка)
  idealRange: 360,
  sectorHalfDeg: 26,
  hitChance: 0.42, // базовый шанс; дальше режется дистанцией/движением/кустом (см. sim)
  hitFalloff: 0.5, // на максимуме fireRange шанс падает до hitChance*(1-0.5)
  dodgeFactor: 0.4, // полный ход цели срезает шанс до hitChance*(1-0.4) — уворот работает
  bushCover: 0.4, // цель в кусте: шанс ×0.4 (мягкое укрытие против ботов)
  graceSec: 5, // «честный первый бой»: первые N секунд боты НЕ стреляют по людям
  radius: 18,
}
// «Мягкий старт»: ПЕРВЫЕ 5 БОЁВ боты максимально тупые (плато на полном смягчении —
// «прям тупые»), дальше за taperBattles боёв сложность плавно растёт до нормы.
// Телеметрия: главная утечка воронки — «постреляли и слились в середине боя» (43%
// всех) + ранняя гибель новичка. Силу даёт softFactor(battles) ∈ [0..1]: бои 1–5 → 1.0,
// бои 6–9 → 0.8/0.6/0.4/0.2, бой ≥10 → 0. Множители ниже — ПОЛНОЕ смягчение
// (softFactor=1); на спаде линейно интерполируются к нейтрали (×1) (см. sim.js).
// Инвариант честного засвета НЕ трогаем: боты стреляют по человеку только из засвета —
// «тупость» = реже попадают, слабее бьют, дольше грейс. ЧИСЛА ПОДКРУТИТЬ ПЛЕЙТЕСТОМ.
export const SOFT_START = {
  fullBattles: 5, // первые N боёв — МАКСИМАЛЬНО тупые боты (плато softFactor=1)
  taperBattles: 4, // дальше за N боёв смягчение плавно спадает до нуля
  extraGraceSec: 6, // окно развёртывания: грейс 5→11с на максимуме (боты дольше не фокусят)
  hitMult: 0.35, // полное смягчение: шанс попадания ботов 0.42→0.15 («почти мажут»)
  dmgMult: 0.5, // и бьют вдвое слабее (бот-урон ×0.5)
  aimToleranceMult: 2.2, // ассист новичку: окно сведения у ИГРОКА шире (44% первых выстрелов мимо)
}
// сила «мягкого старта» по числу сыгранных боёв: 1.0 на первых fullBattles (плато),
// затем линейный спад до 0 за taperBattles боёв (дальше — обычная сложность)
export const softFactor = (battles) => {
  const b = Math.max(0, battles | 0)
  if (b < SOFT_START.fullBattles) return 1
  const end = SOFT_START.fullBattles + SOFT_START.taperBattles
  if (b >= end) return 0
  return 1 - (b - SOFT_START.fullBattles + 1) / (SOFT_START.taperBattles + 1)
}
// БРОНЯ: шанс рикошета/непробития зависит от класса цели и угла встречи (лоб
// держит, корма — нет → награда за фланг/доворот). Модель портирована из офлайн-
// движка (Game.js _penetration), который уже был оттюнингован. Рикошет = 0 урона,
// «не пробил» = nopenMult от урона (чип). Действует одинаково всем (см. фидбек в
// Battle.vue onShot/onSaved — он уже готов). ЧИСЛА ПОДКРУТИТЬ ПЛЕЙТЕСТОМ.
export const ARMOR = {
  byClass: { light: 0.08, medium: 0.15, heavy: 0.24 }, // база шанса блока по классу ЦЕЛИ (срезано — было .1/.2/.3)
  facingMult: 1.2, // усиление от фронтальности (в лоб держит сильнее)
  maxBlock: 0.26, // потолок суммарного шанса блока (рикошет+непробитие); было .35
  nopenMult: 0.2, // доля урона при «не пробил» (рикошет — ровно 0)
  ricochetShare: 0.62, // из блоков 62% — рикошет, 38% — «не пробил» (раньше 50/50; «много не пробил»)
}
export const BOT_CLASS_MIX = ['light', 'medium', 'heavy', 'medium', 'light', 'medium', 'light']
// реальные машины ботам по классу — чтобы в онлайне рисовались настоящими
// танками (как офлайн), а не классовой болванкой в цвете команды. id = имена
// PNG в client/public/sprites/tanks/<id>.png; класс совпадает с моделью.
export const BOT_TANK_IDS = {
  light: ['t26', 'bt7', 'pz2', 'pz3', 'm2l', 'stu'],
  medium: ['t34', 't3485', 't72', 'pz4', 'pnt', 'leo1', 'sher', 'e8', 'm48', 'm60'],
  heavy: ['kv1', 'is2', 'tgr', 'tgr2', 'per', 'abr', 't14'],
}
export const BOT_DMG_MULT = 0.45
export const BOT_SPEED_MULT = 0.85
export const BOT_SPOT_VISION = 480 // вклад бота в засвет для команды
// демаскировка выстрелом: стреляешь → тебя видно врагу N сек, даже из тумана/
// издалека (muzzle flash выдаёт). Симметрично людям и ботам. Создаёт риск
// стрельбы из засады — основа честного засвета. ЧИСЛО ПОДКРУТИТЬ ПЛЕЙТЕСТОМ.
export const FIRE_REVEAL_SEC = 4
export const TANK_RADIUS = 22

// «Жёсткая маскировка» ботов под живых: пул реалистичных ников (без воинских
// званий, нейтральный по командам — настоящие игроки берут любые имена). В бою
// сервер ещё подмешивает имена РЕАЛЬНЫХ аккаунтов (sim берёт случайные без
// повторов и без имён живых участников этого боя).
export const BOT_NICKS = [
  'Shadow', 'Reaper', 'Viper', 'Ghost', 'Razor', 'Maverick', 'Sniper', 'Hunter', 'Phoenix', 'Cobra',
  'Raptor', 'Falcon', 'Titan', 'Nomad', 'Joker', 'Storm', 'Frost', 'Ranger', 'Bandit', 'Outlaw',
  'Mike_99', 'Alex_T34', 'ProTanker', 'TankAce', 'SteelRain', 'IronFist', 'WarDog', 'NightOwl', 'RedStar', 'BlackOps',
  'Killer228', 'xX_Demon_Xx', 'NoMercy', 'Predator', 'Savage', 'Venom', 'Crusher', 'Goliath', 'Maximus', 'Spartan',
  'Panzer_Max', 'WolfHunter', 'Tiger_1', 'Eagle_Eye', 'Lynx', 'Puma', 'Jaguar', 'Rhino_77', 'Vortex', 'Zenith',
  'Apex', 'Onyx', 'Rogue', 'Specter', 'Havoc', 'Riot', 'Chaos', 'Fury', 'Wraith', 'Drake',
  'Барон', 'Гроза', 'Стальной', 'Танкист', 'Леха52', 'Серый', 'Батя', 'Партизан', 'Сибиряк', 'Медведь',
  'Волк', 'Сокол', 'Ястреб', 'Тайфун', 'Шторм', 'Снайпер', 'Палач', 'Призрак', 'Кощей', 'Викинг',
  'Танкист_77', 'Гром', 'Молот', 'Зверь', 'Хищник', 'Беспощадный', 'Ветеран99', 'Дед', 'Боцман', 'Кот',
  'Барсук', 'Рысь', 'Пантера', 'Ворон', 'Удав', 'Скорпион', 'Оса', 'Димон', 'Санёк', 'Витёк',
  'Колян', 'Толян', 'Жека', 'Стас', 'МаксПро', 'Ден', 'Рома', 'tank_killer', 'steel_wolf', 'iron_max',
  'red_baron', 'war_machine', 'panzer228', 'is7_main', 'maus_god', 'leopard_2', 'kv2_lover', 'Громила', 'Тень', 'Берсерк',
]
// часть ботов носит камуфляж (как игроки с прокачкой) — остальные «штатные».
// id обязаны существовать в SKINS (client meta.js): иначе клиент не нарисует камо.
export const BOT_SKINS = ['winter', 'desert', 'forest', 'night', 'digital', 'urban', 'tiger']
export const BOT_SKIN_CHANCE = 0.45 // доля ботов с камуфляжем (реалистичный микс)

export function classToRadians(cls) {
  return {
    ...cls,
    sectorHalf: (cls.sectorDeg * DEG) / 2,
    tolerance: cls.toleranceDeg * DEG,
  }
}
