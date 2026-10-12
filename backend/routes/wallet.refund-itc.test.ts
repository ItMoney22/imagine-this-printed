import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// backend/routes/wallet.ts — POST /api/wallet/refund-itc
//
// This route used to be an ITC mint: it ran on the service-role client (so the
// wallet RLS lockdown never applied) and credited whatever `amount` the request
// body carried, without ever checking that a debit had happened. Watchtower
// task b66fb61f.
//
// What is under test is the guard, from the attacker's side first: an arbitrary
// amount, a fabricated reference, someone else's debit row, a debit that is not
// a feature debit, a refund bigger than what was taken, and the same debit
// refunded twice. Then the legitimate flow — deduct, fail, refund — has to keep
// working, on both the atomic-RPC path and the pre-migration fallback.
//
// The Supabase client is a small in-memory fake and `refund_itc_for_debit` is a
// JS transcription of the SQL function, so the same decision table the database
// enforces is the one these tests exercise. Route handlers are pulled straight
// off the Express router's stack (the technique studio-flow.test.ts uses) — no
// HTTP server involved.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

type Row = Record<string, any>

let db: Record<string, Row[]>
let rpcInstalled: boolean
let idCounter: number

const nextId = (prefix: string) => `${prefix}-${++idCounter}`

/** `metadata->>key` style selectors resolve into the jsonb blob. */
function readField(row: Row, key: string): any {
  const arrow = key.indexOf('->>')
  if (arrow === -1) return row[key]
  const column = key.slice(0, arrow)
  const field = key.slice(arrow + 3)
  const blob = row[column]
  return blob ? blob[field] : undefined
}

