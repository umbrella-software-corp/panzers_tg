<script setup>
// Ангар-сцена (порт HangarSceneScreen): отсек-гараж, top-down танк, нации,
// ТТХ-шторка, карусель танков, кнопки ВЗВОД и В БОЙ, нижняя навигация.
import { ref, computed, watch, onMounted } from 'vue'
import { profile, party, selectTank, isOwned, buyTank, canUnlock, crewLevel, crewProgress, setCamo, buyCamo, camoUnlocked, tankCamo, tasksClaimable, tankModLevel, setBattleMode, isPremium, premiumDaysLeft, loadoutStats, serverConfig, nextGoal, nextGoalText, tankStat, claimPushBonus } from '../store.js'
import { squad } from '../game/squad.js'
import { tanksOfNation, TANK_BY_ID, NATIONS, nationOf, STAT_LABELS, CAMOS, CAMO_BY_ID, MODULE_COMBAT, combatStats, statReal, tankModelUrl, tankSizeScale, isHiddenNation } from '../game/meta.js'
import { haptic, requestWriteAccess, isFromTelegram } from '../tg.js'
import { apiUsed3D } from '../api.js'
import { preload3D } from '../game/NetGame3D.js'
import Tank3DView from './ui/Tank3DView.vue'
import { track } from '../analytics.js'
import { t } from '../i18n.js'
import TankImg from './ui/TankImg.vue'
import CurrencyBar from './ui/CurrencyBar.vue'
import BottomNav from './ui/BottomNav.vue'
import StatRow from './ui/StatRow.vue'
import PzIcon from './ui/PzIcon.vue'
import SquadSheet from './SquadSheet.vue'
import TasksSheet from './TasksSheet.vue'
import FeedbackSheet from './FeedbackSheet.vue'
import SettingsSheet from './SettingsSheet.vue'

const emit = defineEmits(['play', 'go'])
const props = defineProps({ postBattle: { type: Boolean, default: false } }) // фидбек-баннер — только сразу после боя

