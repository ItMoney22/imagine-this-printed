import { describe, it, expect } from 'vitest'

// backend/lib/supabase.ts creates its client eagerly at module load, so these
// must exist before vendor-payouts.ts is evaluated. Every case injects a fake
// `db` and a fake Stripe — no real client, no real money. Dynamic import after
// setting the env vars (rather than a static import, which ESM hoists) is what
// makes the ordering work — same pattern as order-reward-service.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  calculateVendorPayout,
  accrueVendorPayouts,
  summarizeVendorPayouts,
  processVendorPayout
} = await import('./vendor-payouts.js')

type Row = Record<string, any>

/**
 * Minimal in-memory stand-in for the PostgREST builder, with real mutable row
 * state — enough that accrual re-runs, the pending→processing claim and the
 * unique (order_id, product_id) index all behave the way Postgres would.
 */
function makeDb(tables: Record<string, Row[]>) {
  let seq = 0
  const builder = (table: string) => {
    if (!tables[table]) tables[table] = []
    const filters: Array<(r: Row) => boolean> = []
    let orderKey: string | null = null
    let asc = true
    let from = 0
    let to = Infinity
    let take = Infinity
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: any = null

    const matched = () => tables[table].filter((r) => filters.every((f) => f(r)))

    const run = async () => {
      if (mode === 'insert') {
        const rows = Array.isArray(payload) ? payload : [payload]
        for (const r of rows) {
          const clash =
            table === 'vendor_payouts' &&
            r.order_id &&
            r.product_id &&
            tables[table].some((x) => x.order_id === r.order_id && x.product_id === r.product_id)
          if (clash) return { data: null, error: { code: '23505', message: 'duplicate key value' } }
          tables[table].push({
            id: `${table}-${++seq}`,
            created_at: new Date().toISOString(),
            ...r
          })
        }
        return { data: rows, error: null }
      }
      if (mode === 'update') {
        const hits = matched()
        for (const r of hits) Object.assign(r, payload)
        return { data: hits.map((r) => ({ ...r })), error: null }
      }
      let out = matched()
      if (orderKey) {
        const key = orderKey
        out = [...out].sort((a, b) =>
          asc ? String(a[key]).localeCompare(String(b[key])) : String(b[key]).localeCompare(String(a[key]))
        )
      }
      return { data: out.slice(from, to + 1).slice(0, take).map((r) => ({ ...r })), error: null }
    }

    const b: any = {
      select: () => b,
      insert: (p: any) => { mode = 'insert'; payload = p; return b },
      update: (p: any) => { mode = 'update'; payload = p; return b },
      eq: (col: string, val: any) => { filters.push((r) => r[col] === val); return b },
      in: (col: string, vals: any[]) => { filters.push((r) => vals.includes(r[col])); return b },
      gte: (col: string, val: any) => { filters.push((r) => String(r[col]) >= String(val)); return b },
      lte: (col: string, val: any) => { filters.push((r) => String(r[col]) <= String(val)); return b },
      order: (col: string, opts?: any) => { orderKey = col; asc = opts?.ascending !== false; return b },
      range: (a: number, z: number) => { from = a; to = z; return b },
      limit: (n: number) => { take = n; return b },
      single: async () => { const r = await run(); return { data: (r.data as any)?.[0] ?? null, error: r.error } },
      maybeSingle: async () => { const r = await run(); return { data: (r.data as any)?.[0] ?? null, error: r.error } },
      then: (res: any, rej: any) => run().then(res, rej)
    }
    return b
  }
  return { from: builder, _tables: tables }
}

function makeStripe(opts: { transferThrows?: string; payoutThrows?: string } = {}) {
  const calls: any = { transfers: [], payouts: [] }
  return {
    calls,
    transfers: {
      create: async (params: any) => {
        calls.transfers.push(params)
        if (opts.transferThrows) throw new Error(opts.transferThrows)
        return { id: 'tr_test_1' }
      }
    },
    payouts: {
      create: async (params: any, options: any) => {
        calls.payouts.push({ params, options })
        if (opts.payoutThrows) throw new Error(opts.payoutThrows)
        return { id: 'po_test_1', status: 'pending' }
      }
    }
  }
}

const VENDOR = 'vendor-1'

