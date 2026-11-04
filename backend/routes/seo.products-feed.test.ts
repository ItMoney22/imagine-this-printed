import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// Task 1df2f0be (2026-10-31): GET /api/seo/products.xml is the ONE feed Google
// Merchant Center, Pinterest and the ChatGPT merchant program read. Runs the
// REAL seo router on an ephemeral port; only Supabase is faked.
//
// What matters to Google: the XML parses, every item has the required fields,
// and each variant's price equals what checkout charges for that line
// (computeLineItemCents) — a feed price that differs from the landing page
// gets the listing disapproved.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const SITE = 'https://www.imaginethisprinted.com'
const G = 'http://base.google.com/ns/1.0'

const TEE = 'aaaaaaaa-0000-4000-8000-000000000001'
const HOODIE = 'aaaaaaaa-0000-4000-8000-000000000002'
const METAL = 'aaaaaaaa-0000-4000-8000-000000000003'
const TOY = 'aaaaaaaa-0000-4000-8000-000000000004'
const BLANK = 'aaaaaaaa-0000-4000-8000-000000000005'
const DRAFT = 'aaaaaaaa-0000-4000-8000-000000000006'
const GRUMPY = '868b54ed-1568-473e-a508-5e850fdd965b'

const img = (name: string) => `https://storage.googleapis.com/itp/mockups/${name}.png`

const rows: any[] = [
  {
    id: TEE, slug: 'lion-tee', name: 'Lion Tee', status: 'active', is_active: true, product_type: 'physical',
    description: '<p>A <b>roaring</b> lion &amp; friends.</p>', price: 25, category: 'shirts',
    sizes: ['S', 'M', '2XL', '4XL'], colors: ['#000000', '#FFFFFF'],
    // images[] holds the raw art first; the gallery leads with the garment shot.
    images: [img('raw-art'), img('lion/ghost_mannequin/front'), img('print-file')],
    metadata: { product_type: 'tshirt', assets: { display: img('watermarked'), clean: img('print-file'), dtf: img('dtf') } }
  },
  {
    id: HOODIE, slug: 'moon-hoodie', name: 'Moon Hoodie', status: 'active', is_active: true, product_type: 'physical',
    description: 'Moon.', price: 40, category: 'hoodies', sizes: ['M'], colors: [],
    images: [img('moon/flat_lay/one')], metadata: { shirt_color: 'black' }
  },
  {
    id: METAL, slug: 'orbit', name: 'Orbit Metal Print', status: 'active', is_active: true, product_type: 'physical',
    description: 'Orbit.', price: 8.95, category: 'metal-art', sizes: ['4x6', '8x10'], colors: [],
    images: [img('orbit')], metadata: {}
  },
  {
    id: TOY, slug: 'raptor', name: 'Raptor Toy', status: 'active', is_active: true, product_type: 'physical',
    description: 'Toy.', price: 15.99, category: '3d-prints', sizes: [], colors: [], images: [img('raptor')], metadata: {}
  },
  {
    id: BLANK, slug: 'blank', name: 'Blank Tee', status: 'active', is_active: true, product_type: 'physical',
    description: 'Blank.', price: 3.21, category: 'shirts', sizes: ['S'], colors: ['White'], images: [img('blank')],
    metadata: { garment: { blank: true } }
  },
  {
    id: DRAFT, slug: 'draft', name: 'Draft', status: 'active', is_active: false, product_type: 'physical',
    description: 'Draft.', price: 25, category: 'shirts', images: [img('draft')], metadata: {}
  },
  {
    id: GRUMPY, slug: 'grumpy', name: 'Grumpy Cat Hoodie', status: 'active', is_active: true, product_type: 'physical',
    description: 'Held.', price: 44.99, category: 'hoodies', images: [img('grumpy')], metadata: {}
  }
]

const filters: [string, any][] = []
vi.mock('../lib/supabase.js', () => {
  const b: any = {
    select: () => b,
    eq: (col: string, val: any) => { filters.push([col, val]); return b },
    order: () => b,
    limit: async () => ({
      data: rows.filter(r => filters.every(([c, v]) => r[c] === v)),
      error: null
    })
  }
  return { supabase: { from: () => b } }
})

const { default: seoRouter } = await import('./seo.js')
const { computeLineItemCents } = await import('../services/order-pricing.js')

