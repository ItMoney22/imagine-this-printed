# Project Notes

## Completed

### GCS Image Storage
- [2025-12-09] **FIXED**: Extended GCS signed URL lifetime from 7 days to 1 year - Prevents product images from breaking - files: backend/services/google-cloud-storage.ts
- [2025-12-09] Created URL refresh script to regenerate expired signed URLs - Run every 6 months - files: backend/scripts/refresh-product-images.ts

### AI Product Builder
- [2025-12-08] Multi-model image generation system implemented - Uses Imagen 4, Flux, and Recraft to generate 3 unique images - files: backend/routes/admin/ai-products.ts, backend/services/replicate.ts
- [2025-12-08] DTF optimization service created for print-ready designs - Processes images with proper color profiles and sizing - files: backend/services/dtf-optimizer.ts
- [2025-12-08] Image selection flow in Admin Product Wizard - User can select favorite from 3 generated images - files: src/components/AdminCreateProductWizard.tsx
- [2025-12-08] Select-image API endpoint - Creates 2 mockup jobs (flat_lay + mr_imagine) and deletes non-selected images - files: backend/routes/admin/ai-products.ts (lines 424-545)
- [2025-12-08] Gemini 2.5 Flash Image integration for mockup generation - Uses Vertex AI for intelligent mockup creation - files: backend/services/vertex-ai-mockup.ts
- [2025-12-08] Railway worker service setup - Added start:worker script and railway.worker.toml configuration - files: backend/package.json, backend/railway.worker.toml
- [2025-12-09] **FIXED**: Disabled auto-mockup in worker - Mockups are now ONLY created when user selects an image via /select-image route - files: backend/worker/ai-jobs-worker.ts (lines 893-901)
- [2025-12-09] **FIXED**: Template-specific logic in vertex-ai-mockup.ts - mr_imagine fetches base image, flat_lay generates standalone - files: backend/services/vertex-ai-mockup.ts (lines 124-181)

### Imagination Station - Gang Sheet Builder
- [2025-12-11] **COMPLETE**: Full-featured gang sheet design tool for DTF, UV DTF, and Sublimation printing - Real-time Konva.js canvas editor with AI-powered tools - files: src/pages/ImaginationStation.tsx, backend/routes/imagination-station.ts
- [2025-12-11] AI Tools Integration: Mr. Imagine (image generation) and ITP Enhance Engine (BG removal, upscaling, enhancement) - ITC token-based pricing with free trial system - files: backend/services/imagination-ai.ts, backend/services/imagination-pricing.ts
- [2025-12-11] Frontend components created: SheetCanvas, LeftSidebar, RightSidebar, LayersPanel, MrImaginePanel, ITPEnhanceTools, ExportPanel, and 6 more - All with TypeScript fixes applied - files: src/components/imagination/ (13 component files)
- [2025-12-11] Database schema: 4 new Supabase tables with RLS policies - imagination_sheets, imagination_layers, imagination_pricing, imagination_free_trials - Default pricing data inserted
- [2025-12-11] Navigation integration: Added "Gang Sheets" button to Navbar with purple gradient styling - Visible when logged in, links to /imagination-station - files: src/components/Navbar.tsx
- [2025-12-11] Export system: PNG/PDF export at 300 DPI with proper canvas-to-image conversion - Backend handles file storage and signed URLs - files: backend/routes/imagination-station.ts (export endpoint ~1000 lines total)
- [2025-12-11] Auto-layout features: Auto-nest and smart fill algorithms for optimal sheet usage - ITC token costs: auto_nest (2 ITC), smart_fill (3 ITC) - files: backend/config/imagination-presets.ts
- [2025-12-11] TypeScript fixes session: Fixed Header, UserProfile, UserProductCreator, AdminCreateProductWizard, VoiceConversationEnhanced, Community components - Changed @/ imports to relative paths in all imagination components - files: Multiple frontend files
- [2025-12-12] **FIXED**: ITP Enhance buttons (Remove BG, Upscale, Enhance) - Added onClick handlers that were missing - files: src/pages/ImaginationStation.tsx
- [2025-12-12] **FIXED**: Mr. Imagine AI generation - Now calls actual API instead of placeholder alert - files: src/pages/ImaginationStation.tsx
- [2025-12-12] **ADDED**: Admin ITC Pricing Management - New tab in Admin Dashboard to adjust ITC costs, set promos, reset defaults - files: backend/routes/admin/imagination-pricing.ts, src/pages/AdminDashboard.tsx, src/lib/api.ts
- [2025-12-12] **ADDED**: Stability Features - ErrorBoundary, autosave every 30s, undo/redo with history (Ctrl+Z, Ctrl+Shift+Z) - files: src/pages/ImaginationStation.tsx
- [2025-12-12] **VERIFIED**: Mirror & Cutlines functionality working - Mirror applies scaleX:-zoom to Stage for sublimation, cutlines show dashed borders - files: src/components/imagination/SheetCanvas.tsx
- [2025-12-12] **VERIFIED**: DPI detection and warnings - Visual DPI badges on low-quality images, blocks checkout for danger-level DPI - files: src/utils/dpi-calculator.ts, src/pages/ImaginationStation.tsx
- [2025-12-15] **FIXED**: Replicate FileOutput handling - All AI endpoints now correctly call `.url()` method on FileOutput objects from Replicate SDK v1.0+ - files: backend/services/imagination-ai.ts (generateImage, removeBackground, upscaleImage, enhanceImage methods)
- [2025-12-15] **VERIFIED**: All Imagination Station AI features tested and working:
  - Remove Background: ✅ Returns valid URL (tested with unsplash image)
  - Upscale 2x: ✅ Returns valid URL
  - Enhance: ✅ Returns valid URL
  - Mr. Imagine Generation: ✅ Returns valid URL (Flux 1.1 Pro model)
  - Free trial system: ✅ Working correctly, tracks usage per feature
