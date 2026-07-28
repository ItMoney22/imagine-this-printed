# Model Evaluation — 2026-07-28

Author: Iahhm (ITP Closeout campaign, model-evaluation area)
Tasks: `1957a7ad` (Reimagine standard tier), `6456344b` (MOCKUP_FLUX2_SINGLE_CALL),
`c26d59e9` (hunyuan-3d-3.1 vs Tripo), `3b362203` (buyer-side virtual try-on)

**No live paid generations were run for this document.** Every number below comes from
either (a) the live Replicate model metadata API, (b) the published price on the model's
public page, (c) a vendor pricing page, or (d) an A/B another agent already paid for on a
branch. Where a question genuinely cannot be settled without spending money, the exact
minimum experiment and its cost are specified so David can authorize it deliberately.

---

## 0. The exchange rate everything below is measured against

`backend/config/itc-pricing.ts:24` — **`ITC_TO_USD_RATE = 0.01`. 1 ITC = $0.01.** That
file's own comment records that this is authoritative because five money-moving call
sites (cashout, store credit, checkout ITC application, full-ITC order payment, Connect
payouts) already depend on it.

That rate is *list*. Realized revenue per ITC is lower, because `ITC_PACKAGES`
(`itc-pricing.ts:30-57`) discounts in volume:

| Pack | ITC | USD | Realized $/ITC |
|---|---|---|---|
| 500 | 500 | $5.00 | $0.0100 |
| 1,000 | 1,000 | $10.00 | $0.0100 |
| 2,500 | 2,500 | $22.50 | $0.0090 |
| 5,000 | 5,000 | $40.00 | $0.0080 |
| 10,000 | 10,000 | $70.00 | $0.0070 |

So **1 ITC is worth between $0.0070 and $0.0100 of revenue** depending on which pack the
customer bought. Both bounds are used below.

### Live prices pulled for this document (2026-07-28)

Scraped from each model's public Replicate page (`current_tiers` block) — read-only, no
predictions created.

| Model | Billing metric | Price |
|---|---|---|
| `google/nano-banana` (v1) | per output image | **$0.039** |
| `google/nano-banana-2-lite` | per output image | **$0.034** |
| `black-forest-labs/flux-2-pro` | per run + per input MP + per output MP | **$0.015** each |
| `openai/gpt-image-2` quality `high` | per output image | **$0.128** |
| `openai/gpt-image-2` quality `medium` | per output image | $0.047 |
| `openai/gpt-image-2` quality `low` | per output image | $0.012 |
| `tencent/hunyuan-3d-3.1` | **per unit (run)** | **$0.50** ("or 20 units for $10") |
| `prunaai/p-image-try-on` | $7/1k runs + $8/1k input MP | median actual **$0.0081** |
| FASHN Virtual Try-On v1.6 | 1 credit per output | $0.075 on-demand / $0.0488 Tier III |

---

## 1. `1957a7ad` — Should Reimagine "standard" move to nano-banana-2-lite?

### Recommendation

**Yes, migrate — but the migration is not the finding that matters. The standard tier is
sold below cost, and moving to lite does not fix that.** Migrate for the latency win and
the small margin recovery; re-price the tier separately.

### The headline: the standard tier loses money on every generation

`backend/services/imagination-ai.ts:637-649` charges **1 ITC** and calls
`google/nano-banana` at **$0.039/image**.

| | Revenue (list) | Revenue (10k pack) | Model cost | Margin (list) | Margin (10k pack) |
|---|---|---|---|---|---|
| Reimagine **standard** on v1 | $0.010 | $0.007 | $0.039 | **−$0.029** | **−$0.032** |
| Reimagine **standard** on lite | $0.010 | $0.007 | $0.034 | **−$0.024** | **−$0.027** |
| Reimagine **premium** (50 ITC, gpt-image-2 `high`) | $0.500 | $0.350 | $0.128 | +$0.372 | +$0.222 |

The standard tier costs **3.9x what it sells for** on v1 and **3.4x** on lite. Premium is
healthy at 74% gross margin (44% at the deepest pack discount). The two tiers are not the
same kind of product: premium is a priced feature, standard is an unpriced subsidy.

