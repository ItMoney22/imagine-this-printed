# ITP Codebase Audit — Findings

Initial pass: 2026-04-21. Documentation only, no code changes.

Findings sourced from 8 parallel audit agents covering all scope items in `HANDOFF_2026-04-21.md`. Subsequent `/loop` iterations (every 20m) will deepen any thin section and may add entries.

---

## Scope 1 — Image models inventory

## [severity: high] Direct image generation calls bypass unified wrapper

**File(s)**: `backend/services/imagination-ai.ts:174`, `backend/services/imagination-ai.ts:313`, `backend/services/imagination-ai.ts:382`, `backend/services/imagination-ai.ts:454`
**Issue**: Four separate `replicate.run()` calls (Flux, Real-ESRGAN, Recraft, Nano-Banana) scattered across different service methods lack a centralized parameter catalog or cost tracking.
**Recommended fix**: Extract into a single `ImageGenerationService` wrapper exposing model registry + cost/param matrix (mirrors david-trinidad-com `image-flow/lib/models.ts`).
**Effort**: M

## [severity: high] Replicate model wrappers inconsistently parameterized

**File(s)**: `backend/services/replicate.ts:85-200` (generateWithSingleModel), `backend/services/vertex-ai-mockup.ts:188`, `backend/worker/ai-jobs-worker.ts:763-802`
**Issue**: Model params (`aspect_ratio`, `safety_filter_level`, `output_format`) duplicated across 3+ call sites with drift risk; Gemini 2.5 Flash Image and Replicate Nano-Banana both used for mockups with no unified orchestration.
**Recommended fix**: Single `ModelCatalog` config object; all calls reference it by model ID.
**Effort**: M

## [severity: med] Missing cost estimation per AI call

**File(s)**: All image generation entry points in `backend/services/`
**Issue**: `imagination-ai.ts` deducts ITC cost but Replicate endpoints (Flux 1.1 Pro Ultra ~$0.06, Real-ESRGAN ~$0.005/call, Nano-Banana ~$0.02) lack documented $/call mapping; no cost logging to justify deductions.
**Recommended fix**: Add `CostLog` entry on each `replicate.run()` + `predictions.create()` call (model, version, input size, estimated cost).
**Effort**: M

## [severity: med] Output format handling fragmented

**File(s)**: `backend/services/imagination-ai.ts:19-86` (extractUrlString), `backend/services/replicate.ts:478-507` (extractUrl)
**Issue**: Two independent URL extraction utilities for Replicate outputs (FileOutput, string, URL object); both infer rather than guarantee PNG format.
**Recommended fix**: Centralize in `ReplicateOutputFormatter` class; validate MIME type.
**Effort**: S

## [severity: med] Vertex/Gemini integration partially abandoned but not removed

**File(s)**: `backend/services/vertex-ai-mockup.ts` (402 lines), `backend/worker/ai-jobs-worker.ts:7` (commented import)
**Issue**: Gemini 2.5 Flash Image + Imagen 3 fallback is dead code; Replicate Nano-Banana is primary, but Google API key + endpoint remain in use creating dual-path risk.
**Recommended fix**: Archive `vertex-ai-mockup.ts`; move Nano-Banana logic into unified `replicate.ts`.
**Effort**: M

## [severity: low] DTF optimization params not exposed in model config

**File(s)**: `backend/worker/ai-jobs-worker.ts:292-303`, `backend/services/replicate.ts:206-211`
**Issue**: DTF shirt color + print style passed inline to `buildDTFPrompt()` rather than cataloged as model variant params.
**Recommended fix**: Nest DTF params in `ReplicateImageInput.dtf?: {shirtColor, printStyle}` with catalog entry.
**Effort**: S

---

## Scope 2 — DTF rule compliance

## [severity: high] No transparent background enforcement in DTF path

**File(s)**: `backend/services/dtf-optimizer.ts:13-109`, `backend/worker/ai-jobs-worker.ts:184-208`
**Issue**: DTF-optimized images are created (with black removal) but never validated to ensure transparent background is actually present before export.
**Recommended fix**: Add validation in `optimizeForDTF()` to check alpha channel and enforce it post-export.
**Effort**: M

## [severity: high] Missing DPI validation on DTF assets

**File(s)**: `backend/worker/ai-jobs-worker.ts:305-326`, `backend/services/replicate.ts:201-252`
**Issue**: DTF assets saved with hardcoded 1024x1024 dimensions but no 300 DPI validation; 1024px at print size ≠ 300 DPI guarantee.
**Recommended fix**: Store actual image metadata + print size to compute real DPI; fail if < 300.
**Effort**: M

