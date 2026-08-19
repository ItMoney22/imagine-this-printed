# Security fix — anon could INSERT into `community_boost_earnings` and `user_profiles`

**Watchtower task** `1e03d8e0-e3e1-4e7b-b4b2-d46233e4756f` · **Sifu** · 2026-08-19
**Found by** Zero Nine while auditing grants for task `f8ecc070` (handoff
`E:/memory/watchtower/handoffs/handoff-zero-nine-1787162287620.json`)
**Migration** `supabase/migrations/20260819210000_drop_public_insert_policies.sql`
**Verifier** `scripts/verify-anon-insert-lockdown.mjs`

---

## The vulnerability

Two RLS policies on production were `FOR INSERT TO public WITH CHECK (true)`:

| Table | Policy | Origin |
|---|---|---|
| `public.community_boost_earnings` | `System can insert earnings` | `20251231000002_community_features.sql:246` |
| `public.user_profiles` | `Service role can insert profiles` | **no migration in this repo — prod drift** |

Both are named as if they scope writes to the backend. Neither does. `TO public`
is *every* role, `anon` included, and `anon` holds the `INSERT` grant on both
tables — so anyone with the publishable key that ships in the client bundle
could POST rows straight through PostgREST.

Impact, concretely:

* **`community_boost_earnings`** — unbounded, unauthenticated writes to the table
  that feeds the public `community_leaderboard` view, so creator ITC earnings
  totals could be fabricated by anyone. Also a free spam/storage surface.
* **`user_profiles`** — an anon INSERT carrying `role: "admin"` got past RLS and
  was stopped only by `user_profiles_id_fkey`. A foreign key is not an
  authorization boundary: any `auth.users` id without a profile row is a
  writable slot and the attacker picks the `role` column.

Neither policy was load-bearing. `service_role` and `postgres` both have
`rolbypassrls = true` (confirmed live), so the only real writers — the backend's
service-key client (`backend/lib/supabase.ts`, used by
`backend/routes/community.ts:739 creditCreatorITC`, the only writer to
`community_boost_earnings` in the codebase) and the `SECURITY DEFINER` signup
trigger `public.handle_new_user()` — never consult RLS at all.

## The fix

Drop both policies. Nothing added, no grant or row touched.

`user_profiles` keeps `"Users can insert own profile"`
(`WITH CHECK (auth.uid() = id)`) — the correctly-scoped version of the same
idea. `community_boost_earnings` is deliberately left with **no INSERT policy at
all**: no client should ever write its own earnings.

The migration ends with a `DO $$` guard that raises if either shape survives, so
replaying an older migration file cannot silently reopen the hole.

---

## Verification log

### 1. Dry run — 11/11, inside `BEGIN … ROLLBACK`

Impersonating `anon` / `authenticated` / `service_role` on the live database,
with the entire migration applied and rolled back:

```
BYPASSRLS: anon=false authenticated=false postgres=true service_role=true

=== BEFORE (policies still in place) — proving the hole ===
PASS  anon INSERT community_boost_earnings                           expect=OK        got=OK:1
PASS  anon INSERT user_profiles (bogus id -> FK 23503 = RLS PASSED)  expect=ERR:23503 got=ERR:23503
PASS  anon INSERT user_profiles role=admin (FK 23503 = RLS PASSED)   expect=ERR:23503 got=ERR:23503

=== APPLY the two DROP POLICY statements ===
remaining INSERT policies: [{"tablename":"user_profiles","policyname":"Users can insert own profile","cmd":"INSERT"}]

=== AFTER — anon must be locked out ===
PASS  anon INSERT community_boost_earnings                           expect=ERR:42501 got=ERR:42501
PASS  anon INSERT user_profiles                                      expect=ERR:42501 got=ERR:42501
PASS  anon INSERT user_profiles role=admin                           expect=ERR:42501 got=ERR:42501

=== AFTER — legitimate paths must still work ===
PASS  signup trigger handle_new_user() creates profile   [{"id":"a1ab7d4c-…","role":"customer"}]
PASS  authenticated INSERT own profile (auth.uid()=id)               expect=OK        got=OK:1
PASS  authenticated INSERT SOMEONE ELSE profile                      expect=ERR:42501 got=ERR:42501
PASS  service_role INSERT community_boost_earnings (backend writer)  expect=OK        got=OK:1
PASS  service_role INSERT user_profiles (admin scripts)              expect=ERR:23503 got=ERR:23503

RESULT 11 passed / 0 failed
ROLLED BACK. policies now: 12 rows: {"b":"0","p":"185","u":"185"}
```

### 2. BEFORE — `node --env-file=backend/.env scripts/verify-anon-insert-lockdown.mjs`

Real POSTs at `https://czzyrmizvjqlifcivrhn.supabase.co` carrying only the anon key:

```
FAIL  catalog: no `TO public WITH CHECK (true)` INSERT policy remains
      -- community_boost_earnings."System can insert earnings",
         user_profiles."Service role can insert profiles"
PASS  catalog: "Users can insert own profile" survived on user_profiles -- WITH CHECK (auth.uid() = id)

  anon table grants (informational -- RLS is what gates them):
    community_boost_earnings   DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
    user_profiles              DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE,UPDATE

  POSTing as anon using SUPABASE_ANON_KEY -> https://czzyrmizvjqlifcivrhn.supabase.co
FAIL  postgrest[SUPABASE_ANON_KEY]: POST /rest/v1/user_profiles rejected with 42501
      -- HTTP 409 code=23503 <- RLS ALLOWED IT; only the auth.users FK stopped the write
FAIL  postgrest[SUPABASE_ANON_KEY]: POST /rest/v1/community_boost_earnings rejected with 42501
      -- HTTP 201 code=none <- ROW WAS CREATED
      cleaned up: deleted 1 probe row(s) from community_boost_earnings (via DATABASE_URL)

1 passed / 3 failed / 0 skipped        (exit 1)
```

