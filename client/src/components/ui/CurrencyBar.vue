<script setup>
// Кредиты + жетоны (порт CurrencyBar). Клик ведёт в магазин.
import PzIcon from './PzIcon.vue'
import { fmtShort, fmtNum } from '../../i18n.js'

defineProps({
  credits: { type: Number, required: true },
  tokens: { type: Number, required: true },
})
const emit = defineEmits(['shop'])
// в шапке показываем КОМПАКТНО (6М / 10,1к), точное значение — в подсказке по наведению
</script>

<template>
  <div style="display: flex; gap: 6px">
    <button class="pz-chip" style="cursor: pointer" :title="fmtNum(credits)" @click="emit('shop')">
      <PzIcon name="coin" :size="14" /><span>{{ fmtShort(credits) }}</span>
    </button>
    <button class="pz-chip" style="cursor: pointer" :title="fmtNum(tokens)" @click="emit('shop')">
      <PzIcon name="token" :size="14" /><span>{{ fmtShort(tokens) }}</span>
    </button>
  </div>
</template>
