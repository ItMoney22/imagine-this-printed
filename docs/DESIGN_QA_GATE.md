# Design presentation QA gate

Watchtower task `9ec9444a-c7a0-47aa-bec5-e28923cc450e`.

Nothing goes live — on the ITP storefront or on Etsy — until its **presentation**
has been reviewed and passed. The presentation is the whole package a shopper
judges: the photo set, the copy, the tags, the price.

This is a third gate, not a replacement for the two that already existed:

| Gate | Asks | Lives in |
|---|---|---|
| Print quality | Does the ARTWORK have enough pixels to print? | `backend/services/design-library-quality.ts` |
| Mockup fidelity | Is THIS ONE render the right art at the right size? | `backend/services/mockup-qa.ts` |
| **Presentation QA** | **Is the whole listing good enough to sell?** | `backend/services/presentation-qa.ts` |

---

## The six criteria

| id | Criterion | How it is decided |
|---|---|---|
| `mockup_quality` | Photo count, resolution, reachability, realism | measured + vision |
| `design_placement` | Print centred, correctly sized, faithful to the artwork | vision (reuses `mockup-qa.ts`) |
| `typography` | Every word in the print crisp and readable | vision |
| `seo` | Title, description, tags | measured |
| `pricing` | Sane for the category, never below cost | measured |
| `image_sharpness` | Variance of the Laplacian | measured |

Each finding is `block` or `warn`. **Any blocking finding fails the review.**
Warnings never block — they ride along in the feedback so a designer already in
the file can fix them too.

### Measured thresholds

Calibrated 2026-08-17 against 40 live ITP listing images
(`backend/scripts/calibrate-qa-sharpness.ts`, re-run it after any change to how
mockups are rendered):

- live corpus short edge: p05 1008, p50 1024 — the renderer emits 1024
- live corpus sharpness: min 186, p05 243, p50 909, p95 5246
- the same real image blurred at sigma 2.5 measures **78**
- the same real image downsampled to 200px and blown back up to 2000px measures **97**

The band between "worst real image" (186) and "obviously ruined" (78–97) is
empty, so the floor sits at **120**: it cannot fail anything the current
pipeline produces, and it cannot pass a blurred or heavily upscaled render.

