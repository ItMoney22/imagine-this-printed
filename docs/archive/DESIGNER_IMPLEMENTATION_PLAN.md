# Product Designer Mockup Redesign - Implementation Plan

## Overview
Redesign the Product Designer to show realistic product mockups with hybrid preview system (Option C), and enable graphics to be passed from product pages.

## Working Directory
`E:\Projects for MetaSphere\imagine-this-printed`

## Tasks

### Task 1: Create Database Migration for product_mockups Table
**Goal:** Add new table to store mockup templates with print area configuration

**Implementation:**
1. Create migration file: `migrations/add_product_mockups_table.sql`
2. Add table with columns:
   - id (UUID primary key)
   - name (text)
   - category (text) - 'shirts', 'hoodies', 'tumblers'
   - view_type (text) - 'front', 'back', 'side', 'flat-lay', 'lifestyle'
   - mockup_image_url (text) - GCS URL
   - thumbnail_url (text, optional)
   - print_area (jsonb) - {x, y, width, height, rotation}
   - is_active (boolean)
   - created_at, updated_at (timestamps)
   - created_by (UUID reference to auth.users)
   - metadata (jsonb)
3. Add indexes on category, view_type, is_active
4. Add RLS policies:
   - Public read for active mockups
   - Admin-only write access
5. Apply migration to Supabase using mcp__supabase__apply_migration

**Files to Create:**
- `migrations/add_product_mockups_table.sql`

**Verification:**
- Query the table exists
- Test RLS policies work
- Confirm indexes created

---

### Task 2: Create Backend Mockup API Routes
**Goal:** Backend API for CRUD operations on mockups

**Implementation:**
1. Create `backend/routes/mockups.ts`
2. Implement endpoints:
   - `GET /api/mockups` - List mockups (public, filterable by category/view_type)
   - `POST /api/mockups` - Create mockup (admin only, uploads to GCS)
   - `PATCH /api/mockups/:id` - Update mockup (admin only)
   - `DELETE /api/mockups/:id` - Delete mockup (admin only)
3. Use `requireAuth` middleware for protected routes
4. Check admin role via user_profiles.role
5. Upload mockup images to GCS at `mockups/{category}/{timestamp}.png`
6. Mount router in `backend/index.ts` at `/api/mockups`

**Files to Create:**
- `backend/routes/mockups.ts`

**Files to Modify:**
- `backend/index.ts` - mount router

**Verification:**
- Test GET endpoint returns empty array initially
- Test POST requires auth and admin role
- Test image upload to GCS works

---

### Task 3: Update ProductPage to Pass Context to Designer
**Goal:** "Customize Design" button passes product info via URL

**Implementation:**
1. Modify `src/pages/ProductPage.tsx` line 218
2. Change navigation from:
   ```tsx
   onClick={() => navigate('/designer')}
   ```
   To:
   ```tsx
   onClick={() => navigate(`/designer?productId=${product.id}&template=${product.category}&designImage=${encodeURIComponent(product.images[0] || '')}`)}
   ```
3. Pass productId, template (category), and first product image as designImage

**Files to Modify:**
- `src/pages/ProductPage.tsx`

**Verification:**
- Click "Customize Design" button
- Verify URL contains query params
- No TypeScript errors

---

### Task 4: Add URL Parameter Support to ProductDesigner
**Goal:** Designer reads URL params and loads product context

**Implementation:**
1. Modify `src/pages/ProductDesigner.tsx`
2. Use `useSearchParams` from react-router-dom
3. Parse URL parameters: productId, template, designImage
4. Create state for loaded product data
5. Load product from Supabase if productId present
6. Auto-load design image if designImage present
7. Set initial template based on URL template param

**Files to Modify:**
- `src/pages/ProductDesigner.tsx`

**Verification:**
- Navigate to `/designer?productId=X&template=shirts&designImage=Y`
- Verify product loads from database
- Verify designImage auto-loads to canvas
- Verify template switches to correct type

---

### Task 5: Create Product Template Configuration
**Goal:** Define print area configurations for each product type

**Implementation:**
1. Create `src/utils/product-templates.ts`
2. Export `PRODUCT_TEMPLATES` object with configs for:
   - shirts: print area, mockup base path
   - hoodies: print area, mockup base path
   - tumblers: print area, mockup base path
3. Each template includes:
   ```ts
   {
     name: string,
     printArea: {
       x: number, // percentage 0-1
       y: number,
       width: number,
       height: number,
       rotation: number
     }
   }
   ```

**Files to Create:**
- `src/utils/product-templates.ts`

**Verification:**
- Import and log templates
- Verify percentages are 0-1
- No TypeScript errors

---

### Task 6: Create MockupPreview Component
**Goal:** Right panel component showing mockup with design applied

