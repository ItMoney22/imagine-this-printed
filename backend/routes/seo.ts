// Dynamic sitemap + product feed for the storefront. Served from the API but exposed on the
// canonical domain via a vercel.json rewrite of /sitemap.xml → this route
// (robots.txt on the frontend points crawlers at the canonical URL).
import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { buildProductFeedXml } from '../services/product-feed.js'

const router = Router()

const SITE_URL = (process.env.FRONTEND_URL || 'https://www.imaginethisprinted.com').replace(/\/$/, '')

const STATIC_PATHS = ['', '/catalog', '/community', '/imagination-station', '/contact', '/privacy', '/terms', '/shipping', '/returns']

// The catalog's own category filter list (src/pages/ProductCatalog.tsx:208).
// Deriving these from DISTINCT products.category instead would emit URLs the
// UI has no filter for — /catalog/:category only renders for these ids.
//
// Vendor storefronts are deliberately NOT listed: the /vendor/storefront/:vendorId
// page was hardcoded mock data (a fake vendor with 127 invented reviews) and was
// removed 2026-10-13 (task 36222110). Add storefronts here when one is built on a
// real vendor table.
const CATEGORY_PATHS = ['dtf-transfers', 'shirts', 'tumblers', 'hoodies', '3d-prints', 'metal-art']

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const absoluteImage = (url: string) =>
  /^https?:\/\//i.test(url) ? url : `${SITE_URL}/${url.replace(/^\//, '')}`

router.get('/sitemap.xml', async (_req: Request, res: Response) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, slug, name, images, updated_at')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(5000)
    if (error) throw error

    const urls: string[] = []
    for (const path of STATIC_PATHS) {
      urls.push(`  <url><loc>${SITE_URL}${path}</loc><changefreq>daily</changefreq></url>`)
    }
    for (const category of CATEGORY_PATHS) {
      urls.push(`  <url><loc>${SITE_URL}/catalog/${category}</loc><changefreq>daily</changefreq></url>`)
    }
    for (const p of products || []) {
      const lastmod = p.updated_at ? `<lastmod>${new Date(p.updated_at).toISOString().slice(0, 10)}</lastmod>` : ''
      // Image entries — this catalog is image-first, so the design art is the
      // thing worth surfacing in Google Images. Capped at 5 per URL (the spec
      // allows 1000; more than a handful is just sitemap bloat here).
      const images = (Array.isArray(p.images) ? p.images : [])
        .filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
        .slice(0, 5)
        .map(
          (u: string) =>
            `<image:image><image:loc>${xmlEscape(absoluteImage(u))}</image:loc>` +
            `<image:title>${xmlEscape(String(p.name || ''))}</image:title></image:image>`
        )
        .join('')
      urls.push(
        `  <url><loc>${SITE_URL}/product/${xmlEscape(String(p.slug || p.id))}</loc>${lastmod}${images}</url>`
      )
    }

    res
      .set('Content-Type', 'application/xml')
      .set('Cache-Control', 'public, max-age=3600')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
          `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>`
      )
  } catch (error: any) {
    console.error('[seo] sitemap failed:', error)
    res.status(500).send('sitemap unavailable')
  }
})

// Product feed (task 1df2f0be): ONE Google RSS 2.0 file that Merchant Center
// free listings, Pinterest catalogs and the ChatGPT merchant program all read.
// Exposed on www as /feeds/products.xml (vercel.json rewrite, like the
// sitemap). Same row filter as the sitemap plus is_active, the storefront
// gate (src/lib/product-visibility.ts) — i.e. what an anon shopper can open.
// The rules for which rows/sizes/prices/images go in live in
// services/product-feed.ts.
router.get('/products.xml', async (_req: Request, res: Response) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, slug, name, description, meta_description, price, images, category, metadata, sizes, colors, status, is_active, product_type')
      .eq('status', 'active')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(5000)
    if (error) throw error

    const { xml } = buildProductFeedXml(products || [], SITE_URL)
    res
      .set('Content-Type', 'application/xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=3600')
      .send(xml)
  } catch (error: any) {
    console.error('[seo] product feed failed:', error)
    res.status(500).send('product feed unavailable')
  }
})

export default router
