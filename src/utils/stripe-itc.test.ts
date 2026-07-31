// Reconciliation test for Watchtower task 8d7c8233 (buy-side ITC rate was
// 10x the redeem-side rate: $0.10/ITC to buy vs $0.01/ITC everywhere ITC gets
// spent — cashout, store-credit conversion, checkout ITC application, full-ITC
// order payment). backend/config/itc-pricing.ts is now the single canonical
// source; this file's ITC_TO_USD_RATE/ITC_PACKAGES are a straight re-export,
// not a duplicate — these tests exist to catch it if that ever changes back
// to a duplicate that can drift.

import { describe, it, expect } from 'vitest'
import { ITC_TO_USD_RATE, ITC_PACKAGES, stripeITCBridge } from './stripe-itc'
import {
  ITC_TO_USD_RATE as backendRate,
  ITC_PACKAGES as backendPackages,
  calculateUSDFromITC
} from '../../backend/config/itc-pricing'

describe('ITC buy/redeem rate reconciliation', () => {
  it('the frontend re-exports the exact same canonical rate as the backend config', () => {
    expect(ITC_TO_USD_RATE).toBe(backendRate)
    expect(ITC_TO_USD_RATE).toBe(0.01)
  })

  it('the frontend re-exports the exact same package list as the backend config (no duplicate array to drift)', () => {
    expect(ITC_PACKAGES).toBe(backendPackages)
  })

  it('the wallet redeem-side exchange rate (getExchangeRate) agrees with the buy-side rate', () => {
    expect(stripeITCBridge.getExchangeRate()).toBe(ITC_TO_USD_RATE)
    expect(stripeITCBridge.calculateUSDAmount(500)).toBeCloseTo(500 * ITC_TO_USD_RATE, 6)
  })

  it('every ITC package prices out at itcAmount * canonical rate, minus its own bonus discount', () => {
    for (const pkg of ITC_PACKAGES) {
      const undiscounted = calculateUSDFromITC(pkg.itcAmount)
      const bonus = pkg.bonusPercent || 0
      const expectedPrice = Math.round(undiscounted * (1 - bonus / 100) * 100) / 100
      expect(pkg.priceUSD).toBeCloseTo(expectedPrice, 2)
    }
  })

  it('buying then immediately redeeming the smallest package only loses the platform fee, not 90% (regression guard for the old 10x buy/redeem gap)', () => {
    const smallestPackage = ITC_PACKAGES[0]
    const redeemValue = calculateUSDFromITC(smallestPackage.itcAmount)
    // Before the fix: buy rate 0.10, redeem rate 0.01 -> redeemValue would
    // have been 1/10th of priceUSD. Now they must agree exactly (0% bonus tier).
    expect(redeemValue).toBeCloseTo(smallestPackage.priceUSD, 2)
  })
})
