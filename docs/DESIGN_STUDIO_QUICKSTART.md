# Design Studio Modal - Quick Start Guide

## 🚀 Quick Integration (3 Steps)

### Step 1: Import the Modal
```tsx
import DesignStudioModal from '@/components/DesignStudioModal'
```

### Step 2: Add State
```tsx
const [showDesigner, setShowDesigner] = useState(false)
```

### Step 3: Add Button & Modal
```tsx
<button onClick={() => setShowDesigner(true)}>
  Customize Design
</button>

<DesignStudioModal
  isOpen={showDesigner}
  onClose={() => setShowDesigner(false)}
  product={product}  // optional
  template="shirt"   // optional: 'shirt' | 'tumbler' | 'hoodie'
/>
```

---

## 🎨 Modal Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Design Studio                                          [X]      │
│  Create your custom design with professional tools               │
├─────────────┬───────────────────────────┬──────────────────────┤
│             │                           │                       │
│  SIDEBAR    │    DESIGN CANVAS          │   MOCKUP PREVIEW     │
│             │                           │                       │
│ ┌─────────┐ │  ┌─────────────────────┐ │  ┌─────────────────┐│
│ │Template │ │  │                     │ │  │                 ││
│ │Shirt    │ │  │   [Your Design]     │ │  │   [Preview]     ││
│ │Tumbler  │ │  │                     │ │  │                 ││
│ │Hoodie   │ │  │   Print Area Box    │ │  │                 ││
│ └─────────┘ │  │                     │ │  └─────────────────┘│
│             │  └─────────────────────┘ │                       │
│ ┌─────────┐ │                           │  [Generate Mockup]   │
│ │ Image   │ │  Click elements to edit   │  (25 ITC)           │
│ │ Tools   │ │  Drag to move             │                      │
│ │ Upload  │ │  Handles to resize        │  Balance: 100 ITC   │
│ │ Remove  │ │                           │                       │
│ │ Upscale │ │                           │                       │
│ └─────────┘ │                           │                       │
│             │                           │                       │
│ ┌─────────┐ │                           │                       │
│ │ Text    │ │                           │                       │
│ │ Tools   │ │                           │                       │
│ └─────────┘ │                           │                       │
│             │                           │                       │
│ [Delete]    │                           │                       │
│ [Add Cart]  │                           │                       │
│             │                           │                       │
└─────────────┴───────────────────────────┴──────────────────────┘
```

---

## ✨ Key Features

### 🖼️ Background Removal (10 ITC)
1. Upload or select an image
2. Click "Remove Background (10 ITC)"
3. Confirm the operation
4. Wait 10-20 seconds
5. Background-free image appears!

**Example Use Cases:**
- Remove white backgrounds from logos
- Isolate product images
- Create transparent overlays
- Clean up photo backgrounds

### 📐 Image Upscaling (15 ITC)
1. Upload or select an image
2. Click "Upscale Image (15 ITC)"
3. Choose 2x or 4x resolution
4. Confirm the operation
5. Wait 10-20 seconds
6. High-resolution image appears!

**Example Use Cases:**
- Enhance low-quality images
- Prepare images for large prints
- Improve detail visibility
- Fix pixelated graphics

### 🎭 Mockup Preview (25 ITC)
1. Design your product
2. Click "Generate Realistic Preview"
3. Wait 10-20 seconds
4. See professional mockup!
5. Download if needed

**Example Use Cases:**
- Show clients realistic previews
- Verify design placement
- Marketing materials
- Social media posts

---

## 🎯 Common Integration Points

### ProductCard.tsx
```tsx
// Add customize button to each product card
<button
  onClick={() => setShowDesigner(true)}
  className="btn-secondary w-full"
>
  <PencilIcon className="w-4 h-4 mr-2" />
  Customize
</button>
```

### ProductPage.tsx
```tsx
// Add prominent design button on product page
<button
  onClick={() => setShowDesigner(true)}
  className="btn-primary w-full text-lg py-4"
>
  🎨 Start Designing - ${product.price}
</button>
```

### Navbar.tsx
```tsx
// Add Design Studio link to navigation
<Link onClick={() => setShowDesigner(true)}>
  <SparklesIcon className="w-5 h-5" />
  Design Studio
</Link>
```

### Homepage.tsx
```tsx
// Add hero CTA to open design studio
<button
  onClick={() => setShowDesigner(true)}
  className="btn-primary btn-lg"
>
  Create Custom Design
