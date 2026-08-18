# Refund + dispute go-live — migration, Stripe config, and smoke test

**Watchtower task:** `ede1687a-f3d4-477c-9cf2-fcd3da2dd031`
**Ran:** 2026-08-16 · **Agent:** Chase Valenti
**Feature under test:** Watchtower task `c1b0182f` (commit `8849190`, since merged to `main`)
**Target:** LIVE production — Supabase project `czzyrmizvjqlifcivrhn`, Stripe live mode

---

## 1. Migration — APPLIED

`supabase/migrations/20260727_refunds_and_disputes.sql` was **not applied** before this
session: all seven objects it installs were missing from the live catalog, which means
`backend/services/order-refunds.ts` had been silently running its degraded fallbacks
(non-atomic read-modify-write restock, and royalty rows marked `failed` instead of
`reversed`) for every refund since the feature merged.

Applied inside its own transaction and recorded in
`supabase_migrations.schema_migrations` as version `20260727`.

### Acceptance objects — all verified live post-apply

| # | Acceptance criterion | Result | Live evidence |
|---|---|---|---|
| 1 | Migration applies without errors | **PASS** | applied in one transaction, no errors |
| 2 | `reverse_blank_sale` RPC available and functional | **PASS** | `reverse_blank_sale(p_blank_id uuid, p_order_id uuid, p_qty integer)`, `SECURITY DEFINER` — and *exercised* in §3 |
| 3 | `refund` movement reason present | **PASS** | `CHECK (reason = ANY (ARRAY['sale','received','adjustment','shrinkage','refund']))` |
| 4 | `refund` unique index present | **PASS** | `CREATE UNIQUE INDEX blank_movements_refund_once ON blank_inventory_movements (blank_id, order_id) WHERE reason = 'refund'` |
| 5 | `reversed` status on `user_product_royalties` | **PASS** | `CHECK (status = ANY (ARRAY['pending','credited','failed','reversed']))` |
| 6 | `payment_dispute` `admin_notifications` type | **PASS** | present in the type CHECK |
| 7 | Index on `orders.payment_intent_id` | **PASS** | `idx_orders_payment_intent_id … WHERE payment_intent_id IS NOT NULL` |
| 8 | Index on `orders.charge_id` | **PASS** | `idx_orders_charge_id … WHERE charge_id IS NOT NULL` |

### Second migration applied (judgement call, flagged)

`supabase/migrations/20260728_refund_reward_reversal.sql` was **also unapplied**, and
`coupon_usage.reversed_at` — the column it adds — is a hard dependency of
`reverseCouponUsage()` in the same refund service. Without it, refunding any order that
used a coupon reports `refund_reversal.ok = false`, which directly contradicts this
task's own acceptance criterion. It is purely additive
(`ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`), so it was applied in the
same session and tracked as version `20260728`.

### Pre-flight safety checks run before applying

The migration **replaces** three CHECK constraints by restating their full value lists,
so each was checked for values that would be silently dropped or would fail the `ALTER`:

- `admin_notifications` — live list was the original 7; the migration's list is those 7
  plus `payment_dispute`. Strict widening, nothing lost. Only live row is `order_stalled`.
- `blank_inventory_movements.reason` — **0 live rows**, nothing to invalidate.
- `user_product_royalties.status` — **0 live rows**, nothing to invalidate.
- No duplicate `(blank_id, order_id)` refund pairs existed to block the new unique index.

---

## 2. Stripe webhook configuration — ALREADY CORRECT, VERIFIED

**No change was needed.** The live endpoint was already configured correctly; this
section is the verification, not a modification.

**Endpoint `we_1SkSOEIK5lihoSZtO5fqfbU3`** → `https://api.imaginethisprinted.com/api/stripe/webhook`
· status `enabled` · API version `2025-12-15.clover`

| Required event | Enabled | Handled in `backend/routes/stripe.ts` |
|---|---|---|
| `charge.dispute.created` | yes | yes (L771) |
| `charge.dispute.updated` | yes | yes (L772) |
| `charge.dispute.closed` | yes | yes (L775) |
| `charge.dispute.funds_reinstated` | yes | yes (L774) |
| `charge.dispute.funds_withdrawn` | yes | yes (L773) |
| `charge.refunded` | yes | yes (L761) |

> The task brief listed `charge.dispute.funds_reinstated` twice. The fifth distinct
> dispute event the code actually handles is `charge.dispute.funds_withdrawn`, and it is
> enabled — so all five handled cases are covered with no gap.

**Endpoint liveness** — an unsigned POST to the production URL returns
`HTTP 400` with Stripe's own *"No signatures found matching the expected signature"*
error. That proves the route is deployed, reachable, and running
`stripe.webhooks.constructEvent` against a configured `STRIPE_WEBHOOK_SECRET`.

