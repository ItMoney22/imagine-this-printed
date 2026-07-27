import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CartProvider, useCart } from './CartContext'
import type { CartAddon, Product } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-basic',
    name: 'Basic Tee',
    description: 'A plain tee',
    price: 20,
    images: [],
    category: 'shirts',
    inStock: true,
    ...overrides,
  }
}

/** A product enrolled in the 3-for-$25 shirt deal via the top-level flag. */
function makeDealProduct(overrides: Partial<Product> = {}): Product {
  return makeProduct({ id: 'prod-deal', price: 25, isThreeForTwentyFive: true, ...overrides })
}

/** Same deal, but flagged through metadata (how DB-sourced products arrive). */
function makeMetadataDealProduct(overrides: Partial<Product> = {}): Product {
  return makeProduct({
    id: 'prod-deal-meta',
    price: 25,
    metadata: { isThreeForTwentyFive: true },
    ...overrides,
  })
}

const EASEL: CartAddon = { id: 'easel_stand', name: 'Tabletop easel stand', price: 7 }
const MOUNT: CartAddon = { id: 'standoff_mount', name: 'Floating standoff wall mount', price: 10 }

const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>

function renderCart() {
  return renderHook(() => useCart(), { wrapper })
}

const CART_STORAGE_KEY = 'itp_cart_v1'
const COUPON_STORAGE_KEY = 'itp_cart_coupon_v1'

