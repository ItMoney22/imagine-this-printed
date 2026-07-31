// Pure meta-tag + JSON-LD builders shared by every bot renderer in this repo.
//
// Deliberately I/O-free: no env reads, no fetch, no Supabase. Everything the
// builders need arrives as an argument, so the rendered output can be parsed
// back with JSON.parse() in a unit test. Malformed structured data is worse
// than none (Google flags it), so this module is the single place the shapes
// are defined and the only place they are tested.
//
// Consumers:
//   api/_seo/bot-meta.mjs   → resolves a path to <head> content (does the I/O)
//   api/product-meta.mjs    → Vercel bot-UA function
//   server-static.mjs       → Railway/Express static server middleware
//
// Directories under api/ that start with "_" are not routed by Vercel, so this
// file ships as a bundled dependency of the function, not as an endpoint.

export const SITE_NAME = 'Imagine This Printed'
export const SITE_URL = 'https://www.imaginethisprinted.com'
// public/logo.png does not exist — the previous fallback pointed at a 404.
export const LOGO_PATH = '/itp-logo-v3.png'
export const SUPPORT_EMAIL = 'wecare@imaginethisprinted.com'

const IN_STOCK = 'https://schema.org/InStock'
const OUT_OF_STOCK = 'https://schema.org/OutOfStock'
const BACK_ORDER = 'https://schema.org/BackOrder'

export const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Collapse whitespace and clip to `max` chars for a meta description. */
export const clip = (s, max = 155) => {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + '…'
}

/**
 * Serialize JSON-LD into a <script> block. `<` is escaped to \u003c so a
 * product description containing "</script>" cannot break out of the block
 * (JSON.parse turns it straight back into "<", so the data is unchanged).
 * The data-itp-jsonld marker lets the SPA replace server blocks instead of
 * duplicating them once React hydrates for JS-executing crawlers.
 */
export const jsonLdScript = (data) =>
  `<script type="application/ld+json" data-itp-jsonld="server">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

const absolute = (url, siteUrl = SITE_URL) => {
  const s = String(url ?? '').trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  return `${siteUrl.replace(/\/$/, '')}/${s.replace(/^\//, '')}`
}

/** Absolute, de-duped, capped image list. Never empty — falls back to the logo. */
export function normalizeImages(images, siteUrl = SITE_URL) {
  const list = Array.isArray(images) ? images : images ? [images] : []
  const out = []
  for (const raw of list) {
    const abs = absolute(raw, siteUrl)
    if (abs && !out.includes(abs)) out.push(abs)
    if (out.length === 6) break
  }
  return out.length ? out : [absolute(LOGO_PATH, siteUrl)]
}

/**
 * Real availability instead of a hardcoded InStock.
 *
 * Most of the catalog is made-to-order (track_inventory=false,
 * stock_quantity=0) — that is InStock, not OutOfStock. Stock only gates the
 * answer when the row actually tracks inventory or explicitly says in_stock
 * is false.
 */
export function availabilityFor(product = {}) {
  if (product.is_digital === true) return IN_STOCK
  const backorder = product.allow_backorder === true
  if (product.in_stock === false) return backorder ? BACK_ORDER : OUT_OF_STOCK
  if (product.track_inventory === true && Number(product.stock_quantity ?? 0) <= 0) {
    return backorder ? BACK_ORDER : OUT_OF_STOCK
  }
  return IN_STOCK
}

/**
 * Product schema. `offers` is omitted entirely when the row has no usable
 * price — an invented "0.00" offer is a lie Google will act on, and no offer
 * simply makes the page ineligible for a price-carrying rich result.
 */
export function buildProductJsonLd(product, { canonical, description, siteUrl = SITE_URL } = {}) {
  const url = canonical || absolute(`/product/${product.slug || product.id}`, siteUrl)
  const price = Number(product.price)
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: String(product.name || SITE_NAME),
    description: clip(description ?? product.meta_description ?? product.description ?? '', 500),
    image: normalizeImages(product.images, siteUrl),
    url,
    sku: String(product.sku || product.id || ''),
    brand: { '@type': 'Brand', name: SITE_NAME }
  }
  if (product.category) ld.category = String(product.category)
  if (Number.isFinite(price) && price > 0) {
    ld.offers = {
      '@type': 'Offer',
      url,
      price: price.toFixed(2),
      priceCurrency: 'USD',
      availability: availabilityFor(product),
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: SITE_NAME, url: siteUrl }
    }
  }
  // NOTE: aggregateRating / review are deliberately absent — this schema has no
  // reviews table (verified 2026-07-28), and fabricated ratings are a manual
  // action risk. Add them here the day a real review source exists.
  return ld
}

