// Team plate — the customer-facing preview endpoint.
//
// Deliberately PUBLIC (no auth): /product/:id is a guest-shoppable page and the
// personalize panel has to preview before anyone signs in, exactly like the
// rest of checkout. What keeps that safe is that this route takes VALUES, not
// instructions: the template, the fonts, the zones and the sanitizing rules all
// come from the server side, and the only thing the caller supplies is a short
// string that is stripped to [A-Z0-9 '-] before it reaches a glyph.
//
// It is rate-limited because every NEW name and number is a paid
// gpt-image-2.5-flare edit (task 65d98dd9 — the vector engine it replaced was
// free to run), and cached because the same name and number is a very common
// request (a coach ordering a roster will hit the same shirt fifteen times).
import express, { type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import sharp from 'sharp'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { uploadFile } from '../services/gcs-storage.js'
import { parseTeamTemplate, sanitizeValues, TEAM_TEMPLATE_VERSION } from '../shared/team-template.js'
import { renderOrGetCached } from '../services/team-plate/plate-store.js'
// Ids and labels only — the admin picker still offers a face as a style hint.
// Nothing here draws with the quarantined vector engine.
import { HOUSE_FONTS } from '../services/team-plate/legacy-vector/fonts.js'
import { deriveZonesAndDistress, erasePlate, eyedropColours } from '../services/team-plate/authoring.js'

const router = express.Router()

/**
 * Any width under the template canvas asks for the PREVIEW tier (the flare
 * base, ~1152x1536); plate-store.ts no longer resizes per width.
 */
const PREVIEW_WIDTH = 900

// A preview miss costs a flare edit (~20-40s, real money) on a PUBLIC route.
// The panel now previews on a button press instead of on every keystroke, so a
// real customer needs a handful; a roster coach re-hitting cached names is
// cheap but still counted, which is why this is not tighter.
const previewLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That is a lot of previews — give it a few minutes and try again.' },
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
      tier: plate.tier,
    })
  } catch (err: any) {
    req.log?.error({ err }, 'team-plate preview failed')
    return res.status(500).json({ error: 'Could not render that preview' })
  }
})

// ---------------------------------------------------------------------------
// Authoring (admin only)
//
// Everything below produces SUGGESTIONS the operator then corrects on screen.
// The only step that has to be right is the side-by-side comparison at the end,
// which is a human looking at two pictures.
// ---------------------------------------------------------------------------

/** The artwork a template is built from: the product's existing back design. */
async function loadProduct(productId: string) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, metadata')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function saveLayerAsset(
  productId: string,
  role: 'team_plate_back' | 'team_distress_back' | 'team_source_back',
  buffer: Buffer
): Promise<string> {
  const meta = await sharp(buffer).metadata()
  const upload = await uploadFile(buffer, {
    userId: `team-templates/${productId}`,
    folder: 'ai-generated',
    filename: `${role}-${Date.now()}.png`,
    contentType: 'image/png',
  })

  // One row per role: re-authoring replaces rather than accumulates.
  await supabase.from('product_assets').delete().eq('product_id', productId).eq('asset_role', role)

  const { data, error } = await supabase
    .from('product_assets')
    .insert({
      product_id: productId,
      // 'template' is a new kind. product_assets.kind is plain TEXT with no
      // CHECK constraint, and product-gallery.ts's ROLE_ORDER is a WHITELIST,
      // so neither of these roles can ever reach the storefront gallery.
      kind: 'template',
      path: upload.gcsPath,
      url: upload.publicUrl,
      width: meta.width ?? null,
      height: meta.height ?? null,
      asset_role: role,
      is_primary: false,
      display_order: 99,
      metadata: { purpose: 'team-plate' },
    })
    .select('id')
    .single()

  if (error) throw new Error(`Could not save ${role}: ${error.message}`)
  return data.id as string
}

/**
 * POST /api/team-plate/:productId/derive
 * Body: { sourceUrl, canvas?: { w, h }, plateUrl? }
 *
 * Erases the sample lettering (or takes an uploaded clean plate via plateUrl),
 * then diffs the two to seed the zones, the distress mask and the colours.
 */
