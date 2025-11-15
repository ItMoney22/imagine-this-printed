# Product Designer Mockup Redesign Plan

## Goal
Redesign the Product Designer to show realistic product mockups (like AI Product Builder) instead of flat canvas areas, and enable customers to pass graphics from product pages directly into the designer.

## Current State Analysis

### Current Product Designer (ProductDesigner.tsx)
- Uses Konva.js canvas for design
- Shows basic colored rectangles as "templates" (shirt, tumbler, hoodie)
- No realistic mockup preview
- Cannot receive graphics from product pages
- "Customize Design" button on ProductPage just navigates to `/designer` with no context

### Current AI Product Builder (AdminCreateProductWizard.tsx)
- Uses Replicate's **Nano Banana** model (`google/nano-banana`) for realistic mockups
- Applies graphics to actual product photos
- Two mockup types: Flat Lay and Lifestyle
- Stores mockup images in GCS and database
- Shows realistic t-shirt/hoodie/tumbler photos with designs applied

## Implementation Plan

### Phase 1: Add URL Parameter Support
**File:** `src/pages/ProductDesigner.tsx`

1. Accept URL parameters:
   - `productId` - the product being customized
   - `designImage` - URL of graphic to apply (optional)
   - `template` - product type (shirt, hoodie, tumbler)

2. Load product data if `productId` provided
3. Auto-load design image if `designImage` provided

### Phase 2: Update "Customize Design" Button
**File:** `src/pages/ProductPage.tsx` (line 218-221)

Change from:
```tsx
onClick={() => navigate('/designer')}
```

To:
```tsx
onClick={() => navigate(`/designer?productId=${product.id}&template=${product.category}`)}
```

Or if product has a main image to use as design:
```tsx
onClick={() => navigate(`/designer?productId=${product.id}&template=${product.category}&designImage=${encodeURIComponent(product.images[0])}`)}
```

### Phase 3: Add Mockup Preview System

#### 3.1 Product Template Configuration
Create template definitions with print areas:

```typescript
const PRODUCT_TEMPLATES = {
  shirts: {
    name: 'T-Shirt',
    mockupBase: 'https://example.com/blank-tshirt.jpg', // or use nano-banana
    printArea: {
      x: 0.25,  // 25% from left
      y: 0.20,  // 20% from top
      width: 0.50,  // 50% of width
      height: 0.60  // 60% of height
    }
  },
  hoodies: {
    name: 'Hoodie',
    mockupBase: 'https://example.com/blank-hoodie.jpg',
    printArea: {
      x: 0.25,
      y: 0.25,
      width: 0.50,
      height: 0.50
    }
  },
  tumblers: {
    name: 'Tumbler',
    mockupBase: 'https://example.com/blank-tumbler.jpg',
    printArea: {
      x: 0.30,
      y: 0.20,
      width: 0.40,
      height: 0.60
    }
  }
}
```

#### 3.2 Two-Panel Layout
- **Left Panel:** Konva.js canvas for design editing (current system)
- **Right Panel:** Realistic mockup preview showing design on actual product

#### 3.3 Real-time Mockup Generation Options

**Option A: Client-Side Composite (Fast but Less Realistic)**
- Use HTML Canvas API to composite design over mockup base
- Apply perspective transforms to match product angle
- Pros: Instant preview, no API costs
- Cons: Less realistic than AI-generated

**Option B: Replicate Nano Banana (Realistic but Slower)**
- Send design + mockup base to Replicate API
- Generate realistic mockup with proper lighting/shadows
- Cache results for 5-10 seconds to reduce API calls
- Pros: Very realistic, same as AI Product Builder
- Cons: ~5-10 seconds per generation, costs ITC tokens

**Option C: Hybrid Approach (Recommended)**
- Use client-side composite for real-time editing preview
- Offer "Generate Realistic Preview" button that calls Nano Banana
- Show both: live edit + realistic preview side-by-side

### Phase 4: Backend Mockup Generation API

Create endpoint: `POST /api/designer/generate-mockup`

**Request:**
```json
{
  "designImageUrl": "https://...",
  "productTemplate": "shirts",
  "mockupType": "flat" // or "lifestyle"
}
```

**Response:**
```json
{
  "mockupUrl": "https://storage.googleapis.com/...",
  "cost": 25 // ITC tokens
}
```

**Implementation:**
- Use same Replicate integration as AI Product Builder
- Reuse `replicate-mockup.ts` service
- Store generated mockups in GCS
- Deduct ITC from user wallet

### Phase 5: UI/UX Improvements

#### 5.1 Design Canvas (Left Panel)
- Keep current Konva.js canvas
- Add visual grid showing print area boundaries
- Show "Safe zone" indicators (margins)
- Real-time resize/rotate/position controls

#### 5.2 Mockup Preview (Right Panel)
- Show actual product photo with design applied
- Toggle between mockup views (front/back if available)
- "Generate Realistic Preview" button (calls Nano Banana)
- Loading state during generation
- Cost indicator (25 ITC tokens)

#### 5.3 Product Selector
- Dropdown to switch product templates
- Show thumbnail previews of each product type
- Update mockup when product changes

#### 5.4 Save & Add to Cart Flow
1. User designs on canvas
2. Click "Save Design"
3. Generate final mockup (Nano Banana)
4. Show preview modal with mockup
5. Confirm and add to cart with mockup image

