// ---------------------------------------------------------------------------
// Mrs. Imagine steps in — the self-repair pass over a FAILED design review.
//
// David, 2026-09-08, looking at three blocking findings on the Etsy step:
// "if theres something wrong then mrs imagine should step in and fix it so it
// can proccess". Before this, a failed review dead-ended into three manual
// buttons; the flow could report a problem perfectly and do nothing about it.
//
// WHAT THIS IS NOT
// It is NOT an override. Nothing here marks a design as passed, and nothing
// here writes a design_qa_reviews row — it changes the PRESENTATION (the copy,
// the photo) and the gate then has to be satisfied again on its own terms by a
// fresh review. That distinction is the whole reason the gate is worth having,
// so it is enforced structurally: this module cannot reach `submitForQa` or
// `overrideQa` at all.
//
// THE LANES
// A verdict's blocking findings are not one kind of problem, and treating them
// as one is why an automatic fix would otherwise be either useless or reckless:
//
//   copy     title/tags/description        -> rewrite (etsy-copy-repair.ts)
//   photo    a render a shopper would see  -> re-shoot that shot
//   price    outside the sanity band       -> reset to the category anchor,
//                                             and ONLY when that lands in band
//   artwork  the print file itself is wrong-> David's call: a re-brief or a
//                                             background-removal pass, both of
//                                             which change the product
//   manual   infrastructure, or anything
//            unrecognised                  -> say so plainly, fix nothing
//
// Everything unrecognised lands in `manual`. A fixer that guesses at a finding
// it does not understand is worse than one that hands it back.
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js'
import { repairEtsyPack } from './etsy-copy-repair.js'
import { etsyAnchorPriceFor, type EtsyPack } from './etsy-seo-composer.js'
import { priceBandFor, type Channel, type ReworkItem } from './presentation-qa.js'
import { getStepFlow, redoShot, StepFlowValidationError, type ShotKey, type ShotState } from './step-flow/shots.js'

export type FixLane = 'copy' | 'photo' | 'price' | 'artwork' | 'manual'

/** A re-shoot costs a real image generation, so the number of them one call
 *  may fire is capped. Two covers the realistic case (the primary shot plus
 *  one more); a listing with more broken photos than that is a build problem,
 *  not something to spend eight renders papering over. */
export const MAX_RESHOOTS = Number(process.env.QA_AUTOFIX_MAX_RESHOOTS || 2)

/** The gate's own text for "the vision model did not answer", from
 *  presentation-qa.ts's unverifiedVerdict(). An outage is not a design defect
 *  and must never trigger a re-render — the same photo would come back. */
const INFRA_MARKER = 'infrastructure problem'

/**
 * Which lane one finding belongs to. Exported and pure so the routing can be
 * tested against real verdict shapes without touching a database.
 */
export function laneFor(item: ReworkItem): FixLane {
  if (String(item.fix ?? '').toLowerCase().includes(INFRA_MARKER)) return 'manual'
  switch (item.criterion) {
    case 'seo':
      return 'copy'
    case 'pricing':
      return 'price'
    case 'mockup_quality':
    case 'design_placement':
    case 'typography':
    case 'image_sharpness':
      return 'photo'
    case 'print_background':
      // Two very different defects share this criterion. The vision read is
      // about the RENDER (a panel or halo behind the art in the photo), which
      // a re-shoot can fix. The opacity read is about the PRINT FILE itself —
      // a painted checkerboard, no alpha channel, a full-bleed scene — and no
      // amount of re-rendering changes the file that goes to the printer.
      return (item.evidence as { source?: string } | undefined)?.source === 'vision' ? 'photo' : 'artwork'
    default:
      return 'manual'
  }
}

export function laneRework(rework: ReworkItem[]): Record<FixLane, ReworkItem[]> {
  const lanes: Record<FixLane, ReworkItem[]> = { copy: [], photo: [], price: [], artwork: [], manual: [] }
  for (const item of rework) {
    if (item.severity !== 'block') continue
    lanes[laneFor(item)].push(item)
  }
  return lanes
}

