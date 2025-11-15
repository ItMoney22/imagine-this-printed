# Mockup Generation & Image Tools Requirements

**Date:** 2025-11-12
**Status:** 🔄 In Progress

## Requirements Summary

### 1. Mockup Generation System
- **Model:** Must use Nano Banana (Google Gemini 2.5 Flash) for virtual try-on
- **Save Location:** Temp folder initially
- **User Acceptance Flow:**
  - User generates mockup (costs 25 ITC)
  - Mockup saved to temp folder
  - User can accept or reject
  - If accepted → moves to permanent mockups folder
  - If rejected → deleted from temp, ITC refunded
- **User Profile:** Accepted mockups show up under user's mockups in profile

### 2. Image Generation Tool
- **Purpose:** Allow users to generate images if they don't have one to upload
- **Model:** Use Google image generation (likely Imagen or Gemini)
- **Location:** Add to "Image Tools" section in Design Studio
- **Flow:**
  - User clicks "Generate Image" button
  - Enters prompt
  - Image generates
  - Can use generated image in design

## Current Issues

### Issue 1: Mockup Generation Failing
**Error:** `HTTP 400: {"ok":false,"error":"Missing required fields: designImageUrl, productTemplate, modelDescription"}`

**Root Cause:** Frontend not sending required fields

**Required Fields:**
```typescript
{
  designImageUrl: string,        // data URL or HTTP URL of the design
  designElements: any[],          // Konva canvas elements
  productTemplate: 'shirts' | 'hoodies' | 'tumblers',
  modelDescription: {
    garmentColor: string,
    shirtType?: string,
    gender: string,
    ethnicity: string,
    bodyType: string
  }
}
```

### Issue 2: Model Selection
**Current:** Using `yisol/idm-vton` (specialized virtual try-on model)
**Requested:** Use Nano Banana (google/nano-banana)

**Nano Banana Details:**
- Model ID: `google/nano-banana`
- Type: Gemini 2.5 Flash Image (multimodal image editing)
- Capabilities: General image editing with multi-image support
- Virtual Try-On: Can handle it but not specialized like IDM-VTON

**Note:** Nano Banana is NOT a specialized virtual try-on model. It's a general image editing model. For best virtual try-on results, IDM-VTON is recommended, but we can adapt Nano Banana if required.

## Implementation Plan

### Task 1: Fix Frontend Integration ✅
**File:** `src/components/DesignStudioModal.tsx` or `src/components/RealisticMockupGenerator.tsx`

**Changes Needed:**
1. Add form to collect model customization data:
   - Product template selector (shirts/hoodies/tumblers)
   - Garment color picker
   - Shirt type dropdown (crew neck, v-neck, etc.)
   - Model gender selector
   - Model ethnicity selector
   - Model body type selector

2. Pass all required fields to API:
```typescript
const response = await fetch('/api/realistic-mockups/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    designImageUrl: canvasDataUrl,
    designElements: stage.toJSON(),
    productTemplate: selectedTemplate,
    modelDescription: {
      garmentColor: selectedColor,
      shirtType: selectedShirtType,
      gender: selectedGender,
      ethnicity: selectedEthnicity,
      bodyType: selectedBodyType
    }
  })
})
```

### Task 2: Switch to Nano Banana Model
**File:** `backend/routes/realistic-mockups.ts`

**Status:** ✅ Partially done (now uses `REPLICATE_TRYON_MODEL_ID` env variable)

**Additional Changes Needed:**
Since Nano Banana has a different API than IDM-VTON, we need to:

1. Update API call to use Nano Banana's format:
```typescript
const output = await replicate.run("google/nano-banana", {
  input: {
    prompt: `A ${modelDescription.gender} model wearing a ${modelDescription.garmentColor} ${garmentDescription}`,
    image_input: [modelPhotoUrl, designUrl], // Array of images
    output_format: "png"
  }
})
```

2. The current format uses IDM-VTON's parameters:
```typescript
{
  garm_img: designUrl,
  human_img: modelPhotoUrl,
  garment_des: garmentDescription,
  is_checked: true,
  is_checked_crop: false,
  denoise_steps: 30,
  seed: 42
}
```

These are incompatible. Need to choose ONE model and stick with it.

### Task 3: Implement Temp Folder System
**File:** `backend/routes/realistic-mockups.ts`