function makeQuery(table: string) {
  let mode: 'select' | 'insert' | 'update' = 'select'
  let payload: any = null
  let limit: number | null = null
  let orderBy: { column: string; ascending: boolean } | null = null
  const filters: Array<(r: Row) => boolean> = []

  const rows = () => db[table] || (db[table] = [])

  const exec = () => {
    if (mode === 'insert') {
      const inserted = { id: nextId(table), created_at: new Date().toISOString(), ...payload }
      // The partial unique index from 20260922120000_itc_refund_guard.sql.
      if (table === 'itc_transactions' && inserted.type === 'refund' && inserted.metadata?.refunded_transaction_id) {
        const clash = rows().some(
          (r) => r.type === 'refund' && r.metadata?.refunded_transaction_id === inserted.metadata.refunded_transaction_id
        )
        if (clash) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        }
      }
      rows().push(inserted)
      return { data: [inserted], error: null }
    }
    if (mode === 'update') {
      const updated: Row[] = []
      db[table] = rows().map((r) => {
        if (!filters.every((f) => f(r))) return r
        const next = { ...r, ...payload }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }
    let out = rows().filter((r) => filters.every((f) => f(r)))
    if (orderBy) {
      const { column, ascending } = orderBy
      out = [...out].sort((a, b) => {
        const av = String(a[column] ?? '')
        const bv = String(b[column] ?? '')
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    if (limit !== null) out = out.slice(0, limit)
    return { data: out, error: null }
  }

  const chain: any = {
    select: () => chain,
    insert: (p: any) => {
      mode = 'insert'
      payload = p
      return chain
    },
    update: (p: any) => {
      mode = 'update'
      payload = p
      return chain
    },
    eq: (k: string, v: any) => {
      filters.push((row) => String(readField(row, k)) === String(v))
      return chain
    },
    gte: (k: string, v: any) => {
      filters.push((row) => String(row[k] ?? '') >= String(v))
      return chain
    },
    order: (column: string, opts?: { ascending?: boolean }) => {
      orderBy = { column, ascending: opts?.ascending !== false }
      return chain
    },
    limit: (n: number) => {
      limit = n
      return chain
    },
    single: async () => {
      const { data, error } = exec()
      if (error) return { data: null, error }
      const list = data as Row[]
      if (!list?.length) return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
      return { data: list[0], error: null }
    },
    maybeSingle: async () => {
      const { data, error } = exec()
      if (error) return { data: null, error }
      return { data: (data as Row[])?.[0] ?? null, error: null }
    },
    then: (onOk: any, onErr?: any) => Promise.resolve(exec()).then(onOk, onErr),
  }
  return chain
}

/**
 * JS transcription of public.refund_itc_for_debit() — the same decision table,
 * same verdict codes. Keep in step with
 * supabase/migrations/20260922120000_itc_refund_guard.sql.
 */
function refundItcForDebit(args: Record<string, any>) {
  const { p_user_id, p_debit_id, p_amount, p_reference, p_description, p_reference_id } = args
  const ledger = db.itc_transactions || (db.itc_transactions = [])

  if (!(p_amount > 0)) return { ok: false, code: 'invalid_amount' }

  const debit = ledger.find((r) => r.id === p_debit_id && r.user_id === p_user_id)
  if (!debit) return { ok: false, code: 'debit_not_found' }

  if (Number(debit.amount) >= 0 || debit.type !== 'usage' || (debit.reference ?? '') !== 'feature_usage') {
    return { ok: false, code: 'not_refundable' }
  }

  const debitAmount = -Number(debit.amount)

  const already = ledger.some(
    (r) => r.type === 'refund' && r.metadata?.refunded_transaction_id === String(p_debit_id)
  )
  if (already) return { ok: false, code: 'already_refunded', debit_amount: debitAmount }
  if (p_amount > debitAmount) return { ok: false, code: 'amount_exceeds_debit', debit_amount: debitAmount }

  const wallet = (db.user_wallets || []).find((w) => w.user_id === p_user_id)
  if (!wallet) return { ok: false, code: 'wallet_not_found' }

  wallet.itc_balance = Number(wallet.itc_balance) + p_amount
  const refundId = nextId('refund')
  ledger.push({
    id: refundId,
    created_at: new Date().toISOString(),
    user_id: p_user_id,
    type: 'refund',
    amount: p_amount,
    balance_after: wallet.itc_balance,
    reference: p_reference || 'feature_refund',
    metadata: {
      refunded_transaction_id: String(p_debit_id),
      reference_id: p_reference_id ?? null,
      description: p_description ?? null,
    },
  })
  return { ok: true, new_balance: wallet.itc_balance, refund_id: refundId, debit_amount: debitAmount }
}

function rpc(fn: string, args: Record<string, any>) {
  if (fn === 'decrement_itc') {
    const wallet = (db.user_wallets || []).find((w) => w.user_id === args.p_user_id)
    if (!wallet || Number(wallet.itc_balance) < args.p_amount) return { data: null, error: null }
    wallet.itc_balance = Number(wallet.itc_balance) - args.p_amount
    return { data: wallet.itc_balance, error: null }
  }
  if (fn === 'refund_itc_for_debit') {
    if (!rpcInstalled) {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    }
    return { data: refundItcForDebit(args), error: null }
  }
  throw new Error(`unexpected rpc: ${fn}`)
}

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (t: string) => makeQuery(t),
    rpc: async (fn: string, args: Record<string, any>) => rpc(fn, args),
  },
}))
vi.mock('../middleware/supabaseAuth.js', () => ({ requireAuth: (_r: any, _s: any, n: any) => n() }))
vi.mock('../services/order-reward-service.js', () => ({ processOrderCompletion: vi.fn() }))
vi.mock('../services/referral-service.js', () => ({
  createReferralCode: vi.fn(),
  validateReferralCode: vi.fn(),
  processReferralSignup: vi.fn(),
  processReferralFirstPurchase: vi.fn(),
  getReferralStats: vi.fn(),
  getPlatformReferralStats: vi.fn(),
}))
vi.mock('../services/stripe-connect.js', () => ({
  createExpressAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  getConnectAccountStatus: vi.fn(),
  calculateCashout: vi.fn(),
  processInstantPayout: vi.fn(),
  MINIMUM_CASHOUT_ITC: 1000,
  ITC_TO_USD: 0.01,
}))
vi.mock('./coupons.js', () => ({ validateCouponForOrder: vi.fn(), recordCouponUsage: vi.fn() }))

