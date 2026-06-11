<script setup>
// Поиск боя: НАСТОЯЩИЙ онлайн через WS (живые игроки, добор ботами на
// сервере по дедлайну). Сервер недоступен — офлайн-бой с ботами, как раньше.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { profile, loadoutStats } from '../store.js'
import { TANK_BY_ID, FRIENDS, MAX_TIER, SKIN_BY_ID } from '../game/meta.js'
import { MAP_BY_ID, MAPS } from '../game/maps.js'
import { connectMatch } from '../game/net.js'
import TankTopDown from './ui/TankTopDown.vue'
import PzIcon from './ui/PzIcon.vue'

const props = defineProps({
  mapId: { type: String, default: '' }, // жребий для офлайна
  side: { type: Number, default: 0 },
})
const emit = defineEmits(['battle', 'cancel'])

const TEAM = 7
const OFFLINE_SEARCH_MS = 5200 // офлайн: сколько «ищем», прежде чем добрать ИИ

const MM_BOTS = ['ст. сержант Ефимов', 'ефрейтор Козлов', 'мл. сержант Орлов', 'рядовой Багиров', 'сержант Чистяков', 'рядовой Тёркин', 'ефрейтор Махов']

const secs = ref(0)
const allies = ref([]) // { name, kind: 'party'|'player'|'bot', ping? }
const phase = ref('search') // search → fill → go
const online = ref(null) // null — пробуем, true/false — режим определён
const botsEtaOnline = ref(Math.ceil(6000 / 1000))

const map = computed(() => MAP_BY_ID[props.mapId] || MAPS[0])
const tankName = computed(() => (TANK_BY_ID[profile.selectedTank] || {}).name || '')
const tierRange = computed(() => {
  const t = (TANK_BY_ID[profile.selectedTank] || {}).tier || 1
  return `${Math.max(1, t - 1)}–${Math.min(MAX_TIER, t + 1)}`
})
const slots = computed(() => [...Array(TEAM)].map((_, i) => (i === 0 ? { name: profile.name || 'ВЫ', kind: 'you' } : allies.value[i - 1] || null)))
const liveTotal = computed(() => 1 + allies.value.filter((a) => a.kind !== 'bot').length)
const botTotal = computed(() => allies.value.filter((a) => a.kind === 'bot').length)
const botsEta = computed(() =>
  online.value ? botsEtaOnline.value : Math.max(0, Math.ceil(OFFLINE_SEARCH_MS / 1000 - secs.value)),
)
const mmss = computed(() => `${Math.floor(secs.value / 60)}:${String(secs.value % 60).padStart(2, '0')}`)

const timers = []
let tick = null
let client = null
let gone = false

// офлайн-фоллбэк: прежний «театр» поиска + локальный бой с ботами
function startOffline() {
  online.value = false
  const liveNames = ['Kolyan_T34', 'дед_максим', 'Shtorm_88']
  const liveCount = 1 + Math.floor(Math.random() * 2)
  liveNames.slice(0, liveCount).forEach((name, i) =>
    timers.push(
      setTimeout(() => {
        if (allies.value.length + 1 < TEAM) allies.value.push({ name, kind: 'player', ping: 30 + Math.round(Math.random() * 40) })
      }, 1400 + i * 1600 + Math.random() * 600),
    ),
  )
  timers.push(
    setTimeout(() => {
      phase.value = 'fill'
      const need = TEAM - 1 - allies.value.length
      MM_BOTS.slice(0, Math.max(0, need)).forEach((n) => allies.value.push({ name: n, kind: 'bot' }))
    }, OFFLINE_SEARCH_MS),
  )
  timers.push(setTimeout(() => (phase.value = 'go'), OFFLINE_SEARCH_MS + 1300))
  timers.push(setTimeout(() => !gone && ((gone = true), emit('battle', null)), OFFLINE_SEARCH_MS + 2100))
}

