// ---------------------------------------------------------------------------
// Design QA gate — the DB-facing half of the presentation review.
//
// services/presentation-qa.ts decides whether a presentation is good enough.
// This module is what makes that decision BINDING and AUDITABLE:
//
//   submitForQa()      assemble the presentation from the product row, run the
//                      review, write an immutable design_qa_reviews row, mirror
//                      the verdict onto products.metadata.qa_gate
//   partitionByQa()    split a set of products into "may go live" / "may not",
//                      the shape every go-live path already uses (compare
//                      design-library-quality.ts's partitionForActivation)
//   overrideQa()       an admin knowingly ships a failure — recorded as a NEW
//                      review row, never by editing the failure away
//
// GATE FRESHNESS: a pass is bound to the presentation it reviewed, not to the
// product forever. The stamp carries a fingerprint of the exact title, tags,
// price and photo set that passed; edit any of them and the stamp no longer
// matches, so the gate demands a fresh review. Otherwise "pass QA, then change
// the price to $2" would be a hole big enough to drive the whole store through.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto'
import { supabase } from '../lib/supabase.js'
import {
  runPresentationQa,
  looksLikeRender,
  type Channel,
  type PresentationInput,
  type PresentationVerdict,
  type ReworkItem
} from './presentation-qa.js'

export type { Channel } from './presentation-qa.js'

export interface QaStamp {
  status: 'passed' | 'failed' | 'overridden'
  channel: Channel
  submission_no: number
  review_id: string
  score: number
  /** Fingerprint of the presentation that was reviewed — see GATE FRESHNESS. */
  fingerprint: string
  blocking: number
  warnings: number
  at: string
  by: string
  /** Blocking issues only, so a grid can render "why" without a join. */
  failures: string[]
}

export interface QaSubmission {
  reviewId: string
  submissionNo: number
  verdict: PresentationVerdict
  stamp: QaStamp
  input: PresentationInput
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Everything that, if changed, invalidates a pass. Deliberately includes the
 * photo URLs: a re-render swaps the URL, and a re-render is exactly the thing
 * that has to be re-reviewed.
 */
export function fingerprintPresentation(input: PresentationInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        c: input.channel,
        t: input.title,
        d: input.description,
        g: [...input.tags].sort(),
        p: input.price,
        m: input.mockupUrls,
        a: input.designUrl,
        pl: input.placement ?? null,
        s: input.printSizeInches ?? null
      })
    )
    .digest('hex')
    .slice(0, 32)
}

const SELECT_FOR_QA =
  'id, name, description, price, images, category, status, meta_title, meta_description, search_keywords, metadata'

/**
 * Build the presentation exactly as the shopper would meet it on that channel.
 *
 * Etsy reads the composed pack (products.metadata.etsy_pack) and the model
 * shots, because that is what services/etsy.ts actually publishes. The
 * storefront reads the catalogue fields. When an Etsy pack has not been
 * composed yet the storefront fields stand in, which makes the SEO criterion
 * fail against Etsy's stricter rules — the correct answer, and a more useful
 * one than refusing to review.
 */
