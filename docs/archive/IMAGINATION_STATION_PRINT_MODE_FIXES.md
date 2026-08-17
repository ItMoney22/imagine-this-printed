# Imagination Station Print Mode Behavior - Implementation Summary

## Overview
Fixed print mode behavior in Imagination Station to enforce fixed canvas widths per print type and conditionally show/hide print options based on the selected print type.

## Fixed Widths by Print Type

### DTF (Direct-to-Film)
- **Width**: 22.5 inches (FIXED)
- **Mirror Toggle**: Hidden (DTF does not require mirroring)
- **Cut Lines Toggle**: Hidden (DTF does not use cut lines)

### UV DTF (Stickers)
- **Width**: 16 inches (FIXED)
- **Mirror Toggle**: Hidden (UV DTF does not require mirroring)
- **Cut Lines Toggle**: Visible and functional (UV DTF uses cut lines)

### Sublimation
- **Width**: 22 inches (FIXED)
- **Mirror Toggle**: Visible and functional (Sublimation often requires mirroring)
- **Cut Lines Toggle**: Hidden (Sublimation does not use cut lines)

## Files Modified

### 1. `backend/config/imagination-presets.ts`
**Changes:**
- Added clarifying comments to document that widths are FIXED per print type
- Updated `rules.mirror` to indicate which print types support mirroring
- Updated `rules.cutlineOption` to indicate which print types support cut lines
- Updated descriptions to emphasize fixed widths

**Key Configuration:**
```typescript
dtf: {
  width: 22.5,  // FIXED WIDTH
  rules: {
    mirror: false,        // Hide mirror toggle
    whiteInk: true,
    minDPI: 300
  }
}

uv_dtf: {
  width: 16,  // FIXED WIDTH
  rules: {
    mirror: false,        // Hide mirror toggle
    whiteInk: true,
    cutlineOption: true,  // Show cutlines toggle
    minDPI: 300
  }
}

sublimation: {
  width: 22,  // FIXED WIDTH
  rules: {
    mirror: true,         // Show mirror toggle
    whiteInk: false,
    minDPI: 300
  }
}
```

### 2. `src/components/imagination/SheetPresets.tsx`
**Changes:**
- Created `FIXED_WIDTHS` constant to centralize width definitions
- Created `AVAILABLE_HEIGHTS` constant for each print type
- Updated `SHEET_PRESETS` to dynamically generate presets from fixed widths and available heights
- Added "FIXED" badge to the width display to indicate it cannot be changed

**Key Changes:**
```typescript
// New constants
const FIXED_WIDTHS: Record<string, number> = {
  dtf: 22.5,
  uv_dtf: 16,
  sublimation: 22
}

const AVAILABLE_HEIGHTS: Record<string, number[]> = {
  dtf: [24, 36, 48, 53, 60, 72, 84, 96, 108, 120, 132, 144, 168, 192, 216, 240],
  uv_dtf: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
  sublimation: [24, 36, 48, 60, 72, 84, 96, 120]
}
```

### 3. `src/pages/ImaginationStation.tsx`
**Changes:**
- Updated `SHEET_PRESETS` to include `allowMirror` and `allowCutlines` flags
- Modified Print Options section to conditionally render toggles based on print type
- Added informational message when no print options are available (DTF case)

**Key Changes:**
```typescript
// Updated preset configuration
dtf: {
  width: 22.5,
  allowMirror: false,    // Controls mirror toggle visibility
  allowCutlines: false   // Controls cutlines toggle visibility
}

uv_dtf: {
  width: 16,
  allowMirror: false,
  allowCutlines: true    // Only UV DTF shows cutlines toggle
}

sublimation: {
  width: 22,
  allowMirror: true,     // Only Sublimation shows mirror toggle
  allowCutlines: false
}
```

**Conditional Rendering:**
```tsx
{/* Show cutlines toggle only for UV DTF */}
{preset?.allowCutlines && (
  <label>
    <input type="checkbox" checked={showCutLines} ... />
    Include cut lines
  </label>
)}

{/* Show mirror toggle only for Sublimation */}
{preset?.allowMirror && (
  <label>
    <input type="checkbox" checked={mirrorForSublimation} ... />
    Mirror for sublimation
  </label>
)}

{/* Show info if no options available */}
{!preset?.allowCutlines && !preset?.allowMirror && (
  <div>No additional print options for {preset?.name}</div>
)}
```

### 4. `src/components/imagination/ExportPanel.tsx`
**Changes:**
- Updated Print Options section to conditionally show toggles based on `sheet.printType`
- Added informational message for DTF (no additional options)

**Conditional Logic:**
```tsx
{/* Show cutlines toggle ONLY for UV DTF */}
{sheet.printType === 'uv_dtf' && (
  <label>
    <input type="checkbox" checked={includeCutlines} ... />
    Include cutlines (for UV DTF)
  </label>
)}

{/* Show mirror toggle ONLY for Sublimation */}
{sheet.printType === 'sublimation' && (
  <label>
    <input type="checkbox" checked={mirrorForSublimation} ... />
    Mirror for sublimation
  </label>
)}

{/* Show info if no options available (DTF) */}
{sheet.printType === 'dtf' && (
  <p>No additional print options for DTF</p>
)}
```

## Behavior Summary

### When Creating a New Sheet
1. User selects print type (DTF, UV DTF, or Sublimation)
2. Width is automatically set to the fixed value for that print type
3. User can only select from available heights for that print type
4. The sheet is created with the correct fixed width

### In the Editor
1. Width display shows "FIXED" badge to indicate it cannot be changed
2. Only relevant print options are shown based on print type:
   - **DTF**: No additional options (message displayed)
   - **UV DTF**: Cut lines toggle only
   - **Sublimation**: Mirror toggle only

### At Export/Cart
1. Only applicable toggles are shown in the Export Panel
2. Options are saved correctly with the cart item
3. Print type-specific settings are preserved through checkout

## Testing Checklist

- [x] DTF sheets are created with 22.5" width
- [x] UV DTF sheets are created with 16" width
- [x] Sublimation sheets are created with 22" width
- [x] Width cannot be manually changed after creation
- [x] DTF sheets show no print options
- [x] UV DTF sheets show only cut lines toggle
- [x] Sublimation sheets show only mirror toggle
- [x] SheetPresets component displays "FIXED" badge for width
- [x] ExportPanel respects print type for toggle visibility
- [x] All files updated maintain consistent print type behavior

## Notes

- The print type is determined at sheet creation and cannot be changed afterward
- Width is automatically enforced by the backend when creating sheets
- The frontend components now properly reflect these constraints in the UI
- Users are clearly informed about which options are available for each print type
- No breaking changes to existing sheets or cart functionality
