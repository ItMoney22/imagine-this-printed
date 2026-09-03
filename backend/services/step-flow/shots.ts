// Step Flow — Step 4 mockups: product / hanger / model / details, then one
// product-color render per extra color. Reuses the EXISTING job pipeline
// (ai_jobs + product_assets + the worker that already processes
// 'replicate_mockup_v2') — this file only decides WHICH jobs to create and
// keeps `products.metadata.step_flow.shots` in sync with their outcome.
//
// Asset-role pinning: the worker already supports `input.mockupRole` to pin
// an explicit asset_role (see worker/ai-jobs-worker.ts — it's how the
// two-sided product's back view avoids evicting the front flat lay). The
// hanger template and every extra-color render use it here so they land as
// `mockup_hanger` / `mockup_color_<id>` instead of colliding with the
// primary product shot's `mockup_flat_lay` / `mockup_ghost_mannequin` slot —
// no worker changes needed for Track B.
import { supabase } from '../../lib/supabase.js'
import {
  assertOffered,
  getGarment,
  type ColorId,
  type GarmentId,
} from '../../shared/catalog-capability.js'
import { STUDIO_SIZE_KEYS, type MetalArtSizeKey } from '../../shared/metal-art.js'
import { GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES } from '../replicate.js'
import { shootOneModelShot, designReferenceForProduct } from '../etsy-model-shots.js'
import { castForDesign, type CastingDecision } from './casting.js'
import { renderDetailsCard, renderMetalDetailsCard } from './details-card.js'
import { buildProductGallery, METAL_ROLE_ORDER, ROLE_ORDER, type GalleryAsset } from '../../shared/product-gallery.js'
import type { StepBrief, StepFlowInspiration } from './brief.js'
import type { ColorAdvice } from './color-advice.js'
import type { PrintAdvice, PrintFileResult } from './print-prep.js'
// Renders one mockup ai_jobs row to completion (source resolve -> model call
// + QA -> GCS upload -> product_assets write -> job succeeded/failed). Same
// function the worker's polling loop calls for the old 'queued' path; here it
// is called directly, inline, right after this module pre-claims the job as
// 'running' — see queueMockupJob below and the `processImageJobInline`
// pattern it mirrors (routes/admin/ai-products.ts). Importing this has no
// side effects: `startWorker()` lives in the same file but is only invoked
// from backend/worker/index.ts.
import { processMockupJob } from '../../worker/ai-jobs-worker.js'

export type ShotKey = 'product' | 'hanger' | 'model' | 'details' | `color:${string}` | `scene:${string}`

export interface ShotState {
  jobId?: string
  assetId?: string
  url?: string
  approved: boolean
  status: 'queued' | 'running' | 'done' | 'failed'
  error?: string
  /**
   * Explicitly skipped by the admin (a shot that failed and the admin chose
   * not to redo) rather than approved. Counts as "settled" for the
   * `approvals.mockups` stamp the same way a failed-and-left-alone shot
   * always did, but is a distinct, honest state instead of overloading
   * `status:'failed'` for "the admin looked at this and moved on".
   */
  skipped?: boolean
  /**
   * A plain-English note about a shot that SUCCEEDED but not as cast — shown
   * next to the thumbnail. Today's only producer is the youth no-model
   * fallback (both image engines declined a child subject, so the shirt was
   * photographed empty; see etsy-model-shots.ts's generateOneShot). Distinct
   * from `error`, which means the shot did not land at all.
   */
  note?: string
  /**
   * 'details' only: the `product` shot's assetId this card was rendered
   * from. Lets a redo of the product shot be detected (assetId changed) so
   * the details card can be re-rendered instead of silently going stale.
   */
  sourceAssetId?: string
}

export interface StepFlowMeta {
  version: 1
  idea: string
  brief: StepBrief | null
  /**
   * Garment vs. metal print (design doc §14) — mirrors `brief.productKind`,
   * derived fresh every `getStepFlow()` read so it can never drift out of
   * sync with the brief it came from. Absent/undefined means 'garment' (the
   * frontend's `StepFlowState.productKind` default). `GET /:id/step`
   * additionally overrides this in its response with the value derived from
   * `products.category` — the more durable signal once a product exists —
   * but every OTHER reader of a `StepFlowMeta` (queueStepShots,
   * resolveStepFlow, buildApprovedGallery, ...) uses this brief-derived
   * value via `isMetalStepFlow()`.
   */
  productKind?: 'garment' | 'metal'
  garment?: GarmentId
  colors?: { primary: ColorId; extras: ColorId[] }
  /**
   * Metal prints' analog of garment/colors (design doc §14) — the physical
   * panel sizes this listing offers, written by POST /:id/step/sizes.
   * Ordered smallest-to-largest (STUDIO_SIZE_KEYS order). A metal StepBrief
   * (productKind === 'metal') never has `garment`/`colors` set — this is
   * what drives the metal branches through queueStepShots/resolveStepFlow
   * instead. Named `sizes` (not `metalSizes`) to match the frontend's
   * `StepFlowMeta.sizes` wire contract (src/lib/api.ts).
   */
  sizes?: MetalArtSizeKey[]
  advice?: ColorAdvice[]
  shots: Partial<Record<ShotKey, ShotState>>
  approvals: Partial<Record<'design' | 'garments' | 'mockups' | 'listing', string>>
  /**
   * Print prep (design doc §10, David 2026-09-02): the measured halftone
   * recommendation from `POST /:id/step/print-advice`. Optional and
   * side-effect-free — never gates any approval.
   */
  printAdvice?: PrintAdvice
  /**
   * Print prep: the team-only halftone print file from
   * `POST /:id/step/print-file`. Points at a `product_assets` row with
   * `kind:'print', asset_role:'print_halftone'` — that role is deliberately
   * excluded from `shared/product-gallery.ts`'s ROLE_ORDER, so this can never
   * reach `products.images`/the storefront.
   */
  printFile?: PrintFileResult
  /**
   * Inspiration step (design doc §12, David 2026-09-02): the reference photo
   * + Mrs. Imagine's breakdown + the admin's keep/change choices, from
   * `POST /step/inspiration` (services/step-flow/inspiration.ts). Optional
   * and side-effect-free — never gates any approval; carried here so
   * `GET /:id/step` can resume the Inspiration panel across reloads. Note:
   * as of this writing `POST /create` only forwards `idea`/`brief` from the
   * `stepFlow` request field onto `metadata.step_flow` — it does not yet
   * forward `inspiration`, so nothing currently persists this at product
   * creation time (see routes/admin/ai-products.ts).
   */
  inspiration?: StepFlowInspiration
  /**
   * Who Mrs. Imagine cast for the on-person shot and why (David 2026-09-03).
   * Written by `runModelShot` before the render so the panel can show the
   * decision while the photo is still being taken — and so a cast that looks
   * wrong is explainable instead of an anonymous dice roll. Garments only;
   * metal art has no human subject.
   */
  casting?: CastingDecision
}

