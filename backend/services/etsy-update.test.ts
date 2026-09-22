// Tests for updateEtsyListing — the path that pushes a pricing/variation
// change onto a listing that is ALREADY on Etsy.
//
// This route did not exist until 2026-09-07, even though publishProductToEtsy
// has always refused an already-published product with "use update instead of
// re-posting". Repricing the two live listings for the youth/plus-size change
// had to be done by hand from a local script, against live listings, with no
// test anywhere. These are the cases that script had to get right.
//
// Supabase is stubbed (the real client is built eagerly at import) and global
// fetch stands in for Etsy, so nothing here touches either service.
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.ETSY_KEYSTRING = 'test-keystring'
process.env.ETSY_SHARED_SECRET = 'test-secret'

// --- Supabase stub ---------------------------------------------------------
// Chainable enough for the three reads (products, etsy_listings,
// etsy_connection) and the one write (etsy_listings) the update path makes.
const db: Record<string, any> = {}
const writes: Array<{ table: string; values: any }> = []

vi.mock('../lib/supabase.js', () => {
  const builder = (table: string) => {
    const chain: any = {
      _table: table,
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      not: () => chain,
      limit: () => Promise.resolve({ data: db[table] ?? [], error: null }),
      maybeSingle: () => Promise.resolve({ data: db[table] ?? null, error: null }),
      update: (values: any) => {
        writes.push({ table, values })
        const done: any = { eq: () => done, then: (r: any) => r({ error: null }) }
        return done
      },
      upsert: (values: any) => {
        writes.push({ table, values })
        return Promise.resolve({ error: null })
      }
    }
    return chain
  }
  return { supabase: { from: (t: string) => builder(t) } }
})

const { updateEtsyListing, resolveListingCopy, personalizationFieldsFor } = await import('./etsy.js')

// --- Etsy stub -------------------------------------------------------------
type Call = { method: string; path: string; body: any }
let calls: Call[] = []
let listingState = 'active'
let listingMissing = false

const SIZE_PROPERTY_ID = 62809790533

function etsyStub() {
  return vi.fn(async (url: string, init: any = {}) => {
    const path = String(url).replace('https://api.etsy.com/v3', '')
    const method = init.method || 'GET'
    let parsed: any = null
    if (typeof init.body === 'string') { try { parsed = JSON.parse(init.body) } catch { /* form */ } }
    else if (init.body instanceof URLSearchParams) parsed = Object.fromEntries(init.body as any)
    calls.push({ method, path, body: parsed })

    const ok = (json: any) => ({ ok: true, status: 200, json: async () => json, headers: new Map() } as any)

    if (method === 'GET' && /^\/application\/listings\/\d+$/.test(path)) {
      if (listingMissing) {
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }), headers: new Map() } as any
      }
      return ok({ listing_id: 4544388862, state: listingState, taxonomy_id: 482, title: 'Live Title', price: { amount: 2500, divisor: 100, currency_code: 'USD' } })
    }
    if (method === 'GET' && /inventory$/.test(path)) {
      return ok({
        price_on_property: [],
        products: [{
          property_values: [
            { property_id: SIZE_PROPERTY_ID, property_name: 'Size', values: ['M'] },
            { property_id: 200, property_name: 'Primary color', values: ['Black'] }
          ],
          offerings: [{ price: { amount: 2500, divisor: 100 }, quantity: 25, is_enabled: true, readiness_state_id: 999 }]
        }]
      })
    }
    if (method === 'GET' && /properties$/.test(path)) {
      return ok({
        results: [{
          property_id: SIZE_PROPERTY_ID, name: 'Size', display_name: 'Size', supports_variations: true,
          possible_values: [{ value_id: 1, name: 'S' }, { value_id: 2, name: 'M' }, { value_id: 3, name: 'L' }],
          scales: [{ scale_id: 51, display_name: 'Unisex letter size' }]
        }, {
          property_id: 200, name: 'Primary color', display_name: 'Primary color', supports_variations: true, possible_values: []
        }]
      })
    }
    return ok({ ok: true })
  })
}