### 3. Apply

```
BEFORE: 12 policies
APPLIED + COMMITTED supabase/migrations/20260819210000_drop_public_insert_policies.sql
AFTER: 10 policies
DROPPED: [ 'community_boost_earnings | INSERT | System can insert earnings',
           'user_profiles | INSERT | Service role can insert profiles' ]
ADDED  : []
row counts: {"b":"0","p":"185","u":"185"}
```

### 4. AFTER — same verifier, same command

```
PASS  catalog: no `TO public WITH CHECK (true)` INSERT policy remains -- 10 policies inspected
PASS  catalog: "Users can insert own profile" survived on user_profiles -- WITH CHECK (auth.uid() = id)
PASS  postgrest[SUPABASE_ANON_KEY]: POST /rest/v1/user_profiles rejected with 42501 -- HTTP 401 code=42501
PASS  postgrest[SUPABASE_ANON_KEY]: POST /rest/v1/community_boost_earnings rejected with 42501 -- HTTP 401 code=42501

4 passed / 0 failed / 0 skipped        (exit 0)
```

`VITE_SUPABASE_ANON_KEY` (frontend `.env.local`) is byte-identical to
`SUPABASE_ANON_KEY`, so the verifier dedupes them to a single run. Both decode to
`role=anon ref=czzyrmizvjqlifcivrhn`.

### 5. Live end-to-end — 10/10, real account through GoTrue

```
PASS  signup: auth.users row created -- HTTP 200
PASS  signup: handle_new_user() created the user_profiles row
      -- {"id":"8c3460a6-…","email":"sifu-rls-probe-…","role":"customer","username":"sifu-rls-probe-…"}
PASS  signup: role is forced to customer despite role=admin in signup metadata -- role=customer
PASS  signin: real JWT issued for the probe user -- HTTP 200
PASS  authed: user can read own profile -- HTTP 200
PASS  authed: user can update own profile -- HTTP 204
PASS  authed: CANNOT insert a profile for someone else -- HTTP 403 code=42501
PASS  authed: CANNOT fabricate their own boost earnings -- HTTP 403 code=42501
PASS  service_role: backend can still write community_boost_earnings -- HTTP 201
PASS  teardown: probe user + profile fully removed -- residue={"u":0,"p":0}

final live totals: {"u":"185","p":"185","b":"0"}   (unchanged from before the work)
```

The account was created through the GoTrue admin endpoint with
`email_confirm: true` rather than the public `/auth/v1/signup` route. Same
`auth.users` INSERT, same `on_auth_user_created` trigger, same
`handle_new_user()` — but no confirmation email to a domain that does not exist
(`mailer_autoconfirm` is `false` on this project, so a public signup would have
sent one and hard-bounced). Sign-in afterwards used the ordinary public
password-grant endpoint with the anon key, so the authenticated assertions ran
on a genuine end-user JWT.

Note the status-code split: `anon` gets **HTTP 401** + `42501`, an authenticated
end user gets **HTTP 403** + `42501`. The SQLSTATE is the acceptance criterion
and is identical either way.

---

## Trap worth remembering — `Prefer: return=representation` hides this class of bug

The first verifier run used `Prefer: return=representation` and reported both
tables as already locked. They were not. With `return=representation` PostgREST
reads the new row back, so the INSERT is *also* judged by the table's SELECT
policy. `community_boost_earnings`' SELECT policy is `auth.uid() = creator_id`,
which `anon` fails, so a wide-open table answered:

```
HTTP 401 {"code":"42501","message":"new row violates row-level security policy
          for table \"community_boost_earnings\""}
```

— indistinguishable from a properly locked table. The identical POST with
`Prefer: return=minimal` returned **201** and really wrote the row.

`scripts/verify-anon-insert-lockdown.mjs` sends `return=minimal` for exactly this
reason, and tracks the probe row by the `creator_id` it generated (there is no
response body to read an id from). Any RLS write probe anywhere should do the
same.

---

## Still open (filed separately)

1. **`anon` holds write grants on 89 `public` tables.** After this fix, a
   schema-wide sweep found **zero** remaining policies that are `TO public` with
   `WITH CHECK (true)` / `USING (true)` on a write command — these two were the
   last of the family `20260805_security_lockdown.sql` started clearing, and no
   `anon`-granted table has RLS disabled. But RLS is now the *only* thing
   standing between the publishable key and those 89 tables (`orders`,
   `itc_transactions`, `user_wallets`, `payout_requests`, `stripe_connect_accounts`,
   `discount_codes`, `admin_settings`, …), including `TRUNCATE`, which RLS does
   not gate at all. One careless future `WITH CHECK (true)` reopens exactly this
   hole. A blanket `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN
   SCHEMA public FROM anon`, with grants added back per table where a real
   unauthenticated write path exists, would make RLS the second line of defence
   instead of the only one.

2. **`backend/.env` in the shared checkout carries a `SUPABASE_SERVICE_ROLE_KEY`
   for a different Supabase project** (`ref=yrjoblqqgrposgbvsbxm`, prod is
   `czzyrmizvjqlifcivrhn`); every service-role call made with it returns
   `401 Invalid API key`. Production is unaffected — both Render services
   (`srv-d7jpgut7vvec739bsid0`, `srv-d7jppnn7f7vs73bb4p80`) carry the correct
   key — so this breaks local backend development only. This is a recurrence of
   Watchtower task `f436cc1b`.
