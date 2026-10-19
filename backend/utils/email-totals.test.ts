import { describe, it, expect } from 'vitest'
import { buildTotalsRows, totalsFootHtml, subjectClaimsShipped, typedName } from './email-blocks.js'

describe('buildTotalsRows (order ITP-MTYGMM4V-UQ5X shape)', () => {
  const items = [{ quantity: 2, price: 20 }]

  it('reconciles 2 x $20 with a $30.42 total via discount/shipping/tax', () => {
    const rows = buildTotalsRows(items, 30.42, { subtotal: 40, discount: 12, shipping: 0, tax: 2.42 })
    expect(rows.map(r => r.label)).toEqual(['Subtotal', 'Discount', 'Shipping', 'Tax', 'Total'])
    const sum = rows.filter(r => !r.strong).reduce((n, r) => n + Math.round(r.amount * 100), 0)
    expect(sum).toBe(3042)
  })

  it('adds an Adjustments row instead of printing numbers that disagree', () => {
    const rows = buildTotalsRows(items, 30.42, {})
    expect(rows.some(r => r.label === 'Adjustments')).toBe(true)
    const sum = rows.filter(r => !r.strong).reduce((n, r) => n + Math.round(r.amount * 100), 0)
    expect(sum).toBe(3042)
  })

  it('omits Discount when there is none and shows free shipping', () => {
    const rows = buildTotalsRows(items, 42.5, { subtotal: 40, shipping: 0, tax: 2.5, discount: 0 })
    expect(rows.find(r => r.label === 'Discount')).toBeUndefined()
    expect(totalsFootHtml(rows)).toContain('Free')
  })
})

describe('subjectClaimsShipped', () => {
  it('flags the live bad subject', () => {
    expect(subjectClaimsShipped('Your Gothic Ghost Face Candle Holders are on their way')).toBe(true)
    expect(subjectClaimsShipped('Your order has shipped')).toBe(true)
  })
  it('passes a real confirmation', () => {
    expect(subjectClaimsShipped('🎉 Order Confirmed - ITP-MTYGMM4V-UQ5X')).toBe(false)
  })
})

describe('typedName', () => {
  it('keeps the full typed name', () => expect(typedName('  Sam   Reed ')).toBe('Sam Reed'))
  it('is null for blank / placeholder / email', () => {
    for (const v of ['', '  ', null, undefined, 'Not provided', 'a@b.com']) expect(typedName(v as any)).toBeNull()
  })
})
