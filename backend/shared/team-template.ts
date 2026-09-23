// Team shirt personalization — the template contract.
//
// David 2026-09-21: "we need to add this design to our products but the
// customer should be able to edit the name and number that goes on the back
// ... the flow needs to be there for other team shirts we do since this isnt
// the only shirt we do for sports."
//
// A template turns one existing back design into a personalizable one: the
// fixed art (splatter, halftone, helmet) is stored once with the sample
// lettering erased, and the customer's name/number are drawn per order.
//
// HOW THEY ARE DRAWN CHANGED 2026-09-23 (task 65d98dd9). The v1 engine set
// real vector glyphs (services/team-plate/legacy-vector, now quarantined). It
// is replaced by a gpt-image-2.5-flare EDIT of the tagged back artwork that
// keeps the art and redoes only the name and number, chained into
// recraft-crisp-upscale for the 300 DPI press file. David 2026-09-22: "it will
// cost more but will come out the cleanest we will make the $$ back with the
// sale." The resolution objection in the 09-21 design doc (edit returns
// ~1024-1536px, a back needs 3600x4800) is answered by the upscaler, measured
// at 1122x1402 -> 3278x4096 with edges crisp. The field geometry below (zones,
// fill, strokes) is still authored and now travels to the model as placement
// and colour HINTS rather than drawing instructions.
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
import { createHash } from 'node:crypto'

/** Bumped only for a breaking shape change. An unknown version is refused, never guessed at. */
export const TEAM_TEMPLATE_VERSION = 1

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
  /**
   * product_assets row holding the ORIGINAL back art, sample lettering and all.
   * This is what the flare edit works from: it shows the model the lettering
   * style it must reproduce. Null on templates derived before 2026-09-23 —
   * those fall back to editing the erased plate and describing the style.
   */
  sourceAssetId: string | null
  /** product_assets row holding the grunge/halftone mask, or null for clean lettering. */
  distressAssetId: string | null
  canvas: { w: number; h: number; dpi: number }
  /** Whether this ART wants halftoning for the press — a property of the design, not the order. */
  halftone: boolean
  /** Dollars added per line for personalizing. */
  upcharge: number
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

  return {
    key: f.key,
    label: typeof f.label === 'string' ? f.label : f.key,
    type: f.type,
    max: f.max,
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
      sourceAssetId:
        typeof raw.sourceAssetId === 'string' && raw.sourceAssetId.length > 0 ? raw.sourceAssetId : null,
      distressAssetId: typeof raw.distressAssetId === 'string' ? raw.distressAssetId : null,
      canvas,
      halftone: raw.halftone === true,
      upcharge: isFiniteNumber(raw.upcharge) && raw.upcharge > 0 ? raw.upcharge : 0,
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
export function sanitizeFieldValue(field: TeamField, raw: unknown): string {
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

/**
 * Cache key for a rendered plate.
 *
 * Covers the TEMPLATE as well as the values, so editing a template (moving a
 * zone, changing a colour) invalidates every file derived from it without a
 * purge step — the next request simply misses and re-renders.
 */
export function templateCacheKey(template: TeamTemplate, values: Record<string, string>): string {
  const shape = {
    v: template.version,
    plate: template.plateAssetId,
    source: template.sourceAssetId,
    distress: template.distressAssetId,
    canvas: template.canvas,
    halftone: template.halftone,
    fields: template.fields.map((f) => ({
      k: f.key,
      zone: f.zone,
      arch: f.arch,
      font: f.font,
      fill: f.fill,
      strokes: f.strokes,
      offset: f.offset,
      value: values[f.key] ?? '',
    })),
  }
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 32)
}
