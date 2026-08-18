// Tests for the buyer-side try-on gate — Watchtower task 3b362203.
//
// Everything here runs against an in-memory fake of TryOnDeps, so no test ever
// touches Supabase, GCS or FASHN. The three properties under test are the three
// ways this feature can lose money:
//   1. the daily free grant leaking a second free render,
//   2. a paid render deducting against a stale balance,
//   3. a failed render still costing the shopper.

import { describe, it, expect, beforeEach } from 'vitest'

import {
  openGate,
  settleFailure,
  chargeItc,
  priceFor,
  storeDateString,
  summarizeConversion,
  TRYON_VALUE_PER_ADD_TO_CART_USD,
  TRYON_BREAKEVEN_USD_PER_RUN,
  type TryOnDeps,
  type LedgerEntry,
  type GateAllowed
} from './virtual-tryon.js'
import { TRYON_TIERS } from './fashn-tryon.js'

const USER = 'user-1'

interface Fake extends TryOnDeps {
  state: {
    balance: number
    ledger: LedgerEntry[]
    claims: Map<string, { freeUsed: boolean; paidCount: number }>
    pricing: Map<string, { current_cost: number; promo_end_time: string | null }>
    clock: Date
    /** Simulates another request winning the optimistic lock exactly once. */
    stealBalanceOnce: boolean
  }
}

function makeDeps(overrides: Partial<Fake['state']> = {}): Fake {
  const state: Fake['state'] = {
    balance: 100,
    ledger: [],
    claims: new Map(),
    pricing: new Map([
      ['tryon_standard', { current_cost: 10, promo_end_time: null }],
      ['tryon_premium', { current_cost: 25, promo_end_time: null }]
    ]),
    clock: new Date('2026-08-16T15:00:00Z'),
    stealBalanceOnce: false,
    ...overrides
  }

  const key = (userId: string, date: string) => `${userId}::${date}`

  return {
    state,
    async getPricing(featureKey) {
      return state.pricing.get(featureKey) ?? null
    },
    async getWalletBalance() {
      return state.balance
    },
    async applyDeduction(_userId, expectedBalance, amount) {
      if (state.stealBalanceOnce) {
        // Someone else moved the balance between our read and our write.
        state.stealBalanceOnce = false
        state.balance = state.balance - 1
        return false
      }
      if (state.balance !== expectedBalance) return false
      state.balance -= amount
      return true
    },
    async creditWallet(_userId, amount) {
      state.balance += amount
      return state.balance
    },
    async writeLedger(entry) {
      state.ledger.push(entry)
    },
    async claimFreeUse(userId, usageDate) {
      const k = key(userId, usageDate)
      const existing = state.claims.get(k)
      if (existing?.freeUsed) return false // UNIQUE constraint / already used
      state.claims.set(k, { freeUsed: true, paidCount: existing?.paidCount ?? 0 })
      return true
    },
    async releaseFreeUse(userId, usageDate) {
      const k = key(userId, usageDate)
      const existing = state.claims.get(k)
      if (!existing) return
      if (existing.paidCount === 0) state.claims.delete(k)
      else state.claims.set(k, { ...existing, freeUsed: false })
    },
    async hasClaimedFreeUse(userId, usageDate) {
      return Boolean(state.claims.get(key(userId, usageDate))?.freeUsed)
    },
    async incrementPaidCount(userId, usageDate) {
      const k = key(userId, usageDate)
      const existing = state.claims.get(k) ?? { freeUsed: false, paidCount: 0 }
      state.claims.set(k, { ...existing, paidCount: existing.paidCount + 1 })
    },
    now: () => state.clock
  }
}

describe('storeDateString', () => {
  it('rolls the free day at LOCAL midnight, not UTC midnight', () => {
    // 03:30 UTC on the 17th is still 23:30 on the 16th in America/New_York.
    // A naive UTC date would have reset the free try-on at 8pm ET.
    const lateEvening = new Date('2026-08-17T03:30:00Z')
    expect(storeDateString(lateEvening, 'America/New_York')).toBe('2026-08-16')
    expect(storeDateString(lateEvening, 'UTC')).toBe('2026-08-17')
  })

  it('formats as ISO YYYY-MM-DD with padding', () => {
    expect(storeDateString(new Date('2026-01-05T18:00:00Z'), 'America/New_York')).toBe('2026-01-05')
  })
})

