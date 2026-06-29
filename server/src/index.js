// Сервер Panzer TG: HTTP API (профили + платежи Stars) и authoritative
// WS-бой N×N на одном порту. Профили — файловое хранилище, авторизация —
// подпись Telegram initData (без BOT_TOKEN — dev-гости и мгновенные «оплаты»).
import http from 'http'
import { WebSocketServer } from 'ws'
import { BattleSim, MAP_SIZE, randomMap, softFactor, vetFactor } from 'panzer-tg-shared'
import { authRequest, hasBot, recordAuthFailure, recentAuthFailures } from './auth.js'
import { t as tr } from './i18n.js'
import { loadProfile, saveProfile, withProfileLock, listProfiles, listPayments, leaderboard, playerByRank, getSetting, setSetting, srcTag, markReachedBattle, recordBattleEntry } from './db.js'
import { PRODUCTS, createInvoice, grantProduct, refundPayment, startPaymentsLoop } from './payments.js'
import { startSupportBot } from './support.js'
import { startNotifications, notifyFriendsInBattle, sendTestDigest, runDailyDigest, getDigestProgress, runEventBroadcast, getEventProgress, setPushEnabled, sendAdminMessage, mskDay, claimPushBonus, PUSH_BONUS_TOKENS } from './notifications.js'
import { logEvent, readEvents } from './eventlog.js'
import { createClan, joinClan, leaveClan, getClan, myClan, listClansView } from './clans.js'
import { listTournaments, joinTournament, leaveTournament } from './tournaments.js'
import { channelConfig, claimChannelBonus } from './channel.js'
import { feedbackConfig, claimFeedbackBonus } from './feedback.js'
import { claimDaily } from './daily.js'
import { adminPage } from './admin.js'
import { trackServer, analyticsEnabled } from './analytics.js'
import * as econ from './economy.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ID ТЕКУЩЕЙ СБОРКИ клиента (vite пишет client/dist/build-id.txt). Отдаём в /api/config
// → клиент сверяет со своим вкомпиленным __BUILD_ID__ и перезагружается, если устарел
// (залипший бандл в кэше Telegram/браузера). Читаем 1 раз: сервер рестартует на деплое.
// В Docker сервер и клиент — РАЗНЫЕ образы, dist/build-id.txt тут нет: CI отдаёт тот же
// BUILD_ID через env (тот же, что вкомпилен в web-бандл). Локально env нет → читаем файл.
let BUILD_ID = process.env.BUILD_ID || ''
try {
  if (!BUILD_ID) BUILD_ID = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist', 'build-id.txt'), 'utf8').trim()
} catch {
  /* нет файла (dev / сборка без плагина) — гейт просто не сработает */
}

const ADMIN_KEY = process.env.ADMIN_KEY || ''

// какие танки админ может выдать (премиум-техника из meta.js); валидируем, чтобы не
// засунуть в owned несуществующий id и не уронить рендер гаража у игрока
const GRANT_TANKS = new Set(['t28', 't54', 'pz4h', 'maus', 'ram', 'sper'])
let grantSeq = 0 // уникальный хвост id гранта (в паре с Date.now())

const PORT = +(process.env.PORT || 8080)

// страховки процесса: одиночный сбой логируем, сервер с сотней боёв не роняем
process.on('uncaughtException', (e) => console.error('[srv] uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('[srv] unhandledRejection:', e))

// ---------- замер нагрузки сервера (админка ловит лаг боёв числом, а не на глаз) ----------
// event-loop lag: насколько setInterval опаздывает против ожидаемого = насколько заблокирован
// поток (CPU/синхронный I/O). Десятки-сотни мс = WS-понги и тики комнат стоят в очереди =
// реальный лаг во ВСЕХ боях. Главный индикатор перегруза (важнее «среднего тика»).
const EL_LAG = []
;(() => {
  const STEP = 500
  let last = process.hrtime.bigint()
  const t = setInterval(() => {
    const now = process.hrtime.bigint()
    const lag = Math.max(0, Number(now - last) / 1e6 - STEP)
    last = now
    EL_LAG.push(lag)
    if (EL_LAG.length > 60) EL_LAG.shift() // ~30с окна
  }, STEP)
  t.unref?.()
})()

// сводка нагрузки: лаг loop + тики комнат (самозамер tickAccMs/tickN) + кол-во боёв/юнитов +
// RAM. rooms/TICK_HZ объявлены ниже, но на момент ВЫЗОВА (HTTP-запрос) уже инициализированы.
function serverLoad() {
  const lag = EL_LAG.length
    ? { cur: Math.round(EL_LAG[EL_LAG.length - 1]), avg: Math.round(EL_LAG.reduce((a, b) => a + b, 0) / EL_LAG.length), max: Math.round(Math.max(...EL_LAG)) }
    : { cur: 0, avg: 0, max: 0 }
  let tickSum = 0, tickRooms = 0, tickMax = 0, simUnits = 0, startedRooms = 0
  for (const r of rooms.values()) {
    if (r.started) startedRooms++
    if (r.started && r.tickN > 0) {
      const avg = r.tickAccMs / r.tickN
      tickSum += avg
      tickRooms++
      if (avg > tickMax) tickMax = avg
    }
    // юнитов в симуляции считаем только в БОЕВЫХ комнатах (нестартовавшие не тикают = не грузят)
    if (r.started && r.sim && Array.isArray(r.sim.units)) for (const u of r.sim.units) if (u && u.alive) simUnits++
  }
  return {
    elLagCur: lag.cur,
    elLagAvg: lag.avg,
    elLagMax: lag.max,
    tickHz: TICK_HZ,
    tickBudgetMs: Math.round((1000 / TICK_HZ) * 100) / 100,
    tickAvgMs: tickRooms ? Math.round((tickSum / tickRooms) * 100) / 100 : 0,
    tickMaxMs: Math.round(tickMax * 100) / 100,
    startedRooms,
    simUnits,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  }
}

// ---------- HTTP API ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-init-data, x-guest-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS })
  res.end(JSON.stringify(obj))
}
const BODY_LIMIT = 64 * 1024 // профиль — десятки КБ максимум
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > BODY_LIMIT) {
        resolve({})
        req.destroy()
      }
    })
    req.on('error', () => resolve({}))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })

