import { describe, it, expect } from 'vitest'
import { splitOrder } from './vendor-store-split.js'

const rules = { feePercent: 10, ownShippingCents: 599, itpShippingCents: 699 }

describe('splitOrder', () => {
  it('her own product: ITP keeps the fee; her package’s shipping buys her label, so her share is the sale less the fee', () => {
    const s = splitOrder([{ kind: 'own', unitCents: 2500, itpCostCents: 0, quantity: 2 }], rules)
    expect(s.subtotalCents).toBe(5000)
    expect(s.shippingCents).toBe(599)
    expect(s.totalCents).toBe(5599)
    expect(s.ownShippingCents).toBe(599)
    expect(s.itpShippingCents).toBe(0)
    expect(s.itpShareCents).toBe(500 + 599)
    expect(s.vendorShareCents).toBe(4500)
  })

  it('an ITP product she resells: ITP keeps its cost and its shipping, she keeps the markup', () => {
    const s = splitOrder([{ kind: 'itp', unitCents: 3500, itpCostCents: 2000, quantity: 1 }], rules)
    expect(s.totalCents).toBe(3500 + 699)
    expect(s.ownShippingCents).toBe(0)
    expect(s.itpShippingCents).toBe(699)
    expect(s.itpShareCents).toBe(2000 + 699)
    expect(s.vendorShareCents).toBe(1500)
  })

  it('a mixed cart charges both packages and splits each line by its own rule', () => {
    const s = splitOrder([
      { kind: 'own', unitCents: 2000, itpCostCents: 0, quantity: 1 },
      { kind: 'itp', unitCents: 3000, itpCostCents: 1800, quantity: 2 },
    ], rules)
    expect(s.subtotalCents).toBe(8000)
    expect(s.shippingCents).toBe(599 + 699)
    expect(s.itpShareCents).toBe(200 + 3600 + 699 + 599)
    expect(s.vendorShareCents).toBe(s.totalCents - s.itpShareCents)
    expect(s.vendorShareCents).toBe(1800 + 2400)
  })

  it('records each package on its own side: the label it pays for and ITP’s usual cut', () => {
    // Real Shippo rates with ITP's 5%: her box $7.43 -> $7.80 charged, ITP's box $5.58 -> $5.86 charged.
    const s = splitOrder([
      { kind: 'own', unitCents: 2500, itpCostCents: 0, quantity: 1 },
      { kind: 'itp', unitCents: 2600, itpCostCents: 1400, quantity: 1 },
    ], { feePercent: 10, ownShippingCents: 780, ownLabelCents: 743, itpShippingCents: 586, itpLabelCents: 558 })
    expect([s.ownShippingCents, s.ownLabelCents, s.ownShippingCutCents]).toEqual([780, 743, 37])
    expect([s.itpShippingCents, s.itpLabelCents, s.itpShippingCutCents]).toEqual([586, 558, 28])
    expect(s.shippingCents).toBe(780 + 586)
    expect(s.totalCents).toBe(2500 + 2600 + 780 + 586)
    // ITP: 10% of her tee + the candle's cost + both packages (both labels are bought on ITP's Shippo account).
    expect(s.itpShareCents).toBe(250 + 1400 + 586 + 780)
    expect(s.vendorShareCents).toBe(2250 + 1200)
  })

  it('a label is never more than what its package charged, and defaults to all of it', () => {
    const s = splitOrder([{ kind: 'own', unitCents: 1000, itpCostCents: 0, quantity: 1 }], { feePercent: 10, ownShippingCents: 500, itpShippingCents: 700, ownLabelCents: 900, itpLabelCents: 600 })
    expect([s.ownLabelCents, s.ownShippingCutCents]).toEqual([500, 0])
    expect([s.itpShippingCents, s.itpLabelCents, s.itpShippingCutCents]).toEqual([0, 0, 0])
    const d = splitOrder([{ kind: 'own', unitCents: 1000, itpCostCents: 0, quantity: 1 }], rules)
    expect([d.ownLabelCents, d.ownShippingCutCents]).toEqual([599, 0])
  })

  it('refuses an ITP product priced under its cost', () => {
    expect(() => splitOrder([{ kind: 'itp', unitCents: 1500, itpCostCents: 2000, quantity: 1 }], rules)).toThrow()
  })

  it('clamps the fee to 0..50% and refuses an empty order', () => {
    const s = splitOrder([{ kind: 'own', unitCents: 1000, itpCostCents: 0, quantity: 1 }], { ...rules, feePercent: 90 })
    expect(s.itpShareCents).toBe(500 + 599)
    expect(() => splitOrder([], rules)).toThrow()
  })
})
