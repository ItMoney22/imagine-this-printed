# AI Product Builder - Asset Management Refactor

**Date:** 2025-12-09
**Status:** Approved for Implementation

## Overview

Refactor the AI Product Builder asset pipeline to use explicit `asset_role`, `is_primary`, and `display_order` columns for cleaner state management and predictable gallery display.

## Goals

1. Final product shows exactly 3 images: selected design + flat_lay mockup + mr_imagine mockup
2. Non-selected design images are deleted (hard delete, not soft archive)
3. Explicit metadata columns replace inference from `kind` + `metadata.template`
4. Frontend filtering based on explicit flags, not "all assets"

## Data Model Changes

### New Columns on `product_assets`

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `asset_role` | TEXT | `NULL` | Explicit role: `'design'`, `'mockup_flat_lay'`, `'mockup_mr_imagine'`, `'auxiliary'` |
| `is_primary` | BOOLEAN | `false` | `true` only for the selected design asset |
| `display_order` | INTEGER | `99` | Controls gallery ordering (1=design, 2=flat_lay, 3=mr_imagine) |

### Backward Compatibility

- Keep existing `kind` column ('source', 'dtf', 'nobg', 'mockup')
- Keep existing `metadata` JSONB for additional info
- New columns are additive, existing queries continue to work

## Backend Workflow

### 1. Image Generation (`replicate_image` job)

When worker uploads design assets:
```
asset_role = 'design'
is_primary = false
display_order = 99
kind = 'source' or 'dtf' (unchanged)
```

### 2. Image Selection (`POST /:id/select-image`)

On user selection:
1. Update selected asset:
   - `is_primary = true`
   - `asset_role = 'design'`
   - `display_order = 1`
   - `metadata.is_selected = true` (keep for compatibility)

2. Delete non-selected design assets (unchanged behavior)

3. Queue mockup jobs with `asset_role` in input:
   - `{ template: 'flat_lay', asset_role: 'mockup_flat_lay' }`
   - `{ template: 'mr_imagine', asset_role: 'mockup_mr_imagine' }`

### 3. Mockup Generation (`replicate_mockup` job)

When worker creates mockup assets:

**flat_lay template:**
```
asset_role = 'mockup_flat_lay'
is_primary = false
display_order = 2
kind = 'mockup' (unchanged)
```

**mr_imagine template:**
```
asset_role = 'mockup_mr_imagine'
is_primary = false
display_order = 3
kind = 'mockup' (unchanged)
```

### 4. Failure Handling

If mr_imagine generation fails:
- Job marked as failed with error
- Product displays with 2 images (design + flat_lay)
- No placeholder needed
- Admin can retry via UI

## API Changes

### Status Endpoint Enhancement

`GET /api/admin/products/ai/:id/status?display=true`

When `display=true`:
- Returns only assets where `is_primary = true` OR `asset_role LIKE 'mockup_%'`
- Ordered by `display_order ASC`
- Result: 1-3 images for storefront display

Without param: Returns all assets (admin view)

## Frontend Changes

### Display Logic

```typescript
// Filter for storefront gallery
const displayAssets = assets
  .filter(a => a.is_primary || a.asset_role?.startsWith('mockup_'))
  .sort((a, b) => (a.display_order || 99) - (b.display_order || 99))
```

### Gallery Rendering Order

1. Design (display_order = 1) — the selected artwork
2. Flat Lay (display_order = 2) — shirt on surface
3. Mr. Imagine (display_order = 3) — mascot mockup (if exists)

## Migration Strategy

1. Add new columns with defaults (non-breaking)
2. Backfill existing assets based on `metadata.template` and `metadata.is_selected`
3. Deploy backend changes
4. Deploy frontend changes

## Files to Modify

- `migrations/` — New migration file
- `backend/worker/ai-jobs-worker.ts` — Set new fields on asset creation
- `backend/routes/admin/ai-products.ts` — Update select-image and status endpoints
- `src/components/AdminCreateProductWizard.tsx` — Update display filtering
- `src/pages/AdminDashboard.tsx` — Update product asset display (if needed)
