/**
 * Server-side Cloudflare Turnstile check for the public forms the API owns
 * (today: the contact form, POST /api/support/tickets).
 *
 * Signup/sign-in tokens are checked by Supabase itself (GoTrue holds that
 * secret, see docs/SIGNUP_BOT_PROTECTION.md). The contact form posts to OUR
 * API, so our API has to verify its token: a token the browser sends is only
 * worth anything once Cloudflare's siteverify says it is real.
 *
 * Off until TURNSTILE_SECRET_KEY is set, same deploy-ordering rule as the
 * browser half (src/lib/captcha.ts): the secret goes on Render only after the
 * Vercel build carrying VITE_TURNSTILE_SITE_KEY is live, or real customers
 * would be asked for a token no page can produce.
 *
 * Fails OPEN when Cloudflare cannot be reached: the content checks in
 * spam-guard.ts and Jev still run, and a lost customer message is worse than
 * one bot getting through while Cloudflare is down.
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileResult {
  /** True when the request may continue. */
  ok: boolean
  /** True when no check ran (no secret configured, or Cloudflare unreachable). */
  skipped: boolean
  /** Why it failed or was skipped, for logs. Never shown to the customer. */
  reason?: string
}

export function turnstileSecret(): string {
  return (process.env.TURNSTILE_SECRET_KEY || '').trim()
}

/** The token the widget produced. Accepts our field name and Cloudflare's default one. */
export function readTurnstileToken(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const b = body as Record<string, unknown>
  const raw = b.captchaToken ?? b['cf-turnstile-response']
  return typeof raw === 'string' ? raw.trim() : ''
}

type FetchLike = (url: string, init: { method: string; body: URLSearchParams; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<any>
}>

export async function verifyTurnstile(
  token: string,
  remoteIp: string | undefined,
  opts: { secret?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<TurnstileResult> {
  const secret = opts.secret ?? turnstileSecret()
  if (!secret) return { ok: true, skipped: true, reason: 'not_configured' }
  if (!token) return { ok: false, skipped: false, reason: 'missing_token' }
  // Cloudflare's documented cap; anything longer is not a token.
  if (token.length > 2048) return { ok: false, skipped: false, reason: 'token_too_long' }

  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  const doFetch = opts.fetchImpl ?? (fetch as unknown as FetchLike)
  try {
    const res = await doFetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    })
    if (!res.ok) return { ok: true, skipped: true, reason: `siteverify_http_${res.status}` }
    const data = await res.json()
    if (data?.success === true) return { ok: true, skipped: false }
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'].join(',') : 'unknown'
    // A bad SECRET is our misconfiguration, not the customer's fault: let them through and shout in the log.
    if (/invalid-input-secret|missing-input-secret/.test(codes)) {
      return { ok: true, skipped: true, reason: `misconfigured:${codes}` }
    }
    return { ok: false, skipped: false, reason: codes }
  } catch (err) {
    return { ok: true, skipped: true, reason: `unreachable:${err instanceof Error ? err.message : String(err)}` }
  }
}
