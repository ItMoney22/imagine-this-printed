import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { creditItcPurchaseOnce, type ItcPurchaseDb } from './itc-purchase-claim.js'

/**
 * In-memory model of claim_itc_purchase(): a per-user lock (the FOR UPDATE
 * on user_wallets) plus a unique purchase reference. Two calls that overlap
 * on the same payment intent serialize; the second finds the reference taken
 * and does not move the balance. This is the contract the SQL function
 * enforces in Postgres — the assertions below fail if the TS caller credits
 * on a lost claim.
 */
function makeLedger(initialBalance = 100) {
  const wallets = new Map<string, number>([['user-1', initialBalance]])
  const purchases = new Map<string, { id: string; amount: number; balanceAfter: number }>()
  const chains = new Map<string, Promise<unknown>>()
  let seq = 0
  let rpcCalls = 0

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    chains.set(key, run.then(() => undefined, () => undefined))
    return run
  }

  const db: ItcPurchaseDb = {
    rpc(fn, args) {
      rpcCalls += 1
      if (fn !== 'claim_itc_purchase') {
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } })
      }
      const userId = String(args.p_user_id)
      const reference = String(args.p_reference)
      const amount = Number(args.p_amount)
      return withLock(userId, async () => {
        // Yield while the lock is held so a second caller is actually waiting,
        // not merely sequenced by accident of a fully synchronous body.
        await Promise.resolve()
        if (purchases.has(reference)) {
          return {
            data: [{ claimed: false, new_balance: null, transaction_id: null }],
            error: null
          }
        }
        if (!wallets.has(userId)) {
          return {
            data: null,
            error: { code: 'P0001', message: `claim_itc_purchase: wallet not found for ${userId}` }
          }
        }
        const next = (wallets.get(userId) ?? 0) + amount
        wallets.set(userId, next)
        const id = `tx-${++seq}`
        purchases.set(reference, { id, amount, balanceAfter: next })
        return {
          data: [{ claimed: true, new_balance: String(next), transaction_id: id }],
          error: null
        }
      })
    }
  }

  return { db, wallets, purchases, get rpcCalls() { return rpcCalls } }
}

const INPUT = {
  userId: 'user-1',
  paymentIntentId: 'pi_same',
  itcAmount: 500,
  usdAmount: 5
}

describe('creditItcPurchaseOnce', () => {
  it('credits once and parses the numeric balance Postgres returns as a string', async () => {
    const ledger = makeLedger(100)
    const result = await creditItcPurchaseOnce(ledger.db, INPUT)

    expect(result).toEqual({ outcome: 'credited', newBalance: 600, transactionId: 'tx-1' })
    expect(ledger.wallets.get('user-1')).toBe(600)
    expect(ledger.purchases.size).toBe(1)
  })

  it('returns duplicate without throwing or crediting when the payment intent was already claimed', async () => {
    const ledger = makeLedger(100)
    const first = await creditItcPurchaseOnce(ledger.db, INPUT)
    const second = await creditItcPurchaseOnce(ledger.db, INPUT)

    expect(first.outcome).toBe('credited')
    expect(second).toEqual({ outcome: 'duplicate', newBalance: null, transactionId: null })
    expect(ledger.wallets.get('user-1')).toBe(600)
    expect(ledger.purchases.size).toBe(1)
  })

  it('credits exactly once when two deliveries for the same payment intent run concurrently', async () => {
    const ledger = makeLedger(100)

    const [a, b] = await Promise.all([
      creditItcPurchaseOnce(ledger.db, INPUT),
      creditItcPurchaseOnce(ledger.db, INPUT)
    ])

    const outcomes = [a.outcome, b.outcome].sort()
    expect(outcomes).toEqual(['credited', 'duplicate'])
    expect(ledger.wallets.get('user-1')).toBe(600)
    expect([...ledger.purchases.keys()]).toEqual(['pi_same'])
    const winner = a.outcome === 'credited' ? a : b
    expect(winner.newBalance).toBe(600)
    expect(winner.transactionId).toBe('tx-1')
  })

  it('still credits both when the payment intents differ', async () => {
    const ledger = makeLedger(100)

    const [a, b] = await Promise.all([
      creditItcPurchaseOnce(ledger.db, INPUT),
      creditItcPurchaseOnce(ledger.db, { ...INPUT, paymentIntentId: 'pi_other', itcAmount: 50 })
    ])

    expect(a.outcome).toBe('credited')
    expect(b.outcome).toBe('credited')
    expect(ledger.wallets.get('user-1')).toBe(650)
    expect(ledger.purchases.size).toBe(2)
  })

  it('throws when the wallet is missing so Stripe retries, and writes no purchase row', async () => {
    const ledger = makeLedger(100)
    await expect(
      creditItcPurchaseOnce(ledger.db, { ...INPUT, userId: 'nobody' })
    ).rejects.toThrow('Failed to claim ITC purchase')
    expect(ledger.purchases.size).toBe(0)
    expect(ledger.wallets.get('user-1')).toBe(100)
  })

  it('throws on a database error and does not credit', async () => {
    const db: ItcPurchaseDb = {
      rpc: async () => ({ data: null, error: { code: '08006', message: 'connection reset' } })
    }
    await expect(creditItcPurchaseOnce(db, INPUT)).rejects.toThrow('Failed to claim ITC purchase')
  })

  it('rejects a non-positive amount before calling the database', async () => {
    const ledger = makeLedger(100)
    await expect(
      creditItcPurchaseOnce(ledger.db, { ...INPUT, itcAmount: Number.NaN })
    ).rejects.toThrow('Invalid ITC purchase amount')
    expect(ledger.rpcCalls).toBe(0)
    expect(ledger.wallets.get('user-1')).toBe(100)
  })

  it('shows the old select-then-insert check double-credits under the same overlap', async () => {
    // Control. Not the production path — this is the race the unique claim
    // replaces. Both deliveries read "no row" before either writes.
    const state = { balance: 100, rows: [] as string[] }

    async function racySelectThenInsert() {
      const seen = state.rows.includes('pi_same')
      await Promise.resolve()
      if (seen) return 'duplicate' as const
      state.balance += 500
      state.rows.push('pi_same')
      return 'credited' as const
    }

    const [a, b] = await Promise.all([racySelectThenInsert(), racySelectThenInsert()])
    expect([a, b]).toEqual(['credited', 'credited'])
    expect(state.balance).toBe(1100)
    expect(state.rows).toEqual(['pi_same', 'pi_same'])
  })
})

describe('claim_itc_purchase migration', () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../supabase/migrations/20260922183000_itc_purchase_claim_once.sql'
    ),
    'utf8'
  )

  it('claims with a partial unique index and ON CONFLICT DO NOTHING, then credits', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS itc_transactions_purchase_reference_uidx')
    expect(sql).toContain("WHERE type = 'purchase' AND reference IS NOT NULL")
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('ON CONFLICT (reference) WHERE type = \'purchase\' AND reference IS NOT NULL')
    expect(sql).toContain('DO NOTHING')
    expect(sql).toContain('itc_balance = v_new')
  })

  it('refuses to mint ITC for the anon key', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.claim_itc_purchase(uuid, text, numeric, jsonb) FROM PUBLIC')
    expect(sql).toContain('FROM anon, authenticated')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_itc_purchase(uuid, text, numeric, jsonb) TO service_role')
  })

  it('aborts the migration when duplicate purchase references already exist', () => {
    expect(sql).toContain('HAVING count(*) > 1')
    expect(sql).toContain('RAISE EXCEPTION')
  })
})
