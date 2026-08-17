# Auto-Nest and Smart Fill Implementation

## Overview

This document describes the implementation of Auto-Nest and Smart Fill functionality in the Imagination Station gang sheet builder.

## Features Implemented

### 1. Auto-Nest Algorithm

**File:** `backend/services/imagination-layout.ts`

A grid-based shelf-packing algorithm that automatically arranges layers on a gang sheet to minimize wasted space.

**Algorithm Details:**
- Uses shelf-packing approach (similar to bin-packing)
- Sorts layers by area (largest first) for better packing efficiency
- Supports 90-degree rotation for better fit
- Configurable padding between items (default 0.125 inches)
- Returns efficiency percentage and positions for all layers

**Features:**
- Tries to fit items in existing shelves first
- Creates new shelves when needed
- Automatically rotates items 90 degrees if it improves fit
- Handles layers that are too large with graceful fallback
- Calculates packing efficiency and wasted space

**API Parameters:**
```typescript
{
  sheetWidth: number;      // Sheet width in inches
  sheetHeight: number;     // Sheet height in inches
  layers: Array<{
    id: string;
    width: number;         // Layer width in pixels
    height: number;        // Layer height in pixels
    rotation?: number;     // Current rotation
  }>;
  padding?: number;        // Padding between items (default 0.125")
}
```

**API Response:**
```typescript
{
  positions: Array<{
    id: string;
    x: number;            // X position in inches
    y: number;            // Y position in inches
    rotation: number;     // Final rotation (0 or 90)
  }>;
  efficiency: number;     // Packing efficiency percentage
  wastedSpace: number;    // Wasted area in square inches
  itcCharged: number;     // ITC tokens charged
}
```

### 2. Smart Fill Algorithm

**File:** `backend/services/imagination-layout.ts`

Fills empty space on the gang sheet with duplicates of selected designs using a grid-based approach.

**Algorithm Details:**
- Uses the smallest selected layer as the template
- Calculates grid dimensions based on template size + padding
- Places duplicates in a grid pattern
- Avoids overlapping with existing layers
- Returns coverage percentage and list of duplicates

**Features:**
- Grid-based placement for maximum coverage
- Collision detection to avoid existing layers
- Uses smallest layer as template (most efficient)
- Calculates coverage percentage

**API Parameters:**
```typescript
{
  sheetWidth: number;
  sheetHeight: number;
  layers: Array<{
    id: string;
    width: number;
    height: number;
  }>;
  padding?: number;        // Padding between items (default 0.125")
}
```

**API Response:**
```typescript
{
  duplicates: Array<{
    sourceId: string;      // ID of source layer to duplicate
    x: number;             // X position in inches
    y: number;             // Y position in inches
    rotation?: number;     // Rotation (currently 0)
  }>;
  coverage: number;        // Sheet coverage percentage
  totalAdded: number;      // Number of duplicates added
  itcCharged: number;      // ITC tokens charged
}
```

### 3. Backend Routes

**File:** `backend/routes/imagination-station.ts`

Added two new API endpoints:

#### POST `/api/imagination-station/layout/auto-nest`
- Requires authentication
- Validates layer data
- Checks ITC balance or free trial
- Performs auto-nest optimization
- Deducts ITC and logs transaction
- Returns optimized positions

#### POST `/api/imagination-station/layout/smart-fill`
- Requires authentication
- Validates layer data
- Checks ITC balance or free trial
- Performs smart fill
- Deducts ITC and logs transaction
- Returns duplicate positions

### 4. Frontend Integration

**File:** `src/components/imagination/AutoLayoutControls.tsx`

Updated the AutoLayoutControls component to properly integrate with the backend:

**Fixes Applied:**
- Corrected layer property names (`position_x`, `position_y` instead of `x`, `y`)
- Corrected sheet property names (`sheet.sheet_width` instead of `sheet.width`)
- Fixed Smart Fill to create new layer objects with proper IDs
- Added error handling and validation
- Added success messages with efficiency/coverage stats
- Fixed alignment functions to use correct property names
- Added auto-dismissing error/success messages

