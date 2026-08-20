# Security audit — Round 1 (Watchtower task `e3e4f5de-1f5a-4a27-b819-42c6befc9c2f`)

**Auditor:** Lucas Blaze · **Date:** 2026-08-19 · **Branch:** `earth/lucas-blaze/loop-r1-sifu-security-pa-e3e4f5de-mt0r0ydi`

Round 1 of a 3-round review loop. Scope: exposed secrets, missing authn/authz,
injection vectors, unsafe env handling, CORS, and dependencies.

This audit landed on a codebase that has already been through several hardening
passes (2026-08-06 RLS work, 2026-08-16 helmet/rate-limit/trust-proxy, the
service-role env guard of 2026-08-19). Most of what a first-pass scanner flags
here is already closed and deliberately commented as such. What follows is what
was **still open**.

---

## Findings, ranked

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | `/api/admin/imagination-products/*` had no authentication at all | **Fixed** |
| 2 | **High** | `GET /api/profile/get` leaked the full `user_profiles` row (PII) to anyone | **Fixed** |
| 3 | **High** | Frontend Shippo integration is designed to put a live postage key in the public bundle | Already fixed on an unmerged branch — blocked on task `be0019f2` |
| 4 | **High** | Dependency tree: 2 critical / 29 high advisories across root + backend | Task `be391382` |
| 5 | **Medium** | Support live-chat: sender identity taken from the request body (impersonation) | **Fixed** |
| 6 | **Medium** | Guest support chat has no per-ticket capability — any ticket id reads/writes/escalates | Task `73487f1e` |
| 7 | **Medium** | `POST /api/gift-cards/redeem` unauthenticated, credited a body-supplied `userId` | **Fixed** |
| 8 | **Medium** | `POST /api/coupons/apply` unauthenticated write against coupon usage counters | **Fixed** |
| 9 | **Low** | `script-src` allowed `unpkg.com` + `ajax.googleapis.com`, neither used | **Fixed** |
| 10 | **Low** | Shared-secret bearer compares were not constant time (print bridge, UGC inbound) | **Fixed** |
| 11 | **Low** | `timingSafeEqual` on unequal-length buffers threw → 500 instead of 401 | **Fixed** |
| 12 | **Low** | Manager cost-assistant reply rendered into `dangerouslySetInnerHTML` unescaped | **Fixed** |
| 13 | **Low** | Migration files still contain the wide-open RLS policies dropped on live prod | Task `82d4ae2e` |

---

### 1. Critical — unauthenticated admin pricing router

`backend/routes/admin/imagination-products.ts`, mounted at
`/api/admin/imagination-products` (`backend/index.ts:278`).

Five routes, **zero** middleware: `GET /`, `POST /init`, `PUT /:id`,
`POST /size`, `DELETE /size`. `/api/admin` only carries `adminLimiter`, which is
a rate limit, not an authorization check. Any anonymous caller could read the
Imagination Station product config, reprice any product, add or delete a size
tier, or re-seed the whole table from config — and `backend/routes/stripe.ts`
prices checkout off exactly that table (`services/imagination-products.ts`).

The sibling router `admin/imagination-pricing.ts` already had the correct guard
pair; this one was simply missed.

**Fix:** `router.use(requireAuth)` + `router.use(requireAdmin)`. The only client
(`src/lib/api.ts:731-734`, behind the `admin`-gated `/admin/imagination-products`
route) already sends the Supabase bearer token, so no client change was needed.

### 2. High — full profile PII readable by anyone

`backend/routes/user.ts`, `GET /get` — mounted twice, at `/api/users/get` and
`/api/profile/get`.

The handler ran unauthenticated and did `select('*')` on `user_profiles` through
`backend/lib/supabase.ts`, which is the **service-role** client — so RLS never
applied. Any caller with a user id got that user's `email`, `first_name`,
`last_name`, `phone`, `shipping_*`, `tax_id`, `stripe_account_id`,
`credit_limit`, `itc_balance` and `role`.

