# MockupPreview Component Architecture

## Component Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    MockupPreview Component                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Props Input:                                                   │
│  • designElements[]    ─────┐                                   │
│  • selectedTemplate    ─────┼──> Component State                │
│  • mockupImage         ─────┤                                   │
│  • onGenerateRealistic ─────┤                                   │
│  • isGenerating        ─────┤                                   │
│  • itcBalance          ─────┘                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Rendering Pipeline                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Canvas Initialization                                       │
│     ├─> Get canvas ref                                          │
│     ├─> Get 2D context                                          │
│     └─> Set dimensions (responsive)                             │
│                                                                 │
│  2. Background Rendering                                        │
│     ├─> Load mockup image (if provided)                         │
│     │   ├─> Success: Draw to canvas                             │
│     │   └─> Failure: Draw fallback gradient                     │
│     └─> No mockup: Draw fallback gradient                       │
│                                                                 │
│  3. Print Area Calculation                                      │
│     ├─> Get template from PRODUCT_TEMPLATES                     │
│     ├─> Call printAreaToPixels()                                │
│     │   Input:  template.printArea (normalized 0-1)             │
│     │   Output: printArea (pixels)                              │
│     └─> Draw print area boundaries (purple dashed)              │
│                                                                 │
│  4. Design Elements Rendering                                   │
│     For each element in designElements:                         │
│     ├─> Calculate coordinate mapping                            │
│     │   ├─> scaleX = printArea.width / 800                      │
│     │   ├─> scaleY = printArea.height / 600                     │
│     │   ├─> mappedX = printArea.x + element.x * scaleX          │
│     │   └─> mappedY = printArea.y + element.y * scaleY          │
│     │                                                            │
│     ├─> Apply rotation (if any)                                 │
│     │   ├─> Translate to element center                         │
│     │   ├─> Rotate by element.rotation degrees                  │
│     │   └─> Translate back                                      │
│     │                                                            │
│     └─> Render element                                          │
│         ├─> If image: Load & draw with mapped dimensions        │
│         └─> If text: Draw with scaled font size                 │
│                                                                 │
│  5. Watermark                                                   │
│     └─> Draw "Preview Only" in bottom-left corner               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    UI Elements                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Header:                                                        │
│  ┌────────────────────────────────────────┐                     │
│  │ Mockup Preview         T-Shirt          │                     │
│  └────────────────────────────────────────┘                     │
│                                                                 │
│  Canvas Container:                                              │
│  ┌────────────────────────────────────────┐                     │
│  │ ┌────────────────────────────────────┐ │                     │
│  │ │                                    │ │                     │
│  │ │     [Mockup Background]            │ │                     │
│  │ │                                    │ │                     │
│  │ │     ╔═══════════════════╗          │ │  <- Print Area      │
│  │ │     ║                   ║          │ │     (Purple dashed) │
│  │ │     ║  Design Elements  ║          │ │                     │
│  │ │     ║                   ║          │ │                     │
│  │ │     ╚═══════════════════╝          │ │                     │
│  │ │                                    │ │                     │
│  │ │     Preview Only                   │ │  <- Watermark       │
│  │ └────────────────────────────────────┘ │                     │
│  └────────────────────────────────────────┘                     │
│                                                                 │
│  Footer:                                                        │
│  ┌────────────────────────────────────────┐                     │
│  │ This is a quick preview. Generate a    │                     │
│  │ realistic mockup for a professional... │                     │
│  │                                        │                     │
│  │ ┌────────────────────────────────────┐ │                     │
│  │ │ ⚡ Generate Realistic Preview      │ │  <- Button          │
│  │ │             (25 ITC)               │ │                     │
│  │ └────────────────────────────────────┘ │                     │
│  │                                        │                     │
│  │ Your ITC Balance:              100 ITC │  <- Balance         │
│  └────────────────────────────────────────┘                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Coordinate Transformation

```
Konva Canvas Space (800 x 600)          Mockup Canvas Space (600 x 700)
┌─────────────────────────────┐         ┌─────────────────────────────┐
│                             │         │                             │
│  Element at (320, 250)      │         │                             │
│       │                     │         │  ┌─────────────────┐        │
│       ▼                     │   Map   │  │ Print Area      │        │
│     ┌───┐                   │  ────>  │  │   (150, 210,    │        │
│     │ T │                   │         │  │    300, 280)    │        │
│     └───┘                   │         │  │                 │        │
│                             │         │  │   Mapped: (240, │        │
│ (0,0)                       │         │  │           327)  │        │
│                             │         │  │      │          │        │
└─────────────────────────────┘         │  │      ▼          │        │
                                        │  │    ┌───┐        │        │
Calculation:                            │  │    │ T │        │        │
  scaleX = 300 / 800 = 0.375            │  │    └───┘        │        │
  scaleY = 280 / 600 = 0.467            │  └─────────────────┘        │
  mappedX = 150 + 320 * 0.375 = 270     │ (0,0)                       │
  mappedY = 210 + 250 * 0.467 = 327     └─────────────────────────────┘
```

