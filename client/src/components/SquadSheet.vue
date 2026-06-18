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
import { t } from '../i18n.js'
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
  const sel = selectedTank()
  return sel ? `${sel.name} · ${t('squad.tierShort', { n: sel.tier })}` : '—'
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
  if (kind === 'share') showToast(t('squad.shareChoose'))
  else if (kind === 'copied') showToast(t('squad.shareCopied'))
  else showToast(t('squad.shareUnavailable'))
}

// собрать взвод: стать командиром (зайти в своё лобби) и пригласить друга
function createSquad() {
  if (!myId.value) return showToast(t('squad.squadTgOnly'))
  connectSquad(myId.value, profile.name)
  track('squad_create_clicked', {
    tank_id: profile.selectedTank,
    tank_tier: selectedTank()?.tier || null,
  })
  const shareResult = shareLink(inviteLink(`sq_${myId.value}`), t('squad.shareSquad'))
  track('squad_share_attempted', { share_result: shareResult, kind: 'squad' })
  afterShare(shareResult)
}
function inviteMore() {
  if (!myId.value) return
  const shareResult = shareLink(inviteLink(`sq_${myId.value}`), t('squad.shareSquadMore'))
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
    showToast(t('squad.pickTankInRange'))
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
  showToast(t('squad.leftSquad'))
}

// постоянная реф-ссылка: кто зайдёт по ней — засчитается тебе в рекруты на сервере
function inviteFriend() {
  if (!myId.value) return showToast(t('squad.inviteTgOnly'))
  const shareResult = shareLink(inviteLink(`ref_${myId.value}`), t('squad.shareRef'))
  track('invite_friend_clicked', {
    share_result: shareResult,
    referrals_count: profile.referrals.length,
  })
  afterShare(shareResult)
}

async function claim(i) {
  const r = await claimRefMilestone(i)
  if (!r) return
  track('invite_reward_claimed', {
    milestone: i,
    referrals_count: profile.referrals.length,
    credits: r.credits || 0,
    tokens: r.tokens || 0,
    camo: r.camo ? true : false,
  })
  // оф-ящик с дропом камуфляжа — показываем что именно выпало
  if (r.camo) showToast(t('squad.camoDrop', { name: r.camo.name, tankName: r.camo.tankName, credits: r.credits }))
  else showToast(t('squad.milestoneGot', { label: REF_MILESTONES[i].label }))
}

