// Generate the World Cup 2026 landing-page imagery with GPT Image 2.
// Generic soccer/"2026" art only — NO official FIFA logo, emblem, or trophy (trademark-safe).
// Run: node scripts/generate-worldcup-assets.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const env = fs.readFileSync(path.join(root, 'backend/.env'), 'utf8')
const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1].trim().replace(/^["']|["']$/g, '')
const OUT = path.join(root, 'public/world-cup')
fs.mkdirSync(OUT, { recursive: true })

const jobs = [
  {
    name: 'hero',
    size: '1536x1024',
    prompt:
      'Cinematic wide hero banner for a 2026 international soccer (football) celebration. A glowing soccer ball ' +
      'caught mid-air over a packed night stadium with dramatic floodlights, colorful confetti and waving flags of ' +
      'many different nations, electric energetic atmosphere, rich emerald greens and warm gold tones. Leave the ' +
      'upper-left third as cleaner, darker space for headline text overlay. Photorealistic, ultra detailed, high ' +
      'quality. No text, no team logos, no official emblems, no watermark.',
  },
  {
    name: 'lifestyle',
    size: '1536x1024',
    prompt:
      'Warm candid lifestyle photo of a diverse group of friends at a lively soccer watch party, cheering in ' +
      'colorful generic team jerseys with face paint, holding small national flags, confetti in the air, huge ' +
      'genuine smiles, energetic celebration in a sunny backyard / sports bar setting. Photorealistic, editorial ' +
      'quality. No text, no real team logos, no watermark.',
  },
  {
    name: 'emblem',
    size: '1024x1024',
    prompt:
      'A bold vintage-style commemorative sports badge: a generic soccer ball and a stylized gold trophy silhouette ' +
      'with laurel, stars and the year "2026", in emerald green, gold and navy, centered on a clean off-white ' +
      'background. Heritage screen-print apparel graphic style, crisp, high contrast. No official logos, no FIFA ' +
      'marks, no real trophy replica, no extra text beyond 2026, no watermark.',
  },
  {
    name: 'tee',
    size: '1024x1024',
    prompt:
      'A premium soccer-themed t-shirt flat lay on a clean light neutral background. The shirt features a tasteful ' +
      'distressed graphic of a soccer ball with dynamic motion lines and "2026", in emerald green, gold and navy. ' +
      'Soft studio lighting, crisp shadows, e-commerce product photography. Photorealistic, high detail. No logos, ' +
      'no extra text, no watermark.',
  },
]

const run = async () => {
  for (const j of jobs) {
    process.stdout.write(`[worldcup] generating ${j.name} (${j.size})... `)
    try {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-2', prompt: j.prompt, size: j.size, quality: 'high', n: 1 }),
      })
      const d = await r.json()
      if (!r.ok) { console.log('FAIL', JSON.stringify(d).slice(0, 220)); continue }
      const b64 = d?.data?.[0]?.b64_json
      if (!b64) { console.log('NO IMAGE', JSON.stringify(d).slice(0, 200)); continue }
      fs.writeFileSync(path.join(OUT, `${j.name}.png`), Buffer.from(b64, 'base64'))
      console.log('OK', `${(Buffer.from(b64, 'base64').length / 1024 / 1024).toFixed(2)}MB`)
    } catch (e) {
      console.log('ERROR', e?.message || e)
    }
  }
  console.log('[worldcup] done ->', OUT)
}
run()
