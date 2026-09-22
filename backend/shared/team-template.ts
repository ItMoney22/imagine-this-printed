// Team shirt personalization — the template contract.
//
// David 2026-09-21: "we need to add this design to our products but the
// customer should be able to edit the name and number that goes on the back
// ... the flow needs to be there for other team shirts we do since this isnt
// the only shirt we do for sports."
//
// A template turns one existing back design into a personalizable one: the
// fixed art (splatter, halftone, helmet) is stored once with the sample
// lettering erased, and the customer's name/number are drawn per order as real
// vector glyphs at full press resolution. See
// docs/plans/2026-09-21-team-shirt-personalization-design.md for why the
// per-order lettering is NOT an AI edit (short version: a 12x16in back at 300
// DPI is 3600x4800px, the gpt-image edit endpoint returns ~1024-1536px, and
// upscaling invented letterforms is exactly where a 9 stops being a 9).
//
// Lives in backend/shared/ — the established frontend/backend shared-code
// convention (metal-art.ts, catalog-capability.ts, product-gallery.ts) — so the
// product page, the admin authoring screen and the checkout route all read one
// definition instead of three that drift.
//
// NO MIGRATION: the template rides `products.metadata.team_template` (jsonb,
// already present) and its two image layers ride `product_assets`, whose `kind`
// column carries no CHECK constraint. The roles used
// (`team_plate_back` / `team_distress_back`) are deliberately absent from
// product-gallery.ts's ROLE_ORDER, which is a WHITELIST — so they are invisible
// to the storefront no matter what publishes the product, the same mechanism
// that already keeps the team-only halftoned print file away from customers.
//
// THIS MODULE HAS NO IMPORTS AND MUST KEEP IT THAT WAY. The storefront panel
// and the Step Flow both import it into the BROWSER bundle so that the box a
// customer types into sanitizes exactly the way the press file does. It used
// to import node:crypto for templateCacheKey(), which is why the frontend kept
// its own hand-copied sanitizer — and that copy had already drifted (it
// uppercased whenever `uppercase` was not explicitly false, while the server
// only uppercased when it was explicitly true, so a template that omitted the
// flag previewed in capitals and PRINTED in lower case). The cache key moved
// to services/team-plate/cache-key.ts and the duplicate is gone.

/** Bumped only for a breaking shape change. An unknown version is refused, never guessed at. */
export const TEAM_TEMPLATE_VERSION = 1

/**
 * Etsy truncates a listing's personalization_instructions at 255 characters,
 * so anything longer is cut on THEIR side, mid-word, in front of a buyer.
 * Cut it here instead, where the operator can see what fits.
 */
export const ETSY_INSTRUCTIONS_MAX = 255

export interface Zone {
  x: number
  y: number
  w: number
  h: number
}

export interface Stroke {
  /** Hex, e.g. '#F2E0BC'. Reaches an SVG attribute, so it is format-checked on parse. */
  color: string
  /** Visual outline width in canvas px. Doubled at render time — SVG centres strokes on the path. */
  w: number
}

export interface FontSpec {
  /** A HOUSE_FONTS id, or — when `src` is a URL — the display name of the uploaded face. */
  family: string
  /** 'house' for a bundled face, otherwise the GCS URL of an uploaded .ttf. */
  src: string
}

export interface TeamField {
  /** Stable identity: the key in the values map and in order_items.metadata.personalization. */
  key: string
  /** What the customer sees above the input. */
  label: string
  type: 'text' | 'number'
  /** Maximum characters AFTER sanitizing. */
  max: number
  /**
   * The greyed-out example inside the input box, on the product page, in the
   * Step Flow, and inside the instructions Etsy shows a buyer. Optional: a
   * template that predates this field falls back to defaultPlaceholder().
   */
  placeholder: string
  uppercase: boolean
  zone: Zone
  /** Total sweep in degrees from first glyph to last. 0 is a flat baseline. */
  arch: number
  font: FontSpec
  fill: string
  /** Outline passes, widest first — drawn behind the fill in this order. */
  strokes: Stroke[]
  /** Hard offset shadow (the gold ghost behind BEAR), or null for none. */
  offset: { dx: number; dy: number; color: string } | null
}

