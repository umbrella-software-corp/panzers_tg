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
  .lnk { color:var(--blue); cursor:pointer; text-decoration:none; border-bottom:1px dashed rgba(77,163,255,.5); }
  .lnk:hover { border-bottom-style:solid; }
  #drill { position:fixed; inset:0; background:rgba(0,0,0,.82); z-index:50; overflow:auto; padding:20px; }
  .drillcard { max-width:1200px; margin:8px auto; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; }
  .drillhead { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px; }
  #login { max-width:340px; margin:80px auto; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:24px; }
  input { width:100%; padding:10px; background:#0d100a; border:1px solid var(--line); border-radius:8px; color:var(--ink); margin:10px 0; }
  button { width:100%; padding:10px; background:var(--amber); border:none; border-radius:8px; font-weight:700; cursor:pointer; }
  .refbtn { width:auto; padding:5px 12px; font-size:12px; background:var(--red); color:#fff; }
  .refbtn:disabled { opacity:.5; cursor:default; }
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
  <h2>Трафик</h2><div class="cards" id="traffic"></div>
  <h2>Реф-ссылка трафика</h2>
  <div id="reflink">
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
      <span class="muted">метка источника:</span>
      <input id="srcTag" placeholder="напр. tgads, blogger1, channel" style="width:auto; flex:1; min-width:170px; margin:0" onkeydown="if(event.key==='Enter')makeLink()">
      <button style="width:auto; padding:9px 16px" onclick="makeLink()">Сгенерировать ссылку</button>
    </div>
    <div id="linkOut" style="margin-top:10px"></div>
  </div>
  <h2>Проверка пушей</h2>
  <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
    <span class="muted">тест-пуш (дайджест возврата) на uid:</span>
    <input id="pushUid" placeholder="напр. 485427336" style="width:auto; flex:1; min-width:170px; margin:0" onkeydown="if(event.key==='Enter')testPush()">
    <button style="width:auto; padding:9px 16px" onclick="testPush()">Отправить тест-пуш</button>
    <span id="pushOut" class="muted" style="font-size:12px"></span>
  </div>
  <h2>Источники трафика</h2><div id="sources"></div>
  <h2>Рефереры (кто привёл по реф-ссылке <code>ref_&lt;id&gt;</code>)</h2><div id="referrers"></div>
  <h2>Турниры</h2><div id="tournaments"></div>
  <h2>Комнаты боёв</h2><div id="rooms"></div>
  <h2>Покупки за звёзды</h2><div id="payments"></div>
  <h2>Игроки</h2><div id="profiles"></div>
</div>
<div id="drill" hidden>
  <div class="drillcard">
    <div class="drillhead">
      <h2 id="drillTitle" style="margin:0"></h2>
      <button style="width:auto; padding:6px 14px; background:var(--line); color:var(--ink)" onclick="closeDrill()">Закрыть ✕</button>
    </div>
    <div id="drillBody"></div>
  </div>
</div>
<div id="status"></div>
<script>
const $ = (id) => document.getElementById(id)
const KEY = () => localStorage.getItem('pz.adminKey') || ''
function saveKey() { localStorage.setItem('pz.adminKey', $('key').value.trim()); boot() }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const dt = (ts) => ts ? new Date(ts).toLocaleString('ru-RU') : '—'
const table = (heads, rows) => rows.length
  // заголовок числовой колонки тоже выравниваем вправо — чтобы «КРЕДИТЫ» стоял
  // над числом «700», а не уезжал влево (тип берём из первой строки данных)
  ? '<table><tr>' + heads.map((h, i) => '<th' + (typeof rows[0][i] === 'number' ? ' class="num"' : '') + '>' + h + '</th>').join('') + '</tr>' +
    rows.map((r) => '<tr>' + r.map((c) => '<td' + (typeof c === 'number' ? ' class="num"' : '') + '>' + (typeof c === 'number' ? c.toLocaleString('ru-RU') : c) + '</td>').join('') + '</tr>').join('') + '</table>'
  : '<div class="muted">пока пусто</div>'

async function api(path) {
  const r = await fetch(path, { headers: { 'x-admin-key': KEY() } })
  if (r.status === 401) throw new Error('auth')
  return r.json()
}

// последняя выгрузка профилей — для дродауна «игроки этого источника/реферера»
let DATA = { profiles: [], now: 0, online: new Set() }
// генератор реф-ссылки трафика: метка → t.me/<бот>?startapp=src_<метка>
let LINK_BASE = ''
function makeLink() {
  const tag = ($('srcTag').value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
  if (!tag) { $('linkOut').innerHTML = '<span class="err">введите метку: a-z, 0-9, _ или -</span>'; return }
  if (!LINK_BASE) { $('linkOut').innerHTML = '<span class="err">база ссылки не задана (BOT_USERNAME)</span>'; return }
  const url = LINK_BASE + '?startapp=src_' + tag
  $('linkOut').innerHTML = '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">'
    + '<code style="background:#0d100a; padding:8px 10px; border-radius:8px; border:1px solid var(--line); word-break:break-all; flex:1; min-width:200px">' + esc(url) + '</code>'
    + '<button class="refbtn" style="background:var(--blue)" onclick="copyLink(\\'' + esc(url) + '\\', this)">Копировать</button></div>'
    + '<div class="muted" style="margin-top:6px; font-size:12px">в метриках источник: <b>' + esc(tag) + '</b> · перешедшие появятся в «Источники трафика»</div>'
}
window.makeLink = makeLink
function copyLink(url, btn) {
  navigator.clipboard.writeText(url).then(() => { btn.textContent = 'Скопировано ✓' }, () => { btn.textContent = 'не вышло' })
}
window.copyLink = copyLink

// тест-пуш: принудительно шлём дайджест возврата на uid (в обход кулдауна) — увидеть текст/доставку
async function testPush() {
  const uid = ($('pushUid').value || '').trim()
  if (!uid) { $('pushOut').innerHTML = '<span class="err">введите uid (tg-id)</span>'; return }
  $('pushOut').textContent = '…'
  try {
    const r = await fetch('/api/admin/testpush', { method: 'POST', headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' }, body: JSON.stringify({ uid }) })
    const d = await r.json()
    $('pushOut').innerHTML = d.ok ? '<span class="ok">✓ отправлено</span>' : '<span class="err">не дошло: ' + esc(d.reason || d.error || '?') + '</span>'
  } catch (e) { $('pushOut').innerHTML = '<span class="err">сеть: ' + esc(e.message) + '</span>' }
}
window.testPush = testPush

async function refresh() {
  const s = await api('/api/admin/stats')
  const prof = await api('/api/admin/profiles')
  DATA = { profiles: prof.profiles || [], now: s.now || Date.now(), online: new Set(s.onlineUids || []) }
  $('cards').innerHTML = [
    [s.online, 'онлайн (уник. tg-id)'],
    [s.inBattle ?? 0, 'в бою сейчас'],
    [s.onlineIdle ?? 0, 'онлайн не в бою'],
    [s.onlineSockets ?? s.online, 'сокетов (с клонами)'],
    [s.rooms.length, 'комнат'],
    [s.profilesCount, 'профилей'],
    [s.payments.length, 'покупок'],
    ['★ ' + s.revenueStars.toLocaleString('ru-RU'), 'выручка, звёзды'],
    [s.payMode === 'stars' ? 'STARS' : 'DEV', 'режим оплаты'],
  ].map(([v, l]) => '<div class="card"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>').join('')

  const t = s.traffic || { total:0, newToday:0, new7d:0, dau:0, bySource:[] }
  LINK_BASE = s.linkBase || ''
  $('traffic').innerHTML = [
    [t.total, 'всего игроков'],
    [t.newToday, 'новых сегодня'],
    [t.new7d, 'новых за 7 дней'],
    [t.dau, 'актив сегодня (DAU)'],
  ].map(([v, l]) => '<div class="card"><div class="v">' + (v||0).toLocaleString('ru-RU') + '</div><div class="l">' + l + '</div></div>').join('')

  const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '—')
  $('sources').innerHTML = table(
    ['Источник', 'Игроков', 'Дошли до боя', 'Зашёл-и-исчез (<1мин)', 'Завис без боя', 'Вернулись (2-й день+)', 'Новых 7д'],
    t.bySource.map((x) => [
      '<a class="lnk" onclick="showSource(\\'' + esc(x.src === '—' ? '' : x.src) + '\\')">' + (x.src === '—' ? '— без метки (прямой заход)' : esc(x.src)) + '</a>',
      x.users,
      x.played + ' · ' + pct(x.played, x.users),
      (x.ghosts || 0) + ' · ' + pct(x.ghosts || 0, x.users),
      (x.lingered || 0) + ' · ' + pct(x.lingered || 0, x.users),
      (x.returned || 0) + ' · ' + pct(x.returned || 0, x.users),
      x.new7d,
    ]),
  )

  const refs = s.referrers || []
  $('referrers').innerHTML = refs.length
    ? table(
        ['Реферер (tg-id)', 'Привёл', 'Дошли до боя', 'Зашёл-и-исчез (<1мин)', 'Завис без боя', 'Вернулись (2-й день+)', 'Новых 7д'],
        refs.map((x) => [
          '<a class="lnk" onclick="showRef(\\'' + esc(x.ref) + '\\')">' + esc(String(x.ref).replace(/^tg_/, '')) + '</a>',
          x.came,
          x.played + ' · ' + pct(x.played, x.came),
          x.ghosts + ' · ' + pct(x.ghosts, x.came),
          x.lingered + ' · ' + pct(x.lingered, x.came),
          x.returned + ' · ' + pct(x.returned, x.came),
          x.new7d,
        ]),
      )
    : '<div class="muted">пока никто не пришёл по реф-ссылке ref_&lt;id&gt;</div>'

  $('tournaments').innerHTML = '<button style="width:auto;padding:9px 16px;background:'
    + (s.tournaments ? 'var(--green)' : 'var(--line)') + ';color:' + (s.tournaments ? '#0d100a' : 'var(--ink)')
    + '" onclick="toggleTournaments(' + (s.tournaments ? 'false' : 'true') + ')">'
    + (s.tournaments ? 'Турниры ВКЛЮЧЕНЫ ✓ — выключить' : 'Турниры выключены — включить') + '</button>'

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
    ['Когда', 'Игрок', 'Товар', '★ Звёзды', 'Действие'],
    s.payments.slice(0, 50).map((p) => [
      dt(p.ts),
      esc(p.uid || '—'),
      esc((s.products[p.productId] || {}).title || p.productId || '—'),
      p.stars || 0,
      p.refunded
        ? '<span class="muted">возвращён</span>'
        : (p.charge ? '<button class="refbtn" onclick="refund(\\'' + esc(p.charge) + '\\', this)">Рефанд</button>' : '<span class="muted">—</span>'),
    ]),
  )

  // онлайн = в бою/поиске (WS) ИЛИ активность <2.5 мин (в ангаре/меню WS не открыт,
  // поэтому только по WS их не видно — добавляем свежесть lastSeen)
  const onSet = new Set(s.onlineUids || [])
  const tnow = s.now || Date.now()
  const isOnline = (p) => onSet.has(p.uid) || (p.lastSeen && tnow - p.lastSeen < 150000)
  $('profiles').innerHTML = table(
    ['Игрок', 'UID', 'Кредиты', 'Жетоны', 'Боёв', 'Побед', 'Рейтинг', 'Танков', 'Экипаж ОП', 'Был'],
    prof.profiles.slice(0, 100).map((p) => [
      (isOnline(p) ? '<span title="онлайн" style="color:#7cc05a">● </span>' : '') + esc(p.name),
      esc(p.uid), p.credits, p.tokens, p.battles, p.wins, p.rating, p.tanks, p.crewXp, dt(p.updatedAt),
    ]),
  )
  $('status').textContent = 'обновлено ' + new Date().toLocaleTimeString('ru-RU')
}

// дродаун «все игроки этого источника/реферера» + их РЕАЛЬНЫЙ статус воронки.
// статус — та же логика, что в сводке: бой по клиентскому stats.battles, поэтому
// «завис без боя» = наиграл, но клиент не до-сохранил battles>0 (см. оговорку в чате).
function bucketTag(p) {
  if ((p.battles || 0) > 0 || p.reachedBattle) return '<span class="ok">дошёл до боя</span>'
  const d = (p.lastSeen || 0) - (p.firstSeen || 0)
  return d < 60000 ? '<span class="muted">исчез &lt;1мин</span>' : '<span class="warn">завис без боя</span>'
}
const durMin = (ms) => (ms > 0 ? Math.round(ms / 60000) + ' мин' : '—')
function renderPlayers(title, list) {
  const onSet = DATA.online
  const now = DATA.now
  const isOnline = (p) => onSet.has(p.uid) || (p.lastSeen && now - p.lastSeen < 150000)
  const rank = (p) => ((p.battles || 0) > 0 || p.reachedBattle ? 1 : (p.lastSeen || 0) - (p.firstSeen || 0) < 60000 ? 2 : 0) // «завис» — наверх
  list = list.slice().sort((a, b) => rank(a) - rank(b) || (b.lastSeen || 0) - (a.lastSeen || 0))
  $('drillTitle').innerHTML = esc(title) + ' <span class="muted" style="font-size:13px">· ' + list.length + ' игроков</span>'
  $('drillBody').innerHTML = table(
    ['Игрок', 'UID', 'Статус', 'Боёв', 'В апе', 'Первый заход', 'Был'],
    list.map((p) => [
      (isOnline(p) ? '<span style="color:#7cc05a">● </span>' : '') + esc(p.name || '—'),
      esc(p.uid || '—'),
      bucketTag(p),
      p.battles || 0,
      durMin((p.lastSeen || 0) - (p.firstSeen || 0)),
      dt(p.firstSeen),
      dt(p.lastSeen),
    ]),
  )
  $('drill').hidden = false
}
function showSource(src) {
  renderPlayers('Источник: ' + (src || '— без метки (прямой заход)'), DATA.profiles.filter((p) => (src === '' ? !p.src : p.src === src)))
}
function showRef(ref) {
  renderPlayers('Реферер: ' + String(ref).replace(/^tg_/, ''), DATA.profiles.filter((p) => p.referredBy === ref))
}
function closeDrill() { $('drill').hidden = true }
window.showSource = showSource
window.showRef = showRef
window.closeDrill = closeDrill

async function toggleTournaments(on) {
  await fetch('/api/admin/tournaments', {
    method: 'POST',
    headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' },
    body: JSON.stringify({ on }),
  })
  refresh()
}
window.toggleTournaments = toggleTournaments

async function refund(charge, btn) {
  if (!confirm('Вернуть звёзды за этот платёж? Начисленный товар тоже спишется у игрока.')) return
  btn.disabled = true; btn.textContent = '…'
  try {
    const r = await fetch('/api/admin/refund', {
      method: 'POST',
      headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' },
      body: JSON.stringify({ charge }),
    })
    const d = await r.json()
    if (d.ok) { alert('Возвращено ★' + d.stars); refresh() }
    else { alert('Не вышло: ' + (d.error || '?')); btn.disabled = false; btn.textContent = 'Рефанд' }
  } catch (e) { alert('Сеть: ' + e.message); btn.disabled = false; btn.textContent = 'Рефанд' }
}
window.refund = refund

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