beforeEach(() => {
  calls = []
  writes.length = 0
  listingState = 'active'
  listingMissing = false
  db.products = { id: 'p1', name: 'Alien Directive Tee', description: 'd', price: 25, images: [], category: 't-shirts', metadata: { product_type: 'tshirt', etsy_pack: { price: 25, title: 'Pack Title', description: 'Pack desc', tags: ['alien'], colors: ['Black'] } } }
  db.etsy_listings = { listing_id: 4544388862, state: 'active' }
  db.etsy_connection = { access_token: 'tok', refresh_token: 'r', access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(), shop_id: 67055923 }
  vi.stubGlobal('fetch', etsyStub())
})

const put = () => calls.find(c => c.method === 'PUT' && /inventory$/.test(c.path))
const patch = () => calls.find(c => c.method === 'PATCH')

describe('updateEtsyListing', () => {
  it('repushes the full size axis with per-size pricing onto a live listing', async () => {
    const r = await updateEtsyListing('p1')
    expect(r.ok).toBe(true)
    expect(r.updated.variations).toBe(true)
    expect(r.state).toBe('active')

    const body = put()!.body
    const labels = body.products.map((p: any) =>
      p.property_values.find((pv: any) => pv.property_name === 'Size').values[0])
    expect(labels).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL', 'Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL'])

    const priced = Object.fromEntries(body.products.map((p: any) => [
      p.property_values.find((pv: any) => pv.property_name === 'Size').values[0],
      p.offerings[0].price
    ]))
    expect(priced['M']).toBe(25)
    expect(priced['2XL']).toBe(27.5)
    expect(priced['Youth M']).toBe(22)
  })

  it('turns on per-size pricing via price_on_property', async () => {
    await updateEtsyListing('p1')
    expect(put()!.body.price_on_property).toEqual([SIZE_PROPERTY_ID])
  })

  it('does NOT rewrite the listing copy unless asked', async () => {
    // Rewriting a live listing's title is an SEO event, not a price correction.
    const r = await updateEtsyListing('p1')
    expect(r.updated.copy).toBe(false)
    expect(patch()).toBeUndefined()
  })

  it('rewrites copy when asked, and still never PATCHes price onto a variation listing', async () => {
    // Etsy derives a variation listing's price from its inventory; pushing
    // price through the listing PATCH is ignored at best and a 400 at worst.
    const r = await updateEtsyListing('p1', { copy: true })
    expect(r.updated.copy).toBe(true)
    expect(patch()!.body.title).toBe('Pack Title')
    expect(patch()!.body.price).toBeUndefined()
  })

  it('preserves the live colour axis rather than flattening it', async () => {
    await updateEtsyListing('p1')
    const body = put()!.body
    const colors = new Set(body.products.map((p: any) =>
      p.property_values.find((pv: any) => pv.property_name === 'Primary color')?.values[0]))
    expect([...colors]).toEqual(['Black'])
  })

  it('falls back to the colours already on Etsy when the pack has none', async () => {
    db.products.metadata.etsy_pack.colors = []
    await updateEtsyListing('p1')
    const colors = new Set(put()!.body.products.map((p: any) =>
      p.property_values.find((pv: any) => pv.property_name === 'Primary color')?.values[0]))
    expect([...colors]).toEqual(['Black'])
  })

  it('carries the readiness state the live listing already uses', async () => {
    // Etsy rejects offerings with no readiness state — hit live 2026-07-26.
    await updateEtsyListing('p1')
    expect(put()!.body.products[0].offerings[0].readiness_state_id).toBe(999)
  })

  it('dry run computes the whole change and writes NOTHING', async () => {
    const r = await updateEtsyListing('p1', { dryRun: true })
    expect(r.ok).toBe(true)
    expect(r.dryRun).toBe(true)
    expect(r.updated).toEqual({ copy: false, variations: false, personalization: false })
    expect(r.prices!['2XL']).toBe(27.5)
    expect(r.prices!['Youth M']).toBe(22)
    expect(calls.some(c => c.method === 'PUT' || c.method === 'PATCH')).toBe(false)
    expect(writes.length).toBe(0)
  })

  it('refuses a product that has no listing yet, pointing at publish', async () => {
    db.etsy_listings = null
    const r = await updateEtsyListing('p1')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no primary Etsy listing to update/i)
    expect(calls.some(c => c.method === 'PUT')).toBe(false)
  })

  it('never creates a listing when the ledger points at a deleted one', async () => {
    // A stale ledger row is exactly how the publish path once got stuck in a
    // permanent bogus "already has listing" loop. Update must not silently
    // re-list either — it marks the row removed and says to publish.
    listingMissing = true
    const r = await updateEtsyListing('p1')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no longer exists/i)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    expect(writes.some(w => w.values.state === 'removed')).toBe(true)
  })

  it('refuses a removed listing instead of writing to a dead one', async () => {
    listingState = 'removed'
    const r = await updateEtsyListing('p1')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/removed/i)
    expect(calls.some(c => c.method === 'PUT')).toBe(false)
  })

  it('updates a DRAFT listing too, not just an active one', async () => {
    listingState = 'draft'
    const r = await updateEtsyListing('p1')
    expect(r.ok).toBe(true)
    expect(r.state).toBe('draft')
    expect(r.updated.variations).toBe(true)
  })

  it('honours a price override across the whole axis', async () => {
    const r = await updateEtsyListing('p1', { priceOverride: 40, dryRun: true })
    expect(r.basePrice).toBe(40)
    expect(r.prices!['M']).toBe(40)
    expect(r.prices!['2XL']).toBe(42.5)
    expect(r.prices!['Youth M']).toBe(37)
  })

  it('never re-categorises: it reuses the listing\'s own taxonomy', async () => {
    // Changing taxonomy_id on a listing that already has variations
    // invalidates its property ids and wipes the axis.
    await updateEtsyListing('p1')
    expect(calls.some(c => c.path.includes('/seller-taxonomy/nodes/482/properties'))).toBe(true)
    expect(patch()?.body?.taxonomy_id).toBeUndefined()
  })

  it('records the sync on the ledger and clears any previous error', async () => {
    await updateEtsyListing('p1')
    const synced = writes.find(w => w.table === 'etsy_listings' && w.values.last_synced_at)
    expect(synced).toBeTruthy()
    expect(synced!.values.last_error).toBeNull()
  })
})

