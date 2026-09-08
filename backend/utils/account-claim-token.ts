// ============================================================================
// Tokenized post-purchase account claim
//
// Guest checkout is the right default — nobody should have to make an account
// to buy a candle holder — but it leaves every buyer unreachable the moment the
// order is done. They get their transactional mail (that keys off
// orders.customer_email, not off a user row) and then they are gone.
//
// This is the opt-in bridge: the order confirmation carries a signed link that
// turns THAT buyer, and only that buyer, into an account holder in one click.
// Nothing is created until they click it, so we never manufacture logins for
// people who did not ask — which is exactly the mistake that flooded this
// platform with 290 unsolicited accounts in August.
//
// Design mirrors order-status-token.ts (stateless HMAC, no migration, secret
// resolved from values already in the backend environment) with two deliberate
// differences:
//
//   1. The token binds an EXPIRY. A read-only status view can live forever;
//      a link that creates an account should not sit in an inbox indefinitely.
//   2. The token does NOT carry the email. The email is read from the order row
//      server-side, so a tampered link cannot claim an account under an address
//      the buyer does not own.
// ============================================================================

import crypto from 'crypto'

const TOKEN_SECRET =
  process.env.ACCOUNT_CLAIM_TOKEN_SECRET ||
  process.env.ORDER_STATUS_TOKEN_SECRET ||
  process.env.JWT_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.STRIPE_SECRET_KEY ||
  'itp-account-claim-dev-secret'

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

/** How long a claim link stays good. Long enough to survive an unread inbox. */
export const CLAIM_TTL_DAYS = 30

function sign(orderId: string, expiresAt: number): string {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`account-claim:${orderId}:${expiresAt}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Token shape: `<expiryEpochSeconds>.<hmac>`. The expiry travels in the clear
 * because it is covered by the signature — a buyer cannot extend their own link
 * without also forging the HMAC.
 */
export function createAccountClaimToken(orderId: string, ttlDays = CLAIM_TTL_DAYS): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60
  return `${expiresAt}.${sign(orderId, expiresAt)}`
}

export type ClaimTokenResult =
  | { valid: true }
  | { valid: false; reason: 'missing' | 'malformed' | 'expired' | 'bad-signature' }

/** Constant-time comparison so the signature can't be brute-forced by timing. */
export function verifyAccountClaimToken(orderId: string, token?: string | null): ClaimTokenResult {
  if (!orderId || !token) return { valid: false, reason: 'missing' }

  const [rawExpiry, signature] = String(token).split('.')
  const expiresAt = Number(rawExpiry)
  if (!rawExpiry || !signature || !Number.isFinite(expiresAt)) {
    return { valid: false, reason: 'malformed' }
  }

  // Signature is checked BEFORE the clock so a forged token always reads as a
  // bad signature rather than leaking whether some expiry would have worked.
  const expected = Buffer.from(sign(orderId, expiresAt))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { valid: false, reason: 'bad-signature' }
  }

  if (expiresAt * 1000 < Date.now()) return { valid: false, reason: 'expired' }

  return { valid: true }
}

/**
 * Public claim URL for a buyer.
 * Shape: https://imaginethisprinted.com/claim-account/<orderId>?t=<token>
 */
export function buildAccountClaimUrl(orderId?: string | null): string | null {
  if (!orderId) return null
  return `${FRONTEND_URL}/claim-account/${encodeURIComponent(orderId)}?t=${createAccountClaimToken(orderId)}`
}
