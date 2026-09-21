// Team plate — the customer-facing preview endpoint.
//
// Deliberately PUBLIC (no auth): /product/:id is a guest-shoppable page and the
// personalize panel has to preview before anyone signs in, exactly like the
// rest of checkout. What keeps that safe is that this route takes VALUES, not
// instructions: the template, the fonts, the zones and the sanitizing rules all
// come from the server side, and the only thing the caller supplies is a short
// string that is stripped to [A-Z0-9 '-] before it reaches a glyph.
//
// It is rate-limited because it does image work, and cached because the same
// name and number is a very common request (a coach ordering a roster will hit
// the same shirt fifteen times).
import express, { type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { supabase } from '../lib/supabase.js'
import { parseTeamTemplate, sanitizeValues } from '../shared/team-template.js'
import { renderOrGetCached } from '../services/team-plate/plate-store.js'
import { HOUSE_FONTS } from '../services/team-plate/fonts.js'

const router = express.Router()

/** Preview width. Big enough to judge lettering on a phone, small enough to be free. */
const PREVIEW_WIDTH = 900

const previewLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many previews, give it a second.' },
})

/**
 * GET /api/team-plate/fonts
 *
 * The house set, for the admin authoring picker. No licence files or paths —
 * just ids and labels.
 */
router.get('/fonts', (_req: Request, res: Response) => {
  res.json({
    fonts: HOUSE_FONTS.map(({ id, label, note }) => ({ id, label, note })),
  })
})

/**
 * POST /api/team-plate/preview
 * Body: { productId, values: { name, number, ... } }
 *
 * 404 when the product has no template — which is also the signal the frontend
 * feature-detects on. Vercel deploys ahead of Render, so a product page can
 * reach an API that has never heard of this route; the panel hides itself
 * rather than rendering a form that errors.
 */
router.post('/preview', previewLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const { productId, values } = req.body ?? {}
    if (typeof productId !== 'string' || !productId) {
      return res.status(400).json({ error: 'productId is required' })
    }

    const { data: product, error } = await supabase
      .from('products')
      .select('id, metadata')
      .eq('id', productId)
      .maybeSingle()

    if (error) {
      req.log?.error({ err: error, productId }, 'team-plate preview: product lookup failed')
      return res.status(500).json({ error: 'Could not load that product' })
    }
    if (!product) return res.status(404).json({ error: 'Product not found' })

    const template = parseTeamTemplate(product.metadata)
    if (!template) return res.status(404).json({ error: 'This product is not personalizable' })

    // The client's values are advisory. Everything drawn comes from the
    // server's own sanitizer, so the preview and the press file cannot
    // disagree about what was typed.
    const clean = sanitizeValues(template, values)
    const plate = await renderOrGetCached(template, clean, PREVIEW_WIDTH)

    return res.json({
      url: plate.url,
      values: clean,
      width: PREVIEW_WIDTH,
      cached: !plate.rendered,
    })
  } catch (err: any) {
    req.log?.error({ err }, 'team-plate preview failed')
    return res.status(500).json({ error: 'Could not render that preview' })
  }
})

export default router
