# Design performance — proof (task 47174caa, 2026-10-12)

Walked on the branch: Vite :5180 -> branch API :4100 -> the production database (migration applied live first).

| File | What it shows |
|---|---|
| `admin-table-1400.png` | `/admin/design-performance` inside the one admin menu: shop totals, every design with its prompt, sorted with Prune / Refresh on top |
| `admin-raw-check-1400.png` | "Too Cute To Spook" expanded: prompt, idea, model, variant, artwork id, and "Check against raw events" -> 4 tile views, 2 clicks, 2 page views, 1 cart, 0 orders, **Matches this row** (all from a real guest walk in the fleet browser) |
| `admin-compare-1400.png` | Compare prompts: three prompts for one Mrs. Imagine brief side by side (Prune / Refresh / Healthy) |
| `admin-390-top.png`, `admin-390-compare.png` | the same page at phone width |
| `reconcile-30.txt`, `reconcile-90.txt` | `backend/scripts/design-performance-reconcile.ts`: every product on the report equals its raw event + paid-order counts (90 days includes 2 real paid orders on the candle holder) |
| `flags-proof.json` | the daily sweep wrote `prune` and `refresh` (with reasons) onto `design_prompt_variants.flag` |

The side-by-side and flag demo used three DRAFT products from the `sarcastic-brain-tee` brief (no live idea has two
prompts yet) with seeded events tagged `qaproof47174caa-seed`. Every event row (seeded and walked, 1,132), the three
draft mappings and five orphan variants were deleted right after; the walk's admin session was logged out (204).
The live tables hold only the 31 live product -> prompt mappings, every flag back at `learning`.
