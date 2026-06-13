// One-time generator for Toy Creator assets:
//  - 36 item card images (3D vinyl-toy style icons) via Replicate flux-schnell
//  - Mr. Imagine host voice lines via Replicate minimax/speech-02-turbo
// Saves to public/toy-creator/{items,voice}/ + manifest.json.
// Re-runnable: skips files that already exist (delete a file to regenerate it).
//
// Run from repo root:  REPLICATE_API_TOKEN=... node scripts/generate-toy-creator-assets.mjs
// (or it reads backend/.env for the token)

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const ITEMS_DIR = path.join(ROOT, 'public', 'toy-creator', 'items')
const VOICE_DIR = path.join(ROOT, 'public', 'toy-creator', 'voice')
fs.mkdirSync(ITEMS_DIR, { recursive: true })
fs.mkdirSync(VOICE_DIR, { recursive: true })

// --- token ---
let TOKEN = process.env.REPLICATE_API_TOKEN
if (!TOKEN) {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8')
  TOKEN = env.match(/^REPLICATE_API_TOKEN=(.+)$/m)?.[1]?.trim()
}
if (!TOKEN) { console.error('No REPLICATE_API_TOKEN'); process.exit(1) }

const MR_IMAGINE_VOICE = 'moss_audio_737a299c-734a-11f0-918f-4e0486034804'

// --- the item catalog (mirrored in src/pages/ToyCreator.tsx) ---
const CATEGORIES = {
  mind: {
    phrase: (l) => `the clever mind of a ${l}`,
    items: ['raptor', 'owl', 'fox', 'dolphin', 'octopus', 'robot', 'wizard', 'cat'],
  },
  strength: {
    phrase: (l) => `the mighty strength of a ${l}`,
    items: ['gorilla', 't-rex', 'bear', 'rhino', 'elephant', 'bull', 'tiger', 'crocodile'],
  },
  body: {
    phrase: (l) => `the body of a ${l}`,
    items: ['shark', 'lion', 'dragon', 'unicorn', 'wolf', 'eagle', 'panda', 'cheetah', 'axolotl', 'dinosaur', 'robot', 'frog'],
  },
  powerup: {
    phrase: (l) => `equipped with ${l}`,
    items: ['mighty wings', 'hero armor', 'laser eyes', 'rocket boots', 'royal crown', 'super cape', 'ice powers', 'fire breath'],
  },
}

const itemPrompt = (label, category) => {
  const subject = category === 'powerup'
    ? `a magical "${label}" power-up item`
    : `a cute ${label} character`
  return `3D rendered collectible vinyl toy icon of ${subject}, chunky rounded kawaii proportions, glossy smooth plastic surface, vibrant saturated colors, soft dramatic studio lighting, centered composition with the full subject visible, deep rich purple background, subtle magical glow around the subject, no text, no watermark, square format`
}

// --- Mr. Imagine host lines ---
const VOICE_LINES = {
  intro: "Hi there! I'm Mister Imagine! <#0.3#> What awesome creature are we making today? Tap the microphone and TELL me... or build it piece by piece!",
  listening: 'Ooooh, I\'m listening!',
  'got-it': 'That sounds AMAZING! Let\'s mix that D N A!',
  splicing: "Mixing your creature's D N A right now... <#0.3#> this is going to be EPIC!",
  reveal: 'Ta-daaa! Look what we made together! Do you LOVE it?',
  'pick-size': 'How big should your creature be? Pick a size!',
  incubation: 'Your creature is growing in my lab right now! <#0.3#> Almost there...',
  // "alive" rephrased: the original "IT'S ALIVE" read as "it's LIVE" in TTS.
  // "fully alive" forces the right pronunciation. Two variants so the host
  // says the correct thing for the chosen finish (grey vs full color).
  alive: 'Ta-daa! Your creature is fully alive! <#0.3#> We print it in matte grey... so YOU get to paint it any way you want!',
  'alive-color': 'Ta-daa! Your creature is fully alive! <#0.3#> And it comes printed in FULL color... ready right out of the box!',
  error: 'Uh oh! The D N A got a little tangled! Don\'t worry... let\'s try again!',
}

async function replicateRun(model, input) {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    },
    body: JSON.stringify({ input }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  let pred = body
  // Poll if not finished within the wait window
  while (pred.status === 'starting' || pred.status === 'processing') {
    await new Promise(r => setTimeout(r, 2000))
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    pred = await poll.json()
  }
  if (pred.status !== 'succeeded') throw new Error(`${model}: ${pred.status} ${pred.error ?? ''}`)
  const out = pred.output
  return Array.isArray(out) ? out[0] : out
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

const slugify = (s) => s.replace(/\s+/g, '-').toLowerCase()

const manifest = { items: {}, voice: {}, generated_at: new Date().toISOString() }

let ok = 0, skip = 0, fail = 0
for (const [category, cfg] of Object.entries(CATEGORIES)) {
  manifest.items[category] = []
  for (const label of cfg.items) {
    const slug = slugify(label)
    const file = `${category}-${slug}.webp`
    const dest = path.join(ITEMS_DIR, file)
    manifest.items[category].push({ slug, label, file: `/toy-creator/items/${file}`, phrase: cfg.phrase(label) })
    if (fs.existsSync(dest)) { skip++; continue }
    try {
      const url = await replicateRun('black-forest-labs/flux-schnell', {
        prompt: itemPrompt(label, category),
        aspect_ratio: '1:1',
        output_format: 'webp',
        num_inference_steps: 4,
      })
      await download(url, dest)
      ok++
      console.log(`✅ item ${category}/${slug}`)
    } catch (e) {
      fail++
      console.error(`❌ item ${category}/${slug}: ${e.message}`)
    }
  }
}

for (const [key, text] of Object.entries(VOICE_LINES)) {
  const file = `${key}.mp3`
  const dest = path.join(VOICE_DIR, file)
  manifest.voice[key] = `/toy-creator/voice/${file}`
  if (fs.existsSync(dest)) { skip++; continue }
  try {
    const url = await replicateRun('minimax/speech-02-turbo', {
      text,
      voice_id: MR_IMAGINE_VOICE,
      emotion: 'happy',
      speed: 1.05,
      english_normalization: true,
    })
    await download(url, dest)
    ok++
    console.log(`✅ voice ${key}`)
  } catch (e) {
    fail++
    console.error(`❌ voice ${key}: ${e.message}`)
  }
}

fs.writeFileSync(path.join(ROOT, 'public', 'toy-creator', 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\nDone: ${ok} generated, ${skip} skipped (existing), ${fail} failed. Manifest written.`)
if (fail > 0) process.exit(1)
