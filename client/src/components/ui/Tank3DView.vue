<script setup>
// 3D-просмотр танка в ангаре (для эксперимент-режима 3D): модель сверху-спереди,
// мордой к игроку. three.js + модели берём из общего кэша NetGame3D (прогрет
// preload3D), поэтому переключение танков мгновенное.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { loadModelScene } from '../../game/NetGame3D.js'
import { drawCamoPattern } from '../../game/camo.js'
import { CAMO_BY_ID, NATION_MODEL_URL, modelNeedsFlip } from '../../game/meta.js'

const props = defineProps({
  url: { type: String, default: '/models/t90_opt.glb' }, // файл модели танка (см. meta.tankModelUrl)
  camo: { type: String, default: '' }, // id камуфляжа (CAMOS) — красим модель процедурно
  seed: { type: Number, default: 7 }, // зерно узора (обычно хэш tankId) — стабильно у всех клиентов
  scale: { type: Number, default: 1 }, // относительный размер по классу (meta.tankSizeScale)
})
// 'drag' — был реальный поворот пальцем (а не тап). Hangar глушит по нему навигацию
// в Ангар (иначе @click по сцене уводил на вкладку и танк «не крутился»).
const emit = defineEmits(['drag'])
const host = ref(null)
const loading = ref(true) // показываем «загрузка модели…» пока GLB не отрисован (платформа не выглядит пустой)
let THREE, renderer, scene, camera, model, raf
let disposed = false
// ВРАЩЕНИЕ ПАЛЬЦЕМ (turntable): baseRotY — ориентация «лицом к игроку» из show();
// поверх — пользовательский доворот dragY (горизонталь) + наклон dragX (вертикаль) + инерция velY.
let baseRotY = 0
let dragY = 0, dragX = 0, velY = 0
let dragging = false, lastPX = 0, lastPY = 0

onMounted(async () => {
  THREE = await import('three')
  if (disposed || !host.value) return
  const W = host.value.clientWidth || 300
  const H = host.value.clientHeight || 280
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(W, H)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.value.appendChild(renderer.domElement)
  // ВРАЩЕНИЕ — ЖЕЛЕЗОБЕТОННО: вешаем TOUCH+MOUSE на WINDOW в CAPTURE-фазе и гейтим по зоне канвы
  // (inCanvas). Так касание ловится, ДАЖЕ если поверх канвы лежит невидимый оверлей/скрим/рамка
  // (которые перехватывали клик и танк «не крутился» на реальном устройстве, хотя в превью —
  // синтетика прямо на канву — крутился). Capture = срабатывает ДО любого обработчика-перехватчика.
  renderer.domElement.style.touchAction = 'none'
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: false })
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
  window.addEventListener('touchend', onTouchEnd, true)
  window.addEventListener('touchcancel', onTouchEnd, true)
  window.addEventListener('mousedown', onMouseDown, true)
  window.addEventListener('mousemove', onMouseMove, true)
  window.addEventListener('mouseup', onMouseUp, true)
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 100)
  camera.position.set(0, 4.2, 4.6); camera.lookAt(0, 0.1, 0)
  scene.add(new THREE.HemisphereLight(0xdce8f5, 0x3a3a2a, 1.25))
  const key = new THREE.DirectionalLight(0xfff1d6, 1.7); key.position.set(4, 9, 6); scene.add(key)
  await show()
  const loop = () => {
    raf = requestAnimationFrame(loop)
    if (!renderer) return
    if (!dragging && Math.abs(velY) > 0.0002) { dragY += velY; velY *= 0.93 } // инерция после отпускания
    if (model) { model.rotation.y = baseRotY + dragY; model.rotation.x = dragX }
    renderer.render(scene, camera)
  }
  loop()
  this_ro = new ResizeObserver(() => resize()); this_ro.observe(host.value)
})

let this_ro
function resize() {
  if (!renderer || !host.value) return
  const W = host.value.clientWidth, H = host.value.clientHeight
  if (!W || !H) return
  renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix()
}

