import { describe, it, expect, vi, beforeEach } from 'vitest'

// referral-service talks to Supabase through one module-level client. The stub
// below answers per table / per rpc from `db`, and records every rpc and insert
// so the tests can say exactly what reached the database.
const db: {
  authUser: { created_at: string } | null
  orders: Array<{ id: string; payment_status: string | null }>
  rpc: Record<string, any>
  rpcCalls: Array<{ fn: string; args: any }>
  inserts: any[]
  insertResults: Array<{ data: any; error: any }>
  activeCode: any
  transactions: any[]
} = {
  authUser: null,
  orders: [],
  rpc: {},
  rpcCalls: [],
  inserts: [],
  insertResults: [],
  activeCode: null,
  transactions: []
}

vi.mock('../lib/supabase.js', () => {
  const chain = (table: string): any => {
    const c: any = {}
    let inserted: any = null
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
    c.insert = (row: any) => {
      inserted = row
      db.inserts.push({ table, row })
      return c
    }
    const result = () => {
      if (inserted) return db.insertResults.shift() || { data: { id: 'new', ...inserted }, error: null }
      if (table === 'orders') return { data: db.orders, error: null }
      if (table === 'referral_codes') return { data: db.activeCode ? [db.activeCode] : [], error: null }
      if (table === 'referral_transactions') return { data: db.transactions, error: null }
      return { data: null, error: null }
    }
    c.single = async () => result()
    c.maybeSingle = async () => (table === 'referral_codes' && !inserted ? { data: db.activeCode, error: null } : result())
    c.then = (res: any, rej: any) => Promise.resolve(result()).then(res, rej)
    return c
  }
  return {
    supabase: {
      from: (table: string) => chain(table),
      rpc: async (fn: string, args: any) => {
        db.rpcCalls.push({ fn, args })
        return { data: db.rpc[fn], error: null }
      },
      auth: {
        admin: {
          getUserById: async () =>
            db.authUser ? { data: { user: db.authUser }, error: null } : { data: { user: null }, error: { message: 'User not found' } }
        }
      }
    }
  }
})

const {
  newAccountRefusal,
  REFERRAL_NEW_ACCOUNT_DAYS,
  processReferralSignup,
  processReferralFirstPurchase,
  createReferralCode,
  getReferralStats
} = await import('./referral-service.js')

const DAY = 24 * 60 * 60 * 1000
const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString()

beforeEach(() => {
  db.authUser = { created_at: minutesAgo(5) }
  db.orders = []
  db.rpc = {}
  db.rpcCalls = []
  db.inserts = []
  db.insertResults = []
  db.activeCode = null
  db.transactions = []
})

describe('newAccountRefusal', () => {
  const now = Date.parse('2026-10-07T20:00:00Z')

  it('lets a minutes-old account with no orders join', () => {
    expect(newAccountRefusal('2026-10-07T19:55:00Z', 0, now)).toBeNull()
  })

  it(`refuses an account older than ${REFERRAL_NEW_ACCOUNT_DAYS} days`, () => {
    expect(newAccountRefusal(new Date(now - (REFERRAL_NEW_ACCOUNT_DAYS + 1) * DAY).toISOString(), 0, now)).toBe('not_new_account')
  })

  it('refuses an account that has ever paid for an order', () => {
    expect(newAccountRefusal('2026-10-07T19:55:00Z', 1, now)).toBe('not_new_account')
  })

  it('refuses when the creation date is unknown', () => {
    expect(newAccountRefusal(null, 0, now)).toBe('not_new_account')
  })
})