/** Thrown for expected, user-facing validation failures — routers map this to 400. */
export class StepFlowValidationError extends Error {}

type ProductRow = { id: string; name?: string | null; category: string | null; metadata: any }

// ---------------------------------------------------------------------------
// step_flow read/write helpers
// ---------------------------------------------------------------------------

export function getStepFlow(product: { metadata?: any } | null | undefined): StepFlowMeta {
  const raw = product?.metadata?.step_flow
  if (raw && typeof raw === 'object') {
    const brief = raw.brief && typeof raw.brief === 'object' ? raw.brief : null
    return {
      version: 1,
      idea: typeof raw.idea === 'string' ? raw.idea : '',
      brief,
      // Always derived fresh from the brief (never trusted from storage) so
      // it can never drift — see the field's own doc comment above.
      productKind: brief?.productKind === 'metal' ? 'metal' : undefined,
      garment: raw.garment,
      colors: raw.colors,
      sizes: Array.isArray(raw.sizes)
        ? raw.sizes.filter((s: unknown): s is MetalArtSizeKey => s === '4x6' || s === '8x10')
        : undefined,
      advice: Array.isArray(raw.advice) ? raw.advice : undefined,
      shots: raw.shots && typeof raw.shots === 'object' ? raw.shots : {},
      approvals: raw.approvals && typeof raw.approvals === 'object' ? raw.approvals : {},
      printAdvice: raw.printAdvice && typeof raw.printAdvice === 'object' ? raw.printAdvice : undefined,
      casting: raw.casting && typeof raw.casting === 'object' ? raw.casting : undefined,
      printFile: raw.printFile && typeof raw.printFile === 'object' ? raw.printFile : undefined,
      inspiration: raw.inspiration && typeof raw.inspiration === 'object' ? raw.inspiration : undefined,
    }
  }
  return { version: 1, idea: '', brief: null, shots: {}, approvals: {} }
}

export async function loadProductRow(productId: string): Promise<ProductRow> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, metadata')
    .eq('id', productId)
    .single()
  if (error || !data) throw new StepFlowValidationError('Product not found')
  return data
}