// ---------- админка: статистика, профили, покупки (x-admin-key) ----------
async function handleAdmin(req, res) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return json(res, 401, { error: 'unauthorized' })
  if (req.url === '/api/admin/tournaments' && req.method === 'POST') {
    const { on } = await readBody(req)
    await setSetting('tournamentsOn', !!on)
    return json(res, 200, { tournaments: !!on })
  }
  if (req.url === '/api/admin/econ-authority' && req.method === 'POST') {
    // включить/выключить серверно-авторитетную экономику (анти-чит). После флипа
    // клиенты на ближайшем /api/config переключат покупки/награды на сервер.
    const { on } = await readBody(req)
    await setSetting('econAuthority', !!on)
    econ.setEconFlagCache(!!on) // мгновенно, не ждём истечения 5с-кэша
    return json(res, 200, { econAuthority: !!on })
  }
  if (req.url === '/api/admin/econ-normalize' && req.method === 'POST') {
    // НОРМАЛИЗАЦИЯ «невозможных» профилей: стрипает из owned исследуемые танки, которые
    // не оправданы серверным числом боёв (премиум-танки и кредиты НЕ трогаем — админ мог
    // дарить). dry:true — только отчёт, без записи. uid:<digits> — один игрок; иначе все.
    // adminCredits:<n> — ручная поправка «сколько кредитов подарено» (журнал — кольцо).
    const { dry, uid, adminCredits } = await readBody(req)
    const adminC = Math.max(0, Math.round(+adminCredits || 0))
    const targets = []
    if (uid) {
      const key = 'tg_' + String(uid).replace(/[^0-9]/g, '')
      const p = await loadProfile(key)
      if (p) targets.push({ key, p })
    } else {
      for (const row of await listProfiles()) {
        const p = await loadProfile(row.uid)
        if (p) targets.push({ key: row.uid, p })
      }
    }
    const report = []
    for (const { key, p } of targets) {
      const d = econ.diagnoseProfile(p, adminC)
      if (!d.impossible) continue
      const trimmed = econ.trimResearchByBudget(p.owned || [], d.earnable)
      const removed = (p.owned || []).filter((x) => !trimmed.includes(x))
      report.push({ uid: key, srvBattles: d.srvBattles, earnable: d.earnable, spentOnTanks: d.spentOnTanks, before: (p.owned || []).length, after: trimmed.length, removed })
      if (!dry) {
        await withProfileLock(key, async () => {
          const fresh = await loadProfile(key); if (!fresh) return
          fresh.owned = econ.trimResearchByBudget(fresh.owned || [], econ.diagnoseProfile(fresh, adminC).earnable)
          if (!fresh.owned.includes(fresh.selectedTank)) fresh.selectedTank = fresh.owned[0] || 't26' // выбранный мог уехать
          await saveProfile(key, fresh)
        })
        logEvent(key, 'econ_normalize', { removed })
      }
    }
    return json(res, 200, { ok: true, dry: !!dry, scanned: targets.length, normalized: report.length, report: report.slice(0, 200) })
  }
  if (req.url === '/api/admin/testpush' && req.method === 'POST') {
    const { uid } = await readBody(req)
    // принимаем «tg_123», «123» или с @ — нормализуем к tg_<digits>
    const digits = String(uid || '').replace(/[^0-9]/g, '')
    if (!digits) return json(res, 400, { error: 'нет uid' })
    return json(res, 200, await sendTestDigest('tg_' + digits))
  }
  if (req.url === '/api/admin/grant' && req.method === 'POST') {
    // выдать игроку награды. ПРЕМИУМ применяем СРАЗУ (premiumUntil защищён в merge — стоек).
    // КРЕДИТЫ/ЖЕТОНЫ/ТАНКИ кладём в очередь pendingGrants (тоже защищена в merge): клиент
    // применит их на ближайшем syncProfile и подтвердит claim'ом. Так выдача доходит
    // НАДЁЖНО, даже если игрок прямо сейчас онлайн (его сейв баланса не затрёт грант).
    const { uid, credits, tokens, premiumDays, tanks } = await readBody(req)
    const digits = String(uid || '').replace(/[^0-9]/g, '')
    if (!digits) return json(res, 400, { error: 'нет uid' })
    const key = 'tg_' + digits
    const c = Math.max(0, Math.min(1e7, Math.round(+credits || 0)))
    const t = Math.max(0, Math.min(1e5, Math.round(+tokens || 0)))
    const d = Math.max(0, Math.min(3650, Math.round(+premiumDays || 0)))
    const tk = [...new Set((Array.isArray(tanks) ? tanks : [tanks]).filter((x) => GRANT_TANKS.has(x)))]
    // load→mutate→save под локом — чтобы конкурентный сейв профиля / визит не уронил
    // только что добавленную выдачу (и наоборот). Возвращаем profile наружу для уведомления.
    const p = await withProfileLock(key, async () => {
      const pr = await loadProfile(key)
      if (!pr) return null
      if (d) pr.premiumUntil = Math.max(Date.now(), pr.premiumUntil || 0) + d * 86400000
      if (c || t || tk.length) {
        if (!Array.isArray(pr.pendingGrants)) pr.pendingGrants = []
        pr.pendingGrants.push({ id: String(Date.now()) + '.' + ++grantSeq, kind: 'admin', credits: c, tokens: t, tanks: tk, at: Date.now() })
      }
      await saveProfile(key, pr)
      return pr
    })
    if (!p) return json(res, 404, { error: 'профиль не найден (игрок не открывал игру)' })
    logEvent(key, 'admin_grant', { credits: c, tokens: t, premiumDays: d, tanks: tk })
    // уведомляем игрока: «подарок от администрации» (best-effort — дойдёт, если он
    // запускал бота / дал write-access). Награда всё равно начислится на заходе.
    let notified = null
    if (c || t || d || tk.length) {
      const en = p.lang === 'en'
      const lines = []
      if (c) lines.push('+' + c.toLocaleString(en ? 'en-US' : 'ru-RU') + (en ? ' credits 🪙' : ' кредитов 🪙'))
      if (t) lines.push('+' + t + (en ? ' tokens 💎' : ' жетонов 💎'))
      if (d) lines.push('+' + d + (en ? ' days premium ⭐' : ' дн. премиума ⭐'))
      for (const tankId of tk) lines.push((en ? 'tank ' : 'танк ') + tankId.toUpperCase())
      const giftText = en
        ? '🎁 A gift from the Panzers team!\n\n' + lines.join('\n') + '\n\nOpen the game — your reward is waiting in the hangar.'
        : '🎁 Подарок от администрации Panzers!\n\n' + lines.join('\n') + '\n\nЗагляни в игру — награда уже ждёт в ангаре.'
      const out = await sendAdminMessage(key, giftText)
      notified = out && out.ok ? true : out && out.reason ? out.reason : false
    }
    return json(res, 200, {
      ok: true,
      premiumApplied: d,
      premiumUntil: p.premiumUntil || 0,
      queued: { credits: c, tokens: t, tanks: tk },
      pending: Array.isArray(p.pendingGrants) ? p.pendingGrants.length : 0,
      notified, // true | reason-строка | false — дошло ли «подарок от администрации»
    })
  }
  if (req.url === '/api/admin/message' && req.method === 'POST') {
    // написать игроку лично от game-бота (дойдёт, только если он запускал бота / дал write-access)
    const { uid, text } = await readBody(req)
    const digits = String(uid || '').replace(/[^0-9]/g, '')
    if (!digits || !String(text || '').trim()) return json(res, 400, { error: 'нужны uid и текст' })
    const out = await sendAdminMessage('tg_' + digits, String(text))
    if (out && out.ok) logEvent('tg_' + digits, 'admin_msg', { text: String(text).slice(0, 200) })
    return json(res, 200, out)
  }
  if (req.url.split('?')[0] === '/api/admin/player' && req.method === 'GET') {
    // карточка одного игрока + его журнал событий («когда был, что делал»)
    const q = new URL(req.url, 'http://x').searchParams
    const digits = String(q.get('uid') || '').replace(/[^0-9]/g, '')
    if (!digits) return json(res, 400, { error: 'нет uid' })
    const key = 'tg_' + digits
    const p = await loadProfile(key)
    if (!p) return json(res, 404, { error: 'профиль не найден' })
    const st = p.stats || {}
    const player = {
      uid: key,
      name: p.name || '',
      lang: p.lang || 'ru',
      credits: p.credits || 0,
      tokens: p.tokens || 0,
      goldAmmo: p.goldAmmo || 0,
      premiumUntil: p.premiumUntil || 0,
      premiumActive: (p.premiumUntil || 0) > Date.now(),
      battles: st.battles || 0,
      srvBattles: p.srvBattles | 0,
      wins: st.wins || 0,
      kills: st.kills || 0,
      rating: st.rating || 0,
      wn8: st.wn8 || 0,
      tanks: Array.isArray(p.owned) ? p.owned.length : 0,
      owned: Array.isArray(p.owned) ? p.owned : [],
      crewXp: (p.crew && p.crew.xp) || 0,
      src: p.src || null,
      referredBy: p.referredBy || null,
      reachedBattle: !!p.reachedBattle,
      firstSeen: p.firstSeen || p._updatedAt || 0,
      lastSeen: p.lastSeen || p._updatedAt || 0,
      updatedAt: p._updatedAt || 0,
      pendingGrants: Array.isArray(p.pendingGrants) ? p.pendingGrants : [], // ещё не забранные игроком выдачи
    }
    return json(res, 200, { ok: true, player, events: await readEvents(key) })
  }
  if (req.url === '/api/admin/digest' && req.method === 'POST') {
    const { dry } = await readBody(req)
    if (dry) return json(res, 200, await runDailyDigest(Date.now(), { dry: true })) // прикидка охвата, без отправки
    if (getDigestProgress().running) return json(res, 200, { already: true }) // уже идёт — второй запуск НЕ плодим (защита от двойного клика)
    // реальная рассылка идёт минутами (по ~70мс на адресата) — пускаем в фоне, отвечаем сразу
    runDailyDigest(Date.now()).catch((e) => console.error('[push] ручная рассылка:', e.message))
    return json(res, 200, { started: true })
  }
  if (req.url === '/api/admin/digest-status' && req.method === 'GET') {
    return json(res, 200, getDigestProgress()) // прогресс рассылки для живого индикатора в админке
  }
  if (req.url === '/api/admin/event-announce' && req.method === 'POST') {
    const { dry } = await readBody(req)
    if (dry) return json(res, 200, await runEventBroadcast(Date.now(), { dry: true })) // прикидка охвата, без отправки
    if (getEventProgress().running) return json(res, 200, { already: true }) // уже идёт — второй запуск НЕ плодим
    runEventBroadcast(Date.now()).catch((e) => console.error('[push] анонс события:', e.message)) // в фоне, отвечаем сразу
    return json(res, 200, { started: true })
  }
  if (req.url === '/api/admin/event-status' && req.method === 'GET') {
    return json(res, 200, getEventProgress()) // прогресс анонса для живого индикатора
  }
  if (req.url === '/api/admin/auth-failures' && req.method === 'GET') {
    // последние отказы авторизации (почему клиент не залогинился) — кольцевой буфер в памяти
    return json(res, 200, { failures: recentAuthFailures() })
  }
  if (req.url === '/api/admin/stats' && req.method === 'GET') {
    const payments = await listPayments()
    const now = Date.now()
    const profs = await listProfiles()
    // разбивка онлайна: «в бою» (uid в стартовавшей комнате) vs «просто онлайн»
    // (активен — WS открыт ИЛИ заходил <2.5 мин — но сейчас не в бою). battleUids ⊆
    // activeSet (у бойца WS открыт), поэтому idle = active − battle ровно.
    const battleUids = new Set()
    for (const r of rooms.values()) if (r.started) for (const h of r.humans) if (h.uid) battleUids.add(h.uid)
    // страховка: кого сервер ВИДИТ в бою прямо сейчас — durable «дошёл до боя»
    // (на случай матчей, начавшихся до выката reachedBattle; idempotent + reachedMem)
    for (const uid of battleUids) markReachedBattle(uid)
    const activeSet = new Set()
    for (const c of wss.clients) if (c.readyState === 1 && c.uid) activeSet.add(c.uid)
    for (const p of profs) if (p.lastSeen && now - p.lastSeen < 150000) activeSet.add(p.uid)
    const inBattle = battleUids.size
    const onlineActive = activeSet.size // всего активны (как зелёные точки в таблице)
    const onlineIdle = [...activeSet].filter((u) => !battleUids.has(u)).length // просто онлайн, не в бою
    return json(res, 200, {
      now,
      inBattle,
      onlineActive,
      onlineIdle,
      // честный онлайн: уникальные tg-id, а не сырые сокеты (один игрок с кучей
      // вкладок/перезаходов = 1, а не +20). Соединения без tg-id (гость/лобби) — по одному.
      online: (() => {
        const seen = new Set()
        let n = 0
        for (const c of wss.clients) {
          if (c.readyState !== 1) continue
          if (c.uid) { if (seen.has(c.uid)) continue; seen.add(c.uid) }
          n++
        }
        return n
      })(),
      onlineSockets: wss.clients.size, // сырые сокеты (для сверки/диагностики клонов)
      onlineUids: (() => {
        const s = new Set()
        for (const c of wss.clients) if (c.readyState === 1 && c.uid) s.add(c.uid)
        return [...s]
      })(), // кто сейчас онлайн — для пометки в таблице игроков
      tournaments: !!(await getSetting('tournamentsOn', false)),
      rooms: [...rooms.values()].map((r) => ({
        id: r.id,
        started: r.started,
        mapId: r.sim ? r.sim.mapId : null,
        humans: r.humans.map((h) => ({ id: h.id, name: h.name })),
        score: r.sim ? r.sim.score : null,
      })),
      profilesCount: profs.length,
      traffic: trafficMetrics(profs, now), // метрики трафика + разбивка по источникам
      referrers: referrerMetrics(profs, now), // воронка по рефереру (кто привёл по ref_<id>)
      linkBase: process.env.APP_LINK_BASE || `https://t.me/${process.env.BOT_USERNAME || 'panzers_bot'}`,
      payments,
      revenueStars: payments.reduce((s, p) => s + (p.refunded ? 0 : p.stars || 0), 0), // зарефанженные не считаем
      products: PRODUCTS,
      payMode: hasBot() ? 'stars' : 'dev',
      analytics: analyticsEnabled(),
      load: serverLoad(), // event-loop lag + тики комнат + RAM — диагностика лага боёв
    })
  }
  if (req.url === '/api/admin/profiles' && req.method === 'GET') {
    return json(res, 200, { profiles: await listProfiles() })
  }
  if (req.url === '/api/admin/refund' && req.method === 'POST') {
    const { charge } = await readBody(req)
    if (!charge) return json(res, 400, { error: 'нет charge' })
    const out = await refundPayment(String(charge))
    return json(res, out.ok ? 200 : 400, out)
  }
  json(res, 404, { error: 'not found' })
}

// засчёт реферала: игрок (user) открыл игру по ссылке игрока с tg-id <ref>.
// Привязка одноразовая (referredBy у новичка), реферер получает рекрута в referrals.
// Дедуп на стороне реферера по uid — повторный заход по ссылке рекрута не задваивает.
async function registerReferral(user, ref) {
  const refId = String(ref || '').replace(/[^0-9]/g, '').slice(0, 20)
  if (!refId) return { ok: false, reason: 'no-ref' }
  const inviterUid = `tg_${refId}`
  if (inviterUid === user.uid) return { ok: false, reason: 'self' }
  // привязка новичка к рефереру (под локом своего uid)
  const bound = await withProfileLock(user.uid, async () => {
    const me = (await loadProfile(user.uid)) || {}
    if (me.referredBy) return false
    me.referredBy = inviterUid
    await saveProfile(user.uid, me)
    return true
  })
  if (!bound) return { ok: false, reason: 'already' }
  // зачёт рекрута рефереру (под ОТДЕЛЬНЫМ локом — последовательно, не вложенно: без дедлока)
  return withProfileLock(inviterUid, async () => {
    const inviter = await loadProfile(inviterUid)
    if (!inviter) return { ok: true, credited: false } // реферер ещё не заходил в игру
    if (!Array.isArray(inviter.referrals)) inviter.referrals = []
    if (!Array.isArray(inviter.referralIds)) inviter.referralIds = []
    if (!inviter.referralIds.includes(user.uid)) {
      inviter.referralIds.push(user.uid)
      inviter.referrals.push(user.name || tr('defaultName', user.lang))
      await saveProfile(inviterUid, inviter)
    }
    return { ok: true, credited: true }
  })
}

// зафиксировать визит существующего игрока для метрик: проставить источник (один
// раз), firstSeen (если не было) и lastSeen (не чаще раза в минуту — для DAU).
// Нового игрока не создаём здесь — его заведёт первый POST профиля (со срс).
async function recordVisit(user) {
  if (!user || user.uid.startsWith('g_')) {
    // dev-гость: профиля может не быть, но визит всё равно полезно учесть на POST
  }
  await withProfileLock(user.uid, async () => {
    const p = await loadProfile(user.uid)
    if (!p) return
    const now = Date.now()
    let dirty = false
    if (!p.firstSeen) {
      p.firstSeen = p._updatedAt || now
      dirty = true
    }
    const tag = srcTag(user.startParam)
    if (!p.src && tag) {
      p.src = tag
      dirty = true
      // источник из ПОДПИСАННОГО initData — надёжнее клиентского source_tag
      trackServer(user.uid, 'source_attributed', { source_tag: tag })
    }
    // новая сессия: если игрок не был активен >20 мин — это «зашёл в игру».
    // (lastSeen обновляется не чаще раза в минуту, так что порог 20м срабатывает раз
    // на заход, а не на каждый пинг). Журналим для админ-таймлайна «когда был».
    if (!p.lastSeen || now - p.lastSeen > 20 * 60000) {
      logEvent(user.uid, 'open', p.lastSeen ? { away_min: Math.round((now - p.lastSeen) / 60000) } : { first: true })
    }
    if (!p.lastSeen || now - p.lastSeen > 60000) {
      p.lastSeen = now
      dirty = true
    }
    // язык интерфейса из подписанного initData — обновляем при смене (для пушей/оплаты)
    if (user.lang && p.lang !== user.lang) {
      p.lang = user.lang
      dirty = true
    }
    if (dirty) await saveProfile(user.uid, p)
  })
}

