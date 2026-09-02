# Imagine Studio — Step Flow (design)

**Date:** 2026-09-01 · **Author:** Zero Nine (Earth) · **Requested by:** David
**Reference:** YouTube "AI Product Listing Images for Print on Demand — Full
Amazon A+ Workflow | PicWish" (OsJpZd-XCOI). Chapters: generate design from a
streetwear prompt → turn it into a t-shirt mockup → auto-generate product info →
build the 7-image listing gallery (white-background main shot, infographic,
feature highlights, detail close-ups, lifestyle with a model) → A+ content.

## 1. What David asked for

1. The classic wizard in Imagine Studio (`/admin/ai/products/create`) is
   outdated. Replace it with a flow that moves in **steps**, each ending with a
   one-click **approve** before the next step fires.
2. Step 1: type or **speak** the idea ("hip-hop street monkey").
3. Step 2: the system writes the **best prompt** for that idea and **GPT Image 2**
   renders the design on a **plain white or black background** (never a
   pattern, never a simulated checkerboard).
4. Somewhere before mockups: ask **which garments** (white / black tee, hoodie —
   *only what ITP can actually make*) and which **colors**. The system should
   recommend colors that suit the artwork (a mostly-black design should not be
   pushed onto a black shirt) and David picks the final set.
5. Mockups: a real **product mockup**, a **hanger** shot, a **product-details**
   card, and an **on-person** shot — on the primary color, then the extra colors.
6. Move Etsy production onto this route. Stop producing products ITP cannot
   fulfil (polo, embroidery).
7. Separately: the Admin → Products editor can't show full-size images, the
   thumbnail goes blank after opening a product, the "Advanced Image Operations"
   UI is old, and edits should be able to hop into Imagination Station.

## 2. What exists today (audited on `origin/main` b13b594)

| Piece | State |
| --- | --- |
| Design generation | `POST /api/admin/products/ai/create` → `openai/gpt-image-2` OpenAI-direct, N takes from `houseDesignRoster()` (`HOUSE_DESIGN_VARIANTS`, default 3). gpt-image-2 has **no alpha**; transparency comes from the rembg job (`/:id/remove-background`). |
| Prompt writing | `buildDTFPrompt()` wraps the admin prompt; a cheap OpenRouter "writing brain" (`imagine-brain.ts`, gemini-2.5-flash) exists for brainstorm/ideas. No "idea → best prompt" step in the wizard. |
| Garment / color | Picked **before** generation on the describe step. `productType: tshirt|hoodie|tank`, `shirtColor: black|white|gray`. No artwork-aware color advice. |
| Mockups | `POST /:id/create-mockups` fans out `flat_lay`, `ghost_mannequin`, `mr_imagine`, `mockup_back`, pocket `flat_lay` (flux-2-pro single call / nano-banana). **No hanger, no details card, no lifestyle.** Then fire-and-forget `startModelShots()` (two gpt-image on-person shots; prompt hardcodes "crew neck t-shirt" even for hoodies). |
| Approvals | None per step. Only the final "Approve & Publish" (client-side Supabase write). |
| Etsy | Separate `AdminEtsyPanel`: compose (`/api/admin/etsy/compose/:id`) → QA gate → queue (`/queue/:id`, always draft). Not reachable from the builder. |
| Capability boundary | **Does not exist as a module.** Four disagreeing lists (`types/index.ts`, `color-presets.ts`, `etsy.ts`, `etsy-tiers.ts`). Mrs. Imagine's `GarmentType` still includes `'polo'` and her brief prompt demands "at least one hoodie and one polo". |
| Product editor | `AdminDashboard.tsx` (4,476 lines). Edit modal is inline JSX at :3821–4375; thumbnails `h-40 object-cover`, no lightbox. **Bug:** `productAssets[id]` is written flat by `loadProducts` and overwritten with a grouped-by-kind object by `loadProductJobs`, so after expand/edit the table reads `.url` of an object that has none → `<img src={undefined}>` → alt text ("Cel…"). |
| Replicate | Board row bb37ebb6 says the mockup lane never worked (402). **Stale**: prod `ai_jobs` shows 40/40 `replicate_mockup_v2` succeeded on 2026-08-31. |

## 3. Decisions

