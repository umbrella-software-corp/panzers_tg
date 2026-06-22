// Интеграция Telegram Mini App: безопасные зоны контейнера.
// Складываем device safe area + контент-зону Telegram (шапка/кнопки) в CSS-переменные.
// https://core.telegram.org/bots/webapps#contentsafeareainset

// Личность игрока из Telegram: ник профиля. Вне Telegram → null.
// Имя — first_name (как показывает Telegram), запасной вариант — @username.
export function tgUser() {
  let u =
    window.Telegram &&
    window.Telegram.WebApp &&
    window.Telegram.WebApp.initDataUnsafe &&
    window.Telegram.WebApp.initDataUnsafe.user
  // Фолбэк: SDK ещё не подгрузил initDataUnsafe → достаём user из raw launch-хеша,
  // чтобы tgUserId() (uid в бою, аналитика) не был null на медленном/старом клиенте.
  if (!u) u = userFromHash()
  if (!u) return null
  const name = String(u.first_name || u.username || '').trim()
  return name ? { id: u.id, name } : null
}

function userFromHash() {
  try {
    const raw = tgInitData()
    if (!raw) return null
    const userJson = new URLSearchParams(raw).get('user')
    return userJson ? JSON.parse(userJson) : null
  } catch {
    return null
  }
}

// Дождаться, пока Telegram populated RAW initData (он бывает доступен чуть позже самого
// WebApp). КРИТИЧНО: если первый авторизованный запрос (bootSync) уйдёт с пустым initData,
// api.headers() свалится в ГОСТЯ (x-guest-id → профиль под g_<random>, а не tg_<id>) —
// «будто не залогинился», в админке по tgId не найти, прогресс не привязан к ТГ.
// Ждём ТОЛЬКО если мы в Telegram; вне Telegram — сразу выходим (честный гость/дев).
// СЫРОЙ initData для авторизации: из SDK, иначе из raw launch-хеша (tgWebAppData),
// захваченного в index.html ДО telegram-web-app.js. На медленном/старом клиенте (iPhone 8,
// прокси) CDN-скрипт может не успеть/не дойти → SDK-поле пусто, а хеш есть сразу → спасает.
export function tgInitData() {
  const sdk = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData
  if (sdk) return sdk
  try {
    const hash = (window.__PZ_TG_HASH || window.location.hash || '').replace(/^#/, '')
    return new URLSearchParams(hash).get('tgWebAppData') || ''
  } catch {
    return ''
  }
}

export async function waitForInitData(timeoutMs = 2500) {
  if (tgInitData()) return true // SDK или хеш — уже есть, ждать нечего
  const inTg = !!(window.Telegram && window.Telegram.WebApp) || String(window.__PZ_TG_HASH || '').includes('tgWebAppData')
  if (!inTg) return false // не в Telegram — сразу гость/дев
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50))
    if (tgInitData()) return true
  }
  return !!tgInitData()
}

// id текущего игрока в Telegram (число) — для реферальных/взводных deep-link'ов
export function tgUserId() {
  const u = tgUser()
  return u ? u.id : null
}

// ЭКСПЕРИМЕНТ 3D: ОТКРЫТ ДЛЯ ВСЕХ (шоукейс, 2026-06-18). Тоггл «3D» в ангаре опт-ин
// (по умолчанию 2D). ⚠️ 3D-режим = 3 фикс-танка (Т-90/Leo/Abrams) без гейта владения —
// решение продакта (бесплатный топ-танк в обход экономики принят как цена за вау-эффект).
// Чтобы ВЕРНУТЬ гейт по тестерам — раскомментить тело ниже.
const TESTERS_3D = new Set([226201733, 6177596024, 1210592665, 485427336, 786379231, 71802606])
export function isTester3D() {
  return true
  // try {
  //   if (/localhost|127\.0\.0\.1/.test(location.hostname)) return true
  //   return TESTERS_3D.has(Number(tgUserId()))
  // } catch { return false }
}

// start_param из deep-link (?startapp=...): реферал «ref_<id>» или взвод «sq_<id>».
// Вне Telegram (dev в браузере) — можно подставить через ?tgWebAppStartParam=.
export function startParam() {
  const tg = window.Telegram && window.Telegram.WebApp
  const p = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param
  if (p) return String(p)
  try {
    return new URL(location.href).searchParams.get('tgWebAppStartParam') || null
  } catch {
    return null
  }
}

// deep-link на мини-апп с параметром запуска. Бот и (опц.) короткое имя апп —
// из env, дефолт @panzers_bot. Открывший ссылку получит param в start_param.
const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'panzers_bot'
const BOT_APP = import.meta.env.VITE_BOT_APP || ''
export function inviteLink(param) {
  const base = BOT_APP ? `https://t.me/${BOT_USERNAME}/${BOT_APP}` : `https://t.me/${BOT_USERNAME}`
  return `${base}?startapp=${encodeURIComponent(param)}`
}

// поделиться ссылкой: 1) нативный шэр Telegram (выбор чата), 2) буфер обмена,
// 3) не вышло. Возвращает 'share' | 'copied' | 'none' — UI подберёт тост.
export function shareLink(url, text = '') {
  const tg = window.Telegram && window.Telegram.WebApp
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  if (tg && typeof tg.openTelegramLink === 'function') {
    try {
      tg.openTelegramLink(share)
      return 'share'
    } catch {
      /* старый клиент — пробуем буфер ниже */
    }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
      return 'copied'
    }
  } catch {
    /* нет clipboard API */
  }
  return 'none'
}

