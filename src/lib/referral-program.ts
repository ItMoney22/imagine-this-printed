// The referral rewards, in one place for the public page and the dashboard.
//
// What actually pays (production, task 4cebbf83, 2026-10-07):
//   - a friend joining through your link pays you NOTHING yet:
//     process_referral_reward() records the link and gives the FRIEND a
//     personal code for 10% off their first order, good for 30 days;
//   - when that friend's first order with at least $15 of products (after
//     discounts) is paid, award_referral_first_order() pays the referrer
//     v_bonus_itc = 500 ITC ($5 store credit).
// Both live in supabase/migrations/20261007233000_referral_reward_first_order_c.sql.
// Change those, change this.
export const REFERRAL_REWARDS = {
  firstOrder: {
    referrerItc: 500,
    /** Products in the friend's order, after discounts, in dollars. */
    minProductsUsd: 15,
  },
  friend: {
    percentOff: 10,
    days: 30,
  },
} as const

// How long a friend's link is remembered on the device that opened it
// (src/utils/referral-capture.ts REFERRAL_LINK_DAYS).
export { REFERRAL_LINK_DAYS } from '../utils/referral-capture'
