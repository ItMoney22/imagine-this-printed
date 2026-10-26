import { describe, it, expect } from 'vitest'
import { splitOrder } from './vendor-store-split.js'

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
