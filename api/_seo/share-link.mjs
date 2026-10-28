// Short share links: imaginethisprinted.com/p/<a few words>-<id8>.
//
// David 2026-10-16 ("the share button sucks"): Share copied
// /product/<slug-or-uuid>?utm_source=share&utm_medium=..&utm_campaign=.. — long
// enough that people took it for a scam — and it opened "Product Not Found".
// That link carried the product's SLUG, and the Folgers tee's slug is a UUID
// (its upload's file name), so every reader took it for an id and missed.
//
// A short code is a few words of the product name (for the person reading the
// link) plus the first 8 hex characters of the product id (for the lookup).
// Only the id part is ever looked up, so renaming a product never breaks a link
// already sent. 8 hex = 4.3 billion values; 0 collisions across all 2,606
// product rows on 2026-10-18.
//
// Pure and I/O-free: shared by the SPA (src/lib/product-link.ts, typed through
// share-link.d.mts), the bot renderer (bot-meta.mjs) and the card image
// function (api/share-card.mjs).

/** Share links use the bare domain: it is the shortest form and redirects to www. */
export const SHARE_ORIGIN = 'https://imaginethisprinted.com'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHORT_ID_RE = /(?:^|-)([0-9a-f]{8})$/
const MAX_WORDS = 3
const MAX_WORD_CHARS = 24

export const isUuid = (s) => UUID_RE.test(String(s ?? '').trim())

/** The name a card shows: the part before an Etsy-style " | keywords" tail. */
export function shareName(name) {
  const full = String(name ?? '').replace(/\s+/g, ' ').trim()
  return full.split(' | ')[0].trim() || full
}

/** "folgers-coffee-racing-9c3b3d19", or just the id part when the name has no usable words. */
export function shortCodeFor({ id, name } = {}) {
  const idPart = String(id ?? '').slice(0, 8).toLowerCase()
  if (!/^[0-9a-f]{8}$/.test(idPart)) return null
  const words = shareName(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)
  let lead = ''
  for (const word of words.slice(0, MAX_WORDS)) {
    const next = lead ? `${lead}-${word}` : word
    if (next.length > MAX_WORD_CHARS) break
    lead = next
  }
  return lead ? `${lead}-${idPart}` : idPart
}

/** The link Share hands out, or null when the product has no usable id. */
export function shareUrlFor(product, origin = SHARE_ORIGIN) {
  const code = shortCodeFor(product)
  return code ? `${origin}/p/${code}` : null
}

/**
 * The one link every Share target gets (copy, native sheet, Facebook, X,
 * Pinterest). A published product: its short link, no tracking params (the
 * /p/ path is the attribution, src/utils/utm.ts). Anything else, e.g. the
 * design flow's not-yet-approved product, shares the design studio instead of
 * a product the person receiving it could not open.
 */
export function shareLinkFor({ id, name, published } = {}, origin = SHARE_ORIGIN) {
  return (published && shareUrlFor({ id, name }, origin)) || `${origin}/imagination-station`
}

/** The 8-hex id prefix a short code ends in, or null (a full UUID is not a short code). */
export function shortIdOf(code) {
  const s = String(code ?? '').trim().toLowerCase()
  if (!s || isUuid(s)) return null
  const m = SHORT_ID_RE.exec(s)
  return m ? m[1] : null
}

/** Inclusive uuid bounds covering every id that starts with `prefix` (uuids compare byte-wise). */
export function shortIdRange(prefix) {
  return { lo: `${prefix}-0000-0000-0000-000000000000`, hi: `${prefix}-ffff-ffff-ffff-ffffffffffff` }
}

/**
 * Published = what anyone may open, the same rule as the public products read
 * policy (approved AND status active, migration 20261012210000). Share is only
 * offered for these: anything else opens as "not in the shop" for the person
 * the link is sent to.
 */
export function isPublishedProduct(row) {
  return !!row && row.status === 'active' && row.approved === true
}

/**
 * The lookups, in order, that turn a link key into a product row. Every reader
 * walks the same list with its own I/O, so a link that opens for a person also
 * unfurls for a bot.
 *
 *   short id   /p/<words>-<id8>   (short links only)
 *   id         a full UUID
 *   slug       exact; also tried for UUID-shaped keys (the Folgers tee's slug is one)
 *   replaces   a product that took over a removed one lists the old key in
 *              metadata.replaces (see replacesEntriesFor)
 */
