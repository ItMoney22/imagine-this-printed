// ---------------------------------------------------------------------------
// What is this product? — ONE answer for the Etsy pipeline (task 28ab467c).
//
// Before this module the kind was guessed four ways: etsy-copy-repair's
// `kindOf`, the composer's `isHoodieProduct`, the approval route's template
// sniff (which wrote 'shirts' for anything it did not recognise), and the Etsy
// taxonomy's category-only lookup. Each guess was a regex or a default, and a
// wrong one lists a hoodie under T-shirts, writes tee copy for a 3D figurine,
// or blocks the listing at Etsy's taxonomy check.
//
// The order of authority, fixed here so every caller agrees (David 2026-09-23):
//   1. ADMIN — a category the admin picked (the wizard's AUTHORITATIVE slug,
//      ai-product.ts, stamped `metadata.category_source = 'admin'`), the garment
//      approved in the Step Flow, or a Step Flow metal brief. Used
//      unconditionally; Jev is not even asked.
//   2. JEV — a multi-option choice over the product's WORDS (services/
//      product-kind-jev.ts), only when PRODUCT_KIND_JEV=on and only above the
//      confidence bar, and only when it agrees with the category column (or
//      there is no category to agree with).
//   3. FLOOR — the old deterministic heuristics, kept exactly as they were so
//      a Jev outage changes nothing (fail open).
//   Anything that cannot be decided — no signal at all, or Jev unsure about an
//   ambiguous row, or Jev confidently contradicting the category — is flagged
//   `needsReview` for a human. It is NEVER defaulted to shirts.
//
// Pure: no network, no env, no database. Imported by backend/shared/etsy-tiers
// and therefore by the storefront bundle too, so keep it browser-safe.
// (src/lib/product-kind.ts is the storefront's pricing/gallery helper — a
// different job that happens to share the name.)
// ---------------------------------------------------------------------------

export const PRODUCT_KINDS = ['hoodie', 'tee', 'youth_tee', 'metal', 'transfer', '3d', 'tumbler', 'other'] as const
export type ProductKind = typeof PRODUCT_KINDS[number]

export const isProductKind = (v: unknown): v is ProductKind =>
  typeof v === 'string' && (PRODUCT_KINDS as readonly string[]).includes(v)

/**
 * Jev's options, each with a written description (David's rule: never a bare
 * list of keys, never yes/no). Each one says what IS that kind and what only
 * LOOKS like it, because the classic misroute is the artwork's subject (a
 * hooded figure, a coffee mug drawn on a tee) being read as the product.
 */
export const PRODUCT_KIND_CRITERIA: Record<ProductKind, string> = {
  hoodie:
    'A hooded sweatshirt or pullover sweatshirt is the item being sold, with the design printed on it: hoodie, ' +
    'hooded sweatshirt, pullover, crewneck sweatshirt, "hoodie back design". A T-shirt whose artwork merely shows ' +
    'a hooded figure is NOT a hoodie.',
  tee:
    'An adult short-sleeve T-shirt is the item being sold, with the design printed on it: t-shirt, tee, graphic ' +
    'tee, unisex shirt, "shirt design". Includes tees ABOUT kids or family ("proud dad", "mama") that adults wear.',
  youth_tee:
    'A T-shirt made for a CHILD to wear, sold in youth or kids sizes: kids tee, youth shirt, boys or girls tee, ' +
    'toddler or school-age shirt, "for kids". An adult tee that only mentions kids is NOT this.',
  metal:
    'A metal wall-art print: a design dye-sublimated onto an aluminum or metal panel that hangs on a wall or ' +
    'sits on a shelf — metal print, metal panel, wall art, wall decor, metal sign. No garment involved.',
  transfer:
    'A DTF heat-transfer film sold on its own for the buyer to press onto their own clothing: DTF transfer, heat ' +
    'transfer, ready to press, iron-on, gang sheet. No garment is included in the sale.',
  '3d':
    'A physical 3D-printed object: figurine, figure, statue, toy, miniature, bust, keychain, desk or shelf piece ' +
    'made on a 3D printer, or the 3D model for one.',
  tumbler:
    'Drinkware with the design on it: tumbler, insulated cup, travel mug, coffee mug, water bottle. A shirt whose ' +
    'artwork shows a mug or a cup is NOT this.',
  other:
    'Some other item that is none of the above: a polo or tank top, hat, sticker, tote bag, poster, canvas, phone ' +
    'case, or a printable template or service. Only when the words name a different item.',
}

