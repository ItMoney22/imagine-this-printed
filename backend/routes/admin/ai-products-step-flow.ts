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
import { assertOffered, COLORS, photographableAudiences, sizesForGarment, type ColorId, type GarmentId } from '../../shared/catalog-capability.js'
// The listing copywriter and the casting catalog both live behind the ADMIN
// Etsy router (routes/admin/etsy.ts, which is requireRole(['admin','manager'])
// wholesale). The customer lane needs both and must never be handed that
// router, so the two routes below call the underlying SERVICES directly —
// same code, no Etsy surface area.
import { composeEtsyPack } from '../../services/etsy-seo-composer.js'
import { listShotSubjects } from '../../services/etsy-model-shots.js'
import { writeStepBrief } from '../../services/step-flow/brief.js'
import { pitchPhrases, pitchPhrasesForDesign } from '../../services/step-flow/phrases.js'
import {
  letterPhraseIntoDesign,
  LetterPhraseNotFoundError,
  LetterPhraseValidationError,
} from '../../services/step-flow/letter-phrase.js'
import { analyzeInspirationImage, InspirationValidationError } from '../../services/step-flow/inspiration.js'
import { adviseColors, adviseColorsForMetal } from '../../services/step-flow/color-advice.js'
import { computePrintAdvice, buildPrintFile } from '../../services/step-flow/print-prep.js'
import { STUDIO_SIZE_KEYS, METAL_ART_PRICES, metalSizesFor, type MetalArtSizeKey } from '../../shared/metal-art.js'
import { createWatermarkedDesignAsset } from '../../services/product-build.js'
// The print-resolution gate the design-library grid already enforces on its
// own Activate button — reused by /:id/step/adopt so a too-small design can't
// slip live through the Step Flow instead (see that route).
import { canActivate } from '../../services/design-library-quality.js'
import { stepFlowStage, STAGE_LABELS } from '../../services/step-flow/progress.js'
import {
  queueStepShots,
  redoShot,
  addModelShot,
  removeModelShot,
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
 *
 * Two lanes (David 2026-09-08, "our customers should have the same flow"):
 * this router is ALSO mounted at /api/studio by routes/studio-flow.ts, which
 * marks the request `studioLane === 'customer'` only AFTER it has run its own
 * gate — requireAuth + requireCreator + "you own this product". So on that
 * lane the admin role check is deliberately skipped; skipping it here without
 * that outer gate would open the whole flow to any signed-in user, which is
 * why the flag is set by the mount and never by the client.
 */
export type StudioLane = 'admin' | 'customer'

export function laneOf(req: Request): StudioLane {
  return (req as any).studioLane === 'customer' ? 'customer' : 'admin'
}

async function requireStudioAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (laneOf(req) === 'customer') {
    next()
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

/** The design as GENERATED, before any background removal. Print advice has to
 *  read this: a stripped file's opaque pixels are dominated by anti-aliased
 *  edges, which skews every smoothness measurement taken on it. */
async function resolveSourceArtworkUrl(productId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from('product_assets')
    .select('url')
    .eq('product_id', productId)
    .eq('kind', 'source')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.url as string | undefined
}

const router = Router()

// POST /step/brief — { idea, phrase? } -> { brief }. Step 1: idea -> best
// prompt. `phrase` (design doc §11) is either David's typed line or one Mrs.
// Imagine pitched via /step/phrases below; writeStepBrief guarantees the
// exact quoted text reaches designPrompt on every path (model success AND
// fallback), so passing it straight through here is enough — no extra
// validation needed, brief.ts sanitizes it.
router.post('/step/brief', requireAuth, requireStudioAccess, rateLimitAI(20), async (req: Request, res: Response): Promise<any> => {
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
router.post('/step/inspiration', requireAuth, requireStudioAccess, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
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
router.post('/step/phrases', requireAuth, requireStudioAccess, rateLimitAI(20), async (req: Request, res: Response): Promise<any> => {
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

// GET /step/shot-subjects — the archetypes castable on a garment, for the
// Mockups step's "who should model this" picker. The admin lane has always
// read this off /api/admin/etsy/shot-subjects; that router is admin-only, so
// the customer lane reads the same catalog here instead of being handed an
// Etsy mount it has no business holding. `?garment=` narrows it to the age
// bands that garment's listing actually sells (see photographableAudiences).
router.get('/step/shot-subjects', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
  const garment = typeof req.query.garment === 'string' ? req.query.garment : undefined
  try {
    res.json({ subjects: listShotSubjects(garment ? photographableAudiences(garment as GarmentId) : undefined) })
  } catch {
    // An unknown garment is a client mistake, not a server fault — hand back
    // the full catalog rather than 500-ing a picker.
    res.json({ subjects: listShotSubjects() })
  }
})

// GET /step/in-progress — {} -> { builds: [...] }. Every build part-way
// through the flow, newest first, each with the step to pick it back up on.
//
// David 2026-09-08: "idk where to pick up the step flow i already am doing."
// Once a design is pulled in it leaves the Designs grid, so without this list
// a half-finished build would be genuinely hard to find again among thousands
// of product rows.
//
// Registered ahead of `/:id/step` for readability only — the two can't collide
// ('/step/in-progress' would need the literal second segment to be 'step').
router.get('/step/in-progress', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
    let query = supabase
      .from('products')
      .select('id, name, status, images, category, updated_at, metadata')
      // `approvals.design` is stamped when a design is selected — the same
      // signal isInStepFlow() reads, applied here as a jsonb filter so the
      // database does the work instead of scanning every product row.
      .not('metadata->step_flow->approvals->>design', 'is', null)
      // A published build is finished; it belongs in the catalog, not here.
      .neq('status', 'active')
    // Customer lane: only YOUR unfinished builds. Without this a customer's
    // "pick up where you left off" list would be every draft in the shop.
    if (laneOf(req) === 'customer') query = query.eq('created_by_user_id', actorId(req))
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(limit)
    if (error) throw error

    const rows = data || []
    // One query for the whole page: a nobg asset is what separates "still
    // stripping the background" from "ready to pick a garment".
    const { data: nobgRows } = rows.length
      ? await supabase.from('product_assets').select('product_id').eq('kind', 'nobg').in('product_id', rows.map((r: any) => r.id))
      : { data: [] as any[] }
    const hasNobg = new Set((nobgRows || []).map((r: any) => r.product_id))

    const builds = rows
      .map((p: any) => {
        const stage = stepFlowStage(p.metadata, p.status, hasNobg.has(p.id))
        if (!stage || stage === 'published') return null
        return {
          id: p.id,
          name: p.name,
          image: Array.isArray(p.images) ? p.images[0] ?? null : null,
          stage,
          stageLabel: STAGE_LABELS[stage],
          collection: p.metadata?.collection ?? null,
          fromLibrary: p.metadata?.import_source === 'design-library',
          updatedAt: p.updated_at ?? null,
        }
      })
      .filter(Boolean)

    res.json({ builds })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] in-progress error')
    res.status(500).json({ error: err?.message || 'Failed to load builds in progress' })
  }
})

// GET /:id/step — resume: product + step_flow (synced against live job
// status) + assets + jobs. step_flow.printAdvice/printFile (design doc §10)
// come through automatically via getStepFlow's pass-through — no separate
// query needed; `assets` already includes every kind (incl. kind:'print')
// since the select below has no kind filter.
router.get('/:id/step', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
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
    // afterward for a given product. Nested on step_flow (not a sibling of
    // it) to match the frontend's StepFlowMeta.productKind wire contract
    // (src/lib/api.ts, src/components/studio/stepFlowReducer.ts's HYDRATE) —
    // this overrides getStepFlow's brief-derived value for the RESPONSE
    // only; every internal StepFlowMeta reader still uses the brief-derived
    // value via isMetalStepFlow().
    const productKind: 'garment' | 'metal' = product.category === 'metal-art' ? 'metal' : 'garment'

    res.json({ product, step_flow: { ...step_flow, productKind }, assets: assets || [], jobs: jobs || [] })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] GET /:id/step error')
    res.status(500).json({ error: err?.message || 'Failed to load step flow' })
  }
})

