# Imagine design overhaul — GPT Image 2 house pipeline + Mrs. Imagine

**Date:** 2026-08-20 · **Author:** zero-nine · **Status:** approved-by-directive (David, 2026-08-20)

David: "our designs are lacking… gpt image 2 is the best image model for now, we
should only do gpt image 2 [for] the stuff we are selling… openai api not
replicate… create a misses imagine… she needs to go on etsy and look for
realtime data… after she designs she must approve her work by looking at it,
the mockups and all, then she walks the design right into the etsy drafts."

## Locked decisions (from the directive)

1. **House designs (stuff ITP sells) generate ONLY with `gpt-image-2`, via the
   OpenAI API directly** — never through Replicate's hosted copy (no markup, no
   queue, no burst-1 rate limit). Vendors / users / creators keep the existing
   Replicate roster untouched.
2. **Mrs. Imagine** is a new autonomous house designer. Per batch: **10 garment
   designs (tees / hoodies / polos) + 5 metal-print designs**, briefed from
   **realtime Etsy marketplace data** (public `listings/active` search — the
   first real marketplace research in the codebase; the old "etsy trends" was
   Google-SERP scraping).
3. She **approves her own work by looking at it** — the existing presentation
   QA vision gate (`gpt-5.6-terra`, fails closed) IS that look. Pass → she
   queues the Etsy tiers herself; the etsy-jobs-worker walks each into a
   **DRAFT** listing. David's only remaining act is *activate* in Shop Manager.
4. TikTok: each published design also stages a `social_outbox` TikTok draft
   (review-gated rail that already exists). Real TikTok *Shop* remains blocked
   on David creating the Partner Center app (plan doc 2026-06-17).
5. "Best brain to do search": the research brain is `MRS_IMAGINE_BRAIN_MODEL`
   (default `gpt-5.6-terra` — the strongest model this repo names), fed real
   Etsy data. Mr. Imagine's conversational studio brain stays fast/cheap.

## Architecture

### A. Provider split in image-flow
- `models.ts`: `Provider = 'replicate' | 'openai'`; the `openai/gpt-image-2`
  entry becomes `provider: 'openai'`. Registry cost figure stays 0.04 (the
  routed-API cost gate keys off it; the house path bills by quality directly).
- One dispatch point `runRegisteredModel()` in worker-helpers: provider
  `'openai'` → `runOpenAIImage`/`editOpenAIImage` (existing direct provider,
  falls back to gpt-image-1 only if the account loses gpt-image-2), else
  `runReplicate`. `api/generate.ts` + `api/edit.ts` get the same branch.
- House fan-out: admin create routes pin `input.modelIds =
  houseDesignRoster()` = `HOUSE_DESIGN_VARIANTS` (default 3) × gpt-image-2,
  each with its own enhanced prompt so the takes differ. Worker forwards
  `job.input.modelIds`. Creator-studio jobs carry no `modelIds` → unchanged.

### B. Mrs. Imagine
- `services/etsy-market-research.ts` — public Etsy search (`keystring:secret`
  header, read-only, NOT gated on `ETSY_ENABLED`); seed queries per category;
  aggregates tag frequency, title n-grams, price bands, favorites/recency heat.
- `services/mrs-imagine.ts` — productionized `design-e2e.ts` chain per design:
  brief → gpt-image-2 (high) → copy written to gate thresholds → product row
  (house shape, `status:'draft'`) → rembg (851-labs, $0.002 — the one Replicate
  call left in the house path, because gpt-image-2 cannot emit alpha) →
  mockup fan-out (worker) → gallery sync → QA storefront → Etsy pack +
  copyright gate + QA etsy → model shots → queue Etsy tiers → TikTok draft.
  One corrective regeneration on a blocking QA verdict (findings fed back into
  the prompt), then rework-flagged, never force-shipped.
  Batch state lives on an `ai_jobs` row `type:'mrs_imagine_batch'` (no new
  tables, no prod DDL). Runs inline on the API process (fire-and-forget, same
  pattern as `processImageJobInline`); mockups still render on the worker.
- `routes/admin/mrs-imagine.ts` — `POST /run`, `GET /runs`, `GET /research`
  (dry preview). Auth: admin session OR `DESIGN_AGENT_TOKEN` + `x-agent-id`
  (`mrs-imagine` added to the allowlist) so the Watchtower can run her daily.
- Persona: matching fluffy-monster portrait generated from Mr. Imagine's
  reference via gpt-image-2 edit → `public/mrs-imagine/`. Small admin card
  (`AdminMrsImagine.tsx`) to trigger/watch batches.

### C. Polos
`productType` union gains `'polo'` (worker-helpers garment maps + ai-products
category mapping → category `shirts` + `print_locations:['front_image']`).

## Costs (per 15-design batch, defaults)
gen 15×~2 takes×$0.17≈$5 · rembg $0.03 · mockups ~60×$0.03≈$1.8 · model shots
~$3 · QA vision ~$1 → **≈ $10–12 per batch**. Env-tunable counts/quality.

## Env
`HOUSE_DESIGN_VARIANTS=3`, `HOUSE_GPT_IMAGE_QUALITY=high`,
`HOUSE_GPT_IMAGE_SIZE=1024x1024`, `MRS_IMAGINE_BRAIN_MODEL=gpt-5.6-terra`,
`MRS_IMAGINE_GARMENT_COUNT=10`, `MRS_IMAGINE_METAL_COUNT=5`,
`MRS_IMAGINE_AUTO_ACTIVATE=true` (storefront activate on QA pass),
`MRS_IMAGINE_AUTO_QUEUE_ETSY=true`, `MRS_IMAGINE_MODEL_SHOTS=true`.

## Out of scope (noted for David)
- TikTok Shop commerce (blocked on Partner Center app — his move).
- Replicate rembg replacement (needs a self-hosted rembg to be truly
  Replicate-free; $0.002/image doesn't justify it yet).
- The uncommitted Etsy-taxonomy work in the shared checkout belongs to another
  session and is not touched here.
