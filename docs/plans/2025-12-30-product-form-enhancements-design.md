# Product Form Enhancements Design

**Date:** 2025-12-30
**Status:** Approved

## Overview

Enhance the Admin Dashboard product create/edit form with:
1. Category-aware size and color variants
2. Image file upload (replacing URL input)
3. Digital file upload for digital products
4. AI-assisted name and description generation

## 1. Category-Aware Variants

### Size Presets by Category
| Category | Sizes |
|----------|-------|
| T-Shirts | S, M, L, XL, 2XL, 3XL |
| Hoodies | S, M, L, XL, 2XL, 3XL |
| Tumblers | 12oz, 20oz, 30oz, 40oz |
| DTF Transfers | 8.5x11", 11x17", 13x19" |
| 3D Models | None (no variants) |

### Color Picker
- Preset color swatches: Black, White, Navy, Red, Royal Blue, Forest Green, Heather Grey, Pink, Orange, Yellow
- Custom color picker for hex values
- Selected colors display as removable pills

### Data Storage
```typescript
sizes: string[]    // e.g., ["S", "M", "L", "XL"]
colors: string[]   // e.g., ["#000000", "#FFFFFF", "#1E3A5F"]
```

## 2. Image Upload

### Product Images
- Drag-and-drop zone with click-to-browse
- Multiple file selection (jpg, png, webp)
- Upload progress indicator
- Thumbnail preview grid with delete buttons
- First image = main product image
- Uploads to GCS: `products/{productId}/images/`

### Implementation
- Frontend: File input + drag-drop handlers
- Backend: `POST /api/admin/upload-product-image`
- Uses existing `uploadImageFromBuffer` GCS service

## 3. Digital File Upload

### For Digital Products
- Separate upload zone for deliverable files
- Accepts: STL, PDF, ZIP, PNG, AI, PSD, etc.
- Single file per product
- Shows filename + size after upload
- Uploads to GCS: `digital-products/{productId}/`

### Delivery
- File URL stored in `file_url` column
- Delivered to customer after purchase via secure signed URL

## 4. AI Assist for Name & Description

### User Flow
1. Admin uploads product image
2. Clicks ✨ button next to Name or Description field
3. Loading spinner shows
4. AI suggestion appears as clickable card
5. Admin clicks "Accept" or ignores

### Backend Endpoint
```
POST /api/products/ai-suggest
Input: { imageUrl: string, category: string }
Output: { suggestedName: string, suggestedDescription: string }
```

### GPT-4 Vision Prompt
```
Analyze this product image for an e-commerce print shop.
Category: {category}

Generate:
1. A catchy product name (max 60 chars)
2. A compelling description (2-3 sentences) highlighting the design

Focus on the design, style, and appeal. Be specific about what's shown.
```

## Database Changes

Add columns to `products` table:
```sql
ALTER TABLE products
ADD COLUMN IF NOT EXISTS sizes TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS colors TEXT[] DEFAULT '{}';
```

## Files to Modify

### Frontend
- `src/pages/AdminDashboard.tsx` - Update product modal form

### Backend
- `backend/routes/admin.ts` - Add upload and AI suggest endpoints

### Database
- New migration for sizes/colors columns

## Implementation Order

1. Add database columns for sizes/colors
2. Update productForm state with new fields
3. Add category-aware size checkboxes
4. Add color picker with presets + custom
5. Replace image URL input with file upload
6. Add digital file upload section
7. Add AI suggest endpoint
8. Add AI assist buttons to form
