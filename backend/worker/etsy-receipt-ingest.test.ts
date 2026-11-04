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

function makeFakeDb(opts: { etsyListings?: FakeListingRow[]; products?: Array<{ id: string; metadata: any }> } = {}) {
  const etsyListings = opts.etsyListings ?? []
  const products = opts.products ?? []
  const ordersInserted: any[] = []
  const orderItemsInserted: any[] = []
  const seenReceiptIds = new Set<number>()

  return {
    ordersInserted,
    orderItemsInserted,
    seenReceiptIds,
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
            return Promise.resolve({ data: products.filter((p) => vals.includes(p.id)), error: null })
          }
        }
      }
      if (table === 'orders') {
        return {
          // petLinesForReceipt's "already an order?" check
          select() {
            return {
              eq(_col: string, receiptId: number) {
                return { maybeSingle: () => Promise.resolve({ data: seenReceiptIds.has(receiptId) ? { id: `order-${receiptId}` } : null, error: null }) }
              }
            }
          },
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

  it('stores the buyer-note flag on the order metadata', async () => {
    const db = makeFakeDb()
    const seen: any[] = []
    const result = await ingestReceipt(
      baseReceipt({ message_from_buyer: 'Name on the back: MARTINEZ 23' }) as any,
      db as any,
      async (message, items) => {
        seen.push({ message, items })
        return { flag: 'personalization', needsReview: false, source: 'jev', confidence: 0.97, floorRules: [], mode: 'on' }
      }
    )
    expect(result.created).toBe(true)
    expect(seen).toEqual([{ message: 'Name on the back: MARTINEZ 23', items: ['Walk By Faith Tee'] }])
    expect(db.ordersInserted[0].metadata.buyer_message_flag).toEqual({
      flag: 'personalization', needs_review: false, source: 'jev', confidence: 0.97, mode: 'on'
    })
  })

  it('an empty buyer note is flagged none without a Jev call (default classifier)', async () => {
    const db = makeFakeDb()
    await ingestReceipt(baseReceipt({ message_from_buyer: '   ' }) as any, db as any)
    expect(db.ordersInserted[0].metadata.buyer_message_flag).toMatchObject({ flag: 'none', needs_review: false, source: 'floor' })
  })

  it('a classifier failure never costs the sale — the order still ingests, marked for review', async () => {
    const db = makeFakeDb()
    const result = await ingestReceipt(
      baseReceipt({ message_from_buyer: 'please hurry' }) as any,
      db as any,
      async () => { throw new Error('lane down') }
    )
    expect(result.created).toBe(true)
    expect(db.ordersInserted[0].metadata.buyer_message_flag).toEqual({ flag: null, needs_review: true, source: 'error' })
  })

  it('still creates the order when a transaction listing has no etsy_listings mapping (product_id null, not dropped)', async () => {
    const db = makeFakeDb({ etsyListings: [] }) // no mapping at all
    const result = await ingestReceipt(baseReceipt() as any, db as any)
    expect(result.created).toBe(true)
    expect(db.orderItemsInserted[0].product_id).toBeNull()
  })
})