function seed(overrides: Partial<Record<string, Row[]>> = {}) {
  return makeDb({
    products: [{ id: 'prod-1', name: 'Vendor Tee', vendor_id: VENDOR }],
    order_items: [
      { id: 'oi-1', order_id: 'order-1', product_id: 'prod-1', quantity: 2, unit_price: 50, subtotal: 100 }
    ],
    orders: [
      {
        id: 'order-1',
        order_number: 'ITP-1',
        customer_email: 'buyer@example.com',
        payment_status: 'paid',
        status: 'processing',
        created_at: '2026-07-01T00:00:00Z'
      }
    ],
    vendor_payouts: [],
    stripe_connect_accounts: [
      {
        id: 'sca-1',
        user_id: VENDOR,
        stripe_account_id: 'acct_test_1',
        onboarding_complete: true,
        payouts_enabled: true,
        instant_payouts_enabled: false
      }
    ],
    ...overrides
  } as Record<string, Row[]>)
}

describe('calculateVendorPayout — the documented 7% + 3.5% split', () => {
  it('leaves the vendor 89.5% of the sale', () => {
    const calc = calculateVendorPayout(100)
    expect(calc.platformFee).toBe(7)
    expect(calc.stripeFee).toBe(3.5)
    expect(calc.payoutAmount).toBe(89.5)
  })

  it('rounds to cents rather than carrying float dust', () => {
    const calc = calculateVendorPayout(89.99)
    expect(calc.platformFee).toBe(6.3)
    expect(calc.stripeFee).toBe(3.15)
    expect(calc.payoutAmount).toBe(80.54)
  })
})

describe('accrueVendorPayouts — real ledger rows from real paid orders', () => {
  it('records one row per (order, product) with the fee breakdown', async () => {
    const db = seed()
    const created = await accrueVendorPayouts(VENDOR, db as any)

    expect(created).toBe(1)
    const rows = db._tables.vendor_payouts
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      vendor_id: VENDOR,
      order_id: 'order-1',
      product_id: 'prod-1',
      sale_amount: 100,
      platform_fee: 7,
      stripe_fee: 3.5,
      payout_amount: 89.5,
      amount: 89.5,
      status: 'pending'
    })
    expect(rows[0].metadata.order_number).toBe('ITP-1')
    expect(rows[0].metadata.quantity).toBe(2)
  })

  it('is idempotent — a second sweep of the same order creates nothing', async () => {
    const db = seed()
    await accrueVendorPayouts(VENDOR, db as any)
    const second = await accrueVendorPayouts(VENDOR, db as any)

    expect(second).toBe(0)
    expect(db._tables.vendor_payouts).toHaveLength(1)
  })

  it('aggregates several line items of the same product into one ledger row', async () => {
    const db = seed({
      order_items: [
        { id: 'oi-1', order_id: 'order-1', product_id: 'prod-1', quantity: 1, unit_price: 50, subtotal: 50 },
        { id: 'oi-2', order_id: 'order-1', product_id: 'prod-1', quantity: 1, unit_price: 60, subtotal: 60 }
      ]
    })
    await accrueVendorPayouts(VENDOR, db as any)

    expect(db._tables.vendor_payouts).toHaveLength(1)
    expect(db._tables.vendor_payouts[0].sale_amount).toBe(110)
    expect(db._tables.vendor_payouts[0].metadata.order_item_ids).toEqual(['oi-1', 'oi-2'])
  })

  it('falls back to unit_price × quantity when subtotal is missing', async () => {
    const db = seed({
      order_items: [{ id: 'oi-1', order_id: 'order-1', product_id: 'prod-1', quantity: 3, unit_price: 20, subtotal: 0 }]
    })
    await accrueVendorPayouts(VENDOR, db as any)
    expect(db._tables.vendor_payouts[0].sale_amount).toBe(60)
  })

  it('ignores unpaid orders — a vendor is never owed for an unpaid cart', async () => {
    const db = seed({
      orders: [{ id: 'order-1', order_number: 'ITP-1', payment_status: 'pending', status: 'draft' }]
    })
    expect(await accrueVendorPayouts(VENDOR, db as any)).toBe(0)
    expect(db._tables.vendor_payouts).toHaveLength(0)
  })

  it('ignores cancelled and refunded orders', async () => {
    const db = seed({
      orders: [{ id: 'order-1', order_number: 'ITP-1', payment_status: 'paid', status: 'refunded' }]
    })
    expect(await accrueVendorPayouts(VENDOR, db as any)).toBe(0)
  })

  it('never accrues another vendor’s sales', async () => {
    const db = seed({ products: [{ id: 'prod-1', name: 'Someone else', vendor_id: 'vendor-2' }] })
    expect(await accrueVendorPayouts(VENDOR, db as any)).toBe(0)
  })
})

