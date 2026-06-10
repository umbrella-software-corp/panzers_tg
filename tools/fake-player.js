// Фейковый живой игрок для теста PvP: подключается к WS, ездит кругами и
// постреливает. Использование: node tools/fake-player.js [имя] [мс жизни]
import WebSocket from 'ws'

const NAME = process.argv[2] || 'Тестовый_Враг'
const LIFE_MS = +(process.argv[3] || 120000)
const URL = process.env.WS_URL || 'ws://localhost:8080/ws'

const ws = new WebSocket(URL)
let timer = null

ws.on('open', () => {
  console.log(`[${NAME}] подключился`)
  ws.send(JSON.stringify({ type: 'join', name: NAME, tankId: 't34', tint: 0xffffff }))
})
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.type === 'init') console.log(`[${NAME}] init id=${msg.id}, ждём матч`)
  if (msg.type === 'lobby') console.log(`[${NAME}] лобби: ${msg.players.map((p) => p.name).join(', ')} (старт через ${Math.round(msg.startsIn / 100) / 10}с)`)
  if (msg.type === 'match-start') {
    console.log(`[${NAME}] МАТЧ: карта=${msg.mapId}, команда=${msg.youTeam}, юнит=${msg.youUnit}`)
    let t = 0
    timer = setInterval(() => {
      t += 0.2
      ws.send(JSON.stringify({ type: 'input', throttle: 0.7, steer: Math.sin(t * 0.6) * 0.5 }))
      if (Math.random() < 0.15) ws.send(JSON.stringify({ type: 'fire' }))
    }, 200)
  }
  if (msg.type === 'match-end') {
    console.log(`[${NAME}] конец: победитель=${msg.winner}, счёт=${msg.score.join(':')}`)
    clearInterval(timer)
    ws.close()
    process.exit(0)
  }
})
ws.on('close', () => {
  clearInterval(timer)
  console.log(`[${NAME}] отключён`)
})
ws.on('error', (e) => console.error(`[${NAME}] ошибка:`, e.message))

setTimeout(() => {
  clearInterval(timer)
  try {
    ws.close()
  } catch {}
  process.exit(0)
}, LIFE_MS)
