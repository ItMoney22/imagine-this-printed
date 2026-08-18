// ---------------------------------------------------------------------------
// Presentation QA gate — the six-criterion review every design presentation
// must clear before it can go live. Watchtower task 9ec9444a.
//
// WHY THIS EXISTS
// Two QA checks already shipped and both are narrower than the problem:
//   design-library-quality.ts  can the ARTWORK print? (pixels vs DPI)
//   mockup-qa.ts               is THIS ONE render the right art at the right
//                              size? (vision, per shot, fail-OPEN by design)
// Neither looks at what a shopper actually judges — the whole package: the
// photo set, the copy, the tags, the price, together. David's read on why the
// store underperforms is presentation quality, so the gate grades the package.
//
// FAIL-CLOSED, unlike mockup-qa. That module fails open on purpose: a QA outage
// must never bin a render that was already paid for. This one is the opposite
// contract — "a design presentation cannot go live without passing" — so when a
// check cannot run, the presentation does NOT pass. Set
// PRESENTATION_QA_VISION_REQUIRED=false to downgrade the vision-dependent
// criteria to advisory if the store ever has to ship without a vision key.
//
// EVERY THRESHOLD IN THIS FILE WAS MEASURED, NOT GUESSED. See
// scripts/calibrate-qa-sharpness.ts and the numbers quoted at each constant.
// Re-run it after any change to how mockups are rendered.
// ---------------------------------------------------------------------------
import OpenAI from 'openai'
import { checkMockup, coverageIsExempt } from './mockup-qa.js'
import { measureImages, type ImageMetricsResult } from './image-metrics.js'
import { MAX_TAGS, MAX_TITLE_LEN } from './etsy-listing-fields.js'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

/** Vision unavailable = the presentation FAILS, unless explicitly downgraded. */
export const VISION_REQUIRED = process.env.PRESENTATION_QA_VISION_REQUIRED !== 'false'

export type Channel = 'storefront' | 'etsy'

export const CRITERIA = [
  'mockup_quality',
  'design_placement',
  'typography',
  'seo',
  'pricing',
  'image_sharpness'
] as const
export type CriterionId = typeof CRITERIA[number]

export type Severity = 'block' | 'warn'

export interface Finding {
  severity: Severity
  /** What is wrong, in one sentence a designer can act on. */
  issue: string
  /** What to do about it. */
  fix: string
  /** Numbers/urls backing the call, so nobody has to take it on faith. */
  evidence?: Record<string, unknown>
}

export interface CriterionVerdict {
  ok: boolean
  /** True when the check could not run at all (no vision key, image unreachable). */
  unverified?: boolean
  summary: string
  findings: Finding[]
  measured?: Record<string, unknown>
}

export interface ReworkItem extends Finding {
  criterion: CriterionId
}