/** What `selectDesignForFlow` hands back — the same two fields
 *  POST /:id/step/select-design has always answered with. */
interface SelectDesignResult {
  asset: any
  rembgJob: any | null
}

/** Kept distinct from StepFlowValidationError so the routes below can answer
 *  404 (not 400) for a missing asset, exactly as select-design always has. */
class StepFlowNotFoundError extends Error {}

/**
 * The Design step's one approval: mark a source take primary, stamp
 * `approvals.design`, make the watermarked gallery copy, and (garments only)
 * strip the background inline.
 *
 * Extracted from POST /:id/step/select-design so POST /:id/step/adopt — which
 * brings an already-drawn design-library PNG into the flow — runs the SAME
 * path instead of a second copy of it that could drift. Throws
 * StepFlowNotFoundError (-> 404) or StepFlowValidationError (-> 400) for the
 * two rejections the caller has to surface.
 */
async function selectDesignForFlow(
  productId: string,
  assetId: string,
  log?: { error?: (...args: any[]) => void }
): Promise<SelectDesignResult> {
  const { data: asset, error: assetError } = await supabase
    .from('product_assets')
    .select('*')
    .eq('id', assetId)
    .eq('product_id', productId)
    .single()
  if (assetError || !asset) throw new StepFlowNotFoundError('Asset not found on this product')
  // MUST-FIX #13: only a raw generated design (kind:'source') can become
  // the flow's selected design — a mockup, the details card, or any other
  // derived asset id must be rejected here, not silently promoted.
  if (asset.kind !== 'source') {
    throw new StepFlowValidationError('Only a source design can be selected — pick one of the generated takes')
  }

  await supabase.from('product_assets').update({ is_primary: false }).eq('product_id', productId).eq('is_primary', true)

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
  if (updateError) throw new Error(updateError.message)

  // Picking a take IS the step's one approval — there's no separate
  // "approve design" route in the contract, so this stamp is what gates
  // the next step (Garments for a shirt, Sizes for metal) reachability on
  // the frontend.
  const product = await loadProductRow(productId)
  const stepFlow = getStepFlow(product)
  stepFlow.approvals = { ...stepFlow.approvals, design: new Date().toISOString() }
  await saveStepFlow(productId, product.metadata, stepFlow)

  // Gallery contract slot (shared/product-gallery.ts): the WATERMARKED copy
  // of the chosen design. The classic wizard made this on its mockup
  // fan-out; the Step Flow never did, so a metal print — whose gallery
  // LEADS with the artwork — published with scenes only (David 2026-09-02:
  // "didn't put the main image in the product details, just the mockups").
  // Fire-and-forget (sharp + GCS upload); /step/publish re-checks and
  // makes it synchronously if this hasn't landed by then.
  if (updatedAsset?.url) void createWatermarkedDesignAsset(productId, { id: updatedAsset.id, url: updatedAsset.url })

  if (isMetalStepFlow(stepFlow)) {
    return { asset: updatedAsset, rembgJob: null }
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
      product_id: productId,
      type: 'replicate_rembg',
      status: 'running',
      input: { selected_asset_id: assetId, stepKey: 'design_rembg' },
    })
    .select()
    .single()
  if (jobError) throw new Error('Failed to create background removal job')

  // Fire-and-forget: processRemoveBgJob already marks the ai_jobs row
  // succeeded/failed for every failure path it knows about; this .catch is
  // the safety net for anything that throws past it, so the row never gets
  // stuck spinning forever — mirrors every processImageJobInline call site.
  void processRemoveBgJob(rembgJob).catch(async (err: any) => {
    const message = err?.message || 'Background removal failed'
    log?.error?.({ jobId: rembgJob.id, err: message }, '[step-flow] rembg inline job failed')
    await supabase
      .from('ai_jobs')
      .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
      .eq('id', rembgJob.id)
  })

  return { asset: updatedAsset, rembgJob }
}

