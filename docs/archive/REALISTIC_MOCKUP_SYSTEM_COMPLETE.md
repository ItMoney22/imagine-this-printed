# Realistic Mockup Generation System - Implementation Complete

**Date:** 2025-11-12
**Status:** ✅ Implemented - Ready for Testing
**ITC Cost:** 25 ITC per generation, automatic refund on discard

## Overview

We've successfully implemented a complete AI-powered realistic mockup generation system using Replicate's Nano Banana (IDM-VTON) virtual try-on model. Users can now generate professional mockups of their designs on customizable models and manage them in a personal media gallery.

## ✅ What Was Implemented

### 1. Database Schema (3 New Tables)

#### `mockup_generations`
Tracks all mockup generation attempts with status, cost, and refund information.

**Key Fields:**
- `user_id` - Owner of the generation
- `design_snapshot` - JSONB snapshot of Konva elements
- `model_description` - JSONB with all model customization choices
- `product_template` - 'shirts', 'hoodies', or 'tumblers'
- `status` - 'generating', 'completed', 'failed', 'selected', 'discarded'
- `mockup_url` - Public GCS URL for the generated mockup
- `gcs_path` - GCS storage path for internal use
- `generation_cost` - Always 25 ITC
- `refunded` - Boolean tracking if ITC was refunded

#### `user_media`
Permanent storage for selected mockups and user uploads.

**Key Fields:**
- `user_id` - Owner
- `media_type` - 'mockup', 'design', or 'upload'
- `file_url` - Public GCS URL
- `gcs_path` - GCS storage path
- `source_generation_id` - Links back to mockup_generations
- `metadata` - JSONB with generation details

#### `wallet_transactions`
Immutable audit log of all ITC transactions.

**Key Fields:**
- `transaction_type` - 'mockup_generation', 'mockup_refund', etc.
- `amount` - Positive for credits, negative for debits
- `balance_before` / `balance_after` - Audit trail
- `reference_id` - Links to mockup_generations or other entities

### 2. Google Cloud Storage Setup

**Bucket:** `imagine-this-printed-media`
**Project:** `imagine-this-printed-main`
**Region:** `us-central1`

**Folder Structure:**
```
users/{user_id}/
  ├── mockups/{generation_id}.png
  ├── designs/{design_id}.png
  └── uploads/{upload_id}.{ext}

stock-models/
  └── {gender}-{ethnicity}-{bodyType}.jpg

temp/
  └── designs/{uuid}.png (auto-delete after 1 day)
```

**Features:**
- CORS enabled for browser uploads
- Public read access for mockup URLs
- Lifecycle policy: temp files deleted after 1 day
- Signed URLs for secure downloads (24hr expiry)

### 3. Backend Services

#### GCS Storage Service (`backend/services/gcs-storage.ts`)
Utility functions for GCS operations:
- `uploadFile()` - Upload buffer to GCS
- `uploadFromDataUrl()` - Upload base64 data URL
- `generateSignedUrl()` - Create download URLs with expiry
- `deleteFile()` - Remove files from GCS
- `getPublicUrl()` - Get public URL for a file

#### Realistic Mockup API (`backend/routes/realistic-mockups.ts`)

**POST `/api/realistic-mockups/generate`**
- Validates ITC balance (requires 25 ITC)
- Creates generation record
- Deducts ITC from wallet
- Logs transaction
- Uploads design to GCS temp storage
- Starts async Nano Banana generation
- Returns generation ID immediately

**GET `/api/realistic-mockups/:generationId/status`**
- Polls generation status
- Returns mockup URL when complete

**POST `/api/realistic-mockups/:generationId/select`**
- Marks mockup as selected
- Creates user_media record
- Generates signed download URL
- Prevents refund after selection

**POST `/api/realistic-mockups/:generationId/discard`**
- Marks mockup as discarded
- Refunds 25 ITC to wallet
- Logs refund transaction
- Cannot discard after selection

**GET `/api/realistic-mockups/gallery`**
- Paginated user media gallery
- Filter by type (mockup, design, upload)
- Returns 20 items per page

### 4. Nano Banana Integration

**Model:** `yisol/idm-vton:c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4`

