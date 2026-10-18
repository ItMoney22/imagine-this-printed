// The referral rewards, in one place for the public page and the dashboard.
//
// What actually pays (production, 2026-10-07, task bdfa6939):
//   - a friend joining through your link pays NOTHING: process_referral_reward()
//     only records the link (bot sign-ups could farm a sign-up reward);
//   - when that friend's first order is paid, award_referral_first_order()
//     pays the referrer v_bonus_itc = 50 ITC.
// Both live in supabase/migrations/20261007210000_referral_attribution.sql.
// Change those, change this.
export const REFERRAL_REWARDS = {
  firstOrder: {
    referrerItc: 50,
  },
} as const

// How long a friend's link is remembered on the device that opened it
// (src/utils/referral-capture.ts REFERRAL_LINK_DAYS).
export { REFERRAL_LINK_DAYS } from '../utils/referral-capture'
