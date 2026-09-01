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
import { assertOffered, type ColorId, type GarmentId } from '../../shared/catalog-capability.js'
import { writeStepBrief } from '../../services/step-flow/brief.js'
import { adviseColors } from '../../services/step-flow/color-advice.js'
import {
  queueStepShots,
  redoShot,
  approveShot,
  resolveStepFlow,
  getStepFlow,
  saveStepFlow,
  loadProductRow,
  buildStepFlowGallery,
  StepFlowValidationError,
  type ShotKey,
} from '../../services/step-flow/shots.js'

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

const router = Router()

// POST /step/brief — { idea } -> { brief }. Step 1: idea -> best prompt.
router.post('/step/brief', requireAuth, requireAdminOrManager, rateLimitAI(20), async (req: Request, res: Response): Promise<any> => {
  try {
    const { idea } = req.body || {}
    if (typeof idea !== 'string' || !idea.trim()) {
      return res.status(400).json({ error: 'idea is required' })
    }
    const brief = await writeStepBrief(idea)
    res.json({ brief })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] brief error')
    res.status(500).json({ error: err?.message || 'Failed to write brief' })
  }
})

// GET /:id/step — resume: product + step_flow (synced against live job status) + assets + jobs.
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

    res.json({ product, step_flow, assets: assets || [], jobs: jobs || [] })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] GET /:id/step error')
    res.status(500).json({ error: err?.message || 'Failed to load step flow' })
  }
})

// POST /:id/step/select-design — { assetId } -> { ok, asset, rembgJob }.
// Marks the picked take primary and queues rembg ONLY — unlike /select-image,
// this never queues mockups (David: mockups come later, after garments/colors
// are chosen against the transparent art).
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

    const { data: rembgJob, error: jobError } = await supabase
      .from('ai_jobs')
      .insert({ product_id: id, type: 'replicate_rembg', status: 'queued', input: { selected_asset_id: assetId } })
      .select()
      .single()
    if (jobError) return res.status(500).json({ error: 'Failed to create background removal job' })

    // Picking a take IS the step's one approval — there's no separate
    // "approve design" route in the contract, so this stamp is what gates
    // Step 3 (Garments) reachability on the frontend.
    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)
    stepFlow.approvals = { ...stepFlow.approvals, design: new Date().toISOString() }
    await saveStepFlow(id, product.metadata, stepFlow)

    res.json({ ok: true, asset: updatedAsset, rembgJob })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] select-design error')
    res.status(500).json({ error: err?.message || 'Failed to select design' })
  }
})

// POST /:id/step/color-advice — {} -> { advice, artwork }. Measures the nobg
// asset (falls back to the primary source design when rembg hasn't run yet).
router.post('/:id/step/color-advice', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)
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

// POST /:id/step/shots/:key/approve — { approved, assetId } -> { step_flow }.
router.post('/:id/step/shots/:key/approve', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id, key } = req.params
    const { approved, assetId } = req.body || {}
    const result = await approveShot(id, key as ShotKey, !!approved, typeof assetId === 'string' ? assetId : undefined)
    res.json(result)
  } catch (err: any) {
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] approve error')
    res.status(500).json({ error: err?.message || 'Failed to approve shot' })
  }
})

// POST /:id/step/publish — { title, description, tags, price } -> { product }.
// Server-side activation: status active, is_active true, images from the
// approved-mockup gallery whitelist (buildStepFlowGallery — mirrors
// src/lib/product-gallery.ts's ROLE_ORDER).
router.post('/:id/step/publish', requireAuth, requireAdminOrManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { title, description, tags, price } = req.body || {}

    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', id).single()
    if (productError || !product) return res.status(404).json({ error: 'Product not found' })

    const { data: assets } = await supabase.from('product_assets').select('*').eq('product_id', id)
    const images = buildStepFlowGallery(assets || [])
    if (images.length === 0) {
      return res.status(400).json({ error: 'No approved mockups yet — finish the Mockups step first' })
    }

    const stepFlow = getStepFlow(product)
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
