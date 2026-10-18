// @vitest-environment jsdom
// The QR counter stand's order page (task deebfdca): $25 struck to $17.95, the
// link rule in David's words, and what goes into the cart line.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const addToCart = vi.fn()
const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../context/CartContext', () => ({ useCart: () => ({ addToCart }) }))
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('../lib/api', () => ({ API_BASE: '', apiFetch: vi.fn() }))

const { default: QrStandOrder } = await import('./QrStandOrder')

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

const renderAt = (url = '/business/qr-stand') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <QrStandOrder />
    </MemoryRouter>
  )

const linkBox = () => screen.getByLabelText('Where should the code point?') as HTMLInputElement

describe('QR stand order page', () => {
  it('shows $25.00 struck through and $17.95 on sale', () => {
    renderAt()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Custom QR Counter Stand')
    const was = screen.getByLabelText('Was $25.00')
    expect(was.className).toMatch(/line-through/)
    expect(screen.getByText('$17.95')).toBeTruthy()
    expect(screen.getByText('Sale')).toBeTruthy()
  })

  it('refuses a link over 58 characters with "use a shorter link" and keeps it out of the cart', () => {
    renderAt()
    fireEvent.change(linkBox(), { target: { value: 'https://example.com/' + 'a'.repeat(39) } })
    expect(screen.getByRole('alert').textContent).toBe('use a shorter link')
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/ }))
    expect(addToCart).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('Almost there', 'use a shorter link')
  })

  it('puts the stand in the cart with what the customer typed', () => {
    renderAt()
    fireEvent.change(linkBox(), { target: { value: 'bellascafe.com/menu' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Scan For Menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'One more' }))
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/ }))
    expect(addToCart).toHaveBeenCalledTimes(1)
    const [product, qty, , , , , , , , , personalization] = addToCart.mock.calls[0]
    expect(product.id).toBe('qr-stand')
    expect(product.price).toBe(17.95)
    expect(qty).toBe(2)
    expect(personalization).toEqual({ qr_link: 'https://bellascafe.com/menu', qr_caption: 'Scan For Menu' })
  })

  it('carries a reseller site\'s ref on the line without showing it', () => {
    renderAt('/business/qr-stand?via=abc.def')
    fireEvent.change(linkBox(), { target: { value: 'x.co/a' } })
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/ }))
    expect(addToCart.mock.calls[0][10].qr_ref).toBe('abc.def')
    expect(document.body.textContent).not.toMatch(/abc\.def|10%|earn/i)
  })

  it('takes custom words, and no customer screen names a printer, a machine or a cost', () => {
    renderAt()
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('Your words under the code'), { target: { value: 'Tip Jar' } })
    fireEvent.change(linkBox(), { target: { value: 'x.co/tips' } })
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/ }))
    expect(addToCart.mock.calls[0][10].qr_caption).toBe('Tip Jar')
    expect(document.body.textContent).not.toMatch(/bambu|A1\b|printer|filament|grams|profit|cost|AI\b|GPT|Flux/i)
  })
})