export const PRODUCT_KIND_INSTRUCTIONS =
  'What physical item is the customer buying — the thing this design is printed on or sold as? Judge from the ' +
  "product's own words (name, idea, description, keywords). The artwork's SUBJECT never decides it: a tee with a " +
  'drawing of a mug is a tee, a tee with a hooded reaper is a tee.'

// --- kind <-> ITP category slug --------------------------------------------

/** The ITP category a kind is filed under. A youth tee lives under shirts (it
 *  is the same listing family; see catalog-capability's youth cut). `other`
 *  has no category, so it can never be routed to a taxonomy by itself. */
export const KIND_CATEGORY: Record<ProductKind, string | null> = {
  hoodie: 'hoodies',
  tee: 'shirts',
  youth_tee: 'shirts',
  metal: 'metal-art',
  transfer: 'dtf-transfers',
  '3d': '3d-prints',
  tumbler: 'tumblers',
  other: null,
}

const CATEGORY_KIND: Record<string, ProductKind> = {
  shirts: 'tee',
  't-shirts': 'tee',
  hoodies: 'hoodie',
  'metal-art': 'metal',
  'dtf-transfers': 'transfer',
  '3d-prints': '3d',
  tumblers: 'tumbler',
}

export const categoryForKind = (kind: ProductKind | null | undefined): string | null =>
  kind ? KIND_CATEGORY[kind] : null

export const kindForCategory = (category: unknown): ProductKind | null =>
  CATEGORY_KIND[String(category ?? '').trim()] ?? null

/** A garment / product_type string → kind. Youth first: 'youth tshirt' also
 *  contains 'tshirt' (same trap catalog-capability's normalizeGarment avoids). */
export function kindForGarmentValue(value: unknown): ProductKind | null {
  if (typeof value !== 'string') return null
  const v = value.toLowerCase().trim()
  if (!v) return null
  if (/youth|kids?\b|toddler/.test(v)) return 'youth_tee'
  if (/hoodie|sweatshirt|hooded/.test(v)) return 'hoodie'
  if (/metal/.test(v)) return 'metal'
  if (/polo|tank/.test(v)) return 'other'
  if (/^(t-?shirts?|tee|tees|shirts?)$/.test(v)) return 'tee'
  return null
}

/** The approval route's old template sniff, kept as a floor signal — but an
 *  unrecognised template is now NO signal instead of "apparel, so shirts". */
export function kindForTemplate(value: unknown): ProductKind | null {
  if (typeof value !== 'string') return null
  const v = value.toLowerCase().trim()
  if (!v) return null
  const byCategory = kindForCategory(v)
  if (byCategory) return byCategory
  if (v.includes('metal') || v.includes('wall')) return 'metal'
  if (v.includes('3d') || v.includes('toy')) return '3d'
  return kindForGarmentValue(v)
}

/** Word-bounded on purpose (from isHoodieProduct): a TEE whose design mentions
 *  a hooded figure is still a tee. */
const HOODIE_NAME = /\bhoodie\b|\bsweatshirt\b/i

// --- inputs -----------------------------------------------------------------

export interface ProductKindInput {
  category?: unknown
  name?: unknown
  metadata?: any
}

/** Where a category came from, stamped on metadata.category_source by the
 *  create paths: 'admin' = the admin picked it (authoritative), 'default' = a
 *  fallback filled it in (a guess, not evidence). Absent on legacy rows. */
export type CategorySource = 'admin' | 'default'

const garmentOf = (metadata: any): unknown => {
  const g = metadata?.step_flow?.garment ?? metadata?.garment
  return typeof g === 'string' ? g : null
}

// --- 1. admin ---------------------------------------------------------------

export interface AdminKind {
  kind: ProductKind
  basis: string
}

/**
 * The kind an ADMIN explicitly set, or null. Unconditional when present —
 * nothing downstream (Jev, heuristics) may override it.
 */
