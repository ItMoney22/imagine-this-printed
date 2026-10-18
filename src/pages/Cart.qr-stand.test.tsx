// @vitest-environment jsdom
// The cart line for a QR counter stand (task deebfdca) says what the stand will
// say, in plain words, and never the order's private fields (a reseller site's
// ref, the logo's storage path or signed link).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const item = {
  id: 'qr-stand-1',
  product: { id: 'qr-stand', name: 'Custom QR Counter Stand', description: '', price: 17.95, images: ['/business/qr-stand-cafe.webp'], category: '3d-prints', inStock: true, metadata: { product_kind: 'qr-stand' } },
  quantity: 2,
  personalization: {
    qr_link: 'https://bellascafe.com/menu',
    qr_caption: 'Scan For Menu',
    qr_logo_path: 'qr-stand-logos/0f8fad5b-d9cb-469f-a165-70867728950e.png',
    qr_logo_url: 'https://storage.googleapis.com/bucket/qr-stand-logos/x.png?X-Goog-Signature=abc',
    qr_ref: 'eyJzIjoiZGFycmVsbCJ9.c2lnbmF0dXJl',
  },
}
vi.mock('../context/CartContext', () => ({
  useCart: () => ({ state: { items: [item], total: 35.9 }, removeFromCart: vi.fn(), updateQuantity: vi.fn() }),
}))
vi.mock('../components/product/YouMayAlsoLike', () => ({ YouMayAlsoLike: () => null }))

const { default: Cart } = await import('./Cart')
afterEach(cleanup)

describe('cart: QR counter stand line', () => {
  it('shows the link, the words and the logo in plain words, and links back to the stand page', () => {
    render(<MemoryRouter><Cart /></MemoryRouter>)
    expect(screen.getByText('Opens https://bellascafe.com/menu')).toBeTruthy()
    expect(screen.getByText('Scan For Menu')).toBeTruthy()
    expect(screen.getByText('Your logo in the middle')).toBeTruthy()
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toContain('/business/qr-stand')
    expect(links.some((h) => h === '/product/qr-stand')).toBe(false)
  })

  it('keeps the reseller ref and storage links off the screen', () => {
    render(<MemoryRouter><Cart /></MemoryRouter>)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/qr_ref|qr_logo|eyJzIjoi|X-Goog-Signature|qr-stand-logos/)
  })
})
