# Jev copy QA benchmark, 2026-09-23

Watchtower task 728d9207. Code: `backend/services/presentation-qa.ts` (section d2),
`backend/services/jev.ts`. Scripts: `backend/scripts/qa-jev-benchmark.ts`,
`backend/scripts/qa-jev-challenge.ts`. Both are read-only and make no vision calls.

## What changed in the gate

1. **Deterministic floor for unfulfillable claims.** Narrow phrases for every `NOT_OFFERED`
   entry: polo shirt, tank top or sleeveless, embroidered, sublimated. Sublimation, polo and
   tank only fire on apparel, because metal art really is dye-sublimated. The floor always
   blocks and Jev can never clear it.
2. **The Jev copy pass** (typesafe/jev-1.13, one decisions call per presentation):
   - `copy_class`: a four-way choice (`copy_ok`, `filler`, `wrong_product_noun`,
     `unfulfillable_claim`) with a written description for each option.
   - `title_quality`: a score on a four-rung rubric (0-3).
   - `tag_N`: a relevance score on a four-rung rubric (0-3) for each tag.
   - Jev can block only on a **confident** (≥0.85) `unfulfillable_claim` or
     `wrong_product_noun`. Filler copy, weak titles and weak tags produce warnings (≥0.75).
     A class answer under 0.75 goes to a person as a `review: 'human'` warning. There is no
     default answer.
3. **New order of checks:** the photo measurements, artwork opacity, fidelity check and Jev
   all run first, in parallel. The deterministic checks come next, unchanged. The
   `gpt-5.6-terra` vision read runs last, and only if its answer can still change the
   outcome.
4. **Modes (`PRESENTATION_QA_JEV`):**
   - `shadow` (the default): Jev's answers are recorded on `criteria.seo.measured.jev`, but
     no verdict changes and vision is never skipped.
   - `enforce`: Jev findings count toward the verdict, and vision is skipped when the
     submission is already certain to fail.
   - `off`: Jev is not called.
   - `JEV=off` is a global kill switch. If Jev is down, the gate fails open to exactly the
     pre-Jev behaviour.

### A deliberate deviation from the brief

The brief asked to skip vision "when Jev has high confidence in presentation copy validity".
**That is not implemented.** The vision reader grades the photo: realism, placement,
typography and background panels. Jev reads only text, so a confident "the copy is fine" says
nothing about a melted hand in the main photo. The gate is fail-closed, so skipping vision on
good copy would have to do one of two things:

- pass a photo nobody checked, or
- fail every good listing as unverified.

What is implemented instead: vision is skipped when the submission is **already certain to
fail**, from a deterministic block or a confident Jev block. That listing goes back for rework
whatever the photo review says, and vision runs on the resubmission. When vision is skipped
this way, the skipped criteria carry a "deferred" warning, not the infrastructure-outage
block.

## Real rows: 60 newest active products per channel

| | storefront | etsy |
|---|---|---|
| Jev answered | 60/60 | 60/60 |
| copy_ok / filler | 58 / 2 | 56 / 4 |
| confident (≥0.75) | 50 | 56 |
| sent to human review | 10 | 4 |
| Jev blocks | 0 | 0 |
| floor hits | 0 | 0 |
| vision calls today | 60 | 60 |
| vision calls under enforce | **24** | **45** |
| vision calls saved | **36 (60%)** | **15 (25%)** |
| Jev cost, all 60 rows | $0.0051 | $0.0058 |
| Jev latency p50 / max | 256 / 362 ms | 242 / 577 ms |

**Where the savings come from:** every vision call saved on today's catalogue comes from
running the deterministic checks first, not from Jev. Most of the saved calls were rows
already blocked on pricing, photos, sharpness or the 300-character description rule. No live
row makes an unfulfillable claim, so Jev made no blocking decision here.

**The rows Jev was unsure about are worth reading:**

- **Six metal-art listings** (storefront) describe "oxidized metal", "abstract sculpture", a
  "metal wall **clock**" and silhouette cut-outs. The product is a flat sublimated aluminium
  panel. Jev did not call that copy `copy_ok`, which is the right instinct: the copy may be
  promising a cut-metal object that ITP does not ship. A person should read these.
- **Four blank-tee listings** have no design to describe, so the design-relevance questions do
  not fit them. That is harmless noise. A follow-up task covers telling Jev when a listing is a blank.

## Labelled challenge set: 12 real apparel listings × 9 variants = 108

The variants are derived from real copy: the original, seeded claims, claims paraphrased past
the regex, a wrong product noun, and design-subject traps that must **not** be flagged.

| variant | floor | jev | floor+jev | to a human | escaped |
|---|---|---|---|---|---|
| original | 12/12 | 12/12 | 12/12 | 0 | 0 |
| seeded: embroidered | 12/12 | 0/12 | 12/12 | 12 | 0 |
| seeded: tank top | 12/12 | 0/12 | 12/12 | 12 | 0 |
| seeded: sublimation polo | 12/12 | 12/12 | 12/12 | 0 | 0 |
| paraphrase: "stitched in raised thread" | 0/12 | **12/12** | 12/12 | 0 | 0 |
| paraphrase: "sleeveless … deep armholes" | 12/12 | 9/12 | 12/12 | 2 | 0 |
| wrong noun: coffee mug | 0/12 | **12/12** | 12/12 | 0 | 0 |
| trap: Sherman tank | 12/12 | 12/12 | 12/12 | 9 | 0 |
| trap: Marco Polo | 12/12 | 12/12 | 12/12 | 3 | 0 |
| **all** | 84/108 (78%) | 81/108 (75%) | **108/108** | 38 | **0** |

108 Jev calls cost $0.0091 in total.

- The floor and Jev catch different things:
  - The regex can never see a paraphrase ("stitched thread") or a wrong product noun.
  - Jev hesitates on literal seeded claims, and sends them to a human instead of blocking.
  - Together they blocked every bad variant, and neither ever blocked a trap.
- The first run scored 85%. Two fixes brought it to 108/108:
  - The option text now says "tank tops **or any sleeveless cut**", "embroidery **or any
    stitched-thread design**" and so on.
  - The floor now includes `sleeveless`.
  - Caveat: the same agent wrote the variants and tuned the wording, so re-run the challenge
    after any prompt change and treat 108/108 as optimistic.
- **Human review load is the cost.** In the challenge set, 9 of the 12 Sherman-tank traps
  were sent to a human (safe, but it is work). On real rows the human-review rate was
  17% (storefront) and 7% (Etsy).

## Recommendation

- Keep `shadow` until the metal-art copy question is settled.
- Once it is, `enforce` is safe to turn on:
  - Real listings: zero false blocks.
  - Challenge set: zero escapes and zero false positives on the design-subject traps.
- `enforce` saves 25-60% of the vision calls on today's catalogue.
- Turning it on needs `OPENROUTER_API_KEY` on Render. Without the key, Jev fails open and
  only the floor applies.