**Smart Fill Behavior:**
- Uses selected layers as templates (or all layers if none selected)
- Creates new layer objects with unique IDs
- Preserves source layer properties (image URL, metadata, etc.)
- Appends " (filled)" to layer names
- Updates z-index to place new layers on top

### 5. Pricing Integration

Both features integrate with the ITC pricing system:

**Auto-Nest:**
- Default cost: 5 ITC
- Free trial available
- Cost deducted after successful operation
- Transaction logged to wallet_transactions table

**Smart Fill:**
- Default cost: 3 ITC
- Free trial available
- Cost deducted after successful operation
- Transaction logged to wallet_transactions table

## Usage in Imagination Station

### Auto-Nest
1. Upload multiple images to a sheet
2. Click "Auto-Nest" button in the Tools panel
3. Algorithm rearranges all layers to minimize waste
4. Layers are updated with new positions and rotations
5. Efficiency percentage is displayed

### Smart Fill
1. Upload at least one image
2. Optionally select specific layers to duplicate
3. Click "Smart Fill" button in the Tools panel
4. Algorithm fills empty space with duplicates
5. New layers are created and added to the canvas
6. Coverage percentage is displayed

### Magic Spacing (Free)
- **Align Horizontal:** Aligns selected layers horizontally (Y position)
- **Align Vertical:** Aligns selected layers vertically (X position)
- **Distribute:** Evenly distributes 3+ selected layers horizontally

## Technical Notes

### Coordinate System
- Frontend uses pixels for layer dimensions
- Backend expects inches for positions
- Conversion handled in API calls

### Layer Properties
- `position_x`, `position_y`: Position in inches
- `width`, `height`: Size in pixels (96 DPI on screen)
- `rotation`: Rotation in degrees (0, 90, 180, 270)
- `z_index`: Stacking order

### Error Handling
- Insufficient ITC balance: Shows error message
- Invalid layer data: Backend validation returns 400 error
- No layers: Shows user-friendly error
- API errors: Displayed with auto-dismiss

## Future Enhancements

Potential improvements:

1. **Advanced Rotation:**
   - Support arbitrary angles (not just 90-degree increments)
   - Allow user to enable/disable rotation

2. **Grouping:**
   - Keep related designs grouped together
   - Allow user to define groups

3. **Spacing Options:**
   - Let user configure padding distance
   - Different padding for X and Y axes

4. **Preview:**
   - Show preview before applying
   - Allow user to approve/reject changes

5. **Undo/Redo:**
   - Add undo functionality for layout operations
   - Store layout history

6. **Advanced Algorithms:**
   - Genetic algorithm for better optimization
   - Multiple layout options to choose from
   - Support for irregular shapes (not just rectangles)

## Files Modified

### Backend
- `backend/services/imagination-layout.ts` (NEW)
- `backend/routes/imagination-station.ts` (MODIFIED)

### Frontend
- `src/components/imagination/AutoLayoutControls.tsx` (MODIFIED)

### API Client
- `src/lib/api.ts` (Already had endpoints defined)

## Testing

To test the implementation:

1. **Start Development Server:**
   ```bash
   npm run dev
   ```

2. **Navigate to Imagination Station:**
   - Create a new sheet (DTF, UV DTF, or Sublimation)
   - Upload 3-5 images of various sizes

3. **Test Auto-Nest:**
   - Ensure you have sufficient ITC balance (5 ITC)
   - Click "Auto-Nest" in the Tools panel
   - Verify layers are rearranged
   - Check efficiency percentage in success message

4. **Test Smart Fill:**
   - Ensure you have sufficient ITC balance (3 ITC)
   - Select one layer (optional)
   - Click "Smart Fill" in the Tools panel
   - Verify duplicates are added
   - Check coverage percentage in success message

5. **Test Magic Spacing:**
   - Select 2+ layers
   - Click "Align H" or "Align V"
   - Verify layers align correctly
   - Select 3+ layers
   - Click "Distribute"
   - Verify even spacing

## Cost Summary

| Feature | ITC Cost | Free Trial |
|---------|----------|------------|
| Auto-Nest | 5 ITC | Available |
| Smart Fill | 3 ITC | Available |
| Align Horizontal | Free | N/A |
| Align Vertical | Free | N/A |
| Distribute | Free | N/A |
