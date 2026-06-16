<script setup>
// Поиск боя: НАСТОЯЩИЙ онлайн через WS (живые игроки, добор ботами на
// сервере по дедлайну). Сервер недоступен — офлайн-бой с ботами, как раньше.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { profile, loadoutStats, party } from '../store.js'
import { TANK_BY_ID, MAX_TIER, SKIN_BY_ID, rankByBattles } from '../game/meta.js'
import { MAP_BY_ID, MAPS } from '../game/maps.js'
import { connectMatch } from '../game/net.js'
import { apiOnline } from '../api.js'
import { tgUserId } from '../tg.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'
import TankTopDown from './ui/TankTopDown.vue'
import PzIcon from './ui/PzIcon.vue'

const props = defineProps({
  mapId: { type: String, default: '' }, // жребий для офлайна
  side: { type: Number, default: 0 },
  training: { type: Boolean, default: false }, // первый бой: отдельная комната соло + замороженные боты
})
const emit = defineEmits(['battle', 'cancel'])

const TEAM = 7

// заполнение слотов в экране подбора — реалистичные ники (как у живых игроков),
// без воинских званий: добитые слоты неотличимы от настоящих бойцов, зашедших в бой
const MM_FILLERS = t('matchmaking.fillers')

const secs = ref(0)
const teamSize = ref(TEAM)
const myTeam = ref([]) // живые союзники на МОЕЙ стороне (без меня)
const foeTeam = ref([]) // живые враги на стороне противника
const phase = ref('search') // search → fill → go
const online = ref(null) // null — пробуем, true/false — режим определён
const botsEtaOnline = ref(6)
// глобальный счётчик «N в сети» (/api/online) — соц-пруф во время поиска: видно, что
// есть с кем играть. Опрос раз в 30с (как на главной).
const onlineCount = ref(null)
let onlineTimer = null
async function refreshOnline() {
  try {
    onlineCount.value = (await apiOnline()).online
  } catch {}
}

const map = computed(() => MAP_BY_ID[props.mapId] || MAPS[0])
const tankName = computed(() => (TANK_BY_ID[profile.selectedTank] || {}).name || '')
const tierRange = computed(() => {
  const t = (TANK_BY_ID[profile.selectedTank] || {}).tier || 1
  return `${Math.max(1, t - 1)}–${Math.min(MAX_TIER, t + 1)}`
})
const modeLabel = computed(() => (profile.battleMode === 'annihilation' ? t('common.modeAnnihilation') : t('common.modeCapturePoints')))

const liveTotal = computed(() => 1 + myTeam.value.length + foeTeam.value.length) // живых из 14
const botTotal = computed(() => Math.max(0, teamSize.value * 2 - liveTotal.value)) // ботов добьём
const allLive = computed(() => liveTotal.value >= teamSize.value * 2) // все 14 живые → ботов нет
// счётчик «бойцов в сборе» для сводки: в поиске — сколько уже подключилось,
// при развёртывании — полный отряд (без деления на живых/ботов — это тэлл)
const filledCount = computed(() => (phase.value === 'search' ? liveTotal.value : teamSize.value * 2))
// слоты команды: я (своя) + живые игроки; пустое добиваем бойцами (в фазе поиска — «поиск…»).
// добитые слоты неотличимы от живых (kind: 'player') — игрок видит полный отряд людей, не «ботов».
function teamSlots(live, withMe) {
  const out = withMe ? [{ name: profile.name || t('matchmaking.youFallback'), kind: 'you' }] : []
  for (const p of live) out.push(p)
  let bi = withMe ? 0 : 9
  while (out.length < teamSize.value) out.push(phase.value === 'search' ? null : { name: MM_FILLERS[bi++ % MM_FILLERS.length], kind: 'player' })
  return out.slice(0, teamSize.value)
}
const mySlots = computed(() => teamSlots(myTeam.value, true))
const foeSlots = computed(() => teamSlots(foeTeam.value, false))
const blips = computed(() => [...myTeam.value, ...foeTeam.value]) // живые на радаре
const slotName = (s) => (!s ? (phase.value === 'search' ? t('matchmaking.searchingSlot') : '—') : s.kind === 'you' ? profile.name || t('matchmaking.youFallback') : s.name)
const slotDot = (s) => (!s ? 'transparent' : s.kind === 'you' ? 'var(--amber)' : s.kind === 'bot' ? 'var(--ink-faint)' : 'var(--green)')

