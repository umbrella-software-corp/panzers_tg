// @satrialeops: keep the game Russian even if Telegram/device UI is English.
export const FORCE_RU_TG_IDS = new Set(['6177596024'])

export function pickLang(code) {
  return String(code || '').toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export function telegramUserId(user) {
  const id = user && user.id
  return id == null ? '' : String(id).trim()
}

export function forcedLocaleForTelegramUser(user) {
  return FORCE_RU_TG_IDS.has(telegramUserId(user)) ? 'ru' : null
}

export function pickLangForTelegramUser(user) {
  return forcedLocaleForTelegramUser(user) || pickLang(user && user.language_code)
}

export function campaignLocaleFromStartParam(startParam) {
  const sp = String(startParam || '')
  if (/(^|[_-])ru$/i.test(sp)) return 'ru'
  if (/(^|[_-])en$/i.test(sp)) return 'en'
  return null
}

export function resolveClientLocale({ forcedParam, telegramUser, startParam, navigatorLanguage } = {}) {
  if (forcedParam === 'ru' || forcedParam === 'en') return forcedParam
  const accountOverride = forcedLocaleForTelegramUser(telegramUser)
  if (accountOverride) return accountOverride
  return campaignLocaleFromStartParam(startParam) || pickLang((telegramUser && telegramUser.language_code) || navigatorLanguage)
}
