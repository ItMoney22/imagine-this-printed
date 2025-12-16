# DPI Detection and Quality Warnings Implementation Guide

This document outlines the changes needed to add DPI detection and quality warnings to the Imagination Station image upload feature.

## Overview

The implementation adds real-time DPI calculation when images are uploaded, with visual warnings in the sidebar and properties panel to alert users about potential print quality issues.

## Files Created

### 1. `/src/utils/dpi-calculator.ts`
✅ Already created - Contains all DPI calculation utilities and quality assessment logic.

## Changes Required to `/src/pages/ImaginationStation.tsx`

### Step 1: Add Import Statement

After line 18 (`import { SheetCanvas } from '../components/imagination';`), add:

```typescript
import { calculateDpi, getDpiQualityDisplay, getDpiFromMetadata, formatDpi, type DpiInfo, type DpiQuality } from '../utils/dpi-calculator';
```

### Step 2: Update `handleFileUpload` Function

Replace lines 237-293 (the entire `handleFileUpload` function) with:

```typescript
  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !sheet) return;

    setIsProcessing(true);
    try {
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            // Store original dimensions for DPI calculation
            const originalWidth = img.width;
            const originalHeight = img.height;

            // Scale image to fit on sheet (max 6 inches, in pixels)
            const maxSizeInches = 6;
            const maxSizePixels = maxSizeInches * PIXELS_PER_INCH;
            let w = img.width;
            let h = img.height;
            if (w > maxSizePixels || h > maxSizePixels) {
              const scale = maxSizePixels / Math.max(w, h);
              w *= scale;
              h *= scale;
            }

            // Calculate DPI based on original image and canvas size
            const dpiInfo = calculateDpi(originalWidth, originalHeight, w, h);

            const newLayer: ImaginationLayer = {
              id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              sheet_id: sheet.id,
              layer_type: 'image' as LayerType,
              source_url: event.target?.result as string,
              processed_url: null,
              position_x: 1,
              position_y: 1,
              width: w,
              height: h,
              rotation: 0,
              scale_x: 1,
              scale_y: 1,
              z_index: layers.length,
              metadata: {
                name: file.name.replace(/\.[^/.]+$/, ''),
                visible: true,
                locked: false,
                opacity: 1,
                dpiInfo, // Store DPI information in metadata
              },
              created_at: new Date().toISOString(),
            };
            setLayers(prev => [...prev, newLayer]);
            setSelectedLayerIds([newLayer.id]);
            setSaveStatus('unsaved');
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      }
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
```

**Key Changes:**
- Store original image dimensions before scaling
- Calculate DPI using `calculateDpi()` function
- Add `dpiInfo` to layer metadata

### Step 3: Add DPI Recalculation Helper Function

Add this new function after `handleFileUpload` (around line 294):

```typescript
  // Recalculate DPI when layer size changes
  const recalculateDpi = (layer: ImaginationLayer, newWidth: number, newHeight: number): DpiInfo | null => {
    const dpiInfo = getDpiFromMetadata(layer.metadata);
    if (!dpiInfo) return null;

    return calculateDpi(
      dpiInfo.originalWidth,
      dpiInfo.originalHeight,
      newWidth,
      newHeight
    );
  };
```

### Step 4: Update Layer Size Change Handlers in Properties Panel

Find the width and height input handlers in the Properties Panel (around lines 894-924). Update them to recalculate DPI:

**For Width Input** (around line 898):
```typescript
onChange={(e) => {
  const val = parseFloat(e.target.value);
  setLayers(prev => prev.map(l => {
    if (l.id === selectedLayers[0].id) {
      const newDpiInfo = recalculateDpi(l, val, l.height);
      return {
        ...l,
        width: val,
        metadata: {
          ...l.metadata,
          dpiInfo: newDpiInfo || l.metadata?.dpiInfo
        }
      };
    }
    return l;
  }));
  setSaveStatus('unsaved');
}}
```

**For Height Input** (around line 914):
```typescript
onChange={(e) => {
  const val = parseFloat(e.target.value);
  setLayers(prev => prev.map(l => {
    if (l.id === selectedLayers[0].id) {
      const newDpiInfo = recalculateDpi(l, l.width, val);
      return {
        ...l,
        height: val,
        metadata: {
          ...l.metadata,
          dpiInfo: newDpiInfo || l.metadata?.dpiInfo
        }
      };
    }
    return l;
  }));
  setSaveStatus('unsaved');
}}
```

### Step 5: Add DPI Indicator to Layer Items in Sidebar

Find the layer list rendering section (around lines 683-733). Update the layer item to include a DPI indicator:

After line 729 (the layer controls section), add:

