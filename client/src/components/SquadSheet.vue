<script setup>
// Шторка взвода. Таб ВЗВОД — реальный взвод через Telegram deep-link: собираешь
// взвод (становишься командиром) и шлёшь другу sq-ссылку; кто откроет — ищет бой
// с тем же токеном и попадает в ТВОЮ комнату (одна команда живых). Таб НАГРАДЫ —
// рефералы: постоянная ref-ссылка, рекруты считаются на сервере (не фейк).
import { ref, computed, onUnmounted } from 'vue'
import { profile, claimRefMilestone, selectTank, selectedTank } from '../store.js'
import { REF_MILESTONES, TANK_BY_ID } from '../game/meta.js'
import { tgUserId, inviteLink, shareLink } from '../tg.js'
import { squad, connectSquad, squadSetReady, squadLaunch, closeSquad, isSquadLeader, myReady, allReady, myTankCompatible, squadTierOk, memberTierBad, tierFitsSquad } from '../game/squad.js'
import { track } from '../analytics.js'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['close'])

const tab = ref(0)
const toast = ref(null)
let toastTimer = null

const myId = computed(() => tgUserId())
const isLeader = computed(() => isSquadLeader())

// смена техники прямо во взводе (а не «иди в ангар»): пикер своих танков с
// пометкой, какие подходят по уровню взвода. selectTank → watch в squad.js
// сам шлёт танк в лобби и пересчитывает совместимость.
const picker = ref(false)
const mySelId = computed(() => profile.selectedTank)
const myTankName = computed(() => {
  const t = selectedTank()
  return t ? `${t.name} · ур.${t.tier}` : '—'
})
const myTanks = computed(() => (profile.owned || []).map((id) => TANK_BY_ID[id]).filter(Boolean).sort((a, b) => a.tier - b.tier))
function pickTank(id) {
  selectTank(id)
  picker.value = false
}
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
  track('squad_create_clicked', {
    tank_id: profile.selectedTank,
    tank_tier: selectedTank()?.tier || null,
  })
  const shareResult = shareLink(inviteLink(`sq_${myId.value}`), 'Го во взвод в Panzer TG — вместе в один бой!')
  track('squad_share_attempted', { share_result: shareResult, kind: 'squad' })
  afterShare(shareResult)
}
function inviteMore() {
  if (!myId.value) return
  const shareResult = shareLink(inviteLink(`sq_${myId.value}`), 'Го во взвод в Panzer TG!')
  track('squad_share_attempted', {
    share_result: shareResult,
    kind: 'squad_more',
    members_count: squad.members.length,
  })
  afterShare(shareResult)
}
function toggleReady() {
  // готовлюсь, но техника не в пределах ±1 уровня — открываем пикер смены танка
  if (!myReady() && !myTankCompatible()) {
    showToast('Выбери технику в пределах ±1 уровня взвода')
    picker.value = true
    return
  }
  track('squad_ready_clicked', {
    ready_to: !myReady(),
    members_count: squad.members.length,
    tank_compatible: myTankCompatible(),
    tier_ok: squadTierOk(),
  })
  squadSetReady(!myReady())
}
function launch() {
  if (!isLeader.value || !allReady() || !squadTierOk()) return
  track('squad_launch_clicked', {
    members_count: squad.members.length,
    ready_count: squad.members.filter((m) => m.ready).length,
    tier_ok: squadTierOk(),
    mode: profile.battleMode,
  })
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
  const shareResult = shareLink(inviteLink(`ref_${myId.value}`), 'Залетай в Panzer TG — танковые бои в Telegram!')
  track('invite_friend_clicked', {
    share_result: shareResult,
    referrals_count: profile.referrals.length,
  })
  afterShare(shareResult)
}

function claim(i) {
  const r = claimRefMilestone(i)
  if (!r) return
  track('invite_reward_claimed', {
    milestone: i,
    referrals_count: profile.referrals.length,
    credits: r.credits || 0,
    tokens: r.tokens || 0,
    camo: r.camo ? true : false,
  })
  // оф-ящик с дропом камуфляжа — показываем что именно выпало
  if (r.camo) showToast(`🎁 Камуфляж «${r.camo.name}» на ${r.camo.tankName} +${r.credits} кр`)
  else showToast(`${REF_MILESTONES[i].label} — получено!`)
}

const needWord = (n) => (n === 1 ? 'друг' : n < 5 ? 'друга' : 'друзей')

// сервер отклонил старт (разный уровень техники) — показываем тостом
squad.onWarn = (reason) => showToast(reason === 'tier' ? 'Разный уровень техники — нужен ±1' : 'Действие отклонено')

