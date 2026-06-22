import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// УНИКАЛЬНЫЙ ID СБОРКИ: git-хеш (если доступен) + время билда. Компилится в клиент
// (__BUILD_ID__) И пишется в dist/build-id.txt — сервер отдаёт его в /api/config.
// Клиент сверяет свой __BUILD_ID__ с серверным и перезагружается, если устарел
// (залипший бандл в кэше Telegram/браузера) — #23 «у меня старая версия».
let gitHash = 'nogit'
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  /* не git-репо / git недоступен — ок, хватит времени */
}
const BUILD_ID = `${gitHash}.${Date.now()}`

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'pz-build-id',
      apply: 'build',
      closeBundle() {
        try {
          writeFileSync('dist/build-id.txt', BUILD_ID)
        } catch {
          /* не критично — версионный гейт просто не сработает */
        }
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 5173,
  },
})
