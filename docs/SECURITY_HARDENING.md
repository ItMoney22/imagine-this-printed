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