// индекс календарного дня по МСК (UTC+3, как граница дайджеста). Для ретеншна
// «2-й день+»: считаем по СМЕНЕ дня, а не по span>20ч (тот зависел от времени суток —
// вечерний первый заход + возврат днём = <20ч → терялся, хотя это явно 2-й день).
const mskDayIndex = (ts) => Math.floor((ts + 3 * 3600000) / 86400000)
const returnedDay2 = (p) => !!(p.firstSeen && p.lastSeen && mskDayIndex(p.lastSeen) > mskDayIndex(p.firstSeen))

// агрегат метрик трафика из сводки профилей (для админки)
function trafficMetrics(profiles, now) {
  const DAY = 86400000
  const today = mskDay(now) // календарный «сегодня» по МСК
  const bySrc = new Map()
  let newToday = 0
  let new7d = 0
  let dau = 0
  let activeToday = 0 // открыли приложение сегодня (календарный день МСК)
  let playedToday = 0 // реально вошли в бой сегодня (по серверному lastBattleAt) — «живые» игроки
  let reachedTotal = 0 // всего дошли до боя (реальные игроки, не мусорный трафик)
  let returnedReal = 0 // из них вернулись на 2-й день+ — чистая ретенция без гостов/ботов
  let pushBlocked = 0 // бот недоступен (заблокировал ИЛИ не дал write-access) — пуш не доходит
  let pushBlockedReal = 0 // был успешный пуш (lastPushAt>0), теперь недоступен → РЕАЛЬНО заблокировал
  let pushNoAccess = 0 // ни одного успешного пуша → просто НЕ ДАЛ доступ (не запускал бота)
  let pushReachable = 0 // дошли до боя И боту можно писать — реальная аудитория пушей/дайджеста
  let used3D = 0 // включали 3D-режим хоть раз (эксперимент)
  for (const p of profiles) {
    if (p.firstSeen && now - p.firstSeen < DAY) newToday++
    if (p.firstSeen && now - p.firstSeen < 7 * DAY) new7d++
    if (p.lastSeen && now - p.lastSeen < DAY) dau++
    if (p.lastSeen && mskDay(p.lastSeen) === today) activeToday++
    // играли сегодня: первый бой сегодня (новичок — ловится задним числом) ИЛИ
    // последний бой сегодня (вернувшийся — пишется с выката lastBattleAt)
    if ((p.firstBattleAt && mskDay(p.firstBattleAt) === today) || (p.lastBattleAt && mskDay(p.lastBattleAt) === today)) playedToday++
    // чистая ретенция: считаем возвраты ТОЛЬКО среди дошедших до боя (мусорный трафик —
    // гости <1мин и кликеры — исключаются)
    const reached = p.battles > 0 || p.reachedBattle
    if (reached) {
      reachedTotal++
      if (returnedDay2(p)) returnedReal++
      if (!p.pushBlocked && !p.pushOff) pushReachable++ // боту можно писать → дойдёт пуш
    }
    if (p.pushBlocked) {
      pushBlocked++
      if (p.lastPushAt > 0) pushBlockedReal++ // был успешный пуш → реально заблокировал
      else pushNoAccess++ // ни одного пуша → просто не дал доступ (не запускал бота)
    }
    if (p.used3D) used3D++
    const key = p.src || '—'
    const e = bySrc.get(key) || { src: key, users: 0, played: 0, ghosts: 0, lingered: 0, returned: 0, blocked: 0, blockedReal: 0, noAccess: 0, new7d: 0 }
    e.users++
    // та же воронка, что у рефереров: бой / зашёл-и-исчез(<1мин) / завис-без-боя / вернулись(2-й день+)
    const dwell = (p.lastSeen || 0) - (p.firstSeen || 0)
    if (p.battles > 0 || p.reachedBattle) e.played++
    else if (dwell < 60000) e.ghosts++
    else e.lingered++
    if (returnedDay2(p)) e.returned++ // заходил на БОЛЕЕ поздний календарный день (МСК)
    if (p.pushBlocked) { e.blocked++; if (p.lastPushAt > 0) e.blockedReal++; else e.noAccess++ } // реально заблок vs не дал доступ
    if (p.firstSeen && now - p.firstSeen < 7 * DAY) e.new7d++
    bySrc.set(key, e)
  }
  return {
    total: profiles.length,
    newToday,
    new7d,
    dau,
    activeToday,
    playedToday,
    reachedTotal,
    returnedReal,
    pushBlocked,
    pushBlockedReal,
    pushNoAccess,
    pushReachable,
    used3D,
    bySource: [...bySrc.values()].sort((a, b) => b.users - a.users),
  }
}

// воронка по рефереру: для каждого, кто привёл людей (referredBy = tg_<id>), —
// сколько пришло / сыграло бой / вернулось (заходили на 2-й день+) / активны 24ч.
// Закрывает «кто прошёл по моей реф-ссылке и что с ними» (когда реклама залита на
// ref_<id>, а не на src_-метку — такой трафик в «Источники» не попадает).
function referrerMetrics(profiles, now) {
  const DAY = 86400000
  const by = new Map()
  for (const p of profiles) {
    if (!p.referredBy) continue
    const e = by.get(p.referredBy) || { ref: p.referredBy, came: 0, played: 0, ghosts: 0, lingered: 0, returned: 0, blocked: 0, blockedReal: 0, noAccess: 0, new7d: 0 }
    e.came++
    if (p.pushBlocked) { e.blocked++; if (p.lastPushAt > 0) e.blockedReal++; else e.noAccess++ } // реально заблок vs не дал доступ
    const dwell = (p.lastSeen || 0) - (p.firstSeen || 0)
    // непересекающийся разбор: бой / открыл-и-исчез / полазил-без-боя = came
    if (p.battles > 0 || p.reachedBattle) e.played++
    else if (dwell < 60000) e.ghosts++ // открыл <1 мин, без боя — бот/фейк-клик
    else e.lingered++ // полазил ≥1 мин, но в бой так и не пошёл
    if (returnedDay2(p)) e.returned++ // заходил на 2-й день+ (МСК-календарь; копится со временем)
    if (p.firstSeen && now - p.firstSeen < 7 * DAY) e.new7d++
    by.set(p.referredBy, e)
  }
  return [...by.values()].sort((a, b) => b.came - a.came)
}

// кэш публичного «N в сети» (10с): не сканируем профили на каждый поллинг клиента
let onlineCache = null

