# Claude Session State

## Current Status
**Last Updated:** 2025-12-10
**Last Task Completed:** Created Supabase storage bucket for voice chat audio uploads
**Current Branch:** main

## Active Tasks
- [x] Design session continuity system (brainstorming complete)
- [x] Create CLAUDE_SESSION.md structure
- [x] Create docs/INDEX.md with active documentation listing
- [x] Add status headers to key active docs
- [x] Create Puppeteer browser verification system
- [x] Fix voice-chat 401 error (user.id vs user.sub mismatch)
- [x] Commit all uncommitted work (8 commits)
- [x] Verify support ticket system (tables created, routes verified, frontend integrated)
- [x] Add ghost mannequin mockup generation (3rd mockup type using Nano-Banana)
- [x] Fix image selection not being respected in remove-bg and mockups
- [x] Fix Background Removed UI showing wrong "With Background" image
- [x] Fix Mr. Imagine showing 3 images (now shows 1 on white background)
- [x] Set Mr. Imagine mockup as primary product image
- [x] Add real-time status updates showing what's happening during generation
- [x] Switch to Flux-only image generation (cost savings + best DTF quality)
- [x] Fix duplicate Mr. Imagine mockup generation
- [x] Auto-select single image (skip selection step when only 1 image)
- [x] Add Mr. Imagine voice panel to ProductDesigner (user-side voice-guided design)
- [x] Create Supabase storage bucket for voice chat audio
- [x] Test ProductDesigner with voice panel end-to-end
- [ ] Investigate admin mockup duplication issue (parked)

## Session Context
Setting up a robust session continuity system so Claude can resume work after disconnections. The system uses:
1. **CLAUDE_SESSION.md** (this file) - Single source of truth for session state
2. **docs/INDEX.md** - Master index of active documentation
3. **Git commits after each task** - Ensures progress is saved
4. **Browser verification** - Puppeteer tests to confirm features work

## Recent Decisions
- **Session tracking:** Single CLAUDE_SESSION.md file (not date-stamped files)
- **Doc organization:** Keep archive, add status headers, create INDEX.md
- **Task location:** Tasks live in this file (not separate file)
- **Git frequency:** Commit after each completed task
- **Verification:** Puppeteer tests for critical paths before marking tasks complete

## Browser Verification Commands
```bash
npm run verify           # Run all critical path tests
npm run verify:home      # Test homepage loads
npm run verify:products  # Test product catalog
npm run verify:auth      # Test auth modal
```

## Project Overview
ImagineThisPrinted - Custom printing e-commerce platform with:
- AI Product Builder (voice-guided product creation)
- Mr. Imagine chat widget
- User royalty system (10% ITC on sales)
- DTF mockup generation
- Admin dashboards

## Key In-Progress Features
1. **Voice Product Creation** - Backend complete, frontend components exist
   - See: `VOICE_PRODUCT_CREATION_STATUS.md`
   - See: `GEMINI_VOICE_UI_IMPLEMENTATION.md`
   - **Fixed:** voice-chat.ts was using `user.id` instead of `user.sub`

2. **AI Product Builder Pipeline** - Asset management refactored
   - See: `docs/AI_PRODUCT_BUILDER_PIPELINE.md`

3. **Frontend Design Center** - Integration planned
   - See: `docs/plans/2025-12-09-frontend-design-center-integration.md`

## Recent Fixes

### Mr. Imagine Voice Panel for ProductDesigner (2025-12-10)
**Task:** Add voice-guided design creation to the user-facing ProductDesigner page

**Implementation:**
1. **New Component** (`src/components/MrImagineVoicePanel.tsx`):
   - Collapsible voice panel with Mr. Imagine avatar
   - Expression states: idle, listening, thinking, speaking, happy, confused
   - Microphone toggle with audio level visualization
   - Uses existing `/api/ai/voice-chat` backend for transcription + AI response
   - Parses voice commands into design actions
   - Plays Mr. Imagine voice responses (Minimax Speech-02-Turbo)
   - Welcome audio on page load

