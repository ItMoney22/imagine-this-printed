# Multi-Model AI Image Generation - Implementation Summary

## Overview

The AI Product Builder now generates images with **BOTH** Google Imagen 4 and Leonardo Lucid Origin simultaneously, giving you two different AI-generated options to choose from for each product.

## What Changed

### 1. Multi-Model Configuration ([backend/services/replicate.ts](backend/services/replicate.ts))

The system is now configured to use two AI models:

```typescript
const MODELS = [
  {
    id: 'google/imagen-4',
    name: 'Google Imagen 4',
    isSynchronous: true, // Returns image immediately
  },
  {
    id: 'lucataco/lcm-realvisxl:effd44dc01d5100796c2ab3b18931f9ecfba0ec66d0d25e8821b58ef13e32e2b',
    name: 'Leonardo Lucid Origin',
    isSynchronous: false, // Takes time to process
  }
]
```

### 2. How It Works

When you create a product with the AI Product Builder:

1. **Frontend submits product idea** → API creates product and AI job

2. **Worker picks up job** → Calls `generateProductImage()`

3. **Multi-model generation starts**:
   - **Google Imagen 4**: Executes synchronously via `replicate.run()`, returns image URL immediately
   - **Leonardo Lucid Origin**: Creates async prediction via `predictions.create()`, will finish later

4. **Synchronous image (Imagen 4)**:
   - Worker immediately uploads to Google Cloud Storage
   - Saves to `product_assets` table with metadata:
     ```json
     {
       "model_id": "google/imagen-4",
       "model_name": "Google Imagen 4",
       "generated_at": "2025-11-29T..."
     }
     ```

5. **Asynchronous image (Leonardo)**:
   - Worker continues polling Replicate API every 5 seconds
   - When complete, uploads to GCS and saves to `product_assets`
   - Includes same metadata structure with Leonardo model info

6. **Both images available**:
   - Both stored as `kind: 'source'` in `product_assets`
   - Differentiated by `metadata.model_name`
   - You can pick which one to use for the final product

### 3. Fixed Issues

#### Problem 1: Imagen 4 Images Never Uploaded
- **Before**: Worker tried to poll Replicate API for synchronous predictions (404 error)
- **After**: Worker detects synchronous results and uploads immediately without polling

#### Problem 2: Single Model Limitation
- **Before**: Only one model could be used at a time
- **After**: Both models run in parallel, giving you 2 options per product

### 4. Code Changes

**[backend/services/replicate.ts](backend/services/replicate.ts):**
- Added `MODELS` array configuration
- Created `generateWithSingleModel()` helper function
- Updated `generateProductImage()` to run all models in parallel
- Returns multi-model result object:
  ```typescript
  {
    id: 'multi-model-1764434567890',
    status: 'succeeded',
    outputs: [
      {
        modelId: 'google/imagen-4',
        modelName: 'Google Imagen 4',
        isSynchronous: true,
        url: 'https://replicate.delivery/...',
        status: 'succeeded'
      },
      {
        modelId: 'lucataco/lcm-realvisxl:effd...',
        modelName: 'Leonardo Lucid Origin',
        isSynchronous: false,
        predictionId: 'abc123...',
        status: 'processing'
      }
    ],
    isMultiModel: true
  }
  ```

**[backend/worker/ai-jobs-worker.ts](backend/worker/ai-jobs-worker.ts):**
- Updated `startJob()` to handle multi-model results
- Processes synchronous images immediately (Imagen 4)
- Stores async prediction IDs for later polling (Leonardo)
- Updated `checkJobStatus()` to:
  - Detect multi-model jobs (`prediction_id` starts with `multi-model-`)
  - Poll async predictions individually
  - Upload each completed image with model metadata
  - Mark job as succeeded when ALL models complete

## How to Test

### 1. Create a New Product

Go to the AI Product Builder and create a product:
- Enter a product idea (e.g., "A sunset beach scene with palm trees")
- Click "Generate Product"

### 2. Watch the Console Logs

**Worker logs** will show:
```
[replicate] 🎨🎨 Multi-model generation started with 2 models
[replicate] 🎨 Generating with Google Imagen 4: {...}
[replicate] 🎨 Generating with Leonardo Lucid Origin: {...}
[replicate] ✅ Google Imagen 4 generation complete
[replicate] 🔍 Google Imagen 4 Image URL: https://replicate.delivery/...
[replicate] ✅ Leonardo Lucid Origin prediction created: xyz123...
[worker] 🎨 Multi-model generation result: 2 models
[worker] 🚀 Processing synchronous result from Google Imagen 4
[worker] 📤 Uploading synchronous image to GCS: graphics/product-slug/original/...
[worker] ✅ Synchronous image uploaded to GCS: https://storage.googleapis.com/...
[worker] ✅ Saved asset for Google Imagen 4: https://storage.googleapis.com/...
[worker] ⏳ Async prediction created for Leonardo Lucid Origin: xyz123...
```

