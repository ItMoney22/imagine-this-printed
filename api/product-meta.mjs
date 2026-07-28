// Vercel serverless function: bot-only dynamic rendering.
//
// vercel.json routes crawler/unfurler user-agents here for /product/*,
// /catalog*, and the other shell-only routes; humans keep getting the static
// SPA untouched. The per-path <head> (meta + JSON-LD) is built in
// api/_seo/bot-meta.mjs so the Express static server (server-static.mjs) can
// serve byte-identical markup on the Railway deploy.
//
// Degrades safely: any failure returns the plain SPA shell, and every degraded
// path now logs — the silent-null behaviour when VITE_SUPABASE_ANON_KEY was
// unset is what made the previous outage invisible.

import { SITE_URL, injectHead } from './_seo/structured-data.mjs'
import { resolveHeadForPath } from './_seo/bot-meta.mjs'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://czzyrmizvjqlifcivrhn.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''

async function fetchShell() {
  const res = await fetch(`${SITE_URL}/index.html`, { headers: { 'x-meta-fn': '1' } })
  return res.ok ? res.text() : null
}

export default async function handler(req, res) {
  let shell = null
  try {
    // vercel.json passes the matched segment(s) as ?path=; req.url is the
    // fallback for a direct hit on the function.
    const raw = String(req.query.path || req.url || '')
    const pathname = raw.startsWith('/') ? raw : `/${raw}`

    const [shellHtml, head] = await Promise.all([
      fetchShell(),
      resolveHeadForPath(pathname, { supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, siteUrl: SITE_URL })
    ])
    shell = shellHtml

    if (!shell) {
      res.statusCode = 307
      res.setHeader('Location', '/index.html')
      return res.end()
    }
    if (!head) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'public, s-maxage=300')
      return res.end(shell)
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return res.end(injectHead(shell, head))
  } catch (err) {
    console.error('[bot-meta] render failed:', err?.message || err)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (shell) return res.end(shell)
    res.statusCode = 307
    res.setHeader('Location', '/index.html')
    return res.end()
  }
}
