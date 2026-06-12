<script setup>
// Шторка взвода. Таб ВЗВОД — реальный взвод через Telegram deep-link: собираешь
// взвод (становишься командиром) и шлёшь другу sq-ссылку; кто откроет — ищет бой
// с тем же токеном и попадает в ТВОЮ комнату (одна команда живых). Таб НАГРАДЫ —
// рефералы: постоянная ref-ссылка, рекруты считаются на сервере (не фейк).
import { ref, computed, onUnmounted } from 'vue'
import { profile, claimRefMilestone } from '../store.js'
import { REF_MILESTONES } from '../game/meta.js'
import { tgUserId, inviteLink, shareLink } from '../tg.js'
import { squad, connectSquad, squadSetReady, squadLaunch, closeSquad, isSquadLeader, myReady, allReady } from '../game/squad.js'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['close'])

const tab = ref(0)
const toast = ref(null)
let toastTimer = null

const myId = computed(() => tgUserId())
const isLeader = computed(() => isSquadLeader())
const rewardsDot = computed(() =>
  REF_MILESTONES.some((m, i) => !profile.claimedRef.includes(i) && profile.referrals.length >= m.need),
)

function showToast(text) {
  toast.value = { key: Date.now(), text }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 1900)
}

// результат шэра ссылки → понятный тост
function afterShare(kind) {
  if (kind === 'share') showToast('Выбери чат — отправь другу')
  else if (kind === 'copied') showToast('Ссылка скопирована — кидай в чат!')
  else showToast('Шэр недоступен — открой игру в Telegram')
}

// собрать взвод: стать командиром (зайти в своё лобби) и пригласить друга
function createSquad() {
  if (!myId.value) return showToast('Взвод доступен только в Telegram')
  connectSquad(myId.value, profile.name)
  afterShare(shareLink(inviteLink(`sq_${myId.value}`), 'Го во взвод в Panzer TG — вместе в один бой!'))
}
function inviteMore() {
  if (!myId.value) return
  afterShare(shareLink(inviteLink(`sq_${myId.value}`), 'Го во взвод в Panzer TG!'))
}
function toggleReady() {
  squadSetReady(!myReady())
}
function launch() {
  if (!isLeader.value || !allReady()) return
  squadLaunch(profile.battleMode) // сервер пнёт всех → App.onLaunch → в бой с party=squadId
  emit('close')
}
function leaveSquad() {
  closeSquad()
  showToast('Вышел из взвода')
}

// постоянная реф-ссылка: кто зайдёт по ней — засчитается тебе в рекруты на сервере
function inviteFriend() {
  if (!myId.value) return showToast('Приглашение доступно только в Telegram')
  afterShare(shareLink(inviteLink(`ref_${myId.value}`), 'Залетай в Panzer TG — танковые бои в Telegram!'))
}

function claim(i) {
  const r = claimRefMilestone(i)
  if (!r) return
  // оф-ящик с дропом камуфляжа — показываем что именно выпало
  if (r.camo) showToast(`🎁 Камуфляж «${r.camo.name}» на ${r.camo.tankName} +${r.credits} кр`)
  else showToast(`${REF_MILESTONES[i].label} — получено!`)
}

const needWord = (n) => (n === 1 ? 'друг' : n < 5 ? 'друга' : 'друзей')

onUnmounted(() => clearTimeout(toastTimer))
</script>