**Break-even price for standard, on lite: 4 ITC** ($0.034 cost → 3.4 ITC at list, 4.9 ITC
at the 10k-pack rate; 5 ITC is the price that is safe at every pack tier). That is still
a tenth of premium and preserves the "cheap, fast tweak" positioning the UI advertises
(`src/components/CreateDesignModal.tsx:132`).

Re-pricing is a **product decision and a customer-visible change**, so it is written here,
not made. It is a one-row change once decided:
`UPDATE imagination_pricing SET current_cost = 4 WHERE feature_key = 'reimagine_standard';`
— the code already reads the price from that table (`imagination-ai.ts:585-596`) with a
hardcoded fallback of 1, so **the fallback at `imagination-ai.ts:580` must be updated too**
or an unseeded/erroring table silently restores the loss-making price.

### The migration itself: cost and volume

Price delta: **$0.039 → $0.034 = $0.005 saved per generation (12.8%).**

Monthly impact is a function of volume, which is not inferable from the repo. The exact
query that produces it — the deduction ledger writes a stable `reference` string
(`imagination-pricing.ts:186`, `imagination_station:${reason}` where reason is
`reimagine_standard`):

```sql
SELECT date_trunc('month', created_at) AS month, count(*) AS generations
FROM itc_transactions
WHERE reference = 'imagination_station:reimagine_standard'
GROUP BY 1 ORDER BY 1 DESC;
```

Caveat that makes this number *lower* than reality: `deductITC`'s ledger insert is
best-effort (`if (ledgerError) console.error(...)`), and that same file's comment records
that the insert **silently failed for a period** against the live schema. Treat the count
as a floor. The reliable upper-bound cross-check is Replicate's own usage export filtered
to `google/nano-banana`.

Savings at plausible volumes:

| Generations/month | Monthly saving | Annual |
|---|---|---|
| 500 | $2.50 | $30 |
| 2,000 | $10.00 | $120 |
| 10,000 | $50.00 | $600 |

**This is small money.** At any realistic ITP volume the swap saves tens of dollars a
month, while the mispricing above costs $24–32 per thousand generations. The migration is
worth doing for latency; the *reason* to do this task is the pricing finding.

### The real case for migrating: latency, not cost

The tier's entire selling point in the UI is the word "fast"
(`CreateDesignModal.tsx` — "Nano-Banana - fast, good for tweaks"). Live Replicate metadata
for the models' own default examples:

- `google/nano-banana` default example: `predict_time` **10.47s**
- `google/nano-banana-2-lite` default example: `predict_time` **5.37s**

That independently corroborates the 9.02s → 4.35s A/B measured on commit `a7b3393`
(`2.07x faster`). A tier sold on speed should run on the faster model.

### JPEG assessment (deliverable 2) — the part that is actually load-bearing

Live schema check, both models:

```
google/nano-banana        output_format enum ["jpg","png"]  default "jpg"
google/nano-banana-2-lite output_format enum ["jpg","png"]  default "jpg"
```

**The schema accepts `png` on lite — it will not 400.** But `a7b3393`'s live A/B recorded
that lite *ignores* the parameter and returns JPEG anyway, served from a `.png` delivery
URL with an `image/png` content-type header. Corroborating signal from the live API: lite's
default example output is `…/tmpmlo3k05y.jpeg` while v1's is `…/tmp4vqrduzh.jpg` — both
JPEG, which is consistent with (though not proof of) the parameter being inert. Note the
sharper implication: **v1's default is also `jpg`**, so the explicit `output_format: 'png'`
at `imagination-ai.ts:647` is load-bearing today, not decorative.

Downstream impact, traced end to end:

1. **GCS labelling — a real bug, and the sniffer does NOT cover this path.**
   The Reimagine output goes through `persistToGCS` (`imagination-ai.ts:102-127`), which
   (a) hardcodes a `.png` filename and (b) calls `gcsStorage.uploadFromUrl` in
   **`backend/services/gcs-storage.ts`**, which trusts
   `response.headers.get('content-type')`. `a7b3393` added `sniffImageContentType` to a
   *different module* — `backend/services/google-cloud-storage.ts` — and wired it into
   `uploadImageFromUrl` there. **Two similarly-named files, two different upload
   functions.** Migrating Reimagine to lite without touching `persistToGCS` writes JPEG
   bytes to a `.png` object with an `image/png` content type. That is exactly the
   mislabeling Etsy's listing-image validator rejects.