describe('CartContext', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  describe('useCart guard', () => {
    it('throws outside a CartProvider', () => {
      // React logs the thrown error before rethrowing; silence it.
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => renderHook(() => useCart())).toThrow(
        'useCart must be used within a CartProvider',
      )
      spy.mockRestore()
    })
  })

  describe('base pricing', () => {
    it('starts empty at $0', () => {
      const { result } = renderCart()
      expect(result.current.state.items).toEqual([])
      expect(result.current.state.total).toBe(0)
      expect(result.current.finalTotal).toBe(0)
    })

    it('prices a single line as price x quantity', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 3, 'M'))
      expect(result.current.state.total).toBe(60)
    })

    it('sums multiple non-eligible lines', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ id: 'a', price: 20 }), 1, 'M'))
      act(() => result.current.addToCart(makeProduct({ id: 'b', price: 12.5 }), 2, 'M'))
      expect(result.current.state.total).toBeCloseTo(45, 10)
    })
  })

  describe('plus-size upcharge', () => {
    it('adds $2.50 per unit for 2XL and above', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, '2XL'))
      expect(result.current.state.total).toBeCloseTo(45, 10) // 40 + 2 * 2.50
    })

    it('does not upcharge standard sizes', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'L'))
      expect(result.current.state.total).toBe(40)
    })

    it('does not upcharge when no size was chosen', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 1))
      expect(result.current.state.total).toBe(20)
    })

    it('matches plus sizes case-insensitively and across spellings', () => {
      for (const size of ['2XL', '2x', 'xxl', '3XL', 'XXXL', '4x', '5XL']) {
        const { result, unmount } = renderCart()
        act(() => result.current.addToCart(makeProduct({ price: 20 }), 1, size))
        expect(result.current.state.total, `size ${size}`).toBeCloseTo(22.5, 10)
        unmount()
        window.localStorage.clear()
      }
    })

    it('upcharges deal items too — the $25 price is capped, the upcharge is not', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct(), 3, '3XL'))
      expect(result.current.state.total).toBeCloseTo(32.5, 10) // 25 + 3 * 2.50
    })
  })

  describe('3-for-$25 deal', () => {
    it('charges $25 for a set of three', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct(), 3, 'M'))
      expect(result.current.state.total).toBe(25)
    })

    it('charges the full $25 for each item under a set', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct(), 2, 'M'))
      expect(result.current.state.total).toBe(50)
    })

    it('charges $50 for two sets of three', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct(), 6, 'M'))
      expect(result.current.state.total).toBe(50)
    })

    it('charges a set plus the remainder at $25 each', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct(), 4, 'M'))
      expect(result.current.state.total).toBe(50) // 1 set ($25) + 1 remainder ($25)
    })

    it('pools quantity across different eligible products', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct({ id: 'deal-a' }), 2, 'M'))
      act(() => result.current.addToCart(makeDealProduct({ id: 'deal-b' }), 1, 'M'))
      // 3 eligible units total = one set, even though they are separate lines.
      expect(result.current.state.total).toBe(25)
    })

    it('honours the metadata flag as well as the column flag', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeMetadataDealProduct(), 3, 'M'))
      expect(result.current.state.total).toBe(25)
    })

    it('ignores the listed price of eligible items — the deal price wins', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct({ price: 99 }), 3, 'M'))
      expect(result.current.state.total).toBe(25)
    })

    it('keeps eligible and non-eligible items on separate pricing tracks', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct(), 3, 'M'))
      act(() => result.current.addToCart(makeProduct({ price: 30 }), 1, 'M'))
      expect(result.current.state.total).toBe(55) // 25 + 30
    })
  })

  describe('add-on upsells', () => {
    it('charges add-ons per unit', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M', undefined, undefined, undefined, undefined, [EASEL]))
      expect(result.current.state.total).toBe(54) // 40 + 2 * 7
    })

    it('sums multiple add-ons on the same line', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 1, 'M', undefined, undefined, undefined, undefined, [EASEL, MOUNT]))
      expect(result.current.state.total).toBe(37) // 20 + 7 + 10
    })

    it('charges add-ons on deal items on top of the capped $25', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct(), 3, 'M', undefined, undefined, undefined, undefined, [EASEL]))
      expect(result.current.state.total).toBe(46) // 25 + 3 * 7
    })

    it('adds nothing when no add-ons are selected', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 1, 'M', undefined, undefined, undefined, undefined, []))
      expect(result.current.state.total).toBe(20)
    })
  })

  describe('line-item merging', () => {
    it('merges an identical add into the existing line', () => {
      const { result } = renderCart()
      const p = makeProduct({ price: 20 })
      act(() => result.current.addToCart(p, 1, 'M', 'Black'))
      act(() => result.current.addToCart(p, 2, 'M', 'Black'))

      expect(result.current.state.items).toHaveLength(1)
      expect(result.current.state.items[0].quantity).toBe(3)
      expect(result.current.state.total).toBe(60)
    })

    it('keeps a different size on its own line', () => {
      const { result } = renderCart()
      const p = makeProduct({ price: 20 })
      act(() => result.current.addToCart(p, 1, 'M', 'Black'))
      act(() => result.current.addToCart(p, 1, 'L', 'Black'))
      expect(result.current.state.items).toHaveLength(2)
    })

    it('keeps a different colour on its own line', () => {
      const { result } = renderCart()
      const p = makeProduct({ price: 20 })
      act(() => result.current.addToCart(p, 1, 'M', 'Black'))
      act(() => result.current.addToCart(p, 1, 'M', 'White'))
      expect(result.current.state.items).toHaveLength(2)
    })

    it('keeps a different payment method on its own line', () => {
      const { result } = renderCart()
      const p = makeProduct({ price: 20 })
      act(() => result.current.addToCart(p, 1, 'M', 'Black', undefined, undefined, 'usd'))
      act(() => result.current.addToCart(p, 1, 'M', 'Black', undefined, undefined, 'itc'))
      expect(result.current.state.items).toHaveLength(2)
    })

    it('keeps a different add-on selection on its own line', () => {
      const { result } = renderCart()
      const p = makeProduct({ price: 20 })
      act(() => result.current.addToCart(p, 1, 'M', 'Black', undefined, undefined, 'usd', [EASEL]))
      act(() => result.current.addToCart(p, 1, 'M', 'Black', undefined, undefined, 'usd', [MOUNT]))
      expect(result.current.state.items).toHaveLength(2)
      expect(result.current.state.total).toBe(57) // 40 + 7 + 10
    })

    it('merges add-on selections that differ only in order', () => {
      const { result } = renderCart()
      const p = makeProduct({ price: 20 })
      act(() => result.current.addToCart(p, 1, 'M', 'Black', undefined, undefined, 'usd', [EASEL, MOUNT]))
      act(() => result.current.addToCart(p, 1, 'M', 'Black', undefined, undefined, 'usd', [MOUNT, EASEL]))
      expect(result.current.state.items).toHaveLength(1)
      expect(result.current.state.items[0].quantity).toBe(2)
    })
  })

  describe('mutations', () => {
    it('recalculates the total after updateQuantity', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 1, 'M'))
      const id = result.current.state.items[0].id

      act(() => result.current.updateQuantity(id, 4))
      expect(result.current.state.total).toBe(80)
    })

    it('drops the line when quantity hits zero', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))
      const id = result.current.state.items[0].id

      act(() => result.current.updateQuantity(id, 0))
      expect(result.current.state.items).toHaveLength(0)
      expect(result.current.state.total).toBe(0)
    })

    it('re-prices the deal when a set is broken up', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeDealProduct(), 3, 'M'))
      const id = result.current.state.items[0].id

      act(() => result.current.updateQuantity(id, 2))
      expect(result.current.state.total).toBe(50) // no longer a set
    })

    it('removes a single line and re-prices the rest', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ id: 'a', price: 20 }), 1, 'M'))
      act(() => result.current.addToCart(makeProduct({ id: 'b', price: 30 }), 1, 'M'))
      const idA = result.current.state.items[0].id

      act(() => result.current.removeFromCart(idA))
      expect(result.current.state.items).toHaveLength(1)
      expect(result.current.state.total).toBe(30)
    })

    it('clears the cart and any applied coupon', async () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 1, 'M'))
      await applyStubbedCoupon(result, { discount: 5 })
      expect(result.current.discount).toBe(5)

      act(() => result.current.clearCart())
      expect(result.current.state.items).toEqual([])
      expect(result.current.state.total).toBe(0)
      expect(result.current.appliedCoupon).toBeNull()
      expect(result.current.discount).toBe(0)
    })
  })

  describe('restoreFromOrder', () => {
    it('rebuilds lines from order metadata and re-prices them', () => {
      const { result } = renderCart()
      act(() =>
        result.current.restoreFromOrder([
          { product: makeProduct({ id: 'a', price: 20 }), quantity: 2, selectedSize: 'M' },
          { product: makeDealProduct(), quantity: 3, selectedSize: 'M' },
        ]),
      )
      expect(result.current.state.items).toHaveLength(2)
      expect(result.current.state.total).toBe(65) // 40 + 25
    })

    it('backfills a product shell from flat order fields', () => {
      const { result } = renderCart()
      act(() =>
        result.current.restoreFromOrder([
          { id: 'legacy-1', name: 'Legacy Tee', price: 15, quantity: 2 },
        ]),
      )
      const item = result.current.state.items[0]
      expect(item.product.name).toBe('Legacy Tee')
      expect(item.product.price).toBe(15)
      expect(item.quantity).toBe(2)
      expect(item.paymentMethod).toBe('usd')
      expect(result.current.state.total).toBe(30)
    })

    it('reads size/colour out of a variations object', () => {
      const { result } = renderCart()
      act(() =>
        result.current.restoreFromOrder([
          { id: 'legacy-2', price: 20, quantity: 1, variations: { size: '2XL', color: 'Red' } },
        ]),
      )
      const item = result.current.state.items[0]
      expect(item.selectedSize).toBe('2XL')
      expect(item.selectedColor).toBe('Red')
      expect(result.current.state.total).toBeCloseTo(22.5, 10) // plus-size upcharge applies
    })
  })

  describe('persistence', () => {
    it('writes items (not the total) to localStorage', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))

      const raw = window.localStorage.getItem(CART_STORAGE_KEY)
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw as string)
      expect(parsed.items).toHaveLength(1)
      expect(parsed.total).toBeUndefined()
    })

    it('rehydrates a stored cart on mount', () => {
      const first = renderCart()
      act(() => first.result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))
      first.unmount()

      const second = renderCart()
      expect(second.result.current.state.items).toHaveLength(1)
      expect(second.result.current.state.total).toBe(40)
    })

    it('recomputes the total on rehydrate instead of trusting a stored one', () => {
      // A stale total from an older pricing rule must never survive a reload.
      window.localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({
          items: [
            { id: 'x', product: makeDealProduct(), quantity: 3, selectedSize: 'M' },
          ],
          total: 999,
        }),
      )
      const { result } = renderCart()
      expect(result.current.state.total).toBe(25)
    })

    it('falls back to an empty cart on corrupt storage', () => {
      window.localStorage.setItem(CART_STORAGE_KEY, 'not json{{')
      const { result } = renderCart()
      expect(result.current.state.items).toEqual([])
      expect(result.current.state.total).toBe(0)
    })

    it('ignores a stored payload whose items are not an array', () => {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items: 'nope' }))
      const { result } = renderCart()
      expect(result.current.state.items).toEqual([])
    })
  })

  describe('coupons and finalTotal', () => {
    it('finalTotal equals the total when no coupon is applied', () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))
      expect(result.current.discount).toBe(0)
      expect(result.current.finalTotal).toBe(40)
    })

    it('subtracts a validated discount', async () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))
      await applyStubbedCoupon(result, { discount: 10 })

      expect(result.current.appliedCoupon?.code).toBe('SAVE10')
      expect(result.current.discount).toBe(10)
      expect(result.current.finalTotal).toBe(30)
    })

    it('floors finalTotal at zero when the discount exceeds the cart', () => {
      // A $500 gift-card style discount on a $40 cart must not produce -$460.
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))
      return applyStubbedCoupon(result, { discount: 500 }).then(() => {
        expect(result.current.finalTotal).toBe(0)
      })
    })

    it('uppercases the code and sends the current total for validation', async () => {
      const fetchMock = stubCouponFetch({ discount: 5 })
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))
      await act(async () => {
        await result.current.applyCoupon('save10', 'user-1')
      })

      const url = String(fetchMock.mock.calls[0][0])
      expect(url).toContain('code=SAVE10')
      expect(url).toContain('orderTotal=40')
      expect(url).toContain('userId=user-1')
    })

    it('surfaces a rejection without applying a discount', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => ({ valid: false, error: 'Coupon expired' }),
        }),
      )
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))

      let outcome: { success: boolean; error?: string } | undefined
      await act(async () => {
        outcome = await result.current.applyCoupon('EXPIRED')
      })

      expect(outcome).toEqual({ success: false, error: 'Coupon expired' })
      expect(result.current.appliedCoupon).toBeNull()
      expect(result.current.finalTotal).toBe(40)
      vi.unstubAllGlobals()
    })

    it('surfaces a network failure instead of throwing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const { result } = renderCart()

      let outcome: { success: boolean; error?: string } | undefined
      await act(async () => {
        outcome = await result.current.applyCoupon('ANY')
      })

      expect(outcome).toEqual({ success: false, error: 'offline' })
      expect(result.current.couponLoading).toBe(false)
      vi.unstubAllGlobals()
    })

    it('removes an applied coupon', async () => {
      const { result } = renderCart()
      act(() => result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))
      await applyStubbedCoupon(result, { discount: 10 })

      act(() => result.current.removeCoupon())
      expect(result.current.appliedCoupon).toBeNull()
      expect(result.current.finalTotal).toBe(40)
      expect(window.localStorage.getItem(COUPON_STORAGE_KEY)).toBeNull()
    })

    it('persists and rehydrates the applied coupon', async () => {
      const first = renderCart()
      act(() => first.result.current.addToCart(makeProduct({ price: 20 }), 2, 'M'))
      await applyStubbedCoupon(first.result, { discount: 10 })
      expect(window.localStorage.getItem(COUPON_STORAGE_KEY)).toBeTruthy()
      first.unmount()

      const second = renderCart()
      expect(second.result.current.appliedCoupon?.code).toBe('SAVE10')
      expect(second.result.current.finalTotal).toBe(30)
    })
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubCouponFetch({ discount }: { discount: number }) {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({
      valid: true,
      discount,
      freeShipping: false,
      coupon: { id: 'coupon-1', code: 'SAVE10', type: 'fixed', value: discount },
    }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function applyStubbedCoupon(
  result: { current: ReturnType<typeof useCart> },
  opts: { discount: number },
) {
  stubCouponFetch(opts)
  await act(async () => {
    await result.current.applyCoupon('SAVE10')
  })
  vi.unstubAllGlobals()
}
