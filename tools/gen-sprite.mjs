// Генерация спрайта через Replicate API.
// Использование: REPLICATE_API_TOKEN=... node tools/gen-sprite.mjs <model> <outfile> <aspect> "<prompt>"
const [model, outfile, aspect, prompt] = process.argv.slice(2)
const token = process.env.REPLICATE_API_TOKEN
if (!token || !prompt) {
  console.error('usage: REPLICATE_API_TOKEN=.. node gen-sprite.mjs <model> <out> <aspect> "<prompt>"')
  process.exit(1)
}

const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'wait=60',
  },
  body: JSON.stringify({
    input: { prompt, aspect_ratio: aspect, output_format: 'png', num_outputs: 1, megapixels: '1' },
  }),
})
const data = await res.json()
if (data.error || !data.output) {
  console.error('FAIL', JSON.stringify(data).slice(0, 400))
  process.exit(1)
}
const url = Array.isArray(data.output) ? data.output[0] : data.output
const img = await fetch(url)
const buf = Buffer.from(await img.arrayBuffer())
await (await import('fs/promises')).writeFile(outfile, buf)
console.log(`OK ${outfile} ${(buf.length / 1024).toFixed(0)}KB`)