export async function buildPresentationInput(productId: string, channel: Channel): Promise<PresentationInput> {
  const { data: product, error } = await supabase.from('products').select(SELECT_FOR_QA).eq('id', productId).maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  const metadata: Record<string, any> = (product as any).metadata ?? {}
  const images: string[] = Array.isArray(product.images) ? product.images.filter((i: unknown): i is string => typeof i === 'string') : []
  // The artwork that goes to the PRINTER, resolved in the same order the worker
  // itself uses when rendering (ai-jobs-worker.ts: dtf > nobg > source).
  //
  // images[0] is documented as the source artwork (etsy-model-shots.ts
  // designSourceUrl()) and is that for AI-built products, but it is NOT that on
  // most of the live catalogue: measured 2026-08-19, slot 0 is a ghost-mannequin
  // render on the majority of active garments. Grading a photograph of a shirt
  // as if it were the design fails it for having an opaque background, which
  // every photograph has — so fall back to slot 0 only when it is not a render.
  const { data: artworkAssets } = await supabase
    .from('product_assets')
    .select('kind, url, created_at')
    .eq('product_id', productId)
    .in('kind', ['dtf', 'nobg', 'source'])
    .order('created_at', { ascending: false })
  const artworkOfKind = (kind: string): string | null => {
    const hit = (artworkAssets ?? []).find(a => a.kind === kind && typeof a.url === 'string')
    return (hit?.url as string) ?? null
  }
  const galleryArtwork = images[0] && !looksLikeRender(images[0]) ? images[0] : null
  const designUrl = artworkOfKind('dtf') ?? artworkOfKind('nobg') ?? artworkOfKind('source') ?? galleryArtwork

  let mockupUrls: string[] = []
  if (channel === 'etsy') {
    const shots = metadata.etsy_shots ?? {}
    const shotImages: string[] = Array.isArray(shots.images) ? shots.images.filter((i: unknown): i is string => typeof i === 'string') : []
    // A shot that already failed the per-render fidelity check is not part of
    // the presentation — etsy-model-shots.ts refuses to mirror it either.
    mockupUrls = shotImages.filter((_, i) => shots.checks?.[i]?.ok !== false)
  }
  if (!mockupUrls.length) {
    const { data: assets } = await supabase
      .from('product_assets')
      .select('url, is_primary, display_order')
      .eq('product_id', productId)
      .eq('kind', 'mockup')
      .order('is_primary', { ascending: false })
      .order('display_order', { ascending: true })
    mockupUrls = (assets ?? []).map(a => a.url).filter((u: unknown): u is string => typeof u === 'string')
  }
  // Last resort: the catalogue gallery minus the artwork in slot 0.
  if (!mockupUrls.length) mockupUrls = images.slice(1)

  const pack = channel === 'etsy' ? metadata.etsy_pack : null
  const title = pack?.title ?? (product as any).meta_title ?? product.name ?? ''
  const description = pack?.description ?? product.description ?? (product as any).meta_description ?? ''
  const tags: string[] = Array.isArray(pack?.tags)
    ? pack.tags.filter((t: unknown): t is string => typeof t === 'string')
    : String((product as any).search_keywords ?? '').split(',').map(t => t.trim()).filter(Boolean)
  const price = Number(pack?.price ?? product.price ?? 0)

  return {
    productId,
    name: product.name ?? productId,
    channel,
    category: product.category ?? null,
    designUrl,
    mockupUrls,
    placement: metadata.print_placement ?? null,
    printSizeInches: num(metadata.print_size_inches),
    title,
    description,
    tags,
    price,
    costFloor: num(metadata.cost) ?? num(metadata.unit_cost) ?? num(metadata.base_cost) ?? num(metadata.cost_breakdown?.total)
  }
}

async function nextSubmissionNo(productId: string, channel: Channel): Promise<number> {
  const { data, error } = await supabase.rpc('next_design_qa_submission_no', { p_product_id: productId, p_channel: channel })
  if (!error && Number.isFinite(Number(data))) return Number(data)
  // The RPC is the concurrency-safe path. If the migration has not landed yet,
  // fall back to a plain MAX() read rather than refusing to review — a slightly
  // wrong submission number is a far smaller problem than no QA at all.
  console.warn(`[design-qa] submission-no RPC unavailable (${error?.message ?? 'non-numeric result'}) — falling back to MAX()`)
  const { data: rows } = await supabase
    .from('design_qa_reviews')
    .select('submission_no')
    .eq('product_id', productId)
    .eq('channel', channel)
    .order('submission_no', { ascending: false })
    .limit(1)
  return (rows?.[0]?.submission_no ?? 0) + 1
}

const stampFrom = (
  verdict: Pick<PresentationVerdict, 'score' | 'blockingCount' | 'warningCount' | 'rework'>,
  status: QaStamp['status'],
  channel: Channel,
  submissionNo: number,
  reviewId: string,
  fingerprint: string,
  by: string
): QaStamp => ({
  status,
  channel,
  submission_no: submissionNo,
  review_id: reviewId,
  score: verdict.score,
  fingerprint,
  blocking: verdict.blockingCount,
  warnings: verdict.warningCount,
  at: new Date().toISOString(),
  by,
  failures: verdict.rework.filter(r => r.severity === 'block').map(r => `${r.criterion}: ${r.issue}`).slice(0, 12)
})

/** Mirror the verdict onto the product row. Best-effort — the review row is the
 *  source of truth, so a failed mirror must not fail the submission. */
