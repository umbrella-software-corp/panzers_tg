import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { initTelegram } from './tg.js'
import { initLocale, getLocale } from './i18n.js'
import { initAnalytics, track } from './analytics.js'
import { startPresence } from './api.js'

initTelegram()
initLocale() // язык интерфейса по Telegram language_code (ru* → ru, иначе en) — ДО mount
initAnalytics()
track('app_opened', { locale: getLocale() })
createApp(App).mount('#app')
startPresence() // отметка «онлайн», пока приложение на экране (даже в меню)