This is the same exposure `supabase/migrations/20260806_security_round2.sql`
closed at the database layer by introducing `public.public_profiles`; the API
layer had re-opened it.

**Fix:** `optionalAuth`; the owner and admins still get the full row, everyone
else gets exactly the `public_profiles` column list, and only when
`is_public = true`. A private profile returns the same 404 as a missing one so
existence can't be probed. Logic extracted to `fetchVisibleProfile()` and pinned
by `backend/routes/user.profile-visibility.test.ts` (4 cases), which asserts the
sensitive columns are never even *selected*, not just never returned.

Note: the one in-repo caller, `src/utils/profile-service.ts`, is dead code — it
reads a bearer from `localStorage.getItem('auth_token')` (nothing ever writes
that key) and uses a relative `/api` base that resolves to the SPA on Vercel.
Worth deleting in a later round.

### 3. High — Shippo key would ship to the browser

`src/utils/shippo.ts` calls `https://api.goshippo.com` **from the browser** with
`Authorization: ShippoToken ${import.meta.env.VITE_SHIPPO_API_TOKEN}`. Every
`VITE_*` value is inlined into the public JS bundle. A live Shippo token buys
postage with real money and can read every shipment, label and customer address
on the account.

Nothing has leaked — the token is unset, the module is in mock mode, and a scan
of the deployed bundles found no `ShippoToken`, `sk_live_`, `service_role` or
`goshippo` string. The live risk is that the admin UI *instructed operators to
set it*: "Set `VITE_SHIPPO_API_TOKEN` to buy real labels."

