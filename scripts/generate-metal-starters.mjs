// Metal Art Studio — Step 1 style-starter thumbnails + inspiration images.
// Each starter is a rich, print-grade prompt (see STARTERS, mirrored in
// MetalArtStudio.tsx). Saves to public/metal-art/starters/. Skips existing.
// Run from repo root: node scripts/generate-metal-starters.mjs

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
let TOKEN = process.env.REPLICATE_API_TOKEN
if (!TOKEN) {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8')
  TOKEN = env.match(/^REPLICATE_API_TOKEN=(.+)$/m)?.[1]?.trim()
}
if (!TOKEN) { console.error('No REPLICATE_API_TOKEN'); process.exit(1) }

// slug → rich print-grade prompt. These are the SAME prompts the Step-1 starter
// chips prefill, so the thumbnail previews what the user will get.
export const STARTERS = {
  cosmic:    'A breathtaking cosmic nebula in deep space, swirling clouds of magenta, teal and gold, brilliant stars and a glowing galaxy core, ultra-detailed astrophotography, dramatic depth, vivid saturated color, gallery wall-art poster, high dynamic range, 2K, no text',
  fluid:     'Abstract fluid art, marbled swirls of metallic gold, sapphire blue and crimson, organic flowing shapes with high-gloss sheen, luxury gallery print, rich contrast, macro detail, elegant modern wall art, 2K, no text',
  deco:      'Bold Art Deco poster, symmetrical geometric sunburst, gold and black with emerald accents, 1920s luxury aesthetic, clean vector-sharp lines, high-contrast editorial composition, premium wall-art print, 2K, no text',
  travel:    'Vintage national-park travel poster, dramatic mountain range at golden hour, layered depth, screen-print texture, warm retro palette, bold composition, WPA poster style, gallery print, 2K, no text',
  botanical: 'Lush botanical illustration, monstera and tropical leaves, deep emerald and gold ink on dark background, fine detailed linework, elegant symmetrical layout, luxury wall-art print, 2K, no text',
  geometric: 'Minimal geometric abstract, bold interlocking shapes in muted earth tones with a single vivid accent, clean negative space, modern Scandinavian poster aesthetic, crisp edges, gallery print, 2K, no text',
  anime:     'Cinematic anime landscape, a lone figure on a hill beneath a vast sunset sky, sweeping clouds, vibrant Makoto Shinkai style color, dramatic lighting, ultra-detailed scenery, poster composition, 2K, no text',
  wildlife:  'Majestic wildlife portrait, a powerful lion in dramatic rim lighting against a dark background, hyper-detailed fur, intense gaze, fine-art photography, rich shadows, gallery wall print, 2K, no text',
}

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

const dir = path.join(ROOT, 'public', 'metal-art', 'starters')
fs.mkdirSync(dir, { recursive: true })

let ok = 0, skip = 0, fail = 0
for (const [slug, prompt] of Object.entries(STARTERS)) {
  const dest = path.join(dir, `${slug}.webp`)
  if (fs.existsSync(dest)) { skip++; continue }
  try {
    const url = await run('black-forest-labs/flux-schnell', {
      prompt, aspect_ratio: '1:1', output_format: 'webp', num_inference_steps: 4,
    })
    const r = await fetch(url)
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
    ok++; console.log(`✅ starter ${slug}`)
  } catch (e) { fail++; console.error(`❌ ${slug}: ${e.message}`) }
}
console.log(`Done: ${ok} generated, ${skip} skipped, ${fail} failed`)
if (fail > 0) process.exit(1)