export function adminKindOf(product: ProductKindInput): AdminKind | null {
  const md = product.metadata ?? {}
  const sf = md.step_flow
  // A Step Flow metal brief beats everything else at creation too
  // (routes/admin/ai-products.ts, design doc §14).
  if (sf?.brief?.productKind === 'metal') return { kind: 'metal', basis: 'Step Flow metal brief' }
  // The garment the admin approved on the Step Flow's Garments step. That
  // route also writes the category, so the two agree by construction.
  if (sf?.approvals?.garments && typeof sf.garment === 'string') {
    const kind = kindForGarmentValue(sf.garment)
    if (kind) return { kind, basis: `garment picked in the Step Flow (${sf.garment})` }
  }
  if (md.category_source === 'admin') {
    const kind = kindForCategory(product.category)
    if (kind) {
      // A youth tee files under shirts; the garment says which cut.
      const refined = kind === 'tee' && kindForGarmentValue(garmentOf(md)) === 'youth_tee' ? 'youth_tee' : kind
      return { kind: refined, basis: `category picked by the admin (${String(product.category)})` }
    }
  }
  return null
}

// --- 3. the deterministic floor ---------------------------------------------

export interface KindSignal {
  field: string
  kind: ProductKind
  /** A value that is often a create-path default rather than evidence. */
  weak?: boolean
}

export interface ProductKindFloor {
  /** What the old heuristics pick — the fail-open answer. Null = nothing on
   *  the product says what it is (formerly: "so, shirts"). */
  kind: ProductKind | null
  /** Which field decided `kind`, in plain words. */
  basis: string
  /** The category column's kind, when the column is a known slug that was not
   *  filled in by a default. */
  categoryKind: ProductKind | null
  /** Every field that suggested a kind. */
  signals: KindSignal[]
  /** Strong signals disagree with each other, or a weak one overrode a strong one. */
  conflict: boolean
}

/**
 * The old heuristics, in their old order, so a Jev outage changes nothing:
 *   category metal-art / dtf-transfers / hoodies / 3d-prints / tumblers → that kind;
 *   shirts → hoodie when the garment or a word-bounded name says so (kindOf +
 *   isHoodieProduct), youth when the garment says so, else tee;
 *   no category → product_type / garment, then the approval route's template
 *   sniff, then the hoodie name match; nothing → null.
 * Deliberate departure: a non-apparel category is never overridden by the
 * hoodie NAME match (old kindOf turned a 3d-prints "Hoodie Bear" into a hoodie).
 */
export function floorKindOf(product: ProductKindInput): ProductKindFloor {
  const md = product.metadata ?? {}
  const signals: KindSignal[] = []
  const push = (field: string, kind: ProductKind | null, weak = false) => {
    if (kind) signals.push({ field, kind, ...(weak ? { weak } : {}) })
  }

  const rawCategory = String(product.category ?? '').trim()
  const columnKind = kindForCategory(rawCategory)
  const defaulted = md.category_source === 'default'
  push('category', columnKind, defaulted)
  push('step_flow.garment', kindForGarmentValue(md.step_flow?.garment))
  // 'tshirt' is the AI wizard's request default (productType || 'tshirt'), so
  // on its own it is not evidence of anything.
  const productType = kindForGarmentValue(md.product_type)
  push('product_type', productType, productType === 'tee')
  if (typeof md.garment === 'string') push('garment', kindForGarmentValue(md.garment))
  if (md.step_flow?.brief?.productKind === 'metal') push('step_flow.brief', 'metal')
  push('product_template', kindForTemplate(md.product_template))
  push('metadata.category', kindForTemplate(md.category))
  const nameSaysHoodie = HOODIE_NAME.test(String(product.name ?? ''))
  push('name', nameSaysHoodie ? 'hoodie' : null, true)

  const garmentKind = kindForGarmentValue(garmentOf(md))
  let kind: ProductKind | null = null
  let basis = 'nothing on the product says what it is'
  if (columnKind && columnKind !== 'tee') {
    kind = columnKind
    basis = `category ${rawCategory}`
  } else if (columnKind === 'tee') {
    if (garmentKind === 'hoodie') { kind = 'hoodie'; basis = 'garment says hoodie' }
    else if (nameSaysHoodie) { kind = 'hoodie'; basis = 'name says hoodie' }
    else if (garmentKind === 'youth_tee' || productType === 'youth_tee') { kind = 'youth_tee'; basis = 'garment says youth tee' }
    else { kind = 'tee'; basis = `category ${rawCategory}` }
  } else {
    const structured =
      garmentKind ? { kind: garmentKind, basis: 'garment' }
      : productType ? { kind: productType, basis: 'product_type' }
      : kindForTemplate(md.product_template) ? { kind: kindForTemplate(md.product_template)!, basis: 'product template' }
      : kindForTemplate(md.category) ? { kind: kindForTemplate(md.category)!, basis: 'submitted category' }
      : md.step_flow?.brief?.productKind === 'metal' ? { kind: 'metal' as ProductKind, basis: 'Step Flow metal brief' }
      : nameSaysHoodie ? { kind: 'hoodie' as ProductKind, basis: 'name says hoodie' }
      : null
    if (structured) { kind = structured.kind; basis = structured.basis }
  }

  const strong = signals.filter(s => !s.weak)
  const strongKinds = new Set(strong.map(s => s.kind))
  // A youth tee is a cut of the tee, not a different product family.
  if (strongKinds.has('youth_tee')) strongKinds.delete('tee')
  const decidedByWeak = kind !== null && !strong.some(s => s.kind === kind) && strong.length > 0
  return {
    kind,
    basis,
    categoryKind: defaulted ? null : columnKind,
    signals,
    conflict: strongKinds.size > 1 || decidedByWeak,
  }
}

