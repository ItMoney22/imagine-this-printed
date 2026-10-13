// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))

import {
  PENDING_REFERRAL_KEY,
  REFERRAL_LINK_DAYS,
  normalizeReferralCode,
  parseReferralParam,
  captureReferralFromUrl,
  getPendingReferral,
  clearPendingReferral,
  applyPendingReferral,
  httpStatusOf,
} from './referral-capture'

const DAY = 24 * 60 * 60 * 1000
const stored = () => window.localStorage.getItem(PENDING_REFERRAL_KEY)

beforeEach(() => {
  window.localStorage.clear()
})

describe('normalizeReferralCode / parseReferralParam', () => {
  it('upper-cases and trims a code', () => {
    expect(normalizeReferralCode('  refab12cd ')).toBe('REFAB12CD')
  })

  it('refuses anything that cannot be a code', () => {
    expect(normalizeReferralCode('')).toBeNull()
    expect(normalizeReferralCode('ab')).toBeNull()
    expect(normalizeReferralCode('<script>')).toBeNull()
    expect(normalizeReferralCode('REF 123')).toBeNull()
    expect(normalizeReferralCode(null)).toBeNull()
  })

  it('reads ?ref= among other params on any page', () => {
    expect(parseReferralParam('?ref=refab12cd&utm_source=referral&utm_medium=link')).toBe('REFAB12CD')
    expect(parseReferralParam('?utm_source=tiktok')).toBeNull()
  })
})

describe('captureReferralFromUrl', () => {
  it('stores the code from the landing url', () => {
    const record = captureReferralFromUrl('?ref=REFAB12CD')
    expect(record?.code).toBe('REFAB12CD')
    expect(JSON.parse(stored()!).code).toBe('REFAB12CD')
  })

  it('a later visit without ?ref keeps the stored link', () => {
    captureReferralFromUrl('?ref=REFAB12CD')
    expect(captureReferralFromUrl('')?.code).toBe('REFAB12CD')
    expect(JSON.parse(stored()!).code).toBe('REFAB12CD')
  })

  it("the latest friend's link wins", () => {
    captureReferralFromUrl('?ref=REFAAAAAA')
    captureReferralFromUrl('?ref=REFBBBBBB')
    expect(getPendingReferral()?.code).toBe('REFBBBBBB')
  })

  it('keeps nothing for a visitor who declined the banner', () => {
    window.localStorage.setItem('itp_cookie_consent', 'declined')
    expect(captureReferralFromUrl('?ref=REFAB12CD')).toBeNull()
    expect(stored()).toBeNull()
  })

  it('ignores a junk ?ref and keeps the good one', () => {
    captureReferralFromUrl('?ref=REFAB12CD')
    captureReferralFromUrl('?ref=%3Cx%3E')
    expect(getPendingReferral()?.code).toBe('REFAB12CD')
  })
})

describe('getPendingReferral', () => {
  it(`forgets a link older than ${REFERRAL_LINK_DAYS} days`, () => {
    window.localStorage.setItem(
      PENDING_REFERRAL_KEY,
      JSON.stringify({ code: 'REFAB12CD', landed_at: new Date(Date.now() - (REFERRAL_LINK_DAYS + 1) * DAY).toISOString() })
    )
    expect(getPendingReferral()).toBeNull()
    expect(stored()).toBeNull()
  })

  it('clears a corrupt record', () => {
    window.localStorage.setItem(PENDING_REFERRAL_KEY, '{not json')
    expect(getPendingReferral()).toBeNull()
    expect(stored()).toBeNull()
  })

  it('clearPendingReferral also drops the legacy keys', () => {
    window.localStorage.setItem('pending_referral', 'OLD')
    window.localStorage.setItem('referral_timestamp', '1')
    captureReferralFromUrl('?ref=REFAB12CD')
    clearPendingReferral()
    expect(stored()).toBeNull()
    expect(window.localStorage.getItem('pending_referral')).toBeNull()
  })
})

describe('httpStatusOf', () => {
  it("reads apiFetch's 'HTTP 409: ...' errors", () => {
    expect(httpStatusOf(new Error('HTTP 409: {"reason":"own_code"}'))).toBe(409)
    expect(httpStatusOf(new Error('Failed to fetch'))).toBeNull()
  })
})

describe('applyPendingReferral', () => {
  it('does nothing when no link is stored', async () => {
    const post = vi.fn()
    expect(await applyPendingReferral(post)).toBe('none')
    expect(post).not.toHaveBeenCalled()
  })

  it('applies once, clears, and a second call is a no-op', async () => {
    captureReferralFromUrl('?ref=REFAB12CD')
    const post = vi.fn().mockResolvedValue({ ok: true })
    expect(await applyPendingReferral(post)).toBe('applied')
    expect(post).toHaveBeenCalledWith('REFAB12CD')
    expect(stored()).toBeNull()

    expect(await applyPendingReferral(post)).toBe('none')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('concurrent calls share one request', async () => {
    captureReferralFromUrl('?ref=REFAB12CD')
    const post = vi.fn().mockResolvedValue({ ok: true })
    const [a, b] = await Promise.all([applyPendingReferral(post), applyPendingReferral(post)])
    expect(post).toHaveBeenCalledTimes(1)
    expect([a, b]).toEqual(['applied', 'applied'])
  })

  it('reports an already-recorded link as a no-op and clears it', async () => {
    captureReferralFromUrl('?ref=REFAB12CD')
    expect(await applyPendingReferral(vi.fn().mockResolvedValue({ ok: true, already: true }))).toBe('already')
    expect(stored()).toBeNull()
  })

  it.each([400, 404, 409])('a final refusal (%i) clears the link so it is never retried', async (status) => {
    captureReferralFromUrl('?ref=REFAB12CD')
    const post = vi.fn().mockRejectedValue(new Error(`HTTP ${status}: no`))
    expect(await applyPendingReferral(post)).toBe('refused')
    expect(stored()).toBeNull()
  })

  it.each([
    ['401 (session not ready)', new Error('HTTP 401: Unauthorized')],
    ['429', new Error('HTTP 429: slow down')],
    ['500', new Error('HTTP 500: boom')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('keeps the link for the next sign-in on %s', async (_label, err) => {
    captureReferralFromUrl('?ref=REFAB12CD')
    expect(await applyPendingReferral(vi.fn().mockRejectedValue(err))).toBe('retry')
    expect(getPendingReferral()?.code).toBe('REFAB12CD')
  })
})
