// Админка: одна самодостаточная HTML-страница на GET /admin.
// Ключ спрашивается на входе и хранится в localStorage; все данные —
// с /api/admin/* с заголовком x-admin-key. Автообновление раз в 5 секунд.
export const adminPage = () => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panzer TG — админка</title>
<style>
  :root { --bg:#11150f; --panel:#181d15; --line:#2c3326; --ink:#e8e6da; --dim:#9aa08c; --amber:#f2a50c; --green:#8db84a; --red:#ff4b33; --blue:#4da3ff; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--ink); font:14px/1.5 system-ui, sans-serif; padding:20px; }
  h1 { font-size:20px; letter-spacing:.06em; margin-bottom:16px; }
  h1 b { color:var(--amber); }
  h2 { font-size:13px; letter-spacing:.18em; text-transform:uppercase; color:var(--dim); margin:22px 0 8px; }
  .cards { display:flex; gap:10px; flex-wrap:wrap; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 18px; min-width:130px; }
  .card .v { font-size:24px; font-weight:700; color:var(--amber); }
  .card .l { font-size:11px; color:var(--dim); text-transform:uppercase; letter-spacing:.1em; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { padding:7px 10px; text-align:left; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.08em; background:rgba(0,0,0,.25); }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .ok { color:var(--green); } .warn { color:var(--amber); } .muted { color:var(--dim); }
  #login { max-width:340px; margin:80px auto; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:24px; }
  input { width:100%; padding:10px; background:#0d100a; border:1px solid var(--line); border-radius:8px; color:var(--ink); margin:10px 0; }
  button { width:100%; padding:10px; background:var(--amber); border:none; border-radius:8px; font-weight:700; cursor:pointer; }
  .err { color:var(--red); font-size:12px; }
  #status { position:fixed; top:12px; right:16px; font-size:11px; color:var(--dim); }
</style>
</head>
<body>
<div id="login" hidden>
  <h1>PANZER <b>TG</b> · админка</h1>
  <input id="key" type="password" placeholder="ADMIN_KEY">
  <button onclick="saveKey()">Войти</button>
  <div class="err" id="loginErr"></div>
</div>
<div id="app" hidden>
  <h1>PANZER <b>TG</b> · админка <span class="muted" style="font-size:12px">(обновление каждые 5с)</span></h1>
  <div class="cards" id="cards"></div>
  <h2>Комнаты боёв</h2><div id="rooms"></div>
  <h2>Покупки за звёзды</h2><div id="payments"></div>
  <h2>Игроки</h2><div id="profiles"></div>
</div>
<div id="status"></div>
<script>
const $ = (id) => document.getElementById(id)
const KEY = () => localStorage.getItem('pz.adminKey') || ''
function saveKey() { localStorage.setItem('pz.adminKey', $('key').value.trim()); boot() }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const dt = (ts) => ts ? new Date(ts).toLocaleString('ru-RU') : '—'
const table = (heads, rows) => rows.length
  ? '<table><tr>' + heads.map((h) => '<th>' + h + '</th>').join('') + '</tr>' +
    rows.map((r) => '<tr>' + r.map((c) => '<td' + (typeof c === 'number' ? ' class="num"' : '') + '>' + (typeof c === 'number' ? c.toLocaleString('ru-RU') : c) + '</td>').join('') + '</tr>').join('') + '</table>'
  : '<div class="muted">пока пусто</div>'

async function api(path) {
  const r = await fetch(path, { headers: { 'x-admin-key': KEY() } })
  if (r.status === 401) throw new Error('auth')
  return r.json()
}

async function refresh() {
  const s = await api('/api/admin/stats')
  const prof = await api('/api/admin/profiles')
  $('cards').innerHTML = [
    [s.online, 'онлайн (WS)'],
    [s.rooms.length, 'комнат'],
    [s.profilesCount, 'профилей'],
    [s.payments.length, 'покупок'],
    ['★ ' + s.revenueStars.toLocaleString('ru-RU'), 'выручка, звёзды'],
    [s.payMode === 'stars' ? 'STARS' : 'DEV', 'режим оплаты'],
  ].map(([v, l]) => '<div class="card"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>').join('')

  $('rooms').innerHTML = table(
    ['Комната', 'Статус', 'Карта', 'Счёт', 'Люди'],
    s.rooms.map((r) => [
      r.id,
      r.started ? '<span class="ok">в бою</span>' : '<span class="warn">ожидание</span>',
      esc(r.mapId || '—'),
      r.score ? r.score.join(':') : '—',
      esc(r.humans.map((h) => h.name).join(', ') || '—'),
    ]),
  )

  $('payments').innerHTML = table(
    ['Когда', 'Игрок', 'Товар', '★ Звёзды'],
    s.payments.slice(0, 50).map((p) => [
      dt(p.ts),
      esc(p.uid || '—'),
      esc((s.products[p.productId] || {}).title || p.productId || '—'),
      p.stars || 0,
    ]),
  )

  $('profiles').innerHTML = table(
    ['Игрок', 'UID', 'Кредиты', 'Жетоны', 'Боёв', 'Побед', 'Рейтинг', 'Танков', 'Экипаж ОП', 'Был'],
    prof.profiles.slice(0, 100).map((p) => [
      esc(p.name), esc(p.uid), p.credits, p.tokens, p.battles, p.wins, p.rating, p.tanks, p.crewXp, dt(p.updatedAt),
    ]),
  )
  $('status').textContent = 'обновлено ' + new Date().toLocaleTimeString('ru-RU')
}

let timer = null
async function boot() {
  $('loginErr').textContent = ''
  if (!KEY()) { $('login').hidden = false; $('app').hidden = true; return }
  try {
    await refresh()
    $('login').hidden = true
    $('app').hidden = false
    clearInterval(timer)
    timer = setInterval(() => refresh().catch(() => {}), 5000)
  } catch (e) {
    localStorage.removeItem('pz.adminKey')
    $('login').hidden = false
    $('app').hidden = true
    $('loginErr').textContent = 'Неверный ключ'
  }
}
boot()
</script>
</body>
</html>`
