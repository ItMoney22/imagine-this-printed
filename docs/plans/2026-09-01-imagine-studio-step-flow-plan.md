# Imagine Studio Step Flow — implementation plan

Design: `docs/plans/2026-09-01-imagine-studio-step-flow-design.md`.
Branch/worktree: `earth/zero-nine/studio-step-flow` (from `origin/main` b13b594).
Four tracks run in parallel in the same worktree; **file ownership below is
strict** so nobody edits another track's file.

Already in place before tracks start: `backend/shared/catalog-capability.ts`
(the capability boundary module — import it, do not fork it).

## Shared contracts (all tracks code against these)

### Routes — all `requireAuth + requireAdmin`, mounted under `/api/admin/products/ai`

| Method + path | Body → Response |
| --- | --- |
| `POST /step/brief` | `{ idea }` → `{ brief: StepBrief }` |
| `POST /create` (existing) | + optional `takes: 1\|2\|3` (overrides `houseDesignRoster()` length), + optional `stepFlow: { idea, brief }` (persisted to `metadata.step_flow` on create) |
| `GET /:id/step` | → `{ product, step_flow, assets, jobs }` (resume) |
| `POST /:id/step/select-design` | `{ assetId }` → `{ ok, asset, rembgJob }` — sets the source asset primary, queues `replicate_remove_bg`, **never** queues mockups |
| `POST /:id/step/color-advice` | `{}` → `{ advice: ColorAdvice[], artwork: ArtworkStats }` (measures the nobg asset; falls back to source) |
| `POST /:id/step/garments` | `{ garment, primaryColor, extraColors }` → `{ ok, step_flow }` (validated with `assertOffered`; writes `metadata.product_type`, `shirt_color`, `colors`, `print_placement:'front-center'`, `category`) |
| `POST /:id/step/shots` | `{ keys?: ShotKey[] }` → `{ jobs: [{ key, jobId }] }` (default = every key for the approved garment/colors) |
| `POST /:id/step/shots/:key/redo` | → `{ job }` (new job, old asset kept, `shots[key].approved=false`) |
| `POST /:id/step/shots/:key/approve` | `{ approved: boolean, assetId }` → `{ step_flow }` |
| `POST /:id/step/publish` | `{ title, description, tags, price }` → `{ product }` (status active, `images` from `buildProductGallery`, stamps `approvals.listing`) |

Existing routes reused unchanged: `GET /:id/status`, `POST /:id/regenerate-images`,
`POST /api/admin/etsy/compose/:id`, `POST /api/admin/etsy/queue/:id { tiers }`.

### Types

```ts
type StepBrief = {
  designPrompt: string            // the full prompt handed to gpt-image-2
  background: 'white' | 'black'   // solid render background (rembg strips it)
  title: string                   // working product title
  styleTags: string[]
  garmentHint: 'tshirt' | 'hoodie'
  rationale: string               // one sentence: why this background / style
}
type ShotKey = 'product' | 'hanger' | 'model' | 'details' | `color:${string}`   // color:<ColorId>
type ShotState = { jobId?: string; assetId?: string; url?: string; approved: boolean; status: 'queued'|'running'|'done'|'failed'; error?: string }
type ColorAdvice = { id: ColorId; label: string; hex: string; grade: 'great'|'ok'|'poor'; score: number; reason: string }
type ArtworkStats = { meanLuma: number; darkShare: number; lightShare: number; coverage: number; dominantHue: number | null }
type StepFlowMeta = {
  version: 1
  idea: string
  brief: StepBrief
  garment?: GarmentId
  colors?: { primary: ColorId; extras: ColorId[] }
  advice?: ColorAdvice[]
  shots: Partial<Record<ShotKey, ShotState>>
  approvals: Partial<Record<'design'|'garments'|'mockups'|'listing', string>>  // ISO timestamps
}
```

### Asset roles (product_assets.asset_role, kind stays 'mockup')
`product` → existing `mockup_ghost_mannequin` (or `mockup_flat_lay`) ·
`hanger` → `mockup_hanger` · `model` → `mockup_model_1` · `details` →
`mockup_details` · `color:<id>` → `mockup_color_<id>`.
`src/lib/product-gallery.ts` ROLE_ORDER becomes:
ghost_mannequin, flat_lay, hanger, back, model_1, model_2, details, color_* (any), mr_imagine, pocket, design_watermarked.

