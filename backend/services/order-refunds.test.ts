import { describe, it, expect } from 'vitest'

// backend/lib/supabase.ts creates its client eagerly at module load, so these
// must exist before order-refunds.ts is evaluated. Every case below injects a
// fake `db` — nothing here ever touches a real Supabase client — so dummy
// values are fine. The dynamic import (rather than a static one, which ESM
// hoists above this file's statements) is what makes the ordering work — same
// pattern as backend/routes/coupons.test.ts and
// backend/services/order-pricing.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  reverseItcStoreCredit,
  reverseBlankInventory,
  reverseCreatorMargins,
  reverseOrderRewards,
  reverseReferralBonus,
  reverseCouponUsage,
  reverseOrderSideEffects,
  refundedCentsFromMetadata
} = await import('./order-refunds.js')

const ORDER_ID = '11111111-1111-1111-1111-111111111111'
const BLANK_ID = '22222222-2222-2222-2222-222222222222'
const USER_ID = '33333333-3333-3333-3333-333333333333'
const CREATOR_ID = '44444444-4444-4444-4444-444444444444'
const PRODUCT_ID = '55555555-5555-5555-5555-555555555555'
const REFERRER_ID = '66666666-6666-6666-6666-666666666666'
const OTHER_ORDER_ID = '77777777-7777-7777-7777-777777777777'
const DISCOUNT_CODE_ID = '88888888-8888-8888-8888-888888888888'

/**
 * In-memory Supabase stand-in with real mutable row state, so a second call to
 * a reversal actually re-reads the marker row the first one wrote — which is
 * exactly what the idempotency guards depend on against real Postgres.
 *
 * Supports the query shapes order-refunds.ts uses: select+eq chains resolved
 * via maybeSingle() / single() / direct await, update().eq(), insert(), rpc().
 */
function makeDb(
  tables: Record<string, Array<Record<string, any>>>,
  rpcImpl?: (fn: string, args: any) => { data: any; error: any }
) {
  const store: Record<string, Array<Record<string, any>>> = {}
  for (const [name, rows] of Object.entries(tables)) store[name] = rows.map(r => ({ ...r }))

  let idSeq = 0
  const nextId = () => `row-${++idSeq}`

  function rowsFor(table: string) {
    if (!store[table]) store[table] = []
    return store[table]
  }

  function makeSelectBuilder(table: string) {
    const filters: Array<[string, any]> = []
    const matches = () => rowsFor(table).filter(row => filters.every(([col, val]) => row[col] === val))

    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => {
        filters.push([col, val])
        return builder
      },
      maybeSingle: async () => {
        const found = matches()
        return { data: found.length > 0 ? { ...found[0] } : null, error: null }
      },
      single: async () => {
        const found = matches()
        if (found.length === 0) return { data: null, error: { message: 'no rows', code: 'PGRST116' } }
        return { data: { ...found[0] }, error: null }
      },
      // Direct `await builder` — PostgREST resolves to the full match set.
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: matches().map(r => ({ ...r })), error: null }).then(resolve, reject)
    }
    return builder
  }

  return {
    _store: store,
    from(table: string) {
      return {
        select: (..._args: any[]) => makeSelectBuilder(table).select(),
        update(patch: Record<string, any>) {
          const filters: Array<[string, any]> = []
          const apply = () => {
            let n = 0
            for (const row of rowsFor(table)) {
              if (filters.every(([col, val]) => row[col] === val)) {
                Object.assign(row, patch)
                n++
              }
            }
            return n
          }
          const chain: any = {
            eq: (col: string, val: any) => {
              filters.push([col, val])
              return chain
            },
            then: (resolve: any, reject: any) => {
              apply()
              return Promise.resolve({ data: null, error: null }).then(resolve, reject)
            }
          }
          return chain
        },
        insert(row: Record<string, any> | Array<Record<string, any>>) {
          const list = Array.isArray(row) ? row : [row]
          const chain: any = {
            then: (resolve: any, reject: any) => {
              for (const r of list) rowsFor(table).push({ id: nextId(), ...r })
              return Promise.resolve({ data: null, error: null }).then(resolve, reject)
            }
          }
          return chain
        }
      }
    },
    async rpc(fn: string, args: any) {
      if (rpcImpl) return rpcImpl(fn, args)
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } }
    }
  } as any
}

