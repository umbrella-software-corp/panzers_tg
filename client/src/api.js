// Клиент серверного API: профиль + платежи Stars.
// Авторизация: подписанный Telegram initData; вне Telegram — dev-гость
// со стабильным id в localStorage.
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
  else h['x-guest-id'] = guestId()
  return h
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } })
  if (!res.ok) throw new Error(`api ${path}: ${res.status}`)
  return res.json()
}

export const apiLoadProfile = () => call('/api/profile')
export const apiSaveProfile = (profile) => call('/api/profile', { method: 'POST', body: JSON.stringify({ profile }) })
export const apiBuy = (productId, extra = {}) => call('/api/invoice', { method: 'POST', body: JSON.stringify({ productId, ...extra }) })
// смена позывного за звёзды: имя едет в payload инвойса, сервер ставит его после оплаты
export const apiRename = (name) => apiBuy('rename', { name })
