// One-click cart restore links for the abandoned-checkout email.
//
// WHY THE LINK CAN'T JUST BE "/cart"
//
// The cart lives in the browser's localStorage (`itp_cart_v1`, written by
// src/context/CartContext.tsx). A recovery email that just says "go to your
// cart" only works if the recipient opens it in the SAME browser profile they
// abandoned in. People check email on their phone and shop on a laptop, so that
// link is broken for most of the audience it is aimed at — and a "you left
// something behind" email that lands on an empty cart page is worse than no
// email at all.
//
// So the link carries the order id and a token, and the storefront asks the API
// to hand back the cart snapshot the checkout draft already stored in
// orders.metadata.items.
//
// Same stateless-HMAC design as utils/order-status-token.ts: no DB column, no
// migration. Unlike that one this DOES expire — the token unlocks cart contents
// including any custom artwork URLs, and a recovery link has no reason to
// outlive the recovery window. Anything past MAX_RECOVERY_AGE is refused by the
// route on the order's own created_at, so the token expiry here is a second,
// independent bound rather than the only one.
import crypto from 'crypto'

const TOKEN_SECRET =
  process.env.CART_RECOVERY_TOKEN_SECRET ||
  process.env.ORDER_STATUS_TOKEN_SECRET ||
  process.env.JWT_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.STRIPE_SECRET_KEY ||
  'itp-cart-recovery-dev-secret'

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

export function createCartRecoveryToken(orderId: string): string {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`cart-recovery:${orderId}`)
    .digest('hex')
    .slice(0, 32)
}

/** Constant-time, so the token can't be brute-forced by timing the response. */
export function verifyCartRecoveryToken(orderId: string, token?: string | null): boolean {
  if (!orderId || !token) return false
  const expected = createCartRecoveryToken(orderId)
  const given = Buffer.from(String(token))
  const want = Buffer.from(expected)
  if (given.length !== want.length) return false
  return crypto.timingSafeEqual(given, want)
}

/**
 * The URL that goes in the email. Lands on the SPA, which calls
 * GET /api/orders/:orderId/recover?t=… , writes the returned cart to
 * localStorage and forwards to checkout.
 */
export function buildCartRecoveryUrl(orderId: string): string {
  return `${FRONTEND_URL}/recover-cart/${encodeURIComponent(orderId)}?t=${createCartRecoveryToken(orderId)}`
}