export interface TeamTemplate {
  version: number
  /** Which print side this personalizes. v1 ships back only; the mechanism is side-agnostic. */
  side: 'back_image' | 'front_image'
  /** product_assets row holding the art with the sample lettering erased. */
  plateAssetId: string
  /** product_assets row holding the grunge/halftone mask, or null for clean lettering. */
  distressAssetId: string | null
  canvas: { w: number; h: number; dpi: number }
  /** Whether this ART wants halftoning for the press — a property of the design, not the order. */
  halftone: boolean
  /** Dollars added per line for personalizing. */
  upcharge: number
  /**
   * What the buyer is told to type. Etsy gives a personalizable listing ONE
   * free-text box and one instruction line, so this is the only place a buyer
   * on that channel learns the shirt wants two values and what shape they take.
   * Null means "derive it from the fields" — see personalization-etsy.ts
   * etsyPersonalizationFields(), which is what actually reaches Etsy.
   */
  instructions: string | null
  fields: TeamField[]
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/
// The characters a surname actually uses. Everything else is dropped rather
// than rejected: a customer who pastes a stray character should get their name,
// not a form error.
const TEXT_ALLOWED_RE = /[^A-Za-z0-9 '-]/g

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** The example shown when a template does not carry its own placeholder. */
export function defaultPlaceholder(type: 'text' | 'number'): string {
  return type === 'number' ? '00' : 'LAST NAME'
}

function parseZone(raw: unknown, canvas: { w: number; h: number }): Zone | null {
  if (!raw || typeof raw !== 'object') return null
  const { x, y, w, h } = raw as Record<string, unknown>
  if (![x, y, w, h].every(isFiniteNumber)) return null
  const zone = { x: x as number, y: y as number, w: w as number, h: h as number }
  if (zone.w <= 0 || zone.h <= 0) return null
  // A zone that escapes the canvas would render text off the edge of the print
  // file — silently, since sharp happily composites outside the frame.
  if (zone.x < 0 || zone.y < 0) return null
  if (zone.x + zone.w > canvas.w || zone.y + zone.h > canvas.h) return null
  return zone
}

function parseStrokes(raw: unknown): Stroke[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null
  const out: Stroke[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const { color, w } = item as Record<string, unknown>
    if (typeof color !== 'string' || !HEX_RE.test(color)) return null
    if (!isFiniteNumber(w) || w <= 0) return null
    out.push({ color, w })
  }
  return out
}

function parseOffset(raw: unknown): TeamField['offset'] | null | undefined {
  if (raw == null) return null
  if (typeof raw !== 'object') return undefined
  const { dx, dy, color } = raw as Record<string, unknown>
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) return undefined
  if (typeof color !== 'string' || !HEX_RE.test(color)) return undefined
  return { dx, dy, color }
}

function parseField(raw: unknown, canvas: { w: number; h: number }): TeamField | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  if (typeof f.key !== 'string' || f.key.length === 0) return null
  if (f.type !== 'text' && f.type !== 'number') return null
  if (!isFiniteNumber(f.max) || f.max <= 0) return null
  if (typeof f.fill !== 'string' || !HEX_RE.test(f.fill)) return null

  const zone = parseZone(f.zone, canvas)
  if (!zone) return null

  const strokes = parseStrokes(f.strokes)
  if (!strokes) return null

  const offset = parseOffset(f.offset)
  if (offset === undefined) return null

  const font = f.font as Record<string, unknown> | undefined
  if (!font || typeof font.family !== 'string' || typeof font.src !== 'string') return null

  const label = typeof f.label === 'string' ? f.label : f.key
  return {
    key: f.key,
    label,
    type: f.type,
    max: f.max,
    // Plain text only, and short: it lands in an HTML placeholder attribute
    // and inside the instruction line Etsy renders above the buyer's box.
    placeholder:
      typeof f.placeholder === 'string' && f.placeholder.trim()
        ? f.placeholder.replace(/[\r\n]+/g, ' ').trim().slice(0, 40)
        : defaultPlaceholder(f.type as 'text' | 'number'),
    uppercase: f.uppercase === true,
    zone,
    arch: isFiniteNumber(f.arch) ? f.arch : 0,
    font: { family: font.family, src: font.src },
    fill: f.fill,
    strokes,
    offset,
  }
}

