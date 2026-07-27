# Security Hardening

What is in place, why each number is what it is, and how to verify or roll back.
Landed 2026-07-26 (Watchtower task `210cc6bc-6e6f-409b-8083-ccf6809e5fa4`).

---

## 1. API security headers (helmet)

`backend/middleware/security-headers.ts`, registered first in `backend/index.ts`
so 404s and error responses carry the headers too.

| Header | Value | Why |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | HTTPS-only for a year. Not `preload` — preloading is an apex-domain decision that has to be submitted deliberately, not a side effect of a backend deploy. |
| `Content-Security-Policy` | `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` | The API never serves a document. This is the "nothing loads from here, nothing frames this" lockdown. The browsing app's CSP is separate — see §4. |
| `Cross-Origin-Resource-Policy` | `cross-origin` | **Deliberate override.** The SPA on `imaginethisprinted.com` loads generated mockups from `api.imaginethisprinted.com`; helmet's `same-origin` default would block those `<img>` loads. CORS (in `index.ts`) is the access control here, not CORP. |
| `Referrer-Policy` | `no-referrer` | API URLs can contain ids; don't leak them onward. |
| `X-Frame-Options` | `DENY` | Clickjacking. |
| `X-Content-Type-Options` | `nosniff` | MIME confusion. |
| `X-XSS-Protection` | `0` (helmet default) | The legacy auditor is itself an XSS vector in old browsers; CSP replaces it. |
| `X-Powered-By` | removed | Fingerprinting. |

`crossOriginEmbedderPolicy` stays **off**: COEP would break cross-origin image
and font loads for no benefit on a JSON API.

---

## 2. Rate limiting (express-rate-limit)

`backend/middleware/rate-limits.ts`. Buckets are per-IP and in-memory (one set
per process). If the API is ever scaled to N replicas the effective limit
becomes N × the number below; that is an accepted tradeoff versus putting Redis
in the request path for a control that should fail open.

`app.set('trust proxy', TRUST_PROXY_HOPS ?? 1)` in `index.ts` makes `req.ip` the
real client address behind the Railway edge / VPS nginx. It is a **hop count,
never `true`** — trusting every hop would let a caller spoof `X-Forwarded-For`
and mint a fresh bucket per request.

| Bucket | Applies to | Limit | Env override |
| --- | --- | --- | --- |
| global | everything not exempt | 1000 / 15 min | `RATE_LIMIT_GLOBAL_MAX` |
| auth | `/api/auth`, `/api/account` | 60 / 15 min | `RATE_LIMIT_AUTH_MAX` |
| admin | `/api/admin/*` | 300 / 5 min | `RATE_LIMIT_ADMIN_MAX` |
| ai (writes only) | `/api/ai`, `/api/mockups`, `/api/realistic-mockups`, `/api/image-flow`, `/api/designer`, `/api/imagination-station` | 60 / 10 min | `RATE_LIMIT_AI_MAX` |
| code-check | `/api/coupons`, `/api/gift-cards` | 40 / 10 min | `RATE_LIMIT_CODE_CHECK_MAX` |
| public-write (writes only) | `/api/support`, `/api/community` | 30 / 10 min | `RATE_LIMIT_PUBLIC_WRITE_MAX` |

**How the numbers were picked.** Every limit is far above what a human — or an
admin dashboard doing a full panel load, which fans out to a dozen endpoints —
produces, and far below what credential stuffing or code enumeration needs. The
AI and public-write buckets skip `GET` so status polling on a long-running job
never starves the budget; the code-check bucket meters reads too, because coupon
validation *is* a `GET`.

**Never throttled** (`EXEMPT_PREFIXES`): `/api/health`, `/api/webhooks`,
`/api/stripe/webhook`, `/api/email/webhooks`, `/api/ai/replicate`,
`/api/print-bridge`. Providers retry webhooks in bursts — a 429 there loses a
payment record or an inbound email — and uptime monitors poll health on a tight
interval.