async function handleApi(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }
  if (req.url.startsWith('/api/admin/')) return handleAdmin(req, res)
  const user = authRequest(req)
  if (!user) {
    recordAuthFailure(req) // диагностика «играю, но не залогинен» (@Z_86_V) — см. /api/admin/auth-failures
    return json(res, 401, { error: 'unauthorized' })
  }

  if (req.url === '/api/profile' && req.method === 'GET') {
    await recordVisit(user) // метрики: источник/firstSeen/lastSeen (DAU)
    return json(res, 200, { uid: user.uid, profile: await loadProfile(user.uid) })
  }
  if (req.url === '/api/ping' && req.method === 'POST') {
    // presence-heartbeat: клиент шлёт «я тут», пока мини-апп на экране (даже в меню,
    // где боевой WS не открыт) → lastSeen свежий → зелёная точка онлайна в админке.
    // recordVisit троттлит запись lastSeen до 1/мин, так что это дёшево.
    await recordVisit(user)
    return json(res, 200, { ok: true, now: Date.now() })
  }
  if (req.url === '/api/online' && req.method === 'GET') {
    // публичный «N в сети» для главной: активны = открыт боевой WS ИЛИ заходили
    // <2.5 мин назад (lastSeen, обновляется ping'ом даже в меню) — как onlineActive
    // в админке. Кэш 10с, чтобы поллинг клиентов не сканировал профили на каждый зов.
    const now = Date.now()
    if (!onlineCache || now - onlineCache.ts > 10000) {
      const ids = new Set()
      for (const c of wss.clients) if (c.readyState === 1 && c.uid) ids.add(c.uid)
      for (const p of await listProfiles()) if (p.lastSeen && now - p.lastSeen < 150000) ids.add(p.uid)
      onlineCache = { ts: now, n: ids.size }
    }
    return json(res, 200, { online: onlineCache.n, now })
  }
  if (req.url === '/api/leaderboard' && req.method === 'GET') {
    return json(res, 200, { top: await leaderboard(20) })
  }
  if (req.url.startsWith('/api/player') && req.method === 'GET') {
    const rank = +new URL(req.url, 'http://x').searchParams.get('rank')
    if (!rank || rank < 1) return json(res, 400, { error: 'bad rank' })
    const player = await playerByRank(rank)
    return player ? json(res, 200, { player }) : json(res, 404, { error: 'not found' })
  }
  if (req.url === '/api/config' && req.method === 'GET') {
    // econAuthority — флаг серверно-авторитетной экономики; клиент по нему роутит
    // покупки/награды на сервер (а не считает локально). По умолчанию OFF.
    return json(res, 200, { tournaments: !!(await getSetting('tournamentsOn', false)), channel: channelConfig(), feedback: feedbackConfig(), econAuthority: await econ.econAuthority(), pushBonusTokens: PUSH_BONUS_TOKENS, buildId: BUILD_ID })
  }
  if (req.url === '/api/profile' && req.method === 'POST') {
    const body = await readBody(req)
    if (!body || typeof body.profile !== 'object') return json(res, 400, { error: 'bad profile' })
    // серверные поля (рефералы/реферер) ведёт сервер — клиент их НЕ перезаписывает,
    // иначе сейв профиля затирал бы засчитанных рекрутов. Берём прежние из хранилища.
    // Весь load prev→merge→save под локом: иначе между чтением prev и записью merged
    // мог влезть grants-apply (слил очередь) — и мы бы воскресили уже выданную выдачу
    // из prev.pendingGrants → двойное начисление. Лок сериализует это с grants-apply.
    const saved = await withProfileLock(user.uid, async () => {
    const prev = (await loadProfile(user.uid)) || {}
    const merged = {
      ...body.profile,
      referrals: Array.isArray(prev.referrals) ? prev.referrals : [],
      referralIds: Array.isArray(prev.referralIds) ? prev.referralIds : [],
      referredBy: prev.referredBy || null,
      // членство в клане ведут только clan-эндпоинты — сейв профиля его не трогает
      clanId: prev.clanId || null,
      clanTag: prev.clanTag || null,
      // премиум выдаёт ТОЛЬКО платёж (payments.js): клиент НЕ может проставить себе
      // premiumUntil сейвом профиля. Иначе любой через localStorage даёт себе корону.
      premiumUntil: prev.premiumUntil || 0,
      // позывной: пока nameCustom=false — имя ведёт клиент (ник из Telegram). Как только
      // ОПЛАЧЕННАЯ смена выставила nameCustom=true (payments grantProduct, под локом),
      // клиентский дебаунс-сейв со СТАРЫМ именем больше НЕ может его перетереть — иначе
      // оплаченная смена откатывалась назад («смена имени не работает»). nameCustom
      // серверно-авторитетен (клиент не может выставить его сам, минуя оплату).
      name: prev.nameCustom ? prev.name || body.profile.name : body.profile.name || prev.name,
      nameCustom: prev.nameCustom || false,
      // атрибуция трафика — серверные поля, клиент их не пишет. src ставится один
      // раз (на первом сейве нового игрока из start_param), firstSeen — тоже.
      src: prev.src || srcTag(user.startParam) || null,
      // серверный факт входа в бой — ведёт сервер (markReachedBattle), клиент не пишет;
      // сохраняем, чтобы клиентский сейв профиля его не затирал
      reachedBattle: prev.reachedBattle || false,
      srvBattles: prev.srvBattles || 0, // серверный счётчик боёв — клиент не пишет
      // бонус за подписку на канал выдаёт ТОЛЬКО сервер (channel.js, с проверкой
      // getChatMember). Флаг серверный — клиент не может его сбросить сейвом профиля
      // и заклеймить повторно через подчистку localStorage.
      channelBonusClaimed: prev.channelBonusClaimed || false,
      pushBonusClaimed: prev.pushBonusClaimed || false, // бонус за включение уведомлений — серверный (разовый)
      used3D: prev.used3D || body.profile.used3D || false, // включал 3D — липкий флаг (от сервера ИЛИ клиента)
      // бонус за фидбек: «написал в саппорт» (ставит support.js) + «забрал» — серверные
      wroteSupport: prev.wroteSupport || false,
      feedbackClaimed: prev.feedbackClaimed || false,
      firstBattleAt: prev.firstBattleAt || 0,
      firstSeen: prev.firstSeen || Date.now(),
      lastSeen: Date.now(),
      lang: user.lang || prev.lang || 'ru', // язык для серверных сообщений (пуши/оплата)
      // ежедневный вход теперь СЕРВЕРНО-авторитетен (daily.js claimDaily под локом):
      // день/стрик двигает только /api/daily-bonus. Клиентский сейв НЕ может откатить
      // daily.last — иначе с другого устройства (стейл-localStorage) дейлик забирался бы
      // повторно со взвинчиванием стрика.
      daily: prev.daily && typeof prev.daily === 'object' ? prev.daily : { last: '', streak: 0 },
      // очередь админ-выдач ведёт сервер: кладёт /api/admin/grant, применяет+чистит /api/grants-apply.
      // Клиентский сейв НЕ может её трогать — иначе игрок затёр бы свои же невыданные награды.
      pendingGrants: Array.isArray(prev.pendingGrants) ? prev.pendingGrants : [],
      // pity-счётчик донат-крейтов — СЕРВЕРНО-авторитетен (анти-абьюз платных круток):
      // ведёт его только econ.rollNationCrate в grants-apply, клиент НЕ может его сбросить
      // сейвом профиля (иначе через localStorage обнулял бы pity и гарантию t8).
      cratePity: prev.cratePity && typeof prev.cratePity === 'object' ? prev.cratePity : {},
    }
    // СЕРВЕРНО-АВТОРИТЕТНАЯ ЭКОНОМИКА (флаг ВКЛ): деньги/танки/модули/перки ведёт сервер
    // (начисление за бой + валидируемые эндпоинты покупок), клиентский сейв их НЕ пишет —
    // это и закрывает чит «правлю localStorage». При OFF — поведение как было.
    const econAuth = await econ.econAuthority()
    if (econAuth) Object.assign(merged, econ.econPreserve(prev, body.profile))
    const at = await saveProfile(user.uid, merged)
    // под econAuthority ВОЗВРАЩАЕМ серверные econ-поля (раньше отдавали только updatedAt → клиент
    // отставал: XP/кредиты копились на сервере, на экран не доходили — #29 «опыта не давали»).
    // Клиент адоптит их сразу после сейва (store apiSaveProfile), без отдельного GET-синка.
    return { at, econ: econAuth ? { credits: merged.credits | 0, tokens: merged.tokens | 0, goldAmmo: merged.goldAmmo | 0, owned: merged.owned, modules: merged.modules, branchXp: merged.branchXp, freeXp: merged.freeXp, premTankBattles: merged.premTankBattles | 0 } : null }
    })
    // БЭКСТОП РЕФЕРАЛА из ПОДПИСАННОГО start_param (#29 @Z_86_V «приглашение друзей»):
    // клиентский /api/referred зависит от тайминга initData на медленных телефонах и от
    // того, дошёл ли клиент до handleStartParam (при гейте входа — нет) → реферал терялся.
    // start_param из подписи доступен на КАЖДОМ авторизованном запросе и подделать нельзя.
    // Вне лока выше (registerReferral берёт тот же лок) + fire-and-forget (не тормозим ответ).
    // Идемпотентно: referredBy привязывается один раз, повторные вызовы — no-op.
    const refM = /^ref_(\d{3,})$/.exec(user.startParam || '')
    if (refM) registerReferral(user, refM[1]).catch(() => {})
    // updatedAt — версия записи (серверные часы); клиент хранит её и на реоткрытии
    // сверяет: продвинулся ли сервер с тех пор (другое устройство) или нет.
    return json(res, 200, { ok: true, updatedAt: saved && typeof saved.at === 'number' ? saved.at : 0, econ: (saved && saved.econ) || undefined })
  }
  if (req.url === '/api/grants-apply' && req.method === 'POST') {
    // АТОМАРНО применить очередь админ-выдач к серверному профилю и очистить её —
    // кредиты/жетоны/танки начисляем здесь (не на клиенте), клиент лишь забирает
    // авторитетный результат. Один load→mutate→save = ни двойного начисления (очередь
    // чистится вместе с балансом), ни потери (упал до save — очередь цела, применим
    // на след. синке). Премиум сюда не входит (он уже в premiumUntil).
    // под локом — сериализуем с сейвом профиля и с собой же (двойной apply иначе
    // удвоил бы валюту: оба грузят очередь, оба применяют, оба чистят).
    const out = await withProfileLock(user.uid, async () => {
      const p = await loadProfile(user.uid)
      if (!p || !Array.isArray(p.pendingGrants) || !p.pendingGrants.length) {
        return { ok: true, applied: 0, credits: (p && p.credits) || 0, tokens: (p && p.tokens) || 0, goldAmmo: (p && p.goldAmmo) || 0, owned: (p && p.owned) || [], branchXp: (p && p.branchXp) || {}, freeXp: (p && p.freeXp) || 0, pendingGrants: [] }
      }
      let n = 0
      // got = что показать в in-app окне «🎁 Подарок от администрации». Только админ-выдачи
      // (kind 'admin' или легаси без kind) сюда попадают; покупки/бонусы (kind purchase|bonus)
      // применяем к балансу, но окно НЕ показываем — у них своя кнопка-подтверждение.
      const got = { credits: 0, tokens: 0, tanks: [] }
      const crates = [] // ролл донат-крейтов (kind:'crate') — для ревила на клиенте
      for (const g of p.pendingGrants) {
        if (!g) continue
        const reveal = !g.kind || g.kind === 'admin'
        if (g.credits) { p.credits = (p.credits || 0) + (+g.credits || 0); if (reveal) got.credits += +g.credits || 0 }
        if (g.tokens) { p.tokens = (p.tokens || 0) + (+g.tokens || 0); if (reveal) got.tokens += +g.tokens || 0 }
        if (g.goldAmmo) { p.goldAmmo = (p.goldAmmo || 0) + (+g.goldAmmo || 0) } // золотые снаряды (дейлик); своя UI — без reveal-окна
        if (Array.isArray(g.tanks)) {
          if (!Array.isArray(p.owned)) p.owned = []
          for (const tk of g.tanks) if (tk && GRANT_TANKS.has(tk) && !p.owned.includes(tk)) { p.owned.push(tk); if (reveal) got.tanks.push(tk) }
        }
        // ДОНАТ-КРЕЙТ: ролл здесь (авторитетно, под локом) — мутирует p (баланс/owned/
        // camoOwned/pity), собираем награду для ревила. Деньги уже списаны Telegram.
        if (g.kind === 'crate') {
          const rw = econ.rollNationCrate(p, g.nation)
          if (rw) {
            crates.push(rw)
            // ЛОГ ДРОПА: что ИМЕННО выпало из ящика → видно в карточке игрока в админке
            // (фидбек «нам бы видеть что ему выпало»; раньше логировался только факт покупки).
            logEvent(user.uid, 'crate_roll', { nation: g.nation, type: rw.type, tank: rw.tank || null, tier: rw.tier || null, crystals: rw.crystals || 0, freeXp: rw.freeXp || 0, credits: rw.credits || 0, camo: rw.camo || null })
            // лог выпавшего по charge — чтобы рефанд откатил ИМЕННО то, что выпало
            // (награда крейта рандомная, статичный PRODUCTS её не знает). Держим последние 50.
            if (g.charge) {
              if (!p.crateLog || typeof p.crateLog !== 'object') p.crateLog = {}
              p.crateLog[g.charge] = { ...rw, at: g.at || Date.now() }
              const ks = Object.keys(p.crateLog)
              if (ks.length > 50) {
                ks.sort((a, b) => (p.crateLog[a].at || 0) - (p.crateLog[b].at || 0))
                for (const k of ks.slice(0, ks.length - 50)) delete p.crateLog[k]
              }
            }
          }
        }
        n++
      }
      p.pendingGrants = []
      await saveProfile(user.uid, p)
      return { ok: true, applied: n, got, crates, credits: p.credits || 0, tokens: p.tokens || 0, goldAmmo: p.goldAmmo || 0, owned: p.owned || [], camoOwned: p.camoOwned || [], cratePity: p.cratePity || {}, branchXp: p.branchXp || {}, freeXp: p.freeXp || 0, pendingGrants: [] }
    })
    return json(res, 200, out)
  }
  // ---------- СЕРВЕРНО-АВТОРИТЕТНЫЕ ПОКУПКИ/КЛЕЙМЫ (активны при флаге econAuthority) ----------
  // Клиент зовёт их только когда serverConfig.econAuthority=true; гард ниже — страховка,
  // чтобы при ВЫКЛ флаге случайный вызов не списал дважды (клиент тогда считает локально).
  if (req.url && req.url.startsWith('/api/econ/') && req.method === 'POST') {
    if (!(await econ.econAuthority())) return json(res, 409, { error: 'econ-off' })
    const b = await readBody(req)
    let out
    switch (req.url) {
      case '/api/econ/buy-tank': out = await econ.buyTank(user.uid, String(b.tankId || '')); break
      case '/api/econ/sell-tank': out = await econ.sellTank(user.uid, String(b.tankId || '')); break
      case '/api/econ/spend-free-xp': out = await econ.spendFreeXp(user.uid, String(b.nation || ''), b.amount | 0); break
      case '/api/econ/convert-free-xp': out = await econ.convertToFreeXp(user.uid, b.crystals | 0); break
      case '/api/econ/upgrade-module': out = await econ.upgradeModule(user.uid, String(b.tankId || ''), String(b.modId || '')); break
      case '/api/econ/upgrade-crew': out = await econ.upgradeCrewPerk(user.uid, String(b.memberId || '')); break
      case '/api/econ/buy-camo': out = await econ.buyCamo(user.uid, String(b.tankId || ''), String(b.camoId || '')); break
      case '/api/econ/buy-skin': out = await econ.buySkin(user.uid, String(b.skinId || '')); break
      case '/api/econ/buy-gold-ammo': out = await econ.buyGoldAmmo(user.uid, String(b.packId || '')); break
      case '/api/econ/spend-gold-ammo': out = await econ.spendGoldAmmo(user.uid, b.n | 0); break
      case '/api/econ/buy-crate': out = await econ.buyCrate(user.uid, String(b.crateId || '')); break
      case '/api/econ/claim-task': out = await econ.claimTask(user.uid, String(b.taskId || '')); break
      case '/api/econ/claim-ref': out = await econ.claimRefMilestone(user.uid, b.idx | 0); break
      default: return json(res, 404, { error: 'not found' })
    }
    return json(res, out && out.ok ? 200 : 400, out || { error: 'failed' })
  }
  if (req.url === '/api/referred' && req.method === 'POST') {
    const { ref } = await readBody(req)
    return json(res, 200, await registerReferral(user, ref))
  }
  if (req.url === '/api/push-allow' && req.method === 'POST') {
    // клиент вызвал requestWriteAccess и юзер РАЗРЕШИЛ боту писать → снимаем pushBlocked/pushOff,
    // чтобы возврат-рассылка до него дошла (раньше вебапп-юзеры были недосягаемы для бота)
    await setPushEnabled(user.uid, true)
    return json(res, 200, { ok: true })
  }
  if (req.url === '/api/used-3d' && req.method === 'POST') {
    // игрок впервые включил 3D-режим — ставим липкий флаг (метрика эксперимента в админке)
    await withProfileLock(user.uid, async () => {
      const p = await loadProfile(user.uid)
      if (p && !p.used3D) { p.used3D = true; p.used3DAt = Date.now(); await saveProfile(user.uid, p) }
    })
    return json(res, 200, { ok: true })
  }
  if (req.url === '/api/push-bonus' && req.method === 'POST') {
    // разовый бонус за включение уведомлений: СЕРВЕР верифицирует доступ реальной
    // отправкой и начисляет жетоны (если бот всё ещё не может писать — не даём)
    return json(res, 200, await claimPushBonus(user.uid))
  }
  if (req.url === '/api/channel-bonus' && req.method === 'POST') {
    // разовый бонус за подписку на канал — проверка подписки + начисление на сервере
    return json(res, 200, await claimChannelBonus(user.uid))
  }
  if (req.url === '/api/feedback-bonus' && req.method === 'POST') {
    // разовый бонус за фидбек — выдаём, если игрок реально написал в саппорт-бот
    return json(res, 200, await claimFeedbackBonus(user.uid))
  }
  if (req.url === '/api/daily-bonus' && req.method === 'POST') {
    // ежедневный вход — серверно-авторитетный клейм (день/стрик/выдача под локом),
    // чтобы дейлик нельзя было забрать повторно с другого устройства/после очистки кеша
    return json(res, 200, await claimDaily(user.uid))
  }
  if (req.url === '/api/invoice' && req.method === 'POST') {
    const { productId, name } = await readBody(req)
    const out = await createInvoice(user.uid, productId, { name, lang: user.lang })
    if (out.error) return json(res, 400, out)
    // dev-режим: токена нет — начисляем сразу, фронт покажет «куплено (dev)»
    if (out.dev) {
      const granted = await grantProduct(user.uid, productId, { name })
      return json(res, 200, { dev: true, granted })
    }
    return json(res, 200, out)
  }
  if (req.url === '/api/products' && req.method === 'GET') {
    return json(res, 200, { products: PRODUCTS, payments: hasBot() ? 'stars' : 'dev' })
  }
  // ===== кланы =====
  if (req.url === '/api/clans' && req.method === 'GET') {
    return json(res, 200, { clans: await listClansView(30), mine: await myClan(user.uid) })
  }
  if (req.url === '/api/clan/create' && req.method === 'POST') {
    const b = await readBody(req)
    const r = await createClan(user.uid, b.name, b.tag, b.emblem)
    return r.error ? json(res, 400, r) : json(res, 200, { clan: r })
  }
  if (req.url === '/api/clan/join' && req.method === 'POST') {
    const b = await readBody(req)
    const r = await joinClan(user.uid, b.clanId)
    return r.error ? json(res, 400, r) : json(res, 200, { clan: r })
  }
  if (req.url === '/api/clan/leave' && req.method === 'POST') {
    return json(res, 200, await leaveClan(user.uid))
  }
  if (req.url.startsWith('/api/clan/') && req.method === 'GET') {
    const id = req.url.slice('/api/clan/'.length).split('?')[0]
    const c = await getClan(id)
    return c ? json(res, 200, { clan: c }) : json(res, 404, { error: 'not found' })
  }
  // ===== турниры (регистрация + счётчик «участвую») =====
  if (req.url === '/api/tournaments' && req.method === 'GET') {
    return json(res, 200, { tournaments: await listTournaments(user.uid, user.lang) })
  }
  if (req.url === '/api/tournament/join' && req.method === 'POST') {
    const b = await readBody(req)
    const r = await joinTournament(user.uid, String(b.tid || ''), user.lang)
    return r.error ? json(res, 400, r) : json(res, 200, { tournament: r })
  }
  if (req.url === '/api/tournament/leave' && req.method === 'POST') {
    const b = await readBody(req)
    const r = await leaveTournament(user.uid, String(b.tid || ''), user.lang)
    return r.error ? json(res, 400, r) : json(res, 200, { tournament: r })
  }
  json(res, 404, { error: 'not found' })
}

