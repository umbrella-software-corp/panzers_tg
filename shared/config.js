// ============ PANZER TG — общие боевые константы (клиент + сервер) ============
// Скопировано из client/src/game/config.js при выносе симуляции на сервер.
// ВАЖНО: при изменении баланса править ЗДЕСЬ; клиент будет переведён на этот
// пакет следующим шагом (пока его config.js — дубль).
const DEG = Math.PI / 180

export const TANK_CLASSES = {
  // БОТЫ: tier-5-нормированная база под role-based сетку владельца (2026-06-24). Эффективные
  // статы = база × botTierHpMult/DmgMult(тир игрока). Урон ещё × BOT_DMG_MULT (боты мягче).
  // Профиль прицела (sectorDeg/sweepPeriod/toleranceDeg/range) не трогаем. Менять синхронно
  // с meta.js (статы игрока) и client/src/game/config.js (зеркало).
  light: {
    id: 'light',
    label: 'Лёгкий',
    sectorDeg: 58,
    sweepPeriod: 1.9,
    toleranceDeg: 5.5,
    reload: 6.0, // выстр/мин ~10 (быстрый разведчик)
    damage: 130,
    hp: 1500,
    range: 560,
    vision: 340,
    maxSpeed: 65,
    accel: 163,
    turnRate: 1.15,
  },
  medium: {
    id: 'medium',
    label: 'Средний',
    sectorDeg: 46,
    sweepPeriod: 2.5,
    toleranceDeg: 4,
    reload: 7.0,
    damage: 155,
    hp: 2000,
    range: 600,
    vision: 330,
    maxSpeed: 58,
    accel: 145,
    turnRate: 1.0,
  },
  heavy: {
    id: 'heavy',
    label: 'Тяжёлый',
    sectorDeg: 30,
    sweepPeriod: 3.8,
    toleranceDeg: 3.5,
    reload: 8.0,
    damage: 165,
    hp: 2300,
    range: 640,
    vision: 295,
    maxSpeed: 42,
    accel: 105,
    turnRate: 0.7,
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
  sectorHalfDeg: 28, // сектор огня корпуса (нет башни) — чуть шире базы, чтобы доводили ствол и не «тупили» молча
  hitChance: 0.45, // базовый шанс; дальше режется дистанцией/движением/кустом (см. sim). Потолок шанса — 0.85 (см. sim)
  hitFalloff: 0.5, // на максимуме fireRange шанс падает до hitChance*(1-0.5)
  dodgeFactor: 0.5, // полный ход цели срезает шанс до hitChance*(1-0.5) — движение спасает (крутись = уходи)
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
// «ВЕТЕРАНСКИЙ СКЕЙЛ» (обратен мягкому старту): боты УМНЕЕ и злее по мере прогресса
// игрока. Сила vetFactor ∈ [0..1] копится от числа боёв (после окна мягкого старта) и
// от тира боя. Применяется ТОЛЬКО когда мягкий старт уже снят (sim гейтит vet=0 при
// softStart) — новичка не трогает. Эффекты (см. sim.js): выше шанс попадания, движение
// цели спасает меньше (dodgeFactor режется), короче грейс, боты храбрее (реже пятятся) +
// умный выбор цели (добивают раненых, фокусят живого игрока). Инвариант честного засвета
// НЕ трогаем — боты по-прежнему стреляют по человеку только из засвета. ПОД ПЛЕЙТЕСТ.
export const VET = {
  startBattles: 10, // до этого числа боёв ветеранства нет (рулит мягкий старт/норма)
  fullBattles: 140, // к этому числу боёв ветеранство выходит на максимум
  hitMult: 1.35, // ×шанс попадания на максимуме (осажено 1.5→1.35 — ветеранов мелило за 3 выстрела)
  dmgMult: 1.35, // ×УРОН ботов на максимуме vet (осажено 1.6→1.35 — боты слишком быстро сносили)
  dodgeRelief: 0.45, // dodgeFactor ×(1 − relief·vet): движение цели спасает меньше (0.34→0.45 — танцем не уйти)
  graceCut: 3, // грейс по человеку короче на graceCut·vet секунд (минимум 2с держим)
  tierFloor: 0.45, // тир боя даёт «пол» ветеранства даже до набора боёв (тир-10 → 0.45)
}
// PvE-ЭДЖ: боты на команде БЕЗ людей (= чистые враги соло-игрока) получают небольшое
// преимущество, чтобы соло-бой был ЧЕЛЛЕНДЖЕМ, а не 20:0. В PvP (живые в ОБЕИХ командах)
// НЕ применяется — там честная симметрия. Союзные боты игрока эдж НЕ получают (помогают,
// но не тащат за игрока). Стакается с vet. ПОД ПЛЕЙТЕСТ (если легко — поднять hitMult).
export const ENEMY_EDGE = {
  hitMult: 1.3, // ×шанс попадания вражеских ботов в PvE (осажено 1.4→1.3 — соло-бой мелил ветерана)
  retreatMult: 0.6, // порог отступления ниже (дольше давят)
  braveShare: true, // больше «храбрых» (реже пятятся вообще)
  humanFocus: 0.18, // в PvE враги сильнее фокусят живого игрока (0.12→0.18 — не дают раскатать в одно лицо)
}
export const vetFactor = (battles, tier) => {
  const b = Math.max(0, battles | 0)
  let v = 0
  if (b > VET.startBattles) v = Math.min(1, (b - VET.startBattles) / (VET.fullBattles - VET.startBattles))
  const tf = tier ? Math.max(0, Math.min(1, (clampTier(tier) - 1) / 9)) * VET.tierFloor : 0
  return Math.max(v, tf)
}
// БРОНЯ: шанс рикошета/непробития зависит от класса цели и угла встречи (лоб
// держит, корма — нет → награда за фланг/доворот). Модель портирована из офлайн-
// движка (Game.js _penetration), который уже был оттюнингован. Рикошет = 0 урона,
// «не пробил» = nopenMult от урона (чип). Действует одинаково всем (см. фидбек в
// Battle.vue onShot/onSaved — он уже готов). ЧИСЛА ПОДКРУТИТЬ ПЛЕЙТЕСТОМ.
export const ARMOR = {
  // НОВАЯ МОДЕЛЬ — УГОЛ ПОПАДАНИЯ (см. sim _penetration): блок максимум при ДОВОРОТЕ ~45°
  // (ромб/наклон плиты), мал в лоб-плоско, ≈0 в борт/корму. Награждает доворот (скилл),
  // а не «стой плоским лбом». Симметрично игроку и ботам → перекос «боты всегда фейсят»
  // уходит (фейсят плоско → их пробивают; довернёшь — сбунсишь). База — по классу ЦЕЛИ.
  byClass: { light: 0.2, medium: 0.32, heavy: 0.5 }, // ОТКАТ перетюна (тикет #29 «броненосца убиваешь 90% боя»): 0.2/0.38/0.6 → 0.2/0.32/0.5, броня значима, но танки убиваемы
  maxBlock: 0.5, // потолок блока срезан 0.66→0.5 (тяж блокировал до 2/3 выстрелов = губка; теперь макс половина)
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
// тир каждого спрайта из BOT_TANK_IDS — для подбора ±1 к тиру боя (берётся из
// каталога meta.js; держать синхронно при добавлении бот-танков). Пул неполон по
// тирам (нет хай-тир лёгких и т.п.) → выбираем БЛИЖАЙШИЙ доступный, не строго ±1.
export const BOT_TANK_TIER = {
  t26: 1, bt7: 2, pz2: 1, pz3: 2, m2l: 1, stu: 2,
  t34: 3, t3485: 4, t72: 7, pz4: 3, pnt: 4, leo1: 7, sher: 3, e8: 4, m48: 6, m60: 7,
  kv1: 5, is2: 6, tgr: 5, tgr2: 6, per: 5, abr: 8, t14: 10,
}
const clampTier = (t) => Math.max(1, Math.min(10, Math.round(t) || 5))
// масштаб боевой силы бота под ТИР боя — повторяет role-based КРИВУЮ владельца (средние
// HP/урон по тиру, нормированы к тиру 5 = база TANK_CLASSES). Хай-тир игрок не вытаптывает
// плоских ботов, лоу-тир не упирается в стену. Боты мягче игрока (BOT_DMG_MULT). Инвариант
// честного засвета НЕ трогаем. Менять синхронно с meta.js. ПОД ПЛЕЙТЕСТ.
const BOT_HP_CURVE = [0, 0.35, 0.42, 0.57, 0.68, 1.0, 1.27, 1.33, 1.69, 2.03, 2.37]
const BOT_DMG_CURVE = [0, 0.32, 0.43, 0.6, 0.77, 1.0, 1.36, 1.53, 1.79, 2.09, 2.38]
export const botTierHpMult = (tier) => BOT_HP_CURVE[clampTier(tier)] || 1
export const botTierDmgMult = (tier) => BOT_DMG_CURVE[clampTier(tier)] || 1
export const BOT_DMG_MULT = 1.0 // боты бьют КАК ИГРОК (решение владельца: «машины такими же») —
// фикс высокого TTK: союзники-боты добивают, враги честный вызов. Честность (засвет+грейс) и
// softStart новичку остаются. Бот tier-7 урон ≈252 ≈ игрок 240. Снизить = мягче PvE.
// HP ботов ×HP_MULT — синхрон с игроком (meta.js): динамика боя, −30% HP. Хочешь толще/тоньше — тут+meta.
export const HP_MULT = 0.7
export const BOT_SPEED_MULT = 0.9

// ════ АРХЕТИПЫ ПОВЕДЕНИЯ БОТОВ (по таблице владельца 2026-06-24) ════
// Бот играет РОЛЬ своей машины: ШТУРМОВИК прёт и добивает, ТАНК держит позицию/ставит корпус,
// СНАЙПЕР кайтит из укрытий, ОХОТНИК фланг+добивание подранков, ПОДДЕРЖКА липнет к группе.
// Параметры модулируют _stepBot (дистанция боя / отступление / укрытие / выбор цели / агрессия).
// Инвариант ЧЕСТНОГО ЗАСВЕТА (бот бьёт человека только из его засвета + после грейса) НЕ трогаем.
//  distMult   — множитель боевой дистанции (idealRange, капается fireRange): <1 ближе, >1 кайт
//  retreatFrac— порог HP отхода (0 = не отступает: штурмовик/танк)
//  cover      — тяга к укрытию 0..1 (радиус поиска куста + гейт; <0.25 не прячется)
//  hpFocus    — вес добивания подранка в выборе цели (1 базовый, >1 финишер-охотник)
//  crowd      — анти-догпайл (+ рассредоточение; − группировка на цель союзников = поддержка)
//  push       — агрессия сближения (1 жмёт в упор, 0 держит дистанцию/кайт)
export const ARCHETYPE = {
  assault: { distMult: 0.7, retreatFrac: 0.06, cover: 0.15, hpFocus: 1.1, crowd: 0.22, push: 1.0 },
  tank: { distMult: 0.9, retreatFrac: 0.0, cover: 0.3, hpFocus: 0.55, crowd: 0.22, push: 0.55 },
  sniper: { distMult: 1.7, retreatFrac: 0.3, cover: 0.9, hpFocus: 0.7, crowd: 0.28, push: 0.15 },
  hunter: { distMult: 1.05, retreatFrac: 0.26, cover: 0.7, hpFocus: 1.35, crowd: 0.32, push: 0.7 },
  support: { distMult: 1.2, retreatFrac: 0.22, cover: 0.5, hpFocus: 0.85, crowd: -0.4, push: 0.4 },
}
const ARCHE_BY_CLASS = { light: 'hunter', heavy: 'tank', medium: 'assault' }
// привязка машин к архетипам (явные из таблицы + по роли; остальное — дефолт по классу)
export const TANK_ARCHETYPE = {
  t34: 'assault', t3485: 'assault', pnt: 'assault', sher: 'assault', m48: 'assault', m3lee: 'assault', stug3: 'assault', hetzer: 'assault', t28: 'assault', t54: 'assault',
  kv1: 'tank', is2: 'tank', tgr: 'tank', tgr2: 'tank', per: 'tank', abr: 'tank', t14: 'tank', m1a2: 'tank', abrx: 'tank', maus: 'tank', sper: 'tank', kv2: 'tank', jumbo: 'tank', ferdinand: 'tank',
  t90: 'sniper', leo1: 'sniper', leo2: 'sniper', leo2a7: 'sniper', t80u: 'sniper', kf51: 'sniper', su76m: 'sniper', su85: 'sniper', su100: 'sniper', isu152: 'sniper', nashorn: 'sniper', jagdpanther: 'sniper', grille15: 'sniper', m10: 'sniper', m36: 'sniper', t30: 'sniper',
  bt7: 'hunter', m2l: 'hunter', stu: 'hunter', pz2: 'hunter', pz3: 'hunter', t26: 'hunter', t70: 'hunter', chaffee: 'hunter', hellcat: 'hunter',
  t72: 'support', m60: 'support', e8: 'support', pz4: 'support', ram: 'support', pz4h: 'support',
}
export const archetypeOf = (tankId, classId) => ARCHETYPE[TANK_ARCHETYPE[tankId] || ARCHE_BY_CLASS[classId] || 'assault']
// РАССРЕДОТОЧЕНИЕ (анти-толпа): бот мягко отталкивается от союзника ближе SEP_RADIUS
// (в дополнение к жёсткому _collide на касании) — толпа у одной точки/цели расходится.
export const BOT_SEP_RADIUS = 130
export const BOT_SEP_PUSH = 48 // скорость расталкивания (px/с при максимальной тесноте)
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
