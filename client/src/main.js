import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { initTelegram } from './tg.js'
import { initAnalytics, track } from './analytics.js'

initTelegram()
initAnalytics()
track('app_opened')
createApp(App).mount('#app')
