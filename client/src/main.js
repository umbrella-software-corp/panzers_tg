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
// статический сплэш (#boot0 из index.html) снимаем, когда Vue нарисовал свой (идентичный)
// сплэш — тот держится, пока прогреваются ассеты ангара. Двойной rAF = ждём кадр отрисовки.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const b = document.getElementById('boot0')
    if (b) b.remove()
  }),
)
startPresence() // отметка «онлайн», пока приложение на экране (даже в меню)
