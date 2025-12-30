# TASK_NOTES
## Request
- From `codex1.txt`: Imagination Sheet editor — expand scope to include 3 related UX/bug fixes (Enhance+Upscale end-to-end + compare modal, Mystery Imagine modal + reliable rendering, large sheet pan/navigation).

## Status
- Scouted and wrote the Claude brief with strict file lists, plan, acceptance criteria, and commands.

## Repo conventions discovered
- Node: `>=18.17` (from `package.json`).
- Root scripts (from `package.json`): `dev`, `build`, `lint`, `preview`, `start`, `test`, `test:e2e`, `test:watch`, `verify`, `verify:home`, `verify:products`, `verify:auth`.
- Backend scripts (from `backend/package.json`): `dev`, `watch`, `build`, `start`, `worker`, `worker:dev`, `dev:full`, `start:worker`.
- Editor canvas tech: `react-konva` in `src/components/imagination/SheetCanvas.tsx` (no panning yet; sheet is always centered via computed offsets).
- Likely bug: `src/pages/ImaginationStation.tsx` expects `data.processedUrl` for remove-bg/upscale/enhance, but backend endpoints return `imageUrl`/`url`/`output` instead.

## File shortlist (approved scope)
### Read first
- `AGENTS.md`
- `codex1.txt`
- `package.json`
- `backend/package.json`
- `README.md`
- `backend/README.md`
- `RUNBOOK.md`
- `TESTING_README.md`
- `src/pages/ImaginationStation.tsx`
- `src/components/imagination/SheetCanvas.tsx`
- `src/lib/api.ts`
- `backend/routes/imagination-station.ts`
- `backend/services/imagination-ai.ts`
- `public/mr-imagine/mr-imagine-waving.png`

### Edit allowed
- `src/pages/ImaginationStation.tsx`
- `src/components/imagination/SheetCanvas.tsx`
- `src/lib/api.ts`
- `src/components/imagination/ImageCompareModal.tsx` (add)
- `src/components/imagination/MysteryImagineModal.tsx` (add)
- `src/components/imagination/MrImagineModal.tsx` (add) - Mr. Imagine Lightbox with DTF-style prompting
- `src/components/imagination/MrImaginePanel.tsx` - Update to launch modal
- `src/components/imagination/index.ts` - Export new modal
- `backend/routes/imagination-station.ts`
- `backend/services/imagination-ai.ts`

### Performance optimization scope (added 2025-12-20)
- `src/context/SupabaseAuthContext.tsx` - Auth flow optimization
- `src/pages/Home.tsx` - Home page loading optimization
- `src/components/ProductRecommendations.tsx` - Query optimization
- `src/components/FeaturedSocialContent.tsx` - Lazy loading
- `src/lib/supabase.ts` - Connection optimization

## Implementation checkpoints
- Identified the main editor entrypoint as `src/pages/ImaginationStation.tsx` using Konva via `src/components/imagination/SheetCanvas.tsx`.
- Found response-shape mismatch that prevents image tool results from applying: frontend checks `processedUrl`, backend returns `imageUrl` (and aliases).
- Found why DPI may appear unchanged: DPI quality display relies on `layer.metadata.originalWidth/originalHeight` (not updated when swapping image URLs unless explicitly set).
- Found likely “Mystery Imagine shows nothing” contributors: AI-generated layer is created near the top of the sheet and uses `width/height` values inconsistent with the upload path (pixels vs inches conversion), compounded by lack of pan navigation.
- Located Mystery Imagine hero asset: `public/mr-imagine/mr-imagine-waving.png`.

## Completed Tasks
- [x] **Task 1: Upscale/Enhance Lightbox with BEFORE/AFTER compare** - DONE
  - Created ImageCompareModal with slider, side-by-side, toggle views
  - Integrated into upscale/enhance handlers with Accept/Revert options
  - Fixes 4-5 complete
- [x] **Task 2: Mr. Imagine reliable rendering** - DONE
  - Fixed Replicate SDK URL extraction in backend/services/imagination-ai.ts
  - Added extractUrlString() helper to handle all output formats
  - Fix 7 complete
- [x] **Task 3: Large sheet navigation (pan/zoom)** - DONE
  - Added scroll-to-pan, Ctrl+scroll-to-zoom, Alt+drag-to-pan
  - Added 2-finger touch support for mobile
  - Shows hint overlay when sheet exceeds viewport
  - Fix 6 complete

