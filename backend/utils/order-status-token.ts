// ============================================================================
// Tokenized guest order-status links
//
// Every transactional email needs a "check my order" button that works for a
// buyer who never made an account. The old CTA pointed at /orders — which is the
// admin OrderManagement page — so guests (and most customers) hit a wall.
//
// Design: a stateless HMAC of the order id. No DB column, no migration, no
// expiry — customers dig up shipping emails months later and the link must still
// work. The token only unlocks a read-only status view of ONE order, and the
// order id is a v4 UUID, so it isn't guessable or enumerable.
//
// Secret resolution falls back through values that are always present in the
// backend environment, so links work without any new env configuration. Set
// ORDER_STATUS_TOKEN_SECRET explicitly to rotate every outstanding link at once.
// ============================================================================

import crypto from 'crypto'

const TOKEN_SECRET =
  process.env.ORDER_STATUS_TOKEN_SECRET ||
  process.env.JWT_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.STRIPE_SECRET_KEY ||
  'itp-order-status-dev-secret'

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

/** 32 hex chars (128 bits) — plenty against forgery, short enough to stay readable. */
export function createOrderStatusToken(orderId: string): string {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`order-status:${orderId}`)
    .digest('hex')
    .slice(0, 32)
}

/** Constant-time comparison so the token can't be brute-forced by timing. */
export function verifyOrderStatusToken(orderId: string, token?: string | null): boolean {
  if (!orderId || !token) return false
  const expected = createOrderStatusToken(orderId)
  const given = Buffer.from(String(token))
  const want = Buffer.from(expected)
  if (given.length !== want.length) return false
  return crypto.timingSafeEqual(given, want)
}

/**
 * Public, no-login order-status URL for a buyer.
 * Shape: https://imaginethisprinted.com/order-status/<orderId>?t=<token>
 */
export function buildOrderStatusUrl(orderId?: string | null): string {
  if (!orderId) return `${FRONTEND_URL}/account/orders`
  return `${FRONTEND_URL}/order-status/${encodeURIComponent(orderId)}?t=${createOrderStatusToken(orderId)}`
}
