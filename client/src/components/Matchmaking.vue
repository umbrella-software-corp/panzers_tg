<script setup>
// Поиск боя: НАСТОЯЩИЙ онлайн через WS (живые игроки, добор ботами на
// сервере по дедлайну). Сервер недоступен — офлайн-бой с ботами, как раньше.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { profile, loadoutStats, party } from '../store.js'
import { TANK_BY_ID, MAX_TIER, SKIN_BY_ID, rankByBattles } from '../game/meta.js'
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
const teamSize = ref(TEAM)
const myTeam = ref([]) // живые союзники на МОЕЙ стороне (без меня)
const foeTeam = ref([]) // живые враги на стороне противника
const phase = ref('search') // search → fill → go
const online = ref(null) // null — пробуем, true/false — режим определён
const botsEtaOnline = ref(6)

const map = computed(() => MAP_BY_ID[props.mapId] || MAPS[0])
const tankName = computed(() => (TANK_BY_ID[profile.selectedTank] || {}).name || '')
const tierRange = computed(() => {
  const t = (TANK_BY_ID[profile.selectedTank] || {}).tier || 1
  return `${Math.max(1, t - 1)}–${Math.min(MAX_TIER, t + 1)}`
})
const modeLabel = computed(() => (profile.battleMode === 'annihilation' ? 'НА УНИЧТОЖЕНИЕ' : 'ЗАХВАТ ТОЧЕК'))

const liveTotal = computed(() => 1 + myTeam.value.length + foeTeam.value.length) // живых из 14
const botTotal = computed(() => Math.max(0, teamSize.value * 2 - liveTotal.value)) // ботов добьём
const allLive = computed(() => liveTotal.value >= teamSize.value * 2) // все 14 живые → ботов нет
// слоты команды: я (своя) + живые, пустое добиваем ботом (в фазе поиска — «поиск…»)
function teamSlots(live, withMe) {
  const out = withMe ? [{ name: profile.name || 'ВЫ', kind: 'you' }] : []
  for (const p of live) out.push(p)
  let bi = withMe ? 0 : 3
  while (out.length < teamSize.value) out.push(phase.value === 'search' ? null : { name: MM_BOTS[bi++ % MM_BOTS.length], kind: 'bot' })
  return out.slice(0, teamSize.value)
}
const mySlots = computed(() => teamSlots(myTeam.value, true))
const foeSlots = computed(() => teamSlots(foeTeam.value, false))
const blips = computed(() => [...myTeam.value, ...foeTeam.value]) // живые на радаре
const slotName = (s) => (!s ? (phase.value === 'search' ? 'поиск…' : '—') : s.kind === 'you' ? profile.name || 'ВЫ' : s.name)
const slotDot = (s) => (!s ? 'transparent' : s.kind === 'you' ? 'var(--amber)' : s.kind === 'bot' ? 'var(--ink-faint)' : 'var(--green)')

const botsEta = computed(() =>
  online.value ? botsEtaOnline.value : Math.max(0, Math.ceil(OFFLINE_SEARCH_MS / 1000 - secs.value)),
)
const mmss = computed(() => `${Math.floor(secs.value / 60)}:${String(secs.value % 60).padStart(2, '0')}`)

const timers = []
let tick = null
let client = null
let gone = false

// офлайн-фоллбэк: «театр» поиска + локальный бой с ботами (враги — боты, в твою
// команду пара «живых соседей» для антуража; пустое добьётся ботами через слоты)
function startOffline() {
  online.value = false
  const liveNames = ['Kolyan_T34', 'дед_максим']
  const liveCount = Math.floor(Math.random() * 2) // 0–1 живых союзника
  liveNames.slice(0, liveCount).forEach((name, i) =>
    timers.push(
      setTimeout(() => {
        if (myTeam.value.length + 1 < teamSize.value) myTeam.value.push({ name, kind: 'player', ping: 30 + Math.round(Math.random() * 40) })
      }, 1400 + i * 1600 + Math.random() * 600),
    ),
  )
  timers.push(setTimeout(() => (phase.value = 'fill'), OFFLINE_SEARCH_MS))
  timers.push(setTimeout(() => (phase.value = 'go'), OFFLINE_SEARCH_MS + 1300))
  timers.push(setTimeout(() => !gone && ((gone = true), emit('battle', null)), OFFLINE_SEARCH_MS + 2100))
}