export async function saveStepFlow(productId: string, currentMetadata: any, stepFlow: StepFlowMeta): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ metadata: { ...(currentMetadata || {}), step_flow: stepFlow } })
    .eq('id', productId)
  if (error) throw new Error(`Failed to save step_flow: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Per-product async mutex (2026-09-01 review fix) — every step_flow write in
// this module funnels through `withStepFlowLock` + `mergeStepFlow` so two
// writers never race a read-modify-write of the same product's `step_flow`
// blob. Concretely this was losing data two ways: "Approve all" fires N
// `approveShot` calls in parallel and only the LAST writer's snapshot
// survived, and `resolveStepFlow` used to hold an in-memory snapshot across
// the multi-second details-card render and then save it, clobbering whatever
// the model shot's own fire-and-forget completion (or a concurrent approve)
// had written in the meantime.
//
// In-process only — fine here: this is a single Node process per Render
// instance, and every step_flow writer in this file is one of these admin
// request handlers or their fire-and-forget continuations, never a separate
// worker process racing on the same row.
// ---------------------------------------------------------------------------
const productLocks = new Map<string, Promise<unknown>>()

async function withStepFlowLock<T>(productId: string, fn: () => Promise<T>): Promise<T> {
  const prior = productLocks.get(productId) ?? Promise.resolve()
  // Run `fn` after whatever's ahead of it settles, success or failure — a
  // failed earlier write must never permanently jam the queue for this
  // product.
  const run = prior.then(fn, fn)
  // What the NEXT caller waits on: always resolves (its own outcome is
  // irrelevant to the chain), so one rejection doesn't propagate forward.
  const chained = run.then(
    () => undefined,
    () => undefined
  )
  productLocks.set(productId, chained)
  // Best-effort cleanup so a product that's gone quiet doesn't hold a stale
  // Map entry forever (harmless either way — the next write just chains onto
  // an already-resolved promise).
  chained.finally(() => {
    if (productLocks.get(productId) === chained) productLocks.delete(productId)
  })
  return run
}

/**
 * The ONE place that reads `products.metadata`, mutates its `step_flow`, and
 * saves — always called from inside `withStepFlowLock`. Re-reading fresh
 * immediately before merging (rather than trusting whatever snapshot the
 * caller took earlier) is what makes every write here a targeted merge onto
 * the LATEST row instead of a stale whole-object overwrite.
 */
async function mergeStepFlow(
  productId: string,
  mutate: (stepFlow: StepFlowMeta) => StepFlowMeta
): Promise<StepFlowMeta> {
  const { data: product } = await supabase.from('products').select('metadata').eq('id', productId).single()
  const meta = product?.metadata || {}
  const stepFlow = getStepFlow({ metadata: meta })
  const next = mutate(stepFlow)
  await saveStepFlow(productId, meta, next)
  return next
}

/** The default shot set for a garment/colors pick: one full set on the primary color + one product render per extra. */
export function defaultShotKeys(colors: { primary: ColorId; extras: ColorId[] }): ShotKey[] {
  const extras = (colors.extras || []).filter((c) => c !== colors.primary)
  return ['product', 'hanger', 'model', 'details', ...extras.map((c) => `color:${c}` as ShotKey)]
}

/**
 * Metal prints' analog of defaultShotKeys (design doc §14): one size-true
 * scene per SELECTED panel size, plus one details card — no product/hanger/
 * model/color:* keys (a metal panel has no garment, no colors, no on-person
 * shot). Ordered smallest-to-largest (STUDIO_SIZE_KEYS order) so a redo/
 * publish loop always sees the same deterministic order regardless of the
 * order sizes were selected in.
 */
export function defaultMetalShotKeys(sizes: MetalArtSizeKey[]): ShotKey[] {
  const set = new Set(sizes || [])
  const ordered = STUDIO_SIZE_KEYS.filter((s) => set.has(s))
  return [...ordered.map((s) => `scene:${s}` as ShotKey), 'details']
}

/**
 * True when this product opted into the metal wall-art lane (design doc
 * §14). Checks `stepFlow.productKind` (getStepFlow's brief-derived mirror)
 * with a direct `brief.productKind` fallback for any StepFlowMeta a caller
 * built by hand rather than through getStepFlow (test fixtures, mainly).
 */
export function isMetalStepFlow(stepFlow: StepFlowMeta): boolean {
  return stepFlow.productKind === 'metal' || stepFlow.brief?.productKind === 'metal'
}

function pickTemplate(garment: GarmentId): 'ghost_mannequin' | 'flat_lay' {
  return (GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES as string[]).includes(garment) ? 'ghost_mannequin' : 'flat_lay'
}

/**
 * Gallery/asset_role slot a shot key lands in — used both to look up its
 * result and to sort the publish gallery. `garment` is only needed for the
 * 'product' key (it decides ghost_mannequin vs flat_lay) — every other key,
 * including the metal `scene:*` keys, resolves without it, so callers that
 * only ever see metal keys (no `garment` set on the step flow) can pass it
 * through as `undefined`.
 */
export function roleForShotKey(key: ShotKey, garment?: GarmentId): string {
  if (key.startsWith('scene:')) return `mockup_metal_${key.slice('scene:'.length)}`
  if (key === 'hanger') return 'mockup_hanger'
  if (key === 'model') return 'mockup_model_1'
  if (key === 'details') return 'mockup_details'
  if (key.startsWith('color:')) return `mockup_color_${key.slice('color:'.length)}`
  if (key === 'product') {
    if (!garment) throw new Error('roleForShotKey: garment is required for the "product" shot key')
    return pickTemplate(garment) === 'ghost_mannequin' ? 'mockup_ghost_mannequin' : 'mockup_flat_lay'
  }
  throw new Error(`Unknown shot key: ${key}`)
}

function printSizeInchesFor(productMeta: any, garment: GarmentId): number {
  const g = getGarment(garment)
  const fromMeta = Number(productMeta?.print_size_inches)
  return Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : g?.printWidthInches ?? 11
}

function randomNonce(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ---------------------------------------------------------------------------
// Mockup render concurrency guard (2026-09-02, Track B) — a single
// `queueStepShots` call can fan out product/hanger + one color:<id> per extra
// color, each a REAL Replicate call (+ a QA retry on top). Firing every
// mockup's `processMockupJob` at once the way the single-shot design job does
// would burst-hammer Replicate proportional to how many colors the admin
// picked. Caps concurrent renders to 3 per product; anything past that waits
// in FIFO order for a slot to free up. In-process only — same footprint/
// reasoning as `productLocks` above (one Node process per Render instance).
// ---------------------------------------------------------------------------
const MAX_CONCURRENT_MOCKUP_RENDERS = 3
type RenderSlot = { active: number; queue: Array<() => void> }
const mockupRenderSlots = new Map<string, RenderSlot>()

async function withMockupRenderSlot<T>(productId: string, fn: () => Promise<T>): Promise<T> {
  let slot = mockupRenderSlots.get(productId)
  if (!slot) {
    slot = { active: 0, queue: [] }
    mockupRenderSlots.set(productId, slot)
  }
  if (slot.active >= MAX_CONCURRENT_MOCKUP_RENDERS) {
    await new Promise<void>((resolve) => slot!.queue.push(resolve))
  }
  slot.active++
  try {
    return await fn()
  } finally {
    slot.active--
    const next = slot.queue.shift()
    if (next) next()
    else if (slot.active === 0) mockupRenderSlots.delete(productId)
  }
}

// ---------------------------------------------------------------------------
// Per-key job builders
// ---------------------------------------------------------------------------

async function queueMockupJob(
  product: ProductRow,
  garment: GarmentId,
  colors: { primary: ColorId; extras: ColorId[] },
  key: ShotKey
): Promise<{ jobId: string; status: ShotState['status'] }> {
  const meta = product.metadata || {}
  const printPlacement = meta.print_placement || 'front-center'
  const printSizeInches = printSizeInchesFor(meta, garment)
  const productTypeCategory = product.category || 'shirts'

  let template: 'flat_lay' | 'ghost_mannequin' | 'hanger'
  let shirtColor: ColorId
  let mockupRole: string | undefined

  if (key === 'hanger') {
    template = 'hanger'
    shirtColor = colors.primary
    mockupRole = 'mockup_hanger'
  } else if (key.startsWith('color:')) {
    const colorId = key.slice('color:'.length) as ColorId
    template = pickTemplate(garment)
    shirtColor = colorId
    mockupRole = `mockup_color_${colorId}`
  } else {
    template = pickTemplate(garment)
    shirtColor = colors.primary
    mockupRole = undefined
  }

  // Pre-claimed as 'running' at insert (Track B, 2026-09-02) — exactly the
  // `replicate_image_v2` pattern in routes/admin/ai-products.ts. Production
  // Render worker only ever picks up 'queued' rows, so this keeps it from
  // ever seeing the job at all; this API process renders it inline instead
  // (below). `input.stepKey` also excludes the row from the worker's
  // stale-'running' sweep — see ai-jobs-worker.ts's processQueuedJobs.
  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({
      product_id: product.id,
      type: 'replicate_mockup_v2',
      status: 'running',
      input: {
        product_type: productTypeCategory,
        productType: garment,
        shirtColor,
        printPlacement,
        printSizeInches,
        template,
        ...(mockupRole ? { mockupRole } : {}),
        stepKey: key,
        nonce: randomNonce(),
      },
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to queue "${key}" shot: ${error.message}`)

  // Persist the 'running' shot state BEFORE firing the render — same
  // ordering reason as queueModelShot below: a fully-mocked/very-fast render
  // could otherwise patch its own terminal state first and have this stale
  // 'running' write clobber it back.
  await patchShotState(product.id, key, { status: 'running', jobId: job.id, approved: false, error: undefined })

  void withMockupRenderSlot(product.id, () => processMockupJob(job)).catch(async (err: any) => {
    // processMockupJob already marks the ai_jobs row failed for every
    // failure path it knows about; this is the safety net for anything that
    // throws past it (e.g. a product_assets insert error) so the row and the
    // shot never get stuck spinning forever — mirrors the `.catch()` wrapper
    // every processImageJobInline call site uses.
    const message = err?.message || 'Mockup render failed'
    console.error(`[step-flow/shots] "${key}" mockup render failed:`, message)
    await supabase.from('ai_jobs').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', job.id)
    await patchShotState(product.id, key, { status: 'failed', error: message })
  })

  return { jobId: job.id, status: 'running' }
}

