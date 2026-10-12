# Ship proof: Jiffy per-colour blank sizes + Tripo V3 (task 67f1d6f2)

Branch `earth/rhea-cassien/ship-itp-jiffy-per-colou-67f1d6f2-mv5f50mx`. Code commit **b5a58bc** =
live main **ad57532** (Nine's Step Flow hotfix, shipped 2026-10-12) + Nine's **cc27627**
(Jiffy per-colour blanks 3b5d2ab + Tripo V3 7caccd4). No new app code; this folder is the proof.

**Status: ready to ship, NOT shipped.** ITP's daily slot for 2026-10-12 is used (7314e53), and only
zero-nine may run `ship_to_production`. It goes out in the 10/13 daily ship.

## 1. Blanks refuse sizes Jiffy does not carry in a colour

Rerun it yourself (read-only, anon REST, no writes):

    npx tsx --env-file=.env.local scripts/proof-blank-size-gating.ts origin/main

Output saved as [`live-vs-branch.json`](live-vs-branch.json) (2026-10-12T16:01Z, live code ad57532 vs branch b5a58bc):

| | uncarried colour/size combos still priced |
|---|---|
| live code (origin/main ad57532) | **10** |
| this branch | **0** |

All 10 are on **Soft Ring-Spun Tee — Blank** (7c0f8ab3), 4XL at $12.18 in Sky, Gold, Sage, Azalea, Heliconia,
Cherry Red, Light Pink, Mint Green, Forest Green and Dark Chocolate. Jiffy has no 4XL in those colours, so the live
store would take an order it cannot buy. The other three blanks have no gaps. All four live rows already carry
`by_color_only: true`, so the branch code needs no DB change.

Server side: `backend/services/order-pricing.ts:454-456` turns a null blank price into a checkout error
("Blank garment … has no price for size"), so a hand-made cart cannot get past the server either.

## 2. Product page + catalog card hide those sizes

Fleet browser, saved flows replayed (0 model calls, $0), vite on 127.0.0.1:5191, merged tree b5a58bc:

| Walk | Black | Sky |
|---|---|---|
| `/product/7c0f8ab3…` at 1400 | XS–5XL ($4.51 … 4XL/5XL $12.11) | S M L XL 2XL 3XL only |
| same page at 390 (4XL picked on Black, then Sky) | header "$12.11 4XL · Black" | 4XL gone from the row, header back to "from $3.74 pick a size and colour" |
| `/catalog?q=Soft Ring-Spun` card quick-add at 1400 | XS–5XL | S–3XL only |

Shots: [`product-page-sky-1400.png`](product-page-sky-1400.png), [`product-page-sky-390.png`](product-page-sky-390.png),
[`catalog-card-sky-1400.png`](catalog-card-sky-1400.png). One shop menu, no overlap, chat bubble clear of the buttons.

## 3. Tripo V2 → V3 (toy maker + Mini-Me 3D)

- Code: `backend/services/tripo3d.ts` posts to `https://openapi.tripo3d.ai/v3/generation/image-to-model` and polls
  `/v3/tasks/{id}`, model `v3.1-20260211`; covered by `backend/services/tripo3d.test.ts`.
- Tripo's migration page, read 2026-10-12 (developers.tripo3d.ai/en/docs/migration-v2-to-v3): host `openapi.tripo3d.ai`,
  base `https://openapi.tripo3d.ai/v3/`, same two endpoints. Matches the code.
- Live, free (no generation), vault `TRIPO_API_KEY`, 2026-10-12 ~16:00Z:
  - `GET /v3/tasks/00000000-…` with key → 404 `"The task is not found"` (request ecf1f044-20db-429b-a1f3-0e74a20a3289); without key → 401. The key authenticates on V3.
  - `GET /v3/account/balance` → 200 `{"balance":450.00,"frozen":0.00}`. 450 credits is about 15–22 toy jobs (20–30 credits each).
- The V2 shutoff date (2026-10-31 16:00 UTC) is from Nine's 10/7 commit; the migration page does not state it.

## 4. Gates

- [`verify-branch.txt`](verify-branch.txt): `npm run verify` on b5a58bc, tsc clean, **166 files / 2377 tests pass**.
- `npx vite build` on b5a58bc: built in 11s, exit 0.
- `git merge-tree --write-tree` exit 0 against: origin/main ad57532 (pure descendant), local main 6e99462,
  Vinny's Jiffy cost sync 051355f (SHIP 0ad30c62), Saturn's on-person stamping 35cc532b (SHIP 4646cb1f).
- **10/13 superset**: b5a58bc + 051355f + 35cc532b merge clean (tree c2411d7e). [`verify-superset-10-13.txt`](verify-superset-10-13.txt):
  tsc clean, **171 files / 2440 tests pass**. The first two runs went red only on the environment: another session's cleanup
  emptied the shared `backend/node_modules/.prisma/client` at 12:04:25 (health.test.ts could not load Prisma), then a
  5s import timeout in print-bridge.test.ts while a second vitest ran next to it. That file passed alone (12/12), and the full rerun was green.

## After it is live (for the 10/13 ship)

Probe `/`, `/catalog`, `/product/7c0f8ab3-9d2f-42af-bb74-3190697a9493`, `/blanks` (`/products` is a 404). On the product
page pick Sky: no 4XL. Rerun the script with the shipped main as the ref: `uncarried_sold_by_live_code` must be 0.
The first toy job after deploy should log `tripo_model v3.1-20260211`.