**Inputs:**
- `garm_img` - Design canvas as PNG (uploaded to GCS temp)
- `human_img` - Stock model photo URL
- `garment_des` - Description like "white crew neck t-shirt"
- `denoise_steps` - 30 (quality vs speed)
- `seed` - 42 (reproducibility)

**Process:**
1. Design uploaded to GCS temp storage
2. Stock model selected based on user choices
3. Replicate API called with virtual try-on model
4. Output downloaded and uploaded to permanent GCS storage
5. Generation record updated with mockup URL
6. Frontend polls for completion

### 5. Frontend Components

#### RealisticMockupGenerator (`src/components/RealisticMockupGenerator.tsx`)

**Features:**
- **Model Configuration Form** (Hybrid Approach):
  - Garment color selector + color picker
  - Shirt type dropdown (crew neck, v-neck, tank)
  - Gender dropdown (male, female, non-binary)
  - Ethnicity dropdown (diverse options)
  - Hair color, eye color dropdowns
  - Body type dropdown (slim, athletic, average, plus-size)
  - Additional details textarea (free text)

- **Generation Flow**:
  - ITC balance check before generation
  - Confirmation modal showing cost
  - Loading state with progress indicator
  - Auto-polls status every 2 seconds
  - Maximum 60-second polling

- **Mockup Review Panel**:
  - Three action buttons:
    - ✅ **Keep & Download** - Select and enable download
    - 🔄 **Generate Another** - Keep current, create new
    - ❌ **Discard & Refund** - Get 25 ITC back
  - Status badges (selected, pending, discarded)

- **Session Gallery**:
  - Thumbnail grid of all attempts
  - Click to view full size
  - Visual status indicators

#### UserMediaGallery (`src/pages/UserMediaGallery.tsx`)

**Features:**
- Grid view of all saved media
- Filter by type (mockups, designs, uploads, all)
- Pagination (20 items per page)
- Click to open modal with full image
- Download button (signed URLs)
- Delete option (TODO: implement backend endpoint)
- Empty state for new users
- Mobile responsive design

**Route:** `/account/media` (Protected)

### 6. Design Studio Integration

**Changes to DesignStudioModal:**
- Replaced `MockupPreview` component with `RealisticMockupGenerator`
- Passes canvas ref, design elements, product template
- Real-time ITC balance updates
- Integrated with existing design workflow

## 🔧 Configuration Required

### Environment Variables

**Backend (.env):**
```env
# Existing
REPLICATE_API_TOKEN=your_replicate_token

# New (already set)
GCS_PROJECT_ID=imagine-this-printed-main
GCS_BUCKET_NAME=imagine-this-printed-media
```

**GCP Credentials:**
- Default application credentials already configured
- Service account has Storage Object Creator + Viewer permissions

### Stock Model Photos ✅ COMPLETED

All 32 stock model photos have been generated and uploaded to GCS:
```
gs://imagine-this-printed-media/stock-models/
```

**Generation Method:** FLUX Schnell via Replicate API

**Filename Pattern:**
```
{gender}-{ethnicity}-{bodyType}.jpg

Examples:
female-caucasian-athletic.jpg
male-african-slim.jpg
female-asian-plus-size.jpg
```

**Generated Models:**
- ✅ 32 total images (4 body types × 4 ethnicities × 2 genders)
- ✅ All publicly accessible
- ✅ Metadata stored (prompt, generation date, model attributes)
- ✅ Cache-Control headers set for performance
- ✅ High-quality professional appearance
- ✅ Models wearing plain white t-shirts
- ✅ Neutral backgrounds
- ✅ Front-facing poses
- ✅ Natural lighting

**Public URL Format:**
```
https://storage.googleapis.com/imagine-this-printed-media/stock-models/{filename}
```

**Script Location:** `backend/scripts/generate-stock-models.ts`

## 📊 User Flow

### Happy Path:
1. User creates design in Design Studio
2. Clicks "Generate Realistic Preview (25 ITC)"
3. Fills out model customization form
4. Confirms generation (25 ITC deducted)
5. Waits 30-60 seconds for generation
6. Reviews mockup in preview panel
7. Clicks "Keep & Download"
8. Mockup saved to media gallery
9. Download link provided (24hr expiry)

### Retry Flow:
1. User reviews mockup
2. Clicks "Generate Another"
3. Fills form with different options
4. New mockup generated (additional 25 ITC)
5. Both mockups shown in session gallery
6. User selects favorite