onMounted(async () => {
  tick = setInterval(() => secs.value++, 1000)

  // напарников взвода больше НЕ подставляем фейково — они приходят живыми из
  // серверного лобби (onLobby) той же комнаты, в которую группирует party-токен

  try {
    client = await connectMatch({
      name: profile.name,
      tankId: profile.selectedTank,
      tint: (SKIN_BY_ID[profile.skin] || {}).tint || 0xffffff,
      skin: profile.skin,
      battles: profile.stats.battles,
      party: party.token, // взвод: одинаковый токен → одна комната на сервере
      mode: profile.battleMode, // режим боя → сервер ищет комнату того же режима
      stats: JSON.parse(JSON.stringify(loadoutStats(profile.selectedTank))),
      onLobby: (msg) => {
        // живые игроки на РЕАЛЬНЫХ сторонах (сервер раздаёт команды уже в лобби) —
        // твой отряд и противник; пустые слоты добьются ботами (все живые → ботов нет)
        teamSize.value = msg.teamSize || TEAM
        const ally = (p) => ({ name: p.name, kind: 'player', battles: p.battles })
        myTeam.value = msg.players.filter((p) => p.team === msg.yourTeam && p.id !== msg.you).map(ally)
        foeTeam.value = msg.players.filter((p) => p.team !== msg.yourTeam).map(ally)
        botsEtaOnline.value = Math.max(0, Math.ceil(msg.startsIn / 1000))
      },
      onStart: (msg) => {
        phase.value = 'go' // боты добиваются автоматически через teamSlots (фаза не search)
        // НЕ входим в бой, пока не пришёл первый снапшот мира от сервера. Иначе бой
        // грузился, висел на 0:00 без связи и пересобирался офлайн — «двойная
        // загрузка» и смена стороны. Ждём мир ДО входа: один бой, в верном режиме.
        const deadline = Date.now() + 4000
        const enter = () => {
          if (gone) return
          if (client && client.stateN >= 1 && client.ws.readyState === 1) {
            gone = true
            emit('battle', { client, mapId: msg.mapId, side: msg.youTeam, youUnit: msg.youUnit, tickHz: msg.tickHz, mode: msg.mode })
          } else if (Date.now() >= deadline) {
            // сервер так и не прислал мир — честный офлайн с ботами (один бой, без отката)
            gone = true
            if (client) client.close()
            emit('battle', null)
          } else {
            timers.push(setTimeout(enter, 120))
          }
        }
        timers.push(setTimeout(enter, 900)) // короткая пауза «БОЙ НАЙДЕН»
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
      <span class="pz-display" style="color: var(--amber); font-size: 10.5px; margin-left: 4px">· {{ modeLabel }}</span>
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
          v-for="(a, i) in blips"
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

    <!-- состав боя 7×7: твой отряд и противник; живые на сторонах, пустое — боты -->
    <div style="padding: 0 14px; flex: 1; display: flex; flex-direction: column">
      <div class="teams">
        <div class="team-col">
          <div class="pz-stencil-h ally-h">ВАШ ОТРЯД</div>
          <div v-for="(s, i) in mySlots" :key="'a' + i" class="mslot" :class="{ me: s && s.kind === 'you', bot: s && s.kind === 'bot', empty: !s }">
            <span class="mdot" :style="{ background: slotDot(s) }"></span>
            <span class="mname">{{ slotName(s) }}</span>
            <PzIcon v-if="s && s.kind === 'you'" name="star" :size="9" color="var(--amber)" />
          </div>
        </div>
        <div class="team-col">
          <div class="pz-stencil-h foe-h">ПРОТИВНИК</div>
          <div v-for="(s, i) in foeSlots" :key="'e' + i" class="mslot foe" :class="{ bot: s && s.kind === 'bot', empty: !s }">
            <span class="mdot" :style="{ background: s && s.kind === 'player' ? 'var(--red)' : slotDot(s) }"></span>
            <span class="mname">{{ slotName(s) }}</span>
          </div>
        </div>
      </div>
      <div class="live-summary">
        ЖИВЫХ <b :style="{ color: allLive ? 'var(--green)' : 'var(--amber)' }">{{ liveTotal }}/{{ teamSize * 2 }}</b>
        · {{ allLive ? 'все живые — без ботов!' : 'ботов добьём ' + botTotal }}<template v-if="phase === 'search'"> · через {{ botsEta }}с</template>
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
.teams {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  flex: 1;
  min-height: 0;
}
.team-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ally-h {
  color: var(--amber);
}
.foe-h {
  color: var(--red);
  text-align: right;
}
.mslot {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid var(--line);
  animation: pz-slide-up 0.3s ease;
}
.mslot.foe {
  flex-direction: row-reverse;
  text-align: right;
}
.mslot.me {
  background: rgba(242, 165, 12, 0.08);
  border-color: rgba(242, 165, 12, 0.4);
}
.mslot.bot {
  opacity: 0.62;
}
.mslot.empty {
  background: transparent;
  border-style: dashed;
  animation: none;
}
.mdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.mslot.empty .mdot {
  background: transparent;
  border: 1.5px dashed var(--ink-faint);
}
.mname {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mslot.bot .mname,
.mslot.empty .mname {
  color: var(--ink-faint);
  font-weight: 500;
}
.live-summary {
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-dim);
  padding: 10px 0 2px;
}
</style>
