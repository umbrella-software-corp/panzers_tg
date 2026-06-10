<script setup>
// Кредиты + жетоны (порт CurrencyBar). Клик ведёт в магазин.
import PzIcon from './PzIcon.vue'

defineProps({
  credits: { type: Number, required: true },
  tokens: { type: Number, required: true },
})
const emit = defineEmits(['shop'])
const fmt = (n) => n.toLocaleString('ru-RU')
</script>

<template>
  <div style="display: flex; gap: 6px">
    <button class="pz-chip" style="cursor: pointer" @click="emit('shop')">
      <PzIcon name="coin" :size="14" /><span>{{ fmt(credits) }}</span>
    </button>
    <button class="pz-chip" style="cursor: pointer" @click="emit('shop')">
      <PzIcon name="token" :size="14" /><span>{{ tokens }}</span>
    </button>
  </div>
</template>
