// One-time generator for the help + contact pages (task 5878a61f, mockup approved by David 2026-10-07,
// approval dca0616d). Faceless page art goes to Flux 2 Pro on Replicate (creative playbook routing, ~3c each).
// Originals land in E:/generated-images/itp-support/originals; the site gets compressed webp in public/support/.
// Skips files that already exist. Run from repo root: node scripts/generate-support-art.mjs [--only slot]

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

const ROOT = process.cwd()
let TOKEN = process.env.REPLICATE_API_TOKEN
for (const envPath of [path.join(ROOT, 'backend', '.env'), 'D:/Projects for MetaSphere/imagine-this-printed/backend/.env']) {
  if (TOKEN) break
  if (fs.existsSync(envPath)) TOKEN = fs.readFileSync(envPath, 'utf8').match(/^REPLICATE_API_TOKEN=(.+)$/m)?.[1]?.trim()
}
if (!TOKEN) { console.error('No REPLICATE_API_TOKEN'); process.exit(1) }

const ORIGINALS = 'E:/generated-images/itp-support/originals'
const NO = 'no people, no faces, no text, no letters, no logos, no watermark'

const ASSETS = [
  {
    slot: 'hero', width: 1600, quality: 70, aspect: '16:9',
    prompt: `wide editorial photograph of a sunny small-town custom t-shirt print shop workbench, neat stacks of folded cotton t-shirts in lavender, soft pink, white and sky blue beside a heat press, rolls of transfer film and a potted plant, warm morning window light, airy bright palette with soft purple and pink accents, the left third of the frame is calm soft-focus wall for text, shallow depth of field, photorealistic, ${NO}`,
  },
  {
    slot: 'door-answers', width: 1000, quality: 76, aspect: '4:3',
    prompt: `overhead product photograph of neatly folded cotton t-shirts in lavender, pink and teal with a yellow tailor's measuring tape curled across them, soft natural daylight, clean light background, photorealistic, ${NO}`,
  },
  {
    slot: 'door-chat', width: 1000, quality: 76, aspect: '4:3',
    prompt: `photograph of a hand holding a modern smartphone, the screen shows a friendly chat with blank rounded purple and white message bubbles, blurred cozy print shop shelves with folded shirts in the background, soft warm light, photorealistic, only a hand visible, ${NO}`,
  },
  {
    slot: 'door-track', width: 1000, quality: 76, aspect: '4:3',
    prompt: `photograph of a taped kraft cardboard mailer box with a blank white shipping label, sitting on a sunny wooden front porch step beside a small potted plant, soft morning light, photorealistic, ${NO}`,
  },
  {
    slot: 'pickup-map', width: 900, quality: 78, aspect: '4:3',
    prompt: `soft flat illustrated map of a small southern town, gentle pastel streets, green park patches and a winding river, one purple map pin in the center, light lavender, mint and cream palette, clean minimal vector illustration, no labels, ${NO}`,
  },
  {
    slot: 'help-hero', width: 1600, quality: 70, aspect: '16:9',
    prompt: `wide photograph of a bright tidy print shop counter with a stack of folded t-shirts, a measuring tape, a kraft shipping box and a small potted plant against a soft lavender wall, warm daylight, the left half of the frame is calm empty wall for text, shallow depth of field, photorealistic, ${NO}`,
  },
]

async function run(model, input) {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input }),
  })
  let pred = await res.json()
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(pred).slice(0, 300)}`)
  while (pred.status === 'starting' || pred.status === 'processing') {
    await new Promise(r => setTimeout(r, 2000))
    pred = await (await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
  }
  if (pred.status !== 'succeeded') throw new Error(`${pred.status} ${pred.error ?? ''}`)
  return Array.isArray(pred.output) ? pred.output[0] : pred.output
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
fs.mkdirSync(ORIGINALS, { recursive: true })
fs.mkdirSync(path.join(ROOT, 'public', 'support'), { recursive: true })

let ok = 0, skip = 0, fail = 0
await Promise.all(ASSETS.filter(a => !only || a.slot === only).map(async (a) => {
  const dest = path.join(ROOT, 'public', 'support', `${a.slot}.webp`)
  if (fs.existsSync(dest)) { skip++; return }
  try {
    const url = await run('black-forest-labs/flux-2-pro', {
      prompt: a.prompt,
      aspect_ratio: a.aspect,
      output_format: 'png',
      safety_tolerance: 2,
    })
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
    fs.writeFileSync(path.join(ORIGINALS, `${a.slot}.png`), buf)
    await sharp(buf).resize({ width: a.width }).webp({ quality: a.quality }).toFile(dest)
    ok++
    console.log(`ok ${a.slot} -> public/support/${a.slot}.webp (${Math.round(fs.statSync(dest).size / 1024)} KB)`)
  } catch (e) {
    fail++
    console.error(`FAIL ${a.slot}: ${e.message}`)
  }
}))
console.log(`Done: ${ok} generated, ${skip} skipped, ${fail} failed`)
if (fail > 0) process.exit(1)