/**
 * Read a template out of a product's `metadata` (or accept a bare template).
 *
 * Returns null — never throws — for anything malformed. This runs on every
 * product page load, and a bad template must make the product sell as an
 * ordinary shirt rather than 500 the page.
 */
export function parseTeamTemplate(input: unknown): TeamTemplate | null {
  try {
    if (!input || typeof input !== 'object') return null
    const raw = ('team_template' in (input as Record<string, unknown>)
      ? (input as Record<string, unknown>).team_template
      : input) as Record<string, unknown> | null | undefined
    if (!raw || typeof raw !== 'object') return null

    if (raw.version !== TEAM_TEMPLATE_VERSION) return null
    if (raw.side !== 'back_image' && raw.side !== 'front_image') return null
    if (typeof raw.plateAssetId !== 'string' || raw.plateAssetId.length === 0) return null

    const canvasRaw = raw.canvas as Record<string, unknown> | undefined
    if (!canvasRaw) return null
    const { w, h, dpi } = canvasRaw
    if (!isFiniteNumber(w) || !isFiniteNumber(h) || !isFiniteNumber(dpi)) return null
    if (w <= 0 || h <= 0) return null
    const canvas = { w, h, dpi }

    if (!Array.isArray(raw.fields) || raw.fields.length === 0) return null
    const fields: TeamField[] = []
    const seen = new Set<string>()
    for (const item of raw.fields) {
      const field = parseField(item, canvas)
      if (!field) return null
      // Duplicate keys would collide in the values map: one player's number
      // would overwrite their name and the second field would render blank.
      if (seen.has(field.key)) return null
      seen.add(field.key)
      fields.push(field)
    }

    return {
      version: TEAM_TEMPLATE_VERSION,
      side: raw.side,
      plateAssetId: raw.plateAssetId,
      distressAssetId: typeof raw.distressAssetId === 'string' ? raw.distressAssetId : null,
      canvas,
      halftone: raw.halftone === true,
      upcharge: isFiniteNumber(raw.upcharge) && raw.upcharge > 0 ? raw.upcharge : 0,
      instructions:
        typeof raw.instructions === 'string' && raw.instructions.trim()
          ? raw.instructions.trim().slice(0, ETSY_INSTRUCTIONS_MAX)
          : null,
      fields,
    }
  } catch {
    return null
  }
}

/**
 * Coerce one customer-supplied value into something printable.
 *
 * Deliberately lossy rather than rejecting: a stray character is dropped and
 * the name still prints. The one thing it will not do is pass a character
 * through that the press cannot set or that could reach an SVG attribute.
 */
export function sanitizeFieldValue(
  // Only these three decide the result, and taking the narrow shape lets the
  // browser call it with the trimmed field summary the product page holds
  // (zones, fonts and colours never leave the server).
  field: Pick<TeamField, 'type' | 'max' | 'uppercase'>,
  raw: unknown
): string {
  if (typeof raw !== 'string') return ''
  if (field.type === 'number') {
    return raw.replace(/[^0-9]/g, '').slice(0, field.max)
  }
  let out = raw.replace(TEXT_ALLOWED_RE, '').replace(/\s+/g, ' ').trim()
  if (field.uppercase) out = out.toUpperCase()
  return out.slice(0, field.max)
}

/** Sanitize a whole submitted values map, keyed by the template's OWN fields — extra keys are dropped. */
export function sanitizeValues(template: TeamTemplate, raw: unknown): Record<string, string> {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const field of template.fields) {
    out[field.key] = sanitizeFieldValue(field, source[field.key])
  }
  return out
}

/** Does this product row carry a usable personalization template? */
export function hasTeamTemplate(metadata: unknown): boolean {
  return parseTeamTemplate(metadata) !== null
}

/**
 * Dollars added per unit for personalizing, read from the PRODUCT ROW.
 *
 * The product page renders this next to the inputs and the cart shows it in
 * the total, so the server has to charge the same number from the same place.
 * Callers on the money path must pass a row they fetched themselves - the
 * cart POSTs its own copy of product.metadata and that copy is the customer's
 * to edit.
 */
export function personalizationUpchargeDollars(metadata: unknown): number {
  const template = parseTeamTemplate(metadata)
  return template ? template.upcharge : 0
}
