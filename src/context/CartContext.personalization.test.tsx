// @vitest-environment jsdom
//
// The cart merge key and personalized team shirts.
//
// ADD_TO_CART merges a new line into an existing one when product, design,
// size, colour, payment method, print location, tier and add-ons all match.
// Personalization was not in that list, so a coach adding SMITH 22 in YL and
// then LOPEZ 41 in YL got ONE line at quantity 2 — and two kids received the
// same shirt. Nothing about that is visible before the order ships: the cart
// shows a plausible "Spartans Tee x2".
import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { CartProvider, useCart } from './CartContext'
import type { Product } from '../types'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CartProvider>{children}</CartProvider>
)

const teamShirt: Product = {
  id: 'spartans-tee',
  name: 'Spartans Team Tee',
  description: 'Two-sided team shirt',
  price: 28,
  images: ['https://cdn.example.com/spartans.png'],
  category: 'shirts',
  inStock: true,
}

const plainShirt: Product = { ...teamShirt, id: 'plain-tee', name: 'Plain Tee' }

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

describe('cart merging with personalization', () => {
  it('keeps two players in the same size as two separate lines', () => {
    const { result } = renderHook(() => useCart(), { wrapper })

    act(() => {
      result.current.addToCart(teamShirt, 1, 'YL', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '22',
      })
    })
    act(() => {
      result.current.addToCart(teamShirt, 1, 'YL', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'LOPEZ',
        number: '41',
      })
    })

    expect(result.current.state.items).toHaveLength(2)
    expect(result.current.state.items.every((i) => i.quantity === 1)).toBe(true)
    expect(result.current.state.items.map((i) => i.personalization?.name).sort()).toEqual(['LOPEZ', 'SMITH'])
  })

  it('separates two players who differ only by number', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => {
      result.current.addToCart(teamShirt, 1, 'AM', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '22',
      })
    })
    act(() => {
      result.current.addToCart(teamShirt, 1, 'AM', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '23',
      })
    })
    expect(result.current.state.items).toHaveLength(2)
  })

  it('still merges a genuine repeat of the SAME player', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    const add = () =>
      result.current.addToCart(teamShirt, 1, 'YL', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '22',
      })
    act(() => { add() })
    act(() => { add() })

    expect(result.current.state.items).toHaveLength(1)
    expect(result.current.state.items[0].quantity).toBe(2)
  })

  it('does not care about key order in the personalization object', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => {
      result.current.addToCart(teamShirt, 1, 'YL', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '22',
      })
    })
    act(() => {
      result.current.addToCart(teamShirt, 1, 'YL', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        number: '22',
        name: 'SMITH',
      })
    })
    expect(result.current.state.items).toHaveLength(1)
    expect(result.current.state.items[0].quantity).toBe(2)
  })

  it('still separates the same player in two different sizes', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => {
      result.current.addToCart(teamShirt, 1, 'YL', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '22',
      })
    })
    act(() => {
      result.current.addToCart(teamShirt, 1, 'AM', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '22',
      })
    })
    expect(result.current.state.items).toHaveLength(2)
  })

  it('leaves ordinary products merging exactly as before', () => {
    // Regression guard: nothing about a non-personalized shirt should change.
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => { result.current.addToCart(plainShirt, 1, 'L', 'Black') })
    act(() => { result.current.addToCart(plainShirt, 2, 'L', 'Black') })
    expect(result.current.state.items).toHaveLength(1)
    expect(result.current.state.items[0].quantity).toBe(3)
  })

  it('stores the personalization on the line so checkout can read it', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => {
      result.current.addToCart(teamShirt, 1, 'YL', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '22',
      })
    })
    expect(result.current.state.items[0].personalization).toEqual({ name: 'SMITH', number: '22' })
  })
})

// ---------------------------------------------------------------------------
// The personalization upcharge, client side.
//
// products.metadata.team_template.upcharge is shown to the customer next to
// the name box, and until 2026-09-22 NOTHING charged it — not this cart, not
// the checkout page, not the server pricing engine. All three read it now, and
// they have to agree: backend/routes/stripe.ts refuses a client total that
// differs from the server's by more than a cent.
// ---------------------------------------------------------------------------
const TEAM_TEMPLATE = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 5,
  fields: [
    {
      key: 'name', label: 'Last name', type: 'text', max: 12, placeholder: 'SMITH', uppercase: true,
      zone: { x: 220, y: 380, w: 3160, h: 900 }, arch: 18,
      font: { family: 'collegiate-slab', src: 'house' }, fill: '#8C1D2D', strokes: [], offset: null
    },
    {
      key: 'number', label: 'Number', type: 'number', max: 2, placeholder: '22', uppercase: false,
      zone: { x: 900, y: 1500, w: 1800, h: 2400 }, arch: 0,
      font: { family: 'varsity-block', src: 'house' }, fill: '#C9A227', strokes: [], offset: null
    }
  ]
}

const paidTeamShirt: Product = {
  ...teamShirt,
  id: 'spartans-tee-paid',
  metadata: { team_template: TEAM_TEMPLATE },
} as Product

describe('personalization upcharge', () => {
  it('adds the template upcharge to the cart total, per unit', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => {
      result.current.addToCart(paidTeamShirt, 2, 'L', 'White', undefined, undefined, undefined, undefined, undefined, undefined, {
        name: 'SMITH',
        number: '22',
      })
    })
    // 2 × ($28 shirt + $5 personalization)
    expect(result.current.state.total).toBeCloseTo(66, 2)
  })

  it('charges nothing extra for a shirt whose template has no upcharge', () => {
    const free = { ...paidTeamShirt, id: 'free-team', metadata: { team_template: { ...TEAM_TEMPLATE, upcharge: 0 } } } as Product
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => {
      result.current.addToCart(free, 1, 'L', 'White', undefined, undefined, undefined, undefined, undefined, undefined, { name: 'SMITH', number: '22' })
    })
    expect(result.current.state.total).toBeCloseTo(28, 2)
  })

  it('keeps a personalized shirt out of the 2-for-$25 bundle', () => {
    const bundleable = {
      ...paidTeamShirt,
      id: 'bundle-team',
      isThreeForTwentyFive: true,
      metadata: { isThreeForTwentyFive: true, team_template: { ...TEAM_TEMPLATE, upcharge: 0 } },
    } as Product
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => {
      result.current.addToCart(bundleable, 2, 'L', 'White', undefined, undefined, undefined, undefined, undefined, undefined, { name: 'SMITH', number: '22' })
    })
    // Full price twice, not $25 for the pair.
    expect(result.current.state.total).toBeCloseTo(56, 2)
  })
})
