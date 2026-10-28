// Prepaid vendor orders (task d2e4d280, ZenTress Head Spa's merch): ITP's own
// price for every line, the share it refuses to be short-changed on, and what
// lands on the order the press reads.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tables: Record<string, any[]> = { orders: [], order_items: [], qr_stand_builds: [] }
const uploads: string[] = []

vi.mock('../lib/supabase.js', () => {
  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = []
    const q: any = {
      select: () => q,
      eq: (col: string, val: any) => {
        filters.push((r) => {
          if (col.startsWith('metadata->>')) return String(r.metadata?.[col.slice(11)]) === String(val)
          return r[col] === val
        })
        return q
      },
      order: () => q,
      limit: async () => ({ data: tables[table].filter((r) => filters.every((f) => f(r))), error: null }),
      insert: (rows: any) => {
        const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: `${table}-${tables[table].length + 1}`, created_at: 'now', ...r }))
        tables[table].push(...list)
        const res = { data: list, error: null }
        return { select: () => ({ single: async () => ({ data: list[0], error: null }) }), then: (ok: any) => ok(res) }
      },
      delete: () => ({ eq: async (col: string, val: any) => { tables[table] = tables[table].filter((r) => r[col] !== val); return { error: null } } }),
      then: (ok: any) => ok({ data: tables[table].filter((r) => filters.every((f) => f(r))), error: null }),
    }
    return q
  }
  return { supabase: { from } }
})
vi.mock('./google-cloud-storage.js', () => ({
  uploadImageFromBuffer: async (_b: Buffer, path: string) => { uploads.push(path); return { publicUrl: `https://x/${path}`, path } },
  uploadBufferToBucket: async (_bucket: string, _b: Buffer, path: string) => { uploads.push(path); return path },
  signObjectInBucket: async () => 'https://signed',
  getSignedUrl: async () => 'https://signed',
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { priceVendorOrder, vendorPricingRules, itpUnitCents } = await import('../shared/vendor-order-pricing.js')
const { createPrepaidVendorOrder, PrepaidOrderError } = await import('./vendor-prepaid-orders.js')

// A real 1x1 PNG, so the stand logo goes through sharp for real.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const shirt = (over: Record<string, any> = {}) => ({ kind: 'shirt', name: 'ZenTress Tee', quantity: 1, size: 'M', color: 'Black', printLocation: 'left chest', frontPng: PNG, ...over })
const mug = (over: Record<string, any> = {}) => ({ kind: 'mug', name: 'ZenTress Mug', quantity: 1, frontPng: PNG, ...over })
const stand = (over: Record<string, any> = {}) => ({ kind: 'qr-stand', quantity: 1, qr: { link: 'zentressheadspa.com/book', caption: 'Review Us', logoPng: PNG }, ...over })
const body = (lines: any[], over: Record<string, any> = {}) => ({
  externalRef: 'zt-order-1',
  orderType: 'spa',
  shippingCents: 500,
  payment: { paymentIntentId: 'pi_test123', livemode: false, amountCents: 99999 },
  customer: { name: 'ZenTress Head Spa', email: 'info@zentressheadspa.com', shipping: { address: '1 Main St', city: 'Atlanta', state: 'GA', zip: '30301' } },
  lines,
  ...over,
})
const share = (lines: any[], type: 'spa' | 'store', ship = 500) => priceVendorOrder(lines, type, ship).itpShareCents

beforeEach(() => {
  for (const k of Object.keys(tables)) tables[k] = []
  uploads.length = 0
  process.env.STOREFRONT_PREPAID_VENDORS = 'zentress'
  process.env.STOREFRONT_ACCEPT_TEST_ORDERS = '1'
  delete process.env.STOREFRONT_BASE_COST_USD
  delete process.env.STOREFRONT_MUG_BASE_COST_USD
  delete process.env.STOREFRONT_CREATOR_FEE_PERCENT
})

describe('ITP pricing for a vendor order', () => {
  const rules = vendorPricingRules()
  const unit = (line: any, type: 'spa' | 'store' = 'spa') => itpUnitCents(line, type, rules)

  it('shirt: $10 base, +$5 back, +$2.50 at 2XL and up, $12 floor for the spa', () => {
    expect(unit({ kind: 'shirt', quantity: 1, size: 'M' }, 'store')).toBe(1000)
    expect(unit({ kind: 'shirt', quantity: 1, size: 'M', backPrint: true }, 'store')).toBe(1500)
    expect(unit({ kind: 'shirt', quantity: 1, size: '2XL' }, 'store')).toBe(1250)
    expect(unit({ kind: 'shirt', quantity: 1, size: '3XL', backPrint: true }, 'store')).toBe(1750)
    expect(unit({ kind: 'shirt', quantity: 1, size: 'M' })).toBe(1200)
    expect(unit({ kind: 'shirt', quantity: 1, size: '2XL' })).toBe(1250)
    expect(unit({ kind: 'shirt', quantity: 1, size: 'L', backPrint: true })).toBe(1500)
  })

  it('mug $8, stand $17.95', () => {
    expect(unit({ kind: 'mug', quantity: 1 })).toBe(800)
    expect(unit({ kind: 'qr-stand', quantity: 1 })).toBe(1795)
  })

  it('store lines add 3% of retail; the stand and spa orders never do', () => {
    const p = priceVendorOrder(
      [{ kind: 'shirt', quantity: 2, size: 'M', retailCents: 2500 }, { kind: 'mug', quantity: 1, retailCents: 1600 }],
      'store',
      500
    )
    expect(p.itemsCents).toBe(2 * 1000 + 800)
    expect(p.feeCents).toBe(150 + 48)
    expect(p.itpShareCents).toBe(2800 + 198 + 500)
    expect(priceVendorOrder([{ kind: 'shirt', quantity: 1, size: 'M' }], 'spa', 0).feeCents).toBe(0)
  })

  it('refuses a store price under ITP cost', () => {
    expect(() => priceVendorOrder([{ kind: 'mug', quantity: 1, retailCents: 800 }], 'store', 0)).toThrow(/below ITP cost/)
    expect(() => priceVendorOrder([{ kind: 'shirt', quantity: 1, size: 'M' }], 'store', 0)).toThrow(/retail price/)
  })
})

describe('POST /api/storefront/orders (createPrepaidVendorOrder)', () => {
  it('records a paid spa order: shirt, mug and stand at ITP prices, art in the private bucket, stand queued', async () => {
    const lines = [shirt({ size: '2XL', backPrint: true, backPng: PNG }), mug({ quantity: 2 }), stand()]
    const res = await createPrepaidVendorOrder({ vendor: 'zentress', body: body(lines, { itpShareCents: share(lines, 'spa') }) })
    expect(res.duplicate).toBe(false)
    expect(res.itpShareCents).toBe(1750 + 1600 + 1795 + 500)

    const order = tables.orders[0]
    expect(order.payment_status).toBe('paid')
    expect(order.status).toBe('processing')
    expect(order.source).toBe('zentress')
    expect(order.total).toBe(56.45)
    expect(order.metadata.external_ref).toBe('zt-order-1')
    expect(order.metadata.test_mode).toBe(true)
    expect(order.notes).toMatch(/TEST ORDER/)

    const [s, m, q] = tables.order_items
    expect([s.unit_price, m.unit_price, q.unit_price]).toEqual([17.5, 8, 17.95])
    expect(m.subtotal).toBe(16)
    expect(s.metadata.print_file_refs.front).toMatch(/^print-files\/vendor-orders\/zentress\/.+\/line-0-front\.png$/)
    expect(s.metadata.print_file_refs.back).toMatch(/line-0-back\.png$/)
    expect(s.metadata).toMatchObject({ size: '2XL', color: 'Black', print_location: 'left chest', back_print: true })
    expect(q.metadata.qr_stand).toMatchObject({ line_index: 2, link: 'https://zentressheadspa.com/book', caption: 'Review Us' })
    expect(q.metadata.qr_stand.logo_path).toMatch(/^qr-stand-logos\/[0-9a-f-]{36}\.png$/)
    expect(uploads).toContain(q.metadata.qr_stand.logo_path)
    expect(tables.qr_stand_builds).toHaveLength(1)
    expect(tables.qr_stand_builds[0]).toMatchObject({ link: 'https://zentressheadspa.com/book', caption: 'Review Us' })
  })

  it('a store order keeps the retail and ITP fee on each line', async () => {
    const lines = [shirt({ retailCents: 2500 }), mug({ retailCents: 1600 })]
    await createPrepaidVendorOrder({ vendor: 'zentress', body: body(lines, { orderType: 'store', itpShareCents: share(lines, 'store') }) })
    const [s, m] = tables.order_items
    expect(s).toMatchObject({ unit_price: 10, metadata: { retail_unit_cents: 2500, itp_fee_cents: 75 } })
    expect(m).toMatchObject({ unit_price: 8, metadata: { retail_unit_cents: 1600, itp_fee_cents: 48 } })
    expect(tables.orders[0].metadata.itp_share).toEqual({ items_cents: 1800, fee_cents: 123, shipping_cents: 500, total_cents: 2423 })
  })

  it('refuses a share that is not ITP\'s number, and says what ITP\'s is', async () => {
    const lines = [shirt()]
    const err = await createPrepaidVendorOrder({ vendor: 'zentress', body: body(lines, { itpShareCents: 1199 + 500 }) }).catch((e) => e)
    expect(err).toBeInstanceOf(PrepaidOrderError)
    expect(err.status).toBe(409)
    expect(err.detail).toEqual({ itpShareCents: 1700, claimedCents: 1699 })
    expect(tables.orders).toHaveLength(0)
  })

  it('refuses a Stripe test payment unless the box accepts test orders', async () => {
    delete process.env.STOREFRONT_ACCEPT_TEST_ORDERS
    const lines = [mug()]
    const err = await createPrepaidVendorOrder({ vendor: 'zentress', body: body(lines, { itpShareCents: share(lines, 'spa') }) }).catch((e) => e)
    expect(err.status).toBe(422)
    const live = body(lines, { itpShareCents: share(lines, 'spa'), payment: { paymentIntentId: 'pi_live1', livemode: true, amountCents: 1300 } })
    const ok = await createPrepaidVendorOrder({ vendor: 'zentress', body: live })
    expect(ok.duplicate).toBe(false)
    expect(tables.orders[0].notes).toBeNull()
  })

  it('only vendors switched on may send prepaid orders', async () => {
    const lines = [mug()]
    const err = await createPrepaidVendorOrder({ vendor: 'darrell', body: body(lines, { itpShareCents: share(lines, 'spa') }) }).catch((e) => e)
    expect(err.status).toBe(403)
  })

  it('the same site order twice is one ITP order', async () => {
    const lines = [mug()]
    const b = body(lines, { itpShareCents: share(lines, 'spa') })
    const first = await createPrepaidVendorOrder({ vendor: 'zentress', body: b })
    const again = await createPrepaidVendorOrder({ vendor: 'zentress', body: b })
    expect(again).toMatchObject({ duplicate: true, orderId: first.orderId, itpShareCents: 1300 })
    expect(tables.orders).toHaveLength(1)
  })

  it('checks the stand the way the order page does, and keeps it out of a store order', async () => {
    const tooLong = [stand({ qr: { link: 'https://zentressheadspa.com/' + 'x'.repeat(60), caption: 'Review Us' } })]
    expect((await createPrepaidVendorOrder({ vendor: 'zentress', body: body(tooLong, { itpShareCents: 2295 }) }).catch((e) => e)).message).toMatch(/shorter link/)
    const inStore = [stand()]
    expect((await createPrepaidVendorOrder({ vendor: 'zentress', body: body(inStore, { orderType: 'store', itpShareCents: 2295 }) }).catch((e) => e)).message).toMatch(/not sold in its store/)
  })

  it('needs PNG art for shirts and mugs, and the back print when there is one', async () => {
    const noArt = [mug({ frontPng: undefined })]
    expect((await createPrepaidVendorOrder({ vendor: 'zentress', body: body(noArt, { itpShareCents: 1300 }) }).catch((e) => e)).message).toMatch(/front print is required/)
    const jpeg = [mug({ frontPng: Buffer.from('ffd8ffe000104a464946', 'hex').toString('base64') })]
    expect((await createPrepaidVendorOrder({ vendor: 'zentress', body: body(jpeg, { itpShareCents: 1300 }) }).catch((e) => e)).message).toMatch(/must be a PNG/)
    const noBack = [shirt({ backPrint: true })]
    expect((await createPrepaidVendorOrder({ vendor: 'zentress', body: body(noBack, { itpShareCents: 2000 }) }).catch((e) => e)).message).toMatch(/back print is required/)
  })
})