- **New mode, not a rewrite of the 3,865-line classic wizard.** Add
  `mode: 'steps'` to `AdminAIProductBuilder` and make it the **default**. Live
  Studio (voice) and Classic stay behind the toggle. The new component is
  `src/components/studio/StepFlowBuilder.tsx` plus small step components.
- **Reuse the existing job pipeline** (`ai_jobs`, `product_assets`, status
  polling). New behaviour is added as a handful of step-flow routes under
  `/api/admin/products/ai/:id/step/*`, not a parallel pipeline.
- **Background strategy:** the prompt writer picks `white` or `black` as the
  render background from the idea (dark/moody art → white; light/pastel art →
  black) and gpt-image-2 renders on that **solid** color. The rembg pass then
  produces the transparent print file. The prompt explicitly forbids
  checkerboards, gradients, drop shadows and painted transparency.
- **One take by default, "Try another" adds one.** gpt-image-2 is the priciest
  model in the stack; cost-first. `takes` is a request parameter (1–3).
- **Voice input = browser Web Speech API** (free, no realtime token). The xAI
  realtime voice stays the Live Studio's thing.
- **Details card is rendered in-house with `sharp`** (already a dependency),
  not by an image model. AI-rendered infographic text is the one thing the
  reference video warns about ("zoom in on any text"). Ours composes the
  approved product mockup + spec bullets (blank, weight, DTF, care) + size chart
  as SVG over PNG. Deterministic, free, always legible.
- **Capability boundary becomes one module** shared by both sides:
  `backend/shared/catalog-capability.ts` (imported by `src/` the same way
  `backend/shared/metal-art` already is). Garments: **tee** (Gildan 5000) and
  **hoodie** (Gildan 18500). Print method: **DTF only**. Explicitly not
  offered: polo, tank, embroidery, sublimation garments. Mrs. Imagine loses
  `'polo'`.
- **Color advice is measured, not guessed.** New `color-advice` route samples the
  nobg PNG: mean luminance and luminance spread of opaque pixels, coverage, and
  dominant hue; scores every capability color by contrast to the artwork.
  Returns a ranked list with `great | ok | poor`. Poor colors stay pickable but
  dimmed — David keeps the final say.
- **Approvals are stored on the product** in
  `products.metadata.step_flow` so a flow can be resumed from the product
  editor ("Continue in Step Flow").
- **Etsy is the last step of the flow**, using the existing compose + queue
  routes and surfacing the QA-gate reasons inline when it refuses.

## 4. The flow

```
 1 Idea ─▶ 2 Design ─▶ 3 Garments & Colors ─▶ 4 Mockups ─▶ 5 Listing ─▶ 6 Etsy
   ✓ auto      ✓ pick+approve   ✓ approve          ✓ per card     ✓ approve   ✓ queue
```

### Step 1 — Idea
Text box + mic button. Submit → `POST /api/admin/products/ai/step/brief`
`{ idea }` → `{ designPrompt, background: 'white'|'black', title, styleTags[],
garmentHint: 'tshirt'|'hoodie', rationale }` from the writing brain
(OpenRouter gemini-2.5-flash; fallback OpenAI text model). The prompt is shown in
a collapsible "what I'm telling the artist" panel and is editable; the flow
auto-continues into Step 2 (no separate click — David asked for one input that
moves in steps).

### Step 2 — Design
`POST /api/admin/products/ai/create` with `{ prompt: designPrompt, modelId:
'openai/gpt-image-2', forceSingleModel: true, takes: 1, background,
productType: garmentHint, shirtColor: <opposite of background>, category }`.
Creates the draft product as today; the flow polls `GET /:id/status`.
Cards show each take on the solid background. Buttons: **✓ Use this**, **↻ Try
another** (adds one take via `/:id/regenerate-images`), **✎ Tweak** (edits the
prompt and re-runs). "Use this" → `POST /:id/step/select-design`
`{ assetId }` — marks the source asset primary **without** queuing mockups
(unlike `/select-image`), then queues rembg and waits. The result shows the
transparent PNG on a checker, and side-by-side on white and on black.
**✓ Approve design** stamps `step_flow.approvals.design`.

### Step 3 — Garments & Colors
Garment chips from the capability module (Tee / Hoodie; anything else is not
rendered). One garment per run; a "make a hoodie version too" action exists at
the end (duplicates the product and re-runs Step 4). Color swatches come from
`POST /:id/step/color-advice` → ranked ITP colors with contrast grade and a
one-line reason ("artwork is 78% dark ink — black would swallow it"). Best
grade is pre-selected as **primary**; David toggles extras. **✓ Approve** →
`POST /:id/step/garments` `{ garment, primaryColor, extraColors[] }` writes
`metadata.product_type / shirt_color / colors` and stamps the approval.