// Create-your-own pet ornament sales (task 5d007181): the buyer's name + photo
// answers become checkout's print files before the order lands.
describe('ingestReceipt — pet ornament lines', () => {
  const PET_PRODUCT = 'dff53dc2-38ec-4125-9cae-bbc41e094b23'
  const PET_LISTING = 4607572810
  const petTemplate = { pet_ornament: { version: 1, font: 'brush-script', pets: ['cat', 'dog', 'bunny'], field: { key: 'name', label: "Your pet's name", max: 12 }, photo: true } }
  const petReceipt = () =>
    baseReceipt({
      receipt_id: 777,
      transactions: [
        {
          transaction_id: 4242,
          listing_id: PET_LISTING,
          title: 'Create Your Own Pet Ornament',
          quantity: 1,
          price: { amount: 1999, divisor: 100, currency_code: 'USD' },
          variations: [
            { property_id: 54, value_id: null, formatted_name: 'Your pet&#39;s name', formatted_value: 'Biscuit' },
            { property_id: 54, value_id: null, formatted_name: 'A photo of your pet', formatted_value: 'https://i.etsystatic.com/uploads/x/pet.jpg' },
          ],
        },
      ],
    })
  const readyLine = {
    values: { pet: 'dog', name: 'Biscuit', portrait: 'a1b2c3d4e5f6a1b2c3d4e5f6' },
    path: 'users/pet-ornaments/geo-v1/k/print-spec.json',
    status: 'ready' as const,
    etsy: { transactionId: 4242, listingId: PET_LISTING, nameAnswer: 'Biscuit', photoUrl: 'https://i.etsystatic.com/uploads/x/pet.jpg', photoCandidates: 1, photo: null, pet: { id: 'dog', source: 'vision' as const, uncertain: false, reason: 'photo shows a dog (97% sure)' }, portraitId: 'a1b2c3d4e5f6a1b2c3d4e5f6' },
  }
  const noFlag = async () => ({ flag: 'personalization', needsReview: false, source: 'keyword', mode: 'shadow' }) as any

  it("writes checkout's print-file keys on the pet line, so the print bridge sends its parts", async () => {
    const db = makeFakeDb({ etsyListings: [{ listing_id: PET_LISTING, product_id: PET_PRODUCT }] })
    const result = await ingestReceipt(petReceipt() as any, db as any, noFlag, async () => new Map([[4242, readyLine]]))
    expect(result.created).toBe(true)
    const item = db.orderItemsInserted[0]
    expect(item.product_id).toBe(PET_PRODUCT)
    expect(item.metadata).toMatchObject({
      etsy_transaction_id: 4242,
      personalization: { pet: 'dog', name: 'Biscuit', portrait: 'a1b2c3d4e5f6a1b2c3d4e5f6' },
      print_file_path: 'users/pet-ornaments/geo-v1/k/print-spec.json',
      print_file_status: 'ready',
      print_file_error: null,
      etsy_pet: { pet: { id: 'dog', source: 'vision' } },
    })
  })

  it('a held pet line still lands the order, with the reason on the line', async () => {
    const db = makeFakeDb({ etsyListings: [{ listing_id: PET_LISTING, product_id: PET_PRODUCT }] })
    const held = { ...readyLine, path: null, status: 'failed' as const, error: "The buyer's photo is too small to draw" }
    const result = await ingestReceipt(petReceipt() as any, db as any, noFlag, async () => new Map([[4242, held]]))
    expect(result.created).toBe(true)
    expect(db.orderItemsInserted[0].metadata).toMatchObject({ print_file_path: null, print_file_status: 'failed', print_file_error: "The buyer's photo is too small to draw" })
  })

  it('a pet-line crash never costs the sale', async () => {
    const db = makeFakeDb({ etsyListings: [{ listing_id: PET_LISTING, product_id: PET_PRODUCT }] })
    const result = await ingestReceipt(petReceipt() as any, db as any, noFlag, async () => { throw new Error('boom') })
    expect(result.created).toBe(true)
    expect(db.orderItemsInserted[0].metadata.print_file_path).toBeUndefined()
  })

  it('the real petLinesForReceipt builds only pet products, and skips a receipt that is already an order', async () => {
    const { petLinesForReceipt } = await import('./etsy-receipt-ingest.js')
    const { etsyPetDeps } = await import('../services/pet-ornament/etsy-order.js')
    const saved = { ...etsyPetDeps }
    const drawn: string[] = []
    etsyPetDeps.fetch = (async () => new Response(new Uint8Array(await (await import('sharp')).default({ create: { width: 600, height: 600, channels: 3, background: '#884422' } }).png().toBuffer()))) as any
    etsyPetDeps.detectPet = async () => ({ pet: 'dog', source: 'vision', usable: true, uncertain: false, reason: 'photo shows a dog', vision: null })
    etsyPetDeps.drawPortrait = (async (_p: Buffer, label: string) => { drawn.push(label); return { id: 'a1b2c3d4e5f6a1b2c3d4e5f6', map: {}, drawn: true } }) as any
    etsyPetDeps.storePetPrint = (async () => ({ path: 'users/pet-ornaments/geo-v1/k/print-spec.json', built: true, spec: { parts: [] } })) as any
    try {
      const receipt = petReceipt()
      receipt.transactions.push({ ...baseReceipt().transactions[0] }) // a tee on the same receipt: not a pet line
      const db = makeFakeDb({
        etsyListings: [{ listing_id: PET_LISTING, product_id: PET_PRODUCT }, { listing_id: 555, product_id: 'prod-tee' }],
        products: [{ id: PET_PRODUCT, metadata: petTemplate }, { id: 'prod-tee', metadata: {} }],
      })
      const productByListing = new Map<number, string>([[PET_LISTING, PET_PRODUCT], [555, 'prod-tee']])
      const lines = await petLinesForReceipt(receipt as any, productByListing, db as any)
      expect([...lines.keys()]).toEqual([4242])
      expect(lines.get(4242)).toMatchObject({ status: 'ready', values: { pet: 'dog', name: 'Biscuit' } })
      expect(drawn).toEqual(['Dog'])

      db.seenReceiptIds.add(777) // a re-poll of a receipt that is already an order
      expect((await petLinesForReceipt(receipt as any, productByListing, db as any)).size).toBe(0)
      expect(drawn).toEqual(['Dog']) // nothing drawn or paid for twice
    } finally {
      Object.assign(etsyPetDeps, saved)
    }
  })
})