### Job conventions
Shots are `ai_jobs` rows, `type: 'replicate_mockup_v2'`, `input.template` in
`ghost_mannequin | flat_lay | hanger`, plus `input.shirtColor`, `input.productType`,
`input.stepKey`, and a fresh `input.nonce` on redo. The `model` shot goes
through `etsy-model-shots` and mirrors its result into `product_assets`
(`mockup_model_1`). `details` is not a job: rendered synchronously by the
route once the `product` shot has an asset (route returns `{ key:'details',
jobId: null }` and the flow polls `GET /:id/step` for the asset).

---

## Track A — backend core (agent: backend-architect)

**Owns:** `backend/services/mrs-imagine.ts`, `backend/services/image-flow/worker-helpers.ts`,
`backend/services/image-flow/mockup-prompts.test.ts` (extend), `backend/services/etsy-model-shots.ts`,
`backend/shared/catalog-capability.test.ts` (new).

1. `catalog-capability.test.ts`: `normalizeGarment('polo')` is null; `assertOffered('tshirt','royal-blue')` ok; `assertOffered('hoodie','royal-blue')` throws; `NOT_OFFERED` contains polo + embroidery.
2. Mrs. Imagine: `GarmentType` → `'tshirt' | 'hoodie'` (import `GarmentId`); brief prompt text no longer asks for polo ("spread across tshirt and hoodie with at least one hoodie"); parser coerces anything unknown to `tshirt`; `GARMENT_NOUN` from the capability module; category mapping drops the polo→shirts branch. Add a test that a brief JSON with `"garment":"polo"` comes back as `tshirt`.
3. `worker-helpers.ts`: add `'hanger'` to `MockupTemplate`. Single-call flux-2-pro prompt: `${color} ${garment.noun} hanging on a natural wooden hanger against a plain light studio wall, front view, straight-on, garment hanging naturally with soft fabric drape, the graphic printed front-center at true scale (${buildSizeClause})`. Hanger-specific negatives (no mannequin, no person, no folded/flat-lay, no floor, no text overlays). It must NOT reuse the flat-lay negative list (which forbids hangers). Route the hanger through the same flux-2-pro single-call path as flat_lay. Test: prompt contains "hanger", does not contain "flat lay", and the negative list does not contain "hanger".
4. `etsy-model-shots.ts`: garment-aware wording — replace the hardcoded "crew neck t-shirt" (both gpt and nano prompt builders) with the capability noun from `normalizeGarment(product.metadata.product_type)` (default tshirt). Export `shootOneModelShot(productId, userId, opts: { shirtColor?: ColorId; garment?: GarmentId; cast?: ShotCast; nonce?: string }): Promise<{ url: string; check: unknown }>` that renders exactly ONE verified shot and appends it to `metadata.etsy_shots.images`, and returns the URL. Keep `startModelShots` behaviour intact.
5. Run `cd backend && npm run typecheck && npx vitest run services/image-flow services/mrs-imagine shared` (adjust to the repo's test command). All green before reporting.

## Track B — backend step-flow (agent: backend-architect)

**Owns:** `backend/routes/admin/ai-products-step-flow.ts` (new router), `backend/services/step-flow/brief.ts`, `backend/services/step-flow/color-advice.ts`, `backend/services/step-flow/details-card.ts`, `backend/services/step-flow/shots.ts`, their `*.test.ts`, and **only these lines** of `backend/routes/admin/ai-products.ts`: (a) mount the new router (`router.use(stepFlowRouter)`), (b) honour `takes` + `stepFlow` in `POST /create`.

1. `brief.ts` — `writeStepBrief(idea)`: uses the same OpenRouter/OpenAI client pattern as `imagine-brain.ts` (gemini-2.5-flash, JSON-only reply). System prompt: DTF art director; output the JSON `StepBrief`. Rules baked in: contained subject with clean silhouette; **solid** `background` chosen for contrast with the art (dark/moody → white, light/pastel → black); forbid gradients, drop shadows, checkerboards, any painted transparency, any garment/mockup/person in the render; no text unless the idea asks for text, and then spell it exactly; square 1:1. Deterministic fallback when the model call fails (template prompt + `background:'white'`). Test the fallback and the JSON coercion.
2. `color-advice.ts` — `adviseColors(pngUrl, garment)`: `sharp` → raw RGBA at ≤256px; over opaque pixels (alpha ≥ 240) compute meanLuma, darkShare (luma<0.2), lightShare (luma>0.8), coverage, dominant hue. Score each `colorsForGarment(garment)` by |artworkLuma − blankLuma| weighted by dark/light share (art that is 70%+ dark on a black blank → poor; 70%+ light on white → poor; mid-tone art → everything ok/great). Grades: score ≥0.6 great, ≥0.35 ok, else poor. `reason` is one plain sentence. Tests on synthetic PNGs built with sharp in the test.
3. `details-card.ts` — `renderDetailsCard({ mockupUrl, garment, color, title, printWidthInches })`: 1200×1500 PNG via sharp composite: mockup on the left 60%, right column SVG with title, "Printed with DTF — vivid, stretch-safe, wash-tested", blank name + weight, "Design width ~N in", care bullets, and a S–3XL size chart (chest width / length inches for Gildan 5000 / 18500 — put the tables in the file with a source comment). Uploads via `gcs-storage.ts` and inserts `product_assets` `{ kind:'mockup', asset_role:'mockup_details' }`. Test: returns a PNG buffer of 1200×1500.
4. `shots.ts` — `queueStepShots(productId, keys?)`: reads `step_flow`, builds the `ai_jobs` rows per the job conventions (product → ghost_mannequin if `GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES` includes the garment else flat_lay; hanger; one flat_lay-or-ghost per extra color with that `shirtColor`), fires `shootOneModelShot` in the background for `model` and mirrors the URL into `product_assets` as `mockup_model_1`, renders `details` when the product asset exists, and writes `step_flow.shots[key]` state. Also `redoShot`, `approveShot`. Look at how the existing worker maps `input.template` → `asset_role` and make sure `hanger` → `mockup_hanger` and color runs → `mockup_color_<id>` (pass `input.assetRole` if the worker honours it; if not, extend the worker's role mapping — that file is `backend/worker/*` and is yours for that one change).
5. Router: every route in the contract table, with `assertOffered` validation, and `GET /:id/step` merging product + assets + jobs + `step_flow` (mark shot status from job status).
6. `POST /create`: `takes` clamps 1–3 and replaces `houseDesignRoster()` length for this request; `stepFlow` is merged into `metadata.step_flow` (`{ version:1, idea, brief, shots:{}, approvals:{} }`).
7. Typecheck + vitest green. Track A is writing `shootOneModelShot` and the `hanger` template concurrently — code against the signatures above; if they are not present when you typecheck, wait and re-run rather than writing your own.

## Track C — frontend step flow (agent: frontend-react-dev)

**Owns:** `src/components/studio/**` (new), `src/lib/api.ts` (add a `stepFlow` namespace only), `src/lib/product-gallery.ts` (ROLE_ORDER only), `src/pages/AdminAIProductBuilder.tsx` (mode `'steps'` + default + `?mode=&productId=` query), `src/components/studio/stepFlowReducer.test.ts`.

1. `AdminAIProductBuilder.tsx`: `mode: 'steps' | 'studio' | 'classic'`, default `'steps'` (localStorage key unchanged; `?mode=` query overrides). Toggle shows **Step Flow · Live Studio · Classic**. Header subtitle for steps: "One idea in. Approve each step. Product and Etsy listing out." Render `<StepFlowBuilder productId={searchParams.productId} />`.
2. `StepFlowBuilder.tsx` — reducer-driven (`stepFlowReducer.ts`): steps `idea → design → garments → mockups → listing → etsy`; a step is reachable only when the previous approval is stamped (server `step_flow.approvals` is the source of truth after each write). Step tracker at the top (reuse the hex visual language from the page: `HexStepTracker` is fine to copy, do not import the studio's `BuildState`). Poll `GET /:id/step` every 3s while any shot/job is not terminal; stop when idle.
3. `IdeaStep`: textarea + mic (Web Speech API `webkitSpeechRecognition`/`SpeechRecognition`, interim results, graceful "voice not supported" if absent). Submit → `stepFlow.brief(idea)` → show the brief (editable prompt, background chip white/black, garment hint) in a collapsible panel → immediately `aiProducts.create({... takes:1, stepFlow })` and advance.
4. `DesignStep`: take cards on the solid background; ✓ Use this / ↻ Try another (`regenerateImages`) / ✎ Tweak (edit prompt → `regenerateImages` with new prompt if the endpoint takes one, else `create` a fresh product and swap `productId`). After `select-design`, show rembg progress, then the transparent PNG on checker + on white + on black. ✓ Approve design.
5. `GarmentStep`: garment chips from `GARMENTS` (import `../../backend/shared/catalog-capability`), color swatches from `color-advice` sorted by score with grade badges and the reason on hover; primary radio + extra checkboxes; poor colors dimmed but selectable. ✓ Approve → `garments`.
6. `MockupStep`: fires `shots` on entry (once); grid of cards keyed by ShotKey with status, image, ✓ Approve / ↻ Redo; **Approve all**; ✓ Continue enabled when every non-failed shot is approved (failed shots can be skipped with an explicit "skip").
7. `ListingStep`: calls `etsy.compose` (add to api if missing) → editable title/description/tags/price + storefront-style preview (gallery from approved assets). ✓ Approve & publish → `publish`.
8. `EtsyStep`: tiers checkboxes (mirror `AdminEtsyPanel`'s tier list), Queue to Etsy (draft) → `etsy.queue`; render 422 gate reasons inline with a "Back to mockups" link; success shows the listing state.
9. Theme tokens only (bg/card/text/muted/primary/secondary/accent). Mobile: the grid collapses to one column.
10. `npm run typecheck && npm run lint && npm run build` green; reducer tests green.

## Track D — product editor (agent: frontend-react-dev)

**Owns:** `src/pages/AdminDashboard.tsx` (Products tab + enhanced modal only), `src/components/admin/AdminProductEditModal.tsx` (new), `src/components/admin/ImageLightbox.tsx` (new).

1. Bug: add `productAssetGroups` state; `loadProductJobs` (~:1136) and `handleDeleteImage` (~:1431) write there; `productAssets` stays flat. Table thumbnail (~:2570–2616): `src = productAssets[id]?.url ?? product.images?.[0]`, with `onError` swapping to the next candidate then the placeholder.
2. Extract the enhanced edit modal (~:3821–4375) into `AdminProductEditModal` with props for everything it reads/writes today (product, asset groups, jobs, `onSave`, `onSetMain`, `onDeleteImage`, the four AI ops, `onClose`). Behaviour must be identical except as below.
3. Layout: left large viewer (`object-contain`, full image, click → `ImageLightbox` with zoom, prev/next, download, set-main, delete); right tabs **Details / Images / AI Tools**. Images tab groups Source · No background · Upscaled · Mockups · Model shots (`product.metadata.etsy_shots.images`). Thumbnails 3-up, `object-contain` on a checker for transparent assets.
4. AI Tools: the four existing operations + **Open in Imagination Station** (`navigate('/imagination-station?' + URLSearchParams({ addImage: sourceUrl, productName, productId }))`) + **Continue in Step Flow** (`/admin/ai/products/create?mode=steps&productId=<id>`).
5. Theme tokens only; no hardcoded slate colors in the new components. `npm run typecheck && npm run lint && npm run build` green.

## Verification (Zero Nine, after all four)

- `npm run typecheck && npm run lint && npm run build` (root) and `cd backend && npm run typecheck && npx vitest run`.
- Local backend boot against prod Supabase; one real run of `/step/brief` → `/create` → `/step/select-design` → `/step/color-advice` → `/step/garments` → `/step/shots` on a throwaway product; delete it after.
- Commit per track, merge via the pre-merge gate, `TASK_NOTES.md` work-log bullet.
