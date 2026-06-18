<script setup>
// Реальный вид сверху танка (AI-спрайт /sprites/tanks/<id>.png на магента-
// хромакее) — режется в альфу на canvas. В текстурах ствол смотрит вниз,
// поэтому по умолчанию разворачиваем на 180°.
import { ref, watch, onMounted } from 'vue'
import { SKIN_BY_ID } from '../../game/meta.js'
import { applyCamo } from '../../game/camo.js'

const props = defineProps({
  tankId: { type: String, required: true },
  size: { type: Number, default: 132 },
  rotate: { type: Number, default: 180 },
  tint: { type: Number, default: 0xffffff }, // камуфляж-оттенок (фоллбэк)
  skin: { type: String, default: '' }, // id скина — узорный камуфляж поверх (старое)
  camo: { type: String, default: '' }, // per-tank камуфляж — отдельный AI-спрайт
  hangar: { type: Boolean, default: false }, // детальный hangar-рендер /sprites/hangar/<id>.png (только когда нет камо)
})

const canvas = ref(null)

function render() {
  const img = new Image()
  // камуфляж — отдельный перекрашенный спрайт на той же магенте; кеится так же.
  // при ошибке загрузки (камо ещё не сгенерён) откатываемся на базовый спрайт.
  const usingCamo = !!props.camo
  // hangar-рендер — детальный спрайт для большого превью в ангаре; только когда нет камо
  const usingHangar = !usingCamo && props.hangar
  img.src = usingCamo
    ? `/sprites/camo/${props.tankId}_${props.camo}.png`
    : usingHangar
      ? `/sprites/hangar/${props.tankId}.png`
      : `/sprites/tanks/${props.tankId}.png`
  img.onerror = () => {
    // камо ещё не сгенерён ИЛИ нет hangar-рендера → откат на базовый заводской спрайт
    if (usingCamo || usingHangar) {
      img.onerror = null
      img.src = `/sprites/tanks/${props.tankId}.png`
    }
  }
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
    // при per-tank камуфляже / hangar-рендере спрайт уже перекрашен — старый узор/оттенок не нужны
    const camo = usingCamo || usingHangar ? null : (SKIN_BY_ID[props.skin] || {}).camo
    const tr = (props.tint >> 16) & 0xff
    const tg = (props.tint >> 8) & 0xff
    const tb = props.tint & 0xff
    const tinted = !usingCamo && !usingHangar && !camo && props.tint !== 0xffffff
    for (let i = 0; i < p.length; i += 4) {
      if (p[i] > p[i + 1] * 1.5 && p[i + 2] > p[i + 1] * 1.2) {
        p[i + 3] = 0
      } else if (tinted) {
        p[i] = (p[i] * tr) / 255
        p[i + 1] = (p[i + 1] * tg) / 255
        p[i + 2] = (p[i + 2] * tb) / 255
      }
    }
    ctx.putImageData(d, 0, 0)
    if (camo) applyCamo(ctx, S, camo)
  }
}

onMounted(render)
watch(() => [props.tankId, props.tint, props.skin, props.camo, props.hangar], render)
</script>

<template>
  <canvas ref="canvas" :style="{ width: size + 'px', height: size + 'px', transform: `rotate(${rotate}deg)`, display: 'block' }" />
</template>