// POST /:id/step/select-design — { assetId } -> { ok, asset, rembgJob }.
// Marks the picked take primary and queues rembg ONLY — unlike /select-image,
// this never queues mockups (David: mockups come later, after garments/colors
// are chosen against the transparent art). Metal prints (design doc §14)
// have no transparency to extract — a metal panel is the flat art itself,
// full-bleed — so a metal product NEVER gets a rembg job here; `rembgJob` in
// the response is `null` for a metal product.
router.post('/:id/step/select-design', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { assetId } = req.body || {}
    if (typeof assetId !== 'string' || !assetId) {
      return res.status(400).json({ error: 'assetId is required' })
    }

    const { asset, rembgJob } = await selectDesignForFlow(id, assetId, req.log)
    res.json({ ok: true, asset, rembgJob })
  } catch (err: any) {
    if (err instanceof StepFlowNotFoundError) return res.status(404).json({ error: err.message })
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] select-design error')
    res.status(500).json({ error: err?.message || 'Failed to select design' })
  }
})

// ---------------------------------------------------------------------------
// Words on a design that already exists (David 2026-09-09): "the phrases or
// ask mrs imagine to come up with a phrase she is going off the prompt and it
// really doesnt match the design of the image so it sucks can we fix that in
// the flow".
//
// The two routes below are the fix, and they only make sense as a pair: the
// first lets Mrs. Imagine LOOK at the finished take before she writes a line,
// the second letters the chosen line onto that exact take. Both live at the
// Design step, because that is the first moment in the flow where a picture
// exists to match. The blind pitch that used to front the Idea step is gone.
// ---------------------------------------------------------------------------

