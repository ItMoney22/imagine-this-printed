// Imagine Studio — Step Flow routes (David 2026-09-01: replace the classic
// wizard with a flow that moves in STEPS, each ending in a one-click approve
// before the next step fires). Mounted under the same base as ai-products.ts
// (/api/admin/products/ai) — see routes/admin/ai-products.ts's
// `router.use(stepFlowRouter)`.
//
// Reuses the EXISTING job pipeline end to end (ai_jobs, product_assets,
// remove-background) — this file adds the per-step orchestration + approval
// bookkeeping (`products.metadata.step_flow`) on top of it. The mockup fan-out
// logic itself lives in services/step-flow/shots.ts.
import { Router, Request, Response, NextFunction } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { assertOffered, COLORS, type ColorId, type GarmentId } from '../../shared/catalog-capability.js'
import { writeStepBrief } from '../../services/step-flow/brief.js'
import { pitchPhrases } from '../../services/step-flow/phrases.js'
import { analyzeInspirationImage, InspirationValidationError } from '../../services/step-flow/inspiration.js'
import { adviseColors, adviseColorsForMetal } from '../../services/step-flow/color-advice.js'
import { computePrintAdvice, buildPrintFile } from '../../services/step-flow/print-prep.js'
import { STUDIO_SIZE_KEYS, METAL_ART_PRICES, type MetalArtSizeKey } from '../../shared/metal-art.js'
import {
  queueStepShots,
  redoShot,
  approveShot,
  approveShotsBatch,
  resolveStepFlow,
  getStepFlow,
  saveStepFlow,
  loadProductRow,
  buildApprovedGallery,
  isMetalStepFlow,
  StepFlowValidationError,
  type ShotKey,
} from '../../services/step-flow/shots.js'
// Renders one 'replicate_rembg' job to completion (851-labs -> GCS ->
// product_assets kind:'nobg') — same worker function the polling loop calls
// for the classic (queued) path; here it is invoked directly, inline, right
// after this route pre-claims the job as 'running'. Mirrors processMockupJob
// (services/step-flow/shots.ts) and processImageJobInline
// (routes/admin/ai-products.ts). Importing this has no side effects —
// `startWorker()` lives in the same file but is only invoked from
// backend/worker/index.ts.
import { processRemoveBgJob } from '../../worker/ai-jobs-worker.js'

/**
 * Mirrors ai-products.ts's local requireAdmin (admin OR manager) for
 * behavioural parity with the routes this mounts alongside. Not imported from
 * there because it isn't exported and Track B's file-ownership scope is
 * mount-only in that file — see docs/plans/2026-09-01-imagine-studio-step-flow-plan.md.
 */
async function requireAdminOrManager(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', req.user.sub).single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    res.status(403).json({ error: 'Forbidden: Admin access required' })
    return
  }
  next()
}

// Same per-user in-memory rate-limit pattern as ai-products.ts's rateLimitAI
// (not imported for the same file-ownership reason as above) — guards the
// routes that trigger paid model calls (the writing brain, and the mockup/
// model-shot fan-out).
const aiRateBuckets = new Map<string, number[]>()
function rateLimitAI(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.user?.sub || req.ip || 'anon'
    const windowStart = Date.now() - 60_000
    const hits = (aiRateBuckets.get(key) || []).filter((t) => t > windowStart)
    if (hits.length >= maxPerMinute) {
      res.status(429).json({ error: `Rate limit: max ${maxPerMinute} AI generations per minute — try again shortly` })
      return
    }
    hits.push(Date.now())
    aiRateBuckets.set(key, hits)
    next()
  }
}

function actorId(req: Request): string {
  return (req as any).user?.id || (req as any).user?.sub || 'system'
}

/**
 * The nobg asset (falls back to the primary source design when rembg hasn't
 * run yet) — same resolution order color-advice uses, factored out here so
 * both print-prep routes below share it instead of duplicating the query.
 */