export interface PresentationVerdict {
  status: 'passed' | 'failed'
  /** 0-100. Not a pass/fail input — any blocking finding fails regardless. */
  score: number
  criteria: Record<CriterionId, CriterionVerdict>
  rework: ReworkItem[]
  blockingCount: number
  warningCount: number
  model: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// IMAGE THRESHOLDS — calibrated 2026-08-17 against 40 live ITP listing images.
//
//   live corpus short edge   p05 1008   p50 1024   (the render pipeline emits 1024)
//   live corpus sharpness    min 186    p05 243    p25 515    p50 909    p95 5246
//
// Ground truth from the same run, on a real image measured at 17,475:
//   gaussian blur sigma 1.5  ->  2,664      (soft but arguably usable)
//   gaussian blur sigma 2.5  ->     78      (obviously blurry)
//   downsampled to 200px then blown back up to 2000px  ->  97
//
// So the whole band between "worst real image" (186) and "obviously ruined"
// (78-97) is empty. 120 sits in that gap: it cannot fail anything the current
// pipeline produces, and it cannot pass a blurred or heavily upscaled render.
// ---------------------------------------------------------------------------
export const MIN_SHORT_EDGE_PX = Number(process.env.QA_MIN_IMAGE_SHORT_EDGE || 1000)
/** Etsy's own guidance is 2000px on the shortest side. Our renderer emits 1024,
 *  so this is a WARN — a standing note that the renderer should go bigger, not
 *  a reason to hold a design that is as good as everything already live. */
export const WARN_SHORT_EDGE_PX = Number(process.env.QA_WARN_IMAGE_SHORT_EDGE || 2000)
export const MIN_SHARPNESS = Number(process.env.QA_MIN_SHARPNESS || 120)
export const WARN_SHARPNESS = Number(process.env.QA_WARN_SHARPNESS || 300)
/** Etsy allows 10 photos and listings with more of them convert better. */
export const MIN_MOCKUPS = Number(process.env.QA_MIN_MOCKUPS || 1)
export const WARN_MOCKUPS = Number(process.env.QA_WARN_MOCKUPS || 3)

// ---------------------------------------------------------------------------
// SEO RULES
//
// Titles: Etsy's current quality guidance penalises comma-stacked keyword
// titles — their own listing feedback rewrites them — which is why the composer
// (etsy-seo-composer.ts) already targets 50-90 human-readable characters. These
// numbers are that same target, enforced instead of merely requested.
// ---------------------------------------------------------------------------
export const SEO_RULES = {
  storefront: { titleMin: 20, titleMax: 80, titleIdeal: [30, 70] as [number, number], tagsMin: 5, tagsIdeal: 8 },
  etsy: { titleMin: 40, titleMax: MAX_TITLE_LEN, titleIdeal: [50, 90] as [number, number], tagsMin: 10, tagsIdeal: MAX_TAGS }
} satisfies Record<Channel, { titleMin: number; titleMax: number; titleIdeal: [number, number]; tagsMin: number; tagsIdeal: number }>

/** The mobile search-result preview cuts here, so the first line has to stand alone. */
export const HOOK_MAX_CHARS = 155
export const HOOK_MIN_CHARS = 40
/**
 * Description length. This one is a JUDGEMENT, not a platform fact, so it is
 * env-tunable — and it is currently the strictest thing in the gate: a live
 * sample of the catalogue (2026-08-17) ran 242-282 characters, so every one of
 * them fails it. That is the intended answer rather than a miscalibration —
 * a 240-character description is thin for a listing that has to sell on its
 * own — but it is the first number to reach for if the gate needs to be eased
 * while the copy catches up. Only newly-activated designs are affected;
 * nothing already live is pulled down.
 */
export const DESCRIPTION_MIN_CHARS = Number(process.env.QA_DESCRIPTION_MIN_CHARS || 300)
/**
 * Tag length. 20 is ETSY'S limit — a longer tag is rejected by the platform, so
 * it blocks there. The storefront has no such limit, and applying Etsy's rule
 * to it produced a live false failure: real keywords like
 * "neon y2k glitch ghost shirt" (27 chars) are perfectly good storefront search
 * terms. Over 40 characters a "tag" is a sentence, so that warns.
 */
export const MAX_TAG_CHARS = 20
export const STOREFRONT_WARN_TAG_CHARS = 40
/** More than this many commas in a title is keyword stuffing, not a title. */
export const MAX_TITLE_COMMAS = 2

/**
 * Products whose artwork is PRINTED ON A GARMENT, and therefore have a print
 * placement to get right. Everything else (a metal wall panel, a 3D print) is a
 * product photographed as itself — asking whether the print is "centred on the
 * chest" is a category error, and it produced exactly that false failure live.
 */
const GARMENT_CATEGORIES = new Set(['shirts', 'hoodies', 'dtf-transfers', 'tumblers'])
export const isGarment = (category: string | null | undefined): boolean =>
  GARMENT_CATEGORIES.has(String(category ?? ''))
/** Sentinel placement that switches the shared coverage check off — see
 *  mockup-qa.ts coverageIsExempt(). */
export const NO_PLACEMENT = 'not-applicable'

/** Tags that are pure filler on a print shop: they match everything, so they
 *  rank for nothing. Only rejected when the tag is JUST this word. */
const FILLER_TAGS = new Set([
  'shirt', 'shirts', 'tshirt', 't shirt', 'tee', 'tees', 'top', 'clothing', 'apparel',
  'gift', 'gifts', 'art', 'design', 'designs', 'print', 'prints', 'cool', 'nice', 'cute',
  'custom', 'unique', 'new', 'best', 'quality', 'trendy', 'style'
])

// The variation selector is matched by ALTERNATION rather than inside the
// class: a combining mark in a character class is a real footgun (it silently
// changes what neighbouring ranges match) and eslint's
// no-misleading-character-class rightly refuses it.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}/u
/** Three or more consecutive capitals = a shouted word. Roman numerals and
 *  common sizing/material initialisms are legitimate and exempt. */
const SHOUTED_WORD = /\b[A-Z]{3,}\b/g
const CAPS_ALLOWLIST = new Set([
  'DTF', 'UV', 'SVG', 'PNG', 'JPG', 'PDF', 'USA', 'XXL', 'XXXL', 'XL', 'AI', 'HTV', 'ITP',
  'III', 'VII', 'VIII', 'XIII', 'XXL', 'BBQ', 'ATV', 'RV', 'NEW', 'LED', 'UFO'
])

// ---------------------------------------------------------------------------
// PRICING BANDS — per catalogue category, in USD.
//
// These are SANITY bands, not a pricing strategy: they exist to catch a $0.50
// shirt or a $4,000 tumbler, i.e. a decimal that slipped or a currency that got
// crossed. The apparel floor is set above the printed cost of a blank + DTF
// transfer so a listing can never be published at a guaranteed loss; the
// ceilings are roughly 3x the highest thing ITP has ever legitimately sold in
// that category. Every band is env-overridable so a real price change never
// needs a deploy — same principle as shared/etsy-tiers.ts.
// ---------------------------------------------------------------------------
const bandEnv = (key: string, fallback: [number, number]): [number, number] => {
  const raw = process.env[key]
  if (!raw) return fallback
  const [min, max] = raw.split(':').map(Number)
  return Number.isFinite(min) && Number.isFinite(max) && min < max ? [min, max] : fallback
}

export const PRICE_BANDS: Record<string, [number, number]> = {
  shirts: bandEnv('QA_PRICE_BAND_SHIRTS', [15, 60]),
  hoodies: bandEnv('QA_PRICE_BAND_HOODIES', [28, 95]),
  tumblers: bandEnv('QA_PRICE_BAND_TUMBLERS', [15, 65]),
  'dtf-transfers': bandEnv('QA_PRICE_BAND_TRANSFERS', [4, 45]),
  'metal-art': bandEnv('QA_PRICE_BAND_METAL', [18, 160]),
  '3d-models': bandEnv('QA_PRICE_BAND_3D_MODELS', [1, 60]),
  '3d-prints': bandEnv('QA_PRICE_BAND_3D_PRINTS', [8, 200])
}
export const DEFAULT_PRICE_BAND: [number, number] = bandEnv('QA_PRICE_BAND_DEFAULT', [5, 250])

export const priceBandFor = (category: string | null | undefined): [number, number] =>
  PRICE_BANDS[String(category ?? '')] ?? DEFAULT_PRICE_BAND

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export interface PresentationInput {
  productId: string
  name: string
  channel: Channel
  category: string | null
  /** Source artwork, for the fidelity comparison. Null = fidelity unverifiable. */
  designUrl: string | null
  /** The photos the shopper will see, primary first. */
  mockupUrls: string[]
  placement?: string | null
  printSizeInches?: number | null
  title: string
  description: string
  tags: string[]
  price: number
  /** Landed cost if known — a listing must never be priced under it. */
  costFloor?: number | null
}

const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()
const normaliseTag = (t: string): string => clean(t).toLowerCase().replace(/[^a-z0-9 ]/g, '')

// ---------------------------------------------------------------------------
// (a) MOCKUP QUALITY + (f) IMAGE SHARPNESS — both read the same measurements,
// but they are separate criteria because they fail for different reasons and
// have different fixes: "shoot more/bigger photos" vs "re-render, it's soft".
// ---------------------------------------------------------------------------
export function checkMockupQuality(metrics: ImageMetricsResult[], urlCount: number): CriterionVerdict {
  const findings: Finding[] = []
  const readable = metrics.filter((m): m is Extract<ImageMetricsResult, { ok: true }> => m.ok)
  const unreadable = metrics.filter(m => !m.ok)

  if (urlCount < MIN_MOCKUPS) {
    findings.push({
      severity: 'block',
      issue: `The presentation has ${urlCount} product photo${urlCount === 1 ? '' : 's'}; at least ${MIN_MOCKUPS} is required.`,
      fix: 'Render the product mockups before submitting this design for review.',
      evidence: { image_count: urlCount, required: MIN_MOCKUPS }
    })
  } else if (urlCount < WARN_MOCKUPS) {
    findings.push({
      severity: 'warn',
      issue: `Only ${urlCount} product photo${urlCount === 1 ? '' : 's'}. Listings with ${WARN_MOCKUPS}+ photos convert better.`,
      fix: `Add ${WARN_MOCKUPS - urlCount} more shot(s) — a second colourway, a detail crop, or a flat-lay.`,
      evidence: { image_count: urlCount, recommended: WARN_MOCKUPS }
    })
  }

  for (const bad of unreadable) {
    findings.push({
      severity: 'block',
      issue: `A listing photo could not be opened (${(bad as { error: string }).error}).`,
      fix: 'Re-upload or re-render this image — a shopper would see a broken photo.',
      evidence: { url: bad.url }
    })
  }

  for (const m of readable) {
    if (m.shortEdge < MIN_SHORT_EDGE_PX) {
      findings.push({
        severity: 'block',
        issue: `A listing photo is only ${m.width}x${m.height}px. Its short edge (${m.shortEdge}px) is below the ${MIN_SHORT_EDGE_PX}px minimum.`,
        fix: `Re-render at ${WARN_SHORT_EDGE_PX}px or larger on the short edge.`,
        evidence: { url: m.url, width: m.width, height: m.height, required_px: MIN_SHORT_EDGE_PX }
      })
    } else if (m.shortEdge < WARN_SHORT_EDGE_PX) {
      findings.push({
        severity: 'warn',
        issue: `A listing photo is ${m.width}x${m.height}px. Etsy recommends ${WARN_SHORT_EDGE_PX}px on the shortest side.`,
        fix: 'Not blocking — the current renderer maxes out here. Raise the render size to close this.',
        evidence: { url: m.url, short_edge_px: m.shortEdge, recommended_px: WARN_SHORT_EDGE_PX }
      })
    }
  }

  const blocking = findings.filter(f => f.severity === 'block')
  return {
    ok: blocking.length === 0,
    summary: blocking.length
      ? `${blocking.length} photo problem(s) that would reach the shopper.`
      : `${readable.length} photo(s), all readable and at or above ${MIN_SHORT_EDGE_PX}px.`,
    findings,
    measured: {
      image_count: urlCount,
      readable: readable.length,
      resolutions: readable.map(m => `${m.width}x${m.height}`)
    }
  }
}

export function checkSharpness(metrics: ImageMetricsResult[]): CriterionVerdict {
  const readable = metrics.filter((m): m is Extract<ImageMetricsResult, { ok: true }> => m.ok)
  const findings: Finding[] = []

  if (!readable.length) {
    return {
      ok: false,
      unverified: true,
      summary: 'No readable image to measure sharpness on.',
      findings: [{
        severity: 'block',
        issue: 'Sharpness could not be measured because no listing photo could be decoded.',
        fix: 'Fix the photo URLs, then resubmit.',
      }],
      measured: {}
    }
  }

  for (const m of readable) {
    if (m.sharpness < MIN_SHARPNESS) {
      findings.push({
        severity: 'block',
        issue: `A listing photo is blurry or upscaled (sharpness ${m.sharpness}, minimum ${MIN_SHARPNESS}).`,
        fix: 'Re-render this shot from the full-resolution artwork. Do not enlarge a small render to hit the pixel count — that is what this measurement catches.',
        evidence: { url: m.url, sharpness: m.sharpness, minimum: MIN_SHARPNESS, resolution: `${m.width}x${m.height}` }
      })
    } else if (m.sharpness < WARN_SHARPNESS) {
      findings.push({
        severity: 'warn',
        issue: `A listing photo is soft (sharpness ${m.sharpness}; the live catalogue's median is ~900).`,
        fix: 'Consider re-rendering — it will look flat next to the sharper listings in the same search results.',
        evidence: { url: m.url, sharpness: m.sharpness, warn_below: WARN_SHARPNESS }
      })
    }
  }

  const blocking = findings.filter(f => f.severity === 'block')
  const values = readable.map(m => m.sharpness)
  return {
    ok: blocking.length === 0,
    summary: blocking.length
      ? `${blocking.length} photo(s) below the ${MIN_SHARPNESS} sharpness floor.`
      : `Sharpness ${Math.min(...values)}-${Math.max(...values)}, all above the ${MIN_SHARPNESS} floor.`,
    findings,
    measured: { sharpness: values, floor: MIN_SHARPNESS, warn_below: WARN_SHARPNESS }
  }
}

// ---------------------------------------------------------------------------
// (d) SEO — title, description, tags.
// ---------------------------------------------------------------------------
export function checkSeo(input: Pick<PresentationInput, 'channel' | 'title' | 'description' | 'tags'>): CriterionVerdict {
  const rules = SEO_RULES[input.channel]
  const findings: Finding[] = []
  const title = clean(input.title)
  const description = String(input.description ?? '').trim()
  const tags = (input.tags ?? []).map(clean).filter(Boolean)

  // --- title ---
  if (!title) {
    findings.push({ severity: 'block', issue: 'The listing has no title.', fix: 'Write a title.' })
  } else {
    if (title.length < rules.titleMin) {
      findings.push({
        severity: 'block',
        issue: `Title is ${title.length} characters; the minimum is ${rules.titleMin}.`,
        fix: `Name the design, add a style descriptor and the product type — aim for ${rules.titleIdeal[0]}-${rules.titleIdeal[1]} characters.`,
        evidence: { title, length: title.length }
      })
    } else if (title.length > rules.titleMax) {
      findings.push({
        severity: 'block',
        issue: `Title is ${title.length} characters; the maximum is ${rules.titleMax}.`,
        fix: `Cut it to ${rules.titleIdeal[1]} characters or fewer and move the extra phrases into tags.`,
        evidence: { title, length: title.length }
      })
    } else if (title.length < rules.titleIdeal[0] || title.length > rules.titleIdeal[1]) {
      findings.push({
        severity: 'warn',
        issue: `Title is ${title.length} characters; the ideal range is ${rules.titleIdeal[0]}-${rules.titleIdeal[1]}.`,
        fix: 'Tighten or expand it — outside this range it either under-describes or reads as stuffed.',
        evidence: { length: title.length }
      })
    }

    const commas = (title.match(/,/g) || []).length
    if (commas > MAX_TITLE_COMMAS) {
      findings.push({
        severity: 'block',
        issue: `Title is a comma-stacked keyword list (${commas} commas). Etsy's quality guidance penalises this.`,
        fix: 'Rewrite as a readable phrase: design name, one or two descriptors, product type. Every stacked keyword belongs in a tag instead.',
        evidence: { title, commas }
      })
    }

    if (EMOJI.test(title)) {
      findings.push({ severity: 'block', issue: 'Title contains emoji.', fix: 'Remove the emoji — they do not index and they read as spam.', evidence: { title } })
    }

    const shouted = (title.match(SHOUTED_WORD) || []).filter(w => !CAPS_ALLOWLIST.has(w))
    if (shouted.length) {
      findings.push({
        severity: 'warn',
        issue: `Title shouts: ${shouted.join(', ')}.`,
        fix: 'Use title case. ALL-CAPS words read as spam in search results.',
        evidence: { shouted }
      })
    }
  }

  // --- description ---
  if (!description) {
    findings.push({ severity: 'block', issue: 'The listing has no description.', fix: 'Write one — the first line is the mobile search preview.' })
  } else {
    const hook = description.split('\n').map(l => l.trim()).find(Boolean) ?? ''
    if (description.length < DESCRIPTION_MIN_CHARS) {
      findings.push({
        severity: 'block',
        issue: `Description is ${description.length} characters; the minimum is ${DESCRIPTION_MIN_CHARS}.`,
        fix: 'Add the sections buyers look for: the design, the garment, sizing, made-to-order, and care.',
        evidence: { length: description.length }
      })
    }
    if (hook.length > HOOK_MAX_CHARS) {
      findings.push({
        severity: 'warn',
        issue: `The opening line is ${hook.length} characters and will be cut off at ~${HOOK_MAX_CHARS} in the mobile preview.`,
        fix: 'Make the first line a standalone hook under 155 characters, then break and continue.',
        evidence: { hook_length: hook.length }
      })
    } else if (hook.length < HOOK_MIN_CHARS && description.length >= DESCRIPTION_MIN_CHARS) {
      findings.push({
        severity: 'warn',
        issue: `The opening line is only ${hook.length} characters — it wastes the mobile preview.`,
        fix: 'Open with a full sentence saying what it is and who it is for.',
        evidence: { hook_length: hook.length }
      })
    }
  }

  // --- tags ---
  if (tags.length < rules.tagsMin) {
    findings.push({
      severity: 'block',
      issue: `Only ${tags.length} tag(s); at least ${rules.tagsMin} are required${input.channel === 'etsy' ? ` and Etsy allows ${MAX_TAGS}` : ''}.`,
      fix: `Add buyer phrases across style, audience, occasion, gift wording and the design subject until you have ${rules.tagsIdeal}.`,
      evidence: { tag_count: tags.length }
    })
  } else if (tags.length < rules.tagsIdeal) {
    findings.push({
      severity: 'warn',
      issue: `${tags.length} tags used of ${rules.tagsIdeal} available — every unused tag is a search you cannot appear in.`,
      fix: `Add ${rules.tagsIdeal - tags.length} more distinct buyer phrase(s).`,
      evidence: { tag_count: tags.length }
    })
  }

  // Etsy REJECTS a tag over 20 characters, so there it blocks. The storefront
  // has no platform limit, so an over-long keyword is a style note, not a stop.
  if (input.channel === 'etsy') {
    const overlong = tags.filter(t => t.length > MAX_TAG_CHARS)
    if (overlong.length) {
      findings.push({
        severity: 'block',
        issue: `${overlong.length} tag(s) exceed Etsy's ${MAX_TAG_CHARS}-character limit: ${overlong.join(', ')}.`,
        fix: 'Shorten them — Etsy rejects a tag over the limit outright.',
        evidence: { overlong }
      })
    }
  } else {
    const rambling = tags.filter(t => t.length > STOREFRONT_WARN_TAG_CHARS)
    if (rambling.length) {
      findings.push({
        severity: 'warn',
        issue: `${rambling.length} keyword(s) are longer than ${STOREFRONT_WARN_TAG_CHARS} characters and read as sentences: ${rambling.join(', ')}.`,
        fix: 'Split them into 2-3 word buyer phrases. They also need to fit Etsy\'s 20-character limit if this design is ever posted there.',
        evidence: { rambling }
      })
    }
  }

  const seen = new Map<string, string>()
  const dupes: string[] = []
  for (const t of tags) {
    const key = normaliseTag(t)
    if (!key) continue
    if (seen.has(key)) dupes.push(t)
    else seen.set(key, t)
  }
  if (dupes.length) {
    findings.push({
      severity: 'block',
      issue: `Duplicate tags: ${dupes.join(', ')}.`,
      fix: 'Replace each duplicate with a distinct phrase — a repeated tag is a wasted slot, not extra weight.',
      evidence: { dupes }
    })
  }

  const filler = tags.filter(t => FILLER_TAGS.has(normaliseTag(t)))
  if (filler.length) {
    findings.push({
      severity: 'block',
      issue: `Filler tags that rank for nothing: ${filler.join(', ')}.`,
      fix: 'Replace each with a 2-3 word buyer phrase — "retro varsity tee", not "shirt".',
      evidence: { filler }
    })
  }

  const singleWord = tags.filter(t => !FILLER_TAGS.has(normaliseTag(t)) && !t.includes(' '))
  if (singleWord.length > Math.floor(tags.length / 2) && tags.length >= rules.tagsMin) {
    findings.push({
      severity: 'warn',
      issue: `${singleWord.length} of ${tags.length} tags are single words. Shoppers search in phrases.`,
      fix: 'Convert most tags to 2-3 word phrases.',
      evidence: { single_word: singleWord }
    })
  }

  // Coherence: at least one tag phrase should actually appear in the copy.
  if (tags.length && (title || description)) {
    const haystack = `${title} ${description}`.toLowerCase()
    const anchored = tags.some(t => haystack.includes(normaliseTag(t)) && normaliseTag(t).length > 3)
    if (!anchored) {
      findings.push({
        severity: 'warn',
        issue: 'None of the tags appear in the title or description.',
        fix: 'Etsy weighs tag/copy agreement — make sure the two or three strongest tags are also in the copy.',
        evidence: { tags }
      })
    }
  }

  const blocking = findings.filter(f => f.severity === 'block')
  return {
    ok: blocking.length === 0,
    summary: blocking.length
      ? `${blocking.length} SEO problem(s) that would hurt or block the listing.`
      : `Title ${title.length} chars, ${tags.length} tags, description ${description.length} chars.`,
    findings,
    measured: { title_length: title.length, tag_count: tags.length, description_length: description.length }
  }
}

// ---------------------------------------------------------------------------
// (e) PRICING SANITY
// ---------------------------------------------------------------------------
export function checkPricing(input: Pick<PresentationInput, 'category' | 'price' | 'costFloor'>): CriterionVerdict {
  const findings: Finding[] = []
  const price = Number(input.price)
  const [min, max] = priceBandFor(input.category)

  if (!Number.isFinite(price)) {
    findings.push({ severity: 'block', issue: 'Price is missing or not a number.', fix: 'Set a price before submitting.', evidence: { price: input.price } })
  } else if (price <= 0) {
    findings.push({ severity: 'block', issue: `Price is ${price}.`, fix: 'Set a real price — a free listing is a mistake, not a promotion.', evidence: { price } })
  } else {
    if (Math.round(price * 100) !== Number((price * 100).toFixed(4))) {
      findings.push({
        severity: 'block',
        issue: `Price ${price} has sub-cent precision.`,
        fix: 'Round to two decimal places.',
        evidence: { price }
      })
    }
    if (price < min || price > max) {
      findings.push({
        severity: 'block',
        issue: `Price $${price.toFixed(2)} is outside the sane range for ${input.category ?? 'this category'} ($${min}-$${max}).`,
        fix: `Correct the price, or have an admin override the gate if $${price.toFixed(2)} is genuinely intended.`,
        evidence: { price, band_min: min, band_max: max, category: input.category }
      })
    }
    const floor = Number(input.costFloor)
    if (Number.isFinite(floor) && floor > 0 && price <= floor) {
      findings.push({
        severity: 'block',
        issue: `Price $${price.toFixed(2)} is at or below the recorded cost of $${floor.toFixed(2)} — every sale loses money.`,
        fix: 'Raise the price above cost, or correct the cost record if it is wrong.',
        evidence: { price, cost_floor: floor }
      })
    }
  }

  const blocking = findings.filter(f => f.severity === 'block')
  return {
    ok: blocking.length === 0,
    summary: blocking.length ? blocking[0].issue : `$${price.toFixed(2)} is within the $${min}-$${max} band for ${input.category ?? 'default'}.`,
    findings,
    measured: { price, band: [min, max], category: input.category }
  }
}

// ---------------------------------------------------------------------------
// (b) PLACEMENT + (c) TYPOGRAPHY + the realism half of (a) — the vision pass.
//
// One extra model call on top of the fidelity/coverage comparison that
// mockup-qa.ts already performs, rather than a third: fidelity and coverage are
// already solved there and re-asking would cost money to get a second opinion
// on a settled question.
// ---------------------------------------------------------------------------
export interface VisionRead {
  realistic: boolean
  realismIssue: string
  centered: boolean
  placementIssue: string
  hasText: boolean
  typographyOk: boolean
  typographyIssue: string
}

export async function readPresentation(
  mockupUrl: string,
  placement?: string | null,
  garment = true
): Promise<VisionRead | null> {
  if (!openai) return null
  const placementLine = !garment
    ? 'This product is NOT a printed garment — it is the item itself (a metal wall panel, a printed object). Judge only whether it is shown squarely and completely in frame with the artwork fully visible and not cropped. Do NOT expect the artwork to be printed on clothing, and do not fail it for being shown on a wall or a surface.'
    : coverageIsExempt(placement)
      ? 'This is an intentional all-over print, so do not judge how the print is positioned or centred — set centered to true.'
      : 'The print should sit STRAIGHT and CENTRED for its placement: a chest print centred left-to-right on the body and level with the shoulders; a pocket print squarely on one side of the chest. Set centered to false only if it is visibly off-centre, tilted, or crooked — not for the natural skew of a photographed garment.'

  try {
    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a listing-photo reviewer for an online print shop. You judge whether a product photo is good ' +
            'enough to put in front of a shopper. You report only defects a shopper would actually notice.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Review this product photo on three points.\n\n' +
                '1. REALISM — does it read as a real photograph of a real garment? Set realistic to false for ' +
                'melted or malformed hands and faces, impossible fabric, seams that dissolve, garbled text on ' +
                'labels/tags, duplicated limbs, or an obviously synthetic plastic look. Ordinary studio lighting, ' +
                'a plain backdrop, a flat-lay and a ghost-mannequin shot are all FINE.\n\n' +
                `2. PLACEMENT — ${placementLine}\n\n` +
                '3. TYPOGRAPHY — judge only the design\'s FOCAL text: a title, a name, a slogan, or any other ' +
                'wording that is clearly meant to be read as part of the main composition. Set typographyOk to ' +
                'false only when that focal text is broken, smeared, warped into nonsense, colliding, or so ' +
                'low-contrast it disappears — the kind of thing a shopper scrolling past would actually notice. ' +
                'A busy illustrated scene (a cityscape, a crowd, a market) often has small incidental signage, ' +
                'labels or background lettering that is part of the scenery rather than the sold message — it is ' +
                'FINE for that to be small or soft at normal viewing size; do not fail typography over it. Set ' +
                'hasText to false and typographyOk to true when the design has no focal words at all.\n\n' +
                'Respond in JSON: {"realistic": bool, "realismIssue": string, "centered": bool, ' +
                '"placementIssue": string, "hasText": bool, "typographyOk": bool, "typographyIssue": string}. ' +
                'Each issue string is one short sentence naming the single worst defect, or an empty string when ' +
                'that point passes.'
            },
            { type: 'image_url', image_url: { url: mockupUrl, detail: 'high' } }
          ]
        }
      ],
      ...(isReasoningModel(VISION_MODEL) ? { max_completion_tokens: 900 } : { max_tokens: 400, temperature: 0 }),
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0]?.message?.content
    if (!content) return null
    const parsed = JSON.parse(content)
    // Absent field = pass, so a model that omits a key never invents a failure.
    return {
      realistic: parsed?.realistic !== false,
      realismIssue: clean(parsed?.realismIssue).slice(0, 200),
      centered: parsed?.centered !== false,
      placementIssue: clean(parsed?.placementIssue).slice(0, 200),
      hasText: parsed?.hasText === true,
      typographyOk: parsed?.typographyOk !== false,
      typographyIssue: clean(parsed?.typographyIssue).slice(0, 200)
    }
  } catch (err: any) {
    console.warn(`[presentation-qa] vision read failed (${err?.message || err})`)
    return null
  }
}