/** The take a phrase pass should act on when the caller names none: the selected design, else the newest generated take. */
async function resolveDesignTake(productId: string, assetId?: unknown): Promise<any> {
  if (typeof assetId === 'string' && assetId) {
    const { data, error } = await supabase
      .from('product_assets')
      .select('*')
      .eq('id', assetId)
      .eq('product_id', productId)
      .single()
    if (error || !data) throw new StepFlowNotFoundError('Asset not found on this product')
    return data
  }
  const { data: takes } = await supabase
    .from('product_assets')
    .select('*')
    .eq('product_id', productId)
    .eq('kind', 'source')
    .eq('asset_role', 'design')
    .order('created_at', { ascending: false })
  const list = takes ?? []
  const take = list.find((a: any) => a.is_primary) ?? list[0]
  if (!take) throw new StepFlowNotFoundError('This build has no design yet')
  return take
}

// POST /:id/step/phrases-for-design — { assetId?, count? } ->
// { persona, intro, saw, existingText, phrases }.
//
// Mrs. Imagine with her eyes open. Unmetered on both lanes for the same reason
// /step/phrases is: this is one cheap vision call and it produces nothing but
// suggestions — the customer is charged when a phrase is actually lettered in
// (the route below), not for asking what would fit.
router.post('/:id/step/phrases-for-design', requireAuth, requireStudioAccess, rateLimitAI(20), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { assetId, count } = req.body || {}
    const take = await resolveDesignTake(id, assetId)
    if (!take.url) return res.status(400).json({ error: 'That take has no image to look at yet' })

    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)
    const result = await pitchPhrasesForDesign(take.url, {
      idea: typeof stepFlow.idea === 'string' ? stepFlow.idea : undefined,
      count: typeof count === 'number' ? count : undefined,
    })
    res.json({ ...result, assetId: take.id })
  } catch (err: any) {
    if (err instanceof StepFlowNotFoundError) return res.status(404).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] phrases-for-design error')
    res.status(500).json({ error: err?.message || 'Failed to pitch phrases for this design' })
  }
})

// POST /:id/step/letter-phrase — { assetId, phrase: { text, placement?, style? } }
// -> { ok, asset, phrase }.
//
// Adds the words to the take by EDITING it, so the artwork David picked
// survives and only the lettering is new (services/step-flow/letter-phrase.ts
// explains why this is not a re-render). The result is saved as another take,
// so nothing downstream changes: it appears in the same grid and is chosen
// with the same "Use this" button.
router.post('/:id/step/letter-phrase', requireAuth, requireStudioAccess, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { assetId, phrase } = req.body || {}
    if (typeof assetId !== 'string' || !assetId) {
      return res.status(400).json({ error: 'assetId is required' })
    }
    const { asset, phrase: applied } = await letterPhraseIntoDesign(id, assetId, phrase, {
      userId: (req as any).studioOwnerId || req.user?.sub,
    })
    res.json({ ok: true, asset, phrase: applied })
  } catch (err: any) {
    if (err instanceof LetterPhraseNotFoundError) return res.status(404).json({ error: err.message })
    if (err instanceof LetterPhraseValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] letter-phrase error')
    res.status(500).json({ error: err?.message || 'Failed to add those words to the design' })
  }
})

