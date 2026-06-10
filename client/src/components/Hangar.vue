<script setup>
// Ангар-сцена (порт HangarSceneScreen): отсек-гараж, top-down танк, нации,
// ТТХ-шторка, карусель танков, кнопки ВЗВОД и В БОЙ, нижняя навигация.
import { ref, computed } from 'vue'
import { profile, setNation, selectTank, isOwned, crewLevel, crewProgress, buySkin, setSkin } from '../store.js'
import { tanksOfNation, TANK_BY_ID, NATIONS, STAT_LABELS, SKINS, SKIN_BY_ID } from '../game/meta.js'
import TankImg from './ui/TankImg.vue'
import CurrencyBar from './ui/CurrencyBar.vue'
import NationSwitch from './ui/NationSwitch.vue'
import BottomNav from './ui/BottomNav.vue'
import StatRow from './ui/StatRow.vue'
import PzIcon from './ui/PzIcon.vue'
import SquadSheet from './SquadSheet.vue'

const emit = defineEmits(['play', 'go'])
const squadOpen = ref(false)

const tank = computed(() => TANK_BY_ID[profile.selectedTank] || tanksOfNation(profile.nation)[0])
const locked = computed(() => !isOwned(tank.value.id))
const nationLabel = computed(() => (NATIONS.find((n) => n.id === profile.nation) || {}).label)
const tanks = computed(() => tanksOfNation(profile.nation))
const ttx = ref(false)
const fmt = (n) => n.toLocaleString('ru-RU')
const partyMul = computed(() => profile.party.length)
const skinTint = computed(() => (SKIN_BY_ID[profile.skin] || SKIN_BY_ID.std).tint)

function pickSkin(s) {
  if (profile.skins.includes(s.id)) setSkin(s.id)
  else buySkin(s.id) // не хватило жетонов — просто ничего не произойдёт
}
const tintCss = (t) => '#' + t.toString(16).padStart(6, '0')
</script>

