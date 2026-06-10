// Интеграция Telegram Mini App: безопасные зоны контейнера.
// Складываем device safe area + контент-зону Telegram (шапка/кнопки) в CSS-переменные.
// https://core.telegram.org/bots/webapps#contentsafeareainset
export function initTelegram() {
  const tg = window.Telegram && window.Telegram.WebApp
  const root = document.documentElement

  const apply = () => {
    const sa = (tg && tg.safeAreaInset) || { top: 0, right: 0, bottom: 0, left: 0 }
    const csa = (tg && tg.contentSafeAreaInset) || { top: 0, right: 0, bottom: 0, left: 0 }
    root.style.setProperty('--tg-top', sa.top + csa.top + 'px')
    root.style.setProperty('--tg-bottom', sa.bottom + csa.bottom + 'px')
    root.style.setProperty('--tg-left', sa.left + csa.left + 'px')
    root.style.setProperty('--tg-right', sa.right + csa.right + 'px')
  }

  if (!tg) {
    apply() // браузер: нули, layout падает на env(safe-area-inset-*)
    return
  }

  tg.ready()
  try {
    tg.expand()
  } catch {
    /* старые клиенты */
  }
  // на весь экран (Bot API 8.0): скрывает шапку Telegram — игра занимает дисплей.
  // safe-area после этого считается через contentSafeAreaInset (apply ниже).
  try {
    if (typeof tg.requestFullscreen === 'function' && (!tg.isVersionAtLeast || tg.isVersionAtLeast('8.0'))) {
      tg.requestFullscreen()
    }
  } catch {
    /* fullscreen не поддержан — остаёмся в expand */
  }
  // вертикальная фиксация ориентации, если клиент умеет
  try {
    if (typeof tg.lockOrientation === 'function') tg.lockOrientation('portrait')
  } catch {
    /* не поддержано */
  }
  apply()
  tg.onEvent('safeAreaChanged', apply)
  tg.onEvent('contentSafeAreaChanged', apply)
  tg.onEvent('viewportChanged', apply)
  tg.onEvent('fullscreenChanged', apply)
}
