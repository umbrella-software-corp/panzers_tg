<script setup>
// Прокачка (порт TreeScreen): вертикальная ветка нации с пунктирной осью,
// исследование танков (пред. куплен + его топ-модули 5/5), док выбранной
// машины — табы 5 слотов модулей × 3 уровня, апгрейд за кредиты.
import { ref, computed } from 'vue'
import {
  profile,
  setNation,
  selectTank,
  isOwned,
  canUnlock,
  unlockReason,
  buyTank,
  upgradeModule,
  tankModLevel,
  prevTank,
} from '../store.js'
import { tanksOfNation, MODULE_DEFS, moduleCost, modsMaxedCount } from '../game/meta.js'
import TankImg from './ui/TankImg.vue'
import CurrencyBar from './ui/CurrencyBar.vue'
import NationSwitch from './ui/NationSwitch.vue'
import BottomNav from './ui/BottomNav.vue'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['go'])

const tanks = computed(() => tanksOfNation(profile.nation))
const sel = ref(null)
const modTab = ref('gun')
const flash = ref(false)
const selected = computed(() => tanks.value.find((t) => t.id === sel.value))
const mod = computed(() => MODULE_DEFS.find((m) => m.id === modTab.value))
const fmt = (n) => (n || 0).toLocaleString('ru-RU')
const maxedCount = (tankId) => modsMaxedCount(profile.modules, tankId)

// чеклист разблокировки выбранной (некупленной) машины: каждое условие со ✓/✗.
// Заменяет «серую кнопку без объяснения» — игрок видит, что выполнено и что нет.
const checklist = computed(() => {
  const t = selected.value
  if (!t || isOwned(t.id)) return []
  const prev = prevTank(t)
  const rows = []
  if (prev) {
    rows.push({ done: isOwned(prev.id), label: `Исследовать ${prev.name}` })
    const maxed = Math.min(5, maxedCount(prev.id))
    rows.push({ done: maxed >= 5, label: `Топ-модули ${prev.name}`, value: `${maxed}/5` })
  }
  rows.push({ done: profile.credits >= (t.cost || 0), label: 'Кредиты', value: `${fmt(profile.credits)} / ${fmt(t.cost || 0)}` })
  return rows
})
// шаг, к которому ведёт кнопка «→»: пред. танк (открыть его) либо его модули
const gotoStep = computed(() => {
  const t = selected.value
  if (!t || isOwned(t.id)) return null
  const prev = prevTank(t)
  if (!prev) return null
  if (!isOwned(prev.id)) return { id: prev.id, label: `Открыть ${prev.name}` }
  if (maxedCount(prev.id) < 5) return { id: prev.id, label: `К модулям ${prev.name}` }
  return null
})
// перейти к пред. танку: раскрыть его док (там либо его модули, либо его чеклист)
function goToStep(id) {
  sel.value = id
  modTab.value = 'gun'
}