// POST /:id/step/adopt — {} -> { ok, productId, assetId, alreadyAdopted, rembgJob }.
//
// Brings an ALREADY-DRAWN design into the Step Flow, so the Idea and Design
// GENERATE steps are skipped and the flow picks up at Garment & Color →
// Mockups → Listing → Etsy (David 2026-09-08: "bring that design in and
// continue the flow ... then make mockups for it so we can use these designs
// to add to our store").
//
// Why a route is needed at all: the design library's ~2,700 rows
// (scripts/import-designs.mjs) carry their artwork ONLY on
// `products.images[0]` — the importer never wrote a `product_assets` row. The
// Step Flow reads its takes from `product_assets` (kind:'source'), so the
// existing "Continue in Step Flow" deep link lands on an EMPTY Design step for
// every one of them. This route creates that missing asset row from the
// catalogued PNG and then runs the ordinary `selectDesignForFlow` path over
// it, so an adopted design gets exactly the same approval stamp, watermarked
// gallery copy and background removal as one the flow drew itself. (The PNGs
// are usually already transparent; services/background-removal.ts detects that
// and passes them through untouched rather than re-cutting them.)
//
// Adopts IN PLACE (David's call, 2026-09-08): the library row IS the product
// that gets built and published, so the collection grid shows a design flip
// from draft to LIVE and it stays visible which of the library designs have
// actually become listings.
//
// Idempotent: adopting a product that already has a source design just hands
// back the existing one (`alreadyAdopted: true`). It also doubles as the
// repair — a row whose design was never selected, or whose background removal
// never produced a print file, gets put back through the cut.
router.post('/:id/step/adopt', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', id).single()
    if (productError || !product) return res.status(404).json({ error: 'Product not found' })

    // Already in the flow? Never make a second take out of the same artwork —
    // hand back what's there so the caller can just open the builder.
    const { data: existing } = await supabase
      .from('product_assets')
      .select('*')
      .eq('product_id', id)
      .eq('kind', 'source')
      .order('created_at', { ascending: false })
    const existingSource = (existing || [])[0]
    if (existingSource) {
      // The flow can't move past Design without a transparent print file, and
      // a failed background removal leaves the step with nothing to show and
      // no way forward. So this button doubles as the repair: re-select when
      // the design was never selected (an interrupted adopt) OR when the cut
      // never landed. Metal prints never get a nobg asset by design, so they
      // only ever check the selection.
      const { data: nobg } = await supabase
        .from('product_assets')
        .select('id')
        .eq('product_id', id)
        .eq('kind', 'nobg')
        .limit(1)
      const selected = (existing || []).some((a: any) => a.is_primary)
      const needsCut = product.category !== 'metal-art' && !(nobg || []).length
      if (!selected || needsCut) {
        const { rembgJob } = await selectDesignForFlow(id, existingSource.id, req.log)
        return res.json({ ok: true, productId: id, assetId: existingSource.id, alreadyAdopted: true, rembgJob })
      }
      return res.json({ ok: true, productId: id, assetId: existingSource.id, alreadyAdopted: true, rembgJob: null })
    }

    const designUrl: string | undefined = Array.isArray(product.images)
      ? product.images.find((u: unknown) => typeof u === 'string' && u)
      : undefined
    if (!designUrl) {
      return res.status(400).json({ error: 'This product has no design image to bring into the flow' })
    }

    // The print-resolution gate, enforced HERE because it cannot be enforced
    // later: /step/publish activates the product directly and never consults
    // the design-library gate that /design-library/set-status runs. Without
    // this check, routing a too-small design through the Step Flow would be a
    // way to put blurry artwork live that the grid's own Activate button
    // refuses. An admin who has knowingly released the quarantine passes.
    const verdict = canActivate(product.metadata)
    if (!verdict.allowed) {
      return res.status(422).json({
        error: verdict.check.reason,
        blocked: [{ id, name: product.name, reason: verdict.check.reason, code: verdict.check.code, gate: 'print' }],
      })
    }

    const image = product.metadata?.image || {}
    const { data: asset, error: assetError } = await supabase
      .from('product_assets')
      .insert({
        product_id: id,
        kind: 'source',
        // The importer already stored the GCS object path; reusing it keeps
        // the asset row pointing at the SAME object as products.images[0]
        // instead of duplicating an 11 MB PNG into a second bucket path.
        path: product.metadata?.gcs_path ?? null,
        url: designUrl,
        width: Number(image.width_px) || null,
        height: Number(image.height_px) || null,
        asset_role: 'design',
        is_primary: false,
        display_order: 99,
        metadata: {
          adopted_from: product.metadata?.import_source || 'catalog',
          collection: product.metadata?.collection ?? null,
          import_key: product.metadata?.import_key ?? null,
          // Recorded so the Design step / print prep know whether this PNG
          // arrived with real transparency or is a flat image still to cut.
          has_alpha: image.has_alpha ?? null,
          adopted_at: new Date().toISOString(),
        },
      })
      .select()
      .single()
    if (assetError || !asset) return res.status(500).json({ error: assetError?.message || 'Failed to create the design asset' })

    // Seed the flow's `idea` with the design's catalogued name so the details
    // card and the listing composer have something real to work from. `brief`
    // stays null on purpose — nothing generated this design, so there is no
    // prompt, and DesignStep correctly disables Tweak when the brief is null.
    const productRow = await loadProductRow(id)
    const stepFlow = getStepFlow(productRow)
    if (!stepFlow.idea) {
      stepFlow.idea = product.name || 'Design library import'
      await saveStepFlow(id, productRow.metadata, stepFlow)
    }

    const { rembgJob } = await selectDesignForFlow(id, asset.id, req.log)
    res.json({ ok: true, productId: id, assetId: asset.id, alreadyAdopted: false, rembgJob })
  } catch (err: any) {
    if (err instanceof StepFlowNotFoundError) return res.status(404).json({ error: err.message })
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] adopt error')
    res.status(500).json({ error: err?.message || 'Failed to bring this design into the flow' })
  }
})