const httpServer = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res).catch((e) => json(res, 500, { error: e.message }))
  if (req.url === '/admin' || req.url === '/admin/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(adminPage())
  }
  res.writeHead(200, CORS)
  res.end('Panzer TG server')
})
const TEAM_SIZE = +(process.env.TEAM_SIZE || 7)
// сколько комната ждёт живых игроков, прежде чем добрать ботов (одинокий ветеран)
const WAIT_MS = +(process.env.WAIT_MS || 8000)
// новичок-СОЛО: короткое окно ПУЛИНГА — успеть свести с другим живым (под наплыв
// рекламы их много), иначе боты. Было 600мс — слишком быстро, второй живой не
// успевал зайти и каждый падал в свой бой с ботами. Теперь 2с: концы встречаются.
const NEWBIE_WAIT_MS = +(process.env.NEWBIE_WAIT_MS || 2000)
// в комнате уже ≥2 живых → окно ДОБОРА. КОПИМ живых под наплыв: каждый новый вход
// продлевает сбор на FILL_MS (ждём, не идёт ли ещё кто), но не дольше FILL_MAX_MS от
// появления второго живого. Пара игроков (поток иссяк) стартует через FILL_MS; под
// наплыв комната набирается к полному 7×7 живых до потолка/14.
const FILL_MS = +(process.env.FILL_MS || 3000)
const FILL_MAX_MS = +(process.env.FILL_MAX_MS || 6000)
// порог «новичка»: у кого меньше боёв — соло-старт быстрый (см. NEWBIE_WAIT_MS);
// дальше одинокий игрок ждёт живых дольше (WAIT_MS). ≥2 живых — всегда быстрый добор.
const INSTANT_BATTLE_BELOW = +(process.env.INSTANT_BATTLE_BELOW || 7)
// стартовый отсчёт «3-2-1»: мир на сервере застыл, пока клиент считает (Battle.vue
// крутит 3с). Чуть больше 3с — с поправкой на пинг игрок дочитывает раньше, чем
// боты тронутся (а не «боты поехали на цифре 3»).
const COUNTDOWN_MS = +(process.env.COUNTDOWN_MS || 3200)
// БЭКСТОП готовности: мир стоит, пока клиент не пришлёт 'ready' (досчитал «3-2-1» / instant).
// Чинит «боты едут до конца отсчёта»: у клиента до боя ещё пауза «бой найден» + лоадер +
// отсчёт (~4с ПОСЛЕ match-start), а сервер морозил лишь COUNTDOWN_MS → размораживался раньше
// игрока → боты с форой. Старт по 'ready' синхронит игрока и ботов. startAt — лишь бэкстоп,
// если 'ready' не пришёл (старый/застрявший клиент), чтобы комната не висела вечно.
const READY_MAX_MS = +(process.env.READY_MAX_MS || 6500)
// 60Гц симуляция+поток — максимальная плавность/отзывчивость (шаг интерп. ~16мс,
// задержка рендера ~20мс). Частота НЕ была причиной iOS-проблемы (сокет тянул и
// 20Гц; корень — сорванный push, лечится pull-очередью в NetGame). Это ТЕСТОВЫЙ
// сервер (мало игроков), поэтому жмём на максимум. Для прода с толпой комнат
// снизить env'ом: TICK_HZ=30 (баланс) или 20 (экономно) — нагрузка линейна по Hz.
const TICK_HZ = +(process.env.TICK_HZ || 60)
const TICK_DT = 1 / TICK_HZ
// можно слать РЕЖЕ, чем считаем (SNAP_EVERY=2 → половина потока) для слабых сетей
const SNAP_EVERY = Math.max(1, +(process.env.SNAP_EVERY || 1))
const SNAP_HZ = TICK_HZ / SNAP_EVERY

// пределы против флуда: вход больше 2КБ боевому клиенту не нужен
const MAX_SOCKETS = +(process.env.MAX_SOCKETS || 1200)
const MAX_PER_IP = +(process.env.MAX_PER_IP || 30)
const MSG_RATE = 40 // сообщений/с на сокет (ввод 10Гц + огонь + пинг — с запасом)
const MSG_BURST = 80
const SEND_BUFFER_LIMIT = 256 * 1024 // backpressure: дальше кадры дропаем

// perMessageDeflate выключен: сжатие мелких 60Гц-кадров копит их и добавляет
// латентность — для риалтайма вредно (поток должен идти ровно, а не пачками)
const wss = new WebSocketServer({ server: httpServer, maxPayload: 2048, perMessageDeflate: false })
wss.on('error', (e) => console.error('[ws] server error:', e.message))

const ipCount = new Map()

// валидация боевых статов из клиентского лоадаута: только известные числовые
// поля, каждое зажато в честный диапазон (читы и NaN не проходят)
const STAT_CLAMP = {
  sectorDeg: [20, 80],
  sweepPeriod: [1.2, 6],
  toleranceDeg: [2, 12],
  reload: [1.0, 20], // role-based сетка: медленные тяжи (Maus rof 4 → 15с); модули/экипаж ускоряют
  damage: [40, 1000], // абс. урон: топ ~380, Maus 490, +модули/экипаж ~+20% → запас до 1000
  hp: [300, 9000], // T-14 5500 / Maus 5000 + модули/экипаж → запас
  range: [300, 800],
  vision: [200, 800],
  maxSpeed: [15, 130], // км/ч сетки: Maus 20 (медленный) … топ ~75 + экипаж
  accel: [30, 600],
  turnRate: [0.2, 4], // Maus 18°/с → 0.31 рад/с … лёгкие ~76°/с → 1.33
}
function sanitizeStats(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  for (const [k, [lo, hi]] of Object.entries(STAT_CLAMP)) {
    const v = +raw[k]
    if (!Number.isFinite(v)) return null
    out[k] = Math.max(lo, Math.min(hi, v))
  }
  out.id = typeof raw.id === 'string' && /^[a-z]{1,12}$/.test(raw.id) ? raw.id : 'medium'
  return out
}
const ID_RE = /^[a-z0-9_]{1,16}$/

let nextId = 1
const rooms = new Map()
// ждущие комнаты — свои на каждый режим: игроки с разными режимами (захват/
// уничтожение) НЕ попадают в одну комнату. PvP: комната копит до TEAM_SIZE*2 людей
// (две команды живых), взводы держатся вместе при делении (см. assignTeams).
const waitingRooms = { capture: null, annihilation: null }

// ---------- взвод-лобби (до боя): реалтайм состав + готовность ----------
// squadId = tg-id командира. Участники держат WS в режиме лобби (?squad=<id>).
// Командир жмёт «старт» → всем squad-launch → каждый заходит в бой с party=squadId
// (готовая группировка assignTeams сводит их в одну команду).
const squads = new Map() // squadId -> { id, members: Map(memberId -> {id, name, ready, ws, tank}) }
const SQUAD_MAX = 3 // командир + 2
const MAX_TIER_SPREAD = 1 // взвод только в пределах ±1 уровня техники: иначе тир боя
// якорится по СТАРШЕМУ (anchorTier=max), боты весят 9-10 тира, и младший напарник —
// единственная картонка на поле. ЗЕРКАЛО: client/src/game/squad.js. (было 9 «под наплыв».)

// техника участника от клиента: { id, tier, name } — чистим перед хранением
function sanitizeTank(t) {
  if (!t || typeof t !== 'object') return null
  const tier = Math.round(+t.tier || 0)
  if (!(tier >= 1 && tier <= 10)) return null
  return { id: String(t.id || '').slice(0, 16), tier, name: String(t.name || '').slice(0, 24) }
}

function squadRoster(sq) {
  return [...sq.members.values()].map((m) => ({ id: m.id, name: m.name, ready: m.ready, leader: m.id === sq.id, tank: m.tank || null }))
}
function broadcastSquad(sq) {
  const members = squadRoster(sq)
  for (const m of sq.members.values()) send(m.ws, { type: 'squad', squadId: sq.id, members })
}
function squadJoin(squadId, memberId, name, tank, ws) {
  let sq = squads.get(squadId)
  if (!sq) {
    sq = { id: squadId, members: new Map() }
    squads.set(squadId, sq)
  }
  if (!sq.members.has(memberId) && sq.members.size >= SQUAD_MAX) {
    send(ws, { type: 'squad-full' })
    return
  }
  sq.members.set(memberId, { id: memberId, name: (name || tr('defaultName', 'en')).slice(0, 24), ready: false, ws, tank: sanitizeTank(tank) })
  ws.squad = sq
  ws.squadMemberId = memberId
  broadcastSquad(sq)
}
// разброс уровней техники во взводе превышает допустимый ±1?
function squadTierBad(sq) {
  const tiers = [...sq.members.values()].map((m) => m.tank && m.tank.tier).filter((t) => t != null)
  return tiers.length >= 2 && Math.max(...tiers) - Math.min(...tiers) > MAX_TIER_SPREAD
}
function squadLeave(ws) {
  const sq = ws.squad
  if (!sq) return
  ws.squad = null
  sq.members.delete(ws.squadMemberId)
  // командир ушёл → взвод распускаем (всем squad-disband)
  if (ws.squadMemberId === sq.id) {
    for (const m of sq.members.values()) send(m.ws, { type: 'squad-disband' })
    squads.delete(sq.id)
  } else if (sq.members.size === 0) {
    squads.delete(sq.id)
  } else {
    broadcastSquad(sq)
  }
}