let base = ''
let server: any
beforeAll(async () => {
  const app = express()
  app.use('/api/seo', seoRouter)
  server = app.listen(0)
  await new Promise(r => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server?.close())

async function fetchFeed() {
  const res = await fetch(`${base}/api/seo/products.xml`)
  const text = await res.text()
  const doc = new JSDOM(text, { contentType: 'application/xml' }).window.document
  const items = Array.from(doc.getElementsByTagName('item')).map(el => {
    const g = (name: string) => Array.from(el.getElementsByTagNameNS(G, name)).map(n => n.textContent || '')
    const plain = (name: string) => el.getElementsByTagName(name)[0]?.textContent || ''
    return { g, plain }
  })
  return { res, text, doc, items }
}

const priceOf = (id: string, size: string | null) =>
  computeLineItemCents({ productId: id, quantity: 1, selectedSize: size }, new Map([[id, rows.find(r => r.id === id).price]]), new Map(), new Map(), id === METAL ? new Set([METAL]) : new Set()).cents

describe('GET /api/seo/products.xml', () => {
  it('is well-formed Google RSS 2.0 with the g: namespace', async () => {
    const { res, doc } = await fetchFeed()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/xml/)
    expect(doc.getElementsByTagName('parsererror').length).toBe(0)
    expect(doc.documentElement.tagName).toBe('rss')
    expect(doc.documentElement.getAttribute('xmlns:g')).toBe(G)
  })

  it('reads only shopper-visible rows (status active AND is_active)', async () => {
    filters.length = 0
    await fetchFeed()
    expect(filters).toEqual(expect.arrayContaining([['status', 'active'], ['is_active', true]]))
  })

  it('every item carries the required Google fields', async () => {
    const { items } = await fetchFeed()
    expect(items.length).toBeGreaterThan(0)
    for (const it of items) {
      expect(it.g('id')[0]).toBeTruthy()
      expect(it.g('id')[0].length).toBeLessThanOrEqual(50)
      expect(it.plain('title').length).toBeGreaterThan(0)
      expect(it.plain('title').length).toBeLessThanOrEqual(150)
      expect(it.plain('description')).not.toMatch(/[<>]/)
      expect(it.plain('link')).toMatch(new RegExp(`^${SITE}/product/`))
      expect(it.g('image_link')[0]).toMatch(/^https:\/\//)
      expect(it.g('availability')).toEqual(['in_stock'])
      expect(it.g('price')[0]).toMatch(/^\d+\.\d{2} USD$/)
      expect(it.g('brand')).toEqual(['Imagine This Printed'])
      expect(it.g('condition')).toEqual(['new'])
      expect(it.g('identifier_exists')).toEqual(['no'])
      expect(it.g('product_type')[0]).toBeTruthy()
      expect(it.g('min_handling_time')).toEqual(['1'])
      expect(it.g('max_handling_time')).toEqual(['3'])
    }
    const ids = items.map(i => i.g('id')[0])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves out blanks, drafts and IP-held products', async () => {
    const { items } = await fetchFeed()
    const groups = new Set(items.map(i => i.g('item_group_id')[0] || i.g('id')[0]))
    expect(groups).toEqual(new Set([TEE, HOODIE, METAL, TOY]))
  })

  it('apparel is one item per size per colour, priced like the checkout line', async () => {
    const { items } = await fetchFeed()
    const tee = items.filter(i => i.g('item_group_id')[0] === TEE)
    // Stored S/M/2XL/4XL plus the youth band the page appends; × Black/White.
    const sizes = Array.from(new Set(tee.map(i => i.g('size')[0])))
    expect(sizes).toEqual(['S', 'M', '2XL', '4XL', 'YXS', 'YS', 'YM', 'YL', 'YXL'])
    expect(tee.length).toBe(sizes.length * 2)
    expect(new Set(tee.map(i => i.g('color')[0]))).toEqual(new Set(['Black', 'White']))
    for (const it of tee) {
      const size = it.g('size')[0]
      expect(it.g('price')[0]).toBe(`${(priceOf(TEE, size) / 100).toFixed(2)} USD`)
      expect(it.g('gender')).toEqual(['unisex'])
      expect(it.g('age_group')).toEqual([size.startsWith('Y') ? 'kids' : 'adult'])
    }
    // The size surcharge is really in there.
    expect(tee.find(i => i.g('size')[0] === '2XL')!.g('price')[0]).toBe('27.50 USD')
    expect(tee.find(i => i.g('size')[0] === 'YM')!.g('price')[0]).toBe('22.00 USD')

    // No colour picker: the one garment colour it was made on.
    const hoodie = items.filter(i => i.g('item_group_id')[0] === HOODIE)
    expect(hoodie.every(i => i.g('color')[0] === 'Black')).toBe(true)
  })

  it('metal prints are one item per panel size at the panel price', async () => {
    const { items } = await fetchFeed()
    const metal = items.filter(i => i.g('item_group_id')[0] === METAL)
    expect(metal.map(i => [i.g('size')[0], i.g('price')[0]])).toEqual([
      ['4x6', `${(priceOf(METAL, '4x6') / 100).toFixed(2)} USD`],
      ['8x10', `${(priceOf(METAL, '8x10') / 100).toFixed(2)} USD`]
    ])
  })

  it('images follow the product-page gallery and never carry the print file', async () => {
    const { items } = await fetchFeed()
    const tee = items.find(i => i.g('item_group_id')[0] === TEE)!
    const all = [...tee.g('image_link'), ...tee.g('additional_image_link')]
    expect(all).toEqual([img('lion/ghost_mannequin/front'), img('watermarked'), img('raw-art')])
    expect(all).not.toContain(img('print-file'))
    expect(all).not.toContain(img('dtf'))
  })

  it('description is plain text', async () => {
    const { items } = await fetchFeed()
    const tee = items.find(i => i.g('item_group_id')[0] === TEE)!
    expect(tee.plain('description')).toBe('A roaring lion & friends.')
  })
})
