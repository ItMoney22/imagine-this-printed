# ITP Audit — Proposed Implementation Plan

Derived from `audit-findings.md`. Ranked by severity × effort (best ROI first). David reviews before anything ships.

---

## 🔴 Tier 0 — IMMEDIATE (do today, before anything else)

These are active security issues or prod blockers. No design discussion needed.

### 1. Rotate OpenAI API key + Replicate API token
**From**: Scope 8 findings.
**Why**: Three `VITE_`-prefixed secrets (OpenAI ×2, Replicate ×1) are bundled into the public client. Anyone who has loaded the site can extract them.
**Steps**:
1. Rotate keys in OpenAI and Replicate dashboards (invalidate old).
2. Update `backend/.env` (Render) + local dev `.env` with new unprefixed names (`OPENAI_API_KEY`, `REPLICATE_API_TOKEN`).
3. Remove old `VITE_OPENAI_API_KEY` + `VITE_REPLICATE_API_TOKEN` from Vercel env vars.
4. Delete/refactor:
   - `src/utils/gpt-assistant.ts` — move calls behind `backend/routes/`
   - `src/utils/chatbot-service.ts` — kill `dangerouslyAllowBrowser: true`; add `backend/routes/chat.ts`
   - `src/utils/replicate.ts` — kill file; route via `backend/`
   - `src/utils/env-check.ts:20` — remove the ref
5. Grep for `import.meta.env.VITE_` across `src/` after the change — only Supabase anon, Stripe publishable, and `VITE_API_BASE` / `VITE_SITE_URL` should remain.
**Effort**: 1 session, ~M.
**Blocker risk**: High. Leave as-is and OpenAI/Replicate bills become unbounded.

### 2. Unblock Render backend DB connection
**From**: HANDOFF_2026-04-21.md "URGENT BLOCKER".
**Why**: `/api/health/database` returns 500 because Prisma still resolves to the IPv6-only direct URL, not the pooler.
**Steps** (in order, stop when fixed):
1. `grep -r "db\.czzyrmizvjqlifcivrhn\|DIRECT_URL\|SHADOW_DATABASE_URL" backend/` — find any env var that overrides `DATABASE_URL`.
2. Check `backend/prisma/schema.prisma` for a `directUrl` setting. If present, point it at the pooler URL too.
3. On Render, trigger a **clear-cache deploy** (`POST /v1/services/{id}/deploys` with `clearCache: "clear"`) to regenerate Prisma engine.
4. Tail live logs: `GET /v1/logs?ownerId=tea-d7jp7tt7vvec7392beeg&resource=srv-d7jpgut7vvec739bsid0&type=app`.
5. If still broken, switch to the transaction pooler (port 6543) in `DATABASE_URL`.
**Effort**: 1 session, ~S once cause is identified.
**Blocker risk**: Blocks all prod DB activity.

---

## 🟠 Tier 1 — High severity, low effort (quick wins)

### 3. Delete `autoQueueMockupJob` + Gemini comment noise
**Files**: `backend/worker/ai-jobs-worker.ts:6-7`, `128-181`
**Fix**: `git rm` or inline delete of dead function + commented imports. Zero call sites.
**Effort**: S.

### 4. Normalize legacy image-tools response keys
**Files**: `backend/routes/ai/image-tools.ts:45-50, 85-89, 124-128`
**Fix**: Decide — deprecate these routes or return `{ processedUrl, originalUrl, ok }` matching imagination-station. If deprecated, remove from `src/lib/api.ts` too.
**Effort**: S.

### 5. Always-append transparent-background guidance to DTF prompts
**Files**: `backend/services/imagination-ai.ts:154-163`
**Fix**: Drop the conditional; always include "TRANSPARENT BACKGROUND REQUIRED" on DTF/sublimation/gang-sheet paths.
**Effort**: S.

### 6. Delete `railway.toml` + `RAILWAY_ENV_CHECKLIST.md`
**Files**: `railway.toml`, `RAILWAY_ENV_CHECKLIST.md`
**Fix**: `git rm` both. Render ignores them; checklist contradicts current env.
**Effort**: S.

---

## 🟡 Tier 2 — High severity, medium effort (architectural)