export function lookupPlan(key, { short = false } = {}) {
  const k = String(key ?? '').trim()
  if (!k) return []
  const plan = []
  const sid = short ? shortIdOf(k) : null
  if (sid) plan.push({ kind: 'idRange', ...shortIdRange(sid) })
  if (isUuid(k)) plan.push({ kind: 'id', id: k.toLowerCase() })
  plan.push({ kind: 'slug', slug: k })
  plan.push({ kind: 'replaces', value: k })
  if (sid) plan.push({ kind: 'replaces', value: sid })
  return plan
}

/**
 * What a replacing product records in metadata.replaces for the row it takes
 * over, so every link ever handed out for the old row (full id, short link,
 * slug) lands on the new one instead of the catalog.
 */
export function replacesEntriesFor(oldRow) {
  const id = String(oldRow?.id ?? '').toLowerCase()
  return [id, id.slice(0, 8), oldRow?.slug].filter((v, i, all) => v && all.indexOf(v) === i)
}

// The product page's hero ordering, mirrored from src/lib/product-kind.ts
// getGalleryImages() so the card shows the photo a visitor sees first. A
// parity test (src/lib/product-link.test.ts) runs both over the same rows.
const GARMENT_SHOT_RANK = [
  [/\/ghost_mannequin\//i, 0],
  [/\/flat_lay\//i, 1],
  [/\/hanger\//i, 2],
  [/\/composite\//i, 3],
  [/\/mr_imagine\//i, 4],
  [/etsy_shot_/i, 5]
]
const garmentShotRank = (url) => {
  const hit = GARMENT_SHOT_RANK.find(([re]) => re.test(url))
  return hit ? hit[1] : 99
}
const CREATOR_PRODUCT_SOURCE = 'merch-studio'

/** The product's main photo (the page's first gallery image), or null. */
export function shareImageFor(product) {
  const meta = product?.metadata && typeof product.metadata === 'object' ? product.metadata : {}
  const assets = meta.assets && typeof meta.assets === 'object' ? meta.assets : {}
  const images = Array.isArray(product?.images) ? product.images : []
  const mockups = Array.isArray(assets.mockups) ? assets.mockups : []
  const usable = (u) => typeof u === 'string' && u.trim() !== ''

  if (meta.source === CREATOR_PRODUCT_SOURCE) {
    const hidden = new Set([assets.display, assets.clean, assets.dtf, assets.halftone, assets.back_print].filter(Boolean))
    return [...mockups, meta.mockup_url, ...images].find((u) => usable(u) && !hidden.has(u)) ?? null
  }

  const deliverables = new Set([assets.halftone, assets.dtf].filter(Boolean))
  if (assets.display && assets.clean) deliverables.add(assets.clean)
  const shots = images.filter((u) => usable(u) && garmentShotRank(u) < 99)
  shots.sort((a, b) => garmentShotRank(a) - garmentShotRank(b))
  return (
    [...shots, assets.display, ...mockups, meta.mockup_url, assets.clean, ...images].find(
      (u) => usable(u) && !deliverables.has(u)
    ) ?? null
  )
}

/** "$25.00", or "from $8.95" where the page shows a range (metal sizes, blank tiers); null with no price. */
export function sharePriceLabel(product) {
  const price = Number(product?.price)
  if (!Number.isFinite(price) || price <= 0) return null
  const meta = product?.metadata && typeof product.metadata === 'object' ? product.metadata : {}
  const ranged = product?.category === 'metal-art' || meta.garment?.blank === true || meta.blank_only === true
  return `${ranged ? 'from ' : ''}$${price.toFixed(2)}`
}

/** Card title: "Folgers Coffee Racing Legend T-Shirt — $25.00" (name and price both survive a one-line preview). */
export function shareTitleFor(product) {
  const name = shareName(product?.name)
  const price = sharePriceLabel(product)
  return price ? `${name} — ${price}` : name
}

/** Short stable tag of the photo url (query string ignored), so a re-shot photo gets a fresh card url. */
export function shareImageVersion(url) {
  const s = String(url ?? '').split('?')[0]
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The 1200x630 card api/share-card.mjs renders for this product. */
export function shareCardUrl(product, siteUrl) {
  const photo = shareImageFor(product)
  if (!photo || !isUuid(product?.id)) return null
  return `${siteUrl.replace(/\/$/, '')}/api/share-card?id=${product.id}&v=${shareImageVersion(photo)}`
}
