// The referral rewards, in one place for the public page and the dashboard.
// Mirrors the live process_referral_reward() database function (sign-up
// rewards, read from production 2026-10-07) and the first-order bonus in
// backend/services/referral-service.ts. Change those, change this.
export const REFERRAL_REWARDS = {
  signup: {
    referrerPoints: 500,
    referrerItc: 5,
    friendPoints: 250,
    friendItc: 2.5,
  },
  firstOrder: {
    referrerItc: 50,
  },
} as const
