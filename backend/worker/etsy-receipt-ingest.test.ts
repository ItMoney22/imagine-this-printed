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

function makeFakeDb(opts: { etsyListings?: FakeListingRow[] } = {}) {
  const etsyListings = opts.etsyListings ?? []
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
