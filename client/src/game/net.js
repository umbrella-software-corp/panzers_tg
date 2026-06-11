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
export function connectMatch({ name, tankId, tint, skin, stats, battles, party, mode, onLobby, onStart, onClose }, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let ws
    // в query: токен взвода (сервер сводит друзей в одну комнату) и режим боя
    // (захват/уничтожение — чужие режимы в разные комнаты)
    const qs = []
    if (party) qs.push(`party=${encodeURIComponent(party)}`)
    if (mode === 'annihilation') qs.push('mode=annihilation')
    const url = qs.length ? `${WS_URL}?${qs.join('&')}` : WS_URL
    try {
      ws = new WebSocket(url)
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

    // диагностика онлайн-старта: следим, где встаёт поток (фриз на 0:00 у части
    // клиентов). Логи лёгкие — только вехи + первый снапшот, не 20Гц.
    const log = (...a) => console.log('[net]', ...a)
    ws.onopen = () => {
      log('ws открыт →', WS_URL)
      client.send({ type: 'join', name, tankId, tint, skin, stats, battles })
    }
    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type === 'state') {
        client.stateN = (client.stateN || 0) + 1
        client.lastState = msg // буфер: NetGame подпишется позже и сразу проиграет его
        if (client.stateN === 1) log('первый снапшот state получен (t=' + msg.t + ', подписчик ' + (client.onMessage ? 'есть' : 'ещё нет') + ')')
      }
      if (msg.type === 'init') {
        client.youId = msg.id
        client.waitMs = msg.waitMs
        log('init получен, id=' + msg.id + ', waitMs=' + msg.waitMs)
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(client)
        }
      } else if (msg.type === 'lobby') {
        onLobby && onLobby(msg)
      } else if (msg.type === 'match-start') {
        client.started = true
        log('match-start получен (youUnit=' + msg.youUnit + ', map=' + msg.mapId + ')')
        onStart && onStart(msg)
      } else if (client.onMessage) {
        client.onMessage(msg)
      }
    }
    ws.onerror = () => {
      log('ws ОШИБКА (settled=' + settled + ', снапшотов=' + (client.stateN || 0) + ')')
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error('ws error'))
      }
    }
    ws.onclose = (e) => {
      log('ws ЗАКРЫТ code=' + e.code + ' clean=' + e.wasClean + ' (снапшотов было ' + (client.stateN || 0) + ', started=' + client.started + ')')
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error('ws closed'))
      }
      onClose && onClose()
    }
  })
}