const botsEta = computed(() => botsEtaOnline.value)
const mmss = computed(() => `${Math.floor(secs.value / 60)}:${String(secs.value % 60).padStart(2, '0')}`)

const timers = []
let tick = null
let client = null
let gone = false
let tries = 0
const MAX_TRIES = 4 // столько раз пробуем подключиться, потом — кнопки
const failed = ref(false) // сервер недоступен после всех попыток → Повторить/В ангар

// телеметрия поиска: сколько искали и видели ли лобби (для воронок Amplitude)
const searchStartedAt = performance.now()
let lobbyTracked = false
const searchMs = () => Math.round(performance.now() - searchStartedAt)

// онлайн-онли: НИКАКОГО офлайна. Параметры подключения к поиску боя.
function connectParams() {
  return {
    name: profile.name,
    tankId: profile.selectedTank,
    tint: (SKIN_BY_ID[profile.skin] || {}).tint || 0xffffff,
    skin: profile.skin,
    battles: profile.stats.battles,
    party: party.token, // взвод: одинаковый токен → одна комната на сервере
    mode: profile.battleMode, // режим боя → сервер ищет комнату того же режима
    training: props.training, // ?training=1 → отдельная комната соло + замороженные боты (первый бой)
    uid: tgUserId() ? String(tgUserId()) : null, // best-effort tg-id для серверной аналитики
    stats: JSON.parse(JSON.stringify(loadoutStats(profile.selectedTank))),
    onLobby: (msg) => {
      // живые игроки на РЕАЛЬНЫХ сторонах (сервер раздаёт команды уже в лобби) —
      // твой отряд и противник; пустые слоты добьются ботами (все живые → ботов нет)
      teamSize.value = msg.teamSize || TEAM
      const ally = (p) => ({ name: p.name, kind: 'player', battles: p.battles })
      myTeam.value = msg.players.filter((p) => p.team === msg.yourTeam && p.id !== msg.you).map(ally)
      foeTeam.value = msg.players.filter((p) => p.team !== msg.yourTeam).map(ally)
      botsEtaOnline.value = Math.max(0, Math.ceil(msg.startsIn / 1000))
      if (!lobbyTracked) {
        lobbyTracked = true
        track('matchmaking_lobby_seen', {
          live_total: liveTotal.value,
          ally_live: myTeam.value.length,
          enemy_live: foeTeam.value.length,
          bot_total_estimated: botTotal.value,
          starts_in_ms: msg.startsIn,
          team_size: teamSize.value,
          party_present: !!party.token,
          battle_mode: profile.battleMode,
        })
      }
    },
    onStart: (msg) => {
      phase.value = 'go' // боты добиваются автоматически через teamSlots (фаза не search)
      // ростер боя с сервера → предбоевой список бойцов = ровно те ники, что будут в
      // бою (раньше пустые слоты добивались случайными MM_FILLERS и не совпадали).
      if (Array.isArray(msg.roster)) {
        const mine = [], foes = []
        for (const r of msg.roster) {
          if (r.id === msg.youUnit) continue // свой слот рисуется отдельно (kind: 'you')
          ;(r.team === msg.youTeam ? mine : foes).push({ name: r.name, kind: 'player' })
        }
        myTeam.value = mine
        foeTeam.value = foes
      }
      // НЕ входим в бой, пока не пришёл первый снапшот мира. Не пришёл за дедлайн —
      // не офлайн, а новая попытка подключения (онлайн-онли).
      const deadline = Date.now() + 4000
      const enter = () => {
        if (gone) return
        if (client && client.stateN >= 1 && client.ws.readyState === 1) {
          gone = true
          const humans = msg.humans || liveTotal.value
          track('matchmaking_matched', {
            room_id: msg.room || null,
            map_id: msg.mapId,
            mode: msg.mode,
            humans,
            bots_estimated: Math.max(0, teamSize.value * 2 - humans),
            search_ms: searchMs(),
            party_present: !!party.token,
            state_snapshot_received: client.stateN >= 1,
          })
          // room/humans едут в Battle.vue: battle_id для боевых событий и оценка ботов
          emit('battle', { client, mapId: msg.mapId, side: msg.youTeam, youUnit: msg.youUnit, tickHz: msg.tickHz, mode: msg.mode, room: msg.room || null, humans, training: props.training })
        } else if (Date.now() >= deadline) {
          track('matchmaking_connection_failed', {
            reason: 'no_state_snapshot_before_deadline',
            search_ms: searchMs(),
            had_lobby: lobbyTracked,
            state_snapshot_received: false,
            party_present: !!party.token,
          })
          phase.value = 'search'
          retry() // мир не пришёл — переподключаемся
        } else {
          timers.push(setTimeout(enter, 120))
        }
      }
      timers.push(setTimeout(enter, 900)) // короткая пауза «БОЙ НАЙДЕН»
    },
    onClose: () => {
      // сервер оборвал ДО старта — новая попытка (не офлайн)
      if (!gone && phase.value !== 'go') retry()
    },
  }
}