describe('processReferralSignup', () => {
  it('records the link through process_referral_reward with the code upper-cased', async () => {
    db.rpc.process_referral_reward = { success: true, transaction_id: 'tx-1', referrer_id: 'referrer-1' }
    const result = await processReferralSignup(' refab12cd ', 'friend-1', 'friend@example.com')
    expect(result).toMatchObject({ success: true, already: false, transactionId: 'tx-1', referrerId: 'referrer-1' })
    expect(db.rpcCalls).toEqual([
      {
        fn: 'process_referral_reward',
        args: { p_referral_code: 'REFAB12CD', p_referee_id: 'friend-1', p_referee_email: 'friend@example.com', p_reward_type: 'signup' }
      }
    ])
  })

  it('passes a repeat of the same link through as a no-op', async () => {
    db.rpc.process_referral_reward = { success: true, already: true, transaction_id: 'tx-1' }
    expect(await processReferralSignup('REFAB12CD', 'friend-1', '')).toMatchObject({ success: true, already: true })
  })

  it('refuses an existing customer before touching the reward function', async () => {
    db.orders = [{ id: 'o1', payment_status: 'pending' }, { id: 'o2', payment_status: 'paid' }]
    const result = await processReferralSignup('REFAB12CD', 'friend-1', '')
    expect(result).toMatchObject({ success: false, reason: 'not_new_account' })
    expect(db.rpcCalls).toEqual([])
  })

  it('an abandoned unpaid checkout does not make an account old', async () => {
    db.orders = [{ id: 'o1', payment_status: 'pending' }]
    db.rpc.process_referral_reward = { success: true, transaction_id: 'tx-2' }
    expect(await processReferralSignup('REFAB12CD', 'friend-1', '')).toMatchObject({ success: true })
  })

  it("refuses an account created long before it opened the link", async () => {
    db.authUser = { created_at: new Date(Date.now() - 30 * DAY).toISOString() }
    expect(await processReferralSignup('REFAB12CD', 'friend-1', '')).toMatchObject({ success: false, reason: 'not_new_account' })
    expect(db.rpcCalls).toEqual([])
  })

  it.each(['own_code', 'already_referred', 'invalid_code'])('surfaces the database refusal %s', async (reason) => {
    db.rpc.process_referral_reward = { success: false, reason, error: 'no' }
    expect(await processReferralSignup('REFAB12CD', 'friend-1', '')).toMatchObject({ success: false, reason })
  })
})

describe('processReferralFirstPurchase', () => {
  it('pays through award_referral_first_order with the order id', async () => {
    db.rpc.award_referral_first_order = { success: true, bonus_itc: '50', referrer_id: 'referrer-1', transaction_id: 'tx-9' }
    const result = await processReferralFirstPurchase('friend-1', 42, 'order-1')
    expect(result).toEqual({ success: true, bonusITC: 50, referrerId: 'referrer-1', transactionId: 'tx-9' })
    expect(db.rpcCalls).toEqual([{ fn: 'award_referral_first_order', args: { p_referee_id: 'friend-1', p_order_id: 'order-1' } }])
  })

  it('is a quiet no-op for an account nobody referred, or a second order', async () => {
    db.rpc.award_referral_first_order = { success: false, message: 'User was not referred' }
    expect(await processReferralFirstPurchase('friend-1', 42)).toEqual({ success: false, message: 'User was not referred' })
    expect(db.rpcCalls[0].args.p_order_id).toBeNull()
  })
})

describe('createReferralCode', () => {
  it('creates one active code for the account', async () => {
    const result = await createReferralCode({ userId: 'referrer-1' })
    expect(result.success).toBe(true)
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0].row).toMatchObject({ user_id: 'referrer-1', is_active: true })
    expect(db.inserts[0].row.code).toMatch(/^REF[A-Z0-9]{1,6}$/)
  })

  it('a racing second create returns the code the first one made', async () => {
    db.insertResults = [{ data: null, error: { code: '23505', message: 'duplicate key' } }]
    db.activeCode = { id: 'c1', user_id: 'referrer-1', code: 'REFWINNER', is_active: true }
    const result = await createReferralCode({ userId: 'referrer-1' })
    expect(result).toEqual({ success: true, code: db.activeCode })
    expect(db.inserts).toHaveLength(1)
  })

  it('a code collision with someone else retries with a new code', async () => {
    db.insertResults = [{ data: null, error: { code: '23505', message: 'duplicate key' } }]
    const result = await createReferralCode({ userId: 'referrer-1' })
    expect(result.success).toBe(true)
    expect(db.inserts).toHaveLength(2)
  })
})

describe('getReferralStats', () => {
  it('counts friends who joined, not rows, and sums NUMERIC ITC as numbers', async () => {
    db.activeCode = { id: 'c1', user_id: 'referrer-1', code: 'REFAB12CD', is_active: true }
    db.transactions = [
      { id: 't3', type: 'purchase', referrer_reward_itc: '50', referrer_reward_points: 0 },
      { id: 't2', type: 'signup', referrer_reward_itc: '0', referrer_reward_points: 0 },
      { id: 't1', type: 'signup', referrer_reward_itc: '0', referrer_reward_points: 0 }
    ]
    const result = await getReferralStats('referrer-1')
    expect(result.stats).toMatchObject({
      totalReferrals: 2,
      firstOrders: 1,
      totalITCEarned: 50,
      activeCode: 'REFAB12CD',
      referralCode: db.activeCode
    })
  })
})