</button>
```

---

## 💰 Pricing Summary

| Feature | ITC Cost | Processing Time |
|---------|----------|-----------------|
| Background Removal | 10 ITC | 10-20 seconds |
| Image Upscale (2x or 4x) | 15 ITC | 10-20 seconds |
| Realistic Mockup | 25 ITC | 10-20 seconds |
| AI Image Generation | 25 ITC | 15-30 seconds |

**ITC Packages:**
- 50 ITC = $5.00
- 100 ITC = $10.00
- 250 ITC = $25.00
- 500 ITC = $50.00

---

## 🛠️ Developer Tips

### Passing Product Context
```tsx
// With product from database
<DesignStudioModal
  isOpen={showDesigner}
  onClose={() => setShowDesigner(false)}
  product={product}  // Product object from Supabase
/>

// Without product (blank canvas)
<DesignStudioModal
  isOpen={showDesigner}
  onClose={() => setShowDesigner(false)}
  template="shirt"  // Just specify template type
/>
```

### Pre-loading Design Image
```tsx
// Start with an existing image
<DesignStudioModal
  isOpen={showDesigner}
  onClose={() => setShowDesigner(false)}
  initialDesignImage="https://example.com/design.png"
/>
```

### Handling Modal Close
```tsx
// Track if user made changes before closing
const handleClose = () => {
  if (hasUnsavedChanges) {
    const confirmed = confirm('Close without saving?')
    if (!confirmed) return
  }
  setShowDesigner(false)
}

<DesignStudioModal
  isOpen={showDesigner}
  onClose={handleClose}
/>
```

---

## 🎨 Styling Customization

The modal uses semantic color tokens from the Neon 2.0 theme:

```css
/* These are automatically theme-aware */
bg          → Background color
card        → Card/panel backgrounds
text        → Primary text
muted       → Secondary text
primary     → Brand primary (purple/pink)
secondary   → Brand secondary
accent      → Accent highlights
```

To customize further, modify classes in `DesignStudioModal.tsx`:
- Modal overlay: `bg-black/70 backdrop-blur-sm`
- Modal container: `bg-bg border-2 border-primary/30`
- Sidebar cards: `bg-card border border-primary/20`
- Primary buttons: `bg-primary hover:bg-primary/90`

---

## 📱 Mobile Considerations

The modal is optimized for desktop/tablet but works on mobile with some limitations:

**Desktop (Optimal):**
- Full 3-column layout
- Drag & drop with mouse
- Transform handles visible
- All features accessible

**Tablet (Good):**
- 2-column layout (sidebar + canvas/preview stacked)
- Touch drag & drop
- Transform handles visible
- All features accessible

**Mobile (Limited):**
- Single column layout
- Touch interactions may be difficult
- Consider showing simplified UI
- May want to redirect to desktop

---

## 🚨 Troubleshooting

### Modal doesn't open
```tsx
// Check state is properly managed
const [showDesigner, setShowDesigner] = useState(false)

// Check isOpen prop is correct
<DesignStudioModal isOpen={showDesigner} ... />

// Check no CSS z-index conflicts
// Modal uses z-50, ensure nothing blocks it
```

### Background removal fails
```bash
# Check backend logs for errors
# Common causes:
# 1. Missing REPLICATE_API_TOKEN
# 2. Insufficient Replicate credits
# 3. Invalid image URL
# 4. GCS upload failure
```

### Insufficient balance error
```sql
-- Check user's actual balance
SELECT itc_balance FROM user_wallets WHERE user_id = 'xxx';

-- Manually add ITC for testing
UPDATE user_wallets SET itc_balance = 100 WHERE user_id = 'xxx';
```

### Images don't load
```tsx
// Check CORS configuration
// Images must be accessible from your domain

// For data URLs, ensure they're valid base64
// For external URLs, ensure CORS allows your domain
```

---

## 📊 Analytics Tracking (Optional)

Add tracking to monitor usage:

```tsx
// Track modal opens
const handleOpen = () => {
  setShowDesigner(true)
  analytics.track('Design Studio Opened', {
    product_id: product?.id,
    template: template,
    source: 'product_page'
  })
}

// Track feature usage
const handleRemoveBackground = async () => {
  analytics.track('Background Removed', {
    cost: 10,
    balance: userItcBalance
  })
  // ... existing code
}
```

---

## 🎓 User Education

Consider adding these elements to help users:

1. **First-time tooltip:** Show quick tutorial on first open
2. **Feature badges:** "NEW" or "AI" badges on features
3. **Help button:** Link to detailed guide
4. **Example designs:** Showcase gallery of possibilities
5. **Video tutorial:** Short walkthrough video

---

## 📝 Summary

**What You Get:**
✅ Professional full-screen design studio
✅ AI-powered background removal (10 ITC)
✅ AI-powered image upscaling (15 ITC)
✅ Realistic mockup generation (25 ITC)
✅ Drag & drop canvas editor
✅ Text tools with custom fonts
✅ Real-time mockup preview
✅ Add to cart with design data
✅ Responsive layout
✅ Theme-aware styling

**Integration Time:** ~5 minutes
**Code Required:** ~10 lines
**Works With:** Any component or page

**Start designing in 3 steps! 🚀**