describe('resolveListingCopy — publish and update must derive copy identically', () => {
  const product = {
    name: 'Fallback Name',
    description: 'Fallback description',
    meta_title: 'Meta Title',
    meta_description: null,
    search_keywords: 'alien, retro',
    metadata: { etsy_pack: { title: 'Pack Title', description: 'Pack description', tags: ['alien', 'retro tee'] } }
  }

  it('prefers the composed pack over the website fields', () => {
    const c = resolveListingCopy(product, 'primary')
    expect(c.title).toBe('Pack Title')
    expect(c.description).toBe('Pack description')
    expect(c.tags).toEqual(['alien', 'retro tee'])
  })

  it('falls back to the website fields when there is no pack', () => {
    const c = resolveListingCopy({ ...product, metadata: {} }, 'primary')
    expect(c.title).toContain('Meta Title')
    expect(c.description).toBe('Fallback description')
  })

  it('caps tags at Etsy\'s limit even from a hand-edited pack', () => {
    const many = { ...product, metadata: { etsy_pack: { tags: Array.from({ length: 40 }, (_, i) => `tag${i}`) } } }
    expect(resolveListingCopy(many, 'primary').tags.length).toBeLessThanOrEqual(13)
  })

  it('never exceeds the title limit', () => {
    const long = { ...product, metadata: { etsy_pack: { title: 'x'.repeat(400) } } }
    expect(resolveListingCopy(long, 'primary').title.length).toBeLessThanOrEqual(140)
  })
})

