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
  apply()
  tg.onEvent('safeAreaChanged', apply)
  tg.onEvent('contentSafeAreaChanged', apply)
  tg.onEvent('viewportChanged', apply)
}
