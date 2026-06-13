// One-time generator for Metal Art studio + Creator Hub imagery (flux-schnell).
// Saves to public/metal-art/ and public/hub/. Skips existing files.
// Run from repo root: node scripts/generate-metal-art-assets.mjs

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
let TOKEN = process.env.REPLICATE_API_TOKEN
if (!TOKEN) {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8')
  TOKEN = env.match(/^REPLICATE_API_TOKEN=(.+)$/m)?.[1]?.trim()
}
if (!TOKEN) { console.error('No REPLICATE_API_TOKEN'); process.exit(1) }

const ASSETS = [
  {
    dest: 'public/metal-art/wall-scene-living.webp',
    aspect: '4:3',
    prompt: 'interior photography of a modern stylish living room, large empty dark charcoal wall above an elegant sofa, warm ambient evening lighting, plants, minimal scandinavian decor, photorealistic, no artwork on the wall, no text',
  },
  {
    dest: 'public/metal-art/wall-scene-office.webp',
    aspect: '4:3',
    prompt: 'interior photography of a sleek home office, empty dark wall above a wooden desk with a lamp and laptop, moody warm lighting, photorealistic, no artwork on the wall, no text',
  },
  {
    dest: 'public/metal-art/plate-texture.webp',
    aspect: '1:1',
    prompt: 'close-up texture of brushed aluminum metal plate, fine vertical grain, silver grey, subtle reflections, full frame texture, no objects, no text',
  },
  {
    dest: 'public/hub/hub-apparel.webp',
    aspect: '4:3',
    prompt: 'premium product photography of a black t-shirt with a vibrant colorful fantasy dragon art print, floating on a deep purple studio background, dramatic rim lighting, high end ecommerce shot, no text, no person',
  },
  {
    dest: 'public/hub/hub-toys.webp',
    aspect: '4:3',
    prompt: 'product photography of a group of cute colorful 3D printed vinyl toy creature figurines on a glossy surface, deep purple studio background, dramatic lighting, shallow depth of field, no text',
  },
  {
    dest: 'public/hub/hub-metal.webp',
    aspect: '4:3',
    prompt: 'photography of a glossy metal art print poster with vibrant cosmic fantasy artwork hanging on a dark charcoal wall, dramatic gallery spot lighting, slight reflective metallic sheen, photorealistic interior, no text',
  },
]

async function run(model, input) {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input }),
  })
  let pred = await res.json()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(pred).slice(0, 200)}`)
  while (pred.status === 'starting' || pred.status === 'processing') {
    await new Promise(r => setTimeout(r, 2000))
    pred = await (await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
  }
  if (pred.status !== 'succeeded') throw new Error(`${pred.status} ${pred.error ?? ''}`)
  return Array.isArray(pred.output) ? pred.output[0] : pred.output
}

let ok = 0, skip = 0, fail = 0
for (const a of ASSETS) {
  const dest = path.join(ROOT, a.dest)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (fs.existsSync(dest)) { skip++; continue }
  try {
    const url = await run('black-forest-labs/flux-schnell', {
      prompt: a.prompt,
      aspect_ratio: a.aspect,
      output_format: 'webp',
      num_inference_steps: 4,
    })
    const r = await fetch(url)
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
    ok++
    console.log(`✅ ${a.dest}`)
  } catch (e) {
    fail++
    console.error(`❌ ${a.dest}: ${e.message}`)
  }
}
console.log(`Done: ${ok} generated, ${skip} skipped, ${fail} failed`)
if (fail > 0) process.exit(1)
