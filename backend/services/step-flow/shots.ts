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
import { GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES } from '../replicate.js'
import { shootOneModelShot } from '../etsy-model-shots.js'
import { renderDetailsCard } from './details-card.js'
import type { StepBrief } from './brief.js'
import type { ColorAdvice } from './color-advice.js'

export type ShotKey = 'product' | 'hanger' | 'model' | 'details' | `color:${string}`

export interface ShotState {
  jobId?: string
  assetId?: string
  url?: string
  approved: boolean
  status: 'queued' | 'running' | 'done' | 'failed'
  error?: string
}

export interface StepFlowMeta {
  version: 1
  idea: string
  brief: StepBrief | null
  garment?: GarmentId
  colors?: { primary: ColorId; extras: ColorId[] }
  advice?: ColorAdvice[]
  shots: Partial<Record<ShotKey, ShotState>>
  approvals: Partial<Record<'design' | 'garments' | 'mockups' | 'listing', string>>
}

/** Thrown for expected, user-facing validation failures — routers map this to 400. */
export class StepFlowValidationError extends Error {}

type ProductRow = { id: string; category: string | null; metadata: any }

// ---------------------------------------------------------------------------
// step_flow read/write helpers
// ---------------------------------------------------------------------------

export function getStepFlow(product: { metadata?: any } | null | undefined): StepFlowMeta {
  const raw = product?.metadata?.step_flow
  if (raw && typeof raw === 'object') {
    return {
      version: 1,
      idea: typeof raw.idea === 'string' ? raw.idea : '',
      brief: raw.brief && typeof raw.brief === 'object' ? raw.brief : null,
      garment: raw.garment,
      colors: raw.colors,
      advice: Array.isArray(raw.advice) ? raw.advice : undefined,
      shots: raw.shots && typeof raw.shots === 'object' ? raw.shots : {},
      approvals: raw.approvals && typeof raw.approvals === 'object' ? raw.approvals : {},
    }
  }
  return { version: 1, idea: '', brief: null, shots: {}, approvals: {} }
}

