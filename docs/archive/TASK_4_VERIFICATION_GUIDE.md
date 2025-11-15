# Task 4 Verification Guide

## Quick Verification Steps

### 1. Start Development Server
```bash
cd "E:\Projects for MetaSphere\imagine-this-printed"
npm run dev
```
Server should start at http://localhost:5173

### 2. Test Scenarios

#### Test A: Direct URL Navigation (All Parameters)
1. Open browser to: `http://localhost:5173/designer?productId=TEST_ID&template=shirt&designImage=https://picsum.photos/200`
2. **Expected Results:**
   - Loading spinner appears briefly
   - If product exists: Green banner shows product info
   - If product doesn't exist: Red banner shows "Product not found"
   - Template selector shows "T-Shirt" selected
   - Random image loads onto canvas automatically
   - Console logs show:
     ```
     [ProductDesigner] URL params: {productId: "TEST_ID", template: "shirt", designImage: "https://..."}
     [ProductDesigner] Setting template from URL: shirt
     [ProductDesigner] Loading product from database: TEST_ID
     [ProductDesigner] Auto-loading design image: https://...
     ```

#### Test B: From Product Page (Integration Test)
1. Navigate to Product Catalog: `http://localhost:5173/catalog`
2. Click on any product card
3. On product page, click "Customize Design" button
4. **Expected Results:**
   - Redirects to designer with URL like: `/designer?productId=xxx&template=shirts&designImage=https://...`
   - Product loads from database
   - Product info banner appears at top
   - First product image loads onto canvas
   - Template matches product category

#### Test C: Template Parameter Only
1. Open browser to: `http://localhost:5173/designer?template=hoodie`
2. **Expected Results:**
   - Template selector shows "Hoodie" selected
   - Canvas shows hoodie template (320x380)
   - No loading spinner
   - No product info banner
   - Designer works normally

#### Test D: No Parameters (Default Behavior)
1. Open browser to: `http://localhost:5173/designer`
2. **Expected Results:**
   - Template selector shows "T-Shirt" (default)
   - Canvas shows shirt template (300x350)
   - No loading spinner
   - No product info banner
   - Designer works normally

#### Test E: Invalid Product ID
1. Open browser to: `http://localhost:5173/designer?productId=invalid-id-12345`
2. **Expected Results:**
   - Loading spinner appears
   - Red error banner appears: "Product not found" or "Failed to load product"
   - Template remains on default (shirt)
   - Designer remains functional

#### Test F: Invalid Template
1. Open browser to: `http://localhost:5173/designer?template=invalid`
2. **Expected Results:**
   - Console warning: `[ProductDesigner] Invalid template in URL: invalid`
   - Template falls back to default (shirt)
   - Designer works normally

### 3. Browser Console Checks

Open Developer Tools (F12) and check Console tab:

**Expected Logs (with all parameters):**
```
[ProductDesigner] URL params: {productId: "...", template: "...", designImage: "..."}
[ProductDesigner] Setting template from URL: [template]
[ProductDesigner] Loading product from database: [productId]
[ProductDesigner] Product loaded successfully: {id: "...", name: "...", ...}
[ProductDesigner] Auto-loading design image: [url]
[ProductDesigner] Design image loaded successfully
```

**No errors should appear** - only warnings for invalid values

### 4. Visual Verification

#### Loading State
- Blue banner with spinner
- Text: "Loading product information..."
- Appears briefly during database query

#### Success State
- Green banner with checkmark icon
- Shows: "Customizing: [Product Name]"
- Shows: Product description
- Shows: Price and category
- Banner stays visible throughout session

#### Error State
- Red banner with warning icon
- Shows: Error message
- Designer remains functional

#### Canvas State
- Design image appears at coordinates (280, 150)
- Image is scaled to max 200px (maintains aspect ratio)
- Image can be moved, resized, rotated like any element
- Image appears immediately on load (no delay)

### 5. Functional Tests

#### Template Switching
1. Load designer with `?template=shirt`
2. Manually change template to "Tumbler"
3. **Expected:** Template changes, URL parameter ignored after initial load

#### Add to Cart
1. Load designer with product
2. Add elements to canvas
3. Click "Add to Cart"
4. **Expected:** Cart item uses loaded product info (if available)

#### Download Design
1. Load designer with design image
2. Click "Download PNG"
3. **Expected:** Downloaded image includes auto-loaded design

### 6. Database Integration Test

**Prerequisites:** Need at least one product in Supabase

1. Get a real product ID from database:
   - Open Supabase dashboard
   - Go to Table Editor → products
   - Copy an ID value

2. Test with real product:
   ```
   http://localhost:5173/designer?productId=[REAL_ID]
   ```

3. **Expected Results:**
   - Product loads successfully
   - Green banner shows actual product data
   - Template auto-detects from category
   - No errors in console

### 7. Edge Cases

#### Empty Design Image
```
http://localhost:5173/designer?designImage=
```
**Expected:** No image loads, no errors

#### Null Design Image
```
http://localhost:5173/designer?designImage=null
```
**Expected:** No image loads, no errors

#### Undefined Design Image
```
http://localhost:5173/designer?designImage=undefined
```
**Expected:** No image loads, no errors

#### Invalid Image URL
```
http://localhost:5173/designer?designImage=https://invalid-url.com/image.png
```
**Expected:** Console error logged, no UI error shown

#### Mixed Valid/Invalid Parameters
```
http://localhost:5173/designer?productId=invalid&template=shirt&designImage=https://picsum.photos/200
```
**Expected:**
- Error for invalid productId
- Template sets to shirt
- Image loads successfully

### 8. Performance Checks

#### Load Time
- Page should load in < 1 second
- Database query should complete in < 500ms
- Image load should be async (non-blocking)

#### Memory
- No memory leaks on repeated navigation
- Images properly garbage collected
- Event listeners cleaned up on unmount

#### Network
- Only one database query per productId
- No repeated image requests
- No unnecessary re-renders

## Troubleshooting

### Issue: "Product not found" but product exists
**Solution:** Check Supabase RLS policies for products table

### Issue: Image doesn't load
**Solution:**
- Check CORS headers on image URL
- Verify URL is valid and accessible
- Check browser console for specific error

### Issue: Template doesn't change
**Solution:**
- Verify URL parameter is spelled correctly: `template` not `Template`
- Check value is one of: shirt, tumbler, hoodie
- Look for console warning about invalid template

### Issue: Console errors on load
**Solution:**
- Check all imports are correct
- Verify Supabase client is initialized
- Check environment variables are set

### Issue: URL parameters not parsed
**Solution:**
- Verify react-router-dom is installed
- Check useSearchParams is imported
- Ensure component is wrapped in Router

## Success Criteria Checklist

- [ ] URL parameters are parsed correctly
- [ ] productId triggers database query
- [ ] Product loads and displays in green banner
- [ ] template parameter sets initial template
- [ ] designImage parameter auto-loads image
- [ ] Loading state shows during async operations
- [ ] Error state shows for invalid productId
- [ ] Invalid parameters are handled gracefully
- [ ] Console logs show detailed execution flow
- [ ] No TypeScript errors
- [ ] No runtime errors
- [ ] Existing designer features still work
- [ ] Performance is acceptable (< 1s load)
- [ ] Integration with ProductPage works

## Browser Compatibility

Tested and working on:
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari
- [ ] Mobile Chrome
- [ ] Mobile Safari

## Notes

- URL parameters only affect initial load, not subsequent template changes
- Product info banner persists throughout session
- Design image only auto-loads once on initial mount
- Multiple navigation to same URL won't reload product (React optimization)
- To force reload, use browser refresh (F5)