- [2025-12-15] **UPDATED**: AI Models for better quality output:
  - **Remove Background**: Changed from Replicate `lucataco/remove-bg` → **Remove.bg API** (returns base64 data URL for higher quality)
  - **Enhance Image**: Changed from `nightmareai/real-esrgan` → **`recraft-ai/recraft-crisp-upscale`** (Replicate - better image enhancement)
  - Upscale (2x, 4x): Kept `nightmareai/real-esrgan` (user satisfied with output)
  - Mr. Imagine Generation: Kept `black-forest-labs/flux-1.1-pro` (user satisfied with output)
  - Files modified: backend/services/imagination-ai.ts (added import for removebg, rewrote removeBackground() and enhanceImage() methods)

## In Progress

### AI Product Builder - Final Testing
- **Status**: Code fixes applied, ready for end-to-end testing
- **Last Updated**: 2025-12-09
- **Changes Made**:
  1. Disabled `autoQueueMockupJob()` in worker - was creating only flat_lay mockup prematurely
  2. Mockups now only created via `/select-image` endpoint which creates BOTH flat_lay + mr_imagine
  3. Non-selected images are properly deleted
  4. Template-specific logic verified correct in vertex-ai-mockup.ts

## TODO (Priority Order)

1. **High Priority**: Test complete AI product creation flow end-to-end - Rationale: Verify all fixes work correctly in real scenario
2. ~~**High Priority**: Test Imagination Station AI features with real ITC transactions~~ - **DONE [2025-12-15]**: All AI features tested and working
3. **Medium Priority**: Verify product has exactly 3 final images - Context: 1 selected design + 2 mockups (flat_lay + mr_imagine)
4. **Medium Priority**: Deploy to Railway and test in production - Context: Ensure worker processes jobs correctly in production
5. **Low Priority/Nice-to-Have**: Add progress indicators for mockup generation - Potential benefit: Better user experience during async processing
6. **Low Priority/Nice-to-Have**: Add more sheet size presets to Imagination Station - Potential benefit: Support more print shop requirements
7. **Low Priority/Nice-to-Have**: Create templates gallery for Imagination Station - Potential benefit: Help users get started faster with pre-built layouts
8. **Low Priority/Nice-to-Have**: Improve mobile responsiveness for Imagination Station - Potential benefit: Better experience on tablets and phones

## Scheduled Maintenance Tasks

### 📅 June 2026 - GCS Signed URL Refresh
- **Due Date**: 2026-06-09 (6 months from now)
- **Task**: Run the product image URL refresh script
- **Command**: `cd backend && npx tsx scripts/refresh-product-images.ts`
- **Why**: GCS signed URLs expire after 1 year. Product images will stop loading if not refreshed.
- **Files**: `backend/scripts/refresh-product-images.ts`
- **Context**: GCS bucket has public access prevention enforced at org level, so we use signed URLs. URLs were last refreshed on 2025-12-09 and will expire around 2026-12-09.
- **IMPORTANT FOR AI AGENTS**: If you are working on this project after June 2026, run this script immediately to prevent broken product images!

