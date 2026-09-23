# Jev shadow casting — rollout evaluation (2026-09-23)

Watchtower task `e3b25fef-6b90-49cc-a431-518d15dd82d4`. Objective: query production
telemetry at `products.metadata.step_flow.shots.*.casting.jev`, measure Jev's
agreement/accuracy and coverage against live casts, and decide whether to flip
`STEP_FLOW_CASTING_JEV=on` in production.

## Headline: the rollout precondition is not met — on two independent grounds

The task brief assumes branch `3911e9d` (which adds Jev shadow casting) has
**landed** and that **~2 weeks of live shadow observation** exist to evaluate.
Neither is true as of this report:

1. **Branch not merged, not deployed.** Commit `3911e9d` on
   `earth/sifu/implement-jev-model-cast-c3bbbb16-mue1f257` is local-only — not an
   ancestor of `origin/main` (`git merge-base --is-ancestor 3911e9d origin/main`
   fails) and not pushed to `origin` at all. It was authored **the same day** as
   this evaluation (2026-09-23 07:56 -0400, per `git show 3911e9d`), so even if it
   had merged instantly there has been no observation window whatsoever, let
   alone two weeks.
2. **Zero live telemetry exists.** A live, read-only query against the production
   database (`DATABASE_URL_ITP_POOLER`) confirms it:

   | Query | Result |
   |---|---|
   | Products with any `metadata.step_flow.shots` | 27 |
   | Shot rows with a `casting` object at all | 14 |
   | Shot rows with `casting.jev` present | **0** |
   | `casting.source` distribution | `mrs-imagine`: 14 (100%) |
   | Products whose `metadata` JSON mentions `"jev"` anywhere | **0** |

   Every live cast today still runs the pre-Jev vision→keywords→default chain.
   `STEP_FLOW_CASTING_JEV=shadow` has never executed against a real listing in
   production.

Given this, **deliverable 1 (query production shadow telemetry) returns an empty
set** — there is nothing to aggregate. The only measurement that exists is the
one-time, read-only **pre-merge dry run** sifu ran locally against 300 real
listings before opening the branch (`docs/reports/jev-casting-sample-2026-09-23.{md,json}`
on the unmerged branch). That dry run is the best available evidence and is used
below, but it is explicitly **not** the "~2 weeks of shadow data" the rollout
requires, and its numbers already fail the coverage bar this task sets.

## What the pre-merge dry run shows (sifu, 300 live listings, read-only)

| Metric | Value |
|---|---|
| Casts evaluated | 300 / 300 (Jev answered all) |
| Accepted (confident + consistent + agrees with keyword band) — **coverage** | 54 (**18%**) |
| Low confidence → falls to old chain, flagged for review | 241 (80%) |
| Rejected (contradiction / off-menu / keyword-band clash) | 5 (2%) |
| Median subject confidence | 0.61 |
| **Agreement with recorded live casts** (13 listings that already had a real vision-chain cast) | Jev accepted & matched archetype: **5/5**; matched age band: **5/5** |
| Agreement with the keyword list, where both answered | 28 / 36 (78%) |
| Youth (child) casts Jev would make | 1, and it was correct |
| `design_audience` reads | no opinion 185, either 78, adult 25, youth 12 |
| Cost / latency | $0.0166 / 10s for the batch (~$0.00005/cast, parallel with vision — no added latency) |

**Coverage target in this task is ≥40%. The dry run measures 18%** — well under
the bar, independent of the "no live data" problem above. Even in the
counterfactual where the branch had shipped and run for two weeks, today's
prompt would not be expected to clear the rollout threshold without the tuning
below (nothing about coverage improves just by letting the clock run — coverage
is bounded by how much signal is in the two inputs Jev currently gets: product
name + Step Flow idea).

**Accuracy, when Jev is confident, is strong and consistent with the branch's
own gating design:** every accepted pick that overlaps a real recorded cast
matches it exactly (archetype and age band), and disagreements with the keyword
list mostly go Jev's way (e.g. "Retro Cherry Roller Skate Shirt for Playful
Moms" → `mom` instead of `skater`; "Golden Senior Sparkle Tee" → `grandpa`
instead of `student`). This is a quality-of-verdict signal, not a coverage
signal — the two are independent and the rollout needs both.

## Child / audience mismatch review (deliverable 2)

No erroneous *authoritative* child casts exist, because none have run live yet.
Reviewing the dry-run's low-confidence bucket for what an `on` rollout would
have risked surfaces one specific, notable case:

- **"Too Cute To Spook Ghost T-Shirt / Halloween Unisex Tee"** — this is David's
  own original complaint example (2026-09-03: a cute ghost tee modelled by a
  bearded adult man). The live vision chain cast `student` (an adult) for it —
  still wrong today. Jev's read is `kid-playful @ 0.94` with `design_audience:
  youth @ 0.82`. Subject confidence clears the 0.75 bar, but the *child-cast*
  rule additionally requires `design_audience: youth ≥ 0.85` **and** a kids'
  keyword match in the listing wording — 0.82 falls just short, so this specific
  flagship case would still gate to low-confidence / no-opinion under the
  current thresholds and the listing would keep getting the wrong adult cast.
  This is the one concrete tuning lever worth calling out (see below) rather than
  a defect — the gate is deliberately conservative to prevent an actual
  misfire (putting a child in a photo it doesn't belong in), but it is currently
  conservative enough to miss its own motivating example.
- Everywhere else Jev drifted toward `kid-playful` on adult/ambiguous designs
  (e.g. "Crazy Witch Halloween Graphic" → `kid-playful @ 0.42`, "Beam Me Up
  Retro Sci-Fi" → `kid-playful @ 0.20`), confidence stayed well under the 0.75
  subject bar and the child-keyword+0.85 floor, so the gate correctly suppressed
  these — no false child cast would have shipped.
- No case in the sample shows Jev crossing the keyword floor's age band (the
  hard rule that a youth pick can never land on an adult-only garment) — the
  rule held in all 300 rows.

## Decision

**Do not flip `STEP_FLOW_CASTING_JEV=on`.** Both independent preconditions fail:
the branch isn't merged/deployed (so there is no live behavior to promote), and
the only real measurement available — the pre-merge dry run — comes in at 18%
coverage against a 40% target. Leaving the switch on `shadow` (its default) is
correct, matching sifu's own read-only recommendation.

### Concrete tuning specified (per acceptance criteria's "or" branch)

The coverage ceiling is explained, not mysterious: `shots.ts`'s casting call site
passes Jev only `productName` and `idea` — never the Etsy tags, which is where
most of the descriptive signal for "who does this look like" actually lives
(compare the dry run's own keyword pass, which matched 121/300 listings using
tag-derived vocabulary vs. Jev's title/idea-only 18% accept rate). The specific,
already-scoped fix:

1. **Pass Etsy tags into `castForDesign`'s context**, the same wording the
   keyword pass already searches, so Jev's `state` carries the same signal the
   deterministic fallback gets today.
2. **Re-run `backend/scripts/jev-casting-sample.ts`** against the same (or a
   fresh) 300-listing sample after the tag change lands, to re-measure coverage
   before considering `on` again.
3. Optionally revisit the child-cast `design_audience` floor (currently 0.85)
   given the "Too Cute To Spook" case above — but only after (1)/(2), since
   raising signal quality is likely to also raise that confidence organically,
   and loosening a safety gate before improving the underlying signal is the
   wrong order of operations.

This exact work is already scoped as Watchtower task `9ce5e15e-78ae-4f80-a4f7-3d4064485973`
(sifu's own follow-up: "pass tags + show the needsReview badge/verdict in the
panel, then re-run the sample script"). Rather than duplicate it on a second
branch, this evaluation defers implementation to that task to avoid two agents
racing the same file (`backend/services/step-flow/casting.ts`) — see the
multi-session git discipline note in this repo's `CLAUDE.md`.

## What has to happen before this task can be re-run for real

1. Merge `3911e9d` (branch `earth/sifu/implement-jev-model-cast-c3bbbb16-mue1f257`)
   to `main` via the pre-merge gate and deploy to Render, so
   `STEP_FLOW_CASTING_JEV=shadow` starts actually running. Filed as Watchtower
   task `52a9ccbe-e622-4056-9890-edabf6e104fd` (blocks this task).
2. Land task `9ce5e15e` (tag-passing + needsReview badge), then re-run the
   sample script to confirm coverage improves.
3. Let shadow mode run live for ~2 weeks so `products.metadata.step_flow.shots.*.casting.jev`
   actually accumulates rows to query (today: 0).
4. Re-run this evaluation (task `e3b25fef`, or a fresh follow-up) against real
   production telemetry using the query pattern in
   `backend/scripts/jev-casting-sample.ts` (path expression:
   `metadata #> '{step_flow,shots}'`, `val #> '{casting,jev}'`).

## Verification

- `git merge-base --is-ancestor 3911e9d origin/main` → not an ancestor (fails).
- `git branch -r | grep implement-jev-model-cast` → no remote branch (commit is
  local-only, per sifu's own handoff: "NOT merged, NOT pushed").
- Live read-only query against `DATABASE_URL_ITP_POOLER` (Supabase pooler,
  `products` table, JSONB path `metadata #> '{step_flow,shots}'`): 27 products
  with shots, 14 with a `casting` object, 0 with `casting.jev`, 0 mentioning
  `"jev"` anywhere in `metadata`. No writes performed.
- Source numbers for the dry run cross-checked against `git show
  3911e9d:docs/reports/jev-casting-sample-2026-09-23.md` (sifu's branch).
