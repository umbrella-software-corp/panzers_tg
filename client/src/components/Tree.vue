<script setup>
// Прокачка (порт TreeScreen): вертикальная ветка нации с пунктирной осью,
// исследование танков (пред. куплен + его топ-модули 5/5), док выбранной
// машины — табы 5 слотов модулей × 3 уровня, апгрейд за кредиты.
import { ref, computed, onMounted, watch } from 'vue'
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
  syncProfile,
} from '../store.js'
import { tanksOfNation, premiumOfNation, MODULE_DEFS, moduleCost, modsMaxedCount, STAT_LABELS, combatStats, statReal } from '../game/meta.js'
import { apiBuy } from '../api.js'
import { track } from '../analytics.js'
import { t as tr } from '../i18n.js' // алиас: `t` занят как переменная-танк в шаблоне/скрипте
import TankImg from './ui/TankImg.vue'
import StatRow from './ui/StatRow.vue'
import CurrencyBar from './ui/CurrencyBar.vue'
import NationSwitch from './ui/NationSwitch.vue'
import BottomNav from './ui/BottomNav.vue'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['go'])

const tanks = computed(() => tanksOfNation(profile.nation))
const premiums = computed(() => premiumOfNation(profile.nation)) // прем-техника нации (за ⭐)
const premSel = ref(null) // развёрнутый ТТХ прем-танка (тап по строке)
// ТТХ прем-танка (базовые статы 0..10 для оценки ДО покупки)
const premStats = (t) => {
  const cs = combatStats(t) // реальные боевые числа (крупные) для ТТХ
  return Object.entries(t.stats).map(([k, v]) => ({ key: k, label: STAT_LABELS[k] || k, value: v, display: statReal(cs, k) }))
}

// выбрать уже купленный прем-танк → в ангар
function pickPrem(t) {
  selectTank(t.id)
  emit('go', 'hangar')
}
// покупка прем-танка за ⭐ (как в Shop: invoice → openInvoice → sync). dev — мгновенно.
async function buyPrem(t) {
  track('prem_tank_buy_started', { tank_id: t.id, tier: t.tier })
  try {
    const r = await apiBuy('pt_' + t.id)
    if (r.granted) {
      await syncProfile()
      selectTank(t.id)
      track('prem_tank_bought', { tank_id: t.id, dev: !!r.dev })
    } else if (r.link && window.Telegram?.WebApp?.openInvoice) {
      window.Telegram.WebApp.openInvoice(r.link, (status) => {
        if (status === 'paid')
          setTimeout(async () => {
            await syncProfile()
            selectTank(t.id)
            track('prem_tank_bought', { tank_id: t.id, dev: false })
          }, 1200)
      })
    } else {
      shake()
    }
  } catch {
    track('prem_tank_buy_failed', { tank_id: t.id })
    shake()
  }
}
// пришли из ангара по «ОТКРЫТЬ ТАНК» (выбран закрытый) → сразу раскрываем его
// чеклист; иначе обычный просмотр ветки без выбора
const sel = ref(profile.selectedTank && !isOwned(profile.selectedTank) ? profile.selectedTank : null)
const modTab = ref('gun')
const flash = ref(false)
const selected = computed(() => tanks.value.find((t) => t.id === sel.value))
const mod = computed(() => MODULE_DEFS.find((m) => m.id === modTab.value))
const fmt = (n) => (n || 0).toLocaleString('ru-RU')
const maxedCount = (tankId) => modsMaxedCount(profile.modules, tankId)

// чеклист разблокировки выбранной (некупленной) машины: каждое условие со ✓/✗.
// Заменяет «серую кнопку без объяснения» — игрок видит, что выполнено и что нет.
const checklist = computed(() => {
  const tk = selected.value
  if (!tk || isOwned(tk.id)) return []
  const prev = prevTank(tk)
  const rows = []
  if (prev) {
    rows.push({ done: isOwned(prev.id), label: tr('tree.checkResearch', { name: prev.name }) })
    const maxed = Math.min(5, maxedCount(prev.id))
    rows.push({ done: maxed >= 5, label: tr('tree.checkTopModules', { name: prev.name }), value: `${maxed}/5` })
  }
  rows.push({ done: profile.credits >= (tk.cost || 0), label: tr('tree.checkCredits'), value: `${fmt(profile.credits)} / ${fmt(tk.cost || 0)}` })
  return rows
})
// шаг, к которому ведёт кнопка «→»: пред. танк (открыть его) либо его модули
const gotoStep = computed(() => {
  const tk = selected.value
  if (!tk || isOwned(tk.id)) return null
  const prev = prevTank(tk)
  if (!prev) return null
  if (!isOwned(prev.id)) return { id: prev.id, label: tr('tree.stepUnlock', { name: prev.name }) }
  if (maxedCount(prev.id) < 5) return { id: prev.id, label: tr('tree.stepModules', { name: prev.name }) }
  return null
})
// перейти к пред. танку: раскрыть его док (там либо его модули, либо его чеклист)
function goToStep(id) {
  track('unlock_goto_step_clicked', {
    step_tank_id: id,
    from_tank_id: selected.value?.id || null,
  })
  sel.value = id
  modTab.value = 'gun'
}

