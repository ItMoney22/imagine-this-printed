// 3D name gifts — the customer-facing preview (task bf353160).
//
// PUBLIC on purpose, like /api/team-plate/preview: /product/:id is guest
// shoppable. It takes a VALUE, not instructions — the template, the font, the
// sizes and the sanitizer are all server-side; the caller supplies one short
// string, stripped to letters, digits and ' & . - before it reaches a glyph.
//
// FREE, unlike the team preview: the picture is the print file's own outline
// seen from above (geometry.ts toPreviewSvg), built in milliseconds with no
// model call. So the panel previews as the customer types, and the limit
// below only stops a script from hammering the CPU.
//
// 404 when the product has no name template: the panel feature-detects on it
// (Vercel deploys ahead of Render) and hides itself instead of erroring.
import express, { type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { supabase } from '../lib/supabase.js'
import { parseNamePrint, sanitizeNameValues } from '../shared/name-print.js'
import { buildNameModel, toPreviewSvg } from '../services/name-print/geometry.js'

const router = express.Router()

const previewLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That is a lot of previews — give it a minute and try again.' },
})

const MM_PER_INCH = 25.4

/**
 * POST /api/name-print/preview
 * Body: { productId, values: { name } }
 * -> { svg, values, size: { widthMm, heightMm, widthIn, heightIn } }
 */
router.post('/preview', previewLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const { productId, values } = req.body ?? {}
    if (typeof productId !== 'string' || !productId) return res.status(400).json({ error: 'productId is required' })

    const { data: product, error } = await supabase.from('products').select('id, metadata').eq('id', productId).maybeSingle()
    if (error) {
      req.log?.error({ err: error, productId }, 'name-print preview: product lookup failed')
      return res.status(500).json({ error: 'Could not load that product' })
    }
    if (!product) return res.status(404).json({ error: 'Product not found' })

    const template = parseNamePrint(product.metadata)
    if (!template) return res.status(404).json({ error: 'This product is not personalizable' })

    const clean = sanitizeNameValues(template, values)
    const name = clean[template.field.key]
    if (!name) return res.status(400).json({ error: 'Type a name to see it', values: clean })

    const model = buildNameModel(template.shape, template.font, name)
    const svg = toPreviewSvg(model, { plate: template.colours.plate.hex, letters: template.colours.letters.hex })
    const round = (n: number) => Math.round(n * 10) / 10
    return res.json({
      svg,
      values: clean,
      size: {
        widthMm: round(model.size.x),
        heightMm: round(model.size.y),
        widthIn: round(model.size.x / MM_PER_INCH),
        heightIn: round(model.size.y / MM_PER_INCH),
      },
    })
  } catch (err: any) {
    req.log?.error({ err }, 'name-print preview failed')
    return res.status(500).json({ error: 'Could not draw that preview' })
  }
})

export default router