// ЭКСПЕРИМЕНТ 3D: тестеры видят на главной тоггл «3D» — следующий бой пойдёт в
// 3D-рендере (Three.js, NetGame3D) вместо 2D. Гейт по tg-id; в деве (localhost)
// показываем всегда для проверки. Флаг живёт в localStorage.pz3d, Battle.vue
// читает его при монтировании боя — перезагрузка не нужна.
// ТУМБЛЕР 2D/3D — виден ВСЕМ (по умолчанию 2D, опт-ин: безопасно для живых). 3D включает
// и ангар (3D-модель выбранного танка), и бой (NetGame3D). Флаг в localStorage.pz3d —
// Battle.vue читает его при монтировании боя.
const threeD = ref((() => { try { return localStorage.getItem('pz3d') === '1' } catch { return false } })())
const hashId = (s) => { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
// hero-модель ангара = 3D-модель ВЫБРАННОГО танка (любого): листание карусели меняет модель
const heroUrl = computed(() => tankModelUrl(tank.value && tank.value.id, nationOf((tank.value && tank.value.id) || profile.selectedTank)))
const heroSeed = computed(() => hashId(tank.value && tank.value.id)) // зерно узора камо — стабильно по танку
const heroScale = computed(() => tankSizeScale(tank.value && tank.value.id)) // размер по классу/длине корпуса
if (threeD.value) preload3D(profile.selectedTank, nationOf(profile.selectedTank)) // 3D включён → греем three.js + модель СВОЕГО танка (превью ангара + вход в бой без коробки)
// ангар = ТОЛЬКО твои танки: выбран не свой (стейл/превью из дерева) → лучший по тиру; нацию
// держим = нации выбранного (подпись + дефолт «Развития»). Работает одинаково в 2D и 3D.
watch(() => profile.selectedTank, () => {
  // не свой ИЛИ из скрытой нации (США без 3D) → лучший по тиру из ВИДИМЫХ своих
  if (!isOwned(profile.selectedTank) || isHiddenNation(nationOf(profile.selectedTank))) {
    const best = profile.owned.map((id) => TANK_BY_ID[id]).filter((t) => t && !isHiddenNation(nationOf(t.id))).sort((a, b) => b.tier - a.tier)[0]
    if (best) selectTank(best.id)
  }
  if (profile.selectedTank) profile.nation = nationOf(profile.selectedTank)
}, { immediate: true })
function toggle3D() {
  threeD.value = !threeD.value
  try { localStorage.setItem('pz3d', threeD.value ? '1' : '0') } catch { /* приватный режим */ }
  if (threeD.value) {
    preload3D(profile.selectedTank, nationOf(profile.selectedTank))
    if (!profile.used3D) { profile.used3D = true; apiUsed3D().catch(() => {}) } // метрика «перешёл в 3D» (липкий флаг)
  }
  haptic('light')
  track('exp_3d_toggle', { on: threeD.value })
}
const squadOpen = ref(false)
const tasksOpen = ref(false)
const feedbackOpen = ref(false)
const settingsOpen = ref(false)
function openSettings() {
  haptic('light')
  track('settings_opened', { from_screen: 'hangar' })
  settingsOpen.value = true
}

// промо «нам важно ваше мнение → напиши в саппорт → +жетоны»: пока бонус не забран,
// новичкам до первого боя не мешаем (как и канал)
const feedbackOffer = computed(
  () => serverConfig.feedback.on && !profile.feedbackClaimed && props.postBattle,
)
function openFeedbackSheet() {
  track('feedback_offer_opened', { from_screen: 'hangar' })
  haptic('light')
  feedbackOpen.value = true
}

// ОХВАТ ПУШЕЙ: ~81% не дали боту право писать (pushBlocked) → рассылка возврата уходит
// «в 0», в т.ч. ~80 АКТИВНЫХ игроков недосягаемы. Постоянный заметный баннер «🔔 +N💎» —
// чтобы активный мог дать доступ В ЛЮБОЙ момент (не только раз-в-5-дней попапом, который
// легко смахнуть). Прячется сразу после выдачи (pushBonusClaimed реактивен).
// ВАЖЕН ПОРЯДОК: реактивные profile.* читаем ПЕРВЫМИ, isFromTelegram() (НЕреактивна) —
// последней. Иначе при isFromTelegram()===false на первом расчёте && оборвётся до чтения
// profile.*, зависимости не отследятся, и баннер не появится даже когда флаги изменятся.
const notifOffer = computed(() => !profile.pushBonusClaimed && profile.trainingDone && isFromTelegram())
async function enableNotifs() {
  haptic('light')
  track('push_bonus_offered', { reason: 'banner', tokens: serverConfig.pushBonusTokens || 25 })
  const ok = await requestWriteAccess()
  track('push_access_result', { granted: !!ok, reason: 'banner' })
  if (!ok) { track('push_bonus_declined', { stage: 'access', reason: 'banner' }); return }
  const granted = await claimPushBonus() // сервер верифицирует доступ реальной отправкой + жетоны
  if (granted && granted.tokens) track('push_bonus_claimed', { tokens: granted.tokens, reason: 'banner' })
}

// «N в сети» показываем ТОЛЬКО в поиске боя (Matchmaking.vue), на главной убрано —
// в ангаре пустой зал смущал. Чип и опрос /api/online живут теперь там.

// режим боя: захват точек / на уничтожение (персистится в профиле)
function pickMode(m) {
  if (profile.battleMode === m) return
  track('battle_mode_selected', {
    mode_from: profile.battleMode,
    mode_to: m,
    tank_id: profile.selectedTank,
  })
  setBattleMode(m)
  haptic('select')
}

// открытие шторок/саппорта с трекингом (для воронок «до первого боя»)
function openTasksSheet() {
  track('tasks_opened', {
    from_screen: 'hangar',
    before_first_battle: (profile.stats?.battles || 0) === 0,
    claimable: tasksClaimable(),
  })
  tasksOpen.value = true
}
function openSquadSheet() {
  track('squad_opened', {
    from_screen: 'hangar',
    referrals_count: profile.referrals?.length || 0,
    in_squad: inParty.value,
  })
  squadOpen.value = true
}
// выбор танка в карусели ангара (+ отдельное событие на тап по запертому)
function selectTankTracked(t) {
  track('hangar_tank_selected', {
    tank_id: t.id,
    tank_tier: t.tier,
    tank_class: t.cls,
    owned: isOwned(t.id),
    locked: !isOwned(t.id),
  })
  if (!isOwned(t.id)) {
    track('locked_tank_clicked', {
      tank_id: t.id,
      tank_tier: t.tier,
      tank_class: t.cls,
    })
  }
  selectTank(t.id)
}

// «Открыть танк» прямо из ангара: если предок исследован и хватает кредитов —
// покупаем здесь же (без прыжка в ветку), танк становится своим и доступен в бой.
// Если нужна многошаговая прокачка (исследовать предыдущий / топ-модули) — buyTank
// вернёт false, и тогда уводим в ветку, где виден весь чеклист.
async function openOrUnlock() {
  const tk = tank.value
  track('hangar_unlock_clicked', { tank_id: tk.id, tank_tier: tk.tier, can_unlock: canUnlock(tk) })
  if (await buyTank(tk)) {
    selectTank(tk.id)
    haptic('success')
  } else {
    emit('go', 'tree')
  }
}

const tank = computed(() => TANK_BY_ID[profile.selectedTank] || tanksOfNation(profile.nation)[0])

// БЫСТРЫЙ ВЫБОР ТАНКА на Главной (без захода в «Ангар») — лента своих машин, тап =
// выбрал (@Weddaaaa, и на премах). Свои ВИДИМЫЕ танки по тиру↓ (премы включены).
const quickTanks = computed(() =>
  (profile.owned || [])
    .map((id) => TANK_BY_ID[id])
    .filter((tk) => tk && !isHiddenNation(nationOf(tk.id)))
    .sort((a, b) => b.tier - a.tier || String(a.name).localeCompare(String(b.name))),
)
function quickPick(id) {
  if (id === profile.selectedTank) return
  haptic('select')
  selectTank(id)
  track('hangar_quick_pick', { tank_id: id })
}

// ТТХ с учётом прокачки: дизайн-стата × модуль × экипаж (как в loadoutStats).
// base — исходное, value — с прокачкой; шторка рисует прирост, а не статику.
const STAT_MOD = { dmg: 'gun', hp: 'tur', spd: 'eng', mnv: 'trk', view: 'rad' }
const ttxStats = computed(() => {
  const t = tank.value
  const ck = 1 + (crewLevel() - 1) * 0.01 // экипаж баффает ход/манёвр/обзор/темп
  const real = loadoutStats(t.id) // реальные боевые статы с прокачкой (как в бою)
  const baseReal = combatStats(t) // без модулей/экипажа — для прироста
  return Object.entries(t.stats).map(([k, base]) => {
    let m = 1
    const mod = STAT_MOD[k]
    if (mod) m *= MODULE_COMBAT[mod][tankModLevel(t.id, mod) - 1]
    if (k === 'spd' || k === 'mnv' || k === 'view' || k === 'rof') m *= ck
    const rv = statReal(real, k) // крупное реальное число (HP 2088, урон 297…)
    const up = rv - statReal(baseReal, k) // прирост от прокачки в реальных единицах
    return { key: k, label: STAT_LABELS[k], base, value: Math.min(10, +(base * m).toFixed(1)), display: rv, displayUp: up > 0 ? +up.toFixed(k === 'rof' ? 1 : 0) : null }
  })
})
const locked = computed(() => !threeD.value && !isOwned(tank.value.id)) // в 3D-эксперименте 3 танка не залочены
// первая сессия (ещё ни одного боя): на ангаре оставляем ОДИН CTA «В БОЙ» —
// ЗАДАЧИ и ВЗВОД прячем, чтобы не размывать вход. После первого боя возвращаются.
const firstSession = computed(() => (profile.stats?.battles || 0) === 0)
// «следующая цель» — хук удержания: явный следующий шаг (забрать задачи / открыть танк /
// копить опыт / вложить свободный). Тап ведёт к действию. Новичку (0 боёв) не показываем.
const goal = computed(() => (firstSession.value ? null : nextGoal()))
function goGoal(g) {
  if (!g) return
  track('next_goal_clicked', { kind: g.kind })
  haptic('light')
  if (g.kind === 'tasks') openTasksSheet()
  else emit('go', 'tree') // unlock / research / freexp — всё в «Развитии»
}
// статистика ВЫБРАННОГО танка (бои/винрейт/фраги именно на нём) — фидбек: глобальная
// «стата» не нужна, нужны статы по конкретному танку. Тап ведёт в полный профиль.
const tankStatLine = computed(() => {
  const st = tankStat(tank.value.id)
  if (!st.battles) return t('hangar.statNone')
  const wr = Math.round((st.wins / st.battles) * 100)
  return `${st.battles} ${t('hangar.statBattles')} · ${wr}% · ${st.kills} ${t('hangar.statKills')}`
})
function goStats() {
  track('stats_opened', { from: 'hangar', tank_id: tank.value.id })
  haptic('light')
  emit('go', 'rating')
}
const nationLabel = computed(() => (NATIONS.find((n) => n.id === nationOf(tank.value.id)) || {}).label)
// КАРУСЕЛЬ = ТОЛЬКО твои танки (гараж): сортировка по тиру ↓, все нации вперемешку.
// Весь модельный ряд и исследование живут во вкладке «Развитие» (ангар — это ангар).
const NATION_ORDER = { ussr: 0, ger: 1, usa: 2 }
const tanks = computed(() =>
  profile.owned
    .map((id) => TANK_BY_ID[id])
    .filter((t) => t && !isHiddenNation(nationOf(t.id))) // скрытые нации (США без 3D) в карусели не показываем
    .sort((a, b) => b.tier - a.tier || (NATION_ORDER[nationOf(a.id)] ?? 9) - (NATION_ORDER[nationOf(b.id)] ?? 9) || a.name.localeCompare(b.name)),
)
const ttx = ref(false)
const showCamo = ref(false) // камо-сетка спрятана по умолчанию (чистый экран) — тоггл в тулбаре
// переключение танка стрелками/свайпом вместо карусели (карусель убрана ради чистоты)
const tankIndex = computed(() => { const i = tanks.value.findIndex((t) => t.id === tank.value.id); return i < 0 ? 0 : i })
function switchTank(dir) {
  const list = tanks.value
  if (list.length < 2) return
  const i = (tankIndex.value + dir + list.length) % list.length
  selectTankTracked(list[i])
}
// свайп по сцене танка: влево → следующий, вправо → предыдущий
let _swipeX = null
function swipeStart(e) { _swipeX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) }
function swipeEnd(e) {
  if (_swipeX == null) return
  const x = (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : e.clientX)
  const dx = x - _swipeX; _swipeX = null
  if (Math.abs(dx) > 44) switchTank(dx < 0 ? 1 : -1)
}
// тап по сцене танка → Ангар (tree). НО в 3D палец по танку = ПОВОРОТ: Tank3DView
// эмитит 'drag' при реальном вращении → глушим навигацию, иначе танк «не крутился»
// (любое касание уводило на вкладку). Тап без поворота — по-прежнему открывает Ангар.
let _tankDragged = false
function onTankDown() { _tankDragged = false }
function onTankDrag() { _tankDragged = true }
function onTankTap() { if (_tankDragged) { _tankDragged = false; return } emit('go', 'tree') }
const fmt = (n) => n.toLocaleString('ru-RU')
const inParty = computed(() => squad.active || !!party.token) // в лобби взвода или уже в бою с ним
// друг зашёл по ссылке (squad стал активен) → авто-открываем шторку взвода, чтобы он видел лобби
watch(() => squad.active, (a) => { if (a) squadOpen.value = true })
// камуфляж на КАЖДЫЙ танк: разблокировка за жетоны, потом надевается бесплатно
const selCamo = computed(() => tankCamo(tank.value.id))
// предпросмотр запертого камо: показываем на БОЛЬШОМ танке, не покупая.
// Большой танк рисует previewCamo (если есть) поверх надетого.
const previewCamo = ref(null)
// прем-технике камо недоступен → всегда заводской облик (даже если был сохранён ранее)
const dispCamo = computed(() => (tank.value.premium ? '' : previewCamo.value || selCamo.value))
const previewDef = computed(() => (previewCamo.value ? CAMO_BY_ID[previewCamo.value] : null))
function pickCamo(id) {
  const tid = tank.value.id
  if (camoUnlocked(tid, id)) {
    setCamo(tid, id)
    previewCamo.value = null
    haptic('select')
  } else {
    previewCamo.value = id // запертый — только примеряем на танк, покупка отдельной кнопкой
    haptic('select')
  }
}
async function buyPreview() {
  const tid = tank.value.id
  if (previewCamo.value && (await buyCamo(tid, previewCamo.value))) {
    previewCamo.value = null // куплен и надет
    haptic('success')
  } else {
    haptic('error') // не хватает жетонов
  }
}
// смена танка — сбрасываем примерку (камуфляжи у каждого танка свои)
watch(() => tank.value.id, () => (previewCamo.value = null))

