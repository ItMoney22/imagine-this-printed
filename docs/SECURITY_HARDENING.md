# Security Hardening

Tracks the security posture on both edges:

- **Browser edge** (sections 1, 3, 4) — CSP, HSTS and related headers for
  `imaginethisprinted.com`. Enforced in two places that must stay in sync:
  - `vercel.json` — the `headers` block, source of truth for the Vercel deploy.
  - `server-static.mjs` — the Railway/VPS static-file server, mirrors the same
    headers for the non-Vercel deploy path.
- **API edge** (section 2) — helmet response headers, per-family rate limits and
  role revocation on `api.imaginethisprinted.com`, in `backend/`.

## 1. Headers shipped

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`X-XSS-Protection: 0` (modern browsers ignore the legacy XSS auditor; `0`
avoids it being abused as an XSS vector in old IE), `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy` (locks down
geolocation/usb/interest-cohort, scopes `payment` to Stripe), `Strict-
Transport-Security: max-age=31536000; includeSubDomains`.

## 2. API edge — helmet, rate limiting, role revocation

**Status: implemented in `backend/`, verified 2026-08-16.**

History worth knowing before editing this section: this posture was first
written on 2026-07-26 (commit `b47e94f`, Watchtower task `210cc6bc`) on a branch
that never merged. Only the browser-edge half of that effort reached `main`, so
for three weeks this doc's section 1 described live headers while the API half
existed nowhere. It was re-implemented on `main` under Watchtower task
`84a7fbad`. If a future audit finds these files missing again, check for an
unmerged sibling branch before assuming the design was rejected.

### 2.1 Response headers (helmet)

`backend/middleware/security-headers.ts`, registered in `backend/index.ts`
before CORS so error responses and 404s carry the headers too:

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 1 year, no `preload` — preloading is an apex-domain decision that gets submitted deliberately, not as a side effect of a backend deploy. |
| `Content-Security-Policy` | `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` | The API answers JSON and binary assets only, never an HTML document. This is the API-shaped lockdown, not the SPA policy in section 3. |
| `X-Content-Type-Options` | `nosniff` | A JSON body a browser may sniff as HTML is an XSS primitive. |
| `X-Frame-Options` | `DENY` | Belt-and-braces with `frame-ancestors 'none'` for older browsers. |
| `Referrer-Policy` | `no-referrer` | |
| `Cross-Origin-Resource-Policy` | `cross-origin` | **Deliberate override of helmet's default.** The SPA on `imaginethisprinted.com` loads generated mockups/designs from `api.imaginethisprinted.com`; helmet's `same-origin` default would block those `<img>` loads. CORS is the access control here, not CORP. |
| `Cross-Origin-Embedder-Policy` | *off* | COEP would break cross-origin image/font loads for no benefit on a JSON API. |
| `X-Powered-By` | *stripped* | |

### 2.2 Rate limiting

`backend/middleware/rate-limits.ts`. Buckets are **per-IP and in-memory** (one
bucket set per process). That is the right default: the API runs as a single
Node process per deploy, and a shared store (Redis) would add a hard dependency
to the request path for a control meant to fail open. If the API is ever scaled
to N replicas, the effective limit becomes N × the number below.

| Family | Paths | Limit | Notes |
|---|---|---|---|
| global | everything | 1000 / 15 min | Backstop; wide enough that no legitimate session notices. |
| auth | `/api/auth`, `/api/account` | 60 / 15 min | Login and password reset run against Supabase Auth from the browser and are limited by Supabase, not here. |
| admin | `/api/admin/*` | 300 / 5 min | An admin dashboard load fans out to a dozen endpoints and the ops monitor polls. |
| ai | `/api/ai`, `/api/mockups`, `/api/realistic-mockups`, `/api/image-flow`, `/api/designer`, `/api/imagination-station`, `/api/creator/studio` | 60 / 10 min, **writes only** | Paid inference — abuse costs real money. GET status polls stay free so a long-running job's UI never stalls. |
| code-check | `/api/coupons`, `/api/gift-cards` | 40 / 10 min | Brute-forcing codes is the classic attack; reads are metered too because validation happens over GET. |
| public-write | `/api/support`, `/api/community`, `/api/reviews` | 30 / 10 min, **writes only** | Spam floor, without touching browsing. |

**Never throttled** (skipped before any bucket is touched):
`/api/health` (uptime monitors poll tightly), `/api/webhooks`,
`/api/stripe/webhook`, `/api/email/webhooks`, `/api/ai/replicate` (providers
retry in bursts; a 429 loses a payment record or an inbound email), and
`/api/print-bridge` (polls its queue, authenticates with a shared secret).