/** items: [{ name, url }] in crumb order, site root first. */
export function buildBreadcrumbJsonLd(items, siteUrl = SITE_URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: String(it.name),
      item: absolute(it.url, siteUrl)
    }))
  }
}

/**
 * Organization — NOT LocalBusiness. LocalBusiness requires a real postal
 * address and ITP publishes none anywhere in the repo; inventing one would be
 * exactly the malformed-data failure this task exists to avoid. sameAs is
 * omitted for the same reason (no verified profile URLs in the codebase).
 */
export function buildOrganizationJsonLd(siteUrl = SITE_URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: SITE_NAME,
    url: siteUrl,
    logo: absolute(LOGO_PATH, siteUrl),
    email: SUPPORT_EMAIL,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: SUPPORT_EMAIL,
      availableLanguage: ['en']
    }
  }
}

export function buildWebSiteJsonLd(siteUrl = SITE_URL) {
  // No potentialAction/SearchAction: /catalog ignores query params, so a
  // sitelinks searchbox would point crawlers at a URL that does not search.
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    name: SITE_NAME,
    url: siteUrl,
    publisher: { '@id': `${siteUrl}/#organization` }
  }
}

/** Catalog / category / storefront listing pages. */
export function buildCollectionPageJsonLd({ name, description, url, items = [], siteUrl = SITE_URL }) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#collection`,
    name: String(name),
    url,
    isPartOf: { '@id': `${siteUrl}/#website` }
  }
  if (description) ld.description = clip(description, 300)
  if (items.length) {
    ld.mainEntity = {
      '@type': 'ItemList',
      itemListElement: items.slice(0, 24).map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: String(it.name),
        url: absolute(it.url, siteUrl)
      }))
    }
  }
  return ld
}

/**
 * Title/description/canonical/OG/Twitter block. Returns raw HTML — every
 * interpolated value goes through escapeHtml first.
 */
export function buildMetaTags({
  title,
  description,
  canonical,
  image,
  type = 'website',
  keywords,
  noindex = false,
  siteUrl = SITE_URL
}) {
  const img = absolute(image || LOGO_PATH, siteUrl)
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    keywords ? `<meta name="keywords" content="${escapeHtml(keywords)}" />` : '',
    noindex ? `<meta name="robots" content="noindex,follow" />` : '',
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="${escapeHtml(type)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${escapeHtml(img)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(img)}" />`
  ]
    .filter(Boolean)
    .join('\n    ')
}

const CHARSET_RE = /<meta[^>]+charset=[^>]*>/i

/**
 * Drop the shell's static title/description/canonical, then splice our block
 * in. Leaving the originals in place produced duplicate tags (unfurlers pick
 * the first one, which was the generic site card).
 *
 * The block goes in AFTER <meta charset>, not immediately after <head>: the
 * charset declaration must land in the first 1024 bytes of the document, and
 * three JSON-LD blocks are comfortably larger than that on their own. Injecting
 * at the top of <head> pushed charset out of range and left the shell to be
 * character-sniffed.
 */
export function injectHead(shellHtml, headHtml) {
  const stripped = String(shellHtml)
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<link\s+rel="canonical"[^>]*>/i, '')
  if (CHARSET_RE.test(stripped)) {
    return stripped.replace(CHARSET_RE, (charsetTag) => `${charsetTag}\n    ${headHtml}`)
  }
  return stripped.replace(/<head>/i, `<head>\n    ${headHtml}`)
}