### 7. Extract central prompt enhancer
**From**: Scope 3.
**Target**: `backend/lib/prompt-enhancer.ts` with `enhance({ type: "dtf"|"mockup"|"marketing"; userPrompt; productContext })`.
**Callers to migrate**: `ai-product.ts`, `dtf-optimizer.ts:362`, `replicate.ts:204, 346, 443`.
**Reference**: `E:/Projects for MetaSphere/david-trinidad-com/src/modules/image-flow/lib/prompt-enhancer.ts`.
**Effort**: M.

### 8. Extract central image pipeline / model catalog
**From**: Scope 1.
**Target**: `backend/services/image-pipeline.ts` + `backend/lib/model-catalog.ts` (registry of every Replicate/Vertex/Gemini model with input schema, output schema, $/call).
**Callers to migrate**: `imagination-ai.ts:174, 313, 382, 454`, `replicate.ts:85-200`, `vertex-ai-mockup.ts:188`, `ai-jobs-worker.ts:763-802`.
**Effort**: M-L.

### 9. Enforce DTF constraints at generation boundary
**From**: Scope 2.
**Goal**: Every DTF image passes validation before being stored — transparent BG (alpha check), ≥300 DPI computed from real width/height × print size, sRGB ICC profile embedded.
**Files**: `dtf-optimizer.ts`, `ai-jobs-worker.ts`, add validation step in worker.
**Effort**: M.

### 10. Pre-call cost confirmation UX + audit log
**From**: Scope 5.
**Goal**: Frontend shows "Confirm $X for this generation" before any paid AI call. Backend logs actual API cost vs ITC charged per call.
**Files**:
- Backend: add `costLog.recordApiCall()`; return cost estimate from a new `POST /api/ai/quote` endpoint.
- Frontend: wire confirmation into `ImaginationStation.tsx`, `MrImagineModal.tsx`, `AdminCreateProductWizard.tsx`.
**Effort**: M-L.

### 11. Expose hidden model params in admin UI
**From**: Scope 4.
**Goal**: Add "Advanced Model Settings" section (collapsible) to every AI generation form: `seed`, `num_outputs`, `output_quality`, `safety_tolerance`, `negative_prompt`, `aspect_ratio`.
**Files**: `MrImagineModal.tsx`, `AdminCreateProductWizard.tsx`, `Create3DModelForm.tsx`, `RightSidebar.tsx`.
**Effort**: M.

### 12. Typed FE/BE response contracts (shared types)
**From**: Scope 6.
**Goal**: `src/types/api-contracts.ts` exporting `ITPProcessResponse`, `AIJobResponse`, `CheckoutPaymentIntentResponse`. Imported by both backend routes and frontend callers.
**Effort**: M.

---

## 🟢 Tier 3 — Medium severity (bundle into a cleanup PR)

- Add `CostLog` entries to all `replicate.run()` + `predictions.create()` calls (Scope 1/5).
- Centralize URL extraction in `ReplicateOutputFormatter` (Scope 1).
- Add aspect-ratio map for products (Scope 2).
- Seed `imagination_pricing` DB table from hardcoded config on startup (Scope 5).
- Track Remove.bg costs separately (Scope 5).
- Consolidate 4 overlapping root-level MDs → `README.md` + `DEPLOYMENT.md` (Scope 7).
- Update `features.json` stale tasks (Scope 7).
- Clean up stale `REPLICATE_PRODUCT_MODEL_ID` / `REPLICATE_TRYON_MODEL_ID` (Scope 7).

---

## 🔵 Tier 4 — Low severity (do last, or defer)

- `is_dtf_compliant` metadata flag (Scope 2).
- Pass `imageStyle` through to Flux (Scope 3).
- Extract `MockupPromptTemplates` record (Scope 3).
- Add `dtf?: { shirtColor, printStyle }` to `ReplicateImageInput` (Scope 1).

---

## Recommended order

**Today**: Tier 0 (rotate keys, unblock DB).
**This week**: Tier 1 (quick wins) + start Tier 2 item #7 (prompt enhancer — foundational for everything else).
**Next week**: Tier 2 items #8, #9 (pipeline + DTF enforcement).
**Week 3**: Tier 2 items #10, #11, #12 (cost UX, param exposure, typed contracts).
**Then**: Tier 3 bundle → one PR. Tier 4 bundle → one PR.

**Do not start Tier 2 until Tier 0 is complete** — rotating the exposed keys and unblocking prod DB are prerequisites for anything else.