async function resolveDesignArtworkUrl(productId: string): Promise<string | undefined> {
  const { data: nobgAsset } = await supabase
    .from('product_assets')
    .select('url')
    .eq('product_id', productId)
    .eq('kind', 'nobg')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (nobgAsset?.url) return nobgAsset.url as string

  const { data: sourceAsset } = await supabase
    .from('product_assets')
    .select('url')
    .eq('product_id', productId)
    .eq('kind', 'source')
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle()
  return sourceAsset?.url as string | undefined
}

const router = Router()

// POST /step/brief — { idea, phrase? } -> { brief }. Step 1: idea -> best
// prompt. `phrase` (design doc §11) is either David's typed line or one Mrs.
// Imagine pitched via /step/phrases below; writeStepBrief guarantees the
// exact quoted text reaches designPrompt on every path (model success AND
// fallback), so passing it straight through here is enough — no extra
// validation needed, brief.ts sanitizes it.
router.post('/step/brief', requireAuth, requireAdminOrManager, rateLimitAI(20), async (req: Request, res: Response): Promise<any> => {
  try {
    const { idea, phrase, inspiration, productKind } = req.body || {}
    if (typeof idea !== 'string' || !idea.trim()) {
      return res.status(400).json({ error: 'idea is required' })
    }
    const brief = await writeStepBrief(idea, { phrase, inspiration, productKind })
    res.json({ brief })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] brief error')
    res.status(500).json({ error: err?.message || 'Failed to write brief' })
  }
})

// POST /step/inspiration — { image } -> { persona, intro, inspiration }.
// The very beginning of the flow (David 2026-09-02): upload a reference
// photo, Mrs. Imagine breaks it down (subject/style/palette/composition/
// mood/techniques) and flags anything that must never be reproduced (a
// logo, brand mark, licensed character, celebrity likeness, verbatim text)
// — `suggestedIdea` always describes an ORIGINAL design, never a copy. See
// services/step-flow/inspiration.ts for the decode/upload/analysis +
// copyright-gate sanitizing; POST /step/brief (above) accepts the result
// back as `inspiration` to seed the writing brain.
router.post('/step/inspiration', requireAuth, requireAdminOrManager, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { image } = req.body || {}
    const result = await analyzeInspirationImage(image, { actorId: actorId(req) })
    res.json(result)
  } catch (err: any) {
    if (err instanceof InspirationValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] inspiration error')
    res.status(500).json({ error: err?.message || 'Failed to analyze inspiration image' })
  }
})

// POST /step/phrases — { idea, brief?, count? } -> { persona, intro, phrases }.
// Mrs. Imagine's pitch inside Step 1 (design doc §11, David 2026-09-02): "add
// Mrs Imagine to this step i dont want her creating designs on her own
// anymore" — she now pitches short print-ready phrases for the idea instead
// of generating whole products unattended (her daily autonomous batch is off
// by default — see worker/mrs-imagine-daily.ts).
router.post('/step/phrases', requireAuth, requireAdminOrManager, rateLimitAI(20), async (req: Request, res: Response): Promise<any> => {
  try {
    const { idea, brief, count } = req.body || {}
    if (typeof idea !== 'string' || !idea.trim()) {
      return res.status(400).json({ error: 'idea is required' })
    }
    const result = await pitchPhrases(
      idea,
      brief && typeof brief === 'object' ? brief : undefined,
      typeof count === 'number' ? count : undefined
    )
    res.json(result)
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] phrases error')
    res.status(500).json({ error: err?.message || 'Failed to pitch phrases' })
  }
})

