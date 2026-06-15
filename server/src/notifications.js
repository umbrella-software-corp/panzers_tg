// Пуш-уведомления от game-бота: возврат игроков (дейли-награда/задачи + винбэк) и
// соц-хук «друг в бою». Бот УЖЕ умеет писать (api/sendMessage как в payments.js) и
// поллит апдейты там же — сюда вынесена только исходящая рассылка + планировщик.
//
// АНТИСПАМ (иначе Telegram лимитнёт бота):
//  - максимум 1 пуш/сутки на юзера (lastPushAt, общий лимит на все типы);
//  - opt-out: /stop ставит pushOff; /start снова включает (см. payments.js);
//  - кто заблокировал бота (403) → pushBlocked, больше не трогаем;
//  - дейли шлём ТОЛЬКО реальным игрокам (battles>=1) и НЕ активным сегодня
//    (фейков Traffy с battles=0 и онлайн-игроков не дёргаем);
//  - «друг в бою» — только реальным (battles>=1) и недавно активным друзьям,
//    с жёстким троттлингом отправителя (фильтр автоматически отсекает реф-ферму).
import { botToken, hasBot } from './auth.js'
import { listProfiles, loadProfile, saveProfile } from './db.js'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MSK_OFFSET = 3 * HOUR // МСК = UTC+3 (таймзон игроков нет — шлём по МСК-вечеру)
const SEND_HOUR = +(process.env.PUSH_HOUR_MSK || 19) // дейли-пуш в окне 19:00–22:00 МСК
const SEND_WINDOW = 3 // часа: окно, чтобы ночной деплой не разбудил всех в 3 ночи
const PUSH_COOLDOWN = +(process.env.PUSH_COOLDOWN_H || 20) * HOUR // ~1 пуш/сутки на юзера
const FRIEND_SENDER_COOLDOWN = 30 * MIN // один игрок триггерит «друг в бою» не чаще
const FRIEND_RECENT = 3 * DAY // друг считается «живым», если заходил за последние 3 дня
const FRIEND_MAX_PER_BATTLE = 5 // максимум друзей-пингов за один заход в бой
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://panzertg.online'
const DRY_RUN = process.env.PUSH_DRY_RUN === '1' // тест: не слать реально, только лог

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const playButton = { inline_keyboard: [[{ text: '🎮 В БОЙ', web_app: { url: WEBAPP_URL } }]] }

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
    .then((r) => r.json())
    .catch(() => ({ ok: false }))

// ---------- чистые хелперы (тестируются без IO) ----------
export const tgIdOf = (uid) => {
  const m = /^tg_(\d{3,20})$/.exec(uid || '')
  return m ? m[1] : null
}
export const mskDay = (ts) => new Date((ts || 0) + MSK_OFFSET).toISOString().slice(0, 10) // YYYY-MM-DD по МСК
export const mskHour = (ts) => new Date((ts || 0) + MSK_OFFSET).getUTCHours()
// текст дейли: винбэк, если давно не заходил, иначе обычная «награда+задачи»
export const digestText = (daysAway) =>
  daysAway >= 2
    ? '🎖 Командир, тебя давно не было — экипаж скучает! Ежедневная награда копится, новые задачи ждут в ангаре. Заскочи на пару боёв 🔥\n\n/stop — отписаться'
    : '🎁 Командир, ежедневная награда доступна, а задачи дня обновились! Быстрый бой за пару минут — залетай 🔥\n\n/stop — отписаться'
// кого включаем в дейли-рассылку (строка из listProfiles): реальный игрок, с tg-id,
// не игравший сегодня. Лимит 1/сутки и opt-out проверяются позже при самой отправке.
export function shouldDigest(row, today) {
  if (!row || (row.battles | 0) < 1) return false // фейки Traffy / непоигравшие — мимо
  if (!tgIdOf(row.uid)) return false
  if (row.lastSeen && mskDay(row.lastSeen) === today) return false // активных сегодня не трогаем
  return true
}
// годится ли друг для пинга «друг в бою»: реальный игрок и недавно живой (отсекает ферму)
export function friendOk(fp, now) {
  if (!fp) return false
  if (((fp.stats && fp.stats.battles) | 0) < 1) return false
  const seen = fp.lastSeen || fp._updatedAt || 0
  return now - seen <= FRIEND_RECENT
}