A second live endpoint, `we_1T02Zw…` → `https://davidtrinidad.com/api/stripe/webhook`,
is **disabled** — the stray endpoint from the 2026-08-07 webhook outage. Correctly left
disabled.

---

## 3. Smoke test — 26/26 PASS

### How it was run, and why not in Stripe test mode

**This Stripe account has no test-mode secret key** — there is no `sk_test_` value in the
vault (`C:/Users/David/.secrets/keys.json`), in `backend/.env`, or in any project env
file. Only live keys exist. A test-mode order therefore could not be placed, and test
card `4000000000000259` could not be charged, without either new credentials or a real
live-money transaction. **See §5 — this is filed as an approval for Money.**

So instead of Stripe generating the events, the test generated byte-identical
`charge.refunded` and `charge.dispute.created` payloads, **signed them with the real
`STRIPE_WEBHOOK_SECRET`**, and posted them to a locally-booted copy of the production
backend (same commit, byte-identical `stripe.ts` / `order-refunds.ts` /
`webhook-helpers.ts`, pointed at the **live** database).

Everything downstream of Stripe's own HTTP delivery is therefore exercised for real:
signature verification, event routing, order resolution via `payment_intent_id`, the
`claimOnce` gate, all six reversals, the atomic RPC, and the admin notification —
against the real schema.

Two synthetic orders were used (A refunded, B disputed — separate orders because the
dispute handler deliberately refuses to drag an already-refunded order backwards), with
a full pre-paid side-effect fixture: 25 ITC store credit spent, 2 blanks decremented from
a stock of 10, a 5-ITC creator royalty credited, and a 3-ITC loyalty award.

### Refund scenario — order A

| Acceptance criterion | Result | Evidence |
|---|---|---|
| `charge.refunded` accepted (signature verified + handled) | **PASS** | `HTTP 200 {"received":true}` |
| `orders.status` = `refunded` | **PASS** | `refunded` |
| `orders.payment_status` = `refunded` | **PASS** | `refunded` |
| `orders.metadata.refund_reversal` reports `ok: true` | **PASS** | all six steps ok — `itcStoreCredit`, `inventory`, `creatorMargins`, `loyaltyItc` ran; `referralBonus`, `couponUsage` correctly skipped (none existed) |
| Stripe refund recorded on the order | **PASS** | `metadata.refunds[0]` with `stripe_refund_id`, `amount_cents: 2500`, `source: "stripe_webhook"` |
| Customer ITC store credit restored | **PASS** | buyer wallet `0 → 22` (+25 credit returned, −3 loyalty clawback) |
| `qty_on_hand` increased for the refunded product | **PASS** | `10 → 12` |
| **Restock used the ATOMIC RPC, not the fallback** | **PASS** | movement row `reason='refund', delta=2` — the migration's path. Pre-migration this would have been `reason='adjustment'` |
| Creator royalty row reads `reversed` | **PASS** | `reversed` — pre-migration this would have been the `failed` + metadata-marker fallback |
| Creator ITC clawed back | **PASS** | creator wallet `5 → 0` |
| `order_rewards` marked `reversed` | **PASS** | `reversed` |
| Reversal ledger rows written | **PASS** | `purchase_payment_refund` `+25`, `order_reward_refund` `−3`, `royalty_reversal` present |
| Refund written to `audit_logs` | **PASS** | `order_refunded` |

### Dispute scenario — order B

Payload mirrors what test card `4000000000000259` produces (`reason: "fraudulent"`,
`status: "needs_response"`).

| Acceptance criterion | Result | Evidence |
|---|---|---|
| `charge.dispute.created` accepted | **PASS** | `HTTP 200 {"received":true}` |
| Order status changes to `on_hold` | **PASS** | `on_hold` |
| `payment_status` → `disputed` | **PASS** | `disputed` |
| Dispute snapshot persisted | **PASS** | id, reason, status, amount, evidence due date on `metadata.dispute` |
| **`payment_dispute` notification on the admin bell** | **PASS** | *"Chargeback opened — order … — $25.00 disputed (fraudulent). Evidence due 2026-08-26… Order is on hold."* — this insert would have been rejected by the CHECK constraint before the migration |
| Dispute written to `audit_logs` | **PASS** | `stripe_charge_dispute_created` |

### Idempotency — duplicate webhook delivery (extra, not required)

The identical `charge.refunded` event was re-fired. Money must not move twice.

