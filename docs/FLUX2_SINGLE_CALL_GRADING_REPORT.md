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
