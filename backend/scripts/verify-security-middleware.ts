// Standalone verification for the security middleware (helmet + rate limits +
// trust-proxy hop count). Runs against a throwaway Express app on an
// ephemeral port — no database, no Supabase keys, no .env required — so it
// can be run anywhere, including CI:
//
//   npx tsx scripts/verify-security-middleware.ts     (from backend/)
//   npm run verify:security
//
// Exits non-zero on the first failed assertion.
import express from 'express'
import type { AddressInfo } from 'node:net'

// Tighten the metered buckets before importing the limiters — the module reads
// its limits from env at import time.
process.env.RATE_LIMIT_CODE_CHECK_MAX = '3'
process.env.RATE_LIMIT_GLOBAL_MAX = '5'

const { securityHeaders } = await import('../middleware/security-headers.js')
const { globalLimiter, codeCheckLimiter } = await import('../middleware/rate-limits.js')

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// --- App under test: trust proxy = 2, matching the real Cloudflare -> Render
// -> app chain (see docs/SECURITY_HARDENING.md).
const app = express()
app.set('trust proxy', 2)
app.use(securityHeaders())
app.use(globalLimiter)
app.use('/api/coupons', codeCheckLimiter)
app.get('/api/coupons/validate', (_req, res) => res.json({ ok: true }))
app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/whoami', (req, res) => res.json({ ip: req.ip }))

const server = app.listen(0)
await new Promise<void>(resolve => server.once('listening', () => resolve()))
const port = (server.address() as AddressInfo).port
const base = `http://127.0.0.1:${port}`

// --- Security headers -------------------------------------------------------
const headerRes = await fetch(`${base}/api/health`)
const h = headerRes.headers
check('helmet: HSTS', h.get('strict-transport-security') === 'max-age=31536000; includeSubDomains', h.get('strict-transport-security') ?? 'missing')
check('helmet: nosniff', h.get('x-content-type-options') === 'nosniff', h.get('x-content-type-options') ?? 'missing')
check('helmet: frame deny', h.get('x-frame-options') === 'DENY', h.get('x-frame-options') ?? 'missing')
check('helmet: no-referrer', h.get('referrer-policy') === 'no-referrer', h.get('referrer-policy') ?? 'missing')
check('helmet: CSP default-src none', (h.get('content-security-policy') ?? '').includes("default-src 'none'"), h.get('content-security-policy') ?? 'missing')
check('helmet: CSP frame-ancestors none', (h.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"))
check('helmet: CORP cross-origin (SPA loads API images)', h.get('cross-origin-resource-policy') === 'cross-origin', h.get('cross-origin-resource-policy') ?? 'missing')
check('helmet: X-Powered-By stripped', h.get('x-powered-by') === null, h.get('x-powered-by') ?? '')

// --- Rate limiting ----------------------------------------------------------
const codeStatuses: number[] = []
let meteredHeaders: Headers | null = null
for (let i = 0; i < 5; i++) {
  const res = await fetch(`${base}/api/coupons/validate`)
  if (!meteredHeaders) meteredHeaders = res.headers
  codeStatuses.push(res.status)
}
check('rate limit: first 3 code checks pass', codeStatuses.slice(0, 3).every(s => s === 200), codeStatuses.join(','))
check('rate limit: 4th code check is 429', codeStatuses[3] === 429, String(codeStatuses[3]))
check(
  'rate limit: RateLimit headers on metered routes',
  !!meteredHeaders && (meteredHeaders.has('ratelimit') || meteredHeaders.has('ratelimit-policy')),
  meteredHeaders?.get('ratelimit') ?? 'missing'
)
// Exempt routes are skipped entirely, so they carry no RateLimit headers.
check('rate limit: exempt routes carry no RateLimit headers', !headerRes.headers.has('ratelimit'))

// Health probes and webhooks must never be throttled — 20 hits, all 200.
const healthStatuses: number[] = []
for (let i = 0; i < 20; i++) {
  const res = await fetch(`${base}/api/health`)
  healthStatuses.push(res.status)
}
check('rate limit: /api/health exempt', healthStatuses.every(s => s === 200), `${healthStatuses.filter(s => s !== 200).length} throttled`)

// --- Trust proxy hop count ---------------------------------------------------
// Simulate the real chain: client (A) -> Cloudflare (B) -> Render edge (C) ->
// this app. Cloudflare sets X-Forwarded-For to the client's IP; Render's edge
// appends its own hop before forwarding internally, so the app sees
// "A, B" on X-Forwarded-For with the socket peer being C (loopback here,
// since this is a local ephemeral server).
const CLIENT_IP = '203.0.113.7' // TEST-NET-3, RFC 5737 — never a real address
const CF_EDGE_IP = '198.51.100.42' // TEST-NET-2
const whoamiRes = await fetch(`${base}/api/whoami`, {
  headers: { 'X-Forwarded-For': `${CLIENT_IP}, ${CF_EDGE_IP}` }
})
const whoami = await whoamiRes.json()
check(
  'trust proxy=2: req.ip resolves to the real client, not the Cloudflare edge',
  whoami.ip === CLIENT_IP,
  `got ${whoami.ip}, expected ${CLIENT_IP}`
)

server.close()
console.log(failures === 0 ? '\nAll security middleware checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
