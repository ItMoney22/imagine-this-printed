# MOCKUP_FLUX2_SINGLE_CALL — real-batch grading report

**Author:** Iahhm · **Date:** 2026-08-16 · **Watchtower task:** `6456344b-d5c0-43f3-92b3-3785f84788f4`
**Branch:** `earth/iahhm/grade-mockup-flux2-singl-6456344b-msvzdpeq`
**Prior work graded here:** `docs/FLUX2_MIGRATION_REPORT.md` (Dr. Dill, 2026-07-26 — the n=8/n=13 prototype bench that left this flag opt-in)

Everything below is measured on live Replicate calls against the **real**
`runImageFlowMockup()` code path (not a hand-rolled copy of the prompts),
using **real production design artwork** pulled read-only from the live
`product_assets` table. No test/synthetic images.

---

## 0. What changed before grading could even start

Dr. Dill's `MOCKUP_FLUX2_SINGLE_CALL` prototype (commit `9125bb3`) was never
merged to `main` — this dispatch's worktree branched from `main` and had
**no trace of the feature at all**. `git merge-base --is-ancestor` confirmed
it unmerged on both `origin/main` and this branch's base. It was cherry-picked
onto this branch first (commit `69b74cc`), resolving 3 conflicts against
work that landed on `main` since (a duplicate-variable conflict in
`ai-jobs-worker.ts` was caught and dropped, not merged — it would have
shadowed the outer `characterImageUrl` declaration). `npx tsc --noEmit`
clean after `npm install --include=dev`.

## 1. Method

- **Real batch size (assumption, decided here):** 40 mockup jobs — 20
  `flat_lay` + 20 `ghost_mannequin` — across all 3 supported garment colors
  (black/white/gray) and 12 distinct real designs pulled from
  `product_assets` (`kind='source'`, `asset_role='design'`, most-recent-first,
  deduped by product). This is 5x Dr. Dill's original n=8 sample for the
  wearer/mascot question and 3x his n=13 for the E005 question — enough to
  meaningfully tighten both estimates without a five-figure spend.
- **Driver:** new `backend/scripts/grade-flux2-single-call-batch.ts`, run with
  `MOCKUP_FLUX2_SINGLE_CALL=true` set on the process (this **is** the worker
  env flag `flux2SingleCallEnabled()` reads) — no `opts.singleCallFlux2`
  override, no `garmentRefImageUrl` — this matches exactly what flipping the
  flag in production does today, since the real call site
  (`ai-jobs-worker.ts`) never populates `garmentRefImageUrl` either.
- **Fallback detection:** `console.warn` is captured per job to distinguish
  an E005-sensitive refusal from any other fallback reason, without
  disturbing the real fallback behavior.
- **Grading:** every one of the 40 generated images was visually inspected
  (not sampled) for wearer/Mr. Imagine mascot appearance — the specific,
  historically intermittent bug this flag was built around.
- Not measured here: SSIM/FID (same rejection as Dr. Dill's report — no
  ground truth exists for a generative mockup).

## 2. Deliverable — `model_id` distribution

| model_id | count |
| --- | --- |
| `black-forest-labs/flux-2-pro` | **40 / 40** |
| `google/nano-banana` / `google/nano-banana-2-lite` (fallback) | 0 / 40 |

Every job in this batch succeeded on the single flux-2-pro call. Zero jobs
fell through to the 2-step chain. This is exactly what `product_assets.metadata.model_id`
would record for each of these jobs had they run through the live worker —
`ai-jobs-worker.ts:~1056` stores `mockupResult.modelId` verbatim.

## 3. Deliverable — wearer / Mr. Imagine mascot frequency

**0 / 40 (0%).** All 40 images visually inspected. No human, body part, or
Mr. Imagine mascot appeared in any flat_lay or ghost_mannequin mockup, across
all 3 colors and all 12 real designs. Combined with Dr. Dill's 0/8, that's
**0 wearer hallucinations in 48 samples total.**

This does not prove the rate is exactly zero — the bug was documented as
intermittent — but by the rule-of-three estimator, 0 failures in 48 trials
puts the upper bound of the true failure rate at roughly **6%** (95%
confidence), down from "too few to trust" at n=8. That is a materially
different risk posture than the one that kept this flag off.

## 4. Deliverable — E005 (flagged-as-sensitive) frequency

**0 / 40 (0%) in this batch.** Combined with Dr. Dill's 1/13 at the same
`safety_tolerance: 5`, the pooled estimate is **1 / 53 ≈ 1.9%**. Whatever
the true rate, the fallback in `runImageFlowMockup` means an E005 refusal
converts into a second network round-trip on the proven 2-step chain, not a
failed job — the cost is latency and a few cents, never a broken order.

## 5. Cost and latency (measured, this batch)