// открыть саппорт-бота в личке: юзер пишет боту → разработчику падает в группу,
// ответ приходит обратно в эту же личку. Username не секрет — из env или дефолт.
const SUPPORT_BOT = import.meta.env.VITE_SUPPORT_BOT || 'punzers_support_bot'
export function openSupport() {
  const url = `https://t.me/${SUPPORT_BOT}`
  const tg = window.Telegram && window.Telegram.WebApp
  if (tg && typeof tg.openTelegramLink === 'function') {
    try {
      tg.openTelegramLink(url)
      return
    } catch {
      /* старый клиент — пробуем window.open ниже */
    }
  }
  try {
    window.open(url, '_blank')
  } catch {
    /* ничего не вышло */
  }
}

// открыть любую t.me-ссылку (канал/чат) внутри Telegram, с фоллбэком на window.open
export function openTelegramLink(url) {
  if (!url) return
  const tg = window.Telegram && window.Telegram.WebApp
  if (tg && typeof tg.openTelegramLink === 'function') {
    try {
      tg.openTelegramLink(url)
      return
    } catch {
      /* старый клиент — пробуем window.open ниже */
    }
  }
  try {
    window.open(url, '_blank')
  } catch {
    /* ничего не вышло */
  }
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

// тактильная отдача на событиях. Путь 1 — Telegram HapticFeedback (нужен Bot API
// 6.1+, единственный способ на iOS). Путь 2 — нативная navigator.vibrate (Android;
// на iOS не работает). Безопасно вне Telegram.
// kind: light|medium|heavy|rigid|soft (impact) | success|warning|error (notify) | select
const VIBE_MS = { select: 8, light: 12, soft: 12, medium: 22, rigid: 28, heavy: 40, success: 24, warning: 30, error: 45 }
export function haptic(kind = 'light') {
  const tg = window.Telegram && window.Telegram.WebApp
  const h = tg && tg.HapticFeedback
  // Telegram-хаптик — единственный, что работает на iOS. Гейт по версии УБРАН:
  // если HapticFeedback есть, просто пробуем (старый клиент кинет — ловим и идём
  // в нативную вибру). Версионный гейт раньше глушил отдачу на части клиентов.
  if (h) {
    try {
      if (kind === 'success' || kind === 'warning' || kind === 'error') h.notificationOccurred(kind)
      else if (kind === 'select') h.selectionChanged()
      else h.impactOccurred(kind)
      return
    } catch {
      /* старый клиент без impactOccurred — падаем в нативную вибрацию ниже */
    }
  }
  // фолбэк: нативная вибрация (Android и обычный браузер; на iOS — no-op)
  try {
    if (navigator.vibrate) navigator.vibrate(VIBE_MS[kind] || 15)
  } catch {
    /* вибро-API недоступно */
  }
}

// Запросить у юзера разрешение боту слать ему сообщения (нативный попап Telegram).
// КРИТИЧНО для пушей: бот НЕ может писать первым тем, кто открыл только Mini-App и
// не запускал /start. requestWriteAccess даёт это право без /start. Резолвится
// true, если разрешил. Вне Telegram / старый клиент — false.
export function requestWriteAccess() {
  return new Promise((resolve) => {
    try {
      const tg = window.Telegram && window.Telegram.WebApp
      if (tg && typeof tg.requestWriteAccess === 'function') tg.requestWriteAccess((ok) => resolve(!!ok))
      else resolve(false)
    } catch {
      resolve(false)
    }
  })
}

// нативный диалог-подтверждение Telegram (кастомный текст + OK/Отмена). Резолвится
// true, если нажал OK. Вне Telegram — true (чтобы прокликать флоу в браузере/dev).
export function tgConfirm(message) {
  return new Promise((resolve) => {
    try {
      const tg = window.Telegram && window.Telegram.WebApp
      if (tg && typeof tg.showConfirm === 'function') tg.showConfirm(String(message || ''), (ok) => resolve(!!ok))
      else resolve(true)
    } catch {
      resolve(true)
    }
  })
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
  // только телефоны: на десктопе/вебе fullscreen разворачивает игру на весь
  // монитор (раздражает) и портретная фиксация не нужна — там окно Telegram.
  const isMobile = tg.platform === 'android' || tg.platform === 'ios'
  try {
    tg.expand()
  } catch {
    /* старые клиенты */
  }
  // на весь экран (Bot API 8.0): скрывает шапку Telegram — игра занимает дисплей.
  // ТОЛЬКО на телефоне; на компе оставляем оконный режим (expand).
  // safe-area после этого считается через contentSafeAreaInset (apply ниже).
  try {
    if (isMobile && typeof tg.requestFullscreen === 'function' && (!tg.isVersionAtLeast || tg.isVersionAtLeast('8.0'))) {
      tg.requestFullscreen()
    }
  } catch {
    /* fullscreen не поддержан — остаёмся в expand */
  }
  // ТОЛЬКО вертикаль: на телефоне жёстко фиксируем портрет — иначе при повороте
  // вылезает узкая вертикальная колонка с чёрными полосами по бокам (некрасиво).
  // На ПК ориентацию не зафиксировать (это окно) — там вертикаль держит CSS-замок
  // #app (портретная колонка по центру).
  try {
    if (isMobile && typeof tg.lockOrientation === 'function') tg.lockOrientation('portrait')
  } catch {
    /* не поддержано — вертикаль всё равно держит CSS-колонка #app */
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