## [severity: med] No sRGB color profile enforcement

**File(s)**: `backend/services/dtf-optimizer.ts:24-105`
**Issue**: DTF optimization operates on raw pixel data but does not embed or validate sRGB ICC profile in output PNG.
**Recommended fix**: Use sharp's `.withMetadata()` or ICC profile embedding before PNG export.
**Effort**: M

## [severity: med] Aspect ratio rules missing for product types

**File(s)**: `backend/routes/admin/ai-products.ts:196-209`, `backend/services/replicate.ts:22-27`
**Issue**: Prompts hardcode 1:1 (1024x1024) for all products; no validation that shirt/tumbler/hoodie designs match product-specific aspect ratios.
**Recommended fix**: Define aspect-ratio map (shirt: 4:5, tumbler: 2:3, etc.) and validate or reject.
**Effort**: S

## [severity: med] Transparent background prompt is optional, not mandatory

**File(s)**: `backend/services/imagination-ai.ts:154-163`
**Issue**: Legacy prompts only append "transparent background" when no DTF formatting detected; legacy ImaginationAI path does not guarantee transparency.
**Recommended fix**: Always append "TRANSPARENT BACKGROUND REQUIRED" to all DTF/sublimation/gang-sheet prompts, regardless of path.
**Effort**: S

## [severity: low] DTF-optimized assets not flagged in metadata

**File(s)**: `backend/worker/ai-jobs-worker.ts:306-325`
**Issue**: Asset metadata stores shirt color and print style but no `is_dtf_compliant` flag; unclear which assets meet full compliance.
**Recommended fix**: Add explicit `is_dtf_compliant` boolean to metadata after validation.
**Effort**: S

---

## Scope 3 — Prompt enhancer alignment

## [severity: high] No central prompt enhancer; shaping scattered and duplicated

**File(s)**: `backend/services/ai-product.ts:40-126`, `backend/services/dtf-optimizer.ts:362-421`, `backend/services/replicate.ts:201-211`, `backend/services/replicate.ts:346-376`, `backend/services/replicate.ts:443-468`
**Issue**: ITP has no dedicated prompt enhancer like `david-trinidad-com/src/modules/image-flow/lib/prompt-enhancer.ts`. Prompt construction happens inline across five locations with no typed abstraction for DTF/mockup/marketing branches.
**Recommended fix**: Create `backend/lib/prompt-enhancer.ts` with typed `enhance({ type: "dtf" | "mockup" | "marketing"; userPrompt; productContext })` function.
**Effort**: M

## [severity: med] DTF prompt logic duplicated in replicate.ts and dtf-optimizer.ts

**File(s)**: `backend/services/dtf-optimizer.ts:362-421` (buildDTFPrompt), `backend/services/replicate.ts:204-211`, `backend/services/ai-product.ts:112-126`
**Issue**: `buildDTFPrompt()` lives in dtf-optimizer but `normalizeProduct()` in ai-product.ts injects raw DTF context directly into the user prompt without invoking the shared builder — two prompt-shaping paths.
**Recommended fix**: Make `normalizeProduct` call the unified DTF enhancer, or move `buildDTFPrompt` to `backend/lib/` and have both services import it.
**Effort**: S

## [severity: med] Mockup prompts hardcoded in replicate.ts with no reuse

**File(s)**: `backend/services/replicate.ts:346-376`, `backend/services/replicate.ts:443-468`
**Issue**: Three mockup prompt templates (flat_lay, mr_imagine, ghost_mannequin) built inline; style changes require three edits.
**Recommended fix**: Extract to a `MockupPromptTemplates` record keyed by template type, or a `buildMockupPrompt(template, fabricColor, productName, placement)` helper.
**Effort**: S

## [severity: low] imageStyle context dropped before Flux

**File(s)**: `backend/services/replicate.ts:201-217`, `backend/services/ai-product.ts:121`
**Issue**: `normalizeProduct()` respects `imageStyle` (realistic/cartoon/semi-realistic) in its system prompt, but `ReplicateImageInput` has no imageStyle field — style hint is lost before Flux.
**Recommended fix**: Extend `ReplicateImageInput` with optional `imageStyle`; propagate from ai-products route.
**Effort**: S

---

