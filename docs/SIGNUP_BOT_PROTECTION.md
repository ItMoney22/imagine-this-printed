# Signup bot protection

**Watchtower task** `4d915741-ef3f-4f20-bd15-31cea0069fc7` · Sifu · 2026-09-22

What this covers: the three separate holes that let ~290 scripted signups onto the
store in September 2026, which of them are closed as of this document, and the one
remaining step that has to happen in the Supabase and Cloudflare dashboards.

---

## 1. What actually went wrong

Three independent failures stacked, and each one made the next one worth doing:

| # | Hole | State |
|---|------|-------|
| 1 | No bot challenge anywhere in the signup flow | **Code shipped, needs two dashboard keys to enforce** |
| 2 | Every new account was minted 500 ITC by a database trigger | **Closed — applied to production 2026-09-22** |
| 3 | Welcome email was sent from an unauthenticated endpoint to an address taken straight out of the request body | **Closed — applied to production 2026-09-22** |

Hole 2 is what made hole 1 profitable: ~145,000 ITC of AI-generation credit walked out
on accounts nobody created on purpose. Hole 3 is what made it visible — branded mail
from `imaginethisprinted.com` landed in scraped corporate inboxes, which is a sending
reputation problem long after the accounts are deleted.

---

## 2. The wallet mint (closed)

Production's `public.create_user_wallet()` read:

```sql
INSERT INTO user_wallets (user_id, points, itc_balance)
VALUES (NEW.id, 0, 500)          -- unconditional
ON CONFLICT (user_id) DO NOTHING;
```

fired by `trigger_create_user_wallet AFTER INSERT ON public.user_profiles`.