// GET /:id/step — resume: product + step_flow (synced against live job
// status) + assets + jobs. step_flow.printAdvice/printFile (design doc §10)
// come through automatically via getStepFlow's pass-through — no separate
// query needed; `assets` already includes every kind (incl. kind:'print')
// since the select below has no kind filter.
router.get('/:id/step', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', id).single()
    if (productError || !product) return res.status(404).json({ error: 'Product not found' })

    const { data: assets } = await supabase.from('product_assets').select('*').eq('product_id', id)
    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('product_id', id)
      .order('created_at', { ascending: true })

    // Brings step_flow.shots up to date with whatever the worker has already
    // finished, and performs the deferred 'details' render once the product
    // shot has landed.
    const step_flow = await resolveStepFlow(product, assets || [], jobs || [])

    // Derived from category (not step_flow.brief.productKind) so the
    // frontend can branch correctly even if the brief is missing/stale —
    // category is the durable signal, stamped at /create and never changed
    // afterward for a given product.
    const productKind: 'garment' | 'metal' = product.category === 'metal-art' ? 'metal' : 'garment'

    res.json({ product, step_flow, assets: assets || [], jobs: jobs || [], productKind })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] GET /:id/step error')
    res.status(500).json({ error: err?.message || 'Failed to load step flow' })
  }
})

// POST /:id/step/select-design — { assetId } -> { ok, asset, rembgJob }.
// Marks the picked take primary and queues rembg ONLY — unlike /select-image,
// this never queues mockups (David: mockups come later, after garments/colors
// are chosen against the transparent art). Metal prints (design doc §14)
// have no transparency to extract — a metal panel is the flat art itself,
// full-bleed — so a metal product NEVER gets a rembg job here; `rembgJob` in
// the response is `null` for a metal product.
router.post('/:id/step/select-design', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { assetId } = req.body || {}
    if (typeof assetId !== 'string' || !assetId) {
      return res.status(400).json({ error: 'assetId is required' })
    }

    const { data: asset, error: assetError } = await supabase
      .from('product_assets')
      .select('*')
      .eq('id', assetId)
      .eq('product_id', id)
      .single()
    if (assetError || !asset) return res.status(404).json({ error: 'Asset not found on this product' })
    // MUST-FIX #13: only a raw generated design (kind:'source') can become
    // the flow's selected design — a mockup, the details card, or any other
    // derived asset id must be rejected here, not silently promoted.
    if (asset.kind !== 'source') {
      return res.status(400).json({ error: 'Only a source design can be selected — pick one of the generated takes' })
    }

    await supabase.from('product_assets').update({ is_primary: false }).eq('product_id', id).eq('is_primary', true)

    const { data: updatedAsset, error: updateError } = await supabase
      .from('product_assets')
      .update({
        is_primary: true,
        asset_role: 'design',
        metadata: { ...(asset.metadata || {}), is_selected: true, selected_at: new Date().toISOString() },
      })
      .eq('id', assetId)
      .select()
      .single()
    if (updateError) return res.status(500).json({ error: updateError.message })

    // Picking a take IS the step's one approval — there's no separate
    // "approve design" route in the contract, so this stamp is what gates
    // the next step (Garments for a shirt, Sizes for metal) reachability on
    // the frontend.
    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)
    stepFlow.approvals = { ...stepFlow.approvals, design: new Date().toISOString() }
    await saveStepFlow(id, product.metadata, stepFlow)

    if (isMetalStepFlow(stepFlow)) {
      return res.json({ ok: true, asset: updatedAsset, rembgJob: null })
    }

    // Pre-claimed as 'running' at insert (2026-09-02) — same pattern as the
    // mockup jobs in services/step-flow/shots.ts: the production Render
    // worker only ever picks up 'queued' rows, so this keeps it from seeing
    // the job at all, and this API process renders it inline instead (below).
    // Job type stays 'replicate_rembg' — the frontend filters on it.
    // `input.stepKey` also excludes the row from the worker's stale-'running'
    // sweep (ai-jobs-worker.ts's processQueuedJobs) — a rembg call rarely
    // runs long, but without this a slow one crossing 12 minutes would get
    // reset to 'queued' and double-processed by the worker's old code.
    const { data: rembgJob, error: jobError } = await supabase
      .from('ai_jobs')
      .insert({
        product_id: id,
        type: 'replicate_rembg',
        status: 'running',
        input: { selected_asset_id: assetId, stepKey: 'design_rembg' },
      })
      .select()
      .single()
    if (jobError) return res.status(500).json({ error: 'Failed to create background removal job' })

    // Fire-and-forget: processRemoveBgJob already marks the ai_jobs row
    // succeeded/failed for every failure path it knows about; this .catch is
    // the safety net for anything that throws past it, so the row never gets
    // stuck spinning forever — mirrors every processImageJobInline call site.
    void processRemoveBgJob(rembgJob).catch(async (err: any) => {
      const message = err?.message || 'Background removal failed'
      req.log?.error({ jobId: rembgJob.id, err: message }, '[step-flow] rembg inline job failed')
      await supabase
        .from('ai_jobs')
        .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
        .eq('id', rembgJob.id)
    })

    res.json({ ok: true, asset: updatedAsset, rembgJob })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] select-design error')
    res.status(500).json({ error: err?.message || 'Failed to select design' })
  }
})

