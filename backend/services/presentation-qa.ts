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
import { measureImages, measureOpacity, type ImageMetricsResult, type OpacityResult } from './image-metrics.js'
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
  'print_background',
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
// SHOT COVERAGE — "are these the RIGHT photos", not just "are there enough".
//
// The renderer writes every mockup to mockups/{slug}/{template}/{file}
// (ai-jobs-worker.ts), so the shot type is recoverable from the URL without a
// schema change or a second vision call. Hyphenated and underscored spellings
// both occur in live paths ('ghost-mannequin' and 'ghost_mannequin'), so the
// parser normalises before comparing.
// ---------------------------------------------------------------------------
export const ON_BODY_TEMPLATES = new Set(['ghost_mannequin', 'mr_imagine', 'lifestyle', 'model'])
/** Below this many DISTINCT shot types a garment listing looks thin. */
export const MIN_DISTINCT_SHOTS = Number(process.env.QA_MIN_DISTINCT_SHOTS || 2)

/**
 * True when a URL is a RENDER of the product rather than the artwork that goes
 * to the printer. Load-bearing: on most live products images[0] is a
 * ghost-mannequin shot, and measuring a photograph of a shirt as if it were the
 * design blocks it for having an opaque background — which every photo has.
 */
export const looksLikeRender = (url: string | null | undefined): boolean => {
  const u = String(url ?? '')
  return /\/mockups?\//i.test(u) || /\bmockup[-_]?\d*\.[a-z]+/i.test(u)
}

export function shotTemplatesFrom(urls: string[]): string[] {
  const out: string[] = []
  for (const u of urls) {
    const m = /\/mockups\/[^/]+\/([^/]+)\//.exec(String(u))
    if (m) out.push(m[1].replace(/-/g, '_').toLowerCase())
  }
  return out
}

// ---------------------------------------------------------------------------
// PRINT BACKGROUND — measured, like everything else in this file.
//
// A garment print is artwork with dead air around it. A poster is a rectangle.
// The border ring separates them: art meant for a tee leaves its edges empty,
// an opaque render fills them. MEASURED on five real designs, 2026-08-19:
//   bass badge      painted checkerboard  opaqueBorder 1.00  transparent 0.00
//   vet-tech cat    painted checkerboard  opaqueBorder 1.00  transparent 0.00
//   trail-runner v1 opaque sky            opaqueBorder 1.00  transparent 0.00
//   trail-runner v2 real alpha            opaqueBorder 0.41  transparent 0.50
//   trail-runner v3 real alpha            opaqueBorder 0.02  transparent 0.23
// Nothing real lands between 0.41 and 1.00, so 0.9 cannot fail a design with
// genuine dead air and cannot pass a solid rectangle. Worth stating plainly:
// THREE OF THESE FIVE were unprintable, and two of the three were the ones that
// looked best on screen — a painted checkerboard fools the eye completely.
// ---------------------------------------------------------------------------
export const BLOCK_OPAQUE_BORDER = Number(process.env.QA_BLOCK_OPAQUE_BORDER || 0.9)
export const WARN_OPAQUE_BORDER = Number(process.env.QA_WARN_OPAQUE_BORDER || 0.5)
/** A design this see-through has real dead air, whatever its border reads. */
export const MIN_TRANSPARENT_FRACTION = Number(process.env.QA_MIN_TRANSPARENT_FRACTION || 0.02)
/** Border ring this pale, on a file ALREADY judged opaque, means a white/light
 *  plate behind otherwise good art rather than a full-bleed scene. MEASURED:
 *    lion DTF white plate     borderMeanLuma 255.0  -> strip the background
 *    trail-runner full-bleed  borderMeanLuma 114.8  -> re-brief the design
 *  (A transparent emblem also reads 251.5, but never reaches this branch — it
 *  is only consulted once opaqueBorderFraction and transparentFraction have
 *  already established there is no dead air at all.) */
