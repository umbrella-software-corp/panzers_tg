// Лёгкий i18n без зависимостей (в стиле кастомного store.js). Язык выбирается
// АВТОМАТИЧЕСКИ по Telegram: language_code === 'ru*' → русский, всё прочее →
// английский. Ручного переключателя нет — это сознательное решение (см. задачу).
//
// Словари — в locales/ (по доменам). t('ns.key', params) ищет строку в активном
// языке, при промахе падает в английский, затем возвращает сам ключ (видно в UI,
// что забыли перевести). Значение в словаре может быть СТРОКОЙ (с плейсхолдерами
// {name}) или ФУНКЦИЕЙ (params) => string — функции закрывают сложные случаи:
// русские множественные числа, род («повреждён/повреждена»), конкатенацию.
import { dicts } from './locales/index.js'
import { resolveClientLocale } from 'panzer-tg-shared/lang.js'

const FALLBACK = 'en'
let _locale = FALLBACK // выставляется initLocale() до mount (см. main.js)

function tgLaunchUser() {
  try {
    const tg = window.Telegram && window.Telegram.WebApp
    const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user
    if (u) return u
  } catch {
    /* нет Telegram */
  }
  try {
    const hash = (window.__PZ_TG_HASH || window.location.hash || '').replace(/^#/, '')
    const initData = new URLSearchParams(hash).get('tgWebAppData') || ''
    const userJson = initData ? new URLSearchParams(initData).get('user') : ''
    return userJson ? JSON.parse(userJson) : null
  } catch {
    return null
  }
}

function tgLaunchStartParam() {
  try {
    const tg = window.Telegram && window.Telegram.WebApp
    const sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param
    if (sp) return String(sp)
  } catch {
    /* нет Telegram */
  }
  try {
    const hash = (window.__PZ_TG_HASH || window.location.hash || '').replace(/^#/, '')
    const initData = new URLSearchParams(hash).get('tgWebAppData') || ''
    return initData ? new URLSearchParams(initData).get('start_param') || '' : ''
  } catch {
    return ''
  }
}

// ru* → 'ru', всё остальное → 'en'. Источники по приоритету: ?lang= (для dev/QA),
// персональный оверрайд аккаунта, ЯЗЫК КАМПАНИИ из start_param, Telegram language_code,
// navigator.language. Любой нераспознанный код → английский.
export function detectLocale() {
  let forced = ''
  try {
    forced = new URL(location.href).searchParams.get('lang') || ''
  } catch {
    /* нет location — серверный/тестовый контекст */
  }
  let nav = ''
  try {
    nav = (typeof navigator !== 'undefined' && navigator.language) || ''
  } catch {
    /* нет navigator */
  }
  return resolveClientLocale({ forcedParam: forced, telegramUser: tgLaunchUser(), startParam: tgLaunchStartParam(), navigatorLanguage: nav })
}

// вызвать ОДИН раз на старте (main.js), до createApp().mount() — чтобы первый
// рендер уже был на нужном языке. Возвращает выбранный код.
export function initLocale() {
  _locale = detectLocale()
  try {
    document.documentElement.lang = _locale
  } catch {
    /* нет document */
  }
  return _locale
}

export const getLocale = () => _locale
export const isRu = () => _locale === 'ru'

function lookup(dict, key) {
  let node = dict
  for (const part of key.split('.')) {
    if (node == null) return undefined
    node = node[part]
  }
  return node
}

// основной геттер строки. key — 'namespace.path.to.string'. params — объект
// для подстановки {placeholder} или аргумент функции-значения.
export function t(key, params) {
  const dict = dicts[_locale] || dicts[FALLBACK]
  let val = lookup(dict, key)
  if (val === undefined && _locale !== FALLBACK) val = lookup(dicts[FALLBACK], key)
  if (val === undefined) return key // ключ не найден ни в одном словаре — виден в UI
  if (typeof val === 'function') return val(params || {})
  if (typeof val === 'string' && params) {
    return val.replace(/\{(\w+)\}/g, (m, name) => (params[name] != null ? params[name] : m))
  }
  return val
}

// выбор множественной формы. Английский: one | other. Русский: one | few | many.
// forms = { one, few, many } (для en few/many игнорируются — берётся other||many||few).
export function plural(n, forms) {
  const abs = Math.abs(Number(n) || 0)
  if (_locale === 'ru') {
    const mod10 = abs % 10
    const mod100 = abs % 100
    if (mod10 === 1 && mod100 !== 11) return forms.one
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms.few
    return forms.many
  }
  return abs === 1 ? forms.one : forms.other != null ? forms.other : forms.many
}

// число с разделителями групп по локали ("1 000 000" ru / "1,000,000" en)
export function fmtNum(n) {
  try {
    return Number(n).toLocaleString(_locale === 'ru' ? 'ru-RU' : 'en-US')
  } catch {
    return String(n)
  }
}

// КОМПАКТНОЕ число для тесных чипов шапки: 6 006 956 → «6М», 10125 → «10,1к».
// До 10 000 — обычная запись (коротко и точно). От 10к — к (тысячи), от 1М — М (млн),
// одна значащая дробь без хвостового «,0». RU: к/М и запятая; EN: k/M и точка.
export function fmtShort(n) {
  const x = Number(n)
  if (!isFinite(x)) return String(n)
  const ru = _locale === 'ru'
  const one = (v, suf) => {
    let s = (Math.round(v * 10) / 10).toFixed(1) // одна дробь
    if (s.endsWith('.0')) s = s.slice(0, -2) // 6.0 → 6
    return (ru ? s.replace('.', ',') : s) + suf
  }
  const a = Math.abs(x)
  if (a >= 1e6) return one(x / 1e6, ru ? 'М' : 'M')
  if (a >= 1e4) return one(x / 1e3, ru ? 'к' : 'k')
  return fmtNum(x)
}

// дата боя в истории — короткая, локализованная
export function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(_locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}