// POST /:id/step/print-advice — {} -> { advice }. Print prep panel (design
// doc §10, David 2026-09-02): a MEASURED recommendation for whether this
// design needs a halftone screen before DTF pressing — never renders
// anything, never gates ✓ Approve design (optional). Stored on
// step_flow.printAdvice so GET /:id/step returns it on reload.
router.post('/:id/step/print-advice', requireAuth, requireAdminOrManager, rateLimitAI(20), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)

    const pngUrl = await resolveDesignArtworkUrl(id)
    if (!pngUrl) return res.status(400).json({ error: 'No design artwork found yet — select a design first' })

    const primaryColorId = stepFlow.colors?.primary
    const primaryLuma = primaryColorId ? COLORS[primaryColorId]?.luma : undefined
    const advice = await computePrintAdvice(pngUrl, { primaryLuma })

    stepFlow.printAdvice = advice
    await saveStepFlow(id, product.metadata, stepFlow)

    res.json({ advice })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] print-advice error')
    res.status(500).json({ error: err?.message || 'Failed to compute print advice' })
  }
})

// POST /:id/step/print-file — { method?, frequency?, angle?, shape?,
// invertDark? } -> { printFile }. Runs the existing DTF halftone engine on
// the nobg PNG and uploads a TEAM-ONLY print file — asset_role
// 'print_halftone' is excluded from shared/product-gallery.ts's ROLE_ORDER,
// so it can never land in products.images/the storefront no matter what
// publishes. Redo overwrites: one print file per product, older
// product_assets row deleted (bucket object stays). Synchronous local sharp
// transform — no ai_jobs bookkeeping needed.
router.post('/:id/step/print-file', requireAuth, requireAdminOrManager, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { method, frequency, angle, shape, invertDark } = req.body || {}
    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)

    const pngUrl = await resolveDesignArtworkUrl(id)
    if (!pngUrl) return res.status(400).json({ error: 'No design artwork found yet — select a design first' })

    const printFile = await buildPrintFile(
      id,
      pngUrl,
      {
        method: method === 'diffusion' ? 'diffusion' : method === 'halftone' ? 'halftone' : undefined,
        frequency: typeof frequency === 'number' ? frequency : undefined,
        angle: typeof angle === 'number' ? angle : undefined,
        shape: shape === 'line' ? 'line' : shape === 'round' ? 'round' : undefined,
        invertDark: typeof invertDark === 'boolean' ? invertDark : undefined,
      },
      actorId(req)
    )

    stepFlow.printFile = printFile
    await saveStepFlow(id, product.metadata, stepFlow)

    res.json({ printFile })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] print-file error')
    res.status(500).json({ error: err?.message || 'Failed to build print file' })
  }
})

