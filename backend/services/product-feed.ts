// ONE product feed for Google Merchant Center (free listings), Pinterest
// catalogs and the ChatGPT merchant program (task 1df2f0be, card 0fb062f8).
// All three read Google's RSS 2.0 product-feed format (xmlns:g), so one file
// serves them; GET /api/seo/products.xml renders it and www's
// /feeds/products.xml is a vercel.json rewrite of that route.
//
// Nothing here has its own copy of a rule. What the feed says a shopper can
// buy comes from the same functions the product page renders:
//   - sizes, colours, kind, gallery order: backend/shared/listing.ts
//     (src/lib/product-kind.ts re-exports it for ProductPage),
//   - price: computeLineItemCents, the function checkout charges with, so a
//     2XL carries its upcharge and a youth size its discount exactly as the
//     cart line does.
// Google requires the feed price to equal the landing page; a second price
// table here is how those drift apart.
import { computeLineItemCents } from './order-pricing.js'
import { isMetalProductRow } from '../shared/metal-art.js'
import { isYouthSize, normalizeColor, COLORS } from '../shared/catalog-capability.js'
import {
  canonicalCategoryOf,
  colorChoicesFor,
  defaultSizeFor,
  getGalleryImages,
  getProductAssets,
  isBlankProduct,
  listingKindOf,
  sizeChoicesFor,
  type ListingRow
} from '../shared/listing.js'

export const FEED_BRAND = 'Imagine This Printed'

/**
 * Held out of the feed until their IP cards rule (task 1df2f0be BUILD 4):
 * Grumpy Cat hoodie (card ce5cc85b), Ghost Face candle holder (card a58ec168),
 * Folgers tee (APPROVE line 10). Remove an id here once its card clears it.
 */
export const FEED_HELD_PRODUCT_IDS = new Set<string>([
  '868b54ed-1568-473e-a508-5e850fdd965b',
  '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3',
  '9c3b3d19-72b1-4fbb-9a0c-148e2a486298'
])

// Shopper-facing category words for g:product_type (the catalog's pills).
const PRODUCT_TYPE_LABELS: Record<string, string> = {
  shirts: 'Apparel > T-Shirts',
  hoodies: 'Apparel > Hoodies',
  tumblers: 'Drinkware > Tumblers',
  'dtf-transfers': 'DTF Transfers',
  '3d-prints': '3D Prints',
  'metal-art': 'Home Decor > Metal Wall Art'
}

/** Google's caps: title 150, description 5000, id 50, up to 10 additional images. */
const TITLE_MAX = 150
const DESCRIPTION_MAX = 5000
const ID_MAX = 50
const ADDITIONAL_IMAGES_MAX = 10

export interface FeedProductRow extends ListingRow {
  id: string
  slug?: string | null
  name?: string | null
  description?: string | null
  meta_description?: string | null
  price?: number | string | null
  status?: string | null
  is_active?: boolean | null
  product_type?: string | null
}

