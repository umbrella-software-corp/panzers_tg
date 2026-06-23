// DEV-ОНЛИ стенд карт. Поднимает НАСТОЯЩИЙ NetGame3D (тот же рендер, что в бою) со
// стаб-клиентом без вебсокета: снапшотов нет → танков нет, но вся СТАТИКА мира
// (земля/небо/свет/туман/препятствия/пропы) строится и рисуется как в реальном бою.
// Запуск: vite dev → /map3d.html?map=winter  (h/d/a — высота/дальность/упреждение камеры)
import { NetGame3D } from '../game/NetGame3D.js'
import { MAPS } from '../game/maps.js'

const params = new URLSearchParams(location.search)
const mapId = params.get('map') || 'polygon'

// «Героический» обзор для скриншота (дальше/выше боевой камеры). Крутится из консоли.
window.__CAM_H = +params.get('h') || 860
window.__CAM_DIST = +params.get('d') || 540
window.__CAM_AHEAD = +params.get('a') || 420

// Стаб боевого клиента: ничего не шлёт/не принимает, но имеет API, которое читает
// конструктор NetGame (send/close + присваиваемые onMessage/onSocketClose).
const stub = {
  send() {}, close() {}, reconnect: null,
  lastState: null, lastEnd: null, stateQueue: [], ping: null,
  onMessage: null, onSocketClose: null,
}

const root = document.getElementById('stage')
const game = new NetGame3D({ client: stub, mapId, side: 0, youUnit: null, mode: 'capture' })
game.mount(root)
window.__game = game // для ручной отладки в консоли

// Панель переключения карт
const bar = document.getElementById('bar')
for (const m of MAPS) {
  const a = document.createElement('a')
  a.href = `?map=${m.id}`
  a.textContent = m.name
  if (m.id === mapId) a.className = 'on'
  bar.appendChild(a)
}