onUnmounted(() => {
  clearTimeout(toastTimer)
  squad.onWarn = null
})
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
                <div class="sl-info">
                  <div class="sl-name">
                    <PzIcon v-if="squad.members[i - 1].leader" name="star" :size="11" color="var(--amber)" />
                    {{ squad.members[i - 1].name }}<span v-if="String(squad.members[i - 1].id) === String(myId)" style="color: var(--ink-faint); font-weight: 600"> · ты</span>
                  </div>
                  <div class="sl-tank" :class="{ bad: memberTierBad(squad.members[i - 1]) }">
                    <template v-if="squad.members[i - 1].tank">{{ squad.members[i - 1].tank.name }} · ур.{{ squad.members[i - 1].tank.tier }}</template>
                    <template v-else>выбирает технику…</template>
                  </div>
                </div>
                <span class="sl-state" :class="{ ready: squad.members[i - 1].ready }">{{ squad.members[i - 1].ready ? 'ГОТОВ' : 'ждёт' }}</span>
              </template>
              <span v-else class="sl-free">— свободно —</span>
            </div>
          </div>

          <!-- командир один: подсказка как затащить друга (частый затык — кеш/открытая игра) -->
          <p v-if="isLeader && squad.members.length < 2" class="hint" style="margin: 10px 0 0; padding: 9px 11px; border: 1px solid var(--line-strong); border-radius: 8px; background: rgba(0,0,0,.25)">
            Ждём друга. Он должен <b>полностью закрыть игру</b> (смахнуть в Telegram) и открыть её <b>по твоей ссылке</b> — тогда появится здесь. Если игра у него уже открыта — по ссылке не зайдёт.
          </p>

          <!-- моя техника + смена прямо во взводе (подогнать под уровень взвода) -->
          <div class="mytank">
            <div class="mt-row">
              <span class="mt-lbl">ТВОЯ ТЕХНИКА</span>
              <span class="mt-name" :class="{ bad: !myTankCompatible() }">{{ myTankName }}</span>
              <button class="mt-swap" @click="picker = !picker">{{ picker ? 'ЗАКРЫТЬ' : 'СМЕНИТЬ' }}</button>
            </div>
            <p v-if="!myTankCompatible() && !picker" class="mt-warn">Не подходит по уровню взвода — жми «СМЕНИТЬ» и выбери из подходящих (✓)</p>
            <transition name="pz-fade">
              <div v-if="picker" class="tank-picker pz-noscroll">
                <button
                  v-for="t in myTanks"
                  :key="t.id"
                  class="tp-cell"
                  :class="{ on: t.id === mySelId, fit: tierFitsSquad(t.tier), unfit: !tierFitsSquad(t.tier) }"
                  @click="pickTank(t.id)"
                >
                  <span class="tp-name">{{ t.name }}</span>
                  <span class="tp-tier">ур.{{ t.tier }}</span>
                  <span class="tp-mark">{{ t.id === mySelId ? '●' : tierFitsSquad(t.tier) ? '✓' : '✗' }}</span>
                </button>
              </div>
            </transition>
          </div>

          <!-- моя готовность: лейбл по ДЕЙСТВИЮ (зелёный = уже готов) -->
          <button class="ready-toggle" :class="{ on: myReady() }" @click="toggleReady">
            {{ myReady() ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'ГОТОВ' }}
          </button>

          <!-- командир: позвать ещё + старт; участник — подсказка -->
          <button v-if="isLeader && !squad.full" class="pz-btn2" style="width: 100%; margin-top: 8px" @click="inviteMore">Позвать ещё друга</button>
          <button v-if="isLeader" class="pz-cta pz-cta--hazard" style="width: 100%; margin-top: 8px; padding: 13px" :disabled="!allReady() || !squadTierOk()" :style="{ opacity: allReady() && squadTierOk() ? 1 : 0.5 }" @click="launch">
            {{ !squadTierOk() ? 'РАЗНЫЙ УРОВЕНЬ ТЕХНИКИ' : allReady() ? `В БОЙ ×${squad.members.length}` : 'ЖДЁМ ГОТОВНОСТИ ВСЕХ' }}
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
.sl-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sl-name {
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
.sl-tank {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sl-tank.bad {
  color: #ff6a5a;
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
/* моя техника + смена во взводе */
.mytank {
  margin-top: 10px;
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: rgba(0, 0, 0, 0.3);
}
.mt-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mt-lbl {
  font-size: 9px;
  letter-spacing: 0.12em;
  font-weight: 700;
  color: var(--ink-faint);
  flex-shrink: 0;
}
.mt-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mt-name.bad {
  color: #ff6a5a;
}
.mt-swap {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  border-radius: 7px;
  cursor: pointer;
  border: 1px solid var(--amber);
  background: rgba(242, 165, 12, 0.12);
  color: var(--amber);
}
.mt-warn {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.4;
  font-weight: 600;
  color: #ff8a5a;
}
.tank-picker {
  margin-top: 9px;
  max-height: 168px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tp-cell {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.3);
  text-align: left;
}
.tp-cell.fit {
  border-color: rgba(141, 184, 74, 0.5);
  background: rgba(141, 184, 74, 0.07);
}
.tp-cell.unfit {
  opacity: 0.5;
}
.tp-cell.on {
  border-color: var(--amber);
  background: rgba(242, 165, 12, 0.1);
}
.tp-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-tier {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-dim);
  flex-shrink: 0;
}
.tp-mark {
  width: 14px;
  text-align: center;
  font-weight: 800;
  flex-shrink: 0;
  color: var(--ink-faint);
}
.tp-cell.fit .tp-mark {
  color: #7cc05a;
}
.tp-cell.unfit .tp-mark {
  color: #ff6a5a;
}
.tp-cell.on .tp-mark {
  color: var(--amber);
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
