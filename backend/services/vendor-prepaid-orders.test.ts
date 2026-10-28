// Prepaid vendor orders (task d2e4d280, ZenTress Head Spa's merch): ITP's own
// price for every line, the share it refuses to be short-changed on, and what
// lands on the order the press reads.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tables: Record<string, any[]> = { orders: [], order_items: [], qr_stand_builds: [] }
const uploads: string[] = []

vi.mock('../lib/supabase.js', () => {
  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = []
    let patch: any = null
    // A read, or an update applied to every matching row (returned as written).
    const run = () => {
      const hit = tables[table].filter((r) => filters.every((f) => f(r)))
      if (patch) for (const r of hit) Object.assign(r, JSON.parse(JSON.stringify(patch)))
      return hit.map((r) => JSON.parse(JSON.stringify(r)))
    }
    const q: any = {
      select: () => q,
      update: (p: any) => { patch = p; return q },
      eq: (col: string, val: any) => {
        filters.push((r) => {
          if (col.startsWith('metadata->>')) return String(r.metadata?.[col.slice(11)]) === String(val)
          return r[col] === val
        })
        return q
      },
      is: (col: string, val: any) => { filters.push((r) => (r[col] ?? null) === val); return q },
      order: () => q,
      limit: async () => ({ data: run(), error: null }),
      single: async () => { const d = run(); return { data: d[0] ?? null, error: d[0] ? null : { message: 'no rows' } } },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      insert: (rows: any) => {
        const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: `${table}-${tables[table].length + 1}`, created_at: 'now', ...r }))
        tables[table].push(...list)
        const res = { data: list, error: null }
        return { select: () => ({ single: async () => ({ data: list[0], error: null }) }), then: (ok: any) => ok(res) }
      },
      delete: () => ({ eq: async (col: string, val: any) => { tables[table] = tables[table].filter((r) => r[col] !== val); return { error: null } } }),
      then: (ok: any) => ok({ data: run(), error: null }),
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
const { createPrepaidVendorOrder, cancelPrepaidVendorOrder, readPrepaidVendorOrder, vendorOrderStage, vendorTrackingUrl, PrepaidOrderError } = await import('./vendor-prepaid-orders.js')
const { requestPrint } = await import('./qr-stand-builds.js')

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

