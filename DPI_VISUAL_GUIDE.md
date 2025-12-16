# DPI Warning System - Visual Guide

This document shows the visual appearance of the DPI warning system in the Imagination Station.

## 1. Layer List with DPI Warnings

### Layer with Good Quality (150+ DPI)
```
┌─────────────────────────────────────┐
│ ┌────┐                              │
│ │img │  My Design                   │
│ │ 👁 │  ✓ Good quality             │
│ └────┘                     👁  🔓   │
└─────────────────────────────────────┘
No special indicators - layer appears normal
```

### Layer with Warning Quality (100-150 DPI)
```
┌─────────────────────────────────────┐
│ ┌────┐●                             │  ← Amber dot badge
│ │img │  My Design                   │
│ │ 🟡 │  128 DPI - Low Quality      │  ← Amber warning text
│ └────┘                     👁  🔓   │
└─────────────────────────────────────┘
```

### Layer with Danger Quality (<100 DPI)
```
┌─────────────────────────────────────┐
│ ┌────┐●                             │  ← Red dot badge
│ │img │  My Design                   │
│ │ 🔴 │  72 DPI - Poor Quality      │  ← Red danger text
│ └────┘                     👁  🔓   │
└─────────────────────────────────────┘
```

## 2. Properties Panel - DPI Quality Cards

### Excellent Quality (300+ DPI)
```
┌────────────────────────────────────────────┐
│  ┌──┐                                      │
│  │✓ │  Print Quality: Excellent            │
│  └──┘  Perfect for printing at 300+ DPI   │
│         Current DPI:              350      │
│         Original size:      3000 × 2000px  │
│         Print size:           10" × 6.67"  │
│                                            │
└────────────────────────────────────────────┘
Green background, green border
```

### Warning Quality (100-150 DPI)
```
┌────────────────────────────────────────────┐
│  ┌──┐                                      │
│  │⚠ │  Print Quality: Low Quality          │
│  └──┘  May appear pixelated (100-150 DPI) │
│         Current DPI:              128      │
│         Original size:      1200 × 800px   │
│         Print size:          12.5" × 8.3"  │
│         ────────────────────────────────   │
│         Tip: For best results, reduce      │
│         size or consider upscaling         │
└────────────────────────────────────────────┘
Amber background, amber border
```

### Danger Quality (<100 DPI)
```
┌────────────────────────────────────────────┐
│  ┌──┐                                      │
│  │✕ │  Print Quality: Poor Quality         │
│  └──┘  Will look bad when printed (<100)  │
│         Current DPI:               72      │
│         Original size:       800 × 600px   │
│         Print size:          13.9" × 10.4" │
│         ────────────────────────────────   │
│         Recommendation: Reduce the size    │
│         or use a higher resolution image   │
└────────────────────────────────────────────┘
Red background, red border
```

## 3. Canvas Overlays

### Image with Warning Quality
```
     ┌─[ 128 DPI ]─────────────┐
     │                         │
     │                         │
     │      MY DESIGN          │ ← Amber border (3px)
     │                         │
     │                         │
     └─────────────────────────┘
       ↑ Amber badge with DPI value
```

### Image with Danger Quality
```
     ┌─[ 72 DPI ]──────────────┐
     │                         │
     │                         │
     │      MY DESIGN          │ ← Red border (3px)
     │                         │
     │                         │
     └─────────────────────────┘
       ↑ Red badge with DPI value
```

## 4. Cart/Export Panel - Quality Summary

### No Issues
```
┌────────────────────────────────────────────┐
│  Sheet Summary                             │
│  22.5" × 24" DTF sheet with 3 layers      │
│  Price: $10.80                            │
└────────────────────────────────────────────┘
│                                            │
│  [ Add to Cart ]                          │
└────────────────────────────────────────────┘
```

### Warning Quality Present
```
┌────────────────────────────────────────────┐
│  Sheet Summary                             │
│  22.5" × 24" DTF sheet with 3 layers      │
│  Price: $10.80                            │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│  ⚠  Print Quality Warning                  │
│     2 images with low DPI (100-150).       │
│     May appear pixelated.                  │
│     Consider improving quality before      │
│     ordering                               │
└────────────────────────────────────────────┘
Amber background, amber border
│                                            │
│  [ Add to Cart ]                          │
└────────────────────────────────────────────┘
```

### Danger Quality Present (Blocks Checkout)
```
┌────────────────────────────────────────────┐
│  Sheet Summary                             │
│  22.5" × 24" DTF sheet with 3 layers      │
│  Price: $10.80                            │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│  ⚠  Print Quality Issues                   │
│     1 image with critically low DPI        │
│     (below 100). Cannot add to cart.       │
│     Fix quality issues before ordering     │
└────────────────────────────────────────────┘
Red background, red border
│                                            │
│  [ Add to Cart ] (disabled)               │
└────────────────────────────────────────────┘
```

