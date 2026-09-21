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
