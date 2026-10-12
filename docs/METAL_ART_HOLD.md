# Metal art production hold (Watchtower c11af937)

**Set by David 2026-08-24.** Mrs. Imagine must create zero new metal-art briefs/listings while it stands.

## Why it kept failing
It lived only in a task description. `backend/services/mrs-imagine.ts` takes a metal brief count as a
plain argument with no gate, so every cron batch kept making metal SKUs (6+ on 2026-08-31, several ACTIVE).
Live metal catalog at the time: 32 products, $25-$75, median $65.

## Where it is enforced (single source of truth)
`backend/shared/catalog-capability.ts` -> `PRODUCT_LINES`, entry `metal-art`:
`hold: true`, `holdTaskId: 'c11af937'`, `holdEnvVar: 'ITP_METAL_ART_HOLD'`.
Read it via `isLineOnHold()`; never read `hold` directly (the env override must always apply).

- Turn the line off/on = one edit to that entry, or set `ITP_METAL_ART_HOLD=false` on the backend to lift
  it without a deploy. Leaving the constant `true` means a fresh deploy with no env set stays held.
- Code lives on branch `earth/dr-dill/encode-itp-capability-bo-72adcc9c-mucrd4um` (commit 4ebf57e).
  It is NOT on origin/main as of 2026-10-12; board row eb06cd30 merges it. Do not re-implement.

## Open question for David
origin/main shipped a David-directed metal print lane on 2026-09-02 (b678e6c) and row 033ae505 asks him to
price metal add-ons, so whether the hold still stands is his call. Do not enforce it on live products
(deactivating existing SKUs) until he confirms. The hold only stops NEW generation.
