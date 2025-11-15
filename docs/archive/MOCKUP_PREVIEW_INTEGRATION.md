# MockupPreview Component Integration Guide

## Task 6 Implementation Complete

The `MockupPreview` component has been successfully created at:
```
src/components/MockupPreview.tsx
```

## Component Summary

**Purpose**: Display real-time preview of design elements composited onto product mockups using HTML Canvas.

**Key Features**:
- ✅ HTML Canvas composite rendering
- ✅ Mockup image as background with fallback
- ✅ Print area boundary visualization
- ✅ Design element coordinate mapping from Konva to print area
- ✅ Basic perspective transform (2D scaling)
- ✅ Generate Realistic Preview button
- ✅ Loading state management
- ✅ ITC cost display and balance checking
- ✅ Error handling with graceful degradation
- ✅ Responsive design (mobile & desktop)
- ✅ Theme-aware styling

## Props Interface

```typescript
interface MockupPreviewProps {
  designElements: DesignElement[]      // Array of canvas elements
  selectedTemplate: ProductTemplateType // 'shirts' | 'hoodies' | 'tumblers'
  mockupImage?: string                 // URL to mockup base image
  onGenerateRealistic?: () => void     // Callback for realistic generation
  isGenerating?: boolean               // Loading state
  itcBalance?: number                  // User's ITC token balance
}
```

## Integration Steps (Task 7)

To integrate this component into ProductDesigner, follow these steps:

### 1. Import the Component

```typescript
// In src/pages/ProductDesigner.tsx
import MockupPreview from '../components/MockupPreview'
```

### 2. Add State for Realistic Preview

```typescript
const [isGeneratingMockup, setIsGeneratingMockup] = useState(false)
const [realisticPreviewUrl, setRealisticPreviewUrl] = useState<string | null>(null)
```

### 3. Create Handler for Realistic Preview

```typescript
const handleGenerateRealistic = async () => {
  if (userBalance < 25) {
    alert('Insufficient ITC balance. You need 25 ITC to generate a realistic preview.')
    return
  }

  setIsGeneratingMockup(true)
  try {
    // Export current canvas as image
    const canvasDataUrl = stageRef.current.toDataURL()

    // Call backend API (to be implemented in Task 9)
    const response = await fetch('/api/designer/generate-mockup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${/* auth token */}`
      },
      body: JSON.stringify({
        designImageUrl: canvasDataUrl,
        productTemplate: selectedTemplate,
        mockupType: 'flat'
      })
    })

    const data = await response.json()

    if (data.mockupUrl) {
      setRealisticPreviewUrl(data.mockupUrl)
      // Deduct ITC from user balance
      setUserBalance(prev => prev - 25)
      alert('Realistic mockup generated successfully!')
    }
  } catch (error) {
    console.error('Failed to generate mockup:', error)
    alert('Failed to generate realistic mockup. Please try again.')
  } finally {
    setIsGeneratingMockup(false)
  }
}
```

### 4. Update Layout to Two-Panel Design

```typescript
return (
  <div className="min-h-screen bg-bg pt-20">
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-text mb-8">Product Designer</h1>

      {/* Two-Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT PANEL: Konva Canvas Editor */}
        <div className="bg-card rounded-lg border border-primary/20 p-6">
          <h2 className="text-xl font-semibold text-text mb-4">Design Editor</h2>

          {/* Existing Konva Stage */}
          <div className="border-2 border-primary/30 rounded-lg overflow-hidden">
            <Stage
              ref={stageRef}
              width={800}
              height={600}
              onClick={handleStageClick}
            >
              <Layer>
                <Rect
                  x={0}
                  y={0}
                  width={800}
                  height={600}
                  fill={getTemplateBackground().color}
                />
                {/* Render design elements */}
                {elements.map(element => (
                  // ... existing element rendering
                ))}
              </Layer>
            </Stage>
          </div>

          {/* Existing toolbar */}
          <div className="mt-4 space-y-4">
            {/* ... existing controls */}
          </div>
        </div>

        {/* RIGHT PANEL: Mockup Preview */}
        <div className="h-full">
          <MockupPreview
            designElements={elements}
            selectedTemplate={selectedTemplate}
            mockupImage={undefined} // Will be loaded from database in Task 14
            onGenerateRealistic={handleGenerateRealistic}
            isGenerating={isGeneratingMockup}
            itcBalance={userBalance}
          />
        </div>
      </div>
    </div>
  </div>
)
```

### 5. Mobile Responsive Adjustments

The component is already responsive, but ensure the grid layout stacks properly:

```typescript
{/* Mobile: stacked, Desktop: side-by-side */}
<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
```

On mobile (< 1024px), panels will stack vertically:
- Canvas editor (top)
- Mockup preview (bottom)

## Utilities Used

### Product Templates

```typescript
import { PRODUCT_TEMPLATES, printAreaToPixels } from '../utils/product-templates'

