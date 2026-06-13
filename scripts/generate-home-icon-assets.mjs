// One-time generator: Home "How It Works" step images + bespoke 3D studio icons.
// Light-site styling (white/bright, purple accents). Skips existing files.
// Run from repo root: node scripts/generate-home-icon-assets.mjs

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
let TOKEN = process.env.REPLICATE_API_TOKEN
if (!TOKEN) {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8')
  TOKEN = env.match(/^REPLICATE_API_TOKEN=(.+)$/m)?.[1]?.trim()
}
if (!TOKEN) { console.error('No REPLICATE_API_TOKEN'); process.exit(1) }

const ICON_STYLE = 'glossy 3D app icon, isometric perspective, vibrant purple and white color palette, soft studio shadows, rounded square tile, clean white background, premium app store quality, no text'
const STEP_STYLE = 'bright clean photo-illustration, soft natural light, white and light-grey environment with vivid purple accent details, optimistic and modern, no text, no logos'

const ASSETS = [
  // How It Works steps (4:3 cards)
  { dest: 'public/home/how-1-dream.webp', aspect: '4:3', prompt: `a person at a bright desk imagining ideas, colorful glowing t-shirt design concepts floating above an open laptop as holograms, ${STEP_STYLE}` },
  { dest: 'public/home/how-2-create.webp', aspect: '4:3', prompt: `close-up of hands using a tablet design studio app showing a vibrant graphic being placed on a t-shirt mockup on screen, ${STEP_STYLE}` },
  { dest: 'public/home/how-3-print.webp', aspect: '4:3', prompt: `a modern garment printer printing a vivid colorful design onto a white t-shirt in a clean bright print workshop, ${STEP_STYLE}` },
  { dest: 'public/home/how-4-earn.webp', aspect: '4:3', prompt: `a happy young creator looking at a smartphone showing a sales dashboard with rising earnings, confetti-like purple accents in a bright room, ${STEP_STYLE}` },
  // Bespoke studio icons (1:1 tiles)
  { dest: 'public/icons/icon-toy-creator.webp', aspect: '1:1', prompt: `a cute chunky toy creature inside a glass laboratory capsule with a DNA strand, ${ICON_STYLE}` },
  { dest: 'public/icons/icon-metal-art.webp', aspect: '1:1', prompt: `a sleek brushed-metal art plate with a vibrant mountain sunset artwork, slightly tilted, ${ICON_STYLE}` },
  { dest: 'public/icons/icon-create-design.webp', aspect: '1:1', prompt: `a paintbrush painting a glowing design onto a folded t-shirt, ${ICON_STYLE}` },
  { dest: 'public/icons/icon-imagination-station.webp', aspect: '1:1', prompt: `a magical printing press with sparkles and floating sheets of colorful designs, ${ICON_STYLE}` },
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
      prompt: a.prompt, aspect_ratio: a.aspect, output_format: 'webp', num_inference_steps: 4,
    })
    const r = await fetch(url)
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
    ok++; console.log(`✅ ${a.dest}`)
  } catch (e) { fail++; console.error(`❌ ${a.dest}: ${e.message}`) }
}
console.log(`Done: ${ok} generated, ${skip} skipped, ${fail} failed`)
if (fail > 0) process.exit(1)
