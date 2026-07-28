// Path → <head> resolution for crawlers and social unfurlers.
//
// This is a Vite SPA: every URL serves the same empty shell, so anything that
// does not execute JS (Slack, Discord, Facebook, Twitter, LinkedIn, WhatsApp,
// most LLM fetchers) sees one generic site card for the entire storefront.
// This module renders real per-page <head> content for those user-agents.
//
// I/O lives here; the shapes live in ./structured-data.mjs (pure + tested).
//
// Coverage: /product/:idOrSlug, /catalog, /catalog/:category, /community,
// /imagination-station, /wholesale, /contact + the site root. Anything else
// returns null and the caller serves the untouched shell.

import {
  SITE_NAME,
  SITE_URL,
  LOGO_PATH,
  clip,
  jsonLdScript,
  buildMetaTags,
  buildProductJsonLd,
  buildBreadcrumbJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildCollectionPageJsonLd
} from './structured-data.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Adds the LLM fetchers to the original list — they unfurl links too, and an
// empty shell is what teaches an assistant this store has no products.
export const BOT_UA_RE =
  /([Bb]ot|[Cc]rawler|[Ss]pider|facebookexternalhit|Slackbot|Twitterbot|WhatsApp|TelegramBot|Discordbot|LinkedInBot|Pinterest|Googlebot|bingbot|DuckDuckBot|Baiduspider|YandexBot|Applebot|GPTBot|OAI-SearchBot|ChatGPT-User|PerplexityBot|ClaudeBot|Claude-Web|Amazonbot|meta-externalagent)/

export const isBotUserAgent = (ua) => BOT_UA_RE.test(String(ua || ''))

// The full column list. If a deployment's products table predates any of these
// columns PostgREST answers 400 and we retry with the guaranteed-present set —
// degraded meta beats no meta.
const PRODUCT_COLUMNS =
  'id,slug,name,description,price,images,category,sku,in_stock,stock_quantity,track_inventory,allow_backorder,is_digital,meta_title,meta_description,search_keywords'
const PRODUCT_COLUMNS_MINIMAL = 'id,slug,name,description,price,images,category,meta_title,meta_description'

let warnedMissingKey = false

/**
 * Every silent-failure path in the old renderer funnels through here. When
 * VITE_SUPABASE_ANON_KEY is unset on Vercel the previous code returned null
 * from fetchProduct() and shipped the generic shell with no log line, so the
 * outage was invisible. Now it logs loudly (once per process) and the caller
 * still renders valid page-level meta from the path alone.
 */
function warnMissingKey(where) {
  if (warnedMissingKey) return
  warnedMissingKey = true
  console.error(
    `[bot-meta] VITE_SUPABASE_ANON_KEY is not set — ${where} cannot load product data. ` +
      'Crawlers will get generic page meta instead of per-product cards. ' +
      'Set VITE_SUPABASE_ANON_KEY in the deployment environment.'
  )
}

async function supabaseSelect(cfg, table, query, columns, fallbackColumns) {
  if (!cfg.anonKey) {
    warnMissingKey(`${table} lookup`)
    return null
  }
  const headers = { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` }
  const run = async (cols) => {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${query}&select=${cols}`, { headers })
    if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => '') }
    return { ok: true, rows: await res.json() }
  }
  let out = await run(columns)
  if (!out.ok && out.status === 400 && fallbackColumns) {
    console.error(`[bot-meta] ${table} select rejected (${out.status}: ${clip(out.body, 200)}) — retrying with minimal columns`)
    out = await run(fallbackColumns)
  }
  if (!out.ok) {
    console.error(`[bot-meta] ${table} select failed (${out.status}): ${clip(out.body, 200)}`)
    return null
  }
  return out.rows
}

const titleCase = (slug) =>
  String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()

const HOME_CRUMB = { name: 'Home', url: '/' }

// Static page copy. Keeping it in one table means a page that gains real data
// later only has to override the fields it can fill.
const STATIC_PAGES = {
  '/catalog': {
    title: `Shop Custom Printed Designs | ${SITE_NAME}`,
    description:
      'Browse the full Imagine This Printed catalog — custom apparel, DTF transfers, 3D prints, metal art and more, printed to order.',
    crumbs: [HOME_CRUMB, { name: 'Catalog', url: '/catalog' }],
    collection: 'Catalog'
  },
  '/community': {
    title: `Community Showcase | ${SITE_NAME}`,
    description:
      'See what the Imagine This Printed community is making — customer designs, prints in the wild, and featured creations.',
    crumbs: [HOME_CRUMB, { name: 'Community', url: '/community' }],
    // Sign-in gated: fine to unfurl, wrong to index.
    noindex: true
  },
  '/imagination-station': {
    title: `Imagination Station — Design It Yourself | ${SITE_NAME}`,
    description:
      'Describe what you want and watch it become a printable design. Create custom shirts, transfers and prints in the Imagination Station.',
    crumbs: [HOME_CRUMB, { name: 'Imagination Station', url: '/imagination-station' }]
  },
  '/wholesale': {
    title: `Wholesale & Bulk Custom Printing | ${SITE_NAME}`,
    description: 'Bulk pricing on custom apparel, DTF transfers and promotional printing for businesses, teams and events.',
    crumbs: [HOME_CRUMB, { name: 'Wholesale', url: '/wholesale' }],
    noindex: true
  },
  '/contact': {
    title: `Contact Us | ${SITE_NAME}`,
    description: `Questions about an order or a custom project? Reach the Imagine This Printed team.`,
    crumbs: [HOME_CRUMB, { name: 'Contact', url: '/contact' }]
  }
}