### Refund Flow:
1. User reviews mockup
2. Not satisfied with result
3. Clicks "Discard & Refund"
4. 25 ITC immediately refunded
5. Mockup marked as discarded
6. Can generate another attempt

## 🚀 Testing Checklist

### Prerequisites:
- [x] Wallet has at least 500 ITC (already fixed)
- [x] Upload stock model photos to GCS (32 photos generated via FLUX Schnell)
- [x] Replicate API token is valid
- [x] GCS bucket is accessible

### Test Cases:

**1. Basic Generation:**
- [ ] Open Design Studio
- [ ] Create simple text design
- [ ] Click "Generate Realistic Preview"
- [ ] Verify ITC balance check
- [ ] Fill model customization form
- [ ] Confirm generation
- [ ] Verify 25 ITC deducted
- [ ] Wait for completion
- [ ] Verify mockup displays

**2. Select & Download:**
- [ ] Click "Keep & Download"
- [ ] Verify mockup added to media gallery
- [ ] Navigate to `/account/media`
- [ ] Verify mockup appears
- [ ] Click mockup to open modal
- [ ] Click download button
- [ ] Verify file downloads

**3. Discard & Refund:**
- [ ] Generate a mockup
- [ ] Click "Discard & Refund"
- [ ] Verify 25 ITC refunded
- [ ] Check wallet balance
- [ ] Verify transaction logged
- [ ] Verify mockup marked as discarded

**4. Multiple Generations:**
- [ ] Generate first mockup
- [ ] Click "Generate Another"
- [ ] Generate second mockup
- [ ] Verify both in session gallery
- [ ] Select one mockup
- [ ] Discard the other
- [ ] Verify only selected in media gallery

**5. Error Handling:**
- [ ] Try to generate with <25 ITC
- [ ] Verify error message
- [ ] Generate with valid balance
- [ ] Simulate API failure (disconnect network)
- [ ] Verify auto-refund occurs
- [ ] Verify error message shown

**6. Edge Cases:**
- [ ] Generate without any design elements
- [ ] Generate with very large image
- [ ] Try to discard after selection (should fail)
- [ ] Close modal during generation
- [ ] Re-open modal and check status
- [ ] Generate 10+ mockups (pagination test)

## 📈 Success Metrics

Track these in the database:

```sql
-- Total generations
SELECT COUNT(*) FROM mockup_generations;

-- Success rate
SELECT
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM mockup_generations
GROUP BY status;

-- Refund rate
SELECT
  ROUND(SUM(CASE WHEN refunded THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as refund_rate
FROM mockup_generations
WHERE status IN ('completed', 'discarded');

-- Average generations per user
SELECT AVG(generation_count)
FROM (
  SELECT user_id, COUNT(*) as generation_count
  FROM mockup_generations
  GROUP BY user_id
) sub;
```

## 🐛 Known Issues & TODO

### Critical:
- [x] ~~**Stock model photos needed**~~ - ✅ COMPLETED: 32 photos generated via FLUX Schnell
- [x] ~~**Route registration bug fixed**~~ - ✅ COMPLETED: Fixed import statement in realistic-mockups.ts (namespace import instead of default)
- [ ] **Delete endpoint** - UserMediaGallery delete button not implemented

### Nice-to-Have:
- [ ] Background scene selection (studio, outdoor, etc.)
- [ ] Batch generation (2-3 variations at once)
- [ ] Thumbnail generation for faster loading
- [ ] Video mockups (model turning/moving)
- [ ] Social sharing directly from gallery
- [ ] Download all mockups as ZIP
- [ ] AI-powered model recommendations based on design
- [ ] Rate limiting (max generations per day)
- [ ] Admin panel for reviewing generations
- [ ] Analytics dashboard for mockup performance

### Performance:
- [ ] Implement caching for repeated generations
- [ ] Optimize image compression before upload
- [ ] Add image CDN for faster delivery
- [ ] Lazy loading in gallery

## 💰 Cost Analysis

**Per Generation:**
- Replicate API: ~$0.02 (Nano Banana model)
- GCS Storage: ~$0.0001/month per file
- GCS Egress: ~$0.001 per download

