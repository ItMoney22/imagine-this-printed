import { describe, it, expect } from 'vitest'

// etsy-receipt-ingest.ts transitively imports backend/lib/supabase.ts (eager
// createClient(), throws without a URL/key) AND backend/services/blank-inventory.ts
// (imports the same singleton). ingestReceipt() takes an injected fake `db` for
// the tables it writes directly (orders, order_items, etsy_listings), so these
// tests never need a real Supabase client for THOSE calls — dummy env values are
// enough to let the module load. Mirrors ai-jobs-worker.claim.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { ingestReceipt } = await import('./etsy-receipt-ingest.js')

// NOTE: ingestReceipt() calls the real decrementBlanksForOrder() on a created
// order (it is not injected — see the file's own comment on why: it's already
// fully self-contained and swallows every failure internally). Against the
// dummy Supabase URL above that means a real fetch attempt that fails fast
// with a connection error, which decrementBlanksForOrder's own top-level
// try/catch swallows — so it never affects these assertions, it just logs.

interface FakeListingRow { listing_id: number; product_id: string }
interface FakeProductRow { id: string; metadata: any }

function makeFakeDb(opts: { etsyListings?: FakeListingRow[]; products?: FakeProductRow[]; productsError?: string } = {}) {
  const etsyListings = opts.etsyListings ?? []
  const products = opts.products ?? []
  const ordersInserted: any[] = []
  const orderItemsInserted: any[] = []
  const seenReceiptIds = new Set<number>()

  return {
    ordersInserted,
    orderItemsInserted,
    from(table: string) {
      if (table === 'etsy_listings') {
        return {
          select() { return this },
          in(_col: string, vals: any[]) {
            const rows = etsyListings.filter((r) => vals.includes(r.listing_id))
            return Promise.resolve({ data: rows, error: null })
          }
        }
      }
      if (table === 'products') {
        return {
          select() { return this },
          in(_col: string, vals: any[]) {
            if (opts.productsError) return Promise.resolve({ data: null, error: { message: opts.productsError } })
            return Promise.resolve({ data: products.filter((r) => vals.includes(r.id)), error: null })
          }
        }
      }
      if (table === 'orders') {
        return {
          insert(row: any) {
            return {
              select() {
                return {
                  single() {
                    if (seenReceiptIds.has(row.etsy_receipt_id)) {
                      return Promise.resolve({
                        data: null,
                        error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_orders_etsy_receipt_id"' }
                      })
                    }
                    seenReceiptIds.add(row.etsy_receipt_id)
                    ordersInserted.push(row)
                    return Promise.resolve({ data: { id: `order-${row.etsy_receipt_id}` }, error: null })
                  }
                }
              }
            }
          }
        }
      }
      if (table === 'order_items') {
        return {
          insert(rows: any[]) {
            orderItemsInserted.push(...rows)
            return Promise.resolve({ error: null })
          }
        }
      }
      throw new Error(`fake db: unexpected table "${table}"`)
    }
  }
}

function baseReceipt(overrides: Record<string, any> = {}) {
  return {
    receipt_id: 12345,
    name: 'Jane Buyer',
    first_line: '123 Main St',
    second_line: null,
    city: 'Rockmart',
    state: 'GA',
    zip: '30153',
    country_iso: 'US',
    was_paid: true,
    message_from_buyer: null,
    subtotal: { amount: 2500, divisor: 100, currency_code: 'USD' },
    total_price: { amount: 2800, divisor: 100, currency_code: 'USD' },
    total_shipping_cost: { amount: 300, divisor: 100, currency_code: 'USD' },
    total_tax_cost: { amount: 0, divisor: 100, currency_code: 'USD' },
    discount_amt: { amount: 0, divisor: 100, currency_code: 'USD' },
    created_timestamp: 1700000000,
    updated_timestamp: 1700000100,
    transactions: [
      {
        transaction_id: 999,
        listing_id: 555,
        title: 'Walk By Faith Tee',
        quantity: 1,
        price: { amount: 2500, divisor: 100, currency_code: 'USD' },
        variations: [
          { formatted_name: 'Size', formatted_value: 'M' },
          { formatted_name: 'Primary color', formatted_value: 'Black' }
        ]
      }
    ],
    ...overrides
  }
}