## Technical Architecture

### Data Flow

```
ProductPage
  ↓ (Click "Customize Design")
ProductDesigner
  ↓ (Load product + optional design image)
Konva Canvas (Left) ←→ Mockup Preview (Right)
  ↓ (Real-time editing)
Client-side Composite Preview (instant)
  ↓ (Click "Generate Realistic Preview")
Backend API → Replicate Nano Banana
  ↓ (Returns realistic mockup)
GCS Storage ← Mockup Image
  ↓ (Display in right panel)
User sees realistic preview
  ↓ (Click "Save & Add to Cart")
Generate Final Mockup → Add to Cart
```

### File Structure

```
src/
├── pages/
│   └── ProductDesigner.tsx (redesigned)
├── components/
│   ├── DesignCanvas.tsx (Konva editing)
│   ├── MockupPreview.tsx (right panel)
│   └── ProductTemplateSelector.tsx
├── utils/
│   ├── mockup-generator.ts (client-side composite)
│   └── product-templates.ts (template definitions)
└── services/
    └── designer-api.ts (backend calls)

backend/
├── routes/
│   └── designer.ts (mockup generation API)
└── services/
    └── replicate-mockup.ts (existing, reuse)
```

## Implementation Steps

### Step 1: URL Parameter Support (30 min)
- [ ] Add URL param parsing to ProductDesigner
- [ ] Load product data from Supabase
- [ ] Auto-load design image if provided

### Step 2: Update Customize Button (10 min)
- [ ] Modify ProductPage.tsx line 218
- [ ] Pass productId and template in URL
- [ ] Test navigation flow

### Step 3: Two-Panel Layout (1 hour)
- [ ] Split ProductDesigner into left/right panels
- [ ] Move Konva canvas to left panel
- [ ] Create MockupPreview component for right panel
- [ ] Responsive design (stack on mobile)

### Step 4: Client-Side Mockup Composite (2 hours)
- [ ] Create mockup-generator.ts utility
- [ ] Implement canvas-based composite
- [ ] Apply perspective transforms
- [ ] Add print area boundaries to design canvas
- [ ] Real-time preview update on design changes

### Step 5: Product Templates (1 hour)
- [ ] Define template configurations
- [ ] Create ProductTemplateSelector component
- [ ] Load appropriate mockup base per template
- [ ] Update print area constraints

### Step 6: Backend Mockup API (1 hour)
- [ ] Create `/api/designer/generate-mockup` endpoint
- [ ] Integrate with Replicate Nano Banana
- [ ] Upload to GCS
- [ ] Return mockup URL

### Step 7: Realistic Preview Button (1 hour)
- [ ] Add "Generate Realistic Preview" button
- [ ] Show ITC cost (25 tokens)
- [ ] Loading state during generation
- [ ] Display Nano Banana mockup
- [ ] Handle errors

### Step 8: Save & Cart Flow (1 hour)
- [ ] Update "Add to Cart" to generate final mockup
- [ ] Show preview modal before cart
- [ ] Store mockup URL with cart item
- [ ] Update cart UI to show mockups

### Step 9: Testing (1 hour)
- [ ] Test with various product types
- [ ] Test design import from product page
- [ ] Test mockup generation
- [ ] Test ITC balance deduction
- [ ] Test cart flow with mockups

## Total Estimated Time: 9-10 hours

## API Costs

Using Replicate Nano Banana:
- Cost: ~$0.10 per mockup generation
- User cost: 25 ITC tokens per realistic preview
- Free: Client-side composite previews (unlimited)

## Benefits

1. **Realistic Preview:** Customers see actual product before buying
2. **Better Conversions:** Realistic mockups increase purchase confidence
3. **Design Context:** Designs automatically load from product pages
4. **Professional Output:** Same quality as AI Product Builder
5. **Cost Effective:** Free preview + paid realistic preview option

## Mockup Examples

### T-Shirt Mockup
- Use nano-banana to apply design to t-shirt photo
- Show design with proper perspective and wrinkles
- Lighting matches product photo

### Hoodie Mockup
- Larger print area
- Design follows hoodie fabric contours
- Shows realistic wear appearance

### Tumbler Mockup
- Cylindrical wrap around
- Design follows curved surface
- Realistic reflection and lighting

## Future Enhancements

1. **Multiple Views:** Front/back/side mockups
2. **Color Variants:** Preview design on different shirt colors
3. **Size Guide:** Show design at actual print size
4. **3D Preview:** Rotate product to see all angles
5. **Batch Mockups:** Generate multiple product mockups at once
6. **Template Library:** Pre-made design templates
7. **Collaboration:** Share designs with others
8. **Design History:** Save and reload previous designs

## Notes

- Reuse existing Replicate integration from AI Product Builder
- Keep Konva.js for design editing (works well)
- Add mockup preview as enhancement, not replacement
- Maintain backward compatibility with current designer
- Test with real products from database

## Questions for User

1. Which approach for mockup preview? (Client-side, Nano Banana, or Hybrid)
2. Should realistic preview cost ITC tokens or be free?
3. Do you want to support multiple mockup views (front/back)?
4. Should we keep the current simple templates as an option?
5. Any specific product templates to prioritize?

---

**Status:** Ready for implementation
**Created:** 2025-11-10
**Last Updated:** 2025-11-10