export async function loadProductRow(productId: string): Promise<ProductRow> {
  const { data, error } = await supabase
    .from('products')
    .select('id, category, metadata')
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

/** The default shot set for a garment/colors pick: one full set on the primary color + one product render per extra. */
export function defaultShotKeys(colors: { primary: ColorId; extras: ColorId[] }): ShotKey[] {
  const extras = (colors.extras || []).filter((c) => c !== colors.primary)
  return ['product', 'hanger', 'model', 'details', ...extras.map((c) => `color:${c}` as ShotKey)]
}

function pickTemplate(garment: GarmentId): 'ghost_mannequin' | 'flat_lay' {
  return (GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES as string[]).includes(garment) ? 'ghost_mannequin' : 'flat_lay'
}

/** Gallery/asset_role slot a shot key lands in — used both to look up its result and to sort the publish gallery. */
export function roleForShotKey(key: ShotKey, garment: GarmentId): string {
  if (key === 'product') return pickTemplate(garment) === 'ghost_mannequin' ? 'mockup_ghost_mannequin' : 'mockup_flat_lay'
  if (key === 'hanger') return 'mockup_hanger'
  if (key === 'model') return 'mockup_model_1'
  if (key === 'details') return 'mockup_details'
  if (key.startsWith('color:')) return `mockup_color_${key.slice('color:'.length)}`
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

  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({
      product_id: product.id,
      type: 'replicate_mockup_v2',
      status: 'queued',
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
  await patchShotState(product.id, key, { status: 'queued', jobId: job.id, approved: false, error: undefined })
  return { jobId: job.id, status: 'queued' }
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
 * stale one.
 */
async function patchShotState(productId: string, key: ShotKey, patch: Partial<ShotState>): Promise<ShotState> {
  const { data: product } = await supabase.from('products').select('metadata').eq('id', productId).single()
  const meta = product?.metadata || {}
  const stepFlow = getStepFlow({ metadata: meta })
  const existing: ShotState = stepFlow.shots[key] ?? { approved: false, status: 'queued' }
  const next: ShotState = { ...existing, ...patch }
  stepFlow.shots = { ...stepFlow.shots, [key]: next }
  await saveStepFlow(productId, meta, stepFlow)
  return next
}

async function runModelShot(
  productId: string,
  userId: string,
  jobId: string,
  garment: GarmentId,
  shirtColor: ColorId,
  nonce: string
): Promise<void> {
  try {
    const { url } = await shootOneModelShot(productId, userId, { shirtColor, garment, nonce })
    const asset = await mirrorUrlToProductAsset(productId, 'mockup_model_1', url, 5, {
      template: 'step_flow_model_shot',
      generated_with: 'etsy-model-shots',
    })
    await supabase.from('ai_jobs').update({ status: 'succeeded', output: { url }, updated_at: new Date().toISOString() }).eq('id', jobId)
    await patchShotState(productId, 'model', { status: 'done', assetId: asset.id, url: asset.url, error: undefined })
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
  userId: string
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

  void runModelShot(product.id, userId, job.id, garment, primaryColor, nonce)

  return { jobId: job.id, status: 'running' }
}

/**
 * Render the details card once the product shot has landed. Not a job — this
 * runs synchronously (from `redoShot` immediately, or from `resolveStepFlow`
 * on the next `GET /:id/step` poll once the product asset exists).
 */
async function renderDetailsShot(
  product: ProductRow,
  stepFlow: StepFlowMeta
): Promise<{ jobId: null; patch: Partial<ShotState> }> {
  const garment = stepFlow.garment!
  const role = roleForShotKey('product', garment)
  const { data: productAsset } = await supabase
    .from('product_assets')
    .select('id, url')
    .eq('product_id', product.id)
    .eq('asset_role', role)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!productAsset?.url) {
    throw new StepFlowValidationError('Approve the product shot before rendering the details card')
  }

  const meta = product.metadata || {}
  const result = await renderDetailsCard({
    productId: product.id,
    mockupUrl: productAsset.url,
    garment,
    color: stepFlow.colors!.primary,
    title: stepFlow.brief?.title || meta.step_flow?.brief?.title || 'Custom Design',
    printWidthInches: printSizeInchesFor(meta, garment),
  })

  return { jobId: null, patch: { status: 'done', assetId: result.assetId, url: result.url, error: undefined } }
}

async function buildShotJob(
  product: ProductRow,
  stepFlow: StepFlowMeta,
  key: ShotKey,
  userId: string,
  mode: 'queue' | 'redo'
): Promise<{ jobId: string | null; status: ShotState['status'] }> {
  const garment = stepFlow.garment
  const colors = stepFlow.colors
  if (!garment || !colors?.primary) {
    throw new StepFlowValidationError('Approve garments & colors before queuing shots')
  }
  assertOffered(garment, colors.primary)

  if (key === 'model') return queueModelShot(product, garment, colors.primary, userId)

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
  if (!stepFlow.garment || !stepFlow.colors?.primary) {
    throw new StepFlowValidationError('Approve garments & colors before queuing shots')
  }
  assertOffered(stepFlow.garment, stepFlow.colors.primary)
  for (const c of stepFlow.colors.extras || []) assertOffered(stepFlow.garment, c)

  const allKeys = defaultShotKeys(stepFlow.colors)
  const targetKeys = requestedKeys && requestedKeys.length ? requestedKeys.filter((k) => allKeys.includes(k)) : allKeys
  if (targetKeys.length === 0) {
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
  if (!stepFlow.garment || !stepFlow.colors?.primary) {
    throw new StepFlowValidationError('Approve garments & colors before redoing shots')
  }
  const allKeys = defaultShotKeys(stepFlow.colors)
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

export async function approveShot(
  productId: string,
  key: ShotKey,
  approved: boolean,
  assetId?: string
): Promise<{ step_flow: StepFlowMeta }> {
  const product = await loadProductRow(productId)
  const stepFlow = getStepFlow(product)
  const existing: ShotState = stepFlow.shots[key] ?? { approved: false, status: 'queued' }

  let resolvedAssetId = assetId ?? existing.assetId
  let resolvedUrl = existing.url
  if (assetId) {
    const { data: asset, error } = await supabase
      .from('product_assets')
      .select('id, url, product_id')
      .eq('id', assetId)
      .maybeSingle()
    if (error || !asset || asset.product_id !== productId) {
      throw new StepFlowValidationError('assetId does not belong to this product')
    }
    resolvedAssetId = asset.id
    resolvedUrl = asset.url
  }

  const shots: Partial<Record<ShotKey, ShotState>> = {
    ...stepFlow.shots,
    [key]: { ...existing, approved: !!approved, assetId: resolvedAssetId, url: resolvedUrl },
  }

  // One approve per step (David 2026-09-01): once every shot for this
  // garment/colors is either approved or failed-and-skippable, stamp the
  // group approval so the flow can advance to Listing.
  const approvals = { ...stepFlow.approvals }
  if (!approvals.mockups && stepFlow.colors) {
    const tracked = defaultShotKeys(stepFlow.colors).filter((k) => shots[k])
    const allSettled = tracked.length > 0 && tracked.every((k) => shots[k]?.approved === true || shots[k]?.status === 'failed')
    if (allSettled) approvals.mockups = new Date().toISOString()
  }

  const nextStepFlow = { ...stepFlow, shots, approvals }
  await saveStepFlow(productId, product.metadata, nextStepFlow)
  return { step_flow: nextStepFlow }
}

/**
 * Called from GET /:id/step — brings `step_flow.shots` up to date with the
 * ai_jobs rows the worker has already processed, and (for 'details' only)
 * performs the deferred synchronous render once the product shot exists.
 * Persists only when something actually changed.
 */
export async function resolveStepFlow(product: ProductRow, assets: any[], jobs: any[]): Promise<StepFlowMeta> {
  const stepFlow = getStepFlow(product)
  const garment = stepFlow.garment
  if (!garment) return stepFlow

  const shots = { ...stepFlow.shots }
  let changed = false

  for (const key of Object.keys(shots) as ShotKey[]) {
    const state = shots[key]
    if (!state || state.status === 'done' || state.status === 'failed') continue

    if (key === 'details') {
      try {
        const { patch } = await renderDetailsShot(product, stepFlow)
        shots[key] = { ...state, ...patch, jobId: undefined }
        changed = true
      } catch (err: any) {
        // "Not ready yet" (no product asset) is expected while mockups are
        // still rendering — leave it queued for the next poll rather than
        // flagging a failure that never happened.
        if (!(err instanceof StepFlowValidationError)) {
          shots[key] = { ...state, status: 'failed', error: err?.message || 'Details render failed' }
          changed = true
        }
      }
      continue
    }

    if (!state.jobId) continue
    const job = jobs.find((j) => j.id === state.jobId)
    if (!job) continue

    if (job.status === 'failed') {
      shots[key] = { ...state, status: 'failed', error: job.error || 'Job failed' }
      changed = true
    } else if (job.status === 'succeeded') {
      const role = roleForShotKey(key, garment)
      const candidates = assets
        .filter((a) => a.asset_role === role && a.url)
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      if (candidates[0]) {
        shots[key] = { ...state, status: 'done', assetId: candidates[0].id, url: candidates[0].url }
        changed = true
      }
    } else if ((job.status === 'queued' || job.status === 'running') && state.status !== job.status) {
      shots[key] = { ...state, status: job.status }
      changed = true
    }
  }

  const nextStepFlow = { ...stepFlow, shots }
  if (changed) await saveStepFlow(product.id, product.metadata, nextStepFlow)
  return nextStepFlow
}

// ---------------------------------------------------------------------------
// Publish gallery — server-side mirror of src/lib/product-gallery.ts's
// ROLE_ORDER (Track C owns that file; the backend can't import across the
// frontend/backend package boundary, so this is the same whitelist kept in
// step with it by hand). Any role missing here is invisible on the storefront
// no matter how many were generated.
// ---------------------------------------------------------------------------

const GALLERY_FIXED_ROLE_ORDER = [
  'mockup_ghost_mannequin',
  'mockup_flat_lay',
  'mockup_hanger',
  'mockup_back',
  'mockup_model_1',
  'mockup_model_2',
  'mockup_details',
]
const GALLERY_TAIL_ROLE_ORDER = ['mockup_mr_imagine', 'mockup_pocket', 'design_watermarked']

export interface GalleryAssetLike {
  id?: string
  kind?: string | null
  asset_role?: string | null
  url?: string | null
  display_order?: number | null
  created_at?: string | null
}

export function buildStepFlowGallery(assets: GalleryAssetLike[]): string[] {
  const images: string[] = []
  const pushRole = (role: string) => {
    const candidates = assets
      .filter((a) => a.asset_role === role && a.url)
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    if (candidates[0]) images.push(candidates[0].url as string)
  }

  for (const role of GALLERY_FIXED_ROLE_ORDER) pushRole(role)

  const colorRoles = Array.from(
    new Set(
      assets
        .map((a) => a.asset_role)
        .filter((r): r is string => typeof r === 'string' && r.startsWith('mockup_color_'))
    )
  ).sort()
  for (const role of colorRoles) pushRole(role)

  for (const role of GALLERY_TAIL_ROLE_ORDER) pushRole(role)

  if (images.length === 0) {
    const mockups = assets
      .filter((a) => a.kind === 'mockup' && a.url)
      .sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99))
    const seen = new Set<string>()
    for (const m of mockups) {
      if (seen.has(m.url as string)) continue
      seen.add(m.url as string)
      images.push(m.url as string)
    }
  }

  return images
}
