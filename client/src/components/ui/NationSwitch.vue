<script setup>
// Переключатель наций — прокручиваемые пилюли (порт NationSwitch).
import { NATIONS } from '../../game/meta.js'
defineProps({ nation: { type: String, required: true } })
const emit = defineEmits(['pick'])
</script>

<template>
  <div
    class="pz-noscroll"
    style="
      display: flex;
      gap: 6px;
      overflow-x: auto;
      -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent);
      mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent);
      padding-right: 28px;
    "
  >
    <button
      v-for="n in NATIONS"
      :key="n.id"
      class="pz-display"
      :style="{
        flexShrink: 0,
        padding: '7px 14px 6px',
        fontSize: '11.5px',
        letterSpacing: '.14em',
        cursor: 'pointer',
        color: nation === n.id ? '#1d1604' : 'var(--ink-dim)',
        background:
          nation === n.id
            ? 'linear-gradient(180deg, var(--amber-hi), var(--amber))'
            : 'rgba(0,0,0,.45)',
        border: '1px solid ' + (nation === n.id ? 'transparent' : 'var(--line-strong)'),
        borderRadius: '999px',
      }"
      @click="emit('pick', n.id)"
    >
      {{ n.label }}
    </button>
  </div>
</template>
