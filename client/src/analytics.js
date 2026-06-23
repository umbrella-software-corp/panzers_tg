// Amplitude beta-трекинг. Источник правды по canvas/боям — РУЧНЫЕ события,
// не autocapture. НЕ шлём: initData, raw username/first_name, invoice/charge id,
// полный URL и raw start_param, и НИКАКИХ per-tick/per-frame событий.
import * as amplitude from '@amplitude/analytics-browser'
import { startParam, tgUserId, tgInitData } from './tg.js'

let ready = false
let pendingUserId = null
let firstInteractiveTracked = false
let hangarInteractiveTracked = false
let refEntryDetectedTracked = false
let refEntryShownTracked = false
let latestScreen = null
let firstInteractiveContext = null
let refEntryShownContext = null
let interactiveObserver = null
let interactivePoll = null
let interactiveWaiters = []

function tg() {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp : null
}

function buildId() {
  try {
    return typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null
  } catch {
    return null
  }
}

function startParamFromInitData() {
  try {
    const raw = tgInitData()
    return raw ? new URLSearchParams(raw).get('start_param') || null : null
  } catch {
    return null
  }
}

function startParamFromLaunchHash() {
  try {
    const hash = String(window.__PZ_TG_HASH || window.location.hash || '').replace(/^#/, '')
    return new URLSearchParams(hash).get('tgWebAppStartParam') || null
  } catch {
    return null
  }
}

// startParam() исторически читает SDK initDataUnsafe и dev-query. Для аналитики входа
// важно покрыть и SDK-empty Telegram-клиенты: там start_param лежит в сохранённом
// tgWebAppData hash, который уже умеет читать tgInitData().
function effectiveStartParam() {
  return startParam() || startParamFromInitData() || startParamFromLaunchHash()
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

function currentStartParamKind() {
  return startParamKind(effectiveStartParam())
}

function commonProps(extra = {}) {
  const webapp = tg()
  const sp = effectiveStartParam()
  const kind = startParamKind(sp)
  return {
    app: 'panzers_tg',
    env: import.meta.env.MODE || 'production',
    build_id: buildId(),
    platform: webapp ? 'telegram' : 'browser',
    tg_platform: webapp?.platform || 'unknown',
    user_type: tgUserId() ? 'telegram' : 'guest',
    start_param_kind: kind,
    source_tag: cleanSourceTag(sp),
    // инцентивированный реф-заход (реферер вознаграждается за приведённого → риск
    // «фермы»): тег на КАЖДОМ событии сессии входа, чтобы вычитать ферму из воронки
    incentivized: kind === 'ref',
    ...extra,
  }
}

function blockingOverlayPresent() {
  if (typeof document === 'undefined') return false
  return !!(
    document.getElementById('boot0') ||
    document.querySelector('.bootsplash') ||
    document.querySelector('.auth-ovl') ||
    document.visibilityState === 'hidden'
  )
}

function appInteractiveNow() {
  if (typeof document === 'undefined') return true
  return !blockingOverlayPresent()
}

function stopInteractivePoll() {
  if (!interactivePoll) return
  clearInterval(interactivePoll)
  interactivePoll = null
}

function flushInteractiveWaiters() {
  if (!appInteractiveNow()) return
  const waiters = interactiveWaiters.splice(0)
  for (const run of waiters) run()
  if (!interactiveWaiters.length) stopInteractivePoll()
}

function startInteractivePoll() {
  if (interactivePoll || typeof window === 'undefined') return
  interactivePoll = window.setInterval(() => {
    if (!interactiveWaiters.length) return stopInteractivePoll()
    flushInteractiveWaiters()
  }, 1000)
}

function ensureInteractiveWatch() {
  if (typeof document === 'undefined' || !document.body || interactiveObserver) return
  try {
    interactiveObserver = new MutationObserver(flushInteractiveWaiters)
    interactiveObserver.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('visibilitychange', flushInteractiveWaiters)
    window.addEventListener('pageshow', flushInteractiveWaiters)
  } catch {
    /* MutationObserver может быть недоступен в старом webview — поможет poll ниже */
  }
}

function enqueueInteractiveWaiter(run) {
  interactiveWaiters.push(run)
  ensureInteractiveWatch()
  startInteractivePoll()
}

// Некоторые события компонентов монтируются под boot/auth оверлеями. Для воронок первой
// сессии нужен момент, когда игрок реально увидел интерактивный экран, а не когда Vue
// смонтировал Hangar под сплэшем.
function afterInteractive(fn) {
  if (typeof document === 'undefined') return fn()
  let done = false
  const run = () => {
    if (done || !appInteractiveNow()) return
    done = true
    fn()
  }
  if (appInteractiveNow()) {
    setTimeout(() => {
      if (appInteractiveNow()) run()
      else enqueueInteractiveWaiter(run)
    }, 0)
    return
  }
  enqueueInteractiveWaiter(run)
}

function enrichProps(eventType, props = {}) {
  const out = { ...props }
  if (eventType === 'battle_exit_clicked' && out.exit_context === undefined) {
    if (out.before_finish === true) out.exit_context = out.player_alive === false ? 'early_after_death' : 'early_alive'
    else if (out.result_known) out.exit_context = 'after_finish_or_results'
    else out.exit_context = 'unknown'
  }
  return out
}

function trackRaw(eventType, props = {}) {
  if (!ready || !eventType) return
  amplitude.track(eventType, commonProps(props))
}

function setFirstInteractiveContext(screenHint, props = {}) {
  const prev = firstInteractiveContext || {}
  const screen = latestScreen || screenHint || props.screen || prev.screen || null
  firstInteractiveContext = {
    screen,
    prev_screen: props.prev_screen ?? prev.prev_screen ?? null,
    battles_count: props.battles_count ?? prev.battles_count ?? null,
    // Первым в очередь часто попадает технический hangar_viewed под boot splash, а уже
    // потом авто-тренировка переводит новичка в matchmaking. Не даём раннему waiter'у
    // затереть факт training_auto=false.
    training_auto: !!props.training_auto || !!prev.training_auto,
    source_event: props.source_event || prev.source_event || null,
  }
}

function setRefEntryShownContext(screenHint, props = {}) {
  if (currentStartParamKind() !== 'ref') return
  const prev = refEntryShownContext || {}
  refEntryShownContext = {
    screen: latestScreen || screenHint || props.screen || prev.screen || null,
    battles_count: props.battles_count ?? prev.battles_count ?? null,
    training_auto: !!props.training_auto || !!prev.training_auto,
  }
}

function trackFirstInteractive(screenHint, props = {}) {
  setFirstInteractiveContext(screenHint, props)
  if (firstInteractiveTracked) return
  afterInteractive(() => {
    if (firstInteractiveTracked) return
    firstInteractiveTracked = true
    const ctx = firstInteractiveContext || {}
    trackRaw('first_interactive_screen_shown', {
      screen: latestScreen || ctx.screen || screenHint || props.screen || null,
      prev_screen: ctx.prev_screen || null,
      battles_count: ctx.battles_count ?? null,
      training_auto: !!ctx.training_auto,
      source_event: ctx.source_event || null,
    })
  })
}

function trackHangarInteractive(props = {}) {
  if (hangarInteractiveTracked) return
  afterInteractive(() => {
    // Hangar может смонтироваться под boot splash, а потом авто-тренировка переключит экран
    // до снятия оверлея. Не считаем такой технический mount реальным просмотром ангара.
    if (hangarInteractiveTracked || latestScreen !== 'hangar') return
    hangarInteractiveTracked = true
    trackRaw('hangar_interactive_viewed', {
      selected_tank: props.selected_tank || null,
      tank_tier: props.tank_tier || null,
      tank_class: props.tank_class || null,
      battle_mode: props.battle_mode || null,
      battles_count: props.battles_count ?? null,
      party_present: !!props.party_present,
    })
  })
}

function trackRefEntryShown(screenHint, props = {}) {
  if (currentStartParamKind() !== 'ref') return
  setRefEntryShownContext(screenHint, props)
  if (refEntryShownTracked) return
  afterInteractive(() => {
    if (refEntryShownTracked) return
    refEntryShownTracked = true
    const ctx = refEntryShownContext || {}
    trackRaw('ref_entry_shown', {
      screen: latestScreen || ctx.screen || screenHint || props.screen || null,
      battles_count: ctx.battles_count ?? null,
      training_auto: !!ctx.training_auto,
    })
  })
}

function trackDerivedEvents(eventType, props = {}) {
  if (eventType === 'screen_viewed') {
    latestScreen = props.screen || latestScreen
    trackFirstInteractive(props.screen, { ...props, source_event: 'screen_viewed' })
    trackRefEntryShown(props.screen, props)
  }

  if (eventType === 'app_opened' && currentStartParamKind() === 'ref' && !refEntryDetectedTracked) {
    refEntryDetectedTracked = true
    trackRaw('ref_entry_detected', {
      has_initdata: !!props.has_initdata,
      sdk_initdata_present: !!props.sdk_initdata_present,
      locale: props.locale || null,
    })
  }

  if (eventType === 'hangar_viewed') {
    trackFirstInteractive('hangar', { ...props, source_event: 'hangar_viewed' })
    trackHangarInteractive(props)
    trackRefEntryShown('hangar', props)
  }

  if (eventType === 'training_first_launch') {
    trackFirstInteractive('matchmaking', { ...props, training_auto: true, source_event: 'training_first_launch' })
    trackRefEntryShown('matchmaking', { ...props, training_auto: true })
  }

  if (eventType === 'matchmaking_started') {
    trackFirstInteractive('matchmaking', { ...props, source_event: 'matchmaking_started' })
    trackRefEntryShown('matchmaking', props)
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
      flushInteractiveWaiters()
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
  const sp = effectiveStartParam()
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
  const out = enrichProps(eventType, props)
  trackRaw(eventType, out)
  trackDerivedEvents(eventType, out)
}

export function trackScreen(screen, prevScreen) {
  track('screen_viewed', {
    screen,
    prev_screen: prevScreen || null,
  })
}