// POST /:id/step/color-advice — {} -> { advice, artwork }. Measures the nobg
// asset (falls back to the primary source design when rembg hasn't run yet).
// Metal prints (design doc §14) have no garment/shirt color to advise
// against — this branch still measures the artwork but always returns an
// empty advice list (adviseColorsForMetal).
router.post('/:id/step/color-advice', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)

    if (isMetalStepFlow(stepFlow)) {
      const pngUrl = await resolveDesignArtworkUrl(id)
      if (!pngUrl) return res.status(400).json({ error: 'No design artwork found yet — select a design first' })
      const { advice, artwork } = await adviseColorsForMetal(pngUrl)
      stepFlow.advice = advice
      await saveStepFlow(id, product.metadata, stepFlow)
      return res.json({ advice, artwork })
    }

    const garment: GarmentId = stepFlow.garment || (stepFlow.brief?.garmentHint as GarmentId | undefined) || 'tshirt'

    const { data: nobgAsset } = await supabase
      .from('product_assets')
      .select('url')
      .eq('product_id', id)
      .eq('kind', 'nobg')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let pngUrl = nobgAsset?.url as string | undefined
    if (!pngUrl) {
      const { data: sourceAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', id)
        .eq('kind', 'source')
        .eq('is_primary', true)
        .limit(1)
        .maybeSingle()
      pngUrl = sourceAsset?.url as string | undefined
    }
    if (!pngUrl) return res.status(400).json({ error: 'No design artwork found yet — select a design first' })

    const { advice, artwork } = await adviseColors(pngUrl, garment)

    stepFlow.advice = advice
    await saveStepFlow(id, product.metadata, stepFlow)

    res.json({ advice, artwork })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] color-advice error')
    res.status(500).json({ error: err?.message || 'Failed to compute color advice' })
  }
})

// POST /:id/step/garments — { garment, primaryColor, extraColors } -> { ok, step_flow }.
// Validated against the ITP capability boundary — anything not offered (polo,
// tank, embroidery, ...) is rejected here before it can ever reach a mockup.
router.post('/:id/step/garments', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { garment, primaryColor, extraColors } = req.body || {}
    if (typeof garment !== 'string' || typeof primaryColor !== 'string') {
      return res.status(400).json({ error: 'garment and primaryColor are required' })
    }
    const extras: string[] = Array.isArray(extraColors) ? extraColors.filter((c: unknown) => typeof c === 'string') : []

    let capabilityGarment
    try {
      capabilityGarment = assertOffered(garment, primaryColor)
      for (const c of extras) assertOffered(garment, c)
    } catch (e: any) {
      return res.status(400).json({ error: e.message })
    }

    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)
    stepFlow.garment = garment as GarmentId
    stepFlow.colors = {
      primary: primaryColor as ColorId,
      extras: extras.filter((c) => c !== primaryColor) as ColorId[],
    }
    stepFlow.approvals = { ...stepFlow.approvals, garments: new Date().toISOString() }

    // Mirror onto the product row's authoritative DTF fields too — every
    // other build path (create/one-shot/bulk/create-mockups) reads
    // metadata.product_type/shirt_color/print_placement as the source of
    // truth for the mockup worker.
    const { error: updateError } = await supabase
      .from('products')
      .update({
        category: capabilityGarment.category,
        metadata: {
          ...product.metadata,
          step_flow: stepFlow,
          product_type: garment,
          shirt_color: primaryColor,
          colors: [primaryColor, ...stepFlow.colors.extras],
          print_placement: 'front-center',
        },
      })
      .eq('id', id)
    if (updateError) return res.status(500).json({ error: updateError.message })

    res.json({ ok: true, step_flow: stepFlow })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] garments error')
    res.status(500).json({ error: err?.message || 'Failed to save garments/colors' })
  }
})

