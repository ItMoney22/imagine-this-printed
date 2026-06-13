// Generate the America's 250th / 4th of July landing-page imagery with GPT Image 2
// (OpenAI Images API direct). Saves PNGs to public/america-250/.
// Run: node scripts/generate-america250-assets.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const env = fs.readFileSync(path.join(root, 'backend/.env'), 'utf8')
const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1].trim().replace(/^["']|["']$/g, '')
const OUT = path.join(root, 'public/america-250')
fs.mkdirSync(OUT, { recursive: true })

const jobs = [
  {
    name: 'hero',
    size: '1536x1024',
    prompt:
      'Cinematic wide hero banner celebrating America\'s 250th anniversary and the 4th of July. ' +
      'Spectacular red, white and blue fireworks bursting across a deep twilight sky over a softly lit American flag, ' +
      'warm golden bokeh, premium and patriotic, joyful festive mood. Leave the upper-left third as clean uncluttered ' +
      'darker sky for headline text overlay. Photorealistic, ultra detailed, high quality, no text, no watermark.',
  },
  {
    name: 'tee',
    size: '1024x1024',
    prompt:
      'A premium patriotic t-shirt flat lay on a clean light neutral background. The shirt features a tasteful vintage ' +
      '"250 YEARS" American eagle and stars emblem in distressed red, white and blue. Soft studio lighting, crisp shadows, ' +
      'e-commerce product photography style. Photorealistic, high detail, no extra text, no watermark.',
  },
  {
    name: 'lifestyle',
    size: '1536x1024',
    prompt:
      'Warm candid lifestyle photo of a happy diverse American family and friends at a sunny backyard 4th of July ' +
      'barbecue, wearing patriotic red-white-and-blue shirts, small American flags and bunting in the background, ' +
      'golden-hour summer light, genuine smiles, celebratory. Photorealistic, editorial quality, no text, no watermark.',
  },
  {
    name: 'emblem',
    size: '1024x1024',
    prompt:
      'A bold vintage-style commemorative emblem badge: "1776 - 2026, 250 YEARS" with a majestic American bald eagle, ' +
      'stars, and laurel, in distressed red, white, navy and gold, centered on a clean off-white background. ' +
      'Screen-print / heritage apparel graphic style, crisp, high contrast, no watermark.',
  },
]

const run = async () => {
  for (const j of jobs) {
    process.stdout.write(`[america250] generating ${j.name} (${j.size})... `)
    try {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-2', prompt: j.prompt, size: j.size, quality: 'high', n: 1 }),
      })
      const d = await r.json()
      if (!r.ok) {
        console.log('FAIL', JSON.stringify(d).slice(0, 220))
        continue
      }
      const b64 = d?.data?.[0]?.b64_json
      if (!b64) { console.log('NO IMAGE', JSON.stringify(d).slice(0, 200)); continue }
      fs.writeFileSync(path.join(OUT, `${j.name}.png`), Buffer.from(b64, 'base64'))
      console.log('OK', `${(Buffer.from(b64, 'base64').length / 1024 / 1024).toFixed(2)}MB`)
    } catch (e) {
      console.log('ERROR', e?.message || e)
    }
  }
  console.log('[america250] done ->', OUT)
}
run()
