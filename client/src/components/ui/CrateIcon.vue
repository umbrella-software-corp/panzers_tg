<script setup>
// Ящик снабжения (порт CrateIcon): деревянный ящик со звездой.
defineProps({
  size: { type: Number, default: 56 },
  tone: { type: String, default: '#8a6d3b' },
  star: { type: String, default: '#f2a50c' },
})
// уникальный id градиента на инстанс (иначе один градиент на все ящики)
const uid = `pzCrateShade-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 64 64">
    <rect x="6" y="12" width="52" height="42" rx="3" :fill="tone" />
    <rect x="6" y="12" width="52" height="42" rx="3" :fill="`url(#${uid})`" />
    <rect x="6" y="28" width="52" height="9" fill="#000" opacity=".18" />
    <rect x="3" y="10" width="58" height="7" rx="2" :fill="tone" stroke="#00000044" />
    <rect x="3" y="49" width="58" height="7" rx="2" :fill="tone" stroke="#00000044" />
    <path d="M32 22l2.5 5.4 5.9.6-4.4 4 1.2 5.8-5.2-3-5.2 3 1.2-5.8-4.4-4 5.9-.6z" :fill="star" opacity=".92" />
    <defs>
      <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".15" />
        <stop offset="1" stop-color="#000" stop-opacity=".28" />
      </linearGradient>
    </defs>
  </svg>
</template>