// POST /:id/step/print-advice — {} -> { advice }. Print prep panel (design
// doc §10, David 2026-09-02): a MEASURED recommendation for whether this
// design needs a halftone screen before DTF pressing — never renders
// anything, never gates ✓ Approve design (optional). Stored on
// step_flow.printAdvice so GET /:id/step returns it on reload.
router.post('/:id/step/print-advice', requireAuth, requireStudioAccess, rateLimitAI(20), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)

    // Judge the SOURCE, not the stripped file. Print advice measures how much
    // of the art is smooth shading, and on a transparent cut the surviving
    // opaque pixels are mostly anti-aliased LINE EDGES - which read as smooth
    // and push flat line art over the halftone threshold. Measured on the
    // Beam Me Up design: source 28% smooth -> "clean" at 0.72 confidence, the
    // same art after cutting 37.5% -> "halftone" at 0.38. Halftoning that
    // comic line art all but erased it.
    const pngUrl = (await resolveSourceArtworkUrl(id)) || (await resolveDesignArtworkUrl(id))
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
// invertDark?, colors?, detail?, despeckle? } -> { printFile }. Runs the DTF
// halftone engine, or the vectorizer when method is 'vector', on
// the nobg PNG and uploads a TEAM-ONLY print file — asset_role
// 'print_halftone' is excluded from shared/product-gallery.ts's ROLE_ORDER,
// so it can never land in products.images/the storefront no matter what
// publishes. Redo overwrites: one print file per product, older
// product_assets row deleted (bucket object stays). Synchronous local sharp
// transform — no ai_jobs bookkeeping needed.
router.post('/:id/step/print-file', requireAuth, requireStudioAccess, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { method, frequency, angle, shape, invertDark, colors, detail, despeckle } = req.body || {}
    const product = await loadProductRow(id)
    const stepFlow = getStepFlow(product)

    const pngUrl = await resolveDesignArtworkUrl(id)
    if (!pngUrl) return res.status(400).json({ error: 'No design artwork found yet — select a design first' })

    const printFile = await buildPrintFile(
      id,
      pngUrl,
      {
        // 'vector' traces the artwork into flat SVG shapes instead of
        // screening it into dots — the same team-only print-file slot, the
        // other answer to "this needs prepping for the press". Our designs are
        // 1024px, which is ~85 DPI at a 12in press against the ~300 a film
        // wants; an SVG has no resolution to be soft at. It flattens gradients
        // and fine texture though, so it is an add-on the admin chooses, not a
        // default.
        method: method === 'diffusion' ? 'diffusion' : method === 'vector' ? 'vector' : method === 'halftone' ? 'halftone' : undefined,
        frequency: typeof frequency === 'number' ? frequency : undefined,
        angle: typeof angle === 'number' ? angle : undefined,
        shape: shape === 'line' ? 'line' : shape === 'round' ? 'round' : undefined,
        invertDark: typeof invertDark === 'boolean' ? invertDark : undefined,
        colors: typeof colors === 'number' ? colors : undefined,
        detail: typeof detail === 'number' ? detail : undefined,
        despeckle: typeof despeckle === 'number' ? despeckle : undefined,
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
router.post('/:id/step/color-advice', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
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

/** Keep an explicitly chosen print width, but never let it exceed what this garment can physically take. */
function clampPrintSize(current: unknown, garmentMax: number): number {
  const n = Number(current)
  return Number.isFinite(n) && n > 0 ? Math.min(n, garmentMax) : garmentMax
}

// POST /:id/step/garments — { garment, primaryColor, extraColors } -> { ok, step_flow }.
// Validated against the ITP capability boundary — anything not offered (polo,
// tank, embroidery, ...) is rejected here before it can ever reach a mockup.
router.post('/:id/step/garments', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
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
        // Every size this garment's listing sells (David 2026-09-03 for the
        // youth tee, 2026-09-07 for the youth band on adult listings): the
        // adult range PLUS the youth cut. Written whole rather than as
        // `capabilityGarment.sizes`, which is the adult band only — the column
        // is what fulfilment and any direct reader see, so an adult-only value
        // here would make the DB disagree with the storefront about what a
        // buyer was allowed to order.
        sizes: sizesForGarment(garment),
        metadata: {
          ...product.metadata,
          step_flow: stepFlow,
          product_type: garment,
          shirt_color: primaryColor,
          colors: [primaryColor, ...stepFlow.colors.extras],
          print_placement: 'front-center',
          // Mockup prompts scale the print off this. CLAMPED, not overwritten:
          // an admin's deliberately smaller pick survives, but an 11-inch
          // adult print can't stay on a youth tee whose whole body is 18
          // inches wide.
          print_size_inches: clampPrintSize(product.metadata?.print_size_inches, capabilityGarment.printWidthInches),
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
// the same way /step/garments does: products.sizes holds the selection,
// products.price becomes the price of the
// SMALLEST selected size (the listing's entry price), metadata.metal_size
// becomes the LARGEST selected size (drives the mockup scale anchors and
// every other metal_size reader), and metadata.metal_prices carries every
// selected size's price for the storefront's size picker.
// `approvals.garments` is stamped (not a separate 'sizes' key) — same
// approval slot the garment flow uses, so every downstream gate that checks
// `approvals.garments` (e.g. reaching the Mockups step) keeps working
// unmodified for a metal product.
router.post('/:id/step/sizes', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
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
    stepFlow.sizes = ordered
    stepFlow.approvals = { ...stepFlow.approvals, garments: new Date().toISOString() }

    const metalPrices: Record<string, number> = {}
    for (const s of ordered) metalPrices[s] = METAL_ART_PRICES[s]

    const { error: updateError } = await supabase
      .from('products')
      .update({
        price: METAL_ART_PRICES[smallest],
        // The `sizes` COLUMN is what the storefront picker, the admin editor
        // and metalSizesFor() read first — without it ProductPage fell back
        // to a hardcoded list and the editor showed nothing selected.
        sizes: ordered,
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
router.post('/:id/step/shots', requireAuth, requireStudioAccess, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
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

// POST /:id/step/shots/:key/redo — { subjectId? } -> { job }. New render, old
// asset stays visible until the redo lands; the shot's approval resets to
// false. `subjectId` (model shot only, David 2026-09-08) picks the exact
// archetype instead of letting Mrs. Imagine re-cast automatically.
router.post('/:id/step/shots/:key/redo', requireAuth, requireStudioAccess, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id, key } = req.params
    const subjectId = typeof req.body?.subjectId === 'string' && req.body.subjectId.trim() ? req.body.subjectId.trim() : undefined
    // Whitelisted, not passed through: `engine` selects a render path that
    // costs real money, so an unknown value is refused rather than forwarded.
    const engine = req.body?.engine === 'print-true' ? 'print-true' as const : undefined
    if (req.body?.engine !== undefined && !engine) {
      return res.status(400).json({ error: `Unknown engine "${String(req.body.engine)}"` })
    }
    const result = await redoShot(id, actorId(req), key as ShotKey, subjectId, engine)
    res.json(result)
  } catch (err: any) {
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] redo error')
    res.status(500).json({ error: err?.message || 'Failed to redo shot' })
  }
})

// POST /:id/step/shots/model — { subjectId? } -> { job }. Adds ANOTHER
// on-person shot, keeping every one already taken (David 2026-09-08: "keep
// the adult and add a kid"). Omit subjectId to let Mrs. Imagine cast it.
router.post('/:id/step/shots/model', requireAuth, requireStudioAccess, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const subjectId = typeof req.body?.subjectId === 'string' && req.body.subjectId.trim() ? req.body.subjectId.trim() : undefined
    const result = await addModelShot(id, actorId(req), subjectId)
    res.json(result)
  } catch (err: any) {
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] add model error')
    res.status(500).json({ error: err?.message || 'Failed to add a model shot' })
  }
})

// DELETE /:id/step/shots/:key — remove an ADDED on-person shot (model:<n>).
// The first one is part of every listing and can only be redone, not dropped.
router.delete('/:id/step/shots/:key', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id, key } = req.params
    const result = await removeModelShot(id, key as ShotKey)
    res.json(result)
  } catch (err: any) {
    if (err instanceof StepFlowValidationError) return res.status(400).json({ error: err.message })
    req.log?.error({ err: err?.message }, '[step-flow] remove model error')
    res.status(500).json({ error: err?.message || 'Failed to remove the shot' })
  }
})