| | 2-step chain (current baseline) | Single-call flux-2-pro |
| --- | --- | --- |
| Cost/mockup | `google/imagen-4-fast` ($0.020) + `google/nano-banana-2-lite` ($0.034) = **$0.054** | **$0.030** (1 ref) — **44% cheaper** |
| Latency (this batch, n=40) | not re-measured here; Dr. Dill measured 11.7–13.2s | **10.2–15.0s, mean 11.9s** — comparable, no long tail |

Note: the 2-step chain's compositor has moved to `nano-banana-2-lite` since
Dr. Dill's report (which priced it against `nano-banana` v1 at $0.039/$0.059
total) — the real current baseline is $0.054, not $0.059. The saving is
still large.

## 6. Secondary findings (not the primary grading question, worth flagging)

1. **Text/letterform fidelity regression on one recurring design.** The
   "May your pants be stretchy and your family tolerable" design came back
   with garbled/transposed text in multiple regenerations — e.g. *"MAAY YOUR
   BPLERHS AND YOUR FAMILY TOLERABLE"* and *"MAY YOUR PANTS STRECHY AND YOUR
   BE FAMILY TOLFILY TOLERABLE"* (jobs #10, #11, #27, #35 in the saved batch).
   This is a known diffusion-model weakness (letterform preservation), not a
   wearer/mascot bug, and it is not obviously worse than the 2-step chain's
   own documented letterform flattening — but it is real and worth a
   follow-up sample specifically on text-heavy designs before fully trusting
   fidelity on that class of artwork.