| Check | Result |
|---|---|
| Buyer wallet unchanged (still 22) | **PASS** |
| Creator wallet unchanged (still 0) | **PASS** |
| `qty_on_hand` NOT double-restocked (still 12) | **PASS** |
| Exactly one `refund` movement row | **PASS** |
| Exactly one store-credit reversal ledger row | **PASS** |
| Exactly one loyalty clawback ledger row | **PASS** |
| Exactly one royalty reversal ledger row | **PASS** |
| `metadata.refunds` still holds one refund (deduped by Stripe refund id) | **PASS** |

### Admin refund endpoint

`POST /api/stripe/orders/:orderId/refund` is mounted and gated
(`requireAuth, requireRole(['admin'])`, `backend/routes/stripe.ts:1808`). An
unauthenticated POST returns **401 on both the local copy and live production**.

### Teardown

All synthetic data removed and verified gone: 2 orders, 4 ITC transactions, 2 inventory
movements, 1 royalty, 1 order reward, 1 blank, 1 product, 1 admin notification, 2
audit logs, 2 wallets, 2 profiles, and both Supabase auth users (`HTTP 200` each).
Post-cleanup the live DB is back to its baseline: **5 orders total, 0 rows in
`blank_inventory` / `blank_inventory_movements` / `user_product_royalties`, 0
`payment_dispute` notifications.** No smoke-tagged row survives anywhere.

---

## 4. Gaps found — NOT fixed here

### 4a. The admin "Refund" button does not exist

The acceptance criteria describe refunding *"via the admin Order Management Refund
button."* **There is no such button.** The backend endpoint is built and admin-gated,
but nothing in `src/` calls it — `src/pages/OrderManagement.tsx` contains zero refund
references, and a repo-wide search for `stripe/orders` in the frontend returns nothing.
Today a refund can only be issued by an authenticated API call. Filed as a follow-up.

### 4b. LANDMINE — `20260807_admin_notifications_new_order.sql` would delete `payment_dispute`

Three unapplied migrations each rewrite `admin_notifications_type_check` by restating the
full list, and **none of them knows about the others** — they were authored on parallel
branches. Applying `20260807` as written today would silently **drop `payment_dispute`**
and break the chargeback alert this task just enabled.

| Migration | Its list omits | Live status |
|---|---|---|
| `20260727_refunds_and_disputes` (applied here) | `wholesale_application`, `new_order` | **applied** |
| `20260728_wholesale_applications` | `payment_dispute`, `new_order` | unapplied |
| `20260807_admin_notifications_new_order` | `payment_dispute` | unapplied |

The correct constraint is the **union** of all four sources:

```
'new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed',
'low_stock', 'order_stalled', 'health_alert',
'payment_dispute', 'wholesale_application', 'new_order'
```

This also means **`new_order` admin-bell notifications are broken live right now** —
`backend/services/order-payment.ts:341` inserts `type: 'new_order'` on every paid order
and the CHECK rejects it (caught by its own try/catch, so the crew email still sends).
Filed as a follow-up; deliberately not fixed here because it belongs to a different
feature's go-live and needs the three-way reconciliation above, not a fourth restatement.

### 4c. Workstation env trap (local only, no production impact)

This machine carries **wrong-project `SUPABASE_*` variables at OS User scope** (project
ref `yrjoblqqgrposgbvsbxm`). `node --env-file=` does *not* override an already-set
process env var, so any script run that way silently talks to the wrong Supabase project
and gets `401 Invalid API key`. `backend/.env` itself is correct, and the backend dodges
this via `backend/load-env.ts`'s `dotenv.config({ override: true })` — but standalone
scripts must read the env file themselves and let it win.

---

## 5. What could NOT be completed, and why

Two acceptance criteria are unsatisfiable with the credentials on hand:

- *"A test order placed in Stripe test mode can be successfully refunded"*
- *"A test dispute triggered using Stripe test card `4000000000000259`"*

Both require Stripe **test mode**, and no test-mode secret key exists anywhere on this
machine. The equivalent behaviour is proven in §3 against the live schema with real
signed payloads through the real handler; what remains unproven by this session is
narrow but real:

1. Stripe's own HTTP delivery to the production endpoint (the endpoint is verified
   enabled, reachable, and signature-checking — but no event has been delivered
   end-to-end during this session).
2. That the `STRIPE_WEBHOOK_SECRET` deployed on Render matches this endpoint's signing
   secret. Stripe does not expose an endpoint secret for read-back after creation, so
   only a genuinely delivered event can settle this.
3. `stripe.refunds.create()` inside the admin endpoint — it needs a real charge.

This is filed as an approval for Money (options: provision test-mode keys, or authorise a
small live charge-and-refund). See the handoff for the approval id.