function newRoom() {
  const room = {
    id: `r${nextId++}`,
    humans: [], // { id, name, team, ws }
    mode: 'capture', // 'capture' | 'annihilation' — задаётся первым вошедшим
    sim: null,
    timer: null,
    waitTimer: null,
    started: false,
    // телеметрия тика
    tickAccMs: 0,
    tickN: 0,
  }
  rooms.set(room.id, room)
  return room
}

function getJoinRoom(mode) {
  // PvP: ВСЕ (взводы + соло) идут в ОБЩУЮ комнату на режим, до TEAM_SIZE*2 людей —
  // чтобы живые встречали живых, а не только ботов. Взвод (один party-токен) остаётся
  // в одной команде при делении (assignTeams в startRoom). Чужие режимы не сводятся.
  const wr = waitingRooms[mode]
  if (wr && !wr.started && wr.humans.length < TEAM_SIZE * 2) return wr
  const nr = newRoom()
  nr.mode = mode
  waitingRooms[mode] = nr
  return nr
}

// делим людей комнаты на 2 команды: взвод (один party-токен) ЦЕЛИКОМ в одну команду,
// соло раскидываем для баланса (жадно — каждую группу в команду с меньшим числом людей,
// не превышая TEAM_SIZE). Так друзья всегда вместе, но против живого врага, когда он есть.
function assignTeams(humans) {
  const groups = new Map()
  for (const h of humans) {
    const key = h.party || `s${h.id}` // взвод по токену, соло — уникальный ключ
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(h)
  }
  const count = [0, 0]
  for (const g of [...groups.values()].sort((a, b) => b.length - a.length)) {
    let t = count[0] <= count[1] ? 0 : 1
    if (count[t] + g.length > TEAM_SIZE) t = 1 - t // не влезает — в другую команду
    for (const h of g) h.team = t
    count[t] += g.length
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

// горячий путь тика: строка уже собрана; при забитом буфере кадр дропаем —
// клиент интерполирует, а сервер не копит чужие мегабайты в памяти
function sendRaw(ws, str) {
  if (ws.readyState === ws.OPEN && ws.bufferedAmount < SEND_BUFFER_LIMIT) ws.send(str)
}

// лобби ожидающим: кто уже в комнате + НА КАКОЙ стороне. Команды раздаём уже
// здесь (а не только в startRoom) — чтобы матчмейкинг показывал РЕАЛЬНЫЙ состав
// 7×7: живые на своих сторонах, боты добьют пустые слоты (все живые → ботов нет).
function broadcastLobby(room) {
  if (room.started) return
  assignTeams(room.humans)
  const players = room.humans.map((h) => ({ id: h.id, name: h.name, battles: h.battles || 0, team: h.team }))
  const startsIn = Math.max(0, room.deadline ? room.deadline - Date.now() : WAIT_MS)
  for (const h of room.humans) send(h.ws, { type: 'lobby', players, you: h.id, yourTeam: h.team, teamSize: TEAM_SIZE, startsIn })
}

// грейс перед закрытием опустевшей живой комнаты: даём игроку вернуться
// (iOS-сокет умирает молча на старте боя — нужен запас на переподключение)
const RECONNECT_GRACE_MS = +(process.env.RECONNECT_GRACE_MS || 30000)
const genKey = () => Math.random().toString(36).slice(2, 10)

// опустела живая комната — не убиваем сразу, ждём реконнект; вернулся игрок —
// таймер снимаем (cancelRoomEnd при добавлении человека)
function scheduleRoomEnd(room) {
  if (room.endTimer || !room.started) return
  room.endTimer = setTimeout(() => {
    room.endTimer = null
    if (room.humans.length === 0) {
      console.log(`[ws] ${room.id}: никто не вернулся за ${RECONNECT_GRACE_MS}мс — закрываю`)
      endRoom(room)
    }
  }, RECONNECT_GRACE_MS)
}
function cancelRoomEnd(room) {
  if (room.endTimer) {
    clearTimeout(room.endTimer)
    room.endTimer = null
  }
}

// общий обработчик боевого сокета (свежий вход И реконнект): ввод/огонь/пинг,
// свой токен-бакет от флуда, корректное закрытие. Закрытие удаляет ИМЕННО этот
// сокет (human.ws === ws): после реконнекта human.ws уже указывает на новый
// сокет, и close мёртвого старого ничего не ломает.
function setupBattleSocket(ws, room, human, ip) {
  let tokens = MSG_BURST
  let lastRefill = Date.now()
  ws.on('message', (raw) => {
    const now = Date.now()
    tokens = Math.min(MSG_BURST, tokens + ((now - lastRefill) / 1000) * MSG_RATE)
    lastRefill = now
    if (--tokens < 0) {
      console.log(`[ws] ${human.id}: флуд (${ip}), разрываю`)
      ws.terminate()
      return
    }
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'name' && typeof msg.name === 'string') {
      human.name = msg.name.slice(0, 24)
      broadcastLobby(room)
    } else if (msg.type === 'join') {
      // профиль бойца: имя, машина, камуфляж и боевые статы лоадаута —
      // всё с клиента, поэтому формат и диапазоны проверяем жёстко
      if (typeof msg.name === 'string' && msg.name.trim()) human.name = msg.name.trim().slice(0, 24)
      if (typeof msg.tankId === 'string' && ID_RE.test(msg.tankId)) human.tankId = msg.tankId
      if (typeof msg.tint === 'number' && Number.isFinite(msg.tint)) human.tint = msg.tint & 0xffffff
      if (typeof msg.skin === 'string' && ID_RE.test(msg.skin)) human.skin = msg.skin
      if (typeof msg.battles === 'number' && Number.isFinite(msg.battles)) human.battles = Math.max(0, Math.min(1e6, msg.battles | 0))
      // тир машины игрока (1..10) — по нему сервер подбирает ботам ±1 тир (HP/урон+спрайт).
      // Скаляр, жёстко клампим: клиент НЕ задаёт статы ботов (иначе слал бы себе слабых).
      if (typeof msg.tier === 'number' && Number.isFinite(msg.tier)) human.tier = Math.max(1, Math.min(10, msg.tier | 0))
      // best-effort tg-id ТОЛЬКО для аналитики (не авторизация): сшивает серверные
      // server_match_* с клиентским tg_<id>. Нет/гость — событий просто не шлём.
      if (typeof msg.uid === 'string' && /^\d{3,20}$/.test(msg.uid)) human.uid = 'tg_' + msg.uid
      ws.uid = human.uid || null // для честного счётчика онлайна (уникальные tg-id, не сокеты)
      human.stats = sanitizeStats(msg.stats)
      // дедуп по tg-id: один игрок не должен висеть сразу в НЕСКОЛЬКИХ комнатах
      // (вкладки / разные режимы / перезаходы webview) — иначе у него «клоны».
      // Выкидываем его прежние коннекты из ВСЕХ ещё не стартовавших комнат (живой
      // бой НЕ трогаем — оттуда не выкидываем). Оставляем это (свежее) соединение.
      // Пустую чужую комнату добьёт ws.close-обработчик дубля (endRoom).
      if (human.uid) {
        for (const r of rooms.values()) {
          if (r.started) continue
          for (const dup of [...r.humans]) {
            if (dup !== human && dup.uid === human.uid) {
              r.humans = r.humans.filter((h) => h !== dup)
              try { dup.ws.close(4002, 'dup') } catch {}
              console.log(`[ws] дубль ${dup.id} (${human.uid}) выкинут из ${r.id} (оставлен ${human.id} в ${room.id})`)
            }
          }
        }
      }
      broadcastLobby(room)
      // теперь известны battles/состав — пересчитываем старт: соло-новичок стартует
      // быстро (пулинг), но если рядом уже ≥2 живых — короткий добор живого PvP, а не
      // мгновенные боты. Ближайший дедлайн (поздний вход не двигает старт назад).
      scheduleStart(room)
    } else if (!room.sim) {
      return
    } else if (msg.type === 'input') {
      room.sim.setInput(human.id, msg.throttle, msg.steer)
    } else if (msg.type === 'fire') {
      room.sim.fire(human.id)
    } else if (msg.type === 'tutorial-done') {
      // клиент закончил/пропустил обучающий гайд первого боя — будим замороженных ботов
      if (room.training) room.guided = false
    } else if (msg.type === 'ready') {
      // клиент досчитал «3-2-1» (или instant) и готов вступить в бой. Размораживаем мир,
      // когда готовы ВСЕ люди комнаты → старт у игрока и ботов синхронный (фикс «боты едут
      // в отсчёт + раньше на позициях»). Если кто-то не пришлёт — спасёт бэкстоп startAt.
      human.ready = true
      if (room.humans.length && room.humans.every((h) => h.ready)) room.fightStarted = true
    } else if (msg.type === 'ping') {
      send(ws, { type: 'pong', ts: msg.ts })
    }
  })
  ws.on('close', () => {
    const n = (ipCount.get(ip) || 1) - 1
    if (n <= 0) ipCount.delete(ip)
    else ipCount.set(ip, n)
    // реконнект мог увести human на новый сокет — тогда этот close уже не наш
    if (human.ws !== ws) return
    console.log(`[ws] ${human.id} вышел из ${room.id}`)
    room.humans = room.humans.filter((h) => h !== human)
    if (room.sim) room.sim.humanLeft(human.id) // ИИ доигрывает за него
    if (!room.started) {
      broadcastLobby(room)
      if (room.humans.length === 0) endRoom(room)
    } else if (room.humans.length === 0) {
      scheduleRoomEnd(room) // живой бой — даём шанс вернуться, не рубим сразу
    }
  })
}

// возврат в идущий бой по ?rejoin=<roomId>&unit=<id>&rkey=<токен>: находим живой
// юнит, привязываем к нему новый сокет (human.ws), снапшоты возобновляются.
function doRejoin(ws, ip, roomId, unitId, rkey) {
  const room = rooms.get(roomId)
  if (!room || !room.started || !room.sim || room.sim.matchOver) {
    send(ws, { type: 'rejoin-fail' })
    return ws.close(1000, 'no-room')
  }
  if (!room.rejoinKeys || room.rejoinKeys.get(unitId) !== rkey) {
    send(ws, { type: 'rejoin-fail' })
    return ws.close(1000, 'bad-key')
  }
  const unit = room.sim.byId.get(unitId)
  if (!unit) {
    send(ws, { type: 'rejoin-fail' })
    return ws.close(1000, 'no-unit')
  }
  cancelRoomEnd(room)
  unit.human = true
  room.sim.byOwner.set(unit.ownerId, unit)
  let human = room.humans.find((h) => h.id === unit.ownerId)
  if (human) {
    human.ws = ws // увели на новый сокет — старый close станет no-op
  } else {
    human = { id: unit.ownerId, party: null, name: unit.name, team: unit.team, ws, stats: unit.stats, tankId: unit.tankId, tint: unit.tint, skin: unit.skin, battles: 0, rkey }
    room.humans.push(human)
  }
  ws.playerId = unit.ownerId
  ws.room = room
  setupBattleSocket(ws, room, human, ip)
  send(ws, {
    type: 'match-start',
    rejoined: true, // клиент: это не новый бой, а возврат в текущий — не пересобирать
    youTeam: unit.team,
    youUnit: unit.id,
    teamSize: TEAM_SIZE,
    map: room.sim.mapSize,
    mapId: room.sim.mapId,
    mode: room.mode,
    humans: room.humans.length,
    tickHz: SNAP_HZ, // частота снапшотов (для интерполяции у клиента)
    room: room.id,
    rkey,
  })
  console.log(`[ws] ${unit.ownerId} ВЕРНУЛСЯ в ${room.id} (юнит ${unit.id})`)
}

// Маскировка ботов: пул имён РЕАЛЬНЫХ аккаунтов (вперемешку с BOT_NICKS в sim).
// Обновляем раз в 3 мин из профилей, читаем синхронно при старте боя. Отсеиваем
// плейсхолдеры и слишком длинные/короткие; перемешиваем и ограничиваем размер.
let realBotNames = []
async function refreshBotNames() {
  try {
    const ps = await listProfiles()
    const names = ps
      .map((p) => (p.name || '').trim())
      .filter((n) => n.length >= 2 && n.length <= 18 && !/^(Игрок|Боец|Гость)\b/i.test(n))
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[names[i], names[j]] = [names[j], names[i]]
    }
    realBotNames = names.slice(0, 300)
  } catch {}
}
refreshBotNames()
setInterval(refreshBotNames, 180000).unref?.()