export const LIGHT_PLATE_LUMA = Number(process.env.QA_LIGHT_PLATE_LUMA || 200)

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
export function checkMockupQuality(
  metrics: ImageMetricsResult[],
  urlCount: number,
  shotTemplates: string[] = [],
  garment = true
): CriterionVerdict {
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

  // Shot COVERAGE. Only judged when every photo could be classified: a mixed
  // set (etsy_shots URLs, a hand-uploaded image) would otherwise be graded on
  // the subset that happens to sit under a recognisable path, and a listing
  // could be blocked for a flat-lay-only set it does not actually have.
  const classified = urlCount > 0 && shotTemplates.length === urlCount
  const distinctShots = [...new Set(shotTemplates)]
  if (garment && classified) {
    const onBody = distinctShots.filter(t => ON_BODY_TEMPLATES.has(t))
    if (!onBody.length) {
      findings.push({
        severity: 'block',
        issue: `No on-body photo — all ${urlCount} shot(s) are ${distinctShots.join(', ')}.`,
        fix: 'Render at least one ghost-mannequin or on-model shot. A garment listing with no on-body photo leaves the shopper guessing at fit and drape.',
        evidence: { shot_templates: distinctShots, on_body_templates: [...ON_BODY_TEMPLATES] }
      })
    } else if (distinctShots.length < MIN_DISTINCT_SHOTS) {
      findings.push({
        severity: 'warn',
        issue: `Every photo is the same kind of shot (${distinctShots.join(', ')}).`,
        fix: `Add a different angle — a flat-lay next to an on-body shot reads as a real product. ${MIN_DISTINCT_SHOTS}+ distinct shot types is the target.`,
        evidence: { shot_templates: distinctShots }
      })
    }
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
      resolutions: readable.map(m => `${m.width}x${m.height}`),
      shot_templates: distinctShots,
      shots_classified: classified
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
// (g) PRINT BACKGROUND — did the background actually come off?
//
// Two independent reads, because each catches what the other misses. The alpha
// measurement is objective and free but only sees the SOURCE file, so it cannot
// catch a renderer compositing the art onto a panel. The vision read sees the
// finished garment but is a judgement call. Either one is enough to block.
//
// Deliberately skipped for non-garments (a metal panel IS a rectangle) and for
// all-over prints (full-bleed is the point), reusing the same exemption the
// coverage checker uses so the two cannot disagree.
// ---------------------------------------------------------------------------
export function checkPrintBackground(
  opacity: OpacityResult | null,
  vision: VisionRead | null,
  garment: boolean,
  placement?: string | null
): CriterionVerdict {
  if (!garment) {
    return {
      ok: true,
      summary: 'Not a printed garment — there is no background to strip.',
      findings: [],
      measured: { applicable: false }
    }
  }
  if (coverageIsExempt(placement)) {
    return {
      ok: true,
      summary: 'All-over print — full-bleed artwork is intentional here.',
      findings: [],
      measured: { applicable: false, placement: placement ?? null }
    }
  }

  const findings: Finding[] = []
  const measured: Record<string, unknown> = {}

  // Defence in depth: even if the caller hands over a render, never grade it as
  // artwork. A photograph of a shirt is opaque by definition.
  if (opacity?.ok && looksLikeRender(opacity.url)) {
    measured.artwork_resolved = false
    findings.push({
      severity: 'warn',
      issue: 'The URL supplied as the source artwork is a product render, not the design file, so the print background could not be measured.',
      fix: 'Attach the design as a product_asset of kind dtf, nobg or source so the gate can measure what actually goes to the printer.',
      evidence: { url: opacity.url }
    })
  } else if (opacity?.ok) {
    measured.has_alpha_channel = opacity.hasAlphaChannel
    measured.transparent_fraction = opacity.transparentFraction
    measured.opaque_border_fraction = opacity.opaqueBorderFraction

    measured.checkerboard_background = opacity.checkerboardBackground
    measured.border_pattern = opacity.borderPattern

    const solidBorder = opacity.opaqueBorderFraction >= BLOCK_OPAQUE_BORDER
    const noDeadAir = opacity.transparentFraction < MIN_TRANSPARENT_FRACTION
    if (opacity.checkerboardBackground) {
      // Called out separately because it is the most deceptive failure in the
      // set: the file LOOKS transparent to a human and to a vision model, the
      // generative mockup renderer quietly drops it, and the defect only shows
      // up on the transfer the customer receives.
      findings.push({
        severity: 'block',
        issue: 'The artwork has a PAINTED checkerboard background — it looks transparent on screen but every pixel is solid ink, and it would print as a grey-and-white chequered block.',
        fix: 'The image model faked transparency instead of emitting an alpha channel. Run the design through background removal (replicate_rembg) and re-render the mockups from the resulting transparent PNG.',
        evidence: { url: opacity.url, border_pattern: opacity.borderPattern, has_alpha_channel: opacity.hasAlphaChannel }
      })
    } else if (solidBorder && noDeadAir) {
      // Two different defects wear the same measurement, and they need
      // different fixes: art that is FINE but sits on a solid white plate just
      // needs the background stripped; a full-bleed scene has no background to
      // strip and needs re-briefing. A pale, even border ring tells them apart.
      const lightPlate = opacity.borderMeanLuma >= LIGHT_PLATE_LUMA
      findings.push({
        severity: 'block',
        issue: lightPlate
          ? `The artwork sits on a solid light background (border luminance ${Math.round(opacity.borderMeanLuma)}/255, ${Math.round(opacity.opaqueBorderFraction * 100)}% opaque), so it prints as a pale rectangle around the design on any garment that is not the same colour.`
          : opacity.hasAlphaChannel
            ? `The artwork has no transparent area — ${Math.round(opacity.opaqueBorderFraction * 100)}% of its outer edge is solid ink, so it prints as a rectangle on the garment.`
            : 'The artwork file has no alpha channel at all, so it can only print as a solid rectangle on the garment.',
        fix: lightPlate
          ? 'The design itself is fine — strip the background. Run it through background removal (replicate_rembg) and re-render the mockups from the resulting transparent PNG.'
          : 'There is no background to strip here: the artwork fills the frame. Re-brief it as a CONTAINED subject — a badge, an emblem, an isolated character — which comes back with dead air around it. A full-bleed scene never can.',
        evidence: {
          url: opacity.url,
          opaque_border_fraction: opacity.opaqueBorderFraction,
          transparent_fraction: opacity.transparentFraction,
          border_mean_luma: opacity.borderMeanLuma,
          has_alpha_channel: opacity.hasAlphaChannel
        }
      })
    } else if (opacity.opaqueBorderFraction >= WARN_OPAQUE_BORDER) {
      findings.push({
        severity: 'warn',
        issue: `${Math.round(opacity.opaqueBorderFraction * 100)}% of the artwork's outer edge is solid, so the print will reach the edge of its area on at least one side.`,
        fix: 'Check the design is meant to bleed that far. If not, re-run background removal or add margin.',
        evidence: { url: opacity.url, opaque_border_fraction: opacity.opaqueBorderFraction }
      })
    }
  } else if (opacity && !opacity.ok) {
    findings.push({
      severity: 'warn',
      issue: `The source artwork could not be opened to measure its background (${opacity.error}).`,
      fix: 'Check the design URL resolves. Without it this criterion rests on the vision read alone.',
      evidence: { url: opacity.url }
    })
  } else {
    findings.push({
      severity: 'warn',
      issue: 'No source artwork was supplied, so the background could not be measured directly.',
      fix: 'Submit the design URL alongside the mockups.'
    })
  }

  if (vision?.backgroundPanel) {
    findings.push({
      severity: 'block',
      issue: vision.backgroundIssue || 'The design sits inside a visible block of background colour instead of printing straight onto the garment.',
      fix: 'Strip the background and re-render. A panel or halo around the art is the single clearest tell of a cheap print-on-demand listing.',
      evidence: { source: 'vision' }
    })
  }
  if (vision && !vision.printOnFabric) {
    findings.push({
      severity: 'block',
      issue: vision.fabricIssue || 'The print does not sit in the fabric — it reads as a sticker laid on top of the garment.',
      fix: 'Re-render so the print follows the garment folds and drape, with no hard cut edge where it meets the fabric.',
      evidence: { source: 'vision' }
    })
  }

  // Fail-closed: with neither read available there is no evidence either way.
  if (!vision && !opacity?.ok) return unverifiedVerdict('The print background')

  measured.vision_checked = Boolean(vision)
  const blocking = findings.filter(f => f.severity === 'block')
  return {
    ok: blocking.length === 0,
    summary: blocking.length
      ? blocking[0].issue
      : 'The artwork prints onto the garment with the fabric showing through around it.',
    findings,
    measured
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
  /** The art sits inside a visible block of background colour. */
  backgroundPanel: boolean
  backgroundIssue: string
  /** The print reads as ink in the fabric rather than a sticker laid on top. */
  printOnFabric: boolean
  fabricIssue: string
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
                '3. TYPOGRAPHY — if the printed design contains words, is every word crisp and readable at a ' +
                'glance? Set typographyOk to false for letters that are broken, smeared, warped into nonsense, ' +
                'colliding, or so low-contrast against the garment that they disappear. Set hasText to false and ' +
                'typographyOk to true when the design has no words at all.\n\n' +
                '4. BACKGROUND — the artwork should be printed straight onto the garment, with the fabric ' +
                'showing through everywhere the art is not. Set backgroundPanel to true if the design sits ' +
                'inside a visible block of background colour that is not the garment: a rectangular or square ' +
                'panel, a photo pasted onto the chest, a hard sticker edge, or a pale halo tracing a box ' +
                'around the art. Judge the BACKGROUND BEHIND the art, not the shape of the art itself — a ' +
                'design that IS a circle, a badge or an emblem is fine. Set printOnFabric to false if the ' +
                'print does not follow the fabric folds and drape, or meets the garment with a hard cut ' +
                'edge.\n\n' +
                'Respond in JSON: {"realistic": bool, "realismIssue": string, "centered": bool, ' +
                '"placementIssue": string, "hasText": bool, "typographyOk": bool, "typographyIssue": string, ' +
                '"backgroundPanel": bool, "backgroundIssue": string, "printOnFabric": bool, ' +
                '"fabricIssue": string}. ' +
                'Each issue string is one short sentence naming the single worst defect, or an empty string when ' +
                'that point passes.'
            },
            { type: 'image_url', image_url: { url: mockupUrl, detail: 'high' } }
          ]
        }
      ],
      ...(isReasoningModel(VISION_MODEL) ? { max_completion_tokens: 1100 } : { max_tokens: 550, temperature: 0 }),
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
      typographyIssue: clean(parsed?.typographyIssue).slice(0, 200),
      backgroundPanel: parsed?.backgroundPanel === true,
      backgroundIssue: clean(parsed?.backgroundIssue).slice(0, 200),
      printOnFabric: parsed?.printOnFabric !== false,
      fabricIssue: clean(parsed?.fabricIssue).slice(0, 200)
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
  mockup_quality: 18,
  design_placement: 18,
  print_background: 12,
  typography: 12,
  seo: 18,
  pricing: 9,
  image_sharpness: 13
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

  const [metrics, vision, fidelity, opacity] = await Promise.all([
    measureImages(urls),
    primary ? readPresentation(primary, input.placement, garment) : Promise.resolve(null),
    primary && input.designUrl
      ? checkMockup(input.designUrl, primary, placementForCoverage, input.printSizeInches)
      : Promise.resolve(null),
    // The SOURCE artwork, not a mockup — this asks whether the file that goes to
    // the printer has a background, which no render of it can answer.
    input.designUrl ? measureOpacity(input.designUrl) : Promise.resolve(null)
  ])

  const mockupQuality = checkMockupQuality(metrics, urls.length, shotTemplatesFrom(urls), garment)
  const sharpness = checkSharpness(metrics)
  const seo = checkSeo(input)
  const pricing = checkPricing(input)
  const printBackground = checkPrintBackground(opacity, vision, garment, input.placement)

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
    print_background: printBackground,
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