// POST /:id/step/shots/:key/approve — { approved, assetId, skipped? } -> { step_flow }.
// (MUST-FIX #1c: delegates to the batch path below so a mix of per-key and
// batch approvals on the same product still serialize through one lock.)
router.post('/:id/step/shots/:key/approve', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
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
router.post('/:id/step/shots/approve', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
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

// POST /:id/step/publish — { title, description, tags, price? } -> { product }.
// Server-side activation: status active, is_active true, images from
// buildApprovedGallery (approved step-flow shots only, ordered by the
// shared backend/shared/product-gallery.ts ROLE_ORDER — METAL_ROLE_ORDER,
// artwork first, for a metal print). `price` is honoured for garments only;
// a metal print's price comes from shared/metal-art.ts (see below).
// POST /:id/step/listing-copy — writes the title/description/tags/price the
// Listing step opens with. Identical to what the admin lane gets from
// /api/admin/etsy/compose/:id (same composeEtsyPack call); it exists here so
// the customer lane can compose a listing WITHOUT touching the Etsy router.
// Etsy-specific fields in the pack are simply not rendered on that lane.
router.post('/:id/step/listing-copy', requireAuth, requireStudioAccess, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const pack = await composeEtsyPack(req.params.id)
    res.json({ pack })
  } catch (err: any) {
    req.log?.error({ err: err?.message }, '[step-flow] listing-copy error')
    res.status(500).json({ error: err?.message || 'Failed to write the listing' })
  }
})

