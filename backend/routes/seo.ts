// Dynamic sitemap for the storefront. Served from the API but exposed on the
// canonical domain via a vercel.json rewrite of /sitemap.xml → this route
// (robots.txt on the frontend points crawlers at the canonical URL).
import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

const SITE_URL = (process.env.FRONTEND_URL || 'https://www.imaginethisprinted.com').replace(/\/$/, '')

const STATIC_PATHS = ['', '/catalog', '/community', '/imagination-station']

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

router.get('/sitemap.xml', async (_req: Request, res: Response) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, slug, updated_at')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(5000)
    if (error) throw error

    const urls: string[] = []
    for (const path of STATIC_PATHS) {
      urls.push(`  <url><loc>${SITE_URL}${path}</loc><changefreq>daily</changefreq></url>`)
    }
    for (const p of products || []) {
      const lastmod = p.updated_at ? `<lastmod>${new Date(p.updated_at).toISOString().slice(0, 10)}</lastmod>` : ''
      urls.push(`  <url><loc>${SITE_URL}/product/${xmlEscape(String(p.slug || p.id))}</loc>${lastmod}</url>`)
    }

    res
      .set('Content-Type', 'application/xml')
      .set('Cache-Control', 'public, max-age=3600')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`)
  } catch (error: any) {
    console.error('[seo] sitemap failed:', error)
    res.status(500).send('sitemap unavailable')
  }
})

export default router
