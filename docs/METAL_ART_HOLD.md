# Metal art production hold (Watchtower c11af937) — LIFTED 2026-10-12

**Status: lifted.** `ITP_METAL_ART_HOLD=false` on the Render API and worker (set 2026-10-12, task b656d9b1,
option B). Metal art is a live, sellable lane. To put the hold back on, set `ITP_METAL_ART_HOLD=true` on both
Render services; the code reads it on every call, so it takes effect at the next deploy or restart.

## History
- **2026-08-24 — David set it.** Verbatim: "something is off there... for now lets not produce anymore metal
  art." It was a PAUSE while the approach was reworked, not a lost capability (task 9ff3919c).
- **2026-09-01 — still being violated.** It lived only in a task description, so Mrs. Imagine's daily batch
  kept making metal SKUs (6+ on 2026-08-31, several ACTIVE at $48-$75). David also flagged the price: "a 4x6
  for 50+ is insane."
- **2026-09-02 — David reworked the lane himself** (b678e6c, live as 82b7f14): size-aware prices locked at
  4x6 $8.95 / 8x10 $16.95 in `backend/shared/metal-art.ts`, artwork-first gallery, add-ons. He walked a
  metal product through the Step Flow that day.
- **2026-09-09 — unattended building retired.** `MRS_IMAGINE_DAILY` does nothing now; the daily clock only
  runs the scout (`backend/worker/mrs-imagine-daily.ts`). Nothing builds products on its own.
- **2026-09-22 — David priced the metal add-ons** (magnet kit $4.95, printed stand $6.95; approval 033ae505).
  The hold was encoded the same day on 4ebf57e (Dr. Dill, task 72adcc9c), default ON.

## Why it was lifted (decision, task b656d9b1)
Everything that was "off" in August was fixed by David's own 9/2 rework, and the runaway generator that kept
breaking the hold was retired 9/9. Leaving the hold ON once 4ebf57e ships would not stop a runaway (there
isn't one). It would only block David: presentation QA's `capability` check fails every `metal-art` product,
so the Step Flow's Etsy step would error on every metal design he makes. That is the same "it won't let me
finish the Etsy side" failure he reported on 2026-09-03.

## Where it is enforced
`backend/shared/catalog-capability.ts` → `PRODUCT_LINES`, entry `metal-art`: `hold: true` (the default when the
env var is missing), `holdEnvVar: 'ITP_METAL_ART_HOLD'`. Read it through `isLineOnHold()`. The gate is checked in
`mrs-imagine.ts` (brief count, brief parser, product insert) and in `presentation-qa.ts` (`checkCapability`).
This code arrives on main with the merge batch a9abbfb (merge 30bd6e9, ship card bc79ffae).

**Fresh boxes:** a box with no `ITP_METAL_ART_HOLD` set falls back to held. Render has it. The Fly apps have it
**staged** (applied on their next deploy). A local backend `.env` needs `ITP_METAL_ART_HOLD=false` to match prod.
