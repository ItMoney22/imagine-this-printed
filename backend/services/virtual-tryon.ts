// ---------------------------------------------------------------------------
// Virtual try-on gate: daily free cap, ITC pricing, spend ledger, funnel stats.
//
// Watchtower task 3b362203. services/fashn-tryon.ts is the transport; this is
// the money and the measurement.
//
// THE THREE RULES THIS FILE ENFORCES
//  1. One free try-on per user per calendar day, claimed atomically. The claim
//     is an INSERT on a UNIQUE(user_id, usage_date) row — two concurrent
//     requests race on the constraint and exactly one wins. A read-then-write
//     check would hand out two free renders to anyone who double-clicks.
//  2. After the free one, the run is priced in ITC out of imagination_pricing,
//     the same admin-tunable table every other AI spend in the app reads.
//     Deduction uses the optimistic-lock pattern from routes/imagination-
//     station.ts (`.eq('itc_balance', expected)`), not read-then-write.
//  3. Nobody pays for a failure. If FASHN errors, the ITC is refunded and the
//     free daily claim is released.
//
// Every Supabase touch goes through an injected `TryOnDeps` so the unit tests
// (virtual-tryon.test.ts) run with no database at all.
// ---------------------------------------------------------------------------

import { TRYON_TIERS, FREE_TIER, type TryOnTier } from './fashn-tryon.js'

/**
 * The day boundary for the free grant. Rockmart GA is the shop's home, so the
 * free try-on resets at local midnight for the customer rather than at 8pm ET
 * (which is what a naive `now()::date` in UTC would have done).
 */
export const TRYON_TIMEZONE = process.env.TRYON_TIMEZONE || 'America/New_York'

/** How many free try-ons a signed-in user gets per day. Hard-capped at 1 by the brief. */
export const DAILY_FREE_TRYONS = Math.max(0, Number(process.env.TRYON_DAILY_FREE) || 1)

/**
 * The economics gate from the brief: kill the feature if it does not clear
 * $0.075 of incremental value per click. Surfaced in the analytics payload so
 * the verdict is computed, not argued.
 */
export const TRYON_BREAKEVEN_USD_PER_RUN = Number(process.env.TRYON_BREAKEVEN_USD) || 0.075

/** YYYY-MM-DD in the store's timezone. Pure — the test pins a fake clock. */
export function storeDateString(at: Date = new Date(), timeZone: string = TRYON_TIMEZONE): string {
  // en-CA gives ISO-ordered parts (2026-08-16) without any manual padding.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(at)
}

export interface LedgerEntry {
  userId: string
  type: 'debit' | 'credit'
  amount: number
  balanceAfter: number
  reference: string
  metadata: Record<string, unknown>
}

export interface TryOnDeps {
  /** imagination_pricing row for a feature key, or null if unseeded. */
  getPricing(featureKey: string): Promise<{ current_cost: number; promo_end_time: string | null } | null>
  getWalletBalance(userId: string): Promise<number>
  /**
   * Optimistic conditional update. Returns true only if the row still held
   * `expectedBalance` when the write landed.
   */
  applyDeduction(userId: string, expectedBalance: number, amount: number): Promise<boolean>
  creditWallet(userId: string, amount: number): Promise<number>
  writeLedger(entry: LedgerEntry): Promise<void>
  /** true if THIS call won the day's free slot; false if it was already taken. */
  claimFreeUse(userId: string, usageDate: string): Promise<boolean>
  /** Give the free slot back when the render failed. */
  releaseFreeUse(userId: string, usageDate: string): Promise<void>
  /** Has the user already burned today's free slot? Read-only, for GET /config. */
  hasClaimedFreeUse(userId: string, usageDate: string): Promise<boolean>
  incrementPaidCount(userId: string, usageDate: string): Promise<void>
  now(): Date
}

export interface GateAllowed {
  allowed: true
  userId: string
  usedFree: boolean
  itcCost: number
  balanceBefore: number
  tier: TryOnTier
  usageDate: string
}

export interface GateDenied {
  allowed: false
  userId: string
  reason: string
  itcCost: number
  balanceBefore: number
  usageDate: string
}

export type GateDecision = GateAllowed | GateDenied

/** Effective ITC price for a tier, honouring an active admin promo. */
export async function priceFor(deps: TryOnDeps, tier: TryOnTier): Promise<number> {
  const pricing = await deps.getPricing(tier.featureKey)
  if (!pricing) return tier.fallbackItcCost
  const promoActive = Boolean(pricing.promo_end_time) && new Date(pricing.promo_end_time as string) > deps.now()
  if (promoActive) return 0
  return Math.max(0, Number(pricing.current_cost) || 0)
}