describe('summarizeVendorPayouts', () => {
  it('reports available = pending only, and never counts paid rows as claimable', async () => {
    const db = seed({
      vendor_payouts: [
        { id: 'vp-1', vendor_id: VENDOR, payout_amount: 89.5, platform_fee: 7, stripe_fee: 3.5, status: 'pending', created_at: new Date().toISOString() },
        { id: 'vp-2', vendor_id: VENDOR, payout_amount: 40, platform_fee: 3, stripe_fee: 1.5, status: 'paid', created_at: new Date().toISOString() }
      ],
      order_items: [],
      products: []
    })
    const summary = await summarizeVendorPayouts(VENDOR, db as any)

    expect(summary.availableAmount).toBe(89.5)
    expect(summary.pendingAmount).toBe(89.5)
    expect(summary.paidAmount).toBe(40)
    expect(summary.totalAmount).toBe(129.5)
    expect(summary.totalFees).toBe(15)
    expect(summary.config.minimumPayoutUsd).toBe(25)
  })
})

describe('processVendorPayout — real Stripe Connect money movement', () => {
  const bigLedger = (status = 'pending') => [
    { id: 'vp-1', vendor_id: VENDOR, payout_amount: 60, status, created_at: '2026-07-01T00:00:00Z' },
    { id: 'vp-2', vendor_id: VENDOR, payout_amount: 40, status, created_at: '2026-07-02T00:00:00Z' }
  ]

  it('transfers the claimed total and marks the ledger paid', async () => {
    const db = seed({ vendor_payouts: bigLedger(), order_items: [], products: [] })
    const stripe = makeStripe()

    const result = await processVendorPayout(VENDOR, undefined, db as any, stripe as any)

    expect(result.success).toBe(true)
    expect(result.amount).toBe(100)
    expect(result.payoutCount).toBe(2)
    expect(stripe.calls.transfers[0]).toMatchObject({
      amount: 10000,
      currency: 'usd',
      destination: 'acct_test_1'
    })
    expect(stripe.calls.payouts[0].options).toEqual({ stripeAccount: 'acct_test_1' })
    expect(stripe.calls.payouts[0].params.method).toBe('standard')
    for (const row of db._tables.vendor_payouts) {
      expect(row.status).toBe('paid')
      expect(row.stripe_transfer_id).toBe('tr_test_1')
      expect(row.stripe_payout_id).toBe('po_test_1')
      expect(row.processed_at).toBeTruthy()
    }
  })

  it('uses an instant payout when the vendor has an instant-eligible debit card', async () => {
    const db = seed({
      vendor_payouts: bigLedger(),
      order_items: [],
      products: [],
      stripe_connect_accounts: [
        {
          id: 'sca-1',
          user_id: VENDOR,
          stripe_account_id: 'acct_test_1',
          onboarding_complete: true,
          payouts_enabled: true,
          instant_payouts_enabled: true
        }
      ]
    })
    const stripe = makeStripe()
    await processVendorPayout(VENDOR, undefined, db as any, stripe as any)
    expect(stripe.calls.payouts[0].params.method).toBe('instant')
  })

  it('pays whole ledger rows only, oldest first, when an amount cap is given', async () => {
    const db = seed({ vendor_payouts: bigLedger(), order_items: [], products: [] })
    const stripe = makeStripe()

    const result = await processVendorPayout(VENDOR, 60, db as any, stripe as any)

    expect(result.amount).toBe(60)
    expect(stripe.calls.transfers[0].amount).toBe(6000)
    expect(db._tables.vendor_payouts.find((r) => r.id === 'vp-1')!.status).toBe('paid')
    expect(db._tables.vendor_payouts.find((r) => r.id === 'vp-2')!.status).toBe('pending')
  })

  it('refuses below the minimum without calling Stripe at all', async () => {
    const db = seed({
      vendor_payouts: [{ id: 'vp-1', vendor_id: VENDOR, payout_amount: 10, status: 'pending', created_at: '2026-07-01T00:00:00Z' }],
      order_items: [],
      products: []
    })
    const stripe = makeStripe()

    const result = await processVendorPayout(VENDOR, undefined, db as any, stripe as any)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Minimum payout is $25.00')
    expect(stripe.calls.transfers).toHaveLength(0)
    expect(db._tables.vendor_payouts[0].status).toBe('pending')
  })

  it('refuses when the vendor has no Stripe Connect account', async () => {
    const db = seed({ vendor_payouts: bigLedger(), order_items: [], products: [], stripe_connect_accounts: [] })
    const stripe = makeStripe()

    const result = await processVendorPayout(VENDOR, undefined, db as any, stripe as any)

    expect(result.success).toBe(false)
    expect(result.error).toContain('No Stripe Connect account')
    expect(stripe.calls.transfers).toHaveLength(0)
  })

  it('distinguishes "onboarding not finished" from "Stripe still verifying"', async () => {
    const notOnboarded = seed({
      vendor_payouts: bigLedger(),
      order_items: [],
      products: [],
      stripe_connect_accounts: [{ id: 'sca-1', user_id: VENDOR, stripe_account_id: 'acct_1', onboarding_complete: false, payouts_enabled: false }]
    })
    const r1 = await processVendorPayout(VENDOR, undefined, notOnboarded as any, makeStripe() as any)
    expect(r1.error).toContain('complete Stripe Connect onboarding')

    const verifying = seed({
      vendor_payouts: bigLedger(),
      order_items: [],
      products: [],
      stripe_connect_accounts: [{ id: 'sca-1', user_id: VENDOR, stripe_account_id: 'acct_1', onboarding_complete: true, payouts_enabled: false }]
    })
    const r2 = await processVendorPayout(VENDOR, undefined, verifying as any, makeStripe() as any)
    expect(r2.error).toContain('still being verified')
  })

  it('refuses a second payout while one is already processing — no double-spend', async () => {
    const db = seed({
      vendor_payouts: [
        { id: 'vp-1', vendor_id: VENDOR, payout_amount: 60, status: 'processing', created_at: '2026-07-01T00:00:00Z' },
        { id: 'vp-2', vendor_id: VENDOR, payout_amount: 40, status: 'pending', created_at: '2026-07-02T00:00:00Z' }
      ],
      order_items: [],
      products: []
    })
    const stripe = makeStripe()

    const result = await processVendorPayout(VENDOR, undefined, db as any, stripe as any)

    expect(result.success).toBe(false)
    expect(result.error).toContain('already have a payout in progress')
    expect(stripe.calls.transfers).toHaveLength(0)
  })

  it('releases the claim back to pending when the Stripe transfer fails', async () => {
    const db = seed({ vendor_payouts: bigLedger(), order_items: [], products: [] })
    const stripe = makeStripe({ transferThrows: 'Insufficient platform balance' })

    const result = await processVendorPayout(VENDOR, undefined, db as any, stripe as any)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Insufficient platform balance')
    for (const row of db._tables.vendor_payouts) {
      expect(row.status).toBe('pending')
      expect(row.payout_batch_id).toBeNull()
      expect(row.failure_reason).toContain('Insufficient platform balance')
    }
    expect(stripe.calls.payouts).toHaveLength(0)
  })

  it('keeps rows paid when the transfer succeeded but the bank payout failed — the money already left the platform', async () => {
    const db = seed({ vendor_payouts: bigLedger(), order_items: [], products: [] })
    const stripe = makeStripe({ payoutThrows: 'No external account on file' })

    const result = await processVendorPayout(VENDOR, undefined, db as any, stripe as any)

    expect(result.success).toBe(true)
    expect(result.warning).toContain('transferred to your Stripe account')
    for (const row of db._tables.vendor_payouts) {
      // Releasing these back to `pending` would let the same earnings be
      // transferred a second time — that is the double-spend this guards.
      expect(row.status).toBe('paid')
      expect(row.stripe_transfer_id).toBe('tr_test_1')
      expect(row.stripe_payout_id).toBeNull()
      expect(row.failure_reason).toContain('No external account')
    }
  })

  it('reports "no earnings" instead of transferring $0', async () => {
    const db = seed({ vendor_payouts: [], order_items: [], products: [] })
    const stripe = makeStripe()

    const result = await processVendorPayout(VENDOR, undefined, db as any, stripe as any)

    expect(result.success).toBe(false)
    expect(result.error).toContain('No earnings')
    expect(stripe.calls.transfers).toHaveLength(0)
  })
})
