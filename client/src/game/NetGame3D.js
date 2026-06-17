// 3D-рендер боя на Three.js. НАСЛЕДУЕТ всю сеть/ввод/предикт/события/HUD-state
// от NetGame (Battle.vue и серверный протокол не меняются) — переопределяет
// только визуальный слой: mount/_draw/_spawnFx/_wantTex/destroy.
//
// Координаты: мир сервера (x,y) в пикселях карты → THREE (x, высота, y).
// Камера player-relative сверху (свой танк всегда едет «от тебя» → честность
// засвета как в 2D). Все живые тюнеры — window.__CAM_*/__YAW3 в консоли превью.
import { NetGame } from './NetGame.js'

// three.js грузится ДИНАМИЧЕСКИ (только когда тестер реально входит в 3D-бой) —
// иначе ~150КБ gzip висели бы в главном бандле у всех 2D-игроков (96% трафика).
// Модульные THREE/GLTFLoader/MeshoptDecoder заполняются в ensureThree() до mount.
let THREE, GLTFLoader, MeshoptDecoder
async function ensureThree() {
  if (THREE) return
  THREE = await import('three')
  ;({ GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'))
  ;({ MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js'))
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
// прогрев three.js + моделей заранее (ангар зовёт при включённом 3D-тоггле)
export function preload3D() { try { loadModelScenes() } catch { /* ничего */ } }

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
    this.tankGroups = new Map() // unitId -> { group, holder, ring }
    this.models = [] // шаблоны GLB (клонируем на каждый танк)

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
    const sky = 0x141a12
    scene.background = new THREE.Color(sky)
    scene.fog = new THREE.Fog(sky, this.mapSize * 0.42, this.mapSize * 0.85)
    this.scene = scene

    this.camera = new THREE.PerspectiveCamera(46, W / H, 1, this.mapSize * 3)

    scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x45482f, 1.05))
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.7)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sh = sun.shadow.camera
    sh.near = 50; sh.far = this.mapSize * 2; sh.left = -700; sh.right = 700; sh.top = 700; sh.bottom = -700
    sun.shadow.bias = -0.0005
    scene.add(sun); this.sun = sun
    this.sunTarget = new THREE.Object3D(); scene.add(this.sunTarget); sun.target = this.sunTarget

    this._buildGround()
    this._buildStatic()

    // эффекты: пулы трассеров-стриков + вспышек/взрывов (объёмные меши, видны)
    this.fxGroup = new THREE.Group(); scene.add(this.fxGroup)
    this.tracerGroup = new THREE.Group(); scene.add(this.tracerGroup)

    // СЛЕДЫ ГУСЕНИЦ (ring-buffer плоских меток на земле) + ПЫЛЬ из-под танка
    // (ring-buffer пуфов). Оба пула ограничены → перф предсказуем. Эмиссия по
    // пройденному расстоянию (см. _dustTracks); на LOW пыль не эмитим.
    this.trackGroup = new THREE.Group(); scene.add(this.trackGroup)
    this.dustGroup = new THREE.Group(); scene.add(this.dustGroup)
    const trackGeo = new THREE.BoxGeometry(30, 1, 24)
    for (let i = 0; i < 140; i++) { const m = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({ color: 0x2a2417, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; this.trackGroup.add(m) }
    const dustGeo = new THREE.SphereGeometry(1, 8, 6)
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: 0xb8a87e, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; m._vy = 0; this.dustGroup.add(m) }
    this._trackI = 0; this._dustI = 0; this._tankMove = new Map()

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
    this.aimReticle = this._mkGroundRing(22, 27, 0xffe066, 1)
    this.aimReticle.position.y = 6; this.aimReticle.renderOrder = 4; scene.add(this.aimReticle)

    // применяем стартовое качество (pixelRatio/тени/туман-меш/блоб-тени)
    this._applyQuality(this._quality)

    // FPS-HUD (тестерам): текущий FPS + уровень качества; по нему выставим пороги
    const hud = document.createElement('div')
    hud.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:6;font:11px/1.3 monospace;color:#8ee06a;background:rgba(0,0,0,.45);padding:2px 6px;border-radius:5px;pointer-events:none'
    container.appendChild(hud); this._hud = hud; this._updateHud()

    // модели танков — из общего кэша (мог быть прогрет preload3D во время матчмейкинга);
    // клонируем перед нормализацией (кэш хранит исходные сцены, нормализация мутирует)
    loadModelScenes().then((scenes) => {
      scenes.forEach((sc, i) => { if (sc && this.scene) { this.models[i] = this._normalizeModel(sc.clone(true)); this._reskinTanks(i) } })
    }).catch((e) => console.warn('[3d] модели не загрузились', e))

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
  _buildGround() {
    const th = this.map.theme || {}
    const geo = new THREE.PlaneGeometry(this.mapSize, this.mapSize)
    const mat = new THREE.MeshStandardMaterial({ color: th.ground || 0x4f5a2c, roughness: 1 })
    const g = new THREE.Mesh(geo, mat)
    g.rotation.x = -Math.PI / 2
    g.position.set(this.mapSize / 2, 0, this.mapSize / 2)
    g.receiveShadow = true
    this.scene.add(g)
    const grid = new THREE.GridHelper(this.mapSize, 28, 0x39431f, 0x39431f)
    grid.material.opacity = 0.12; grid.material.transparent = true
    grid.position.set(this.mapSize / 2, 0.5, this.mapSize / 2)
    this.scene.add(grid)
  }

  _buildStatic() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 1, flatShading: true })
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1, flatShading: true })
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x6b5436, roughness: 0.9 })
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x47502a, roughness: 1 })
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x236a86, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.9 })
    this.bushMeshes = []
    for (const o of this.obstacles) {
      let m
      if (o.kind === 'rock') { m = new THREE.Mesh(new THREE.IcosahedronGeometry(o.r, 0), rockMat); m.scale.y = 0.7; m.position.set(o.x, o.r * 0.4, o.y) }
      else if (o.kind === 'bush') { m = new THREE.Mesh(new THREE.SphereGeometry(o.r, 10, 8), bushMat.clone()); m.material.transparent = true; m.scale.y = 0.7; m.position.set(o.x, o.r * 0.5, o.y); this.bushMeshes.push({ m, x: o.x, y: o.y, r: o.r }) }
      else if (o.kind === 'box') { m = new THREE.Mesh(new THREE.BoxGeometry(o.r * 1.6, o.r * 1.4, o.r * 1.6), boxMat); m.position.set(o.x, o.r * 0.7, o.y) }
      else if (o.kind === 'hill') { m = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.05, o.r * 0.35, 24), hillMat); m.position.set(o.x, o.r * 0.17, o.y) }
      else if (o.kind === 'water') { m = new THREE.Mesh(new THREE.CircleGeometry(o.r, 28), waterMat); m.rotation.x = -Math.PI / 2; m.position.set(o.x, 1, o.y) }
      if (m) { if (o.kind !== 'water') { m.castShadow = true; m.receiveShadow = true } this.scene.add(m) }
    }
    // здания — 3D-коробки
    const bMat = new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.85 })
    for (const w of this.walls) {
      const Hh = Math.max(40, Math.min(Math.min(w.hw, w.hh) * 1.3, 120))
      const b = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2, Hh, w.hh * 2), bMat)
      b.position.set(w.cx, Hh / 2, w.cy); b.castShadow = true; b.receiveShadow = true
      this.scene.add(b)
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
    const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48), new THREE.MeshBasicMaterial({ color: 0x9aa6b2, transparent: true, opacity: 0.1, depthWrite: false }))
    disc.rotation.x = -Math.PI / 2; disc.position.y = 1.5
    const fill = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }))
    fill.rotation.x = -Math.PI / 2; fill.position.y = 2; fill.scale.setScalar(0.001)
    const ring = this._mkGroundRing(p.r - 5, p.r, 0x9aa6b2, 0.7); ring.position.y = 3
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 110, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x9aa6b2, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.y = 55
    g.add(disc, fill, ring, beam); this.scene.add(g)
    return { g, disc, fill, ring, beam, r: p.r }
  }

  // нормализация GLB: центр по XZ, основание на y=0, масштаб по длине, тени
  _normalizeModel(model) {
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    model.position.x -= center.x; model.position.z -= center.z; model.position.y -= box.min.y
    const longest = Math.max(size.x, size.z) || 1
    model.scale.setScalar(TANK_LEN / longest)
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    const wrap = new THREE.Group(); wrap.add(model)
    return wrap
  }

  _modelIndexFor(u, isSelf) {
    if (TANK_MODEL[u.tankId] != null) return TANK_MODEL[u.tankId] // T-90/Leopard/Abrams — своя модель
    return isSelf ? 0 : (hashId(u.tankId || u.id) % 3)
  }

  // подменить плейсхолдеры реальной моделью i у уже созданных танков
  _reskinTanks(i) {
    for (const [id, t] of this.tankGroups) {
      if (t.mi === i && this.models[i]) {
        t.holder.clear()
        t.holder.add(this.models[i].clone(true))
        t.placeholder = false
      }
    }
  }

  _tankGroup(u, isSelf) {
    let t = this.tankGroups.get(u.id)
    if (t) return t
    const group = new THREE.Group()
    const holder = new THREE.Group(); group.add(holder)
    const mi = this._modelIndexFor(u, isSelf)
    if (this.models[mi]) { holder.add(this.models[mi].clone(true)) }
    else { // плейсхолдер-бокс пока модель грузится
      const m = new THREE.Mesh(new THREE.BoxGeometry(TANK_LEN * 0.55, 26, TANK_LEN), new THREE.MeshStandardMaterial({ color: isSelf ? 0xe0a52a : 0x7a7d72 }))
      m.position.y = 16; m.castShadow = true; holder.add(m)
    }
    // командное кольцо под танком
    const ringCol = isSelf ? 0xf2d24a : (u.team === this.side ? this.colors.ally : this.colors.enemy).hp
    const ring = this._mkGroundRing(37, 42, ringCol, 0.82); ring.position.y = 2; group.add(ring)
    // блоб-тень (дешёвая) — видна, когда реальные тени выключены на LOW
    const blob = new THREE.Mesh(new THREE.CircleGeometry(36, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }))
    blob.rotation.x = -Math.PI / 2; blob.position.y = 1; blob.visible = !!this._blobOn; group.add(blob)
    this.scene.add(group)
    t = { group, holder, ring, blob, mi, placeholder: !this.models[mi] }
    this.tankGroups.set(u.id, t)
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
        b.m.material.opacity += (tgt - b.m.material.opacity) * 0.2
      }
    }

    // точки захвата — цвет владельца + диск прогресса захвата (в цвете захватчика)
    const caps = this.cur ? this.cur.caps : []
    for (const cap of caps || []) {
      const c = this.capRings[cap.id]; if (!c) continue
      const owner = cap.owner === this.side ? this.colors.ally.hp : cap.owner != null ? this.colors.enemy.hp : 0x9aa6b2
      c.ring.material.color.setHex(owner); c.disc.material.color.setHex(owner); c.beam.material.color.setHex(owner)
      const capper = cap.capper === this.side ? this.colors.ally.hp : cap.capper != null ? this.colors.enemy.hp : owner
      const p = Math.max(0, Math.min(1, cap.p || 0))
      c.fill.material.color.setHex(capper)
      c.fill.scale.setScalar(p > 0.01 ? p : 0.001)
    }

    this._drawAim(own, vis, oh, ox, oy)
    this._drawFx()
    const nowD = performance.now()
    const ddt = Math.min(0.05, (nowD - (this._lastDrawT || nowD)) / 1000); this._lastDrawT = nowD
    this._dustTracks(units, ddt)

    // КАМЕРА: player-relative сверху (свой едет «от тебя»)
    const dist = (typeof window !== 'undefined' && window.__CAM_DIST) || 300
    const height = (typeof window !== 'undefined' && window.__CAM_H) || 560
    const ahead = (typeof window !== 'undefined' && window.__CAM_AHEAD) || 170
    const fx = Math.cos(oh), fz = Math.sin(oh)
    this.camera.position.set(ox - fx * dist, height, oy - fz * dist)
    this.camera.lookAt(ox + fx * ahead, 0, oy + fz * ahead)
    this.sunTarget.position.set(ox, 0, oy)
    this.sun.position.set(ox + 350, 600, oy + 200)

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

  // трассеры + вспышки + взрывы (данные ведёт super._update в this.shells/muzzles/booms)
  _drawFx() {
    // ТРАССЕРЫ — яркие объёмные стрики (бокс вдоль траектории), хорошо видны
    const tg = this.tracerGroup
    while (tg.children.length < this.shells.length) {
      tg.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 1), new THREE.MeshBasicMaterial({ color: TRACER_COLOR, transparent: true })))
    }
    let ti = 0
    const BARREL = 46 // вынос дула вперёд от центра танка → выстрел «из ствола», не из центра
    for (const s of this.shells) {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      const bx1 = s.x1 + Math.cos(a) * BARREL, by1 = s.y1 + Math.sin(a) * BARREL // точка дула
      const k = s.t / s.dur
      const sx = bx1 + (s.x2 - bx1) * k, sy = by1 + (s.y2 - by1) * k
      const L = 40
      const m = tg.children[ti++]; m.visible = true
      m.position.set(sx - Math.cos(a) * L / 2, 20, sy - Math.sin(a) * L / 2)
      m.rotation.y = Math.PI / 2 - a
      m.scale.z = L
      m.material.opacity = 0.95 // цвет единый (TRACER_COLOR), задан в материале
    }
    for (let i = ti; i < tg.children.length; i++) tg.children[i].visible = false

    // вспышки/взрывы — пул сфер в fxGroup
    const need = this.muzzles.length + this.booms.length
    while (this.fxGroup.children.length < need) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ transparent: true }))
      this.fxGroup.add(m)
    }
    let idx = 0
    for (const m of this.muzzles) {
      const sp = this.fxGroup.children[idx++]; sp.visible = true
      const k = Math.max(0, 1 - m.age / 0.09)
      sp.position.set(m.x, 18, m.y); sp.scale.setScalar(10 + 14 * k)
      sp.material.color.setHex(0xffe6a0); sp.material.opacity = 0.85 * k
    }
    for (const bm of this.booms) {
      const sp = this.fxGroup.children[idx++]; sp.visible = true
      const life = bm.big ? 0.7 : 0.45
      const k = Math.max(0, 1 - bm.age / life)
      sp.position.set(bm.x, 16, bm.y)
      sp.scale.setScalar((bm.big ? 46 : bm.dust ? 20 : 30) * (1.1 - k))
      sp.material.color.setHex(bm.big ? 0xff7a2a : bm.dust ? 0x9a8a6a : 0xffb24a)
      sp.material.opacity = 0.7 * k
    }
    for (let i = idx; i < this.fxGroup.children.length; i++) this.fxGroup.children[i].visible = false
  }

  // следы гусениц + пыль из-под едущих танков (эмиссия по пройденному пути)
  _dustTracks(units, dt) {
    // затухание следов
    for (const m of this.trackGroup.children) {
      if (m.material.opacity > 0) { m.material.opacity -= dt * 0.13; if (m.material.opacity <= 0.002) { m.material.opacity = 0; m.visible = false } }
    }
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
      mv.acc += moved; mv.accD += moved
      const dir = u.hull
      if (mv.acc >= 22) { // метка следа под кормой
        mv.acc = 0
        const tm = this.trackGroup.children[this._trackI]; this._trackI = (this._trackI + 1) % this.trackGroup.children.length
        tm.position.set(u.x - Math.cos(dir) * 22, 1.2, u.y - Math.sin(dir) * 22)
        tm.rotation.y = Math.PI / 2 - dir
        tm.material.opacity = 0.5; tm.visible = true
      }
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
  }

  destroy() {
    cancelAnimationFrame(this._raf)
    clearInterval(this._inputTimer)
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    if (this._ro) try { this._ro.disconnect() } catch {}
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
