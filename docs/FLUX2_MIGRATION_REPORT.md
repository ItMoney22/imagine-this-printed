# FLUX.2 [pro] migration — measured results

**Author:** Dr. Dill · **Date:** 2026-07-26 · **Watchtower task:** `e322a3f2-2ea1-4984-8721-c9ef43093288`
**Branch:** `earth/dr-dill/migrate-flux-1-1-pro-ult-e322a3f2-ms2cjxeh`

Everything below is measured on live Replicate calls made on 2026-07-26, not
estimated. Bench harness: `backend/scripts/ab-mockup-flux2.mjs` (re-runnable).

---

## 1. Premise check

The dispatch asked to "migrate to flux-2-pro" and "register flux-2-pro in
`models.ts`". Two corrections up front:

| Dispatch claim | Reality |
| --- | --- |
| flux-2-pro needs registering in `models.ts` | **Already registered** (`models.ts:99`) before this task, and already branded `Imagine Pro`. Its metadata was thin and its cost wrong; that is what actually needed fixing. |
| "~6s latency" | **Not observed.** 22 live flux-2-pro calls ran **7.5–16.3s**; 1 MP text-to-image ≈ 8s, single-reference ≈ 10–15s, two-reference ≈ 14–16s. Budget ~2× the quoted figure. |
| flux-1.1-pro-ultra is used broadly | Only one script (`generate-style-previews.ts`) used it in an image-flow path. Other references live in `services/imagination-ai.ts`, `services/replicate.ts`, `routes/user-products.ts`, `src/types/index.ts`, `src/pages/UserProductCreator.tsx` — **out of scope here, still on Ultra.** See §7. |

Model verified live: `black-forest-labs/flux-2-pro`, 9,576,875 runs, accepts
`input_images` (max 8, 9 MP total input), output a single URI. `resolution`
enum `0.5/1/2/4 MP`, `safety_tolerance` 1–5.

---

## 2. The bug this task uncovered

`input-builder.ts` was sending reference images to the flux-2 family under the
key **`image_inputs`**. The Replicate schema for both `flux-2-pro` and
`flux-2-max` has no such field — the parameter is **`input_images`**.

Replicate does not reject unknown input keys, so this failed *silently*.
Proof, run with a deliberately expired reference URL:

| Parameter sent | Result |
| --- | --- |
| `input_images` (correct) | prediction **failed**: `404 Client Error: Not Found for url: <ref>` — the model fetched the reference |
| `image_inputs` (what the repo sent) | prediction **succeeded** — the model never looked at the URL |

Every `flux-2-max` multi-reference call in this repo has been running
**text-only, silently discarding its references.** `flux-2-max` is in
`ADMIN_MULTI_MODEL_IDS`, so this affected the admin fan-out. Fixed.

---

## 3. Cost

Vendor-published FLUX.2 [pro] pricing: **$0.015 per input MP + $0.015 per
output MP** (not independently billable-verified here; latency and success were
measured, per-call billing was not).

| Path | Before | After | Δ |
| --- | --- | --- | --- |
| Style previews (7 styles, text-to-image) | $0.42 (Ultra @ $0.06) | **$0.105** | **−75%** |
| flat_lay / ghost_mannequin mockup | $0.059 (2-step chain) | **$0.030** (1 ref) / **$0.045** (2 refs) | **−49% / −24%** |

The 2-step chain baseline is `google/imagen-4-fast` ($0.020) +
`google/nano-banana` ($0.039).

---

## 4. Latency (measured)

| Template | Arm | Black | White |
| --- | --- | --- | --- |
| flat_lay | A — 2-step chain | 12.7s | 12.5s |
| | B — flux-2-pro, 1 ref | 15.3s | 11.2s |
| | C — flux-2-pro, 2 refs | 16.0s | 14.9s |
| ghost_mannequin | A — 2-step chain | 11.7s | 12.3s |
| | B — flux-2-pro, 1 ref | 12.0s | 10.6s |
| | C — flux-2-pro, 2 refs | 16.3s | 14.5s |

**One call is not faster than two here.** Arm B is a wash against the chain;
arm C is ~2–4s slower. The win is cost and architectural simplicity, not speed.

---

## 5. Quality

### Metric choice (open question — decided)

SSIM/FID were **rejected**. SSIM needs a ground-truth target image that does not
exist for a generative mockup, and FID needs thousands of samples per arm to
mean anything — at $0.03–0.06 a sample that is a five-figure bench to measure
the wrong thing. Neither scores what actually breaks in production.

Used instead: a **5-point pass/fail rubric over this pipeline's documented
failure modes**, graded by eye on 12 mockups (2 templates × 3 arms × 2 colors):

