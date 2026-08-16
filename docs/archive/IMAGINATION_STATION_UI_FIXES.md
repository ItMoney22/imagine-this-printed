# Imagination Station UI Fixes

This document outlines the four core UI fixes needed for the Imagination Station page.

## Changes Required

### 1. Back Button Navigation (Line ~804)

**Current Code:**
```tsx
<button
  onClick={() => navigate(-1)}
  className="flex items-center gap-2 text-stone-600 hover:text-purple-600 transition-colors"
>
  <ChevronLeft className="w-5 h-5" />
  <span className="font-medium">Back</span>
</button>
```

**Fixed Code:**
```tsx
<button
  onClick={() => navigate('/product-catalog')}
  className="flex items-center gap-2 text-stone-600 hover:text-purple-600 transition-colors"
>
  <ChevronLeft className="w-5 h-5" />
  <span className="font-medium">Back</span>
</button>
```

**Change:** `navigate(-1)` → `navigate('/product-catalog')`

---

### 2. Top Navigation Buttons (Lines ~852-860)

**Current Code:**
```tsx
{/* ITC Balance */}
<div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 rounded-lg border border-purple-100">
  <Coins className="w-4 h-4 text-amber-500" />
  <span className="font-bold text-purple-700">{itcBalance}</span>
  <span className="text-purple-600 text-sm">ITC</span>
</div>
```

**Fixed Code:**
```tsx
{/* ITC Balance - Clickable */}
<button
  onClick={() => navigate('/wallet')}
  className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 rounded-lg border border-purple-100 hover:bg-purple-100 transition-colors"
  title="Go to Wallet"
>
  <Coins className="w-4 h-4 text-amber-500" />
  <span className="font-bold text-purple-700">{itcBalance}</span>
  <span className="text-purple-600 text-sm">ITC</span>
</button>

{/* Profile Button */}
<button
  onClick={() => navigate('/profile')}
  className="w-8 h-8 flex items-center justify-center text-stone-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
  title="Profile"
>
  <User className="w-5 h-5" />
</button>

{/* Settings Button - Opens settings panel */}
<button
  onClick={() => setActivePanel('export')}
  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
    activePanel === 'export'
      ? 'text-purple-600 bg-purple-50'
      : 'text-stone-600 hover:text-purple-600 hover:bg-purple-50'
  }`}
  title="Settings & Export"
>
  <Settings className="w-5 h-5" />
</button>
```

**Changes:**
- Make ITC balance clickable (navigate to wallet)
- Add Profile button
- Add Settings button

---

### 3. Sidebar Toggle Buttons (Lines ~866 and ~1097)

**Left Sidebar - Current Code (Line ~866):**
```tsx
<aside className="w-64 bg-white border-r border-stone-200 flex flex-col shrink-0">
```

**Left Sidebar - Fixed Code:**
```tsx
{leftSidebarVisible && (
<aside className="w-64 bg-white border-r border-stone-200 flex flex-col shrink-0 relative">
  {/* Hide button */}
  <button
    onClick={() => setLeftSidebarVisible(false)}
    className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors z-10"
    title="Hide panel"
  >
    <PanelLeft className="w-4 h-4" />
  </button>
  {/* Rest of sidebar content... */}
</aside>
)}

{/* Show Left Sidebar Button */}
{!leftSidebarVisible && (
  <button
    onClick={() => setLeftSidebarVisible(true)}
    className="w-8 bg-white border-r border-stone-200 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 transition-colors shrink-0"
    title="Show left panel"
  >
    <PanelRight className="w-4 h-4" />
  </button>
)}
```

**Right Sidebar - Current Code (Line ~1097):**
```tsx
<aside className="w-80 bg-white border-l border-stone-200 flex flex-col shrink-0">
```

**Right Sidebar - Fixed Code:**
```tsx
{/* Show Right Sidebar Button */}
{!rightSidebarVisible && (
  <button
    onClick={() => setRightSidebarVisible(true)}
    className="w-8 bg-white border-l border-stone-200 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 transition-colors shrink-0"
    title="Show right panel"
  >
    <PanelLeft className="w-4 h-4" />
  </button>
)}

