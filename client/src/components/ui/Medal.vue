<script setup>
// Значок медали: спрайт /sprites/medals/<id>.png, при отсутствии — векторный
// диск цвета тира с символом-глифом. Опционально: счётчик ×N, замок, «НОВАЯ».
import { ref } from 'vue'
import { MEDAL_TIER_COLOR } from '../../game/meta.js'

const props = defineProps({
  medal: { type: Object, required: true },
  size: { type: Number, default: 56 },
  count: { type: Number, default: 0 },
  locked: { type: Boolean, default: false },
  isNew: { type: Boolean, default: false },
})
const failed = ref(false)
const color = () => MEDAL_TIER_COLOR[props.medal.tier] || MEDAL_TIER_COLOR.bronze
</script>

<template>
  <div class="medal" :class="{ locked }" :style="{ width: size + 'px' }">
    <div class="disc" :class="{ art: !failed }" :style="{ width: size + 'px', height: size + 'px', '--mc': color() }">
      <img v-if="!failed" :src="`/sprites/medals/${medal.id}.png`" :alt="medal.name" @error="failed = true" />
      <span v-else class="glyph" :style="{ fontSize: size * 0.5 + 'px' }">{{ medal.glyph }}</span>
      <span v-if="count > 1" class="count pz-display">×{{ count }}</span>
      <span v-if="isNew" class="new pz-pixel">NEW</span>
    </div>
  </div>
</template>

<style scoped>
.medal {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.disc {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, color-mix(in srgb, var(--mc) 65%, #fff 0%), #11151c 78%);
  border: 2px solid var(--mc);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35), inset 0 0 10px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
/* когда подгружен спрайт-медаль — без диск-рамки, картинка как настоящий значок */
.disc.art {
  background: none;
  border: none;
  box-shadow: none;
  overflow: visible;
}
.disc img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.55));
}
.glyph {
  color: var(--mc);
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--mc) 40%, transparent));
}
.count {
  position: absolute;
  right: -2px;
  bottom: -2px;
  min-width: 18px;
  height: 16px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #0b0e13;
  background: var(--mc);
  border-radius: 8px;
  border: 1.5px solid #0b0e13;
}
.new {
  position: absolute;
  top: -3px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 6px;
  letter-spacing: 0.06em;
  color: #0b0e13;
  background: var(--amber);
  padding: 1.5px 3px;
  border-radius: 3px;
}
.locked .disc {
  filter: grayscale(1) brightness(0.5);
  opacity: 0.6;
}
.locked .disc img {
  opacity: 0.4;
}
</style>