## Scope 4 — Model parameter exposure (admin UI)

## [severity: high] Hardcoded AI model params in imagination-ai.ts

**File(s)**: `backend/services/imagination-ai.ts:174-186`
**Issue**: Critical Flux params (`aspect_ratio`, `output_format`, `output_quality`, `safety_tolerance`, `prompt_upsampling`) are hardcoded in the backend with no admin UI toggle — violates the "expose all model features" rule.
**Recommended fix**: Add admin form controls in MrImagineModal to expose `aspect_ratio`, `output_quality`, `safety_tolerance`, `num_outputs` as optional toggles.
**Effort**: M

## [severity: high] AdminCreateProductWizard lacks seed and advanced controls

**File(s)**: `src/components/AdminCreateProductWizard.tsx:35-52`
**Issue**: Admin wizard exposes only `tone`, `imageStyle`, `mockupStyle`, `productType`; hides `seed`, `steps`, `cfg_scale`, `guidance_scale`, `num_outputs`, `negative_prompt` from Flux/Imagen.
**Recommended fix**: Add "Advanced Model Settings" section with `seed` (reproducibility), `num_outputs`, `output_quality` controls.
**Effort**: M

## [severity: med] MrImagineModal hides output_quality / safety_tolerance

**File(s)**: `src/components/imagination/MrImagineModal.tsx:90-94`
**Issue**: Output size exposed (1024/1536/2048) but `output_quality`, `safety_tolerance`, `prompt_upsampling` hardcoded in backend.
**Recommended fix**: Add "Advanced" dropdown exposing `output_quality` (1-100) and `safety_tolerance` (0-2).
**Effort**: M

## [severity: med] 3D Model form omits style-specific params

**File(s)**: `src/components/3d-models/Create3DModelForm.tsx:12-32`
**Issue**: Exposes 4 hardcoded styles only; backend likely supports `num_outputs`, `seed`, quality tiers not surfaced.
**Recommended fix**: Add "Advanced generation settings" toggle showing estimated ITC cost per param change (seed lock, batch size, quality tier).
**Effort**: M

---

## Scope 5 — Cost safeguards

## [severity: high] No pre-call cost confirmation on expensive operations

**File(s)**: `backend/routes/imagination-station.ts:506-512`, `576-614`, `664-712`, `767-806`
**Issue**: AI ops (`generateImage`, `removeBackground`, `upscale`, `enhance`) are called directly — cost is deducted silently inside the service after the request is processed. Violates the `feedback_fal_cost_safeguards` rule (confirm $ before expensive calls).
**Recommended fix**: Return cost estimate to frontend BEFORE deduction; require explicit user confirm button ("Confirm $X charge") before calling the service.
**Effort**: M

## [severity: high] Silent retry loops on Replicate can multiply costs

**File(s)**: `backend/routes/ai/image-tools.ts:32-54`, `63-94`, `100-133`
**Issue**: Three `replicate.run()` calls have no explicit retry bound; Replicate SDK may silently retry; `Promise.allSettled()` in `replicate.ts:222` can cascade into duplicate charges.
**Recommended fix**: Wrap all `replicate.run()` in try/catch with explicit `maxAttempts` counter (≤2); log each attempt's cost impact.
**Effort**: M

## [severity: med] Missing per-call cost logging for audit trail

**File(s)**: `backend/services/imagination-ai.ts:141-239`
**Issue**: ITC deduction is logged by `pricingService.deductITC()`, but no record of actual API cost vs. ITC charged for reconciliation with Replicate billing.
**Recommended fix**: Add `costLog.recordApiCall({ userId, feature, model, apiCost, itcCharged, timestamp })` before deduction.
**Effort**: M

## [severity: med] imagination-pricing hardcoded config never consulted by AI service

**File(s)**: `backend/config/imagination-pricing.ts:20-36` vs. `backend/services/imagination-pricing.ts:98-146`
**Issue**: Hardcoded `IMAGINATION_PRICING` (DTF=$14 ITC, sublimation=$8 ITC, UV-DTF=$12 ITC) is never consulted; AI service queries `imagination_pricing` Supabase table instead. Stale/missing DB rows → falls to 0 or errors.
**Recommended fix**: Seed DB from hardcoded config on startup; warn if a feature key is missing.
**Effort**: S

## [severity: med] Remove.bg calls (~$0.50-1/call) not tracked separately