// ---------------------------------------------------------------------------
// Personalization sync — David 2026-09-02: "we made a shirt for a football team
// we should be able to let the customer change name jersey number etc ...
// translate that to our Etsy store." An Etsy listing that does not carry
// is_personalizable has no box for the buyer to type into, so the shirt sells
// there with no name on it at all.
// ---------------------------------------------------------------------------

const TEAM_TEMPLATE = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 5,
  fields: [
    {
      key: 'name', label: 'Last name', type: 'text', max: 12, placeholder: 'SMITH', uppercase: true,
      zone: { x: 220, y: 380, w: 3160, h: 900 }, arch: 18,
      font: { family: 'collegiate-slab', src: 'house' }, fill: '#8C1D2D', strokes: [], offset: null
    },
    {
      key: 'number', label: 'Number', type: 'number', max: 2, placeholder: '22', uppercase: false,
      zone: { x: 900, y: 1500, w: 1800, h: 2400 }, arch: 0,
      font: { family: 'varsity-block', src: 'house' }, fill: '#C9A227', strokes: [], offset: null
    }
  ]
}

const withTemplate = () => {
  db.products = { ...db.products, metadata: { ...db.products.metadata, team_template: TEAM_TEMPLATE } }
}

describe('updateEtsyListing personalization', () => {
  it('leaves a listing alone when the product has no team template', async () => {
    const r = await updateEtsyListing('p1')
    expect(r.updated.personalization).toBe(false)
    expect(patch()).toBeUndefined()
  })

  it('pushes is_personalizable, the character cap and the instructions', async () => {
    withTemplate()
    const r = await updateEtsyListing('p1')
    expect(r.updated.personalization).toBe(true)
    const body = patch()!.body
    expect(body.is_personalizable).toBe('true')
    expect(body.personalization_is_required).toBe('true')
    expect(Number(body.personalization_char_count_max)).toBeGreaterThan(0)
    expect(body.personalization_instructions).toContain('Last name: SMITH')
    expect(body.personalization_instructions).toContain('Number: 22')
  })

  it('rides along with the copy PATCH instead of spending a second call', async () => {
    withTemplate()
    await updateEtsyListing('p1', { copy: true })
    const patches = calls.filter(c => c.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(patches[0].body.title).toBeTruthy()
    expect(patches[0].body.is_personalizable).toBe('true')
  })

  it('reports what it WOULD write on a dry run without writing it', async () => {
    withTemplate()
    const r = await updateEtsyListing('p1', { dryRun: true })
    expect(r.personalization?.is_personalizable).toBe(true)
    expect(r.updated.personalization).toBe(false)
    expect(patch()).toBeUndefined()
  })

  it('can be switched off for a caller that only wants prices moved', async () => {
    withTemplate()
    const r = await updateEtsyListing('p1', { personalization: false })
    expect(r.updated.personalization).toBe(false)
    expect(patch()).toBeUndefined()
  })
})

describe('personalizationFieldsFor', () => {
  it('is null for a product with no template', () => {
    expect(personalizationFieldsFor({ product_type: 'tshirt' }, 'primary')).toBeNull()
  })

  it('is null for the digital download tier — there is no press run to name', () => {
    expect(personalizationFieldsFor({ team_template: TEAM_TEMPLATE }, 'download')).toBeNull()
  })

  it('derives the four Etsy fields from the template', () => {
    const fields = personalizationFieldsFor({ team_template: TEAM_TEMPLATE }, 'primary')
    expect(fields).toMatchObject({ is_personalizable: true, personalization_is_required: true })
    expect(fields!.personalization_char_count_max).toBeLessThanOrEqual(1024)
  })
})
