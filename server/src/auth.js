// Авторизация Telegram Mini App: проверка подписи initData (HMAC-SHA256,
// секрет = HMAC("WebAppData", BOT_TOKEN)). Без BOT_TOKEN (локальная разработка)
// принимаем гостевой id из заголовка x-guest-id → uid "g_<id>".
import crypto from 'crypto'
import { pickLang, pickLangForTelegramUser, t } from './i18n.js'

const BOT_TOKEN = process.env.BOT_TOKEN || ''

export const hasBot = () => !!BOT_TOKEN
export const botToken = () => BOT_TOKEN

// Проверка initData С ПРИЧИНОЙ отказа. Возвращает { ok, reason, authAge, user, lang,
// startParam }. reason: empty|no-hash|bad-signature|no-auth-date|expired|no-user|
// parse-error|ok. Нужна и для диагностики «играю, но не залогинен» (@Z_86_V): хотим
// видеть, ПОЧЕМУ конкретно клиент не авторизуется, не дёргая игрока. verifyInitData —
// тонкая обёртка ниже (логика подписи не продублирована).
export function verifyInitDataVerbose(initData) {
  if (!BOT_TOKEN) return { ok: false, reason: 'no-bot-token' }
  if (!initData) return { ok: false, reason: 'empty' }
  let params
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'parse-error' }
  }
  const hash = params.get('hash')
  if (!hash) return { ok: false, reason: 'no-hash' }
  params.delete('hash')
  const dataCheck = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex')
  if (calc !== hash) return { ok: false, reason: 'bad-signature' }
  // украденный initData не должен жить вечно: сутки — и до свидания
  const authDate = +params.get('auth_date') || 0
  const authAge = authDate ? Math.round(Date.now() / 1000 - authDate) : null
  if (!authDate) return { ok: false, reason: 'no-auth-date', authAge }
  if (authAge > 86400) return { ok: false, reason: 'expired', authAge }
  // подпись валидна — достаём пользователя
  let user
  try {
    user = JSON.parse(params.get('user') || '{}')
  } catch {
    return { ok: false, reason: 'parse-error', authAge }
  }
  if (!user.id) return { ok: false, reason: 'no-user', authAge }
  // язык интерфейса/сообщений — из language_code пользователя Telegram
  const lang = pickLangForTelegramUser(user)
  // start_param из ПОДПИСАННОГО initData (метка источника трафика ?startapp=…) —
  // подделать нельзя, подпись проверена выше
  return { ok: true, reason: 'ok', authAge, user, lang, startParam: params.get('start_param') || null }
}

export function verifyInitData(initData) {
  const r = verifyInitDataVerbose(initData)
  if (!r.ok) return null
  const u = r.user
  return { uid: `tg_${u.id}`, name: u.first_name || u.username || t('defaultName', r.lang), lang: r.lang, startParam: r.startParam }
}

// uid из запроса: телеграмная подпись либо dev-гость
export function authRequest(req) {
  const initData = req.headers['x-init-data']
  const tg = verifyInitData(initData)
  if (tg) return tg
  if (!BOT_TOKEN) {
    const gid = String(req.headers['x-guest-id'] || '').slice(0, 40)
    // для dev-гостя метку источника берём из заголовка (в проде — из initData)
    const lang = pickLang(req.headers['x-lang'])
    if (gid) return { uid: `g_${gid}`, name: t('defaultName', lang), lang, startParam: req.headers['x-start-param'] || null }
  }
  return null
}

// ---------- Диагностика отказов авторизации ----------
// Кольцевой буфер последних отказов: видно ПОЧЕМУ реальный клиент не логинится (@Z_86_V
// «играю, но не залогинен» — на деле гость под g_<random>). Читается из админки
// (/api/admin/auth-failures). Работает ДАЖЕ если у игрока старый бандл — это сервер.
// tgId/имя парсим из НЕдоверенного initData ТОЛЬКО для сопоставления с тикетом (подпись
// уже признана невалидной — в игру эти данные не идут).
const AUTH_FAILS = []
const AUTH_FAILS_MAX = 300
// троттл: гости поллят /api/online и /api/ping постоянно — без дедупа один игрок забил бы
// всё кольцо. Пишем максимум 1 запись на (ip+причина) в минуту → буфер остаётся читаемым.
const AUTH_FAIL_SEEN = new Map()
const AUTH_FAIL_THROTTLE_MS = 60000