## Mr. Imagine Lightbox Upgrade
### Requirements
- [x] Modal UI with Mr. Imagine hero image at top
- [x] Headline: "What do you want to design today?"
- [x] Prompt input with placeholder text
- [x] Generate button with loading state
- [x] Tools section: style preset dropdown (DTF-compatible default)
- [x] Tools section: background controls (transparent/solid/scene)
- [x] Tools section: shirt color selector with color hints for DTF
- [x] Tools section: output sizing options
- [x] DTF-style prompting matching AI Product Builder
- [x] Generation result handling: idle → generating → complete → error states
- [x] Display generated image INSIDE lightbox with preview
- [x] Action buttons: "Use in Sheet", "Regenerate", "Download"
- [x] Keyboard shortcuts: Escape to close, Ctrl+Enter to generate
- [x] Free trial tracking via localStorage

### Files Changed
- `src/components/imagination/MrImagineModal.tsx` - Created new modal component
- `src/components/imagination/index.ts` - Added export for MrImagineModal
- `src/components/imagination/RightSidebar.tsx` - Added modal launcher button and integrated MrImagineModal

## Work log (append-only)
- 2025-12-15 Initialized scout workflow files.
- 2025-12-15 Added global Codex prompt `scout.md` to enable `/scout REQUEST`.
- 2025-12-15 Refreshed `CLAUDE_TASK.md` + `TASK_NOTES.md` to match the current Repo Scout spec.
- 2025-12-15 Refreshed scout output files and included backend commands from repo sources.
- 2025-12-15 Scouted `codex1.txt` Imagination Sheet fixes and captured likely root causes + strict edit list for Claude.
- 2025-12-15 **IMPLEMENTED** Fix 1: Backend API response shape - Added `processedUrl` key to all 3 AI endpoints (remove-bg, upscale, enhance) in `backend/routes/imagination-station.ts`.
- 2025-12-15 **IMPLEMENTED** Fix 2: Frontend handlers - Updated `handleRemoveBackground`, `handleUpscale`, `handleEnhance` in `src/pages/ImaginationStation.tsx` to use fallback pattern: `data.processedUrl || data.imageUrl || data.url || data.output`.
- 2025-12-15 **IMPLEMENTED** Fix 3: Metadata update - Upscale handler now properly updates `originalWidth/originalHeight` and recalculates DPI with `calculateDpi()`.
- 2025-12-15 **IMPLEMENTED** Fix 4: ImageCompareModal - Created new component `src/components/imagination/ImageCompareModal.tsx` with slider, side-by-side, and toggle view modes. Exported from index.ts.
- 2025-12-15 **IMPLEMENTED** Fix 5: Compare modal integration - Upscale and Enhance handlers now show BEFORE/AFTER compare modal with Accept/Revert options.
- 2025-12-15 **IMPLEMENTED** Fix 6: Pan/drag navigation - Added panning to `SheetCanvas.tsx` with scroll-to-pan, Ctrl+scroll-to-zoom, Alt+drag-to-pan, and 2-finger touch support for mobile. Shows hint overlay when sheet exceeds viewport and "Center Sheet" button when panned.
- 2025-12-15 **IMPLEMENTED** Fix 7: Mr. Imagine URL extraction - Fixed critical bug in `backend/services/imagination-ai.ts` where Replicate SDK returns URL **objects** (with `.href` property) instead of strings. Added `extractUrlString()` helper function to handle all Replicate output formats (URL objects, FileOutput with .url() method, arrays, strings) and extract the actual URL string. Applied to `generateImage`, `upscaleImage`, and `enhanceImage` functions.
- 2025-12-15 **IMPLEMENTED** Mr. Imagine Lightbox Upgrade - Created MrImagineModal.tsx with DTF-style prompting, style presets (DTF Print Ready as default), shirt color selector, background controls, output sizing. Modal opens from RightSidebar AI tab. Generated images can be used directly in sheet, downloaded, or regenerated.
- 2025-12-15 **FIX** Mr. Imagine DTF prompting - Backend now detects DTF-formatted prompts from frontend (by checking for "CRITICAL REQUIREMENTS") and uses them as-is instead of overwriting with legacy style enhancement. This ensures DTF guidelines are properly followed.
- 2025-12-15 **FIX** Mr. Imagine image size - Images now load with proper dimensions (6 inches default, maintaining aspect ratio) instead of hardcoded 3x3 inches. Added `loadImageAndGetDimensions()` helper that loads the image, calculates proper size based on aspect ratio, and stores original dimensions for DPI calculation. Images are now centered on the sheet.
- 2025-12-15 **CRITICAL FIX** SheetCanvas inch-to-pixel conversion - Fixed fundamental bug where SheetCanvas was using layer.width/height directly as pixels when they should be inches. Now multiplies all dimension values by PIXELS_PER_INCH (96) for rendering. Fixes: image width/height rendering, cutline overlay, DPI warning box, shape dimensions, and transform end handlers now properly convert pixels back to inches for storage.
- 2025-12-15 **INTEGRATED** MrImagineModal into ImaginationStation - Added MrImagineModal to the main ImaginationStation page AI panel with proper ImaginationLayer type creation. Modal now opens from a prominent button, and generated images are properly sized (6 inches max, maintaining aspect ratio), centered on the sheet, and include DPI information. Converted pricing/freeTrials to required format.
- 2025-12-16 **FIX** ITP Enhance tools now work on Mr. Imagine images - Changed layer_type checks in handleRemoveBackground, handleUpscale, and handleEnhance from `layer_type === 'image'` to `layer_type === 'image' || layer_type === 'ai_generated'`.
- 2025-12-16 **FIX** Image upload sizing - Fixed uploaded images coming in too large. Both handleFileUpload and addPendingImageToSheet now properly calculate dimensions in INCHES (max 6 inches, maintaining aspect ratio) instead of storing pixel values. This ensures images display at correct size (6" max) on the canvas.
- 2025-12-16 **FEATURE** Nano Banana - Added image-to-image AI feature for adding elements to existing images. Backend: added `reimagineImage()` method to imagination-ai.ts using Flux-Redux model, added `/ai/reimagine` endpoint. Frontend: created NanoBananaModal.tsx with prompt input, example prompts, loading state, and side-by-side/slider comparison. User can choose original or reimagined version. Added to ImaginationStation Tools panel.
- 2025-12-16 **RENAME** Nano Banana → Reimagine It - Renamed the feature from "Nano Banana" to "Reimagine It" per user request. Updated all references: ReimagineItModal.tsx (new file name + purple/pink theme), ImaginationStation.tsx (imports, state, handlers, UI), index.ts (exports), api.ts (comments). Button now shows sparkle icon instead of banana, with purple/pink gradient.
- 2025-12-16 **FIX** Reimagine It HTTP 500 error - Fixed Replicate API parameter name in reimagineImage() method. The flux-redux-dev model requires `redux_image` parameter, not `image`. Changed line 418 in backend/services/imagination-ai.ts to use correct parameter name.
- 2025-12-16 **FIX** Reimagine It now uses Google Nano-Banana model - Changed model from flux-redux-dev to google/nano-banana per user request. Updated parameters to use `prompt`, `image_input` (array), `aspect_ratio: "match_input_image"`, and `output_format: "png"`. Updated loading state in ReimagineItModal to show Mr. Imagine character image (bouncing animation) instead of generic sparkle icon.
- 2025-12-16 **UI** Size panel now shows inches instead of pixels - Changed Size section labels in ImaginationStation.tsx Properties panel from "Width (pixels)"/"Height (pixels)" to "Size (inches)" with proper decimal display. Added Quick Size buttons (11" Front, 10" Front, 3.5" Pocket, 12" Back, 4" Sleeve) that auto-resize maintaining aspect ratio. Added collapsible T-Shirt Size Guide with industry-standard print size recommendations for Youth S-M through Adult 2XL+.
- 2025-12-16 **COMPLETE FIX** ITP Enhance tools fully work on AI-generated images - Extended the layer_type fix to all locations in ImaginationStation.tsx: checkout DPI validation (lines 881, 887), export panel DPI warnings (lines 2802, 2805), layer thumbnail display (line 1956), DPI Quality Warning (line 2172), and ITP Enhance panel visibility (line 2624). All checks now include `|| layer_type === 'ai_generated'`.
- 2025-12-16 **UI REDESIGN** Imagination Station landing page now POP with Mr. Imagine branding - Complete visual overhaul with dark cosmic theme featuring: animated gradient orbs, floating sparkle particles, Mr. Imagine hero with glow effects and bounce animation, glassmorphism card design for sheet types, gradient text titles, feature pills with checkmarks, enhanced ITC balance display with gradient styling, custom hover effects on all interactive elements. Loading state also updated with matching dark theme and Mr. Imagine loading animation.
- 2025-12-16 **DIAGNOSED** AI Product Builder stuck on "Generating Assets" - Root cause: The ai-jobs-worker.ts runs as a separate process from the API server. Running `npm run dev` only starts the API, not the worker. Jobs get created but never processed. **FIX**: Run `npm run dev:full` to start both API and worker together, or run `npm run worker` in a separate terminal.
- 2025-12-16 **FIX** Thumbnail uploads now use Google Cloud Storage - Changed imagination-station.ts to use gcsStorage.uploadFromDataUrl() instead of Supabase Storage (which was failing with "Bucket not found" error). Added 'thumbnails' as valid folder type in gcs-storage.ts. Thumbnails now save to GCS path: `users/{userId}/thumbnails/{filename}`.
- 2025-12-19 **FIX** Admin dashboard PGRST200 errors - Fixed FK hint queries in backend routes (coupons.ts, gift-cards.ts, support.ts) that were causing "Could not find a relationship" errors. Changed all FK hint queries (e.g., `user:user_profiles!user_id`) to use separate queries with `.in()` to fetch related data.
- 2025-12-19 **FIX** User role reverting to customer - Added retry logic and role preservation in SupabaseAuthContext.tsx to prevent admin role from reverting to 'customer' when profile fetch temporarily fails.
- 2025-12-19 **FIX** Admin dashboard UI - Fixed notification bell z-index (was behind profile dropdown), fixed tab bar to use flex-wrap instead of horizontal scroll, fixed users query to use separate wallet fetch.
- 2025-12-19 **DATABASE** Created missing tables via migration - Applied SQL migration (20251219_coupons_giftcards_support.sql) via Node.js pg client to create: discount_codes, coupon_usage, gift_cards, support_tickets, ticket_messages, admin_notifications, agent_status, chat_sessions. All tables now exist with RLS policies and indexes.
- 2025-12-20 **PERFORMANCE** Major auth and Home page optimization - Fixed 2-3 minute sign-in and product loading times:
  - **SupabaseAuthContext**: Added profile caching (1 min TTL), eliminated duplicate fetches via refs, reduced timeout from 10s to 5s, added fast fallback instead of blocking retries, optimized query to only fetch needed columns
  - **Home.tsx**: Added React.lazy() for heavy components (ProductRecommendations, FeaturedSocialContent, DesignStudioModal), added Suspense boundaries with skeletons, added featured products cache (1 min TTL)
  - **ProductRecommendations**: Wrapped with memo(), added recommendations cache (2 min TTL), added duplicate fetch prevention via ref
  - **product-recommender.ts**: Optimized query to only fetch needed columns, reduced limit from 20 to just enough, replaced slow .sort() shuffle with Fisher-Yates
  - **Database indexes**: Created migration with indexes for products.is_active, products.is_featured, products.category, user_profiles.id, orders.user_id/status/created_at
- 2025-12-20 **UI** OrderSuccess page Mr. Imagine packing image - Added mr-imagine-packing.png to public folder and updated OrderSuccess.tsx to show Mr. Imagine packing the order instead of generic waving pose. Updated message to "Mr. Imagine is packing it with love!"
- 2025-12-21 **FEATURE** Marketing Tools full integration - Complete overhaul of MarketingTools.tsx:
  - **UI Update**: Added gradient header matching CRM page, stats cards with gradient icon backgrounds, pill-style tabs with icons, enhanced campaign cards with status badges
  - **Supabase Integration**: Connected to products table for real product data, connected to marketing_campaigns table for campaign CRUD
  - **Campaign Operations**: Create campaign (saves to Supabase), toggle status (pause/resume), loading/error states
  - **Backend API**: Created backend/routes/marketing.ts with OpenAI GPT-4o-mini integration for AI content generation, includes fallback mock content when API unavailable
  - **Endpoints**: POST /api/marketing/generate-content (single product), POST /api/marketing/generate-campaign (multi-product campaigns)
  - Registered marketing routes in backend/index.ts
  - **Database**: Created `marketing_campaigns` table via Node.js pg client with pooler connection. Table has: id, name, type, status, target_products, generated_content, budget, start_date, end_date, metrics, settings, created_by, created_at, updated_at. RLS policies for admin/manager access.

## Decisions / notes
- Focus the implementation on `src/pages/ImaginationStation.tsx` (the Konva-based editor). There are other “imagination” components in the repo (e.g., `src/components/imagination/RightSidebar.tsx`), but they appear to be a different UI path.

## Follow-ups
- Confirm whether "Mystery Imagine" should replace/rename "Mr. Imagine" in the UI or be a separate tool entrypoint.

## Work Log (continued)
- 2025-12-23 **FIX** Imagination Station editor improvements:
  - **Image positioning**: Uploaded images now centered on sheet instead of position (1,1). Auto-zoom to fit image with margin on first layer upload.
  - **AI Tools button**: Changed to open MrImagineModal lightbox instead of switching panels.
  - **ITP Enhance button**: Created new ITPEnhanceModal.tsx lightbox with all enhancement tools (Remove BG, Upscale, Enhance, Reimagine It), updated button to open modal instead of panel.
  - **Canvas grab/pan tool**: Click and drag on empty canvas now pans (grab tool behavior). Single-finger touch on mobile also pans. Cursor shows grab/grabbing icons. Updated hint text.
  - Files created: `src/components/imagination/ITPEnhanceModal.tsx`
  - Files modified: `src/pages/ImaginationStation.tsx`, `src/components/imagination/index.ts`, `src/components/imagination/SheetCanvas.tsx`
- 2025-12-24 **FEATURE** 3D Model business logic updates:
  - **Download licensing**: Added ITC-based download licenses (200 personal, 500 commercial). Created `purchased_licenses` column in database.
  - **Print ordering simplified**: PLA grey only with optional paint kit addon ($25 base + $15 paint kit). Removed multiple material/color/size options.
  - **Watermarking**: All generated 3D model images (concept + 4 angles) now include watermark to prevent theft.
  - **Frontend update**: Model3DDetailModal now has 3 tabs (Preview, Order Print, Download Files) with license purchase flow.
  - Files created: `backend/services/watermark.ts`, `supabase/migrations/20251224_3d_models_licenses.sql`
  - Files modified: `backend/routes/3d-models.ts`, `backend/worker/ai-jobs-worker.ts`, `src/components/3d-models/Model3DDetailModal.tsx`
- 2025-12-30 **FEATURE** Admin Dashboard Product Form Enhancements:
  - **Size variants**: Added category-aware size checkboxes (S/M/L/XL for apparel, oz for tumblers, dimensions for DTF)
  - **Color variants**: Added color picker with 10 preset swatches + custom hex color input with visual picker
  - **Image upload**: Replaced URL text input with drag-and-drop file upload zone with thumbnail previews
  - **Digital file upload**: Added separate upload section for digital product deliverables (STL, PDF, ZIP, etc.)
  - **AI Assist**: Added AI-powered name/description suggestions using GPT-4 Vision analysis of uploaded product images
  - Files created: `backend/routes/admin/products.ts`, `supabase/migrations/20251230_product_variants.sql`, `docs/plans/2025-12-30-product-form-enhancements-design.md`
  - Files modified: `src/pages/AdminDashboard.tsx`, `backend/index.ts`
- 2025-12-30 **FEATURE** Community Page with Creator Showcase and Boost System:
  - **Database**: Created `community_posts`, `community_boosts`, `community_boost_earnings` tables with RLS policies, triggers for auto-updating boost counts, and leaderboard view
  - **Backend API**: Created `/api/community` routes for feed (with sorting/filtering), leaderboard, free vote toggle, paid ITC boost, earnings tracking, post publishing
  - **Frontend Components**: Created `CommunityPostCard.tsx` (post with vote/boost buttons), `PaidBoostModal.tsx` (ITC spend dialog), `CreatorLeaderboard.tsx` (top 5 creators), `CommunityShowcase.tsx` (main container)
  - **Community Page**: Updated `Community.tsx` with tabs for "Creator Showcase" (new boost feature) and "Social Media" (existing functionality)
  - **Boost System**: Free votes (1 per user per post, toggleable) + Paid ITC boosts (1-100 ITC, increases visibility). Creators earn 1 ITC per boost received.
  - Files created: `supabase/migrations/20251231_community_features.sql`, `backend/routes/community.ts`, `src/utils/community-service.ts`, `src/components/community/CommunityPostCard.tsx`, `src/components/community/PaidBoostModal.tsx`, `src/components/community/CreatorLeaderboard.tsx`, `src/components/community/CommunityShowcase.tsx`, `src/components/community/index.ts`
  - Files modified: `backend/index.ts`, `backend/middleware/supabaseAuth.ts` (added optionalAuth), `src/types/index.ts`, `src/pages/Community.tsx`