async function search() {
  failed.value = false
  online.value = null
  try {
    client = await connectMatch(connectParams())
    online.value = true
  } catch (err) {
    track('matchmaking_connection_failed', {
      reason: 'connect_rejected',
      detail: err?.message || 'unknown', // 'ws timeout' / 'ws closed:1013' (busy) / 'ws error' — для диагностики «не подрубается»
      search_ms: searchMs(),
      try_n: tries + 1,
    })
    retry()
  }
}

// связь не встала — пробуем ещё; после MAX_TRIES показываем кнопки (без офлайна)
function retry() {
  if (gone) return
  if (client) {
    try {
      client.close()
    } catch {
      /* ок */
    }
    client = null
  }
  tries++
  if (tries >= MAX_TRIES) {
    // онлайн-онли: офлайн-фоллбэка НЕТ — терминальное «сервер недоступен» с кнопками
    track('matchmaking_failed', {
      reason: 'no_connection_after_max_tries',
      tries,
      search_ms: searchMs(),
      had_lobby: lobbyTracked,
      battle_mode: profile.battleMode,
      party_present: !!party.token,
    })
    failed.value = true
    online.value = false
    return
  }
  online.value = null
  timers.push(setTimeout(search, 600)) // быстрый ретрай: «тёплый» коннект после холодного обычно встаёт сразу
}

// кнопка «Повторить» — сбрасываем счётчик и ищем заново
function retryNow() {
  tries = 0
  secs.value = 0
  phase.value = 'search'
  search()
}

onMounted(() => {
  track('matchmaking_started', {
    battle_mode: profile.battleMode,
    party_present: !!party.token,
    tank_id: profile.selectedTank,
    tank_tier: (TANK_BY_ID[profile.selectedTank] || {}).tier || null,
  })
  tick = setInterval(() => secs.value++, 1000)
  refreshOnline()
  onlineTimer = setInterval(refreshOnline, 30000)
  search()
})
onUnmounted(() => {
  clearInterval(tick)
  clearInterval(onlineTimer)
  timers.forEach(clearTimeout)
  // бой не начался — соединение никому не нужно
  if (!gone && client) client.close()
})

function cancel() {
  track('matchmaking_cancelled', {
    search_ms: searchMs(),
    live_total_last: liveTotal.value,
    ally_live: myTeam.value.length,
    enemy_live: foeTeam.value.length,
    status: phase.value,
    online: online.value,
  })
  if (client) client.close()
  emit('cancel')
}

const blipColor = (a) => (a.kind === 'bot' ? 'var(--ink-faint)' : a.kind === 'party' ? 'var(--blue)' : 'var(--green)')
</script>