router.post('/:id/step/publish', requireAuth, requireStudioAccess, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { title, description, tags, price } = req.body || {}

    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', id).single()
    if (productError || !product) return res.status(404).json({ error: 'Product not found' })

    let { data: assets } = await supabase.from('product_assets').select('*').eq('product_id', id)
    const stepFlow = getStepFlow(product)
    const isMetal = isMetalStepFlow(stepFlow)

    // Gallery contract slot: the watermarked design (see /step/select-design,
    // which makes it in the background). If it hasn't landed — an older
    // draft, or that background run failed — make it now, synchronously, so
    // the storefront gallery is complete on the first publish. For a metal
    // print this is the LEAD image (METAL_ROLE_ORDER).
    if (!(assets || []).some((a: any) => a.asset_role === 'design_watermarked')) {
      const design =
        (assets || []).find((a: any) => a.kind === 'source' && a.is_primary && a.url) ||
        (assets || []).find((a: any) => a.asset_role === 'design' && a.url)
      if (design) {
        await createWatermarkedDesignAsset(id, { id: design.id, url: design.url })
        const refreshed = await supabase.from('product_assets').select('*').eq('product_id', id)
        if (refreshed.data) assets = refreshed.data
      }
    }
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

    // The one place the two lanes genuinely differ. An admin finishing the
    // flow PUBLISHES — the product goes live on the storefront. A customer
    // finishing it SUBMITS FOR REVIEW: same gallery, same listing copy, but
    // `pending_approval` and is_active:false, which is the queue every
    // creator design already goes through (see routes/creator-studio.ts's
    // /:id/submit). Nothing a customer builds can reach the storefront
    // without a human approving it.
    const lane = laneOf(req)
    // The review queue (GET /api/admin/user-products/pending) matches on
    // `metadata.user_submitted === 'true'` AND status pending_approval — BOTH.
    // Stamping only the status would land a customer's finished build in a
    // place nothing lists and nobody reviews, so these ride together. Fields
    // mirror routes/creator-studio.ts's /:id/submit exactly.
    const submitStamp =
      lane === 'customer'
        ? {
            user_submitted: true,
            submitted_at: new Date().toISOString(),
            creator_id: actorId(req),
            creator_royalty_percent: Number((req as any).creator?.royaltyPercent) || 15,
          }
        : {}
    const updates: Record<string, any> = {
      status: lane === 'customer' ? 'pending_approval' : 'active',
      is_active: lane !== 'customer',
      images,
      metadata: { ...product.metadata, ...submitStamp, step_flow: stepFlow },
    }
    if (typeof title === 'string' && title.trim()) updates.name = title.trim()
    if (typeof description === 'string' && description.trim()) updates.description = description.trim()
    if (isMetal) {
      // A metal print's price is OWNED by backend/shared/metal-art.ts (David
      // 2026-09-02: 4x6 $8.95 / 8x10 $16.95) — never the listing pack's $25
      // Etsy anchor, which is what the Listing step used to send here and
      // what overwrote the Sizes step's price on the first Golden Gate
      // print. products.price stays the entry (smallest offered) price; the
      // per-size prices ride on metadata.metal_prices + the sizes column.
      const offered = stepFlow.sizes?.length ? stepFlow.sizes : metalSizesFor(product)
      const metalPrices: Record<string, number> = {}
      for (const s of offered) metalPrices[s] = METAL_ART_PRICES[s]
      updates.price = METAL_ART_PRICES[offered[0]]
      updates.sizes = offered
      updates.metadata = {
        ...updates.metadata,
        metal_sizes: offered,
        metal_size: offered[offered.length - 1],
        metal_prices: metalPrices,
      }
      if (typeof price === 'number' && price > 0 && Math.abs(price - updates.price) > 0.005) {
        req.log?.warn?.({ productId: id, sent: price, used: updates.price }, '[step-flow] publish: ignored client price for a metal print')
      }
    } else if (typeof price === 'number' && price > 0) {
      updates.price = price
    }
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