// --- the decision -----------------------------------------------------------

export type ProductKindMode = 'off' | 'shadow' | 'on'

/** Jev's bar. Set by what a wrong answer costs: a wrong kind lists the
 *  product under the wrong Etsy category and writes the wrong copy, which is
 *  "skipping a safety check" territory (~0.85 in the jev-decisions skill), not
 *  the cheap-to-be-wrong 0.75. Measured on the live catalog — see
 *  docs/reports/jev-product-kind-dryrun-*.md. */
export const PRODUCT_KIND_MIN_CONFIDENCE = 0.85

export interface JevKindRead {
  choice: ProductKind
  confidence: number
}

export type JevKindStatus = 'accepted' | 'low-confidence' | 'disagrees' | 'unavailable' | 'not-asked'

export interface ProductKindDecision {
  /** The kind every caller should use. Null only when nothing says what it is. */
  kind: ProductKind | null
  source: 'admin' | 'jev' | 'floor' | 'none'
  /** A human must confirm the kind before it is listed. Never "so, shirts". */
  needsReview: boolean
  /** Plain words: why this kind, or why it needs a look. */
  note: string
  floor: ProductKindFloor
  jev: { status: JevKindStatus; choice?: ProductKind; confidence?: number }
  mode: ProductKindMode
}

const pct = (c: number) => `${Math.round(c * 100)}%`

/**
 * Turn the floor, the admin's pick and Jev's answer into one decision. Pure.
 *
 * `jevRead`: undefined = Jev was not asked (off, admin-set, or no words);
 * null = asked but no usable answer (outage, off-menu) — the caller FAILS OPEN.
 *
 * Shadow and off never change behaviour: the floor decides, exactly as the old
 * heuristics did, and only a product with no signal at all is flagged.
 * With 'on', Jev decides only where it is sure AND agrees with the category
 * column (or there is no category); a confident contradiction, or an unsure
 * answer on an ambiguous row, goes to a human with the floor's answer held
 * provisionally.
 */
export function decideProductKind(
  product: ProductKindInput,
  jevRead: JevKindRead | null | undefined,
  mode: ProductKindMode,
  minConfidence: number = PRODUCT_KIND_MIN_CONFIDENCE
): ProductKindDecision {
  const floor = floorKindOf(product)
  const jevBase = jevRead
    ? { choice: jevRead.choice, confidence: jevRead.confidence }
    : {}

  const admin = adminKindOf(product)
  if (admin) {
    return {
      kind: admin.kind,
      source: 'admin',
      needsReview: false,
      note: `Set by the admin: ${admin.basis}.`,
      floor,
      jev: { status: 'not-asked', ...jevBase },
      mode,
    }
  }

  const fromFloor = (status: JevKindStatus): ProductKindDecision =>
    floor.kind
      ? { kind: floor.kind, source: 'floor', needsReview: false, note: `Read from the product's own fields (${floor.basis}).`, floor, jev: { status, ...jevBase }, mode }
      : {
          kind: null,
          source: 'none',
          needsReview: true,
          note: 'Nothing on this product says what it is (no category, garment or template) — pick its category.',
          floor,
          jev: { status, ...jevBase },
          mode,
        }

  if (jevRead === undefined) return fromFloor('not-asked')
  if (jevRead === null) return fromFloor('unavailable')

  const confident = jevRead.confidence >= minConfidence
  const status: JevKindStatus = !confident
    ? 'low-confidence'
    : jevAgrees(jevRead.choice, floor) ? 'accepted' : 'disagrees'

  // Shadow/off: measured only.
  if (mode !== 'on') return fromFloor(status)

  const review = (note: string): ProductKindDecision => ({
    kind: floor.kind,
    source: floor.kind ? 'floor' : 'none',
    needsReview: true,
    note,
    floor,
    jev: { status, ...jevBase },
    mode,
  })

  if (status === 'accepted') {
    return {
      kind: jevRead.choice,
      source: 'jev',
      needsReview: false,
      note: `Jev read it as ${jevRead.choice} (${pct(jevRead.confidence)} sure)${floor.kind ? `, matching ${floor.basis}` : ''}.`,
      floor,
      jev: { status, ...jevBase },
      mode,
    }
  }
  if (status === 'disagrees') {
    const said = floor.categoryKind ? `the category says ${floor.categoryKind}` : `the product's fields say ${floor.kind}`
    return review(`Jev reads this as ${jevRead.choice} (${pct(jevRead.confidence)} sure) but ${said} — check it and set the category.`)
  }
  // Unsure: a clean floor still decides — it is the product's own data, not a guess.
  if (floor.kind && !floor.conflict && floor.categoryKind) return fromFloor(status)
  return review(
    floor.kind
      ? `Not sure what this is: ${floor.conflict ? 'its fields disagree' : `only ${floor.basis} says ${floor.kind}`} and Jev was only ${pct(jevRead.confidence)} sure (${jevRead.choice}).`
      : `Nothing on this product says what it is and Jev was only ${pct(jevRead.confidence)} sure (${jevRead.choice}) — pick its category.`
  )
}

