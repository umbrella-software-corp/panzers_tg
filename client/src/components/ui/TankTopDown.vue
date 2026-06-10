<script setup>
// Top-down силуэт танка (порт TankTopDown): корпус + гусеницы + башня + ствол.
import { computed } from 'vue'

const props = defineProps({
  size: { type: Number, default: 90 },
  color: { type: String, default: '#4da3ff' },
  dark: { type: String, default: '#1b3a5c' },
  angle: { type: Number, default: 0 },
  barrel: { type: Number, default: 1 },
})

const w = computed(() => props.size)
const h = computed(() => props.size * 1.28)
const treadRows = [...Array(8).keys()]
</script>

<template>
  <svg
    :width="w"
    :height="h"
    viewBox="0 0 100 128"
    :style="{ transform: `rotate(${angle}deg)`, display: 'block' }"
  >
    <!-- гусеницы -->
    <rect x="8" y="14" width="18" height="100" rx="7" :fill="dark" />
    <rect x="74" y="14" width="18" height="100" rx="7" :fill="dark" />
    <g opacity=".5">
      <g v-for="i in treadRows" :key="i">
        <rect x="10" :y="20 + i * 12" width="14" height="3.4" rx="1.6" fill="#000" opacity=".35" />
        <rect x="76" :y="20 + i * 12" width="14" height="3.4" rx="1.6" fill="#000" opacity=".35" />
      </g>
    </g>
    <!-- корпус -->
    <rect x="22" y="18" width="56" height="92" rx="9" :fill="color" />
    <rect x="22" y="18" width="56" height="92" rx="9" fill="url(#pzHullShade)" />
    <path d="M26 30 L50 21 L74 30" :stroke="dark" stroke-width="2.4" fill="none" opacity=".55" />
    <!-- ствол -->
    <rect x="46.4" :y="-26 * barrel + 26" width="7.2" :height="barrel * 44" rx="2.6" :fill="dark" />
    <rect x="44.6" :y="-26 * barrel + 22" width="10.8" height="7" rx="2" :fill="dark" />
    <!-- башня -->
    <circle cx="50" cy="58" r="21" :fill="dark" />
    <circle cx="50" cy="58" r="21" fill="url(#pzTurretShade)" />
    <circle cx="50" cy="58" r="8" :fill="color" opacity=".8" />
    <defs>
      <linearGradient id="pzHullShade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity=".14" />
        <stop offset=".5" stop-color="#fff" stop-opacity="0" />
        <stop offset="1" stop-color="#000" stop-opacity=".25" />
      </linearGradient>
      <radialGradient id="pzTurretShade" cx=".35" cy=".3" r="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".18" />
        <stop offset="1" stop-color="#000" stop-opacity=".3" />
      </radialGradient>
    </defs>
  </svg>
</template>