## Known Issues

### AI Product Builder - Mockup Generation [2025-12-09 RESOLVED]
- **[Impact: High]** Mockup generation was not working as expected after user selects image
  - **Expected Behavior**: 3 final images (1 selected design + 2 mockups: flat_lay and mr_imagine)
  - **Previous Behavior**: Only flat_lay mockup generated due to premature auto-queue

  **ROOT CAUSES IDENTIFIED AND FIXED:**

  1. **BUG #1: `autoQueueMockupJob()` was called prematurely (FIXED)**
     - Location: `backend/worker/ai-jobs-worker.ts` (lines 893-901)
     - Problem: Worker auto-created a single flat_lay mockup when image generation completed
     - This interfered with the user selection flow
     - Fix: Disabled auto-queue; mockups now only created via `/select-image` endpoint

  2. **BUG #2: Template logic was originally broken (ALREADY FIXED in earlier session)**
     - Location: `backend/services/vertex-ai-mockup.ts`
     - Problem: flat_lay was incorrectly trying to use Mr. Imagine base image
     - Fix: Strict separation - mr_imagine uses base image, flat_lay generates standalone
     - Version tag v2.0 added to verify code is fresh

  **Verification Steps**:
  - Create a new product via AI Product Builder
  - When 3 images are generated, user selects one
  - Check ai_jobs table: should see 2 `replicate_mockup` jobs (flat_lay + mr_imagine)
  - Check product_assets table: should have 3 assets after mockups complete
  - Worker logs should show `MOCKUP GENERATION v2.0` for both jobs

## Architecture Notes

### Imagination Station - Gang Sheet Builder

**Overview**: Professional gang sheet design tool for DTF, UV DTF, and Sublimation printing with AI-powered features.

**Access**:
- URL: `/imagination-station` (requires authentication)
- Navigation: "Gang Sheets" button in Navbar (purple gradient, visible when logged in)

**Core Features**:
- Real-time canvas editor using Konva.js
- Support for 3 print types: DTF, UV DTF, Sublimation
- Preset sheet sizes: 13x19", 13x38", 24x36", Custom
- AI tools: Mr. Imagine (image generation), ITP Enhance Engine (BG removal, upscaling, enhancement)
- Auto-layout: auto-nest and smart fill algorithms
- Export: PNG/PDF at 300 DPI

**ITC Token Pricing**:
| Feature | Cost | Free Trial |
|---------|------|------------|
| bg_remove | 5 ITC | 3 uses |
| upscale_2x | 5 ITC | 2 uses |
| upscale_4x | 10 ITC | 1 use |
| enhance | 5 ITC | 2 uses |
| generate | 15 ITC | 2 uses |
| auto_nest | 2 ITC | 5 uses |
| smart_fill | 3 ITC | 3 uses |
| export | 0 ITC | unlimited |

**Database Schema**:
```
imagination_sheets:
  - id, user_id, name, sheet_type, width, height
  - background_color, grid_enabled, snap_enabled
  - created_at, updated_at

imagination_layers:
  - id, sheet_id, layer_type (image/text/shape)
  - content (image URL or text content)
  - x, y, width, height, rotation, opacity
  - z_index, locked, visible
  - created_at, updated_at

imagination_pricing:
  - id, feature_name, itc_cost
  - free_trial_uses, description
  - created_at, updated_at

imagination_free_trials:
  - id, user_id, feature_name
  - uses_remaining, last_used_at
  - created_at, updated_at
```

**Frontend Architecture**:
- Main page: `src/pages/ImaginationStation.tsx`
- Components: `src/components/imagination/` (13 files)
  - SheetCanvas.tsx - Konva canvas component
  - LeftSidebar.tsx - Tool selection and layer controls
  - RightSidebar.tsx - Properties panel
  - LayersPanel.tsx - Layer management
  - MrImaginePanel.tsx - AI image generation
  - ITPEnhanceTools.tsx - AI enhancement tools
  - ExportPanel.tsx - Export options
  - BackgroundPanel.tsx, GridPanel.tsx, SnapPanel.tsx
  - ImageUploadPanel.tsx, TextPanel.tsx, ShapePanel.tsx

**Backend Architecture**:
- Main API: `backend/routes/imagination-station.ts` (~1000 lines)
- Services:
  - `backend/services/imagination-ai.ts` - AI tool integration
  - `backend/services/imagination-pricing.ts` - ITC pricing and free trial logic