describe('the daily free cap', () => {
  let deps: Fake
  beforeEach(() => { deps = makeDeps() })

  it('gives the first try-on of the day away and charges nothing', async () => {
    const gate = await openGate(deps, { userId: USER, tierName: 'standard' })
    expect(gate.allowed).toBe(true)
    expect((gate as GateAllowed).usedFree).toBe(true)
    expect(gate.itcCost).toBe(0)
    expect(deps.state.balance).toBe(100)
    expect(deps.state.ledger).toHaveLength(0)
  })

  it('charges the SECOND try-on the same day', async () => {
    await openGate(deps, { userId: USER, tierName: 'standard' })
    const second = await openGate(deps, { userId: USER, tierName: 'standard' })

    expect(second.allowed).toBe(true)
    expect((second as GateAllowed).usedFree).toBe(false)
    expect(second.itcCost).toBe(10)
    expect(deps.state.balance).toBe(90)
    expect(deps.state.ledger[0]).toMatchObject({
      type: 'debit',
      amount: -10,
      balanceAfter: 90,
      reference: 'virtual_tryon:tryon_standard'
    })
  })

  it('hands out exactly one free render when two requests race', async () => {
    const [a, b] = await Promise.all([
      openGate(deps, { userId: USER, tierName: 'standard' }),
      openGate(deps, { userId: USER, tierName: 'standard' })
    ])
    const freeCount = [a, b].filter((g) => g.allowed && (g as GateAllowed).usedFree).length
    expect(freeCount).toBe(1)
  })

  it('resets the free render the next local day', async () => {
    await openGate(deps, { userId: USER, tierName: 'standard' })
    deps.state.clock = new Date('2026-08-17T15:00:00Z')

    const nextDay = await openGate(deps, { userId: USER, tierName: 'standard' })
    expect((nextDay as GateAllowed).usedFree).toBe(true)
    expect(deps.state.balance).toBe(100)
  })

  it('spends the free render even when the wallet is loaded', async () => {
    deps.state.balance = 10_000
    const gate = await openGate(deps, { userId: USER, tierName: 'premium' })
    expect((gate as GateAllowed).usedFree).toBe(true)
    expect(deps.state.balance).toBe(10_000)
  })

  it('downgrades the free render to the cheapest FASHN configuration', async () => {
    // A free `premium` would be 2 credits ($0.15) instead of 1 ($0.075).
    const gate = (await openGate(deps, { userId: USER, tierName: 'premium' })) as GateAllowed
    expect(gate.tier.numSamples).toBe(1)
    expect(gate.tier.mode).toBe('performance')
  })
})

