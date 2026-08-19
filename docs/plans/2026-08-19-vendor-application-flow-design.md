# Self-serve vendor applications — design notes

**Author:** Marcus Wolfe · **Date:** 2026-08-19 · **Watchtower:** `54fb9414-40fd-47cf-9607-faca4f6e59fc`
**Status:** design only. Nothing here is built. Manual admin promotion (shipped in the same task) is
the interim path.

---

## Where things stand after 54fb9414

Manual promotion works end to end and is proven on production:

- `AdminDashboard.tsx` → **Users** tab: search, role filter, per-role counts, a role badge, a
  **Make Vendor / Remove Vendor** action, and a confirmation modal for every privileged role.
- `AdminDashboard.tsx` → **Vendors** tab now reads the table vendors actually write to
  (`public.products` where `vendor_id IS NOT NULL`), so submissions are visible and approvable.
- `20260819190000_admin_update_user_profiles_rls.sql` gave admins the row-level UPDATE they never had.
- Production has exactly **one** vendor: `info@darrellmccutchen.com` (`41c6873c-…`).

So the question this doc answers is narrower than "how do we build vendor onboarding": it is
**"what has to exist before a stranger can ask to be a vendor without an admin touching the DB."**

## Recommendation

**Do not build the self-serve flow yet.** One vendor, hand-picked, is the right size for a
marketplace that has never had a single vendor product persist. Build it when there is real inbound
demand — the manual path costs an admin about ten seconds per vendor. When that changes, build it as
a near-copy of the wholesale application flow, which is already live and load-bearing.

## The pattern to copy

`supabase/migrations/20260728_wholesale_applications.sql` + `backend/routes/wholesale.ts` +
`src/pages/WholesalePortal.tsx`. That trio is the house style for "a member of the public asks for
elevated access":

| Piece | Wholesale | Vendor equivalent |
|---|---|---|
| Table | `wholesale_applications` | `vendor_applications` |
| Submit route | `POST /api/wholesale/apply` (`requireAuth`) | `POST /api/vendor/apply` (`requireAuth`) |
| Admin alert | `admin_notifications` type `wholesale_application` | new type `vendor_application` |
| Email | `sendNewWholesaleApplicationEmail` | `sendNewVendorApplicationEmail` |
| Admin review UI | (pending) | new **Applications** panel on the Vendors tab |

### Schema

```sql
CREATE TABLE IF NOT EXISTS public.vendor_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  brand_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,          -- taken from the JWT, never the body
  portfolio_url TEXT,
  product_categories TEXT[] DEFAULT '{}',
  monthly_volume_estimate TEXT,
  owns_rights BOOLEAN NOT NULL DEFAULT FALSE,   -- explicit IP attestation
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_vendor_application_open
  ON public.vendor_applications(user_id) WHERE status = 'pending';
```

The partial unique index is the one thing wholesale lacks and this needs: without it a bored user can
file forty applications and flood `admin_notifications`.

RLS, copied verbatim in shape from wholesale: `SELECT` on `auth.uid() = user_id` so the applicant can
see their own pending state; every write through the service role, because the write and the admin
notification have to happen together.

### The approval side effect

Approval must do two things atomically-ish: set `status='approved'` **and** promote
`user_profiles.role` to `'vendor'`. Put it in a backend route
(`POST /api/admin/vendor-applications/:id/approve`, `requireAuth` + `requireAdmin`) using the service
role rather than in the browser:

- `enforce_user_profile_role_immutable` exempts `service_role`, so no policy work is needed.
- One server-side transaction keeps a half-approved state (application approved, role not changed)
  from existing.
- It gives one place to send the "you're approved" email and write the audit log.

The frontend `updateUserRole` path stays as-is for one-off manual promotions.

## Traps found while proving the current flow — fix these before opening the doors

1. **`vendor_products` is dead.** The table exists with full RLS, and nothing has written to it since
   the vendor flow moved onto `products`. The Vendors tab now reads both, but the legacy table should
   be dropped once someone confirms it is empty in every environment (it holds 0 rows in production).
   Two tables that both look like "the vendor products table" is how this bug survived so long.
2. **Category taxonomy mismatch — the biggest one.** The vendor submit form offers
   `gaming / eco / office / lifestyle / 3d-models / tech`. The storefront's categories are
   `dtf-transfers / shirts / tumblers / hoodies / 3d-models / 3d-prints / metal-art`. An approved
   vendor product in `lifestyle` appears only under **All Products** — it is invisible under every
   category tab. Verified live during this task. Any self-serve flow multiplies that problem by the
   number of vendors. Filed as a follow-up.
3. **`products_print_locations_valid`** requires ≥1 print location on a `shirts` row. Fixed for the
   catalog "Add to store" path in this task; a future vendor-facing shirt form needs the same field.
4. **Role cache.** `backend/middleware/requireVendorOrAdmin.ts` reads through `getCachedRole`. A
   freshly promoted vendor can be refused by the backend until that cache expires, even though RLS
   already accepts them. An approval route should invalidate the cache for that user id.
5. **A newly promoted vendor keeps a stale role in their open tab** until the profile is refetched.
   Not worth solving for manual promotion; worth a `SIGNED_IN` refetch if applications go live.

## What this does not need

No Stripe Connect gate at application time — `vendor-payouts.ts` / `AdminConnectManagement.tsx`
already handle onboarding after the fact, and demanding a Connect account before the first product is
a conversion killer. Keep the application to identity, catalogue fit, and the IP attestation.