### Step 4 — Mockups
`POST /:id/step/shots` fires, for the primary color:
- `product` → existing `ghost_mannequin` (falls back to `flat_lay`)
- `hanger` → **new** `hanger` template in `worker-helpers.ts` (flux-2-pro
  single call: garment on a wooden hanger, plain light wall, front view, true
  print scale). The flat-lay negative list currently *forbids* hangers; the
  hanger template gets its own positives/negatives.
- `model` → one on-person shot through `etsy-model-shots` with a
  **garment-aware** prompt (hoodie renders as a hoodie) and the chosen color.
- `details` → in-house `sharp` render, produced once the `product` shot lands.

For each extra color: one `product` shot with that `shirtColor`.
Every card has **✓ Approve** and **↻ Redo** (retry with a fresh nonce; the
old asset is kept but unapproved). **Approve all** is one click. Approved
assets get `asset_role` values the gallery whitelist knows
(`mockup_hanger`, `mockup_details`, `mockup_color_<slug>` are added to
`product-gallery.ts` ROLE_ORDER). Unapproved renders never reach the storefront.

### Step 5 — Listing
`POST /api/admin/etsy/compose/:id` runs the SEO composer; title, description,
tags, price are shown editable next to a storefront-style preview built from the
approved gallery. **✓ Approve & publish** → `POST /:id/step/publish` sets
`status:'active'`, `is_active:true`, `images` from `buildProductGallery()`,
`colors`, and stamps `approvals.listing`. Server-side, so the wizard's
client-side Supabase write is no longer the only path.

### Step 6 — Etsy
Tier checkboxes from `tiersForCategory`. **Queue to Etsy (draft)** →
`POST /api/admin/etsy/queue/:id`. A 422 from the QA gate renders the failed
criteria inline with a "fix in Step 4" jump. Nothing here activates a listing;
David still flips drafts live in Etsy.

## 5. Data

`products.metadata.step_flow`:
```json
{
  "version": 1,
  "idea": "hip-hop street monkey",
  "brief": { "designPrompt": "...", "background": "white", "title": "...", "styleTags": [] },
  "garment": "tshirt",
  "colors": { "primary": "black", "extras": ["heather-grey", "white"] },
  "advice": [{ "id": "black", "grade": "great", "score": 0.91, "reason": "..." }],
  "shots": { "product": { "jobId": "...", "assetId": "...", "approved": true }, "hanger": {}, "model": {}, "details": {}, "color:heather-grey": {} },
  "approvals": { "design": "2026-09-01T...", "garments": "...", "mockups": "...", "listing": "..." }
}
```
No migration: `metadata` is jsonb. `product_assets.asset_role` gains the new
role strings; `kind` stays `mockup`.

## 6. Capability boundary module

`backend/shared/catalog-capability.ts` exports:
```ts
GARMENTS: [{ id:'tshirt', label:'T-Shirt', category:'t-shirts', blank:'Gildan 5000', weightOz:5.3,
             colors:['black','white','navy','heather-grey','red','forest-green','royal-blue'] },
           { id:'hoodie', label:'Hoodie', category:'hoodies', blank:'Gildan 18500', weightOz:8.0,
             colors:['black','white','navy','heather-grey','red','forest-green'] }]
COLORS: { black:{label,hex}, white:{...}, ... }        // subset of color-presets, keyed by slug
PRINT_METHODS: ['dtf']
NOT_OFFERED: ['polo','tank','embroidery','sublimation-garment']
isOfferedGarment(id), colorsForGarment(id), assertOffered(...)
```
Consumers in this change: StepFlowBuilder (chips + swatches), the step-flow
routes (validation), Mrs. Imagine (`GarmentType` = `'tshirt'|'hoodie'`, brief
prompt loses polo), `etsy-model-shots` garment noun. Existing lists are left in
place this round; the module is the one new code must import.

## 7. Product editor

- **Bug fix:** split state — `productAssets` (flat, table thumbnail) stays as
  written by `loadProducts`; `loadProductJobs` and `handleDeleteImage` write to
  a new `productAssetGroups` map. Table thumbnail also gets an `onError`
  fallback to `product.images[0]`, then the placeholder.
