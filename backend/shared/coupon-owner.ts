// Coupons that belong to one account.
//
// A discount_codes row can carry, in its metadata:
//   owner_user_id     only that signed-in account may use it
//   first_order_only  only while that account has never paid for an order
//
// The referral welcome code (task 4cebbf83: 10% off a referred friend's first
// order, minted by process_referral_reward() in
// supabase/migrations/20261007233000_referral_reward_first_order_c.sql) sets
// both. Without them a bot farm could sign up through a link, collect codes
// and pass them around.
//
// Checked in BOTH places a code is judged: the checkout pricing engine
// (backend/services/order-pricing.ts, with the server-trusted user id) and
// GET /api/coupons/validate + the full-ITC path (backend/routes/coupons.ts).
// Pure, so both call the same rule.

export type CouponOwnerRefusal = 'sign_in' | 'not_owner' | 'not_first_order'

export const COUPON_OWNER_ERRORS: Record<CouponOwnerRefusal, string> = {
  sign_in: 'Sign in to use this code',
  not_owner: 'This code belongs to another account',
  not_first_order: 'This code is for a first order only',
}

type CouponMetadata = Record<string, unknown> | null | undefined

function ownerOf(metadata: CouponMetadata): string | null {
  const owner = metadata && typeof metadata === 'object' ? metadata.owner_user_id : null
  return typeof owner === 'string' && owner ? owner : null
}

function isFirstOrderOnly(metadata: CouponMetadata): boolean {
  return !!(metadata && typeof metadata === 'object' && metadata.first_order_only === true)
}

/** Does this coupon need to know who is paying (and whether they ever paid)? */
export function couponNeedsOwnerCheck(metadata: CouponMetadata): boolean {
  return ownerOf(metadata) !== null || isFirstOrderOnly(metadata)
}

/** Does this coupon need the payer's paid-order count? */
export function couponNeedsPaidOrderCount(metadata: CouponMetadata): boolean {
  return isFirstOrderOnly(metadata)
}

/**
 * Why this account may not use this coupon, or null when it may.
 * `everPaidOrderCount` is the account's orders that were ever paid
 * (EVER_PAID_STATUSES in backend/services/order-refunds.ts); pass null when it
 * could not be read, and a first-order-only code is refused (fail closed).
 */
export function couponOwnerRefusal(
  metadata: CouponMetadata,
  userId: string | null | undefined,
  everPaidOrderCount: number | null
): CouponOwnerRefusal | null {
  if (!couponNeedsOwnerCheck(metadata)) return null
  if (!userId) return 'sign_in'
  const owner = ownerOf(metadata)
  if (owner && owner !== userId) return 'not_owner'
  if (isFirstOrderOnly(metadata) && (everPaidOrderCount === null || everPaidOrderCount > 0)) return 'not_first_order'
  return null
}