## State Management Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    Component State                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  useState                                                    │
│  ├─> isLoadingMockup: boolean                               │
│  ├─> mockupLoadError: string | null                         │
│  └─> canvasSize: { width: number, height: number }          │
│                                                              │
│  useRef                                                      │
│  └─> canvasRef: HTMLCanvasElement | null                    │
│                                                              │
│  useEffect Dependencies                                      │
│  ├─> [designElements, selectedTemplate, mockupImage]        │
│  │   └─> Triggers: drawPreview()                            │
│  │                                                           │
│  └─> [window.resize]                                        │
│      └─> Triggers: handleResize() → Update canvasSize       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

```
Parent Component (ProductDesigner)
│
├─> designElements (Konva Stage state)
│   └─> Updates on every canvas edit
│       └─> Triggers MockupPreview re-render
│           └─> Canvas redraws with new elements
│
├─> selectedTemplate (user selection)
│   └─> Updates on template switch
│       └─> Triggers print area recalculation
│           └─> Canvas redraws with new print area
│
├─> itcBalance (from AuthContext)
│   └─> Updates on token purchase/usage
│       └─> Triggers button enabled/disabled state
│
└─> onGenerateRealistic (callback)
    └─> User clicks "Generate" button
        └─> Parent handles API call
            ├─> Shows isGenerating=true
            ├─> Calls Nano Banana API
            ├─> Deducts ITC tokens
            └─> Shows result

MockupPreview Component
│
└─> Renders canvas preview
    ├─> Updates on designElements change
    ├─> Updates on template change
    └─> Shows loading/error states
```

## Integration with Product Templates

```
product-templates.ts
├─> PRODUCT_TEMPLATES
│   ├─> shirts
│   │   └─> printArea: { x: 0.25, y: 0.30, width: 0.50, height: 0.40, rotation: 0 }
│   ├─> hoodies
│   │   └─> printArea: { x: 0.25, y: 0.25, width: 0.50, height: 0.50, rotation: 0 }
│   └─> tumblers
│       └─> printArea: { x: 0.30, y: 0.20, width: 0.40, height: 0.60, rotation: 0 }
│
└─> printAreaToPixels(printArea, canvasWidth, canvasHeight)
    └─> Returns: { x: pixels, y: pixels, width: pixels, height: pixels, rotation: degrees }

MockupPreview.tsx
└─> Uses printAreaToPixels to map normalized coordinates to canvas pixels
```

## Rendering Sequence

```
1. Component Mount
   └─> useEffect #1: Set initial canvas size
   └─> useEffect #2: Add resize listener

2. Props Update (designElements changed)
   └─> useEffect #3: Trigger drawPreview()
       ├─> Clear canvas
       ├─> Load mockup background (async)
       ├─> Calculate print area (sync)
       ├─> Draw print area boundaries (sync)
       ├─> For each element:
       │   ├─> Calculate mapped coordinates
       │   ├─> Apply rotation transform
       │   └─> Draw element (async for images)
       └─> Draw watermark

3. Window Resize
   └─> handleResize()
       ├─> Get container width
       ├─> Calculate new canvas size (maintain aspect ratio)
       └─> Update canvasSize state
           └─> Triggers useEffect #3 (redraw)

4. User Clicks "Generate Realistic"
   └─> Call onGenerateRealistic()
       └─> Parent component handles (Task 9)
```

## Error Handling Flow

```
Error Type: Mockup Image Load Failure
├─> Cause: Invalid URL, CORS, network error
├─> Detected: loadImage() Promise rejection
├─> Handled:
│   ├─> Set mockupLoadError state
│   ├─> Display error banner to user
│   └─> Draw fallback gradient background
└─> Result: Component continues to function

Error Type: Design Image Load Failure
├─> Cause: Invalid data URL, CORS error
├─> Detected: loadImage() Promise rejection in element loop
├─> Handled:
│   ├─> Console.error() for debugging
│   └─> Draw placeholder gray rectangle
└─> Result: Other elements still render

Error Type: Insufficient ITC Balance
├─> Cause: itcBalance < 25
├─> Detected: canAffordRealistic computed value
├─> Handled:
│   ├─> Disable "Generate" button
│   ├─> Add tooltip explaining issue
│   ├─> Change balance text to red
│   └─> Show warning message below
└─> Result: User cannot generate until balance topped up
```