describe('reverseItcStoreCredit', () => {
  const spendRow = {
    id: 'spend-1',
    user_id: USER_ID,
    type: 'purchase_payment',
    amount: -500,
    reference: ORDER_ID,
    metadata: { usd_value: 5 }
  }

  it('credits the wallet back and writes a reversal ledger row', async () => {
    const db = makeDb({
      itc_transactions: [spendRow],
      // NUMERIC arrives as a string over the JS client — the real bug class
      // addBalance() exists to prevent ('100' + 500 === '100500').
      user_wallets: [{ user_id: USER_ID, itc_balance: '100' }]
    })

    const result = await reverseItcStoreCredit(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(false)
    expect(db._store.user_wallets[0].itc_balance).toBe(600)
    const reversal = db._store.itc_transactions.find((t: any) => t.type === 'purchase_payment_refund')
    expect(reversal).toBeTruthy()
    expect(reversal.amount).toBe(500)
    expect(reversal.balance_after).toBe(600)
    expect(reversal.reference).toBe(ORDER_ID)
  })

  it('is idempotent — a second run credits nothing more', async () => {
    const db = makeDb({
      itc_transactions: [spendRow],
      user_wallets: [{ user_id: USER_ID, itc_balance: '100' }]
    })

    await reverseItcStoreCredit(ORDER_ID, undefined, db)
    const second = await reverseItcStoreCredit(ORDER_ID, undefined, db)

    expect(second.ok).toBe(true)
    expect(second.skipped).toBe(true)
    expect(db._store.user_wallets[0].itc_balance).toBe(600)
    expect(db._store.itc_transactions.filter((t: any) => t.type === 'purchase_payment_refund')).toHaveLength(1)
  })

  it('skips cleanly when no store credit was applied to the order', async () => {
    const db = makeDb({ itc_transactions: [], user_wallets: [{ user_id: USER_ID, itc_balance: '100' }] })
    const result = await reverseItcStoreCredit(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
    expect(db._store.user_wallets[0].itc_balance).toBe('100')
  })

  it('reports a failure (never throws) when the wallet is missing', async () => {
    const db = makeDb({ itc_transactions: [spendRow], user_wallets: [] })
    const result = await reverseItcStoreCredit(ORDER_ID, undefined, db)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/wallet not found/)
  })
})

describe('reverseBlankInventory', () => {
  const saleMovement = { id: 'mv-1', blank_id: BLANK_ID, delta: -3, reason: 'sale', order_id: ORDER_ID, note: null }

  it('restocks through the reverse_blank_sale RPC when it exists', async () => {
    const db = makeDb(
      {
        blank_inventory_movements: [saleMovement],
        blank_inventory: [{ id: BLANK_ID, qty_on_hand: 7, cost_per_unit: 4 }]
      },
      (fn, args) => {
        expect(fn).toBe('reverse_blank_sale')
        expect(args).toEqual({ p_blank_id: BLANK_ID, p_order_id: ORDER_ID, p_qty: 3 })
        return { data: true, error: null }
      }
    )

    const result = await reverseBlankInventory(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(false)
    expect(result.details?.restocked).toEqual([{ blankId: BLANK_ID, qty: 3, via: 'rpc' }])
  })

  it('falls back to a marker movement + qty update when the RPC is not deployed', async () => {
    const db = makeDb({
      blank_inventory_movements: [saleMovement],
      blank_inventory: [{ id: BLANK_ID, qty_on_hand: 7, cost_per_unit: 4 }]
    }) // default rpc impl returns PGRST202 (function not found)

    const result = await reverseBlankInventory(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(result.details?.restocked).toEqual([{ blankId: BLANK_ID, qty: 3, via: 'fallback' }])
    expect(db._store.blank_inventory[0].qty_on_hand).toBe(10)
    const marker = db._store.blank_inventory_movements.find((m: any) => m.reason === 'adjustment')
    expect(marker).toMatchObject({ blank_id: BLANK_ID, delta: 3, order_id: ORDER_ID })
    expect(marker.note).toBe(`Refund reversal for order ${ORDER_ID}`)
  })

  it('is idempotent on the fallback path — a second run restocks nothing more', async () => {
    const db = makeDb({
      blank_inventory_movements: [saleMovement],
      blank_inventory: [{ id: BLANK_ID, qty_on_hand: 7, cost_per_unit: 4 }]
    })

    await reverseBlankInventory(ORDER_ID, undefined, db)
    const second = await reverseBlankInventory(ORDER_ID, undefined, db)

    expect(second).toMatchObject({ ok: true, skipped: true })
    expect(db._store.blank_inventory[0].qty_on_hand).toBe(10)
    expect(db._store.blank_inventory_movements.filter((m: any) => m.reason === 'adjustment')).toHaveLength(1)
  })

  it('treats an already-written RPC refund movement as done', async () => {
    const db = makeDb({
      blank_inventory_movements: [
        saleMovement,
        { id: 'mv-2', blank_id: BLANK_ID, delta: 3, reason: 'refund', order_id: ORDER_ID, note: null }
      ],
      blank_inventory: [{ id: BLANK_ID, qty_on_hand: 10, cost_per_unit: 4 }]
    })

    const result = await reverseBlankInventory(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
    expect(db._store.blank_inventory[0].qty_on_hand).toBe(10)
  })

  it('skips when the order never decremented inventory', async () => {
    const db = makeDb({ blank_inventory_movements: [], blank_inventory: [] })
    const result = await reverseBlankInventory(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
  })
})

describe('reverseCreatorMargins', () => {
  const royaltyRow = {
    id: 'roy-1',
    user_id: CREATOR_ID,
    product_id: PRODUCT_ID,
    order_id: ORDER_ID,
    itc_amount: 400,
    amount_cents: 400,
    status: 'credited',
    metadata: { model: 'margin_d1' }
  }

  it('debits the creator wallet and marks the accrual reversed', async () => {
    const db = makeDb({
      user_product_royalties: [royaltyRow],
      user_wallets: [{ user_id: CREATOR_ID, itc_balance: '1000' }],
      itc_transactions: []
    })

    const result = await reverseCreatorMargins(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(db._store.user_wallets[0].itc_balance).toBe(600)
    expect(db._store.user_product_royalties[0].status).toBe('reversed')
    const ledger = db._store.itc_transactions.find((t: any) => t.type === 'royalty_reversal')
    expect(ledger).toMatchObject({ amount: -400, balance_after: 600, reference: ORDER_ID })
    expect(ledger.metadata.product_id).toBe(PRODUCT_ID)
    expect(result.details?.totalShortfallItc).toBe(0)
  })

  it('floors the wallet at zero and reports the unrecovered shortfall', async () => {
    const db = makeDb({
      user_product_royalties: [royaltyRow],
      // Creator already cashed most of it out.
      user_wallets: [{ user_id: CREATOR_ID, itc_balance: '150' }],
      itc_transactions: []
    })

    const result = await reverseCreatorMargins(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(db._store.user_wallets[0].itc_balance).toBe(0)
    expect(result.details?.totalShortfallItc).toBe(250)
    const ledger = db._store.itc_transactions.find((t: any) => t.type === 'royalty_reversal')
    expect(ledger.amount).toBe(-150)
    expect(ledger.metadata.shortfall_itc).toBe(250)
  })

  it('is idempotent — a second run does not debit twice', async () => {
    const db = makeDb({
      user_product_royalties: [royaltyRow],
      user_wallets: [{ user_id: CREATOR_ID, itc_balance: '1000' }],
      itc_transactions: []
    })

    await reverseCreatorMargins(ORDER_ID, undefined, db)
    const second = await reverseCreatorMargins(ORDER_ID, undefined, db)

    expect(second).toMatchObject({ ok: true, skipped: true })
    expect(db._store.user_wallets[0].itc_balance).toBe(600)
    expect(db._store.itc_transactions.filter((t: any) => t.type === 'royalty_reversal')).toHaveLength(1)
  })

  it('marks a pending (never-credited) accrual without touching any wallet', async () => {
    const db = makeDb({
      user_product_royalties: [{ ...royaltyRow, status: 'pending' }],
      user_wallets: [{ user_id: CREATOR_ID, itc_balance: '1000' }],
      itc_transactions: []
    })

    const result = await reverseCreatorMargins(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(db._store.user_wallets[0].itc_balance).toBe('1000')
    expect(db._store.user_product_royalties[0].status).toBe('reversed')
  })

  it('skips when no creator margin was accrued', async () => {
    const db = makeDb({ user_product_royalties: [], user_wallets: [], itc_transactions: [] })
    const result = await reverseCreatorMargins(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
  })
})

describe('reverseOrderRewards', () => {
  const rewardRow = { id: 'rew-1', order_id: ORDER_ID, user_id: USER_ID, itc_bonus: 20, status: 'awarded' }

  it('debits the wallet and marks the order_rewards row reversed', async () => {
    const db = makeDb({
      order_rewards: [rewardRow],
      user_wallets: [{ user_id: USER_ID, itc_balance: '100' }],
      itc_transactions: []
    })

    const result = await reverseOrderRewards(ORDER_ID, undefined, db)

    expect(result).toMatchObject({ ok: true, skipped: false })
    expect(db._store.user_wallets[0].itc_balance).toBe(80)
    expect(db._store.order_rewards[0].status).toBe('reversed')
    const ledger = db._store.itc_transactions.find((t: any) => t.type === 'order_reward_refund')
    expect(ledger).toMatchObject({ amount: -20, balance_after: 80, reference: ORDER_ID })
  })

  it('is idempotent — a second run debits nothing more', async () => {
    const db = makeDb({
      order_rewards: [rewardRow],
      user_wallets: [{ user_id: USER_ID, itc_balance: '100' }],
      itc_transactions: []
    })

    await reverseOrderRewards(ORDER_ID, undefined, db)
    const second = await reverseOrderRewards(ORDER_ID, undefined, db)

    expect(second).toMatchObject({ ok: true, skipped: true })
    expect(db._store.user_wallets[0].itc_balance).toBe(80)
    expect(db._store.itc_transactions.filter((t: any) => t.type === 'order_reward_refund')).toHaveLength(1)
  })

  it('floors the wallet at zero and reports the shortfall when the ITC was already spent', async () => {
    const db = makeDb({
      order_rewards: [rewardRow],
      user_wallets: [{ user_id: USER_ID, itc_balance: '5' }],
      itc_transactions: []
    })

    const result = await reverseOrderRewards(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(db._store.user_wallets[0].itc_balance).toBe(0)
    expect(result.details?.shortfallItc).toBe(15)
    const ledger = db._store.itc_transactions.find((t: any) => t.type === 'order_reward_refund')
    expect(ledger.amount).toBe(-5)
    expect(ledger.metadata.shortfall_itc).toBe(15)
  })

  it('skips when no rewards were awarded for this order', async () => {
    const db = makeDb({ order_rewards: [], user_wallets: [], itc_transactions: [] })
    const result = await reverseOrderRewards(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
  })

  it('skips a never-awarded (failed/pending) reward without touching any wallet', async () => {
    const db = makeDb({
      order_rewards: [{ ...rewardRow, status: 'failed' }],
      user_wallets: [{ user_id: USER_ID, itc_balance: '100' }],
      itc_transactions: []
    })
    const result = await reverseOrderRewards(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
    expect(db._store.user_wallets[0].itc_balance).toBe('100')
  })

  it('skips a points-only award (no ITC bonus)', async () => {
    const db = makeDb({
      order_rewards: [{ ...rewardRow, itc_bonus: 0 }],
      user_wallets: [{ user_id: USER_ID, itc_balance: '100' }],
      itc_transactions: []
    })
    const result = await reverseOrderRewards(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
    expect(db._store.user_wallets[0].itc_balance).toBe('100')
  })
})

describe('reverseReferralBonus', () => {
  const buyerOrder = { id: ORDER_ID, user_id: USER_ID, created_at: '2026-01-01T00:00:00Z', payment_status: 'paid' }
  const bonusTx = { id: 'reftx-1', referee_id: USER_ID, referrer_id: REFERRER_ID, referrer_reward_itc: 50, type: 'purchase', status: 'completed' }

  it("debits the referrer when the refunded order is the buyer's first paid order", async () => {
    const db = makeDb({
      orders: [buyerOrder],
      referral_transactions: [bonusTx],
      user_wallets: [{ user_id: REFERRER_ID, itc_balance: '200' }],
      itc_transactions: []
    })

    const result = await reverseReferralBonus(ORDER_ID, undefined, db)

    expect(result).toMatchObject({ ok: true, skipped: false })
    expect(db._store.user_wallets[0].itc_balance).toBe(150)
    expect(db._store.referral_transactions[0].status).toBe('reversed')
    const ledger = db._store.itc_transactions.find((t: any) => t.type === 'referral_bonus_refund')
    expect(ledger).toMatchObject({ amount: -50, balance_after: 150, reference: ORDER_ID, user_id: REFERRER_ID })
  })

  it('is idempotent — a second run debits nothing more', async () => {
    const db = makeDb({
      orders: [buyerOrder],
      referral_transactions: [bonusTx],
      user_wallets: [{ user_id: REFERRER_ID, itc_balance: '200' }],
      itc_transactions: []
    })

    await reverseReferralBonus(ORDER_ID, undefined, db)
    const second = await reverseReferralBonus(ORDER_ID, undefined, db)

    expect(second).toMatchObject({ ok: true, skipped: true })
    expect(db._store.user_wallets[0].itc_balance).toBe(150)
  })

  it('floors the referrer wallet at zero and reports the shortfall', async () => {
    const db = makeDb({
      orders: [buyerOrder],
      referral_transactions: [bonusTx],
      user_wallets: [{ user_id: REFERRER_ID, itc_balance: '10' }],
      itc_transactions: []
    })

    const result = await reverseReferralBonus(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(db._store.user_wallets[0].itc_balance).toBe(0)
    expect(result.details?.shortfallItc).toBe(40)
  })

  it('skips when this user never triggered a referral bonus', async () => {
    const db = makeDb({ orders: [buyerOrder], referral_transactions: [], user_wallets: [], itc_transactions: [] })
    const result = await reverseReferralBonus(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
  })

  it("skips when the refunded order is NOT the buyer's first paid order — the bonus stays put", async () => {
    // OTHER_ORDER_ID was created first and is also paid, so it — not ORDER_ID
    // — is the order the referral bonus was actually tied to.
    const db = makeDb({
      orders: [
        { id: OTHER_ORDER_ID, user_id: USER_ID, created_at: '2025-12-01T00:00:00Z', payment_status: 'paid' },
        buyerOrder
      ],
      referral_transactions: [bonusTx],
      user_wallets: [{ user_id: REFERRER_ID, itc_balance: '200' }],
      itc_transactions: []
    })

    const result = await reverseReferralBonus(ORDER_ID, undefined, db)

    expect(result).toMatchObject({ ok: true, skipped: true })
    expect(db._store.user_wallets[0].itc_balance).toBe('200')
    expect(db._store.referral_transactions[0].status).toBe('completed')
  })

  it('ignores a chronologically-earlier order that was never actually paid', async () => {
    // An abandoned/pending order must not outrank the real first purchase.
    const db = makeDb({
      orders: [
        { id: OTHER_ORDER_ID, user_id: USER_ID, created_at: '2025-12-01T00:00:00Z', payment_status: 'pending' },
        buyerOrder
      ],
      referral_transactions: [bonusTx],
      user_wallets: [{ user_id: REFERRER_ID, itc_balance: '200' }],
      itc_transactions: []
    })

    const result = await reverseReferralBonus(ORDER_ID, undefined, db)

    expect(result).toMatchObject({ ok: true, skipped: false })
    expect(db._store.user_wallets[0].itc_balance).toBe(150)
  })
})

describe('reverseCouponUsage', () => {
  const usageRow = { id: 'cu-1', discount_code_id: DISCOUNT_CODE_ID, order_id: ORDER_ID, reversed_at: null }

  it('decrements current_uses and marks the usage row reversed', async () => {
    const db = makeDb({
      coupon_usage: [usageRow],
      discount_codes: [{ id: DISCOUNT_CODE_ID, current_uses: 3 }]
    })

    const result = await reverseCouponUsage(ORDER_ID, undefined, db)

    expect(result).toMatchObject({ ok: true, skipped: false })
    expect(db._store.discount_codes[0].current_uses).toBe(2)
    expect(db._store.coupon_usage[0].reversed_at).toBeTruthy()
  })

  it('is idempotent — a second run decrements nothing more', async () => {
    const db = makeDb({
      coupon_usage: [usageRow],
      discount_codes: [{ id: DISCOUNT_CODE_ID, current_uses: 3 }]
    })

    await reverseCouponUsage(ORDER_ID, undefined, db)
    const second = await reverseCouponUsage(ORDER_ID, undefined, db)

    expect(second).toMatchObject({ ok: true, skipped: true })
    expect(db._store.discount_codes[0].current_uses).toBe(2)
  })

  it('never drives current_uses negative', async () => {
    const db = makeDb({
      coupon_usage: [usageRow],
      discount_codes: [{ id: DISCOUNT_CODE_ID, current_uses: 0 }]
    })

    const result = await reverseCouponUsage(ORDER_ID, undefined, db)

    expect(result.ok).toBe(true)
    expect(db._store.discount_codes[0].current_uses).toBe(0)
  })

  it('skips when no coupon was used on this order', async () => {
    const db = makeDb({ coupon_usage: [], discount_codes: [] })
    const result = await reverseCouponUsage(ORDER_ID, undefined, db)
    expect(result).toMatchObject({ ok: true, skipped: true })
  })
})

describe('reverseOrderSideEffects', () => {
  it('reports ok when every step succeeds or is a no-op', async () => {
    const db = makeDb({
      orders: [{ id: ORDER_ID, user_id: USER_ID, created_at: '2026-01-01T00:00:00Z', payment_status: 'paid' }],
      itc_transactions: [
        { id: 'spend-1', user_id: USER_ID, type: 'purchase_payment', amount: -500, reference: ORDER_ID, metadata: {} }
      ],
      user_wallets: [
        { user_id: USER_ID, itc_balance: '100' },
        { user_id: CREATOR_ID, itc_balance: '1000' },
        { user_id: REFERRER_ID, itc_balance: '200' }
      ],
      blank_inventory_movements: [{ id: 'mv-1', blank_id: BLANK_ID, delta: -2, reason: 'sale', order_id: ORDER_ID, note: null }],
      blank_inventory: [{ id: BLANK_ID, qty_on_hand: 5, cost_per_unit: 4 }],
      user_product_royalties: [
        { id: 'roy-1', user_id: CREATOR_ID, product_id: PRODUCT_ID, order_id: ORDER_ID, itc_amount: 400, amount_cents: 400, status: 'credited', metadata: {} }
      ],
      order_rewards: [{ id: 'rew-1', order_id: ORDER_ID, user_id: USER_ID, itc_bonus: 20, status: 'awarded' }],
      referral_transactions: [{ id: 'reftx-1', referee_id: USER_ID, referrer_id: REFERRER_ID, referrer_reward_itc: 50, type: 'purchase', status: 'completed' }],
      coupon_usage: [{ id: 'cu-1', discount_code_id: DISCOUNT_CODE_ID, order_id: ORDER_ID, reversed_at: null }],
      discount_codes: [{ id: DISCOUNT_CODE_ID, current_uses: 3 }]
    })

    const report = await reverseOrderSideEffects(ORDER_ID, undefined, db)

    expect(report.ok).toBe(true)
    // itcStoreCredit (+500) then loyaltyItc (-20): 100 -> 600 -> 580.
    expect(db._store.user_wallets.find((w: any) => w.user_id === USER_ID).itc_balance).toBe(580)
    expect(db._store.blank_inventory[0].qty_on_hand).toBe(7)
    expect(db._store.user_wallets.find((w: any) => w.user_id === CREATOR_ID).itc_balance).toBe(600)
    expect(db._store.user_wallets.find((w: any) => w.user_id === REFERRER_ID).itc_balance).toBe(150)
    expect(report.loyaltyItc).toMatchObject({ ok: true, skipped: false })
    expect(report.referralBonus).toMatchObject({ ok: true, skipped: false })
    expect(report.couponUsage).toMatchObject({ ok: true, skipped: false })
    expect(db._store.order_rewards[0].status).toBe('reversed')
    expect(db._store.referral_transactions[0].status).toBe('reversed')
    expect(db._store.discount_codes[0].current_uses).toBe(2)
    expect(db._store.coupon_usage[0].reversed_at).toBeTruthy()
  })

  it('reports ok:false when a single step fails, and still runs the others', async () => {
    const db = makeDb({
      // Store-credit spend row with no wallet to credit back → that step fails.
      itc_transactions: [
        { id: 'spend-1', user_id: USER_ID, type: 'purchase_payment', amount: -500, reference: ORDER_ID, metadata: {} }
      ],
      user_wallets: [],
      blank_inventory_movements: [{ id: 'mv-1', blank_id: BLANK_ID, delta: -2, reason: 'sale', order_id: ORDER_ID, note: null }],
      blank_inventory: [{ id: BLANK_ID, qty_on_hand: 5, cost_per_unit: 4 }],
      user_product_royalties: []
    })

    const report = await reverseOrderSideEffects(ORDER_ID, undefined, db)

    expect(report.ok).toBe(false)
    expect(report.itcStoreCredit.ok).toBe(false)
    // The failure did not abort the rest of the pipeline.
    expect(report.inventory.ok).toBe(true)
    expect(db._store.blank_inventory[0].qty_on_hand).toBe(7)
    expect(report.creatorMargins).toMatchObject({ ok: true, skipped: true })
  })

  it('is idempotent end-to-end — simulates Stripe redelivering charge.refunded twice', async () => {
    const db = makeDb({
      orders: [{ id: ORDER_ID, user_id: USER_ID, created_at: '2026-01-01T00:00:00Z', payment_status: 'paid' }],
      itc_transactions: [
        { id: 'spend-1', user_id: USER_ID, type: 'purchase_payment', amount: -500, reference: ORDER_ID, metadata: {} }
      ],
      user_wallets: [
        { user_id: USER_ID, itc_balance: '100' },
        { user_id: CREATOR_ID, itc_balance: '1000' },
        { user_id: REFERRER_ID, itc_balance: '200' }
      ],
      blank_inventory_movements: [{ id: 'mv-1', blank_id: BLANK_ID, delta: -2, reason: 'sale', order_id: ORDER_ID, note: null }],
      blank_inventory: [{ id: BLANK_ID, qty_on_hand: 5, cost_per_unit: 4 }],
      user_product_royalties: [
        { id: 'roy-1', user_id: CREATOR_ID, product_id: PRODUCT_ID, order_id: ORDER_ID, itc_amount: 400, amount_cents: 400, status: 'credited', metadata: {} }
      ],
      order_rewards: [{ id: 'rew-1', order_id: ORDER_ID, user_id: USER_ID, itc_bonus: 20, status: 'awarded' }],
      referral_transactions: [{ id: 'reftx-1', referee_id: USER_ID, referrer_id: REFERRER_ID, referrer_reward_itc: 50, type: 'purchase', status: 'completed' }],
      coupon_usage: [{ id: 'cu-1', discount_code_id: DISCOUNT_CODE_ID, order_id: ORDER_ID, reversed_at: null }],
      discount_codes: [{ id: DISCOUNT_CODE_ID, current_uses: 3 }]
    })

    // In production this webhook redelivery would never even reach here — the
    // caller's claimOnce() on orders.status is the outer gate — but every step
    // inside reverseOrderSideEffects must ALSO be safe to run twice on its own
    // (e.g. an admin manually retrying a partially-failed reversal), which is
    // exactly what this asserts by calling it directly a second time.
    const first = await reverseOrderSideEffects(ORDER_ID, undefined, db)
    const second = await reverseOrderSideEffects(ORDER_ID, undefined, db)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    for (const step of ['itcStoreCredit', 'inventory', 'creatorMargins', 'loyaltyItc', 'referralBonus', 'couponUsage'] as const) {
      expect(second[step]).toMatchObject({ ok: true, skipped: true })
    }

    // Nothing moved a second time — no negative balances, no double credit.
    expect(db._store.user_wallets.find((w: any) => w.user_id === USER_ID).itc_balance).toBe(580)
    expect(db._store.user_wallets.find((w: any) => w.user_id === CREATOR_ID).itc_balance).toBe(600)
    expect(db._store.user_wallets.find((w: any) => w.user_id === REFERRER_ID).itc_balance).toBe(150)
    expect(db._store.blank_inventory[0].qty_on_hand).toBe(7)
    expect(db._store.discount_codes[0].current_uses).toBe(2)
    expect(db._store.itc_transactions.filter((t: any) => t.type === 'order_reward_refund')).toHaveLength(1)
    expect(db._store.itc_transactions.filter((t: any) => t.type === 'referral_bonus_refund')).toHaveLength(1)
  })
})

describe('refundedCentsFromMetadata', () => {
  it('sums recorded refunds and tolerates junk', () => {
    expect(refundedCentsFromMetadata(null)).toBe(0)
    expect(refundedCentsFromMetadata({})).toBe(0)
    expect(refundedCentsFromMetadata({ refunds: 'nope' })).toBe(0)
    expect(refundedCentsFromMetadata({ refunds: [{ amount_cents: 500 }, { amount_cents: 250 }] })).toBe(750)
    expect(refundedCentsFromMetadata({ refunds: [{ amount_cents: 500 }, {}] })).toBe(500)
  })
})
