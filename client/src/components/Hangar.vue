<script setup>
// Ангар-сцена (порт HangarSceneScreen): отсек-гараж, top-down танк, нации,
// ТТХ-шторка, карусель танков, кнопки ВЗВОД и В БОЙ, нижняя навигация.
import { ref, computed, watch, onMounted } from 'vue'
import { profile, party, setNation, selectTank, isOwned, crewLevel, crewProgress, setCamo, buyCamo, camoUnlocked, tankCamo, tasksClaimable, tankModLevel, setBattleMode } from '../store.js'
import { squad } from '../game/squad.js'
import { tanksOfNation, TANK_BY_ID, NATIONS, STAT_LABELS, CAMOS, CAMO_BY_ID, MODULE_COMBAT } from '../game/meta.js'
import { haptic, openSupport } from '../tg.js'
import { track } from '../analytics.js'
import TankImg from './ui/TankImg.vue'
import CurrencyBar from './ui/CurrencyBar.vue'
import NationSwitch from './ui/NationSwitch.vue'
import BottomNav from './ui/BottomNav.vue'
import StatRow from './ui/StatRow.vue'
import PzIcon from './ui/PzIcon.vue'
import SquadSheet from './SquadSheet.vue'
import TasksSheet from './TasksSheet.vue'

const emit = defineEmits(['play', 'go'])
const squadOpen = ref(false)
const tasksOpen = ref(false)

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
function openSupportTracked() {
  track('support_opened', {
    from_screen: 'hangar',
    before_first_battle: (profile.stats?.battles || 0) === 0,
  })
  haptic('light')
  openSupport()
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

const tank = computed(() => TANK_BY_ID[profile.selectedTank] || tanksOfNation(profile.nation)[0])

// ТТХ с учётом прокачки: дизайн-стата × модуль × экипаж (как в loadoutStats).
// base — исходное, value — с прокачкой; шторка рисует прирост, а не статику.
const STAT_MOD = { dmg: 'gun', hp: 'tur', spd: 'eng', mnv: 'trk', view: 'rad' }
const ttxStats = computed(() => {
  const t = tank.value
  const ck = 1 + (crewLevel() - 1) * 0.01 // экипаж баффает ход/манёвр/обзор/темп
  return Object.entries(t.stats).map(([k, base]) => {
    let m = 1
    const mod = STAT_MOD[k]
    if (mod) m *= MODULE_COMBAT[mod][tankModLevel(t.id, mod) - 1]
    if (k === 'spd' || k === 'mnv' || k === 'view' || k === 'rof') m *= ck
    return { key: k, label: STAT_LABELS[k], base, value: Math.min(10, +(base * m).toFixed(1)) }
  })
})
const locked = computed(() => !isOwned(tank.value.id))
// первая сессия (ещё ни одного боя): на ангаре оставляем ОДИН CTA «В БОЙ» —
// ЗАДАЧИ и ВЗВОД прячем, чтобы не размывать вход. После первого боя возвращаются.
const firstSession = computed(() => (profile.stats?.battles || 0) === 0)
const nationLabel = computed(() => (NATIONS.find((n) => n.id === profile.nation) || {}).label)
const tanks = computed(() => tanksOfNation(profile.nation))
const ttx = ref(false)
const fmt = (n) => n.toLocaleString('ru-RU')
const inParty = computed(() => squad.active || !!party.token) // в лобби взвода или уже в бою с ним
// друг зашёл по ссылке (squad стал активен) → авто-открываем шторку взвода, чтобы он видел лобби
watch(() => squad.active, (a) => { if (a) squadOpen.value = true })
// камуфляж на КАЖДЫЙ танк: разблокировка за жетоны, потом надевается бесплатно
const selCamo = computed(() => tankCamo(tank.value.id))
// предпросмотр запертого камо: показываем на БОЛЬШОМ танке, не покупая.
// Большой танк рисует previewCamo (если есть) поверх надетого.
const previewCamo = ref(null)
const dispCamo = computed(() => previewCamo.value || selCamo.value)
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
function buyPreview() {
  const tid = tank.value.id
  if (previewCamo.value && buyCamo(tid, previewCamo.value)) {
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
        <div class="bay-num pz-display">Б-01</div>
        <div class="bay-hazard"></div>
      </div>

      <!-- тень + танк -->
      <div class="tank-wrap">
        <div class="tank-shadow"></div>
        <div :key="tank.id + selCamo" style="animation: pz-pop 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.4); transform: rotate(-7deg)">
          <TankImg :tank-id="tank.id" :size="300" :camo="locked ? '' : dispCamo" :style="{ filter: locked ? 'grayscale(0.85) brightness(0.55)' : 'drop-shadow(0 16px 22px rgba(0,0,0,0.55))' }" />
        </div>
        <div v-if="locked" class="pz-chip" style="position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%); color: var(--amber)">
          <PzIcon name="lock" :size="12" /> {{ fmt(tank.cost || 0) }}
        </div>
      </div>

      <!-- скримы для читаемости chrome -->
      <div style="position: absolute; left: 0; right: 0; top: 0; height: 170px; background: linear-gradient(180deg, rgba(8, 9, 6, 0.88), rgba(8, 9, 6, 0.4) 60%, transparent)"></div>
      <div style="position: absolute; left: 0; right: 0; bottom: 0; height: 320px; background: linear-gradient(0deg, rgba(8, 9, 6, 0.94) 30%, rgba(8, 9, 6, 0.55) 65%, transparent)"></div>
    </div>

    <!-- ===== chrome ===== -->
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px">
      <div class="pz-display" style="font-size: 19px">PANZER <span style="color: var(--amber)">TG</span></div>
      <div style="display: flex; align-items: center; gap: 8px">
        <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" @shop="emit('go', 'shop')" />
        <button class="support-btn" title="Поддержка" aria-label="Поддержка" @click="openSupportTracked">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
            <rect x="2.5" y="13" width="4" height="6" rx="1.6" />
            <rect x="17.5" y="13" width="4" height="6" rx="1.6" />
            <path d="M20 18v.5a3.5 3.5 0 0 1-3.5 3.5H13" />
          </svg>
        </button>
      </div>
    </header>

    <NationSwitch :nation="profile.nation" style="padding: 2px 14px" @pick="setNation" />

    <!-- ID-плашка танка -->
    <div style="margin-top: auto; padding: 0 14px 6px; display: flex; align-items: flex-end; justify-content: space-between; gap: 10px">
      <div>
        <div style="display: flex; align-items: baseline; gap: 8px">
          <span class="pz-display" style="font-size: 30px; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8)">{{ tank.name }}</span>
          <span class="pz-pixel" style="font-size: 8px; color: var(--amber)">УР.{{ tank.tier }}</span>
        </div>
        <div style="font-size: 12px; color: var(--ink-dim); font-weight: 500; margin-top: 1px">{{ tank.cls }} · {{ nationLabel }}</div>
      </div>
      <div style="display: flex; gap: 6px; align-items: center">
        <!-- экипаж: один на все танки, уровень баффает машину; клик — прокачка -->
        <button class="crew-badge pz-display" title="Открыть прокачку экипажа" @click="emit('go', 'crew')">
          <span>ЭКИПАЖ {{ crewLevel() }} ▸</span>
          <i class="bar"><b :style="{ width: crewProgress() * 100 + '%' }"></b></i>
        </button>
        <button class="pz-btn2" style="padding: 8px 12px; font-size: 11.5px" :style="{ borderColor: ttx ? 'var(--amber)' : 'var(--line-strong)', color: ttx ? 'var(--amber)' : 'var(--ink)' }" @click="track('ttx_opened', { tank_id: tank.id, open_to: !ttx }); ttx = !ttx">
          ТТХ {{ ttx ? '▾' : '▸' }}
        </button>
      </div>
    </div>

    <!-- ТТХ-шторка -->
    <div v-if="ttx" class="pz-plate" style="margin: 0 14px 8px; padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 7px; animation: pz-slide-up 0.22s ease">
      <StatRow v-for="s in ttxStats" :key="s.key" :label="s.label" :value="s.value" :base="s.base" />
      <div style="font-size: 11.5px; color: var(--ink-dim); line-height: 1.45; margin-top: 2px">{{ tank.desc }}</div>
    </div>

    <!-- камуфляж: 3 схемы + заводская, на КАЖДЫЙ танк. Превью — сам танк в этом
         камо; разблокировка за жетоны (заводская бесплатна) -->
    <div class="camo-head">
      <span class="pz-pixel" style="font-size: 7px; color: var(--ink-faint); letter-spacing: 0.1em">КАМУФЛЯЖ</span>
    </div>
    <div class="camo-dots pz-noscroll">
      <button
        v-for="c in CAMOS"
        :key="c.id || 'std'"
        class="camo-cell"
        :class="{ on: dispCamo === c.id, locked: !camoUnlocked(tank.id, c.id) }"
        :disabled="locked"
        :title="c.name"
        @click="pickCamo(c.id)"
      >
        <TankImg :tank-id="tank.id" :camo="c.id" :size="40" :rotate="180" />
        <span v-if="!camoUnlocked(tank.id, c.id)" class="camo-price pz-pixel">
          <PzIcon name="token" :size="8" /> {{ c.cost }}
        </span>
        <span class="camo-lbl">{{ c.short }}</span>
      </button>
    </div>
    <!-- примерка запертого камо: купить за жетоны (танк уже показан в нём) -->
    <div v-if="previewCamo && previewDef" class="camo-buy">
      <span class="camo-buy-name pz-display">{{ previewDef.name }}</span>
      <button class="pz-cta camo-buy-btn" @click="buyPreview">
        КУПИТЬ <PzIcon name="token" :size="11" /> {{ previewDef.cost }}
      </button>
    </div>

    <!-- карусель -->
    <div class="pz-noscroll" style="display: flex; gap: 8px; overflow-x: auto; padding: 4px 14px; flex-shrink: 0">
      <button
        v-for="t in tanks"
        :key="t.id"
        :class="t.id === tank.id ? 'pz-brackets' : ''"
        :style="{
          '--bk': 'var(--amber)',
          flexShrink: 0,
          width: '76px',
          padding: '8px 4px 7px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          background: t.id === tank.id ? 'linear-gradient(180deg, rgba(242,165,12,.14), rgba(0,0,0,.5))' : 'rgba(0,0,0,.5)',
          border: '1px solid ' + (t.id === tank.id ? 'var(--amber)' : 'var(--line-strong)'),
          borderRadius: '8px',
          cursor: 'pointer',
          color: !isOwned(t.id) ? 'var(--ink-faint)' : 'var(--ink)',
        }"
        @click="selectTankTracked(t)"
      >
        <span class="pz-pixel" style="font-size: 8px" :style="{ color: t.id === tank.id ? 'var(--amber)' : 'var(--ink-faint)' }">{{ t.tier }}</span>
        <TankImg :tank-id="t.id" :size="42" :style="{ filter: isOwned(t.id) ? 'none' : 'grayscale(0.9) brightness(0.55)' }" />
        <span class="pz-display" style="font-size: 10px; line-height: 1.05; text-align: center; white-space: normal; word-break: break-word; height: 23px; display: flex; align-items: center; justify-content: center; overflow: hidden">{{ t.name }}</span>
        <span style="height: 14px; display: flex; align-items: center" :style="{ color: t.id === tank.id ? 'var(--amber)' : 'var(--ink-faint)' }">
          <PzIcon :name="isOwned(t.id) ? 'star' : 'lock'" :size="11" :color="t.id === tank.id ? 'var(--amber)' : 'var(--ink-faint)'" />
        </span>
      </button>
    </div>

    <!-- режим боя -->
    <div class="modepick" style="padding: 6px 14px 0; flex-shrink: 0; display: flex; gap: 6px">
      <button class="modeopt" :class="{ on: profile.battleMode === 'capture' }" @click="pickMode('capture')">
        <span class="pz-display mlabel">ЗАХВАТ</span>
        <span class="msub">точки · быстрая катка</span>
      </button>
      <button class="modeopt" :class="{ on: profile.battleMode === 'annihilation' }" @click="pickMode('annihilation')">
        <span class="pz-display mlabel">НА УНИЧТОЖЕНИЕ</span>
        <span class="msub">бой до последнего</span>
      </button>
    </div>

    <!-- CTA -->
    <div style="padding: 8px 14px 4px; flex-shrink: 0; display: flex; gap: 8px">
      <button v-if="!firstSession" class="pz-btn2 squad-btn tasks-btn" @click="openTasksSheet">
        <span style="position: relative">
          <PzIcon name="tasks" :size="18" />
          <i v-if="tasksClaimable() > 0" class="task-dot"></i>
        </span>
        ЗАДАЧИ
      </button>
      <button v-if="!firstSession" class="pz-btn2 squad-btn" @click="openSquadSheet">
        <span class="dots">
          <span class="slot you"><PzIcon name="star" :size="7" color="var(--amber)" /></span>
          <span class="slot" :class="{ filled: inParty }"></span>
          <span class="slot" :class="{ filled: inParty }"></span>
        </span>
        ВЗВОД
      </button>
      <button class="pz-cta pz-cta--hazard playbtn" @click="locked ? emit('go', 'tree') : emit('play')">
        <span v-if="locked" class="play-stack">
          <span class="play-main">ОТКРЫТЬ ТАНК ▸</span>
          <span class="play-sub">в «Развитии»</span>
        </span>
        <span v-else class="play-stack">
          <span class="play-main">В БОЙ<template v-if="inParty"> · ВЗВОД</template></span>
          <span class="play-sub">▸ {{ tank.name }}</span>
        </span>
      </button>
    </div>

    <BottomNav screen="hangar" @go="emit('go', $event)" />

    <SquadSheet v-if="squadOpen" @close="squadOpen = false" />
    <TasksSheet v-if="tasksOpen" @close="tasksOpen = false" />
  </div>
</template>

<style scoped>
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
</style>