// Task cb187ff5: the vendor site reads its order back, so its own row moves
// from "submitted" on its own: ITP's stage, and tracking only when it is real.
describe('reading a prepaid order back', () => {
  const place = async (vendorRef = 'zt-order-1') => {
    const lines = [mug()]
    const placed = await createPrepaidVendorOrder({ vendor: 'zentress', body: body(lines, { externalRef: vendorRef, itpShareCents: share(lines, 'spa') }) })
    return tables.orders.find((o) => o.id === placed.orderId)!
  }

  it('collapses ITP statuses to the stages a site shows', () => {
    const stage = (status: string | null, extra: Record<string, any> = {}) => vendorOrderStage({ status, ...extra })
    expect(stage('processing')).toBe('received')
    expect(stage('paid')).toBe('received')
    expect(stage('printed')).toBe('in_production')
    expect(stage('processing', { printStatus: 'printing' })).toBe('in_production')
    expect(stage('processing', { standPrintSent: true })).toBe('in_production')
    expect(stage('shipped')).toBe('shipped')
    expect(stage('delivered')).toBe('delivered')
    expect(stage('completed')).toBe('delivered')
    expect(stage('cancelled')).toBe('cancelled')
    expect(stage('refunded')).toBe('cancelled')
    expect(stage('on_hold')).toBe('on_hold')
  })

  it('a new order reads back as received, with no tracking', async () => {
    const order = await place()
    const read = await readPrepaidVendorOrder('zentress', 'zt-order-1')
    expect(read).toMatchObject({ orderId: order.id, orderNumber: order.order_number, externalRef: 'zt-order-1', stage: 'received', status: 'processing' })
    expect(read).toMatchObject({ trackingNumber: null, carrier: null, trackingUrl: null })
  })

  it('a shipped order reads back with its tracking and the carrier\'s own link', async () => {
    const order = await place()
    Object.assign(order, { status: 'shipped', tracking_number: ' 9400111899223197428490 ', tracking_company: 'USPS', shipped_at: '2026-10-28T12:00:00Z' })
    const read = await readPrepaidVendorOrder('zentress', 'zt-order-1')
    expect(read).toMatchObject({ stage: 'shipped', trackingNumber: '9400111899223197428490', carrier: 'USPS', shippedAt: '2026-10-28T12:00:00Z' })
    expect(read!.trackingUrl).toMatch(/^https:\/\/tools\.usps\.com\/.*9400111899223197428490/)
  })

  it('a bought label\'s own tracking link wins', () => {
    const url = vendorTrackingUrl({ tracking_number: '1Z999AA10123456784', tracking_company: 'UPS', metadata: { shipping_label: { tracking_url: 'https://track.goshippo.com/x' } } })
    expect(url).toBe('https://track.goshippo.com/x')
  })

  it('never hands back a search link for a carrier ITP cannot name', async () => {
    const order = await place()
    Object.assign(order, { status: 'shipped', tracking_number: 'ABC123', tracking_company: "Bob's Courier" })
    const read = await readPrepaidVendorOrder('zentress', 'zt-order-1')
    expect(read).toMatchObject({ trackingNumber: 'ABC123', carrier: "Bob's Courier", trackingUrl: null })
  })

  it('a stand sent to the 3D printer reads as in production', async () => {
    const order = await place()
    tables.qr_stand_builds.push({ id: 'b1', order_id: order.id, line_index: 0, print_status: 'sent', created_at: '2026-10-28' })
    expect((await readPrepaidVendorOrder('zentress', 'zt-order-1'))!.stage).toBe('in_production')
  })

  it('only the vendor that sent the order can read it, and an unknown order is null', async () => {
    await place()
    expect(await readPrepaidVendorOrder('zentress', 'zt-nope')).toBeNull()
    expect((await readPrepaidVendorOrder('darrell', 'zt-order-1').catch((e) => e)).status).toBe(403)
    process.env.STOREFRONT_PREPAID_VENDORS = 'zentress,darrell'
    expect(await readPrepaidVendorOrder('darrell', 'zt-order-1')).toBeNull()
    expect((await readPrepaidVendorOrder('zentress', '  ').catch((e) => e)).status).toBe(400)
  })
})