// процедурный камуфляж: тот же генератор узора, что печёт 2D-спрайты (camo.js),
// рисует CanvasTexture и кладёт её на материалы GLB-модели. Никаких PNG.
function camoTexture(id, seed) {
  const def = CAMO_BY_ID[id]
  if (!def || !def.pattern || !THREE) return null // '' (заводская)/неизвестный → без камо
  const S = 512
  const cv = document.createElement('canvas'); cv.width = cv.height = S
  drawCamoPattern(cv.getContext('2d'), S, def.pattern, seed)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2.2, 2.2)
  tex.needsUpdate = true
  return tex
}
function applyCamo(root, id, seed) {
  const tex = camoTexture(id, seed)
  if (!tex) return // заводская окраска — оставляем исходные материалы модели
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return
    o.material = o.material.clone() // не мутируем общий кэш сцен
    o.material.map = tex
    if (o.material.color) o.material.color.set(0xffffff) // показать истинные цвета узора
    if ('metalness' in o.material) o.material.metalness = 0.1
    if ('roughness' in o.material) o.material.roughness = 0.85
    o.material.needsUpdate = true
  })
}

async function show() {
  loading.value = true
  let src = await loadModelScene(props.url)
  if (disposed || !scene) return
  // модель не загрузилась (сбой сети) → фоллбэк на базовую модель, чтобы платформа не
  // осталась пустой (props.url и так уже резолвится на модель нации/Т-90 при отсутствии своей)
  if (!src) {
    const fb = NATION_MODEL_URL.ussr
    if (props.url !== fb) src = await loadModelScene(fb)
    if (disposed || !scene || !src) { loading.value = false; return } // совсем не вышло — снимаем индикатор
  }
  if (model) { scene.remove(model); model = null }
  const m = src.clone(true)
  const box = new THREE.Box3().setFromObject(m)
  const size = new THREE.Vector3(); box.getSize(size)
  const center = new THREE.Vector3(); box.getCenter(center)
  m.position.sub(center) // центр в начало координат
  // РАЗМЕР = опорная база × относительный размер танка (props.scale = tankSizeScale = реальная
  // длина корпуса / SIZE_REF). Камера ФИКСИРОВАНА → у каждого танка СВОЙ видимый размер: лёгкий
  // мелкий, тяж крупный (фидбек «у каждого свой размер»). База 3.0 (НЕ уменьшаем — «не меньше»).
  m.scale.setScalar((3.0 / (Math.max(size.x, size.y, size.z) || 1)) * props.scale)
  applyCamo(m, props.camo, props.seed) // перекраска камуфляжем (процедурно, без PNG)
  const wrap = new THREE.Group(); wrap.add(m)
  // «мордой к игроку»: ставим модель длиной к КАМЕРЕ (ось Z). Модели от разных партий
  // ориентированы по-разному — часть смоделирована длиной по X (T-26/БТ-7) → доворот
  // на 90°. Так любая (и будущая) модель встаёт лицом к игроку. window.__FACE — доп-тюнер.
  const faceY = size.x > size.z ? -Math.PI / 2 : 0
  const flipY = modelNeedsFlip(props.url) ? Math.PI : 0 // модели «задом» (MODEL_FLIP) → лицом к игроку
  baseRotY = faceY + flipY + ((typeof window !== 'undefined' && window.__FACE != null) ? window.__FACE : 0)
  dragY = 0; dragX = 0; velY = 0 // новый танк — снова лицом к игроку (можно покрутить)
  wrap.rotation.y = baseRotY
  model = wrap; scene.add(wrap)
  loading.value = false // модель в сцене → убираем индикатор загрузки
}

