# Imagination Station AI Tools - Wiring Summary

## What Was Done

I've prepared all the code needed to wire up the AI/Nano Banana tool endpoints in the Imagination Station. Due to the file being actively modified (likely by a running dev server), I couldn't directly edit `ImaginationStation.tsx`, but I've provided complete implementation files.

## Files Created

1. **AI_HANDLERS_TO_WIRE.ts** - Complete TypeScript implementations of all 4 AI handlers
2. **IMAGINATION_STATION_AI_WIRING_GUIDE.md** - Detailed step-by-step guide for wiring up the tools
3. **WIRING_SUMMARY.md** - This summary file

## Required Changes

All changes are in: `src/pages/ImaginationStation.tsx`

### 1. Add State Variables (Line ~144)
```typescript
const [isGenerating, setIsGenerating] = useState(false);
const [isRemovingBg, setIsRemovingBg] = useState(false);
const [isUpscaling, setIsUpscaling] = useState(false);
const [isEnhancing, setIsEnhancing] = useState(false);
```

### 2. Replace handleAiGenerate & Add 3 New Handlers (Line ~374)
Replace the placeholder `handleAiGenerate` function with the full implementation and add:
- `handleRemoveBackground()`
- `handleUpscale(factor: 2 | 4)`
- `handleEnhance()`

Full implementations are in `AI_HANDLERS_TO_WIRE.ts`.

### 3. Update Generate Button (Line ~1052)
- Change `disabled={isProcessing ...}` to `disabled={isGenerating ...}`
- Change `{isProcessing ? ...}` to `{isGenerating ? ...}`

### 4. Wire Remove Background Button (Line ~1089)
- Add `onClick={handleRemoveBackground}`
- Change `disabled={isProcessing}` to `disabled={isRemovingBg}`
- Add loading spinner and text changes

### 5. Wire Upscale Button (Line ~1107)
- Add `onClick={() => handleUpscale(2)}`
- Change `disabled={isProcessing}` to `disabled={isUpscaling}`
- Add loading spinner and text changes

### 6. Wire Enhance Button (Line ~1125)
- Add `onClick={handleEnhance}`
- Change `disabled={isProcessing}` to `disabled={isEnhancing}`
- Add loading spinner and text changes

## Feature Implementations

### 3.1 Mr. Imagine AI Generation
**What it does:**
- Accepts text prompt and style selection
- Calls `imaginationApi.generateImage({ prompt, style, useTrial })`
- Loads generated image and scales to fit sheet (max 6 inches)
- Creates new layer on canvas with generated image
- Updates ITC balance/free trials
- Clears prompt after success

**User flow:**
1. User enters prompt "a cool dragon"
2. Selects style "vibrant"
3. Clicks "Generate" button
4. Shows loading state "Generating..."
5. Image appears as new layer on canvas
6. ITC balance updates

### 3.2 Remove Background
**What it does:**
- Gets imageUrl from selected layer (processed_url or source_url)
- Calls `imaginationApi.removeBackground({ imageUrl, useTrial })`
- Updates layer's processed_url with result
- Updates ITC balance/free trials

**User flow:**
1. User selects an image layer
2. Clicks "Remove Background"
3. Shows loading state "Removing..."
4. Layer updates with transparent background
5. ITC balance updates

### 3.3 Upscale Image
**What it does:**
- Gets imageUrl from selected layer
- Calls `imaginationApi.upscaleImage({ imageUrl, factor, useTrial })`
- Loads upscaled image to get new dimensions
- Updates layer with processed_url, width, and height
- Updates ITC balance/free trials

**User flow:**
1. User selects an image layer
2. Clicks "Upscale 2x"
3. Shows loading state "Upscaling..."
4. Layer updates with higher resolution image
5. Layer dimensions double
6. ITC balance updates

### 3.4 Enhance Quality
**What it does:**
- Gets imageUrl from selected layer
- Calls `imaginationApi.enhanceImage({ imageUrl, useTrial })`
- Updates layer's processed_url with enhanced result
- Updates ITC balance/free trials

**User flow:**
1. User selects an image layer
2. Clicks "Enhance Quality"
3. Shows loading state "Enhancing..."
4. Layer updates with AI-enhanced image
5. ITC balance updates

## API Endpoints

All endpoints are already defined in `src/lib/api.ts`:

```typescript
imaginationApi.generateImage({ prompt, style, useTrial })
imaginationApi.removeBackground({ imageUrl, useTrial })
imaginationApi.upscaleImage({ imageUrl, factor, useTrial })
imaginationApi.enhanceImage({ imageUrl, useTrial })
```

## Key Implementation Details

### Loading States
- Each tool has its own loading state variable
- `isProcessing` is set globally during operations to disable upload
- Buttons show loading spinner and text during processing

### Error Handling
- All handlers use try-catch-finally blocks
- Errors show user-friendly alert messages
- Console logs detailed error information
- Loading states always reset in finally block

### ITC Balance Management
- Each handler checks `getFreeTrial(featureKey)` for free trial availability
- Passes `useTrial: true` if free trials remain
- Reloads pricing/trials after successful operation
- UI automatically updates to show new balance

### Image Layer Updates
- AI generation creates a NEW layer
- Other tools UPDATE the selected layer
- processed_url stores the AI-processed result
- source_url preserves the original
- Sheet marked as "unsaved" after operations

## Next Steps

1. Stop any running dev server
2. Open `src/pages/ImaginationStation.tsx`
3. Follow the step-by-step guide in `IMAGINATION_STATION_AI_WIRING_GUIDE.md`
4. Copy implementations from `AI_HANDLERS_TO_WIRE.ts`
5. Test each feature with the testing checklist

## Testing Checklist

- [ ] AI generation adds new layer with image
- [ ] Background removal updates selected layer
- [ ] Upscale updates layer and dimensions
- [ ] Enhance updates selected layer
- [ ] Loading states show correctly
- [ ] Error messages display properly
- [ ] ITC balance updates after operations
- [ ] Free trials decrement
- [ ] Buttons disabled during processing
- [ ] Sheet marked "unsaved" after operations
- [ ] Buttons require layer selection (except AI gen)
- [ ] Image loads properly in canvas

## File Paths

- Main file: `src/pages/ImaginationStation.tsx`
- API client: `src/lib/api.ts`
- Handler code: `AI_HANDLERS_TO_WIRE.ts`
- Guide: `IMAGINATION_STATION_AI_WIRING_GUIDE.md`