| Setting | Default | Env override |
|---|---|---|
| Min photo short edge (block) | 1000 px | `QA_MIN_IMAGE_SHORT_EDGE` |
| Recommended short edge (warn) | 2000 px (Etsy's guidance) | `QA_WARN_IMAGE_SHORT_EDGE` |
| Min sharpness (block) | 120 | `QA_MIN_SHARPNESS` |
| Soft sharpness (warn) | 300 | `QA_WARN_SHARPNESS` |
| Min photos (block) / recommended (warn) | 1 / 3 | `QA_MIN_MOCKUPS`, `QA_WARN_MOCKUPS` |
| Min description length | 300 chars | `QA_DESCRIPTION_MIN_CHARS` |
| Price bands, per category | see `PRICE_BANDS` | `QA_PRICE_BAND_SHIRTS` etc., format `min:max` |
| Vision required to pass | `true` | `PRESENTATION_QA_VISION_REQUIRED` |

`GET /api/admin/design-qa/rules` serves all of this live, so an agent never has
to hardcode a threshold.

### Channel differences

The same design is graded separately for `storefront` and `etsy`, because the
copy rules genuinely differ:

- **Etsy** reads `products.metadata.etsy_pack` (what `services/etsy.ts` actually
  publishes) and the model shots. Title 40–140 chars, 10–13 tags, **tags over 20
  characters block** (Etsy rejects them outright).
- **Storefront** reads the catalogue fields. Title 20–80 chars, 5+ keywords, and
  **no tag length limit** — a 27-character storefront keyword is fine.

Passing on one channel is not passing on the other.

---

## Fail-closed

`mockup-qa.ts` fails **open** on purpose: a QA outage must never bin a render
that was already paid for. This gate is the opposite contract — *a presentation
cannot go live without passing* — so when a check cannot run, it does not pass.
Set `PRESENTATION_QA_VISION_REQUIRED=false` to downgrade the vision-judged
criteria to advisory if the store ever has to ship without a vision key.

## Freshness

A pass is bound to the presentation that earned it, not to the product forever.
The stamp carries a fingerprint of the exact title, description, tags, price,
placement and photo URLs that were reviewed. Change any of them and the gate
reports `stale` and demands a fresh review — otherwise "pass QA, then edit the
price to $2" would walk straight through.

## Where it is enforced

| Path | Behaviour |
|---|---|
| `POST /api/admin/design-library/set-status` (→ active) | Held-back designs are reported per gate: `print` or `presentation` |
| `POST /api/admin/etsy/queue/:productId` | 422 with the reason and the resubmit URL |
| `POST /api/admin/etsy/publish/:productId` | Same — the direct path is not a way around QA |
| `backend/worker/etsy-jobs-worker.ts` | A never-reviewed row is reviewed in place; a failed one goes `state='blocked'` and notifies |

---

## Agent integration

The Etsy scout (`12d1c31d`) and the daily designer (`f95ad58d`) authenticate
with a shared secret rather than a browser session:

```
Authorization: Bearer <DESIGN_AGENT_TOKEN>
x-agent-id: daily-designer        # allowlisted — see DESIGN_AGENT_IDS
```

Agent ids are allowlisted (`daily-designer`, `etsy-scout`, `mr-imagine`,
`etsy-worker` by default) because one shared token means an open id field would
make `submitted_by` decorative — and `submitted_by` is the column that answers
"is this agent getting better or just resubmitting".

**An agent cannot override its own failure.** `/override` is admin-only.

### The designer agent's loop

```
GET  /api/admin/design-qa/rules                  # once per run — self-check before spending a render
GET  /api/admin/design-qa/rework?channel=etsy&agent=daily-designer
     -> [{ product_id, blocking: [{criterion, issue, fix}], warnings: [...], resubmit }]
     ... fix the top blocking item ...
POST /api/admin/design-qa/submit/:productId      # creates submission N+1
     -> 200 passed | 422 failed (the body is the verdict either way)
```

`/rework` returns only designs whose **latest** review failed, so a fix that
landed is off the queue immediately. `agent=` scopes it so the designer works
its own backlog rather than the scout's.

### Batch

```
POST /api/admin/design-qa/submit  { "product_ids": [...max 50], "channel": "etsy" }
```

Reviews run sequentially server-side: each makes up to two vision calls on the
same key the render pipeline uses, and firing fifty at once would rate-limit
both.

### Other endpoints

| Endpoint | Purpose |
|---|---|
| `GET /product/:productId?channel=` | Current gate verdict + full submission history (the audit trail) |
| `GET /summary?channel=` | Pass rate, average score, and **first-pass rate** — the number that says whether the pipeline is producing good work rather than eventually being beaten into it |
| `POST /override/:productId` | Admin-only, requires a reason ≥10 chars, recorded as a NEW row that preserves the original findings |

---

## Data

`design_qa_reviews` — one immutable row per submission
(`supabase/migrations/20260817120000_design_qa_gate.sql`). `submission_no` is
per `(product_id, channel)` and assigned by
`next_design_qa_submission_no()` in the INSERT, so two concurrent submissions
cannot both claim #3.

`authenticated` has **no INSERT grant**. The only way to pass is to be reviewed,
and there is deliberately no endpoint that marks a design passed without running
the checks — otherwise anyone with an admin token could forge a pass.

The verdict is also mirrored to `products.metadata.qa_gate[channel]` so grids can
render a badge without a join. That mirror is a convenience, **not** the source
of truth.

## Tools

```bash
cd backend
npx tsx --env-file=.env scripts/calibrate-qa-sharpness.ts [n]   # retune the image thresholds
npx tsx --env-file=.env scripts/qa-gate-dry-run.ts [n] [channel] # see verdicts, write nothing
npx tsx --env-file=.env scripts/qa-gate-e2e-check.ts [productId] # prove the loop after a deploy
```

## Known limits

- Sharpness is measured at a fixed 512px short edge, so it reports **perceived
  crispness at display size**, not native detail. A mildly upscaled image can
  still score well; native resolution is covered by the separate pixel check and
  by the artwork printability gate.
- Realism, centring and typography are model judgements. They are prompted to
  report only defects a shopper would notice, but they are not deterministic —
  which is why every one of them is overridable by a human with a recorded
  reason.
- **Typography judges the design's focal text, not every incidental pixel.** A
  busy illustrated scene (a cityscape, a crowd, a market) often carries small
  background signage that is scenery, not the sold message. As of 2026-08-18
  the prompt explicitly scopes `typographyOk` to a title/name/slogan-class
  focal text and tells the model to ignore soft or tiny incidental background
  lettering — the same "would a shopper actually notice" standard the realism
  criterion already uses. Before this, a design with legible primary text but
  dense secondary scene-signage (e.g. "Neon City Tactical Soldier Crossover",
  four legible major signs plus tiny background labels) failed typography 0/8
  even after `design_placement` was fixed and passing reliably. Verified live
  against two products: the soldier tee flips fail→pass 3/3 with placement and
  realism unaffected, and a known-good design with real focal text ("Neon Y2K
  Glitch Boo Crew") still passes 3/3 — the scoping does not blanket-disable the
  check. Watchtower task `f7b25ed8-1fe1-4eef-99ce-ae7afe2dc0d4`.
- As of 2026-08-17 a live sample of the active catalogue scored **0/4 passing**,
  almost entirely on description length (242–282 chars against a 300 floor) plus
  two genuine mockup defects. That is the honest state of the presentation, not
  a miscalibration — but `QA_DESCRIPTION_MIN_CHARS` is the first dial to reach
  for if the gate needs easing while the copy catches up. Only newly activated
  designs are affected; nothing already live is pulled down.
