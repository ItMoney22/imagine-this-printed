# AI Product Builder Pipeline - Reference Documentation

**Last Updated**: 2025-12-09
**Status**: Production Ready

This document captures the complete, tested AI Product Builder pipeline that transforms a text prompt into a finished product with optimized design and mockups.

---

## Pipeline Overview

```
User Prompt → 3 AI Models Generate Images → DTF Optimization → User Selection → Mockup Generation → Final Product
```

### Pipeline Steps

| Step | Component | Description |
|------|-----------|-------------|
| 1 | Multi-Model Generation | 3 AI models generate design images from prompt |
| 2 | DTF Optimization | Each design is optimized for printing |
| 3 | User Selection | User chooses their preferred design |
| 4 | Asset Cleanup | Non-selected designs are deleted |
| 5 | Mockup Generation | 2 mockups created from selected design |
| 6 | Final Display | Product shows: Design + Flat Lay + Mr. Imagine |

---

## Step 1: Multi-Model Image Generation

**Job Type**: `replicate` (for Flux, Lucid) and `google_imagen` (for Imagen)

### AI Models Used

1. **Google Imagen 4 Ultra** (`imagen-4.0-ultra-generate-001`)
   - Provider: Google Vertex AI
   - Best for: Photorealistic product imagery

2. **Flux 1.1 Pro Ultra** (`black-forest-labs/flux-1.1-pro-ultra`)
   - Provider: Replicate
   - Best for: High-quality artistic designs

3. **Lucid Origin** (`lucidsimulation/lucid-origin`)
   - Provider: Replicate
   - Best for: Creative interpretations

### API Endpoint

```typescript
POST /api/admin/ai-products
{
  "name": "Product Name",
  "prompt": "Design description",
  "productType": "t-shirt" | "mug" | "poster" | etc.,
  "category": "Category Name",
  "price": 29.99
}
```

### Worker Processing

The worker creates one job per model, all running in parallel:

```typescript
// Job creation in backend/routes/admin/ai-products.ts
for (const model of selectedModels) {
  await supabase.from('ai_jobs').insert({
    type: model === 'google_imagen' ? 'google_imagen' : 'replicate',
    status: 'pending',
    input: {
      product_id: product.id,
      prompt: systemPrompt,
      model: modelMap[model].model,
      // ... model-specific params
    }
  })
}
```

### Asset Creation

Each generated image is stored with explicit tracking fields:

```typescript
// In backend/worker/ai-jobs-worker.ts
await supabase.from('product_assets').insert({
  product_id: productId,
  kind: 'source',
  url: publicUrl,
  asset_role: 'design',
  is_primary: false,
  display_order: 99,
  metadata: {
    model: modelName,
    prompt: originalPrompt,
    // ... other metadata
  }
})
```

---

## Step 2: DTF Optimization

**Job Type**: `dtf_optimization`

After each AI model generates an image, a DTF optimization job is automatically queued.

### What DTF Optimization Does

- Analyzes the image for print viability
- Adjusts colors for DTF (Direct-to-Film) printing
- Optimizes contrast and saturation
- Ensures transparent backgrounds where appropriate

### Worker Implementation

```typescript
// DTF job processing in ai-jobs-worker.ts
if (job.type === 'dtf_optimization') {
  const optimizedUrl = await dtfOptimizer.optimize(inputUrl)

  await supabase.from('product_assets').insert({
    product_id: productId,
    kind: 'dtf',
    url: optimizedUrl,
    asset_role: 'design',
    is_primary: false,
    display_order: 99,
    metadata: {
      source_asset_id: sourceAssetId,
      optimization_applied: true
    }
  })
}
```

---

## Step 3: User Selection

**API Endpoint**: `POST /api/admin/ai-products/:id/select-image`

User reviews all generated images and selects their preferred design.

### Selection Process

```typescript
// Request body
{
  "assetId": "uuid-of-selected-asset"
}

// What happens:
// 1. Selected asset marked as primary
// 2. Non-selected source/dtf assets deleted
// 3. Mockup generation jobs queued
```

### Asset Updates on Selection