// ---------- отправка с уважением opt-out / blocked / 1-в-сутки ----------
async function sendPush(uid, text, { now = Date.now(), force = false } = {}) {
  const chatId = tgIdOf(uid)
  if (!chatId) return false
  const p = await loadProfile(uid)
  if (!p || p.pushOff || p.pushBlocked) return false
  if (!force && p.lastPushAt && now - p.lastPushAt < PUSH_COOLDOWN) return false
  if (DRY_RUN) {
    console.log(`[push:dry] → ${uid}: ${text.split('\n')[0]}`)
    p.lastPushAt = now
    await saveProfile(uid, p)
    return true
  }
  const res = await api('sendMessage', { chat_id: chatId, text, reply_markup: playButton, disable_web_page_preview: true })
  if (res && res.ok) {
    p.lastPushAt = now
    await saveProfile(uid, p)
    return true
  }
  const desc = (res && res.description) || ''
  if ((res && res.error_code === 403) || /chat not found|bot was blocked|user is deactivated|can't initiate/i.test(desc)) {
    p.pushBlocked = true // юзер не запускал/заблокировал бота — больше не пишем
    await saveProfile(uid, p)
  }
  return false
}

// ---------- дейли-рассылка (награда+задачи / винбэк) ----------
export async function runDailyDigest(now = Date.now()) {
  const today = mskDay(now)
  const profs = await listProfiles()
  let sent = 0
  for (const row of profs) {
    if (!shouldDigest(row, today)) continue
    const daysAway = Math.floor((now - (row.lastSeen || now)) / DAY)
    if (await sendPush(row.uid, digestText(daysAway), { now })) {
      sent++
      await sleep(70) // ~14 msg/с — с запасом под лимит Telegram (~30/с)
    }
  }
  console.log(`[push] дейли-рассылка: отправлено ${sent} из ${profs.length} профилей`)
  return sent
}

// ---------- «друг в бою» (соц-хук из startRoom) ----------
// «Друг в бою» ВЫКЛЮЧЕН по умолчанию: «друзья» сейчас = реферальный граф, а он
// засран Traffy-трафиком (один реф-id «привёл» ~1900 человек) → пуши «твой друг
// X в бою» летят про незнакомцев. Включить (FRIEND_PING=1) только когда появится
// НАСТОЯЩИЙ граф друзей (взаимные/squad-мейты), а не реклама-рефералы.
const FRIEND_PING_ENABLED = process.env.FRIEND_PING === '1'
const friendThrottle = new Map() // uid игрока → ts последнего соц-броадкаста
export async function notifyFriendsInBattle(player) {
  if (!FRIEND_PING_ENABLED) return // см. коммент выше — реф-граф ≠ граф друзей (Traffy)
  if (!hasBot() || !player || !player.uid || !tgIdOf(player.uid)) return
  const now = Date.now()
  if ((friendThrottle.get(player.uid) || 0) > now - FRIEND_SENDER_COOLDOWN) return // отправитель уже недавно дёргал друзей
  friendThrottle.set(player.uid, now)
  const me = await loadProfile(player.uid)
  if (!me) return
  const candidates = []
  if (me.referredBy) candidates.push(me.referredBy) // тот, кто меня пригласил
  if (Array.isArray(me.referralIds)) candidates.push(...me.referralIds.slice(-25)) // последние, кого я пригласил
  const seen = new Set()
  let pinged = 0
  for (const fuid of candidates) {
    if (pinged >= FRIEND_MAX_PER_BATTLE) break
    if (fuid === player.uid || seen.has(fuid)) continue
    seen.add(fuid)
    const fp = await loadProfile(fuid)
    if (!friendOk(fp, now)) continue // только реальные недавно-активные (ферма отсеивается)
    if (await sendPush(fuid, `🔥 Твой друг ${me.name || 'боец'} сейчас в бою! Залетай вместе ⚔️\n\n/stop — отписаться`, { now })) pinged++
  }
}

// включить/выключить уведомления (для /start и /stop в payments.js)
export async function setPushEnabled(uid, on) {
  if (!tgIdOf(uid)) return
  const p = await loadProfile(uid)
  if (!p) return
  p.pushOff = !on
  if (on) p.pushBlocked = false // снова пишет боту → разблокируем
  await saveProfile(uid, p)
}

// ---------- планировщик: раз в сутки в вечернем окне по МСК ----------
let lastDigestDay = null
export function startNotifications() {
  if (!hasBot()) {
    console.log('[push] BOT_TOKEN не задан — уведомления выключены (dev)')
    return
  }
  const tick = async () => {
    try {
      const now = Date.now()
      const today = mskDay(now)
      const h = mskHour(now)
      if (h >= SEND_HOUR && h < SEND_HOUR + SEND_WINDOW && lastDigestDay !== today) {
        lastDigestDay = today
        await runDailyDigest(now)
      }
    } catch (e) {
      console.error('[push] ошибка планировщика:', e.message)
    }
    setTimeout(tick, 5 * MIN)
  }
  tick()
  console.log(`[push] планировщик уведомлений запущен (дейли в ${SEND_HOUR}:00 МСК)`)
}
