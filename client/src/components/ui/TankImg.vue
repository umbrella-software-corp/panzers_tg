<script setup>
// Реальный вид сверху танка (AI-спрайт /sprites/tanks/<id>.png на магента-
// хромакее) — режется в альфу на canvas. В текстурах ствол смотрит вниз,
// поэтому по умолчанию разворачиваем на 180°.
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  tankId: { type: String, required: true },
  size: { type: Number, default: 132 },
  rotate: { type: Number, default: 180 },
})

const canvas = ref(null)

function render() {
  const img = new Image()
  img.src = `/sprites/tanks/${props.tankId}.png`
  img.onload = () => {
    const c = canvas.value
    if (!c) return
    const S = 256
    c.width = S
    c.height = S
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, S, S)
    ctx.drawImage(img, 0, 0, S, S)
    const d = ctx.getImageData(0, 0, S, S)
    const p = d.data
    for (let i = 0; i < p.length; i += 4) {
      if (p[i] > p[i + 1] * 1.5 && p[i + 2] > p[i + 1] * 1.2) p[i + 3] = 0
    }
    ctx.putImageData(d, 0, 0)
  }
}

onMounted(render)
watch(() => props.tankId, render)
</script>

<template>
  <canvas ref="canvas" :style="{ width: size + 'px', height: size + 'px', transform: `rotate(${rotate}deg)`, display: 'block' }" />
</template>
