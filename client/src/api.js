// Клиент серверного API: профиль + платежи Stars.
// Авторизация: подписанный Telegram initData; вне Telegram — dev-гость
// со стабильным id в localStorage.
import { startParam } from './tg.js'

const BASE = import.meta.env.VITE_API_URL || `${location.protocol}//${location.hostname}:8080`

function guestId() {
  let id = localStorage.getItem('pz.guest')
  if (!id) {
    id = Math.random().toString(36).slice(2, 12)
    localStorage.setItem('pz.guest', id)
  }
  return id
}

function headers() {
  const h = { 'Content-Type': 'application/json' }
  const initData = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData
  if (initData) h['x-init-data'] = initData
  else {
    h['x-guest-id'] = guestId()
    // вне Telegram источник трафика берём из start_param (?tgWebAppStartParam=…);
    // у реальных юзеров сервер берёт его из подписанного initData и заголовок игнорит
    const sp = startParam()
    if (sp) h['x-start-param'] = sp
  }
  return h
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } })
  if (!res.ok) throw new Error(`api ${path}: ${res.status}`)
  return res.json()
}

export const apiLoadProfile = () => call('/api/profile')
// presence-heartbeat: пока мини-апп на экране — раз в 40с говорим серверу «я тут»
// (обновляет lastSeen → онлайн в админке даже в ангаре/меню, где боевой WS закрыт).
// Сервер троттлит запись до 1/мин, ошибки глушим — это не критичный запрос.
export const apiPing = () => call('/api/ping', { method: 'POST', body: '{}' })
let _presenceTimer = null
export function startPresence() {
  const beat = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') apiPing().catch(() => {})
  }
  if (_presenceTimer) clearInterval(_presenceTimer)
  _presenceTimer = setInterval(beat, 40000)
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') beat() // вернулись на экран — сразу отметимся
    })
  beat()
}
export const apiSaveProfile = (profile) => call('/api/profile', { method: 'POST', body: JSON.stringify({ profile }) })
// сейв «на вылет»: keepalive переживает выгрузку вебвью (как sendBeacon, но с нашими
// auth-заголовками x-init-data). Шлём при сворачивании/закрытии мини-аппа, чтобы
// дебаунс-сейв (1.5с) не потерялся — иначе на реоткрытии syncProfile затирал свежий
// прогресс (дерево/кредиты) СТАРЫМ серверным состоянием.
export const apiSaveProfileFlush = (profile) =>
  call('/api/profile', { method: 'POST', body: JSON.stringify({ profile }), keepalive: true }).catch(() => {})
export const apiBuy = (productId, extra = {}) => call('/api/invoice', { method: 'POST', body: JSON.stringify({ productId, ...extra }) })
// смена позывного за звёзды: имя едет в payload инвойса, сервер ставит его после оплаты
export const apiRename = (name) => apiBuy('rename', { name })
// живая таблица лидеров (топ по рейтингу) и серверный конфиг (флаг турниров)
export const apiLeaderboard = () => call('/api/leaderboard')
export const apiConfig = () => call('/api/config')
// живой счётчик «N в сети» для главной (публичный, без побочных эффектов)
export const apiOnline = () => call('/api/online')
// публичный профиль игрока по месту в таблице
export const apiPlayer = (rank) => call('/api/player?rank=' + rank)
// засчёт реферала: «меня пригласил <ref>» (Telegram id пригласившего из deep-link).
// Сервер один раз привязывает реферера и добавляет меня ему в рекруты.
export const apiReferred = (ref) => call('/api/referred', { method: 'POST', body: JSON.stringify({ ref: String(ref) }) })
// юзер дал разрешение боту писать ему (requestWriteAccess) → сервер снимает pushBlocked/pushOff
export const apiPushAllow = () => call('/api/push-allow', { method: 'POST', body: '{}' })
// разовый бонус за включение уведомлений: сервер верифицирует доступ реальной отправкой
// и начисляет жетоны. Ответ: { ok, granted:{tokens} } | { already } | { ok:false, reason }.
export const apiPushBonus = () => call('/api/push-bonus', { method: 'POST', body: '{}' })
// разовый бонус за подписку на канал: сервер проверяет подписку (getChatMember) и
// начисляет. Ответ: { ok, granted } | { already } | { subscribed:false } | { disabled }.
export const apiChannelBonus = () => call('/api/channel-bonus', { method: 'POST', body: '{}' })
// разовый бонус за фидбек: сервер проверяет, писал ли игрок в саппорт-бот, и начисляет.
// Ответ: { ok, granted } | { already } | { wrote:false } | { disabled }.
export const apiFeedbackBonus = () => call('/api/feedback-bonus', { method: 'POST', body: '{}' })
// ежедневный вход: серверный клейм (день/стрик/выдача под локом — нельзя забрать дважды
// с разных устройств). Ответ: { ok, day, reward } | { already:true }. Награда уезжает
// в pendingGrants — её надо забрать через apiGrantsApply.
export const apiDailyBonus = () => call('/api/daily-bonus', { method: 'POST', body: '{}' })
// атомарно применить очередь админ-выдач на сервере и забрать результат (кредиты/жетоны/
// танки начисляет сервер, очередь чистит). Идемпотентно. Ответ: { ok, applied, credits, tokens, owned, pendingGrants }.
export const apiGrantsApply = () => call('/api/grants-apply', { method: 'POST', body: '{}' })
// серверно-авторитетная экономика (при флаге econAuthority): покупки/клеймы валидирует
// и начисляет СЕРВЕР, клиент принимает авторитетный кошелёк. См. server/src/economy.js.
const apiEcon = (action, body = {}) => call('/api/econ/' + action, { method: 'POST', body: JSON.stringify(body) })
export const apiBuyTank = (tankId) => apiEcon('buy-tank', { tankId })
export const apiUpgradeModule = (tankId, modId) => apiEcon('upgrade-module', { tankId, modId })
export const apiUpgradeCrew = (memberId) => apiEcon('upgrade-crew', { memberId })
export const apiBuyCamo = (tankId, camoId) => apiEcon('buy-camo', { tankId, camoId })
export const apiBuySkin = (skinId) => apiEcon('buy-skin', { skinId })
export const apiBuyGoldAmmo = (packId) => apiEcon('buy-gold-ammo', { packId })
export const apiSpendGoldAmmo = (n) => apiEcon('spend-gold-ammo', { n })
export const apiBuyCrate = (crateId) => apiEcon('buy-crate', { crateId })
export const apiClaimTask = (taskId) => apiEcon('claim-task', { taskId })
export const apiClaimRef = (idx) => apiEcon('claim-ref', { idx })
// кланы: список (+ мой клан), создать, вступить, выйти, карточка по id
export const apiClans = () => call('/api/clans')
export const apiCreateClan = (name, tag, emblem) => call('/api/clan/create', { method: 'POST', body: JSON.stringify({ name, tag, emblem }) })
export const apiJoinClan = (clanId) => call('/api/clan/join', { method: 'POST', body: JSON.stringify({ clanId }) })
export const apiLeaveClan = () => call('/api/clan/leave', { method: 'POST', body: JSON.stringify({}) })
export const apiClan = (id) => call('/api/clan/' + encodeURIComponent(id))
// турниры: список (со счётчиком «участвую» и моим статусом), записаться, сняться
export const apiTournaments = () => call('/api/tournaments')
export const apiJoinTournament = (tid) => call('/api/tournament/join', { method: 'POST', body: JSON.stringify({ tid }) })
export const apiLeaveTournament = (tid) => call('/api/tournament/leave', { method: 'POST', body: JSON.stringify({ tid }) })