**Implementation:**
1. Create `src/components/MockupPreview.tsx`
2. Props: designElements, selectedTemplate, mockupImage
3. Use HTML Canvas to composite design onto mockup
4. Show mockup image as background
5. Calculate print area position from template config
6. Render design elements within print area bounds
7. Apply basic perspective transform
8. Add "Generate Realistic Preview" button
9. Show loading state during Nano Banana generation
10. Display ITC cost (25 tokens)

**Files to Create:**
- `src/components/MockupPreview.tsx`

**Verification:**
- Component renders without errors
- Mockup image displays
- Design elements show in print area
- Button appears and is clickable

---

### Task 7: Create Two-Panel Designer Layout
**Goal:** Split ProductDesigner into left (canvas) and right (mockup)

**Implementation:**
1. Modify `src/pages/ProductDesigner.tsx`
2. Create responsive grid layout:
   - Desktop: 50/50 split left/right
   - Mobile: stacked (canvas top, mockup bottom)
3. Left panel: existing Konva canvas (keep current code)
4. Right panel: MockupPreview component
5. Pass design elements to MockupPreview for live update
6. Add visual print area boundaries to Konva canvas
7. Constrain design elements to print area (optional warning if outside)

**Files to Modify:**
- `src/pages/ProductDesigner.tsx`

**Dependencies:**
- Task 6 (MockupPreview component)

**Verification:**
- Layout splits correctly on desktop
- Layout stacks correctly on mobile
- Canvas edits appear in MockupPreview
- Print area boundaries visible

---

### Task 8: Implement Client-Side Mockup Composite
**Goal:** Real-time preview using HTML Canvas (instant, free)

**Implementation:**
1. Create `src/utils/mockup-generator.ts`
2. Export `generateMockupPreview` function
3. Takes: mockup image, design elements, print area config
4. Returns: canvas element with composite
5. Algorithm:
   - Load mockup image to canvas
   - Calculate print area pixel coordinates from percentages
   - Draw each design element scaled/positioned to print area
   - Apply perspective transform matrix (basic)
   - Handle rotation
6. Optimize for performance (debounce updates)

**Files to Create:**
- `src/utils/mockup-generator.ts`

**Verification:**
- Function generates canvas correctly
- Design appears in print area
- Updates happen quickly (<100ms)
- No memory leaks on repeated calls

---

### Task 9: Create Backend Mockup Generation API
**Goal:** Realistic preview endpoint using Nano Banana

**Implementation:**
1. Create `backend/routes/designer.ts`
2. Implement `POST /api/designer/generate-mockup`
3. Request body:
   ```json
   {
     "designImageUrl": "https://...",
     "productTemplate": "shirts",
     "mockupType": "flat"
   }
   ```
4. Use existing Replicate Nano Banana integration
5. Load mockup base from product_mockups table
6. Call Replicate API with design + mockup
7. Upload result to GCS at `designer-mockups/{userId}/{timestamp}.png`
8. Deduct 25 ITC from user wallet
9. Return mockup URL
10. Mount router in `backend/index.ts`

**Files to Create:**
- `backend/routes/designer.ts`

**Files to Modify:**
- `backend/index.ts` - mount router

**Dependencies:**
- Task 1 (product_mockups table)

**Verification:**
- POST request generates mockup
- Replicate API called correctly
- GCS upload succeeds
- ITC balance decreases
- Returns valid URL

---

### Task 10: Integrate Realistic Preview Button
**Goal:** Connect "Generate Realistic Preview" button to backend

**Implementation:**
1. Modify `src/components/MockupPreview.tsx`
2. Add onClick handler for realistic preview button
3. Export current canvas as image data URL
4. Call backend API: `POST /api/designer/generate-mockup`
5. Show loading spinner during generation
6. Display returned mockup image
7. Handle errors (insufficient ITC, API failure)
8. Show success message with cost
9. Update user ITC balance in UI

**Files to Modify:**
- `src/components/MockupPreview.tsx`

**Dependencies:**
- Task 9 (backend API)

**Verification:**
- Button calls API correctly
- Loading state shows
- Realistic mockup displays
- ITC balance updates
- Error handling works

---

### Task 11: Update Save & Cart Flow
**Goal:** Generate final mockup before adding to cart

**Implementation:**
1. Modify `src/pages/ProductDesigner.tsx`
2. Update "Add to Cart" button handler
3. Before adding to cart:
   - Generate final realistic mockup (call Nano Banana)
   - Show preview modal with mockup
   - Confirm with user
   - Add to cart with mockup URL attached
4. Store mockup URL in cart item metadata
5. Update cart display to show mockup thumbnails

**Files to Modify:**
- `src/pages/ProductDesigner.tsx`
- `src/context/CartContext.tsx` (if needed)

