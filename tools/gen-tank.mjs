// Генерация спрайтов ПЛАТНЫХ (премиум) танков через Replicate flux — строго вид
// сверху на МАГЕНТА-хромакее, в одном стиле с базовыми машинами (их так же режет
// в альфу _chromaKey в TankImg.vue). Использование:
//   REPLICATE_API_TOKEN=... node tools/gen-tank.mjs <tankId|all> [tankId...]
// Без id (или `all`) — генерит все 6 премиум-танков. Уже готовые файлы НЕ
// пропускаются (это перегенерация): чтобы не затирать — удали лишние id из
// аргументов. Кладёт в client/public/sprites/tanks/<id>.png
import { mkdir, writeFile } from 'fs/promises'

const token = process.env.REPLICATE_API_TOKEN
if (!token) {
  console.error('нужен REPLICATE_API_TOKEN в окружении')
  process.exit(1)
}

// модель flux: тот же вход (aspect_ratio/num_outputs/megapixels), что и в gen-sprite.mjs
const MODEL = process.env.MODEL || 'black-forest-labs/flux-dev'

// единый стиль — копия проверенной «top-down магента» формулировки из gen-camo.mjs,
// чтобы прем-спрайты сели ровно в стиль базовых танков (а не в 3/4-перспективе)
const STYLE =
  'STRICT orthographic top-down plan view photographed from directly above (satellite view), ' +
  'the gun barrel points straight down in the image. Flat top-down angle, no 3D, no isometric, ' +
  'no perspective tilt — the whole vehicle is seen from directly overhead. Centered, single tank, ' +
  'full vehicle in frame. Realistic painted scale-model look, soft top light, subtle drop shadow. ' +
  'SOLID bright magenta (#ff00ff) background, no ground texture, no grass, no text, no UI.'

// реальные машины (см. locales/game.js) — описываем силуэт сверху
const TANKS = {
  t28: 'Soviet T-28 multi-turret medium tank, long boxy hull, one large central turret with a long gun plus two small machine-gun sub-turrets in front, dark olive green paint',
  t54: 'Soviet T-54 post-war medium tank, rounded dome turret, long smooth gun barrel, sloped hull, dark olive green paint',
  pz4h: 'German Panzer IV Ausf. H medium tank with side skirts (Schürzen) along the hull and turret, boxy turret, long 75mm gun, grey-green paint',
  maus: 'German Panzer VIII Maus super-heavy tank, enormous very wide boxy hull, huge slab turret, massive long gun, grey paint',
  ram: 'Canadian Ram II cruiser medium tank, cast rounded hull and turret, short stubby gun, olive green paint',
  sper: 'American T26E4 Super Pershing heavy tank, up-armored thick spaced front plate, long high-velocity gun, olive drab paint',
}

const args = process.argv.slice(2).filter((a) => a !== 'all')
const ids = args.length ? args : Object.keys(TANKS)
const outDir = new URL('../client/public/sprites/tanks/', import.meta.url)
await mkdir(outDir, { recursive: true })

async function gen(id) {
  const prompt = `${TANKS[id]}. ${STYLE}`
  const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '1:1', output_format: 'png', num_outputs: 1, megapixels: '1' } }),
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

let ok = 0
let fail = 0
for (const id of ids) {
  if (!TANKS[id]) {
    console.error(`нет премиум-танка ${id} (есть: ${Object.keys(TANKS).join(', ')})`)
    continue
  }
  try {
    ;(await gen(id)) ? ok++ : fail++
  } catch (e) {
    console.error(`ERR ${id}:`, e.message)
    fail++
  }
}
console.log(`\nИТОГО: ok=${ok} fail=${fail} из ${ids.length}`)