<template>
  <div class="pz-screen" style="background: #131510">
    <!-- ===== сцена ===== -->
    <div style="position: absolute; inset: 0; z-index: 0">
      <!-- бетонный пол: AI-фон ангара + затемнение для читаемости -->
      <div
        style="
          position: absolute;
          inset: 0;
          background:
            radial-gradient(420px 360px at 50% 36%, rgba(255, 236, 180, 0.06), transparent 70%),
            linear-gradient(180deg, rgba(13, 15, 10, 0.62) 0%, rgba(13, 15, 10, 0.45) 40%, rgba(10, 12, 8, 0.72) 100%),
            url('/sprites/hangar.png') center / cover no-repeat,
            linear-gradient(180deg, #191c14 0%, #14160f 45%, #0e100a 100%);
        "
      ></div>
      <!-- размеченный отсек (бочки/пятна убраны — фон ангара уже фотореальный) -->
      <div class="bay">
        <span v-for="i in 4" :key="i" class="bay-tick" :class="'c' + i"></span>
        <div class="bay-num pz-display">Б-01</div>
        <div class="bay-hazard"></div>
      </div>

      <!-- тень + танк -->
      <div class="tank-wrap">
        <div class="tank-shadow"></div>
        <div :key="tank.id + profile.skin" style="animation: pz-pop 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.4); transform: rotate(-7deg)">
          <TankImg :tank-id="tank.id" :size="170" :tint="locked ? 0xffffff : skinTint" :style="{ filter: locked ? 'grayscale(0.85) brightness(0.55)' : 'drop-shadow(0 10px 14px rgba(0,0,0,0.45))' }" />
        </div>
        <div v-if="locked" class="pz-chip" style="position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%); color: var(--amber)">
          <PzIcon name="lock" :size="12" /> {{ fmt(tank.cost || 0) }}
        </div>
      </div>

      <!-- скримы для читаемости chrome -->
      <div style="position: absolute; left: 0; right: 0; top: 0; height: 170px; background: linear-gradient(180deg, rgba(8, 9, 6, 0.88), rgba(8, 9, 6, 0.4) 60%, transparent)"></div>
      <div style="position: absolute; left: 0; right: 0; bottom: 0; height: 320px; background: linear-gradient(0deg, rgba(8, 9, 6, 0.94) 30%, rgba(8, 9, 6, 0.55) 65%, transparent)"></div>
    </div>

    <!-- ===== chrome ===== -->
    <header style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px">
      <div class="pz-display" style="font-size: 19px">PANZER <span style="color: var(--amber)">TG</span></div>
      <CurrencyBar :credits="profile.credits" :tokens="profile.tokens" @shop="emit('go', 'shop')" />
    </header>

    <NationSwitch :nation="profile.nation" style="padding: 2px 14px" @pick="setNation" />

    <!-- ID-плашка танка -->
    <div style="margin-top: auto; padding: 0 14px 6px; display: flex; align-items: flex-end; justify-content: space-between; gap: 10px">
      <div>
        <div style="display: flex; align-items: baseline; gap: 8px">
          <span class="pz-display" style="font-size: 30px; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8)">{{ tank.name }}</span>
          <span class="pz-pixel" style="font-size: 8px; color: var(--amber)">УР.{{ tank.tier }}</span>
        </div>
        <div style="font-size: 12px; color: var(--ink-dim); font-weight: 500; margin-top: 1px">{{ tank.cls }} · {{ nationLabel }}</div>
      </div>
      <div style="display: flex; gap: 6px; align-items: center">
        <!-- экипаж: один на все танки, уровень баффает машину -->
        <div class="crew-badge pz-display" :title="`Экипаж: +${crewLevel() - 1}% к темпу/обзору/ходу`">
          <PzIcon name="star" :size="10" color="var(--amber)" />
          <span>ЭКИПАЖ {{ crewLevel() }}</span>
          <i class="bar"><b :style="{ width: crewProgress() * 100 + '%' }"></b></i>
        </div>
        <button class="pz-btn2" style="padding: 8px 12px; font-size: 11.5px" :style="{ borderColor: ttx ? 'var(--amber)' : 'var(--line-strong)', color: ttx ? 'var(--amber)' : 'var(--ink)' }" @click="ttx = !ttx">
          ТТХ {{ ttx ? '▾' : '▸' }}
        </button>
      </div>
    </div>

    <!-- ТТХ-шторка -->
    <div v-if="ttx" class="pz-plate" style="margin: 0 14px 8px; padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 7px; animation: pz-slide-up 0.22s ease">
      <StatRow v-for="(v, k) in tank.stats" :key="k" :label="STAT_LABELS[k]" :value="v" />
      <div style="font-size: 11.5px; color: var(--ink-dim); line-height: 1.45; margin-top: 2px">{{ tank.desc }}</div>
    </div>

    <!-- камуфляжи: платные скины, видны в бою -->
    <div style="display: flex; align-items: center; gap: 7px; padding: 2px 14px 4px; flex-shrink: 0">
      <span class="pz-pixel" style="font-size: 7px; color: var(--ink-faint); letter-spacing: 0.1em">КАМО</span>
      <button
        v-for="s in SKINS"
        :key="s.id"
        class="skin-dot"
        :class="{ on: profile.skin === s.id }"
        :style="{ background: tintCss(s.tint) }"
        :title="s.name + (profile.skins.includes(s.id) ? '' : ` · ${s.costTokens} жет.`)"
        @click="pickSkin(s)"
      >
        <PzIcon v-if="!profile.skins.includes(s.id)" name="lock" :size="9" color="#1d1604" />
      </button>
    </div>

    <!-- карусель -->
    <div class="pz-noscroll" style="display: flex; gap: 8px; overflow-x: auto; padding: 4px 14px; flex-shrink: 0">
      <button
        v-for="t in tanks"
        :key="t.id"
        :class="t.id === tank.id ? 'pz-brackets' : ''"
        :style="{
          '--bk': 'var(--amber)',
          flexShrink: 0,
          width: '76px',
          padding: '8px 4px 7px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          background: t.id === tank.id ? 'linear-gradient(180deg, rgba(242,165,12,.14), rgba(0,0,0,.5))' : 'rgba(0,0,0,.5)',
          border: '1px solid ' + (t.id === tank.id ? 'var(--amber)' : 'var(--line-strong)'),
          borderRadius: '8px',
          cursor: 'pointer',
          color: !isOwned(t.id) ? 'var(--ink-faint)' : 'var(--ink)',
        }"
        @click="selectTank(t.id)"
      >
        <span class="pz-pixel" style="font-size: 8px" :style="{ color: t.id === tank.id ? 'var(--amber)' : 'var(--ink-faint)' }">{{ t.tier }}</span>
        <span class="pz-display" style="font-size: 12.5px; white-space: nowrap">{{ t.name }}</span>
        <span style="height: 14px; display: flex; align-items: center" :style="{ color: t.id === tank.id ? 'var(--amber)' : 'var(--ink-faint)' }">
          <PzIcon :name="isOwned(t.id) ? 'star' : 'lock'" :size="11" :color="t.id === tank.id ? 'var(--amber)' : 'var(--ink-faint)'" />
        </span>
      </button>
    </div>

    <!-- CTA -->
    <div style="padding: 8px 14px 4px; flex-shrink: 0; display: flex; gap: 8px">
      <button class="pz-btn2 squad-btn" @click="squadOpen = true">
        <span class="dots">
          <span class="slot you"><PzIcon name="star" :size="7" color="var(--amber)" /></span>
          <span class="slot" :class="{ filled: partyMul >= 1 }"></span>
          <span class="slot" :class="{ filled: partyMul >= 2 }"></span>
        </span>
        ВЗВОД
      </button>
      <button class="pz-cta pz-cta--hazard" :disabled="locked" @click="emit('play')">
        <template v-if="locked">ИССЛЕДУЙ В РАЗВИТИИ</template>
        <template v-else>В БОЙ <span style="font-size: 14px; opacity: 0.75">▸ {{ tank.name }}<template v-if="partyMul > 0"> ×{{ 1 + partyMul }}</template></span></template>
      </button>
    </div>

    <BottomNav screen="hangar" @go="emit('go', $event)" />

    <SquadSheet v-if="squadOpen" @close="squadOpen = false" />
  </div>
