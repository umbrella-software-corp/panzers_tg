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
export function connectMatch({ name, tankId, tier, tint, skin, stats, battles, party, mode, uid, training, onLobby, onStart, onClose }, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let ws
    // в query: токен взвода (сервер сводит друзей в одну комнату) и режим боя
    // (захват/уничтожение — чужие режимы в разные комнаты). training=1 — отдельная
    // тренировочная комната (соло + замороженные боты) для самого первого боя.
    const qs = []
    if (party) qs.push(`party=${encodeURIComponent(party)}`)
    if (mode === 'annihilation') qs.push('mode=annihilation')
    if (training) qs.push('training=1')
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

    // диагностика онлайн-старта: следим, где встаёт поток (фриз на 0:00 у части
    // клиентов). Логи лёгкие — только вехи + первый снапшот, не 20Гц.
    const log = (...a) => console.log('[net]', ...a)

    const client = {
      ws, // АКТИВНЫЙ сокет; после реконнекта указывает на новый
      youId: null,
      started: false,
      roomId: null, // для реконнекта: куда возвращаться
      youUnit: null, // свой юнит (возврат именно за него)
      rkey: null, // токен возврата в этот бой
      ping: null, // RTT в мс (ping↔pong, сервер эхо-понгит ts); null = ещё не измерен
      _pingTimer: null,
      stateQueue: [], // ВСЕ принятые снапшоты (NetGame сливает очередь каждый кадр);
      // на мобиле снапшоты приходят бурстами — одиночный lastState терял промежуточные
      onMessage: null, // подписка NetGame на время боя
      onSocketClose: null, // подписка NetGame: АКТИВНЫЙ сокет оборвался посреди боя
      send(msg) {
        if (client.ws && client.ws.readyState === 1) client.ws.send(JSON.stringify(msg))
      },
      close() {
        if (client._pingTimer) { clearInterval(client._pingTimer); client._pingTimer = null }
        try {
          client.ws && client.ws.close()
        } catch {
          /* ок */
        }
      },
      // вернуться в ТОТ ЖЕ идущий бой новым сокетом (старый — мёртв-но-открыт на
      // iOS, либо оборвался). Резолвится, когда сервер подтвердил возврат
      // (match-start rejoined); реджектится по таймауту/ошибке/rejoin-fail.
      reconnect() {
        return new Promise((res, rej) => {
          if (!client.roomId || !client.youUnit) return rej(new Error('нет данных для возврата'))
          const qp = `rejoin=${encodeURIComponent(client.roomId)}&unit=${encodeURIComponent(client.youUnit)}&rkey=${encodeURIComponent(client.rkey || '')}`
          let sock
          try {
            sock = new WebSocket(`${WS_URL}?${qp}`)
          } catch (e) {
            return rej(e)
          }
          let done = false
          const to = setTimeout(() => {
            if (done) return
            done = true
            try { sock.close() } catch {}
            rej(new Error('rejoin timeout'))
          }, 4000)
          sock.onmessage = (e) => {
            let m
            try { m = JSON.parse(e.data) } catch { return }
            if (m.type === 'pong') { if (typeof m.ts === 'number') client.ping = Math.max(0, Math.round(Date.now() - m.ts)); return }
            if (m.type === 'rejoin-fail') {
              if (done) return
              done = true
              clearTimeout(to)
              try { sock.close() } catch {}
              rej(new Error('rejoin-fail'))
            } else if (m.type === 'match-start' && m.rejoined) {
              if (done) return
              done = true
              clearTimeout(to)
              const old = client.ws
              client.ws = sock // переключаем активный сокет
              client.roomId = m.room || client.roomId
              if (m.rkey) client.rkey = m.rkey
              try { if (old && old !== sock) old.close() } catch {}
              log('reconnect: вернулись в бой ' + m.room)
              res()
            } else if (m.type === 'state') {
              client.stateN = (client.stateN || 0) + 1
              client.lastState = m
              client.stateQueue.push(m) // в очередь — NetGame сольёт по порядку (t-дедуп снимет двойную с push)
              if (client.stateQueue.length > 64) client.stateQueue.shift()
              if (client.onMessage) client.onMessage(m)
            } else if (m.type === 'match-end') {
              client.lastEnd = m // буферим — NetGame подхватит даже без push
              if (client.onMessage) client.onMessage(m)
            }
          }
          sock.onerror = () => {
            if (done) return
            done = true
            clearTimeout(to)
            rej(new Error('rejoin error'))
          }
          sock.onclose = (ev) => {
            if (!done) {
              done = true
              clearTimeout(to)
              rej(new Error('rejoin closed'))
            } else if (client.ws === sock && client.onSocketClose) {
              client.onSocketClose(ev.code) // уже активный — настоящий обрыв, пусть NetGame решает
            }
          }
        })
      },
    }
    ws.onopen = () => {
      log('ws открыт →', WS_URL)
      client.send({ type: 'join', name, tankId, tier, tint, skin, stats, battles, uid }) // uid — best-effort tg-id для аналитики
      // пинг: RTT раз в 2с. client.send шлёт через АКТИВНЫЙ сокет → переживает реконнект.
      if (!client._pingTimer) client._pingTimer = setInterval(() => client.send({ type: 'ping', ts: Date.now() }), 2000)
    }
    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type === 'pong') { if (typeof msg.ts === 'number') client.ping = Math.max(0, Math.round(Date.now() - msg.ts)); return }
      if (msg.type === 'state') {
        client.stateN = (client.stateN || 0) + 1
        client.lastState = msg // последний — для мгновенного показа мира при подписке NetGame
        client.stateQueue.push(msg) // очередь — NetGame сольёт ВСЕ по порядку (без потери промежуточных)
        if (client.stateQueue.length > 64) client.stateQueue.shift() // кэп: фоновая вкладка с замёрзшим rAF не копит бесконечно
        if (client.stateN === 1) log('первый снапшот state получен (t=' + msg.t + ', подписчик ' + (client.onMessage ? 'есть' : 'ещё нет') + ')')
      }
      if (msg.type === 'match-end') client.lastEnd = msg // всегда буферим — NetGame подхватит pull'ом
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
        client.roomId = msg.room || client.roomId // данные для возможного реконнекта
        client.youUnit = msg.youUnit
        if (msg.rkey) client.rkey = msg.rkey
        log('match-start получен (youUnit=' + msg.youUnit + ', map=' + msg.mapId + ', room=' + msg.room + ')')
        onStart && onStart(msg)
      } else if (msg.type === 'match-end') {
        // уже забуферено в client.lastEnd выше (NetGame подхватит pull'ом, даже
        // если push не дошёл) — push дублируем для мгновенности, _onMessage дедупит
        if (client.onMessage) client.onMessage(msg)
        log('match-end получен ДО подписчика — буферизую')
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
        // код закрытия в ошибку → в телеметрию (1013=busy лимит IP, 1006=обрыв и т.д.)
        reject(new Error('ws closed:' + e.code))
      }
      // в бою на это подписан NetGame. Но если реконнект уже увёл активный сокет
      // на новый (client.ws !== ws) — этот close уже не наш, игнорируем.
      if (client.ws === ws && client.onSocketClose) client.onSocketClose(e.code)
      onClose && onClose()
    }
  })
}