2. **ProductDesigner Integration** (`src/pages/ProductDesigner.tsx`):
   - Added `MrImagineVoicePanel` as fixed right-side panel
   - Added auth guard (redirects to login if not authenticated)
   - Added `handleVoiceAction()` callback connecting voice commands to canvas actions:
     - "Add text Hello World" → adds text element
     - "Change color to red" → updates text color
     - "Switch to hoodie" → changes template
     - "Generate a dragon" → opens AI image modal
     - "Upload image" → triggers file input
     - "Clear canvas" → removes all elements
     - "Download" → downloads PNG
     - "Add to cart" → triggers cart flow
     - "Save" → saves to localStorage gallery

**Voice Command Types:**
- `add_text` - Add text to canvas
- `change_color` - Change current text color
- `change_template` - Switch to shirt/hoodie/tumbler
- `upload_image` - Trigger file upload
- `generate_ai` - Open AI generation modal
- `clear_canvas` - Remove all elements
- `download` - Download design as PNG
- `add_to_cart` - Add to shopping cart
- `save_gallery` - Save to user gallery

**Files Created/Modified:**
- `src/components/MrImagineVoicePanel.tsx` (NEW - 400+ lines)
- `src/pages/ProductDesigner.tsx` (Modified - added voice panel integration)

### Flux-Only Image Generation + Single Image Auto-Select (2025-12-10)
**Problems:**
1. User observed only Flux produces usable DTF images; Imagen 4 Ultra and Lucid Origin were "off the mark"
2. Generating 3 images wastes money when only 1 is usable
3. 3 Mr. Imagine mockups being created instead of 1
4. Unnecessary image selection step when only 1 image exists

**Fixes:**

1. **Flux-Only Generation** (`backend/services/replicate.ts:72-79`):
   - Changed `MODELS` array from 3 models to just `black-forest-labs/flux-1.1-pro-ultra`
   - Removed Imagen 4 Ultra and Lucid Origin
   - Updated log messages to reflect single-model generation

2. **Prevent Duplicate Mockup Jobs** (`backend/routes/admin/ai-products.ts`):
   - In `POST /:id/select-image` (line 588-600): Changed cleanup to delete ALL mockup jobs (not just `queued`/`running`)
   - In `POST /:id/create-mockups` (line 385-397): Same cleanup change
   - This ensures old succeeded/failed jobs are also cleared before creating new ones

3. **Auto-Select Single Image** (`src/components/AdminCreateProductWizard.tsx`):
   - Added `mockupsTriggeredRef` to prevent duplicate API calls during polling
   - When 1 source image is ready, automatically selects it and triggers mockup generation
   - Changed condition from `!selectedImageId` to `!mockupsTriggeredRef.current`
   - No more manual image selection step needed since only Flux generates

4. **Better Completion Detection**:
   - Now monitors ALL mockup jobs (`replicate_mockup` + `ghost_mannequin`)
   - Transitions to success only when all jobs complete

**Flow Now:**
1. Enter prompt → Review normalized product
2. Start generation → Flux generates 1 image
3. **Auto-selects image** → Creates 2 mockup jobs (ghost_mannequin + mr_imagine)
4. Wait for mockups → Success screen

### Real-Time Status Updates (2025-12-10)
**Request:** User wanted GPT-style progress messages showing what the system is doing during generation (admin-only)

**Implementation:**
1. **Worker** (`backend/worker/ai-jobs-worker.ts`):
   - Added `updateJobProgress()` helper function that writes progress to `job.output.progress`
   - Added progress updates at key stages: sending to AI, downloading images, uploading to GCS
   - Format: `{ message: "...", step: N, total_steps: N, updated_at: "..." }`

2. **Frontend** (`src/components/AdminCreateProductWizard.tsx`):
   - Updated job status display to show `job.output?.progress?.message` when available
   - Added step counter display (e.g., "2/3")
   - Messages animate with pulse effect for visibility