// Task 14ce738b: the site refunded its buyer, so the order must never reach the press or the post.
describe('POST /api/storefront/orders/:externalRef/cancel (cancelPrepaidVendorOrder)', () => {
  const REFUND = { reason: 'refunded', refund: { chargeId: 'ch_1', amountRefundedCents: 99999 } }

  async function placeSpaOrder(lines = [shirt(), stand()]) {
    const res = await createPrepaidVendorOrder({ vendor: 'zentress', body: body(lines, { itpShareCents: share(lines, 'spa') }) })
    // The table's default for a new build.
    for (const b of tables.qr_stand_builds) b.status ??= 'queued'
    return res
  }

  it('cancels a processing order: status cancelled, payment refunded, the refund on record', async () => {
    const placed = await placeSpaOrder()
    const res = await cancelPrepaidVendorOrder({ vendor: 'zentress', externalRef: 'zt-order-1', body: REFUND })
    expect(res).toEqual({ orderId: placed.orderId, orderNumber: placed.orderNumber, status: 'cancelled', alreadyCancelled: false })
    const order = tables.orders[0]
    expect(order).toMatchObject({ status: 'cancelled', payment_status: 'refunded' })
    expect(order.metadata.cancellation).toMatchObject({ by: 'zentress', reason: 'refunded', refund: { charge_id: 'ch_1', amount_refunded_cents: 99999 } })
    // What the order was is kept: the site's reference and ITP's share.
    expect(order.metadata.external_ref).toBe('zt-order-1')
    expect(order.metadata.itp_share.total_cents).toBe(share([shirt(), stand()], 'spa'))
  })

  it('a cancelled order\'s QR stand is not built and cannot be sent to the printers', async () => {
    await placeSpaOrder()
    await cancelPrepaidVendorOrder({ vendor: 'zentress', externalRef: 'zt-order-1', body: REFUND })
    expect(tables.qr_stand_builds[0]).toMatchObject({ status: 'failed', error: 'Order cancelled' })

    // Even a print file that finished building before the cancel stays off the printers.
    Object.assign(tables.qr_stand_builds[0], { status: 'ready', scan_ok: true, print_status: null })
    const print = await requestPrint(tables.qr_stand_builds[0].id)
    expect(print).toEqual({ ok: false, error: 'This order is cancelled: it must not be printed.' })
    expect(tables.qr_stand_builds[0].print_status).toBeNull()
  })

  it('a print already asked for is called off', async () => {
    await placeSpaOrder()
    Object.assign(tables.qr_stand_builds[0], { status: 'ready', scan_ok: true, print_status: 'requested' })
    await cancelPrepaidVendorOrder({ vendor: 'zentress', externalRef: 'zt-order-1', body: REFUND })
    expect(tables.qr_stand_builds[0]).toMatchObject({ print_status: 'failed', print_error: 'Order cancelled: do not print' })
  })

  it('a stand on an order that is still live prints as before', async () => {
    await placeSpaOrder()
    Object.assign(tables.qr_stand_builds[0], { status: 'ready', scan_ok: true, print_status: null })
    const print = await requestPrint(tables.qr_stand_builds[0].id)
    expect(print.ok).toBe(true)
  })

  it('refuses once the order has shipped, says so, and changes nothing', async () => {
    for (const shipped of [{ status: 'shipped' }, { status: 'delivered' }, { status: 'completed' }, { status: 'processing', fulfillment_status: 'fulfilled' }]) {
      tables.orders = []
      tables.order_items = []
      tables.qr_stand_builds = []
      await placeSpaOrder([mug()])
      Object.assign(tables.orders[0], shipped)
      const before = JSON.stringify(tables.orders[0])
      const err = await cancelPrepaidVendorOrder({ vendor: 'zentress', externalRef: 'zt-order-1', body: REFUND }).catch((e) => e)
      expect(err).toBeInstanceOf(PrepaidOrderError)
      expect(err.status).toBe(409)
      expect(err.message).toMatch(/^Order ITP-.+ has already shipped and can no longer be cancelled$/)
      expect(err.detail).toMatchObject({ shipped: true, status: shipped.status })
      expect(JSON.stringify(tables.orders[0])).toBe(before)
    }
  })

  it('cancelling twice is one cancel', async () => {
    await placeSpaOrder([mug()])
    await cancelPrepaidVendorOrder({ vendor: 'zentress', externalRef: 'zt-order-1', body: REFUND })
    const at = tables.orders[0].metadata.cancellation.at
    const again = await cancelPrepaidVendorOrder({ vendor: 'zentress', externalRef: 'zt-order-1', body: REFUND })
    expect(again).toMatchObject({ status: 'cancelled', alreadyCancelled: true })
    expect(tables.orders[0].metadata.cancellation.at).toBe(at)
  })

  it('an order ITP itself refunded is not dragged into cancelled', async () => {
    await placeSpaOrder([mug()])
    tables.orders[0].status = 'refunded'
    const err = await cancelPrepaidVendorOrder({ vendor: 'zentress', externalRef: 'zt-order-1', body: REFUND }).catch((e) => e)
    expect(err.status).toBe(409)
    expect(tables.orders[0].status).toBe('refunded')
  })

  it('a key reaches only its own vendor\'s orders, and only vendors switched on may cancel', async () => {
    await placeSpaOrder([mug()])
    process.env.STOREFRONT_PREPAID_VENDORS = 'zentress,other'
    const other = await cancelPrepaidVendorOrder({ vendor: 'other', externalRef: 'zt-order-1', body: REFUND }).catch((e) => e)
    expect(other.status).toBe(404)
    const off = await cancelPrepaidVendorOrder({ vendor: 'darrell', externalRef: 'zt-order-1', body: REFUND }).catch((e) => e)
    expect(off.status).toBe(403)
    expect(tables.orders[0].status).toBe('processing')
  })

  it('an unknown reference is a 404 that says so (notFound), unlike a route that is not there', async () => {
    const err = await cancelPrepaidVendorOrder({ vendor: 'zentress', externalRef: 'nope', body: REFUND }).catch((e) => e)
    expect(err.status).toBe(404)
    expect(err.detail).toEqual({ notFound: true })
  })
})
