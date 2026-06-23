// image -> 3D GLB через Replicate TRELLIS (текстурированный меш, фон удаляется).
// Использование: REPLICATE_API_TOKEN=... node tools/gen-3d.mjs <infile.png> <out.glb> [mesh_simplify]
import { readFile, writeFile } from 'fs/promises'
const [infile, outfile, simplifyArg] = process.argv.slice(2)
const token = process.env.REPLICATE_API_TOKEN
if (!token || !infile || !outfile) { console.error('usage: gen-3d.mjs <in.png> <out.glb> [mesh_simplify]'); process.exit(1) }
const VERSION = 'e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c' // firtoz/trellis
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

const b64 = (await readFile(infile)).toString('base64')
const dataUri = `data:image/png;base64,${b64}`
const start = await fetch('https://api.replicate.com/v1/predictions', {
  method: 'POST', headers: H,
  body: JSON.stringify({
    version: VERSION,
    input: {
      images: [dataUri],
      generate_model: true, generate_color: true, generate_normal: false,
      return_no_background: true,
      texture_size: 1024,
      mesh_simplify: simplifyArg ? +simplifyArg : 0.92,
      ss_sampling_steps: 18, slat_sampling_steps: 18,
    },
  }),
})
let data = await start.json()
if (data.error || !data.id) { console.error('START FAIL', JSON.stringify(data).slice(0, 400)); process.exit(1) }
const id = data.id
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
process.stdout.write(`pred ${id} `)
for (let i = 0; i < 180 && !['succeeded', 'failed', 'canceled'].includes(data.status); i++) {
  await sleep(3000); process.stdout.write('.')
  data = await (await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: H })).json()
}
process.stdout.write('\n')
if (data.status !== 'succeeded') { console.error('FAIL', data.status, JSON.stringify(data.error || '').slice(0, 200)); process.exit(1) }
// найти .glb в выходе (строка / массив / объект {model_file})
let glb = null
const scan = (v) => { if (glb) return; if (typeof v === 'string') { if (v.endsWith('.glb') || v.includes('.glb?')) glb = v } else if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === 'object') Object.values(v).forEach(scan) }
scan(data.output)
if (!glb) { console.error('NO GLB in output:', JSON.stringify(data.output).slice(0, 300)); process.exit(1) }
const buf = Buffer.from(await (await fetch(glb)).arrayBuffer())
await writeFile(outfile, buf)
console.log(`OK ${outfile} ${(buf.length / 1024).toFixed(0)}KB`)
