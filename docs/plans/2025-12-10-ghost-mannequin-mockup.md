# Ghost Mannequin Mockup Feature

**Date:** 2025-12-10
**Status:** IMPLEMENTED

## Overview

Added ghost mannequin mockup generation as a third mockup type. Uses Google's Nano-Banana model (Gemini 2.5 Flash Image) to create professional e-commerce photos showing garments as 3D volumes with realistic draping, as if worn by an invisible mannequin.

## Mockup Types (Updated)

| # | Template | Asset Role | Display Order | Description |
|---|----------|------------|---------------|-------------|
| 1 | - | design | 1 | Selected design/artwork |
| 2 | flat_lay | mockup_flat_lay | 2 | Flat lay product shot |
| 3 | ghost_mannequin | mockup_ghost_mannequin | 3 | Invisible mannequin 3D view |
| 4 | mr_imagine | mockup_mr_imagine | 4 | Mr. Imagine mascot wearing product |

## Supported Product Types

Ghost mannequin only generates for garments:
- Categories: `shirts`, `hoodies`, `tanks`
- Product types: `tshirt`, `hoodie`, `tank`

Skipped for: `tumblers`, `dtf-transfers`

## Implementation

### Files Modified

1. **`backend/services/replicate.ts`**
   - Added `GhostMannequinInput` interface
   - Added `GHOST_MANNEQUIN_SUPPORTED_CATEGORIES` and `GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES` exports
   - Added `generateGhostMannequin()` function using `google/nano-banana` model

2. **`backend/worker/ai-jobs-worker.ts`**
   - Added `ghost_mannequin` job type handler
   - Updated Mr. Imagine display_order from 3 to 4
   - Imports ghost mannequin constants

3. **`backend/routes/admin/ai-products.ts`**
   - Updated `/select-image` endpoint to create 3 mockup jobs
   - Ghost mannequin job added conditionally for garments

4. **`backend/routes/user-products.ts`**
   - Updated `/select-image` endpoint to create 3 mockup jobs
   - Ghost mannequin job added conditionally for garments

### Prompt Template

```
Generate a ghost mannequin photograph of this {color} {productType} with the
printed design exactly as shown in the input image.

REQUIREMENTS:
- Show the garment as a 3D volume with realistic fabric draping
- The garment should appear as if worn by an invisible mannequin
- No visible mannequin, support structure, or model - just the floating garment
- Pure white background (RGB 255,255,255)
- Professional e-commerce studio lighting
- Preserve the printed design exactly as it appears in the input image
- Show natural fabric folds, seams, and construction details
- The interior neckline and collar structure should be visible
- High resolution, suitable for online product catalog
- Clean, professional product photography style
```

## Flow

1. User selects design image from AI-generated options
2. System creates 3 mockup jobs in parallel:
   - `replicate_mockup` (flat_lay)
   - `ghost_mannequin` (if garment type)
   - `replicate_mockup` (mr_imagine)
3. Worker processes each job:
   - Gets design image from selected asset
   - Generates mockup using appropriate service
   - Uploads to GCS
   - Saves to `product_assets` table

## Database Schema

Ghost mannequin assets stored in `product_assets` with:
```json
{
  "kind": "mockup",
  "asset_role": "mockup_ghost_mannequin",
  "display_order": 3,
  "metadata": {
    "template": "ghost_mannequin",
    "generated_with": "nano-banana",
    "productType": "tshirt",
    "shirtColor": "black"
  }
}
```

## Testing

To test ghost mannequin generation:
1. Create a new AI product (admin or user)
2. Generate images
3. Select an image
4. Verify 3 mockup jobs are created
5. Check `product_assets` for `mockup_ghost_mannequin` asset

## Notes

- Ghost mannequin uses synchronous `replicate.run()` (no webhooks)
- Skips gracefully for non-garment products with "skipped" status
- Same input priority as other mockups: selected > DTF > nobg > source