function pickNation(n) {
  sel.value = null
  setNation(n)
}
function toggle(t) {
  sel.value = sel.value === t.id ? null : t.id
  modTab.value = 'gun'
}
function shake() {
  flash.value = true
  setTimeout(() => (flash.value = false), 600)
}
function research(t) {
  if (buyTank(t)) selectTank(t.id)
  else shake()
}
function buyModule(modId) {
  if (!upgradeModule(sel.value, modId)) shake()
}
function pickInHangar() {
  selectTank(sel.value)
  emit('go', 'hangar')
}
// цвет ромбика уровня модуля в строке ветки
function diamondColor(tankId, modId) {
  const lvl = tankModLevel(tankId, modId)
  if (lvl >= 3) return 'var(--amber)'
  if (lvl === 2) return 'rgba(242,165,12,.47)'
  return 'rgba(255,255,255,.14)'
}
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.88), rgba(13, 15, 10, 0.94)), url('/sprites/bg_tree.png') center / cover no-repeat">
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px">
      <div class="pz-display" style="font-size: 17px">РАЗВИТИЕ</div>
      <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" @shop="emit('go', 'shop')" />
    </header>

    <NationSwitch :nation="profile.nation" style="padding: 2px 14px 8px" @pick="pickNation" />

    <!-- ===== ветка ===== -->
    <div class="pz-noscroll" style="flex: 1; overflow-y: auto; padding: 14px 14px 10px; position: relative">
      <div style="position: relative; display: flex; flex-direction: column; gap: 14px">
        <!-- пунктирная ось -->
        <div class="spine"></div>

        <button
          v-for="t in tanks"
          :key="t.id"
          class="pz-plate node"
          :class="{ 'pz-brackets': sel === t.id }"
          :style="{
            '--bk': 'var(--amber)',
            borderColor: sel === t.id ? 'var(--amber)' : isOwned(t.id) ? 'var(--line-strong)' : 'var(--line)',
            opacity: !isOwned(t.id) && !canUnlock(t) ? 0.55 : 1,
          }"
          @click="toggle(t)"
        >
          <!-- узел оси -->
          <div
            class="node-dot"
            :style="{
              borderColor: isOwned(t.id) ? 'var(--amber)' : 'var(--line-strong)',
              background: isOwned(t.id) ? 'rgba(242,165,12,.12)' : 'rgba(0,0,0,.4)',
              color: isOwned(t.id) ? 'var(--amber)' : canUnlock(t) ? 'var(--ink-dim)' : 'var(--ink-faint)',
            }"
          >
            <PzIcon v-if="isOwned(t.id)" name="star" :size="13" color="var(--amber)" />
            <span v-else-if="canUnlock(t)" class="pz-pixel" style="font-size: 9px">{{ t.tier }}</span>
            <PzIcon v-else name="lock" :size="12" />
          </div>

          <!-- реальный силуэт машины -->
          <TankImg :tank-id="t.id" :size="40" :style="{ filter: isOwned(t.id) ? 'none' : 'grayscale(0.9) brightness(0.55)', flexShrink: 0 }" />

          <div>
            <div style="display: flex; align-items: baseline; gap: 7px">
              <span class="pz-display" style="font-size: 15.5px">{{ t.name }}</span>
              <span style="font-size: 11px; color: var(--ink-dim); font-weight: 500">{{ t.cls }} · ур. {{ t.tier }}</span>
            </div>
            <div style="font-size: 11px; color: var(--ink-faint); margin-top: 2px; font-weight: 500; display: flex; align-items: center; gap: 6px">
              <template v-if="isOwned(t.id)">
                <span style="display: flex; gap: 3px">
                  <span v-for="m in MODULE_DEFS" :key="m.id" class="diamond" :style="{ background: diamondColor(t.id, m.id) }"></span>
                </span>
                топ-модули {{ maxedCount(t.id) }}/{{ MODULE_DEFS.length }}
              </template>
              <template v-else-if="canUnlock(t)">Доступен к исследованию</template>
              <template v-else>{{ unlockReason(t) }}</template>
            </div>
          </div>

          <div v-if="!isOwned(t.id)" class="pz-chip" :style="{ color: canUnlock(t) ? 'var(--amber)' : 'var(--ink-faint)' }">
            <PzIcon name="coin" :size="13" /> {{ fmt(t.cost) }}
          </div>
        </button>
      </div>
    </div>

    <!-- ===== док выбранной машины ===== -->
    <div v-if="selected" :key="selected.id" class="pz-plate dock">
      <div style="display: flex; gap: 12px; align-items: center">
        <TankImg :tank-id="selected.id" :size="48" :style="{ filter: isOwned(selected.id) ? 'none' : 'grayscale(0.9) brightness(0.6)', flexShrink: 0 }" />
        <div style="flex: 1">
          <div class="pz-display" style="font-size: 16px">{{ selected.name }}</div>
          <div style="font-size: 11.5px; color: var(--ink-dim); line-height: 1.4; margin-top: 2px">
            {{ isOwned(selected.id) ? 'Изучи все топ-модули, чтобы открыть следующую машину ветки.' : selected.desc }}
          </div>
        </div>
      </div>

      <template v-if="isOwned(selected.id)">
        <!-- табы слотов модулей -->
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px">
          <button
            v-for="m in MODULE_DEFS"
            :key="m.id"
            class="mod-tab"
            :style="{
              background: modTab === m.id ? 'rgba(242,165,12,.08)' : 'rgba(0,0,0,.35)',
              borderColor: modTab === m.id ? 'var(--amber)' : 'var(--line)',
              color: modTab === m.id ? 'var(--amber)' : tankModLevel(selected.id, m.id) >= 3 ? 'rgba(242,165,12,.6)' : 'var(--ink-faint)',
            }"
            @click="modTab = m.id"
          >
            <PzIcon :name="m.id" :size="20" />
            <span style="font-size: 9px; font-weight: 600" :style="{ color: modTab === m.id ? 'var(--ink)' : 'var(--ink-dim)' }">{{ m.label }}</span>
            <span style="display: flex; gap: 2px">
              <span
                v-for="l in 3"
                :key="l"
                class="pip"
                :style="{ background: l <= tankModLevel(selected.id, m.id) ? (modTab === m.id ? 'var(--amber)' : 'rgba(242,165,12,.53)') : 'rgba(255,255,255,.15)' }"
              ></span>
            </span>
          </button>
        </div>

        <!-- уровни выбранного слота -->
        <div style="display: flex; flex-direction: column; gap: 6px">
          <div
            v-for="(name, li) in mod.levels"
            :key="li"
            class="mod-row"
            :style="{
              background: li + 1 <= tankModLevel(selected.id, mod.id) ? 'rgba(242,165,12,.06)' : 'rgba(0,0,0,.35)',
              borderColor:
                li + 1 <= tankModLevel(selected.id, mod.id)
                  ? 'rgba(242,165,12,.4)'
                  : li + 1 === tankModLevel(selected.id, mod.id) + 1
                    ? 'var(--line-strong)'
                    : 'var(--line)',
              opacity: li + 1 > tankModLevel(selected.id, mod.id) + 1 ? 0.5 : 1,
            }"
          >
            <div style="flex: 1; min-width: 0">
              <div style="font-size: 12.5px; font-weight: 600" :style="{ color: li + 1 > tankModLevel(selected.id, mod.id) + 1 ? 'var(--ink-dim)' : 'var(--ink)' }">{{ name }}</div>
              <div style="font-size: 10.5px; color: var(--ink-dim); font-weight: 500">{{ mod.stats[li] }}</div>
            </div>
            <span v-if="li + 1 <= tankModLevel(selected.id, mod.id)" class="pz-chip" style="color: var(--amber); font-size: 10.5px">
              {{ li + 1 === tankModLevel(selected.id, mod.id) ? 'Установлен ★' : '✓' }}
            </span>
            <button
              v-else-if="li + 1 === tankModLevel(selected.id, mod.id) + 1"
              class="pz-btn2"
              style="padding: 7px 12px; font-size: 11px; gap: 4px; border-color: var(--amber); color: var(--amber)"
              :style="{ animation: flash ? 'pz-shake .3s linear 2' : 'none' }"
              @click="buyModule(mod.id)"
            >
              <PzIcon name="coin" :size="12" /> {{ moduleCost(selected.tier, li + 1) }}
            </button>
            <span v-else class="pz-chip" style="color: var(--ink-faint); font-size: 10.5px"><PzIcon name="lock" :size="10" /> закрыто</span>
          </div>
        </div>

        <button class="pz-btn2" @click="pickInHangar">Выбрать в ангаре</button>
      </template>

      <template v-else>
        <!-- чеклист разблокировки: что выполнено (✓) и что осталось (✗) -->
        <div class="unlock-list">
          <div v-for="(s, i) in checklist" :key="i" class="unlock-row" :class="{ ok: s.done }">
            <span class="ul-mark">{{ s.done ? '✓' : '✗' }}</span>
            <span class="ul-label">{{ s.label }}</span>
            <span v-if="s.value" class="ul-value">{{ s.value }}</span>
          </div>
        </div>
        <!-- переход к недостающему шагу: пред. танк или его модули -->
        <button v-if="gotoStep" class="pz-btn2 goto-step" @click="goToStep(gotoStep.id)">→ {{ gotoStep.label }}</button>
        <!-- исследование активно, только когда условия (кроме кредитов) выполнены -->
        <button
          class="pz-cta"
          style="font-size: 15px; padding: 12px 16px"
          :style="{ animation: flash ? 'pz-shake .3s linear 2' : 'none' }"
          :disabled="!canUnlock(selected)"
          @click="research(selected)"
        >
          <template v-if="!canUnlock(selected)">ВЫПОЛНИ УСЛОВИЯ ВЫШЕ</template>
          <template v-else-if="profile.credits < selected.cost">НУЖНО <PzIcon name="coin" :size="15" /> {{ fmt(selected.cost) }}</template>
          <template v-else>ИССЛЕДОВАТЬ · {{ fmt(selected.cost) }}</template>
        </button>
      </template>
    </div>

    <BottomNav screen="tree" @go="emit('go', $event)" />
  </div>