// DRAG-TO-ROTATE: горизонталь крутит танк (Y), вертикаль — лёгкий наклон (X, ограничен,
// не переворачиваем). Инерция после отпускания (см. loop). touch-action:none — палец на
// танке вращает, а не скроллит страницу.
let moved = 0 // суммарный путь пальца за жест — отличаем поворот от тапа
// общая логика драга (вызывается из touch И mouse — координаты экрана x,y)
function dragStart(x, y) { dragging = true; velY = 0; moved = 0; lastPX = x; lastPY = y }
function dragMove(x, y) {
  if (!dragging) return
  const dx = x - lastPX, dy = y - lastPY
  lastPX = x; lastPY = y
  moved += Math.abs(dx) + Math.abs(dy)
  if (moved > 6) emit('drag') // порог: явный поворот, а не дрожь пальца на тапе
  dragY += dx * 0.011
  velY = Math.max(-0.3, Math.min(0.3, dx * 0.011)) // кап скорости флика (не разгоняем бесконечно)
  dragX = Math.max(-0.3, Math.min(0.5, dragX + dy * 0.006)) // наклон ограничен (взгляд чуть сверху/сбоку)
}
function dragEnd() { dragging = false }
// касание/курсор в ЗОНЕ канвы? (window-listener ловит весь экран — крутим только над танком)
function inCanvas(x, y) {
  if (!renderer || !renderer.domElement) return false
  const r = renderer.domElement.getBoundingClientRect()
  return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}
// TOUCH (мобайл — главный путь; window+capture, гейт по зоне канвы)
function onTouchStart(e) { const t = e.touches[0]; if (t && inCanvas(t.clientX, t.clientY)) dragStart(t.clientX, t.clientY) }
function onTouchMove(e) {
  const t = e.touches[0]
  if (!dragging || !t) return
  if (e.cancelable) e.preventDefault() // глушим скролл страницы под пальцем на танке
  dragMove(t.clientX, t.clientY)
}
function onTouchEnd() { dragEnd() }
// MOUSE (десктоп)
function onMouseDown(e) { if (inCanvas(e.clientX, e.clientY)) dragStart(e.clientX, e.clientY) }
function onMouseMove(e) { if (dragging) dragMove(e.clientX, e.clientY) }
function onMouseUp() { dragEnd() }

watch(() => [props.url, props.camo, props.seed, props.scale], () => show())
onBeforeUnmount(() => {
  disposed = true; cancelAnimationFrame(raf)
  try {
    window.removeEventListener('touchstart', onTouchStart, { capture: true })
    window.removeEventListener('touchmove', onTouchMove, { capture: true })
    window.removeEventListener('touchend', onTouchEnd, true)
    window.removeEventListener('touchcancel', onTouchEnd, true)
    window.removeEventListener('mousedown', onMouseDown, true)
    window.removeEventListener('mousemove', onMouseMove, true)
    window.removeEventListener('mouseup', onMouseUp, true)
  } catch { /* ok */ }
  if (this_ro) try { this_ro.disconnect() } catch { /* ok */ }
  if (renderer) {
    try { renderer.forceContextLoss() } catch { /* ok */ } // освобождаем WebGL-контекст (иначе утечка → 3D перестаёт создаваться)
    renderer.dispose()
    const c = renderer.domElement; c && c.parentNode && c.parentNode.removeChild(c); renderer = null
  }
})
</script>

<template>
  <!-- обработчики вращения навешены ПРЯМО на канву в onMounted (addEventListener,
       passive:false) — надёжнее на iOS, чем @pointer на host через bubbling -->
  <div ref="host" class="tank3d">
    <div v-if="loading" class="tank3d-load"><span class="tank3d-spin"></span>загрузка модели…</div>
  </div>
</template>

<style scoped>
.tank3d { width: 100%; height: 100%; position: relative; touch-action: none; cursor: grab; }
.tank3d:active { cursor: grabbing; }
.tank3d-load {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px;
  color: var(--ink-dim, #9aa6b2); font-size: 13px; font-weight: 600; letter-spacing: 0.3px; pointer-events: none;
}
.tank3d-spin {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid rgba(242, 165, 12, 0.25); border-top-color: #f2a50c;
  animation: tank3d-spin 0.8s linear infinite;
}
@keyframes tank3d-spin { to { transform: rotate(360deg); } }
</style>
