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
2. **Medium Priority**: Verify product has exactly 3 final images - Context: 1 selected design + 2 mockups (flat_lay + mr_imagine)
3. **Medium Priority**: Deploy to Railway and test in production - Context: Ensure worker processes jobs correctly in production
4. **Low Priority/Nice-to-Have**: Add progress indicators for mockup generation - Potential benefit: Better user experience during async processing

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

## Technical Debt

### AI Product Builder
- Need comprehensive error handling in mockup generation pipeline - Why: Currently difficult to diagnose failures, poor user feedback
- Worker job status tracking needs improvement - Why: No visibility into job progress or failure reasons from frontend
- Missing unit tests for DTF optimization service - Why: Critical image processing logic should have test coverage
- Hardcoded mockup types (flat_lay, mr_imagine) - Why: Should be configurable or database-driven for flexibility
- `autoQueueMockupJob` function is now dead code - Why: Can be removed in cleanup

## Next Steps

1. Test complete flow end-to-end with fresh product creation
2. Verify worker logs show correct behavior:
   - "MOCKUP GENERATION v2.0" for both templates
   - "Template: flat_lay - Generating standalone mockup" for flat_lay
   - "Template: mr_imagine - Using Mr. Imagine base:" for mr_imagine
3. Verify final product has exactly 3 images
4. Deploy to Railway production and verify worker processes jobs
5. Clean up dead code (`autoQueueMockupJob` function can be removed)
