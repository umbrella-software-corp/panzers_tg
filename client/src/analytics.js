// Amplitude beta-трекинг. Источник правды по canvas/боям — РУЧНЫЕ события,
// не autocapture. НЕ шлём: initData, raw username/first_name, invoice/charge id,
// полный URL и raw start_param, и НИКАКИХ per-tick/per-frame событий.
import * as amplitude from '@amplitude/analytics-browser'
import { startParam, tgUserId } from './tg.js'

let ready = false
let pendingUserId = null

function tg() {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp : null
}

// источник трафика из start_param: только безобидный тег (ref/sq — отдельная ветка),
// без сырого значения. Нормализуем и режем до 32 символов.
function cleanSourceTag(sp) {
  if (!sp || typeof sp !== 'string') return null
  if (/^(ref|sq)_/i.test(sp)) return null
  const tag = sp
    .replace(/^s(rc)?[-_]/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32)
  return tag || null
}

function startParamKind(sp) {
  if (!sp) return 'none'
  if (/^ref_/i.test(sp)) return 'ref'
  if (/^sq_/i.test(sp)) return 'squad'
  return 'source'
}

function commonProps(extra = {}) {
  const webapp = tg()
  const sp = startParam()
  return {
    app: 'panzers_tg',
    env: import.meta.env.MODE || 'production',
    platform: webapp ? 'telegram' : 'browser',
    tg_platform: webapp?.platform || 'unknown',
    user_type: tgUserId() ? 'telegram' : 'guest',
    start_param_kind: startParamKind(sp),
    source_tag: cleanSourceTag(sp),
    // инцентивированный реф-заход (реферер вознаграждается за приведённого → риск
    // «фермы»): тег на КАЖДОМ событии сессии входа, чтобы вычитать ферму из воронки
    incentivized: startParamKind(sp) === 'ref',
    ...extra,
  }
}

export function initAnalytics() {
  if (ready || typeof window === 'undefined') return
  const key = import.meta.env.VITE_AMPLITUDE_API_KEY
  if (!key) return // ключ не задан — трекинг молча выключен (dev/локалка)

  // first-party прокси: блокировщики трекеров (EasyPrivacy и пр.) режут прямой
  // api2.amplitude.com → шлём события на свой домен (nginx /amp/ проксирует туда).
  // В dev переменная не задана → SDK бьёт напрямую (локально блокировщиков нет).
  const serverUrl = import.meta.env.VITE_AMPLITUDE_PROXY || undefined

  amplitude.init(key, undefined, {
    serverUrl,
    defaultTracking: {
      sessions: true,
      pageViews: false,
      formInteractions: false,
      fileDownloads: false,
    },
  })

  ready = true
  if (pendingUserId) amplitude.setUserId(pendingUserId)

  // Flush на закрытии вебвью. Telegram-мини-апп закрывается без надёжного
  // beforeunload → очередь Amplitude не успевает уйти (теряется ~12-18% событий).
  // На переход в hidden шлём очередь через sendBeacon (переживает выгрузку);
  // вернулись на передний план — возвращаем обычный fetch-транспорт.
  const flushBeacon = () => {
    try {
      amplitude.setTransport('beacon')
      amplitude.flush()
    } catch {
      /* транспорт/флаш недоступен — не роняем приложение */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBeacon()
    else {
      try {
        amplitude.setTransport('fetch')
      } catch {
        /* no-op */
      }
    }
  })
  // pagehide — последний надёжный сигнал перед выгрузкой (iOS Safari/вебвью)
  window.addEventListener('pagehide', flushBeacon)
}

export function setAnalyticsUserId(uid) {
  if (!uid) return
  pendingUserId = String(uid)
  if (ready) amplitude.setUserId(pendingUserId)
}

export function identifyUser(props = {}) {
  if (!ready) return
  const identify = new amplitude.Identify()
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined && value !== null) identify.set(key, value)
  }
  amplitude.identify(identify)
}

// Первичная атрибуция источника как СТИКИ user-property (setOnce — не
// перетираем на следующих сессиях). Даёт когорту на весь lifecycle игрока:
// вычитать реф-ферму можно из всей воронки, а не только из событий с start_param
// (на возвратах его уже нет). ref = инцентивированный (реферер вознаграждается).
export function identifyAcquisition() {
  if (!ready) return
  const sp = startParam()
  const kind = startParamKind(sp)
  const id = new amplitude.Identify()
  id.setOnce('acq_kind', kind) // none | ref | squad | source
  id.setOnce('acq_source_tag', cleanSourceTag(sp) || 'none')
  id.setOnce('acq_incentivized', kind === 'ref')
  id.set('last_entry_kind', kind) // текущий вход (видеть возвраты по другим ссылкам)
  amplitude.identify(id)
}

export function track(eventType, props = {}) {
  if (!ready || !eventType) return
  amplitude.track(eventType, commonProps(props))
}

export function trackScreen(screen, prevScreen) {
  track('screen_viewed', {
    screen,
    prev_screen: prevScreen || null,
  })
}