/** Vision could not run — how that lands depends on VISION_REQUIRED. */
const unverifiedVerdict = (what: string): CriterionVerdict => ({
  ok: !VISION_REQUIRED,
  unverified: true,
  summary: `${what} could not be verified — the vision reviewer did not answer.`,
  findings: VISION_REQUIRED
    ? [{
        severity: 'block',
        issue: `${what} could not be checked because the vision reviewer was unavailable.`,
        fix: 'This is an infrastructure problem, not a design problem. Retry the review; if it keeps failing, check OPENAI_API_KEY on the backend.'
      }]
    : [{
        severity: 'warn',
        issue: `${what} was not checked (vision review is disabled).`,
        fix: 'Set PRESENTATION_QA_VISION_REQUIRED=true and configure OPENAI_API_KEY to enforce this criterion.'
      }],
  measured: { verified: false }
})

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------
const SCORE_WEIGHTS: Record<CriterionId, number> = {
  mockup_quality: 20,
  design_placement: 20,
  typography: 15,
  seo: 20,
  pricing: 10,
  image_sharpness: 15
}

export async function runPresentationQa(input: PresentationInput): Promise<PresentationVerdict> {
  const started = Date.now()
  const urls = (input.mockupUrls ?? []).filter(u => typeof u === 'string' && u.length > 0)
  const primary = urls[0] ?? null

  // Measure every photo, and run both vision passes against the PRIMARY shot —
  // the one that carries the listing in search results.
  // A metal panel or a 3D print is photographed as ITSELF; there is no print
  // placement on a garment to get right. Feeding the shared coverage checker a
  // garment placement for one produced a live false failure ("shown on a wall
  // canvas instead of printed on a chest garment"), so non-garment products go
  // in with the exemption sentinel.
  const garment = isGarment(input.category)
  const placementForCoverage = garment ? input.placement : NO_PLACEMENT

  const [metrics, vision, fidelity] = await Promise.all([
    measureImages(urls),
    primary ? readPresentation(primary, input.placement, garment) : Promise.resolve(null),
    primary && input.designUrl
      ? checkMockup(input.designUrl, primary, placementForCoverage, input.printSizeInches)
      : Promise.resolve(null)
  ])

  const mockupQuality = checkMockupQuality(metrics, urls.length)
  const sharpness = checkSharpness(metrics)
  const seo = checkSeo(input)
  const pricing = checkPricing(input)

  // Realism rides on the mockup_quality criterion: both answer "is this a photo
  // we can put in front of a shopper".
  if (vision && !vision.realistic) {
    mockupQuality.findings.push({
      severity: 'block',
      issue: vision.realismIssue || 'The primary photo does not read as a real product photo.',
      fix: 'Re-render the shot. Artefacts like malformed hands, dissolving seams or garbled label text are what shoppers read as "AI junk".',
      evidence: { url: primary }
    })
    mockupQuality.ok = false
    mockupQuality.summary = vision.realismIssue || 'The primary photo does not read as real.'
  } else if (!vision && primary) {
    const unverified = unverifiedVerdict('Photo realism')
    mockupQuality.findings.push(...unverified.findings)
    if (VISION_REQUIRED) { mockupQuality.ok = false; mockupQuality.unverified = true }
  }

  // --- placement -----------------------------------------------------------
  let placement: CriterionVerdict
  if (!primary) {
    placement = {
      ok: false,
      summary: 'No photo to judge placement on.',
      findings: [{ severity: 'block', issue: 'There is no product photo, so the design placement cannot be reviewed.', fix: 'Render the mockups first.' }],
      measured: {}
    }
  } else if (!vision && !fidelity) {
    placement = unverifiedVerdict('Design placement')
  } else {
    const findings: Finding[] = []
    if (fidelity && !fidelity.ok) {
      findings.push(
        fidelity.failed === 'coverage'
          ? {
              severity: 'block',
              issue: fidelity.reason || 'The print is the wrong size for its placement.',
              fix: `Re-render at the size this product was built for (${input.placement ?? 'front-center'}). A print blown up edge-to-edge is a different product than the one being sold.`,
              evidence: { url: primary, placement: input.placement, size_inches: input.printSizeInches }
            }
          : {
              severity: 'block',
              issue: fidelity.reason || 'The printed design does not match the source artwork.',
              fix: 'Re-render from the source artwork. Do not let the renderer redraw text or restyle the art.',
              evidence: { url: primary, design_url: input.designUrl }
            }
      )
    }
    if (vision && !vision.centered) {
      findings.push({
        severity: 'block',
        issue: vision.placementIssue || (garment ? 'The print is off-centre or crooked on the garment.' : 'The product is cropped or skewed in the photo.'),
        fix: garment
          ? 'Re-render with the print squared and centred for its placement.'
          : 'Re-render with the whole product square in frame and the artwork fully visible.',
        evidence: { url: primary, placement: input.placement }
      })
    }
    if (!input.designUrl) {
      findings.push({
        severity: 'warn',
        issue: 'No source artwork was supplied, so print fidelity (re-drawn text, restyled art, wrong colours) could not be compared.',
        fix: 'Submit the design URL alongside the mockups so fidelity is checked too.'
      })
    }
    const blocking = findings.filter(f => f.severity === 'block')
    placement = {
      ok: blocking.length === 0,
      summary: blocking.length ? blocking[0].issue : 'Print is centred, correctly sized, and matches the source artwork.',
      findings,
      measured: { placement: input.placement ?? null, size_inches: input.printSizeInches ?? null, fidelity_checked: Boolean(fidelity) }
    }
  }

  // --- typography ----------------------------------------------------------
  let typography: CriterionVerdict
  if (!primary) {
    typography = {
      ok: false,
      summary: 'No photo to judge typography on.',
      findings: [{ severity: 'block', issue: 'There is no product photo, so typography legibility cannot be reviewed.', fix: 'Render the mockups first.' }],
      measured: {}
    }
  } else if (!vision) {
    typography = unverifiedVerdict('Typography legibility')
  } else if (!vision.hasText) {
    typography = { ok: true, summary: 'The design has no text.', findings: [], measured: { has_text: false } }
  } else if (!vision.typographyOk) {
    typography = {
      ok: false,
      summary: vision.typographyIssue || 'The text in the design is not clearly legible.',
      findings: [{
        severity: 'block',
        issue: vision.typographyIssue || 'The text in the design is not clearly legible.',
        fix: 'Re-render so every word is crisp and high-contrast against the garment. Broken or smeared lettering is the single most obvious tell of a bad print.',
        evidence: { url: primary }
      }],
      measured: { has_text: true }
    }
  } else {
    typography = { ok: true, summary: 'Text in the design is crisp and readable.', findings: [], measured: { has_text: true } }
  }

  const criteria: Record<CriterionId, CriterionVerdict> = {
    mockup_quality: mockupQuality,
    design_placement: placement,
    typography,
    seo,
    pricing,
    image_sharpness: sharpness
  }

  const rework: ReworkItem[] = []
  let score = 0
  for (const id of CRITERIA) {
    const verdict = criteria[id]
    for (const f of verdict.findings) rework.push({ criterion: id, ...f })
    // A criterion with warnings but no blocker keeps most of its weight — the
    // score has to be able to tell "clean pass" from "scraped through".
    if (verdict.ok) score += verdict.findings.length ? SCORE_WEIGHTS[id] * 0.7 : SCORE_WEIGHTS[id]
  }
  // Blocking findings sort first — a designer reading the feed works top-down.
  rework.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1))

  const blockingCount = rework.filter(f => f.severity === 'block').length
  return {
    status: blockingCount === 0 ? 'passed' : 'failed',
    score: Math.round(score),
    criteria,
    rework,
    blockingCount,
    warningCount: rework.length - blockingCount,
    model: openai ? VISION_MODEL : 'deterministic-only',
    durationMs: Date.now() - started
  }
}