export interface FeedItem {
  id: string
  itemGroupId: string | null
  title: string
  description: string
  link: string
  imageLink: string
  additionalImageLinks: string[]
  priceCents: number
  productType: string
  size: string | null
  color: string | null
  gender: 'unisex' | null
  ageGroup: 'adult' | 'kids' | null
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** HTML / markdown-ish copy → one plain-text paragraph (Google rejects markup in description). */
export function plainText(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[*_#`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const cap = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…')

/** Shopper-facing colour name: '#000000' → 'Black', 'maroon' → 'Maroon'. Null for an unnamed hex. */
export function colorLabel(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim()
  if (!v) return null
  const id = normalizeColor(v)
  if (id) return COLORS[id].label
  if (/^#/.test(v)) return null
  return v.charAt(0).toUpperCase() + v.slice(1)
}

/** Gallery images in product-page order, minus any un-watermarked print file (card 83a2ab40). */
export function feedImages(row: FeedProductRow, siteUrl: string): string[] {
  const assets = getProductAssets(row) as Record<string, unknown>
  const printFiles = new Set(
    [assets.clean, assets.dtf, assets.halftone, assets.back_print, row.metadata?.print_file_url]
      .concat(Object.values((row.metadata?.print_files as Record<string, unknown>) || {}))
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
  )
  const out: string[] = []
  for (const u of getGalleryImages(row)) {
    if (printFiles.has(u)) continue
    const abs = /^https?:\/\//i.test(u) ? u : `${siteUrl}/${u.replace(/^\//, '')}`
    if (!out.includes(abs)) out.push(abs)
  }
  return out
}

/** One cart line's unit price in cents, priced by checkout's own line function. */
export function feedUnitPriceCents(row: FeedProductRow, size: string | null): number | null {
  const priceMap = new Map<string, number>([[row.id, Number(row.price) || 0]])
  const metalIds = isMetalProductRow(row) ? new Set([row.id]) : new Set<string>()
  const { cents, errors } = computeLineItemCents(
    { productId: row.id, quantity: 1, selectedSize: size || null },
    priceMap,
    new Map(),
    new Map(),
    metalIds
  )
  return errors.length > 0 ? null : cents
}

/** Why a row is not in the feed, or null when it is. */
export function feedExclusionReason(row: FeedProductRow): string | null {
  if (row.status !== 'active' || row.is_active === false) return 'not shopper-visible'
  if (FEED_HELD_PRODUCT_IDS.has(row.id)) return 'IP hold'
  // Blank tees are the /blanks lane, priced per size × colour off a supplier
  // table; they are not the finished goods this feed lists.
  if (isBlankProduct(row)) return 'blank garment'
  if (row.product_type === 'digital') return 'digital only'
  if (!(Number(row.price) > 0)) return 'no price'
  return null
}

const compactId = (productId: string) => productId.replace(/-/g, '')
const idPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')

/** The feed items one product row becomes: one per size (and per colour) for apparel and metal, else one. */
export function feedItemsFor(row: FeedProductRow, siteUrl: string): FeedItem[] {
  if (feedExclusionReason(row)) return []
  const images = feedImages(row, siteUrl)
  if (images.length === 0) return []

  const kind = listingKindOf(row)
  const category = canonicalCategoryOf(row)
  const base = {
    title: cap(plainText(row.name), TITLE_MAX),
    description: cap(plainText(row.description) || plainText(row.meta_description) || plainText(row.name), DESCRIPTION_MAX),
    link: `${siteUrl}/product/${encodeURIComponent(String(row.slug || row.id))}`,
    imageLink: images[0],
    additionalImageLinks: images.slice(1, 1 + ADDITIONAL_IMAGES_MAX),
    productType: PRODUCT_TYPE_LABELS[category] || category
  }

  // Each size variant links to the page opened on that size (?size=, read by
  // src/pages/ProductPage.tsx), so the price Google sees there is this item's.
  const sizedLink = (size: string) => `${base.link}?size=${encodeURIComponent(size)}`

  const one = (size: string | null): FeedItem | null => {
    const priceCents = feedUnitPriceCents(row, size)
    if (priceCents === null || priceCents <= 0) return null
    return { ...base, id: row.id, itemGroupId: null, priceCents, size: null, color: null, gender: null, ageGroup: null }
  }

  if (kind === 'tee' || kind === 'hoodie') {
    // Google: variants that differ by colour must be separate items, so a
    // listing offering Black and White is one item per size per colour.
    // A listing with no colour picker is the one garment colour it was made on.
    const offered = colorChoicesFor(row).map(colorLabel).filter((c): c is string => !!c)
    const colors: (string | null)[] = offered.length > 0
      ? Array.from(new Set(offered))
      : [colorLabel(row.metadata?.shirt_color)]
    const items: FeedItem[] = []
    for (const size of sizeChoicesFor(row)) {
      const priceCents = feedUnitPriceCents(row, size)
      if (priceCents === null || priceCents <= 0) continue
      for (const color of colors) {
        const suffix = colors.length > 1 && color ? `-${idPart(color)}` : ''
        items.push({
          ...base,
          link: sizedLink(size),
          id: `${compactId(row.id)}-${idPart(size)}${suffix}`.slice(0, ID_MAX),
          itemGroupId: row.id,
          priceCents,
          size,
          color,
          gender: 'unisex',
          ageGroup: isYouthSize(size) ? 'kids' : 'adult'
        })
      }
    }
    return items
  }

  if (kind === 'metal') {
    // Each panel size is its own price on the page, so its own item.
    const sizes = sizeChoicesFor(row)
    if (sizes.length <= 1) {
      const item = one(sizes[0] ?? null)
      return item ? [{ ...item, size: sizes[0] ?? null }] : []
    }
    const items: FeedItem[] = []
    for (const size of sizes) {
      const priceCents = feedUnitPriceCents(row, size)
      if (priceCents === null || priceCents <= 0) continue
      items.push({
        ...base,
        link: sizedLink(size),
        id: `${compactId(row.id)}-${idPart(size)}`.slice(0, ID_MAX),
        itemGroupId: row.id,
        priceCents,
        size,
        color: null,
        gender: null,
        ageGroup: null
      })
    }
    return items
  }

  // Transfers, 3D prints, tumblers: one item at the price the page opens on.
  const item = one(defaultSizeFor(row) || null)
  return item ? [item] : []
}

const tag = (name: string, value: string | null | undefined) =>
  value === null || value === undefined || value === '' ? '' : `<${name}>${xmlEscape(value)}</${name}>`

export function feedItemXml(item: FeedItem): string {
  const parts = [
    tag('g:id', item.id),
    tag('title', item.title),
    tag('description', item.description),
    tag('link', item.link),
    tag('g:image_link', item.imageLink),
    ...item.additionalImageLinks.map((u) => tag('g:additional_image_link', u)),
    tag('g:availability', 'in_stock'),
    tag('g:price', `${(item.priceCents / 100).toFixed(2)} USD`),
    tag('g:brand', FEED_BRAND),
    tag('g:condition', 'new'),
    tag('g:identifier_exists', 'no'),
    tag('g:product_type', item.productType),
    tag('g:min_handling_time', '1'),
    tag('g:max_handling_time', '3'),
    tag('g:item_group_id', item.itemGroupId),
    tag('g:size', item.size),
    tag('g:color', item.color),
    tag('g:gender', item.gender),
    tag('g:age_group', item.ageGroup)
  ]
  return `    <item>${parts.join('')}</item>`
}

export function buildProductFeedXml(rows: FeedProductRow[], siteUrl: string): { xml: string; items: FeedItem[] } {
  const site = siteUrl.replace(/\/$/, '')
  const items = rows.flatMap((r) => feedItemsFor(r, site))
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n` +
    `  <channel>\n` +
    `    <title>${xmlEscape(FEED_BRAND)}</title>\n` +
    `    <link>${xmlEscape(site)}</link>\n` +
    `    <description>${xmlEscape(`${FEED_BRAND} products`)}</description>\n` +
    items.map(feedItemXml).join('\n') +
    (items.length ? '\n' : '') +
    `  </channel>\n` +
    `</rss>\n`
  return { xml, items }
}
