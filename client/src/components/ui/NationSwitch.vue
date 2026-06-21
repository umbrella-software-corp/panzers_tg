<script setup>
// Переключатель наций — прокручиваемые пилюли (порт NationSwitch).
// Видимые нации выбираются; скрытые (без 3D-моделей, см. HIDDEN_NATIONS) показываем
// заглушкой «🔒 скоро» — нельзя выбрать, тап → пояснение у родителя (ветка не «пропала»).
import { visibleNations, hiddenNations } from '../../game/meta.js'
import { haptic } from '../../tg.js'
const NATIONS = visibleNations()
const SOON = hiddenNations()
defineProps({ nation: { type: String, required: true } })
const emit = defineEmits(['pick', 'note'])
const pick = (id) => {
  haptic('select')
  emit('pick', id)
}
const note = (id) => {
  haptic('select')
  emit('note', id)
}
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
      @click="pick(n.id)"
    >
      {{ n.label }}
    </button>
    <button
      v-for="n in SOON"
      :key="n.id"
      class="pz-display"
      :style="{
        flexShrink: 0,
        padding: '7px 14px 6px',
        fontSize: '11.5px',
        letterSpacing: '.14em',
        cursor: 'pointer',
        color: 'var(--ink-faint)',
        background: 'rgba(0,0,0,.45)',
        border: '1px dashed var(--line-strong)',
        borderRadius: '999px',
        opacity: 0.7,
      }"
      @click="note(n.id)"
    >
      🔒 {{ n.label }}
    </button>
  </div>
</template>