The part that hid it for months: `handle_new_user()` also inserts the wallet, at 0.00,
and *loses*. `on_auth_user_created` → `handle_new_user()` inserts the profile row, that
insert fires `trigger_create_user_wallet`, the wallet is created at 500, and
`handle_new_user()`'s own zero-balance insert then hits its `ON CONFLICT (user_id) DO
NOTHING` and quietly does nothing. So the column default (0), the schema,
`handle_new_user()`, `COMPLETE_DATABASE_SETUP.sql` and
`supabase/migrations/003_user_triggers.sql` **all said zero**, and every account still
got 500. Reading the repo would never have told you.

Fixed in `supabase/migrations/20260922120000_signup_wallet_and_welcome_email.sql`:
zero balances on every path, plus `SET search_path` on a `SECURITY DEFINER` function
that did not have one.

**Decision — no welcome credit on confirmation either.** ITC is the spend control in
front of every paid AI lane (Imagination Station, Toy Creator, Metal Art Studio,
Creator Studio, try-on), all of which bill real Replicate/OpenAI money per generation.
A credit granted by a trigger is a faucet that opens the moment anyone can insert a
row. If a welcome credit is wanted, it belongs in a server-side grant on the service
role, keyed to a confirmed account and revocable in one place.

### Verified live, not assumed

A real row was inserted into `auth.users` on production and the resulting wallet read
back: `points 0, itc_balance 0.00, usd_balance 0.00, total_earned 0.00, total_spent
0.00`. The probe user was then deleted; the account count is unchanged at 5.

---

## 3. Welcome email (closed)

Two paths existed. Both are gone.

**`POST /api/account/send-welcome-email`** took an `email` out of the request body,
with no authentication, and mailed it. Anyone who knew the URL could send our branded
welcome mail to any inbox on earth without creating an account. It now:

1. requires a Supabase access token (`Authorization: Bearer …`),
2. reads the destination address out of that **verified token**, never the body,
3. refuses accounts whose address is not confirmed,
4. sends at most once per account ever, stamped on
   `user_profiles.welcome_email_sent_at` — a durable column, replacing an in-process
   `Map` that forgot everything on each Render restart and was per-instance anyway.

It is called from `src/pages/AuthCallback.tsx`, the one place where a **confirmed**
session first exists — an email-confirmation link and an OAuth return both land there.
It used to be called straight after `signUp()`, where the address is still unproved.

**Trigger `on_auth_user_welcome_email`** (`send_welcome_email_webhook()`) was dropped.
It fired `net.http_post()` at `/api/webhooks/supabase-auth` on *every* `auth.users`
INSERT, confirmed or not — and sent no `x-webhook-secret`, so the receiving route
(which fails closed) has answered 401/503 to every one of them. It was a per-signup
unauthenticated outbound HTTP request from inside the database that could never
deliver anything.

**The trade, stated plainly:** delivery now depends on the customer's browser reaching
`/auth/callback`. A missed welcome email is a far cheaper failure than branded mail
landing in a scraped inbox. To restore a browser-independent path, see the note at the
bottom of the migration file — it needs a trigger on the `email_confirmed_at`
NULL → NOT NULL transition, `SUPABASE_WEBHOOK_SECRET` provisioned on Render *and* in a
DB setting, and the same `welcome_email_sent_at` dedupe taught to
`backend/routes/webhooks.ts` so the two paths cannot double-send.

`backend/routes/webhooks.ts` is left in place and still fails closed; nothing calls it.

---

## 4. Captcha — the half that still needs dashboards

### Code that has shipped

| File | What it does |
|---|---|
| `src/lib/captcha.ts` | Site key, `isCaptchaConfigured()`, action names |
| `src/components/TurnstileWidget.tsx` | Renders the challenge, no npm dependency |
| `src/context/SupabaseAuthContext.tsx` | Optional `captchaToken` on `signUp` / `signIn` / `resetPassword` / `signInWithMagicLink` |
| `src/pages/Signup.tsx`, `src/pages/Login.tsx`, `src/components/AuthModal.tsx` | Widget rendered; submit held until solved |
| `vercel.json` | `challenges.cloudflare.com` allow-listed in `script-src`, `frame-src`, `connect-src` |

That CSP line is not optional. Without it the widget is blocked, renders nothing, and
signup fails with no visible cause.

**All four GoTrue endpoints carry a token, not just signup.** Supabase's Bot & Abuse
Protection applies to signup, password sign-in, magic link and password reset
together. Gating only signup would lock customers out of the other three the moment
the dashboard toggle is flipped. Google OAuth is genuinely exempt — it leaves for
Google's domain and returns through `/auth/callback`, never touching a
captcha-protected endpoint.

`src/pages/ClaimAccount.tsx` auto-signs-in a guest who has just set a password, and
carries no token on purpose: that flow is already gated by a signed, order-scoped link
a bot cannot guess, and a challenge there would tax a conversion flow for nothing. Once
the toggle is on, GoTrue will refuse that one call, so the success screen now says
"sign in with the password you just chose" and links to `/login` instead of promising a
redirect that never arrives.

### What is still needed (dashboard access, not code)

**Step 1 — Cloudflare, create the widget.** Dashboard → Turnstile → Add widget.
Domains: `imaginethisprinted.com`, `www.imaginethisprinted.com`, `localhost`.
Mode: Managed. This yields a **site key** and a **secret key**.

> Attempted and blocked on 2026-09-22: the `CLOUDFLARE_API_TOKEN` in the vault can
> *list* Turnstile widgets but returns `10000 Authentication error` on create — it
> lacks `Turnstile: Edit`. Either widen that token or create the widget by hand.

**Step 2 — Vercel, publish the site key.** Set `VITE_TURNSTILE_SITE_KEY` for Production
and Preview, **and redeploy**. Vite inlines `VITE_*` at build time; setting the variable
without a rebuild changes nothing.

**Step 3 — look at production.** `/signup` and `/login` must show the widget, and the
submit button must stay disabled until it solves. No red "For testing only" band — that
band means a Cloudflare test key shipped.

**Step 4 — Supabase, turn on enforcement.** Dashboard → Authentication → Attack
Protection → Enable Captcha protection → provider **Turnstile** → paste the **secret**
key. The secret goes here and nowhere else: not in this repo, not in `.env.local`, not
in Vercel.

> Attempted and blocked on 2026-09-22: `SUPABASE_MANAGEMENT_PAT_ITP` in the vault
> authenticates, but its account can only see the `Imagine This Auction` project
> (`qdiodkevkacgbfvplafm`) — not `czzyrmizvjqlifcivrhn`. `PATCH
> /v1/projects/czzyrmizvjqlifcivrhn/config/auth` returns 403. A PAT from the account
> that owns the store project would let this step be automated.

**Order matters.** Step 4 before steps 2–3 means GoTrue demands a token no deployed page
produces, and signup, password sign-in, magic link and password reset all fail at once.

### Proving it works, after step 4

- Signing up with the challenge unsolved must fail. The button is disabled in the UI, so
  drive it from the console: `supabase.auth.signUp({email, password})` with no
  `captchaToken` must return a captcha error, not a user.
- Swap the local site key to Cloudflare's always-blocks test key
  (`2x00000000000000000000AB`) and confirm the form refuses to submit.
- A real signup must land with `itc_balance = 0` and exactly one welcome email, sent
  only after the confirmation link is clicked.

---

## 5. Left open, on purpose

- **`anon` still holds an INSERT grant on `public.user_wallets`.** The
  `"Users can insert own wallet at zero"` policy makes it harmless (every balance
  column is forced to 0), but the grant itself is wider than it needs to be. Part of
  the broader "anon holds write grants on 89 tables" sweep, not this task.
- **A user can clear their own `welcome_email_sent_at`.** `user_profiles` has a
  self-update policy, and revoking one column from a table-level UPDATE grant is not
  something Postgres supports without restructuring every other column grant. Worst
  case: someone re-sends themselves their own welcome email, into their own confirmed
  inbox, behind the `/api/account` rate limiter. Noted, not worth the blast radius.
- **`COMPLETE_DATABASE_SETUP.sql` still describes a `user_wallets` that does not
  exist** (`points_balance`, `lifetime_*`). It was already wrong before this task; the
  migration documents the real column names.

---

## 6. 2026-10-07 — the second wave, the contact form and inbound mail (Zero Nine, task 673c0b4a)

**What was happening.** All 152 signups from 2026-09-23 to 2026-10-07 were bots: a
scraped real person's address, random letters for a name ("Izoui Waugcj"), sent
through the real Signup form (their metadata keys match `signUp()` exactly). Every
one made Supabase send a confirmation email to a stranger. Separately, 569 of 572
support tickets were one bot posting random strings straight to the API; until
17ecd4c each fired an admin alert and a "we got your ticket" email to the address it
typed.

**What is live now (no deploy needed):**

| Piece | Where | Effect |
|---|---|---|
| Contact-form content guard | `backend/lib/spam-guard.ts` (17ecd4c, main) | Bot-shaped tickets and Jev-confident spam are stored `category=spam, status=closed`, no admin alert, no email, normal 201. `support_tickets.status` has a CHECK of open/in_progress/resolved/closed, so "spam" lives in `category`. |
| Bot-signup flag | `supabase/migrations/20261007120000_signup_bot_flag.sql` (applied + tracked) | `on_auth_user_flag_bot` marks strong new bot signups in `user_profiles.metadata.bot_suspect`. All 152 existing bot accounts marked; nothing deleted. |
| Dormant signup gate | same migration, `on_auth_user_gate_bot` | Refuses strong bot signups only while `admin_settings.signup_bot_gate = "block"`. Off by default; proven on and off live with probe accounts. |

**What ships with the next deploy (branch `earth/zero-nine/itp-stop-the-spam-and-lo-673c0b4a-muy9vxe1`):**

- Signup form + auth modal honeypot (`src/components/HoneypotField.tsx`): filled = fake success, nothing sent.
- Contact form Turnstile widget + server check (`backend/lib/turnstile.ts`): once
  `TURNSTILE_SECRET_KEY` is set on Render, a post with no valid token gets a visible 400.
- Resend inbound webhook (`backend/lib/inbound-spam.ts`): Jev spam at 0.85+ is stored
  archived + read and NOT forwarded to the owner's phone; a sender past
  `INBOUND_FORWARD_MAX_PER_SENDER_HOUR` (5) an hour is stored but not forwarded.
  Unsigned/forged webhook posts were already refused with 401 (svix check).
  The webhook is deliberately NOT rate-limited: a 429 to Resend loses real mail, and
  the signature already shuts out every caller that is not Resend.

**Keys, and where each one goes** (one Turnstile widget serves all three forms):

| Value | Where | When |
|---|---|---|
| Turnstile site key | Vercel `VITE_TURNSTILE_SITE_KEY` (Production + Preview), then redeploy | first |
| Turnstile secret | Render `TURNSTILE_SECRET_KEY` (API service) | after the site key is live |
| Turnstile secret | Supabase → Authentication → Attack Protection → Turnstile | after the site key is live |

Card 9fcb9c8a (Sifu) owns minting the widget; the vault's Cloudflare token cannot
create widgets and the vault's Supabase PAT cannot see this project (both still true
2026-10-07: management API answers 403).

**Bot-flag criteria** (`signup_bot_verdict`): mean letter-pair log-probability of the
two names under a model of ~1,600 real names; `strong` = score < -3.3 and neither name
appears in the email; `weak` = score < -3.0 and neither name in the email. Live flag
and gate use `strong` only (147/152 bots; 1 of 808 held-out real name pairs). The
backfill also marks `weak` accounts created since 2026-09-01 that never signed in and
have no orders (the other 5). Undo one: `update user_profiles set metadata = metadata - 'bot_suspect' where id = '<id>'`.