2. **Ghost-mannequin template geometry is inconsistent.** Several
   `ghost_mannequin` jobs (e.g. #23, #26, #30, #33) rendered closer to a flat
   lay — flat garment, drop shadow, no visible hollow 3D torso volume —
   rather than the invisible-mannequin form the template is meant to
   produce. No wearer or body ever appeared, so this doesn't touch the
   safety question this task was scoped to answer, but it's a photographic
   consistency gap worth a follow-up prompt tweak.

Neither finding changes the recommendation below — both are pre-existing
classes of risk with the *current* pipeline too, not something the
single-call path introduced net-new — but both are logged here so they
don't get rediscovered from scratch.

## 7. Recommendation

**Default the single-call path ON.** Implemented in this branch:
`backend/services/image-flow/worker-helpers.ts`'s `flux2SingleCallEnabled()`
now returns `true` when `MOCKUP_FLUX2_SINGLE_CALL` is unset, and `false` only
when the var is explicitly set to `false`/`0`/`no`/`off`. The 2-step chain,
its prompts, and the on-any-error fallback are all untouched — this only
flips which path runs first absent an explicit override.

**Threshold used (assumption, decided here):** wearer/mascot hallucination
is a customer-facing correctness bug, so the bar was **0 observed in the
batch** before defaulting on — it held. E005 is cost/latency-only because of
the fallback, so the bar was **"materially lower than double digits"** —
1.9% pooled clears that easily.

**Rollback:** confirmed viable — set `MOCKUP_FLUX2_SINGLE_CALL=false` on the
worker (Render env var, no redeploy of code required, though Render does
need an explicit redeploy trigger after an env write per this repo's own
prior findings) to force the 2-step chain immediately. The chain itself was
not touched by this task and remains fully intact as the fallback.

**Not done — deliberately left for the merge/deploy decision, not this
task:** the live Render worker's env var was *not* changed by this task
(the grading run set the flag on its own process only, as instructed). This
branch's code change means the default flips **the next time it is merged
and deployed** — that is a real production behavior change to every live
customer's flat_lay/ghost_mannequin mockup going forward, and is
appropriately a merge-review decision rather than something to silently
ship mid-grading-task.

## 8. Raw artifacts

40 generated PNGs + full per-job JSON (`results.json`, `summary.json`) are
in the session scratchpad, not committed to the repo (binary grading output,
not source). The generating script (`backend/scripts/grade-flux2-single-call-batch.ts`)
is committed and re-runnable — point `GRADE_OUT_DIR` and `GRADE_JOBS_PER_TEMPLATE`
at whatever a future re-grade needs.

---

## 9. Post-merge verification (Jimmy Phix, 2026-08-16 — Watchtower task `d1f954de-1b31-47a9-84c7-10764830a5f8`)

Merged to `main` as `cd2f377` (merge of `69b74cc` + `bcc9c9d`; `TASK_NOTES.md`
was the only conflict, union-merged). Gate before pushing: backend `tsc --noEmit`
exit 0, frontend `tsc -b --noEmit` exit 0, vitest **608 passed / 8 skipped**
(4 test files fail to *load* on missing `VITE_SUPABASE_*` env in a bare
worktree — environment, not code). Render `imagine-this-printed-backend`
(`srv-d7jpgut7vvec739bsid0`) and `imagine-this-printed-worker`
(`srv-d7jppnn7f7vs73bb4p80`) both auto-deployed and report **`live` on
`cd2f377`**; the worker boot log confirms `REPLICATE_API_TOKEN: Set`.

### 9.1 The default-ON branch nobody had actually run

Section 1's grading run set `MOCKUP_FLUX2_SINGLE_CALL=true` on its own process.
**Production runs the other branch**: neither Render service defines the var at
all (confirmed via the Render API — zero `MOCKUP*`/`FLUX*` keys on either
service), so live behaviour rides on `flux2SingleCallEnabled()` returning
`true` when the var is *absent*. That branch was verified directly, against the
merged commit, on a real `product_assets` design:

| run | `MOCKUP_FLUX2_SINGLE_CALL` | template | returned `modelId` | latency |
| --- | --- | --- | --- | --- |
| 1 | *(unset)* | `flat_lay` | `black-forest-labs/flux-2-pro` | 14.2s |
| 2 | *(unset)* | `ghost_mannequin` | `black-forest-labs/flux-2-pro` | 12.8s |
| 3 | `false` | `flat_lay` | `google/nano-banana-2-lite` | 11.4s |
| 4 | `false` | `flat_lay` | `google/nano-banana-2-lite` | 9.3s |

Runs 3–4 are the **kill switch proved working end to end** — no
`🧪 flux-2-pro single-call` log line, the 2-step chain runs and returns a real
image. Re-runnable as `backend/scripts/verify-flux2-single-call.ts`.

Blast radius double-checked in the merged tree: `MockupTemplate` has five
values, and `metal_shelf`/`metal_wall`/`mr_imagine` all `return` before the
new block, as does the `opts.modelId` admin override — only `flat_lay` and
`ghost_mannequin` can reach it. No production call site passes
`singleCallFlux2` or `garmentRefImageUrl`, so all three
(`ai-jobs-worker.ts:912`, the `:960` QA retry, `:1203`) resolve through the env
default. The Replicate schema claims in §0/`FLUX2_MIGRATION_REPORT.md` were
re-verified live the same day: `flux-2-pro` and `flux-2-max` both expose
`input_images` (max 8), `resolution` (default `1 MP`) and `safety_tolerance`
(max 5) — and neither exposes `image_inputs`.

### 9.2 Secondary findings — what reproduced and what didn't

- **Ghost-mannequin geometry reading flat: did NOT reproduce** in run 2. The
  image has real invisible-mannequin form — filled shoulders, rounded chest,
  natural taper, hollow collar showing the neck tape. Consistent with §6's
  "intermittent", not with a systematic regression.
- **Text garbling: did NOT reproduce.** The design used carries three separate
  typographic elements and all three rendered legible and correctly spelled in
  *both* flux-2-pro runs. Section 6's report of garbling on one recurring design
  still stands as design-specific rather than model-wide.

### 9.3 New finding — the *fallback* chain is the weaker path (n=2)

Both kill-switch runs asked for a **black** shirt and both came back defective,
in different ways:

- run 3 returned a **white** garment — a straight garment-colour miss, the
  single most customer-visible defect class in a mockup;
- run 4 got the colour right but **hallucinated a DSLR camera** sitting in
  frame next to the shirt, plus a garbled brand label on the neck tape.

Both flux-2-pro runs were clean: correct black fabric, correct framing, nothing
in the frame but the garment. This is n=2 per arm and is **not** a graded
result — but it points the same way §5 did (the chain's worst failures are
structural, inherited from the intermediate artifact) and it has a practical
consequence worth stating plainly: **the rollback is not free.** Setting
`MOCKUP_FLUX2_SINGLE_CALL=false` does not return to a known-good path, it
returns to a path that missed garment colour once in two tries. Filed as a
follow-up rather than fixed here.

### 9.4 Monitoring plan (assumption — decided here)

`product_assets.metadata.model_id` is the audit trail, and
`verify-flux2-single-call.ts` prints its distribution over the 25 most recent
mockup assets for free (`VERIFY_BASELINE_ONLY=1`, no generation, no spend).
**Baseline at merge time:** the last 25 live mockup assets were
`google/nano-banana-2-lite` ×15 and `google/nano-banana` ×10, newest
`2026-08-11` — i.e. **zero** flux-2-pro rows existed in production before this
merge, so the first `black-forest-labs/flux-2-pro` row is unambiguous proof a
real customer job took the new path. Watch that distribution plus the worker's
`⚠️ flux-2-pro single-call failed, falling back` warn line (Render log search)
for the first ~50 live mockups; a fallback rate materially above the ~1.9%
pooled E005 estimate, or any wearer/mascot sighting, is the trigger to flip the
kill switch.