**Kill switch:** `RATE_LIMIT_ENABLED=false` bypasses every limiter (the boot log
warns when it is set). Reach for it if a proxy misconfiguration ever collapses
every client onto one apparent IP.

**Not covered here:** the primary login and password-reset flows run against
Supabase Auth directly from the browser, so Supabase's own auth rate limits
govern them. What this protects is the backend surface: the legacy token
endpoints, the profile-lookup enumeration oracle, the unauthenticated
welcome-email endpoint, and every admin route.

---

## 3. Role cache and revocation

`backend/lib/role-cache.ts` backs both `requireAdmin` and `requireRole`.

- **TTL is 60s** (was 5 minutes). A cached role is a privilege that outlives the
  decision to revoke it; five minutes sat inside a typical incident-response
  window. 60s still absorbs the burst the cache exists for.
- **Role changes invalidate immediately.** `POST /api/admin/users/:userId/role`
  (`backend/routes/admin/users.ts`) updates `user_profiles`, writes the
  `ROLE_CHANGE` audit row, and calls `invalidateCachedRole` for the target (and
  for the acting admin, who may be demoting themselves). `AdminDashboard`'s role
  dropdown calls this route; if the API is unreachable it falls back to the old
  direct Supabase write, and the change then lands within the 60s TTL instead.
- **`requireRole` no longer trusts the JWT's role claim.** A token is minted for
  up to an hour, so honoring its copy of the role meant a demotion did not take
  effect until the session refreshed. Authorization now always resolves against
  `user_profiles` through the cache.
- **Out-of-band changes** (Supabase dashboard, SQL) are covered by the TTL, or
  can be flushed immediately:
  - `POST /api/admin/users/:userId/invalidate-role-cache`
  - `POST /api/admin/users/role-cache/flush` (everything)
  - `GET  /api/admin/users/role-cache/stats`

The cache is per-process, so a flush only clears the instance that served it.
With one API process per deploy that is the whole cache; with replicas, the 60s
TTL is the guarantee.

---

## 4. Browser app headers (`vercel.json` + `server-static.mjs`)

Vercel serves the SPA in production; `server-static.mjs` is the Railway/VPS path
to the same bundle. **The two policies are duplicated on purpose — change both.**

CSP, in one line per intent:

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Baseline. |
| `script-src` | `'self' https://js.stripe.com https://unpkg.com https://ajax.googleapis.com https://www.googletagmanager.com` | The only scripts the bundle loads: Stripe.js, `@google/model-viewer` (loaded from unpkg by `Model3DViewer`, from ajax.googleapis by `ToyAR`), and vendor-storefront GA. **No `'unsafe-inline'` and no `'unsafe-eval'`** — verified: the built `dist/index.html` contains zero inline `<script>` blocks and the bundle contains zero `eval(` / `new Function(` sites. Adding an inline script to `index.html` will break the site; use a module instead. (`<script type="application/ld+json">` in `api/product-meta.mjs` is a data block, not executable, and is not covered by `script-src`.) |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | React inline `style` attributes require `'unsafe-inline'`; Google Fonts serves the stylesheet. |
| `font-src` | `'self' data: https://fonts.gstatic.com` | Google Fonts payload. |
| `img-src` / `media-src` | `'self' data: blob: https:` | Product imagery comes from Supabase storage, GCS, unsplash, jsdelivr, vendor-supplied URLs and freshly generated blobs. Enumerating them would break a feature the first time a new bucket appears; `https:` still blocks plaintext sources. |
| `connect-src` | `'self' https: wss:` | Supabase (REST + realtime), the API, Stripe, Shippo. Same tradeoff as above. **This is the loosest directive and the one worth tightening once traffic is observed.** |
| `frame-src` | `'self'` + Stripe (`js.stripe.com`, `hooks.stripe.com`, `m.stripe.network`) + TikTok / YouTube / Instagram embeds | Payment iframes and social embeds. |
| `worker-src` / `child-src` | `'self' blob:` | Bundled workers. |
| `object-src` | `'none'` | No plugins, ever. |
| `base-uri` | `'self'` | Blocks `<base>` hijacking of every relative URL. |
| `form-action` | `'self'` | Blocks form-post exfiltration. |
| `frame-ancestors` | `'none'` | Clickjacking (with `X-Frame-Options: DENY` for older agents). |
| `upgrade-insecure-requests` | — | No mixed content. Localhost is exempt per spec, so local `http://127.0.0.1` testing still works. |