</template>

<style scoped>
.spine {
  position: absolute;
  left: 29px;
  top: 18px;
  bottom: 18px;
  width: 2px;
  background: repeating-linear-gradient(0deg, var(--line-strong) 0 6px, transparent 6px 11px);
}
.node {
  display: grid;
  grid-template-columns: 46px 40px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  color: var(--ink);
  font-family: var(--font-body);
}
.node-dot {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  justify-self: start;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--line-strong);
  position: relative;
  z-index: 1;
}
.diamond {
  width: 6px;
  height: 6px;
  border-radius: 1px;
  transform: rotate(45deg);
}
.dock {
  margin: 0 14px 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: pz-slide-up 0.25s ease;
}
.mod-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 2px 6px;
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid var(--line);
}
.pip {
  width: 4px;
  height: 4px;
  border-radius: 1px;
}
.mod-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
}

/* чеклист разблокировки */
.unlock-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.unlock-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.28);
  font-size: 12.5px;
}
.unlock-row.ok {
  border-color: rgba(120, 190, 90, 0.45);
  background: rgba(120, 190, 90, 0.08);
}
.ul-mark {
  width: 16px;
  text-align: center;
  font-weight: 800;
  color: var(--red);
  flex-shrink: 0;
}
.unlock-row.ok .ul-mark {
  color: #7cc05a;
}
.ul-label {
  flex: 1;
  min-width: 0;
  color: var(--ink-dim);
}
.unlock-row.ok .ul-label {
  color: var(--ink);
}
.ul-value {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--ink-dim);
}
.goto-step {
  border-color: var(--amber);
  color: var(--amber);
  font-size: 12.5px;
}
</style>
