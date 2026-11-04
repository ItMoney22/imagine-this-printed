// Create-your-own pet ornament — the customer-facing endpoints (task 81358f3a).
//
// PUBLIC on purpose, like /api/name-print/preview: /product/:id is guest
// shoppable, and a customer sees THEIR pet on the ornament before paying.
//
//   POST /api/pet-ornament/portrait   multipart: photo + productId
//        One paid image-model call per NEW photo (the same photo is never
//        drawn twice), so it is rate-limited per visitor and capped per day.
//        -> { portraitId, filaments }
//   POST /api/pet-ornament/preview    { productId, values: { pet, name, portrait } }
//        Free: the print files' own outlines seen from above, in milliseconds.
//        -> { svg, values, colours, size }
//
// 404 when the product has no pet template: the panel feature-detects on it
// (Vercel deploys ahead of Render) and hides itself instead of erroring.
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import { supabase } from '../lib/supabase.js'
import { sniffImageContentType } from '../services/google-cloud-storage.js'
import { filamentById, parsePetOrnament, sanitizePetValues, type PetOrnamentTemplate } from '../shared/pet-ornament.js'
import { buildPetModel, toPetPreviewSvg } from '../services/pet-ornament/geometry.js'
import { mapFor } from '../services/pet-ornament/store.js'
import { drawPortrait } from '../services/pet-ornament/portrait.js'

const router = express.Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } })
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

// A visitor trying a few photos is normal; a script is not.
const portraitLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: Number(process.env.PET_PORTRAIT_LIMIT_PER_15MIN) || 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That is a lot of photos in a row. Give it a few minutes and try again.' },
})

// The whole site's new drawings per UTC day: a ceiling on the bill whatever
// the per-visitor limiter misses (~$0.02 each at Flare low).
const DAILY_CAP = Number(process.env.PET_PORTRAIT_DAILY_CAP) || 400
let day = ''
let drawnToday = 0
function dailyCap(_req: Request, res: Response, next: NextFunction): void {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== day) { day = today; drawnToday = 0 }
  if (drawnToday >= DAILY_CAP) {
    res.status(503).json({ error: 'Photo portraits are very busy today. Pick the stock design, or try again tomorrow.' })
    return
  }
  next()
}

const previewLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That is a lot of previews. Give it a minute and try again.' },
})

async function templateFor(productId: unknown, req: Request, res: Response): Promise<PetOrnamentTemplate | null> {
  if (typeof productId !== 'string' || !productId) {
    res.status(400).json({ error: 'productId is required' })
    return null
  }
  const { data: product, error } = await supabase.from('products').select('id, metadata').eq('id', productId).maybeSingle()
  if (error) {
    req.log?.error({ err: error, productId }, 'pet-ornament: product lookup failed')
    res.status(500).json({ error: 'Could not load that product' })
    return null
  }
  const template = product ? parsePetOrnament(product.metadata) : null
  if (!template) {
    res.status(404).json({ error: product ? 'This product is not a pet ornament' : 'Product not found' })
    return null
  }
  return template
}

function colourList(filaments: Array<string | null>): Array<{ name: string; hex: string }> {
  return filaments.filter((f): f is string => !!f).map((id) => {
    const f = filamentById(id)!
    return { name: f.name, hex: f.hex }
  })
}

router.post('/portrait', portraitLimiter, dailyCap, upload.single('photo'), async (req: Request, res: Response): Promise<any> => {
  try {
    const template = await templateFor(req.body?.productId, req, res)
    if (!template) return
    if (!template.photo) return res.status(400).json({ error: 'This ornament uses our own designs only' })

    const file = (req as any).file as { buffer: Buffer } | undefined
    if (!file?.buffer?.length) return res.status(400).json({ error: 'Choose a photo of your pet' })
    // Trust the bytes, not the declared type.
    const sniffed = sniffImageContentType(file.buffer)
    if (!sniffed || !ALLOWED.has(sniffed)) return res.status(400).json({ error: 'That file is not a photo we can read. Try a JPEG or PNG.' })

    const pet = sanitizePetValues(template, { pet: req.body?.pet }).pet
    const label = template.pets.find((p) => p.id === pet)!.label
    const out = await drawPortrait(file.buffer, label)
    if (out.drawn) drawnToday++
    req.log?.info({ portraitId: out.id, drawn: out.drawn, modelId: out.modelId, pet }, 'pet-ornament: portrait')
    return res.json({ portraitId: out.id, colours: colourList(out.map.filaments) })
  } catch (err: any) {
    req.log?.error({ err }, 'pet-ornament: portrait failed')
    const moderated = /safety|moderation|content_policy/i.test(err?.message ?? '')
    return res.status(moderated ? 422 : 500).json({
      error: moderated
        ? 'We could not use that photo. Try a different photo of your pet.'
        : 'Our artist could not draw that one. Try again, or try another photo.',
    })
  }
})

router.post('/preview', previewLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const template = await templateFor(req.body?.productId, req, res)
    if (!template) return
    const values = sanitizePetValues(template, req.body?.values)
    const map = await mapFor(values)
    const model = buildPetModel(map, template.font, values.name)
    const round = (n: number) => Math.round(n * 10) / 10
    return res.json({
      svg: toPetPreviewSvg(model),
      values,
      colours: colourList(model.parts.map((p) => p.filament)),
      size: { widthMm: round(model.size.x), heightMm: round(model.size.y), widthIn: round(model.size.x / 25.4), heightIn: round(model.size.y / 25.4) },
    })
  } catch (err: any) {
    const expired = /expired/.test(err?.message ?? '')
    if (!expired) req.log?.error({ err }, 'pet-ornament: preview failed')
    return res.status(expired ? 410 : 500).json({ error: expired ? err.message : 'Could not draw that preview' })
  }
})

export default router