function pickNation(n) {
  sel.value = null
  setNation(n)
}
function toggle(t) {
  track('tank_node_selected', {
    tank_id: t.id,
    tank_tier: t.tier,
    tank_class: t.cls,
    owned: isOwned(t.id),
    can_unlock: canUnlock(t),
    unlock_reason: unlockReason(t),
  })
  sel.value = sel.value === t.id ? null : t.id
  modTab.value = 'gun'
}
function shake() {
  flash.value = true
  setTimeout(() => (flash.value = false), 600)
}
async function research(t) {
  track('research_clicked', {
    tank_id: t.id,
    tank_tier: t.tier,
    can_unlock: canUnlock(t),
    unlock_reason: unlockReason(t),
    credits: profile.credits,
    cost: t.cost || 0,
  })
  if (await buyTank(t)) {
    track('tank_unlocked', {
      tank_id: t.id,
      tank_tier: t.tier,
      cost: t.cost || 0,
      credits_after: profile.credits,
    })
    selectTank(t.id)
  } else {
    shake()
  }
}
async function buyModule(modId) {
  const before = tankModLevel(sel.value, modId)
  track('module_upgrade_clicked', {
    tank_id: sel.value,
    module: modId,
    level_before: before,
    credits: profile.credits,
  })
  if (await upgradeModule(sel.value, modId)) {
    track('module_upgraded', {
      tank_id: sel.value,
      module: modId,
      level_before: before,
      level_after: tankModLevel(sel.value, modId),
      credits_after: profile.credits,
    })
  } else {
    shake()
  }
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

onMounted(() => {
  track('tree_viewed', {
    selected_tank: profile.selectedTank,
    owned_tanks_count: profile.owned?.length || 0,
    credits: profile.credits || 0,
  })
})
// раскрыли чеклист некупленной машины — что нужно для исследования
watch(selected, (t) => {
  if (!t || isOwned(t.id)) return
  const prev = prevTank(t)
  track('unlock_checklist_viewed', {
    tank_id: t.id,
    tank_tier: t.tier,
    prev_owned: prev ? isOwned(prev.id) : true,
    top_modules_done: prev ? maxedCount(prev.id) : null,
    credits_enough: profile.credits >= (t.cost || 0),
    unlock_reason: unlockReason(t),
  })
})
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.88), rgba(13, 15, 10, 0.94)), url('/sprites/bg_tree.png') center / cover no-repeat">
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px">
      <div class="pz-display" style="font-size: 17px">{{ tr('tree.title') }}</div>
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
              <span style="font-size: 11px; color: var(--ink-dim); font-weight: 500">{{ tr('tree.classTier', { cls: tr('game.classes.' + t.classId), tier: t.tier }) }}</span>
            </div>
            <div style="font-size: 11px; color: var(--ink-faint); margin-top: 2px; font-weight: 500; display: flex; align-items: center; gap: 6px">
              <template v-if="isOwned(t.id)">
                <span style="display: flex; gap: 3px">
                  <span v-for="m in MODULE_DEFS" :key="m.id" class="diamond" :style="{ background: diamondColor(t.id, m.id) }"></span>
                </span>
                {{ tr('tree.topModules', { n: maxedCount(t.id), total: MODULE_DEFS.length }) }}
              </template>
              <template v-else-if="canUnlock(t)">{{ tr('tree.available') }}</template>
              <template v-else>{{ unlockReason(t) }}</template>
            </div>
          </div>

          <div v-if="!isOwned(t.id)" class="pz-chip" :style="{ color: canUnlock(t) ? 'var(--amber)' : 'var(--ink-faint)' }">
            <PzIcon name="coin" :size="13" /> {{ fmt(t.cost) }}
          </div>
        </button>
      </div>

      <!-- ===== премиум-техника (покупка за ⭐, не исследуется) ===== -->
      <div v-if="premiums.length" class="prem-sec">
        <div class="prem-head pz-pixel">{{ tr('tree.premHead') }}</div>
        <div
          v-for="t in premiums"
          :key="t.id"
          class="pz-plate prem-card"
          :style="{ borderColor: isOwned(t.id) ? 'rgba(242,165,12,.5)' : 'var(--line-strong)' }"
        >
          <div class="prem-node" @click="premSel = premSel === t.id ? null : t.id">
            <TankImg :tank-id="t.id" :size="40" :style="{ filter: isOwned(t.id) ? 'none' : 'grayscale(0.9) brightness(0.55)', flexShrink: 0 }" />
            <div style="flex: 1; min-width: 0; text-align: left">
              <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap">
                <span class="pz-display" style="font-size: 15px">{{ t.name }}</span>
                <span v-if="t.legend" class="legend-tag pz-pixel">{{ tr('tree.legend') }}</span>
                <span class="pz-pixel" style="font-size: 7px; color: var(--ink-faint)">{{ tr('tree.spec') }} {{ premSel === t.id ? '▾' : '▸' }}</span>
              </div>
              <div style="font-size: 10.5px; color: var(--ink-faint); margin-top: 2px; font-weight: 500">{{ tr('tree.premPerk', { cls: tr('game.classes.' + t.classId), tier: t.tier }) }}</div>
            </div>
            <button v-if="isOwned(t.id)" class="prem-act owned" @click.stop="pickPrem(t)">{{ tr('tree.inGarage') }}</button>
            <button v-else class="prem-act prem-buy" @click.stop="buyPrem(t)">★ {{ t.stars }}</button>
          </div>
          <!-- ТТХ прем-танка (тап по строке): оценить ДО покупки -->
          <div v-if="premSel === t.id" class="prem-ttx">
            <StatRow v-for="s in premStats(t)" :key="s.key" :label="s.label" :value="s.value" :display="s.display" />
            <div class="prem-desc">{{ t.desc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== док выбранной машины ===== -->
    <div v-if="selected" :key="selected.id" class="pz-plate dock">
      <button class="dock-close" :aria-label="tr('common.close')" :title="tr('common.close')" @click="sel = null">✕</button>
      <div style="display: flex; gap: 12px; align-items: center; padding-right: 28px">
        <TankImg :tank-id="selected.id" :size="48" :style="{ filter: isOwned(selected.id) ? 'none' : 'grayscale(0.9) brightness(0.6)', flexShrink: 0 }" />
        <div style="flex: 1">
          <div class="pz-display" style="font-size: 16px">{{ selected.name }}</div>
          <div style="font-size: 11.5px; color: var(--ink-dim); line-height: 1.4; margin-top: 2px">
            {{ isOwned(selected.id) ? tr('tree.ownedHint') : selected.desc }}
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
              {{ li + 1 === tankModLevel(selected.id, mod.id) ? tr('tree.installed') : '✓' }}
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
            <span v-else class="pz-chip" style="color: var(--ink-faint); font-size: 10.5px"><PzIcon name="lock" :size="10" /> {{ tr('tree.locked') }}</span>
          </div>
        </div>

        <button class="pz-btn2" @click="pickInHangar">{{ tr('tree.pickInHangar') }}</button>
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
          <template v-if="!canUnlock(selected)">{{ tr('tree.meetConditions') }}</template>
          <template v-else-if="profile.credits < selected.cost">{{ tr('tree.need') }} <PzIcon name="coin" :size="15" /> {{ fmt(selected.cost) }}</template>
          <template v-else>{{ tr('tree.research', { cost: fmt(selected.cost) }) }}</template>
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
  position: relative;
  margin: 0 14px 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: pz-slide-up 0.25s ease;
}
.dock-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.4);
  color: var(--ink-dim);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}
