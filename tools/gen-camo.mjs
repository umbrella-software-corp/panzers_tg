// Перекраска танков в камуфляж через Replicate flux-kontext (image editing —
// держит силуэт машины, меняет только покраску). Вход — наш танковый спрайт
// (top-down на МАГЕНТА-хромакее), выход — он же в камо на том же фоне, который
// потом кеится в приложении тем же _chromaKey. По 3 камо на танк.
//   REPLICATE_API_TOKEN=... node tools/gen-camo.mjs <tankId|all> [camoId...]
// Уже готовые файлы пропускаются (resume). Кладёт в
//   client/public/sprites/camo/<tankId>_<camoId>.png
import { mkdir, readFile, writeFile, access } from 'fs/promises'

const token = process.env.REPLICATE_API_TOKEN
if (!token) {
  console.error('нужен REPLICATE_API_TOKEN')
  process.exit(1)
}
const [arg, ...camoArgs] = process.argv.slice(2)
if (!arg) {
  console.error('usage: node tools/gen-camo.mjs <tankId|all> [camoId...]')
  process.exit(1)
}

const ALL_TANKS = [
  't26', 'bt7', 't34', 't3485', 'kv1', 'is2', 't72', 't90', 't80u', 't14',
  'pz2', 'pz3', 'pz4', 'pnt', 'tgr', 'tgr2', 'leo1', 'leo2', 'leo2a7', 'kf51',
  'm2l', 'stu', 'sher', 'e8', 'per', 'm48', 'm60', 'abr', 'm1a2', 'abrx',
]
const CAMO = {
  woodland: 'a green and brown woodland camouflage pattern with irregular disruptive blotches',
  desert: 'a tan and sand-brown desert camouflage pattern with pale ochre blotches',
  winter: 'a white and pale-grey winter camouflage pattern with snow-grey splotches',
}

const tanks = arg === 'all' ? ALL_TANKS : [arg]
const camos = camoArgs.length ? camoArgs : Object.keys(CAMO)
const CONCURRENCY = 3

const outDir = new URL('../client/public/sprites/camo/', import.meta.url)
await mkdir(outDir, { recursive: true })

const exists = async (p) => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function gen(tankId, camoId) {
  const outPath = new URL(`${tankId}_${camoId}.png`, outDir)
  if (await exists(outPath)) {
    console.log(`skip ${tankId}_${camoId} (есть)`)
    return true
  }
  const tankBuf = await readFile(new URL(`../client/public/sprites/tanks/${tankId}.png`, import.meta.url))
  const dataUri = `data:image/png;base64,${tankBuf.toString('base64')}`
  const prompt =
    `Repaint only the tank's hull and turret with ${CAMO[camoId]}. ` +
    `Keep the exact same tank shape, size, orientation and top-down camera angle. ` +
    `Keep the solid magenta background completely unchanged. Photorealistic military vehicle.`
  const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, input_image: dataUri, output_format: 'png', aspect_ratio: 'match_input_image' } }),
  })
  const data = await res.json()
  if (data.error || !data.output) {
    console.error(`FAIL ${tankId}_${camoId}:`, JSON.stringify(data).slice(0, 200))
    return false
  }
  const url = Array.isArray(data.output) ? data.output[0] : data.output
  const img = await fetch(url)
  const buf = Buffer.from(await img.arrayBuffer())
  await writeFile(outPath, buf)
  console.log(`OK ${tankId}_${camoId}.png ${(buf.length / 1024).toFixed(0)}KB`)
  return true
}

// очередь пар (tank,camo) с ограничением параллельности
const jobs = []
for (const t of tanks) for (const c of camos) if (CAMO[c]) jobs.push([t, c])
let idx = 0
let ok = 0
let fail = 0
async function worker() {
  while (idx < jobs.length) {
    const [t, c] = jobs[idx++]
    try {
      ;(await gen(t, c)) ? ok++ : fail++
    } catch (e) {
      console.error(`ERR ${t}_${c}:`, e.message)
      fail++
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`\nИТОГО: ok=${ok} fail=${fail} из ${jobs.length}`)