**File(s)**: `backend/services/removebg.ts:5-39`, `backend/services/imagination-ai.ts:260`
**Issue**: `removeBackgroundWithRemoveBg()` calls paid Remove.bg API but cost is not tracked; ITP deducts generic `bg_remove` ITC but never logs actual Remove.bg charge.
**Recommended fix**: Log Remove.bg API cost separately; reconcile monthly with Remove.bg invoice.
**Effort**: M

## [severity: low] Vertex/Gemini mockup fallback chain unpriced

**File(s)**: `backend/services/vertex-ai-mockup.ts:247-304`
**Issue**: `generateMockup()` calls Gemini 2.5 Flash then falls back to Imagen 3 on failure — neither call is cost-checked or logged. Fallback path = silent double charge.
**Recommended fix**: Add `pricingService.checkCost()` guard; log extra fallback charge and surface to user.
**Effort**: M

---

## Scope 6 — Frontend ↔ backend contract drift

## [severity: high] Image processing response keys drift in Imagination Station

**File(s)**:
- `backend/routes/imagination-station.ts:603-607` (remove-bg)
- `backend/routes/imagination-station.ts:699-708` (upscale)
- `backend/routes/imagination-station.ts:794-802` (enhance)
- `src/pages/ImaginationStation.tsx` (~1580 handleRemoveBackground, ~1620 handleUpscale)
**Issue**: Backend returns `processedUrl` as primary plus aliased fallbacks (`imageUrl`, `url`, `output`); frontend requires fallback chain `data.processedUrl || data.imageUrl || data.url || data.output`. If primary stops emitting, FE silently fails.
**Recommended fix**: Shared type `ITPProcessResponse { processedUrl: string; originalUrl: string; ... }` enforced on both sides; drop aliases.
**Effort**: M

## [severity: high] Legacy image-tools route returns inconsistent keys

**File(s)**: `backend/routes/ai/image-tools.ts:45-50`, `85-89`, `124-128`
**Issue**: Three legacy `/api/ai/*` endpoints return different key names (`upscaled_url`, `result_url`, `enhanced_url`) vs. the normalized `processedUrl`. Frontend silently fails on shape mismatch.
**Recommended fix**: Unify to `{ processedUrl, originalUrl, ok }` matching imagination-station; or deprecate and delete these legacy routes.
**Effort**: S

## [severity: med] Admin AI products response shape not typed

**File(s)**: `backend/routes/admin/ai-products.ts:369`, `329-333`; `src/components/AdminCreateProductWizard.tsx` (~340)
**Issue**: `/remove-background` and `/create-mockups` return `{ job }` directly; frontend caller doesn't destructure or type-check. If backend wraps response (e.g., `{ data: job }`), FE won't detect.
**Recommended fix**: Shared `AIJobResponse { job: AIJob }` interface enforced in both sides.
**Effort**: S

## [severity: med] Stripe checkout response lacks explicit type contract

**File(s)**: `backend/routes/stripe.ts:115-121`, `251-256`; `src/pages/Checkout.tsx` (~280)
**Issue**: Response (`clientSecret`, `paymentIntentId`, `orderId`) correct today but no shared TS interface guards shape.
**Recommended fix**: Export `CheckoutPaymentIntentResponse` in `src/types/index.ts`; type the Stripe methods in `src/lib/api.ts`.
**Effort**: S

---

## Scope 7 — Unused / dead code from pivots

## [severity: high] `autoQueueMockupJob` defined but never called

**File(s)**: `backend/worker/ai-jobs-worker.ts:128-181`
**Issue**: 54-line function has zero callers; handoff notes it was disabled. Dead weight on worker boot.
**Recommended fix**: Delete the function.
**Effort**: S

## [severity: med] `REPLICATE_PRODUCT_MODEL_ID` + `REPLICATE_TRYON_MODEL_ID` stale

**File(s)**: `backend/index.ts:89-90`, `backend/services/replicate.ts`
**Issue**: `REPLICATE_PRODUCT_MODEL_ID` is logged but never read. `REPLICATE_TRYON_MODEL_ID` points to deprecated `cuuupid/idm-vton`.
**Recommended fix**: Remove the log; verify or delete the try-on model ref.
**Effort**: S

## [severity: med] `railway.toml` still present after Render/Vercel pivot

**File(s)**: `railway.toml`
**Issue**: Defines NIXPACKS build + startCommand for Railway; Render uses its own build config. Confusing.
**Recommended fix**: Delete `railway.toml`.
**Effort**: S