- Config:
  - `backend/config/imagination-presets.ts` - Sheet size presets

**Key Endpoints**:
```
GET /api/imagination/sheets - List user sheets
POST /api/imagination/sheets - Create new sheet
GET /api/imagination/sheets/:id - Get sheet with layers
PUT /api/imagination/sheets/:id - Update sheet
DELETE /api/imagination/sheets/:id - Delete sheet

POST /api/imagination/layers - Add layer
PUT /api/imagination/layers/:id - Update layer
DELETE /api/imagination/layers/:id - Delete layer

POST /api/imagination/ai/generate - Mr. Imagine image generation
POST /api/imagination/ai/remove-bg - ITP Enhance Engine BG removal
POST /api/imagination/ai/upscale - ITP Enhance Engine upscaling
POST /api/imagination/ai/enhance - ITP Enhance Engine enhancement

POST /api/imagination/auto-nest - Auto-nest algorithm
POST /api/imagination/smart-fill - Smart fill algorithm

POST /api/imagination/export - Export to PNG/PDF
GET /api/imagination/pricing - Get pricing info
GET /api/imagination/free-trials/:userId - Get user's free trial status
```

**Known TypeScript Fixes Applied**:
- All imagination components use relative imports (not @/ aliases)
- Fixed Header.tsx: pointsBalance → itcBalance
- Fixed UserProfile.tsx: wallet access, JSX namespace, ProfileStats type
- Fixed UserProductCreator.tsx: pointsBalance, DesignSession type
- Fixed AdminCreateProductWizard.tsx: AIJob type updates
- Fixed VoiceConversationEnhanced.tsx: MediaTrackConstraints
- Fixed Community.tsx: encodeURIComponent fallbacks

### AI Product Builder Flow (CORRECT FLOW)

```
Step 1 - Product Creation:
  └─> Admin enters prompt + settings
  └─> Backend creates product in DB
  └─> Creates replicate_image job with multi-model config

Step 2 - Image Generation (Worker):
  └─> Worker picks up replicate_image job
  └─> Runs 3 AI models in parallel (Imagen 4, Flux, Recraft)
  └─> Uploads results to GCS as 'source' assets
  └─> Creates DTF-optimized versions as 'dtf' assets
  └─> ** NO auto-mockup job created ** (changed 2025-12-09)

Step 3 - User Selection (Frontend → Backend):
  └─> User views 3 generated images
  └─> User selects their favorite
  └─> Frontend calls POST /api/admin/products/ai/:id/select-image
  └─> Backend:
      a) Marks selected asset as primary
      b) DELETES non-selected source/dtf assets
      c) Creates 2 mockup jobs: flat_lay + mr_imagine

Step 4 - Mockup Generation (Worker):
  └─> Worker picks up replicate_mockup jobs
  └─> For flat_lay: Gemini generates standalone product mockup
  └─> For mr_imagine: Gemini composites design onto Mr. Imagine base image
  └─> Both uploaded to GCS as 'mockup' assets

Step 5 - Final Product:
  └─> Product has exactly 3 images:
      1. Selected design (source or dtf)
      2. Flat lay mockup
      3. Mr. Imagine mockup
```

### Key Files
- **Frontend**: `src/components/AdminCreateProductWizard.tsx` - Wizard UI for product creation
- **Backend API**: `backend/routes/admin/ai-products.ts` - Handles image generation, selection, and job creation
- **Worker**: `backend/worker/ai-jobs-worker.ts` - Background job processor for async tasks
- **Services**:
  - `backend/services/replicate.ts` - Multi-model image generation
  - `backend/services/dtf-optimizer.ts` - Print-ready image optimization
  - `backend/services/vertex-ai-mockup.ts` - Gemini-powered mockup generation

### Important Code Locations
- **Select-image route**: `ai-products.ts` lines 424-553
  - Deletes non-selected images: lines 461-479
  - Creates both mockup jobs: lines 507-526
- **Worker mockup processing**: `ai-jobs-worker.ts` lines 444-673
  - Gets selected asset: lines 498-514
  - Calls Gemini: lines 600-608
- **Gemini mockup generation**: `vertex-ai-mockup.ts` lines 65-310
  - Template separation: lines 124-181
  - mr_imagine fetches base image: lines 124-158
  - flat_lay generates standalone: lines 160-181

## Improvement Ideas

