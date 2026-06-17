// «Нам важно ваше мнение → +50 жетонов»: РАЗОВАЯ выдача, когда игрок РЕАЛЬНО написал
// в саппорт-бот (флаг wroteSupport ставит support.js на входящем сообщении игрока).
// Флаги серверные (wroteSupport/feedbackClaimed) — клиентский сейв их не сбрасывает
// (защита в index.js merge, как channelBonusClaimed/reachedBattle), localStorage не читерит.
// Включена по умолчанию; FEEDBACK_OFF=1 — выключить.
import { loadProfile, saveProfile, withProfileLock } from './db.js'

let grantSeq = 0 // уникальный хвост id гранта бонуса
const REWARD_TOKENS = +(process.env.FEEDBACK_BONUS_TOKENS || 50)
const REWARD_CREDITS = +(process.env.FEEDBACK_BONUS_CREDITS || 0)
const ENABLED = process.env.FEEDBACK_OFF !== '1'
const isTg = (uid) => /^tg_\d{3,20}$/.test(uid || '')

export const feedbackEnabled = () => ENABLED
// публичный конфиг для клиента (через /api/config): включена ли фича и размер награды
export const feedbackConfig = () => ({ on: ENABLED, tokens: REWARD_TOKENS, credits: REWARD_CREDITS })

// support.js зовёт, когда игрок написал в саппорт-бот → ставим флаг. wroteMem гасит
// повторные записи; нет профиля ещё (написал до захода в игру) — НЕ кэшируем, пометим
// со следующим сообщением.
const wroteMem = new Set()
export async function markWroteSupport(uid) {
  if (!uid || !isTg(uid) || wroteMem.has(uid)) return
  return withProfileLock(uid, async () => {
    try {
      const p = await loadProfile(uid)
      if (!p) return
      wroteMem.add(uid)
      if (p.wroteSupport) return
      p.wroteSupport = true
      await saveProfile(uid, p)
    } catch {
      /* гонка/битый профиль — не критично */
    }
  })
}

// РАЗОВАЯ выдача за фидбек. Возвращает один из:
//  { ok:true, granted:{credits,tokens} } — начислили;
//  { already:true } — уже забирал;
//  { wrote:false } — ещё не писал в поддержку;
//  { disabled:true } — фича выключена (FEEDBACK_OFF=1).
export async function claimFeedbackBonus(uid) {
  if (!ENABLED) return { disabled: true }
  return withProfileLock(uid, async () => {
    const p = (await loadProfile(uid)) || {}
    if (p.feedbackClaimed) return { already: true }
    if (!p.wroteSupport) return { wrote: false }
    // валюту — через pendingGrants (kind:'bonus'), чтобы клиентский сейв профиля её не
    // затёр; клиент заберёт атомарно на syncProfile. У шита фидбека своя кнопка-итог.
    if (REWARD_CREDITS || REWARD_TOKENS) {
      if (!Array.isArray(p.pendingGrants)) p.pendingGrants = []
      p.pendingGrants.push({ id: 'fb.' + Date.now() + '.' + ++grantSeq, kind: 'bonus', credits: REWARD_CREDITS, tokens: REWARD_TOKENS, tanks: [], at: Date.now() })
    }
    p.feedbackClaimed = true
    await saveProfile(uid, p)
    return { ok: true, granted: { credits: REWARD_CREDITS, tokens: REWARD_TOKENS } }
  })
}
