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
// TRUST_PROXY_HOPS is per-HOST, not per-app, and the Render -> Fly migration
// changes it. Both topologies are asserted here so neither can be broken by
// copying the other's value:
//
//   Render: client (A) -> Cloudflare (B) -> Render's router (C) -> app.
//           The Cloudflare there is RENDER'S OWN — the zone record for
//           api.imaginethisprinted.com is proxied:false, yet production
//           responses carry `server: cloudflare` alongside Render's
//           `rndr-id`. Two hops, TRUST_PROXY_HOPS=2.
//   Fly:    client (A) -> Fly proxy -> app. One hop, TRUST_PROXY_HOPS=1
//           (pinned in backend/fly.api.toml).
//
// Express resolves req.ip by walking X-Forwarded-For from the right, treating
// the n rightmost entries as trusted proxies. So the hop count decides which
// entry is believed — and an over-count believes one the CALLER supplied.
const CLIENT_IP = '203.0.113.7' // TEST-NET-3, RFC 5737 — never a real address
const CF_EDGE_IP = '198.51.100.42' // TEST-NET-2
const SPOOFED_IP = '192.0.2.99' // TEST-NET-1 — stands in for a forged header

const whoamiRes = await fetch(`${base}/api/whoami`, {
  headers: { 'X-Forwarded-For': `${CLIENT_IP}, ${CF_EDGE_IP}` }
})
const whoami = await whoamiRes.json()
check(
  'render topology (hops=2): req.ip resolves to the real client, not the Cloudflare edge',
  whoami.ip === CLIENT_IP,
  `got ${whoami.ip}, expected ${CLIENT_IP}`
)

server.close()

// --- Fly topology (hops=1) ---------------------------------------------------
// Second throwaway app, because `trust proxy` is set once per Express app.
// Fly's proxy APPENDS the connecting client's address to X-Forwarded-For, so a
// caller that forges the header ends up with "<forged>, <real>" and the real
// address is always the rightmost entry.
const flyApp = express()
flyApp.set('trust proxy', 1)
flyApp.get('/api/whoami', (req, res) => res.json({ ip: req.ip }))
const flyServer = flyApp.listen(0)
await new Promise<void>(resolve => flyServer.once('listening', () => resolve()))
const flyBase = `http://127.0.0.1:${(flyServer.address() as AddressInfo).port}`

const flyHonest = await (await fetch(`${flyBase}/api/whoami`, {
  headers: { 'X-Forwarded-For': CLIENT_IP }
})).json()
check(
  'fly topology (hops=1): req.ip resolves to the client the Fly proxy appended',
  flyHonest.ip === CLIENT_IP,
  `got ${flyHonest.ip}, expected ${CLIENT_IP}`
)

const flySpoofed = await (await fetch(`${flyBase}/api/whoami`, {
  headers: { 'X-Forwarded-For': `${SPOOFED_IP}, ${CLIENT_IP}` }
})).json()
check(
  'fly topology (hops=1): a forged X-Forwarded-For entry is IGNORED',
  flySpoofed.ip === CLIENT_IP,
  `got ${flySpoofed.ip}, expected ${CLIENT_IP} (a client that can forge this mints a fresh rate-limit bucket per request)`
)

// The failure mode being guarded against, stated as a test: carrying Render's
// 2 over to Fly makes Express believe exactly the entry the caller forged.
const wrongApp = express()
wrongApp.set('trust proxy', 2)
wrongApp.get('/api/whoami', (req, res) => res.json({ ip: req.ip }))
const wrongServer = wrongApp.listen(0)
await new Promise<void>(resolve => wrongServer.once('listening', () => resolve()))
const wrongBase = `http://127.0.0.1:${(wrongServer.address() as AddressInfo).port}`
const wrongIp = (await (await fetch(`${wrongBase}/api/whoami`, {
  headers: { 'X-Forwarded-For': `${SPOOFED_IP}, ${CLIENT_IP}` }
})).json()).ip
check(
  'regression guard: hops=2 on a Fly-shaped chain trusts the forged entry (this is why the value is not portable)',
  wrongIp === SPOOFED_IP,
  `got ${wrongIp}, expected ${SPOOFED_IP}`
)

flyServer.close()
wrongServer.close()
console.log(failures === 0 ? '\nAll security middleware checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