// сервер отклонил старт (разный уровень техники) — показываем тостом
squad.onWarn = (reason) => showToast(reason === 'tier' ? t('squad.warnTier') : t('squad.warnRejected'))

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
        <button class="pz-display tabbtn" :class="{ on: tab === 0 }" @click="tab = 0">{{ t('squad.tabSquad') }}</button>
        <button class="pz-display tabbtn" :class="{ on: tab === 1 }" @click="tab = 1">{{ t('squad.tabRewards') }}{{ rewardsDot ? ' •' : '' }}</button>
      </div>

      <!-- ===== таб ВЗВОД ===== -->
      <template v-if="tab === 0">
        <div class="pz-stencil-h" style="margin-bottom: 10px">{{ t('squad.squadHeader') }}{{ squad.active ? ` · ${squad.members.length}/3` : '' }}</div>

        <!-- НЕ в лобби -->
        <template v-if="!squad.active">
          <p class="hint">{{ t('squad.notInLobbyHint') }}</p>
          <button class="pz-cta" style="width: 100%; gap: 8px; font-size: 14px; padding: 13px 16px" @click="createSquad">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M10 14l8.5-8.5M13 5h6v6" /><path d="M19 14v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" />
            </svg>
            {{ t('squad.buildSquad') }}
          </button>
          <div class="howto">
            <div class="pz-stencil-h" style="margin-bottom: 8px">{{ t('squad.howItWorks') }}</div>
            <ol class="steps">
              <li>{{ t('squad.step1') }}</li>
              <li>{{ t('squad.step2') }}</li>
              <li>{{ t('squad.step3') }}</li>
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
                    {{ squad.members[i - 1].name }}<span v-if="String(squad.members[i - 1].id) === String(myId)" style="color: var(--ink-faint); font-weight: 600">{{ t('squad.youSuffix') }}</span>
                  </div>
                  <div class="sl-tank" :class="{ bad: memberTierBad(squad.members[i - 1]) }">
                    <template v-if="squad.members[i - 1].tank">{{ squad.members[i - 1].tank.name }} · {{ t('squad.tierShort', { n: squad.members[i - 1].tank.tier }) }}</template>
                    <template v-else>{{ t('squad.pickingTank') }}</template>
                  </div>
                </div>
                <span class="sl-state" :class="{ ready: squad.members[i - 1].ready }">{{ squad.members[i - 1].ready ? t('squad.memberReady') : t('squad.memberWaiting') }}</span>
              </template>
              <span v-else class="sl-free">{{ t('squad.slotFree') }}</span>
            </div>
          </div>

          <!-- командир один: подсказка как затащить друга (частый затык — кеш/открытая игра) -->
          <p v-if="isLeader && squad.members.length < 2" class="hint" style="margin: 10px 0 0; padding: 9px 11px; border: 1px solid var(--line-strong); border-radius: 8px; background: rgba(0,0,0,.25)">
            {{ t('squad.waitingFriendHint1') }}<b>{{ t('squad.waitingFriendHintBold') }}</b>{{ t('squad.waitingFriendHint2') }}<b>{{ t('squad.waitingFriendHintBold2') }}</b>{{ t('squad.waitingFriendHint3') }}
          </p>

          <!-- моя техника + смена прямо во взводе (подогнать под уровень взвода) -->
          <div class="mytank">
            <div class="mt-row">
              <span class="mt-lbl">{{ t('squad.yourTank') }}</span>
              <span class="mt-name" :class="{ bad: !myTankCompatible() }">{{ myTankName }}</span>
              <button class="mt-swap" @click="picker = !picker">{{ picker ? t('squad.closeBtn') : t('squad.swapBtn') }}</button>
            </div>
            <p v-if="!myTankCompatible() && !picker" class="mt-warn">{{ t('squad.tankWarn') }}</p>
            <transition name="pz-fade">
              <div v-if="picker" class="tank-picker pz-noscroll">
                <button
                  v-for="tk in myTanks"
                  :key="tk.id"
                  class="tp-cell"
                  :class="{ on: tk.id === mySelId, fit: tierFitsSquad(tk.tier), unfit: !tierFitsSquad(tk.tier) }"
                  @click="pickTank(tk.id)"
                >
                  <span class="tp-name">{{ tk.name }}</span>
                  <span class="tp-tier">{{ t('squad.tierShort', { n: tk.tier }) }}</span>
                  <span class="tp-mark">{{ tk.id === mySelId ? '●' : tierFitsSquad(tk.tier) ? '✓' : '✗' }}</span>
                </button>
              </div>
            </transition>
          </div>

          <!-- моя готовность: лейбл по ДЕЙСТВИЮ (зелёный = уже готов) -->
          <button class="ready-toggle" :class="{ on: myReady() }" @click="toggleReady">
            {{ myReady() ? t('squad.readyOn') : t('squad.readyOff') }}
          </button>

          <!-- командир: позвать ещё + старт; участник — подсказка -->
          <button v-if="isLeader && !squad.full" class="pz-btn2" style="width: 100%; margin-top: 8px" @click="inviteMore">{{ t('squad.inviteMore') }}</button>
          <button v-if="isLeader" class="pz-cta pz-cta--hazard" style="width: 100%; margin-top: 8px; padding: 13px" :disabled="!allReady() || !squadTierOk()" :style="{ opacity: allReady() && squadTierOk() ? 1 : 0.5 }" @click="launch">
            {{ !squadTierOk() ? t('squad.launchTierBad') : allReady() ? t('squad.launchGo', { n: squad.members.length }) : t('squad.launchWait') }}
          </button>
          <div v-else class="hint" style="text-align: center; margin-top: 10px">{{ t('squad.memberLaunchHint') }}</div>

          <button class="pz-btn2" style="width: 100%; margin-top: 8px" @click="leaveSquad">{{ isLeader ? t('squad.disband') : t('squad.leave') }}</button>
        </template>
      </template>

      <!-- ===== таб НАГРАДЫ ===== -->
      <template v-else>
        <div class="pz-stencil-h" style="margin-bottom: 10px">{{ t('squad.invitedHeader', { n: profile.referrals.length }) }}</div>

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
              {{ t('squad.needFriends', { n: m.need }) }}
            </span>
            <span style="flex: 1; font-size: 12.5px; font-weight: 600" :style="{ color: profile.claimedRef.includes(i) ? 'var(--ink-faint)' : 'var(--ink)' }">{{ m.label }}</span>
            <span v-if="profile.claimedRef.includes(i)" class="pz-chip" style="color: var(--green); font-size: 10.5px">{{ t('squad.claimed') }}</span>
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
              {{ t('squad.claim') }}
            </button>
          </div>
        </div>

        <div class="pz-stencil-h" style="margin-bottom: 8px">{{ t('squad.yourRecruits') }}</div>
        <div class="pz-noscroll" style="overflow-y: auto; display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0">
          <div v-if="profile.referrals.length === 0" style="font-size: 12px; color: var(--ink-faint); text-align: center; padding: 14px 0; font-weight: 500">
            {{ t('squad.noRecruits') }}
          </div>
          <div v-for="(name, i) in profile.referrals" :key="i" class="friend-row">
            <span class="prog on" style="flex-shrink: 0"><PzIcon name="star" :size="10" color="var(--amber)" /></span>
            <div style="flex: 1; font-size: 13px; font-weight: 600">{{ name }}</div>
            <span class="pz-chip" style="color: var(--ink-dim); font-size: 10.5px">{{ t('squad.viaYourLink') }}</span>
          </div>
        </div>
      </template>

      <!-- пригласить по постоянной реф-ссылке (только на табе НАГРАДЫ) -->
      <button v-if="tab === 1" class="pz-cta" style="margin-top: 12px; gap: 8px; font-size: 14px; padding: 13px 16px" @click="inviteFriend">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M10 14l8.5-8.5M13 5h6v6" />
          <path d="M19 14v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" />
        </svg>
        {{ t('squad.inviteByLink') }}
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