<template>
  <div class="sheet-root">
    <div class="scrim" @click="emit('close')"></div>

    <div class="pz-plate sheet">
      <div class="grip"></div>

      <!-- табы -->
      <div style="display: flex; gap: 6px; margin-bottom: 12px">
        <button class="pz-display tabbtn" :class="{ on: tab === 0 }" @click="tab = 0">ВЗВОД</button>
        <button class="pz-display tabbtn" :class="{ on: tab === 1 }" @click="tab = 1">НАГРАДЫ{{ rewardsDot ? ' •' : '' }}</button>
      </div>

      <!-- ===== таб ВЗВОД ===== -->
      <template v-if="tab === 0">
        <div class="pz-stencil-h" style="margin-bottom: 10px">ВЗВОД{{ squad.active ? ` · ${squad.members.length}/3` : '' }}</div>

        <!-- НЕ в лобби -->
        <template v-if="!squad.active">
          <p class="hint">Собери взвод: друзья по ссылке зайдут в лобби, отметят готовность — и командир кинет всех в ОДИН бой на своей стороне.</p>
          <button class="pz-cta" style="width: 100%; gap: 8px; font-size: 14px; padding: 13px 16px" @click="createSquad">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M10 14l8.5-8.5M13 5h6v6" /><path d="M19 14v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" />
            </svg>
            Собрать взвод
          </button>
          <div class="howto">
            <div class="pz-stencil-h" style="margin-bottom: 8px">КАК ЭТО РАБОТАЕТ</div>
            <ol class="steps">
              <li>Жмёшь «Собрать взвод» — кидаешь ссылку другу в чат.</li>
              <li>Друг открывает игру по ссылке — попадает в твоё лобби.</li>
              <li>Все жмут «Готов», командир — «В БОЙ»: вы в одном бою.</li>
            </ol>
          </div>
        </template>

        <!-- В ЛОББИ: живой состав -->
        <template v-else>
          <div class="squad-slots">
            <div v-for="i in 3" :key="i" class="squad-slot" :class="{ filled: !!squad.members[i - 1], ready: squad.members[i - 1] && squad.members[i - 1].ready, me: squad.members[i - 1] && String(squad.members[i - 1].id) === String(myId) }">
              <template v-if="squad.members[i - 1]">
                <span class="sl-dot" :class="{ ready: squad.members[i - 1].ready }"></span>
                <div class="sl-name">
                  <PzIcon v-if="squad.members[i - 1].leader" name="star" :size="11" color="var(--amber)" />
                  {{ squad.members[i - 1].name }}<span v-if="String(squad.members[i - 1].id) === String(myId)" style="color: var(--ink-faint); font-weight: 600"> · ты</span>
                </div>
                <span class="sl-state" :class="{ ready: squad.members[i - 1].ready }">{{ squad.members[i - 1].ready ? 'ГОТОВ' : 'ждёт' }}</span>
              </template>
              <span v-else class="sl-free">— свободно —</span>
            </div>
          </div>

          <!-- моя готовность -->
          <button class="ready-toggle" :class="{ on: myReady() }" @click="toggleReady">
            {{ myReady() ? '✓ Я ГОТОВ' : 'ОТМЕТИТЬ ГОТОВНОСТЬ' }}
          </button>

          <!-- командир: позвать ещё + старт; участник — подсказка -->
          <button v-if="isLeader && !squad.full" class="pz-btn2" style="width: 100%; margin-top: 8px" @click="inviteMore">Позвать ещё друга</button>
          <button v-if="isLeader" class="pz-cta pz-cta--hazard" style="width: 100%; margin-top: 8px; padding: 13px" :disabled="!allReady()" :style="{ opacity: allReady() ? 1 : 0.5 }" @click="launch">
            {{ allReady() ? `В БОЙ ×${squad.members.length}` : 'ЖДЁМ ГОТОВНОСТИ ВСЕХ' }}
          </button>
          <div v-else class="hint" style="text-align: center; margin-top: 10px">Командир запустит бой, когда все готовы</div>

          <button class="pz-btn2" style="width: 100%; margin-top: 8px" @click="leaveSquad">{{ isLeader ? 'Распустить взвод' : 'Покинуть взвод' }}</button>
        </template>
      </template>

      <!-- ===== таб НАГРАДЫ ===== -->
      <template v-else>
        <div class="pz-stencil-h" style="margin-bottom: 10px">ПРИГЛАШЕНО · {{ profile.referrals.length }}/5</div>

        <!-- прогресс -->
        <div style="display: flex; align-items: center; gap: 4px; margin: 2px 4px 14px">
          <template v-for="i in 5" :key="i">
            <span class="prog" :class="{ on: i <= profile.referrals.length }">
              <PzIcon v-if="i <= profile.referrals.length" name="star" :size="10" color="var(--amber)" />
              <span v-else class="pz-pixel" style="font-size: 7px; color: var(--ink-faint)">{{ i }}</span>
            </span>
            <span v-if="i < 5" style="flex: 1; height: 2px" :style="{ background: i < profile.referrals.length ? 'var(--amber)' : 'var(--line)' }"></span>
          </template>
        </div>

        <!-- рубежи -->
        <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px">
          <div
            v-for="(m, i) in REF_MILESTONES"
            :key="i"
            class="mile-row"
            :class="{ ready: !profile.claimedRef.includes(i) && profile.referrals.length >= m.need }"
          >
            <span class="pz-display" style="font-size: 11px; width: 56px; flex-shrink: 0" :style="{ color: !profile.claimedRef.includes(i) && profile.referrals.length >= m.need ? 'var(--amber)' : 'var(--ink-faint)' }">
              {{ m.need }} {{ needWord(m.need) }}
            </span>
            <span style="flex: 1; font-size: 12.5px; font-weight: 600" :style="{ color: profile.claimedRef.includes(i) ? 'var(--ink-faint)' : 'var(--ink)' }">{{ m.label }}</span>
            <span v-if="profile.claimedRef.includes(i)" class="pz-chip" style="color: var(--green); font-size: 10.5px">✓ получено</span>
            <button
              v-else
              class="pz-btn2"
              style="padding: 6px 12px; font-size: 10.5px"
              :disabled="profile.referrals.length < m.need"
              :style="{
                opacity: profile.referrals.length >= m.need ? 1 : 0.45,
                borderColor: profile.referrals.length >= m.need ? 'var(--amber)' : 'var(--line-strong)',
                color: profile.referrals.length >= m.need ? 'var(--amber)' : 'var(--ink-dim)',
              }"
              @click="claim(i)"
            >
              Забрать
            </button>
          </div>
        </div>

        <div class="pz-stencil-h" style="margin-bottom: 8px">ТВОИ РЕКРУТЫ</div>
        <div class="pz-noscroll" style="overflow-y: auto; display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0">
          <div v-if="profile.referrals.length === 0" style="font-size: 12px; color: var(--ink-faint); text-align: center; padding: 14px 0; font-weight: 500">
            Пока никого — кинь ссылку в чат
          </div>
          <div v-for="(name, i) in profile.referrals" :key="i" class="friend-row">
            <span class="prog on" style="flex-shrink: 0"><PzIcon name="star" :size="10" color="var(--amber)" /></span>
            <div style="flex: 1; font-size: 13px; font-weight: 600">{{ name }}</div>
            <span class="pz-chip" style="color: var(--ink-dim); font-size: 10.5px">по твоей ссылке</span>
          </div>
        </div>
      </template>

      <!-- пригласить по постоянной реф-ссылке (только на табе НАГРАДЫ) -->
      <button v-if="tab === 1" class="pz-cta" style="margin-top: 12px; gap: 8px; font-size: 14px; padding: 13px 16px" @click="inviteFriend">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M10 14l8.5-8.5M13 5h6v6" />
          <path d="M19 14v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" />
        </svg>
        Пригласить по ссылке
      </button>

      <!-- тост над шторкой -->
      <div v-if="toast" :key="toast.key" class="sheet-toast">{{ toast.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.sheet-root {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.scrim {
  position: absolute;
  inset: 0;
  background: rgba(5, 7, 4, 0.66);
  backdrop-filter: blur(2px);
}
.sheet {
  position: relative;
  margin: 0 8px calc(8px + var(--safe-bottom));
  border-radius: 16px;
  padding: 14px 14px 16px;
  max-height: 78%;
  display: flex;
  flex-direction: column;
  animation: pz-slide-up 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.1);
}
.grip {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--line-strong);
  margin: 0 auto 10px;
}
.tabbtn {
  flex: 1;
  padding: 8px 0 7px;
  font-size: 11px;
  letter-spacing: 0.16em;
  cursor: pointer;
  color: var(--ink-dim);
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
}
.tabbtn.on {
  color: #1d1604;
  background: linear-gradient(180deg, var(--amber-hi), var(--amber));
  border-color: transparent;
}
.squad-slots {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.squad-slot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 10px;
  border: 1.5px dashed var(--line-strong);
  background: rgba(0, 0, 0, 0.25);
  min-height: 46px;
}
.squad-slot.filled {
  border-style: solid;
  background: rgba(0, 0, 0, 0.4);
}
.squad-slot.ready {
  border-color: var(--green);
  background: rgba(141, 184, 74, 0.08);
}
.squad-slot.me.filled {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.08);
}
.sl-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--ink-faint);
}
.sl-dot.ready {
  background: var(--green);
  box-shadow: 0 0 8px var(--green);
}
.sl-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sl-state {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
  flex-shrink: 0;
}
.sl-state.ready {
  color: var(--green);
}
.sl-free {
  flex: 1;
  text-align: center;
  font-size: 11.5px;
  color: var(--ink-faint);
  font-weight: 500;
}
.ready-toggle {
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  border: 1.5px solid var(--line-strong);
  background: rgba(0, 0, 0, 0.4);
  color: var(--ink-dim);
}
.ready-toggle.on {
  border-color: var(--green);
  background: rgba(141, 184, 74, 0.14);
  color: var(--green);
}
.friend-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.friend-row .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.prog {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  border: 1.5px solid var(--line-strong);
}
.prog.on {
  background: rgba(242, 165, 12, 0.13);
  border-color: var(--amber);
}
.mile-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.mile-row.ready {
  background: rgba(242, 165, 12, 0.06);
  border-color: var(--amber);
}
.hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-dim);
  font-weight: 500;
  margin: 0 0 12px;
}
.party-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
}
.party-card.active {
  background: rgba(242, 165, 12, 0.07);
  border-color: var(--amber);
}
.party-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--ink-faint);
}
.party-dot.on {
  background: var(--green);
  box-shadow: 0 0 8px var(--green);
  animation: pz-blink 1.6s linear infinite;
}
.howto {
  margin-top: 16px;
}
.steps {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.steps li {
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-dim);
  font-weight: 500;
}
.sheet-toast {
  position: absolute;
  top: -46px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-3);
  border: 1px solid var(--line-strong);
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  white-space: nowrap;
  animation: pz-slide-up 0.25s ease;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
</style>
