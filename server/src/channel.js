// «Подпишись на канал → бонус» (набор тестеров): РАЗОВАЯ выдача кредитов/жетонов
// с НАСТОЯЩЕЙ проверкой подписки через getChatMember (как в support.js — бот ДОЛЖЕН
// быть админом канала, иначе Telegram не отдаёт статус участника). Награда разовая:
// флаг channelBonusClaimed в профиле — серверное поле, клиентский сейв его не сбрасывает
// (index.js защищает его в merge, как reachedBattle/premiumUntil). Это значит, что
// подчистка localStorage НЕ позволяет забрать бонус повторно — выдаёт только сервер.
//
// Фича ВЫКЛЮЧЕНА, пока не задан CHANNEL_ID (env). Тогда channelEnabled() === false →
// /api/config отдаёт on:false → клиент прячет кнопку, эндпоинт возвращает { disabled }.
import { botToken, hasBot } from './auth.js'
import { loadProfile, saveProfile } from './db.js'

const CHANNEL_ID = process.env.CHANNEL_ID || '' // @username ИЛИ -100…; пусто = фича выключена
// ссылка для кнопки «Подписаться»: явный CHANNEL_URL, иначе соберём из @username
const CHANNEL_URL =
  process.env.CHANNEL_URL || (CHANNEL_ID.startsWith('@') ? `https://t.me/${CHANNEL_ID.slice(1)}` : '')
const REWARD_CREDITS = +(process.env.CHANNEL_BONUS_CREDITS || 5000)
const REWARD_TOKENS = +(process.env.CHANNEL_BONUS_TOKENS || 50)

// статусы getChatMember, считающиеся «подписан»; left/kicked/restricted — нет
const MEMBER_OK = new Set(['member', 'administrator', 'creator'])

const tgIdOf = (uid) => {
  const m = /^tg_(\d{3,20})$/.exec(uid || '')
  return m ? m[1] : null
}

export const channelEnabled = () => !!CHANNEL_ID
// публичный конфиг для клиента (через /api/config): включена ли фича, ссылка, размер награды
export const channelConfig = () => ({
  on: channelEnabled(),
  url: CHANNEL_URL,
  credits: REWARD_CREDITS,
  tokens: REWARD_TOKENS,
})

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
    .then((r) => r.json())
    .catch(() => ({ ok: false }))

// подписан ли tgId на наш канал. Без бота (локальная разработка) — считаем что да,
// чтобы прокликать флоу; в проде статус решает getChatMember.
export async function isSubscribed(tgId) {
  if (!hasBot()) return true
  if (!CHANNEL_ID || !tgId) return false
  const r = await api('getChatMember', { chat_id: CHANNEL_ID, user_id: Number(tgId) })
  return !!(r && r.ok && r.result && MEMBER_OK.has(r.result.status))
}

// РАЗОВАЯ выдача бонуса за подписку. Возвращает один из:
//  { ok:true, granted:{credits,tokens} } — начислили;
//  { already:true } — уже забирал;
//  { subscribed:false } — ещё не подписан (или бот не админ канала);
//  { disabled:true } — фича выключена (нет CHANNEL_ID).
export async function claimChannelBonus(uid) {
  if (!channelEnabled()) return { disabled: true }
  const profile = (await loadProfile(uid)) || {}
  if (profile.channelBonusClaimed) return { already: true }
  if (!(await isSubscribed(tgIdOf(uid)))) return { subscribed: false }
  // начисляем прямо в профиль (как grantProduct в payments.js) и ставим флаг — клиент
  // после ответа дёрнет syncProfile() и подтянет новый баланс (как после покупки за Stars).
  profile.credits = (profile.credits || 0) + REWARD_CREDITS
  profile.tokens = (profile.tokens || 0) + REWARD_TOKENS
  profile.channelBonusClaimed = true
  await saveProfile(uid, profile)
  return { ok: true, granted: { credits: REWARD_CREDITS, tokens: REWARD_TOKENS } }
}
