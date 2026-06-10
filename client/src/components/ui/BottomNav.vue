<script setup>
// Нижняя навигация (порт BottomNav): Ангар / Прокачка / Магазин.
import PzIcon from './PzIcon.vue'
defineProps({ screen: { type: String, required: true } })
const emit = defineEmits(['go'])
const items = [
  { id: 'hangar', label: 'Ангар', icon: 'hangar' },
  { id: 'tree', label: 'Прокачка', icon: 'tree' },
  { id: 'shop', label: 'Магазин', icon: 'shop' },
]
</script>

<template>
  <nav class="pz-nav">
    <button
      v-for="it in items"
      :key="it.id"
      class="pz-nav-btn"
      :class="{ on: screen === it.id }"
      @click="emit('go', it.id)"
    >
      <PzIcon :name="it.icon" :size="24" />
      <span>{{ it.label }}</span>
    </button>
  </nav>
</template>
