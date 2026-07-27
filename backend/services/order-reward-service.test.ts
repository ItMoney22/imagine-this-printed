import { describe, it, expect } from 'vitest'

// backend/lib/supabase.ts creates its client eagerly at module load. Every
// test here injects a fake `db` and never touches a real client, so dummy
// values are fine. Dynamic import after setting env vars (rather than a
// static import, which ESM hoists ahead of any code in this file) is what
// makes the ordering work — same pattern as order-pricing.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { processOrderCompletion } = await import('./order-reward-service.js')

function makeFakeDb(opts: { existingReward?: { id: string; status: string } | null; rpcResult?: any }) {
  let rpcCalls = 0
  return {
    from(table: string) {
      if (table !== 'order_rewards') throw new Error(`fake db: unexpected table "${table}"`)
      const builder: any = {
        select() {
          return builder
        },
        eq() {
          return builder
        },
        single: async () => ({ data: opts.existingReward ?? null, error: null })
      }
      return builder
    },
    rpc: async (_fn: string, _args: any) => {
      rpcCalls++
      return { data: opts.rpcResult ?? { success: true, itc_awarded: 100, tier: 'bronze' }, error: null }
    },
    _rpcCalls: () => rpcCalls
  }
}

describe('processOrderCompletion — redelivered webhook must not double-credit a reward (Watchtower task 918912a3)', () => {
  it('awards rewards when no existing order_rewards row exists for this order', async () => {
    const db = makeFakeDb({ existingReward: null })
    const result = await processOrderCompletion(
      { orderId: 'order-1', userId: 'user-1', orderTotal: 100, orderNumber: 'ITP-1' },
      db as any
    )
    expect(result.success).toBe(true)
    expect(result.itcAwarded).toBe(100)
    expect(db._rpcCalls()).toBe(1)
  })

  it('refuses to award a second time when order_rewards already has a row for this order — proves a redelivered paid webhook cannot double-credit', async () => {
    const db = makeFakeDb({ existingReward: { id: 'reward-1', status: 'awarded' } })
    const result = await processOrderCompletion(
      { orderId: 'order-1', userId: 'user-1', orderTotal: 100, orderNumber: 'ITP-1' },
      db as any
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('Duplicate reward attempt')
    // The critical assertion: the reward-awarding RPC must never even be
    // called once the dedup guard trips, so a Stripe webhook redelivery
    // (or any second call for the same orderId) can't mint a second payout.
    expect(db._rpcCalls()).toBe(0)
  })
})
