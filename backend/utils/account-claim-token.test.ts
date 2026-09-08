import { describe, it, expect, vi, afterEach } from 'vitest'

// The token secret is read at module load, so it has to exist before the module
// under test is evaluated — same dynamic-import pattern as coupons.test.ts.
process.env.ACCOUNT_CLAIM_TOKEN_SECRET ||= 'test-claim-secret'
process.env.FRONTEND_URL ||= 'https://imaginethisprinted.com'

const {
  createAccountClaimToken,
  verifyAccountClaimToken,
  buildAccountClaimUrl,
  CLAIM_TTL_DAYS
} = await import('./account-claim-token.js')

const ORDER = 'a1b2c3d4-0000-4000-8000-000000000001'
const OTHER_ORDER = 'a1b2c3d4-0000-4000-8000-000000000002'

afterEach(() => {
  vi.useRealTimers()
})

describe('account claim token', () => {
  it('accepts a token it just issued', () => {
    expect(verifyAccountClaimToken(ORDER, createAccountClaimToken(ORDER))).toEqual({ valid: true })
  })

  it('rejects a token issued for a different order', () => {
    // The whole point: a buyer forwarding their email must not be able to claim
    // somebody else's order.
    const token = createAccountClaimToken(OTHER_ORDER)
    expect(verifyAccountClaimToken(ORDER, token)).toEqual({ valid: false, reason: 'bad-signature' })
  })

  it('rejects a tampered signature', () => {
    const token = createAccountClaimToken(ORDER)
    const [expiry, sig] = token.split('.')
    const flipped = sig[0] === 'a' ? 'b' : 'a'
    expect(verifyAccountClaimToken(ORDER, `${expiry}.${flipped}${sig.slice(1)}`))
      .toEqual({ valid: false, reason: 'bad-signature' })
  })

  it('rejects an expiry extended by hand', () => {
    // The expiry travels in the clear, so this is the attack that matters: push
    // the timestamp out and see if the old signature still passes.
    const token = createAccountClaimToken(ORDER)
    const [expiry, sig] = token.split('.')
    const extended = Number(expiry) + 365 * 24 * 60 * 60
    expect(verifyAccountClaimToken(ORDER, `${extended}.${sig}`))
      .toEqual({ valid: false, reason: 'bad-signature' })
  })

  it('rejects a token past its expiry', () => {
    const token = createAccountClaimToken(ORDER)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + (CLAIM_TTL_DAYS + 1) * 24 * 60 * 60 * 1000)
    expect(verifyAccountClaimToken(ORDER, token)).toEqual({ valid: false, reason: 'expired' })
  })

  it('still accepts a token one day before it expires', () => {
    const token = createAccountClaimToken(ORDER)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + (CLAIM_TTL_DAYS - 1) * 24 * 60 * 60 * 1000)
    expect(verifyAccountClaimToken(ORDER, token)).toEqual({ valid: true })
  })

  it.each([
    ['missing token', undefined, 'missing'],
    ['empty token', '', 'missing'],
    ['no separator', 'garbage', 'malformed'],
    ['non-numeric expiry', 'notanumber.abcdef', 'malformed']
  ])('rejects %s', (_label, token, reason) => {
    expect(verifyAccountClaimToken(ORDER, token as any)).toEqual({ valid: false, reason })
  })

  it('rejects a missing order id even with a real token', () => {
    expect(verifyAccountClaimToken('', createAccountClaimToken(ORDER)))
      .toEqual({ valid: false, reason: 'missing' })
  })

  it('builds a claim URL that verifies against its own order', () => {
    const url = buildAccountClaimUrl(ORDER)!
    expect(url).toContain(`/claim-account/${ORDER}`)
    const token = new URL(url).searchParams.get('t')
    expect(verifyAccountClaimToken(ORDER, token)).toEqual({ valid: true })
  })

  it('returns no URL without an order id', () => {
    expect(buildAccountClaimUrl(null)).toBeNull()
    expect(buildAccountClaimUrl(undefined)).toBeNull()
  })
})