// POST /:id/step/sizes — { sizes: MetalArtSizeKey[] } -> { ok, step_flow }.
// Metal prints' analog of /step/garments above (design doc §14): picks which
// physical panel sizes this listing offers. Must be a non-empty subset of
// STUDIO_SIZE_KEYS (currently ['4x6','8x10']). Mirrors onto the product row
// the same way /step/garments does: products.price becomes the price of the
// SMALLEST selected size (the listing's entry price), metadata.metal_size
// becomes the LARGEST selected size (drives the mockup scale anchors and
// every other metal_size reader), and metadata.metal_prices carries every
// selected size's price for the storefront's size picker.
// `approvals.garments` is stamped (not a separate 'sizes' key) — same
// approval slot the garment flow uses, so every downstream gate that checks
// `approvals.garments` (e.g. reaching the Mockups step) keeps working
// unmodified for a metal product.
router.post('/:id/step/sizes', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { sizes } = req.body || {}
    if (!Array.isArray(sizes) || sizes.length === 0) {
      return res.status(400).json({ error: 'sizes[] is required and must be non-empty' })
    }
    const cleanSizes = Array.from(
      new Set(sizes.filter((s: unknown): s is MetalArtSizeKey => s === '4x6' || s === '8x10'))
    )
    if (cleanSizes.length === 0) {
      return res.status(400).json({ error: `sizes must be a subset of ${STUDIO_SIZE_KEYS.join(', ')}` })
    }
    // Canonical smallest-to-largest order regardless of the order sent.
    const ordered = STUDIO_SIZE_KEYS.filter((s) => cleanSizes.includes(s))
    const smallest = ordered[0]
    const largest = ordered[ordered.length - 1]

    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)
    stepFlow.metalSizes = ordered
    stepFlow.approvals = { ...stepFlow.approvals, garments: new Date().toISOString() }

    const metalPrices: Record<string, number> = {}
    for (const s of ordered) metalPrices[s] = METAL_ART_PRICES[s]

    const { error: updateError } = await supabase
      .from('products')
      .update({
        price: METAL_ART_PRICES[smallest],
        metadata: {
          ...product.metadata,
          step_flow: stepFlow,
          metal_sizes: ordered,
          metal_size: largest,
          metal_prices: metalPrices,
        },
      })
      .eq('id', id)
    if (updateError) return res.status(500).json({ error: updateError.message })

    res.json({ ok: true, step_flow: stepFlow })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] sizes error')
    res.status(500).json({ error: err?.message || 'Failed to save sizes' })
  }
})

// POST /:id/step/shots — { keys? } -> { jobs: [{ key, jobId }] }. Default =
// every key for the approved garment/colors (product/hanger/model/details +
// one color:<id> per extra color).
router.post('/:id/step/shots', requireAuth, requireAdminOrManager, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { keys } = req.body || {}
    const requestedKeys = Array.isArray(keys)
      ? (keys.filter((k: unknown): k is string => typeof k === 'string') as ShotKey[])
      : undefined
    const result = await queueStepShots(id, actorId(req), requestedKeys)
    res.json(result)
  } catch (err: any) {
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] shots error')
    res.status(500).json({ error: err?.message || 'Failed to queue shots' })
  }
})

// POST /:id/step/shots/:key/redo -> { job }. New render, old asset stays
// visible until the redo lands; the shot's approval resets to false.
router.post('/:id/step/shots/:key/redo', requireAuth, requireAdminOrManager, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id, key } = req.params
    const result = await redoShot(id, actorId(req), key as ShotKey)
    res.json(result)
  } catch (err: any) {
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] redo error')
    res.status(500).json({ error: err?.message || 'Failed to redo shot' })
  }
})

// POST /:id/step/shots/:key/approve — { approved, assetId, skipped? } -> { step_flow }.
// (MUST-FIX #1c: delegates to the batch path below so a mix of per-key and
// batch approvals on the same product still serialize through one lock.)
router.post('/:id/step/shots/:key/approve', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id, key } = req.params
    const { approved, assetId, skipped } = req.body || {}
    const result = await approveShot(
      id,
      key as ShotKey,
      !!approved,
      typeof assetId === 'string' ? assetId : undefined,
      !!skipped
    )
    res.json(result)
  } catch (err: any) {
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] approve error')
    res.status(500).json({ error: err?.message || 'Failed to approve shot' })
  }
})

