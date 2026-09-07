// One-click unsubscribe links for COMMERCIAL mail.
//
// Every email ITP sent before 2026-09-07 was transactional — an order
// confirmation, a shipping notice, a support reply — and transactional mail
// needs no unsubscribe. The abandoned-cart recovery nudge is the first
// genuinely commercial send: nobody asked for it, and it exists to make a sale.
// That puts it under CAN-SPAM, which requires a working opt-out in the message
// and honouring it. It is also basic deliverability hygiene: a recipient with
// no unsubscribe button uses the spam button instead, and those complaints land
// against the SAME sending domain that carries order confirmations — mail that
// genuinely has to arrive.
//
// Same stateless-HMAC design as utils/order-status-token.ts, and for the same
// reason: no DB column, no migration, no expiry. A recipient may click the
// unsubscribe link in a months-old email and it must still work.
//
// The opt-out itself is recorded in `email_suppressions` (reason 'manual'),
// which sendEmailWithTracking already consults before every single send — so
// one honoured unsubscribe silences ITP mail to that address everywhere,
// automatically, with no new plumbing.
import crypto from 'crypto'

const TOKEN_SECRET =
  process.env.UNSUBSCRIBE_TOKEN_SECRET ||
  process.env.ORDER_STATUS_TOKEN_SECRET ||
  process.env.JWT_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.STRIPE_SECRET_KEY ||
  'itp-unsubscribe-dev-secret'

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'
const API_ORIGIN = process.env.API_ORIGIN || process.env.PUBLIC_URL || 'https://api.imaginethisprinted.com'

/** Addresses are compared lower/trimmed so a link minted for "A@b.com" verifies for "a@b.com". */
function normalize(email: string): string {
  return String(email || '').trim().toLowerCase()
}

export function createUnsubscribeToken(email: string): string {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`unsubscribe:${normalize(email)}`)
    .digest('hex')
    .slice(0, 32)
}

/** Constant-time, so the token can't be brute-forced by timing the response. */
export function verifyUnsubscribeToken(email: string, token?: string | null): boolean {
  if (!email || !token) return false
  const expected = createUnsubscribeToken(email)
  const given = Buffer.from(String(token))
  const want = Buffer.from(expected)
  if (given.length !== want.length) return false
  return crypto.timingSafeEqual(given, want)
}

/**
 * The link a human clicks. Lands on the API (not the SPA) so the opt-out is
 * recorded even if the storefront is mid-deploy, and renders its own small
 * confirmation page.
 */
export function buildUnsubscribeUrl(email: string): string {
  return `${API_ORIGIN}/api/email/unsubscribe?e=${encodeURIComponent(normalize(email))}&t=${createUnsubscribeToken(email)}`
}

/**
 * Headers for RFC 8058 one-click unsubscribe. Gmail and Yahoo both require
 * these on bulk mail now, and honouring them is what keeps the domain's
 * reputation — and therefore the order confirmations — out of spam folders.
 */
export function unsubscribeHeaders(email: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${buildUnsubscribeUrl(email)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  }
}

export { FRONTEND_URL as UNSUBSCRIBE_FRONTEND_URL }
