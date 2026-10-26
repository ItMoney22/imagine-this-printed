import { describe, it, expect } from 'vitest'
import { splitOrder, discountCentsFor, DiscountTooDeepError, type OrderSplit, type SplitDiscount, type SplitLine } from './vendor-store-split.js'

const rules = { feePercent: 10, ownShippingCents: 599, itpShippingCents: 699 }

describe('splitOrder', () => {
  it('her own product: ITP keeps the fee, she keeps the rest and her shipping', () => {
    const s = splitOrder([{ kind: 'own', unitCents: 2500, itpCostCents: 0, quantity: 2 }], rules)
    expect(s.subtotalCents).toBe(5000)
    expect(s.shippingCents).toBe(599)
    expect(s.totalCents).toBe(5599)
    expect(s.itpShareCents).toBe(500)
    expect(s.vendorShareCents).toBe(5099)
  })

  it('an ITP product she resells: ITP keeps its cost and its shipping, she keeps the markup', () => {
    const s = splitOrder([{ kind: 'itp', unitCents: 3500, itpCostCents: 2000, quantity: 1 }], rules)
    expect(s.totalCents).toBe(3500 + 699)
    expect(s.itpShareCents).toBe(2000 + 699)
    expect(s.vendorShareCents).toBe(1500)
  })

  it('a mixed cart charges both shipping rates and splits each line by its own rule', () => {
    const s = splitOrder([
      { kind: 'own', unitCents: 2000, itpCostCents: 0, quantity: 1 },
      { kind: 'itp', unitCents: 3000, itpCostCents: 1800, quantity: 2 },
    ], rules)
    expect(s.subtotalCents).toBe(8000)
    expect(s.shippingCents).toBe(599 + 699)
    expect(s.itpShareCents).toBe(200 + 3600 + 699)
    expect(s.vendorShareCents).toBe(s.totalCents - s.itpShareCents)
    expect(s.vendorShareCents).toBe(1800 + 2400 + 599)
  })

  it('refuses an ITP product priced under its cost', () => {
    expect(() => splitOrder([{ kind: 'itp', unitCents: 1500, itpCostCents: 2000, quantity: 1 }], rules)).toThrow()
  })

  it('clamps the fee to 0..50% and refuses an empty order', () => {
    const s = splitOrder([{ kind: 'own', unitCents: 1000, itpCostCents: 0, quantity: 1 }], { ...rules, feePercent: 90 })
    expect(s.itpShareCents).toBe(500)
    expect(() => splitOrder([], rules)).toThrow()
  })
})

