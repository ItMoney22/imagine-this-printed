# Imagination Station - AI Tool Wiring Guide

This guide explains how to wire up the AI/Nano Banana tool endpoints in the Imagination Station.

## Overview

We need to wire up 4 AI features:
1. **Mr. Imagine AI Generation (3.1)**: Generate images from text prompts
2. **Remove Background (3.2)**: Remove background from selected image layer
3. **Upscale (3.3)**: Upscale image 2x or 4x
4. **Enhance Quality (3.4)**: AI-enhance image quality

## Files to Modify

### 1. src/pages/ImaginationStation.tsx

#### Step 1: Add Processing State Variables

Around line 144, add these new state variables for individual tool processing states:

```typescript
// AI Panel state
const [aiPrompt, setAiPrompt] = useState('');
const [aiStyle, setAiStyle] = useState('vibrant');

// Processing states for individual tools
const [isGenerating, setIsGenerating] = useState(false);
const [isRemovingBg, setIsRemovingBg] = useState(false);
const [isUpscaling, setIsUpscaling] = useState(false);
const [isEnhancing, setIsEnhancing] = useState(false);
```

#### Step 2: Replace AI Handler Functions

Around line 374, replace the placeholder `handleAiGenerate` function and add the three new handler functions.

**REPLACE THIS:**
```typescript
// AI Generation (placeholder)
const handleAiGenerate = async () => {
  if (!aiPrompt.trim()) return;
  setIsProcessing(true);
  try {
    // TODO: Call actual AI generation API
    alert(`AI Generation coming soon!\n\nPrompt: ${aiPrompt}\nStyle: ${aiStyle}`);
  } finally {
    setIsProcessing(false);
  }
};
```

**WITH THE 4 HANDLER FUNCTIONS** (see AI_HANDLERS_TO_WIRE.ts for full code):
- `handleAiGenerate` - AI image generation
- `handleRemoveBackground` - Background removal
- `handleUpscale` - Image upscaling
- `handleEnhance` - Quality enhancement

#### Step 3: Update AI Panel Generate Button

Around line 1052-1067, update the Generate button:

**Change the disabled condition:**
```typescript
// FROM:
disabled={isProcessing || !aiPrompt.trim()}

// TO:
disabled={isGenerating || !aiPrompt.trim()}
```

**Change the loading state check:**
```typescript
// FROM:
{isProcessing ? (
  <>
    <Loader2 className="w-4 h-4 animate-spin" />
    Generating...
  </>
) : (
  <>
    <Sparkles className="w-4 h-4" />
    Generate ({getFreeTrial('generate') > 0 ? 'Free' : `${getFeaturePrice('generate')} ITC`})
  </>
)}

// TO:
{isGenerating ? (
  <>
    <Loader2 className="w-4 h-4 animate-spin" />
    Generating...
  </>
) : (
  <>
    <Sparkles className="w-4 h-4" />
    Generate ({getFreeTrial('generate') > 0 ? 'Free' : `${getFeaturePrice('generate')} ITC`})
  </>
)}
```

#### Step 4: Wire Remove Background Button

Around line 1089-1105, update the Remove Background button:

**Change from:**
```typescript
<button
  disabled={isProcessing}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      <ImageIcon className="w-4 h-4 text-amber-600" />
    </div>
    <div>
      <div className="font-medium text-stone-800">Remove Background</div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('bg_remove') > 0 ? `${getFreeTrial('bg_remove')} free` : `${getFeaturePrice('bg_remove')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>
```

**To:**
```typescript
<button
  onClick={handleRemoveBackground}
  disabled={isRemovingBg}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      {isRemovingBg ? (
        <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
      ) : (
        <ImageIcon className="w-4 h-4 text-amber-600" />
      )}
    </div>
    <div>
      <div className="font-medium text-stone-800">
        {isRemovingBg ? 'Removing...' : 'Remove Background'}
      </div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('bg_remove') > 0 ? `${getFreeTrial('bg_remove')} free` : `${getFeaturePrice('bg_remove')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>
```

#### Step 5: Wire Upscale Button

Around line 1107-1123, update the Upscale button:

**Change from:**
```typescript
<button
  disabled={isProcessing}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      <Maximize2 className="w-4 h-4 text-amber-600" />
    </div>
    <div>
      <div className="font-medium text-stone-800">Upscale 2x</div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('upscale_2x') > 0 ? `${getFreeTrial('upscale_2x')} free` : `${getFeaturePrice('upscale_2x')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>
```

**To:**
```typescript
<button
  onClick={() => handleUpscale(2)}
  disabled={isUpscaling}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      {isUpscaling ? (
        <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
      ) : (
        <Maximize2 className="w-4 h-4 text-amber-600" />
      )}
    </div>
    <div>
      <div className="font-medium text-stone-800">
        {isUpscaling ? 'Upscaling...' : 'Upscale 2x'}
      </div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('upscale_2x') > 0 ? `${getFreeTrial('upscale_2x')} free` : `${getFeaturePrice('upscale_2x')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>
```

#### Step 6: Wire Enhance Quality Button

Around line 1125-1141, update the Enhance Quality button:

**Change from:**
```typescript
<button
  disabled={isProcessing}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      <Sparkles className="w-4 h-4 text-amber-600" />
    </div>
    <div>
      <div className="font-medium text-stone-800">Enhance Quality</div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('enhance') > 0 ? `${getFreeTrial('enhance')} free` : `${getFeaturePrice('enhance')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>
```

**To:**
```typescript
<button
  onClick={handleEnhance}
  disabled={isEnhancing}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      {isEnhancing ? (
        <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
      ) : (
        <Sparkles className="w-4 h-4 text-amber-600" />
      )}
    </div>
    <div>
      <div className="font-medium text-stone-800">
        {isEnhancing ? 'Enhancing...' : 'Enhance Quality'}
      </div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('enhance') > 0 ? `${getFreeTrial('enhance')} free` : `${getFeaturePrice('enhance')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>
```

## How Each Feature Works

### 1. Mr. Imagine AI Generation
- User enters a text prompt and selects a style
- Clicks "Generate" button
- Backend calls AI API to generate image
- ITC is deducted (or uses free trial)
- Generated image is added as a new layer on the canvas
- Prompt is cleared after successful generation

### 2. Remove Background
- User selects an image layer
- Clicks "Remove Background" button
- Backend sends image to AI background removal API
- Processed image (with transparent background) replaces the layer
- ITC is deducted (or uses free trial)

### 3. Upscale Image
- User selects an image layer
- Clicks "Upscale 2x" button (can also support 4x)
- Backend sends image to AI upscaling API
- Upscaled image replaces the layer
- Layer dimensions are updated to match the upscaled size
- ITC is deducted (or uses free trial)

### 4. Enhance Quality
- User selects an image layer
- Clicks "Enhance Quality" button
- Backend sends image to AI enhancement API
- Enhanced image replaces the layer
- ITC is deducted (or uses free trial)

## API Endpoints Used

All endpoints are defined in `src/lib/api.ts` under `imaginationApi`:

- `generateImage({ prompt, style, useTrial })` → POST /api/imagination-station/ai/generate
- `removeBackground({ imageUrl, useTrial })` → POST /api/imagination-station/ai/remove-bg
- `upscaleImage({ imageUrl, factor, useTrial })` → POST /api/imagination-station/ai/upscale
- `enhanceImage({ imageUrl, useTrial })` → POST /api/imagination-station/ai/enhance

## Error Handling

Each handler includes:
- Try-catch blocks with user-friendly error alerts
- Console logging for debugging
- Proper cleanup in finally blocks
- Loading state management

## ITC Balance Updates

After each successful operation, the handlers reload pricing and free trial data:

```typescript
const { data: pricingData } = await imaginationApi.getPricing();
setPricing(pricingData?.pricing || []);
setFreeTrials(pricingData?.freeTrials || []);
```

This ensures the UI always shows the updated ITC balance and remaining free trials.

## Testing Checklist

- [ ] AI generation creates new layer with generated image
- [ ] Background removal updates the selected layer
- [ ] Upscale updates layer dimensions correctly
- [ ] Enhance updates the selected layer
- [ ] Loading states show during processing
- [ ] Error messages display for failures
- [ ] ITC balance updates after operations
- [ ] Free trials decrement correctly
- [ ] Buttons are disabled during processing
- [ ] Sheet is marked as "unsaved" after operations

## Reference Files

- **AI_HANDLERS_TO_WIRE.ts** - Complete handler implementations and UI changes
- **src/lib/api.ts** - API endpoint definitions
- **src/pages/ImaginationStation.tsx** - Main file to modify

## Notes

- The file may be auto-updated by a linter or dev server, so make changes when the dev server is stopped
- All AI tools require an image layer to be selected except for AI generation
- The `isProcessing` global state is still used to disable the Upload button during any AI operation
- Each tool has its own specific loading state (isGenerating, isRemovingBg, etc.)