onMounted(() => {
  track('hangar_viewed', {
    selected_tank: profile.selectedTank,
    tank_tier: tank.value?.tier || null,
    tank_class: tank.value?.cls || null,
    battle_mode: profile.battleMode,
    battles_count: profile.stats?.battles || 0,
    party_present: !!party.token,
  })
})
</script>

<template>
  <div class="pz-screen" style="background: #131510">
    <!-- ===== сцена ===== -->
    <div style="position: absolute; inset: 0; z-index: 0">
      <!-- бетонный пол: AI-фон ангара + затемнение для читаемости -->
      <div
        style="
          position: absolute;
          inset: 0;
          background:
            radial-gradient(420px 360px at 50% 36%, rgba(255, 236, 180, 0.06), transparent 70%),
            linear-gradient(180deg, rgba(13, 15, 10, 0.62) 0%, rgba(13, 15, 10, 0.45) 40%, rgba(10, 12, 8, 0.72) 100%),
            url('/sprites/hangar.png') center / cover no-repeat,
            linear-gradient(180deg, #191c14 0%, #14160f 45%, #0e100a 100%);
        "
      ></div>
      <!-- размеченный отсек (бочки/пятна убраны — фон ангара уже фотореальный) -->
      <div class="bay">
        <span v-for="i in 4" :key="i" class="bay-tick" :class="'c' + i"></span>
        <div class="bay-num pz-display">{{ t('hangar.bay') }}</div>
        <div class="bay-hazard"></div>
      </div>

      <!-- тень + танк. Тап → Ангар; драг в 3D → ПОВОРОТ танка (навигацию глушим, см. onTankTap) -->
      <div class="tank-wrap" data-tut="tank" @pointerdown="onTankDown" @click="onTankTap">
        <div class="tank-shadow"></div>
        <!-- 3D: модель ВЫБРАННОГО танка (любого), мордой к игроку; крути пальцем (turntable) -->
        <Tank3DView v-if="threeD" :url="heroUrl" :camo="locked ? '' : dispCamo" :seed="heroSeed" :scale="heroScale" class="tank3d-host" :style="locked ? 'filter: brightness(0.82) saturate(0.85)' : ''" @drag="onTankDrag" />
        <template v-else>
          <div :key="tank.id + selCamo" style="animation: pz-pop 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.4); transform: rotate(-7deg)">
            <TankImg :tank-id="tank.id" :size="300" :hangar="true" :camo="locked ? '' : dispCamo" :style="{ filter: locked ? 'grayscale(0.85) brightness(0.55)' : 'drop-shadow(0 16px 22px rgba(0,0,0,0.55))' }" />
          </div>
          <div v-if="locked" class="pz-chip" style="position: absolute; left: 50%; bottom: 4px; transform: translateX(-50%); color: var(--amber); background: rgba(0,0,0,0.82); white-space: nowrap; z-index: 3">
            <PzIcon name="lock" :size="12" /> {{ fmt(tank.cost || 0) }}
          </div>
        </template>
      </div>

      <!-- скримы для читаемости chrome -->
      <div style="position: absolute; left: 0; right: 0; top: 0; height: 170px; background: linear-gradient(180deg, rgba(8, 9, 6, 0.88), rgba(8, 9, 6, 0.4) 60%, transparent)"></div>
      <div style="position: absolute; left: 0; right: 0; bottom: 0; height: 320px; background: linear-gradient(0deg, rgba(8, 9, 6, 0.94) 30%, rgba(8, 9, 6, 0.55) 65%, transparent)"></div>
    </div>


    <!-- ===== chrome ===== -->
    <header style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px 6px">
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto">
        <div class="pz-display" style="font-size: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">PANZER <span style="color: var(--amber)">TG</span></div>
        <!-- премиум активен: корона на главной (тап → магазин) -->
        <button v-if="isPremium()" class="prem-badge pz-display" :title="t('hangar.premiumActive') + ' · ' + t('common.days', { n: premiumDaysLeft() })" @click="emit('go', 'shop')">♛ {{ t('common.premiumShort') }}</button>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0">
        <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" @shop="emit('go', 'shop')" />
        <button class="support-btn" :title="t('settings.title')" :aria-label="t('settings.title')" @click="openSettings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>

    <!-- ТУМБЛЕР 2D/3D — плавающий, виден всем; по умолчанию 2D (опт-ин) -->
    <button class="td-toggle pz-display" :class="{ on: threeD }" :title="threeD ? 'Бой в 3D — нажми для 2D' : 'Бой в 2D — нажми для 3D'" @click="toggle3D">{{ threeD ? '3D' : '2D' }}</button>

    <!-- СРЕДНЯЯ ЧАСТЬ скроллится; CTA «В БОЙ» + навигация ниже ЗАКРЕПЛЕНЫ (всегда видны).
         Раньше весь стек прижимался к низу в overflow:hidden-экране → на коротких
         телефонах низ (В БОЙ/навигация) обрезался и был недостижим («не могу в бой»). -->
    <div class="hangar-mid pz-noscroll">
    <!-- ИМЯ ВЫБРАННОГО ТАНКА. Сменить машину/камуфляж — на вкладке «Ангар» (тап по танку/чипу) -->
    <div style="margin-top: auto; padding: 0 14px 6px; text-align: center">
      <div style="display: flex; align-items: baseline; justify-content: center; gap: 8px">
        <span class="pz-display" style="font-size: 32px; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.85)">{{ tank.name }}</span>
        <span class="pz-pixel" style="font-size: 8px; color: var(--amber)">{{ t('hangar.tier', { n: tank.tier }) }}</span>
        <span v-if="tank.premium" class="pz-pixel" style="font-size: 7px; color: #1d1604; background: var(--amber); border-radius: 5px; padding: 2px 5px 1px">{{ t('hangar.premBadge') }}</span>
      </div>
      <div style="font-size: 12px; color: var(--ink-dim); font-weight: 500; margin-top: 2px">{{ t('game.classes.' + tank.classId) }} · {{ nationLabel }} · {{ t('hangar.crew', { n: crewLevel() }) }}</div>
    </div>

    <!-- Главная — чисто: танк + В БОЙ. Выбор танка/камуфляж/прокачка — на вкладке «⇄ Ангар». -->

    <!-- КОМПАКТНЫЙ ТУЛБАР В ОДНУ СТРОКУ: «⇄ Ангар» (там танки+камуфляж) + ТТХ/Задачи/Взвод.
         Чистый экран — основное это танк и «В БОЙ». -->
    <div class="hangar-tools">
      <button class="toolpill toolpill--go" data-tut="garage" @click="emit('go', 'tree')">⇄ {{ t('nav.tree') }}</button>
      <button class="toolpill" :class="{ on: ttx }" @click="track('ttx_opened', { tank_id: tank.id, open_to: !ttx }); ttx = !ttx">{{ t('hangar.ttx') }}</button>
      <button v-if="!firstSession" class="toolpill" @click="openTasksSheet"><span class="tp-rel">{{ t('hangar.tasks') }}<i v-if="tasksClaimable() > 0" class="task-dot"></i></span></button>
      <button v-if="!firstSession" class="toolpill" @click="openSquadSheet" :class="{ on: inParty }">{{ t('hangar.platoon') }}</button>
    </div>

    <!-- ТТХ-шторка -->
    <div v-if="ttx" class="pz-plate" style="margin: 0 14px 8px; padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 7px; animation: pz-slide-up 0.22s ease">
      <StatRow v-for="s in ttxStats" :key="s.key" :label="s.label" :value="s.value" :base="s.base" :display="s.display" :display-up="s.displayUp" />
      <div style="font-size: 11.5px; color: var(--ink-dim); line-height: 1.45; margin-top: 2px">{{ tank.desc }}</div>
    </div>

    <!-- ВКЛЮЧИ УВЕДОМЛЕНИЯ → +N💎: постоянный заметный вход, чтобы вырастить охват пушей
         (81% не дали боту право писать → рассылка возврата уходит «в 0»). Прячется после выдачи. -->
    <button v-if="notifOffer" class="chbanner chbanner--notif" @click="enableNotifs">
      <span class="chb-icon">🔔</span>
      <span class="chb-text">
        <span class="chb-title">{{ t('hangar.notifBanner') }}</span>
        <span class="chb-reward">
          <PzIcon name="token" :size="12" /> +{{ serverConfig.pushBonusTokens || 25 }}
        </span>
      </span>
      <span class="chb-cta">▸</span>
    </button>

    <!-- «нам важно ваше мнение» → написать в саппорт → бонус жетонов -->
    <button v-if="feedbackOffer && !notifOffer" class="chbanner" @click="openFeedbackSheet">
      <span class="chb-icon">💬</span>
      <span class="chb-text">
        <span class="chb-title">{{ t('feedback.banner') }}</span>
        <span class="chb-reward">
          <PzIcon name="token" :size="12" /> +{{ serverConfig.feedback.tokens }}
        </span>
      </span>
      <span class="chb-cta">▸</span>
    </button>

    </div>
    <!-- /hangar-mid -->

    <!-- РЕЖИМ + «В БОЙ» — ЗАКРЕПЛЕНЫ внизу (не скроллятся, всегда доступны) -->
    <div class="hangar-cta">
      <div class="modeseg" data-tut="mode">
        <button :class="{ on: profile.battleMode === 'capture' }" @click="pickMode('capture')">{{ t('common.modeCapture') }}</button>
        <button :class="{ on: profile.battleMode === 'annihilation' }" @click="pickMode('annihilation')">{{ t('common.modeAnnihilation') }}</button>
      </div>
      <button class="pz-cta playbtn" :class="locked ? 'pz-cta--muted' : 'pz-cta--hazard'" data-tut="play" @click="locked ? openOrUnlock() : emit('play')">
        <span v-if="locked" class="play-stack">
          <span class="play-main">{{ t('hangar.openTank') }}</span>
          <span class="play-sub">▸ {{ tank.name }}</span>
        </span>
        <span v-else class="play-stack">
          <span class="play-main">{{ t('common.play') }}<template v-if="inParty">{{ t('hangar.battlePlatoon') }}</template></span>
          <span class="play-sub">▸ {{ tank.name }}</span>
        </span>
      </button>
    </div>

    <BottomNav screen="hangar" @go="emit('go', $event)" />

    <SquadSheet v-if="squadOpen" @close="squadOpen = false" />
    <TasksSheet v-if="tasksOpen" @close="tasksOpen = false" />
    <FeedbackSheet v-if="feedbackOpen" @close="feedbackOpen = false" />
    <SettingsSheet v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
/* Средняя часть ангара: скроллится, если не влезает (короткие телефоны). CTA «В БОЙ»
   и нижняя навигация — СЁСТРЫ ниже, flex-shrink:0 → закреплены и всегда доступны.
   min-height:0 обязателен, иначе flex-ребёнок не даёт колонке сжиматься (контент
   распирал бы экран и снова прятал низ). */
.hangar-mid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  -webkit-overflow-scrolling: touch;
}
/* закреплённый низ: режим-сегмент над «В БОЙ» */
.hangar-cta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: linear-gradient(0deg, rgba(8, 9, 6, 0.6), transparent);
}
.hangar-cta .playbtn { width: 100%; }
/* компактный тулбар вторичных действий */
.hangar-tools {
  display: flex;
  gap: 7px;
  justify-content: center;
  flex-wrap: wrap;
  padding: 2px 12px 0;
}
.toolpill {
  font-family: var(--font-display);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 7px 12px;
  cursor: pointer;
}
.toolpill.on { color: var(--amber); border-color: var(--amber); background: rgba(242, 165, 12, 0.12); }
/* лента быстрого выбора танка (горизонтальный скролл) */
.quickpick {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  padding: 2px 14px 8px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.quickpick::-webkit-scrollbar { display: none; }
.qp-cell {
  position: relative;
  flex-shrink: 0;
  width: 50px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
}
.qp-cell.on {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.14);
  box-shadow: 0 0 9px rgba(242, 165, 12, 0.4);
}
.qp-cell.on:active, .qp-cell:active { transform: scale(0.94); }
.qp-tier {
  position: absolute;
  bottom: 1px;
  right: 3px;
  font-size: 7px;
  color: var(--ink-dim);
}
.qp-prem {
  position: absolute;
  top: 1px;
  left: 3px;
  font-size: 8px;
  line-height: 1;
  color: var(--amber);
}
/* «⇄ Ангар» — заметная (там танки + камуфляж) */
.toolpill--go { color: var(--amber); border-color: rgba(242, 165, 12, 0.55); background: rgba(242, 165, 12, 0.1); }
.toolpill--go:active { transform: scale(0.95); }
.tp-rel { position: relative; display: inline-flex; }
.tp-rel .task-dot { position: absolute; top: -4px; right: -7px; }
/* сегмент выбора режима (тонкий, вместо двух больших кнопок) */
.modeseg {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 3px;
}
.modeseg button {
  flex: 1;
  font-family: var(--font-display);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  background: transparent;
  border: none;
  border-radius: 7px;
  padding: 8px 6px;
  cursor: pointer;
}
.modeseg button.on { color: #1d1604; background: linear-gradient(180deg, var(--amber-hi, #ffce5a), var(--amber)); }
.prem-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 3px 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #1d1604;
  background: linear-gradient(180deg, var(--amber-hi, #ffce5a), var(--amber));
  border: none;
  border-radius: 7px;
  box-shadow: 0 0 10px rgba(242, 165, 12, 0.5);
  cursor: pointer;
}
.prem-badge i {
  font-style: normal;
  font-size: 9px;
  opacity: 0.7;
}
/* тестерский тоггл 3D-рендера боя — плавающий справа под шапкой (вне потока,
   чтобы не перекрывался балансом/премиумом при любой ширине заголовка) */
.td-toggle {
  position: absolute;
  /* корень .pz-screen имеет padding-top: var(--safe-top) и position:absolute, поэтому
     абсолютный top отсчитывается ОТ САМОГО верха (под тг-кнопками). Добавляем safe-top,
     чтобы чип сел НИЖЕ телеграм-кнопок (✕/⌄/•••), на уровень ряда наций. */
  top: calc(var(--safe-top, 0px) + 52px);
  right: 12px;
  z-index: 30;
  padding: 4px 10px;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #cfe0ff;
  background: rgba(8, 12, 18, 0.82);
  border: 1px solid rgba(120, 180, 255, 0.5);
  border-radius: 8px;
  cursor: pointer;
}
.td-toggle.on {
  color: #0b1014;
  background: linear-gradient(180deg, #7fe0ff, #38b6ff);
  border-color: transparent;
  box-shadow: 0 0 10px rgba(56, 182, 255, 0.5);
}
/* 3D-эксперимент: хост модели в отсеке + пикер 3 танков */
.tank3d-host { width: 340px; height: 310px; }
.td-pick {
  flex-shrink: 0; padding: 9px 16px;
  font-family: 'Russo One', sans-serif; font-size: 13px; letter-spacing: 0.04em;
  color: #cfe0ff; background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line-strong); border-radius: 9px; cursor: pointer;
}
.td-pick.on {
  color: #0b1014; background: linear-gradient(180deg, var(--amber-hi, #ffce5a), var(--amber));
  border-color: transparent;
}
.prem-badge:active {
  transform: scale(0.95);
}
.support-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: rgba(0, 0, 0, 0.4);
  color: var(--amber);
  cursor: pointer;
}
.support-btn:active {
  transform: scale(0.94);
}
.bay {
  position: absolute;
  left: 50%;
  top: 37%;
  width: 264px;
  height: 330px;
  transform: translate(-50%, -50%);
  border: 2.5px dashed color-mix(in oklab, var(--amber) 35%, transparent);
  border-radius: 6px;
}
.bay-tick {
  position: absolute;
  width: 22px;
  height: 22px;
  opacity: 0.8;
}
.bay-tick.c1 {
  top: -3px;
  left: -3px;
  border-top: 4px solid var(--amber);
  border-left: 4px solid var(--amber);
}
.bay-tick.c2 {
  top: -3px;
  right: -3px;
  border-top: 4px solid var(--amber);
  border-right: 4px solid var(--amber);
}
.bay-tick.c3 {
  bottom: -3px;
  left: -3px;
  border-bottom: 4px solid var(--amber);
  border-left: 4px solid var(--amber);
}
.bay-tick.c4 {
  bottom: -3px;
  right: -3px;
  border-bottom: 4px solid var(--amber);
  border-right: 4px solid var(--amber);
}
.bay-num {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 64px;
  color: rgba(232, 230, 218, 0.05);
  letter-spacing: 0.1em;
  white-space: nowrap;
}
.bay-hazard {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -16px;
  height: 10px;
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in oklab, var(--amber) 40%, transparent) 0 10px,
    rgba(0, 0, 0, 0.5) 10px 20px
  );
  border-radius: 2px;
  opacity: 0.5;
}
.camo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 14px 0;
  flex-shrink: 0;
}
.camo-dots {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px 4px;
  overflow-x: auto; /* много скинов — горизонтальный скролл, ряд не ломается */
  flex-shrink: 0;
}
.camo-buy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 2px 14px 4px;
  padding: 6px 8px 6px 12px;
  border: 1px solid var(--amber);
  border-radius: 9px;
  background: rgba(242, 165, 12, 0.08);
  flex-shrink: 0;
  animation: pz-slide-up 0.2s ease;
}
.camo-buy-name {
  font-size: 13px;
  color: var(--amber);
}
.camo-buy-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  font-size: 13px;
  flex-shrink: 0;
  width: auto; /* .pz-cta даёт width:100% → кнопка распиралась на всю ширину; тут — по контенту */
}
.camo-cell {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 4px 6px 3px;
  border-radius: 9px;
  border: 1.5px solid var(--line-strong);
  background: rgba(0, 0, 0, 0.32);
  cursor: pointer;
  opacity: 0.9;
}
.camo-cell.locked :deep(canvas) {
  filter: grayscale(0.7) brightness(0.6); /* не куплен — приглушаем превью */
}
.camo-price {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 7px;
  color: #1d1604;
  background: var(--amber);
  padding: 1px 4px 1px 2px;
  border-radius: 6px;
}
.camo-cell.on {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.12);
  box-shadow: 0 0 8px rgba(242, 165, 12, 0.4);
  opacity: 1;
}
.camo-cell:disabled {
  opacity: 0.4;
  cursor: default;
}
.camo-lbl {
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-dim);
}
.camo-cell.on .camo-lbl {
  color: var(--amber);
}
.tank-wrap {
  position: absolute;
  left: 50%;
  top: 37%;
  transform: translate(-50%, -50%);
}
.tank-shadow {
  position: absolute;
  left: 50%;
  top: 54%;
  width: 190px;
  height: 210px;
  transform: translate(-50%, -50%);
  background: radial-gradient(ellipse, rgba(0, 0, 0, 0.55), transparent 68%);
  border-radius: 50%;
}
.squad-btn {
  flex-direction: column;
  gap: 3px;
  padding: 8px 12px;
  font-size: 11px;
  flex-shrink: 0; /* ЗАДАЧИ/ВЗВОД фиксированы, не жмутся под длинное имя танка */
}
/* «следующая цель» — слим-чип над кнопкой «В БОЙ» */
.goal-chip {
  margin: 4px 14px 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: rgba(242, 165, 12, 0.07);
  color: var(--ink);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.goal-chip:active {
  background: rgba(242, 165, 12, 0.14);
}
.goal-lbl {
  font-size: 7px;
  letter-spacing: 0.14em;
  color: var(--amber);
  flex-shrink: 0;
}
.goal-text {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}
.goal-arr {
  flex-shrink: 0;
  color: var(--amber);
  font-weight: 800;
}
/* тизер статистики — холодный акцент, чтобы не спорить с янтарным чипом цели */
.stats-chip {
  background: rgba(124, 192, 255, 0.07);
}
.stats-chip:active {
  background: rgba(124, 192, 255, 0.14);
}
.stats-chip .goal-lbl,
.stats-chip .goal-arr {
  color: #7cc0ff;
}
/* кнопка В БОЙ: «В БОЙ» крупно + имя танка отдельной строкой (длинные имена
   вроде «Т-34-85»/«Leopard 2A7» не распирают и не переносятся как попало) */
.playbtn {
  flex: 1;
  min-width: 0;
  padding: 9px 14px;
}
.play-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  line-height: 1.05;
}
.play-main {
  font-size: 19px;
}
.play-sub {
  max-width: 100%;
  font-size: 11px;
  opacity: 0.78;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-dot {
  position: absolute;
  top: -3px;
  right: -5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 6px rgba(242, 165, 12, 0.8);
  animation: pz-blink 1.4s linear infinite;
}
.crew-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 10px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ink-dim);
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  font-family: var(--font-display);
  cursor: pointer;
}
.crew-badge:active {
  border-color: var(--amber);
  color: var(--amber);
}
.crew-badge > div:first-child,
.crew-badge span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.crew-badge .bar {
  width: 54px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.crew-badge .bar b {
  display: block;
  height: 100%;
  background: var(--amber);
}
.squad-btn .dots {
  display: flex;
  gap: 4px;
}
.squad-btn .dots .slot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px dashed var(--ink-faint);
  display: flex;
  align-items: center;
  justify-content: center;
}
.squad-btn .dots .slot.you {
  border: 1.5px solid var(--amber);
  background: rgba(242, 165, 12, 0.17);
}
.modeopt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--ink-dim);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.modeopt.on {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.08);
  color: var(--ink);
}
.modeopt .mlabel {
  font-size: 11.5px;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.modeopt.on .mlabel {
  color: var(--amber);
}
.modeopt .msub {
  font-size: 9.5px;
  color: var(--ink-faint);
  font-weight: 500;
  white-space: nowrap;
}
.squad-btn .dots .slot.filled {
  border: 1.5px solid var(--blue);
  background: rgba(77, 163, 255, 0.2);
}
/* промо-баннер «подпишись на канал → бонус» */
.chbanner {
  margin: 6px 14px 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--amber);
  border-radius: 10px;
  background: linear-gradient(90deg, rgba(255, 193, 7, 0.16), rgba(255, 193, 7, 0.05));
  cursor: pointer;
  animation: chb-pulse 2.4s ease-in-out infinite;
}
@keyframes chb-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(255, 193, 7, 0);
  }
  50% {
    box-shadow: 0 0 12px 0 rgba(255, 193, 7, 0.35);
  }
}
/* баннер уведомлений — синий (цвет «колокольчика»), отличается от амбер-фидбека */
.chbanner--notif {
  border-color: #57b6f0;
  background: linear-gradient(90deg, rgba(87, 182, 240, 0.18), rgba(87, 182, 240, 0.05));
  animation: chb-pulse-notif 2.4s ease-in-out infinite;
}
@keyframes chb-pulse-notif {
  0%, 100% { box-shadow: 0 0 0 0 rgba(87, 182, 240, 0); }
  50% { box-shadow: 0 0 12px 0 rgba(87, 182, 240, 0.4); }
}
.chb-icon {
  font-size: 18px;
  line-height: 1;
}
.chb-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  text-align: left;
}
.chb-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
}
.chb-reward {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--amber);
}
.chb-cta {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--bg, #0b0d08);
  background: var(--amber);
  padding: 5px 12px;
  border-radius: 7px;
}
</style>
