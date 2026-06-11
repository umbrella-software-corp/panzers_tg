// Генерация спрайтов медалей через Replicate (recraft-v3 — чистые значки на
// прозрачном фоне). Использование:
//   REPLICATE_API_TOKEN=... node tools/gen-medals.mjs [id1 id2 ...]
// Без аргументов — генерит все. Кладёт в client/public/sprites/medals/<id>.png
import { mkdir, writeFile } from 'fs/promises'

const token = process.env.REPLICATE_API_TOKEN
if (!token) {
  console.error('нужен REPLICATE_API_TOKEN в окружении')
  process.exit(1)
}

// единый стиль: вид сверху, военный орден, прозрачный фон, по центру
const STYLE =
  'military award medal, top-down front view, ornate metal badge with ribbon, ' +
  'gunmetal and olive military style with amber gold accents, game UI icon, ' +
  'centered, isolated on transparent background, crisp, high detail, no text'

const MEDALS = {
  warrior: 'bronze valor medal, bold five-pointed star emblem, olive ribbon',
  sniper: 'gold ace medal, crosshair over a sunburst emblem, scarlet ribbon',
  firestorm: 'silver artillery medal, bursting shell with flames emblem',
  wall: 'silver defense medal, heavy riveted shield emblem',
  scout: 'bronze reconnaissance medal, watchful eye in a lens emblem',
  survivor: 'bronze survivor medal, laurel wreath around a helmet emblem',
  triumph: 'gold triumph medal, victory banner crossed with laurel branches',
  recruit: 'bronze service medal, single chevron emblem',
  veteran: 'silver veteran medal, crossed rifles emblem',
  guards: 'gold guards elite medal, wreathed star emblem, lavish',
  hunter: 'silver tank hunter medal, crossed cannons over a tank silhouette',
  ace: 'gold war ace medal, tank silhouette inside a laurel wreath',
  legend: 'gold grand order, royal crown emblem, ornate and lavish',
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MEDALS)
const outDir = new URL('../client/public/sprites/medals/', import.meta.url)
await mkdir(outDir, { recursive: true })

async function gen(id) {
  const prompt = `${MEDALS[id]}. ${STYLE}`
  const res = await fetch('https://api.replicate.com/v1/models/recraft-ai/recraft-v3/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, size: '1024x1024', style: 'digital_illustration', output_format: 'png' } }),
  })
  const data = await res.json()
  if (data.error || !data.output) {
    console.error(`FAIL ${id}:`, JSON.stringify(data).slice(0, 300))
    return false
  }
  const url = Array.isArray(data.output) ? data.output[0] : data.output
  const img = await fetch(url)
  const buf = Buffer.from(await img.arrayBuffer())
  await writeFile(new URL(`${id}.png`, outDir), buf)
  console.log(`OK ${id}.png ${(buf.length / 1024).toFixed(0)}KB`)
  return true
}

for (const id of ids) {
  if (!MEDALS[id]) {
    console.error(`нет медали ${id}`)
    continue
  }
  try {
    await gen(id)
  } catch (e) {
    console.error(`ERR ${id}:`, e.message)
  }
}
