// Vercel serverless function: the link-preview photo for a product.
//
// GET /api/share-card?id=<product uuid>&v=<photo tag> -> 1200x630 JPEG.
//
// A product's main photo is a ~1.5 MB square (or tall) PNG. Facebook and
// Messenger crop link images to 1.91:1, which cuts the collar and hem off a
// shirt, and WhatsApp drops images that large. This fits the WHOLE photo
// (the one the product page shows first, see shareImageFor) into a 1200x630
// frame padded with the photo's own backdrop, as a small JPEG.
//
// Only renders published products by id, never a caller-supplied image url,
// so it cannot be used as an open image proxy. `v` changes when the photo
// does (shareImageVersion), so caching it for a long time is safe.
//
// Degrades safely: any failure redirects to the raw photo (or the logo), so a
// preview always has an image.

import { SITE_URL, LOGO_PATH } from './_seo/structured-data.mjs'
import { isUuid, shareImageFor } from './_seo/share-link.mjs'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://czzyrmizvjqlifcivrhn.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630
const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8000
const WHITE = { r: 255, g: 255, b: 255 }
const INK = { r: 24, g: 24, b: 27 }

const absolute = (url) => (/^https?:\/\//i.test(url) ? url : `${SITE_URL}/${String(url).replace(/^\//, '')}`)

async function fetchProduct(id) {
  if (!SUPABASE_ANON_KEY) {
    console.error('[share-card] VITE_SUPABASE_ANON_KEY is not set — cannot load the product')
    return null
  }
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${id}&status=eq.active&limit=1&select=id,images,metadata`,
    { headers }
  )
  if (!res.ok) {
    console.error(`[share-card] product read failed (${res.status})`)
    return null
  }
  return (await res.json())?.[0] ?? null
}

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`photo fetch ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_SOURCE_BYTES) throw new Error(`photo too large (${buf.length} bytes)`)
  return buf
}

/**
 * The 1200x630 card for one photo. Opaque photos are padded with the colour
 * of their own top-left corner (a ghost mannequin's studio white), so the
 * frame reads as one backdrop. Transparent art goes on white, or on near-black
 * when the art itself is light (white lettering on white disappears).
 */
export async function renderShareCard(input, sharp) {
  // One 64x64 sample answers both questions. Many photos carry an alpha
  // channel that is fully opaque, so "has alpha" is decided by coverage.
  const { data } = await sharp(input, { failOn: 'none' })
    .resize(64, 64, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let lum = 0
  let weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255
    lum += a * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
    weight += a
  }
  const transparent = weight / (data.length / 4) < 0.98
  const background = transparent
    ? weight > 0 && lum / weight > 200
      ? INK
      : WHITE
    : { r: data[0], g: data[1], b: data[2] }
  return sharp(input, { failOn: 'none' })
    .rotate()
    .flatten({ background })
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'contain', background })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
}

function redirect(res, location) {
  res.statusCode = 302
  res.setHeader('Location', location)
  res.setHeader('Cache-Control', 'public, s-maxage=300')
  return res.end()
}

export default async function handler(req, res) {
  const id = String(req.query?.id || '').toLowerCase()
  if (!isUuid(id)) return redirect(res, `${SITE_URL}${LOGO_PATH}`)

  let photo = null
  try {
    const product = await fetchProduct(id)
    photo = product ? shareImageFor(product) : null
    if (!photo) return redirect(res, `${SITE_URL}${LOGO_PATH}`)
    photo = absolute(photo)

    const { default: sharp } = await import('sharp')
    const jpeg = await renderShareCard(await fetchImage(photo), sharp)

    res.statusCode = 200
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Content-Length', String(jpeg.length))
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400')
    return res.end(jpeg)
  } catch (err) {
    console.error('[share-card] render failed:', err?.message || err)
    return redirect(res, photo || `${SITE_URL}${LOGO_PATH}`)
  }
}