2. **Print-ready render — JPEG does not break it, but it does not save it either.**
   `backend/routes/imagination-station.ts:412-416` runs `sharp(srcBuffer).ensureAlpha()`.
   `ensureAlpha()` on a JPEG adds a **fully opaque** alpha channel; it does not recover
   transparency. So a JPEG layer composites onto the DTF sheet as an opaque rectangle.
   Honest caveat: nano-banana v1's PNG is also typically opaque, so this is not a
   regression *by itself* — transparency in this pipeline comes from the separate
   background-removal step (`imagination-ai.ts:385`, `bg-key.ts`, `removebg.ts`), not from
   the generator.

3. **Where JPEG genuinely hurts: quality, compounded by the print scale-up.**
   Reimagine feeds DTF apparel artwork — the prompt at
   `src/components/CreateDesignModal.tsx:645-652` explicitly asks for *"transparent or
   clean solid background"*, *"high contrast, bold colors"*, *"keep text readable"*. That
   is flat colour and hard edges, the exact content JPEG's chroma subsampling handles
   worst: ringing on letterform edges and colour fringing on saturated flats. Two
   amplifiers specific to this pipeline:
   - the render **upscales to 300 DPI** (`sheets/:id/render`), magnifying every artifact;
   - background removal keys against those artifact-laden edges, producing halos.

   **Net:** JPEG is a quality tax on the one output type that is least tolerant of it. It
   is not a pipeline break.

### Assumptions recorded (the task's open questions)

- *"Handful of real customer-style designs"* — **not run, deliberately.** A statistically
  significant fidelity A/B on single-image edits is the one deliverable here that cannot be
  produced without spending money, and this campaign forbids unauthorized generations.
  See "smallest experiment" below.
- *"Equal-or-better fidelity" metric* — the operative metric for this tier is **edit
  fidelity to the source image** (does the untouched region survive the edit), not prompt
  adherence. `a7b3393`'s A/B measured composite fidelity across 2-input shapes; the
  standard tier is a **1-input edit** (`image_input: [inputUrl]`,
  `aspect_ratio: 'match_input_image'`), so its result does not transfer. That gap is real
  and is why the recommendation below is staged.
- *"Downstream uses"* — enumerated above: `persistToGCS` → GCS object, then either
  `imagination_layers.processed_url` → 300 DPI sheet render → DTF print file, or the
  standalone path → `CreateDesignModal` → product design submission.

### The smallest experiment that settles the open question — **$0.44**

If David wants the fidelity question answered rather than reasoned:

- **6 source images** covering the shapes this tier actually sees: 1 photo, 1 flat vector
  logo, 1 heavy-text varsity graphic (the hardest case), 1 line-art/outline design,
  1 gradient-heavy design, 1 design with fine detail under 2mm.
- **1 tweak prompt each**, held identical across both arms ("change the shirt color to
  navy and keep everything else exactly the same" — an edit that must preserve, which is
  what the tier is for).
- **2 arms × 6 = 12 generations.** Cost: 6 × $0.039 + 6 × $0.034 = **$0.438.**
- **Grade on three binaries per pair:** (a) did the un-prompted region survive unchanged,
  (b) did text/outline strokes stay crisp, (c) did the requested change actually land.
- **Decision rule:** migrate if lite ties or wins on ≥5 of 6 pairs. Sub-$0.50 is not worth
  deliberating over — but it must be authorized, not assumed.

The harness already exists on the unmerged branch:
`backend/scripts/verify-nano-banana-2-lite.ts` (added by `a7b3393`, ~$0.15/run, exercises
the real composite path). It would need a 1-input-edit variant.

### Migration checklist, if approved

**Not applied — `imagination-ai.ts` and `replicate.ts` were committed by another agent
this wave and are out of my file area.** This is the exact change list:

