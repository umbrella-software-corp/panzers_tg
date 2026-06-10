<script setup>
// Поиск боя (порт MatchmakingScreen): радар, честный поиск «живых» (фейк),
// добор ботов по дедлайну, развёртывание → бой. Отмена возвращает в ангар.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { profile } from '../store.js'
import { TANK_BY_ID, FRIENDS, MAX_TIER } from '../game/meta.js'
import TankTopDown from './ui/TankTopDown.vue'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['battle', 'cancel'])

const TEAM = 7
const SEARCH_MS = 5200 // сколько «честно ждём живых»

const MM_PLAYERS = [
  { name: 'Kolyan_T34', ping: 32 },
  { name: 'дед_максим', ping: 58 },
  { name: 'Shtorm_88', ping: 41 },
]
const MM_BOTS = ['ст. сержант Ефимов', 'ефрейтор Козлов', 'мл. сержант Орлов', 'рядовой Багиров', 'сержант Чистяков', 'рядовой Тёркин', 'ефрейтор Махов']

const secs = ref(0)
const allies = ref([]) // { name, kind: 'party'|'player'|'bot', ping? }
const phase = ref('search') // search → fill → go

const tankName = computed(() => (TANK_BY_ID[profile.selectedTank] || {}).name || '')
const tierRange = computed(() => {
  const t = (TANK_BY_ID[profile.selectedTank] || {}).tier || 1
  return `${Math.max(1, t - 1)}–${Math.min(MAX_TIER, t + 1)}`
})
const slots = computed(() => [...Array(TEAM)].map((_, i) => (i === 0 ? { name: 'ВЫ', kind: 'you' } : allies.value[i - 1] || null)))
const liveTotal = computed(() => 1 + allies.value.filter((a) => a.kind !== 'bot').length)
const botTotal = computed(() => allies.value.filter((a) => a.kind === 'bot').length)
const botsEta = computed(() => Math.max(0, Math.ceil(SEARCH_MS / 1000 - secs.value)))
const mmss = computed(() => `${Math.floor(secs.value / 60)}:${String(secs.value % 60).padStart(2, '0')}`)

const timers = []
let tick = null
onMounted(() => {
  tick = setInterval(() => secs.value++, 1000)

  // взвод присоединяется мгновенно (в party — id друзей)
  profile.party.forEach((id, i) => {
    const name = (FRIENDS.find((f) => f.id === id) || {}).name || String(id)
    timers.push(setTimeout(() => allies.value.push({ name, kind: 'party' }), 300 + i * 250))
  })

  // «живые» подтягиваются по одному
  const liveCount = 1 + Math.floor(Math.random() * 2) // 1-2 живых
  MM_PLAYERS.slice(0, liveCount).forEach((p, i) =>
    timers.push(
      setTimeout(() => {
        if (allies.value.length + 1 < TEAM) allies.value.push({ ...p, kind: 'player' })
      }, 1400 + i * 1600 + Math.random() * 600),
    ),
  )

  // дедлайн: добор ботов
  timers.push(
    setTimeout(() => {
      phase.value = 'fill'
      const need = TEAM - 1 - allies.value.length
      MM_BOTS.slice(0, Math.max(0, need)).forEach((n) => allies.value.push({ name: n, kind: 'bot' }))
    }, SEARCH_MS),
  )

  // развёртывание → бой
  timers.push(setTimeout(() => (phase.value = 'go'), SEARCH_MS + 1300))
  timers.push(setTimeout(() => emit('battle'), SEARCH_MS + 2100))
})
onUnmounted(() => {
  clearInterval(tick)
  timers.forEach(clearTimeout)
})

