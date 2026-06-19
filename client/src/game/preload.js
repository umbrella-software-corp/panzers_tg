// Прогрев ассетов на стартовом сплэше. Раньше сплэш просто крутил спиннер вхолостую, а
// спрайты подгружались на лету (ангар моргал, бой стартовал с лагом). Тут грузим картинки
// заранее в HTTP-кэш браузера. КЛЮЧ КЭША = ПОЛНЫЙ URL c query — поэтому тянем 1:1 как
// потребители, иначе прогрев впустую:
//   • бой (NetGame, Pixi Assets.load) и CSS-фоны (url() в стилях) — ГОЛЫЕ /sprites/...png
//   • ангар/UI (TankImg на canvas) — с ?v=SPRITE_VER (см. sprites.js)
import { SPRITE_VER } from './sprites.js'
import { TANK_BY_ID } from './meta.js'

// боевые env-текстуры (NetGame texNames) — голые URL
const BATTLE_ENV = ['ground', 'forest', 'rock', 'water', 'hill', 'building', 'explosion', 'smoke', 'muzzle', 'box']
// классовые «болванки» команд (NetGame: tank_<color>, tank_<cls>_<color>) — голые
const TEAM_TANKS = []
for (const color of ['amber', 'blue', 'red']) {
  TEAM_TANKS.push(`tank_${color}`)
  for (const cls of ['light', 'heavy']) TEAM_TANKS.push(`tank_${cls}_${color}`)
}
// per-map земля /sprites/maps/<id>/ground.png — ЗЕРКАЛО id из shared/maps.js
const MAP_IDS = ['polygon', 'city', 'lakes', 'forest', 'heights', 'desert', 'ruins', 'crossing', 'meadow', 'eisenstadt', 'winter']
// CSS-фоны экранов (голые url() в стилях) + иконки валют (<img> в магазине)
const SCREEN_BG = ['hangar', 'bg_tree', 'bg_shop', 'bg_rating', 'bg_mm', 'paper', 'icon_credits', 'icon_tokens', 'icon_gold']
const ALL_TANK_IDS = Object.keys(TANK_BY_ID)

// один раз на URL за сессию — не перезапрашиваем уже прогретое
const _requested = new Set()
function loadImg(url) {
  if (_requested.has(url)) return Promise.resolve()
  _requested.add(url)
  return new Promise((resolve) => {
    const img = new Image()
    const done = () => resolve()
    // decode() догоняет полное декодирование (не только сеть) — кадр в ангаре/бою без рывка
    img.onload = () => (img.decode ? img.decode().then(done, done) : done())
    img.onerror = done // битый/отсутствующий спрайт не должен ронять прогрев
    img.src = url
  })
}

// грузим список с ограничением параллелизма (не топим сеть) + колбэк прогресса 0..1
async function loadAll(urls, onProgress, concurrency = 6) {
  const list = [...new Set(urls)]
  const total = list.length || 1
  let done = 0
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      await loadImg(list[i++])
      done++
      if (onProgress) onProgress(done / total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length || 1) }, worker))
}

// КРИТИЧНОЕ (держит сплэш, мало и быстро): первый экран — ангар. Его фон + спрайты
// ТВОИХ танков (карусель = tanks?v, большой рендер = hangar?v) + иконки валют.
export function preloadCritical(profile, onProgress) {
  const owned = Array.isArray(profile && profile.owned) ? profile.owned : []
  const urls = [
    '/sprites/hangar.png', // фон первого экрана
    ...owned.map((id) => `/sprites/tanks/${id}.png${SPRITE_VER}`), // карусель ангара
    ...owned.map((id) => `/sprites/hangar/${id}.png${SPRITE_VER}`), // большой рендер
  ]
  return loadAll(urls, onProgress)
}

// ОСТАЛЬНОЕ (фоном после сплэша): весь бой (все танки голые + env + команды + карты +
// надетый камо твоих машин) и фоны прочих экранов. К моменту «В БОЙ» уже прогрето.
export function preloadRest(profile) {
  const camos = profile && profile.camos && typeof profile.camos === 'object' ? profile.camos : {}
  const camoUrls = Object.entries(camos)
    .filter(([, c]) => c)
    .flatMap(([tid, c]) => [`/sprites/camo/${tid}_${c}.png`, `/sprites/camo/${tid}_${c}.png${SPRITE_VER}`])
  const urls = [
    ...ALL_TANK_IDS.map((id) => `/sprites/tanks/${id}.png`), // бой: NetGame грузит голые
    ...BATTLE_ENV.map((n) => `/sprites/${n}.png`),
    ...TEAM_TANKS.map((n) => `/sprites/${n}.png`),
    ...MAP_IDS.map((id) => `/sprites/maps/${id}/ground.png`),
    ...SCREEN_BG.map((n) => `/sprites/${n}.png`),
    ...camoUrls,
  ]
  return loadAll(urls, null, 4)
}