## 5. Checkout Alerts

### Danger Alert (Blocks Checkout)
```
┌──────────────────────────────────────────┐
│  ⚠  Cannot proceed to cart               │
│                                          │
│  1 layer(s) have critically low DPI      │
│  (below 100).                            │
│                                          │
│  Affected layers: Logo Design            │
│                                          │
│  These images will look very pixelated   │
│  when printed. Please:                   │
│  • Reduce the size of these images, or   │
│  • Upload higher resolution versions, or │
│  • Use the Upscale tool to improve       │
│    quality                               │
│                                          │
│               [ OK ]                     │
└──────────────────────────────────────────┘
```

### Warning Confirmation (Allows Proceed)
```
┌──────────────────────────────────────────┐
│  ⚠  Warning                              │
│                                          │
│  2 layer(s) have low DPI (100-150).      │
│                                          │
│  Affected layers: Background, Pattern    │
│                                          │
│  These images may appear slightly        │
│  pixelated when printed.                 │
│                                          │
│  Do you want to continue anyway?         │
│                                          │
│         [ Cancel ]    [ Continue ]       │
└──────────────────────────────────────────┘
```

## Color Reference

### Excellent/Good Quality
- Background: `bg-green-50`
- Border: `border-green-300`
- Text: `text-green-600` to `text-green-800`
- Icon: ✓ (checkmark)

### Warning Quality
- Background: `bg-amber-50`
- Border: `border-amber-300`
- Text: `text-amber-600` to `text-amber-800`
- Badge Color: `bg-amber-500` (#F59E0B)
- Icon: ⚠ (warning triangle)

### Danger Quality
- Background: `bg-red-50`
- Border: `border-red-300`
- Text: `text-red-600` to `text-red-800`
- Badge Color: `bg-red-500` (#EF4444)
- Icon: ✕ (X mark)

## Responsive Behavior

### Layer List
- Badge dot: Fixed 3×3 pixels, absolute positioned top-right
- Warning text: Wraps on small containers
- Always shows for warning/danger layers

### Properties Panel
- Quality card: Full width of panel
- Scales with panel size
- Information grid stacks on very narrow panels

### Canvas Overlays
- DPI badge: Fixed 80px width, 20px height
- Positioned 24px above image top edge
- Border: 3px solid, scales with zoom
- Text: 12px font, white on colored background

### Cart Panel Summary
- Full width of panel
- Stacks vertically
- Text wraps as needed
- Icon size: 20×20 pixels

## Animation States

### On Upload
1. Layer appears in list
2. DPI calculation occurs (instant)
3. Badge fades in (150ms)
4. Warning text slides in (200ms)

### On Resize
1. User drags resize handle
2. DPI recalculates continuously
3. All indicators update in real-time
4. Color transitions smoothly (300ms)

### Quality Improvement
```
Red → Amber → Green
  ↓      ↓      ↓
 72    128    302 DPI

Border color fades between states
Badge updates text immediately
```

## User Interaction Flow

```
┌─────────────┐
│ Upload Image│
└──────┬──────┘
       │
       ↓
┌──────────────┐
│ DPI < 150?   │─No─→ [No warnings shown]
└──────┬───────┘
       │Yes
       ↓
┌──────────────────┐
│ Show Indicators: │
│ • Badge on layer │
│ • Canvas overlay │
│ • Property panel │
└──────┬───────────┘
       │
       ↓
┌──────────────┐
│ User Actions │
└──────┬───────┘
       │
       ├─Resize─→ DPI Recalculates ─→ Indicators Update
       │
       ├─Select─→ Property Panel Shows Details
       │
       └─Checkout─→ Validation
                      │
                      ├─DPI < 100 → Block
                      ├─DPI 100-150 → Warn
                      └─DPI >= 150 → Allow
```

## Accessibility

- Color is not the only indicator (text labels provided)
- Icon meanings are explained in tooltips
- High contrast ratios (WCAG AA compliant)
- Keyboard navigable
- Screen reader friendly labels

## Print Reference

### DPI Values for Common Scenarios

**Professional Print Quality**: 300+ DPI
- Business cards, brochures, posters
- Magazine quality
- Sharp text and fine details

**Acceptable Print Quality**: 150-300 DPI
- General promotional materials
- Large format prints (viewed from distance)
- Most DTF transfers

**Marginal Quality**: 100-150 DPI (WARNING)
- May show pixelation on close inspection
- Acceptable only for large formats
- Not recommended for professional work

**Poor Quality**: <100 DPI (DANGER)
- Visible pixelation
- Blurry edges
- Unprofessional appearance
- Should not be printed

### Size Guidelines

For a 10" × 10" print:
- 300 DPI = 3000 × 3000 pixels (Excellent)
- 150 DPI = 1500 × 1500 pixels (Good)
- 100 DPI = 1000 × 1000 pixels (Warning)
- 72 DPI = 720 × 720 pixels (Danger)
