import { describe, it, expect } from 'vitest'
import { LIVE_OPT_IN_LABEL, cartHasOwnPrint, orderMayStillPrint } from './live-print'

describe('cartHasOwnPrint', () => {
  it('is true when the cart holds the customer\'s own print', () => {
    expect(cartHasOwnPrint([{ product: { id: 'a-shirt' } }, { product: { id: '3d-print-1234' } }])).toBe(true)
  })

  it('is false for shirts and catalog toys', () => {
    expect(cartHasOwnPrint([{ product: { id: '44444444-4444-4444-8444-444444444444' } }])).toBe(false)
  })

  it('is false for an empty cart and a line with no product', () => {
    expect(cartHasOwnPrint([])).toBe(false)
    expect(cartHasOwnPrint([{ product: null }])).toBe(false)
  })
})

describe('orderMayStillPrint', () => {
  it.each(['pending', 'processing', 'on_hold'])('keeps watching a %s order', status => {
    expect(orderMayStillPrint(status)).toBe(true)
  })

  it.each(['shipped', 'delivered', 'cancelled', 'refunded'])('stops at %s', status => {
    expect(orderMayStillPrint(status)).toBe(false)
  })
})

it('keeps the box in the words David gave it', () => {
  expect(LIVE_OPT_IN_LABEL).toBe('Let my family watch my Mini-Me print live on a private link')
})