**Monthly Estimate (1000 generations):**
- API: $20
- Storage: $0.10
- Egress: $1
- **Total: ~$21/month**

**ITC Revenue (1000 generations @ 25 ITC):**
- If 20% refunded: 20,000 ITC spent
- Net: 20,000 ITC = $200 equivalent value

**Profit Margin:** Very healthy at current pricing

## 📚 Documentation

**For Developers:**
- Design doc: `docs/plans/2025-11-12-realistic-mockup-generator.md`
- API routes: `backend/routes/realistic-mockups.ts`
- Frontend component: `src/components/RealisticMockupGenerator.tsx`
- Media gallery: `src/pages/UserMediaGallery.tsx`

**For Users:**
- Add to user documentation/help center
- Create video tutorial for mockup generation
- Add tooltips in UI for guidance

## 🎯 Next Steps

1. ~~**Upload stock model photos to GCS**~~ ✅ COMPLETED
   - Generated 32 stock photos using FLUX Schnell via Replicate
   - All photos uploaded to `gs://imagine-this-printed-media/stock-models/`
   - Publicly accessible with proper metadata

2. **Test with real generations**
   - Run through all test cases
   - Monitor Replicate API responses
   - Check GCS file uploads

3. **Implement delete endpoint**
   ```typescript
   // backend/routes/realistic-mockups.ts
   router.delete('/media/:mediaId', requireAuth, async (req, res) => {
     // Delete from user_media
     // Delete from GCS
     // Return success
   })
   ```

4. **Monitor performance**
   - Track generation success rate
   - Monitor API costs
   - Check user satisfaction

5. **Iterate based on feedback**
   - Gather user feedback
   - Improve prompt engineering
   - Optimize model selection

## 🎉 Conclusion

The realistic mockup generation system is fully implemented and ready for testing. It provides a complete user journey from design creation to professional mockup generation with fair pricing and automatic refunds.

**Key Achievements:**
- ✅ Full database schema with transaction logging
- ✅ GCS integration for media storage
- ✅ Nano Banana virtual try-on integration
- ✅ Rich model customization interface
- ✅ Select/Discard/Retry flow with refunds
- ✅ Personal media gallery
- ✅ Session history tracking
- ✅ Real-time ITC balance updates

**Remaining Work:**
- ~~Upload stock model photos~~ ✅ COMPLETED
- Implement delete endpoint
- Complete testing
- Deploy to production

The system is production-ready pending final testing and delete endpoint implementation! 🚀

## 📝 Stock Model Generation Summary

**Date Completed:** 2025-11-12
**Method:** Automated generation via `backend/scripts/generate-stock-models.ts`
**AI Model:** FLUX Schnell by Black Forest Labs (Replicate API)
**Total Images:** 32

### Generation Details:
- **Ethnicities:** Caucasian, African American, Asian, Hispanic
- **Body Types:** Slim, Athletic, Average, Plus-Size
- **Genders:** Male, Female
- **Quality:** 3:4 aspect ratio, JPG format, 90% quality
- **Storage:** GCS with public URLs and metadata
- **Cost:** ~$0.64 (32 images × $0.02 per image)

### Technical Implementation:
1. Created TypeScript script with 32 model configurations
2. Each config includes gender, ethnicity, body type, and detailed prompt
3. FLUX Schnell generates high-quality realistic photos
4. Images automatically uploaded to GCS with metadata
5. Async iterator used to handle FLUX output format
6. Skip logic prevents duplicate generations
7. All images publicly accessible with proper Cache-Control headers

### Sample URLs:
```
https://storage.googleapis.com/imagine-this-printed-media/stock-models/female-caucasian-slim.jpg
https://storage.googleapis.com/imagine-this-printed-media/stock-models/male-african-athletic.jpg
https://storage.googleapis.com/imagine-this-printed-media/stock-models/female-asian-average.jpg
https://storage.googleapis.com/imagine-this-printed-media/stock-models/male-hispanic-plus-size.jpg
```

### Metadata Stored:
- `generatedWith`: flux-schnell
- `prompt`: Full generation prompt
- `gender`: male/female
- `ethnicity`: caucasian/african/asian/hispanic
- `bodyType`: slim/athletic/average/plus-size
- `generatedAt`: ISO timestamp