```typescript
// Mark selected asset as primary
await supabase.from('product_assets').update({
  is_primary: true,
  asset_role: 'design',
  display_order: 1,
  metadata: {
    ...selectedAsset.metadata,
    is_selected: true,
    selected_at: new Date().toISOString()
  }
}).eq('id', selectedAssetId)

// Delete non-selected assets
await supabase.from('product_assets')
  .delete()
  .eq('product_id', productId)
  .in('kind', ['source', 'dtf'])
  .neq('id', selectedAssetId)
```

---

## Step 4: Mockup Generation

**Job Types**: `gemini_mockup` (x2)

Two mockup jobs are created automatically after image selection:

### Mockup Templates

1. **flat_lay** - Product displayed flat on surface
   - Template: `templates/flat_lay_tshirt.jpg`
   - Display Order: 2

2. **mr_imagine** - Character wearing/holding product
   - Template: `templates/mr_imagine_tshirt.jpg`
   - Display Order: 3

### Mockup Generation Flow

```typescript
// Queue mockup jobs after selection
const mockupTemplates = ['flat_lay', 'mr_imagine']

for (const template of mockupTemplates) {
  await supabase.from('ai_jobs').insert({
    type: 'gemini_mockup',
    status: 'pending',
    input: {
      product_id: productId,
      design_url: selectedAsset.url,
      template: template,
      product_type: product.product_type
    }
  })
}
```

### Worker Mockup Processing

```typescript
// In ai-jobs-worker.ts
if (job.type === 'gemini_mockup') {
  const { template, design_url, garment_url } = job.input

  const mockupUrl = await geminiMockupService.generate({
    designImage: design_url,
    garmentImage: garment_url,
    template: template
  })

  // Determine asset_role and display_order
  const assetRole = template === 'flat_lay' ? 'mockup_flat_lay' :
                    template === 'mr_imagine' ? 'mockup_mr_imagine' :
                    'mockup_flat_lay'
  const displayOrder = template === 'flat_lay' ? 2 :
                       template === 'mr_imagine' ? 3 : 2

  await supabase.from('product_assets').insert({
    product_id: productId,
    kind: 'mockup',
    url: mockupUrl,
    asset_role: assetRole,
    is_primary: false,
    display_order: displayOrder,
    metadata: {
      template: template,
      design_asset_id: designAssetId
    }
  })
}
```

---

## Step 5: Final Display

### Asset Schema

```typescript
interface ProductAsset {
  id: string
  product_id: string
  kind: 'source' | 'dtf' | 'mockup' | 'nobg' | 'upscaled'
  url: string
  asset_role: 'design' | 'mockup_flat_lay' | 'mockup_mr_imagine' | 'auxiliary'
  is_primary: boolean
  display_order: number
  metadata: Record<string, any>
  created_at: string
}
```

### Display Order Convention

| Order | Asset Role | Description |
|-------|------------|-------------|
| 1 | design | User's selected design (is_primary=true) |
| 2 | mockup_flat_lay | Flat lay mockup |
| 3 | mockup_mr_imagine | Mr. Imagine mockup |
| 99 | auxiliary | Hidden assets (nobg, upscaled) |

### Filtering for Display

```typescript
// Get display-ready assets
const displayAssets = productAssets
  .filter(a => a.is_primary || a.asset_role?.startsWith('mockup_'))
  .sort((a, b) => (a.display_order || 99) - (b.display_order || 99))
```

### API Query for Display

```typescript
// Status endpoint with display filter
GET /api/admin/ai-products/:id/status?display=true

// Returns only:
// - Assets where is_primary = true
// - Assets where asset_role LIKE 'mockup_%'
// Ordered by display_order ascending
```

---

## Database Schema

### product_assets Table Columns

```sql
-- Core columns
id UUID PRIMARY KEY
product_id UUID REFERENCES products(id)
kind TEXT -- 'source', 'dtf', 'mockup', 'nobg', 'upscaled'
url TEXT
metadata JSONB

-- Role tracking columns (added 2025-12-09)
asset_role TEXT -- 'design', 'mockup_flat_lay', 'mockup_mr_imagine', 'auxiliary'
is_primary BOOLEAN DEFAULT false
display_order INTEGER DEFAULT 99
```