async function stampProduct(productId: string, channel: Channel, stamp: QaStamp): Promise<void> {
  const { data } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
  const metadata: Record<string, any> = (data as any)?.metadata ?? {}
  const qaGate = { ...(metadata.qa_gate ?? {}), [channel]: stamp }
  const { error } = await supabase
    .from('products')
    .update({ metadata: { ...metadata, qa_gate: qaGate }, updated_at: new Date().toISOString() })
    .eq('id', productId)
  if (error) console.error(`[design-qa] stamp failed for ${productId}: ${error.message}`)
}

/**
 * Run the gate and record the result. This is the ONLY way a design earns a
 * pass — there is no endpoint that writes a passing verdict without running the
 * checks, which is also why `authenticated` has no INSERT grant on the table.
 */
export async function submitForQa(opts: {
  productId: string
  channel?: Channel
  submittedBy?: string
}): Promise<QaSubmission> {
  const channel: Channel = opts.channel === 'etsy' ? 'etsy' : 'storefront'
  const submittedBy = opts.submittedBy || 'unknown'

  const input = await buildPresentationInput(opts.productId, channel)
  const verdict = await runPresentationQa(input)
  const fingerprint = fingerprintPresentation(input)
  const submissionNo = await nextSubmissionNo(opts.productId, channel)

  const criteria: Record<string, unknown> = {}
  for (const [id, v] of Object.entries(verdict.criteria)) {
    criteria[id] = { ok: v.ok, unverified: v.unverified ?? false, summary: v.summary, measured: v.measured ?? {}, findings: v.findings }
  }

  const { data: review, error } = await supabase
    .from('design_qa_reviews')
    .insert({
      product_id: opts.productId,
      channel,
      submission_no: submissionNo,
      status: verdict.status,
      score: verdict.score,
      criteria: { ...criteria, _fingerprint: fingerprint },
      rework: verdict.rework,
      submitted_by: submittedBy,
      model: verdict.model,
      duration_ms: verdict.durationMs
    })
    .select('id')
    .single()
  if (error) throw new Error(`Failed to record QA review: ${error.message}`)

  const stamp = stampFrom(verdict, verdict.status, channel, submissionNo, review.id, fingerprint, submittedBy)
  await stampProduct(opts.productId, channel, stamp)

  console.log(
    `[design-qa] ${verdict.status.toUpperCase()} ${input.name} [${channel} #${submissionNo}] ` +
      `score ${verdict.score} — ${verdict.blockingCount} blocking, ${verdict.warningCount} warning`
  )

  return { reviewId: review.id, submissionNo, verdict, stamp, input }
}