router.post(
  '/:productId/derive',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { productId } = req.params
      const { sourceUrl, plateUrl } = req.body ?? {}
      if (typeof sourceUrl !== 'string' || !sourceUrl) {
        return res.status(400).json({ error: 'sourceUrl is required' })
      }

      const product = await loadProduct(productId)
      if (!product) return res.status(404).json({ error: 'Product not found' })

      const srcRes = await fetch(sourceUrl)
      if (!srcRes.ok) return res.status(400).json({ error: 'Could not fetch the source artwork' })
      const originalRaw = Buffer.from(await srcRes.arrayBuffer())
      const srcMeta = await sharp(originalRaw).metadata()

      // Canvas defaults to a 300 DPI press file at the artwork's own aspect.
      const bodyCanvas = req.body?.canvas
      const canvas =
        bodyCanvas && Number(bodyCanvas.w) > 0 && Number(bodyCanvas.h) > 0
          ? { w: Math.round(Number(bodyCanvas.w)), h: Math.round(Number(bodyCanvas.h)) }
          : { w: 3600, h: Math.round((3600 * (srcMeta.height ?? 4)) / (srcMeta.width ?? 3)) }

      const original = await sharp(originalRaw)
        .resize(canvas.w, canvas.h, { fit: 'fill' })
        .png()
        .toBuffer()

      let plate: Buffer
      let modelId: string | null = null
      if (typeof plateUrl === 'string' && plateUrl) {
        // The operator supplied a clean plate — always better than an erase
        // when the layered source file exists.
        const plateRes = await fetch(plateUrl)
        if (!plateRes.ok) return res.status(400).json({ error: 'Could not fetch the clean plate' })
        plate = await sharp(Buffer.from(await plateRes.arrayBuffer()))
          .resize(canvas.w, canvas.h, { fit: 'fill' })
          .png()
          .toBuffer()
      } else {
        const erased = await erasePlate(sourceUrl, canvas, { userId: (req as any).user?.sub })
        plate = erased.buffer
        modelId = erased.modelId
      }

      const { zones, distress } = await deriveZonesAndDistress(original, plate, canvas)
      const colours = await Promise.all(zones.map((zone) => eyedropColours(original, zone)))

      // The ORIGINAL (sample lettering and all) is saved too: it is what the
      // per-order flare edit works from, because showing the model the
      // lettering style beats describing it.
      const [plateAssetId, distressAssetId, sourceAssetId] = await Promise.all([
        saveLayerAsset(productId, 'team_plate_back', plate),
        saveLayerAsset(productId, 'team_distress_back', distress),
        saveLayerAsset(productId, 'team_source_back', original),
      ])

      return res.json({
        canvas: { ...canvas, dpi: 300 },
        plateAssetId,
        distressAssetId,
        sourceAssetId,
        modelId,
        // One suggested field per zone, top to bottom: on a team shirt that is
        // the name and then the number. Both are editable before saving.
        suggestions: zones.map((zone, i) => ({
          zone,
          fill: colours[i].fill,
          strokes: colours[i].strokes,
          guessedType: i === 0 ? 'text' : 'number',
        })),
      })
    } catch (err: any) {
      req.log?.error({ err }, 'team-plate derive failed')
      return res.status(500).json({ error: err?.message ?? 'Could not derive a template' })
    }
  }
)

/** GET /api/team-plate/:productId/template — the saved template, or null. */
router.get(
  '/:productId/template',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<any> => {
    const product = await loadProduct(req.params.productId)
    if (!product) return res.status(404).json({ error: 'Product not found' })
    return res.json({ template: parseTeamTemplate(product.metadata) })
  }
)

/**
 * PUT /api/team-plate/:productId/template
 * Body: { template }
 *
 * Validates before saving. The glyph-coverage warning the vector engine needed
 * is gone with it: the lettering is drawn by the image model now, which has no
 * font file to run out of glyphs.
 */
router.put(
  '/:productId/template',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { productId } = req.params
      const incoming = { ...(req.body?.template ?? {}), version: TEAM_TEMPLATE_VERSION }
      const template = parseTeamTemplate(incoming)
      if (!template) return res.status(400).json({ error: 'That template is not valid' })

      const product = await loadProduct(productId)
      if (!product) return res.status(404).json({ error: 'Product not found' })

      const warnings: string[] = []

      const metadata = { ...(product.metadata ?? {}), team_template: template }
      const { error } = await supabase.from('products').update({ metadata }).eq('id', productId)
      if (error) return res.status(500).json({ error: error.message })

      return res.json({ template, warnings })
    } catch (err: any) {
      req.log?.error({ err }, 'team-plate template save failed')
      return res.status(500).json({ error: 'Could not save that template' })
    }
  }
)

/**
 * POST /api/team-plate/:productId/proof
 * Body: { template, values }
 *
 * Renders a template that has NOT been saved yet, so the authoring screen can
 * show the side-by-side while the operator is still nudging boxes. Each new
 * proof is a flare edit — admin-only, so not rate-limited.
 */
router.post(
  '/:productId/proof',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const incoming = { ...(req.body?.template ?? {}), version: TEAM_TEMPLATE_VERSION }
      const template = parseTeamTemplate(incoming)
      if (!template) return res.status(400).json({ error: 'That template is not valid yet' })
      const values = sanitizeValues(template, req.body?.values)
      const plate = await renderOrGetCached(template, values, PREVIEW_WIDTH)
      return res.json({ url: plate.url, values })
    } catch (err: any) {
      req.log?.error({ err }, 'team-plate proof failed')
      return res.status(500).json({ error: err?.message ?? 'Could not render that proof' })
    }
  }
)

export default router