const walletRouter = (await import('./wallet.js')).default

function handlerFor(method: string, path: string) {
  const layer = (walletRouter as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method])
  if (!layer) throw new Error(`No route for ${method.toUpperCase()} ${path}`)
  const handlers = layer.route.stack.map((s: any) => s.handle)
  return handlers[handlers.length - 1] as (req: any, res: any) => Promise<any>
}

const refundHandler = handlerFor('post', '/refund-itc')
const deductHandler = handlerFor('post', '/deduct-itc')

function makeRes() {
  const res: any = { statusCode: 200 }
  res.status = (c: number) => {
    res.statusCode = c
    return res
  }
  res.json = (b: any) => {
    res.body = b
    return res
  }
  return res
}

async function call(handler: (req: any, res: any) => Promise<any>, userId: string | null, body: Row) {
  const req: any = { body, user: userId ? { sub: userId } : undefined }
  const res = makeRes()
  await handler(req, res)
  return res
}

const ATTACKER = 'user-attacker'
const VICTIM = 'user-victim'

function balanceOf(userId: string) {
  return Number((db.user_wallets || []).find((w) => w.user_id === userId)?.itc_balance)
}

function seedDebit(userId: string, amount: number, overrides: Row = {}) {
  const row: Row = {
    id: nextId('debit'),
    created_at: new Date().toISOString(),
    user_id: userId,
    type: 'usage',
    amount: -amount,
    balance_after: 0,
    reference: 'feature_usage',
    metadata: { description: 'Mockup generation: Black Hoodie' },
    ...overrides,
  }
  db.itc_transactions.push(row)
  return row
}

