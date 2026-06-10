<script setup>
// Строка статы 0..10 с сегментным баром (порт StatRow).
defineProps({
  label: { type: String, required: true },
  value: { type: Number, required: true },
})
</script>

<template>
  <div class="pz-stat">
    <div class="pz-stat-label">{{ label }}</div>
    <div class="pz-stat-track">
      <div class="pz-stat-fill" :style="{ width: value * 10 + '%' }"></div>
    </div>
    <div class="pz-stat-num">{{ value }}</div>
  </div>
</template>
