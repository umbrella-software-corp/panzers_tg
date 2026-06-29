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
  .tabs { display:flex; gap:4px; flex-wrap:wrap; margin:18px 0 4px; border-bottom:1px solid var(--line); }
  .tab { width:auto; padding:9px 16px; background:transparent; color:var(--dim); border:none; border-bottom:2px solid transparent; border-radius:0; font-weight:600; font-size:13px; letter-spacing:.03em; }
  .tab:hover { color:var(--ink); }
  .tab.active { color:var(--amber); border-bottom-color:var(--amber); }
  .tab .badge { display:inline-block; min-width:18px; padding:0 5px; margin-left:5px; border-radius:9px; background:var(--line); color:var(--dim); font-size:11px; font-weight:700; text-align:center; vertical-align:middle; }
  .tab .badge.live { background:var(--green); color:#0d100a; }
  .tabpane { display:none; }
  .tabpane.active { display:block; }
  .tabpane > h2:first-child { margin-top:14px; }
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

  <div class="tabs">
    <button class="tab active" data-tab="overview" onclick="showTab('overview')">📊 Обзор</button>
    <button class="tab" data-tab="players" onclick="showTab('players')">👤 Игроки</button>
    <button class="tab" data-tab="grants" onclick="showTab('grants')">🎁 Выдачи и пуши</button>
    <button class="tab" data-tab="battles" onclick="showTab('battles')">⚔️ Бои<span class="badge" id="battleBadge">0</span></button>
    <button class="tab" data-tab="purchases" onclick="showTab('purchases')">💳 Покупки</button>
    <button class="tab" data-tab="auth" onclick="showTab('auth')">🔐 Входы<span class="badge" id="authBadge">0</span></button>
  </div>

  <div class="tabpane active" id="tab-overview">
    <h2>Нагрузка сервера <span class="muted" style="font-size:12px">· event-loop lag = реальный лаг боёв (десятки-сотни мс = перегруз)</span></h2>
    <div class="cards" id="load"></div>
    <h2>Трафик</h2><div class="cards" id="traffic"></div>
    <h2>Источники трафика</h2><div id="sources"></div>
    <h2>Рефереры (кто привёл по реф-ссылке <code>ref_&lt;id&gt;</code>)</h2><div id="referrers"></div>
    <h2>Реф-ссылка трафика</h2>
    <div id="reflink">
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
        <span class="muted">метка источника:</span>
        <input id="srcTag" placeholder="напр. tgads, blogger1, channel" style="width:auto; flex:1; min-width:170px; margin:0" onkeydown="if(event.key==='Enter')makeLink()">
        <button style="width:auto; padding:9px 16px" onclick="makeLink()">Сгенерировать ссылку</button>
      </div>
      <div id="linkOut" style="margin-top:10px"></div>
    </div>
  </div>

  <div class="tabpane" id="tab-players">
    <h2>Поиск игрока</h2>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
      <input id="findUid" placeholder="uid (6177596024) или имя — увидеть профиль и журнал" style="width:auto; flex:1; min-width:240px; margin:0" onkeydown="if(event.key==='Enter')findPlayer()">
      <button style="width:auto; padding:9px 16px" onclick="findPlayer()">Найти</button>
      <span id="findOut" class="muted" style="font-size:12px"></span>
    </div>
    <h2>Игроки</h2><div id="profiles"></div>
  </div>

  <div class="tabpane" id="tab-grants">
    <h2>Выдать / написать игроку</h2>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
      <span class="muted">uid:</span>
      <input id="grUid" placeholder="напр. 6177596024" style="width:auto; min-width:150px; margin:0">
      <span class="muted">+кредиты 🪙</span><input id="grCr" type="number" placeholder="0" style="width:90px; margin:0">
      <span class="muted">+жетоны 💎</span><input id="grTk" type="number" placeholder="0" style="width:80px; margin:0">
      <span class="muted">+дней према ⭐</span><input id="grPr" type="number" placeholder="0" style="width:70px; margin:0">
      <span class="muted">+прем-танк 🛡️</span>
      <select id="grTank" style="width:auto; margin:0; padding:9px; background:var(--panel); color:var(--ink); border:1px solid var(--line); border-radius:8px">
        <option value="">— нет —</option>
        <option value="t28">T-28 (T4)</option>
        <option value="pz4h">Pz. IV H (T4)</option>
        <option value="ram">Ram II (T4)</option>
        <option value="t54">T-54 (T8)</option>
        <option value="maus">Maus (T8)</option>
        <option value="sper">Super Pershing (T8)</option>
      </select>
      <button style="width:auto; padding:9px 16px" onclick="doGrant()">Выдать</button>
      <span id="grOut" class="muted" style="font-size:12px"></span>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:8px">
      <span class="muted">сообщение игроку (uid выше):</span>
      <input id="grMsg" placeholder="текст от @panzers_bot…" style="width:auto; flex:1; min-width:220px; margin:0" onkeydown="if(event.key==='Enter')doMsg()">
      <button style="width:auto; padding:9px 16px" onclick="doMsg()">Написать</button>
      <span id="grMsgOut" class="muted" style="font-size:12px"></span>
    </div>
    <div class="muted" style="font-size:11px; margin-top:6px">Премиум начисляется стойко. Кредиты/жетоны применятся при следующем заходе игрока — выдавай, когда он не в игре (иначе его сейв может перезаписать). Сообщение дойдёт, только если игрок запускал бота / разрешил писать.</div>
    <h2>Проверка пушей</h2>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
      <span class="muted">тест-пуш (дайджест возврата) на uid:</span>
      <input id="pushUid" placeholder="напр. 485427336" style="width:auto; flex:1; min-width:170px; margin:0" onkeydown="if(event.key==='Enter')testPush()">
      <button style="width:auto; padding:9px 16px" onclick="testPush()">Отправить тест-пуш</button>
      <span id="pushOut" class="muted" style="font-size:12px"></span>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:8px">
      <button style="width:auto; padding:9px 16px" onclick="digestDry()">Прикинуть охват дайджеста</button>
      <button style="width:auto; padding:9px 16px; background:var(--red); color:#fff" onclick="digestSend()">⚠ Разослать дайджест ВСЕМ сейчас</button>
      <span id="digestOut" class="muted" style="font-size:12px"></span>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:8px; padding-top:8px; border-top:1px solid var(--line)">
      <button style="width:auto; padding:9px 16px" onclick="eventDry()">Прикинуть охват анонса</button>
      <button style="width:auto; padding:9px 16px; background:var(--amber, #f2a50c); color:#1a1a1a; font-weight:700" onclick="eventSend()">⚔ Анонс «Борьба за рейтинг» ВСЕМ</button>
      <span id="eventOut" class="muted" style="font-size:12px"></span>
    </div>
  </div>

  <div class="tabpane" id="tab-battles">
    <h2>Комнаты боёв</h2><div id="rooms"></div>
    <h2>Турниры</h2><div id="tournaments"></div>
  </div>

  <div class="tabpane" id="tab-purchases">
    <h2>Покупки за звёзды</h2><div id="payments"></div>
  </div>

  <div class="tabpane" id="tab-auth">
    <h2>Отказы авторизации <span class="muted" style="font-size:13px">· почему игрок «не залогинен» (играет, но под гостем)</span></h2>
    <p class="muted" style="font-size:12px; margin:2px 0 10px">
      Кольцо последних отказов (401) в памяти сервера. <b>reason</b>: <code>guest-no-initdata</code> — клиент не нашёл initData и ушёл гостем (CDN-скрипт/хеш не доехал);
      <code>expired</code> — подпись старше суток (вебвью из кэша, не было свежего запуска); <code>bad-signature</code> — битый/чужой initData;
      <code>empty/no-hash/no-user</code> — обрезанный initData. <b>tg</b> — id из НЕдоверенного initData (для сопоставления с тикетом). Сброс — при рестарте сервера.
    </p>
    <div id="authFails"></div>
  </div>
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
// вкладки админки: показать одну панель, спрятать остальные, запомнить выбор
function showTab(name) {
  if (!document.getElementById('tab-' + name)) name = 'overview' // старое/битое значение (напр. 'ops') → дефолт
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === name)
  for (const p of document.querySelectorAll('.tabpane')) p.classList.toggle('active', p.id === 'tab-' + name)
  try { localStorage.setItem('pz.adminTab', name) } catch {}
}
window.showTab = showTab
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

