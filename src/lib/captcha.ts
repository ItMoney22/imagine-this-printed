/**
 * Cloudflare Turnstile — the bot challenge in front of Supabase Auth.
 *
 * WHY THIS EXISTS
 * ---------------
 * 2026-09-08: 303 accounts existed on this store and only 5 were real. The
 * other 290 were scripted signups against an endpoint with no challenge of any
 * kind, and each one minted 500 ITC (see
 * supabase/migrations/20260922120000_signup_wallet_and_welcome_email.sql) and
 * fired a welcome email at a scraped corporate address. The wallet hole and the
 * mail hole are both closed now; this is the part that stops the accounts being
 * created in the first place.
 *
 * HOW IT ENFORCES
 * ---------------
 * The token this widget produces is passed to supabase-js as
 * `options.captchaToken`. It is only actually *checked* once Supabase's own
 * Bot & Abuse Protection is switched on in the project dashboard, because
 * verification happens inside GoTrue against the Turnstile SECRET — the browser
 * never sees that secret and cannot be trusted to enforce anything. Widget in
 * the page = the token exists; dashboard toggle = the token is required.
 * Both halves are needed. See docs/SIGNUP_BOT_PROTECTION.md for the order the
 * two halves have to be turned on in, which matters: flipping the dashboard
 * first locks every real customer out of signing in.
 *
 * FAIL-OPEN BY DESIGN
 * -------------------
 * With no site key configured the widget renders nothing and the forms submit
 * without a token, exactly as they did before. That is deliberate: this file
 * can ship to production before the key and the dashboard toggle land without
 * taking signup down in between. It is not a security decision — the security
 * lives in GoTrue — it is a deploy-ordering decision.
 */

/** Public site key. Safe to ship to the browser; the secret half never leaves Supabase. */
export const TURNSTILE_SITE_KEY: string =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || ''

/**
 * True when a site key is configured, i.e. the forms should render a challenge
 * and hold the submit button until it is solved.
 */
export const isCaptchaConfigured = (): boolean => TURNSTILE_SITE_KEY.length > 0

/** URL of Cloudflare's script. Also allow-listed in vercel.json's CSP. */
export const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/**
 * Turnstile labels each solve with an "action" so Cloudflare's analytics can
 * tell a signup flood apart from a password-reset flood. Keep these stable.
 */
export type CaptchaAction = 'signup' | 'signin' | 'password-reset' | 'magic-link'
