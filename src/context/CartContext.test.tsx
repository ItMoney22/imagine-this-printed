// @vitest-environment jsdom
//
// Regression coverage for two cart-integrity bugs (Watchtower tasks
// 6593e839 and 428a05df):
//
//  1. Line-item ids used to be `${product.id}-${Date.now()}`. Two distinct
//     variants (different size/color/addons) added within the same
//     millisecond got the same id, so removeFromCart/updateQuantity would
//     act on both instead of one.
//  2. The cart persisted full base64 image data, the entire layer array,
//     and a JSON canvas snapshot straight to localStorage on every change.
//     A couple of Imagination Sheets blow the ~5MB quota, and the write
//     failure used to be swallowed silently — the cart just didn't survive
//     a refresh, with no indication to the customer.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { CartProvider, useCart } from './CartContext'
import type { CartItem, Product } from '../types'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CartProvider>{children}</CartProvider>
)

const baseProduct: Product = {
  id: 'prod-1',
  name: 'Test Shirt',
  description: 'A shirt',
  price: 20,
  images: ['https://cdn.example.com/shirt.png'],
  category: 'shirts',
  inStock: true
}

const heavyDesignData: CartItem['designData'] = {
  elements: [{ id: 'layer-1', type: 'image' }, { id: 'layer-2', type: 'text' }],
  template: 'imagination-sheet',
  mockupUrl: `data:image/png;base64,${'A'.repeat(1000)}`,
  canvasSnapshot: JSON.stringify({ big: 'x'.repeat(1000) }),
  printReadyUrl: 'https://storage.googleapis.com/itp-bucket/print-ready/abc123.png'
}

const sheetProduct: Product = {
  id: 'imagination-sheet-1',
  name: 'Imagination Sheet',
  description: 'A DTF sheet',
  price: 15,
  images: [`data:image/png;base64,${'B'.repeat(500)}`],
  category: 'dtf-transfers',
  inStock: true
}

