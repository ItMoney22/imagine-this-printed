// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const mockAuth = vi.fn()
vi.mock('../context/SupabaseAuthContext', () => ({
  useAuth: () => mockAuth(),
}))

const cart = {
  state: { items: [] as unknown[] },
  appliedCoupon: null as null | { code: string },
  applyCoupon: vi.fn(),
}
vi.mock('../context/CartContext', () => ({ useCart: () => cart }))

const addToast = vi.fn()
vi.mock('../context/ToastContext', () => ({ useToastContext: () => ({ addToast }) }))

const apiFetch = vi.fn()
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))

import ReferralApplier from './ReferralApplier'
import { PENDING_REFERRAL_KEY, WELCOME_OFFERED_KEY, captureReferralFromUrl } from '../utils/referral-capture'

const WELCOME = { code: 'WELCOME10-ABC234', percent: 10, expiresAt: '2026-11-06T21:00:00.000Z' }

beforeEach(() => {
  window.localStorage.clear()
  apiFetch.mockReset()
  addToast.mockReset()
  cart.state = { items: [] }
  cart.appliedCoupon = null
  cart.applyCoupon = vi.fn().mockResolvedValue({ success: true })
})

afterEach(() => cleanup())

const welcomeCalls = () => apiFetch.mock.calls.filter(([url]) => url === '/api/wallet/referral/welcome')

describe('ReferralApplier', () => {
  it('waits while signed out: the stored link stays put', () => {
    captureReferralFromUrl('?ref=REFAB12CD')
    mockAuth.mockReturnValue({ user: null })
    render(<ReferralApplier />)
    expect(apiFetch).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(PENDING_REFERRAL_KEY)).not.toBeNull()
  })

  it('posts the stored code once at sign-in, then forgets it', async () => {
    captureReferralFromUrl('?ref=REFAB12CD')
    apiFetch.mockResolvedValue({ ok: true })
    mockAuth.mockReturnValue({ user: { id: 'user-1' } })

    const { rerender } = render(<ReferralApplier />)
    await waitFor(() => expect(window.localStorage.getItem(PENDING_REFERRAL_KEY)).toBeNull())
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('/api/wallet/referral/apply', {
      method: 'POST',
      body: JSON.stringify({ code: 'REFAB12CD' }),
    })

    // A re-render, or the same account signing in again, sends nothing.
    rerender(<ReferralApplier />)
    mockAuth.mockReturnValue({ user: { id: 'user-1', role: 'customer' } })
    rerender(<ReferralApplier />)
    await Promise.resolve()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('sends nothing for a signed-in visitor with no link and an empty cart', async () => {
    mockAuth.mockReturnValue({ user: { id: 'user-2' } })
    render(<ReferralApplier />)
    await Promise.resolve()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  describe("the friend's welcome code (task 4cebbf83)", () => {
    it('puts it in a cart that has something in it, says so, and remembers it did', async () => {
      cart.state = { items: [{ id: 'line-1' }] }
      apiFetch.mockResolvedValue({ ok: true, welcome: WELCOME })
      mockAuth.mockReturnValue({ user: { id: 'friend-1' } })

      render(<ReferralApplier />)
      await waitFor(() => expect(cart.applyCoupon).toHaveBeenCalledWith('WELCOME10-ABC234', 'friend-1'))
      await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: '10% off your first order' })))
      expect(window.localStorage.getItem(WELCOME_OFFERED_KEY)).toBe('WELCOME10-ABC234')
    })

    it('does not overrule a customer who took it out (offered once per device)', async () => {
      window.localStorage.setItem(WELCOME_OFFERED_KEY, 'WELCOME10-ABC234')
      cart.state = { items: [{ id: 'line-1' }] }
      apiFetch.mockResolvedValue({ ok: true, welcome: WELCOME })
      mockAuth.mockReturnValue({ user: { id: 'friend-1' } })

      render(<ReferralApplier />)
      await waitFor(() => expect(welcomeCalls()).toHaveLength(1))
      await Promise.resolve()
      expect(cart.applyCoupon).not.toHaveBeenCalled()
    })

    it('leaves another code on the cart alone and does not even ask', async () => {
      cart.state = { items: [{ id: 'line-1' }] }
      cart.appliedCoupon = { code: 'ETSYBAG' }
      mockAuth.mockReturnValue({ user: { id: 'friend-1' } })

      render(<ReferralApplier />)
      await Promise.resolve()
      expect(welcomeCalls()).toHaveLength(0)
      expect(cart.applyCoupon).not.toHaveBeenCalled()
    })

    it('asks once per visit, and a code checkout refuses is not marked offered', async () => {
      cart.state = { items: [{ id: 'line-1' }] }
      cart.applyCoupon = vi.fn().mockResolvedValue({ success: false, error: 'This code is for a first order only' })
      apiFetch.mockResolvedValue({ ok: true, welcome: WELCOME })
      mockAuth.mockReturnValue({ user: { id: 'friend-1' } })

      const { rerender } = render(<ReferralApplier />)
      await waitFor(() => expect(cart.applyCoupon).toHaveBeenCalledTimes(1))
      cart.state = { items: [{ id: 'line-1' }, { id: 'line-2' }] }
      rerender(<ReferralApplier />)
      await Promise.resolve()
      expect(welcomeCalls()).toHaveLength(1)
      expect(addToast).not.toHaveBeenCalled()
      expect(window.localStorage.getItem(WELCOME_OFFERED_KEY)).toBeNull()
    })
  })
})