const TANK_NAME = { t28: 'T-28', pz4h: 'Pz. IV H', ram: 'Ram II', t54: 'T-54', maus: 'Maus', sper: 'Super Pershing' }
// выдать игроку кредиты/жетоны/премиум/прем-танк (по uid из поля grUid)
async function doGrant() {
  const uid = ($('grUid').value || '').trim()
  if (!uid) { $('grOut').innerHTML = '<span class="err">введите uid</span>'; return }
  const tank = $('grTank').value || ''
  const body = { uid, credits: +($('grCr').value || 0), tokens: +($('grTk').value || 0), premiumDays: +($('grPr').value || 0), tanks: tank ? [tank] : [] }
  if (!body.credits && !body.tokens && !body.premiumDays && !tank) { $('grOut').innerHTML = '<span class="err">укажи что выдать</span>'; return }
  $('grOut').textContent = '…'
  try {
    const r = await fetch('/api/admin/grant', { method: 'POST', headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json()
    if (d.ok) {
      const q = d.queued || {}
      const now = d.premiumApplied ? '+' + d.premiumApplied + 'д према ⭐ — сразу' : ''
      const queued = []
      if (q.credits) queued.push('+' + q.credits + ' 🪙')
      if (q.tokens) queued.push('+' + q.tokens + ' 💎')
      if (q.tanks && q.tanks.length) queued.push('🛡️ ' + q.tanks.map((t) => TANK_NAME[t] || t).join(', '))
      const tail = queued.length ? (queued.join(', ') + ' — дойдёт при заходе игрока') : ''
      const msg = d.notified === true ? ' · 📩 уведомлён' : d.notified ? ' · ✉️ сообщение не дошло (' + esc(d.notified) + ')' : ''
      $('grOut').innerHTML = '<span class="ok">✓ ' + esc([now, tail].filter(Boolean).join(' · ')) + (d.pending ? ' (в очереди: ' + d.pending + ')' : '') + '</span>' + msg
      $('grCr').value = ''; $('grTk').value = ''; $('grPr').value = ''; $('grTank').value = ''
    } else $('grOut').innerHTML = '<span class="err">' + esc(d.error || '?') + '</span>'
  } catch (e) { $('grOut').innerHTML = '<span class="err">сеть: ' + esc(e.message) + '</span>' }
}
window.doGrant = doGrant

// написать игроку лично от game-бота
async function doMsg() {
  const uid = ($('grUid').value || '').trim()
  const text = ($('grMsg').value || '').trim()
  if (!uid || !text) { $('grMsgOut').innerHTML = '<span class="err">нужны uid и текст</span>'; return }
  $('grMsgOut').textContent = '…'
  try {
    const r = await fetch('/api/admin/message', { method: 'POST', headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' }, body: JSON.stringify({ uid, text }) })
    const d = await r.json()
    if (d.ok) { $('grMsgOut').innerHTML = '<span class="ok">✓ отправлено</span>'; $('grMsg').value = '' }
    else $('grMsgOut').innerHTML = '<span class="err">не дошло: ' + esc(d.reason || d.error || '?') + '</span>'
  } catch (e) { $('grMsgOut').innerHTML = '<span class="err">сеть: ' + esc(e.message) + '</span>' }
}
window.doMsg = doMsg

// прикинуть охват дайджеста (без отправки)
async function digestDry() {
  $('digestOut').textContent = '…'
  try {
    const r = await fetch('/api/admin/digest', { method: 'POST', headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' }, body: JSON.stringify({ dry: true }) })
    const d = await r.json()
    $('digestOut').innerHTML = '<span class="muted">подходит под рассылку: <b style="color:var(--ink)">' + d.eligible + '</b> из ' + d.total + ' профилей (реальные игроки, не активные сегодня). Кому фактически уйдёт — минус кулдаун 1/сутки и отписки.</span>'
  } catch (e) { $('digestOut').innerHTML = '<span class="err">сеть: ' + esc(e.message) + '</span>' }
}
window.digestDry = digestDry

// разослать дайджест ВСЕМ подходящим прямо сейчас (реальные сообщения в Telegram)
async function digestSend() {
  if (!confirm('Разослать возврат-пуш ВСЕМ подходящим игрокам ПРЯМО СЕЙЧАС?\\n\\nЭто реальные сообщения в Telegram. Кому пуш уже уходил сегодня — кулдаун пропустит (повторно не заспамит).')) return
  $('digestOut').textContent = 'запускаю рассылку…'
  try {
    const r = await fetch('/api/admin/digest', { method: 'POST', headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' }, body: JSON.stringify({ dry: false }) })
    const d = await r.json()
    if (d.already) { $('digestOut').innerHTML = '<span class="muted">рассылка уже идёт — повтор не запускаю (от дублей)</span>'; pollDigest(); return }
    if (!d.started) { $('digestOut').innerHTML = '<span class="err">не запустилось</span>'; return }
    pollDigest() // живой прогресс прямо тут
  } catch (e) { $('digestOut').innerHTML = '<span class="err">сеть: ' + esc(e.message) + '</span>' }
}
window.digestSend = digestSend

// опрос прогресса рассылки → показываем «идёт X / N» и финал прямо в админке
async function pollDigest() {
  try {
    const r = await fetch('/api/admin/digest-status', { headers: { 'x-admin-key': KEY() } })
    const p = await r.json()
    if (p.running) {
      $('digestOut').innerHTML = '<span class="muted">рассылка идёт: <b style="color:var(--ink)">' + p.sent + '</b> / ' + p.eligible + ' …</span>'
      setTimeout(pollDigest, 1500)
    } else {
      const extra = []
      if (p.cooldown) extra.push(p.cooldown + ' уже получали за сутки (кулдаун)')
      if (p.blocked) extra.push(p.blocked + ' отписка/бот заблокирован')
      const note = extra.length ? ' <span class="muted">(' + extra.join(', ') + ')</span>' : ''
      $('digestOut').innerHTML = '<span class="ok">✓ отправлено: <b>' + p.sent + '</b> из ' + p.eligible + '</span>' + note
    }
  } catch (e) { $('digestOut').innerHTML = '<span class="err">статус: ' + esc(e.message) + '</span>' }
}
window.pollDigest = pollDigest

// ---- разовый анонс события «Борьба за рейтинг» (broadcast) ----
async function eventDry() {
  $('eventOut').textContent = '…'
  try {
    const r = await fetch('/api/admin/event-announce', { method: 'POST', headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' }, body: JSON.stringify({ dry: true }) })
    const d = await r.json()
    $('eventOut').innerHTML = '<span class="muted">подходит под анонс: <b style="color:var(--ink)">' + d.eligible + '</b> из ' + d.total + ' (реальные игроки, кто ещё не получал анонс). Минус заблокировавшие бота/отписки.</span>'
  } catch (e) { $('eventOut').innerHTML = '<span class="err">сеть: ' + esc(e.message) + '</span>' }
}
window.eventDry = eventDry

async function eventSend() {
  if (!confirm('Разослать анонс «Борьба за рейтинг» ВСЕМ игрокам ПРЯМО СЕЙЧАС?\\n\\nЭто разовое реальное сообщение в Telegram (в обход кулдауна). Повторный запуск дошлёт только тех, кому не дошло.')) return
  $('eventOut').textContent = 'запускаю анонс…'
  try {
    const r = await fetch('/api/admin/event-announce', { method: 'POST', headers: { 'x-admin-key': KEY(), 'content-type': 'application/json' }, body: JSON.stringify({ dry: false }) })
    const d = await r.json()
    if (d.already) { $('eventOut').innerHTML = '<span class="muted">анонс уже идёт — повтор не запускаю</span>'; pollEvent(); return }
    if (!d.started) { $('eventOut').innerHTML = '<span class="err">не запустилось</span>'; return }
    pollEvent()
  } catch (e) { $('eventOut').innerHTML = '<span class="err">сеть: ' + esc(e.message) + '</span>' }
}
window.eventSend = eventSend

async function pollEvent() {
  try {
    const r = await fetch('/api/admin/event-status', { headers: { 'x-admin-key': KEY() } })
    const p = await r.json()
    if (p.running) {
      $('eventOut').innerHTML = '<span class="muted">анонс идёт: <b style="color:var(--ink)">' + p.sent + '</b> / ' + p.eligible + ' …</span>'
      setTimeout(pollEvent, 1500)
    } else {
      const note = p.blocked ? ' <span class="muted">(' + p.blocked + ' отписка/бот заблокирован)</span>' : ''
      $('eventOut').innerHTML = '<span class="ok">✓ анонс отправлен: <b>' + p.sent + '</b> из ' + p.eligible + '</span>' + note
    }
  } catch (e) { $('eventOut').innerHTML = '<span class="err">статус: ' + esc(e.message) + '</span>' }
}
window.pollEvent = pollEvent

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

  // НАГРУЗКА СЕРВЕРА: event-loop lag — главный индикатор лага боёв (поток заблокирован).
  // Цвет по макс. лагу: <25мс зелёный (ок), 25-80 жёлтый, >80 красный (игроки чувствуют).
  const L = s.load || {}
  const lagCol = (L.elLagMax || 0) > 80 ? 'var(--red)' : (L.elLagMax || 0) > 25 ? 'var(--amber)' : 'var(--green)'
  $('load').innerHTML = [
    ['<span style="color:' + lagCol + '">' + (L.elLagCur || 0) + ' / ' + (L.elLagAvg || 0) + ' / ' + (L.elLagMax || 0) + '</span>', 'event-loop lag мс · тек/сред/макс'],
    [(L.tickAvgMs || 0) + ' / ' + (L.tickMaxMs || 0), 'тик комнаты мс · сред/макс'],
    [(L.tickBudgetMs || 0) + 'мс @ ' + (L.tickHz || 0) + 'Гц', 'бюджет тика'],
    [L.startedRooms || 0, 'комнат в бою'],
    [L.simUnits || 0, 'юнитов в симуляции'],
    [(L.rssMb || 0) + ' МБ', 'RAM (RSS)'],
  ].map(([v, l]) => '<div class="card"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>').join('')

  // живой счётчик активных боёв на вкладке «Бои» (стартовавшие комнаты)
  const liveBattles = (s.rooms || []).filter((r) => r.started).length
  const bb = $('battleBadge')
  if (bb) { bb.textContent = liveBattles; bb.classList.toggle('live', liveBattles > 0) }

  // отказы авторизации («не залогинен») — почему клиент не прошёл, для сопоставления с тикетом
  try {
    const af = await api('/api/admin/auth-failures')
    const fails = af.failures || []
    const ab = $('authBadge')
    if (ab) { ab.textContent = fails.length; ab.classList.toggle('live', fails.length > 0) }
    const ageStr = (a) => a == null ? '—' : a < 90 ? a + 'с' : a < 5400 ? Math.round(a / 60) + 'м' : Math.round(a / 3600) + 'ч'
    $('authFails').innerHTML = table(
      ['Когда', 'reason', 'tg', 'имя', 'len', 'возраст', 'guest', 'url', 'ip', 'UA'],
      fails.map((f) => [
        dt(f.ts),
        '<b style="color:var(--red)">' + esc(f.reason) + '</b>',
        f.tgId ? esc(String(f.tgId)) : '—',
        esc(f.name || '—'),
        f.initDataLen,
        esc(ageStr(f.authAgeSec)),
        f.hasGuestId ? esc(f.guestId || 'да') : '—',
        esc((f.url || '').split('/api/').join('')),
        esc(f.ip || '—'),
        '<span class="muted" style="font-size:11px">' + esc((f.ua || '').slice(0, 70)) + '</span>',
      ])
    )
  } catch { /* старый сервер без эндпоинта — пропускаем */ }

  const t = s.traffic || { total:0, newToday:0, new7d:0, dau:0, activeToday:0, playedToday:0, reachedTotal:0, returnedReal:0, pushBlocked:0, pushReachable:0, used3D:0, bySource:[] }
  LINK_BASE = s.linkBase || ''
  const retPct = t.reachedTotal ? Math.round((t.returnedReal / t.reachedTotal) * 100) : 0
  const reachPct = t.reachedTotal ? Math.round((t.pushReachable / t.reachedTotal) * 100) : 0
  $('traffic').innerHTML = [
    [t.total, 'всего игроков'],
    [t.newToday, 'новых сегодня'],
    [t.activeToday, 'активны сегодня (МСК)'],
    [t.playedToday, 'играли сегодня'],
    [(t.returnedReal||0).toLocaleString('ru-RU') + ' · ' + retPct + '%', 'вернулись (игроки, не мусор)'],
    [(t.pushReachable||0).toLocaleString('ru-RU') + ' · ' + reachPct + '%', 'доступны для пуша'],
    [(t.pushBlockedReal||0).toLocaleString('ru-RU'), '🔴 реально заблок. бота'],
    [(t.pushNoAccess||0).toLocaleString('ru-RU'), '🟡 не дали доступ (не запускали)'],
    [t.dau, 'актив за 24ч (DAU)'],
    [t.used3D, 'перешли в 3D'],
  ].map(([v, l]) => '<div class="card"><div class="v">' + (typeof v === 'number' ? v.toLocaleString('ru-RU') : v) + '</div><div class="l">' + l + '</div></div>').join('')

  const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '—')
  $('sources').innerHTML = table(
    ['Источник', 'Игроков', 'Дошли до боя', 'Зашёл-и-исчез (<1мин)', 'Завис без боя', 'Вернулись (2-й день+)', '🔴заблок · 🟡нет доступа', 'Новых 7д'],
    t.bySource.map((x) => [
      '<a class="lnk" onclick="showSource(\\'' + esc(x.src === '—' ? '' : x.src) + '\\')">' + (x.src === '—' ? '— без метки (прямой заход)' : esc(x.src)) + '</a>',
      x.users,
      x.played + ' · ' + pct(x.played, x.users),
      (x.ghosts || 0) + ' · ' + pct(x.ghosts || 0, x.users),
      (x.lingered || 0) + ' · ' + pct(x.lingered || 0, x.users),
      (x.returned || 0) + ' · ' + pct(x.returned || 0, x.users),
      '🔴' + (x.blockedReal || 0) + ' · 🟡' + (x.noAccess || 0),
      x.new7d,
    ]),
  )

  const refs = s.referrers || []
  $('referrers').innerHTML = refs.length
    ? table(
        ['Реферер (tg-id)', 'Привёл', 'Дошли до боя', 'Зашёл-и-исчез (<1мин)', 'Завис без боя', 'Вернулись (2-й день+)', '🔴заблок · 🟡нет доступа', 'Новых 7д'],
        refs.map((x) => [
          '<a class="lnk" onclick="showRef(\\'' + esc(x.ref) + '\\')">' + esc(String(x.ref).replace(/^tg_/, '')) + '</a>',
          x.came,
          x.played + ' · ' + pct(x.played, x.came),
          x.ghosts + ' · ' + pct(x.ghosts, x.came),
          x.lingered + ' · ' + pct(x.lingered, x.came),
          x.returned + ' · ' + pct(x.returned, x.came),
          '🔴' + (x.blockedReal || 0) + ' · 🟡' + (x.noAccess || 0),
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
      (isOnline(p) ? '<span title="онлайн" style="color:#7cc05a">● </span>' : '') + '<span class="lnk" onclick="openPlayer(\\'' + esc(p.uid) + '\\')">' + esc(p.name || '—') + '</span>',
      esc(p.uid), p.credits, p.tokens, p.battles || p.srvBattles || 0, p.wins, p.rating, p.tanks, p.crewXp, dt(p.updatedAt),
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
      (isOnline(p) ? '<span style="color:#7cc05a">● </span>' : '') + '<span class="lnk" onclick="openPlayer(\\'' + esc(p.uid) + '\\')">' + esc(p.name || '—') + '</span>',
      esc(p.uid || '—'),
      bucketTag(p),
      p.battles || p.srvBattles || 0,
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

// карточка одного игрока + журнал событий («когда был, что делал») в оверлее #drill
async function openPlayer(uid) {
  const digits = String(uid || '').replace(/[^0-9]/g, '')
  if (!digits) return
  $('drillTitle').innerHTML = 'Игрок ' + esc(digits) + ' <span class="muted">· загрузка…</span>'
  $('drillBody').innerHTML = '<div class="muted">…</div>'
  $('drill').hidden = false
  try {
    const r = await fetch('/api/admin/player?uid=' + digits, { headers: { 'x-admin-key': KEY() } })
    const d = await r.json()
    if (!d.ok) { $('drillBody').innerHTML = '<div class="err">' + esc(d.error || 'не найден') + '</div>'; return }
    renderPlayer(d.player, d.events || [])
  } catch (e) { $('drillBody').innerHTML = '<div class="err">сеть: ' + esc(e.message) + '</div>' }
}
window.openPlayer = openPlayer

const fmtMin = (m) => m >= 1440 ? Math.round(m / 1440) + 'д' : m >= 60 ? Math.round(m / 60) + 'ч' : m + 'м'
// событие журнала → [иконка+заголовок, детали] (обе части — уже безопасный текст)
function evLabel(e) {
  switch (e.type) {
    case 'open': return ['🔵 зашёл в игру', e.first ? 'первый заход' : (e.away_min != null ? 'не был ' + fmtMin(e.away_min) : '')]
    case 'battle_start': return ['⚔️ вошёл в бой', 'танк ' + esc(e.tank || '?') + ', ' + esc(e.mode || '') + ', карта ' + esc(e.map || '?') + ', живых ' + (e.humans || 1)]
    case 'battle_end': return [e.draw ? '🤝 ничья' : (e.win ? '🏆 победа' : '💀 поражение'), (e.kills || 0) + ' килов, ' + (e.dmg || 0) + ' урона, ' + (e.alive ? 'выжил' : 'уничтожен') + ', счёт ' + esc(e.score || '') + ', танк ' + esc(e.tank || '?')]
    case 'purchase': return ['⭐ покупка', esc(e.title || e.product || '') + ' за ' + (e.stars || 0) + '⭐']
    case 'admin_grant': return ['🎁 админ выдал', [e.credits ? '+' + e.credits + '🪙' : '', e.tokens ? '+' + e.tokens + '💎' : '', e.premiumDays ? '+' + e.premiumDays + 'д према' : '', (e.tanks && e.tanks.length) ? '🛡️ ' + e.tanks.map((t) => TANK_NAME[t] || t).join(',') : ''].filter(Boolean).join(', ')]
    case 'admin_msg': return ['✉️ админ написал', esc(e.text || '')]
    default: return [esc(e.type || '?'), esc(JSON.stringify(e).slice(0, 120))]
  }
}
const kv = (k, v) => '<div><span class="muted">' + k + ':</span> ' + v + '</div>'
// свод невыданной очереди: суммируем кредиты/жетоны + список танков
function pendSummary(pend) {
  let c = 0, t = 0; const tanks = []
  for (const g of pend) { if (!g) continue; c += +g.credits || 0; t += +g.tokens || 0; if (Array.isArray(g.tanks)) for (const tk of g.tanks) tanks.push(TANK_NAME[tk] || tk) }
  return [c ? '+' + c + '🪙' : '', t ? '+' + t + '💎' : '', tanks.length ? '🛡️ ' + tanks.join(', ') : ''].filter(Boolean).join(', ') || '—'
}
function renderPlayer(p, events) {
  const prem = p.premiumActive ? '<span class="ok">премиум до ' + dt(p.premiumUntil) + '</span>' : '<span class="muted">нет</span>'
  const card = '<div style="display:flex; flex-wrap:wrap; gap:10px 22px; margin-bottom:14px; font-size:14px">'
    + kv('UID', esc(p.uid))
    + kv('Кредиты', (p.credits || 0).toLocaleString('ru-RU') + ' 🪙') + kv('Жетоны', (p.tokens || 0).toLocaleString('ru-RU') + ' 💎')
    + kv('Премиум', prem)
    + kv('Боёв', (p.battles || p.srvBattles || 0) + ' <span class="muted">(srv ' + (p.srvBattles || 0) + ')</span>')
    + kv('Побед', p.wins || 0) + kv('Киллов', p.kills || 0) + kv('Рейтинг', p.rating || 0)
    + kv('Танков', p.tanks || 0) + kv('Экипаж ОП', p.crewXp || 0)
    + kv('Источник', esc(p.src || '—')) + kv('Привёл', p.referredBy ? esc(String(p.referredBy).replace(/^tg_/, '')) : '—')
    + kv('Первый заход', dt(p.firstSeen)) + kv('Был', dt(p.lastSeen))
    + ((p.pendingGrants && p.pendingGrants.length) ? kv('⏳ Не забрал', '<span class="warn">' + esc(pendSummary(p.pendingGrants)) + '</span> <span class="muted">(дойдёт при заходе)</span>') : '')
    + '</div>'
  const rows = events.map((e) => { const ld = evLabel(e); return [dt(e.t), ld[0], ld[1]] })
  const log = events.length
    ? table(['Время', 'Событие', 'Детали'], rows)
    : '<div class="muted">журнал пуст (события пишутся с момента этого деплоя — прошлое не восстановить)</div>'
  $('drillTitle').innerHTML = (p.premiumActive ? '★ ' : '') + esc(p.name || 'игрок') + ' <span class="muted" style="font-size:13px">· ' + esc(p.uid) + '</span>'
  $('drillBody').innerHTML = '<div style="margin-bottom:12px; display:flex; gap:8px; flex-wrap:wrap">'
    + '<button style="width:auto;padding:6px 12px" onclick="prefillGrant(\\'' + esc(p.uid) + '\\')">Выдать награду</button>'
    + '<button style="width:auto;padding:6px 12px" onclick="prefillMsg(\\'' + esc(p.uid) + '\\')">Написать</button>'
    + '</div>' + card
    + '<h2 style="margin:8px 0">Журнал событий <span class="muted" style="font-size:13px">· ' + events.length + ' (новые сверху)</span></h2>' + log
}

// поиск: цифры (≥5) — сразу карточка по uid; иначе фильтр по имени среди выгрузки
function findPlayer() {
  const q = ($('findUid').value || '').trim()
  if (!q) return
  const digits = q.replace(/[^0-9]/g, '')
  $('findOut').textContent = ''
  if (digits.length >= 5) { openPlayer(digits); return }
  const m = (DATA.profiles || []).filter((p) => (p.name || '').toLowerCase().includes(q.toLowerCase()))
  if (!m.length) { $('findOut').innerHTML = '<span class="err">не найдено (по имени — только среди выгруженных; по uid точнее)</span>'; return }
  if (m.length === 1) { openPlayer(m[0].uid); return }
  renderPlayers('Поиск: «' + q + '»', m) // список — клик по строке откроет карточку
}
window.findPlayer = findPlayer

// подставить uid в блок «Выдать / написать» и проскроллить туда
function prefillGrant(uid) { $('grUid').value = String(uid).replace(/[^0-9]/g, ''); closeDrill(); $('grUid').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('grCr').focus() }
function prefillMsg(uid) { $('grUid').value = String(uid).replace(/[^0-9]/g, ''); closeDrill(); $('grMsg').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('grMsg').focus() }
window.prefillGrant = prefillGrant
window.prefillMsg = prefillMsg

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
    showTab(localStorage.getItem('pz.adminTab') || 'overview') // восстановить последнюю вкладку
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
