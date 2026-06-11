<script setup>
// Шторка взвода. Таб ВЗВОД — реальный взвод через Telegram deep-link: собираешь
// взвод (становишься командиром) и шлёшь другу sq-ссылку; кто откроет — ищет бой
// с тем же токеном и попадает в ТВОЮ комнату (одна команда живых). Таб НАГРАДЫ —
// рефералы: постоянная ref-ссылка, рекруты считаются на сервере (не фейк).
import { ref, computed, onUnmounted } from 'vue'
import { profile, party, setPartyToken, clearParty, claimRefMilestone } from '../store.js'
import { REF_MILESTONES } from '../game/meta.js'
import { tgUserId, inviteLink, shareLink } from '../tg.js'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['close'])

const tab = ref(0)
const toast = ref(null)
let toastTimer = null

const myId = computed(() => tgUserId())
const inParty = computed(() => !!party.token)
const isLeader = computed(() => inParty.value && (party.leader || String(party.token) === String(myId.value)))
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

// собрать взвод: стать командиром и отправить другу приглашение
function inviteToParty() {
  if (!myId.value) return showToast('Взвод доступен только в Telegram')
  setPartyToken(myId.value, true)
  afterShare(shareLink(inviteLink(`sq_${myId.value}`), 'Го во взвод в Panzer TG — вместе в один бой!'))
}
function leaveParty() {
  clearParty()
  showToast('Взвод распущен')
}

// постоянная реф-ссылка: кто зайдёт по ней — засчитается тебе в рекруты на сервере
function inviteFriend() {
  if (!myId.value) return showToast('Приглашение доступно только в Telegram')
  afterShare(shareLink(inviteLink(`ref_${myId.value}`), 'Залетай в Panzer TG — танковые бои в Telegram!'))
}

function claim(i) {
  if (claimRefMilestone(i)) showToast(`${REF_MILESTONES[i].label} — получено!`)
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
        <div class="pz-stencil-h" style="margin-bottom: 10px">ВЗВОД</div>
        <p class="hint">Друзья в одном онлайн-бою на твоей стороне. Позови их по ссылке: кто откроет игру по ней и нажмёт «В бой» — встанет в твою команду.</p>

        <!-- статус взвода -->
        <div class="party-card" :class="{ active: inParty }">
          <span class="party-dot" :class="{ on: inParty }"></span>
          <div style="flex: 1; min-width: 0">
            <div class="pz-display" style="font-size: 12px">
              {{ inParty ? (isLeader ? 'ВЗВОД СОБРАН · ТЫ КОМАНДИР' : 'ТЫ ВО ВЗВОДЕ') : 'ВЗВОД НЕ СОБРАН' }}
            </div>
            <div style="font-size: 11px; color: var(--ink-dim); font-weight: 600; margin-top: 2px">
              {{ inParty ? (isLeader ? 'Друзья по ссылке встанут в твою команду' : 'Ищи бой — попадёшь к командиру') : 'Позови друзей в один бой' }}
            </div>
          </div>
        </div>

        <!-- действия -->
        <button v-if="!inParty || isLeader" class="pz-cta" style="width: 100%; margin-top: 12px; gap: 8px; font-size: 14px; padding: 13px 16px" @click="inviteToParty">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M10 14l8.5-8.5M13 5h6v6" /><path d="M19 14v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" />
          </svg>
          {{ inParty ? 'Позвать ещё друга' : 'Собрать взвод и пригласить' }}
        </button>
        <button v-if="inParty" class="pz-btn2" style="width: 100%; margin-top: 8px" @click="leaveParty">
          {{ isLeader ? 'Распустить взвод' : 'Покинуть взвод' }}
        </button>

        <div class="howto">
          <div class="pz-stencil-h" style="margin-bottom: 8px">КАК ЭТО РАБОТАЕТ</div>
          <ol class="steps">
            <li>Жмёшь «Собрать взвод» — откроется выбор чата в Telegram.</li>
            <li>Кидаешь ссылку другу, он открывает игру по ней.</li>
            <li>Оба жмёте «В БОЙ» — сервер сводит вас в один онлайн-бой.</li>
          </ol>
        </div>
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
.you-slot {
  padding: 10px 6px;
  text-align: center;
  background: rgba(242, 165, 12, 0.08);
  border: 1px solid var(--amber);
  border-radius: 8px;
}
.mate-slot {
  padding: 10px 6px;
  text-align: center;
  background: rgba(77, 163, 255, 0.1);
  border: 1px solid var(--blue);
  border-radius: 8px;
  cursor: pointer;
  color: var(--ink);
}
.free-slot {
  padding: 10px 6px;
  text-align: center;
  border: 1.5px dashed var(--line-strong);
  border-radius: 8px;
  color: var(--ink-faint);
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
