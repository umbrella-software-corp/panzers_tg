// Саппорт-бот @punzers_support_bot — ОТДЕЛЬНЫЙ Telegram-бот (свой токен, не
// основной игровой). Поток:
//   1. Игрок жмёт кнопку «Поддержка» в ангаре → открывается личка этого бота.
//   2. Пишет сообщение (текст/фото/видео/голос/документ).
//   3. Бот пересылает его в группу разработчиков (SUPPORT_CHAT_ID) с заголовком
//      «📩 Тикет #N | @user | tgId=<id>». tgId в заголовке = ключ для ответа
//      (БД не нужна; номер тикета — для читаемости, один на игрока).
//   4. Разработчик отвечает РЕПЛАЕМ на пересланное сообщение в группе.
//   5. Бот читает tgId из заголовка реплая и copyMessage'ит ответ игроку в личку.
//
// Без БД и без второго процесса: запускается из основного сервера (index.js),
// long-polling своим токеном независимо от игрового бота. Если SUPPORT_BOT_TOKEN
// не задан — модуль молча выключен (dev/без саппорта).
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// номера тикетов: один тикет на игрока (как в МиниПолии). Лёгкий JSON-файл,
// маршрут ответа всё равно по tgId из заголовка — номер только для читаемости.
const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'support.json')
let store = { next: 1, users: {} }
let storeLoaded = false
async function ticketFor(uid) {
  if (!storeLoaded) {
    storeLoaded = true
    try {
      store = JSON.parse(await fs.readFile(STORE, 'utf8'))
    } catch {
      /* нет файла — дефолт */
    }
  }
  const key = String(uid)
  if (!store.users[key]) {
    store.users[key] = store.next++
    try {
      await fs.mkdir(path.dirname(STORE), { recursive: true })
      await fs.writeFile(STORE, JSON.stringify(store))
    } catch (e) {
      console.error('[support] не сохранил тикет:', e.message)
    }
  }
  return store.users[key]
}

const TOKEN = process.env.SUPPORT_BOT_TOKEN || ''
const GROUP_RAW = process.env.SUPPORT_CHAT_ID || '' // id группы разработчиков (число; супергруппа: -100…)

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40000), // лонг-полл 25с + запас
  })
    .then((r) => r.json())
    .catch((e) => ({ ok: false, description: e.message }))

// tgId игрока вытаскиваем из заголовка пересланного сообщения — он и есть адрес ответа
const TGID_RE = /tgId=(\d+)/

export function startSupportBot() {
  if (!TOKEN) {
    console.log('[support] SUPPORT_BOT_TOKEN не задан — саппорт-бот выключен')
    return
  }
  const groupId = Number(GROUP_RAW)
  const hasGroup = Number.isFinite(groupId) && groupId !== 0
  if (!hasGroup) {
    console.log('[support] SUPPORT_CHAT_ID не задан/не число — бот примет /chatid в группе, но пересылать ещё некуда')
  }

  let offset = 0
  const tick = async () => {
    try {
      const res = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] })
      if (res.ok) {
        for (const u of res.result) {
          offset = u.update_id + 1
          await handle(u, groupId, hasGroup).catch((e) => console.error('[support] handle', e.message))
        }
      }
    } catch (e) {
      console.error('[support] poll', e.message)
    }
    setTimeout(tick, 1000)
  }
  tick()
  console.log(`[support] саппорт-бот запущен${hasGroup ? `, группа = ${groupId}` : ''}`)
}

async function handle(u, groupId, hasGroup) {
  const msg = u.message
  if (!msg || !msg.from || msg.from.is_bot) return
  const chat = msg.chat
  const text = typeof msg.text === 'string' ? msg.text : ''

  // /chatid — в любом чате сообщает его id (нужно один раз, чтобы узнать
  // SUPPORT_CHAT_ID группы: добавь бота в группу, напиши /chatid)
  if (text.startsWith('/chatid')) {
    await api('sendMessage', { chat_id: chat.id, text: `chat.id = ${chat.id}\ntype = ${chat.type}` })
    return
  }

  // ответ из группы разработчиков (реплай на пересланное сообщение) → игроку
  if (hasGroup && chat.id === groupId) {
    const reply = msg.reply_to_message
    if (!reply) return // не реплай — это заметка разработчика, игнор
    const m = (reply.text || reply.caption || '').match(TGID_RE)
    if (!m) return
    const userId = Number(m[1])
    const r = await api('copyMessage', { chat_id: userId, from_chat_id: groupId, message_id: msg.message_id })
    if (!r.ok) {
      await api('sendMessage', { chat_id: groupId, text: `⚠️ Не доставил ответ игроку ${userId}: ${r.description || '?'}`, reply_to_message_id: msg.message_id })
    }
    return
  }

  // дальше — только личка игрока
  if (chat.type !== 'private') return

  if (text.startsWith('/start')) {
    await api('sendMessage', {
      chat_id: chat.id,
      text: 'Привет! Это поддержка Panzer TG. Опиши проблему или вопрос — передадим разработчику и ответим прямо здесь. Можно текст, скриншоты, видео, голос.',
    })
    return
  }

  if (!hasGroup) {
    await api('sendMessage', { chat_id: chat.id, text: 'Поддержка временно не настроена — напишите чуть позже.' })
    return
  }

  // сообщение игрока → в группу разработчиков с заголовком (tgId = ключ ответа)
  const from = msg.from
  const who = from.username ? '@' + from.username : from.first_name || '—'
  const ticket = await ticketFor(from.id)
  const header = `📩 Тикет #${ticket} | ${who} | tgId=${from.id}`
  let r
  if (text) {
    r = await api('sendMessage', { chat_id: groupId, text: `${header}\n\n${text}` })
  } else if (msg.sticker || msg.dice || msg.location || msg.contact) {
    // эти типы не принимают caption — заголовок шлём отдельно, затем сам контент
    r = await api('sendMessage', { chat_id: groupId, text: header })
    if (r && r.ok) await api('copyMessage', { chat_id: groupId, from_chat_id: chat.id, message_id: msg.message_id })
  } else {
    // фото/видео/голос/документ — copyMessage с заголовком в подпись
    const cap = typeof msg.caption === 'string' && msg.caption ? `${header}\n\n${msg.caption}` : header
    r = await api('copyMessage', { chat_id: groupId, from_chat_id: chat.id, message_id: msg.message_id, caption: cap })
  }
  // НЕ врём «передали», если пересылка в группу не прошла. Чаще всего причина —
  // неверный SUPPORT_CHAT_ID: добавь бота в нужную группу и напиши там /chatid.
  if (!r || r.ok === false) {
    console.error(`[support] НЕ доставлено в группу chat_id=${groupId}: ${(r && r.description) || 'нет ответа'} — проверь SUPPORT_CHAT_ID (напиши /chatid в группе)`)
    await api('sendMessage', { chat_id: chat.id, text: 'Пока не получилось передать сообщение — уже разбираемся. Напиши ещё раз чуть позже.' })
    return
  }
  await api('sendMessage', { chat_id: chat.id, text: `✅ Тикет #${ticket} передан разработчику — ответим здесь.` })
}