Responses carry draft-7 `RateLimit` / `RateLimit-Policy` headers; a throttled
request gets `429` with `{ error, detail, retryAfterSeconds }`. Every limit is
env-tunable and `RATE_LIMIT_ENABLED=false` is the kill switch — see
[ENV_VARIABLES.md](ENV_VARIABLES.md#rate-limiting--proxy-optional--sane-defaults).

**Trust proxy is a hop COUNT, never `true`.** `app.set('trust proxy',
TRUST_PROXY_HOPS)` (default `1`) makes `req.ip` the real client address, which
is what every bucket keys on. `true` would let a caller spoof `X-Forwarded-For`
and mint a fresh bucket per request, making the whole control decorative. If a
deploy gains a second proxy in front (a CDN), raise the count — do not set
`true`.

### 2.3 Role revocation

Three pieces, all needed:

1. **`requireRole` never trusts the JWT.** `backend/middleware/supabaseAuth.ts`
   resolves the role from `user_profiles` (through the cache below), because
   `user_metadata` is client-writable via `supabase.auth.updateUser()` *and*
   because a token lives ~1h, so a role claim baked into it outlives a
   demotion. (This half reached `main` separately, in the 2026-08-06 hardening.)
2. **The role cache TTL is 60s**, not the 5 minutes it started at
   (`backend/lib/role-cache.ts`). A cached role is a privilege that outlives the
   decision to revoke it; 60s still absorbs the burst the cache exists for while
   capping worst-case staleness at a minute.
3. **`POST /api/admin/users/:userId/role`** (`backend/routes/admin/users.ts`,
   admin-only) does the update, the `audit_logs` record and the cache
   invalidation in one step, so a demotion takes effect on the target's **very
   next request** rather than at TTL expiry. It invalidates the acting admin's
   entry too (an admin can demote themselves). The role value is validated
   against the `User['role']` union — an unknown role string silently fails
   every authorization check, which reads as "the account is broken".
   `AdminDashboard`'s role dropdown posts here and falls back to the old direct
   `user_profiles` write only if the API is unreachable (that path is then
   TTL-bounded rather than immediate).

   Companion endpoints for roles changed out of band (Supabase dashboard, SQL)
   and for incident response:
   `POST /api/admin/users/:userId/invalidate-role-cache`,
   `POST /api/admin/users/role-cache/flush`,
   `GET /api/admin/users/role-cache/stats`.

The TTL is only the backstop. It covers out-of-band changes and *other
processes'* caches — the cache is per-process, so with multiple API replicas a
change made through one replica's endpoint is immediate there and TTL-bounded
(≤60s) elsewhere.

### 2.4 Debug handles are development-only

`window.supabase` (`src/lib/supabase.ts`) and `window.refreshSession` /
`window.hardResetAuth` (`src/main.tsx`) are gated behind `import.meta.env.DEV`,
which is statically `false` in a production build, so the blocks are dropped at
build time. The anon key is public, but these are not just the key: they are a
live client holding the signed-in user's session and a lever that wipes stored
credentials. Anything that can run script in the page (XSS, a malicious
extension, a pasted "fix", self-XSS in the console) could otherwise use them.

`src/utils/debug.ts`, `src/utils/connectivity-test.ts` and
`src/utils/env-check.ts` also attach `window` probes, but nothing imports them,
so Vite never includes them in the bundle. They are dead code — listed under
open follow-ups rather than gated.

### 2.5 How to verify

```bash
cd backend && npm run verify:security     # 14 assertions, no DB/env needed
```

It boots a throwaway Express app on an ephemeral port and asserts every header
above plus per-family 429 behaviour, `RateLimit` headers, and that exempt routes
are skipped entirely. Against a running API, the live equivalents are:

```bash
curl -sD - -o /dev/null https://api.imaginethisprinted.com/api/health          # helmet headers, no RateLimit header (exempt)
curl -sD - -o /dev/null https://api.imaginethisprinted.com/api/coupons/validate # RateLimit: limit=…, remaining=…
```

## 3. Content-Security-Policy — baseline

The enforcing `Content-Security-Policy` locks every directive down to an
explicit list of trusted hosts (Stripe, Google Fonts/tag-manager/ajax CDN)
**except `connect-src`**, which is still the broad `'self' https: wss:` — see
section 4 for why and what replaces it.

`script-src` carries no `'unsafe-inline'`/`'unsafe-eval'` — the built
`index.html` has zero inline scripts and the bundle has zero `eval` sites.

## 4. connect-src — tightening to an explicit allowlist (Report-Only phase)

**Status: Report-Only shipped 2026-07-28, NOT yet enforcing.**

`connect-src 'self' https: wss:` is broad enough to let a successful XSS
exfiltrate data to *any* HTTPS/WSS host — CSP's main job is closing exactly
that path. Both `vercel.json` and `server-static.mjs` now ship a SECOND
header, `Content-Security-Policy-Report-Only`, alongside the unchanged
enforcing policy. It is identical in every directive except `connect-src`,
which is narrowed to the explicit hosts below. Report-Only headers **never
block anything** — the browser just evaluates the policy and would report
violations if a reporting endpoint were configured. No such endpoint exists
yet (see "How to verify" below); this phase relies on manual verification
instead of an automated collector.

### The allowlist, and why each host is there

Built by grepping `src/` for every place the browser actually makes a
network call (fetch/XHR/WebSocket/SDK), not from guesswork:

| Host | Why | Evidence |
|---|---|---|
| `'self'` | same-origin API routes, SSR fragments | — |
| `https://czzyrmizvjqlifcivrhn.supabase.co` | Supabase REST (auth, `from()`, `rpc()`) | `src/lib/supabase.ts`, `VITE_SUPABASE_URL` |
| `wss://czzyrmizvjqlifcivrhn.supabase.co` | Supabase Realtime transport | supabase-js ships this even though no `.channel()` call was found live in `src/` today — kept so a future realtime feature doesn't silently break under the enforcing policy |
| `https://api.imaginethisprinted.com` | backend API (Express), separate subdomain from the SPA | `src/lib/api.ts` `API_BASE` |
| `https://api.stripe.com` | Stripe.js network calls (Elements, PaymentIntents) | `@stripe/stripe-js` `loadStripe()` in `src/pages/Checkout.tsx`, `src/pages/Wallet.tsx`, `src/utils/stripe.ts`, `src/utils/stripe-itc.ts` |
| `https://m.stripe.network` | Stripe.js advanced fraud-signal beacon (documented as required by Stripe's own recommended CSP) | same Stripe.js usage as above |
| `https://storage.googleapis.com` | GCS-hosted assets (style previews, uploaded designs) | `src/components/CreateDesignModal.tsx`, `src/utils/product-style-options.ts` |
| `https://api.goshippo.com` | Shippo shipping-rate API, called directly from the browser | `src/utils/shippo.ts` |
| `https://www.googletagmanager.com` | per-vendor Google Analytics tag (`storefrontConfig.analytics.googleAnalyticsId`) | `src/pages/VendorStorefront.tsx` |
| `https://www.google-analytics.com`, `https://region1.google-analytics.com` | GA4 Measurement Protocol beacons once the above tag loads | same vendor-analytics feature |

**Not included, on purpose:**
- `https://api.brevo.com` — referenced in `src/utils/email.ts`, but that
  module is only ever imported by `backend/**` (Node, `process.env`-based),
  never by a frontend entry point, so it is not part of the browser bundle.
  It is also being purged per a live campaign decision (ITP does not use
  Brevo) — see `E:/memory/watchtower/projects/imagine-this-printed/campaign-2026-07-28/DECISIONS.md`.
- `*.amazonaws.com` (S3) — `src/utils/storage.ts` talks to S3 directly from
  the browser using non-`VITE_`-prefixed env vars (so the credentials are
  always `undefined` in a Vite build), but nothing imports its only
  consumer, `src/components/StorageSettings.tsx`. Dead code, unreachable
  from any route — flagged for cleanup, not wired into the allowlist.
- Replicate / OpenRouter — used only from `backend/`; the browser never
  calls either directly.

### How to verify (replaces automated report collection for this pass)

No `report-uri`/`report-to` collector exists in this stack, and standing one
up is out of scope for this change (`Content-Security-Policy` and
`Content-Security-Policy-Report-Only` are pure browser-edge config — a
report collector would be new backend infra). Instead, verify manually:
open the production/staging site with DevTools open, exercise checkout
(Stripe), sign-in (Supabase), a design upload (GCS), and a shipping-rate
lookup (Shippo), and confirm the console shows **zero**
`Content-Security-Policy-Report-Only` violation lines. Add any host that
does show a violation to both files before flipping to enforcing.

### Flipping to enforcing (the one-line change this Report-Only phase sets up)

Once verified, in both `vercel.json` and `server-static.mjs`:
1. Replace the enforcing `Content-Security-Policy`'s `connect-src` value
   with the Report-Only policy's `connect-src` value (the two are already
   letter-for-letter identical except that one directive).
2. Delete the `Content-Security-Policy-Report-Only` header entirely.

## Open follow-ups

- Stand up a `report-uri`/`report-to` collector if ongoing automated CSP
  violation monitoring is wanted beyond this one-time manual verification
  pass.
- `*.amazonaws.com` / `src/utils/storage.ts` + `src/components/StorageSettings.tsx`
  are dead code (S3 client with credentials that can never resolve in a Vite
  build, and no route renders the component). Candidate for deletion.
- `src/utils/email.ts` (Brevo) — being purged under a separate, already
  in-flight campaign task; do not re-add `api.brevo.com` to this allowlist
  when that lands unless Brevo turns out to be genuinely wired to the
  frontend (it is not, as of this writing).
- Flip connect-src from Report-Only to enforcing after the manual
  verification pass above (or a real monitoring window, if one is run).
