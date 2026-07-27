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
  reverseOrderSideEffects,
  refundedCentsFromMetadata
} = await import('./order-refunds.js')

const ORDER_ID = '11111111-1111-1111-1111-111111111111'
const BLANK_ID = '22222222-2222-2222-2222-222222222222'
const USER_ID = '33333333-3333-3333-3333-333333333333'
const CREATOR_ID = '44444444-4444-4444-4444-444444444444'
const PRODUCT_ID = '55555555-5555-5555-5555-555555555555'

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

describe('reverseOrderSideEffects', () => {
  it('reports ok when every step succeeds or is a no-op', async () => {
    const db = makeDb({
      itc_transactions: [
        { id: 'spend-1', user_id: USER_ID, type: 'purchase_payment', amount: -500, reference: ORDER_ID, metadata: {} }
      ],
      user_wallets: [
        { user_id: USER_ID, itc_balance: '100' },
        { user_id: CREATOR_ID, itc_balance: '1000' }
      ],
      blank_inventory_movements: [{ id: 'mv-1', blank_id: BLANK_ID, delta: -2, reason: 'sale', order_id: ORDER_ID, note: null }],
      blank_inventory: [{ id: BLANK_ID, qty_on_hand: 5, cost_per_unit: 4 }],
      user_product_royalties: [
        { id: 'roy-1', user_id: CREATOR_ID, product_id: PRODUCT_ID, order_id: ORDER_ID, itc_amount: 400, amount_cents: 400, status: 'credited', metadata: {} }
      ]
    })

    const report = await reverseOrderSideEffects(ORDER_ID, undefined, db)

    expect(report.ok).toBe(true)
    expect(db._store.user_wallets.find((w: any) => w.user_id === USER_ID).itc_balance).toBe(600)
    expect(db._store.blank_inventory[0].qty_on_hand).toBe(7)
    expect(db._store.user_wallets.find((w: any) => w.user_id === CREATOR_ID).itc_balance).toBe(600)
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