1. **No wearer** — no human, body part, or Mr. Imagine mascot (the recurring bug the 2-step chain was built to defeat)
2. **Garment color correct** — especially white staying white (documented regression)
3. **Design fidelity** — colors, shapes, proportions preserved
4. **Template geometry** — flat_lay top-down flat; ghost_mannequin hollow 3D form
5. **Print placement + scale** — front-center, commercially usable size

### Results

| # | Criterion | A (2-step) | B (flux2 ×1) | C (flux2 ×2) |
| --- | --- | --- | --- | --- |
| 1 | No wearer / mascot | 4/4 | 4/4 | 4/4 |
| 2 | Garment color | 3/4 | 4/4 | 4/4 |
| 3 | Design fidelity | 4/4 | 4/4 | 4/4 |
| 4 | Template geometry | 4/4 | 4/4 | 4/4 |
| 5 | Placement + scale | **2/4** | 4/4 | 4/4 |

**Verdict: the single flux-2-pro call is comparable-to-better than the two-call
chain, and the acceptance criterion is met.**

Specifics:

- **The mascot never appeared.** Zero hallucinated wearers in any arm, including
  all 8 flux-2-pro mockups, which have no `negative_prompt` to lean on. This was
  the single biggest risk going in and it did not materialize — see §6 for why
  that is not the same as "solved."
- **Arm A's worst failure was structural, not stylistic.** On black flat_lay,
  Imagen invented a **chest pocket** the prompt never asked for, and nano-banana
  — correctly obeying "preserve INPUT 1 exactly" — printed the tiger *inside the
  pocket* at pocket scale. A defect in the intermediate artifact propagated into
  the final image. **The single-call path is structurally immune to this class of
  bug** because there is no intermediate artifact to inherit defects from. That
  is the strongest argument for the migration, stronger than the cost saving.
- **Arm A also drifted on color**: black flat_lay came back dark navy/charcoal
  with a visible brand tag, not black.
- **Print scale**: flux-2-pro consistently produced larger, more commercially
  usable front-center prints; arm A tended to undersize.
- **DTF realism**: arm C was best — visible fabric weave and ink texture through
  the print, the most convincing "real transfer on cotton" of the set.
- **White garments**: all three arms held white correctly. The historical
  white→black regression did **not** recur in this run.

---

## 6. Risks — read before enabling in production

1. **Sample size is n=1 per cell.** 12 mockups, one seed each. This is enough to
   show the single call is *viable*; it is **not** enough to claim a lower
   hallucination rate than the chain. The mascot bug was always intermittent —
   an intermittent bug not firing in 8 samples is weak evidence. Grade a real
   batch before flipping the flag on by default.
2. **flux-2-pro refuses benign garment mockups.** One call in ~13 came back
   `flagged as sensitive (E005)` on a **white t-shirt with a tiger graphic**,
   *at `safety_tolerance: 5`, the most permissive setting*. Roughly 8%, small
   sample. This is the same false-positive class that got `imagen-4-ultra`
   excluded from the design fan-out (`FANOUT_EXCLUDE`). The implemented path
   falls back to the 2-step chain on any error, so a refusal costs latency, not
   a failed job.
3. **No `negative_prompt` — and negations actively backfire.** BFL document that
   naming a thing to exclude "might actually add what you're trying to avoid."
   `buildFlux2SingleCallPrompt()` is therefore written **positive-only** and
   deliberately never names the mascot. Reintroducing `do NOT ...` phrasing there
   risks summoning the exact failure the 2-step chain exists to prevent. There is
   a comment saying so on the function; leave it there.
4. **Prompt duplication.** `ab-mockup-flux2.mjs` mirrors the prompt builders
   rather than importing them (it is dependency-free so it runs without a backend
   `npm install`). Re-sync it before trusting a future re-run.

---

## 7. Not done — deliberately out of scope

`flux-1.1-pro-ultra` is still referenced in five places this task was not scoped
to touch. They are live user-facing paths, not dead code, and each is a real
behavior change:

- `backend/services/imagination-ai.ts:243`
- `backend/services/replicate.ts:17,75,106`
- `backend/routes/user-products.ts:626`
- `src/types/index.ts:1078`
- `src/pages/UserProductCreator.tsx:447`

Migrating these is the same 75% saving on the highest-volume generation path in
the product. Filed as a follow-up rather than done silently.

---

## 8. How to enable / roll back

Off by default. Nothing changes until the flag is set.

```bash
# worker env — enable the single-call prototype
MOCKUP_FLUX2_SINGLE_CALL=true
```

Per-call override: `runImageFlowMockup({ ..., singleCallFlux2: true })`.
Optional second reference: `garmentRefImageUrl` — a real blank-product photo,
which locks fabric color and cut instead of leaving them to the model.

**Rollback:** unset the env var. The 2-step chain is untouched and remains the
default and the error fallback.

**Audit trail:** `product_assets.metadata.model_id` records which path produced
each image (`black-forest-labs/flux-2-pro` vs `google/nano-banana`), so a
production A/B can be graded straight from the table.
