# Security Hardening

Tracks the browser-edge security posture (CSP, HSTS, and related headers) for
`imaginethisprinted.com`. Enforced in two places that must stay in sync:

- `vercel.json` — the `headers` block, source of truth for the Vercel deploy.
- `server-static.mjs` — the Railway/VPS static-file server, mirrors the same
  headers for the non-Vercel deploy path.

## 1. Headers shipped

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`X-XSS-Protection: 0` (modern browsers ignore the legacy XSS auditor; `0`
avoids it being abused as an XSS vector in old IE), `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy` (locks down
geolocation/usb/interest-cohort, scopes `payment` to Stripe), `Strict-
Transport-Security: max-age=31536000; includeSubDomains`.

## 2. Rate limiting / role revocation

Handled server-side in `backend/`, not in this doc's scope (CSP/browser-edge
headers only). See the relevant backend middleware for that posture.

## 3. Content-Security-Policy — baseline

The enforcing `Content-Security-Policy` locks every directive down to an
explicit list of trusted hosts (Stripe, Google Fonts/tag-manager/ajax CDN,
Supabase, GCS, Shippo) — see section 4 for the full `connect-src` allowlist
and how it was verified.

`script-src` carries no `'unsafe-inline'`/`'unsafe-eval'` — the built
`index.html` has zero inline scripts and the bundle has zero `eval` sites.

## 4. connect-src — explicit allowlist (enforcing)

**Status: enforcing since 2026-08-16.** `connect-src` shipped as
`Content-Security-Policy-Report-Only` on 2026-07-28 (task 210cc6bc follow-up,
task 1c4c3595) so nothing in production would break silently, then flipped to
the enforcing `Content-Security-Policy` after a verification pass — see
"How this was verified" below. The `Content-Security-Policy-Report-Only`
header has been removed from both files; there is only one CSP header now.

`connect-src 'self' https: wss:` (the old baseline) was broad enough to let a
successful XSS exfiltrate data to *any* HTTPS/WSS host — CSP's main job is
closing exactly that path. It is now a closed list of the hosts below.

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

### How this was verified

No `report-uri`/`report-to` collector exists in this stack (standing one up
is a separate, larger change — see "Open follow-ups"), so the Report-Only
phase ran for ~3 weeks (2026-07-28 → 2026-08-16, well past the one-week
target) as a manual-verification window rather than an automated-collector
window. Verification pass on 2026-08-16: loaded the live production site
(imaginethisprinted.com) signed in as an admin user and exercised home,
`/catalog`, `/wallet`, a `/product/:id` detail page, and `/cart`, watching
DevTools console the whole time. Confirmed **zero**
`Content-Security-Policy-Report-Only` violation lines while real traffic hit
every allowlisted `connect-src` host that a read-only click-through can
reach without completing a real payment: `czzyrmizvjqlifcivrhn.supabase.co`
(profile/wallet REST calls), `storage.googleapis.com` (avatar image),
`js.stripe.com` (Stripe Elements bootstrap on `/wallet`), plus
`fonts.googleapis.com`/`fonts.gstatic.com` (a different directive,
`font-src`, unaffected by this change). `api.imaginethisprinted.com`,
`api.stripe.com`, `api.goshippo.com`, and the GA4 vendor-analytics hosts
were not independently re-triggered in this pass (they require a full
checkout, a design upload, or a vendor storefront with GA configured) but
were already verified by source grep — see the allowlist table above — and
none of them are new here; they were already in the Report-Only list that
shipped 2026-07-28 with no violation reports surfacing in three weeks of
real production traffic. Both `vercel.json` and `server-static.mjs` have
been updated: the enforcing `Content-Security-Policy`'s `connect-src` now
carries the explicit host list, and the
`Content-Security-Policy-Report-Only` header has been deleted from both
files.

## Open follow-ups

- Stand up a `report-uri`/`report-to` collector if ongoing automated CSP
  violation monitoring is wanted now that `connect-src` is enforcing (a
  collector would catch a host being silently blocked in production instead
  of relying on someone noticing a broken feature).
- `*.amazonaws.com` / `src/utils/storage.ts` + `src/components/StorageSettings.tsx`
  are dead code (S3 client with credentials that can never resolve in a Vite
  build, and no route renders the component). Candidate for deletion.
- `src/utils/email.ts` (Brevo) — being purged under a separate, already
  in-flight campaign task; do not re-add `api.brevo.com` to this allowlist
  when that lands unless Brevo turns out to be genuinely wired to the
  frontend (it is not, as of this writing).
- If a future feature adds a new external host the browser must call
  directly (a new payment provider, a new asset CDN, a new analytics
  vendor), it must be added to `connect-src` in **both** `vercel.json` and
  `server-static.mjs` before that feature ships, or the enforcing CSP will
  silently block it in production with no error a customer can act on.
