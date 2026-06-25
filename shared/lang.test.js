import test from 'node:test'
import assert from 'node:assert/strict'

import {
  forcedLocaleForTelegramUser,
  pickLangForTelegramUser,
  resolveClientLocale,
} from './lang.js'

test('forces Russian for the satrialeops Telegram account', () => {
  assert.equal(forcedLocaleForTelegramUser({ id: 6177596024, language_code: 'en' }), 'ru')
  assert.equal(pickLangForTelegramUser({ id: 6177596024, language_code: 'en' }), 'ru')
})

test('keeps normal Telegram language detection for other users', () => {
  assert.equal(forcedLocaleForTelegramUser({ id: 111, language_code: 'en' }), null)
  assert.equal(pickLangForTelegramUser({ id: 111, language_code: 'en' }), 'en')
  assert.equal(pickLangForTelegramUser({ id: 111, language_code: 'ru-RU' }), 'ru')
})

test('keeps explicit URL language override above account override for QA', () => {
  assert.equal(resolveClientLocale({ forcedParam: 'en', telegramUser: { id: 6177596024, language_code: 'en' } }), 'en')
  assert.equal(resolveClientLocale({ forcedParam: 'ru', telegramUser: { id: 111, language_code: 'en' } }), 'ru')
})

test('applies account override before campaign and device detection', () => {
  assert.equal(resolveClientLocale({ telegramUser: { id: 6177596024, language_code: 'en' }, startParam: 'src_ads_en', navigatorLanguage: 'en-US' }), 'ru')
  assert.equal(resolveClientLocale({ telegramUser: { id: 111, language_code: 'en' }, startParam: 'src_ads_ru', navigatorLanguage: 'en-US' }), 'ru')
})