.dock-close:active {
  background: rgba(0, 0, 0, 0.6);
  color: var(--ink);
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
.prem-sec {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.prem-head {
  font-size: 8px;
  letter-spacing: 0.16em;
  color: var(--amber);
  opacity: 0.85;
  padding-left: 2px;
}
.prem-card {
  padding: 0;
  overflow: hidden;
  background: linear-gradient(90deg, rgba(242, 165, 12, 0.06), rgba(0, 0, 0, 0.3));
}
.prem-node {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  color: var(--ink);
  font-family: var(--font-body);
}
.legend-tag {
  font-size: 7px;
  letter-spacing: 0.1em;
  color: #1d1604;
  background: var(--amber);
  border-radius: 5px;
  padding: 2px 5px 1px;
}
.prem-act {
  flex-shrink: 0;
  border: none;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 700;
  padding: 6px 11px;
  border-radius: 7px;
}
.prem-buy {
  color: #1d1604;
  background: linear-gradient(180deg, var(--amber-hi, #ffce5a), var(--amber));
  font-weight: 800;
}
.prem-act.owned {
  color: #7cc05a;
  background: rgba(124, 192, 90, 0.14);
}
.prem-ttx {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 14px 12px;
  border-top: 1px solid var(--line);
  animation: pz-slide-up 0.2s ease;
}
.prem-desc {
  font-size: 11px;
  color: var(--ink-dim);
  line-height: 1.4;
  margin-top: 2px;
}
</style>
