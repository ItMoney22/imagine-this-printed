// Pet ornament — a local walk harness (task 81358f3a). Runs the REAL
// /api/pet-ornament routes (real photo -> real GPT Image 2.5 Flare drawing ->
// real quantizer and print files) on a box with no ITP database or GCS:
// a tiny stand-in answers the one products lookup, files land on disk, and
// checkout's storePetPrint can be exercised at /dev/checkout.
//
//   OPENAI_API_KEY=... npx tsx scripts/pet-ornament-dev-server.ts <filesDir> [port=4100]
//
// The product id is DEV_PRODUCT_ID below; the walk script steers the
// storefront's own products query to the same row.
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import OpenAI, { toFile } from 'openai'

export const DEV_PRODUCT_ID = '9e7a0c1e-5e7a-4c0e-9a0e-0000000081f3'
const [filesDir, portArg] = process.argv.slice(2)
const PORT = Number(portArg) || 4100
mkdirSync(filesDir, { recursive: true })

const template = { version: 1, font: 'brush-script', pets: ['cat', 'dog', 'bunny'], field: { key: 'name', label: "Your pet's name", max: 12 }, photo: true, upcharge: 0 }
const row = { id: DEV_PRODUCT_ID, metadata: { pet_ornament: template } }

// Stand-in for PostgREST: the router's only query is products by id.
const rest = createServer((req, res) => {
  const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object')
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(req.url?.includes(DEV_PRODUCT_ID) ? (wantsObject ? row : [row]) : wantsObject ? null : []))
})
await new Promise<void>((r) => rest.listen(PORT + 1, r))
process.env.SUPABASE_URL = `http://127.0.0.1:${PORT + 1}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dev-harness'

const { blobStore } = await import('../services/pet-ornament/store.js')
const { portraitDeps, PORTRAIT_MODEL, PORTRAIT_QUALITY } = await import('../services/pet-ornament/portrait.js')
const { default: router } = await import('../routes/pet-ornament.js')
const { storePetPrint } = await import('../services/pet-ornament/store.js')
const { parsePetOrnament, sanitizePetValues } = await import('../shared/pet-ornament.js')

const disk = (p: string) => path.join(filesDir, p)
blobStore.exists = async (p) => existsSync(disk(p))
blobStore.read = async (p) => readFileSync(disk(p))
blobStore.write = async (buf, p) => {
  mkdirSync(path.dirname(disk(p)), { recursive: true })
  writeFileSync(disk(p), buf)
}
blobStore.sign = async (p) => `file://${disk(p)}`

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
portraitDeps.draw = async (photo, prompt) => {
  const t0 = Date.now()
  const res: any = await openai.images.edit({
    model: PORTRAIT_MODEL,
    image: await toFile(photo, 'pet.png', { type: 'image/png' }),
    prompt,
    size: '1024x1024',
    quality: PORTRAIT_QUALITY,
  } as any)
  console.log(`[harness] drew a portrait in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return { png: Buffer.from(res.data[0].b64_json, 'base64'), modelId: PORTRAIT_MODEL }
}

const app = express()
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  if (req.method === 'OPTIONS') return res.end()
  next()
})
app.use(express.json())
app.use('/api/pet-ornament', router)
// What checkout does for a cart line, without Stripe.
app.post('/dev/checkout', async (req, res) => {
  const t = parsePetOrnament(row.metadata)!
  const stored = await storePetPrint(t, sanitizePetValues(t, req.body))
  res.json({ ...stored, dir: disk(path.dirname(stored.path)) })
})
app.listen(PORT, () => console.log(`[harness] pet-ornament API on :${PORT}, files in ${filesDir}`))
