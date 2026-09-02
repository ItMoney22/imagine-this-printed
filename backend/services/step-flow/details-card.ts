// Step Flow — Step 4 "details" shot.
//
// David 2026-09-01: the reference PicWish workflow warns "zoom in on any
// text" an image model renders — so the product-details card is NOT
// AI-rendered. It's composed in-house with `sharp` (already a dependency):
// the approved product mockup on the left, spec bullets + a size chart as SVG
// text on the right. Deterministic, free, always legible.
//
// David 2026-09-02: "the text is way too small." This card is a listing
// image buyers scroll on Etsy/the storefront at thumbnail size, so it's
// rebuilt square (1500x1500 — Etsy crops non-square thumbnails) with a big,
// legible text column. Nothing on the card renders below MIN_FONT_SIZE.
import sharp from 'sharp'
import { supabase } from '../../lib/supabase.js'
import { uploadFile } from '../gcs-storage.js'
import { GARMENTS, getGarment, type ColorId, type GarmentId } from '../../shared/catalog-capability.js'
import {
  METAL_ART_SIZES,
  METAL_ART_PRICES,
  METAL_ADDONS,
  STUDIO_SIZE_KEYS,
  type MetalArtSizeKey,
} from '../../shared/metal-art.js'

const CARD_WIDTH = 1500
const CARD_HEIGHT = 1500
const LEFT_WIDTH = Math.round(CARD_WIDTH * 0.52) // 780 — the mockup photo
const RIGHT_WIDTH = CARD_WIDTH - LEFT_WIDTH // 720 — the text column
const PHOTO_MARGIN = 40 // inner margin around the cropped mockup photo
const CARD_MARGIN = 24 // off-white gutter around the white text-column card
const CARD_RADIUS = 24
const TEXT_PAD = 40 // inner padding from the white card's edge to the text
const MIN_FONT_SIZE = 28 // floor — nothing on this card may render smaller

const INK = '#111827'
const MUTED = '#6b7280'
const BRAND_PURPLE = '#7c3aed'
const BG_OFFWHITE = '#f7f7f8'
const CARD_WHITE = '#ffffff'
const ROW_TINT = '#f3f4f6'

/**
 * S–3XL size charts, inches. Body width = garment laid flat, measured pit to
 * pit (double for full chest circumference); body length = from the high
 * point of the shoulder to the hem.
 *
 * SOURCE: Gildan's published spec sheets for style 5000 (Heavy Cotton Tee)
 * and style 18500 (Heavy Blend Hoodie) — https://www.gildan.com, "size
 * chart" tab per style. Values below are the standard adult-unisex numbers
 * from those sheets (rounded to the nearest quarter inch), not a live fetch —
 * update here if Gildan revises a spec sheet.
 */
