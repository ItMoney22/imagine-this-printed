# MockupPreview Component - Quick Start Guide

## Import

```tsx
import MockupPreview from '../components/MockupPreview'
```

## Basic Usage

```tsx
<MockupPreview
  designElements={elements}
  selectedTemplate="shirts"
  itcBalance={100}
/>
```

## Full Example

```tsx
import { useState } from 'react'
import MockupPreview from '../components/MockupPreview'

function ProductDesigner() {
  const [elements, setElements] = useState([
    {
      id: 'text-1',
      type: 'text',
      text: 'Hello World',
      x: 320,
      y: 250,
      fontSize: 24,
      fontFamily: 'Arial',
      fill: '#000000',
      rotation: 0
    }
  ])

  const [selectedTemplate, setSelectedTemplate] = useState('shirts')
  const [itcBalance, setItcBalance] = useState(100)
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGenerateRealistic = async () => {
    setIsGenerating(true)
    try {
      // Call backend API (Task 9)
      const response = await fetch('/api/designer/generate-mockup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          designImageUrl: canvasDataUrl,
          productTemplate: selectedTemplate,
          mockupType: 'flat'
        })
      })
      const data = await response.json()
      // Handle response, deduct ITC
      setItcBalance(prev => prev - 25)
    } catch (error) {
      console.error('Failed to generate mockup:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Canvas Editor */}
      <div>
        {/* Your Konva canvas here */}
      </div>

      {/* Right: Mockup Preview */}
      <MockupPreview
        designElements={elements}
        selectedTemplate={selectedTemplate}
        mockupImage="https://example.com/shirt-mockup.png"
        onGenerateRealistic={handleGenerateRealistic}
        isGenerating={isGenerating}
        itcBalance={itcBalance}
      />
    </div>
  )
}
```

## Props Reference

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| designElements | DesignElement[] | ✅ Yes | - | Array of canvas elements |
| selectedTemplate | 'shirts' \| 'hoodies' \| 'tumblers' | ✅ Yes | - | Product template |
| mockupImage | string | No | undefined | URL to mockup image |
| onGenerateRealistic | () => void | No | undefined | Callback for generate button |
| isGenerating | boolean | No | false | Loading state |
| itcBalance | number | No | 0 | User's ITC balance |

## DesignElement Type

```typescript
interface DesignElement {
  id: string
  type: 'image' | 'text'
  x: number           // Position X in Konva canvas space (0-800)
  y: number           // Position Y in Konva canvas space (0-600)
  rotation: number    // Rotation in degrees (0-360)

  // For images
  src?: string        // Image data URL or HTTP URL
  width?: number      // Image width in pixels
  height?: number     // Image height in pixels

  // For text
  text?: string       // Text content
  fontSize?: number   // Font size in pixels
  fontFamily?: string // Font family name
  fill?: string       // Text color (hex or rgb)
}
```

## Features

✅ Real-time canvas preview
✅ Print area boundaries (purple dashed)
✅ Coordinate mapping (Konva → print area)
✅ Image and text rendering
✅ Rotation support
✅ Generate button with ITC cost
✅ Loading states
✅ Error handling
✅ Responsive design

## Print Area Configuration

Automatically uses configuration from `product-templates.ts`:

```typescript
shirts:   { x: 0.25, y: 0.30, width: 0.50, height: 0.40 }
hoodies:  { x: 0.25, y: 0.25, width: 0.50, height: 0.50 }
tumblers: { x: 0.30, y: 0.20, width: 0.40, height: 0.60 }
```

Coordinates are normalized (0-1) and automatically converted to pixels.

## Styling

Component uses theme-aware Tailwind classes:
- `bg-bg`, `bg-card` - Backgrounds
- `text-text`, `text-muted` - Text colors
- `border-primary/20` - Borders
- `bg-primary` - Buttons
- `hover:shadow-glow` - Hover effects

Works automatically with light/dark mode.

## Common Issues

### Elements not showing
**Problem**: Design elements array is empty or has invalid coordinates
**Solution**: Check that `designElements` prop contains valid data with x, y between 0-800, 0-600

### Print area incorrect
**Problem**: Wrong template selected or template not found
**Solution**: Verify `selectedTemplate` is 'shirts', 'hoodies', or 'tumblers'

### Generate button disabled
**Problem**: Insufficient ITC balance
**Solution**: Ensure `itcBalance >= 25`

### Images not loading
**Problem**: CORS or invalid URL
**Solution**: Use data URLs for local images, check CORS headers for external URLs

## Performance Tips

1. **Debounce updates**: If elements change frequently, consider debouncing
2. **Optimize images**: Use compressed images for better load times
3. **Lazy load mockups**: Load mockup images on demand
4. **Canvas size**: Keep canvas under 1000x1000 for best performance

## Integration with ProductDesigner

See `MOCKUP_PREVIEW_INTEGRATION.md` for complete integration guide.

Quick steps:
1. Import component
2. Create two-panel layout
3. Pass `elements` state to `designElements` prop
4. Implement `handleGenerateRealistic` callback
5. Connect to ITC balance

## Next Steps

After Task 7 (integration):
- Task 9: Implement backend API for realistic generation
- Task 14: Load mockups from database
- Future: Add 3D perspective, shadows, multiple views

## Support

- **Documentation**: See `TASK_6_COMPLETION_REPORT.md`
- **Architecture**: See `MOCKUP_PREVIEW_ARCHITECTURE.md`
- **Testing**: See `MockupPreview.test.md`
- **Integration**: See `MOCKUP_PREVIEW_INTEGRATION.md`

---

**Component Status**: ✅ Production Ready
**Version**: 1.0.0
**Date**: 2025-11-10
