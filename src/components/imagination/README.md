# Imagination Station Components

This directory contains all the components for the Imagination Station DTF design tool.

## Left Sidebar Components

### LeftSidebar
Main container for the left sidebar with all design tools and controls.

**Props:**
- `sheet: Sheet` - Current sheet configuration (print type, dimensions)
- `layers: Layer[]` - Array of all layers in the design
- `setLayers: (layers: Layer[]) => void` - Function to update layers
- `pricing: Pricing` - Pricing information for the design
- `freeTrials: FreeTrials` - Remaining free trials for AI tools
- `itcBalance: number` - User's ITC token balance
- `isProcessing: boolean` - Whether a process is currently running
- `setIsProcessing: (processing: boolean) => void` - Function to update processing state
- `onLayerAdded: (layer: Layer) => void` - Callback when a new layer is added
- `onSheetChange?: (sheet: Sheet) => void` - Optional callback when sheet settings change
- `saveStatus?: 'saved' | 'saving' | 'unsaved' | 'offline' | 'error'` - Current save status
- `lastSaved?: Date` - When the design was last saved

### SheetPresets
Displays and allows changing print type and sheet dimensions.

**Props:**
- `sheet: Sheet` - Current sheet configuration
- `onSheetChange?: (sheet: Sheet) => void` - Optional callback when sheet changes

### LayersPanel
Manages all layers with drag-to-reorder, visibility toggle, and delete functionality.

**Props:**
- `layers: Layer[]` - Array of all layers
- `setLayers: (layers: Layer[]) => void` - Function to update layers
- `selectedLayerId?: string` - ID of currently selected layer
- `onLayerSelect?: (layerId: string) => void` - Callback when a layer is selected

### SaveStatus
Shows the current save status with visual indicators.

**Props:**
- `status: 'saved' | 'saving' | 'unsaved' | 'offline' | 'error'` - Current status
- `lastSaved?: Date` - When last saved (shows "Saved X ago" text)

### ITCBalance
Displays user's ITC balance with "Add ITC" button and pricing info.

**Props:**
- `balance: number` - Current ITC balance

## Usage Example

```tsx
import React, { useState } from 'react'
import { LeftSidebar, Layer, Sheet, Pricing, FreeTrials } from '@/components/imagination'

export default function ImaginationStation() {
  const [sheet, setSheet] = useState<Sheet>({
    printType: 'DTF',
    width: 13,
    height: 16,
    unit: 'in'
  })

  const [layers, setLayers] = useState<Layer[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [lastSaved, setLastSaved] = useState(new Date())

  const pricing: Pricing = {
    basePrice: 5.00,
    perSquareInch: 0.15,
    setupFee: 2.00
  }

  const freeTrials: FreeTrials = {
    mrImagine: 3,
    itpEnhance: 5
  }

  const handleLayerAdded = (layer: Layer) => {
    setLayers([...layers, layer])
    setSaveStatus('unsaved')
  }

  const handleSheetChange = (newSheet: Sheet) => {
    setSheet(newSheet)
    setSaveStatus('unsaved')
  }

  return (
    <div className="flex h-screen">
      <LeftSidebar
        sheet={sheet}
        layers={layers}
        setLayers={setLayers}
        pricing={pricing}
        freeTrials={freeTrials}
        itcBalance={150.50}
        isProcessing={isProcessing}
        setIsProcessing={setIsProcessing}
        onLayerAdded={handleLayerAdded}
        onSheetChange={handleSheetChange}
        saveStatus={saveStatus}
        lastSaved={lastSaved}
      />

      {/* Main canvas area */}
      <div className="flex-1 bg-bg">
        {/* Your canvas component here */}
      </div>
    </div>
  )
}
```

## Types

### Sheet
```typescript
interface Sheet {
  printType: 'DTF' | 'UV DTF' | 'Sublimation'
  width: number
  height: number
  unit: 'in' | 'cm'
}
```

### Layer
```typescript
interface Layer {
  id: string
  type: 'image' | 'ai_generated' | 'text'
  name: string
  visible: boolean
  thumbnail?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  zIndex: number
  imageUrl?: string
  text?: string
  fontSize?: number
  fontFamily?: string
  color?: string
}
```

### Pricing
```typescript
interface Pricing {
  basePrice: number
  perSquareInch: number
  setupFee: number
}
```

### FreeTrials
```typescript
interface FreeTrials {
  mrImagine: number
  itpEnhance: number
}
```

## Styling

All components use the project's theme system:
- `bg-card` - Card backgrounds
- `text-text` - Primary text
- `text-muted` - Secondary text
- `text-primary` - Primary brand color
- `border-primary/20` - Primary brand borders with opacity

The components are fully responsive and work with both light and dark themes through the ThemeProvider.
