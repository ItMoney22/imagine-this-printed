// Path → <head> resolution. fetch is stubbed, so these are offline and fast.
// The case that matters most is the one that used to fail silently: no
// VITE_SUPABASE_ANON_KEY must produce a loud log AND valid fallback meta.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isBotUserAgent, resolveHeadForPath } from './bot-meta.mjs'
import { SITE_URL } from './structured-data.mjs'

const CFG = { supabaseUrl: 'https://db.test', anonKey: 'anon-key', siteUrl: SITE_URL }

const PRODUCT_ROW = {
  id: '11111111-2222-3333-4444-555555555555',
  slug: 'galaxy-cat-tee',
  name: 'Galaxy Cat Tee',
  description: 'A cat. In space.',
  price: 24.5,
  images: ['/uploads/cat.png'],
  category: 'shirts',
  in_stock: true,
  track_inventory: false,
  stock_quantity: 0
}

/** Pull every JSON-LD block out of a rendered head and parse it. */
function jsonLdBlocks(head) {
  return [...head.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1])
  )
}

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [PRODUCT_ROW], text: async () => '' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isBotUserAgent', () => {
  it('matches unfurlers, crawlers and LLM fetchers', () => {
    for (const ua of ['Googlebot/2.1', 'facebookexternalhit/1.1', 'Slackbot-LinkExpanding', 'GPTBot/1.0', 'PerplexityBot']) {
      expect(isBotUserAgent(ua)).toBe(true)
    }
  })
  it('does not match a real browser', () => {
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe(false)
    expect(isBotUserAgent(undefined)).toBe(false)
  })
})

describe('resolveHeadForPath', () => {
  it('renders Product + BreadcrumbList + Organization for a product url', async () => {
    const head = await resolveHeadForPath('/product/galaxy-cat-tee', CFG)
    const blocks = jsonLdBlocks(head)
    expect(blocks.map((b) => b['@type'])).toEqual(['Product', 'BreadcrumbList', 'Organization'])
    expect(blocks[0].offers.availability).toBe('https://schema.org/InStock')
    expect(head).toContain(`<link rel="canonical" href="${SITE_URL}/product/galaxy-cat-tee" />`)
    expect(head).toContain('<meta property="og:type" content="product" />')
  })

  it('renders CollectionPage + BreadcrumbList for a category url', async () => {
    const head = await resolveHeadForPath('/catalog/shirts', CFG)
    const blocks = jsonLdBlocks(head)
    expect(blocks.map((b) => b['@type'])).toEqual(['CollectionPage', 'BreadcrumbList', 'Organization'])
    expect(head).toContain(`<link rel="canonical" href="${SITE_URL}/catalog/shirts" />`)
  })

  it('renders Organization + WebSite for the site root', async () => {
    const head = await resolveHeadForPath('/', CFG)
    expect(jsonLdBlocks(head).map((b) => b['@type'])).toEqual(['Organization', 'WebSite'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks the sign-in gated community page noindex', async () => {
    const head = await resolveHeadForPath('/community', CFG)
    expect(head).toContain('<meta name="robots" content="noindex,follow" />')
  })

  it('returns null for paths with no bot treatment', async () => {
    expect(await resolveHeadForPath('/admin/dashboard', CFG)).toBeNull()
    expect(await resolveHeadForPath('/cart', CFG)).toBeNull()
  })

  it('logs loudly and still renders valid meta when the anon key is missing', async () => {
    const head = await resolveHeadForPath('/product/galaxy-cat-tee', { ...CFG, anonKey: '' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('VITE_SUPABASE_ANON_KEY is not set'))
    // Fallback is real, parseable meta — not a silent empty shell.
    expect(head).toContain('<title>')
    expect(jsonLdBlocks(head).map((b) => b['@type'])).toEqual(['Organization'])
  })

  it('retries with a minimal column set when PostgREST rejects the select', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'column products.sku does not exist' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PRODUCT_ROW], text: async () => '' })
    const head = await resolveHeadForPath('/product/galaxy-cat-tee', CFG)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(jsonLdBlocks(head)[0]['@type']).toBe('Product')
  })
})