### Indexes

```sql
CREATE INDEX idx_product_assets_asset_role ON product_assets(asset_role);
CREATE INDEX idx_product_assets_is_primary ON product_assets(is_primary) WHERE is_primary = true;
CREATE INDEX idx_product_assets_display_order ON product_assets(display_order);
CREATE INDEX idx_product_assets_display ON product_assets(product_id, is_primary, asset_role, display_order);
```

---

## Running the Pipeline

### Required Services

1. **Frontend Dev Server**: `npm run dev` (port 5173)
2. **Backend API Server**: `cd backend && npm run dev` (port 4000)
3. **Worker Process**: `cd backend && npm run worker:dev`

### Environment Variables Required

```env
# Backend (.env)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
DATABASE_URL=postgres://...
REPLICATE_API_TOKEN=xxx
GOOGLE_CLOUD_PROJECT_ID=xxx
GOOGLE_APPLICATION_CREDENTIALS=./path/to/credentials.json
GEMINI_API_KEY=xxx
```

### Testing the Pipeline

1. Navigate to Admin Dashboard → AI Products
2. Click "Create AI Product"
3. Enter product details and prompt
4. Wait for 3 AI models to generate images (~30-60 seconds)
5. Select preferred design
6. Wait for mockups to generate (~15-30 seconds)
7. View final product with 3 display images

---

## Integration with Frontend Design Center

To reuse this pipeline in a customer-facing design center:

### Key Components to Expose

1. **Prompt Input**: User enters design description
2. **Model Selection**: Optional - let users choose AI models
3. **Image Gallery**: Display generated options
4. **Selection UI**: User picks preferred design
5. **Mockup Preview**: Show final product mockups

### API Endpoints for Design Center

```typescript
// Create product with AI generation
POST /api/products/ai-generate
{
  prompt: string
  productType: string
  // Optional: selectedModels: string[]
}

// Get generation status
GET /api/products/:id/generation-status

// Select design
POST /api/products/:id/select-design
{
  assetId: string
}

// Get final display assets
GET /api/products/:id/assets?display=true
```

### Frontend Flow

```tsx
// 1. Submit design request
const { productId } = await api.post('/products/ai-generate', { prompt, productType })

// 2. Poll for generation status
const poll = setInterval(async () => {
  const { status, assets } = await api.get(`/products/${productId}/generation-status`)
  if (status === 'images_ready') {
    setGeneratedImages(assets)
    clearInterval(poll)
  }
}, 3000)

// 3. User selects design
await api.post(`/products/${productId}/select-design`, { assetId: selectedId })

// 4. Poll for mockups
const mockupPoll = setInterval(async () => {
  const { assets } = await api.get(`/products/${productId}/assets?display=true`)
  if (assets.length === 3) { // design + 2 mockups
    setFinalProduct(assets)
    clearInterval(mockupPoll)
  }
}, 3000)
```

---

## Troubleshooting

### Common Issues

1. **Images not generating**
   - Check worker is running: `npm run worker:dev`
   - Check Replicate API token is valid
   - Check Google credentials are configured

2. **Mockups not generating**
   - Verify image selection was successful
   - Check Gemini API key is valid
   - Review worker logs for errors

3. **Wrong images showing in display**
   - Verify `is_primary` and `asset_role` are set correctly
   - Check `display_order` values
   - Ensure filtering query uses correct fields

### Debug Queries

```sql
-- Check all assets for a product
SELECT id, kind, asset_role, is_primary, display_order, url
FROM product_assets
WHERE product_id = 'your-product-id'
ORDER BY display_order;

-- Check pending jobs
SELECT id, type, status, created_at
FROM ai_jobs
WHERE status = 'pending'
ORDER BY created_at;
```

---

## Version History

| Date | Change |
|------|--------|
| 2025-12-09 | Added asset_role, is_primary, display_order columns |
| 2025-12-09 | Implemented 3-model parallel generation |
| 2025-12-09 | Added DTF optimization step |
| 2025-12-09 | Integrated Mr. Imagine mockup template |
