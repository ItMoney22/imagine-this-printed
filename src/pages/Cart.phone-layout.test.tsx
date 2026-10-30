// @vitest-environment jsdom
// A cart line on a phone (task 1434d8c5). The pre-redo cart drew each line as ONE row
// (picture, words, quantity, total + Remove); at 390 px that row ran past the screen, so
// the "+" was clipped and the line total and Remove sat off to the right on every product.
// The redone cart (task b9656cc9) keeps everything a shopper acts on (the total, - / +,
// Remove) inside the words column, the one part of the row allowed to shrink (min-w-0),
// with only the picture at a fixed width beside it. jsdom has no layout, so this checks
// that structure: a merge that brings back the one-row line fails here (the name-gift
// branch 3f76ee3 was cut from main before the redo and still carries it).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const items = [
  {
    id: 'ornament-1',
    product: { id: 'e91d3fe4-ccea-4f25-bb9e-48607283f932', name: 'Personalized Name Ornament', description: 'A Christmas ornament with the name you choose raised across the front in white script.', price: 16.99, images: ['/products/ornament.webp'], category: '3d-prints', inStock: true },
    quantity: 2,
    personalization: { name: 'Grandma Rose' },
  },
  {
    id: 'tee-1',
    product: { id: 'tee', name: 'Wizard Beast Heavyweight Tee', description: 'A heavyweight tee.', price: 24.99, images: ['/products/tee.webp'], category: 'shirts', inStock: true },
    quantity: 1,
    selectedSize: 'XL',
    selectedColor: 'black',
    printLocation: 'front',
  },
]
vi.mock('../context/CartContext', () => ({
  useCart: () => ({ state: { items, total: 58.97 }, removeFromCart: vi.fn(), updateQuantity: vi.fn() }),
}))
vi.mock('../components/product/YouMayAlsoLike', () => ({ YouMayAlsoLike: () => null }))

const { default: Cart } = await import('./Cart')
afterEach(cleanup)

describe('cart line on a phone', () => {
  it('keeps the total, the quantity buttons and Remove inside the column that can shrink', () => {
    render(<MemoryRouter><Cart /></MemoryRouter>)
    const removes = screen.getAllByRole('button', { name: 'Remove' })
    expect(removes).toHaveLength(items.length)

    for (const [i, remove] of removes.entries()) {
      const item = items[i]
      const column = remove.closest('.min-w-0')
      expect(column, `${item.product.name}: Remove is not inside a column that can shrink`).toBeTruthy()

      const row = column!.parentElement!
      // Beside the column there is only the picture, at its fixed size. Any other
      // sibling (a quantity box, a price block) is width the phone does not have.
      for (const child of Array.from(row.children)) {
        if (child === column) continue
        expect(child.classList.contains('shrink-0'), `${item.product.name}: extra fixed-width box beside the words`).toBe(true)
        expect(child.querySelector('img')).toBeTruthy()
      }

      expect(column!.contains(screen.getByRole('button', { name: `One fewer ${item.product.name}` }))).toBe(true)
      expect(column!.contains(screen.getByRole('button', { name: `One more ${item.product.name}` }))).toBe(true)
      expect(column!.textContent).toMatch(/\$\d+\.\d{2}/)
    }
  })
})