describe('ITC pricing', () => {
  it('reads the admin-tunable cost out of imagination_pricing', async () => {
    const deps = makeDeps()
    deps.state.pricing.set('tryon_standard', { current_cost: 7, promo_end_time: null })
    await openGate(deps, { userId: USER, tierName: 'standard' }) // burn the free one

    const paid = await openGate(deps, { userId: USER, tierName: 'standard' })
    expect(paid.itcCost).toBe(7)
    expect(deps.state.balance).toBe(93)
  })

  it('falls back to the hard-coded tier price when the pricing row is missing', async () => {
    const deps = makeDeps()
    deps.state.pricing.clear()
    expect(await priceFor(deps, TRYON_TIERS.premium)).toBe(25)
  })

  it('is free while an admin promo is live', async () => {
    const deps = makeDeps()
    deps.state.pricing.set('tryon_standard', {
      current_cost: 10,
      promo_end_time: '2026-08-20T00:00:00Z'
    })
    await openGate(deps, { userId: USER, tierName: 'standard' })

    const paid = await openGate(deps, { userId: USER, tierName: 'standard' })
    expect(paid.itcCost).toBe(0)
    expect(deps.state.balance).toBe(100)
  })

  it('ignores an EXPIRED promo', async () => {
    const deps = makeDeps()
    deps.state.pricing.set('tryon_standard', {
      current_cost: 10,
      promo_end_time: '2026-08-01T00:00:00Z'
    })
    await openGate(deps, { userId: USER, tierName: 'standard' })

    const paid = await openGate(deps, { userId: USER, tierName: 'standard' })
    expect(paid.itcCost).toBe(10)
  })

  it('refuses the render when the balance cannot cover it and deducts nothing', async () => {
    const deps = makeDeps({ balance: 3 })
    await openGate(deps, { userId: USER, tierName: 'standard' })

    const denied = await openGate(deps, { userId: USER, tierName: 'standard' })
    expect(denied.allowed).toBe(false)
    expect(deps.state.balance).toBe(3)
    expect(deps.state.ledger).toHaveLength(0)
  })

  it('premium costs more than standard', async () => {
    const deps = makeDeps({ balance: 1000 })
    await openGate(deps, { userId: USER, tierName: 'standard' })

    const premium = await openGate(deps, { userId: USER, tierName: 'premium' })
    expect(premium.itcCost).toBe(25)
    expect((premium as GateAllowed).tier.numSamples).toBe(2)
  })
})

describe('chargeItc optimistic locking', () => {
  it('re-reads and retries when another write wins the race', async () => {
    const deps = makeDeps({ balance: 50, stealBalanceOnce: true })
    const result = await chargeItc(deps, USER, 10, 50, 'tryon_standard')

    expect(result.ok).toBe(true)
    // 50 -> 49 (the concurrent write) -> 39 (our retry against the fresh read)
    expect(deps.state.balance).toBe(39)
    expect(result.balanceAfter).toBe(39)
  })

  it('never deducts twice for one charge', async () => {
    const deps = makeDeps({ balance: 50 })
    await chargeItc(deps, USER, 10, 50, 'tryon_standard')
    expect(deps.state.balance).toBe(40)
    expect(deps.state.ledger).toHaveLength(1)
  })

  it('refuses when the known balance is already short', async () => {
    const deps = makeDeps({ balance: 5 })
    const result = await chargeItc(deps, USER, 10, 5, 'tryon_standard')
    expect(result.ok).toBe(false)
    expect(deps.state.balance).toBe(5)
  })
})

describe('nobody pays for a failed render', () => {
  it('refunds the ITC and writes a refund ledger row', async () => {
    const deps = makeDeps()
    await openGate(deps, { userId: USER, tierName: 'standard' })
    const paid = (await openGate(deps, { userId: USER, tierName: 'standard' })) as GateAllowed
    expect(deps.state.balance).toBe(90)

    await settleFailure(deps, paid)

    expect(deps.state.balance).toBe(100)
    expect(deps.state.ledger.at(-1)).toMatchObject({
      type: 'credit',
      amount: 10,
      balanceAfter: 100,
      reference: 'virtual_tryon_refund:tryon_standard'
    })
  })

  it('gives the free daily slot back so the shopper can retry today', async () => {
    const deps = makeDeps()
    const free = (await openGate(deps, { userId: USER, tierName: 'standard' })) as GateAllowed
    expect(await deps.hasClaimedFreeUse(USER, free.usageDate)).toBe(true)

    await settleFailure(deps, free)
    expect(await deps.hasClaimedFreeUse(USER, free.usageDate)).toBe(false)

    const retry = await openGate(deps, { userId: USER, tierName: 'standard' })
    expect((retry as GateAllowed).usedFree).toBe(true)
    expect(deps.state.balance).toBe(100)
  })
})

