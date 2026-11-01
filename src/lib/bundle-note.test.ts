import { describe, it, expect } from 'vitest'
import { bundleNote } from './bundle-note'

const tee = (id: string, price = 25, eligible = true) => ({
  id, quantity: 1, selectedSize: 'M',
  product: { id, price, isThreeForTwentyFive: eligible, metadata: {} },
}) as any

describe('bundleNote', () => {
  it('two eligible $25 tees: saves $25, no nudge', () => {
    expect(bundleNote([tee('a'), tee('b')])).toEqual({ eligibleQty: 2, saved: 25, oneMore: false })
  })
  it('one eligible tee: nothing saved, nudge to add one more', () => {
    expect(bundleNote([tee('a')])).toEqual({ eligibleQty: 1, saved: 0, oneMore: true })
  })
  it('ineligible items never show the deal', () => {
    expect(bundleNote([tee('a', 25, false), tee('b', 25, false)])).toEqual({ eligibleQty: 0, saved: 0, oneMore: false })
  })
})
