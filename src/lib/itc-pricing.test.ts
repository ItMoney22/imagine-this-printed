import { describe, it, expect } from 'vitest'
import {
  ITC_PER_USD,
  usdToItc,
  itcToUsd,
  itcToUsdLabel,
  formatItc,
  usdToItcLabel,
} from './itc-pricing'

describe('itc-pricing', () => {
  describe('ITC_PER_USD', () => {
    it('is 100 — 1 ITC = $0.01', () => {
      // This constant is duplicated in backend/routes/wallet.ts (ITC_TO_USD) and
      // in Checkout.tsx. If it drifts, customers see one price and get charged
      // another, so pin it here as a tripwire rather than as trivia.
      expect(ITC_PER_USD).toBe(100)
    })
  })

  describe('usdToItc', () => {
    it('converts whole dollars', () => {
      expect(usdToItc(1)).toBe(100)
      expect(usdToItc(25)).toBe(2500)
      expect(usdToItc(0)).toBe(0)
    })

    it('rounds away float error instead of leaking fractional ITC', () => {
      // 0.29 * 100 === 28.999999999999996 in IEEE-754.
      expect(usdToItc(0.29)).toBe(29)
      expect(usdToItc(1.15)).toBe(115)
      expect(usdToItc(89.99)).toBe(8999)
    })

    it('rounds half-cent amounts to the nearest whole ITC', () => {
      expect(usdToItc(0.005)).toBe(1)
      expect(usdToItc(0.004)).toBe(0)
    })

    it('handles negative amounts (refunds / adjustments)', () => {
      expect(usdToItc(-5)).toBe(-500)
    })
  })

  describe('itcToUsd', () => {
    it('converts ITC back to dollars', () => {
      expect(itcToUsd(100)).toBe(1)
      expect(itcToUsd(15)).toBeCloseTo(0.15, 10)
      expect(itcToUsd(2500)).toBe(25)
      expect(itcToUsd(0)).toBe(0)
    })

    it('round-trips whole-cent USD amounts without drift', () => {
      for (const usd of [0.01, 0.29, 1.15, 25, 89.99, 1234.56]) {
        expect(itcToUsd(usdToItc(usd))).toBeCloseTo(usd, 10)
      }
    })

    it('round-trips whole ITC amounts exactly', () => {
      for (const itc of [1, 29, 115, 2500, 8999]) {
        expect(usdToItc(itcToUsd(itc))).toBe(itc)
      }
    })
  })

  describe('itcToUsdLabel', () => {
    it('always renders two decimal places', () => {
      expect(itcToUsdLabel(15)).toBe('$0.15')
      expect(itcToUsdLabel(100)).toBe('$1.00')
      expect(itcToUsdLabel(2500)).toBe('$25.00')
      expect(itcToUsdLabel(0)).toBe('$0.00')
    })

    it('rounds sub-cent ITC fractions for display', () => {
      expect(itcToUsdLabel(1)).toBe('$0.01')
      expect(itcToUsdLabel(8999)).toBe('$89.99')
    })
  })

  describe('formatItc', () => {
    it('appends the ITC unit', () => {
      expect(formatItc(500)).toBe('500 ITC')
      expect(formatItc(0)).toBe('0 ITC')
    })

    it('groups thousands', () => {
      // Locale-tolerant: the separator depends on the runtime default locale,
      // but the digits and the unit must not.
      expect(formatItc(2999)).toMatch(/^2\D?999 ITC$/)
    })
  })

  describe('usdToItcLabel', () => {
    it('composes usdToItc + formatItc', () => {
      expect(usdToItcLabel(5)).toBe('500 ITC')
      expect(usdToItcLabel(29.99)).toMatch(/^2\D?999 ITC$/)
    })

    it('agrees with the USD label it was derived from', () => {
      const usd = 29.99
      expect(itcToUsdLabel(usdToItc(usd))).toBe('$29.99')
      expect(usdToItcLabel(usd)).toBe(formatItc(usdToItc(usd)))
    })
  })
})
