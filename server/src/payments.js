// Платежи Telegram Stars (XTR): createInvoiceLink + поллинг getUpdates для
// pre_checkout_query и successful_payment. Товары — серверный каталог
// (клиентским ценам не верим). Идемпотентность по telegram charge id.
import { botToken, hasBot } from './auth.js'
import { loadProfile, saveProfile, paymentSeen, markPayment, listPayments, markRefunded } from './db.js'
import { setPushEnabled } from './notifications.js'
import { t, pickLang } from './i18n.js'

// каталог: что начисляем за звёзды
export const PRODUCTS = {
  p1: { title: '1 000 кредитов', stars: 50, credits: 1000 },
  p2: { title: '3 500 кредитов', stars: 135, credits: 3500 },
  p3: { title: '9 000 кредитов', stars: 299, credits: 9000 },
  t1: { title: '20 жетонов', stars: 65, tokens: 20 },
  t2: { title: '60 жетонов', stars: 165, tokens: 60 },
  t3: { title: '150 жетонов', stars: 329, tokens: 150 },
  rename: { title: 'Смена позывного', stars: 50, rename: true },
  prem: { title: 'Премиум-аккаунт · 7 дней', stars: 99, premiumDays: 7 },
  // премиум-техника (танк за ⭐99) — grantProduct добавляет tank в owned. id сверены
  // с PREMIUM_TANKS в client/src/game/meta.js (спрайты <tank>.png уже в репо).
  pt_t28: { title: 'Т-28 · премиум-танк', stars: 99, tank: 't28' },
  pt_t54: { title: 'Т-54 · премиум-танк', stars: 99, tank: 't54' },
  pt_pz4h: { title: 'Pz. IV H · премиум-танк', stars: 99, tank: 'pz4h' },
  pt_maus: { title: 'Maus · премиум-танк', stars: 99, tank: 'maus' },
  pt_ram: { title: 'Ram II · премиум-танк', stars: 99, tank: 'ram' },
  pt_sper: { title: 'Super Pershing · премиум-танк', stars: 99, tank: 'sper' },
}

// позывной с клиента: режем управляющие символы, тримим, 3..16 символов.
// null — недопустим (платёж не создаём / не начисляем).
function cleanName(raw) {
  const s = String(raw || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 16)
  return s.length >= 3 ? s : null
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // лонг-полл 25с + запас; без таймаута зависший fetch молча стопит платежи
    signal: AbortSignal.timeout(40000),
  }).then((r) => r.json())

export async function createInvoice(uid, productId, extra = {}) {
  const p = PRODUCTS[productId]
  if (!p) return { error: 'unknown product' }
  // товары с параметром (смена позывного) — проверяем его ДО создания счёта
  let name
  if (p.rename) {
    name = cleanName(extra.name)
    if (!name) return { error: 'bad name' }
  }
  if (!hasBot()) return { dev: true } // локальная разработка — без оплаты
  // заголовок/описание счёта — на языке покупателя (lang приходит из index.js)
  const lang = pickLang(extra.lang)
  const loc = t('products.' + productId, lang)
  const title = loc === 'products.' + productId ? p.title : loc
  const res = await api('createInvoiceLink', {
    title,
    description: p.rename ? t('invoiceRename', lang, { name }) : t('invoiceDesc', lang, { title }),
    payload: JSON.stringify(name ? { uid, productId, name } : { uid, productId }),
    currency: 'XTR',
    prices: [{ label: title, amount: p.stars }],
  })
  if (!res.ok) return { error: res.description || 'invoice failed' }
  return { link: res.result }
}

// начисление товара профилю (используется и поллингом, и dev-эндпоинтом)
export async function grantProduct(uid, productId, extra = {}) {
  const p = PRODUCTS[productId]
  if (!p) return false
  const profile = (await loadProfile(uid)) || {}
  if (p.credits) profile.credits = (profile.credits || 0) + p.credits
  if (p.tokens) profile.tokens = (profile.tokens || 0) + p.tokens
  if (p.premiumDays) {
    // продлеваем от текущего конца премиума (или от сейчас, если истёк)
    const base = Math.max(Date.now(), profile.premiumUntil || 0)
    profile.premiumUntil = base + p.premiumDays * 86400000
  }
  if (p.tank) {
    // премиум-танк в гараж (один раз; повтор-покупка не дублирует)
    if (!Array.isArray(profile.owned)) profile.owned = []
    if (!profile.owned.includes(p.tank)) profile.owned.push(p.tank)
  }
  if (p.rename) {
    const name = cleanName(extra.name)
    if (!name) return false // недопустимое имя — не «съедаем» оплату молча
    profile.name = name
    profile.nameCustom = true // больше не перетираем ником из Telegram
  }
  await saveProfile(uid, profile)
  return true
}