export function recentAuthFailures() {
  return AUTH_FAILS.slice().reverse()
}

function reqIp(req) {
  return (
    String(req.headers['x-real-ip'] || '').trim() ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    '?'
  )
}

export function recordAuthFailure(req) {
  // ВЫСОКОЧАСТОТНЫЕ некритичные эндпоинты: presence-хартбит (/api/ping, каждые 40с) и
  // поллинг онлайна (/api/online) у гостя 401-ятся ПОСТОЯННО — это не «не залогинен», а
  // ожидаемый шум. Не пишем и не логируем: иначе на потоке гостей синхронный console.warn
  // в stderr блокирует event-loop → лаг во ВСЕХ боях (на том же loop висит WS). Вход меряем
  // по /api/profile и /api/econ/*, где отказ реально означает «не залогинен».
  const url = String(req.url || '').split('?')[0]
  if (url === '/api/ping' || url === '/api/online') return null
  const initData = String(req.headers['x-init-data'] || '')
  const guestId = String(req.headers['x-guest-id'] || '')
  // только реальные клиенты (есть хоть какой-то auth-сигнал) — отсекаем сканеры/боты
  if (!initData && !guestId) return null
  // причина: если initData есть — почему не прошёл; если только guest-id — клиент НЕ
  // нашёл initData и свалился в гостя (в проде это и есть 401 «не залогинен»).
  const v = initData ? verifyInitDataVerbose(initData) : { reason: 'guest-no-initdata', authAge: null }
  let tgId = null
  let name = null
  if (initData) {
    try {
      const u = JSON.parse(new URLSearchParams(initData).get('user') || '{}')
      tgId = u.id || null
      name = u.first_name || u.username || null
    } catch {
      /* кривой initData — id для сопоставления не достать */
    }
  }
  const ip = reqIp(req)
  // дедуп: тот же ip+причина за последнюю минуту — не плодим (но в pm2-лог всё равно пишем)
  const key = ip + '|' + v.reason
  const now = Date.now()
  const last = AUTH_FAIL_SEEN.get(key) || 0
  const throttled = now - last < AUTH_FAIL_THROTTLE_MS
  if (!throttled) AUTH_FAIL_SEEN.set(key, now)
  const rec = {
    ts: Date.now(),
    reason: v.reason,
    url: String(req.url || '').split('?')[0],
    initDataLen: initData.length,
    hasGuestId: !!guestId,
    guestId: guestId.slice(0, 40),
    tgId,
    name,
    authAgeSec: v.authAge != null ? v.authAge : null,
    ua: String(req.headers['user-agent'] || '').slice(0, 200),
    ip,
  }
  // и кольцо, и pm2-лог — только НЕ зафлуженные (1/мин на ip+причину). Синхронный
  // console.warn на КАЖДЫЙ 401 под потоком гостей блокировал event-loop → лаг в боях.
  if (!throttled) {
    AUTH_FAILS.push(rec)
    if (AUTH_FAILS.length > AUTH_FAILS_MAX) AUTH_FAILS.shift()
    // подчистка карты дедупа, чтобы не росла бесконечно (старше окна — не нужны)
    if (AUTH_FAIL_SEEN.size > 2000) for (const [k, ts] of AUTH_FAIL_SEEN) if (now - ts > AUTH_FAIL_THROTTLE_MS) AUTH_FAIL_SEEN.delete(k)
    try {
      console.warn('[auth-fail]', rec.reason, 'tg=' + tgId, 'len=' + initData.length, 'age=' + rec.authAgeSec, 'ip=' + ip, 'ua=' + rec.ua.slice(0, 60))
    } catch {
      /* нет console — ок */
    }
  }
  return rec
}