describe('summarizeConversion', () => {
  const viewed = (u: string, p: string) => ({ user_id: u, product_id: p, event_type: 'tryon_card_viewed' })
  const ran = (u: string, p: string) => ({ user_id: u, product_id: p, event_type: 'tryon_completed' })
  const carted = (u: string, p: string) => ({ user_id: u, product_id: p, event_type: 'add_to_cart' })
  const completedRun = (cost = 0.075, itc = 0) => ({ cost_usd: cost, status: 'completed', used_free_daily: itc === 0, itc_charged: itc })

  it('compares only shoppers who saw the card (matched cohorts)', () => {
    const events = [
      // used the try-on, carted
      viewed('a', 'p1'), ran('a', 'p1'), carted('a', 'p1'),
      // used the try-on, did not cart
      viewed('b', 'p1'), ran('b', 'p1'),
      // saw the card, skipped it, carted
      viewed('c', 'p1'), carted('c', 'p1'),
      // saw the card, skipped it, did not cart
      viewed('d', 'p1'),
      viewed('e', 'p1'),
      viewed('f', 'p1')
    ]
    const report = summarizeConversion(events, [completedRun(), completedRun()])

    expect(report.cohorts.usedTryOn).toMatchObject({ shoppers: 2, addToCarts: 1, addToCartRatePct: 50 })
    expect(report.cohorts.noTryOn).toMatchObject({ shoppers: 4, addToCarts: 1, addToCartRatePct: 25 })
    expect(report.liftPct).toBe(25)
  })

  it('counts a user once per product no matter how many events fire', () => {
    const events = [
      viewed('a', 'p1'), viewed('a', 'p1'), ran('a', 'p1'), ran('a', 'p1'),
      carted('a', 'p1'), carted('a', 'p1'),
      viewed('b', 'p1')
    ]
    const report = summarizeConversion(events, [completedRun()])
    expect(report.cohorts.usedTryOn.shoppers).toBe(1)
    expect(report.cohorts.usedTryOn.addToCarts).toBe(1)
    expect(report.cohorts.noTryOn.shoppers).toBe(1)
  })

  it('treats the same user on a different product as a separate shopper', () => {
    const events = [viewed('a', 'p1'), ran('a', 'p1'), carted('a', 'p1'), viewed('a', 'p2')]
    const report = summarizeConversion(events, [completedRun()])
    expect(report.cohorts.usedTryOn.shoppers).toBe(1)
    expect(report.cohorts.noTryOn.shoppers).toBe(1)
  })

  it('tracks FASHN spend and ITC recovered', () => {
    const runs = [
      completedRun(0.075, 0),   // free daily
      completedRun(0.075, 10),  // paid standard
      { cost_usd: 0, status: 'failed', used_free_daily: false, itc_charged: 0 }
    ]
    const report = summarizeConversion([], runs)
    expect(report.runs).toMatchObject({ total: 3, completed: 2, failed: 1, free: 1, paid: 2 })
    expect(report.spend.totalUsd).toBeCloseTo(0.15, 5)
    expect(report.spend.itcRevenueUsd).toBeCloseTo(0.10, 5)
    expect(report.spend.netUsd).toBeCloseTo(-0.05, 5)
  })

  it('withholds a verdict until there is enough matched traffic', () => {
    const report = summarizeConversion([viewed('a', 'p1'), ran('a', 'p1')], [completedRun()])
    expect(report.verdict).toBe('insufficient-data')
  })

  it('kills the feature when the try-on cohort converts no better', () => {
    const events: any[] = []
    for (let i = 0; i < 40; i++) {
      events.push(viewed(`u${i}`, 'p1'), ran(`u${i}`, 'p1'))
      if (i < 8) events.push(carted(`u${i}`, 'p1')) // 20%
    }
    for (let i = 100; i < 140; i++) {
      events.push(viewed(`u${i}`, 'p1'))
      if (i < 108) events.push(carted(`u${i}`, 'p1')) // 20%
    }
    const runs = Array.from({ length: 40 }, () => completedRun())
    const report = summarizeConversion(events, runs)

    expect(report.liftPct).toBe(0)
    expect(report.verdict).toBe('kill')
    expect(report.verdictReason).toMatch(/no positive lift/i)
  })

  it('keeps the feature when the lift clears the cost of a render', () => {
    const events: any[] = []
    for (let i = 0; i < 40; i++) {
      events.push(viewed(`u${i}`, 'p1'), ran(`u${i}`, 'p1'))
      if (i < 16) events.push(carted(`u${i}`, 'p1')) // 40%
    }
    for (let i = 100; i < 140; i++) {
      events.push(viewed(`u${i}`, 'p1'))
      if (i < 108) events.push(carted(`u${i}`, 'p1')) // 20%
    }
    const runs = Array.from({ length: 40 }, () => completedRun())
    const report = summarizeConversion(events, runs)

    expect(report.liftPct).toBe(20)
    // 8 incremental carts across 40 runs = 20 per 100, far above the
    // ~1.9 per 100 needed at $0.075/run and $4/cart.
    expect(report.actualIncrementalCartsPer100Runs).toBe(20)
    expect(report.breakevenIncrementalCartsPer100Runs).toBeCloseTo(
      (TRYON_BREAKEVEN_USD_PER_RUN / TRYON_VALUE_PER_ADD_TO_CART_USD) * 100,
      2
    )
    expect(report.verdict).toBe('keep')
  })

  it('kills a positive-but-too-small lift', () => {
    const events: any[] = []
    // 200 try-on users, one extra cart between them: 0.5 per 100 runs, under
    // the ~1.9 bar.
    for (let i = 0; i < 200; i++) {
      events.push(viewed(`u${i}`, 'p1'), ran(`u${i}`, 'p1'))
      if (i < 41) events.push(carted(`u${i}`, 'p1')) // 20.5%
    }
    for (let i = 1000; i < 1200; i++) {
      events.push(viewed(`u${i}`, 'p1'))
      if (i < 1040) events.push(carted(`u${i}`, 'p1')) // 20%
    }
    const runs = Array.from({ length: 200 }, () => completedRun())
    const report = summarizeConversion(events, runs)

    expect(report.liftPct).toBeGreaterThan(0)
    expect(report.verdict).toBe('kill')
    expect(report.verdictReason).toMatch(/falls short/i)
  })

  it('ignores events with no user or no product', () => {
    const events = [
      { user_id: null, product_id: 'p1', event_type: 'tryon_card_viewed' },
      { user_id: 'a', product_id: null, event_type: 'tryon_card_viewed' },
      viewed('b', 'p1')
    ]
    const report = summarizeConversion(events, [])
    expect(report.cohorts.usedTryOn.shoppers + report.cohorts.noTryOn.shoppers).toBe(1)
  })

  it('replaces the default value-per-add-to-cart with measured rate if sufficient purchase data is available', () => {
    const events: any[] = []
    const purchased = (u: string, p: string) => ({ user_id: u, product_id: p, event_type: 'purchase' })

    // 40 try-on users, 20 carted, 10 purchased
    // cart-to-purchase rate = 10 / 20 = 50%
    // measured value = 50% * $13.00 = $6.50
    for (let i = 0; i < 40; i++) {
      events.push(viewed(`u${i}`, 'p1'), ran(`u${i}`, 'p1'))
      if (i < 20) events.push(carted(`u${i}`, 'p1'))
      if (i < 10) events.push(purchased(`u${i}`, 'p1'))
    }

    // 40 non-try-on users, 10 carted
    for (let i = 100; i < 140; i++) {
      events.push(viewed(`u${i}`, 'p1'))
      if (i < 110) events.push(carted(`u${i}`, 'p1'))
    }

    const runs = Array.from({ length: 40 }, () => completedRun())
    const report = summarizeConversion(events, runs)

    expect(report.usingMeasuredValue).toBe(true)
    expect(report.valuePerAddToCartUsd).toBe(6.50)
    // breakeven should be based on $6.50 instead of $4.00
    // breakeven = 0.075 / 6.50 * 100 = 1.15
    expect(report.breakevenIncrementalCartsPer100Runs).toBe(1.15)
  })
})
