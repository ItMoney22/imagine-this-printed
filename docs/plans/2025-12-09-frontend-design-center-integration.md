# Frontend Design Center Integration Plan

**Date**: 2025-12-09
**Status**: Planning

## Overview

Integrate the proven AI Product Builder multi-model pipeline into the customer-facing Design Center, enabling users to:
1. Generate designs using 3 AI models simultaneously
2. Preview and select from multiple design options
3. See mockups automatically generated after selection
4. Purchase products with their selected design

---

## Current State

### Existing Components

| Component | Location | Current Function |
|-----------|----------|-----------------|
| `UserProductCreator` | `src/pages/UserProductCreator.tsx` | Voice-enabled product creation page |
| `VoiceProductForm` | `src/components/VoiceProductForm.tsx` | Single-model generation form |
| `VoiceConversationEnhanced` | `src/components/VoiceConversationEnhanced.tsx` | Voice input/output |
| `ProductDesigner` | `src/pages/ProductDesigner.tsx` | Konva-based manual design editor |

### Current VoiceProductForm Flow

```
Step 1: Enter prompt → Step 2: Select style → Step 3: DTF settings → Step 4: Generate (single model) → Step 5: Post-actions
```

### Limitations

- Uses single AI model (older `/api/admin/products/ai/create` endpoint)
- No multi-model comparison
- No automatic mockup generation after design selection
- Missing image selection step

---

## Target State

### New User Flow

```
Step 1: Enter prompt
     ↓
Step 2: Select style (optional - can default to "realistic")
     ↓
Step 3: Select product type
     ↓
Step 4: Generate with 3 AI models
     ↓
Step 5: Preview & select design (NEW)
     ↓
Step 6: Automatic mockup generation
     ↓
Step 7: View final product with mockups
     ↓
Step 8: Purchase or share
```

### Key Improvements

1. **Multi-Model Generation**: Users see options from Imagen 4, Flux 1.1, Lucid Origin
2. **Visual Selection UI**: Side-by-side comparison of generated designs
3. **Automatic Mockups**: After selection, flat_lay and mr_imagine mockups auto-generate
4. **Display-Ready Product**: Final product shows 3 images in correct order

---

## Implementation Tasks

### Phase 1: API Integration

#### 1.1 Create User-Facing API Endpoints

Create new routes in `backend/routes/api/user-products.ts`:

```typescript
// Create product with multi-model generation
POST /api/user/products/create
{
  prompt: string
  productType: 't-shirt' | 'hoodie' | 'mug' | etc.
  style?: 'realistic' | 'artistic'
  // models auto-selected based on style
}

// Get generation status with all images
GET /api/user/products/:id/status

// Select design (triggers cleanup + mockup generation)
POST /api/user/products/:id/select-design
{
  assetId: string
}

// Get display-ready assets
GET /api/user/products/:id/display-assets
```

#### 1.2 Modify Existing Admin Endpoints

Option: Expose existing admin endpoints to authenticated users:
- Add user ownership check
- Limit to user's own products
- Reuse existing worker jobs

```typescript
// In backend/routes/admin/ai-products.ts
// Add middleware to allow user access to own products
```

### Phase 2: Frontend Components

#### 2.1 Create `DesignSelectionGallery` Component

New component: `src/components/DesignSelectionGallery.tsx`

```tsx
interface DesignSelectionGalleryProps {
  assets: ProductAsset[]
  onSelect: (assetId: string) => void
  isSelecting: boolean
}

// Features:
// - Grid view of generated images
// - Model name labels (Imagen 4, Flux, Lucid)
// - Click to select with confirmation
// - Loading state while mockups generate
```

#### 2.2 Create `ProductPreviewCard` Component

New component: `src/components/ProductPreviewCard.tsx`

```tsx
interface ProductPreviewCardProps {
  assets: ProductAsset[]  // Already filtered for display
  productName: string
  price: number
}

// Features:
// - Image carousel/gallery
// - Design first, then mockups
// - Zoom capability
// - Share buttons
```

#### 2.3 Update `VoiceProductForm`

Modify to use multi-model pipeline:

```tsx
// New state variables
const [generatedDesigns, setGeneratedDesigns] = useState<ProductAsset[]>([])
const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null)
const [mockupsReady, setMockupsReady] = useState(false)
const [displayAssets, setDisplayAssets] = useState<ProductAsset[]>([])

// New steps
// Step 5: Design selection (between current Step 4 and post-actions)
// Step 6: Mockup generation loading
// Step 7: Final product display
```

### Phase 3: Integration

#### 3.1 Connect to Worker Pipeline

Ensure VoiceProductForm calls correct API:

```typescript
// Current (single model):
POST /api/admin/products/ai/create

// New (multi-model):
POST /api/admin/ai-products  // or new /api/user/products/create
```

#### 3.2 Status Polling Updates

```typescript
// Poll for image generation
const pollForImages = async () => {
  const { data } = await api.get(`/api/admin/ai-products/${productId}/status`)

  // Check if all 3 models completed
  const sourceAssets = data.assets.filter(a => a.kind === 'source' || a.kind === 'dtf')
  const pendingJobs = data.jobs.filter(j => j.status === 'pending' || j.status === 'processing')

  if (sourceAssets.length >= 3 && pendingJobs.length === 0) {
    setGeneratedDesigns(sourceAssets)
    setCurrentStep('selection')
  }
}
```

#### 3.3 Selection Handler

