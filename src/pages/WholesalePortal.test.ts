import { describe, expect, it } from 'vitest'
import source from './WholesalePortal.tsx?raw'

// Guard: ITP is the only seller. The portal listed two invented vendors
// ("Premium Apparel Co", "Quality Prints Ltd") and a stock unsplash photo on the
// live site until 2026-10-13 (task 67755f9a); this fails if either comes back.
describe('WholesalePortal invented data', () => {
  it('has no hard-coded vendor names or stock photo hosts', () => {
    expect(source).not.toMatch(/Premium Apparel|Quality Prints|All Vendors|images\.unsplash\.com/i)
  })
})