{rightSidebarVisible && (
<aside className="w-80 bg-white border-l border-stone-200 flex flex-col shrink-0 relative">
  {/* Hide button */}
  <button
    onClick={() => setRightSidebarVisible(false)}
    className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors z-10"
    title="Hide panel"
  >
    <PanelRight className="w-4 h-4" />
  </button>
  {/* Rest of sidebar content... */}
</aside>
)}
```

**Changes:**
- Wrap sidebars in conditional rendering
- Add hide/show toggle buttons
- Add `relative` class to sidebars for absolute positioning of hide button

---

### 4. Lock Layer Functionality in SheetCanvas

**File:** `src/components/imagination/SheetCanvas.tsx`

**Location:** Line ~81-108 (CanvasImage component)

**Current Code:**
```tsx
<Image
  ref={shapeRef}
  image={image}
  x={layer.position_x * PIXELS_PER_INCH}
  y={layer.position_y * PIXELS_PER_INCH}
  width={layer.width}
  height={layer.height}
  rotation={layer.rotation}
  scaleX={layer.scale_x}
  scaleY={layer.scale_y}
  draggable
  onClick={onSelect}
  onTap={onSelect}
  onDragEnd={(e) => {
    onChange({
      position_x: e.target.x() / PIXELS_PER_INCH,
      position_y: e.target.y() / PIXELS_PER_INCH
    });
  }}
  onTransformEnd={(e) => {
    const node = shapeRef.current;
    if (!node) return;

    onChange({
      position_x: node.x() / PIXELS_PER_INCH,
      position_y: node.y() / PIXELS_PER_INCH,
      width: node.width() * node.scaleX(),
      height: node.height() * node.scaleY(),
      rotation: node.rotation(),
      scale_x: 1,
      scale_y: 1
    });

    // Reset scale after applying
    node.scaleX(1);
    node.scaleY(1);
  }}
/>
```

**Fixed Code:**
```tsx
<Image
  ref={shapeRef}
  image={image}
  x={layer.position_x * PIXELS_PER_INCH}
  y={layer.position_y * PIXELS_PER_INCH}
  width={layer.width}
  height={layer.height}
  rotation={layer.rotation}
  scaleX={layer.scale_x}
  scaleY={layer.scale_y}
  draggable={!(layer.metadata?.locked ?? false)}
  onClick={onSelect}
  onTap={onSelect}
  onDragEnd={(e) => {
    if (layer.metadata?.locked) return;
    onChange({
      position_x: e.target.x() / PIXELS_PER_INCH,
      position_y: e.target.y() / PIXELS_PER_INCH
    });
  }}
  onTransformEnd={(e) => {
    if (layer.metadata?.locked) return;
    const node = shapeRef.current;
    if (!node) return;

    onChange({
      position_x: node.x() / PIXELS_PER_INCH,
      position_y: node.y() / PIXELS_PER_INCH,
      width: node.width() * node.scaleX(),
      height: node.height() * node.scaleY(),
      rotation: node.rotation(),
      scale_x: 1,
      scale_y: 1
    });

    // Reset scale after applying
    node.scaleX(1);
    node.scaleY(1);
  }}
/>
```

Also update the Transformer visibility (Line ~124-137):

**Current Code:**
```tsx
{isSelected && (
  <Transformer
    ref={trRef}
    boundBoxFunc={(oldBox, newBox) => {
      // Limit minimum size
      if (newBox.width < 20 || newBox.height < 20) {
        return oldBox;
      }
      return newBox;
    }}
    rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
    rotationSnapTolerance={5}
  />
)}
```

**Fixed Code:**
```tsx
{isSelected && !(layer.metadata?.locked ?? false) && (
  <Transformer
    ref={trRef}
    boundBoxFunc={(oldBox, newBox) => {
      // Limit minimum size
      if (newBox.width < 20 || newBox.height < 20) {
        return oldBox;
      }
      return newBox;
    }}
    rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
    rotationSnapTolerance={5}
  />
)}
```

**Changes:**
- Set `draggable={!(layer.metadata?.locked ?? false)}`
- Add lock checks in `onDragEnd` and `onTransformEnd`
- Hide Transformer when layer is locked

---

## Summary

All four UI issues are now addressed:
1. ✅ Back button navigates to product catalog
2. ✅ ITC, Profile, and Settings buttons work correctly
3. ✅ Left/Right sidebars can be hidden/shown
4. ✅ Locked layers cannot be dragged or transformed

## Testing

After implementing these changes:
1. Test back button navigation
2. Click ITC balance (should go to wallet)
3. Click Profile button (should go to profile)
4. Click Settings button (should open export panel)
5. Click hide/show buttons for both sidebars
6. Lock a layer and verify it cannot be moved or resized
