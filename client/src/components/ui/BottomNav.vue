<script setup>
// Нижняя навигация (порт BottomNav): Ангар / Прокачка / Магазин.
import PzIcon from './PzIcon.vue'
import { haptic } from '../../tg.js'
defineProps({ screen: { type: String, required: true } })
const emit = defineEmits(['go'])
const tap = (id) => {
  haptic('select')
  emit('go', id)
}
const items = [
  { id: 'hangar', label: 'Ангар', icon: 'hangar' },
  { id: 'tree', label: 'Развитие', icon: 'tree' },
  { id: 'crew', label: 'Экипаж', icon: 'crew' },
  { id: 'shop', label: 'Магазин', icon: 'shop' },
  { id: 'rating', label: 'Рейтинг', icon: 'rank' },
]
</script>

<template>
  <nav class="pz-nav">
    <button
      v-for="it in items"
      :key="it.id"
      class="pz-nav-btn"
      :class="{ on: screen === it.id }"
      @click="tap(it.id)"
    >
      <PzIcon :name="it.icon" :size="24" />
      <span>{{ it.label }}</span>
    </button>
  </nav>
</template>