export interface AutofixReport {
  channel: Channel
  /** True when at least one lane actually changed something. */
  changed: boolean
  copy: { repaired: boolean; changes: string[]; stillBlocking: string[]; note?: string }
  photos: { redone: Array<{ key: ShotKey; jobId: string | null }>; note?: string }
  price: { repaired: boolean; from?: number; to?: number; note?: string }
  /** Blocking findings nobody automatic should touch, with the gate's own text. */
  unfixable: ReworkItem[]
  /** One or two plain sentences for the panel David reads. */
  summary: string
}

/** The shot keys backing the photos a shopper sees, best first. The Etsy
 *  presentation leads with the on-person shot, so that is the one a failure on
 *  the PRIMARY photo almost always means. */
const SHOT_PRIORITY: ShotKey[] = ['model', 'product', 'hanger']

/**
 * Which step-flow shot a photo finding is about.
 *
 * The gate reports the URL it measured. That URL is normally one of the shot
 * assets, so match on it first and only fall back to the priority order — a
 * fallback that re-shoots the wrong photo is worse than useless, so it is the
 * last resort, not the first guess.
 */
export function shotKeysForFindings(
  items: ReworkItem[],
  shots: Partial<Record<ShotKey, ShotState>>
): ShotKey[] {
  const entries = Object.entries(shots) as Array<[ShotKey, ShotState]>
  const keys: ShotKey[] = []
  const add = (key: ShotKey | undefined) => {
    if (key && !keys.includes(key)) keys.push(key)
  }

  for (const item of items) {
    const url = (item.evidence as { url?: unknown } | undefined)?.url
    if (typeof url !== 'string' || !url) continue
    add(entries.find(([, s]) => s.url === url)?.[0])
  }

  if (!keys.length && items.length) {
    // Nothing matched by URL — either the presentation was assembled from
    // `metadata.etsy_shots` (whose URLs are the mirrored copies) or the shot
    // has since been replaced. Fall back to the photo that carries the listing.
    const present = new Set(entries.map(([k]) => k))
    add(SHOT_PRIORITY.find(k => present.has(k)))
    if (!keys.length) add(entries[0]?.[0])
  }

  return keys.slice(0, MAX_RESHOOTS)
}

const sentence = (parts: string[]): string => parts.filter(Boolean).join(' ')

export interface AutofixOptions {
  productId: string
  channel: Channel
  /** Whoever asked — an admin session id, or the QA agent's id. Recorded on
   *  the shot jobs the same way a manual redo is. */
  userId: string
  /** The blocking findings to act on, from the latest review. */
  rework: ReworkItem[]
}

/**
 * Try to clear a failed review's blocking findings. Returns what was changed
 * and what was not; the caller re-runs the review afterwards, which is the only
 * thing that can actually clear the gate.
 */