- **Extract** the enhanced edit modal to
  `src/components/admin/AdminProductEditModal.tsx` (props: product, assets
  groups, jobs, handlers). Layout: left = large viewer (full image,
  `object-contain`, click → lightbox with zoom/prev/next/download/set-main/
  delete); right = tabs **Details / Images / AI Tools**. Images tab groups
  Source · No background · Upscaled · Mockups · **Model shots** (`etsy_shots`
  were never shown before).
- **AI Tools** keeps the four existing operations and adds **Open in
  Imagination Station** (deep link `/imagination-station?addImage=<source>&productName=&productId=`)
  and **Continue in Step Flow** (`/admin/ai/products/create?mode=steps&productId=<id>`).

## 8. Out of scope (filed / left alone)

- Amazon A+ layouts from the video. Etsy first.
- Multi-garment in one run (hoodie sibling is a post-publish action).
- Rewriting the Etsy publisher's variation/embroidery copy (board 9b420def).
- Deactivating already-live unfulfillable listings (board 397c15e1).
- Metal art in the step flow (standing hold, board c11af937).

## 9. Testing

- Unit (vitest, backend): brief parser/fallback; color-advice scoring on
  synthetic PNGs (all-black art → black graded poor, white great; pastel art →
  inverse); details-card renderer produces a PNG of the expected size; capability
  helpers; hanger prompt builder contains hanger positives and no flat-lay
  negatives; Mrs. Imagine brief parser never yields polo.
- Frontend: `tsc -b`, `eslint`, `vite build`; StepFlowBuilder reducer tests
  (approval gating: a step cannot advance without its approval).
- Manual: one real end-to-end run against the local backend before merge.

## 10. Print prep: halftone print file (David, 2026-09-02)

David: "if i feel the design needs to be halftones after can i do it there but i
dont want the main design to be comprimised and i dont want the cust to see the
halftoned design its only for my team to use when they are pressing and
printing the design. and reccomend if a design should be half toned or not."

- **Where:** a "Print prep" panel on the Design step, shown once the transparent
  design exists (after ✓ Approve design). It never changes the design assets
  (`source`, `nobg`) — it produces a separate file.
- **Recommendation is measured, not guessed.** `POST /:id/step/print-advice`
  samples the nobg PNG with sharp: share of opaque pixels sitting in smooth
  tonal ramps (local luminance gradient small but non-zero across a 5px window),
  count of distinct quantized colors, share of semi-transparent pixels (soft
  edges/glows). Rule of thumb for DTF: flat vector-style art (few colors, hard
  edges) prints best as-is; photoreal or heavily shaded art (large smooth-ramp
  share) benefits from a halftone screen so the white underbase and gradients do
  not turn into solid blocks. Returns `{ recommend: 'halftone' | 'clean',
  confidence, reason, suggested: { frequency, angle, shape, invertDark } }`,
  where `invertDark` follows the approved primary shirt color (dark shirt →
  true).
- **Render:** `POST /:id/step/print-file { method:'halftone'|'diffusion',
  frequency?, angle?, shape?, invertDark? }` runs the existing
  `backend/services/halftone.ts` `applyHalftone()` on the nobg PNG, uploads via
  gcs-storage, inserts `product_assets { kind:'print', asset_role:'print_halftone' }`
  with the halftone metadata, and records `step_flow.printFile = { assetId, url,
  options, createdAt }`. Redo overwrites (one print file per product; older ones
  are deleted from product_assets, not the bucket).
- **Team-only, never customer-facing:** `asset_role: 'print_halftone'` is not in
  the gallery whitelist (`backend/shared/product-gallery.ts` ROLE_ORDER), so
  `publish` cannot put it in `products.images`; the storefront never reads
  `kind:'print'`. The Admin product editor shows it under a new **Print files
  (team only)** group in the Images tab with a Download button, and the Etsy
  uploader ignores it (it reads the gallery).
- **UI:** the panel shows the recommendation badge ("Halftone recommended — 61%
  of the artwork is smooth shading" / "Print clean — flat colors, hard edges"),
  a Make print file button (with the suggested frequency/angle prefilled and a
  small advanced disclosure), a side-by-side preview of design vs. print file
  labelled TEAM ONLY, and Download. The Design step's ✓ Approve is not gated on
  this — it is optional.