const SIZE_CHARTS: Record<GarmentId, { size: string; widthIn: number; lengthIn: number }[]> = {
  tshirt: [
    { size: 'S', widthIn: 18, lengthIn: 28 },
    { size: 'M', widthIn: 20, lengthIn: 29 },
    { size: 'L', widthIn: 22, lengthIn: 30 },
    { size: 'XL', widthIn: 24, lengthIn: 31 },
    { size: '2XL', widthIn: 26, lengthIn: 32 },
    { size: '3XL', widthIn: 28, lengthIn: 33 },
  ],
  hoodie: [
    { size: 'S', widthIn: 20, lengthIn: 27 },
    { size: 'M', widthIn: 22, lengthIn: 28 },
    { size: 'L', widthIn: 24, lengthIn: 29 },
    { size: 'XL', widthIn: 26, lengthIn: 30 },
    { size: '2XL', widthIn: 28, lengthIn: 31 },
    { size: '3XL', widthIn: 30, lengthIn: 32 },
  ],
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface DetailsCardTextOpts {
  garment: GarmentId
  color: ColorId
  title: string
  printWidthInches: number
}

// Render's Linux image has no Arial/Helvetica — 'DejaVu Sans' is the actual
// font that resolves there (Arial/Helvetica are still first for anyone
// rendering this SVG on a machine that does have them; sans-serif is the
// final catch-all). Applied to every <text> element in this card.
const FONT = "Arial, Helvetica, 'DejaVu Sans', sans-serif"

/**
 * Word-wrap RAW text (never pre-escaped — see buildDetailsSvg's comment on
 * why) into at most `maxLines` lines of ≤`charsPerLine` characters. If it
 * still doesn't fit, the LAST line is visibly truncated with an ellipsis —
 * a deliberate, visible cut, never a silent one.
 */
function wrapText(text: string, charsPerLineN: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const wrapped: string[] = []
  let cur = ''
  for (const w of words) {
    const attempt = (cur + ' ' + w).trim()
    if (attempt.length > charsPerLineN && cur) {
      wrapped.push(cur)
      cur = w
    } else {
      cur = attempt
    }
  }
  if (cur) wrapped.push(cur)
  if (wrapped.length <= maxLines) return wrapped
  const kept = wrapped.slice(0, maxLines)
  kept[maxLines - 1] = kept[maxLines - 1].replace(/[.,;:\s]+$/, '') + '…'
  return kept
}

/**
 * Clamp a single line of RAW text to `maxChars`, visibly truncating with an
 * ellipsis. Used for the blank name (and, as a general safety net, every
 * spec-row value) — these rows must never wrap onto a second line.
 */
function clampLine(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + '…'
}

/**
 * ~0.55em average glyph width for this bold sans-serif stack — there's no
 * real text-measuring lib in play, so line breaks are decided by character
 * count against this heuristic rather than actual rendered pixel width.
 */
function charsPerLine(fontSizePx: number, maxWidthPx: number): number {
  return Math.max(1, Math.floor(maxWidthPx / (fontSizePx * 0.55)))
}

/** Build the right-column SVG panel — title, DTF pitch, blank spec, size chart, care line. */
export function buildDetailsSvg(opts: DetailsCardTextOpts): string {
  const garment = getGarment(opts.garment) ?? GARMENTS[0]
  const chart = SIZE_CHARTS[garment.id]
  const rawTitle = (opts.title || 'Custom Design').trim() || 'Custom Design'

  const contentX = CARD_MARGIN + TEXT_PAD // 64 — left edge every text node sits at
  const contentWidth = RIGHT_WIDTH - 2 * (CARD_MARGIN + TEXT_PAD) // 592

  const nodes: string[] = [
    `<rect width="100%" height="100%" fill="${BG_OFFWHITE}" />`,
    `<rect x="${CARD_MARGIN}" y="${CARD_MARGIN}" width="${RIGHT_WIDTH - 2 * CARD_MARGIN}" height="${
      CARD_HEIGHT - 2 * CARD_MARGIN
    }" rx="${CARD_RADIUS}" ry="${CARD_RADIUS}" fill="${CARD_WHITE}" />`,
  ]

  let y = CARD_MARGIN + TEXT_PAD

  /** Push one <text> node at the current y and advance nothing — callers move y first. */
  const emit = (str: string, x: number, size: number, weight: number, fill: string) => {
    if (size < MIN_FONT_SIZE) {
      // A hard fail, not a silent shrink — this card's whole point is legibility.
      throw new Error(`details-card: attempted font-size ${size}px, below the ${MIN_FONT_SIZE}px floor`)
    }
    nodes.push(
      `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(
        str
      )}</text>`
    )
  }

  // --- 1. Title — 2 lines max at 72px bold. A title that needs a 3rd line
  // shrinks to 60px (the floor for this block, never smaller) instead of
  // being silently cut. Wrapped on the RAW title (never pre-escaped — the
  // old version escaped once up front and then AGAIN while wrapping, which
  // doubled every "&" to "&amp;amp;"; escaping now happens exactly once, at
  // push time, on the wrapped raw line).
  const naturalAt72 = wrapText(rawTitle, charsPerLine(72, contentWidth), 999)
  let titleSize = 72
  let titleLines = naturalAt72
  if (naturalAt72.length > 2) {
    titleSize = 60
    titleLines = wrapText(rawTitle, charsPerLine(titleSize, contentWidth), 3)
  }
  const titleLineHeight = Math.round(titleSize * 1.15)
  for (const line of titleLines) {
    y += titleLineHeight
    emit(line, contentX, titleSize, 700, INK)
  }

  // --- 2. DTF pitch + one-line benefit underneath.
  y += 64
  emit('Printed with DTF', contentX, 40, 600, BRAND_PURPLE)
  y += 40
  emit('vivid, stretch-safe, wash-tested', contentX, 30, 400, MUTED)

  // --- 3. Spec rows: Blank · Weight · Design width · Print · Fit. Each row
  // is one <text> with a muted label tspan and a dark value tspan so they
  // share a baseline without needing a hand-tuned two-column x layout. The
  // value is clamped to one line (ellipsis) sized off THIS row's own label
  // width — the blank name is the one that can realistically run long.
  const SPEC_ROW_H = 64
  const specRows: [string, string][] = [
    ['Blank', garment.blank],
    ['Weight', `${garment.weightOz} oz`],
    ['Design width', `~${Math.round(opts.printWidthInches)} in`],
    ['Print', 'DTF heat transfer'],
    ['Fit', 'Unisex, true to size'],
  ]
  for (const [label, rawValue] of specRows) {
    y += SPEC_ROW_H
    const labelWidthPx = label.length * 34 * 0.55
    const valueBudgetPx = Math.max(60, contentWidth - labelWidthPx - 14)
    const value = clampLine(rawValue, charsPerLine(34, valueBudgetPx))
    nodes.push(
      `<text x="${contentX}" y="${y}" font-family="${FONT}" font-size="34">` +
        `<tspan fill="${MUTED}" font-weight="600">${escapeXml(label)}</tspan>` +
        `<tspan fill="${INK}" font-weight="400" dx="14">${escapeXml(value)}</tspan>` +
        `</text>`
    )
  }

  // --- 4. Size chart: header, column labels, then S–3XL rows with
  // alternating row tint.
  y += 70
  emit('Size chart (inches)', contentX, 38, 700, INK)

  y += 54
  const chartColX = [contentX, contentX + Math.round(contentWidth / 3), contentX + Math.round((2 * contentWidth) / 3)]
  emit('Size', chartColX[0], 32, 700, INK)
  emit('Chest', chartColX[1], 32, 700, INK)
  emit('Length', chartColX[2], 32, 700, INK)

  const CHART_ROW_H = 56
  let rowTop = y + 14
  for (let i = 0; i < chart.length; i++) {
    const row = chart[i]
    if (i % 2 === 0) {
      nodes.push(
        `<rect x="${CARD_MARGIN}" y="${rowTop}" width="${
          RIGHT_WIDTH - 2 * CARD_MARGIN
        }" height="${CHART_ROW_H}" fill="${ROW_TINT}" />`
      )
    }
    y = rowTop + CHART_ROW_H - 16
    emit(row.size, chartColX[0], 32, 400, INK)
    emit(`${row.widthIn}"`, chartColX[1], 32, 400, INK)
    emit(`${row.lengthIn}"`, chartColX[2], 32, 400, INK)
    rowTop += CHART_ROW_H
  }
  y = rowTop

  // --- 5. Care line. Wrapped the same way as the title (never a single
  // fixed-width <text> with no safety net): at 28px this exact string
  // measures wider than contentWidth in real Arial-metric rendering, so
  // without a wrap check it silently overflowed past the card's right edge
  // — caught by rendering a real card and pixel-scanning it, not by eye.
  const careLines = wrapText('Wash cold inside out · Tumble low · No iron on print', charsPerLine(28, contentWidth), 2)
  const careLineHeight = Math.round(28 * 1.3)
  y += 64
  for (const line of careLines) {
    emit(line, contentX, 28, 400, MUTED)
    y += careLineHeight
  }

  return `<svg width="${RIGHT_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${nodes.join('\n    ')}
  </svg>`
}

/** Compose the 1500x1500 details card PNG from an already-decoded mockup image buffer. Pure — no network, no upload. */
export async function composeDetailsCardPng(mockupBuffer: Buffer, opts: DetailsCardTextOpts): Promise<Buffer> {
  const photoWidth = LEFT_WIDTH - PHOTO_MARGIN * 2
  const photoHeight = CARD_HEIGHT - PHOTO_MARGIN * 2
  const leftPanel = await sharp(mockupBuffer)
    .resize(photoWidth, photoHeight, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const rightPanel = Buffer.from(buildDetailsSvg(opts))

  return sharp({
    create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: BG_OFFWHITE },
  })
    .composite([
      { input: leftPanel, left: PHOTO_MARGIN, top: PHOTO_MARGIN },
      { input: rightPanel, left: LEFT_WIDTH, top: 0 },
    ])
    .png()
    .toBuffer()
}

export interface RenderDetailsCardOpts extends DetailsCardTextOpts {
  productId: string
  mockupUrl: string
  actorId?: string
}

export interface RenderDetailsCardResult {
  buffer: Buffer
  url: string
  path: string
  assetId: string
}

/**
 * Full pipeline: fetch the approved product mockup, compose the card,
 * upload to GCS, and insert the `product_assets` row (asset_role
 * 'mockup_details', kind 'mockup' — same slot the gallery ROLE_ORDER whitelist
 * knows). One details card per product — replaces any prior one.
 */
export async function renderDetailsCard(opts: RenderDetailsCardOpts): Promise<RenderDetailsCardResult> {
  const res = await fetch(opts.mockupUrl)
  if (!res.ok) throw new Error(`Failed to fetch mockup for details card: ${res.status} ${res.statusText}`)
  const mockupBuffer = Buffer.from(await res.arrayBuffer())

  const buffer = await composeDetailsCardPng(mockupBuffer, opts)

  const filename = `${opts.productId}-details-${Date.now()}.png`
  const { publicUrl, gcsPath } = await uploadFile(buffer, {
    userId: opts.actorId || 'system',
    folder: 'mockups',
    filename,
    contentType: 'image/png',
  })

  // One details card per product, ever — replace any prior one (mirrors the
  // worker's "one asset per mockup role" rule for every other mockup role).
  await supabase.from('product_assets').delete().eq('product_id', opts.productId).eq('asset_role', 'mockup_details')

  const { data: inserted, error } = await supabase
    .from('product_assets')
    .insert({
      product_id: opts.productId,
      kind: 'mockup',
      path: gcsPath,
      url: publicUrl,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      asset_role: 'mockup_details',
      is_primary: false,
      display_order: 6,
      metadata: {
        template: 'step_flow_details_card',
        garment: opts.garment,
        color: opts.color,
        generated_at: new Date().toISOString(),
      },
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to save details card asset: ${error.message}`)

  return { buffer, url: publicUrl, path: gcsPath, assetId: inserted.id }
}

// ---------------------------------------------------------------------------
// Metal art variant (design doc §14) — same layout, big-type rules, and
// square 1500x1500 output as the garment card above, but with metal-specific
// copy: no DTF pitch, no S–3XL body chart, no "Fit"/"Print" garment rows.
// Instead: an aluminum-panel pitch, a Panel/Sizes/Finish/Mounting spec block,
// an inches+cm size table for the sizes actually offered, and a metal care
// line ("Wipe with a soft cloth · Keep out of direct sun" — never washed).
// ---------------------------------------------------------------------------

export interface MetalDetailsCardTextOpts {
  title: string
  /** The sizes this listing actually offers (from step_flow.metalSizes) — drives both the "Sizes" spec row and the size table rows. */
  sizes: MetalArtSizeKey[]
}

/** Build the right-column SVG panel for a metal print's details card. */
export function buildMetalDetailsSvg(opts: MetalDetailsCardTextOpts): string {
  const rawTitle = (opts.title || 'Custom Metal Print').trim() || 'Custom Metal Print'
  const requested = opts.sizes && opts.sizes.length ? opts.sizes : STUDIO_SIZE_KEYS
  const ordered = STUDIO_SIZE_KEYS.filter((s) => requested.includes(s))
  const sizesForDisplay = ordered.length ? ordered : STUDIO_SIZE_KEYS

  const contentX = CARD_MARGIN + TEXT_PAD
  const contentWidth = RIGHT_WIDTH - 2 * (CARD_MARGIN + TEXT_PAD)

  const nodes: string[] = [
    `<rect width="100%" height="100%" fill="${BG_OFFWHITE}" />`,
    `<rect x="${CARD_MARGIN}" y="${CARD_MARGIN}" width="${RIGHT_WIDTH - 2 * CARD_MARGIN}" height="${
      CARD_HEIGHT - 2 * CARD_MARGIN
    }" rx="${CARD_RADIUS}" ry="${CARD_RADIUS}" fill="${CARD_WHITE}" />`,
  ]

  let y = CARD_MARGIN + TEXT_PAD

  const emit = (str: string, x: number, size: number, weight: number, fill: string) => {
    if (size < MIN_FONT_SIZE) {
      throw new Error(`details-card: attempted font-size ${size}px, below the ${MIN_FONT_SIZE}px floor`)
    }
    nodes.push(
      `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(
        str
      )}</text>`
    )
  }

  // --- 1. Title — same 2-line-at-72px / 3-line-at-60px rule as the garment card.
  const naturalAt72 = wrapText(rawTitle, charsPerLine(72, contentWidth), 999)
  let titleSize = 72
  let titleLines = naturalAt72
  if (naturalAt72.length > 2) {
    titleSize = 60
    titleLines = wrapText(rawTitle, charsPerLine(titleSize, contentWidth), 3)
  }
  const titleLineHeight = Math.round(titleSize * 1.15)
  for (const line of titleLines) {
    y += titleLineHeight
    emit(line, contentX, titleSize, 700, INK)
  }

  // --- 2. Aluminum-panel pitch + one-line benefit underneath.
  y += 64
  emit('Printed on aluminum', contentX, 40, 600, BRAND_PURPLE)
  y += 40
  emit('glossy, frameless, ready to display', contentX, 30, 400, MUTED)

  // --- 3. Spec rows: Panel · Sizes · Finish · Mounting. The "Sizes" value is
  // one clamped line (same rule every spec row uses — see clampLine below),
  // so this uses the short size key ("4x6") rather than METAL_ART_SIZES's
  // longer labelIn ("4 × 6\"") — the full inches/cm breakdown lives in the
  // size table beneath, this row just needs to fit the price alongside it.
  const sizesLabel = sizesForDisplay.map((s) => `${s} $${METAL_ART_PRICES[s].toFixed(2)}`).join(', ')
  const mountingLabel = Object.values(METAL_ADDONS)
    .map((a) => a.label)
    .join(', ')
  const SPEC_ROW_H = 64
  const specRows: [string, string][] = [
    ['Panel', 'Aluminum metal print'],
    ['Sizes', sizesLabel],
    ['Finish', 'Glossy'],
    ['Mounting', mountingLabel],
  ]
  for (const [label, rawValue] of specRows) {
    y += SPEC_ROW_H
    const labelWidthPx = label.length * 34 * 0.55
    const valueBudgetPx = Math.max(60, contentWidth - labelWidthPx - 14)
    const value = clampLine(rawValue, charsPerLine(34, valueBudgetPx))
    nodes.push(
      `<text x="${contentX}" y="${y}" font-family="${FONT}" font-size="34">` +
        `<tspan fill="${MUTED}" font-weight="600">${escapeXml(label)}</tspan>` +
        `<tspan fill="${INK}" font-weight="400" dx="14">${escapeXml(value)}</tspan>` +
        `</text>`
    )
  }

  // --- 4. Size table: header, column labels, then one row per offered size
  // in both inches and centimeters.
  y += 70
  emit('Sizes (in / cm)', contentX, 38, 700, INK)

  y += 54
  const chartColX = [contentX, contentX + Math.round(contentWidth / 3), contentX + Math.round((2 * contentWidth) / 3)]
  emit('Size', chartColX[0], 32, 700, INK)
  emit('Inches', chartColX[1], 32, 700, INK)
  emit('Centimeters', chartColX[2], 32, 700, INK)

  const CHART_ROW_H = 56
  let rowTop = y + 14
  for (let i = 0; i < sizesForDisplay.length; i++) {
    const spec = METAL_ART_SIZES[sizesForDisplay[i]]
    if (i % 2 === 0) {
      nodes.push(
        `<rect x="${CARD_MARGIN}" y="${rowTop}" width="${
          RIGHT_WIDTH - 2 * CARD_MARGIN
        }" height="${CHART_ROW_H}" fill="${ROW_TINT}" />`
      )
    }
    y = rowTop + CHART_ROW_H - 16
    const cmW = (spec.widthIn * 2.54).toFixed(1)
    const cmH = (spec.heightIn * 2.54).toFixed(1)
    emit(spec.labelIn, chartColX[0], 32, 400, INK)
    emit(`${spec.widthIn}x${spec.heightIn}"`, chartColX[1], 32, 400, INK)
    emit(`${cmW}x${cmH} cm`, chartColX[2], 32, 400, INK)
    rowTop += CHART_ROW_H
  }
  y = rowTop

  // --- 5. Care line — metal, not fabric: never washed.
  const careLines = wrapText('Wipe with a soft cloth · Keep out of direct sun', charsPerLine(28, contentWidth), 2)
  const careLineHeight = Math.round(28 * 1.3)
  y += 64
  for (const line of careLines) {
    emit(line, contentX, 28, 400, MUTED)
    y += careLineHeight
  }

  return `<svg width="${RIGHT_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${nodes.join('\n    ')}
  </svg>`
}

/** Compose the 1500x1500 metal details card PNG from an already-decoded mockup image buffer. Pure — no network, no upload. */
export async function composeMetalDetailsCardPng(mockupBuffer: Buffer, opts: MetalDetailsCardTextOpts): Promise<Buffer> {
  const photoWidth = LEFT_WIDTH - PHOTO_MARGIN * 2
  const photoHeight = CARD_HEIGHT - PHOTO_MARGIN * 2
  const leftPanel = await sharp(mockupBuffer)
    .resize(photoWidth, photoHeight, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const rightPanel = Buffer.from(buildMetalDetailsSvg(opts))

  return sharp({
    create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: BG_OFFWHITE },
  })
    .composite([
      { input: leftPanel, left: PHOTO_MARGIN, top: PHOTO_MARGIN },
      { input: rightPanel, left: LEFT_WIDTH, top: 0 },
    ])
    .png()
    .toBuffer()
}

export interface RenderMetalDetailsCardOpts extends MetalDetailsCardTextOpts {
  productId: string
  mockupUrl: string
  actorId?: string
}

/**
 * Full pipeline for a metal print's details card — mirrors renderDetailsCard
 * above (fetch the approved size-scene mockup, compose the card, upload to
 * GCS, insert the product_assets row). Same asset_role ('mockup_details') and
 * "one per product, replaces any prior one" contract, so the shared
 * ROLE_ORDER whitelist (backend/shared/product-gallery.ts) needs no
 * metal-specific entry for this slot.
 */
export async function renderMetalDetailsCard(opts: RenderMetalDetailsCardOpts): Promise<RenderDetailsCardResult> {
  const res = await fetch(opts.mockupUrl)
  if (!res.ok) throw new Error(`Failed to fetch mockup for details card: ${res.status} ${res.statusText}`)
  const mockupBuffer = Buffer.from(await res.arrayBuffer())

  const buffer = await composeMetalDetailsCardPng(mockupBuffer, opts)

  const filename = `${opts.productId}-details-${Date.now()}.png`
  const { publicUrl, gcsPath } = await uploadFile(buffer, {
    userId: opts.actorId || 'system',
    folder: 'mockups',
    filename,
    contentType: 'image/png',
  })

  await supabase.from('product_assets').delete().eq('product_id', opts.productId).eq('asset_role', 'mockup_details')

  const { data: inserted, error } = await supabase
    .from('product_assets')
    .insert({
      product_id: opts.productId,
      kind: 'mockup',
      path: gcsPath,
      url: publicUrl,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      asset_role: 'mockup_details',
      is_primary: false,
      display_order: 6,
      metadata: {
        template: 'step_flow_metal_details_card',
        sizes: opts.sizes,
        generated_at: new Date().toISOString(),
      },
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to save details card asset: ${error.message}`)

  return { buffer, url: publicUrl, path: gcsPath, assetId: inserted.id }
}