/**
 * Decide whether this run happens and what it costs, then take the payment.
 *
 * Order matters: the free slot is claimed BEFORE any ITC is touched, so a user
 * with a full wallet still spends their free render first instead of being
 * quietly charged for it.
 */
export async function openGate(
  deps: TryOnDeps,
  opts: { userId: string; tierName: 'standard' | 'premium' }
): Promise<GateDecision> {
  const usageDate = storeDateString(deps.now())
  const tier = opts.tierName === 'premium' ? TRYON_TIERS.premium : TRYON_TIERS.standard

  if (DAILY_FREE_TRYONS > 0) {
    const gotFree = await deps.claimFreeUse(opts.userId, usageDate)
    if (gotFree) {
      const balanceBefore = await deps.getWalletBalance(opts.userId)
      // The free render always runs on the cheapest FASHN configuration — a
      // free `premium` (2 credits, $0.15) would double the giveaway cost.
      return {
        allowed: true,
        userId: opts.userId,
        usedFree: true,
        itcCost: 0,
        balanceBefore,
        tier: FREE_TIER,
        usageDate
      }
    }
  }

  const cost = await priceFor(deps, tier)
  const balanceBefore = await deps.getWalletBalance(opts.userId)

  if (cost === 0) {
    await deps.incrementPaidCount(opts.userId, usageDate)
    return { allowed: true, userId: opts.userId, usedFree: false, itcCost: 0, balanceBefore, tier, usageDate }
  }

  if (balanceBefore < cost) {
    return {
      allowed: false,
      userId: opts.userId,
      reason: `You've used today's free try-on. This one costs ${cost} ITC and your balance is ${balanceBefore}.`,
      itcCost: cost,
      balanceBefore,
      usageDate
    }
  }

  const charged = await chargeItc(deps, opts.userId, cost, balanceBefore, tier.featureKey)
  if (!charged.ok) {
    return {
      allowed: false,
      userId: opts.userId,
      reason: charged.error || 'Could not complete the ITC charge. Nothing was deducted.',
      itcCost: cost,
      balanceBefore,
      usageDate
    }
  }

  await deps.incrementPaidCount(opts.userId, usageDate)
  return { allowed: true, userId: opts.userId, usedFree: false, itcCost: cost, balanceBefore, tier, usageDate }
}

/**
 * Optimistic-locked ITC deduction with one re-read retry, mirroring the
 * auto-nest path in routes/imagination-station.ts. Two try-ons fired at once
 * must not both deduct against the same stale balance.
 */
export async function chargeItc(
  deps: TryOnDeps,
  userId: string,
  amount: number,
  knownBalance: number,
  featureKey: string
): Promise<{ ok: boolean; balanceAfter?: number; error?: string }> {
  let expected = knownBalance

  for (let attempt = 0; attempt < 2; attempt++) {
    if (expected < amount) return { ok: false, error: 'Insufficient ITC balance' }

    const applied = await deps.applyDeduction(userId, expected, amount)
    if (applied) {
      const balanceAfter = expected - amount
      await deps.writeLedger({
        userId,
        type: 'debit',
        amount: -amount,
        balanceAfter,
        reference: `virtual_tryon:${featureKey}`,
        metadata: { source: 'virtual_tryon', feature_key: featureKey, status: 'completed' }
      })
      return { ok: true, balanceAfter }
    }

    expected = await deps.getWalletBalance(userId)
  }

  return { ok: false, error: 'Wallet balance changed while charging. Please try again.' }
}

/**
 * Undo a gate when the render failed. FASHN does not bill failed predictions,
 * so neither do we — the ITC comes back and the free slot reopens.
 */
export async function settleFailure(deps: TryOnDeps, decision: GateAllowed): Promise<void> {
  if (decision.usedFree) {
    await deps.releaseFreeUse(decision.userId, decision.usageDate)
    return
  }
  if (decision.itcCost > 0) {
    const balanceAfter = await deps.creditWallet(decision.userId, decision.itcCost)
    await deps.writeLedger({
      userId: decision.userId,
      type: 'credit',
      amount: decision.itcCost,
      balanceAfter,
      reference: `virtual_tryon_refund:${decision.tier.featureKey}`,
      metadata: { source: 'virtual_tryon', feature_key: decision.tier.featureKey, status: 'refund' }
    })
  }
}

// ---------------------------------------------------------------------------
// Conversion measurement
// ---------------------------------------------------------------------------

export interface FunnelEvent {
  user_id: string | null
  product_id: string | null
  event_type: string
  value_usd?: number | string | null
}

