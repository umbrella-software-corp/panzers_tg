// Перегенерация прем-спрайтов в СТИЛЬ обычных танков (фидбек: премы были 3/4 и
// с запечённым камо → выбивались из стаи). Метод — image-to-image через
// flux-kontext-pro: берём УЖЕ идеальный обычный спрайт (top-down, плоский оливковый,
// магента-хромакей, ствол вниз) и лишь МЕНЯЕМ СИЛУЭТ под нужную реальную машину,
// жёстко фиксируя камеру/фон/покраску. Так top-down и стиль гарантированы базой.
//   REPLICATE_API_TOKEN=... node tools/gen-premium.mjs <premId|all>
// Кладёт в tools/premium-out/<premId>.png (стейджинг — посмотреть перед заменой
// живых в client/public/sprites/tanks/). Готовые файлы пропускаются (resume);
// чтобы перегенерить один — удали его из premium-out или передай его id.
import { mkdir, readFile, writeFile, access } from 'fs/promises'

const token = process.env.REPLICATE_API_TOKEN
if (!token) {
  console.error('нужен REPLICATE_API_TOKEN')
  process.exit(1)
}

// прем → { base: обычный спрайт-донор, desc: целевой силуэт реальной машины }
const PREMIUM = {
  sper: {
    base: 'per',
    desc: 'an American Super Pershing T26E4 heavy tank — like the base Pershing but with a much longer 90mm main gun and a thick slab of extra applique armor bolted onto the front of the turret mantlet and the upper hull glacis',
  },
  pz4h: {
    base: 'pz4',
    desc: 'a German Panzer IV Ausf. H medium tank with a long 75mm KwK40 gun and flat Schürzen spaced side-skirt armor plates running along both sides of the hull and around the turret',
  },
  ram: {
    base: 'sher',
    desc: 'a Canadian Ram II cruiser tank — a Sherman-style cast rounded hull with a smaller cast central turret carrying a shorter 6-pounder gun, riveted hull sides',
  },
  t54: {
    base: 't72',
    desc: 'a Soviet T-54 medium tank with a smooth rounded dome-shaped cast turret set forward, a steeply sloped glacis plate and a long 100mm gun',
  },
  maus: {
    base: 'tgr2',
    desc: 'a German Maus super-heavy tank — a very wide, very long, low flat rectangular boxy hull with one massive flat-topped boxy turret centered on top carrying a long 128mm main gun, heavy super-heavy proportions',
  },
  t28: {
    base: 't34',
    desc: 'a Soviet T-28 from the 1930s, a distinctive MULTI-TURRET medium tank on a long riveted hull: one big central main turret with a short gun, and in front of it TWO separate small round raised machine-gun sub-turrets — one on the left and one on the right — clearly standing up as their own little turrets, this multi-turret layout is the defining feature and must be obvious',
  },
}

const arg = process.argv[2]
if (!arg) {
  console.error('usage: node tools/gen-premium.mjs <premId|all>   ids: ' + Object.keys(PREMIUM).join(' '))
  process.exit(1)
}
const ids = arg === 'all' ? Object.keys(PREMIUM) : [arg]
for (const id of ids) if (!PREMIUM[id]) { console.error(`нет такого према: ${id}`); process.exit(1) }

const CONCURRENCY = +(process.env.CONCURRENCY || 2)
const DELAY_MS = +(process.env.DELAY_MS || 0)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const outDir = new URL('./premium-out/', import.meta.url)
await mkdir(outDir, { recursive: true })
const exists = async (p) => { try { await access(p); return true } catch { return false } }

async function gen(id) {
  const { base, desc } = PREMIUM[id]
  const outPath = new URL(`${id}.png`, outDir)
  if (await exists(outPath)) { console.log(`skip ${id} (есть в premium-out)`); return true }
  if (DELAY_MS) await sleep(DELAY_MS)
  // РЕЖИМ ПО ЧЕРТЕЖУ: если лежит tools/ref/<id>.png (top-down план машины, уже
  // повёрнутый стволом ВНИЗ) — берём геометрию из него и просто рендерим в наш стиль.
  // Иначе — донорский режим (силуэт обычного танка-донора).
  const refPath = new URL(`./ref/${id}.png`, import.meta.url)
  const useRef = await exists(refPath)
  const srcPath = useRef ? refPath : new URL(`../client/public/sprites/tanks/${base}.png`, import.meta.url)
  const srcBuf = await readFile(srcPath)
  const dataUri = `data:image/png;base64,${srcBuf.toString('base64')}`
  const prompt = useRef
    ? `The input is a top-down plan-view blueprint line drawing of a tank, seen straight from directly overhead, with the main gun already pointing straight down. ` +
      `Render it as a crisp, fully shaded 3D-modeled top-down tank game sprite that EXACTLY follows this overhead silhouette, layout and proportions — it is ${desc}. ` +
      `Keep the directly-overhead orthographic bird's-eye view and the main gun pointing straight down; do NOT tilt or add perspective. ` +
      `Paint it plain matte olive-drab green with NO camouflage pattern. Place it on a SOLID MAGENTA background with a soft drop shadow. ` +
      `Sharp clean hard edges, high-detail game asset — fully rendered and shaded, NOT line-art, NOT a sketch, NOT blurry. Center it in a square frame.`
    : `This is a 2D top-down tank game sprite seen straight from directly overhead (orthographic bird's-eye plan view, satellite view). ` +
      `WITHOUT changing the camera at all, keep the EXACT same overhead top-down viewpoint as the input image. ` +
      `Only reshape the tank's outline and silhouette into ${desc}. ` +
      `The main gun barrel must point straight down in the image. ` +
      `Do NOT tilt, rotate, or switch to a 3D / isometric / perspective / three-quarter angle — it must stay a flat directly-overhead view. ` +
      `Keep the tank at the SAME size, scale and centered position in the frame as the input — do not zoom in, do not crop tighter, do not enlarge it. ` +
      `Keep the identical plain matte olive-drab green paint with NO camouflage pattern, the identical soft drop shadow, ` +
      `and keep the solid magenta background completely unchanged. ` +
      `Render it crisp and sharp with clean hard edges like a high-detail game asset — NOT blurry, NOT painterly, NOT smudged.`
  const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, input_image: dataUri, output_format: 'png', aspect_ratio: 'match_input_image' } }),
  })
  const data = await res.json()
  if (data.error || !data.output) { console.error(`FAIL ${id}:`, JSON.stringify(data).slice(0, 200)); return false }
  const url = Array.isArray(data.output) ? data.output[0] : data.output
  const img = await fetch(url)
  const buf = Buffer.from(await img.arrayBuffer())
  await writeFile(outPath, buf)
  console.log(`OK ${id}.png (${useRef ? 'по чертежу' : 'база ' + base}) ${(buf.length / 1024).toFixed(0)}KB`)
  return true
}

let idx = 0, ok = 0, fail = 0
async function worker() {
  while (idx < ids.length) {
    const id = ids[idx++]
    try { (await gen(id)) ? ok++ : fail++ } catch (e) { console.error(`ERR ${id}:`, e.message); fail++ }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`\nИТОГО: ok=${ok} fail=${fail}. Файлы в tools/premium-out/ — посмотри и скопируй в client/public/sprites/tanks/`)