// рефанд звёзд игроку по charge id (из админки): возвращает звёзды через
// Telegram refundStarPayment и откатывает начисленный товар (кредиты/жетоны/
// премиум) с клампом ≥0, чтобы не остались и звёзды, и товар.
export async function refundPayment(charge) {
  const rec = (await listPayments()).find((p) => p.charge === charge)
  if (!rec) return { error: 'платёж не найден' }
  if (rec.refunded) return { error: 'уже возвращён' }
  if (!hasBot()) return { error: 'нет BOT_TOKEN (dev-режим)' }
  // uid телеграм-юзера — «tg_<numeric>»; гость — «g_...». Для refundStarPayment
  // нужен ЧИСЛОВОЙ user_id, поэтому вырезаем префикс.
  const m = /^tg_(\d+)$/.exec(String(rec.uid))
  if (!m) return { error: 'не Telegram-оплата (гость)' }
  const userId = Number(m[1])
  const res = await api('refundStarPayment', { user_id: userId, telegram_payment_charge_id: charge })
  if (!res.ok) return { error: res.description || 'Telegram отклонил рефанд' }
  // откат начисленного товара (кламп ≥0)
  const p = PRODUCTS[rec.productId]
  if (p) {
    const profile = (await loadProfile(rec.uid)) || {}
    if (p.credits) profile.credits = Math.max(0, (profile.credits || 0) - p.credits)
    if (p.tokens) profile.tokens = Math.max(0, (profile.tokens || 0) - p.tokens)
    if (p.premiumDays) profile.premiumUntil = Math.max(Date.now(), (profile.premiumUntil || 0) - p.premiumDays * 86400000)
    if (p.tank) profile.owned = (profile.owned || []).filter((id) => id !== p.tank) // рефанд — убираем танк
    await saveProfile(rec.uid, profile)
  }
  await markRefunded(charge)
  console.log(`[pay] РЕФАНД ${rec.uid} · ${rec.productId} · ${rec.stars} XTR возвращены`)
  return { ok: true, stars: rec.stars }
}

// приветствие бота: на /start — кнопка, открывающая Mini App
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://panzertg.online'
async function greet(chatId, lang) {
  await api('sendMessage', {
    chat_id: chatId,
    text: t('greet', lang),
    reply_markup: { inline_keyboard: [[{ text: t('greetButton', lang), web_app: { url: WEBAPP_URL } }]] },
  })
}

// сохранить язык юзера на профиле (если он уже есть) — для будущих пушей/счетов
async function storeLang(uid, lang) {
  const p = await loadProfile(uid)
  if (p && p.lang !== lang) {
    p.lang = lang
    await saveProfile(uid, p)
  }
}

// поллинг бота: подтверждаем pre_checkout и начисляем по successful_payment
export function startPaymentsLoop() {
  if (!hasBot()) {
    console.log('[pay] BOT_TOKEN не задан — платежи в dev-режиме (мгновенное начисление)')
    return
  }
  let offset = 0
  const tick = async () => {
    try {
      const res = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['pre_checkout_query', 'message'] })
      if (res.ok) {
        for (const u of res.result) {
          offset = u.update_id + 1
          if (u.pre_checkout_query) {
            await api('answerPreCheckoutQuery', { pre_checkout_query_id: u.pre_checkout_query.id, ok: true })
          }
          if (u.message && typeof u.message.text === 'string') {
            const text = u.message.text.trim()
            const chatId = u.message.chat.id
            const uid = `tg_${chatId}`
            const lang = pickLang(u.message.from && u.message.from.language_code)
            if (text.startsWith('/start')) {
              await setPushEnabled(uid, true) // /start = вовлечение → (пере)подписываем на уведомления
              await storeLang(uid, lang) // запомнить язык для пушей/счетов
              await greet(chatId, lang)
            } else if (text === '/stop' || text.startsWith('/stop')) {
              await setPushEnabled(uid, false)
              await api('sendMessage', { chat_id: chatId, text: t('stopConfirm', lang) })
            }
          }
          const sp = u.message && u.message.successful_payment
          if (sp) {
            const charge = sp.telegram_payment_charge_id
            if (await paymentSeen(charge)) continue
            const { uid, productId, name } = JSON.parse(sp.invoice_payload || '{}')
            if (uid && productId && (await grantProduct(uid, productId, { name }))) {
              await markPayment(charge, { uid, productId, stars: sp.total_amount })
              console.log(`[pay] ${uid} оплатил ${productId} (${sp.total_amount} XTR)`)
            }
          }
        }
      }
    } catch (e) {
      console.error('[pay] poll error', e.message)
    }
    setTimeout(tick, 1000)
  }
  tick()
  console.log('[pay] поллинг платежей Stars запущен')
}