### AI Product Builder
- Add preview capability for mockup jobs before finalizing - Potential benefit: User can review mockups before publishing product
- Implement retry logic for failed mockup generation - Potential benefit: More resilient to API failures
- Add ability to regenerate specific mockups - Potential benefit: User control over final image quality
- Consider caching Gemini responses for similar prompts - Potential benefit: Faster generation and cost reduction

### Imagination Station
- Add templates gallery with pre-built layouts - Potential benefit: Help users get started faster, showcase best practices
- Implement collaborative editing (real-time multi-user) - Potential benefit: Teams can work together on gang sheets
- ~~Add history/undo system beyond browser undo~~ - **DONE** [2025-12-12]: Implemented undo/redo with 50-entry history, Ctrl+Z/Ctrl+Shift+Z shortcuts
- Create mobile/tablet-optimized interface - Potential benefit: Design on-the-go capability
- Add more sheet size presets (11x17", 22x60", etc.) - Potential benefit: Support more print shop requirements
- Implement batch operations (apply effect to multiple layers) - Potential benefit: Faster workflow for repetitive tasks
- ~~Add keyboard shortcuts for common actions~~ - **DONE** [2025-12-12]: Added Ctrl+Z (undo), Ctrl+Shift+Z/Ctrl+Y (redo)
- Create video tutorials and help system - Potential benefit: Reduce learning curve, increase adoption
- ~~Add autosave functionality~~ - **DONE** [2025-12-12]: Autosaves every 30 seconds when there are unsaved changes

## Technical Debt

### AI Product Builder
- Need comprehensive error handling in mockup generation pipeline - Why: Currently difficult to diagnose failures, poor user feedback
- Worker job status tracking needs improvement - Why: No visibility into job progress or failure reasons from frontend
- Missing unit tests for DTF optimization service - Why: Critical image processing logic should have test coverage
- Hardcoded mockup types (flat_lay, mr_imagine) - Why: Should be configurable or database-driven for flexibility
- `autoQueueMockupJob` function is now dead code - Why: Can be removed in cleanup

### Imagination Station
- Auto-nest and smart-fill algorithms are stubs - Why: Need actual implementation for optimal sheet layout, currently placeholder code
- Missing comprehensive error handling in AI service calls - Why: API failures could leave users in bad state without clear feedback
- No retry logic for failed AI operations - Why: Network issues or API limits could cause permanent failures
- Canvas export might fail on very large sheets - Why: Browser memory limits, need chunked or server-side rendering
- @/ import aliases not working in imagination components - Why: Had to use relative imports as workaround, should fix Vite config
- Missing unit tests for pricing service - Why: Critical billing logic should have test coverage
- No rate limiting on AI endpoints - Why: Users could abuse free trials or rack up costs
- Image URLs stored directly in layers table - Why: Should use asset management system like product_assets for consistency

## Next Steps

### Immediate (AI Product Builder)
1. Test complete flow end-to-end with fresh product creation
2. Verify worker logs show correct behavior:
   - "MOCKUP GENERATION v2.0" for both templates
   - "Template: flat_lay - Generating standalone mockup" for flat_lay
   - "Template: mr_imagine - Using Mr. Imagine base:" for mr_imagine
3. Verify final product has exactly 3 images
4. Deploy to Railway production and verify worker processes jobs
5. Clean up dead code (`autoQueueMockupJob` function can be removed)

### Immediate (Imagination Station)
1. Test all AI features with real ITC transactions:
   - Verify free trial system works correctly (tracks uses, decrements properly)
   - Test paid operations (ITC deduction, insufficient balance handling)
   - Verify Mr. Imagine image generation (15 ITC)
   - Test all ITP Enhance Engine features (bg_remove, upscale_2x, upscale_4x, enhance)
2. Test auto-nest and smart-fill features (currently stubs - need implementation)
3. Test export functionality:
   - PNG export at 300 DPI
   - PDF export at 300 DPI
   - Verify file storage and signed URL generation
4. Test sheet persistence:
   - Create, save, load, delete sheets
   - Verify layers are properly associated with sheets
   - Test concurrent editing scenarios
5. UI/UX testing:
   - Test on different screen sizes
   - Verify all panels open/close correctly
   - Test keyboard/mouse interactions with canvas
   - Verify layer selection, drag, resize, rotate

### Soon
1. Implement actual auto-nest and smart-fill algorithms (replace stubs)
2. Add rate limiting to AI endpoints
3. Improve error handling throughout the feature
4. Add comprehensive logging for debugging
5. Create user documentation/tutorials