<template>
  <div class="pz-screen" style="background: linear-gradient(rgba(13, 15, 10, 0.82), rgba(13, 15, 10, 0.92)), url('/sprites/bg_mm.png') center / cover no-repeat">
    <!-- шапка -->
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 0">
      <div class="pz-display" style="font-size: 17px">{{ failed ? t('matchmaking.titleNoConnection') : phase === 'go' ? t('matchmaking.titleFound') : t('matchmaking.titleSearching') }}</div>
      <div style="display: flex; align-items: center; gap: 6px">
        <!-- живой «N в сети» — соц-пруф пока ищем соперников -->
        <span v-if="onlineCount" class="pz-chip" :title="t('common.online')" style="padding: 2px 8px; gap: 5px; color: var(--ink-dim)">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 5px var(--green); display: inline-block"></span>
          <span class="pz-pixel" style="font-size: 8px">{{ t('common.onlineNow', { n: onlineCount }) }}</span>
        </span>
        <span class="pz-chip" style="color: var(--ink-dim)">
          <span class="pz-pixel" style="font-size: 9px" :style="{ color: phase === 'go' ? 'var(--green)' : 'var(--amber)' }">{{ mmss }}</span>
        </span>
      </div>
    </div>
    <div style="font-size: 11.5px; color: var(--ink-dim); font-weight: 500; padding: 4px 14px 0">
      {{ tankName }} · {{ t('matchmaking.battle7x7') }} · {{ t('matchmaking.tiers', { range: tierRange }) }}
      <span class="pz-display" style="color: var(--amber); font-size: 10.5px; margin-left: 4px">· {{ modeLabel }}</span>
    </div>
    <!-- онлайн-онли: карту и сторону объявляет сервер при развёртывании -->
    <div style="font-size: 11.5px; font-weight: 500; padding: 2px 14px 0; color: var(--ink-faint)">
      {{ failed ? t('matchmaking.serverDown') : t('matchmaking.deployNote') }}
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
      :style="{ color: failed ? 'var(--red)' : phase === 'go' ? 'var(--green)' : 'var(--ink-dim)', animation: failed || phase === 'go' ? 'none' : 'pz-blink 1.2s linear infinite' }"
    >
      {{ failed ? t('matchmaking.statusServerDown') : online === null ? t('matchmaking.statusConnecting') : phase === 'search' ? t('matchmaking.statusSearching') : phase === 'fill' ? t('matchmaking.statusFilling') : t('matchmaking.statusDeploying') }}
    </div>

    <!-- состав боя 7×7: твой отряд и противник; живые на сторонах, пустое — боты -->
    <div style="padding: 0 14px; flex: 1; display: flex; flex-direction: column">
      <div class="teams">
        <div class="team-col">
          <div class="pz-stencil-h ally-h">{{ t('matchmaking.yourSquad') }}</div>
          <div v-for="(s, i) in mySlots" :key="'a' + i" class="mslot" :class="{ me: s && s.kind === 'you', bot: s && s.kind === 'bot', empty: !s }">
            <span class="mdot" :style="{ background: slotDot(s) }"></span>
            <span class="mname">{{ slotName(s) }}</span>
            <PzIcon v-if="s && s.kind === 'you'" name="star" :size="9" color="var(--amber)" />
          </div>
        </div>
        <div class="team-col">
          <div class="pz-stencil-h foe-h">{{ t('matchmaking.opponent') }}</div>
          <div v-for="(s, i) in foeSlots" :key="'e' + i" class="mslot foe" :class="{ bot: s && s.kind === 'bot', empty: !s }">
            <span class="mdot" :style="{ background: s && s.kind === 'player' ? 'var(--red)' : slotDot(s) }"></span>
            <span class="mname">{{ slotName(s) }}</span>
          </div>
        </div>
      </div>
      <div class="live-summary">
        {{ t('matchmaking.battle7x7Caps') }} · <b :style="{ color: phase === 'go' ? 'var(--green)' : 'var(--amber)' }">{{ filledCount }}/{{ teamSize * 2 }}</b>
        · {{ phase === 'search' ? t('matchmaking.gathering') : t('matchmaking.gathered') }}
      </div>
    </div>

    <!-- отмена / в бой -->
    <div style="padding: 8px 14px 18px">
      <div v-if="failed" style="display: flex; gap: 8px">
        <button class="pz-btn2" style="flex: 1" @click="cancel">{{ t('common.toHangar') }}</button>
        <button class="pz-cta" style="flex: 1.5; padding: 11px" @click="retryNow">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="phase === 'go'" class="pz-display" style="text-align: center; font-size: 15px; letter-spacing: 0.12em; color: var(--green); padding: 12px 0; animation: pz-pop 0.3s ease">{{ t('matchmaking.intoBattle') }}</div>
      <button v-else class="pz-btn2" style="width: 100%" @click="cancel">{{ t('matchmaking.cancelSearch') }}</button>
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
