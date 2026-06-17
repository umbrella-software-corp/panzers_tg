<script setup>
// 3D-просмотр танка в ангаре (для эксперимент-режима 3D): модель сверху-спереди,
// мордой к игроку. three.js + модели берём из общего кэша NetGame3D (прогрет
// preload3D), поэтому переключение танков мгновенное.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { loadModelScenes } from '../../game/NetGame3D.js'

const props = defineProps({ index: { type: Number, default: 0 } })
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
  await show(props.index)
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

async function show(i) {
  const scenes = await loadModelScenes()
  if (disposed || !scene || !scenes[i]) return
  if (model) { scene.remove(model); model = null }
  const m = scenes[i].clone(true)
  const box = new THREE.Box3().setFromObject(m)
  const size = new THREE.Vector3(); box.getSize(size)
  const center = new THREE.Vector3(); box.getCenter(center)
  m.position.sub(center) // центр в начало координат
  m.scale.setScalar(3.0 / (Math.max(size.x, size.y, size.z) || 1))
  const wrap = new THREE.Group(); wrap.add(m)
  // мордой к игроку (ствол на камеру); правится живьём window.__FACE
  wrap.rotation.y = (typeof window !== 'undefined' && window.__FACE != null) ? window.__FACE : 0
  model = wrap; scene.add(wrap)
}

watch(() => props.index, (i) => show(i))
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