## [severity: med] Four overlapping root-level doc files

**File(s)**: `README.md` (609 lines), `RUNBOOK.md` (460 lines), `CLAUDE.md` (434 lines), `HANDOFF_2026-04-21.md` (179 lines)
**Issue**: Scope overlap — env setup, deployment, project status repeated. RUNBOOK and RAILWAY_ENV_CHECKLIST both describe env vars with conflicting model names.
**Recommended fix**: Consolidate into `README.md` (overview + quickstart) + `DEPLOYMENT.md` (env vars, Render/Vercel); delete/archive RUNBOOK and HANDOFF.
**Effort**: M

## [severity: low] `RAILWAY_ENV_CHECKLIST.md` references deprecated Replicate model

**File(s)**: `RAILWAY_ENV_CHECKLIST.md:217-218`
**Issue**: Explicitly Railway-titled; references dead `cuuupid/idm-vton`. Misleads onboarding.
**Recommended fix**: Delete file; fold current env vars into `DEPLOYMENT.md`.
**Effort**: S

## [severity: low] Commented-out Gemini mockup import

**File(s)**: `backend/worker/ai-jobs-worker.ts:6-7`
**Issue**: `// Gemini mockup import removed - now using Replicate NanoBanana` + commented import. Architectural noise.
**Recommended fix**: Delete lines 6-7. If `vertex-ai-mockup.ts` still unused, flag it under Scope 1's "partially abandoned" finding.
**Effort**: S

## [severity: low] `features.json` lists stale Railway deployment task

**File(s)**: `features.json:19-30`
**Issue**: Task #2 "Railway Production Deployment" no longer actionable; other roadmap items (Mockup Retry Logic, Regeneration) also stale.
**Recommended fix**: Retitle task #2 to "Render + Vercel Stability" or delete; reprioritize stale items.
**Effort**: S

---

## Scope 8 — Build-time secrets leaking to client

## [severity: high — CRITICAL] VITE_OPENAI_API_KEY exposed in gpt-assistant.ts

**File(s)**: `src/utils/gpt-assistant.ts:1`
**Issue**: `const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || 'demo-openai-key'` — reads private OpenAI key with `VITE_` prefix, embedding it in the client bundle. Attackers can extract from JS source / DevTools and bill your OpenAI account.
**Recommended fix**: Rotate the OpenAI key immediately; remove this file or route calls via `backend/` and `apiFetch()`; rename env to non-prefixed `OPENAI_API_KEY` (server-only).
**Effort**: M

## [severity: high — CRITICAL] VITE_OPENAI_API_KEY exposed in chatbot-service.ts

**File(s)**: `src/utils/chatbot-service.ts:5`
**Issue**: `new OpenAI({ apiKey: import.meta.env.VITE_OPENAI_API_KEY, dangerouslyAllowBrowser: true })` — explicitly creates an OpenAI client in the browser with `dangerouslyAllowBrowser: true`. Antipattern. Leaks key to every user.
**Recommended fix**: Delete client-side OpenAI init; add backend `/api/chat` endpoint using non-prefixed `OPENAI_API_KEY`.
**Effort**: M

## [severity: high — CRITICAL] VITE_REPLICATE_API_TOKEN exposed in replicate.ts

**File(s)**: `src/utils/replicate.ts:3`
**Issue**: `const REPLICATE_API_TOKEN = import.meta.env.VITE_REPLICATE_API_TOKEN || 'demo-replicate-token'` — Replicate token in the client bundle. Anyone can submit predictions on your account.
**Recommended fix**: Rotate the Replicate token; rename to unprefixed `REPLICATE_API_TOKEN`; proxy all Replicate calls through backend routes.
**Effort**: M

## [severity: med] env-check.ts references VITE_OPENAI_API_KEY

**File(s)**: `src/utils/env-check.ts:20`
**Issue**: Reads `VITE_OPENAI_API_KEY` to log its presence (masked). Even without the leak, the reference implies the env var is expected client-side.
**Recommended fix**: Delete the reference; replace with a backend health-check endpoint that reports secret presence without exposing them.
**Effort**: S

---

## Totals

| Severity | Count |
|---|---|
| High | 14 (incl. 3 CRITICAL secret leaks) |
| Med | 18 |
| Low | 7 |
| **Total** | **39** |

Scope items 1–8 all have entries. Subsequent `/loop` iterations will deepen specific files, re-verify, and cross-link duplicates before the plan document is written.