describe('ingestReceipt', () => {
  it('creates exactly one order + order_items row, mapping listing_id -> product_id and extracting size/color', async () => {
    const db = makeFakeDb({ etsyListings: [{ listing_id: 555, product_id: 'prod-abc' }] })
    const result = await ingestReceipt(baseReceipt() as any, db as any)

    expect(result.created).toBe(true)
    expect(result.orderId).toBe('order-12345')
    expect(db.ordersInserted).toHaveLength(1)
    expect(db.ordersInserted[0]).toMatchObject({
      order_number: 'ETSY-12345',
      source: 'etsy',
      etsy_receipt_id: 12345,
      payment_status: 'paid',
      status: 'processing',
      payment_method: 'etsy',
      total: 28,
      subtotal: 25
    })
    expect(db.orderItemsInserted).toHaveLength(1)
    expect(db.orderItemsInserted[0]).toMatchObject({
      order_id: 'order-12345',
      product_id: 'prod-abc',
      quantity: 1,
      unit_price: 25,
      subtotal: 25
    })
    expect(db.orderItemsInserted[0].metadata).toMatchObject({ size: 'M', color: 'Black', etsy_listing_id: 555 })
  })

  it('does not create a second order for the same receipt on a repeat poll (idempotent via DB unique violation)', async () => {
    const db = makeFakeDb({ etsyListings: [{ listing_id: 555, product_id: 'prod-abc' }] })

    const first = await ingestReceipt(baseReceipt() as any, db as any)
    const second = await ingestReceipt(baseReceipt() as any, db as any) // simulates the poller re-fetching the same receipt

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.reason).toBe('duplicate')
    expect(db.ordersInserted).toHaveLength(1) // still just one order for this receipt
  })

  it('skips receipts that are not paid yet without creating an order', async () => {
    const db = makeFakeDb()
    const result = await ingestReceipt(baseReceipt({ was_paid: false }) as any, db as any)
    expect(result).toEqual({ created: false, orderId: null, reason: 'not_paid_yet' })
    expect(db.ordersInserted).toHaveLength(0)
  })

  it('still creates the order when a transaction listing has no etsy_listings mapping (product_id null, not dropped)', async () => {
    const db = makeFakeDb({ etsyListings: [] }) // no mapping at all
    const result = await ingestReceipt(baseReceipt() as any, db as any)
    expect(result.created).toBe(true)
    expect(db.orderItemsInserted[0].product_id).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Personalization — the Etsy half of David's 2026-09-02 ask: "we made a shirt
// for a football team we should be able to let the customer change name jersey
// number etc ... translate that to our Etsy store."
//
// Etsy hands over ONE free-text string. These tests pin the whole journey from
// that string to a press file on the order line, including the two ways it can
// go wrong — a buyer who typed something unreadable, and a render that fails.
// ---------------------------------------------------------------------------

const TEAM_TEMPLATE = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
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

function personalizedReceipt(text: string | null, overrides: Record<string, any> = {}) {
  const variations: any[] = [{ formatted_name: 'Size', formatted_value: 'L' }]
  if (text !== null) variations.push({ property_id: 54, formatted_name: 'Personalization', formatted_value: text })
  return baseReceipt({
    receipt_id: 777001,
    transactions: [
      {
        transaction_id: 4242,
        listing_id: 555,
        title: 'Spartans Team Tee',
        quantity: 1,
        price: { amount: 3000, divisor: 100, currency_code: 'USD' },
        variations
      }
    ],
    ...overrides
  })
}

const teamDb = (extra: Record<string, any> = {}) =>
  makeFakeDb({
    etsyListings: [{ listing_id: 555, product_id: 'prod-spartans' }],
    products: [{ id: 'prod-spartans', metadata: { team_template: TEAM_TEMPLATE } }],
    ...extra
  })

describe('ingestReceipt personalization', () => {
  it('parses the buyer text into field values and renders the press file at full canvas width', async () => {
    const db = teamDb()
    const rendered: any[] = []
    const result = await ingestReceipt(personalizedReceipt('Last name: Smith | Number: 22') as any, db as any, {
      renderPlate: async (template, values) => {
        rendered.push({ width: template.canvas.w, values })
        return { path: 'users/system/team-plates/abc-3600.png' }
      }
    })

    expect(result.created).toBe(true)
    const meta = db.orderItemsInserted[0].metadata
    expect(meta.personalization).toEqual({ name: 'SMITH', number: '22' })
    expect(meta.print_file_path).toBe('users/system/team-plates/abc-3600.png')
    expect(meta.print_file_error).toBeNull()
    expect(meta.personalization_text).toBe('Last name: Smith | Number: 22')
    // Press width, the same call the website checkout makes — not a preview.
    expect(rendered).toEqual([{ width: 3600, values: { name: 'SMITH', number: '22' } }])
  })

  it('reads an unlabelled "SMITH 22" the same way', async () => {
    const db = teamDb()
    await ingestReceipt(personalizedReceipt('SMITH 22') as any, db as any, {
      renderPlate: async () => ({ path: 'p.png' })
    })
    expect(db.orderItemsInserted[0].metadata.personalization).toEqual({ name: 'SMITH', number: '22' })
  })

  it('also puts the values on the order metadata snapshot, not just the line', async () => {
    const db = teamDb()
    await ingestReceipt(personalizedReceipt('LOPEZ 41') as any, db as any, {
      renderPlate: async () => ({ path: 'p.png' })
    })
    expect(db.ordersInserted[0].metadata.items[0].personalization).toEqual({ name: 'LOPEZ', number: '41' })
  })

  it('refuses to draw half a plate, and says which field is missing', async () => {
    const db = teamDb()
    let drew = false
    await ingestReceipt(personalizedReceipt('SMITH') as any, db as any, {
      renderPlate: async () => { drew = true; return { path: 'p.png' } }
    })
    const meta = db.orderItemsInserted[0].metadata
    expect(drew).toBe(false)
    expect(meta.print_file_path).toBeNull()
    expect(meta.print_file_error).toBe('unreadable_personalization')
    expect(meta.personalization_missing).toEqual(['number'])
    expect(meta.personalization_text).toBe('SMITH')
  })

  it('flags a personalizable listing that arrived with an empty box', async () => {
    const db = teamDb()
    await ingestReceipt(personalizedReceipt(null) as any, db as any, {
      renderPlate: async () => ({ path: 'p.png' })
    })
    const meta = db.orderItemsInserted[0].metadata
    expect(meta.print_file_error).toBe('missing_personalization')
    expect(meta.personalization_missing).toEqual(['name', 'number'])
  })

  it('still creates the order when the render fails, and records why', async () => {
    const db = teamDb()
    await ingestReceipt(personalizedReceipt('SMITH 22') as any, db as any, {
      renderPlate: async () => { throw new Error('font missing') }
    })
    const meta = db.orderItemsInserted[0].metadata
    expect(meta.personalization).toEqual({ name: 'SMITH', number: '22' })
    expect(meta.print_file_path).toBeNull()
    expect(meta.print_file_error).toBe('font missing')
  })

  it('carries a review flag through to the line without refusing the sale', async () => {
    const db = teamDb()
    const result = await ingestReceipt(personalizedReceipt('NIKE 22') as any, db as any, {
      renderPlate: async () => ({ path: 'p.png' })
    })
    expect(result.created).toBe(true)
    expect(db.orderItemsInserted[0].metadata.personalization_flags?.length).toBeGreaterThan(0)
  })

  it('keeps the buyer text when the product has no template at all', async () => {
    const db = makeFakeDb({
      etsyListings: [{ listing_id: 555, product_id: 'prod-plain' }],
      products: [{ id: 'prod-plain', metadata: {} }]
    })
    await ingestReceipt(personalizedReceipt('Grandma 2026') as any, db as any, {
      renderPlate: async () => ({ path: 'p.png' })
    })
    const meta = db.orderItemsInserted[0].metadata
    expect(meta.personalization_text).toBe('Grandma 2026')
    expect(meta.print_file_error).toBe('no_template')
  })

  it('leaves an ordinary sale with no personalization keys set', async () => {
    const db = makeFakeDb({
      etsyListings: [{ listing_id: 555, product_id: 'prod-abc' }],
      products: [{ id: 'prod-abc', metadata: {} }]
    })
    await ingestReceipt(baseReceipt() as any, db as any)
    const meta = db.orderItemsInserted[0].metadata
    expect(meta.personalization).toBeNull()
    expect(meta.personalization_text).toBeNull()
    expect(meta.print_file_error).toBeNull()
  })

  it('still ingests the sale when the products lookup itself fails', async () => {
    const db = teamDb({ productsError: 'connection reset' })
    const result = await ingestReceipt(personalizedReceipt('SMITH 22') as any, db as any, {
      renderPlate: async () => ({ path: 'p.png' })
    })
    expect(result.created).toBe(true)
    // No template in hand, so the words are kept for a human rather than guessed at.
    expect(db.orderItemsInserted[0].metadata.personalization_text).toBe('SMITH 22')
  })
})