export interface RunCostRow {
  cost_usd: number | string | null
  status: string
  used_free_daily?: boolean | null
  itc_charged?: number | null
}

export interface ConversionReport {
  cohorts: {
    usedTryOn: { shoppers: number; addToCarts: number; addToCartRatePct: number; purchases: number }
    noTryOn: { shoppers: number; addToCarts: number; addToCartRatePct: number; purchases: number }
  }
  /** Percentage points, not a ratio: 41.0% - 22.0% = 19.0. */
  liftPct: number
  runs: { total: number; completed: number; failed: number; free: number; paid: number }
  spend: {
    totalUsd: number
    itcRevenue: number
    /** ITC charged, converted to USD at the canonical 1 ITC = $0.01. */
    itcRevenueUsd: number
    netUsd: number
    costPerCompletedRunUsd: number
    /** THE number the kill decision rests on. */
    costPerIncrementalAddToCartUsd: number | null
  }
  /** How many extra carts the feature produced vs. the matched control cohort. */
  incrementalAddToCarts: number
  breakevenUsdPerRun: number
  /** What one incremental add-to-cart is assumed to be worth in gross margin. */
  valuePerAddToCartUsd: number
  /** Whether the value is measured from purchase data or assumed from default. */
  usingMeasuredValue: boolean
  /**
   * The bar, stated as a rate: incremental carts per 100 completed runs needed
   * to cover the FASHN bill. Below this the feature is losing money per click.
   */
  breakevenIncrementalCartsPer100Runs: number
  actualIncrementalCartsPer100Runs: number
  verdict: 'keep' | 'kill' | 'insufficient-data'
  verdictReason: string
}

const ITC_TO_USD = 0.01
const MIN_SHOPPERS_FOR_VERDICT = Number(process.env.TRYON_MIN_SHOPPERS_FOR_VERDICT) || 50

/**
 * Gross margin credited to one incremental add-to-cart. ASSUMPTION, and the
 * one number in this report that isn't measured: ~$26 AOV x ~50% gross margin
 * x ~30% cart->purchase = ~$4. Retune with TRYON_VALUE_PER_ADD_TO_CART_USD
 * once real cart->purchase data exists for this cohort; the `purchases` counts
 * in the report are there so that day comes.
 */
export const TRYON_VALUE_PER_ADD_TO_CART_USD = Number(process.env.TRYON_VALUE_PER_ADD_TO_CART_USD) || 4

/**
 * Pure aggregation so the report is unit-testable without a database.
 *
 * Cohorts are MATCHED on "saw the try-on card on this product". Comparing
 * try-on users against all site traffic would be selection bias dressed up as
 * a lift number, and this feature gets killed or kept on this figure.
 */
