// Сетевой клиент PvP: подключение к WS-серверу, лобби и матч.
// URL: VITE_WS_URL → из VITE_API_URL (https→wss) → dev-хост :8080.
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws') + '/ws'
    : `ws://${location.hostname}:8080/ws`)

/**
 * Подключение к поиску боя. Резолвится клиентом после init от сервера;
 * реджектится по таймауту/ошибке — вызывающий уходит в офлайн-бой с ботами.
 * onLobby({players, you, startsIn}) — обновления комнаты ожидания,
 * onStart(msg match-start) — бой начался, onClose — соединение закрылось.
 */
export function connectMatch({ name, tankId, tint, skin, stats, onLobby, onStart, onClose }, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let ws
    try {
      ws = new WebSocket(WS_URL)
    } catch (e) {
      return reject(e)
    }
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try {
          ws.close()
        } catch {
          /* уже закрыт */
        }
        reject(new Error('ws timeout'))
      }
    }, timeoutMs)

    const client = {
      ws,
      youId: null,
      started: false,
      onMessage: null, // подписка NetGame на время боя
      send(msg) {
        if (ws.readyState === 1) ws.send(JSON.stringify(msg))
      },
      close() {
        try {
          ws.close()
        } catch {
          /* ок */
        }
      },
    }

    ws.onopen = () => client.send({ type: 'join', name, tankId, tint, skin, stats })
    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type === 'init') {
        client.youId = msg.id
        client.waitMs = msg.waitMs
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(client)
        }
      } else if (msg.type === 'lobby') {
        onLobby && onLobby(msg)
      } else if (msg.type === 'match-start') {
        client.started = true
        onStart && onStart(msg)
      } else if (client.onMessage) {
        client.onMessage(msg)
      }
    }
    ws.onerror = () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error('ws error'))
      }
    }
    ws.onclose = () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error('ws closed'))
      }
      onClose && onClose()
    }
  })
}
