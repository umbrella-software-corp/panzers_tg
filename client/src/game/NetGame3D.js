// 3D-рендер боя на Three.js. НАСЛЕДУЕТ всю сеть/ввод/предикт/события/HUD-state
// от NetGameCore (рендер-независимое ядро; Battle.vue и серверный протокол не
// меняются) — реализует визуальный слой: mount/_draw/_spawnFx/_wantTex/destroy.
//
// Координаты: мир сервера (x,y) в пикселях карты → THREE (x, высота, y).
// Камера player-relative сверху (свой танк всегда едет «от тебя» → честность
// засвета как в 2D). Все живые тюнеры — window.__CAM_*/__YAW3 в консоли превью.
// База — наш продовый NetGame (2D-движок): снапшот-протокол и API базы байт-совместимы
// с NetGameCore форка, поэтому 3D-рендер садится прямо на него (NetGameCore не портируем).
import { NetGame } from './NetGame.js'
import { t } from '../i18n.js' // локализация меток плавающего урона (рикошет/броня)
import { tankModelUrl, tankSizeScale, PROP_MODELS, modelNeedsFlip, CAMO_BY_ID } from './meta.js'
import { drawCamoPattern } from './camo.js' // процедурный камо-узор (как в ангаре)
import { MAP_SIZE } from './config.js'
import { decorObstacles } from './decor.js' // декор-скаттер ТОЛЬКО для 3D-визуала (без коллизий)

