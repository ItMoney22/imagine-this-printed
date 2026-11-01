// Pet ornament: draw the stock portraits (the no-photo designs) once and
// commit their four-colour maps to backend/assets/pet-ornament (task 81358f3a).
// Same prompt rules and the same quantizer as a customer photo.
//
//   OPENAI_API_KEY=... npx tsx scripts/pet-ornament-stock.ts [pet ...]
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { stockPortraitPrompt } from '../services/pet-ornament/portrait-prompt.js'
import { encodeMap, quantizePortrait } from '../services/pet-ornament/quantize.js'

const COATS: Record<string, { pet: string; coat: string }> = {
  cat: { pet: 'cat', coat: 'orange tabby' },
  dog: { pet: 'dog', coat: 'golden retriever' },
  bunny: { pet: 'bunny rabbit with long upright ears', coat: 'grey and white' },
}
const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../assets/pet-ornament')
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(COATS)
for (const id of wanted) {
  const { pet, coat } = COATS[id]
  const res: any = await openai.images.generate({ model: 'gpt-image-2.5-flare', prompt: stockPortraitPrompt(pet, coat), size: '1024x1024', quality: 'medium' } as any)
  const png = Buffer.from(res.data[0].b64_json, 'base64')
  const { map, report } = await quantizePortrait(png)
  writeFileSync(join(dir, `${id}.png`), png)
  writeFileSync(join(dir, `${id}.json`), encodeMap(map))
  console.log(id, JSON.stringify(report), map.filaments)
}
