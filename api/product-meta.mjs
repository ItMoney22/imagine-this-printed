// Vercel serverless function: bot-only dynamic rendering for /product/* URLs.
// vercel.json routes crawler/unfurler user-agents here; humans keep getting the
// static SPA untouched. Injects per-product title, description, Open Graph,
// Twitter card, canonical and JSON-LD into the SPA shell so shared links and
// search results show the actual design instead of the generic site tags.
//
// Degrades safely: any failure returns the plain SPA shell.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://czzyrmizvjqlifcivrhn.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''
const SITE_URL = 'https://www.imaginethisprinted.com'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function fetchProduct(idOrSlug) {
  if (!SUPABASE_ANON_KEY) return null
  const filter = UUID_RE.test(idOrSlug)
    ? `id=eq.${encodeURIComponent(idOrSlug)}`
    : `slug=eq.${encodeURIComponent(idOrSlug)}`
  const url = `${SUPABASE_URL}/rest/v1/products?${filter}&status=eq.active&select=id,slug,name,description,price,images,category,meta_title,meta_description,search_keywords&limit=1`
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  })
  if (!res.ok) return null
  const rows = await res.json()
  return rows?.[0] || null
}

async function fetchShell() {
  const res = await fetch(`${SITE_URL}/index.html`, { headers: { 'x-meta-fn': '1' } })
  return res.ok ? res.text() : null
}

export default async function handler(req, res) {
  let shell = null
  try {
    const path = String(req.query.path || req.url || '')
    const idOrSlug = decodeURIComponent(path.split('?')[0].replace(/^\/?(product\/)?/, '').replace(/\/+$/, ''))

    const [shellHtml, product] = await Promise.all([fetchShell(), idOrSlug ? fetchProduct(idOrSlug) : null])
    shell = shellHtml

    if (!shell) {
      res.statusCode = 307
      res.setHeader('Location', `/index.html`)
      return res.end()
    }
    if (!product) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'public, s-maxage=300')
      return res.end(shell)
    }

    const title = product.meta_title || `${product.name} | Imagine This Printed`
    const desc = product.meta_description || (product.description || '').replace(/\s+/g, ' ').slice(0, 155)
    const image = Array.isArray(product.images) && product.images[0] ? product.images[0] : `${SITE_URL}/logo.png`
    const canonical = `${SITE_URL}/product/${product.slug || product.id}`

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: desc,
      image,
      url: canonical,
      category: product.category,
      offers: {
        '@type': 'Offer',
        price: Number(product.price) || 0,
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        url: canonical
      }
    }

    const headTags = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    ${product.search_keywords ? `<meta name="keywords" content="${esc(product.search_keywords)}" />` : ''}
    <link rel="canonical" href="${esc(canonical)}" />
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="Imagine This Printed" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${esc(image)}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`

    // Strip the shell's static title/description, then inject ours.
    const html = shell
      .replace(/<title>[\s\S]*?<\/title>/i, '')
      .replace(/<meta\s+name="description"[^>]*>/i, '')
      .replace(/<head>/i, `<head>${headTags}`)

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return res.end(html)
  } catch (err) {
    console.error('[product-meta] failed:', err?.message || err)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (shell) return res.end(shell)
    res.statusCode = 307
    res.setHeader('Location', '/index.html')
    return res.end()
  }
}