// Her discount codes (David 2026-10-26: "whatever she does cuts at her own cost"). ITP's share is what ITP is owed on
// the full prices: our price to her on ITP items, our percent of her own items, our shipping. A code must never move
// it by a cent; it only comes off what she keeps. A code that would need ITP's money is refused.
describe('splitOrder with her discount code', () => {
  // Everything ITP gets out of an order. With and without a code this must be the same, byte for byte.
  const itpSide = (s: OrderSplit) => JSON.stringify({ itpShareCents: s.itpShareCents, itpShippingCents: s.itpShippingCents })
  const PERCENT_20: SplitDiscount = { kind: 'percent', amount: 20 }
  const FIVE_OFF: SplitDiscount = { kind: 'amount', amount: 500 }
  const mixed: SplitLine[] = [
    { kind: 'own', unitCents: 2000, itpCostCents: 0, quantity: 1 },
    { kind: 'itp', unitCents: 3000, itpCostCents: 1800, quantity: 2 },
  ]

  it('percent off comes off the whole cart’s items, out of her share only', () => {
    const plain = splitOrder(mixed, rules)
    const s = splitOrder(mixed, rules, PERCENT_20)
    expect(s.discountCents).toBe(1600) // 20% of 8000
    expect(s.shippingCents).toBe(599 + 699) // shipping is never discounted
    expect(s.totalCents).toBe(8000 - 1600 + 1298)
    expect(s.itpShareCents).toBe(200 + 3600 + 699) // 10% of her 2000, our price 2 x 1800, our shipping
    expect(itpSide(s)).toBe(itpSide(plain))
    expect(s.vendorShareCents).toBe(plain.vendorShareCents - 1600)
  })

  it('dollars off comes out of her share only', () => {
    const own: SplitLine[] = [{ kind: 'own', unitCents: 2500, itpCostCents: 0, quantity: 2 }]
    const plain = splitOrder(own, rules)
    const s = splitOrder(own, rules, FIVE_OFF)
    expect(s.discountCents).toBe(500)
    expect(s.totalCents).toBe(5599 - 500)
    expect(s.itpShareCents).toBe(500) // still 10% of the FULL 5000, not of 4500
    expect(itpSide(s)).toBe(itpSide(plain))
    expect(s.vendorShareCents).toBe(5099 - 500)
  })

  it('a dollars-off code bigger than the items stops at the items: shipping is never taken', () => {
    const small: SplitLine[] = [{ kind: 'own', unitCents: 500, itpCostCents: 0, quantity: 1 }]
    const s = splitOrder(small, rules, { kind: 'amount', amount: 1000 })
    expect(s.discountCents).toBe(500)
    expect(s.totalCents).toBe(599)
    expect(s.itpShareCents).toBe(50)
  })

  it('refuses a code that would take the order under ITP’s share, and allows one that lands exactly on it', () => {
    // Candle: her price 2600, our price to her 1400, our shipping 699. ITP's share 2099; she keeps 1200.
    const candle: SplitLine[] = [{ kind: 'itp', unitCents: 2600, itpCostCents: 1400, quantity: 1 }]
    expect(() => splitOrder(candle, rules, { kind: 'percent', amount: 50 })).toThrow(DiscountTooDeepError)
    expect(() => splitOrder(candle, rules, { kind: 'amount', amount: 1201 })).toThrow(DiscountTooDeepError)
    const edge = splitOrder(candle, rules, { kind: 'amount', amount: 1200 })
    expect(edge.totalCents).toBe(2099)
    expect(edge.itpShareCents).toBe(2099)
    expect(edge.vendorShareCents).toBe(0)
  })

  it('no code, or a code worth nothing, leaves the split exactly as it was', () => {
    const plain = splitOrder(mixed, rules)
    expect(plain.discountCents).toBe(0)
    expect(splitOrder(mixed, rules, null)).toEqual(plain)
    expect(splitOrder([{ kind: 'own', unitCents: 40, itpCostCents: 0, quantity: 1 }], rules, { kind: 'percent', amount: 1 }).discountCents).toBe(0)
  })

  it('works out the discount on the items only, rounded to the cent and never past them', () => {
    expect(discountCentsFor({ kind: 'percent', amount: 15 }, 3333)).toBe(500) // 499.95
    expect(discountCentsFor({ kind: 'percent', amount: 150 }, 1000)).toBe(1000)
    expect(discountCentsFor({ kind: 'amount', amount: 2500 }, 1999)).toBe(1999)
    expect(discountCentsFor(null, 1999)).toBe(0)
  })

  it('ITP’s share is byte-identical with and without each code, across 2,000 carts', () => {
    // A fixed-seed generator, so a failure names a cart that can be replayed.
    let seed = 20261026
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const codes: SplitDiscount[] = [
      { kind: 'percent', amount: 5 }, { kind: 'percent', amount: 10 }, PERCENT_20, { kind: 'percent', amount: 35 },
      { kind: 'amount', amount: 100 }, FIVE_OFF, { kind: 'amount', amount: 1000 },
    ]
    let applied = 0
    let refused = 0
    for (let cart = 0; cart < 2000; cart++) {
      const lines: SplitLine[] = Array.from({ length: 1 + rand(4) }, () => {
        if (rand(2)) return { kind: 'own' as const, unitCents: 100 + rand(6000), itpCostCents: 0, quantity: 1 + rand(3) }
        const cost = 25 + rand(2500)
        return { kind: 'itp' as const, unitCents: cost + rand(2000), itpCostCents: cost, quantity: 1 + rand(3) }
      })
      const r = { feePercent: rand(26), ownShippingCents: rand(2) ? 599 : 0, itpShippingCents: rand(2) ? 699 : 0 }
      const plain = splitOrder(lines, r)
      for (const code of codes) {
        let s: OrderSplit
        try {
          s = splitOrder(lines, r, code)
        } catch (e) {
          // Refused only when the code really is bigger than what she keeps.
          expect(e).toBeInstanceOf(DiscountTooDeepError)
          expect(discountCentsFor(code, plain.subtotalCents)).toBeGreaterThan(plain.vendorShareCents)
          refused++
          continue
        }
        expect(itpSide(s), `cart ${cart} ${code.kind} ${code.amount}`).toBe(itpSide(plain))
        expect(s.totalCents).toBe(plain.totalCents - s.discountCents)
        expect(s.vendorShareCents).toBe(plain.vendorShareCents - s.discountCents)
        expect(s.vendorShareCents).toBeGreaterThanOrEqual(0)
        applied++
      }
    }
    expect(applied).toBeGreaterThan(10000)
    expect(refused).toBeGreaterThan(0)
  })
})