## Performance Optimization

```
Optimization Strategy:
├─> useEffect Dependencies
│   └─> Only redraw when designElements, template, or mockup change
│       (Not on every parent re-render)
│
├─> Async Image Loading
│   └─> Non-blocking, doesn't freeze UI
│       └─> Uses Promise.all for parallel loading (future enhancement)
│
├─> Canvas Context Save/Restore
│   └─> Efficiently manage transformation state
│       └─> No global state pollution
│
├─> Responsive Resize
│   └─> CSS-driven canvas scaling
│       └─> Only recalculate on actual resize events
│
└─> Image Caching (Future)
    └─> Cache loaded images to avoid repeated network requests
```

## Theme Integration

```
Tailwind Classes Used:
├─> bg-bg              → Background color (light/dark mode)
├─> bg-card            → Card background
├─> border-primary/20  → Primary color border with 20% opacity
├─> text-text          → Main text color
├─> text-muted         → Muted text color
├─> bg-primary         → Primary button color
├─> hover:shadow-glow  → Glow effect on hover
├─> text-red-400       → Error/warning text
└─> rounded-lg         → Rounded corners

CSS Variables (from index.css):
├─> --bg               → Background
├─> --card             → Card surface
├─> --text             → Primary text
├─> --muted            → Secondary text
├─> --primary          → Brand color (#8b5cf6 purple)
├─> --secondary        → Accent color
└─> --accent           → Highlight color
```

## Canvas API Usage

```
HTML5 Canvas Methods Used:
├─> getContext('2d')           → Get 2D rendering context
├─> clearRect()                → Clear canvas area
├─> drawImage()                → Draw image/mockup
├─> fillRect()                 → Draw rectangle (fallback)
├─> fillText()                 → Draw text element
├─> strokeRect()               → Draw print area border
├─> save() / restore()         → Save/restore canvas state
├─> translate()                → Move coordinate origin
├─> rotate()                   → Rotate coordinate system
├─> setLineDash([5, 5])        → Set dashed line pattern
└─> toDataURL()                → Export canvas (future use)
```

## Future Enhancements (Roadmap)

```
Phase 1 (Current): Basic Composite ✅
└─> Real-time canvas preview with print area

Phase 2 (Task 9): Realistic Generation
└─> Nano Banana API integration

Phase 3 (Task 14): Mockup Library
└─> Load mockups from product_mockups table

Phase 4: Advanced Features
├─> 3D Perspective Transform
├─> Shadow/Lighting Simulation
├─> Multiple Mockup Views (front/back/side)
├─> Zoom/Pan Controls
├─> Export Preview as PNG
└─> Image Caching

Phase 5: Admin Tools
├─> Visual Print Area Editor
├─> Mockup Upload Interface
└─> Template Management
```

---

## Component Lifecycle

```
Mount
  ├─> Initialize state
  ├─> Set canvas ref
  ├─> Calculate initial size
  ├─> Add resize listener
  └─> Draw initial preview

Update (props change)
  ├─> Check dependencies
  ├─> If changed: redraw canvas
  └─> Update button states

Unmount
  └─> Remove resize listener
```

## Testing Matrix

```
                    │ Empty │ With     │ With     │ Rotated │ Large
                    │ Array │ Images   │ Text     │ Elements│ Elements
────────────────────┼───────┼──────────┼──────────┼─────────┼──────────
Renders Without     │  ✅   │   ✅     │   ✅     │   ✅    │   ✅
Errors              │       │          │          │         │
────────────────────┼───────┼──────────┼──────────┼─────────┼──────────
Print Area Visible  │  ✅   │   ✅     │   ✅     │   ✅    │   ✅
────────────────────┼───────┼──────────┼──────────┼─────────┼──────────
Elements in Print   │  N/A  │   ✅     │   ✅     │   ✅    │   ⚠️
Area                │       │          │          │         │ (may overflow)
────────────────────┼───────┼──────────┼──────────┼─────────┼──────────
Rotation Applied    │  N/A  │   N/A    │   N/A    │   ✅    │   ✅
────────────────────┼───────┼──────────┼──────────┼─────────┼──────────
Responsive          │  ✅   │   ✅     │   ✅     │   ✅    │   ✅
────────────────────┼───────┼──────────┼──────────┼─────────┼──────────
Button Enabled      │  ✅   │   ✅     │   ✅     │   ✅    │   ✅
(if balance)        │       │          │          │         │
────────────────────┼───────┼──────────┼──────────┼─────────┼──────────
```

---

**Architecture Document Complete**
**Date**: 2025-11-10
**Component**: MockupPreview.tsx
**Status**: Production Ready
