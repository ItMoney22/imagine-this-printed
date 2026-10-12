// ---------------------------------------------------------------------------
// Referral link capture.
//
// A friend's link is https://imaginethisprinted.com/<any page>?ref=CODE. The
// code only exists on the FIRST url of the visit, so main.tsx stores it before
// React mounts, the same way utm.ts keeps campaign tags. It waits on this
// device (localStorage, not a cookie) until the visitor's account signs in,
// then ReferralApplier sends it to the API exactly once and it is cleared.
//
// Model: the LATEST friend's link wins, kept for REFERRAL_LINK_DAYS. The API
// decides whether the account may join through it (new accounts only, never
// your own code, one link per account); every final answer clears the stored
// code so it can never be applied twice.
// ---------------------------------------------------------------------------

import { apiFetch } from '../lib/api'

export const PENDING_REFERRAL_KEY = 'itp_pending_referral'
export const REFERRAL_LINK_DAYS = 30
// The site banner's choice (src/components/CookieConsent.tsx). 'declined' means
// do not keep referral links on this device.
export const COOKIE_CONSENT_KEY = 'itp_cookie_consent'
// Keys the old, never-called storeReferralCode() would have written.
const LEGACY_KEYS = ['pending_referral', 'referral_timestamp']

export interface PendingReferral {
  code: string
  landed_at: string
}

/** Pure: a referral code as the API stores it (upper case), or null when it can't be one. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = String(raw ?? '').trim().toUpperCase()
  return /^[A-Z0-9]{4,20}$/.test(code) ? code : null
}

/** Pure: the ?ref= code in a query string, or null. */
export function parseReferralParam(search: string): string | null {
  return normalizeReferralCode(new URLSearchParams(search || '').get('ref'))
}

/** Pure: has this stored link aged out? */
export function isReferralExpired(record: PendingReferral, now: number = Date.now()): boolean {
  const landed = Date.parse(record.landed_at)
  if (Number.isNaN(landed)) return true
  return now - landed > REFERRAL_LINK_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Store the ?ref= code from this url, if it carries one. Called once from
 * main.tsx before React mounts. A visit without ?ref leaves a stored link alone.
 */
export function captureReferralFromUrl(search: string = typeof window !== 'undefined' ? window.location.search : ''): PendingReferral | null {
  const code = parseReferralParam(search)
  if (!code) return getPendingReferral()
  const record: PendingReferral = { code, landed_at: new Date().toISOString() }
  try {
    if (window.localStorage.getItem(COOKIE_CONSENT_KEY) === 'declined') return null
    window.localStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(record))
  } catch {
    // Private mode / storage full: the referral is best-effort, never fatal.
  }
  return record
}

/** The stored link, or null when absent, expired (cleared) or corrupt (cleared). */
export function getPendingReferral(now: number = Date.now()): PendingReferral | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PENDING_REFERRAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingReferral
    const code = normalizeReferralCode(parsed?.code)
    if (!code || !parsed.landed_at || isReferralExpired(parsed, now)) {
      clearPendingReferral()
      return null
    }
    return { code, landed_at: parsed.landed_at }
  } catch {
    clearPendingReferral()
    return null
  }
}

export function clearPendingReferral(): void {
  try {
    window.localStorage.removeItem(PENDING_REFERRAL_KEY)
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export type ReferralApplyOutcome =
  | 'none'     // nothing stored
  | 'applied'  // recorded now
  | 'already'  // this account already carries this link: no-op
  | 'refused'  // final no (own code, not a new account, bad code...): cleared
  | 'retry'    // network / server trouble: kept for the next sign-in

/** Pure: the HTTP status inside apiFetch's "HTTP 409: ..." error, or null. */
export function httpStatusOf(err: unknown): number | null {
  const match = /^HTTP (\d{3})\b/.exec(err instanceof Error ? err.message : String(err ?? ''))
  return match ? Number(match[1]) : null
}

export type ReferralPost = (code: string) => Promise<{ ok?: boolean; already?: boolean }>

const postApply: ReferralPost = (code) =>
  apiFetch('/api/wallet/referral/apply', { method: 'POST', body: JSON.stringify({ code }) })

let inFlight: Promise<ReferralApplyOutcome> | null = null

/**
 * Send the stored link to the API for the signed-in account, once. Concurrent
 * calls (StrictMode effects, several auth events) share one request.
 */
export function applyPendingReferral(post: ReferralPost = postApply): Promise<ReferralApplyOutcome> {
  if (inFlight) return inFlight
  inFlight = (async (): Promise<ReferralApplyOutcome> => {
    const pending = getPendingReferral()
    if (!pending) return 'none'
    try {
      const result = await post(pending.code)
      clearPendingReferral()
      return result?.already ? 'already' : 'applied'
    } catch (err) {
      const status = httpStatusOf(err)
      // 401: the session isn't ready yet. 408/429/5xx/network: try again later.
      if (status !== null && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
        clearPendingReferral()
        return 'refused'
      }
      return 'retry'
    }
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}
