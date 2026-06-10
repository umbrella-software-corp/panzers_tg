<script setup>
// Набор UI-иконок (порт PzIcon из прототипа). name — какой глиф.
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 16 },
  color: { type: String, default: 'currentColor' },
})
</script>

<template>
  <svg v-if="name === 'coin'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" fill="#f2a50c" stroke="#7a5206" stroke-width="1.4" />
    <circle cx="8" cy="8" r="3.6" fill="none" stroke="#7a5206" stroke-width="1.2" stroke-dasharray="2 1.6" />
  </svg>
  <svg v-else-if="name === 'token'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.5" transform="rotate(45 8 8)" fill="#4da3ff" stroke="#1b4d85" stroke-width="1.3" />
  </svg>
  <svg v-else-if="name === 'star'" :width="size" :height="size" viewBox="0 0 16 16" :fill="color">
    <path d="M8 1.6l1.9 4 4.4.5-3.3 3 0.9 4.4L8 11.3l-3.9 2.2.9-4.4-3.3-3 4.4-.5z" />
  </svg>
  <svg v-else-if="name === 'lock'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="currentColor" stroke="none" opacity=".9" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
  </svg>
  <svg v-else-if="name === 'hangar'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
    <path d="M3 19V10l9-5.5L21 10v9" />
    <path d="M8 19v-5h8v5" />
    <path d="M3 19h18" stroke-linecap="round" />
  </svg>
  <svg v-else-if="name === 'tree'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
    <circle cx="12" cy="5" r="2.4" /><circle cx="6" cy="19" r="2.4" /><circle cx="18" cy="19" r="2.4" />
    <path d="M12 7.5V12m0 0l-4.6 5M12 12l4.6 5" />
  </svg>
  <svg v-else-if="name === 'shop'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
    <path d="M4 8h16l-1.2 12.2a1.5 1.5 0 01-1.5 1.3H6.7a1.5 1.5 0 01-1.5-1.3z" />
    <path d="M8.5 10.5V6.8a3.5 3.5 0 017 0v3.7" stroke-linecap="round" />
  </svg>
  <svg v-else-if="name === 'pause'" :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
  <!-- иконки слотов модулей (порт PZ_MOD_ICONS) -->
  <svg v-else-if="name === 'gun'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M3 12h13" />
    <path d="M16 9.5h5v5h-5z" fill="currentColor" stroke="none" opacity=".85" />
    <path d="M3 9.5v5" />
  </svg>
  <svg v-else-if="name === 'tur'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <circle cx="12" cy="13" r="6" />
    <path d="M12 7V2.5" stroke-linecap="round" />
    <circle cx="12" cy="13" r="2" fill="currentColor" stroke="none" />
  </svg>
  <svg v-else-if="name === 'eng'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
    <path d="M5 9h4l2-2h5v3h3v6h-3l-2 2H7l-2-3H3v-4h2z" />
  </svg>
  <svg v-else-if="name === 'trk'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <rect x="2.5" y="8" width="19" height="8" rx="4" />
    <circle cx="7" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="17" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
  <svg v-else-if="name === 'rad'" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M12 21v-7" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M7.5 7.5a6.4 6.4 0 019 0M5 5a10 10 0 0114 0" />
  </svg>
</template>
