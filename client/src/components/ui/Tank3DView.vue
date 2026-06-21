<script setup>
// 3D-просмотр танка в ангаре (для эксперимент-режима 3D): модель сверху-спереди,
// мордой к игроку. three.js + модели берём из общего кэша NetGame3D (прогрет
// preload3D), поэтому переключение танков мгновенное.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { loadModelScene } from '../../game/NetGame3D.js'
import { drawCamoPattern } from '../../game/camo.js'
import { CAMO_BY_ID } from '../../game/meta.js'

const props = defineProps({
  url: { type: String, default: '/models/t90_opt.glb' }, // файл модели танка (см. meta.tankModelUrl)
  camo: { type: String, default: '' }, // id камуфляжа (CAMOS) — красим модель процедурно
  seed: { type: Number, default: 7 }, // зерно узора (обычно хэш tankId) — стабильно у всех клиентов
  scale: { type: Number, default: 1 }, // относительный размер по классу (meta.tankSizeScale)
})
const host = ref(null)
let THREE, renderer, scene, camera, model, raf
let disposed = false

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
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 100)
  camera.position.set(0, 4.2, 4.6); camera.lookAt(0, 0.1, 0)
  scene.add(new THREE.HemisphereLight(0xdce8f5, 0x3a3a2a, 1.25))
  const key = new THREE.DirectionalLight(0xfff1d6, 1.7); key.position.set(4, 9, 6); scene.add(key)
  await show()
  const loop = () => { raf = requestAnimationFrame(loop); if (renderer) renderer.render(scene, camera) }
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
  const src = await loadModelScene(props.url)
  if (disposed || !scene || !src) return
  if (model) { scene.remove(model); model = null }
  const m = src.clone(true)
  const box = new THREE.Box3().setFromObject(m)
  const size = new THREE.Vector3(); box.getSize(size)
  const center = new THREE.Vector3(); box.getCenter(center)
  m.position.sub(center) // центр в начало координат
  // нормализуем к опорному размеру и применяем относительный размер класса (лёгкий/тяж)
  m.scale.setScalar((3.0 / (Math.max(size.x, size.y, size.z) || 1)) * props.scale)
  applyCamo(m, props.camo, props.seed) // перекраска камуфляжем (процедурно, без PNG)
  const wrap = new THREE.Group(); wrap.add(m)
  // «мордой к игроку»: ставим модель длиной к КАМЕРЕ (ось Z). Модели от разных партий
  // ориентированы по-разному — часть смоделирована длиной по X (T-26/БТ-7) → доворот
  // на 90°. Так любая (и будущая) модель встаёт лицом к игроку. window.__FACE — доп-тюнер.
  const faceY = size.x > size.z ? -Math.PI / 2 : 0
  wrap.rotation.y = faceY + ((typeof window !== 'undefined' && window.__FACE != null) ? window.__FACE : 0)
  model = wrap; scene.add(wrap)
}

watch(() => [props.url, props.camo, props.seed, props.scale], () => show())
onBeforeUnmount(() => {
  disposed = true; cancelAnimationFrame(raf)
  if (this_ro) try { this_ro.disconnect() } catch { /* ok */ }
  if (renderer) {
    try { renderer.forceContextLoss() } catch { /* ok */ } // освобождаем WebGL-контекст (иначе утечка → 3D перестаёт создаваться)
    renderer.dispose()
    const c = renderer.domElement; c && c.parentNode && c.parentNode.removeChild(c); renderer = null
  }
})
</script>

<template>
  <div ref="host" class="tank3d"></div>
</template>

<style scoped>
.tank3d { width: 100%; height: 100%; }
</style>
