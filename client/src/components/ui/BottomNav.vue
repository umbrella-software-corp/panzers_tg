<script setup>
// Нижняя навигация (порт BottomNav): Ангар / Прокачка / Магазин.
import PzIcon from './PzIcon.vue'
import { haptic } from '../../tg.js'
import { t } from '../../i18n.js'
defineProps({ screen: { type: String, required: true } })
const emit = defineEmits(['go'])
const tap = (id) => {
  haptic('select')
  emit('go', id)
}
const items = [
  { id: 'hangar', label: t('nav.hangar'), icon: 'hangar' },
  { id: 'tree', label: t('nav.tree'), icon: 'tree' },
  { id: 'crew', label: t('nav.crew'), icon: 'crew' },
  { id: 'shop', label: t('nav.shop'), icon: 'shop' },
  { id: 'rating', label: t('nav.rating'), icon: 'rank' },
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