**Example Progress Messages:**
- "🎨 Sending design to AI models (Flux Fast, Imagen 4, Lucid Origin)..."
- "✂️ Removing background with AI (Remove.bg)..."
- "🎭 Generating Mr. Imagine mascot mockup with Gemini AI..."
- "👻 Rendering invisible mannequin effect with Nano-Banana AI..."

### Mr. Imagine Improvements (2025-12-10)
**Problems:**
1. Mr. Imagine showing 3 images instead of 1
2. Background not plain white for e-commerce
3. Mr. Imagine not set as primary product image

**Fixes:**
1. **Gemini API Config** (`backend/services/vertex-ai-mockup.ts`):
   - Added `candidateCount: 1` to request only 1 response
   - Changed `responseModalities: ['IMAGE']` (removed TEXT to prevent variations)
   - Lowered `temperature: 0.2` and `topP: 0.8` for deterministic output

2. **Prompt Updates**:
   - Added "PLAIN WHITE studio background" instruction
   - Added "Output a SINGLE high-quality product mockup image"
   - Added "Do NOT generate multiple images or variations"

3. **Primary Image Setting** (`backend/worker/ai-jobs-worker.ts`):
   - Mr. Imagine mockup gets `is_primary: true` and `display_order: 1`
   - Other mockups set to `is_primary: false`
   - Display order: mr_imagine(1) → flat_lay(2) → ghost_mannequin(3)

### Image Selection Not Being Respected Fix (2025-12-10)
**Problem:** User reported: "I selected one image. It removed background from the second. It mocked up the third."

**Root Causes Found:**
1. **`/create-mockups` route** didn't accept `selectedAssetId` parameter
2. **API client `createMockups()`** function didn't accept or pass `selectedAssetId`
3. **Frontend `handleCreateMockups()`** didn't pass `selectedImageId` to the API

**Fixes Applied:**
1. **Backend** (`backend/routes/admin/ai-products.ts:378-412`):
   - Added `const { selectedAssetId } = req.body` to extract selection
   - Added `selected_asset_id: selectedAssetId` to `baseInput` for all mockup jobs
   - Added logging: `[ai-products] 🎯 Using selected asset for mockups:`

2. **API Client** (`src/lib/api.ts:142-153`):
   - Changed signature from `createMockups(productId)` to `createMockups(productId, selectedAssetId?)`
   - Added `body: JSON.stringify({ selectedAssetId })` to the request

3. **Frontend** (`src/components/AdminCreateProductWizard.tsx:263-280`):
   - Changed `await aiProducts.createMockups(productId)` to `await aiProducts.createMockups(productId, selectedImageId || undefined)`
   - Added logging for debugging

**Flow Now Works:**
- User selects image → `selectedImageId` is set
- User clicks "Remove Background" → `handleEnhanceRemoveBackground` passes `selectedImageId` to API
- User clicks "Skip to Mockups" or "Create Mockups" → `handleCreateMockups` passes `selectedImageId` to API
- Backend creates jobs with `selected_asset_id` in input
- Worker uses `job.input.selected_asset_id` to fetch the correct image

### AI Product Builder Mockup Generation Fix (2025-12-10)
**Problem:** User reported:
1. Only 1 image shown for selection (should show 1-3 from different AI models)
2. Mockup used different image than the one selected
3. Missing ghost mannequin and Mr. Imagine mockups

**Root Causes:**
- Frontend waited for 3 images before showing selection; if fewer than 3, it either timed out or bypassed selection entirely
- Backend `/create-mockups` route still created OLD mockup types (`flat_lay` + `lifestyle`) instead of NEW ones (`flat_lay` + `ghost_mannequin` + `mr_imagine`)
- Third AI model (Lucid Origin) sometimes fails content moderation, leaving only 1-2 images