const blipColor = (a) => (a.kind === 'bot' ? 'var(--ink-faint)' : a.kind === 'party' ? 'var(--blue)' : 'var(--green)')
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.82), rgba(13, 15, 10, 0.92)), url('/sprites/bg_mm.png') center / cover no-repeat">
    <!-- шапка -->
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 0">
      <div class="pz-display" style="font-size: 17px">{{ phase === 'go' ? 'БОЙ НАЙДЕН' : 'ПОИСК БОЯ' }}</div>
      <span class="pz-chip" style="color: var(--ink-dim)">
        <span class="pz-pixel" style="font-size: 9px" :style="{ color: phase === 'go' ? 'var(--green)' : 'var(--amber)' }">{{ mmss }}</span>
      </span>
    </div>
    <div style="font-size: 11.5px; color: var(--ink-dim); font-weight: 500; padding: 4px 14px 0">{{ tankName }} · бой 7×7 · уровни {{ tierRange }} · сектор Б-4</div>

    <!-- радар -->
    <div style="display: flex; justify-content: center; padding: 18px 0 6px">
      <div style="position: relative; width: 132px; height: 132px">
        <div style="position: absolute; inset: 0; border-radius: 50%; border: 1px solid var(--line-strong)"></div>
        <div style="position: absolute; inset: 22px; border-radius: 50%; border: 1px dashed var(--line)"></div>
        <div
          style="position: absolute; inset: 0; border-radius: 50%; overflow: hidden; background: conic-gradient(from 0deg, rgba(242, 165, 12, 0.2) 0deg, transparent 80deg)"
          :style="{ animation: phase === 'go' ? 'none' : 'pz-radar-sweep 1.8s linear infinite' }"
        ></div>
        <!-- отметки найденных -->
        <span
          v-for="(a, i) in allies"
          :key="i"
          style="position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; animation: pz-pop 0.3s ease"
          :style="{
            left: 50 + 34 * Math.cos(i * 2.4 + 1) + '%',
            top: 50 + 34 * Math.sin(i * 2.4 + 1) + '%',
            background: blipColor(a),
          }"
        ></span>
        <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center">
          <TankTopDown :size="36" color="var(--amber)" dark="#3d3110" />
        </div>
      </div>
    </div>

    <!-- статус -->
    <div
      class="pz-display"
      style="text-align: center; font-size: 12px; letter-spacing: 0.18em; padding: 0 14px 10px"
      :style="{ color: phase === 'go' ? 'var(--green)' : 'var(--ink-dim)', animation: phase === 'go' ? 'none' : 'pz-blink 1.2s linear infinite' }"
    >
      {{ phase === 'search' ? 'ИЩЕМ ЖИВЫХ ИГРОКОВ…' : phase === 'fill' ? 'ДОБИРАЕМ ЭКИПАЖИ ИИ' : 'РАЗВЁРТЫВАНИЕ' }}
    </div>

    <!-- команда -->
    <div style="padding: 0 14px; display: flex; flex-direction: column; gap: 6px; flex: 1">
      <div class="pz-stencil-h">ВАША КОМАНДА · {{ 1 + allies.length }}/{{ TEAM }}</div>
      <div
        v-for="(s, i) in slots"
        :key="i"
        class="slot"
        :style="{
          background: s ? (s.kind === 'you' ? 'rgba(242,165,12,.06)' : 'rgba(0,0,0,.35)') : 'transparent',
          border: s ? '1px solid ' + (s.kind === 'you' ? 'rgba(242,165,12,.4)' : 'var(--line)') : '1.5px dashed var(--line)',
          animation: s && s.kind !== 'you' ? 'pz-slide-up .3s ease' : 'none',
          opacity: s && s.kind === 'bot' ? 0.75 : 1,
        }"
      >
        <template v-if="s">
          <span style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0" :style="{ background: s.kind === 'you' ? 'var(--amber)' : blipColor(s) }"></span>
          <span style="flex: 1; font-size: 13px; font-weight: 600" :style="{ color: s.kind === 'bot' ? 'var(--ink-dim)' : 'var(--ink)' }">{{ s.name }}</span>
          <span v-if="s.kind === 'you'" class="pz-chip" style="color: var(--amber); font-size: 10px"><PzIcon name="star" :size="9" color="var(--amber)" /> вы</span>
          <span v-else-if="s.kind === 'party'" class="pz-chip" style="color: var(--blue); font-size: 10px">взвод</span>
          <span v-else-if="s.kind === 'player'" class="pz-chip" style="color: var(--green); font-size: 10px">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--green)"></span>{{ s.ping }} мс
          </span>
          <span v-else class="pz-chip" style="color: var(--ink-faint); font-size: 10px">БОТ</span>
        </template>
        <span v-else style="flex: 1; font-size: 11.5px; color: var(--ink-faint); font-weight: 500; display: flex; align-items: center; gap: 8px">
          <span style="width: 8px; height: 8px; border-radius: 50%; border: 1.5px dashed var(--ink-faint); flex-shrink: 0"></span>
          {{ phase === 'search' ? 'поиск…' : '—' }}
        </span>
      </div>
      <div style="font-size: 10.5px; color: var(--ink-faint); font-weight: 500; text-align: center; margin-top: 2px">
        живых: {{ liveTotal }} · ботов: {{ botTotal }}<template v-if="phase === 'search'"> · боты добавятся через {{ botsEta }} с</template>
      </div>
    </div>

    <!-- отмена / в бой -->
    <div style="padding: 8px 14px 18px">
      <div v-if="phase === 'go'" class="pz-display" style="text-align: center; font-size: 15px; letter-spacing: 0.12em; color: var(--green); padding: 12px 0; animation: pz-pop 0.3s ease">▸ В БОЙ</div>
      <button v-else class="pz-btn2" style="width: 100%" @click="emit('cancel')">Отменить поиск</button>
    </div>
  </div>
</template>

<style scoped>
.slot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
}
</style>
