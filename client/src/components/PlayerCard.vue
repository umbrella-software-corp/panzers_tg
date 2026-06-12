<script setup>
// Карточка профиля игрока (модалка): рейтинг, место, бои/винрейт/фраги,
// любимая техника. Медали добавятся, когда будет система медалей.
import { computed, ref } from 'vue'
import { TANK_BY_ID, MEDALS, rankByBattles, ratingBand } from '../game/meta.js'
import TankImg from './ui/TankImg.vue'
import Medal from './ui/Medal.vue'
import MedalSheet from './MedalSheet.vue'

const props = defineProps({ player: { type: Object, required: true } })
const emit = defineEmits(['close'])
const selMedal = ref(null) // открытая модалка медали
const p = computed(() => props.player)
const rank = computed(() => rankByBattles(p.value.battles))
const winrate = computed(() => (p.value.battles ? Math.round((p.value.wins / p.value.battles) * 100) : 0))
const tankName = computed(() => (TANK_BY_ID[p.value.tank] || {}).name || p.value.favoriteTank || '—')
// медали игрока: карта { id: счётчик } → значки в порядке каталога
const medals = computed(() => {
  const m = p.value.medals || {}
  return MEDALS.filter((d) => (m[d.id] || 0) > 0).map((d) => ({ def: d, count: m[d.id] }))
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="card pz-plate pz-brackets" style="--bk: var(--amber)">
      <button class="x" @click="emit('close')">✕</button>
      <div class="pz-display" style="font-size: 19px; text-align: center; padding: 0 20px" :style="{ color: p.premium ? 'var(--amber-hi)' : undefined }">
        <span v-if="p.premium" style="text-shadow: 0 0 6px rgba(242,165,12,.6)">♛ </span>{{ p.name }}
      </div>
      <div v-if="p.premium" class="pz-pixel" style="text-align: center; font-size: 7px; color: var(--amber); letter-spacing: 0.14em; margin-top: 3px">ПРЕМИУМ-АККАУНТ</div>
      <div class="rank-chip pz-display">{{ rank.name }}</div>
      <div v-if="p.place" class="pz-pixel place">МЕСТО {{ p.place }} В РЕЙТИНГЕ</div>

      <div class="rating-big pz-display" :style="{ color: ratingBand(p.rating).color }">{{ p.rating }}<span class="unit" :style="{ color: ratingBand(p.rating).color }">{{ ratingBand(p.rating).label }}</span></div>

      <div class="grid">
        <div class="cell"><div class="v pz-display">{{ p.battles }}</div><div class="l">боёв</div></div>
        <div class="cell"><div class="v pz-display">{{ winrate }}%</div><div class="l">винрейт</div></div>
        <div class="cell"><div class="v pz-display">{{ p.kills }}</div><div class="l">фрагов</div></div>
      </div>

      <div v-if="p.tank || p.favoriteTank" class="tank">
        <TankImg v-if="p.tank" :tank-id="p.tank" :size="50" />
        <div style="flex: 1; min-width: 0">
          <div class="pz-pixel label">ЛЮБИМАЯ ТЕХНИКА</div>
          <div class="pz-display" style="font-size: 15px">{{ tankName }}</div>
        </div>
      </div>

      <div class="medals">
        <div class="pz-pixel label">МЕДАЛИ <span v-if="medals.length" style="color: var(--amber)">{{ medals.length }}</span></div>
        <div v-if="medals.length" class="medal-grid">
          <Medal v-for="m in medals" :key="m.def.id" :medal="m.def" :count="m.count" :size="42" style="cursor: pointer" @click="selMedal = m" />
        </div>
        <div v-else style="font-size: 11.5px; color: var(--ink-dim); margin-top: 3px; font-weight: 500">пока нет — впереди бои и подвиги</div>
      </div>
    </div>

    <!-- модалка медали поверх карточки -->
    <transition name="pz-fade">
      <MedalSheet v-if="selMedal" :medal="selMedal.def" :count="selMedal.count" @close="selMedal = null" />
    </transition>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(6, 9, 14, 0.72);
  backdrop-filter: blur(4px);
}
.card {
  position: relative;
  width: 100%;
  max-width: 320px;
  padding: 22px 18px 18px;
  animation: pz-pop 0.25s ease;
}
.x {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--line-strong);
  color: var(--ink-dim);
  cursor: pointer;
  font-size: 13px;
}
.rank-chip {
  display: block;
  width: fit-content;
  margin: 7px auto 0;
  padding: 3px 12px;
  font-size: 12px;
  color: var(--amber);
  background: rgba(242, 165, 12, 0.1);
  border: 1px solid var(--amber);
  border-radius: 12px;
  letter-spacing: 0.04em;
}
.place {
  font-size: 8px;
  color: var(--amber);
  text-align: center;
  letter-spacing: 0.14em;
  margin-top: 5px;
}
.rating-big {
  font-size: 40px;
  color: var(--amber);
  text-align: center;
  margin: 10px 0 4px;
  line-height: 1;
}
.rating-big .unit {
  font-size: 11px;
  opacity: 0.55;
  margin-left: 6px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 14px;
}
.cell {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 9px 4px;
  text-align: center;
}
.cell .v {
  font-size: 18px;
}
.cell .l {
  font-size: 10px;
  color: var(--ink-dim);
  margin-top: 2px;
}
.tank {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
}
.label {
  font-size: 7px;
  color: var(--ink-faint);
  letter-spacing: 0.1em;
}
.medals {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--line-strong);
}
.medal-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 9px;
}
</style>