// Матчмейкинг: когда стартовать комнату и с кем. ≥14 живых — сразу (полный PvP);
// ≥2 живых — короткое окно ДОБОРА (FILL_MS) — сводим живых вместе; один новичок —
// окно ПУЛИНГА (NEWBIE_WAIT_MS); один ветеран — ждёт живых дольше (WAIT_MS). Берём
// БЛИЖАЙШИЙ дедлайн (поздний вход не двигает старт назад — антигриф + быстрый матч
// под наплыв). Вызывать на каждом входе/«join», когда известно battles/состав.
function scheduleStart(room) {
  if (room.started) return
  // тренировочная комната (первый бой новичка): соло + боты, стартуем сразу как
  // пришли статы (join) — без окна добора живых.
  if (room.training) {
    startRoom(room)
    return
  }
  const n = room.humans.length
  if (n === 0) return
  if (n >= TEAM_SIZE * 2) {
    startRoom(room)
    return
  }
  if (n >= 2) {
    // живой PvP формируется → КОПИМ живых: окно добора FILL_MS после каждого входа,
    // но не дольше FILL_MAX_MS от появления второго живого. Поток иссяк — старт через
    // FILL_MS; идёт наплыв — набираем к полному 7×7 (или мгновенно при 14 выше).
    if (!room.fillStart) room.fillStart = Date.now()
    const deadline = Math.min(Date.now() + FILL_MS, room.fillStart + FILL_MAX_MS)
    clearTimeout(room.waitTimer)
    room.deadline = deadline
    room.waitTimer = setTimeout(() => startRoom(room), Math.max(0, deadline - Date.now()))
    return
  }
  // соло: новичок — быстрый пулинг (NEWBIE_WAIT_MS), ветеран — дольше ждёт живых
  // (WAIT_MS). Берём БЛИЖАЙШИЙ дедлайн (поздний вход не двигает соло-старт назад).
  const solo = room.humans[0]
  const newbie = !solo.party && (solo.battles | 0) < INSTANT_BATTLE_BELOW
  // РАНДОМ времени поиска: было ровно WAIT_MS (всегда ~8с — игрок видит, что подбор
  // «фейково-ровный», #29 @Z_86_V «сделать более рандомным»). Життерим ОДИН раз на
  // комнату (±, ~5.5–11с вокруг 8с), чтобы каждый поиск ощущался как живой подбор, а
  // не таймер. Новичку оставляем быстрый старт (NEWBIE_WAIT_MS) — лёгкий джиттер.
  if (!room.soloWait) {
    room.soloWait = newbie ? Math.round(NEWBIE_WAIT_MS * (0.85 + Math.random() * 0.35)) : Math.round(WAIT_MS * (0.7 + Math.random() * 0.65))
  }
  const wait = room.soloWait
  const deadline = Date.now() + wait
  if (room.waitTimer && room.deadline && room.deadline <= deadline) return // уже назначен более ранний старт
  clearTimeout(room.waitTimer)
  room.deadline = deadline
  room.waitTimer = setTimeout(() => startRoom(room), wait)
}

function startRoom(room) {
  if (room.started) return
  room.started = true
  clearTimeout(room.waitTimer)
  if (waitingRooms[room.mode] === room) waitingRooms[room.mode] = null
  // фиксируем флаг авторитетной экономики на ВЕСЬ бой (горячий путь тика синхронный)
  room.econAuthority = econ.econAuthorityCached()

  // PvP: делим живых на 2 команды (взводы цело, соло — балансом). Каждая команда
  // добирается ботами в sim. Соло против соло = настоящий бой человек-vs-человек.
  assignTeams(room.humans)
  const map = randomMap()
  // «Мягкий старт»: берём самого зелёного человека в комнате и смягчаем ботов
  // ПЛАВНО по числу его боёв (бой №1 максимально тупые → к бою 6 норма; см.
  // softFactor/SOFT_START в shared/config.js). Новичок почти всегда соло-против-
  // ботов, так что смягчение точечное; ветеран в миксе просто получит softFactor
  // по своему (меньшему) числу боёв — дуэль человек-vs-человек не затронута.
  // тренировка форсит МАКСИМАЛЬНО мягких ботов (как первый бой), даже если клиент
  // прислал battles>0 — гайд должен быть безопасным
  const minBattles = room.training ? 0 : Math.min(...room.humans.map((h) => h.battles | 0))
  const softF = softFactor(minBattles)
  const softStart = softF > 0
  // тир боя = макс. среди живых (соло-PvE = тир игрока). По нему боты весят ±1 тира.
  const humanTiers = room.humans.map((h) => h.tier).filter((t) => t >= 1 && t <= 10)
  const anchorTier = humanTiers.length ? Math.max(...humanTiers) : null
  // ВЕТЕРАНСКИЙ СКЕЙЛ: боты умнее по прогрессу САМОГО опытного человека в комнате (число
  // боёв + тир). Тренировка/мягкий старт его подавляют (sim гейтит vet=0 при softStart).
  const maxBattles = Math.max(0, ...room.humans.map((h) => h.battles | 0))
  const vet = room.training ? 0 : vetFactor(maxBattles, anchorTier)
  room.sim = new BattleSim({
    teamSize: TEAM_SIZE,
    mapId: map.id,
    mode: room.mode,
    softFactor: softF,
    vet,
    humans: room.humans.map((h) => ({ id: h.id, team: h.team, name: h.name, stats: h.stats, tankId: h.tankId, tint: h.tint, skin: h.skin })),
    botNames: realBotNames, // маскировка: боты берут имена реальных аккаунтов + BOT_NICKS
    anchorTier,
  })

  // мир застыл, ПОКА клиент(ы) не пришлют 'ready' (досчитали «3-2-1»/instant). startAt —
  // только БЭКСТОП (см. READY_MAX_MS): старт боя — по готовности ВСЕХ людей (см. roomTick).
  room.startAt = Date.now() + READY_MAX_MS
  room.fightStarted = false
  for (const h of room.humans) h.ready = false
  // тренировка: враги заморожены, пока клиент ведёт гайд; бэкстоп — будим через 90с,
  // если tutorial-done так и не пришёл (стух/закрыл вкладку)
  if (room.training) room.guidedDeadline = Date.now() + 90000

  // ростер боя для экрана «БОЙ НАЙДЕН»: имена+команды ВСЕХ юнитов, чтобы предбоевой
  // список совпал с ником в самом бою. БЕЗ флага human/bot — это тэлл (боты неотличимы).
  const roster = room.sim.units.map((u) => ({ id: u.id, name: u.name, team: u.team }))
  // ключи реконнекта: по unitId, переживают отвал сокета (для возврата в бой)
  room.rejoinKeys = new Map()
  for (const h of room.humans) {
    const u = room.sim.byOwner.get(h.id)
    const rkey = genKey()
    h.rkey = rkey
    if (u) room.rejoinKeys.set(u.id, rkey)
    send(h.ws, {
      type: 'match-start',
      youTeam: h.team,
      youUnit: u ? u.id : null,
      teamSize: TEAM_SIZE,
      map: room.sim.mapSize, // размер карты (большие карты — больше места)
      mapId: map.id,
      mode: room.mode,
      humans: room.humans.length,
      startsIn: COUNTDOWN_MS, // длительность стартового отсчёта (мир застыл столько)
      tickHz: SNAP_HZ, // частота снапшотов (для интерполяции у клиента)
      room: room.id, // для реконнекта: куда возвращаться, если сокет умрёт
      rkey, // токен возврата в этот бой за свой юнит
      roster, // полный список бойцов (имя+команда) — для совпадения предбоевого списка с боем
    })
  }
  // серверно-авторитетный старт боя (backstop к клиентскому battle_started): только
  // для игроков с известным tg-id — гостей в аналитику матчей не тащим
  for (const h of room.humans) {
    if (!h.uid) continue
    recordBattleEntry(h.uid) // серверный счётчик боёв +1 + «дошёл до боя» (не зависит от клиентского stats.battles)
    logEvent(h.uid, 'battle_start', { room: room.id, mode: room.mode, map: map.id, tank: h.tankId || null, humans: room.humans.length })
    trackServer(h.uid, 'server_match_started', {
      room_id: room.id,
      mode: room.mode,
      map_id: map.id,
      humans: room.humans.length,
      bots_estimated: TEAM_SIZE * 2 - room.humans.length,
      party_present: !!h.party,
      team: h.team,
      soft_start: softStart, // «мягкий старт» включён для этой комнаты
      soft_factor: +softF.toFixed(2), // сила смягчения 1.0..0 (плавный спад бой1→6)
      newbie_battles: minBattles, // боёв у самого зелёного игрока комнаты
    })
    // соц-хук «друг в бою»: пингуем живых друзей этого игрока (троттлинг и фильтр
    // реальных игроков — внутри; ферма Traffy отсекается). Fire-and-forget — не тормозим старт.
    notifyFriendsInBattle({ uid: h.uid, name: h.name }).catch(() => {})
  }
  console.log(
    `[ws] ${room.id}: старт ${TEAM_SIZE}x${TEAM_SIZE} на «${map.name}», люди ${room.humans.filter((h) => h.team === 0).length}vs${room.humans.filter((h) => h.team === 1).length}, остальное — боты${softStart ? ` · МЯГКИЙ СТАРТ ×${softF.toFixed(2)}` : ''}`,
  )

  room.timer = setInterval(() => {
    try {
      roomTick(room)
    } catch (e) {
      // комната не должна ронять процесс с остальными боями
      console.error(`[ws] ${room.id}: tick error, закрываю комнату`, e)
      for (const h of room.humans) send(h.ws, { type: 'match-end', winner: null, reason: 'aborted', score: room.sim ? room.sim.score : [0, 0], stats: [] })
      endRoom(room)
    }
  }, 1000 / TICK_HZ)
}

function roomStats(room) {
  return room.sim.units.map((u) => ({
    id: u.id,
    team: u.team,
    name: u.name,
    // human НЕ отдаём — финальная таблица не должна выдавать ботов
    kills: u.kills,
    damage: Math.round(u.damageDealt),
    alive: u.alive,
  }))
}

