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
// Настройка группы: добавь бота в группу разработчиков и напиши там /here
// (только админ группы) — бот запомнит её (перекрывает env SUPPORT_CHAT_ID,
// без правки .env и редеплоя). /chatid — узнать id любого чата.
//
// Без БД и без второго процесса: запускается из основного сервера (index.js),
// long-polling своим токеном независимо от игрового бота. Если SUPPORT_BOT_TOKEN
// не задан — модуль молча выключен (dev/без саппорта).
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { t, pickLang } from './i18n.js'

// Хранилище: номера тикетов (один на игрока, как в МиниПолии) + назначенная
// группа (команда /here). Маршрут ответа — по tgId из заголовка; номер для
// читаемости. group из /here ПЕРЕКРЫВАЕТ env SUPPORT_CHAT_ID — настройка без
// правки .env и редеплоя.
const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'support.json')
let store = { next: 1, users: {}, group: null }
let storeLoaded = false
async function loadStore() {
  if (storeLoaded) return
  storeLoaded = true
  try {
    store = { next: 1, users: {}, group: null, ...JSON.parse(await fs.readFile(STORE, 'utf8')) }
  } catch {
    /* нет файла — дефолт */
  }
}
async function saveStore() {
  try {
    await fs.mkdir(path.dirname(STORE), { recursive: true })
    await fs.writeFile(STORE, JSON.stringify(store))
  } catch (e) {
    console.error('[support] не сохранил store:', e.message)
  }
}
async function ticketFor(uid) {
  await loadStore()
  const key = String(uid)
  if (!store.users[key]) {
    store.users[key] = store.next++
    await saveStore()
  }
  return store.users[key]
}
async function setGroup(chatId) {
  await loadStore()
  store.group = chatId
  await saveStore()
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

const envGroup = Number(GROUP_RAW)
// действующая группа тикетов: назначенная через /here ПЕРЕКРЫВАЕТ env SUPPORT_CHAT_ID
function effectiveGroup() {
  if (Number.isFinite(store.group) && store.group !== 0) return store.group
  if (Number.isFinite(envGroup) && envGroup !== 0) return envGroup
  return null
}

export function startSupportBot() {
  if (!TOKEN) {
    console.log('[support] SUPPORT_BOT_TOKEN не задан — саппорт-бот выключен')
    return
  }
  loadStore().then(() => {
    const g = effectiveGroup()
    console.log(g ? `[support] саппорт-бот запущен, группа = ${g}` : '[support] саппорт-бот запущен; группа не задана — добавь бота в группу и напиши там /here')
  })
  let offset = 0
  const tick = async () => {
    try {
      const res = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] })
      if (res.ok) {
        for (const u of res.result) {
          offset = u.update_id + 1
          await handle(u).catch((e) => console.error('[support] handle', e.message))
        }
      }
    } catch (e) {
      console.error('[support] poll', e.message)
    }
    setTimeout(tick, 1000)
  }
  tick()
}

async function handle(u) {
  const msg = u.message
  if (!msg || !msg.from || msg.from.is_bot) return
  const chat = msg.chat
  const text = typeof msg.text === 'string' ? msg.text : ''
  const group = effectiveGroup()
  const lang = pickLang(msg.from.language_code) // язык пишущего — на нём и отвечаем

  // /chatid — id любого чата (для справки)
  if (text.startsWith('/chatid')) {
    await api('sendMessage', { chat_id: chat.id, text: `chat.id = ${chat.id}\ntype = ${chat.type}` })
    return
  }

  // /here — назначить ЭТУ группу местом тикетов (только админ группы). Перекрывает
  // env SUPPORT_CHAT_ID и сохраняется в файл — настройка без правки .env и редеплоя.
  if (text.startsWith('/here') || text.startsWith('/setgroup')) {
    if (chat.type !== 'group' && chat.type !== 'supergroup') {
      await api('sendMessage', { chat_id: chat.id, text: t('sup.hereInPrivate', lang) })
      return
    }
    const mem = await api('getChatMember', { chat_id: chat.id, user_id: msg.from.id })
    const admin = mem.ok && (mem.result.status === 'creator' || mem.result.status === 'administrator')
    if (!admin) {
      await api('sendMessage', { chat_id: chat.id, text: t('sup.hereNotAdmin', lang) })
      return
    }
    await setGroup(chat.id)
    await api('sendMessage', { chat_id: chat.id, text: t('sup.hereDone', lang, { id: chat.id }) })
    return
  }

  // ответ из группы разработчиков (реплай на пересланное сообщение) → игроку
  if (group !== null && chat.id === group) {
    const reply = msg.reply_to_message
    if (!reply) return // не реплай — это заметка разработчика, игнор
    const m = (reply.text || reply.caption || '').match(TGID_RE)
    if (!m) return
    const userId = Number(m[1])
    const r = await api('copyMessage', { chat_id: userId, from_chat_id: group, message_id: msg.message_id })
    if (!r.ok) {
      await api('sendMessage', { chat_id: group, text: `⚠️ Не доставил ответ игроку ${userId}: ${r.description || '?'}`, reply_to_message_id: msg.message_id })
    }
    return
  }

  // дальше — только личка игрока
  if (chat.type !== 'private') return

  if (text.startsWith('/start')) {
    await api('sendMessage', { chat_id: chat.id, text: t('sup.start', lang) })
    return
  }

  if (group === null) {
    await api('sendMessage', { chat_id: chat.id, text: t('sup.notConfigured', lang) })
    return
  }

  // сообщение игрока → в группу разработчиков с заголовком (tgId = ключ ответа)
  const from = msg.from
  const who = from.username ? '@' + from.username : from.first_name || '—'
  const ticket = await ticketFor(from.id)
  const header = `📩 Тикет #${ticket} | ${who} | tgId=${from.id}`
  let r
  if (text) {
    r = await api('sendMessage', { chat_id: group, text: `${header}\n\n${text}` })
  } else if (msg.sticker || msg.dice || msg.location || msg.contact) {
    // эти типы не принимают caption — заголовок шлём отдельно, затем сам контент
    r = await api('sendMessage', { chat_id: group, text: header })
    if (r && r.ok) await api('copyMessage', { chat_id: group, from_chat_id: chat.id, message_id: msg.message_id })
  } else {
    // фото/видео/голос/документ — copyMessage с заголовком в подпись
    const cap = typeof msg.caption === 'string' && msg.caption ? `${header}\n\n${msg.caption}` : header
    r = await api('copyMessage', { chat_id: group, from_chat_id: chat.id, message_id: msg.message_id, caption: cap })
  }
  // НЕ врём «передали», если пересылка в группу не прошла. Чаще всего причина —
  // не та группа: добавь бота в нужную группу и напиши там /here.
  if (!r || r.ok === false) {
    console.error(`[support] НЕ доставлено в группу chat_id=${group}: ${(r && r.description) || 'нет ответа'} — проверь группу (добавь бота туда и напиши /here)`)
    await api('sendMessage', { chat_id: chat.id, text: t('sup.deliveryFailed', lang) })
    return
  }
  await api('sendMessage', { chat_id: chat.id, text: t('sup.ticketDone', lang, { n: ticket }) })
}