// Get print area for selected template
const template = PRODUCT_TEMPLATES[selectedTemplate]
const printArea = printAreaToPixels(
  template.printArea,
  canvasWidth,
  canvasHeight
)
```

### Coordinate Mapping

The component maps Konva canvas coordinates (800x600) to the mockup's print area:

```typescript
const scaleX = printArea.width / 800
const scaleY = printArea.height / 600

const mappedX = printArea.x + element.x * scaleX
const mappedY = printArea.y + element.y * scaleY
```

## Visual Features

### Print Area Boundaries

A purple dashed rectangle shows the print area on the mockup:

```typescript
ctx.strokeStyle = '#8b5cf6'
ctx.lineWidth = 2
ctx.setLineDash([5, 5])
ctx.strokeRect(printArea.x, printArea.y, printArea.width, printArea.height)
```

### Fallback Background

If no mockup image is provided, displays a gradient with template name:

```
┌─────────────────────┐
│                     │
│    T-Shirt Mockup   │
│                     │
│ Upload mockup in    │
│   Admin Panel       │
│                     │
└─────────────────────┘
```

### Loading States

1. **Mockup Loading**: Spinner with "Loading mockup..." message
2. **Generating Preview**: Spinner with "Generating..." in button
3. **Error State**: Red banner with error message

## Error Handling

The component handles these error cases:

1. **Failed Mockup Load**: Shows error banner, falls back to gradient
2. **Failed Design Image Load**: Shows gray placeholder rectangle
3. **Insufficient ITC**: Disables button with tooltip
4. **CORS Issues**: Uses `crossOrigin = 'anonymous'` on images

## Performance Considerations

- Canvas redraws on every `designElements` change (debounce if needed)
- Images are loaded asynchronously (non-blocking)
- Uses `useEffect` to trigger redraws only when dependencies change
- Responsive resize listener cleanup on unmount

## Testing the Component

### Manual Test

1. Open ProductDesigner at `/designer`
2. Add text or image elements
3. Verify they appear in the MockupPreview panel
4. Switch templates (shirt/hoodie/tumbler)
5. Verify print area boundaries adjust
6. Check ITC balance display
7. Click "Generate Realistic Preview"
8. Verify loading state shows
9. Check error handling with insufficient balance

### Automated Test (Future)

```typescript
// Example test cases
describe('MockupPreview', () => {
  it('renders without crashing', () => {})
  it('displays design elements in print area', () => {})
  it('shows loading state during generation', () => {})
  it('disables button when insufficient balance', () => {})
  it('handles mockup load errors gracefully', () => {})
})
```

## Next Steps (Task 7)

1. Modify `src/pages/ProductDesigner.tsx` to use two-panel layout
2. Import and integrate MockupPreview component
3. Pass design elements to MockupPreview for live updates
4. Add visual print area boundaries to Konva canvas (optional)
5. Test responsive behavior on mobile

## Backend Integration (Task 9)

The realistic preview generation requires backend API:

```typescript
POST /api/designer/generate-mockup
{
  "designImageUrl": "data:image/png;base64,...",
  "productTemplate": "shirts",
  "mockupType": "flat"
}

Response:
{
  "mockupUrl": "https://storage.googleapis.com/...",
  "cost": 25,
  "balanceRemaining": 75
}
```

This will be implemented in Task 9 using Replicate Nano Banana.

## Files Created

1. ✅ `src/components/MockupPreview.tsx` - Main component
2. ✅ `src/components/MockupPreview.test.md` - Test documentation
3. ✅ `MOCKUP_PREVIEW_INTEGRATION.md` - This integration guide

## Dependencies

- ✅ React (already installed)
- ✅ TypeScript (already configured)
- ✅ Product Templates utility (Task 5, already exists)
- ⏳ Backend API (Task 9, to be implemented)
- ⏳ Mockup database (Task 1, to be implemented)

## Verification Checklist

- ✅ Component file created
- ✅ Props interface defined with TypeScript
- ✅ Canvas composite logic implemented
- ✅ Print area calculation using `printAreaToPixels`
- ✅ Design element rendering (images and text)
- ✅ Rotation transformation applied
- ✅ Generate Realistic Preview button
- ✅ Loading state UI
- ✅ ITC cost display (25 tokens)
- ✅ Balance checking and button disabling
- ✅ Error handling for image loads
- ✅ Fallback background when no mockup
- ✅ Responsive canvas sizing
- ✅ Theme-aware styling (bg, card, primary, text)
- ✅ CORS handling for images
- ✅ TypeScript types for all props
- ✅ React hooks (useRef, useEffect, useState)
- ✅ Documentation created

## Known Issues

None at this time. Component is ready for integration.

## Support

For questions or issues:
1. Review `MockupPreview.test.md` for detailed feature list
2. Check console logs for debugging information
3. Verify `product-templates.ts` exports are available
4. Ensure theme CSS variables are defined in `index.css`

---

**Status**: ✅ Task 6 Complete - Ready for Task 7 (Two-Panel Layout Integration)