// POST /:id/step/shots/approve — { keys: string[], approved: boolean, skipped?: boolean }
// -> { step_flow }. Batch approve/skip (MUST-FIX #1c) — "Approve all" fires
// this ONCE instead of N parallel per-key calls racing each other's
// read-modify-write of the same step_flow.shots object.
router.post('/:id/step/shots/approve', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { keys, approved, skipped } = req.body || {}
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'keys[] is required' })
    }
    const cleanKeys = keys.filter((k: unknown): k is string => typeof k === 'string') as ShotKey[]
    const result = await approveShotsBatch(
      id,
      cleanKeys.map((key) => ({ key, approved: !!approved, skipped: !!skipped }))
    )
    res.json(result)
  } catch (err: any) {
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] batch approve error')
    res.status(500).json({ error: err?.message || 'Failed to approve shots' })
  }
})

// POST /:id/step/publish — { title, description, tags, price } -> { product }.
// Server-side activation: status active, is_active true, images from
// buildApprovedGallery (approved step-flow shots only, ordered by the
// shared backend/shared/product-gallery.ts ROLE_ORDER).
router.post('/:id/step/publish', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { title, description, tags, price } = req.body || {}

    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', id).single()
    if (productError || !product) return res.status(404).json({ error: 'Product not found' })

    const { data: assets } = await supabase.from('product_assets').select('*').eq('product_id', id)
    const stepFlow = getStepFlow(product)
    // SHOULD-FIX #4: build from APPROVED step-flow shots only — a rendered
    // but never-approved (or since-redone) mockup must not sneak onto the
    // storefront just because a product_assets row for it exists. The "zero
    // approved" guard below counts approved FLOW shots specifically, not
    // whatever the whitelist happened to also pick up from non-flow roles
    // (mr_imagine, pocket, watermark) — those alone are not a finished
    // listing.
    const { images, approvedFlowCount } = buildApprovedGallery(stepFlow, assets || [])
    if (approvedFlowCount === 0) {
      return res.status(400).json({ error: 'No approved mockups yet — finish the Mockups step first' })
    }

    stepFlow.approvals = { ...stepFlow.approvals, listing: new Date().toISOString() }

    const updates: Record<string, any> = {
      status: 'active',
      is_active: true,
      images,
      metadata: { ...product.metadata, step_flow: stepFlow },
    }
    if (typeof title === 'string' && title.trim()) updates.name = title.trim()
    if (typeof description === 'string' && description.trim()) updates.description = description.trim()
    if (typeof price === 'number' && price > 0) updates.price = price
    if (stepFlow.colors?.primary) {
      // SHOULD-FIX #6: products.colors is the swatch-matching COLUMN
      // (ProductPage renders each entry directly as a CSS backgroundColor),
      // so it holds HEX values — metadata.colors keeps the capability slugs
      // ('royal-blue') for everything else that already reads it.
      const ids = [stepFlow.colors.primary, ...(stepFlow.colors.extras || [])]
      const hexes = ids.map((cid) => COLORS[cid]?.hex).filter((h): h is string => !!h)
      if (hexes.length > 0) updates.colors = hexes
    }

    const { data: updated, error: updateError } = await supabase.from('products').update(updates).eq('id', id).select().single()
    if (updateError) return res.status(500).json({ error: updateError.message })

    if (Array.isArray(tags) && tags.length > 0) {
      await supabase.from('product_tags').delete().eq('product_id', id)
      const cleanTags = tags.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
      if (cleanTags.length > 0) {
        await supabase.from('product_tags').insert(cleanTags.map((tag: string) => ({ product_id: id, tag })))
      }
    }

    res.json({ product: updated })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] publish error')
    res.status(500).json({ error: err?.message || 'Failed to publish' })
  }
})

export default router