/**
 * Resolve a request path to a <head> fragment, or null when the path has no
 * bot-specific treatment (caller serves the plain shell).
 *
 * @returns {Promise<string|null>}
 */
export async function resolveHeadForPath(pathname, { supabaseUrl, anonKey, siteUrl = SITE_URL } = {}) {
  const cfg = { supabaseUrl: String(supabaseUrl || '').replace(/\/$/, ''), anonKey, siteUrl }
  const path = '/' + String(pathname || '/').split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '')
  const org = buildOrganizationJsonLd(siteUrl)

  if (path === '/') {
    return [
      buildMetaTags({
        title: `${SITE_NAME} — Custom Printing & Design`,
        description:
          'Custom printing powered by Mr. Imagine. Design and order custom apparel, DTF transfers, 3D prints, metal art and more.',
        canonical: `${siteUrl}/`,
        image: LOGO_PATH,
        siteUrl
      }),
      jsonLdScript(org),
      jsonLdScript(buildWebSiteJsonLd(siteUrl))
    ].join('\n    ')
  }

  if (path.startsWith('/product/')) {
    return renderProduct(decodeURIComponent(path.slice('/product/'.length)), cfg, org)
  }

  if (path === '/catalog' || path.startsWith('/catalog/')) {
    return renderCatalog(path, cfg, org)
  }

  const staticPage = STATIC_PAGES[path]
  if (staticPage) {
    const canonical = `${siteUrl}${path}`
    return [
      buildMetaTags({
        title: staticPage.title,
        description: staticPage.description,
        canonical,
        image: LOGO_PATH,
        noindex: staticPage.noindex,
        siteUrl
      }),
      jsonLdScript(org),
      jsonLdScript(buildBreadcrumbJsonLd(staticPage.crumbs, siteUrl))
    ].join('\n    ')
  }

  return null
}

async function renderProduct(idOrSlug, cfg, org) {
  const { siteUrl } = cfg
  if (!idOrSlug) return null

  const filter = UUID_RE.test(idOrSlug)
    ? `id=eq.${encodeURIComponent(idOrSlug)}`
    : `slug=eq.${encodeURIComponent(idOrSlug)}`
  const rows = await supabaseSelect(
    cfg,
    'products',
    `${filter}&status=eq.active&limit=1`,
    PRODUCT_COLUMNS,
    PRODUCT_COLUMNS_MINIMAL
  )
  const product = rows?.[0]

  // No row (or no key): still beat the generic site card with catalog-level
  // meta so the link at least unfurls as a shop page, and say so in the log.
  if (!product) {
    console.error(`[bot-meta] no active product for "${idOrSlug}" — serving catalog fallback meta`)
    const canonical = `${siteUrl}/product/${encodeURIComponent(idOrSlug)}`
    return [
      buildMetaTags({
        title: `Custom Printed Designs | ${SITE_NAME}`,
        description: STATIC_PAGES['/catalog'].description,
        canonical,
        image: LOGO_PATH,
        noindex: true,
        siteUrl
      }),
      jsonLdScript(org)
    ].join('\n    ')
  }

  const canonical = `${siteUrl}/product/${product.slug || product.id}`
  const title = product.meta_title || `${product.name} | ${SITE_NAME}`
  const description = clip(product.meta_description || product.description || product.name, 155)
  const productLd = buildProductJsonLd(product, { canonical, description, siteUrl })

  const crumbs = [HOME_CRUMB, { name: 'Catalog', url: '/catalog' }]
  if (product.category) {
    crumbs.push({ name: titleCase(product.category), url: `/catalog/${encodeURIComponent(product.category)}` })
  }
  crumbs.push({ name: product.name, url: canonical })

  return [
    buildMetaTags({
      title,
      description,
      canonical,
      image: productLd.image[0],
      type: 'product',
      keywords: product.search_keywords || undefined,
      siteUrl
    }),
    jsonLdScript(productLd),
    jsonLdScript(buildBreadcrumbJsonLd(crumbs, siteUrl)),
    jsonLdScript(org)
  ].join('\n    ')
}

async function renderCatalog(path, cfg, org) {
  const { siteUrl } = cfg
  const category = path.startsWith('/catalog/') ? decodeURIComponent(path.slice('/catalog/'.length)) : null
  const canonical = `${siteUrl}${category ? `/catalog/${encodeURIComponent(category)}` : '/catalog'}`
  const label = category ? titleCase(category) : 'Catalog'

  const filter = category ? `category=eq.${encodeURIComponent(category)}&status=eq.active` : 'status=eq.active'
  const rows =
    (await supabaseSelect(cfg, 'products', `${filter}&order=updated_at.desc&limit=24`, 'id,slug,name,images')) || []

  const title = category
    ? `${label} — Custom Printed ${label} | ${SITE_NAME}`
    : STATIC_PAGES['/catalog'].title
  const description = category
    ? `Shop custom printed ${label.toLowerCase()} from Imagine This Printed — made to order, shipped fast.`
    : STATIC_PAGES['/catalog'].description

  const crumbs = [HOME_CRUMB, { name: 'Catalog', url: '/catalog' }]
  if (category) crumbs.push({ name: label, url: canonical })

  const firstImage = rows.find((p) => Array.isArray(p.images) && p.images[0])?.images[0]

  return [
    buildMetaTags({ title, description, canonical, image: firstImage || LOGO_PATH, siteUrl }),
    jsonLdScript(
      buildCollectionPageJsonLd({
        name: title,
        description,
        url: canonical,
        siteUrl,
        items: rows.map((p) => ({ name: p.name, url: `/product/${p.slug || p.id}` }))
      })
    ),
    jsonLdScript(buildBreadcrumbJsonLd(crumbs, siteUrl)),
    jsonLdScript(org)
  ].join('\n    ')
}