beforeEach(() => {
  idCounter = 0
  rpcInstalled = true
  db = {
    user_wallets: [
      { user_id: ATTACKER, itc_balance: 100 },
      { user_id: VICTIM, itc_balance: 500 },
    ],
    itc_transactions: [],
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// The hole itself
// ---------------------------------------------------------------------------
describe('POST /refund-itc — self-mint attempts', () => {
  it('refuses a refund when no debit ever happened', async () => {
    const res = await call(refundHandler, ATTACKER, { amount: 1_000_000, reason: 'free money' })

    expect(res.statusCode).toBe(422)
    expect(res.body.code).toBe('debit_not_found')
    expect(balanceOf(ATTACKER)).toBe(100)
    expect(db.itc_transactions).toHaveLength(0)
  })

  it('refuses a fabricated debit_transaction_id', async () => {
    const res = await call(refundHandler, ATTACKER, {
      amount: 25,
      reason: 'refund',
      debit_transaction_id: 'debit-does-not-exist',
    })

    expect(res.statusCode).toBe(422)
    expect(res.body.code).toBe('debit_not_found')
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it("refuses another user's debit and does not leak that it exists", async () => {
    const victimDebit = seedDebit(VICTIM, 250)

    const res = await call(refundHandler, ATTACKER, {
      amount: 250,
      reason: 'refund',
      debit_transaction_id: victimDebit.id,
    })

    expect(res.statusCode).toBe(422)
    expect(res.body.code).toBe('debit_not_found')
    expect(balanceOf(ATTACKER)).toBe(100)
    expect(balanceOf(VICTIM)).toBe(500)
  })

  it('refuses a debit that is not a feature debit — an order paid in ITC stays paid', async () => {
    const orderDebit = seedDebit(ATTACKER, 80, { type: 'redemption', reference: 'order_payment' })

    const res = await call(refundHandler, ATTACKER, {
      amount: 80,
      reason: 'refund my order',
      debit_transaction_id: orderDebit.id,
    })

    expect(res.statusCode).toBe(422)
    expect(res.body.code).toBe('debit_not_found')
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it('refuses to refund a credit row', async () => {
    const credit = seedDebit(ATTACKER, -40, { type: 'reward', reference: 'feature_usage' })

    const res = await call(refundHandler, ATTACKER, {
      amount: 40,
      reason: 'refund',
      debit_transaction_id: credit.id,
    })

    expect(res.statusCode).toBe(422)
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it('caps the refund at the amount actually debited', async () => {
    const debit = seedDebit(ATTACKER, 25)

    const res = await call(refundHandler, ATTACKER, {
      amount: 5000,
      reason: 'refund',
      debit_transaction_id: debit.id,
    })

    expect(res.statusCode).toBe(422)
    expect(res.body.code).toBe('amount_exceeds_debit')
    expect(res.body.debit_amount).toBe(25)
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it('refuses a second refund against the same debit', async () => {
    const debit = seedDebit(ATTACKER, 25)

    const first = await call(refundHandler, ATTACKER, {
      amount: 25,
      reason: 'refund',
      debit_transaction_id: debit.id,
    })
    expect(first.statusCode).toBe(200)
    expect(balanceOf(ATTACKER)).toBe(125)

    const second = await call(refundHandler, ATTACKER, {
      amount: 25,
      reason: 'refund again',
      debit_transaction_id: debit.id,
    })
    expect(second.statusCode).toBe(409)
    expect(second.body.code).toBe('already_refunded')
    expect(balanceOf(ATTACKER)).toBe(125)
  })

  it('a partial refund still burns the debit — no salami-slicing back to the full amount', async () => {
    const debit = seedDebit(ATTACKER, 25)

    await call(refundHandler, ATTACKER, { amount: 5, reason: 'partial', debit_transaction_id: debit.id })
    expect(balanceOf(ATTACKER)).toBe(105)

    for (let i = 0; i < 5; i++) {
      const res = await call(refundHandler, ATTACKER, { amount: 5, reason: 'again', debit_transaction_id: debit.id })
      expect(res.statusCode).toBe(409)
    }
    expect(balanceOf(ATTACKER)).toBe(105)
  })

  it('rejects non-positive and non-numeric amounts before touching the ledger', async () => {
    const debit = seedDebit(ATTACKER, 25)

    for (const amount of [0, -50, 'lots', null, undefined, NaN]) {
      const res = await call(refundHandler, ATTACKER, {
        amount,
        reason: 'refund',
        debit_transaction_id: debit.id,
      })
      expect(res.statusCode).toBe(400)
    }
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it('rejects an unauthenticated request', async () => {
    const res = await call(refundHandler, null, { amount: 25, reason: 'refund' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a refund with no reason', async () => {
    const debit = seedDebit(ATTACKER, 25)
    const res = await call(refundHandler, ATTACKER, { amount: 25, debit_transaction_id: debit.id })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// The legitimate flow the guard has to keep working
// ---------------------------------------------------------------------------
describe('POST /refund-itc — legitimate compensating refund', () => {
  it('deduct → action fails → refund restores exactly the debited amount', async () => {
    const deduct = await call(deductHandler, ATTACKER, { amount: 25, reason: 'Mockup generation: Black Hoodie' })

    expect(deduct.statusCode).toBe(200)
    expect(deduct.body.new_balance).toBe(75)
    expect(typeof deduct.body.transaction_id).toBe('string')

    const refund = await call(refundHandler, ATTACKER, {
      amount: 25,
      reason: 'Refund: mockup gen failed for Black Hoodie',
      reference_type: 'mockup_generation',
      reference_id: 'hoodie-black',
      debit_transaction_id: deduct.body.transaction_id,
    })

    expect(refund.statusCode).toBe(200)
    expect(refund.body.refunded).toBe(25)
    expect(refund.body.new_balance).toBe(100)
    expect(balanceOf(ATTACKER)).toBe(100)

    const refundRow = db.itc_transactions.find((r) => r.type === 'refund')
    expect(refundRow?.metadata.refunded_transaction_id).toBe(deduct.body.transaction_id)
    expect(refundRow?.reference).toBe('mockup_generation')
  })

  it('two separate unlocks each get their own refund', async () => {
    const first = await call(deductHandler, ATTACKER, { amount: 25, reason: 'Mockup: hoodie' })
    const second = await call(deductHandler, ATTACKER, { amount: 25, reason: 'Mockup: tumbler' })
    expect(balanceOf(ATTACKER)).toBe(50)

    const r1 = await call(refundHandler, ATTACKER, {
      amount: 25, reason: 'failed', debit_transaction_id: first.body.transaction_id,
    })
    const r2 = await call(refundHandler, ATTACKER, {
      amount: 25, reason: 'failed', debit_transaction_id: second.body.transaction_id,
    })

    expect(r1.statusCode).toBe(200)
    expect(r2.statusCode).toBe(200)
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it('an older browser bundle that sends no debit id still gets its refund, once', async () => {
    const deduct = await call(deductHandler, ATTACKER, { amount: 25, reason: 'Mockup generation: Tumbler' })
    expect(balanceOf(ATTACKER)).toBe(75)

    const refund = await call(refundHandler, ATTACKER, {
      amount: 25,
      reason: 'Refund: mockup gen failed for Tumbler',
      reference_type: 'mockup_generation',
    })
    expect(refund.statusCode).toBe(200)
    expect(refund.body.debit_transaction_id).toBe(deduct.body.transaction_id)
    expect(balanceOf(ATTACKER)).toBe(100)

    // ...and the same bundle cannot then farm the endpoint, because the only
    // matching debit is now spent.
    const replay = await call(refundHandler, ATTACKER, { amount: 25, reason: 'again' })
    expect(replay.statusCode).toBe(422)
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it('the id-less path will not match a debit that is too old', async () => {
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    seedDebit(ATTACKER, 25, { created_at: stale })

    const res = await call(refundHandler, ATTACKER, { amount: 25, reason: 'refund' })
    expect(res.statusCode).toBe(422)
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it('the id-less path will not match a debit smaller than the refund asked for', async () => {
    seedDebit(ATTACKER, 5)

    const res = await call(refundHandler, ATTACKER, { amount: 25, reason: 'refund' })
    expect(res.statusCode).toBe(422)
    expect(balanceOf(ATTACKER)).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Pre-migration deploys — Render can ship this code before the SQL is applied
// ---------------------------------------------------------------------------
describe('POST /refund-itc — before refund_itc_for_debit() is installed', () => {
  beforeEach(() => {
    rpcInstalled = false
  })

  it('still refunds a genuine debit through the fallback path', async () => {
    const deduct = await call(deductHandler, ATTACKER, { amount: 25, reason: 'Mockup generation: Hoodie' })

    const refund = await call(refundHandler, ATTACKER, {
      amount: 25,
      reason: 'failed',
      debit_transaction_id: deduct.body.transaction_id,
    })

    expect(refund.statusCode).toBe(200)
    expect(balanceOf(ATTACKER)).toBe(100)
    expect(db.itc_transactions.find((r) => r.type === 'refund')?.metadata.refunded_transaction_id)
      .toBe(deduct.body.transaction_id)
  })

  it('still refuses an unbacked refund', async () => {
    const res = await call(refundHandler, ATTACKER, { amount: 999999, reason: 'free money' })
    expect(res.statusCode).toBe(422)
    expect(balanceOf(ATTACKER)).toBe(100)
  })

  it('still refuses a double refund', async () => {
    const debit = seedDebit(ATTACKER, 25)

    const first = await call(refundHandler, ATTACKER, { amount: 25, reason: 'x', debit_transaction_id: debit.id })
    const second = await call(refundHandler, ATTACKER, { amount: 25, reason: 'x', debit_transaction_id: debit.id })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(409)
    expect(balanceOf(ATTACKER)).toBe(125)
  })
})