/**
 * Metal prints' analog of queueMockupJob (design doc §14) — one size-true
 * scene render for a single `scene:<size>` key. `metal_shelf`/`metal_wall`
 * already carry the desk-vs-wall scene split per template (see
 * services/image-flow/worker-helpers.ts's runImageFlowMockup); the 4x6/8x10
 * split within each is driven by `metalSize`, so 4x6 always renders on a
 * desk/table and 8x10 always renders hung on a wall regardless of which
 * template maps to which — no worker changes were needed for this.
 *
 * `printPlacement: 'not-applicable'` opts this render out of the garment
 * coverage-QA check (services/mockup-qa.ts's coverageIsExempt) — judging
 * "how much of the garment does the print cover" on a wall panel is a
 * category error, not a defect (see that module's own comment on the exact
 * false-failure this was already fixed for at the listing-QA layer).
 */
async function queueMetalSceneJob(product: ProductRow, key: ShotKey): Promise<{ jobId: string; status: ShotState['status'] }> {
  const sizeKey = key.slice('scene:'.length) as MetalArtSizeKey
  const template: 'metal_shelf' | 'metal_wall' = sizeKey === '8x10' ? 'metal_wall' : 'metal_shelf'
  const mockupRole = `mockup_metal_${sizeKey}`

  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({
      product_id: product.id,
      type: 'replicate_mockup_v2',
      status: 'running',
      input: {
        product_type: 'metal-art',
        template,
        metalSize: sizeKey,
        mockupRole,
        printPlacement: 'not-applicable',
        stepKey: key,
        nonce: randomNonce(),
      },
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to queue "${key}" shot: ${error.message}`)

  await patchShotState(product.id, key, { status: 'running', jobId: job.id, approved: false, error: undefined })

  void withMockupRenderSlot(product.id, () => processMockupJob(job)).catch(async (err: any) => {
    const message = err?.message || 'Mockup render failed'
    console.error(`[step-flow/shots] "${key}" mockup render failed:`, message)
    await supabase.from('ai_jobs').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', job.id)
    await patchShotState(product.id, key, { status: 'failed', error: message })
  })

  return { jobId: job.id, status: 'running' }
}

/** Mirror one already-hosted image URL into product_assets under `role`, replacing any prior asset in that slot. */
async function mirrorUrlToProductAsset(
  productId: string,
  role: string,
  url: string,
  displayOrder: number,
  extraMetadata: Record<string, unknown> = {}
): Promise<{ id: string; url: string }> {
  await supabase.from('product_assets').delete().eq('product_id', productId).eq('asset_role', role)
  const path = (() => {
    try {
      return new URL(url).pathname.split('/').slice(2).join('/') || null
    } catch {
      return null
    }
  })()
  const { data, error } = await supabase
    .from('product_assets')
    .insert({
      product_id: productId,
      kind: 'mockup',
      path,
      url,
      width: 1024,
      height: 1024,
      asset_role: role,
      is_primary: false,
      display_order: displayOrder,
      metadata: { generated_at: new Date().toISOString(), ...extraMetadata },
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to save ${role} asset: ${error.message}`)
  return { id: data.id, url: data.url }
}

/**
 * Re-read-then-merge a single shot key and return the resulting state.
 * Deliberately does NOT reuse an in-memory step_flow snapshot: the model
 * shot's fire-and-forget continuation can finish (and patch its own key)
 * before `queueStepShots`'s loop over the other keys does, so every writer
 * here always merges onto the LATEST row rather than clobbering it with a
 * stale one. Wrapped in the per-product lock (see `withStepFlowLock` above)
 * so two concurrent patches to DIFFERENT keys on the same product still
 * serialize instead of both reading-then-both-writing around each other.
 */
async function patchShotState(productId: string, key: ShotKey, patch: Partial<ShotState>): Promise<ShotState> {
  return withStepFlowLock(productId, async () => {
    let result!: ShotState
    await mergeStepFlow(productId, (stepFlow) => {
      const existing: ShotState = stepFlow.shots[key] ?? { approved: false, status: 'queued' }
      result = { ...existing, ...patch }
      return { ...stepFlow, shots: { ...stepFlow.shots, [key]: result } }
    })
    return result
  })
}

async function runModelShot(
  productId: string,
  userId: string,
  jobId: string,
  garment: GarmentId,
  shirtColor: ColorId,
  nonce: string,
  /** Set on a redo — the PRIOR shot's URL to replace in-place rather than append. */
  replaceUrl?: string,
  /** Listing wording the casting pass reads alongside the artwork. */
  castContext: { productName?: string; idea?: string } = {}
): Promise<void> {
  try {
    // Cast FIRST, from the artwork itself (David 2026-09-03). Passing no cast
    // is what made this shot a uniform random draw over every adult
    // archetype, which is how a kids' ghost tee got a bearded man. The
    // decision is persisted before the (slow, paid) render so the panel can
    // show who is being shot while it happens — and so a bad cast is
    // explainable afterwards instead of being an anonymous dice roll.
    const decision = await castForDesign({
      designUrl: await designReferenceForProduct(productId),
      garment,
      productName: castContext.productName,
      idea: castContext.idea,
    })
    console.log(
      `[step-flow/shots] ${productId} cast ${decision.label} (${decision.source}) for the model shot: ${decision.reason}`
    )
    await mergeStepFlow(productId, (stepFlow) => ({ ...stepFlow, casting: decision }))

    const { url, check } = await shootOneModelShot(productId, userId, {
      shirtColor,
      garment,
      nonce,
      replaceUrl,
      cast: { subjects: [decision.subjectId] },
    })

    if (check?.ok === false) {
      // Design-fidelity QA rejected this take (see etsy-model-shots.ts's
      // verifyDesignFidelity) — shootOneModelShot already recorded it in
      // metadata.etsy_shots for the admin to see, but it must NOT become the
      // product's mockup_model_1 asset: mirroring a rejected take would ship
      // a wrong-design photo to the storefront the moment it's approved.
      const message = check.reason || 'Model shot failed design-fidelity QA'
      console.warn(`[step-flow/shots] ${productId} model shot failed QA (not mirrored): ${message}`)
      await supabase.from('ai_jobs').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', jobId)
      await patchShotState(productId, 'model', { status: 'failed', error: message })
      return
    }

    const asset = await mirrorUrlToProductAsset(productId, 'mockup_model_1', url, 5, {
      template: 'step_flow_model_shot',
      generated_with: 'etsy-model-shots',
    })
    await supabase.from('ai_jobs').update({ status: 'succeeded', output: { url }, updated_at: new Date().toISOString() }).eq('id', jobId)
    // `check.degraded` means the shot came back as something other than what
    // was cast (today: both engines declined a child subject, so the youth
    // shirt was photographed empty). It is a usable photo, so this is a note
    // on a DONE shot rather than a failure — but it is never silent.
    await patchShotState(productId, 'model', {
      status: 'done', assetId: asset.id, url: asset.url, error: undefined, note: check.degraded,
    })
  } catch (err: any) {
    const message = err?.message || 'Model shot failed'
    console.error('[step-flow/shots] model shot failed:', message)
    await supabase.from('ai_jobs').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', jobId)
    await patchShotState(productId, 'model', { status: 'failed', error: message })
  }
}

async function queueModelShot(
  product: ProductRow,
  garment: GarmentId,
  primaryColor: ColorId,
  userId: string,
  /** Set on a redo — threads through to `shootOneModelShot`'s `replaceUrl` so the retake replaces the prior entry in metadata.etsy_shots.images instead of piling up another one. */
  previousUrl?: string
): Promise<{ jobId: string; status: ShotState['status'] }> {
  const nonce = randomNonce()
  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({
      product_id: product.id,
      type: 'step_flow_model_shot', // bookkeeping only — pre-claimed as 'running' so the worker never touches it
      status: 'running',
      input: { stepKey: 'model', shirtColor: primaryColor, garment, nonce },
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to queue model shot: ${error.message}`)

  // Persist the initial 'running' state BEFORE firing the shoot — the shoot
  // is a real, slow model call in production, but in principle (and in a
  // fully-mocked test) it could resolve and patch its own 'done' state
  // before this write lands. Writing first — not "build a patch and let the
  // caller save it later" — makes the ordering correct regardless of timing.
  await patchShotState(product.id, 'model', { status: 'running', jobId: job.id, approved: false, error: undefined })

  void runModelShot(product.id, userId, job.id, garment, primaryColor, nonce, previousUrl, {
    productName: product.name ?? undefined,
    idea: getStepFlow(product).idea || undefined,
  })

  return { jobId: job.id, status: 'running' }
}

/**
 * Metal prints' analog of `stepFlow.shots.product` (design doc §14) — the
 * shot key the details card is composed FROM. Metal has no single "product"
 * shot; instead it's the LARGEST selected size's scene (the same "largest
 * wins" convention `POST /:id/step/sizes` uses for metadata.metal_size), so
 * the card's source photo is the most representative one. Returns undefined
 * when no size has been selected yet (nothing to key off of).
 */
function metalDetailsSourceKey(stepFlow: StepFlowMeta): ShotKey | undefined {
  const sizes = stepFlow.sizes || []
  const largestFirst = [...STUDIO_SIZE_KEYS].reverse().filter((s) => sizes.includes(s))
  if (!largestFirst.length) return undefined
  // Prefer the largest size whose scene is already DONE — the details card
  // shouldn't block on a specific size finishing if a smaller one already
  // has (progressive rendering, same spirit as the garment card rendering
  // the instant its one product shot lands).
  const doneSize = largestFirst.find((s) => stepFlow.shots[`scene:${s}` as ShotKey]?.status === 'done')
  if (doneSize) return `scene:${doneSize}` as ShotKey
  // Nothing done yet — key off the largest selected size; its own status
  // ('running'/'queued'/'failed') is what drives the "not ready yet" /
  // "failed, nothing to render" branches in resolveStepFlow's details block.
  return `scene:${largestFirst[0]}` as ShotKey
}

/** The shot this product's details card is composed FROM — 'product' for a garment, the largest selected size's scene for metal. */
function detailsSourceKey(stepFlow: StepFlowMeta): ShotKey | undefined {
  return isMetalStepFlow(stepFlow) ? metalDetailsSourceKey(stepFlow) : 'product'
}

/**
 * Render the details card once its source shot has landed. Not a job — this
 * runs synchronously (from `redoShot` immediately, or from `resolveStepFlow`
 * on the next `GET /:id/step` poll once the source asset exists).
 */
async function renderDetailsShot(
  product: ProductRow,
  stepFlow: StepFlowMeta
): Promise<{ jobId: null; patch: Partial<ShotState> }> {
  if (isMetalStepFlow(stepFlow)) {
    const sourceKey = metalDetailsSourceKey(stepFlow)
    const sourceShot = sourceKey ? stepFlow.shots[sourceKey] : undefined
    if (!sourceShot?.assetId || !sourceShot.url) {
      throw new StepFlowValidationError('Approve a size scene before rendering the details card')
    }
    const sizes = stepFlow.sizes || []
    const result = await renderMetalDetailsCard({
      productId: product.id,
      mockupUrl: sourceShot.url,
      sizes,
      title: stepFlow.brief?.title || product.metadata?.step_flow?.brief?.title || 'Custom Metal Print',
    })
    return {
      jobId: null,
      patch: { status: 'done', assetId: result.assetId, url: result.url, sourceAssetId: sourceShot.assetId, error: undefined },
    }
  }

  const garment = stepFlow.garment!
  // Read the product shot straight off step_flow (not a separate
  // product_assets-by-role query) so this function's own "ready?" check is
  // the SAME source of truth callers gate on (MUST-FIX #8: only render once
  // shots.product.status === 'done'), and so the exact assetId the card was
  // built from is available to stamp as `sourceAssetId` below.
  const productShot = stepFlow.shots.product
  if (!productShot?.assetId || !productShot.url) {
    throw new StepFlowValidationError('Approve the product shot before rendering the details card')
  }

  const meta = product.metadata || {}
  const result = await renderDetailsCard({
    productId: product.id,
    mockupUrl: productShot.url,
    garment,
    color: stepFlow.colors!.primary,
    title: stepFlow.brief?.title || meta.step_flow?.brief?.title || 'Custom Design',
    printWidthInches: printSizeInchesFor(meta, garment),
  })

  return {
    jobId: null,
    patch: { status: 'done', assetId: result.assetId, url: result.url, sourceAssetId: productShot.assetId, error: undefined },
  }
}

async function buildShotJob(
  product: ProductRow,
  stepFlow: StepFlowMeta,
  key: ShotKey,
  userId: string,
  mode: 'queue' | 'redo'
): Promise<{ jobId: string | null; status: ShotState['status'] }> {
  if (isMetalStepFlow(stepFlow)) {
    const sizes = stepFlow.sizes || []
    if (!sizes.length) {
      throw new StepFlowValidationError('Select sizes before queuing shots')
    }

    if (key === 'details') {
      if (mode === 'queue') {
        await patchShotState(product.id, key, { status: 'queued', jobId: undefined, approved: false, error: undefined })
        return { jobId: null, status: 'queued' }
      }
      const { patch } = await renderDetailsShot(product, stepFlow)
      await patchShotState(product.id, key, { ...patch, jobId: undefined, approved: false })
      return { jobId: null, status: patch.status as ShotState['status'] }
    }

    if (key.startsWith('scene:')) {
      return queueMetalSceneJob(product, key)
    }

    throw new StepFlowValidationError(`Unknown shot key "${key}" for a metal product`)
  }

  const garment = stepFlow.garment
  const colors = stepFlow.colors
  if (!garment || !colors?.primary) {
    throw new StepFlowValidationError('Approve garments & colors before queuing shots')
  }
  assertOffered(garment, colors.primary)

  if (key === 'model') {
    // MUST-FIX #3: on a redo, thread the prior shot's URL through so
    // shootOneModelShot REPLACES it in metadata.etsy_shots.images instead of
    // appending another take for the Etsy uploader to potentially pick up.
    const previousUrl = mode === 'redo' ? stepFlow.shots.model?.url : undefined
    return queueModelShot(product, garment, colors.primary, userId, previousUrl)
  }

  if (key === 'details') {
    if (mode === 'queue') {
      await patchShotState(product.id, key, { status: 'queued', jobId: undefined, approved: false, error: undefined })
      return { jobId: null, status: 'queued' }
    }
    const { patch } = await renderDetailsShot(product, stepFlow)
    await patchShotState(product.id, key, { ...patch, jobId: undefined, approved: false })
    return { jobId: null, status: patch.status as ShotState['status'] }
  }

  return queueMockupJob(product, garment, colors, key)
}

// ---------------------------------------------------------------------------
// Public API — router calls these directly
// ---------------------------------------------------------------------------

export async function queueStepShots(
  productId: string,
  userId: string,
  requestedKeys?: ShotKey[]
): Promise<{ jobs: { key: ShotKey; jobId: string | null }[] }> {
  const product = await loadProductRow(productId)
  const stepFlow = getStepFlow(product)

  let allKeys: ShotKey[]
  if (isMetalStepFlow(stepFlow)) {
    const sizes = stepFlow.sizes || []
    if (!sizes.length) {
      throw new StepFlowValidationError('Select sizes before queuing shots')
    }
    allKeys = defaultMetalShotKeys(sizes)
  } else {
    if (!stepFlow.garment || !stepFlow.colors?.primary) {
      throw new StepFlowValidationError('Approve garments & colors before queuing shots')
    }
    assertOffered(stepFlow.garment, stepFlow.colors.primary)
    for (const c of stepFlow.colors.extras || []) assertOffered(stepFlow.garment, c)
    allKeys = defaultShotKeys(stepFlow.colors)
  }

  const explicit = !!(requestedKeys && requestedKeys.length)
  let targetKeys = explicit ? requestedKeys!.filter((k) => allKeys.includes(k)) : allKeys

  if (!explicit) {
    // SHOULD-FIX #9: the default (no explicit keys) fan-out is idempotent —
    // a shot that's already queued/running/done never gets a second
    // duplicate job just because the panel fired "shots" again (entry-effect
    // double-invoke, an accidental double-click on Continue, ...). Redo is
    // the explicit way to re-run a settled shot; the default path only fills
    // in what hasn't started yet.
    targetKeys = targetKeys.filter((k) => {
      const status = stepFlow.shots[k]?.status
      return status !== 'queued' && status !== 'running' && status !== 'done'
    })
  }

  if (targetKeys.length === 0) {
    // Nothing NEW to queue isn't an error when everything's already in
    // flight or finished — only an explicit (and invalid) keys[] request
    // should surface as a validation error.
    if (!explicit) return { jobs: [] }
    throw new StepFlowValidationError('No valid shot keys for the approved garment/colors')
  }

  const results: { key: ShotKey; jobId: string | null }[] = []
  for (const key of targetKeys) {
    // Each builder persists its OWN key's state internally (see
    // patchShotState's comment) — no accumulate-then-save-once here, which
    // would risk clobbering the model shot's completion if it lands first.
    const { jobId } = await buildShotJob(product, stepFlow, key, userId, 'queue')
    results.push({ key, jobId })
  }

  return { jobs: results }
}

export async function redoShot(
  productId: string,
  userId: string,
  key: ShotKey
): Promise<{ job: { id: string | null; key: ShotKey; status: ShotState['status'] } }> {
  const product = await loadProductRow(productId)
  const stepFlow = getStepFlow(product)

  let allKeys: ShotKey[]
  if (isMetalStepFlow(stepFlow)) {
    const sizes = stepFlow.sizes || []
    if (!sizes.length) {
      throw new StepFlowValidationError('Select sizes before redoing shots')
    }
    allKeys = defaultMetalShotKeys(sizes)
  } else {
    if (!stepFlow.garment || !stepFlow.colors?.primary) {
      throw new StepFlowValidationError('Approve garments & colors before redoing shots')
    }
    allKeys = defaultShotKeys(stepFlow.colors)
  }

  if (!allKeys.includes(key)) {
    throw new StepFlowValidationError(`Unknown shot key "${key}" for the current garment/colors`)
  }

  // Old asset stays visible until the redo lands — every builder's internal
  // patchShotState merges onto the existing state, so assetId/url survive
  // for product/hanger/color/model keys; details replaces immediately since
  // its render is synchronous.
  const { jobId, status } = await buildShotJob(product, stepFlow, key, userId, 'redo')
  return { job: { id: jobId, key, status } }
}

export interface ApproveItem {
  key: ShotKey
  approved: boolean
  assetId?: string
  /** MUST-FIX #2: a failed shot the admin chose not to redo — settled, not approved. */
  skipped?: boolean
}

/**
 * Approve (or skip) a batch of shots in one locked read-modify-write. The
 * per-key `approveShot` below is a thin wrapper over this — added so
 * "Approve all" can fire ONE call instead of N parallel `approveShot` calls
 * racing each other's read-modify-write of the same `step_flow.shots` object
 * (that race was MUST-FIX #1's "last writer wins" bug).
 */
export async function approveShotsBatch(
  productId: string,
  items: ApproveItem[]
): Promise<{ step_flow: StepFlowMeta }> {
  if (!items.length) throw new StepFlowValidationError('No shots given to approve')

  // Resolve/validate every assetId up front — a lookup, not a step_flow
  // write, so it doesn't need to happen inside the lock.
  const resolved = await Promise.all(
    items.map(async (item) => {
      if (!item.assetId) return { ...item, resolvedUrl: undefined as string | undefined }
      const { data: asset, error } = await supabase
        .from('product_assets')
        .select('id, url, product_id')
        .eq('id', item.assetId)
        .maybeSingle()
      if (error || !asset || asset.product_id !== productId) {
        throw new StepFlowValidationError(`assetId for "${item.key}" does not belong to this product`)
      }
      return { ...item, resolvedUrl: asset.url as string }
    })
  )

  return withStepFlowLock(productId, async () => {
    const stepFlow = await mergeStepFlow(productId, (stepFlow) => {
      const shots: Partial<Record<ShotKey, ShotState>> = { ...stepFlow.shots }
      for (const item of resolved) {
        const existing: ShotState = shots[item.key] ?? { approved: false, status: 'queued' }
        shots[item.key] = {
          ...existing,
          approved: !!item.approved,
          skipped: !!item.skipped,
          assetId: item.assetId ?? existing.assetId,
          url: item.resolvedUrl ?? existing.url,
        }
      }

      // One approve per step (David 2026-09-01): once every shot for this
      // garment/colors is approved, failed-and-skippable, or explicitly
      // skipped, stamp the group approval so the flow can advance to
      // Listing.
      const approvals = { ...stepFlow.approvals }
      if (!approvals.mockups) {
        const trackedKeys = isMetalStepFlow(stepFlow)
          ? defaultMetalShotKeys(stepFlow.sizes || [])
          : stepFlow.colors
            ? defaultShotKeys(stepFlow.colors)
            : []
        const tracked = trackedKeys.filter((k) => shots[k])
        const allSettled =
          tracked.length > 0 &&
          tracked.every((k) => shots[k]?.approved === true || shots[k]?.status === 'failed' || shots[k]?.skipped === true)
        if (allSettled) approvals.mockups = new Date().toISOString()
      }

      return { ...stepFlow, shots, approvals }
    })
    return { step_flow: stepFlow }
  })
}

export async function approveShot(
  productId: string,
  key: ShotKey,
  approved: boolean,
  assetId?: string,
  skipped?: boolean
): Promise<{ step_flow: StepFlowMeta }> {
  return approveShotsBatch(productId, [{ key, approved, assetId, skipped }])
}

/** Fifteen minutes with no result is a stuck job (worker crash, etc.), not a slow one — MUST-FIX #11. */
const STALE_RUNNING_MS = 15 * 60 * 1000

/** The error stamped on 'details' when its source shot (product, or a metal scene) failed — checked below to avoid re-stamping the same failure every poll. */
const DETAILS_SOURCE_FAILED_ERROR = 'source shot failed — nothing to render'

/**
 * Called from GET /:id/step — brings `step_flow.shots` up to date with the
 * ai_jobs rows the worker has already processed, and (for 'details' only)
 * performs the deferred synchronous render once the product shot exists.
 *
 * Every mutation is applied through `patchShotState` (locked, targeted
 * merge) the instant it's decided — this function never accumulates a local
 * `shots` snapshot and blind-saves it at the end. That used to be the bug:
 * the 'details' branch could `await` a multi-second card render mid-loop,
 * and whatever the model shot's own fire-and-forget completion (or a
 * concurrent approve) wrote to OTHER keys in that window got clobbered by
 * this function's stale in-memory copy of them when it finally saved.
 */
export async function resolveStepFlow(product: ProductRow, assets: any[], jobs: any[]): Promise<StepFlowMeta> {
  const stepFlow = getStepFlow(product)
  const garment = stepFlow.garment
  const isMetal = isMetalStepFlow(stepFlow)
  // A garment flow with no `garment` picked yet has nothing to resolve
  // (Step 3 hasn't run). A metal flow has no `garment` EVER — its readiness
  // signal is productKind, not garment — so it still proceeds; the loop
  // below is a no-op anyway until `shots` has entries in it.
  if (!garment && !isMetal) return stepFlow

  let touched = false

  for (const key of Object.keys(stepFlow.shots) as ShotKey[]) {
    const state = stepFlow.shots[key]
    if (!state) continue

    if (key === 'details') {
      const sourceKey = detailsSourceKey(stepFlow)
      const sourceShot = sourceKey ? stepFlow.shots[sourceKey] : undefined

      if (sourceShot?.status === 'failed') {
        // MUST-FIX #2: the details card is composed FROM the source shot —
        // if that failed there is nothing to render it from.
        const alreadyMarked = state.status === 'failed' && state.error === DETAILS_SOURCE_FAILED_ERROR
        if (!alreadyMarked) {
          await patchShotState(product.id, key, { status: 'failed', error: DETAILS_SOURCE_FAILED_ERROR })
          touched = true
        }
        continue
      }

      if (sourceShot?.status !== 'done') continue // not ready yet — leave queued for the next poll

      // MUST-FIX #8: render once the source shot is done, and RE-render if
      // the source shot has since changed (a redo) — sourceAssetId is the
      // freshness check, not just "status is already done".
      if (state.status === 'done' && state.sourceAssetId === sourceShot.assetId) continue

      try {
        // Render OUTSIDE the lock (network fetch + sharp compose + GCS
        // upload — several seconds). Only the result write is locked, so a
        // slow render can never hold up, or get clobbered by, a concurrent
        // approve/redo/model-shot completion on this same product.
        const { patch } = await renderDetailsShot(product, stepFlow)
        await patchShotState(product.id, key, { ...patch, jobId: undefined })
        touched = true
      } catch (err: any) {
        // "Not ready yet" (no source asset) is expected while mockups are
        // still rendering — leave it queued for the next poll rather than
        // flagging a failure that never happened.
        if (!(err instanceof StepFlowValidationError)) {
          await patchShotState(product.id, key, { status: 'failed', error: err?.message || 'Details render failed' })
          touched = true
        }
      }
      continue
    }

    if (state.status === 'done' || state.status === 'failed') continue

    if (!state.jobId) continue
    const job = jobs.find((j) => j.id === state.jobId)

    if (!job) {
      if (state.status === 'running' || state.status === 'queued') {
        // The job record this shot is waiting on is gone (deleted, or never
        // landed) — nothing will ever resolve it. Fail now so Redo is
        // offered instead of a spinner that waits forever.
        await patchShotState(product.id, key, { status: 'failed', error: 'stale — job record missing, redo this shot' })
        touched = true
      }
      continue
    }

    if (job.status === 'failed') {
      await patchShotState(product.id, key, { status: 'failed', error: job.error || 'Job failed' })
      touched = true
    } else if (job.status === 'succeeded') {
      const role = roleForShotKey(key, garment)
      const candidates = assets
        .filter((a) => a.asset_role === role && a.url)
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      if (candidates[0]) {
        await patchShotState(product.id, key, { status: 'done', assetId: candidates[0].id, url: candidates[0].url })
      } else {
        // MUST-FIX #11: the job says it succeeded but nothing landed in its
        // asset_role slot — never leave the shot spinning forever.
        await patchShotState(product.id, key, { status: 'failed', error: 'render finished, no asset landed' })
      }
      touched = true
    } else {
      // queued/running
      const startedAt = job.created_at ? new Date(job.created_at).getTime() : NaN
      const age = Number.isFinite(startedAt) ? Date.now() - startedAt : 0
      if (age > STALE_RUNNING_MS) {
        // MUST-FIX #11: stuck for >15 minutes — fail it so Redo is offered
        // instead of an infinite spinner.
        await patchShotState(product.id, key, { status: 'failed', error: 'stale — no result after 15 minutes, redo this shot' })
        touched = true
      } else if (state.status !== job.status) {
        await patchShotState(product.id, key, { status: job.status })
        touched = true
      }
    }
  }

  if (!touched) return stepFlow
  // Every mutation above already landed through the lock — re-read once at
  // the end to hand the caller the fully up-to-date row instead of
  // reconstructing it from whatever order the patches happened to apply in.
  const fresh = await loadProductRow(product.id)
  return getStepFlow(fresh)
}

// ---------------------------------------------------------------------------
// Publish gallery (SHOULD-FIX #4/#5) — built from APPROVED step-flow shots
// only, using the shared ROLE_ORDER whitelist (backend/shared/product-gallery.ts)
// that the frontend's publish paths use too, instead of a second, drifted
// copy that used to live here.
// ---------------------------------------------------------------------------

/**
 * Publish gallery + the "did the admin actually approve anything" guard.
 * Roles the step flow tracks approval for (product/hanger/model/details/
 * color:*) are included ONLY when their shot was approved — a stray
 * `mockup_hanger` row from an un-approved (or since-redone) render must never
 * reach the storefront just because it happens to exist in `product_assets`.
 * Roles the flow never tracks (mr_imagine, pocket, back, the watermarked
 * design, ...) pass through unfiltered, exactly like every other publish
 * path in the app.
 */
export function buildApprovedGallery(
  stepFlow: StepFlowMeta,
  assets: GalleryAsset[]
): { images: string[]; approvedFlowCount: number } {
  const garment = stepFlow.garment
  const approvedAssetIds = new Set(
    Object.values(stepFlow.shots)
      .filter((s): s is ShotState => !!s && s.approved === true && !!s.assetId)
      .map((s) => s.assetId as string)
  )

  // No `if (garment)` gate here (2026-09-02, Track B metal lane): a metal
  // flow never has `garment` set, but its `scene:*`/`details` roles still
  // need to be tracked — roleForShotKey resolves those without a garment,
  // and only throws for a 'product' key with no garment, which the catch
  // below already treats as "leave it out" the same as any other unknown key.
  const trackedRoles = new Set<string>()
  for (const k of Object.keys(stepFlow.shots) as ShotKey[]) {
    try {
      trackedRoles.add(roleForShotKey(k, garment))
    } catch {
      // Unknown/legacy key (or a 'product' key with no garment) — nothing to
      // track it against; leave it out rather than let a malformed key crash
      // the publish route.
    }
  }

  const filtered = assets.filter((a) => {
    if (!a.asset_role || !trackedRoles.has(a.asset_role)) return true
    return !!a.id && approvedAssetIds.has(a.id)
  })

  // Metal prints lead with the (watermarked) artwork — the panel IS the art
  // — then the size scenes and the details card (METAL_ROLE_ORDER); garments
  // keep the mockup-first ROLE_ORDER.
  const order = isMetalStepFlow(stepFlow) ? METAL_ROLE_ORDER : ROLE_ORDER
  return { images: buildProductGallery(filtered, order), approvedFlowCount: approvedAssetIds.size }
}