**Fixes Applied:**
1. **Frontend** (`src/components/AdminCreateProductWizard.tsx`):
   - Changed image selection logic to show selection UI for 1, 2, or 3 images
   - Removed special case that bypassed selection when only 1 image was generated
   - Now waits 10 seconds (5 polls) for additional images before proceeding

2. **Backend** (`backend/routes/admin/ai-products.ts`):
   - Updated `/create-mockups` route to create: `flat_lay` + `ghost_mannequin` (for garments) + `mr_imagine`
   - Removed old `lifestyle` mockup type

### Ghost Mannequin Mockup (2025-12-10)
**Task:** Add 3rd mockup type using Nano-Banana for invisible mannequin effect
**Implementation:**
- Added `generateGhostMannequin()` in `backend/services/replicate.ts`
- Added `ghost_mannequin` job type in `backend/worker/ai-jobs-worker.ts`
- Updated mockup creation in admin and user routes
- Display order: flat_lay(2) → ghost_mannequin(3) → mr_imagine(4)
- Only generates for garments (shirts/hoodies/tanks), skips tumblers/transfers
- See: `docs/plans/2025-12-10-ghost-mannequin-mockup.md`

### Support Ticket System (2025-12-09)
**Task:** Another agent created support ticket system, needed database and verification
**Actions:**
- Applied migration `backend/db/migrations/01_support_system.sql` to Supabase
- Created `support_tickets` table (11 columns) with RLS policies
- Created `ticket_messages` table (6 columns) with RLS policies
- Verified backend route at `/api/admin/support` (GET /tickets, POST /reply, etc.)
- Verified frontend `AdminSupport` component integrated in `AdminDashboard.tsx`

### Voice Chat 401 Error (2025-12-09)
**Problem:** `/api/ai/voice-chat` returning 401 even with valid token
**Root Cause:** Routes were accessing `req.user.id` but auth middleware sets `req.user.sub`
**Fix:** Updated all routes in `backend/routes/ai/voice-chat.ts` to use `req.user?.sub || req.user?.id`

## Pending Migrations (Not Yet Applied)
- `backend/migrations/create_admin_settings.sql` - Voice settings table
- `backend/migrations/create_user_royalty_system.sql` - Royalty tracking

## Blockers / Questions
- Need to test /create-design after the 401 fix
- Backend server must be running on port 4000 for voice features

## Files Modified This Session
- `CLAUDE_SESSION.md` - Updated with current state
- `docs/INDEX.md` - Created documentation index
- `docs/AI_PRODUCT_BUILDER.md` - Added status header
- `docs/PRODUCTION_READINESS_CHECKLIST.md` - Added status header
- `package.json` - Added verify scripts
- `scripts/verify/browser-utils.js` - Created Puppeteer utilities
- `scripts/verify/critical-paths.js` - Created critical path tests
- `backend/routes/ai/voice-chat.ts` - Fixed user.id -> user.sub (6 locations)
- `backend/db/migrations/01_support_system.sql` - Migration applied to Supabase
- `backend/services/replicate.ts` - Added generateGhostMannequin function
- `backend/worker/ai-jobs-worker.ts` - Added ghost_mannequin job handler
- `backend/routes/admin/ai-products.ts` - Added ghost mannequin job creation
- `backend/routes/user-products.ts` - Added ghost mannequin job creation
- `docs/plans/2025-12-10-ghost-mannequin-mockup.md` - Design documentation

---

## How to Use This File

**For Claude:** Read this file at the start of every conversation to understand current state. Update it after completing tasks. Commit to git regularly.

**For User:** Check this file to see what Claude was last working on. Add notes in "Blockers / Questions" if you need Claude to address something specific.

---

## Workflow Checklist (For Claude)
1. Read this file at conversation start
2. Check Active Tasks
3. Work on tasks
4. Update this file after each task
5. Run `npm run verify` before claiming task complete (when applicable)
6. Commit to git after completing tasks
