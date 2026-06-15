// Авторизация Telegram Mini App: проверка подписи initData (HMAC-SHA256,
// секрет = HMAC("WebAppData", BOT_TOKEN)). Без BOT_TOKEN (локальная разработка)
// принимаем гостевой id из заголовка x-guest-id → uid "g_<id>".
import crypto from 'crypto'
import { pickLang, t } from './i18n.js'

const BOT_TOKEN = process.env.BOT_TOKEN || ''

export const hasBot = () => !!BOT_TOKEN
export const botToken = () => BOT_TOKEN

export function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData) return null
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const dataCheck = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex')
  if (calc !== hash) return null
  // украденный initData не должен жить вечно: сутки — и до свидания
  const authDate = +params.get('auth_date') || 0
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null
  // подпись валидна — достаём пользователя
  try {
    const user = JSON.parse(params.get('user') || '{}')
    if (!user.id) return null
    // язык интерфейса/сообщений — из language_code пользователя Telegram
    const lang = pickLang(user.language_code)
    // start_param из ПОДПИСАННОГО initData (метка источника трафика ?startapp=…) —
    // подделать нельзя, подпись проверена выше
    return { uid: `tg_${user.id}`, name: user.first_name || user.username || t('defaultName', lang), lang, startParam: params.get('start_param') || null }
  } catch {
    return null
  }
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