function roomTick(room) {
    const t0 = process.hrtime.bigint()
    // СТАРТОВЫЙ ОТСЧЁТ: клиент крутит «3-2-1» (Battle.vue), и пока он идёт — мир
    // на сервере ЗАСТЫЛ (боты не едут и не стреляют, время t не идёт). Снапшоты
    // всё равно шлём — поле видно за оверлеем отсчёта. Размораживаемся в startAt.
    const warming = !room.fightStarted && room.startAt && Date.now() < room.startAt
    // буфер событий инициализируем ВСЕГДА (даже в warmup) — иначе снапшот ниже
    // вызывает eventsForTeam(undefined) и комната падает на первом тике отсчёта
    if (!room.evBuf) room.evBuf = []
    // тренировка: враги заморожены, пока идёт гайд (room.guided). Бэкстоп — если
    // клиент не прислал tutorial-done за разумное время, будим ботов сами.
    if (room.guided && room.guidedDeadline && Date.now() > room.guidedDeadline) room.guided = false
    if (!warming) {
      room.sim.step(TICK_DT, !!room.guided)
      // события копим между отправками: шлём реже тика, но НИ ОДНО не теряем
      // (выстрелы/попадания/киллы с пропущенных тиков уходят со следующим снапшотом)
      const ev = room.sim.takeEvents()
      if (ev.length) room.evBuf.push(...ev)
    }
    room.sinceSnap = (room.sinceSnap || 0) + 1

    if (room.sinceSnap >= SNAP_EVERY || room.sim.matchOver) {
      room.sinceSnap = 0
      const events = room.evBuf || []
      room.evBuf = []
      // сериализация один раз на команду: личная добавка подклеивается строкой
      const teamStr = [0, 1].map((t) =>
        JSON.stringify({ ...room.sim.snapshotForTeam(t), events: room.sim.eventsForTeam(events, t) }),
      )
      for (const h of room.humans) {
        const you = JSON.stringify(room.sim.personalFor(h.id))
        sendRaw(h.ws, teamStr[h.team].slice(0, -1) + ',"you":' + you + '}')
      }
    }
    room.tickAccMs += Number(process.hrtime.bigint() - t0) / 1e6
    room.tickN++

    if (room.sim.matchOver) {
      const stats = roomStats(room)
      // ЭКОНОМИКА V1 — контекст коэффициента эффективности: вклад каждого юнита (урон+фраги·300),
      // макс по бою (MVP), макс по команде (best), средний (good/avg/weak). Боты участвуют в ранге.
      const scored = stats.map((s) => ({ team: s.team, sc: econ.contribScore({ damage: s.damage, kills: s.kills }) }))
      const matchMax = scored.reduce((mx, x) => Math.max(mx, x.sc), 0)
      const teamMax = scored.reduce((mp, x) => { mp[x.team] = Math.max(mp[x.team] || 0, x.sc); return mp }, {})
      const avgScore = scored.length ? scored.reduce((a, x) => a + x.sc, 0) / scored.length : 0
      for (const h of room.humans) {
        send(h.ws, { type: 'match-end', winner: room.sim.winner, score: room.sim.score, reason: room.sim.endReason, stats })
      }
      // серверно-авторитетный итог (backstop к клиентскому battle_finished)
      for (const h of room.humans) {
        if (!h.uid) continue
        trackServer(h.uid, 'server_match_finished', {
          room_id: room.id,
          winner: room.sim.winner,
          reason: room.sim.endReason,
          score_ally: room.sim.score[h.team],
          score_enemy: room.sim.score[1 - h.team],
          team: h.team,
          humans: room.humans.length,
          stats_count: stats.length,
        })
        const _mu = room.sim.byOwner.get(h.id); const mine = _mu ? { kills: _mu.kills, damage: Math.round(_mu.damageDealt), alive: _mu.alive } : null // FIX #29: мой юнит по byOwner (s.id в stats = unit.id ≠ h.id → раньше mine=null → у ВСЕХ 0 урона/0 фрагов → afk-награда)
        logEvent(h.uid, 'battle_end', {
          room: room.id,
          win: room.sim.winner === h.team,
          draw: room.sim.winner == null,
          score: room.sim.score[h.team] + ':' + room.sim.score[1 - h.team],
          kills: mine ? mine.kills : 0,
          dmg: mine ? mine.damage : 0,
          alive: mine ? mine.alive : false,
          tank: h.tankId || null,
        })
        // СЕРВЕРНО-АВТОРИТЕТНАЯ НАГРАДА (флаг ВКЛ): начисляем кредиты/жетоны из СВОИХ
        // чисел боя в pendingGrants (клиент заберёт на ближайшем applyPendingGrants).
        // fire-and-forget: match-end уже ушёл, начисление не блокирует закрытие комнаты.
        if (room.econAuthority && !room.granted) {
          const result = room.sim.winner == null ? 'draw' : room.sim.winner === h.team ? 'victory' : 'defeat'
          // коэффициент эффективности по вкладу игрока + рангу (AFK 0.5 … MVP 2.0)
          const mineScore = econ.contribScore({ damage: mine ? mine.damage : 0, kills: mine ? mine.kills : 0 })
          const efficiency = econ.battleEfficiency({ score: mineScore, teamMax: teamMax[h.team] || 0, matchMax, avg: avgScore })
          econ.grantBattle(h, { result, kills: mine ? mine.kills : 0, damage: mine ? mine.damage : 0, efficiency, survived: mine ? mine.alive : false }, room.id).catch((e) => console.error('[econ] grantBattle:', e && e.message))
        }
      }
      room.granted = true // гард от повторного начисления, если matchOver увидят дважды
      console.log(
        `[ws] ${room.id}: конец, счёт ${room.sim.score.join(':')}, winner=${room.sim.winner}, средний тик ${(room.tickAccMs / Math.max(1, room.tickN)).toFixed(3)}мс`,
      )
      endRoom(room)
    }
}

function endRoom(room) {
  clearInterval(room.timer)
  clearTimeout(room.waitTimer)
  clearTimeout(room.endTimer)
  rooms.delete(room.id)
  if (waitingRooms[room.mode] === room) waitingRooms[room.mode] = null
  // сокеты не рвём — клиент сам уходит после match-end
}

// heartbeat: полуоткрытые сокеты (мобильная сеть пропала) добиваем сами
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
}, 30000)
wss.on('close', () => clearInterval(heartbeat))

wss.on('connection', (ws, req) => {
  // x-real-ip ставит наш nginx (доверенный); клиентский x-forwarded-for — только
  // фоллбэк без прокси. Иначе за nginx все игроки = 127.0.0.1 и MAX_PER_IP
  // превращается в глобальный потолок сокетов на весь сервер.
  const ip =
    String(req.headers['x-real-ip'] || '').trim() ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '?'
  if (wss.clients.size > MAX_SOCKETS || (ipCount.get(ip) || 0) >= MAX_PER_IP) {
    ws.close(1013, 'busy')
    return
  }
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1)
  // TCP_NODELAY: слать каждый снапшот СРАЗУ, а не копить Нэйглом в пачки (иначе
  // 60Гц поток приходит рывками раз в ~RTT → дёрг). Критично для риалтайма.
  try { req.socket.setNoDelay(true) } catch {}
  ws.isAlive = true
  ws.on('pong', () => (ws.isAlive = true))
  ws.on('error', (e) => console.error(`[ws] socket error:`, e.message)) // без хендлера 'error' валит процесс

  // токен взвода из query (?party=<id командира>) — группирует друзей в одну
  // комнату; режим (?mode=annihilation) — какой бой искать (захват по умолчанию)
  let party = null
  let mode = 'capture'
  let training = false
  let squadId = null
  let rejoinRoom = null
  let rejoinUnit = 0
  let rejoinKey = ''
  try {
    const q = new URL(req.url, 'http://x').searchParams
    party = (q.get('party') || '').replace(/[^0-9]/g, '').slice(0, 20) || null
    mode = q.get('mode') === 'annihilation' ? 'annihilation' : 'capture'
    training = q.get('training') === '1' // тренировочный первый бой: соло + замороженные боты
    squadId = (q.get('squad') || '').replace(/[^0-9]/g, '').slice(0, 20) || null
    rejoinRoom = (q.get('rejoin') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || null
    rejoinUnit = (q.get('unit') || '').replace(/[^0-9]/g, '').slice(0, 6) | 0
    rejoinKey = (q.get('rkey') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16)
  } catch {
    party = null
  }

  // ===== РЕКОННЕКТ (?rejoin=<roomId>&unit=<id>&rkey=<токен>): возврат в идущий бой =====
  if (rejoinRoom) {
    doRejoin(ws, ip, rejoinRoom, rejoinUnit, rejoinKey)
    return
  }

  // ===== режим ВЗВОД-ЛОББИ (?squad=<id командира>): состав до боя, в бой НЕ заходим =====
  if (squadId) {
    let tk = MSG_BURST
    let lr = Date.now()
    ws.on('message', (raw) => {
      const now = Date.now()
      tk = Math.min(MSG_BURST, tk + ((now - lr) / 1000) * MSG_RATE)
      lr = now
      if (--tk < 0) return ws.terminate()
      let m
      try {
        m = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (m.type === 'squad-join' && m.id) {
        squadJoin(squadId, String(m.id).replace(/[^0-9]/g, '').slice(0, 20), m.name, m.tank, ws)
      } else if (m.type === 'squad-tank') {
        // сменил технику в ангаре, пока во взводе — обновляем уровень для проверки
        const me = ws.squad && ws.squad.members.get(ws.squadMemberId)
        if (me) {
          me.tank = sanitizeTank(m.tank)
          broadcastSquad(ws.squad)
        }
      } else if (m.type === 'ready') {
        const me = ws.squad && ws.squad.members.get(ws.squadMemberId)
        if (me) {
          me.ready = !!m.ready
          broadcastSquad(ws.squad)
        }
      } else if (m.type === 'launch' && ws.squad && ws.squadMemberId === ws.squad.id) {
        // гейт уровня: разная техника (> ±1) — старт запрещён (страховка к UI-блоку)
        if (squadTierBad(ws.squad)) {
          send(ws, { type: 'squad-warn', reason: 'tier' })
          return
        }
        // только командир стартует — всем участникам команда зайти в бой
        const lmode = m.mode === 'annihilation' ? 'annihilation' : 'capture'
        for (const mem of ws.squad.members.values()) send(mem.ws, { type: 'squad-launch', squadId: ws.squad.id, mode: lmode })
      }
    })
    ws.on('close', () => {
      const n = (ipCount.get(ip) || 1) - 1
      if (n <= 0) ipCount.delete(ip)
      else ipCount.set(ip, n)
      squadLeave(ws)
    })
    return
  }

  const id = `p${nextId++}`
  // тренировочный первый бой: ОТДЕЛЬНАЯ комната (НЕ из общего пула waitingRooms),
  // чтобы к новичку не подсел живой игрок — только он и (замороженные на гайд) боты.
  const room = training ? Object.assign(newRoom(), { mode, training: true, guided: true }) : getJoinRoom(mode)
  // party-токен храним на игроке — по нему делим на команды в startRoom (взвод цело)
  const human = { id, party, name: tr('lobbyPlayer', 'en', { id }), team: 0, ws, stats: null, tankId: null, tint: 0, skin: null, battles: 0, uid: null }
  room.humans.push(human)
  ws.playerId = id
  ws.room = room

  send(ws, { type: 'init', id, map: MAP_SIZE, tickHz: TICK_HZ, teamSize: TEAM_SIZE, waitMs: WAIT_MS })
  console.log(`[ws] ${id} → ${room.id} (${room.humans.length} чел.)${training ? ' [тренировка]' : ''}`)

  if (training) {
    // тренировка: ждём только join (статы танка) → scheduleStart мгновенно стартует.
    // фолбэк-таймер на случай, если join не дошёл (стартуем на DEFAULT_CLASS)
    room.waitTimer = setTimeout(() => startRoom(room), 8000)
  } else if (room.humans.length === 1) {
    // первый в комнате — потолок ожидания (WAIT_MS); точный режим (новичок/≥2 живых)
    // уточнит join-сообщение через scheduleStart. ≥2-й живой уже здесь → окно добора.
    room.deadline = Date.now() + WAIT_MS
    room.waitTimer = setTimeout(() => startRoom(room), WAIT_MS)
  } else {
    scheduleStart(room) // появился ≥2-й живой → быстрый добор (или мгновенно при полном лобби)
  }
  broadcastLobby(room)

  // ввод/огонь/пинг + корректное закрытие (общий путь со входом-реконнектом)
  setupBattleSocket(ws, room, human, ip)
})

// мягкое выключение (деплой делает systemctl restart): бои живут в памяти,
// поэтому перед смертью рассылаем match-end (клиент покажет итог) и закрываем
// сокеты кодом 1001 — иначе игроки 5с смотрят на замёрзший кадр и молча
// проваливаются в офлайн-бой с ботами «взвод не работает»
let shuttingDown = false
function shutdown(sig) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[srv] ${sig}: мягкое выключение — боёв ${rooms.size}, взводов ${squads.size}`)
  for (const room of [...rooms.values()]) {
    if (room.sim) {
      for (const h of room.humans) send(h.ws, { type: 'match-end', winner: null, reason: 'aborted', score: room.sim.score, stats: roomStats(room) })
    }
    endRoom(room)
  }
  for (const sq of [...squads.values()]) {
    for (const m of sq.members.values()) send(m.ws, { type: 'squad-disband' })
  }
  squads.clear()
  for (const ws of wss.clients) {
    try {
      ws.close(1001, 'restart')
    } catch {
      /* уже закрыт */
    }
  }
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref() // сокеты не успели — всё равно выходим
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

httpServer.listen(PORT, () => {
  console.log(`[srv] Panzer TG: HTTP API + WS ${TEAM_SIZE}x${TEAM_SIZE} на :${PORT} (${TICK_HZ}Hz, добор ботами через ${WAIT_MS}мс)`)
  startPaymentsLoop()
  startSupportBot() // саппорт-бот (если задан SUPPORT_BOT_TOKEN/SUPPORT_CHAT_ID)
  startNotifications() // пуши возврата (дейли-награда/задачи + винбэк) по расписанию
})