/**
 * Does a confident Jev answer fit the floor? It must match the category
 * column when there is one (Jev never re-files a product against its
 * category); with no trustworthy category it must be one of the kinds the
 * product's own fields suggest, or the fields must suggest nothing.
 */
function jevAgrees(choice: ProductKind, floor: ProductKindFloor): boolean {
  const same = (a: ProductKind | null, b: ProductKind) =>
    a === b || (a === 'tee' && b === 'youth_tee') || (a === 'youth_tee' && b === 'tee')
  if (floor.categoryKind) {
    // A youth tee files under shirts, so it agrees with a shirts category —
    // but only exactly when nothing else on the row says otherwise.
    if (floor.categoryKind === 'tee' && choice === 'youth_tee') return true
    return floor.categoryKind === choice
  }
  if (!floor.signals.length) return true
  return floor.signals.some(s => same(s.kind, choice))
}

// --- the stamp ----------------------------------------------------------------

/** What gets written to products.metadata.product_kind so synchronous readers
 *  (the publisher's taxonomy, the anchor price) see the same decision. */
export interface ProductKindStamp {
  kind: ProductKind | null
  source: ProductKindDecision['source']
  needs_review: boolean
  note: string
  /** The category column the decision was made against. A stamp whose
   *  category no longer matches the row is stale and ignored — so an admin
   *  fixing the category clears a review by itself. */
  category: string | null
  mode: ProductKindMode
  jev_status: JevKindStatus
  jev_choice?: ProductKind
  jev_confidence?: number
  decided_at: string
}

export function toKindStamp(decision: ProductKindDecision, product: ProductKindInput, now = new Date()): ProductKindStamp {
  const category = String(product.category ?? '').trim()
  return {
    kind: decision.kind,
    source: decision.source,
    needs_review: decision.needsReview,
    note: decision.note,
    category: category || null,
    mode: decision.mode,
    jev_status: decision.jev.status,
    ...(decision.jev.choice ? { jev_choice: decision.jev.choice } : {}),
    ...(typeof decision.jev.confidence === 'number' ? { jev_confidence: Number(decision.jev.confidence.toFixed(4)) } : {}),
    decided_at: now.toISOString(),
  }
}

/** The stamp, if present and still about this row's category; else null. */
export function readKindStamp(product: ProductKindInput): ProductKindStamp | null {
  const s = product.metadata?.product_kind
  if (!s || typeof s !== 'object') return null
  if (s.kind !== null && !isProductKind(s.kind)) return null
  const category = String(product.category ?? '').trim() || null
  if ((s.category ?? null) !== category) return null
  return s as ProductKindStamp
}

/**
 * The kind a SYNCHRONOUS caller should use (anchor price, copy vocabulary):
 * the admin's pick, else a live stamp's kind, else the floor. Never a default.
 */
export function resolvedKindOf(product: ProductKindInput): ProductKind | null {
  const admin = adminKindOf(product)
  if (admin) return admin.kind
  const stamp = readKindStamp(product)
  if (stamp?.kind) return stamp.kind
  return floorKindOf(product).kind
}