// three.js грузится ДИНАМИЧЕСКИ (только когда тестер реально входит в 3D-бой) —
// иначе ~150КБ gzip висели бы в главном бандле у всех 2D-игроков (96% трафика).
// three.quarks (GPU-партиклы для VFX) — туда же: импортится только здесь, попадает
// в тот же ленивый чанк, что и three (NetGame3D статически тянет Battle/Hangar).
// Модульные THREE/GLTFLoader/MeshoptDecoder/QK заполняются в ensureThree() до mount.
let THREE, GLTFLoader, MeshoptDecoder, QK
async function ensureThree() {
  if (THREE) return
  THREE = await import('three')
  ;({ GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'))
  ;({ MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js'))
  QK = await import('three.quarks')
}

const MODEL_URLS = ['/models/t90_opt.glb', '/models/tank2_opt.glb', '/models/tank3_opt.glb']
// 3 модели = 3 танка эксперимента: T-90 / Leopard 2 / Abrams (по нации). Остальные
// танки (боты разных tankId) получают модель по хэшу.
export const TANK3D = [
  { key: 't90', nation: 'ussr', label: 'Т-90', model: 0 },
  { key: 'leo2', nation: 'ger', label: 'Leopard 2', model: 1 },
  { key: 'abr', nation: 'usa', label: 'Abrams', model: 2 },
]
const TANK_MODEL = { t90: 0, leo2: 1, abr: 2 }
const TANK_LEN = 78 // длина модели танка в пикселях карты (≈ размер 2D-спрайта)
const TRACER_COLOR = 0xffe08a // ВСЕ снаряды одного цвета (тёплый жёлтый) — без «звёздных войн»
const hashId = (s) => { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }

// === АТМОСФЕРА КАРТЫ ===
// Раньше у ВСЕХ карт были одни мрачно-оливковые небо/туман (0x141a12) — зима, пустыня,
// лес выглядели на одно лицо. Теперь у каждой карты свой «воздух»: цвет зенита (top),
// дымка у горизонта = цвет тумана (haze), цвет/сила солнца (sun/sunI), полусфера-заливка
// (hemiSky/hemiGround/hemiI) и дистанция тумана (near/far в долях mapSize). Карты нет в
// таблице → палитра выводится из theme.ground (moodFor), чтобы новая карта не была чёрной.
const MOOD = {
  polygon:    { top: 0x9fc6e8, haze: 0xccd6b2, sun: 0xfff2d2, sunI: 1.95, hemiSky: 0xbcd6f0, hemiGround: 0x6a6f3a, hemiI: 0.95, near: 0.55, far: 1.05 },
  city:       { top: 0x8aa0b6, haze: 0xaab3be, sun: 0xf4f0e6, sunI: 1.55, hemiSky: 0xb0bccc, hemiGround: 0x585d63, hemiI: 1.0,  near: 0.45, far: 0.95 },
  lakes:      { top: 0x8fc6ea, haze: 0xc4d4b2, sun: 0xfff1cf, sunI: 2.0,  hemiSky: 0xb8d8ee, hemiGround: 0x647046, hemiI: 1.0,  near: 0.55, far: 1.05 },
  forest:     { top: 0x8ab6cc, haze: 0xa6b88e, sun: 0xf6f0d0, sunI: 1.6,  hemiSky: 0xa9c6c0, hemiGround: 0x3f4a26, hemiI: 0.9,  near: 0.45, far: 0.9 },
  heights:    { top: 0xb6cbe2, haze: 0xd6c69e, sun: 0xfff0c8, sunI: 2.05, hemiSky: 0xcdd8e8, hemiGround: 0x6e5a36, hemiI: 1.0,  near: 0.55, far: 1.05 },
  desert:     { top: 0xe6c88c, haze: 0xeed9a8, sun: 0xffe6ad, sunI: 2.25, hemiSky: 0xf0dcb0, hemiGround: 0x9a7c4a, hemiI: 1.1,  near: 0.6,  far: 1.1 },
  ruins:      { top: 0x9aa0a0, haze: 0xbcb29a, sun: 0xf2e6cc, sunI: 1.55, hemiSky: 0xbdc0bd, hemiGround: 0x5c564a, hemiI: 0.95, near: 0.42, far: 0.9 },
  crossing:   { top: 0x8fc4e6, haze: 0xbcc69a, sun: 0xfff1cf, sunI: 1.95, hemiSky: 0xb4d2ea, hemiGround: 0x60683e, hemiI: 1.0,  near: 0.55, far: 1.05 },
  meadow:     { top: 0x9fcdec, haze: 0xdde0a6, sun: 0xfff4d6, sunI: 2.1,  hemiSky: 0xc2def2, hemiGround: 0x7a7e4a, hemiI: 1.05, near: 0.6,  far: 1.1 },
  eisenstadt: { top: 0x8e9aa6, haze: 0xb6afa2, sun: 0xf4ece0, sunI: 1.55, hemiSky: 0xb0bac4, hemiGround: 0x5a564e, hemiI: 1.0,  near: 0.42, far: 0.9 },
  winter:     { top: 0xbcd2e6, haze: 0xe0eaf3, sun: 0xf4f8ff, sunI: 1.75, hemiSky: 0xd2e2f0, hemiGround: 0x9aa6b2, hemiI: 1.2,  near: 0.5,  far: 1.0 },
}
// смешать два hex-цвета (t=0 → a, t=1 → b)
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
  return ((Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)) >>> 0
}
// палитра для карты вне таблицы: тёплое солнце + небо, выведенное из цвета земли (светлее+к голубому)
function moodFor(map) {
  if (map && MOOD[map.id]) return MOOD[map.id]
  const g = ((map && map.theme && map.theme.ground) != null) ? map.theme.ground : 0x8a8f5a
  const r = (g >> 16) & 255, gr = (g >> 8) & 255, b = g & 255
  const haze = ((Math.min(255, r + 40) << 16) | (Math.min(255, gr + 44) << 8) | Math.min(255, b + 70)) >>> 0
  const top = ((Math.min(255, r + 30) << 16) | (Math.min(255, gr + 70) << 8) | 255) >>> 0
  return { top, haze, sun: 0xfff1d2, sunI: 1.9, hemiSky: top, hemiGround: g, hemiI: 1.0, near: 0.5, far: 1.0 }
}

// общий кэш загруженных сцен моделей (раз на сессию). Позволяет preload3D() прогреть
// three.js + модели ВО ВРЕМЯ матчмейкинга, чтобы вход в бой был без фриза-загрузки.
let modelScenesPromise = null
export function loadModelScenes() {
  if (modelScenesPromise) return modelScenesPromise
  modelScenesPromise = ensureThree().then(() => Promise.all(MODEL_URLS.map((url) => new Promise((res) => {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(url, (g) => res(g.scene), undefined, (e) => { console.warn('[3d] модель не загрузилась', url, e); res(null) })
  }))))
  return modelScenesPromise
}
// прогрев three.js + моделей заранее (ангар зовёт при входе)
// Прогрев 3D перед боем: three.js + базовые/проп-модели + (важно!) модель ИМЕННО
// твоего танка — иначе она (444КБ) качается лишь на старте боя и виден плейсхолдер-
// бокс, пока грузит. tankId/nation передаёт ангар (см. Hangar preload3D).
export function preload3D(tankId, nation) {
  try {
    loadModelScenes(); loadPropScenes()
    if (tankId || nation) loadModelScene(tankModelUrl(tankId, nation))
  } catch { /* ничего */ }
}

// === ОКРУЖЕНИЕ: модели пропов ===
// Загрузка всех GLB-пропов один раз на сессию → { kind: scene|null }.
let propScenesPromise = null
export function loadPropScenes() {
  if (propScenesPromise) return propScenesPromise
  const entries = Object.entries(PROP_MODELS)
  propScenesPromise = ensureThree()
    .then(() => Promise.all(entries.map(([k, url]) => loadModelScene(url).then((sc) => [k, sc]))))
    .then((arr) => Object.fromEntries(arr))
  return propScenesPromise
}

// Декор-укрытия теперь генерятся в shared/decor.js (детерминированно, с коллизией) и
// приходят как obstacles с полем prop — рендер см. в _load3DProps.

// загрузка ОДНОЙ модели по URL с кэшем (раз на сессию). Для превью в ангаре —
// грузим ровно модель выбранного танка (см. meta.tankModelUrl), а не весь набор.
const sceneByUrl = new Map() // url -> Promise<scene|null>
export function loadModelScene(url) {
  if (sceneByUrl.has(url)) return sceneByUrl.get(url)
  const p = ensureThree().then(() => new Promise((res) => {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
    // при сбое НЕ отравляем кэш null'ом навсегда — снимаем запись, чтобы повтор/фоллбэк
    // мог попробовать ещё раз (иначе один транзиентный сбой = коробка на всю сессию)
    loader.load(url, (g) => res(g.scene), undefined, (e) => { console.warn('[3d] модель не загрузилась', url, e); sceneByUrl.delete(url); res(null) })
  }))
  sceneByUrl.set(url, p)
  return p
}

export class NetGame3D extends NetGame {
  // PNG-спрайты/хромакей в 3D не нужны — танки это GLB-модели
  _wantTex() {}
  // взрыв-дым в 3D рисуем своими booms (см. _drawFx) — Pixi-fx гасим
  _spawnFx() {}

  async mount(container) {
    await ensureThree() // подгрузить three.js (динамический чанк) до создания сцены
    this.container = container
    this.fxSprites = [] // super._update трогает этот массив — держим пустым
    this.tex = {}
    this.tankGroups = new Map() // unitId -> { group, holder, ring, blob }

    const W = container.clientWidth || 360
    const H = container.clientHeight || 640
    // АВТО-КАЧЕСТВО: грубая оценка железа → стартовый уровень (0 LOW / 1 MED / 2 HIGH).
    // Дальше FPS-замер сам понижает (см. _checkPerf). antialias фиксится при создании
    // рендерера (по эвристике), а pixelRatio/тени дёргаем живьём в _applyQuality.
    const cores = navigator.hardwareConcurrency || 4
    const mem = navigator.deviceMemory || 4
    const lowEnd = cores <= 4 || mem <= 3
    this._quality = lowEnd ? 1 : 2
    this._warmAt = performance.now() + 1800 // прогрев: первые ~1.8с не деградируем
    const renderer = new THREE.WebGLRenderer({ antialias: this._quality >= 1, powerPreference: 'high-performance' })
    renderer.setSize(W, H)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    container.appendChild(renderer.domElement)
    this.renderer = renderer

    // оверлей 2D для ников/HP/прицельного текста (проецируем 3D-точки на экран)
    const odpr = Math.min(2, window.devicePixelRatio || 1)
    const ov = document.createElement('canvas')
    ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
    ov.width = W * odpr; ov.height = H * odpr
    container.appendChild(ov)
    this.overlay = ov; this.octx = ov.getContext('2d'); this._dpr = odpr

    const scene = new THREE.Scene()
    // АТМОСФЕРА: у каждой карты своё настроение (см. MOOD). Туман уходит в цвет дымки
    // у горизонта (haze) — мир «растворяется в воздухе», а не обрывается в чёрное.
    const mood = moodFor(this.map); this.mood = mood
    scene.background = new THREE.Color(mood.haze)
    scene.fog = new THREE.Fog(mood.haze, this.mapSize * mood.near, this.mapSize * mood.far)
    this.scene = scene

    this.camera = new THREE.PerspectiveCamera(46, W / H, 1, this.mapSize * 4)

    scene.add(new THREE.HemisphereLight(mood.hemiSky, mood.hemiGround, mood.hemiI))
    const sun = new THREE.DirectionalLight(mood.sun, mood.sunI)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sh = sun.shadow.camera
    sh.near = 50; sh.far = this.mapSize * 2; sh.left = -700; sh.right = 700; sh.top = 700; sh.bottom = -700
    sun.shadow.bias = -0.0005
    scene.add(sun); this.sun = sun
    this.sunTarget = new THREE.Object3D(); scene.add(this.sunTarget); sun.target = this.sunTarget

    this._buildSky(mood) // градиентный купол неба (горизонт→зенит) — даёт глубину и горизонт
    this._buildGround(mood)
    this._buildStatic()
    // GLB-ОКРУЖЕНИЕ (камни/ящики→модели + декор-скаттер бочки/ежи/руины) — только на
    // MED/HIGH: на LOW остаются дешёвые примитивы из _buildStatic. На широкую раскатку
    // их отключали ради перфа слабых телефонов — гейт по качеству возвращает их безопасно.
    if (this._quality >= 1) {
      loadPropScenes().then((scenes) => { if (this.scene) this._load3DProps(scenes) }).catch((e) => console.warn('[3d] пропы не загрузились', e))
    }

    // эффекты: трассеры-стрики снаряда (объёмные меши) + GPU-партиклы (three.quarks)
    // для вспышек/взрывов/искр/дыма — см. _initParticles. fxGroup/sparkGroup оставлены
    // пустыми (партиклы рисует BatchedRenderer); shell/tracer — по-прежнему меш-пулы.
    this.fxGroup = new THREE.Group(); scene.add(this.fxGroup)
    this.tracerGroup = new THREE.Group(); scene.add(this.tracerGroup) // светящиеся трейлы снарядов
    this.shellGroup = new THREE.Group(); scene.add(this.shellGroup)   // «головы» снарядов (ядра)
    this.sparkGroup = new THREE.Group(); scene.add(this.sparkGroup)
    // импульс света от дульной вспышки — ОДИН переиспользуемый источник (intensity 0 в покое,
    // чтобы не пересобирать шейдеры добавлением/удалением света на каждый выстрел)
    this.muzzleLight = new THREE.PointLight(0xffce7a, 0, 360, 2)
    this.muzzleLight.castShadow = false; scene.add(this.muzzleLight)
    this._initParticles() // three.quarks: пулы вспышка/огонь/дым/искра/пыль

    // ПЫЛЬ из-под едущего танка (ring-buffer пуфов; на LOW не эмитим). Следы гусениц
    // на земле убраны по просьбе — оставляем только пыль.
    this.dustGroup = new THREE.Group(); scene.add(this.dustGroup)
    const dustGeo = new THREE.SphereGeometry(1, 8, 6)
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: 0xb8a87e, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; m._vy = 0; this.dustGroup.add(m) }
    this._dustI = 0; this._tankMove = new Map()
    this._shake = 0; this._wasBump = false; this._bumpDustT = 0 // отдача камеры + пыль при упоре в препятствие

    // ПОДБИТЫЙ ТАНК: чёрный дым (нормальный blend, тёмные сферы поднимаются/растут/тают)
    // + огонь у основания (additive, оранжевые сферы мерцают). Оба ring-buffer (см. _wreckFx).
    this.smokeGroup = new THREE.Group(); scene.add(this.smokeGroup)
    this.fireGroup = new THREE.Group(); scene.add(this.fireGroup)
    const wreckGeo = new THREE.SphereGeometry(1, 10, 8)
    for (let i = 0; i < 90; i++) { const m = new THREE.Mesh(wreckGeo, new THREE.MeshBasicMaterial({ color: 0x161616, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; m._vy = 0; this.smokeGroup.add(m) }
    for (let i = 0; i < 44; i++) { const m = new THREE.Mesh(wreckGeo, new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; m._vy = 0; this.fireGroup.add(m) }
    this._smokeI = 0; this._fireI = 0; this._wreckEmit = new Map()

    // ТУМАН ВОЙНЫ: тёмный аннулюс — всё дальше обзора затемнено (граница видимости)
    const vis0 = this.cls.vision || 600
    this.fogRing = this._mkGroundRing(vis0, this.mapSize * 1.4, 0x05070a, 0.6)
    this.fogRing.position.y = 4; this.fogRing.renderOrder = 1; this.fogRing._vis = vis0; scene.add(this.fogRing)
    // КОЛЬЦО ОБЗОРА — яркая граница «вижу/стреляю»
    this.visionRing = this._mkGroundRing(vis0 - 5, vis0, 0xf2a50c, 0.55)
    this.visionRing.position.y = 5; this.visionRing.renderOrder = 2; this.visionRing._vis = vis0; scene.add(this.visionRing)
    // ПРИЦЕЛ: лучевой маркер на земле (бокс) + ретикл-кольцо на конце
    this.aimBeam = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 1), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false }))
    this.aimBeam.renderOrder = 4; scene.add(this.aimBeam)
    // СЕКТОР РАЗБРОСА: две боковые линии-края (как в 2D) — где «гуляет» прицел вокруг
    // корпуса. Тоньше/тусклее луча сведения. Геометрия как у aimBeam (бокс по Z).
    const mkSector = () => { const m = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 1), new THREE.MeshBasicMaterial({ color: 0xf2a50c, transparent: true, opacity: 0.22, depthWrite: false })); m.renderOrder = 3; scene.add(m); return m }
    this.sectorL = mkSector(); this.sectorR = mkSector()
    this.aimReticle = this._mkGroundRing(22, 27, 0xffe066, 1)
    this.aimReticle.position.y = 6; this.aimReticle.renderOrder = 4; scene.add(this.aimReticle)

    // применяем стартовое качество (pixelRatio/тени/туман-меш/блоб-тени)
    this._applyQuality(this._quality)

    // FPS-HUD (тестерам): текущий FPS + уровень качества; по нему выставим пороги
    const hud = document.createElement('div')
    hud.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:6;font:11px/1.3 monospace;color:#8ee06a;background:rgba(0,0,0,.45);padding:2px 6px;border-radius:5px;pointer-events:none'
    container.appendChild(hud); this._hud = hud; this._updateHud()

    // модели танков грузятся ПЕР-ТАНК в _tankGroup по реестру (meta.tankModelUrl):
    // каждый юнит получает СВОЮ модель + размер по классу. Кэш по URL (loadModelScene)
    // грузит каждый файл раз; до загрузки показываем плейсхолдер-бокс.

    this._bindKeyboard()
    this._inputTimer = setInterval(() => this._sendInput(), 50)
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(container)

    // игровой цикл (вместо Pixi-тикера). super._update делает ВСЮ работу с данными
    // (слив снапшотов, лерп-часы, предикт, события, таймеры эффектов) и в конце
    // зовёт this._draw() — наш, 3D.
    this._prevT = performance.now()
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - this._prevT) / 1000)
      this._prevT = now
      this._update(dt)
      this._checkPerf(now)
    }
    this._raf = requestAnimationFrame(loop)
    this._emitState()
  }

  // АВТО-КАЧЕСТВО: уровень 0 LOW / 1 MED / 2 HIGH. Дёргаем pixelRatio, тени (+ их
  // разрешение), туман-меш; на LOW тени реального времени выключаем → блоб-тени.
  _applyQuality(level) {
    this._quality = Math.max(0, Math.min(2, level))
    const dpr = window.devicePixelRatio || 1
    this.renderer.setPixelRatio(this._quality >= 2 ? Math.min(2, dpr) : this._quality >= 1 ? Math.min(1.5, dpr) : 1)
    const shadows = this._quality >= 1
    if (this.sun) { this.sun.castShadow = shadows; if (shadows) this.sun.shadow.mapSize.set(this._quality >= 2 ? 2048 : 1024, this._quality >= 2 ? 2048 : 1024) }
    this._blobOn = !shadows // на LOW реальные тени off → показываем дешёвые блоб-пятна
    if (this.tankGroups) for (const [, t] of this.tankGroups) if (t.blob) t.blob.visible = this._blobOn
    if (this.fogRing) this.fogRing.visible = this._quality >= 1 // на LOW туман-меш убираем (scene.fog остаётся)
    this._updateHud()
  }

  // FPS-замер раз в секунду → при просадке понижаем качество; если даже на LOW
  // держится <24 — отключаем 3D для СЛЕДУЮЩЕГО боя (текущий доигрываем на LOW,
  // без рискованного swap движка посреди боя). «Взорвать» телефон нельзя.
  _checkPerf(now) {
    if (!this._fpsT0) { this._fpsT0 = now; this._fpsN = 0; return }
    this._fpsN++
    const el = now - this._fpsT0
    if (el < 1000) return
    this._fps = Math.round((this._fpsN * 1000) / el)
    this._fpsT0 = now; this._fpsN = 0
    this._updateHud()
    if (now < this._warmAt) return
    if (this._fps < 30 && this._quality > 0) { this._applyQuality(this._quality - 1); this._badStreak = 0 }
    else if (this._fps < 24 && this._quality === 0) { this._badStreak = (this._badStreak || 0) + 1; if (this._badStreak >= 2) this._fallback2D() }
    else this._badStreak = 0
  }

  _fallback2D() {
    if (this._fellBack) return
    this._fellBack = true
    try { localStorage.setItem('pz3d', '0') } catch { /* приватный режим */ }
    if (this._hud) { this._hud.textContent = '⚠ 3D тяжёл — след. бой в 2D'; this._hud.style.color = '#ffb24a' }
    console.warn('[3d] устройство не тянет — 3D выключен для следующего боя')
  }

  _updateHud() {
    if (!this._hud || this._fellBack) return
    const q = ['LOW', 'MED', 'HIGH'][this._quality] || '?'
    this._hud.textContent = `FPS ${this._fps || '—'} · ${q}`
    const f = this._fps || 60
    this._hud.style.color = f >= 45 ? '#8ee06a' : f >= 28 ? '#ffd24a' : '#ff6a5a'
  }

  _resize() {
    const W = this.container.clientWidth, H = this.container.clientHeight
    if (!W || !H) return
    this.renderer.setSize(W, H)
    this.overlay.width = W * this._dpr; this.overlay.height = H * this._dpr
    this.camera.aspect = W / H; this.camera.updateProjectionMatrix()
  }

  // --- статика мира ---
  // КУПОЛ НЕБА: большая сфера-наизнанку с вертикальным градиентом дымка→зенит. Даёт
  // настоящий горизонт и «воздух» (раньше фон был плоским цветом). Туман у горизонта
  // того же цвета (haze) → земля бесшовно растворяется в небе. Дёшево: 1 меш, без теней.
  _buildSky(mood) {
    const geo = new THREE.SphereGeometry(this.mapSize * 1.6, 32, 16)
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(mood.top) },
        bot: { value: new THREE.Color(mood.haze) },
        off: { value: this.mapSize * 0.04 }, exp: { value: 0.8 },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; uniform float off; uniform float exp; varying vec3 vP; void main(){ float h = normalize(vP + vec3(0.0, off, 0.0)).y; gl_FragColor = vec4(mix(bot, top, pow(max(h, 0.0), exp)), 1.0); }',
    })
    const sky = new THREE.Mesh(geo, mat)
    sky.position.set(this.mapSize / 2, 0, this.mapSize / 2); sky.frustumCulled = false
    this.scene.add(sky)
  }

  _buildGround(mood) {
    const th = this.map.theme || {}
    const geo = new THREE.PlaneGeometry(this.mapSize, this.mapSize)
    // карт-текстуру подложим, когда догрузится (ниже); до этого — цвет темы как фоллбэк
    const mat = new THREE.MeshStandardMaterial({ color: th.ground || 0x4f5a2c, roughness: 0.96, metalness: 0 })
    const g = new THREE.Mesh(geo, mat)
    g.rotation.x = -Math.PI / 2
    g.position.set(this.mapSize / 2, 0, this.mapSize / 2)
    g.receiveShadow = true
    this.scene.add(g)
    this.groundMat = mat
    // КАРТ-СПЕЦИФИЧНАЯ ЗЕМЛЯ: та же /sprites/maps/<id>/ground.png, что в 2D — тайлится по
    // RepeatWrapping с тем же зерном (groundScale как tileScale у 2D TilingSprite). Раньше
    // в 3D земля была плоским цветом — теперь реальная фактура грунта/снега/песка/брусчатки.
    const url = this.map && this.map.id ? `/sprites/maps/${this.map.id}/ground.png` : null
    if (url) {
      new THREE.TextureLoader().load(url, (tex) => {
        if (!this.scene || this.groundMat !== mat) return
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        const iw = (tex.image && tex.image.width) || 512
        const rep = Math.max(1, this.mapSize / (iw * (th.groundScale || 0.55)))
        tex.repeat.set(rep, rep)
        try { tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) } catch { /* нет аниз. */ }
        mat.map = tex; mat.color.setHex(0xffffff); mat.needsUpdate = true // текстура своей расцветки — не тинтуем
      }, undefined, () => { /* нет файла — остаётся цвет темы */ })
    }
    // ОВЕРЛЕЙ ТЕМЫ (асфальт города / СНЕГ зимы / тёмная подложка леса) — как в 2D: заливка
    // поверх земли. Без него зима/город в 3D были неотличимы от поля. Полупрозрачный план.
    if (th.overlay != null && th.overlayAlpha) {
      const om = new THREE.Mesh(new THREE.PlaneGeometry(this.mapSize, this.mapSize),
        new THREE.MeshBasicMaterial({ color: th.overlay, transparent: true, opacity: th.overlayAlpha, depthWrite: false }))
      om.rotation.x = -Math.PI / 2; om.position.set(this.mapSize / 2, 0.6, this.mapSize / 2); om.renderOrder = 1
      this.scene.add(om)
    }
    // Координатная сетка — еле заметная, только на MED/HIGH (на LOW убираем). Тон — из темы.
    if (this._quality >= 1) {
      const grid = new THREE.GridHelper(this.mapSize, 24, th.grid || 0x39431f, th.grid || 0x39431f)
      grid.material.opacity = 0.05; grid.material.transparent = true; grid.material.depthWrite = false
      grid.position.set(this.mapSize / 2, 0.9, this.mapSize / 2)
      this.scene.add(grid)
    }
  }

  _buildStatic() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 1, flatShading: true })
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1, flatShading: true })
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x6b5436, roughness: 0.9 })
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x47502a, roughness: 1 })
    // вода: ярче/насыщеннее + лёгкий «блеск» (metalness) и слабое свечение — читается как
    // живая вода, а не плоский синий диск. Каждый водоём клонирует материал (своя фаза ряби).
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f93b6, roughness: 0.16, metalness: 0.4, transparent: true, opacity: 0.88, emissive: 0x07323f, emissiveIntensity: 0.35 })
    this.bushMeshes = []
    this.waterMeshes = [] // рябь: лёгкое мерцание свечения/уровня в _draw
    this._obstSwap = [] // примитивы препятствий, которые заменим на GLB когда догрузятся
    for (const o of this.obstacles) {
      let m
      // декор-укрытие (kind:'block' + prop): рисуется GLB-моделью в _load3DProps, примитива нет
      if (o.prop) { this._obstSwap.push({ o, prim: null }); continue }
      // ВНИМАНИЕ: в картах камень — kind:'block' (не 'rock'); раньше он не рисовался в 3D
      if (o.kind === 'rock' || o.kind === 'block') { m = new THREE.Mesh(new THREE.IcosahedronGeometry(o.r, 0), rockMat); m.scale.y = 0.7; m.position.set(o.x, o.r * 0.4, o.y); this._obstSwap.push({ o, prim: m }) }
      else if (o.kind === 'bush') {
        // куст = НИЗКАЯ ШИРОКАЯ ЛИСТВА (плоский тёмный кластер блобов), а НЕ высокий
        // ярко-зелёный ШАР-«НЛО» во весь экран (фидбек «всё сломалось»). Высоту режем
        // (scale.y 0.32), ширину капим (vr), цвет тёмный. Скрытность остаётся o.r.
        const g = new THREE.Group(); const fadeMats = []
        const vr = Math.min(o.r, 80) // визуальный радиус листвы (геймплей-скрытность = o.r)
        const n = 4 + (hashId(`${o.x}:${o.y}`) % 2)
        for (let k = 0; k < n; k++) {
          const s = hashId(`${o.x}:${o.y}:${k}`)
          const rr = vr * (0.5 + ((s % 100) / 100) * 0.25)
          const ang = (s % 360) * Math.PI / 180
          const dist = vr * 0.42 * (((s >> 5) % 100) / 100)
          const mat = bushMat.clone(); mat.color.setHex(mixHex(0x2c5e36, 0x16301c, (s % 100) / 100)); mat.transparent = true
          const sm = new THREE.Mesh(new THREE.SphereGeometry(rr, 8, 5), mat)
          sm.scale.y = 0.32; sm.position.set(Math.cos(ang) * dist, rr * 0.24, Math.sin(ang) * dist)
          sm.receiveShadow = true // куст НЕ отбрасывает тень (мягче/дешевле)
          g.add(sm); fadeMats.push(mat)
        }
        g.position.set(o.x, 0, o.y); m = g
        this.bushMeshes.push({ prim: g, fadeMats, x: o.x, y: o.y, r: o.r }); this._obstSwap.push({ o, prim: g })
      }
      else if (o.kind === 'box') { m = new THREE.Mesh(new THREE.BoxGeometry(o.r * 1.6, o.r * 1.4, o.r * 1.6), boxMat); m.position.set(o.x, o.r * 0.7, o.y); this._obstSwap.push({ o, prim: m }) }
      else if (o.kind === 'hill') { m = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.05, o.r * 0.35, 24), hillMat); m.position.set(o.x, o.r * 0.17, o.y) }
      else if (o.kind === 'water') { m = new THREE.Mesh(new THREE.CircleGeometry(o.r, 36), waterMat.clone()); m.rotation.x = -Math.PI / 2; m.position.set(o.x, 1.2, o.y); m._ph = (hashId(`${o.x}:${o.y}`) % 100) / 16; this.waterMeshes.push(m) }
      if (m) { if (o.kind !== 'water') { m.castShadow = true; m.receiveShadow = true } this.scene.add(m) }
    }
    // здания — корпус (тон ПОД КАРТУ: песчаник/снег/камень, а не один серый бокс) +
    // тёмная плита-крыша с карнизом (силуэт, тень — читается как здание, не куб).
    const th = this.map.theme || {}
    const mix = (a, b, t) => { const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255; return ((Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)) >>> 0 }
    const wallCol = mix(0x747a80, th.ground || 0x747a80, 0.42)
    const bMat = new THREE.MeshStandardMaterial({ color: wallCol, roughness: 0.9 })
    const roofMat = new THREE.MeshStandardMaterial({ color: mix(wallCol, 0x000000, 0.42), roughness: 0.95 })
    // урбан-карты: крупные «кварталы» заменим GLB-домом (когда пропы догрузятся), тонкие
    // баррикады остаются коробкой. _wallSwap держит бокс+крышу, чтобы спрятать под дом.
    const urban = ['city', 'eisenstadt', 'ruins'].includes(this.map.id)
    this._wallSwap = []
    for (const w of this.walls) {
      const Hh = Math.max(40, Math.min(Math.min(w.hw, w.hh) * 1.3, 120))
      const b = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2, Hh, w.hh * 2), bMat)
      b.position.set(w.cx, Hh / 2, w.cy); b.castShadow = true; b.receiveShadow = true
      this.scene.add(b)
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2 + 8, 8, w.hh * 2 + 8), roofMat)
      roof.position.set(w.cx, Hh + 4, w.cy); roof.castShadow = true; roof.receiveShadow = true
      this.scene.add(roof)
      if (urban && Math.min(w.hw, w.hh) >= 45) this._wallSwap.push({ w, box: b, roof })
    }
    // базы — жирные кольца + столб света на земле
    for (const base of this.bases) {
      const col = (base.team === this.side ? this.colors.ally : this.colors.enemy).hp
      const r = this._mkGroundRing(base.r - 5, base.r, col, 0.55); r.position.set(base.x, 2, base.y); this.scene.add(r)
    }
    // ТОЧКИ ЗАХВАТА — заметные: тусклый диск + жирное кольцо + столб + диск прогресса
    this.capRings = {}
    for (const id in this.capPos) this.capRings[id] = this._mkCap(this.capPos[id])
  }

  // нормализация пропа: центр по X/Z, основание на земле (y=0), масштаб по
  // посадочному «следу» (spec.fit) или по высоте (spec.h). Возвращает Group-обёртку.
  _normalizeProp(scene, spec) {
    const m = scene.clone(true)
    // модели Hunyuan-3D уже Y-up — НЕ доворачиваем (доворот ронял их на бок)
    m.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(m)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = spec.h ? spec.h / (size.y || 1) : spec.fit / (Math.max(size.x, size.z) || 1)
    m.scale.setScalar(s)
    // центр по X/Z и основание на земле — в МАСШТАБИРОВАННОМ кадре (box снят при scale=1)
    m.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    const wrap = new THREE.Group(); wrap.add(m)
    return wrap
  }

  // умножить цвет всех материалов пропа на hex (тинт под карту). Текстура GLB обычно
  // белая под маской — мультипликатив сохраняет детализацию, но сдвигает оттенок.
  _tintProp(wrap, hex) {
    const c = new THREE.Color(hex)
    wrap.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const apply = (mm) => { mm = mm.clone(); if (mm.color) mm.color.multiply(c); return mm }
      o.material = Array.isArray(o.material) ? o.material.map(apply) : apply(o.material)
    })
  }

  // вызывается когда GLB-пропы догрузились: меняем примитивы препятствий на модели
  // и раскидываем тематический декор. Если модель не пришла — остаётся примитив.
  _load3DProps(scenes) {
    if (!this.scene || !scenes) return
    const th = this.map.theme || {}
    // GLB вместо примитивов: КАМНИ→rock, ЯЩИКИ→crate (хорошо читаются сверху; кусты
    // оставляем примитивами). Декор-укрытия (o.prop) — рисуем свою GLB-модель, масштаб
    // под радиус коллизии (≈2×r), чтобы вид совпадал с тем, обо что упираешься.
    for (const { o, prim } of this._obstSwap) {
      const key = o.prop ? o.prop : (o.kind === 'rock' || o.kind === 'block') ? 'boulder' : o.kind === 'box' ? 'crate' : null
      const sc = key && scenes[key]
      if (!sc) continue
      // масштаб пропа относительно танка (TANK_LEN=78): ящик меньше танка, валун чуть
      // крупнее (фидбек «коробка больше танка» — было 1.8/2.1, пропы выглядели гигантами).
      const fitR = o.prop ? 1.7 : key === 'crate' ? 1.25 : 1.5
      const wrap = this._normalizeProp(sc, { fit: o.r * fitR })
      // ВАЛУН тинтуем под землю карты (текстура светлая) — снег→белый, песок→песочный,
      // лес→серо-зелёный. Лёгкий тинт, чтобы камень не выбивался из палитры.
      if (key === 'boulder') this._tintProp(wrap, mixHex(0xc0bcae, th.ground || 0xb0b0a8, 0.7))
      wrap.position.set(o.x, 0, o.y)
      wrap.rotation.y = (hashId(`${o.x}:${o.y}`) % 360) * Math.PI / 180
      if (prim) prim.visible = false
      this.scene.add(wrap)
    }
    // УРБАН-ДОМА: крупные кварталы → GLB-дом (укрытие = здание, честно). Масштаб по следу
    // стены; бокс+крышу прячем. Поворот квантуем по 90° (дом «лицом» к осям улиц).
    if (this._wallSwap && scenes.house) {
      for (const { w, box, roof } of this._wallSwap) {
        const wrap = this._normalizeProp(scenes.house, { fit: Math.max(w.hw, w.hh) * 2 * 1.12 })
        wrap.position.set(w.cx, 0, w.cy)
        wrap.rotation.y = (hashId(`${w.cx}:${w.cy}`) % 4) * (Math.PI / 2)
        box.visible = false; roof.visible = false
        this.scene.add(wrap)
      }
    }
    // ОКРУЖЕНИЕ-ЗАДНИК (ВИЗУАЛ, без коллизий): деревья у кустов и по опушке на природных
    // картах, горы по краю на скальных. Sim/2D их не видят — баланс/засвет не трогаем.
    for (const s of this._sceneryProps()) {
      const sc = scenes[s.prop]
      if (!sc) continue
      const wrap = this._normalizeProp(sc, { h: s.h })
      // ПЕРФ: фон-окружение НЕ отбрасывает тени (только принимает) — выкидывает их из
      // shadow-pass. Тяжёлый кадр раздувал ЗАМЕР пинга (pong обрабатывается на занятом
      // main-thread, см. net.js _onPong) — это снижает и стоимость кадра, и «пинг».
      wrap.traverse((o) => { if (o.isMesh) o.castShadow = false })
      wrap.position.set(s.x, 0, s.y)
      wrap.rotation.y = s.rot
      this.scene.add(wrap)
    }
    // ДЕКОР-СКАТТЕР (только 3D-визуал, БЕЗ коллизий): бочки/ежи/руины/мешки по военным
    // картам. Генерим клиентски (detерминированно по id карты), НЕ трогая sim/баланс/2D.
    for (const d of this._decorProps()) {
      const sc = scenes[d.prop]
      if (!sc) continue
      const wrap = this._normalizeProp(sc, { fit: d.r * 1.8 })
      wrap.position.set(d.x, 0, d.y)
      wrap.rotation.y = (hashId(`${d.x}:${d.y}`) % 360) * Math.PI / 180
      this.scene.add(wrap)
    }
  }

  // декор-пропы текущей карты в пикселях (dx/dy форка → px по sc). ВИЗУАЛ, без коллизий —
  // sim/сервер/2D их не видят (намеренно: не меняем баланс живого боя).
  _decorProps() {
    if (!this.map) return []
    const c = this.mapSize / 2
    const sc = this.mapSize / MAP_SIZE
    return decorObstacles(this.map).map((d) => ({ x: c + d.dx * sc, y: c + d.dy * sc, r: d.r, prop: d.prop }))
  }

  // ОКРУЖЕНИЕ-ЗАДНИК (ВИЗУАЛ, БЕЗ КОЛЛИЗИЙ): деревья у кустов + по опушке на природных
  // картах; горы по краю на скальных. ЧЕСТНОСТЬ: ставим у реального укрытия (кусты) и по
  // краю поля — НЕ в центре, чтобы не выглядело фейк-укрытием (засвет/баланс не трогаем).
  // Детерминированно по id карты (стабильно у всех клиентов). Только MED/HIGH (см. гейт).
  _sceneryProps() {
    if (!this.map) return []
    const id = this.map.id
    const half = this.mapSize / 2, cx = half, cy = half
    let seed = (hashId(id) ^ 0x9e3779b9) >>> 0
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const out = []
    const bad = (x, y, r) => {
      for (const b of this.bases) if (Math.hypot(x - b.x, y - b.y) < b.r + r + 60) return true
      for (const k in this.capPos) { const p = this.capPos[k]; if (Math.hypot(x - p.x, y - p.y) < p.r + r + 50) return true }
      return false
    }
    const NATURE = ['polygon', 'forest', 'lakes', 'meadow', 'crossing']
    const ROCKY = ['heights', 'desert']
    if (NATURE.includes(id)) {
      // ДЕРЕВЬЯ ТОЛЬКО ПО ОПУШКЕ (край карты). Раньше сажали деревья НА кусты — дерево
      // торчало из зелёной сферы-куста и клипалось («это чего такое»). Убрано.
      const ring = 12
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2 + rand() * 0.35
        const rr = half * (0.8 + rand() * 0.14)
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr
        if (bad(x, y, 90)) continue
        out.push({ x, y, prop: 'tree', h: 150 + rand() * 90, rot: rand() * Math.PI * 2 })
      }
    }
    if (ROCKY.includes(id)) {
      // горы по краю — крупный задник (визуал)
      const N = 7
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + rand() * 0.25
        const rr = half * (0.84 + rand() * 0.12)
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr
        if (bad(x, y, 220)) continue
        out.push({ x, y, prop: 'mtn', h: 230 + rand() * 150, rot: rand() * Math.PI * 2 })
      }
    }
    return out
  }

  // плоское кольцо на земле (видимое, в отличие от 1px-линии)
  _mkGroundRing(inner, outer, color, opacity) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })
    )
    m.rotation.x = -Math.PI / 2; m.frustumCulled = false
    return m
  }

  // точка захвата — диск-основа + диск-прогресс + жирное кольцо + полупрозрачный столб
  _mkCap(p) {
    const g = new THREE.Group(); g.position.set(p.x, 0, p.y)
    // ТЁМНАЯ подложка-диск — контраст маркера на ЛЮБОМ фоне (особенно на БЕЛОМ снегу,
    // где светлые кольца сливались, фидбек Katrin). Цветом владельца НЕ красим: это
    // нейтральная тёмная плита, на ней читаются цветные кольцо/прогресс/столб.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48), new THREE.MeshBasicMaterial({ color: 0x0b0e14, transparent: true, opacity: 0.26, depthWrite: false }))
    disc.rotation.x = -Math.PI / 2; disc.position.y = 1.5
    const fill = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }))
    fill.rotation.x = -Math.PI / 2; fill.position.y = 2; fill.scale.setScalar(0.001)
    const ring = this._mkGroundRing(p.r - 9, p.r, 0x9aa6b2, 0.95); ring.position.y = 3 // толще+ярче кольцо
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 130, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x9aa6b2, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.y = 65 // выше+ярче столб — маркер виден сверху на любом грунте
    g.add(disc, fill, ring, beam); this.scene.add(g)
    return { g, disc, fill, ring, beam, r: p.r }
  }

  // нормализация GLB: центр по XZ, основание на y=0, масштаб = TANK_LEN×размер_класса,
  // ось «вперёд» к Z (часть моделей смоделирована длиной по X — довернуть на 90°), тени
  _normalizeModel(model, sizeScale = 1, flip = false) {
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    model.position.x -= center.x; model.position.z -= center.z; model.position.y -= box.min.y
    const longest = Math.max(size.x, size.z) || 1
    model.scale.setScalar((TANK_LEN * sizeScale) / longest)
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    const wrap = new THREE.Group(); wrap.add(model)
    if (size.x > size.z) wrap.rotation.y = -Math.PI / 2 // длина по X → довернуть «вперёд» к Z
    if (flip) wrap.rotation.y += Math.PI // модель смоделирована «задом» (см. MODEL_FLIP) → доворот 180°
    return wrap
  }

  // КАМУФЛЯЖ на модель танка: процедурный узор (camo.js) → CanvasTexture поверх
  // материалов GLB (как в ангаре Tank3DView). Без камо ('' / неизвестный) — оставляем
  // заводскую текстуру модели. Зерно — хэш tankId (стабильный узор у всех клиентов).
  _applyCamoToModel(root, camoId, seed) {
    const def = CAMO_BY_ID[camoId]
    if (!def || !def.pattern) return
    const S = 512
    const cv = document.createElement('canvas'); cv.width = cv.height = S
    drawCamoPattern(cv.getContext('2d'), S, def.pattern, seed)
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2.2, 2.2)
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return
      o.material = o.material.clone() // не мутируем общий кэш сцен
      o.material.map = tex
      if (o.material.color) o.material.color.set(0xffffff)
      if ('metalness' in o.material) o.material.metalness = 0.1
      if ('roughness' in o.material) o.material.roughness = 0.85
      o.material.needsUpdate = true
    })
  }

  // НИЗКОПОЛИ-ТАНК из примитивов — плейсхолдер/фоллбэк, когда GLB не загрузился.
  // Узнаваемый силуэт (корпус+башня+ствол), ствол вперёд (+Z). Цвет команды.
  _placeholderTank(isSelf) {
    const col = isSelf ? 0xd99a2c : 0x6f7a66
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, metalness: 0.05, flatShading: true })
    const g = new THREE.Group()
    const W = TANK_LEN * 0.52 // ширина корпуса
    const hull = new THREE.Mesh(new THREE.BoxGeometry(W, 15, TANK_LEN * 0.9), mat)
    hull.position.y = 11; hull.castShadow = true; g.add(hull)
    const turret = new THREE.Mesh(new THREE.BoxGeometry(W * 0.66, 12, TANK_LEN * 0.46), mat)
    turret.position.set(0, 23, -TANK_LEN * 0.04); turret.castShadow = true; g.add(turret)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, TANK_LEN * 0.6, 10), mat)
    barrel.rotation.x = Math.PI / 2 // ось Y→Z (ствол вперёд)
    barrel.position.set(0, 23, TANK_LEN * 0.42); barrel.castShadow = true; g.add(barrel)
    return g
  }

  _tankGroup(u, isSelf) {
    let t = this.tankGroups.get(u.id)
    if (t) return t
    const group = new THREE.Group()
    const holder = new THREE.Group(); group.add(holder)
    // ПЛЕЙСХОЛДЕР: низкополи-танк из примитивов (корпус+башня+ствол), пока грузится
    // GLB. На устройствах, где GLB не тянется (webp/meshopt в webview), он ОСТАЁТСЯ —
    // и это узнаваемый танк, а не голый куб («это t28, ахахаха»). Ствол смотрит в +Z
    // (локальное «вперёд»: holder крутится по hull, см. _draw).
    holder.add(this._placeholderTank(isSelf))
    // командное кольцо под танком
    const ringCol = isSelf ? 0xf2d24a : (u.team === this.side ? this.colors.ally : this.colors.enemy).hp
    const ring = this._mkGroundRing(37, 42, ringCol, 0.82); ring.position.y = 2; group.add(ring)
    // блоб-тень (дешёвая) — видна, когда реальные тени выключены на LOW
    const blob = new THREE.Mesh(new THREE.CircleGeometry(36, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }))
    blob.rotation.x = -Math.PI / 2; blob.position.y = 1; blob.visible = !!this._blobOn; group.add(blob)
    this.scene.add(group)
    t = { group, holder, ring, blob }
    this.tankGroups.set(u.id, t)
    // РЕАЛЬНАЯ модель танка по реестру + размер по классу. Если своя модель не
    // загрузилась (нет в реестре / сбой сети) — фоллбэк на модель нации, чтобы НИКОГДА
    // не торчал плейсхолдер-бокс («это t28 в 3d, ахахаха»). Бокс — только пока грузит.
    const url = tankModelUrl(u.tankId, u.nation)
    // камуфляж: свой танк — выбранный игроком (playerCamo, как в 2D, local-only), чужие —
    // их u.camo из снапшота (если сервер шлёт; иначе заводская). Узор — процедурный.
    const camoId = u.id === this.youUnit ? this.playerCamo : u.camo
    const place = (sc, srcUrl) => {
      if (!sc || this.tankGroups.get(u.id) !== t || !this.scene) return false // юнит исчез / destroy
      holder.clear()
      const m = this._normalizeModel(sc.clone(true), tankSizeScale(u.tankId), modelNeedsFlip(srcUrl))
      this._applyCamoToModel(m, camoId, hashId(u.tankId))
      holder.add(m)
      return true
    }
    loadModelScene(url).then((sc) => {
      if (place(sc, url) || this.tankGroups.get(u.id) !== t || !this.scene) return
      const fb = tankModelUrl(null, u.nation) // модель нации (СССР→Т-90 и т.д.) — обычно уже прогрета
      if (fb !== url) loadModelScene(fb).then((sc2) => place(sc2, fb)).catch(() => {})
    }).catch(() => {})
    return t
  }

  // --- рендер кадра (зовётся в конце super._update) ---
  _draw() {
    if (!this.renderer) return
    const units = this._lerpUnits()
    const own = this._own(units)
    const dead = !!(own && !own.alive)
    const ox = own ? own.x : this.mapSize / 2
    const oy = own ? own.y : this.mapSize / 2
    const oh = own ? own.hull : (this.side === 0 ? Math.PI / 2 : -Math.PI / 2)
    const yaw3 = (typeof window !== 'undefined' && window.__YAW3 != null) ? window.__YAW3 : 0

    // личный туман войны: враг вне ЛИЧНОГО обзора — скрыт (как в 2D _draw)
    const PROX = 150
    const radioMul = this.you && this.you.crippled && this.you.crippled.radio > 0 ? 0.5 : 1
    const vis = this.cls.vision * radioMul
    this._hiddenEnemy = new Set()
    if (own && own.alive) {
      for (const u of units) {
        if (!u.alive || u.team === this.side) continue
        if (Math.hypot(u.x - ox, u.y - oy) > Math.max(PROX, vis)) this._hiddenEnemy.add(u.id)
      }
    }

    // танки
    const seen = new Set()
    for (const u of units) {
      const isSelf = u.id === this.youUnit
      if (!isSelf && u.alive && u.team !== this.side && this._hiddenEnemy.has(u.id)) {
        const ex = this.tankGroups.get(u.id); if (ex) ex.group.visible = false; continue
      }
      seen.add(u.id)
      const t = this._tankGroup(u, isSelf)
      t.group.visible = true
      t.group.position.set(u.x, 0, u.y)
      t.holder.rotation.y = (Math.PI / 2 - u.hull) + yaw3
      t.holder.visible = true
      // подбитый — притопить и затемнить кольцо
      t.ring.material.opacity = u.alive ? 0.85 : 0.25
      if (!u.alive) { t.holder.position.y = -6 } else { t.holder.position.y = 0 }
    }
    for (const [id, t] of this.tankGroups) if (!seen.has(id)) t.group.visible = false

    // КУСТЫ: прозрачнеют, если внутри стоит ВИДИМЫЙ танк (свой/тиммейт/засвеченный
    // враг) — куст не должен прятать того, кого игрок и так должен видеть
    if (this.bushMeshes) {
      for (const b of this.bushMeshes) {
        let occupied = false
        for (const u of units) {
          if (!u.alive) continue
          if (u.team !== this.side && u.id !== this.youUnit && this._hiddenEnemy.has(u.id)) continue
          if (Math.hypot(u.x - b.x, u.y - b.y) < b.r * 0.95) { occupied = true; break }
        }
        const tgt = occupied ? 0.26 : 1
        for (const mat of b.fadeMats) mat.opacity += (tgt - mat.opacity) * 0.2
      }
    }

    // точки захвата — цвет владельца + диск прогресса захвата (в цвете захватчика)
    const caps = this.cur ? this.cur.caps : []
    for (const cap of caps || []) {
      const c = this.capRings[cap.id]; if (!c) continue
      const owner = cap.owner === this.side ? this.colors.ally.hp : cap.owner != null ? this.colors.enemy.hp : 0xe8c24a // нейтрал — янтарный (виден на белом снегу и на тёмных картах)
      c.ring.material.color.setHex(owner); c.beam.material.color.setHex(owner) // диск НЕ красим — он тёмная плита-подложка
      const capper = cap.capper === this.side ? this.colors.ally.hp : cap.capper != null ? this.colors.enemy.hp : owner
      const p = Math.max(0, Math.min(1, cap.p || 0))
      c.fill.material.color.setHex(capper)
      c.fill.scale.setScalar(p > 0.01 ? p : 0.001)
    }

    // ВОДА: лёгкая «рябь» — мерцание свечения + микро-колебание уровня (каждый водоём
    // в своей фазе). Дёшево (несколько мешей), но вода перестаёт быть мёртвым диском.
    if (this.waterMeshes && this.waterMeshes.length) {
      const tw = performance.now() * 0.001
      for (const w of this.waterMeshes) {
        w.material.emissiveIntensity = 0.3 + 0.18 * Math.sin(tw * 1.6 + w._ph)
        w.position.y = 1.2 + 0.6 * Math.sin(tw * 0.9 + w._ph * 1.7)
      }
    }

    this._drawAim(own, vis, oh, ox, oy)
    this._drawFx()
    const nowD = performance.now()
    const ddt = Math.min(0.05, (nowD - (this._lastDrawT || nowD)) / 1000); this._lastDrawT = nowD
    if (this.batch) this.batch.update(ddt) // продвигаем GPU-партиклы (вспышки/взрывы/дым/искры)
    this._dustTracks(units, ddt)
    this._wreckFx(units, ddt)

    // КАМЕРА: player-relative сверху (свой едет «от тебя»)
    const dist = (typeof window !== 'undefined' && window.__CAM_DIST) || 300
    const height = (typeof window !== 'undefined' && window.__CAM_H) || 560
    const ahead = (typeof window !== 'undefined' && window.__CAM_AHEAD) || 170
    const fx = Math.cos(oh), fz = Math.sin(oh)
    // ОТДАЧА выстрела (лёгкая) и тряска от попадания по мне (заметнее) — флаги ставит NetGameCore
    if (this._fxSelfShot) { this._fxSelfShot = false; this._shake = Math.min(1, this._shake + 0.32) }
    if (this._fxSelfHit) { this._fxSelfHit = false; this._shake = Math.min(1.2, this._shake + 0.75) }
    // ОТДАЧА ОТ УПОРА: свой танк уперся в препятствие/стену → пыль из-под носа + кратко тряхнём камеру
    const bump = this._bumpPush || 0
    if (bump > 2.5) {
      this._emitBumpDust(ox + fx * 32, oy + fz * 32)
      if (!this._wasBump) this._shake = Math.min(1, this._shake + 0.7) // кик только на ВХОДЕ в упор, не постоянно
      this._wasBump = true
    } else { this._wasBump = false }
    let shx = 0, shz = 0
    if (this._shake > 0.02) {
      const s = this._shake * 13
      shx = (Math.random() * 2 - 1) * s; shz = (Math.random() * 2 - 1) * s
      this._shake *= 0.8
    } else this._shake = 0
    // МЁРТВ — свободное наблюдение: камера на specCam (джойстик водит по карте, как в 2D
    // _panSpectator), фиксированный курс (не вертится за мёртвым танком), без тряски.
    // Фидбек тикет #26 «при смерти крутиться нельзя» — раньше 3D игнорил specCam.
    const spec = dead && this.specCam
    const cx = spec ? this.specCam.x : ox
    const cy = spec ? this.specCam.y : oy
    const cfx = spec ? 0 : fx, cfz = spec ? 1 : fz
    const csx = spec ? 0 : shx, csz = spec ? 0 : shz
    this.camera.position.set(cx - cfx * dist + csx, height, cy - cfz * dist + csz)
    this.camera.lookAt(cx + cfx * ahead, 0, cy + cfz * ahead)
    this.sunTarget.position.set(cx, 0, cy)
    this.sun.position.set(cx + 350, 600, cy + 200)

    this.renderer.render(this.scene, this.camera)
    this._drawOverlay(units, own)

    // миникарта (canvas 2D, рендер-независима — переиспользуем родительскую)
    const nowMs = performance.now()
    if (this.minimapCtx && nowMs - (this._lastMini || 0) > 80) { this._lastMini = nowMs; this._drawMinimap(units) }
  }

  // туман войны + кольцо обзора + лучевой прицел с ретиклом (всё на земле)
  _drawAim(own, vis, oh, ox, oy) {
    const alive = own && own.alive
    this.fogRing.visible = alive
    this.visionRing.visible = alive
    this.aimBeam.visible = alive
    this.aimReticle.visible = alive
    this.sectorL.visible = alive
    this.sectorR.visible = alive
    if (!alive) return
    // туман + кольцо обзора следуют за игроком (масштаб под текущий обзор)
    const sv = vis / (this.visionRing._vis || vis)
    this.fogRing.position.set(ox, 4, oy); this.fogRing.scale.set(sv, sv, 1)
    this.visionRing.position.set(ox, 5, oy); this.visionRing.scale.set(sv, sv, 1)
    const lit = !!(this.you && this.you.firedReveal)
    this.visionRing.material.color.setHex(lit ? 0xff4b33 : 0xf2a50c)

    const lineA = oh + this._sweepOffset()
    // ассист: ближайшая валидная цель в секторе → прицел зеленеет (как в 2D)
    const half = this._sectorHalfEff()
    // края сектора разброса — две линии на oh±half (как в 2D); луч сведения «гуляет» меж них
    const placeEdge = (mesh, a) => {
      mesh.position.set(ox + Math.cos(a) * vis / 2, 2.5, oy + Math.sin(a) * vis / 2)
      mesh.rotation.y = Math.PI / 2 - a; mesh.scale.z = vis
    }
    placeEdge(this.sectorL, oh - half); placeEdge(this.sectorR, oh + half)
    let target = null, td = Infinity, tx = 0, ty = 0
    for (const u of (this.cur ? this.cur.units : [])) {
      if (!u.alive || u.team === this.side) continue
      const d = Math.hypot(u.x - ox, u.y - oy)
      if (d > this.cls.range || (d > 150 && d > vis)) continue
      const ang = Math.atan2(u.y - oy, u.x - ox)
      if (Math.abs(this._angDiff(ang, oh)) > half) continue
      if (this._losBlocked(ox, oy, u.x, u.y)) continue
      if (d < td) { td = d; target = ang; tx = u.x; ty = u.y }
    }
    const ready = !!(this.you && this.you.ready)
    const onLine = target != null && Math.abs(this._angDiff(target, lineA)) <= this.cls.tolerance
    const locked = ready && onLine
    this._aimLock = locked
    const col = locked ? 0x46e08a : ready ? 0xffe066 : 0x9aa0ad
    // луч от танка вдоль линии сведения (при захвате — до цели)
    const len = locked && target != null ? td : vis
    this.aimBeam.position.set(ox + Math.cos(lineA) * len / 2, 3, oy + Math.sin(lineA) * len / 2)
    this.aimBeam.rotation.y = Math.PI / 2 - lineA
    this.aimBeam.scale.z = len
    this.aimBeam.material.color.setHex(col)
    this.aimBeam.material.opacity = ready ? 0.95 : 0.55
    // ретикл на конце луча (или на захваченной цели)
    const rx = locked && target != null ? tx : ox + Math.cos(lineA) * vis
    const ry = locked && target != null ? ty : oy + Math.sin(lineA) * vis
    this.aimReticle.position.set(rx, 6, ry)
    this.aimReticle.material.color.setHex(col)
    this.aimReticle.scale.setScalar(locked ? 1.3 : 1)
  }

  // === GPU-партиклы (three.quarks): вспышка дула / огонь / дым / искры / пыль ===
  // Пулы fire-and-forget систем. На выстрел/взрыв берём систему по кругу, ставим в
  // позицию и restart() (он обнуляет particleNum — поэтому пул должен пережить время
  // жизни партиклов; размеры подобраны с запасом под 7×7). Стартовый burst гасим
  // endEmit() при создании: первый кадр update() выходит рано (emitEnded && 0 частиц),
  // пока реальный _fx не вызовет restart().
  _initParticles() {
    if (!QK || !this.scene) return
    const batch = new QK.BatchedRenderer()
    this.scene.add(batch)
    this.batch = batch

    // мягкий круглый спрайт партикла — рисуем в canvas (без ассета)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64
    const cx = cv.getContext('2d')
    const grd = cx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grd.addColorStop(0.0, 'rgba(255,255,255,1)')
    grd.addColorStop(0.35, 'rgba(255,255,255,0.7)')
    grd.addColorStop(1.0, 'rgba(255,255,255,0)')
    cx.fillStyle = grd; cx.fillRect(0, 0, 64, 64)
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
    const matAdd = new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    const matNorm = new THREE.MeshBasicMaterial({ map: tex, blending: THREE.NormalBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    this._pDispose = [tex, matAdd, matNorm] // освобождаем в destroy()

    const V3 = (r, g, b) => new QK.Vector3(r, g, b)
    const V4 = (r, g, b, a) => new QK.Vector4(r, g, b, a)
    const iv = (a, b) => new QK.IntervalValue(a, b)
    const grow = (a, b, c, d) => new QK.SizeOverLife(new QK.PiecewiseBezier([[new QK.Bezier(a, b, c, d), 0]]))
    const up = (mag) => new QK.ApplyForce(new QK.Vector3(0, 1, 0), new QK.ConstantValue(mag))
    const down = (mag) => new QK.ApplyForce(new QK.Vector3(0, -1, 0), new QK.ConstantValue(mag))

    // фабрика одной системы + пула; emitter в сцену, регистрируем в batch, глушим стартовый burst
    const mk = (cfg) => {
      const ps = new QK.ParticleSystem({
        duration: cfg.duration, looping: false, autoDestroy: false, worldSpace: true,
        startLife: cfg.life, startSpeed: cfg.speed, startSize: cfg.size, startColor: cfg.color,
        emissionOverTime: new QK.ConstantValue(0),
        emissionBursts: [{ time: 0, count: new QK.ConstantValue(cfg.count), cycle: 1, interval: 0.01, probability: 1 }],
        shape: cfg.shape, material: cfg.mat,
        renderMode: QK.RenderMode.BillBoard, behaviors: cfg.behaviors || [],
      })
      batch.addSystem(ps); this.scene.add(ps.emitter); ps.endEmit()
      return ps
    }
    const pool = (n, cfg) => { const p = []; for (let i = 0; i < n; i++) p.push(mk(cfg)); p._n = 0; return p }
    const sphere = (r) => new QK.SphereEmitter({ radius: r, thickness: 1, arc: Math.PI * 2 })

    // ВСПЫШКА ДУЛА — короткий яркий аддитивный пых
    this._pFlash = pool(10, {
      duration: 0.2, life: iv(0.04, 0.12), speed: iv(20, 90), size: iv(10, 26),
      color: new QK.ConstantColor(V4(1, 0.86, 0.46, 1)), shape: sphere(4), mat: matAdd,
      count: 9, behaviors: [new QK.ColorOverLife(new QK.Gradient([[V3(1, 0.92, 0.6), 0], [V3(1, 0.5, 0.16), 1]], [[1, 0], [0.9, 0.3], [0, 1]])), grow(1, 1, 0.6, 0)],
    })
    // ОГОНЬ ВЗРЫВА — аддитивный шар, всплывает и тает
    this._pFire = pool(6, {
      duration: 0.5, life: iv(0.18, 0.42), speed: iv(15, 70), size: iv(14, 34),
      color: new QK.ConstantColor(V4(1, 0.74, 0.3, 1)), shape: sphere(6), mat: matAdd,
      count: 16, behaviors: [new QK.ColorOverLife(new QK.Gradient([[V3(1, 0.85, 0.45), 0], [V3(1, 0.4, 0.1), 0.55], [V3(0.4, 0.1, 0.05), 1]], [[0, 0], [0.95, 0.15], [0, 1]])), grow(0.35, 1, 0.9, 0.2), up(28)],
    })
    // ДЫМ — нормальный блендинг, тёмный, поднимается и расширяется (на LOW не льём)
    this._pSmoke = pool(6, {
      duration: 0.9, life: iv(0.5, 1.0), speed: iv(8, 30), size: iv(16, 30),
      color: new QK.ConstantColor(V4(0.12, 0.12, 0.12, 0.7)), shape: sphere(6), mat: matNorm,
      count: 10, behaviors: [new QK.ColorOverLife(new QK.Gradient([[V3(0.13, 0.13, 0.13), 0], [V3(0.07, 0.07, 0.07), 1]], [[0, 0], [0.55, 0.25], [0, 1]])), grow(0.4, 0.8, 1, 1)],
    })
    // ИСКРЫ — аддитивные мелкие, гравитация вниз, разлёт
    this._pSpark = pool(6, {
      duration: 0.4, life: iv(0.15, 0.4), speed: iv(80, 240), size: iv(3, 8),
      color: new QK.ConstantColor(V4(1, 0.95, 0.7, 1)), shape: sphere(2), mat: matAdd,
      count: 14, behaviors: [new QK.ColorOverLife(new QK.Gradient([[V3(1, 0.95, 0.7), 0], [V3(1, 0.55, 0.2), 1]], [[1, 0], [1, 0.5], [0, 1]])), down(150)],
    })
    // ПЫЛЬ ЗЕМЛИ — промах/рикошет: бежевый пых, нормальный блендинг
    this._pDust = pool(6, {
      duration: 0.6, life: iv(0.3, 0.6), speed: iv(10, 40), size: iv(12, 26),
      color: new QK.ConstantColor(V4(0.62, 0.56, 0.4, 0.6)), shape: sphere(5), mat: matNorm,
      count: 10, behaviors: [new QK.ColorOverLife(new QK.Gradient([[V3(0.62, 0.56, 0.4), 0], [V3(0.5, 0.45, 0.32), 1]], [[0, 0], [0.5, 0.25], [0, 1]])), grow(0.4, 0.9, 1, 1), up(12)],
    })
  }

  // взять систему из пула по кругу, поставить в мир (x,y,z) и пыхнуть. updateWorldMatrix
  // форсим вручную: batch.update идёт ДО renderer.render, иначе burst в старой позиции.
  _firePool(pool, x, y, z) {
    if (!pool || !pool.length) return
    pool._n = (pool._n + 1) % pool.length
    const ps = pool[pool._n]
    ps.emitter.position.set(x, y, z)
    ps.emitter.updateWorldMatrix(true, false)
    ps.restart()
  }

  _fxMuzzle(x, y) {
    if (!this.batch) return
    this._firePool(this._pFlash, x, 18, y)
    this._firePool(this._pSpark, x, 18, y) // лёгкий сноп искр из ствола
  }

  _fxBoom(x, y, big, dust) {
    if (!this.batch) return
    if (dust) { // промах/рикошет: пыль + короткий «пинг» искр
      this._firePool(this._pDust, x, 8, y)
      this._firePool(this._pSpark, x, 10, y)
      return
    }
    // попадание: огонь + дым (кроме LOW) + искры
    this._firePool(this._pFire, x, 16, y)
    this._firePool(this._pSpark, x, 14, y)
    if (this._quality >= 1) this._firePool(this._pSmoke, x, 14, y)
    if (big) { // киллшот — плотнее: ещё огонь+искры рядом
      this._firePool(this._pFire, x + 6, 22, y + 4)
      this._firePool(this._pSpark, x - 4, 18, y - 6)
    }
  }

  // трассеры + вспышки + взрывы (данные ведёт super._update в this.shells/muzzles/booms)
  _drawFx() {
    // НОВЫЕ выстрелы/взрывы → одноразовый GPU-burst (помечаем _fx, чтобы пыхнуть раз)
    if (this.batch) {
      for (const m of this.muzzles) { if (!m._fx) { m._fx = true; this._fxMuzzle(m.x, m.y) } }
      for (const bm of this.booms) { if (!bm._fx) { bm._fx = true; this._fxBoom(bm.x, bm.y, bm.big, bm.dust) } }
    }
    // СНАРЯД: светящаяся голова летит ПО ДУГЕ + затухающий трейл за ней (аддитивное свечение)
    const tg = this.tracerGroup, sg = this.shellGroup
    while (tg.children.length < this.shells.length) {
      tg.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 1), new THREE.MeshBasicMaterial({ color: TRACER_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })))
    }
    while (sg.children.length < this.shells.length) {
      sg.add(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })))
    }
    let ti = 0
    const BARREL = 46 // вынос дула вперёд от центра танка → выстрел «из ствола», не из центра
    for (const s of this.shells) {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      const bx1 = s.x1 + Math.cos(a) * BARREL, by1 = s.y1 + Math.sin(a) * BARREL // точка дула
      const k = Math.min(1, s.t / s.dur)
      const sx = bx1 + (s.x2 - bx1) * k, sy = by1 + (s.y2 - by1) * k
      const dist = Math.hypot(s.x2 - bx1, s.y2 - by1)
      const hy = 20 + Math.min(38, dist * 0.05) * Math.sin(Math.PI * k) // параболическая дуга (вверх→вниз)
      const col = s.color || TRACER_COLOR
      // голова-ядро
      const head = sg.children[ti]; head.visible = true
      head.position.set(sx, hy, sy); head.scale.setScalar(6.5); head.material.opacity = 1
      // трейл назад по направлению, на высоте головы
      const L = 46
      const tr = tg.children[ti]; tr.visible = true
      tr.position.set(sx - Math.cos(a) * L / 2, hy, sy - Math.sin(a) * L / 2)
      tr.rotation.y = Math.PI / 2 - a; tr.scale.set(1, 1, L)
      tr.material.color.setHex(col); tr.material.opacity = 0.8
      ti++
    }
    for (let i = ti; i < tg.children.length; i++) tg.children[i].visible = false
    for (let i = ti; i < sg.children.length; i++) sg.children[i].visible = false

    // ИМПУЛЬС СВЕТА от самой свежей дульной вспышки (один общий PointLight; сами
    // вспышки/взрывы/искры рисуют GPU-партиклы из _fxMuzzle/_fxBoom). Подсветка
    // живёт чуть дольше партикл-пыха (по m.age) — даёт «толчок» сцене на выстреле.
    let lit = null, litK = 0
    for (const m of this.muzzles) {
      const k = Math.max(0, 1 - m.age / 0.09)
      if (k > litK) { litK = k; lit = m }
    }
    if (this.muzzleLight) {
      if (lit) { this.muzzleLight.position.set(lit.x, 28, lit.y); this.muzzleLight.intensity = 9 * litK }
      else this.muzzleLight.intensity = 0
    }
  }

  // пыль при упоре в препятствие (берём пуф из общего пула — его анимирует _dustTracks)
  _emitBumpDust(x, y) {
    if (!this.dustGroup || this._quality < 1) return // на LOW пыль не льём
    if ((this._bumpDustT = (this._bumpDustT + 1) % 3) !== 0) return // дроссель: не каждый кадр
    const dm = this.dustGroup.children[this._dustI]; this._dustI = (this._dustI + 1) % this.dustGroup.children.length
    dm.position.set(x + (Math.random() * 2 - 1) * 16, 6, y + (Math.random() * 2 - 1) * 16)
    dm.scale.setScalar(8 + Math.random() * 6); dm._vy = 20; dm.material.opacity = 0.5; dm.visible = true
  }

  // следы гусениц + пыль из-под едущих танков (эмиссия по пройденному пути)
  _dustTracks(units, dt) {
    // апдейт пыли (поднимается, растёт, тает)
    for (const m of this.dustGroup.children) {
      if (!m.visible) continue
      m.position.y += m._vy * dt; m.scale.multiplyScalar(1 + dt * 1.5); m.material.opacity -= dt * 1.1
      if (m.material.opacity <= 0.02) m.visible = false
    }
    const emitDust = this._quality >= 1 // на LOW пыль не эмитим (экономим частицы)
    for (const u of units) {
      if (!u.alive) continue
      if (u.id !== this.youUnit && u.team !== this.side && this._hiddenEnemy && this._hiddenEnemy.has(u.id)) continue
      let mv = this._tankMove.get(u.id)
      if (!mv) { this._tankMove.set(u.id, { lx: u.x, ly: u.y, acc: 0, accD: 0 }); continue }
      const moved = Math.hypot(u.x - mv.lx, u.y - mv.ly)
      mv.lx = u.x; mv.ly = u.y
      if (moved < 0.4) continue // стоит — ни следа, ни пыли
      mv.accD += moved
      const dir = u.hull
      if (emitDust && mv.accD >= 32) { // пуф пыли за кормой
        mv.accD = 0
        const dm = this.dustGroup.children[this._dustI]; this._dustI = (this._dustI + 1) % this.dustGroup.children.length
        dm.position.set(u.x - Math.cos(dir) * 30, 10, u.y - Math.sin(dir) * 30)
        dm.scale.setScalar(7 + (this._dustI % 5)) // вариация без Math.random
        dm._vy = 16 + (this._dustI % 4) * 4
        dm.material.opacity = 0.45; dm.visible = true
      }
    }
  }

  // подбитый танк ГОРИТ и ДЫМИТ: чёрный дым столбом вверх + мерцающий огонь у основания
  _wreckFx(units, dt) {
    // дым: поднимается, растёт, тает
    for (const m of this.smokeGroup.children) {
      if (!m.visible) continue
      m.position.y += m._vy * dt
      m.scale.multiplyScalar(1 + dt * 0.7)
      m.material.opacity -= dt * 0.32
      if (m.material.opacity <= 0.02) m.visible = false
    }
    // огонь: чуть подрастает и быстро гаснет (мерцание)
    for (const m of this.fireGroup.children) {
      if (!m.visible) continue
      m.position.y += m._vy * dt
      m.scale.multiplyScalar(1 + dt * 0.4)
      m.material.opacity -= dt * 2.4
      if (m.material.opacity <= 0.02) m.visible = false
    }
    // эмиссия с подбитых ВИДИМЫХ танков (скрытого туманом врага не дымим)
    for (const u of units) {
      if (u.alive) continue
      if (u.id !== this.youUnit && u.team !== this.side && this._hiddenEnemy && this._hiddenEnemy.has(u.id)) continue
      let w = this._wreckEmit.get(u.id)
      if (!w) { w = { acc: 0 }; this._wreckEmit.set(u.id, w) }
      w.acc += dt
      if (w.acc < 0.08) continue
      w.acc = 0
      const k = this._smokeI
      // чёрный дым — столбом вверх, лёгкий снос вбок
      const sm = this.smokeGroup.children[this._smokeI]; this._smokeI = (this._smokeI + 1) % this.smokeGroup.children.length
      sm.position.set(u.x + ((k % 3) - 1) * 5, 24, u.y + ((k % 2) - 0.5) * 6)
      sm.scale.setScalar(11 + (k % 4) * 3)
      sm._vy = 34 + (k % 5) * 3
      sm.material.color.setHex((k % 4) ? 0x171717 : 0x2c2c2c)
      sm.material.opacity = 0.72; sm.visible = true
      // огонь — у основания, мерцает (реже дыма)
      if (k % 2 === 0) {
        const fi = this._fireI
        const fr = this.fireGroup.children[this._fireI]; this._fireI = (this._fireI + 1) % this.fireGroup.children.length
        fr.position.set(u.x + ((fi % 3) - 1) * 4, 11, u.y + ((fi % 3) - 1) * 4)
        fr.scale.setScalar(9 + (fi % 3) * 3)
        fr._vy = 16
        fr.material.color.setHex((fi % 2) ? 0xff5a14 : 0xffb030)
        fr.material.opacity = 0.9; fr.visible = true
      }
    }
    // подчистка карты эмиттеров от исчезнувших юнитов
    if (this._wreckEmit.size > 24) {
      const live = new Set(units.map((u) => u.id))
      for (const id of [...this._wreckEmit.keys()]) if (!live.has(id)) this._wreckEmit.delete(id)
    }
  }

  // ники + HP-полоски: проекция 3D-точек на 2D-оверлей
  _drawOverlay(units, own) {
    const ctx = this.octx; if (!ctx) return
    const W = this.overlay.width, H = this.overlay.height, dpr = this._dpr
    ctx.clearRect(0, 0, W, H)
    ctx.textAlign = 'center'
    const v = new THREE.Vector3()
    for (const u of units) {
      if (!u.alive && u.team !== this.side) continue
      if (u.id !== this.youUnit && u.team !== this.side && this._hiddenEnemy && this._hiddenEnemy.has(u.id)) continue
      v.set(u.x, 40, u.y).project(this.camera)
      if (v.z > 1) continue
      const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H
      const isYou = u.id === this.youUnit
      const ally = u.team === this.side
      const pal = ally ? this.colors.ally : this.colors.enemy
      // ник
      ctx.font = `${13 * dpr}px 'Russo One', sans-serif`
      const name = u.name || ''
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#000'; ctx.strokeText(name, sx, sy - 14 * dpr)
      ctx.fillStyle = isYou ? '#ffd54a' : ally ? '#cfe0ff' : '#ff9a8d'
      ctx.fillText(name, sx, sy - 14 * dpr)
      // HP-бар
      const fr = Math.max(0, u.hp) / (u.maxHp || 1)
      const bw = 46 * dpr, bh = 5 * dpr
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(sx - bw / 2 - dpr, sy - 10 * dpr, bw + 2 * dpr, bh + 2 * dpr)
      const hpc = isYou ? (fr > 0.5 ? '#6fcf4a' : fr > 0.25 ? '#f2c20c' : '#ff4b33') : (ally ? '#5b9cff' : '#ff5a4a')
      ctx.fillStyle = hpc; ctx.fillRect(sx - bw / 2, sy - 9 * dpr, bw * fr, bh)
      // число HP
      ctx.font = `${11 * dpr}px 'Russo One', sans-serif`
      const hp = Math.max(0, Math.round(u.hp))
      ctx.fillStyle = '#eef2f6'; ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = '#000'
      const ht = isYou ? `${hp}/${u.maxHp || hp}` : `${hp}`
      ctx.strokeText(ht, sx, sy + 2 * dpr); ctx.fillText(ht, sx, sy + 2 * dpr)
    }
    // ПЛАВАЮЩИЕ ЦИФРЫ УРОНА (combat text) по моим выстрелам — всплывают над целью, гаснут.
    // Делают разброс урона прозрачным: пробитие = число, непробитие = число+«БРОНЯ», рикошет.
    const fl = this.floaters
    if (fl && fl.length) {
      for (const f of fl) {
        v.set(f.x, 70, f.y).project(this.camera)
        if (v.z > 1) continue
        const fx = (v.x * 0.5 + 0.5) * W
        const k = Math.min(1, f.age / 1.1)
        const fy = (-v.y * 0.5 + 0.5) * H - 16 * dpr - k * 44 * dpr // всплывает вверх по мере старения
        const alpha = f.age < 0.1 ? f.age / 0.1 : 1 - Math.max(0, (f.age - 0.6) / 0.5) // въезд + угасание
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
        let txt, col, size
        if (f.outcome === 'ricochet') { txt = t('battle.ricochet'); col = '#7fd6ff'; size = 13 }
        else if (f.outcome === 'nopen') { txt = `${f.dmg} · ${t('battle.armorShort')}`; col = '#c7cdd6'; size = 13 }
        else { txt = `${f.dmg}`; col = f.killed ? '#ffd54a' : '#fff0c4'; size = f.killed ? 23 : 18 }
        ctx.font = `${size * dpr}px 'Russo One', sans-serif`
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#000'; ctx.strokeText(txt, fx, fy)
        ctx.fillStyle = col; ctx.fillText(txt, fx, fy)
      }
      ctx.globalAlpha = 1
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf)
    clearInterval(this._inputTimer)
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    if (this._ro) try { this._ro.disconnect() } catch {}
    // GPU-партиклы: освобождаем системы + общую текстуру/материалы (WebGL-ресурсы
    // добьёт forceContextLoss ниже, но JS/текстуры чистим явно — боёв за сессию много)
    for (const pool of [this._pFlash, this._pFire, this._pSmoke, this._pSpark, this._pDust]) {
      if (pool) for (const ps of pool) try { ps.dispose() } catch {}
    }
    if (this._pDispose) for (const r of this._pDispose) try { r.dispose() } catch {}
    if (this.client) { this.client.onMessage = null; this.client.onSocketClose = null; this.client.close() }
    if (this.renderer) {
      try { this.renderer.forceContextLoss() } catch { /* ok */ } // ОСВОБОДИТЬ WebGL-контекст (dispose сам по себе не освобождает → утечка → «3D не заходит»)
      this.renderer.dispose()
      const c = this.renderer.domElement; c && c.parentNode && c.parentNode.removeChild(c)
      this.renderer = null
    }
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay)
    if (this._hud && this._hud.parentNode) this._hud.parentNode.removeChild(this._hud)
  }
}
