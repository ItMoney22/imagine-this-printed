// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  AUTH_RETURN_KEY,
  GUEST_GATE_COPY,
  gateBannerFor,
  isGuestGateReason,
  rememberReturnPath,
  signInReasonFor,
} from './guest-gate'

describe('guest gate copy', () => {
  it('every reason names what the account unlocks and why', () => {
    for (const [reason, copy] of Object.entries(GUEST_GATE_COPY)) {
      expect(copy.title, reason).toMatch(/free account/i)
      expect(copy.why.length, reason).toBeGreaterThan(20)
    }
  })

  it('never names the engine behind the tools', () => {
    const all = JSON.stringify(GUEST_GATE_COPY)
    expect(all).not.toMatch(/gpt|openai|flare|flux|grok|claude|gemini/i)
  })

  it('recognises only real reasons', () => {
    expect(isGuestGateReason('toy-mix')).toBe(true)
    expect(isGuestGateReason('toString')).toBe(false)
    expect(isGuestGateReason(undefined)).toBe(false)
  })
})

describe('signInReasonFor', () => {
  it('names the private page a visitor was headed to', () => {
    expect(signInReasonFor('/account/orders')).toMatch(/your orders/)
    expect(signInReasonFor('/account/profile/edit')).toMatch(/your account/)
    expect(signInReasonFor('/creator/studio')).toMatch(/your creator studio/)
    expect(signInReasonFor('/wallet')).toMatch(/your wallet/)
  })

  it('does not match a look-alike prefix or a public page', () => {
    expect(signInReasonFor('/accounting')).toBeNull()
    expect(signInReasonFor('/')).toBeNull()
    expect(signInReasonFor(null)).toBeNull()
  })
})

describe('gateBannerFor', () => {
  it('uses the reason the gate sent', () => {
    expect(gateBannerFor({ reason: 'wholesale-apply', from: { pathname: '/wholesale' } })).toEqual(
      GUEST_GATE_COPY['wholesale-apply'],
    )
  })

  it('explains a plain private-page redirect', () => {
    const banner = gateBannerFor({ from: { pathname: '/account/orders' } })
    expect(banner?.why).toMatch(/your orders/)
  })

  it('shows nothing for a direct visit', () => {
    expect(gateBannerFor(null)).toBeNull()
    expect(gateBannerFor({ from: { pathname: '/catalog' } })).toBeNull()
    expect(gateBannerFor('nonsense')).toBeNull()
  })
})

describe('rememberReturnPath', () => {
  beforeEach(() => localStorage.clear())

  it('stores the page AuthCallback sends the visitor back to', () => {
    rememberReturnPath('/toy-creator')
    expect(localStorage.getItem(AUTH_RETURN_KEY)).toBe('/toy-creator')
  })
})
