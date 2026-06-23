// Генерация картинки через Replicate с ПОЛЛИНГОМ (надёжнее, чем Prefer:wait — flux-dev
// холодно стартует дольше 60с). Использование:
//   REPLICATE_API_TOKEN=... node tools/gen-img.mjs <model> <outfile> <aspect> "<prompt>"
const [model, outfile, aspect, prompt] = process.argv.slice(2)
const token = process.env.REPLICATE_API_TOKEN
if (!token || !prompt) { console.error('usage: gen-img.mjs <model> <out> <aspect> "<prompt>"'); process.exit(1) }
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

const start = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ input: { prompt, aspect_ratio: aspect, output_format: 'png', num_outputs: 1, megapixels: '1', go_fast: true } }),
})
let data = await start.json()
if (data.error) { console.error('START FAIL', JSON.stringify(data).slice(0, 300)); process.exit(1) }
const id = data.id
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 120 && !(data.status === 'succeeded' || data.status === 'failed' || data.status === 'canceled'); i++) {
  await sleep(2000)
  data = await (await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: H })).json()
}
if (data.status !== 'succeeded' || !data.output) { console.error('FAIL', data.status, JSON.stringify(data.error || '').slice(0, 200)); process.exit(1) }
const url = Array.isArray(data.output) ? data.output[0] : data.output
const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
await (await import('fs/promises')).writeFile(outfile, buf)
console.log(`OK ${outfile} ${(buf.length / 1024).toFixed(0)}KB`)
