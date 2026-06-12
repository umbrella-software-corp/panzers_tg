<script setup>
// Эмблема клана: символ в цвете на тёмном щитке. По id из CLAN_EMBLEMS.
import { computed } from 'vue'
import { CLAN_EMBLEM_BY_ID } from '../../game/meta.js'

const props = defineProps({
  emblem: { type: String, default: 'e1' },
  size: { type: Number, default: 40 },
})
const e = computed(() => CLAN_EMBLEM_BY_ID[props.emblem] || CLAN_EMBLEM_BY_ID.e1)
</script>

<template>
  <div class="cl-emb" :style="{ width: size + 'px', height: size + 'px', '--c': e.col, fontSize: size * 0.5 + 'px' }">{{ e.sym }}</div>
</template>

<style scoped>
.cl-emb {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 28%;
  color: var(--c);
  background: radial-gradient(circle at 38% 30%, color-mix(in srgb, var(--c) 26%, #11151c), #0b0e13 80%);
  border: 1.5px solid var(--c);
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.5);
  line-height: 1;
  text-shadow: 0 0 6px color-mix(in srgb, var(--c) 50%, transparent);
}
</style>