onMounted(async () => {
  tick = setInterval(() => secs.value++, 1000)

  // взвод — мгновенно (визуально; в онлайне взвод пока соло)
  profile.party.forEach((id, i) => {
    const name = (FRIENDS.find((f) => f.id === id) || {}).name || String(id)
    timers.push(setTimeout(() => allies.value.push({ name, kind: 'party' }), 300 + i * 250))
  })

  try {
    client = await connectMatch({
      name: profile.name,
      tankId: profile.selectedTank,
      tint: (SKIN_BY_ID[profile.skin] || {}).tint || 0xffffff,
      skin: profile.skin,
      stats: JSON.parse(JSON.stringify(loadoutStats(profile.selectedTank))),
      onLobby: (msg) => {
        // живые игроки комнаты (кроме нас) + таймер добора ботов
        allies.value = msg.players
          .filter((p) => p.id !== msg.you)
          .map((p) => ({ name: p.name, kind: 'player' }))
        botsEtaOnline.value = Math.max(0, Math.ceil(msg.startsIn / 1000))
      },
      onStart: (msg) => {
        phase.value = 'go'
        const need = TEAM - 1 - allies.value.length
        MM_BOTS.slice(0, Math.max(0, need)).forEach((n) => allies.value.push({ name: n, kind: 'bot' }))
        timers.push(
          setTimeout(() => {
            if (gone) return
            gone = true
            emit('battle', {
              client,
              mapId: msg.mapId,
              side: msg.youTeam,
              youUnit: msg.youUnit,
              tickHz: msg.tickHz,
            })
          }, 900),
        )
      },
      onClose: () => {
        // сервер оборвал до старта — уходим в офлайн
        if (!gone && online.value && phase.value !== 'go') startOffline()
      },
    })
    online.value = true
  } catch {
    startOffline()
  }
})
onUnmounted(() => {
  clearInterval(tick)
  timers.forEach(clearTimeout)
  // бой не начался — соединение никому не нужно
  if (!gone && client) client.close()
})

function cancel() {
  if (client) client.close()
  emit('cancel')
}

const blipColor = (a) => (a.kind === 'bot' ? 'var(--ink-faint)' : a.kind === 'party' ? 'var(--blue)' : 'var(--green)')
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.82), rgba(13, 15, 10, 0.92)), url('/sprites/bg_mm.png') center / cover no-repeat">
    <!-- шапка -->
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 0">
      <div class="pz-display" style="font-size: 17px">{{ phase === 'go' ? 'БОЙ НАЙДЕН' : 'ПОИСК БОЯ' }}</div>
      <span class="pz-chip" style="color: var(--ink-dim)">
        <span
          v-if="online !== null"
          class="pz-pixel"
          style="font-size: 7px; margin-right: 4px"
          :style="{ color: online ? 'var(--green)' : 'var(--ink-faint)' }"
        >{{ online ? 'ОНЛАЙН' : 'ОФЛАЙН' }}</span>
        <span class="pz-pixel" style="font-size: 9px" :style="{ color: phase === 'go' ? 'var(--green)' : 'var(--amber)' }">{{ mmss }}</span>
      </span>
    </div>
    <div style="font-size: 11.5px; color: var(--ink-dim); font-weight: 500; padding: 4px 14px 0">
      {{ tankName }} · бой 7×7 · уровни {{ tierRange }}
    </div>
    <!-- жребий офлайна; в онлайне карту и сторону объявит сервер -->
    <div v-if="online === false" style="font-size: 11.5px; font-weight: 500; padding: 2px 14px 0; display: flex; align-items: center; gap: 6px">
      <span class="pz-display" style="font-size: 12px; color: var(--ink)">{{ map.name }}</span>
      <span style="color: var(--ink-faint)">· {{ map.desc }} · вы за</span>
      <span class="pz-display" style="font-size: 11px" :style="{ color: side === 1 ? 'var(--red)' : 'var(--blue)' }">{{ side === 1 ? 'КРАСНЫХ' : 'СИНИХ' }}</span>
    </div>
    <div v-else style="font-size: 11.5px; font-weight: 500; padding: 2px 14px 0; color: var(--ink-faint)">
      карту и сторону объявит штаб при развёртывании
    </div>

    <!-- радар -->
    <div style="display: flex; justify-content: center; padding: 18px 0 6px">
      <div style="position: relative; width: 132px; height: 132px">
        <div style="position: absolute; inset: 0; border-radius: 50%; border: 1px solid var(--line-strong)"></div>
        <div style="position: absolute; inset: 22px; border-radius: 50%; border: 1px dashed var(--line)"></div>
        <div
          style="position: absolute; inset: 0; border-radius: 50%; overflow: hidden; background: conic-gradient(from 0deg, rgba(242, 165, 12, 0.2) 0deg, transparent 80deg)"
          :style="{ animation: phase === 'go' ? 'none' : 'pz-radar-sweep 1.8s linear infinite' }"
        ></div>
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
            <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--green)"></span>живой
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
      <button v-else class="pz-btn2" style="width: 100%" @click="cancel">Отменить поиск</button>
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