**Changes:**
1. Change upload folder from 'mockups' to 'temp':
```typescript
const uploadResult = await gcsStorage.uploadFile(buffer, {
  userId,
  folder: 'temp',  // Changed from 'mockups'
  filename: `mockup_${generationId}.png`,
  contentType: 'image/png'
})
```

2. Add accept/reject endpoints:
```typescript
// POST /api/realistic-mockups/:id/accept
router.post('/:id/accept', requireAuth, async (req, res) => {
  // 1. Get mockup from temp folder
  // 2. Move to permanent mockups folder
  // 3. Update database status to 'accepted'
  // 4. Add to user_mockups table for profile display
})

// POST /api/realistic-mockups/:id/reject
router.post('/:id/reject', requireAuth, async (req, res) => {
  // 1. Delete from temp folder
  // 2. Refund 25 ITC to user
  // 3. Update database status to 'rejected'
})
```

### Task 4: Add Image Generation Tool
**New File:** `backend/routes/image-generation.ts`

**Implementation:**
```typescript
import { Router } from 'express'
import { requireAuth } from '../middleware/supabaseAuth'
import Replicate from 'replicate'

const router = Router()

// POST /api/image-generation/generate
router.post('/generate', requireAuth, async (req, res) => {
  const { prompt } = req.body
  const userId = req.user.sub

  // Use Google's image generation model
  const output = await replicate.run("google/imagen-3", {
    input: {
      prompt,
      aspect_ratio: "1:1",
      output_format: "png"
    }
  })

  // Upload to GCS temp folder
  const uploadResult = await uploadFile(buffer, {
    userId,
    folder: 'temp',
    filename: `generated_${Date.now()}.png`
  })

  res.json({
    ok: true,
    imageUrl: uploadResult.publicUrl
  })
})

export default router
```

**Frontend Component:** `src/components/ImageGenerationTool.tsx`
```typescript
function ImageGenerationTool({ onImageGenerated }) {
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    const response = await fetch('/api/image-generation/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ prompt })
    })
    const data = await response.json()
    onImageGenerated(data.imageUrl)
    setGenerating(false)
  }

  return (
    <div>
      <input
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Describe the image you want to generate..."
      />
      <button onClick={handleGenerate} disabled={generating}>
        {generating ? 'Generating...' : 'Generate Image'}
      </button>
    </div>
  )
}
```

### Task 5: Display Mockups in User Profile
**File:** `src/pages/UserProfile.tsx`

**Changes:**
1. Fetch user's accepted mockups from database
2. Display in a grid under "My Mockups" section
3. Allow download/share/delete actions

## Decision Needed

**CRITICAL:** Which model should we use for virtual try-on?

**Option A: Keep IDM-VTON (yisol/idm-vton)** ✅ Recommended
- Pros: Specialized for virtual try-on, better results
- Cons: Not Nano Banana as requested

**Option B: Switch to Nano Banana (google/nano-banana)**
- Pros: As requested, faster, newer technology
- Cons: Not specialized for virtual try-on, may have inferior results, requires API changes

**Recommendation:** Use IDM-VTON for mockups, but add Nano Banana as the image generation tool. This gives you:
- Best virtual try-on results (IDM-VTON)
- Fast image generation (Nano Banana for the "Generate Image" tool)

## Next Steps

1. **Decide on model** (IDM-VTON vs Nano Banana for try-on)
2. **Fix frontend** to send required fields
3. **Implement temp folder** system with accept/reject
4. **Add image generation** tool with Nano Banana
5. **Update user profile** to show mockups

## Files to Modify

### Backend:
- `backend/routes/realistic-mockups.ts` - Model selection, temp folder, accept/reject endpoints
- `backend/routes/image-generation.ts` - NEW FILE for image generation
- `backend/index.ts` - Register image-generation route

### Frontend:
- `src/components/DesignStudioModal.tsx` - Add model customization form
- `src/components/ImageGenerationTool.tsx` - NEW FILE for image generation
- `src/pages/UserProfile.tsx` - Display user mockups

### Database:
- `user_mockups` table - Link mockups to user profiles (may need to create)

## Cost Breakdown

- **Mockup Generation:** 25 ITC (refundable if rejected)
- **Image Generation:** TBD (suggest 10-15 ITC)
- **Background Removal:** 10 ITC (already implemented with Remove.bg)
