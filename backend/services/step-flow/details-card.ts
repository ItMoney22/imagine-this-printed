// Step Flow — Step 4 "details" shot.
//
// David 2026-09-01: the reference PicWish workflow warns "zoom in on any
// text" an image model renders — so the product-details card is NOT
// AI-rendered. It's composed in-house with `sharp` (already a dependency):
// the approved product mockup on the left, spec bullets + a size chart as SVG
// text on the right. Deterministic, free, always legible.
import sharp from 'sharp'
import { supabase } from '../../lib/supabase.js'
import { uploadFile } from '../gcs-storage.js'
import { GARMENTS, getGarment, type ColorId, type GarmentId } from '../../shared/catalog-capability.js'

const CARD_WIDTH = 1200
const CARD_HEIGHT = 1500
const LEFT_WIDTH = Math.round(CARD_WIDTH * 0.6) // 720
const RIGHT_WIDTH = CARD_WIDTH - LEFT_WIDTH // 480

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

const CARE_BULLETS = [
  'Machine wash cold, inside out',
  'Tumble dry low or hang dry',
  'Do not iron directly on the print',
  'Do not dry clean',
]

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

/** Build the right-column SVG panel — title, DTF pitch, blank spec, care, size chart. */
export function buildDetailsSvg(opts: DetailsCardTextOpts): string {
  const garment = getGarment(opts.garment) ?? GARMENTS[0]
  const chart = SIZE_CHARTS[garment.id]
  const title = escapeXml((opts.title || 'Custom Design').slice(0, 60))

  const pad = 36
  let y = 64

  const lines: string[] = []
  const addText = (text: string, opts2: { size: number; weight?: number; fill?: string; dy?: number }) => {
    y += opts2.dy ?? opts2.size + 10
    lines.push(
      `<text x="${pad}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${opts2.size}" font-weight="${
        opts2.weight ?? 400
      }" fill="${opts2.fill ?? '#111827'}">${escapeXml(text)}</text>`
    )
  }

  // Wrap the title across up to 2 lines (~22 chars/line at this size).
  const titleWords = title.split(' ')
  const titleLines: string[] = []
  let cur = ''
  for (const w of titleWords) {
    if ((cur + ' ' + w).trim().length > 22 && cur) {
      titleLines.push(cur.trim())
      cur = w
    } else {
      cur = (cur + ' ' + w).trim()
    }
  }
  if (cur) titleLines.push(cur)
  for (const t of titleLines.slice(0, 2)) {
    y += 34
    lines.push(
      `<text x="${pad}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#111827">${escapeXml(
        t
      )}</text>`
    )
  }

  y += 18
  lines.push(
    `<text x="${pad}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="600" fill="#7C3AED">Printed with DTF — vivid, stretch-safe, wash-tested</text>`
  )

  y += 40
  lines.push(
    `<text x="${pad}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#374151">Blank: ${escapeXml(
      garment.blank
    )} (${garment.weightOz} oz)</text>`
  )
  y += 26
  lines.push(
    `<text x="${pad}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#374151">Design width ~${Math.round(
      opts.printWidthInches
    )} in</text>`
  )

  y += 38
  lines.push(
    `<text x="${pad}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#111827">Care</text>`
  )
  for (const bullet of CARE_BULLETS) {
    y += 24
    lines.push(
      `<text x="${pad + 4}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#4B5563">• ${escapeXml(
        bullet
      )}</text>`
    )
  }

  y += 40
  lines.push(
    `<text x="${pad}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#111827">${escapeXml(
      garment.label
    )} Size Chart (in)</text>`
  )
  y += 14
  const colX = [pad, pad + 90, pad + 220]
  y += 24
  lines.push(
    `<text x="${colX[0]}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="#111827">Size</text>`,
    `<text x="${colX[1]}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="#111827">Chest W</text>`,
    `<text x="${colX[2]}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="#111827">Length</text>`
  )
  for (const row of chart) {
    y += 24
    lines.push(
      `<text x="${colX[0]}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#374151">${row.size}</text>`,
      `<text x="${colX[1]}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#374151">${row.widthIn}"</text>`,
      `<text x="${colX[2]}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#374151">${row.lengthIn}"</text>`
    )
  }

  return `<svg width="${RIGHT_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#FFFFFF" />
    ${lines.join('\n    ')}
  </svg>`
}

/** Compose the 1200x1500 details card PNG from an already-decoded mockup image buffer. Pure — no network, no upload. */
export async function composeDetailsCardPng(mockupBuffer: Buffer, opts: DetailsCardTextOpts): Promise<Buffer> {
  const leftPanel = await sharp(mockupBuffer)
    .resize(LEFT_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const rightPanel = Buffer.from(buildDetailsSvg(opts))

  return sharp({
    create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: '#FFFFFF' },
  })
    .composite([
      { input: leftPanel, left: 0, top: 0 },
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