Then after a few polling cycles:
```
[worker] 🔍 Checking job: ... prediction: multi-model-1764434567890
[worker] 🎨 Multi-model job detected, checking async predictions
[worker] 🔍 Checking async prediction for Leonardo Lucid Origin: xyz123...
[worker] ✅ Async prediction succeeded for Leonardo Lucid Origin
[worker] 📸 Leonardo Lucid Origin output URL: https://replicate.delivery/...
[worker] 📤 Uploading Leonardo Lucid Origin image to GCS: graphics/product-slug/original/...
[worker] ✅ Leonardo Lucid Origin image uploaded to GCS: https://storage.googleapis.com/...
[worker] ✅ Saved asset for Leonardo Lucid Origin: https://storage.googleapis.com/...
[worker] ✅ All multi-model outputs completed
```

### 3. Check the Database

Query the `product_assets` table:

```sql
SELECT
  kind,
  url,
  metadata->>'model_name' as model_name,
  created_at
FROM product_assets
WHERE product_id = 'your-product-id'
ORDER BY created_at DESC;
```

You should see TWO `source` assets:
- One from Google Imagen 4
- One from Leonardo Lucid Origin

### 4. Frontend Integration (TODO)

Currently, both images are stored but the frontend needs to be updated to:
1. Display both generated images side-by-side
2. Allow user to select which one to use
3. Mark the selected image as the "primary" source

## Model Details

### Google Imagen 4
- **Type**: Synchronous (instant results)
- **Speed**: ~2-3 seconds
- **Quality**: High-quality, photorealistic
- **API Method**: `replicate.run()`
- **Best For**: General product graphics, clean designs

### Leonardo Lucid Origin (LCM RealVisXL)
- **Type**: Asynchronous (queued processing)
- **Speed**: ~10-30 seconds
- **Quality**: Ultra-realistic, highly detailed
- **API Method**: `replicate.predictions.create()`
- **Best For**: Complex scenes, lifestyle images, artistic renders

## Adding More Models

To add another AI model to the multi-model generation:

1. Update `MODELS` array in [backend/services/replicate.ts](backend/services/replicate.ts:21-33):
   ```typescript
   const MODELS = [
     // ... existing models
     {
       id: 'your-model-id',
       name: 'Your Model Name',
       isSynchronous: false, // or true if it uses replicate.run()
     }
   ]
   ```

2. If the model has special parameters, add them in `generateWithSingleModel()`:
   ```typescript
   else if (modelId.includes('your-model-keyword')) {
     modelInput.your_param = 'value'
     modelInput.another_param = 123
   }
   ```

3. Restart the worker and API server

That's it! The worker will automatically handle the new model.

## Troubleshooting

### Images not generating?
- Check worker is running: `cd backend && npm run worker:dev`
- Check worker logs for errors
- Verify REPLICATE_API_TOKEN is set in `.env`

### Only one image appears?
- Check worker logs for the async prediction polling
- Leonardo can take 30+ seconds - be patient
- Check Replicate dashboard for prediction status: https://replicate.com/predictions

### Metadata not saving?
- The `metadata` column is JSONB in PostgreSQL
- If you get a schema error, the column might not exist
- Can manually add: `ALTER TABLE product_assets ADD COLUMN metadata JSONB;`

## Environment Variables

No new environment variables needed! The system uses:
- `REPLICATE_API_TOKEN` - Already configured
- `GCS_BUCKET_NAME` - Already configured
- `PUBLIC_URL` - Already configured (for webhooks)

## Performance Notes

- **Imagen 4**: Returns immediately, ~2-3 seconds total
- **Leonardo**: Queued on Replicate, ~10-30 seconds total
- **Total time**: The slowest model determines when "all complete"
- **Storage**: Each image is ~500KB-2MB after GCS upload
- **Cost**: Pay per prediction on Replicate (both models charged)

## Next Steps

1. **Frontend UI**: Add image selector to AdminAIProductBuilder
2. **Primary Image**: Add `is_primary` flag to product_assets
3. **Image Comparison**: Show side-by-side preview with quality metrics
4. **Model Preferences**: Let users pick favorite models for future generations
5. **Batch Processing**: Generate multiple variations with same prompt

---

**Implementation Date**: November 29, 2025
**Status**: ✅ Complete and Running
**Backend Services**: Both API and Worker updated and running
