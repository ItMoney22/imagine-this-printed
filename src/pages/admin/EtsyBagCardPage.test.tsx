// @vitest-environment jsdom
// The Etsy bag card print page after decision d9a98efc (option A): the card
// carries an Etsy SHOP promo code and nothing that points an Etsy buyer off
// Etsy, and printing stays on hold until that code is saved.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'

// This project runs vitest without `globals`, so unmount by hand.
afterEach(cleanup)

const apiFetch = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: any[]) => apiFetch(...args) }))

const EtsyBagCardPage = (await import('./EtsyBagCardPage')).default

const NO_WEEKS = { weeks: [{ weekStart: '2026-10-05', redemptions: 0, sales: 0, discountGiven: 0, qrOrders: 0, unpaidCheckouts: 1 }] }

function serve(coupon: unknown) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/admin/coupons/etsy-bag/weekly')) return NO_WEEKS
    if (path === '/api/admin/coupons/etsy-bag/card' && !init?.method) return { coupon }
    if (path === '/api/admin/coupons/etsy-bag/card' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      return { coupon: { ...body, savedAt: '2026-10-07T20:00:00Z', savedBy: 'christina@example.com' } }
    }
    throw new Error(`unexpected ${path}`)
  })
}

const card = () => screen.getByRole('article')
const printButtons = () => [screen.getByRole('button', { name: /print on 4×6/i }), screen.getByRole('button', { name: /letter paper/i })]

function expectEtsySafe(el: HTMLElement) {
  const text = el.textContent || ''
  expect(text).not.toMatch(/imaginethisprinted\.com/i)
  expect(text).not.toMatch(/website|scan|ETSYBAG/i)
  expect(within(el).queryByRole('img', { name: /qr/i })).toBeNull()
  expect(el.querySelector('img[src*="qr"]')).toBeNull()
}

// Braces matter: a function returned from beforeEach runs as a cleanup hook.
beforeEach(() => {
  apiFetch.mockReset()
})

describe('EtsyBagCardPage', () => {
  it('holds printing until the Etsy shop code is saved, and the card is Etsy-safe', async () => {
    serve(null)
    render(<EtsyBagCardPage />)
    await screen.findByText(/not ready to print yet/i)
    expect(within(card()).getByText(/etsy code not set yet/i)).toBeTruthy()
    for (const b of printButtons()) expect((b as HTMLButtonElement).disabled).toBe(true)
    expectEtsySafe(card())
    // The website code is still shown for pickup/markets/social, outside the card.
    expect(screen.getByRole('heading', { name: /website code ETSYBAG/i })).toBeTruthy()
  })

  it('prints with the saved Etsy code', async () => {
    serve({ code: 'THANKYOU15', percentOff: 15, savedAt: '2026-10-07T20:00:00Z', savedBy: 'christina@example.com' })
    render(<EtsyBagCardPage />)
    await screen.findByText(/ready for etsy orders/i)
    expect(within(card()).getByText('THANKYOU15')).toBeTruthy()
    expect(within(card()).getByText(/15% off your next order in our Etsy shop/i)).toBeTruthy()
    for (const b of printButtons()) expect((b as HTMLButtonElement).disabled).toBe(false)
    expectEtsySafe(card())
  })

  it('shows what is typed on the card, and saves it', async () => {
    serve(null)
    render(<EtsyBagCardPage />)
    await screen.findByText(/not ready to print yet/i)
    fireEvent.change(screen.getByLabelText(/etsy promo code/i), { target: { value: 'comeback20' } })
    fireEvent.change(screen.getByLabelText(/% off/i), { target: { value: '20' } })
    expect(within(card()).getByText('COMEBACK20')).toBeTruthy()
    // Typed but not saved: still no printing.
    for (const b of printButtons()) expect((b as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /save code/i }))
    await screen.findByText(/ready for etsy orders/i)
    const put = apiFetch.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ code: 'COMEBACK20', percentOff: 20 })
    for (const b of printButtons()) expect((b as HTMLButtonElement).disabled).toBe(false)
  })

  it('will not put the website code on the card', async () => {
    serve(null)
    render(<EtsyBagCardPage />)
    await screen.findByText(/not ready to print yet/i)
    fireEvent.change(screen.getByLabelText(/etsy promo code/i), { target: { value: 'ETSYBAG' } })
    fireEvent.change(screen.getByLabelText(/% off/i), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: /save code/i }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/website code/i))
    expect(apiFetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    expectEtsySafe(card())
  })
})
