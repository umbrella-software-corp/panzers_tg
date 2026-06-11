// Платежи Telegram Stars (XTR): createInvoiceLink + поллинг getUpdates для
// pre_checkout_query и successful_payment. Товары — серверный каталог
// (клиентским ценам не верим). Идемпотентность по telegram charge id.
import { botToken, hasBot } from './auth.js'
import { loadProfile, saveProfile, paymentSeen, markPayment, listPayments, markRefunded } from './db.js'

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
  const res = await api('createInvoiceLink', {
    title: p.title,
    description: p.rename ? `Panzer TG · новый позывной «${name}»` : `Panzer TG · ${p.title}`,
    payload: JSON.stringify(name ? { uid, productId, name } : { uid, productId }),
    currency: 'XTR',
    prices: [{ label: p.title, amount: p.stars }],
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
    await saveProfile(rec.uid, profile)
  }
  await markRefunded(charge)
  console.log(`[pay] РЕФАНД ${rec.uid} · ${rec.productId} · ${rec.stars} XTR возвращены`)
  return { ok: true, stars: rec.stars }
}

// приветствие бота: на /start — кнопка, открывающая Mini App
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://panzertg.online'
async function greet(chatId) {
  await api('sendMessage', {
    chat_id: chatId,
    text: 'Panzer TG — танковые бои 7×7 прямо в Telegram. Жми «Играть» и в бой! 🎖',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: WEBAPP_URL } }]] },
  })
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
          if (u.message && typeof u.message.text === 'string' && u.message.text.startsWith('/start')) {
            await greet(u.message.chat.id)
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
