// DEV-ОНЛИ вьювер одного GLB-пропа (для оценки сгенерированных моделей окружения).
// /glb.html?f=/_gen/tree.glb   (s=масштаб поворота, авто-турнтейбл)
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const params = new URLSearchParams(location.search)
const file = params.get('f') || '/models/prop_tree.glb'
document.getElementById('lbl').textContent = file

const root = document.getElementById('stage')
const W = root.clientWidth, H = root.clientHeight
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(W, H); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap
root.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x20242a)
const cam = new THREE.PerspectiveCamera(40, W / H, 0.01, 100)
cam.position.set(2.4, 1.8, 2.8)
cam.lookAt(0, 0.5, 0)

scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x40443a, 1.1))
const sun = new THREE.DirectionalLight(0xfff1d6, 2.0)
sun.position.set(3, 5, 2); sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
scene.add(sun)
// земля-подложка
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: 0x3a3f33, roughness: 1 }))
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
const grid = new THREE.GridHelper(6, 12, 0x556, 0x445); grid.position.y = 0.001; scene.add(grid)

const holder = new THREE.Group(); scene.add(holder)
new GLTFLoader().load(file, (g) => {
  const m = g.scene
  const box = new THREE.Box3().setFromObject(m)
  const size = new THREE.Vector3(); box.getSize(size)
  const center = new THREE.Vector3(); box.getCenter(center)
  const s = 1.6 / (Math.max(size.x, size.y, size.z) || 1)
  m.scale.setScalar(s)
  m.position.set(-center.x * s, -box.min.y * s, -center.z * s)
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  holder.add(m)
}, undefined, (e) => { document.getElementById('lbl').textContent = 'ОШИБКА: ' + file })

let t = 0
function loop() { requestAnimationFrame(loop); t += 0.008; holder.rotation.y = t; renderer.render(scene, cam) }
loop()
