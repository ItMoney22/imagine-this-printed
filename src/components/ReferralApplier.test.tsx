// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const mockAuth = vi.fn()
vi.mock('../context/SupabaseAuthContext', () => ({
  useAuth: () => mockAuth(),
}))

const apiFetch = vi.fn()
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))

import ReferralApplier from './ReferralApplier'
import { PENDING_REFERRAL_KEY, captureReferralFromUrl } from '../utils/referral-capture'

beforeEach(() => {
  window.localStorage.clear()
  apiFetch.mockReset()
})

afterEach(() => cleanup())

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

  it('sends nothing for a signed-in visitor with no link', async () => {
    mockAuth.mockReturnValue({ user: { id: 'user-2' } })
    render(<ReferralApplier />)
    await Promise.resolve()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