export async function autofixPresentation(opts: AutofixOptions): Promise<AutofixReport> {
  const { productId, channel, userId } = opts
  const lanes = laneRework(opts.rework)

  const report: AutofixReport = {
    channel,
    changed: false,
    copy: { repaired: false, changes: [], stillBlocking: [] },
    photos: { redone: [] },
    price: { repaired: false },
    unfixable: [...lanes.artwork, ...lanes.manual],
    summary: '',
  }

  // --- copy ---------------------------------------------------------------
  // Etsy only: the storefront's copy is the catalogue row itself, which the
  // admin edits directly — rewriting a live product's name and description
  // out from under them is not a repair, it is a surprise.
  if (lanes.copy.length && channel === 'etsy') {
    try {
      const result = await repairEtsyPack(productId, lanes.copy.map(i => i.issue))
      report.copy = { repaired: result.repaired, changes: result.changes, stillBlocking: result.stillBlocking }
      if (result.repaired) report.changed = true
      if (result.stillBlocking.length) {
        report.copy.note = 'Some copy objections could not be cleared automatically.'
      }
    } catch (err: any) {
      report.copy.note = `The listing copy could not be rewritten (${err?.message || err}).`
      report.unfixable.push(...lanes.copy)
    }
  } else if (lanes.copy.length) {
    report.copy.note = 'Storefront copy is edited on the product itself, so it is left alone here.'
    report.unfixable.push(...lanes.copy)
  }

  // --- price --------------------------------------------------------------
  if (lanes.price.length) {
    const outOfBand = lanes.price.filter(i => /outside the sane range/i.test(i.issue))
    // "at or below cost" is never auto-fixed: raising a price is a business
    // decision, and the cost record itself may be the thing that is wrong.
    const belowCost = lanes.price.filter(i => !outOfBand.includes(i))
    if (belowCost.length) {
      report.price.note = 'A price at or below cost is a call for David, not an automatic edit.'
      report.unfixable.push(...belowCost)
    }
    if (outOfBand.length) {
      try {
        const fixed = await resetPackPriceToAnchor(productId)
        report.price = { ...report.price, ...fixed }
        if (fixed.repaired) report.changed = true
        else report.unfixable.push(...outOfBand)
      } catch (err: any) {
        report.price.note = `The listing price could not be reset (${err?.message || err}).`
        report.unfixable.push(...outOfBand)
      }
    }
  }

  // --- photos -------------------------------------------------------------
  if (lanes.photo.length) {
    try {
      const { data: product } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
      const stepFlow = getStepFlow(product as any)
      const keys = shotKeysForFindings(lanes.photo, stepFlow.shots ?? {})
      if (!keys.length) {
        report.photos.note = 'There is no step-flow shot to re-render for this product.'
        report.unfixable.push(...lanes.photo)
      } else {
        for (const key of keys) {
          const { job } = await redoShot(productId, userId, key)
          report.photos.redone.push({ key, jobId: job.id })
        }
        report.changed = true
      }
    } catch (err: any) {
      report.photos.note =
        err instanceof StepFlowValidationError
          ? `The photo could not be re-rendered: ${err.message}.`
          : `The photo could not be re-rendered (${err?.message || err}).`
      report.unfixable.push(...lanes.photo)
    }
  }

  report.summary = summarise(report)
  return report
}

function summarise(report: AutofixReport): string {
  const did: string[] = []
  if (report.copy.repaired) did.push('rewrote the listing copy')
  if (report.price.repaired) did.push(`reset the price to $${report.price.to?.toFixed(2)}`)
  if (report.photos.redone.length) {
    did.push(`is re-shooting ${report.photos.redone.length === 1 ? 'the photo' : `${report.photos.redone.length} photos`}`)
  }

  if (!did.length) {
    return sentence([
      'Mrs. Imagine could not fix this one automatically.',
      report.copy.note ?? report.photos.note ?? report.price.note ?? '',
    ])
  }

  const list = did.length === 1 ? did[0] : `${did.slice(0, -1).join(', ')} and ${did[did.length - 1]}`
  const left = report.unfixable.length
  return sentence([
    `Mrs. Imagine ${list}.`,
    left ? `${left} thing${left === 1 ? '' : 's'} still need${left === 1 ? 's' : ''} you.` : '',
  ])
}

/**
 * Put the Etsy pack's price back on the category anchor. Only counts as a fix
 * when the anchor itself sits inside the gate's band — otherwise the "fix"
 * would just re-fail, and the band or the anchor is what needs changing.
 */
async function resetPackPriceToAnchor(
  productId: string
): Promise<{ repaired: boolean; from?: number; to?: number; note?: string }> {
  const { data: product, error } = await supabase
    .from('products')
    .select('id, name, category, price, metadata')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  const metadata: Record<string, any> = (product as any).metadata ?? {}
  const pack: EtsyPack | undefined = metadata.etsy_pack
  const from = Number(pack?.price ?? product.price ?? 0)
  const to = etsyAnchorPriceFor(product as any)
  const [min, max] = priceBandFor(product.category)

  if (!(to >= min && to <= max)) {
    return { repaired: false, from, to, note: `The $${to} anchor is itself outside the $${min}-$${max} band for this category.` }
  }
  if (from === to) return { repaired: false, from, to, note: 'The price already sits on the category anchor.' }
  if (!pack) return { repaired: false, from, to, note: 'There is no composed Etsy pack to price.' }

  const { error: updErr } = await supabase
    .from('products')
    .update({ metadata: { ...metadata, etsy_pack: { ...pack, price: to, edited_at: new Date().toISOString() } } })
    .eq('id', productId)
  if (updErr) throw new Error(`Failed to persist the price: ${updErr.message}`)
  return { repaired: true, from, to }
}