**No fix landed on this branch, deliberately.** The correct fix already exists:
commit `a2f069c` on `earth/lucas-blaze/move-shippo-label-purcha-1199ada7-ms3evqf3`
deletes `src/utils/shippo.ts` outright and replaces it with
`POST /api/orders/:orderId/shipping-label` behind `requireAuth` +
`requireRole(admin, manager)`, using a server-only `SHIPPO_API_TOKEN`. That
branch is unmerged and blocked on Watchtower task
`be0019f2-9045-4be6-a1f4-1f7b11642e0d` ("Deploy Shippo label route and verify
with one live purchase"), which needs a real ~$6.23 label purchase to close.

Hardening the file here would have produced a modify/delete merge conflict
against a branch that removes it, for no security gain over merging that branch.
Nothing new was filed — `be0019f2` is the task.

Same latent class, lower stakes, and NOT covered by that branch:
`src/utils/{connectivity-test,debug,env-check}.ts`,
`src/components/StorageSettings.tsx` and `src/pages/TestPage.tsx` read
`import.meta.env.AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `DATABASE_URL`.
Vite's default `envPrefix` means these are always `undefined` today, so nothing
leaks — but adding a prefix, or a `define:` entry, would publish AWS credentials
and the Postgres URL. Those readers are dead code (`src/utils/storage.ts` is
documented as unused in `vite.config.ts`) and should be deleted — task `e6965776`,
which also covers deleting the dead `src/utils/profile-service.ts` noted above.

### 4. High — dependency advisories

`npm audit` at the repo root: **1 critical, 17 high, 27 moderate, 4 low**.
`backend/`: **1 critical, 12 high, 8 moderate, 1 low**.

The ones that touch request-handling paths rather than build tooling:

- `sharp` — libvips CVE-2026-33327/33328/35590/35591. The backend runs `sharp`
  over **user-uploaded images** (`services/bg-key.ts`, `dtf-optimizer.ts`,
  `halftone.ts`, `image-metrics.ts`). Highest real-world exposure of the set.
- `axios` — NO_PROXY normalization SSRF, prototype-pollution auth bypass.
- `express` / `body-parser` / `path-to-regexp` / `qs` — request-path DoS + ReDoS.
- `react-router` / `react-router-dom` — XSS via open redirect.
- `fast-xml-parser` (critical), `form-data` CRLF injection, `undici`, `ws`,
  `multer`, `jws` HMAC verification weakness.

Not remediated here: the fixes are major-version bumps (React Router in
particular), and this worktree's `node_modules` is a junction into the shared
checkout, so an `npm audit fix` from here would mutate another session's tree.
Filed as task `be391382-a0e5-4e1f-9cac-a8bc9f6c0d89`.

### 5-6. Medium — support live chat

`backend/routes/admin/support.ts` deliberately exposes four unauthenticated
routes at the bottom of the file for the customer-facing chat widget:
`GET /tickets/:id/messages/poll`, `POST /tickets/:id/messages`,
`POST /tickets/:id/escalate`, `GET /tickets/:id/live-status`.

Two separate problems:

**(5, fixed)** `POST /tickets/:id/messages` took `sender_id` straight from
`req.body.userId`. Anyone could post into a ticket stamped as any user they
named, and both the agent console and the customer transcript render that
attribution. The sender is now the verified JWT subject via `optionalAuth`; the
body's `userId` is ignored. A genuine guest still posts with `sender_id: null`,
exactly as before. Also added: a UUID shape check on the ticket id (so a
malformed id can't surface a Postgres cast error) and a 5,000-character cap.

**(6, filed)** Ownership is still not enforced on any of the four — a ticket UUID
is the only thing standing between a caller and reading, writing to, or
escalating someone else's ticket. Fixing that properly means issuing a per-ticket
capability token (the pattern `utils/order-status-token.ts` already uses for
guest order status), which is a design change, not a hardening tweak.

### 7-8. Medium — value endpoints without a session

- `POST /api/gift-cards/redeem` was unauthenticated and credited ITC to whatever
  `userId` the body carried. **Fixed:** `requireAuth`, credited account is always
  the JWT subject. The sole caller (`src/pages/Wallet.tsx`, behind
  `ProtectedRoute`) already sends the token through `apiFetch`.
- `POST /api/coupons/apply` was an unauthenticated write into
  `recordCouponUsage`, which increments `coupons.current_uses` and inserts a
  usage row — i.e. an anonymous caller could burn a promotion to its cap or forge
  usage history. Nothing in the app calls it (real checkout records usage
  server-side in `services/order-payment.ts` and `routes/wallet.ts`).
  **Fixed:** `requireAuth`, user taken from the token.

Code enumeration on the `/validate` reads was already handled — `codeCheckLimiter`
covers both `/api/coupons` and `/api/gift-cards` (`backend/index.ts:233`).

### 9-12. Low — fixed

- `vercel.json` `script-src` allowed `https://unpkg.com` and
  `https://ajax.googleapis.com`. Neither appears anywhere in the source, the
  built bundle, or `index.html`; both are arbitrary-package CDNs, so allowing
  them widens the blast radius of any HTML injection for no benefit. Removed.
- `requireBridgeAuth` (`print-bridge.ts`) and the UGC inbound guard (`social.ts`)
  compared the shared secret with `!==`, which leaks the prefix through response
  timing. Both now use a length-checked `crypto.timingSafeEqual`, matching
  `middleware/requireStorefrontSecret.ts`. The print bridge is explicitly exempt
  from the global rate limiter, so attempts there are unmetered.
- `ai/replicate-callback.ts` called `crypto.timingSafeEqual` on buffers of
  possibly different lengths, which throws `RangeError` — inside the route's
  `try`, so a wrong-length forged signature produced a 500 instead of a clean
  401. Length is compared first now.
- `src/pages/ManagerDashboard.tsx` rendered the cost-assistant reply through
  `dangerouslySetInnerHTML` after a bare `**bold**`/newline regex pass. The reply
  is model output composed over database values other roles can write. Now
  HTML-escaped first, then the two intended tags are re-added
  (`renderAssistantHtml`).

### 13. Low — migration files vs. live database

`supabase/migrations/002_rls_policies.sql`,
`20251219_coupons_giftcards_support.sql` and several others still contain the
`FOR ALL USING (true)` / `WITH CHECK (true)` policies that were dropped directly
against production on 2026-08-06 and 2026-08-19. Live prod is fine; a rebuild
from migrations is not. Filed.

---

## Checked and found already closed

Worth recording so round 2 doesn't re-audit them:

- **CORS** (`backend/index.ts:171-192`) — explicit allowlist, `origin: true` only
  under `NODE_ENV=development`, plus a boot-time assertion that refuses to start
  if a future edit makes permissive CORS reachable in production.
- **Auth model** (`middleware/supabaseAuth.ts`) — HS256 verification with a
  pinned issuer; role is deliberately never read from the JWT (`user_metadata` is
  client-writable) and always resolves through `lib/role-cache.ts` against
  `user_profiles`. Cache TTL is 60s with explicit invalidation.
- **Security headers** — helmet on the API with a `default-src 'none'` API-shaped
  CSP, HSTS, frameguard; a full document CSP in `vercel.json`.
- **Rate limits** — global + auth + admin + AI + code-check + public-write
  buckets, with webhook/health exemptions.
- **Webhook signatures** — Stripe (raw body), Resend (svix), Supabase auth
  (fails **closed** when the secret is unconfigured), Replicate (rejects in
  production when `AI_WEBHOOK_SECRET` is missing).
- **Checkout** — the client-supplied `amount`, tax, discount and shipping are
  recomputed server-side; ITC credit and per-user coupon limits only honor a
  JWT-authenticated `trustedUserId`, never the body's.
- **Guest order status** — HMAC token (`utils/order-status-token.ts`), minimal
  projection, identical 404 for bad token and missing order.
- **Kiosk sessions** — per-device secret exchange for a short-lived hashed token;
  one generic failure message to prevent kiosk-id enumeration.
- **Media proxy** (`routes/media.ts`) — prefix allowlist, `..`/backslash
  rejection, `users/**` deliberately unreachable.
- **`window.supabase`** — now gated behind `import.meta.env.DEV`, so the
  production build ships no session-bearing console handle.
- **Injection** — no `child_process` anywhere in `backend/`, `api/` or `src/`.
  All raw SQL (`client.query`) lives in operator-run migration scripts reading
  `.sql` files; every request-path query goes through the Supabase query builder.
  One `innerHTML` assignment (`src/pages/MyOrders.tsx:417`) writes a static SVG
  placeholder with no interpolation.
- **Secrets in the repo** — no `.env` file is tracked; all `*.example` files hold
  placeholders. A scan of all 628 commits found no service-role key, no
  `sk_live_`, and no AWS key ever committed. The Supabase **anon** key does
  appear in old commits (`get-user-token.mjs`, `scripts/update_product_variants.ts`)
  — that key is public by design, and its rotation is already tracked separately.
- **Env handling** — `backend/lib/supabase-env-guard.ts` refuses to boot on a
  wrong-project or wrong-role service key; `load-env.ts` resolves from the module
  path with `override: true`.

---

## Verification

- `npx vitest run` — **58 files / 752 tests pass** (4 new).
- `tsc -p tsconfig.app.json --noEmit` — clean.
- `backend/ tsc --noEmit` — clean apart from six pre-existing `TS2742` notices in
  `middleware/rate-limits.ts`, which are an artifact of this worktree's
  cross-drive `node_modules` junction (they name a `D:/` path) and are absent on
  a local install.
- `npm run build` — succeeds.
- `eslint` on all 12 changed files — 0 errors (139 pre-existing `no-explicit-any`
  style warnings).

---

## Watchtower tasks filed

| Task | Severity | Title |
|---|---|---|
| `be391382-a0e5-4e1f-9cac-a8bc9f6c0d89` | High | Upgrade vulnerable dependencies (2 critical / 29 high) |
| `73487f1e-3be0-4825-8d60-70a5d3a60a27` | Medium | Guest support chat has no per-ticket capability |
| `82d4ae2e-cbfa-4331-9eda-51fa6a22d774` | Medium | Migration files still create the wide-open RLS policies dropped on prod |
| `e6965776-4307-4a5c-9874-8ecce13c98b2` | Low | Delete the dead frontend modules reading AWS/DATABASE_URL env |

Not filed, because a task already covers it:
`be0019f2-9045-4be6-a1f4-1f7b11642e0d` (Shippo label route — finding 3).