```typescript
const handleDesignSelect = async (assetId: string) => {
  setIsSelecting(true)

  // Call selection endpoint
  await api.post(`/api/admin/ai-products/${productId}/select-image`, {
    assetId
  })

  setSelectedDesignId(assetId)
  setCurrentStep('mockup-generation')

  // Poll for mockups
  pollForMockups()
}
```

#### 3.4 Mockup Polling

```typescript
const pollForMockups = async () => {
  const { data } = await api.get(`/api/admin/ai-products/${productId}/status?display=true`)

  // Check for 3 display assets: design + 2 mockups
  if (data.assets.length >= 3) {
    const hasDesign = data.assets.some(a => a.is_primary)
    const hasFlatLay = data.assets.some(a => a.asset_role === 'mockup_flat_lay')
    const hasMrImagine = data.assets.some(a => a.asset_role === 'mockup_mr_imagine')

    if (hasDesign && hasFlatLay && hasMrImagine) {
      setDisplayAssets(data.assets)
      setMockupsReady(true)
      setCurrentStep('complete')
    }
  }
}
```

### Phase 4: UI/UX Enhancements

#### 4.1 Design Selection Step UI

```tsx
{currentStep === 'selection' && (
  <div className="space-y-6">
    <h2 className="text-2xl font-display text-white text-center">
      Choose Your Favorite Design
    </h2>
    <p className="text-muted text-center">
      Our AI created 3 unique versions. Pick the one you love!
    </p>

    <div className="grid grid-cols-3 gap-4">
      {generatedDesigns.map(design => (
        <button
          key={design.id}
          onClick={() => handleDesignSelect(design.id)}
          className="relative group rounded-xl overflow-hidden border-2 border-transparent hover:border-primary transition-all"
        >
          <img src={design.url} alt={design.metadata?.model} className="w-full aspect-square object-cover" />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
            <span className="text-white text-sm font-medium">
              {getModelLabel(design.metadata?.model)}
            </span>
          </div>
        </button>
      ))}
    </div>
  </div>
)}
```

#### 4.2 Mockup Generation Loading UI

```tsx
{currentStep === 'mockup-generation' && (
  <div className="text-center py-12 space-y-6">
    <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto" />
    <h3 className="text-xl font-display text-white">Creating Product Mockups</h3>
    <p className="text-muted">Placing your design on products...</p>
  </div>
)}
```

#### 4.3 Final Product Display

```tsx
{currentStep === 'complete' && (
  <div className="space-y-6">
    <h2 className="text-2xl font-display text-white text-center">
      Your Product is Ready!
    </h2>

    {/* Main gallery */}
    <div className="bg-card/40 rounded-2xl p-4">
      {/* Primary image (selected design) */}
      <img
        src={displayAssets.find(a => a.is_primary)?.url}
        alt="Your design"
        className="w-full rounded-xl mb-4"
      />

      {/* Mockup thumbnails */}
      <div className="grid grid-cols-2 gap-4">
        {displayAssets.filter(a => a.asset_role?.startsWith('mockup_')).map(mockup => (
          <img
            key={mockup.id}
            src={mockup.url}
            alt={mockup.asset_role}
            className="w-full rounded-lg"
          />
        ))}
      </div>
    </div>

    {/* Action buttons */}
    <div className="grid grid-cols-2 gap-4">
      <button className="btn-secondary">Share Design</button>
      <button className="btn-primary">Add to Cart</button>
    </div>
  </div>
)}
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/components/DesignSelectionGallery.tsx` | Multi-design selection UI |
| `src/components/ProductPreviewCard.tsx` | Final product display with mockups |
| `backend/routes/api/user-products.ts` | (Optional) User-facing API routes |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/VoiceProductForm.tsx` | Add selection step, mockup polling, multi-step flow |
| `src/pages/UserProductCreator.tsx` | Minor updates to support new flow |
| `backend/routes/admin/ai-products.ts` | Add user access if using admin routes |

---

## Testing Plan

### Manual Testing Steps

1. **Multi-Model Generation**
   - Enter prompt in VoiceProductForm
   - Verify 3 images appear from different models
   - Check loading states

2. **Design Selection**
   - Click on a design to select
   - Verify selection API call succeeds
   - Verify non-selected designs are deleted

3. **Mockup Generation**
   - After selection, verify mockup jobs are created
   - Wait for mockups to complete
   - Verify 2 mockups appear (flat_lay, mr_imagine)

4. **Final Display**
   - Verify 3 images show in correct order
   - Verify design is first, then mockups
   - Test image zoom/gallery functionality

### Automated Tests

- API endpoint tests for user product routes
- Component tests for DesignSelectionGallery
- E2E test for full user flow

---

## Timeline Considerations

### Dependencies

- Multi-model worker pipeline (COMPLETE)
- Asset role columns migration (COMPLETE)
- Display filtering API (COMPLETE)

### Blockers

- None identified

### Risks

1. **User Patience**: Multi-model generation takes 30-60 seconds
   - Mitigation: Add engaging loading animations, progress indicators

2. **API Cost**: 3x AI model calls per product
   - Mitigation: Consider premium tier or credit system

3. **Mockup Failures**: If mockup generation fails
   - Mitigation: Show product with design only, offer retry

---

## Success Metrics

- User completes design selection: > 80%
- Products created with all 3 display assets: > 95%
- Time from prompt to final product: < 90 seconds
- User satisfaction with multi-option choice: Survey feedback

---

## Next Steps

1. [ ] Create DesignSelectionGallery component
2. [ ] Update VoiceProductForm with new steps
3. [ ] Add selection and mockup polling logic
4. [ ] Implement final product display
5. [ ] Test end-to-end user flow
6. [ ] Optimize loading states and animations
