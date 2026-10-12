# Image model bake-off: Nano Banana 2.1 vs flux-2-pro vs GPT Image 2.5 Flare (2026-10-09)

Board task d9c0e648, job 20261007-td9c0e648. Bench: `backend/scripts/ab-image-models-bakeoff.ts`,
test set: `backend/scripts/fixtures/image-model-bakeoff-20.json`. **No generative default was changed.**

## Method
- 20 real ITP products (13 active + 7 drafts with real design art): 10 mockups (flat lay / ghost
  mannequin, 9 tees + 1 hoodie) and 10 on-person shots. 12 designs carry lettering, 4 of them small.
- Same prompt for all three engines per product: mockups use the production
  `buildFlux2SingleCallPrompt`, on-person shots use the production `buildGptPrompt` with a fixed
  persona and scene per product.
- All at ~1 MP: Nano Banana 2.1 via the Gemini API at imageSize 1K, flux-2-pro via Replicate at 1 MP,
  Flare via OpenAI `images.edit` quality high (1024x1024 mockup, 1024x1536 on-person).
- Graded by the unchanged production QA: `checkMockup` (mockups) and `verifyShot` (on-person:
  holistic check, then word by word). One render each, no corrective retry.

## Result (QA pass rate, price not considered)

| Engine | All | Mockups | On-person | Text designs |
|---|---|---|---|---|
| **flux-2-pro** | **18/20 (90%)** | 10/10 | 8/10 | 10/12 |
| GPT Image 2.5 Flare | 17/20 (85%) | 10/10 | 7/10 | 9/12 |
| Nano Banana 2.1 | 14/20 (70%) | 7/10 | 7/10 | 8/12 |

Two products failed on all three engines, so they do not separate them: #13 is a QA false-fail (the
word reader invented "RLS", "PLSTIK" and "THING" that are not on the design; all three renders read
correctly by eye), and #19 has tiny Japanese and slogan text that no engine renders legibly at 1K.
On the other 18: Nano Banana 2.1 failed 4 that flux-2-pro passed (#5 drawstrings over the art, #6 a
dropped "!", #7 oversized print, #18 "QUITERS"); Flare failed 1 (#20 white silhouettes printed dark
gray). No render was flagged "art redrawn" by any engine in this sample.

n=20, so flux-2-pro vs Flare (1 product apart) is a tie within noise. Nano Banana 2.1 trails both, in
line with its model card's small-text caveat.

## Capability gaps that matter
- Nano Banana 2.1: no transparent background, no layers.
- GPT Image 2.5 Flare: real transparency, no layers (png/jpeg/webp only).
- flux-2-pro: runs on Replicate; during this bench the account was under its credit floor and throttled
  to 6 predictions/min, burst 1 (the same credit problem behind 65 of 72 failed mockup jobs in 90 days).

## Recommendation
Keep flux-2-pro for mockups (today's default) and keep the GPT Image chain (Flare first) for on-person
shots (today's default). Do not adopt Nano Banana 2.1 as a default. The mockup fallback
(imagen-4-fast) is dead since Google shut Imagen 4 down and was not reintroduced here; Flare passed
10/10 mockups and is the obvious candidate for that fallback slot, which is a separate decision.

Full per-product table, flags and contact sheets: watchtower `jobs/saturn/20261007-td9c0e648-*.previews/`.