</template>

<style scoped>
.bay {
  position: absolute;
  left: 50%;
  top: 37%;
  width: 264px;
  height: 330px;
  transform: translate(-50%, -50%);
  border: 2.5px dashed color-mix(in oklab, var(--amber) 35%, transparent);
  border-radius: 6px;
}
.bay-tick {
  position: absolute;
  width: 22px;
  height: 22px;
  opacity: 0.8;
}
.bay-tick.c1 {
  top: -3px;
  left: -3px;
  border-top: 4px solid var(--amber);
  border-left: 4px solid var(--amber);
}
.bay-tick.c2 {
  top: -3px;
  right: -3px;
  border-top: 4px solid var(--amber);
  border-right: 4px solid var(--amber);
}
.bay-tick.c3 {
  bottom: -3px;
  left: -3px;
  border-bottom: 4px solid var(--amber);
  border-left: 4px solid var(--amber);
}
.bay-tick.c4 {
  bottom: -3px;
  right: -3px;
  border-bottom: 4px solid var(--amber);
  border-right: 4px solid var(--amber);
}
.bay-num {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 64px;
  color: rgba(232, 230, 218, 0.05);
  letter-spacing: 0.1em;
  white-space: nowrap;
}
.bay-hazard {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -16px;
  height: 10px;
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in oklab, var(--amber) 40%, transparent) 0 10px,
    rgba(0, 0, 0, 0.5) 10px 20px
  );
  border-radius: 2px;
  opacity: 0.5;
}
.skin-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.85;
}
.skin-dot.on {
  border-color: var(--amber);
  box-shadow: 0 0 8px rgba(242, 165, 12, 0.6);
  opacity: 1;
}
.tank-wrap {
  position: absolute;
  left: 50%;
  top: 37%;
  transform: translate(-50%, -50%);
}
.tank-shadow {
  position: absolute;
  left: 50%;
  top: 54%;
  width: 150px;
  height: 170px;
  transform: translate(-50%, -50%);
  background: radial-gradient(ellipse, rgba(0, 0, 0, 0.55), transparent 68%);
  border-radius: 50%;
}
.squad-btn {
  flex-direction: column;
  gap: 3px;
  padding: 8px 12px;
  font-size: 11px;
}
.crew-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 10px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ink-dim);
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
}
.crew-badge > div:first-child,
.crew-badge span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.crew-badge .bar {
  width: 54px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.crew-badge .bar b {
  display: block;
  height: 100%;
  background: var(--amber);
}
.squad-btn .dots {
  display: flex;
  gap: 4px;
}
.squad-btn .dots .slot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px dashed var(--ink-faint);
  display: flex;
  align-items: center;
  justify-content: center;
}
.squad-btn .dots .slot.you {
  border: 1.5px solid var(--amber);
  background: rgba(242, 165, 12, 0.17);
}
.squad-btn .dots .slot.filled {
  border: 1.5px solid var(--blue);
  background: rgba(77, 163, 255, 0.2);
}
</style>