**Dependencies:**
- Task 10 (realistic preview integration)

**Verification:**
- "Add to Cart" generates mockup
- Preview modal shows
- Mockup URL stored in cart
- Cart displays mockup correctly

---

### Task 12: Create Admin Mockup Manager Page
**Goal:** Admin interface to upload and configure mockups

**Implementation:**
1. Create `src/pages/AdminMockupManager.tsx`
2. Features:
   - List existing mockups (grid view)
   - Upload new mockup form
   - Image file input
   - Category dropdown (shirts, hoodies, tumblers)
   - View type dropdown (front, back, side, etc.)
   - Print area visual editor (canvas with draggable rectangle)
   - Save button (calls POST /api/mockups)
   - Edit/delete buttons for each mockup
3. Use GCS upload via backend
4. Show preview of mockup with test design
5. Filter mockups by category

**Files to Create:**
- `src/pages/AdminMockupManager.tsx`

**Dependencies:**
- Task 2 (backend API)

**Verification:**
- Page accessible at `/admin/mockups`
- Upload form works
- Print area editor functional
- Mockups save to database
- List displays mockups

---

### Task 13: Add Route for Admin Mockup Manager
**Goal:** Add navigation route for mockup manager

**Implementation:**
1. Modify `src/App.tsx`
2. Add route:
   ```tsx
   <Route path="/admin/mockups" element={<ProtectedRoute><AdminMockupManager /></ProtectedRoute>} />
   ```
3. Modify `src/components/Navbar.tsx`
4. Add "Mockup Manager" link in admin dropdown menu

**Files to Modify:**
- `src/App.tsx`
- `src/components/Navbar.tsx`

**Dependencies:**
- Task 12 (AdminMockupManager component)

**Verification:**
- Route accessible at `/admin/mockups`
- Navigation link appears for admins
- ProtectedRoute works

---

### Task 14: Load Mockups in ProductDesigner
**Goal:** Designer fetches and displays mockups from database

**Implementation:**
1. Modify `src/pages/ProductDesigner.tsx`
2. Add state for available mockups
3. Fetch mockups on mount:
   ```ts
   GET /api/mockups?category=${selectedTemplate}&is_active=true
   ```
4. Display mockup selector dropdown
5. Update MockupPreview when mockup selection changes
6. Load mockup image from mockup_image_url
7. Apply print_area config from selected mockup
8. Fall back to default if no mockups available

**Files to Modify:**
- `src/pages/ProductDesigner.tsx`

**Dependencies:**
- Task 2 (backend API)
- Task 7 (two-panel layout)

**Verification:**
- Mockups load from database
- Dropdown shows available mockups
- Changing selection updates preview
- Print area config applies correctly

---

## Success Criteria

- [ ] Database table created and accessible
- [ ] Backend API routes functional
- [ ] "Customize Design" button passes product context
- [ ] Designer loads product and design from URL
- [ ] Two-panel layout works (responsive)
- [ ] Client-side composite preview (instant)
- [ ] Realistic preview button generates Nano Banana mockup
- [ ] ITC balance deducted correctly
- [ ] Save to cart includes mockup
- [ ] Admin can upload and configure mockups
- [ ] Designer loads mockups from database
- [ ] All TypeScript errors resolved
- [ ] No console errors

## Testing Plan

1. **Database Test:**
   - Create sample mockup via Supabase
   - Verify it appears in API call

2. **Product Page Test:**
   - Click "Customize Design" on product
   - Verify URL params passed

3. **Designer Test:**
   - Load designer with URL params
   - Verify product loads
   - Verify design image auto-loads

4. **Mockup Preview Test:**
   - Edit design on canvas
   - Verify preview updates instantly
   - Click "Generate Realistic"
   - Verify Nano Banana mockup appears

5. **Cart Flow Test:**
   - Add design to cart
   - Verify mockup included
   - Check cart displays mockup

6. **Admin Test:**
   - Upload blank mockup
   - Configure print area
   - Verify saves to database
   - Verify appears in designer

## Estimated Timeline

- Tasks 1-2: Database & API (1.5 hours)
- Tasks 3-4: URL params (30 min)
- Task 5: Templates (30 min)
- Tasks 6-7: Layout & Preview (2 hours)
- Task 8: Client-side composite (1 hour)
- Tasks 9-10: Nano Banana integration (1.5 hours)
- Task 11: Cart flow (30 min)
- Tasks 12-13: Admin manager (2 hours)
- Task 14: Load mockups (30 min)

**Total: ~10 hours**

## Notes

- Use existing Replicate integration from AI Product Builder
- Reuse GCS upload functions
- Keep Konva.js canvas (works well)
- Make responsive (mobile-friendly)
- Add loading states everywhere
- Handle errors gracefully
- Test with real Envato mockups once uploaded