export function summarizeConversion(events: FunnelEvent[], runs: RunCostRow[]): ConversionReport {
  const key = (e: FunnelEvent) => `${e.user_id}::${e.product_id}`
  const viewers = new Set<string>()
  const usedTryOn = new Set<string>()
  const addedToCart = new Set<string>()
  const purchased = new Set<string>()

  for (const e of events) {
    if (!e.user_id || !e.product_id) continue
    const k = key(e)
    switch (e.event_type) {
      case 'tryon_card_viewed': viewers.add(k); break
      case 'tryon_completed': usedTryOn.add(k); viewers.add(k); break
      case 'add_to_cart': addedToCart.add(k); break
      case 'purchase': purchased.add(k); break
    }
  }

  const tally = (pairs: string[]) => {
    const shoppers = pairs.length
    const addToCarts = pairs.filter((k) => addedToCart.has(k)).length
    const purchases = pairs.filter((k) => purchased.has(k)).length
    return {
      shoppers,
      addToCarts,
      purchases,
      addToCartRatePct: shoppers ? Number(((addToCarts / shoppers) * 100).toFixed(2)) : 0
    }
  }

  const all = [...viewers]
  const used = tally(all.filter((k) => usedTryOn.has(k)))
  const notUsed = tally(all.filter((k) => !usedTryOn.has(k)))

  const liftPct = Number((used.addToCartRatePct - notUsed.addToCartRatePct).toFixed(2))
  // Incremental carts = the carts the try-on cohort produced ABOVE what the
  // same number of non-users would have produced on their own.
  const incrementalAddToCarts = Number(
    (used.addToCarts - used.shoppers * (notUsed.addToCartRatePct / 100)).toFixed(2)
  )

  const completed = runs.filter((r) => r.status === 'completed')
  const failed = runs.filter((r) => r.status === 'failed')
  const free = runs.filter((r) => r.used_free_daily === true)
  const totalUsd = Number(runs.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0).toFixed(4))
  const itcRevenue = runs.reduce((sum, r) => sum + (Number(r.itc_charged) || 0), 0)
  const itcRevenueUsd = Number((itcRevenue * ITC_TO_USD).toFixed(4))

  const costPerIncrementalAddToCartUsd =
    incrementalAddToCarts > 0 ? Number((totalUsd / incrementalAddToCarts).toFixed(4)) : null

  // Logic to replace the TRYON_VALUE_PER_ADD_TO_CART_USD assumption with the measured figure
  // once sufficient purchase data is available:
  const SUFFICIENT_PURCHASES_THRESHOLD = 10
  let valuePerAddToCartUsd = TRYON_VALUE_PER_ADD_TO_CART_USD
  let usingMeasuredValue = false

  if (used.purchases >= SUFFICIENT_PURCHASES_THRESHOLD && used.addToCarts > 0) {
    const measuredCartToPurchaseRate = used.purchases / used.addToCarts
    const grossMarginPerPurchase = 13.0 // $26 AOV x 50% gross margin
    valuePerAddToCartUsd = Number((grossMarginPerPurchase * measuredCartToPurchaseRate).toFixed(2))
    usingMeasuredValue = true
  }

  // THE KILL RULE, in the brief's own terms: a run costs ~$0.075, so it has to
  // buy at least $0.075 of incremental gross margin. One incremental cart is
  // worth `valuePerAddToCart`, so the required incremental-cart rate is
  // breakeven / value — expressed per 100 runs because that reads like a
  // conversion rate instead of a decimal nobody can hold in their head.
  const breakevenIncrementalCartsPer100Runs = Number(
    ((TRYON_BREAKEVEN_USD_PER_RUN / valuePerAddToCartUsd) * 100).toFixed(2)
  )
  const actualIncrementalCartsPer100Runs = completed.length
    ? Number(((incrementalAddToCarts / completed.length) * 100).toFixed(2))
    : 0

  let verdict: ConversionReport['verdict'] = 'insufficient-data'
  let verdictReason = `Fewer than ${MIN_SHOPPERS_FOR_VERDICT} matched shoppers (or no completed runs) — not enough signal to rule on yet.`

  if (used.shoppers + notUsed.shoppers >= MIN_SHOPPERS_FOR_VERDICT && completed.length > 0) {
    if (incrementalAddToCarts <= 0 || liftPct <= 0) {
      verdict = 'kill'
      verdictReason = `Try-on users add to cart at ${used.addToCartRatePct}% vs ${notUsed.addToCartRatePct}% for shoppers who saw the card and skipped it — no positive lift, so every render is pure cost.`
    } else if (actualIncrementalCartsPer100Runs >= breakevenIncrementalCartsPer100Runs) {
      verdict = 'keep'
      verdictReason = `${actualIncrementalCartsPer100Runs} incremental carts per 100 runs beats the ${breakevenIncrementalCartsPer100Runs} needed to cover $${TRYON_BREAKEVEN_USD_PER_RUN.toFixed(3)}/run at $${valuePerAddToCartUsd.toFixed(2)} of margin per cart.`
    } else {
      verdict = 'kill'
      verdictReason = `${actualIncrementalCartsPer100Runs} incremental carts per 100 runs falls short of the ${breakevenIncrementalCartsPer100Runs} needed to cover $${TRYON_BREAKEVEN_USD_PER_RUN.toFixed(3)}/run.`
    }
  }

  return {
    cohorts: {
      usedTryOn: {
        shoppers: used.shoppers,
        addToCarts: used.addToCarts,
        addToCartRatePct: used.addToCartRatePct,
        purchases: used.purchases
      },
      noTryOn: {
        shoppers: notUsed.shoppers,
        addToCarts: notUsed.addToCarts,
        addToCartRatePct: notUsed.addToCartRatePct,
        purchases: notUsed.purchases
      }
    },
    liftPct,
    runs: {
      total: runs.length,
      completed: completed.length,
      failed: failed.length,
      free: free.length,
      paid: runs.length - free.length
    },
    spend: {
      totalUsd,
      itcRevenue,
      itcRevenueUsd,
      netUsd: Number((itcRevenueUsd - totalUsd).toFixed(4)),
      costPerCompletedRunUsd: completed.length ? Number((totalUsd / completed.length).toFixed(4)) : 0,
      costPerIncrementalAddToCartUsd
    },
    incrementalAddToCarts,
    breakevenUsdPerRun: TRYON_BREAKEVEN_USD_PER_RUN,
    valuePerAddToCartUsd,
    usingMeasuredValue,
    breakevenIncrementalCartsPer100Runs,
    actualIncrementalCartsPer100Runs,
    verdict,
    verdictReason
  }
}
