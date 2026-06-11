// Интеграция Telegram Mini App: безопасные зоны контейнера.
// Складываем device safe area + контент-зону Telegram (шапка/кнопки) в CSS-переменные.
// https://core.telegram.org/bots/webapps#contentsafeareainset

// Личность игрока из Telegram: ник профиля. Вне Telegram → null.
// Имя — first_name (как показывает Telegram), запасной вариант — @username.
export function tgUser() {
  const u =
    window.Telegram &&
    window.Telegram.WebApp &&
    window.Telegram.WebApp.initDataUnsafe &&
    window.Telegram.WebApp.initDataUnsafe.user
  if (!u) return null
  const name = String(u.first_name || u.username || '').trim()
  return name ? { id: u.id, name } : null
}

// текущий обработчик кнопки «Назад» (его дёргает единый onClick из initTelegram)
let backHandler = null

// Управление кнопкой «Назад» Telegram. Передать функцию — кнопка показана и
// по нажатию делает навигацию внутри игры; передать null — спрятать (на корне
// «назад» штатно сворачивает мини-апп).
export function setBackButton(handler) {
  backHandler = typeof handler === 'function' ? handler : null
  const bb = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.BackButton
  if (!bb) return
  try {
    if (backHandler) bb.show()
    else bb.hide()
  } catch {
    /* старый клиент без BackButton */
  }
}

// тактильная отдача Telegram (вибрация на событиях). Безопасно вне Telegram.
// kind: light|medium|heavy|rigid|soft (impact) | success|warning|error (notify) | select
export function haptic(kind = 'light') {
  try {
    const h = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback
    if (!h) return
    if (kind === 'success' || kind === 'warning' || kind === 'error') h.notificationOccurred(kind)
    else if (kind === 'select') h.selectionChanged()
    else h.impactOccurred(kind)
  } catch {
    /* старый клиент без HapticFeedback */
  }
}

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
  // свайп вниз не должен сворачивать игру (особенно в бою — джойстик/огонь)
  try {
    if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes()
  } catch {
    /* старый клиент */
  }
  // кнопка «Назад» Telegram: один обработчик, вызывает текущий backHandler.
  // Без этого «назад»/свайп сворачивает мини-апп вместо навигации внутри игры.
  try {
    if (tg.BackButton) tg.BackButton.onClick(() => backHandler && backHandler())
  } catch {
    /* нет BackButton */
  }
  apply()
  tg.onEvent('safeAreaChanged', apply)
  tg.onEvent('contentSafeAreaChanged', apply)
  tg.onEvent('viewportChanged', apply)
  tg.onEvent('fullscreenChanged', apply)
}
