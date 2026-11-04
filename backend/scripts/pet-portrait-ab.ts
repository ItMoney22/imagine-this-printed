// Pet ornament model sweep (task 81358f3a): the same real pet photos through
// GPT Image 2.5 Flare (house chain, OpenAI direct) and Nano Banana 2.1 (Gemini
// API), saved side by side so the flat-colour result can be judged and fed to
// the quantizer. Writes nothing to the database.
//
//   OPENAI_API_KEY=... GEMINI_API_KEY=... npx tsx scripts/pet-portrait-ab.ts <outDir> <photo>[:pet] ...
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import { portraitFromPhotoPrompt } from '../services/pet-ornament/portrait-prompt.js'

const [outDir, ...inputs] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function flare(photo: Buffer, prompt: string, quality: 'low' | 'medium'): Promise<Buffer> {
  const res: any = await openai.images.edit({
    model: 'gpt-image-2.5-flare',
    image: await toFile(photo, 'pet.png', { type: 'image/png' }),
    prompt,
    size: '1024x1024',
    quality,
  } as any)
  return Buffer.from(res.data[0].b64_json, 'base64')
}

async function nano(photo: Buffer, prompt: string): Promise<Buffer> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/png', data: photo.toString('base64') } }, { text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    }),
  })
  const body: any = await res.json()
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  const part = body?.candidates?.[0]?.content?.parts?.find((x: any) => x.inlineData)
  if (!part) throw new Error(`gemini: no image (${body?.candidates?.[0]?.finishReason})`)
  return Buffer.from(part.inlineData.data, 'base64')
}

const engines: Record<string, (p: Buffer, prompt: string) => Promise<Buffer>> = {
  'flare-medium': (p, q) => flare(p, q, 'medium'),
  'flare-low': (p, q) => flare(p, q, 'low'),
  'nano-2.1': nano,
}

for (const input of inputs) {
  const [file, pet = 'cat'] = input.split(':')
  const photo = await sharp(readFileSync(file)).rotate().resize(1024, 1024, { fit: 'inside' }).png().toBuffer()
  const stem = basename(file).replace(/\.[^.]+$/, '')
  await Promise.all(
    Object.entries(engines).map(async ([name, fn]) => {
      const t0 = Date.now()
      try {
        const out = await fn(photo, portraitFromPhotoPrompt(pet))
        writeFileSync(join(outDir, `${stem}.${name}.png`), out)
        console.log(`${stem} ${name} ok ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      } catch (e: any) {
        console.log(`${stem} ${name} FAIL ${e?.message?.slice(0, 200)}`)
      }
    })
  )
}