1. `backend/services/imagination-ai.ts:641` — `'google/nano-banana'` → `'google/nano-banana-2-lite'`.
2. `backend/services/imagination-ai.ts:647` — keep `output_format: 'png'`. It is inert on
   lite but harmless, and the line is what keeps v1 lossless if the model is ever reverted.
3. `backend/services/imagination-ai.ts:102-127` — **`persistToGCS` must sniff.** Either
   import `sniffImageContentType`/`extForImageContentType` from `google-cloud-storage.ts`
   and pass an explicit `contentType` + real extension into `gcsStorage.uploadFile`, or
   port the sniff into `gcs-storage.ts:uploadFromUrl`. Prefer the latter — it fixes
   **every** caller of that function at once, not just Reimagine.
   *Note: `sniffImageContentType` does not exist in this tree yet; it arrives with
   `a7b3393`, which is not an ancestor of this branch.*
4. `backend/routes/imagination-station.ts:1494` — update the tier comment.
5. `src/components/CreateDesignModal.tsx:132` — update the tier comment/label.
6. Decide the re-price (above). Ship it in the same change or the migration makes the
   loss *slightly* smaller and nothing else.

### Dead code: `generateFlatLay` / `generateGhostMannequin` (deliverable 6)

**Confirmed dead. Not deleted — `backend/services/replicate.ts` is outside my file area
(committed by the AI-model-retirement agent this wave).**

Proof:

```
$ grep -rn "generateFlatLay\|generateGhostMannequin" backend/ src/ --exclude-dir=node_modules --exclude-dir=dist
backend/services/replicate.ts:423:export async function generateGhostMannequin(input: GhostMannequinInput) {
backend/services/replicate.ts:529:export async function generateFlatLay(input: FlatLayInput) {
```

Definition sites only. Zero importers, zero callers. Live mockup generation goes through
`runImageFlowMockup` (`image-flow/worker-helpers.ts:343`) and
`/api/mockups/itp-enhance` (`backend/routes/mockups.ts:385`) instead. Both dead functions
hardcode `google/nano-banana` at `replicate.ts:424` and `:530` — worth noting because a
future "swap all nano-banana call sites" grep will hit them and waste time on code nobody
calls. Deleting them is a ~110-line removal in one file; safe as its own follow-up task.

---

## 2. `6456344b` — Grade `MOCKUP_FLUX2_SINGLE_CALL`

### Status: **cannot be run as specified — the feature is not in this tree.**

```
$ grep -rn "MOCKUP_FLUX2_SINGLE_CALL" . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git
(no matches)

$ git log --all --oneline -S"MOCKUP_FLUX2_SINGLE_CALL"
9125bb3 dr-dill: migrate to flux-2-pro, fix silent multi-ref bug, prototype single-call mockup

$ git merge-base --is-ancestor 9125bb3 HEAD; echo $?
1                                   # NOT an ancestor
$ git branch -a --contains 9125bb3
  earth/dr-dill/migrate-flux-1-1-pro-ult-e322a3f2-ms2cjxeh
```