Also set: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
(one year, no `preload`), `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: geolocation=(), usb=(), interest-cohort=(), payment=(self "https://js.stripe.com")`
(payment is delegated to Stripe so Apple/Google Pay keep working; features not
listed keep their `self` default), `X-XSS-Protection: 0` (was `1; mode=block` —
see §1), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.

### Rolling back HSTS

Browsers cache HSTS for the full `max-age`, so a bad rollout is not fixed by
deleting the header. To back out, ship `max-age=0` (optionally keeping
`includeSubDomains`) and leave it deployed long enough for clients to pick it
up. `includeSubDomains` requires **every** `*.imaginethisprinted.com` host to
serve HTTPS; today they all do (Vercel + Cloudflare + the API).

---

## 5. Client-side exposure

`window.supabase` was assigned unconditionally in `src/lib/supabase.ts`. The
anon key is public, but the handle is not just the key — it is a live client
already holding the signed-in user's session, so any script that runs in the
page (XSS, a hostile extension, a pasted "fix" in the console) could read and
write every row that user's RLS policies allow. It is now behind
`import.meta.env.DEV`, which is statically `false` in the production build, so
the block is dropped at build time.

Gated the same way, for the same reason:

| Handle | File |
| --- | --- |
| `window.supabase` | `src/lib/supabase.ts` |
| `window.refreshSession`, `window.hardResetAuth` | `src/main.tsx` (auth levers — `hardResetAuth` wipes stored credentials) |
| `window.testDatabaseConnectivity`, `window.logEnvironmentInfo` | `src/utils/debug.ts` |
| `window.testConnectivity` | `src/utils/connectivity-test.ts` |
| `window.checkEnvironment` | `src/utils/env-check.ts` (the production console auto-diagnostic still runs; only the callable handle is withheld) |

Verify after a build:

```bash
npm run build
grep -ro "window\.supabase" dist/assets/ | wc -l   # expect 0
grep -ro "\.hardResetAuth=" dist/assets/ | wc -l   # expect 0
```

Known, unchanged: `src/lib/authDebug.ts` logs auth state changes (including a
20-character access-token prefix) to the console in production. Console noise,
not a handle — left alone here.

---

## Verifying

```bash
# Headers + limiter behaviour, no DB or .env required
cd backend && npm run verify:security

# Types
cd backend && npm run typecheck
npm run typecheck            # (repo root)

# Full frontend build — also the CSP check (see §5)
npm run build
```

`backend/scripts/verify-security-middleware.ts` boots a throwaway app on an
ephemeral port and asserts the helmet headers, that a metered route 429s past
its limit, that `RateLimit` headers are emitted, and that exempt paths are never
throttled.

Manual spot check against a running API:

```bash
curl -sD - -o /dev/null https://api.imaginethisprinted.com/    # expect HSTS, CSP, nosniff, DENY
for i in $(seq 1 5); do curl -so /dev/null -w "%{http_code} " \
  -X POST https://api.imaginethisprinted.com/api/admin/users/x/role; done   # 401s, then 429 once the bucket empties
```

---

## Open follow-ups

1. **Tighten `connect-src`.** It is `https:` today. Enumerating the real host
   set (Supabase, the API, Stripe, GCS, Shippo) closes the XSS-exfiltration path
   that a wildcard leaves open — worth doing with a report-only rollout first.
2. **Shared-store rate limiting** if the API is ever scaled past one process.
3. **HSTS preload** for `imaginethisprinted.com` is a deliberate, hard-to-undo
   submission; deferred.