describe('CartContext', () => {
  beforeEach(() => {
    // Pin the clock so two adds genuinely land in the same millisecond —
    // that's the exact scenario that collided under the old id scheme.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'))
    window.localStorage.clear()
  })

  // This project runs vitest without `globals`, so testing-library's
  // automatic per-test cleanup never registers — unmount by hand.
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  describe('line-item id collisions (task 6593e839)', () => {
    it('gives two same-millisecond variant adds distinct line-item ids', () => {
      const { result } = renderHook(() => useCart(), { wrapper })

      act(() => {
        result.current.addToCart(baseProduct, 1, 'M')
        result.current.addToCart(baseProduct, 1, 'L')
      })

      expect(result.current.state.items).toHaveLength(2)
      const [item1, item2] = result.current.state.items
      expect(item1.id).not.toBe(item2.id)
    })

    it('removeFromCart on a same-millisecond collision only removes the targeted item', () => {
      const { result } = renderHook(() => useCart(), { wrapper })

      act(() => {
        result.current.addToCart(baseProduct, 1, 'M')
        result.current.addToCart(baseProduct, 1, 'L')
      })
      const [item1, item2] = result.current.state.items

      act(() => {
        result.current.removeFromCart(item1.id)
      })

      expect(result.current.state.items).toHaveLength(1)
      expect(result.current.state.items[0].id).toBe(item2.id)
    })

    it('updateQuantity on a same-millisecond collision only updates the targeted item', () => {
      const { result } = renderHook(() => useCart(), { wrapper })

      act(() => {
        result.current.addToCart(baseProduct, 1, 'M')
        result.current.addToCart(baseProduct, 1, 'L')
      })
      const [item1, item2] = result.current.state.items

      act(() => {
        result.current.updateQuantity(item2.id, 5)
      })

      const updated1 = result.current.state.items.find(i => i.id === item1.id)
      const updated2 = result.current.state.items.find(i => i.id === item2.id)
      expect(updated1?.quantity).toBe(1)
      expect(updated2?.quantity).toBe(5)
    })

    it('also de-collides restoreFromOrder bulk adds within the same millisecond', () => {
      const { result } = renderHook(() => useCart(), { wrapper })

      act(() => {
        result.current.restoreFromOrder([
          { product: baseProduct, quantity: 1, selectedSize: 'M' },
          { product: baseProduct, quantity: 1, selectedSize: 'L' }
        ])
      })

      expect(result.current.state.items).toHaveLength(2)
      const [item1, item2] = result.current.state.items
      expect(item1.id).not.toBe(item2.id)
    })
  })

  describe('localStorage persistence (task 428a05df)', () => {
    it('strips base64 images, layer elements, and the canvas snapshot before writing to localStorage, but keeps them in memory', () => {
      const { result } = renderHook(() => useCart(), { wrapper })

      act(() => {
        result.current.addToCart(sheetProduct, 1, undefined, undefined, undefined, heavyDesignData)
      })

      // In-memory state is untouched — the current session still has
      // everything it needs to render/re-edit the sheet.
      const memoryItem = result.current.state.items[0]
      expect(memoryItem.designData?.mockupUrl.startsWith('data:')).toBe(true)
      expect(memoryItem.designData?.elements).toHaveLength(2)
      expect(memoryItem.product.images[0].startsWith('data:')).toBe(true)

      // The persisted copy is what actually reaches localStorage.
      const raw = window.localStorage.getItem('itp_cart_v1')
      expect(raw).toBeTruthy()
      const persisted = JSON.parse(raw as string)
      const persistedItem = persisted.items[0]

      expect(persistedItem.designData.mockupUrl).toBe('')
      expect(persistedItem.designData.elements).toEqual([])
      expect(persistedItem.designData.canvasSnapshot).toBeUndefined()
      expect(persistedItem.product.images).toEqual([])
      // Real GCS URLs are cheap strings and pass straight through.
      expect(persistedItem.designData.printReadyUrl).toBe(heavyDesignData!.printReadyUrl)

      // The whole point: the persisted payload stays small even though the
      // in-memory item carries ~1.5KB of embedded fake "base64".
      expect(JSON.stringify(persisted).length).toBeLessThan(1000)
    })

    it('still loads a pre-existing cart saved before this fix, with raw base64 data intact', () => {
      const legacyCart = {
        items: [{
          id: 'legacy-1',
          product: {
            id: 'p1', name: 'Old Sheet', description: '', price: 10,
            images: ['data:image/png;base64,LEGACYIMAGE'], category: 'dtf-transfers', inStock: true
          },
          quantity: 1,
          designData: {
            elements: [{ id: 'x' }],
            template: 'imagination-sheet',
            mockupUrl: 'data:image/png;base64,LEGACYMOCKUP',
            canvasSnapshot: '{"old":true}'
          }
        }]
      }
      window.localStorage.setItem('itp_cart_v1', JSON.stringify(legacyCart))

      const { result } = renderHook(() => useCart(), { wrapper })

      expect(result.current.state.items).toHaveLength(1)
      expect(result.current.state.items[0].id).toBe('legacy-1')
      expect(result.current.state.items[0].product.images[0]).toBe('data:image/png;base64,LEGACYIMAGE')
    })

    it('surfaces a QuotaExceededError instead of swallowing it', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      })

      // Mount alone triggers a persist attempt for the initial cart state;
      // it fails immediately and must be visible on the context, not just
      // logged to the console.
      const { result } = renderHook(() => useCart(), { wrapper })

      expect(result.current.persistError).toBeTruthy()
      expect(result.current.persistError).toMatch(/save|storage|design data/i)

      setItemSpy.mockRestore()
    })

    it('dismissPersistError clears it, and a later successful write clears it again on its own', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      })

      const { result } = renderHook(() => useCart(), { wrapper })
      expect(result.current.persistError).toBeTruthy()

      act(() => {
        result.current.dismissPersistError()
      })
      expect(result.current.persistError).toBeNull()

      // mockImplementationOnce only threw for the mount write — this one
      // goes through to the real jsdom localStorage and succeeds.
      act(() => {
        result.current.addToCart(baseProduct, 1, 'M')
      })
      expect(result.current.persistError).toBeNull()

      setItemSpy.mockRestore()
    })
  })
})