/** Full submission history for a design, newest first. The audit trail. */
export async function reviewHistory(productId: string, channel?: Channel) {
  let query = supabase
    .from('design_qa_reviews')
    .select('id, channel, submission_no, status, score, criteria, rework, submitted_by, model, duration_ms, override_reason, override_by, created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
  if (channel) query = query.eq('channel', channel)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export type GateCode = 'passed' | 'overridden' | 'never_reviewed' | 'failed' | 'stale'

export interface GateVerdict {
  allowed: boolean
  code: GateCode
  reason: string
  stamp: QaStamp | null
}

/**
 * Read a product's stamp and decide whether it may go live RIGHT NOW.
 *
 * Pure and synchronous so every go-live path can call it inside a loop without
 * an extra round trip — the stamp already travels on the product row. Pass the
 * freshly built presentation to enforce the freshness rule; omit it and only
 * the recorded status is checked.
 */
export function evaluateGate(
  metadata: Record<string, any> | null | undefined,
  channel: Channel,
  currentFingerprint?: string
): GateVerdict {
  const stamp: QaStamp | undefined = metadata?.qa_gate?.[channel]
  if (!stamp) {
    return {
      allowed: false,
      code: 'never_reviewed',
      reason: 'This design has never been through the presentation QA gate. Submit it for review before it can go live.',
      stamp: null
    }
  }
  if (stamp.status === 'failed') {
    return {
      allowed: false,
      code: 'failed',
      reason: `Failed QA (submission #${stamp.submission_no}, score ${stamp.score}): ${stamp.failures[0] ?? 'see the review for details'}`,
      stamp
    }
  }
  if (currentFingerprint && stamp.fingerprint && stamp.fingerprint !== currentFingerprint) {
    return {
      allowed: false,
      code: 'stale',
      reason:
        'The listing has changed since it passed QA (title, tags, price, or photos). ' +
        'Resubmit it so the version that goes live is the version that was reviewed.',
      stamp
    }
  }
  return {
    allowed: true,
    code: stamp.status === 'overridden' ? 'overridden' : 'passed',
    reason: stamp.status === 'overridden' ? `QA failure overridden by ${stamp.by}.` : `Passed QA (submission #${stamp.submission_no}, score ${stamp.score}).`,
    stamp
  }
}

export interface GateRow {
  id: string
  name?: string | null
  metadata?: Record<string, any> | null
}

export interface GateBlocked<T extends GateRow = GateRow> {
  id: string
  name: string | null
  code: GateCode
  reason: string
  product: T
}

/** Split go-live candidates the same way design-library-quality's
 *  partitionForActivation() does, so the two gates compose in one handler. */
export function partitionByQa<T extends GateRow>(rows: T[], channel: Channel): { allowed: T[]; blocked: GateBlocked<T>[] } {
  const allowed: T[] = []
  const blocked: GateBlocked<T>[] = []
  for (const row of rows) {
    const verdict = evaluateGate(row.metadata, channel)
    if (verdict.allowed) allowed.push(row)
    else blocked.push({ id: row.id, name: row.name ?? null, code: verdict.code, reason: verdict.reason, product: row })
  }
  return { allowed, blocked }
}

/**
 * Fetch-and-check for the single-product go-live paths (Etsy queue/publish),
 * where the caller has an id rather than a row. Also enforces freshness, which
 * partitionByQa cannot do without rebuilding every presentation.
 */
export async function checkGate(productId: string, channel: Channel): Promise<GateVerdict> {
  const { data } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
  const metadata = (data as any)?.metadata ?? null
  const quick = evaluateGate(metadata, channel)
  if (!quick.allowed) return quick
  try {
    const input = await buildPresentationInput(productId, channel)
    return evaluateGate(metadata, channel, fingerprintPresentation(input))
  } catch (err: any) {
    // Could not rebuild the presentation to compare — report the recorded
    // status rather than inventing a failure the designer cannot act on.
    console.warn(`[design-qa] freshness check skipped for ${productId}: ${err?.message || err}`)
    return quick
  }
}

/**
 * An admin knowingly ships a design that failed. Recorded as a new review row
 * carrying the ORIGINAL findings plus who overrode them and why — the same
 * "keep the reason, add the override" shape as releaseQuarantine().
 */
export async function overrideQa(opts: {
  productId: string
  channel?: Channel
  by: string
  reason: string
}): Promise<QaSubmission> {
  const channel: Channel = opts.channel === 'etsy' ? 'etsy' : 'storefront'
  const history = await reviewHistory(opts.productId, channel)
  const last = history[0]
  if (!last) throw new Error('Nothing to override — this design has never been reviewed.')
  if (last.status === 'passed') throw new Error('This design already passed QA; there is nothing to override.')

  const submissionNo = await nextSubmissionNo(opts.productId, channel)
  const rework: ReworkItem[] = Array.isArray(last.rework) ? last.rework : []

  const { data: review, error } = await supabase
    .from('design_qa_reviews')
    .insert({
      product_id: opts.productId,
      channel,
      submission_no: submissionNo,
      status: 'overridden',
      score: last.score,
      criteria: last.criteria,
      rework,
      submitted_by: opts.by,
      model: last.model,
      override_reason: opts.reason,
      override_by: opts.by
    })
    .select('id')
    .single()
  if (error) throw new Error(`Failed to record override: ${error.message}`)

  const fingerprint = String((last.criteria as any)?._fingerprint ?? '')
  const summary = {
    score: last.score ?? 0,
    blockingCount: rework.filter(r => r.severity === 'block').length,
    warningCount: rework.filter(r => r.severity !== 'block').length,
    rework
  }
  const stamp = stampFrom(summary, 'overridden', channel, submissionNo, review.id, fingerprint, opts.by)
  await stampProduct(opts.productId, channel, stamp)

  console.log(`[design-qa] OVERRIDDEN ${opts.productId} [${channel} #${submissionNo}] by ${opts.by}: ${opts.reason}`)
  return {
    reviewId: review.id,
    submissionNo,
    stamp,
    input: await buildPresentationInput(opts.productId, channel),
    verdict: {
      status: 'failed',
      score: summary.score,
      criteria: (last.criteria ?? {}) as any,
      rework,
      blockingCount: summary.blockingCount,
      warningCount: summary.warningCount,
      model: last.model ?? 'n/a',
      durationMs: 0
    }
  }
}