The flag, `opts.singleCallFlux2`, `buildFlux2SingleCallPrompt`, `ab-mockup-flux2.mjs` and
`docs/FLUX2_MIGRATION_REPORT.md` all live only on that one unmerged branch.
`worker-helpers.ts` here still has only the `mr_imagine` single-call path, the admin
`opts.modelId` override, and the 2-step chain. Deliverable 1 ("set the env var on the
worker") has nothing to set it on.

So this is graded **on the merits of the approach and its economics**, from the code and
the A/B data on `9125bb3`, plus live pricing. That is the deliverable that can be produced
without spending money, and it is the one that decides whether merging the branch is worth
it at all.

### Cost per mockup — recomputed from live pricing, not from the branch's claims

`black-forest-labs/flux-2-pro` bills **three** metrics at $0.015 each: per run, per **input**
image megapixel, per **output** image megapixel. The single-call path sends 1–2 reference
images and requests one image.

| Path | Components | Cost |
|---|---|---|
| **2-step chain (current default)** | imagen-4-fast scene + nano-banana v1 composite | **~$0.059** |
| 2-step chain *after* the `a7b3393` lite swap | imagen-4-fast + nano-banana-2-lite | **~$0.054** |
| **Single-call flux-2-pro, 1 ref** (design only) | $0.015 run + $0.015 in + $0.015 out | **$0.045** |
| **Single-call flux-2-pro, 2 refs** (garment + design) | $0.015 run + $0.030 in + $0.015 out | **$0.060** |

**The branch's own cost claim is wrong.** Its commit message states
`$0.059 -> $0.030 (1 ref) / $0.045 (2 refs)` — that omits the **output** megapixel charge,
which is a separate billed metric on the live pricing page. Corrected: the 1-ref path saves
**$0.014/mockup (24%)** against today's chain, and only **$0.009 (17%)** against the chain
once the lite swap merges. The **2-ref path is more expensive than the chain it replaces**
($0.060 vs $0.054) — it is a cost *regression*, not a saving, and the 2-ref mode is the one
the branch's own prompt builder treats as the higher-quality configuration.

That single correction changes the decision. This is not a "halve the cost" change; it is a
"shave a cent, or lose one" change.

### The approach on its merits

**Sound reasoning in it:**

- The structural argument is the strongest thing on the branch and is not about cost. The
  chain's worst observed failure was Imagen inventing a chest pocket, after which
  nano-banana — correctly obeying `"Preserve INPUT 1 exactly"` in `buildCompositePrompt`
  (`worker-helpers.ts:300`) — printed the design *inside the pocket at pocket scale*. A
  single-call path has no intermediate artifact to inherit a defect from. **That class of
  bug is unreachable by prompt tuning on the chain**, because the chain's second stage is
  contractually required to preserve whatever the first stage produced, including its
  mistakes.
- `buildFlux2SingleCallPrompt` is written positive-only and never names the mascot. That is
  the correct handling of flux-2-pro having **no `negative_prompt`** (confirmed against the
  live schema: `prompt`, `input_images`, `aspect_ratio`, `output_format`,
  `safety_tolerance`, `resolution` — no negative field), and it matches the same lesson the
  campaign learned independently in `dtf-optimizer.ts`.
- The fallback wraps only the flux call and falls through to the proven chain on any error,
  so the flag cannot fail a job — only make it slower and more expensive.

**Where it is not sound enough to default:**

1. **The negative-prompt loss is the whole reason the chain exists.** The 2-step pipeline
   was built specifically to kill the "all three mockups come back as Mr. Imagine" bug, and
   Step A's fix was Imagen's **dedicated `negative_prompt` field** —
   `worker-helpers.ts:378-386` in this tree still carries the comment saying so: *"provided
   we use the dedicated `negative_prompt` parameter instead of cramming negations into the
   positive prompt (where Imagen down-weights them)."* Replacing that with positive-only
   phrasing on a model with no negative field removes the mechanism and keeps only the
   hope. The task's own context concedes the evidence base: **"zero in 8 samples, too few
   to trust."** Zero-in-8 gives a 95% upper confidence bound of roughly **31%** on the true
   failure rate. That is not a measurement, it is an absence of one.
2. **The E005 refusal rate is a cost leak that the fallback converts rather than removes.**
   1-in-13 at `safety_tolerance: 5` (the *most* permissive setting — there is no headroom
   left to tune) means ~7.7% of mockups pay for a refused flux call **and then** pay for
   the full chain: $0.045 + $0.054 = $0.099. Blended 1-ref cost becomes
   `0.923 × $0.045 + 0.077 × $0.099 = $0.049` — against $0.054 for the chain alone. **The
   realistic saving is ~$0.005 per mockup, ~9%**, not the 24% the sticker price suggests.
   The 2-ref path stays underwater.
3. **`output_format` on flux-2-pro defaults to `webp`** (campaign ledger finding #12, and
   the branch's single-call `buildInput` passes only `safety_tolerance`). Whether the
   mockup upload path handles webp is a separate question the branch did not answer; the
   `sniffImageContentType` helper recognizes webp, but that helper is on a *different*
   unmerged branch.
4. `n=1 per cell` over 12 mockups. The branch author flagged this himself and left the flag
   off. That judgment was correct.

### Recommendation

**Do not default `MOCKUP_FLUX2_SINGLE_CALL`. Do merge `9125bb3` — for the multi-ref bug fix,
not for this flag.**

The genuinely valuable thing on that branch is unrelated to mockups: it found that
`input-builder.ts` was sending flux-2 references under `image_inputs` while the live schema
expects `input_images`, and Replicate **silently ignores unknown input keys** — so every
flux-2-max multi-reference call has been running text-only with its references discarded.
That is a live correctness bug, it is proven (expired-ref-URL differential test), and it is
worth the merge on its own. Verified still present here:
`backend/services/image-flow/input-builder.ts` — flux-2 case.

Keep the single-call path exactly as the branch left it: **opt-in, off by default,
fallback intact.** Revisit only if the chain's structural-defect failures (the pocket case)
turn out to be frequent in production — that, not cost, is the argument that could win.

**Rollback procedure (acceptance criterion 7): confirmed viable by construction.**
`flux2SingleCallEnabled()` reads `process.env.MOCKUP_FLUX2_SINGLE_CALL` on **every call**,
not at module load, so unsetting the variable takes effect on the next job with no
redeploy. No state is written that would survive the flip.

### Assumptions recorded (the task's open questions)

- *"Real batch"* — would be **40 jobs, 20 `flat_lay` + 20 `ghost_mannequin`**, spread over
  ≥4 garment colours including white (the white-on-white contrast case the prompt builders
  special-case) and ≥4 design styles. 20 per template is the smallest n where a 1-in-13
  E005 rate produces a usable estimate. At the blended cost above that batch is
  **~$2.00 for the single-call arm** and ~$2.16 for a paired chain arm — **~$4.16 for a
  properly paired run.** That is the experiment to authorize if the decision is contested.
- *"Acceptable thresholds"* — **0 mascot/wearer appearances in 40** (this is a
  correctness bug that reached a customer before, not a quality slider) and **≤1-in-40
  E005**. Anything above that leaves the blended cost at or above the chain's, at which
  point there is no argument left.

---

## 3. `c26d59e9` — `tencent/hunyuan-3d-3.1` vs Tripo

### Recommendation: **do not integrate. It is 2.5x MORE expensive than Tripo.**

The task's premise is wrong. It states hunyuan *"bills by GPU-seconds, making its per-run
cost unknown."* It does not. `tencent/hunyuan-3d-3.1` is an **official Replicate model
(`is_official: true`) with flat per-unit pricing**, published on its model page:

```json
"prices": [{"metric_display": "unit", "price": "$0.50", "title": "per unit",
            "type": "per-unit", "description": "or 20 units for $10"}]
```

**$0.50 per generation, flat.** One tier, `"criteria": []` — no cheaper rate for
`generate_type: "Geometry"` (untextured), no cheaper rate for lower `face_count`.

| Provider | Cost/model | vs Tripo |
|---|---|---|
| **Tripo v2.5** (untextured image-to-3D, verified live) | **$0.20** | baseline |
| **tencent/hunyuan-3d-3.1** | **$0.50** | **+150%** |

The task asks whether it is *"materially under $0.20"*. It is **2.5x over**. The
cost-effectiveness question is closed with a published number and **zero generations
spent** — deliverables 1–2 (three billed runs) are moot, since no mesh quality result
could justify paying 2.5x on a path whose whole purpose was to be cheaper.

**Assumption recorded** for the open question *"what is materially under $0.20"*: I set the
bar at **≤$0.15 (25% cheaper)** — below that the integration + maintenance of a second 3D
provider costs more than it saves. The actual number is $0.50, so the threshold never came
into play.

### The cost is not the only blocker — three integration gaps

Recorded because they would sink this even if the price flipped.

1. **`face_count` minimum is 40,000. Two of ITP's four print tiers are below it.**
   Live schema: `"face_count": { "minimum": 40000, "maximum": 1500000, "default": 500000 }`.
   Against `SIZE_TIERS` in `backend/services/tripo3d.ts:55-105`:

   | Tier | Tripo `faceLimit` | ITC | hunyuan-capable? |
   |---|---|---|---|
   | mini | 10,000 | 50 | **No** — under the 40k floor |
   | small | 25,000 | 80 | **No** — under the 40k floor |
   | medium | 40,000 | 140 | Yes, exactly at the floor |
   | large | 50,000 | 220 | Yes |

   Mini and small are the impulse-buy tiers David deliberately priced down in 2026-06
   (*"$20-something for user generated is too much — go a little under, get people in"*,
   `tripo3d.ts:64-68`). A provider that cannot render them is not a drop-in fallback; it is
   a partial one that would need per-tier routing.

2. **No quad-mesh option.** The `large` tier sets `quad: true` (`tripo3d.ts:100`). Hunyuan's
   input schema has no quad parameter at all — triangulated output only. The top tier would
   silently lose a quality feature it is priced for.

3. **Output shape is narrower.** Hunyuan returns a **single GLB URI string** (verified: its
   default example output is `…/tmpks5unr_8.glb`). Tripo returns
   `{ glbUrl, pbrUrl?, rendererPreviewUrl? }` (`Tripo3DOutput`, `tripo3d.ts:~118`). The
   preview URL in particular is consumed downstream; a hunyuan lane would have to render
   its own preview or leave that field empty.

   **Good news, narrowly:** GLB matches. The STL conversion path is downstream of GLB
   (`tripo3d.ts` header: *"Tripo3D outputs GLB by default. We convert to STL downstream with
   three.js"*), so acceptance criterion "STL conversion untouched" would have been
   satisfiable. That is the only compatibility box hunyuan ticks.

4. **Latency is 5–2.4x worse.** Hunyuan's default example: `predict_time` **144.7s**. ITP's
   tiers advertise 60s (mini) → 180s (large) in `approxSeconds`. Hunyuan would blow the mini
   and small budgets outright.

5. **Licensing: unresolved, and Replicate does not answer it.** The API returns
   `license_url: null`, `github_url: null`, `paper_url: null` for this model, and the
   README explicitly hedges: *"Availability depends on Tencent's official releases and
   licensing."* Upstream Hunyuan3D releases have historically carried the **Tencent Hunyuan
   Community License**, which is not OSI-standard and has carried territory and
   monthly-active-user restrictions. **ITP sells the resulting meshes as physical prints and
   as paid GLB/STL downloads** (`backend/routes/3d-models.ts:809` — *"Purchase download
   rights for GLB/STL file with ITC"*), which is commercial redistribution of model output.
   That is exactly the use a community license constrains. Since the cost already disqualifies
   the model, this was not chased further — but **if hunyuan is ever revisited, licensing must
   be cleared before a single production mesh is sold**, not after.

### What this means for the "Tripo is now the sole 3D path" concern

Task `5aeeab4f` removed the fal.ai fallback, so Tripo is the only 3D provider. That raised
the value of knowing whether an alternative exists. **The answer is: not this one, and not
at this price.** Concretely, for a real fallback the search should be for a model that is
(a) ≤$0.15/run, (b) has no face-count floor above 10,000, and (c) has an unambiguous
commercial license. Hunyuan fails all three. Candidates worth a look on those criteria
rather than on leaderboard position: self-hosted TRELLIS (already referenced in
`backend/routes/3d-models.ts:5`'s pipeline comment) and Stability's 3D line.

**No hunyuan predictions were created. $1.50 of benchmark spend avoided** — the published
price answered the question the three runs were meant to answer.

---

## 4. `3b362203` — Buyer-side virtual try-on behind an ITC gate

Implementation notes live with the code. This section covers the model/cost decision only.

### The brief mandates FASHN. FASHN is the wrong provider for ITP.

| Provider | Price per try-on | Notes |
|---|---|---|
| FASHN v1.6 on-demand | **$0.075** | verified live on help.fashn.ai — 1 credit/output |
| FASHN v1.6 Tier III | $0.0488 | **requires a prepaid top-up** to reach 35% off |
| **`prunaai/p-image-try-on`** (Replicate) | **~$0.0081 median** | $7/1k runs + $8/1k input MP; `p50price: $0.0081` |
| `cuuupid/idm-vton` (Replicate) | ~$0.024 median | **non-commercial license — disqualified** |

`prunaai/p-image-try-on` is **9.3x cheaper than FASHN on-demand** and **6x cheaper than
FASHN's deepest prepaid tier**, and it runs on infrastructure ITP already pays for:

- no new vendor, no new API key, no new secret to rotate;
- no prepayment to unlock the good rate;
- reuses the existing `Replicate` client and the existing spend visibility;
- `$0.0081` is `p50price` — Replicate's **observed median actual bill**, not a list price,
  so it already accounts for real input megapixel counts.

`cuuupid/idm-vton` is the highest-run-count try-on model on Replicate but its own
description says *"non-commercial use"*. It is excluded on licensing, not on price — worth
recording so nobody re-proposes it for being popular.

**Recommendation: build against `prunaai/p-image-try-on`, keep the provider behind a single
env var so FASHN remains swappable if quality demands it.** The stub is written that way.

### What that does to the economics the task set out

The task says to kill the feature *"if the conversion lift does not cover $0.075 per click."*
At $0.0081 the bar is **9x lower**. Restated in ITP's own units:

- $0.0081 cost = **0.81 ITC** of raw cost.
- At **3 ITC** (the price wired in the prototype), revenue is $0.030 list / $0.021 at the
  deepest pack discount — **profitable at every pack tier**, unlike Reimagine standard.
- The **one free try-on per user per day** costs David $0.0081/user/day, capped by the
  number of distinct signed-in users who try it. 100 daily users exercising the free slot =
  **$0.81/day, ~$24/month.** At FASHN's price the same free tier would be **$225/month.**
  That difference is the entire reason a free daily slot is affordable at all.

### Conversion-lift instrumentation (deliverable 6) — the query, not a dashboard

Every try-on is recorded in `virtual_tryon_uses` with `product_id` and `user_id`, which is
enough to compute the lift from SQL without building an analytics surface:

```sql
-- add-to-cart rate for users who tried on a product vs users who viewed it and didn't.
-- Requires an add-to-cart event source; ITP records purchase, not add-to-cart, so this
-- measures PURCHASE lift until a cart event is instrumented. Stated plainly because
-- purchase lift and add-to-cart lift are not the same number.
WITH tried AS (
  SELECT DISTINCT user_id, product_id FROM virtual_tryon_uses WHERE status = 'succeeded'
)
SELECT
  (SELECT count(DISTINCT t.user_id) FROM tried t
     JOIN order_items oi ON oi.product_id = t.product_id
     JOIN orders o ON o.id = oi.order_id AND o.user_id = t.user_id)::float
  / NULLIF((SELECT count(DISTINCT user_id) FROM tried), 0) AS purchase_rate_tried;
```

**This is deliberately not built as a feature.** A prototype whose job is to prove a
conversion hypothesis needs a number David can query, not a dashboard he has to maintain.
The honest gap: ITP has no add-to-cart event table, so the literal acceptance criterion
("records and reports the add-to-cart conversion rate") cannot be met without adding one.
That is a follow-up task, and it is worth doing before the try-on kill/keep decision, since
the decision depends on it.

---

## Method notes

- **Replicate's public model pages carry a machine-readable `current_tiers` pricing block**
  that the API does not expose. `curl` the page and grep `"current_tiers"` — it gives the
  exact billed metric (`run_count` vs `image_output_count` vs `image_output_megapixel_count`
  vs `unspecified_billing_metric`), which matters because those metrics **stack**. flux-2-pro
  bills three of them at once; costing it as "one price per image" understates it by 3x, which
  is precisely the error on branch `9125bb3`.
- `p50price` on the same block is the **median actual bill** for that model — the closest
  thing to a real-world cost figure available without running anything.
- Model metadata (`GET /v1/models/{owner}/{name}`) is free and returns the full input schema
  including enums and defaults, plus a `default_example` with real `predict_time` metrics.
  That is enough to answer most "will this parameter 400" and "how slow is it" questions
  without a prediction.
