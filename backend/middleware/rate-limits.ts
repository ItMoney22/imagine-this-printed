// Central rate-limit policy for the API.
//
// Buckets are per-IP and in-memory (one bucket set per process). That is the
// right default here: the API runs as a single Node process per deploy, and a
// shared store (Redis) would add a hard dependency to the request path for a
// control that is meant to fail open. If the API is ever scaled to N replicas,
// the effective limit becomes N x the number below — see docs/SECURITY_HARDENING.md.
//
// Limits are deliberately generous. Every number below is far above what a
// human (or an admin dashboard doing a full panel load) produces, and far below
// what credential stuffing / enumeration needs. Each is env-overridable so an
// operator can retune without a code deploy, and RATE_LIMIT_ENABLED=false is
// the kill switch if a proxy misconfiguration ever collapses every client onto
// one apparent IP.
import rateLimit from 'express-rate-limit'
import type { Request, Response, RequestHandler } from 'express'

const ENABLED = String(process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Never throttled:
//   - provider webhooks (Stripe / Resend / Replicate). Providers retry in
//     bursts; a 429 here loses a payment record or an inbound email.
//   - health probes (uptime monitors poll on a tight interval).
//   - the Watchtower print bridge, which polls its queue and authenticates
//     with a shared secret rather than a user session.
const EXEMPT_PREFIXES = [
  '/api/health',
  '/api/webhooks',
  '/api/stripe/webhook',
  '/api/email/webhooks',
  '/api/ai/replicate',
  '/api/print-bridge'
]

function pathOf(req: Request): string {
  // Limiters are mounted on sub-paths, so req.path is relative to the mount.
  // Exemptions are expressed as absolute API paths, so match on originalUrl.
  return (req.originalUrl || req.url || '').split('?')[0]
}

function isExempt(req: Request): boolean {
  const path = pathOf(req)
  return EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix))
}

type LimiterSpec = {
  name: string
  windowMs: number
  limit: number
  /** Extra skip predicate, e.g. "reads are cheap, only meter writes". */
  skip?: (req: Request) => boolean
}

function makeLimiter({ name, windowMs, limit, skip }: LimiterSpec): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // RateLimit / RateLimit-Policy response headers
    legacyHeaders: false,
    skip: (req: Request) => !ENABLED || isExempt(req) || (skip ? skip(req) : false),
    handler: (req: Request, res: Response) => {
      const retryAfterSeconds = Math.ceil(windowMs / 1000)
      console.warn(`[rate-limit] ${name} tripped: ${req.method} ${pathOf(req)} from ${req.ip}`)
      res.status(429).json({
        error: 'Too many requests',
        detail: 'Rate limit exceeded. Slow down and try again shortly.',
        retryAfterSeconds
      })
    }
  })
}

const isRead = (req: Request) => req.method === 'GET' || req.method === 'HEAD'

/**
 * Backstop for every route. Wide enough that no legitimate session notices,
 * narrow enough to blunt a scripted sweep of the whole API surface.
 */
export const globalLimiter = makeLimiter({
  name: 'global',
  windowMs: 15 * 60 * 1000,
  limit: envInt('RATE_LIMIT_GLOBAL_MAX', 1000)
})

/**
 * Auth / account surfaces (`/api/auth`, `/api/account`): legacy token
 * verification, profile lookup by username (an enumeration oracle) and the
 * unauthenticated welcome-email endpoint.
 *
 * Note: the primary login and password-reset flows run against Supabase Auth
 * directly from the browser and are rate-limited by Supabase, not here.
 */
export const authLimiter = makeLimiter({
  name: 'auth',
  windowMs: 15 * 60 * 1000,
  limit: envInt('RATE_LIMIT_AUTH_MAX', 60)
})

/**
 * Admin surfaces. An admin dashboard load fans out to a dozen endpoints and
 * the ops monitor polls, so this is sized per 5 minutes rather than per minute.
 */
export const adminLimiter = makeLimiter({
  name: 'admin',
  windowMs: 5 * 60 * 1000,
  limit: envInt('RATE_LIMIT_ADMIN_MAX', 300)
})

/**
 * Paid-inference surfaces (image generation, mockups, chat, transcription).
 * Abuse here costs real money, so writes are metered tightly; status polls are
 * GETs and stay free so a long-running job's UI never stalls.
 */
export const aiLimiter = makeLimiter({
  name: 'ai',
  windowMs: 10 * 60 * 1000,
  limit: envInt('RATE_LIMIT_AI_MAX', 60),
  skip: isRead
})

/**
 * Coupon / gift-card code checks — a classic brute-force target (guess codes
 * until one validates). Reads are metered too: validation happens over GET.
 */
export const codeCheckLimiter = makeLimiter({
  name: 'code-check',
  windowMs: 10 * 60 * 1000,
  limit: envInt('RATE_LIMIT_CODE_CHECK_MAX', 40)
})

/**
 * Unauthenticated public writes (support tickets, community posts). Keeps the
 * spam floor low without touching browsing.
 */
export const publicWriteLimiter = makeLimiter({
  name: 'public-write',
  windowMs: 10 * 60 * 1000,
  limit: envInt('RATE_LIMIT_PUBLIC_WRITE_MAX', 30),
  skip: isRead
})

export const rateLimitingEnabled = ENABLED