```typescript
                        {/* Layer controls */}
                        <div className="flex items-center gap-1">
                          {/* DPI Indicator */}
                          {layer.layer_type === 'image' && (() => {
                            const dpiInfo = getDpiFromMetadata(layer.metadata);
                            if (dpiInfo) {
                              const display = getDpiQualityDisplay(dpiInfo.quality);
                              return (
                                <div
                                  className={`w-2 h-2 rounded-full ${display.indicatorColor}`}
                                  title={`${formatDpi(dpiInfo.dpi)} - ${display.description}`}
                                />
                              );
                            }
                            return null;
                          })()}

                          <button
                            onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                            className="p-1 text-stone-400 hover:text-stone-600"
                          >
```

**Key Changes:**
- Add DPI indicator dot before visibility and lock buttons
- Color indicates quality level (green/amber/red)
- Tooltip shows DPI value and description

### Step 6: Add DPI Warning Panel in Properties Panel

Find the Properties Panel section (around lines 843-982). After the "Selected Layer" name display (around line 850), add a new DPI warning section:

```typescript
                    <div>
                      <h3 className="text-sm font-semibold text-stone-800 mb-3">Selected Layer</h3>
                      <p className="text-stone-600">{selectedLayers[0].metadata?.name || `Layer ${selectedLayers[0].z_index + 1}`}</p>
                    </div>

                    {/* DPI Quality Warning */}
                    {selectedLayers[0].layer_type === 'image' && (() => {
                      const dpiInfo = getDpiFromMetadata(selectedLayers[0].metadata);
                      if (dpiInfo) {
                        const display = getDpiQualityDisplay(dpiInfo.quality);
                        return (
                          <div className={`p-4 ${display.bgColor} border ${display.borderColor} rounded-xl`}>
                            <div className="flex items-start gap-3">
                              <div className={`w-10 h-10 ${display.indicatorColor} rounded-lg flex items-center justify-center text-white text-lg font-bold shrink-0`}>
                                {display.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className={`font-semibold ${display.color}`}>
                                    Print Quality: {display.label}
                                  </h4>
                                </div>
                                <p className={`text-sm ${display.color} mb-2`}>
                                  {display.description}
                                </p>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <span className="text-stone-500">DPI:</span>
                                    <span className={`ml-1 font-semibold ${display.color}`}>
                                      {dpiInfo.dpi}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Size:</span>
                                    <span className={`ml-1 font-semibold ${display.color}`}>
                                      {dpiInfo.canvasSizeInches.width}" × {dpiInfo.canvasSizeInches.height}"
                                    </span>
                                  </div>
                                  <div className="col-span-2">
                                    <span className="text-stone-500">Original:</span>
                                    <span className={`ml-1 font-semibold ${display.color}`}>
                                      {dpiInfo.originalWidth} × {dpiInfo.originalHeight} px
                                    </span>
                                  </div>
                                </div>
                                {dpiInfo.quality === 'danger' && (
                                  <div className="mt-3 pt-3 border-t border-red-200">
                                    <p className="text-xs text-red-700 font-medium">
                                      ⚠ This image will not print well. Consider:
                                    </p>
                                    <ul className="text-xs text-red-600 mt-1 ml-4 list-disc space-y-0.5">
                                      <li>Using a higher resolution image</li>
                                      <li>Reducing the print size</li>
                                      <li>Using the Upscale tool to improve quality</li>
                                    </ul>
                                  </div>
                                )}
                                {dpiInfo.quality === 'warning' && (
                                  <div className="mt-3 pt-3 border-t border-amber-200">
                                    <p className="text-xs text-amber-700">
                                      💡 For best results, use a higher resolution image or reduce the print size.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    <div>
                      <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Position</h4>
```

**Key Features:**
- Full DPI quality panel with color-coded warnings
- Shows DPI value, canvas size, and original dimensions
- Provides actionable recommendations for poor quality images
- Different messaging for "danger" vs "warning" levels

## Summary of Changes

1. ✅ **Created DPI calculator utility** (`src/utils/dpi-calculator.ts`)
2. **Add import** for DPI utilities
3. **Update handleFileUpload** to calculate and store DPI on upload
4. **Add recalculateDpi helper** function
5. **Update size inputs** to recalculate DPI when dimensions change
6. **Add DPI indicator** dots in layer sidebar
7. **Add DPI warning panel** in properties panel

## Expected Behavior

- When an image is uploaded, DPI is automatically calculated
- Green dot (✓): 150+ DPI - good quality
- Yellow dot (⚠): 100-150 DPI - warning
- Red dot (✕): <100 DPI - poor quality
- Properties panel shows detailed DPI information when layer is selected
- Recommendations provided for low-quality images
- DPI recalculates in real-time when user changes layer dimensions

## Testing Checklist

- [ ] Upload high-res image (300+ DPI) - should show green indicator
- [ ] Upload medium-res image (100-150 DPI) - should show yellow indicator
- [ ] Upload low-res image (<100 DPI) - should show red indicator
- [ ] Resize layer and verify DPI recalculates
- [ ] Check tooltip on DPI indicator in sidebar
- [ ] Verify detailed DPI panel appears in properties when layer selected
- [ ] Confirm recommendations show for poor quality images
