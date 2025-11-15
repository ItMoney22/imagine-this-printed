# Product System Improvements Needed

**Date**: 2025-11-08
**Status**: Needs Extensive Work
**Priority**: High

---

## Issues Identified

### 1. Database Schema Mismatch
- **Problem**: Code was using `in_stock` column which doesn't exist in the database
- **Database Actually Has**: `is_active` (boolean) and `status` (text: 'draft', 'active', 'published', etc.)
- **Impact**: Product creation, updates, and filtering all failing

### 2. Files Fixed (So Far)
✅ `src/components/AdminCreateProductWizard.tsx` - Fixed line 156
✅ `src/pages/AdminDashboard.tsx` - Fixed 5 locations (lines 138, 213, 458, 544, 554, 1929, 1934)
✅ `src/pages/ProductCatalog.tsx` - Fixed 2 locations (lines 25, 37)

### 3. Product Status Management Issues
- Products created via AI Builder were stuck in 'draft' status
- Changing status dropdown in Admin Dashboard wasn't working properly
- ProductCatalog wasn't showing products because of incorrect filtering
- **Temporary Fix**: Manually updated 47 products from draft to active status via SQL

---

## Areas That Need Extensive Work

### 1. Product Data Model Consistency
- [ ] Audit ALL files for `in_stock` vs `is_active` usage
- [ ] Create TypeScript interface that matches actual database schema
- [ ] Update `src/types/index.ts` Product type definition
- [ ] Ensure consistency between frontend types and database schema

### 2. Product Lifecycle Management
- [ ] Define clear product states: draft → review → active → archived
- [ ] Implement proper state transitions with validation
- [ ] Add status change history/audit trail
- [ ] Create admin workflow for approving/publishing products

### 3. Product Image Management
- [ ] Review image upload flow (currently broken)
- [ ] Fix Google Cloud Storage integration
- [ ] Implement proper image validation (size, format, dimensions)
- [ ] Add image optimization/compression
- [ ] Create fallback images for missing product images
- [ ] Fix mockup generation and display

### 4. Product Creation Flow (AI Builder)
- [ ] Test end-to-end product creation
- [ ] Fix Step 4 approval process (was failing due to in_stock issue)
- [ ] Validate all required fields before submission
- [ ] Add progress indicators for long-running AI operations
- [ ] Implement proper error handling and retry logic
- [ ] Add ability to save as draft and resume later

### 5. Product Display & Filtering
- [ ] Fix ProductCatalog filtering logic
- [ ] Implement category filtering properly
- [ ] Add search functionality
- [ ] Add sorting options (price, date, popularity)
- [ ] Implement pagination for large product lists
- [ ] Add "no products found" states with better UX

### 6. Product Editing
- [ ] Fix inline editing in Admin Dashboard
- [ ] Validate field changes before saving
- [ ] Add undo/redo for product changes
- [ ] Implement bulk edit operations
- [ ] Add versioning/revision history

### 7. Product Variations & Options
- [ ] Review variation system (size, color, material)
- [ ] Fix pricing calculations with variations
- [ ] Implement SKU management for variations
- [ ] Add inventory tracking per variation

### 8. Mass Operations
- [ ] Fix mass delete (currently broken - mentioned by user)
- [ ] Implement mass publish/unpublish
- [ ] Add mass category update
- [ ] Implement mass price update
- [ ] Add export/import functionality (CSV/Excel)

### 9. Product Publishing Workflow
- [ ] Fix publish button functionality
- [ ] Add pre-publish validation checklist:
  - Required images present
  - Price set and valid
  - Description complete
  - Category assigned
  - All mockups generated
- [ ] Implement scheduled publishing
- [ ] Add publish confirmation with preview

### 10. Integration Issues
- [ ] Fix Replicate API integration for image generation
- [ ] Fix background removal service (Remove.bg)
- [ ] Fix mockup generation workflow
- [ ] Fix upscale functionality (mentioned as "stuck")
- [ ] Verify Google Cloud Storage uploads are working

---

## Known Bugs to Fix

1. **Mass Delete Not Working** (user reported)
2. **Publishing Products Not Working** (user reported)
3. **Mockup Display Issues** (user reported)
4. **Upscale Stuck** (user reported)
5. **Status Toggle Not Updating UI** (partially fixed, needs testing)
6. **Product Images Not Showing in Catalog** (may be related to GCS paths)

---

## Database Schema Review Needed

### Current `products` Table Schema
```sql
- id: uuid
- name: text (required)
- description: text
- price: numeric (required)
- images: text[] (array)
- category: text
- sku: text
- is_active: boolean (default: true) ← KEY FIELD
- is_featured: boolean (default: false)
- metadata: jsonb (default: {})
- created_at: timestamp
- updated_at: timestamp
- vendor_id: uuid
- category_id: uuid
- slug: text
- status: text (default: 'draft') ← KEY FIELD
```

### Missing Columns That Might Be Needed
- `stock_quantity`: integer (for inventory management)
- `weight`: numeric (for shipping calculations)
- `dimensions`: jsonb (length, width, height)
- `tags`: text[] (for search/filtering)
- `seo_title`: text
- `seo_description`: text

---

## Recommended Approach for Next Session

### Phase 1: Database Audit (30 min)
1. Search entire codebase for `in_stock` references
2. Replace ALL with `is_active`
3. Verify no hardcoded column names

### Phase 2: Product Type Definitions (15 min)
1. Update TypeScript types to match database exactly
2. Create proper interfaces for product variations
3. Add JSDoc comments for clarity

### Phase 3: Product Creation Flow (1-2 hours)
1. Test AI Product Builder end-to-end
2. Fix any broken steps
3. Add proper validation at each step
4. Implement save-as-draft functionality
5. Add better error messages

### Phase 4: Product Display (30 min)
1. Fix ProductCatalog display
2. Add proper loading states
3. Fix image display issues
4. Implement basic filtering/search

### Phase 5: Admin Dashboard (1 hour)
1. Fix inline editing
2. Fix mass operations (delete, publish, etc.)
3. Add bulk actions dropdown
4. Improve status management UI

### Phase 6: Integration Testing (1 hour)
1. Test full workflow: Create → Edit → Publish → Display
2. Test with real images/mockups
3. Verify GCS uploads working
4. Test Replicate API integrations

---

## Files That Need Attention

### High Priority
- `src/pages/AdminDashboard.tsx` - Core product management
- `src/pages/AdminAIProductBuilder.tsx` - Product creation
- `src/components/AdminCreateProductWizard.tsx` - Wizard component
- `src/pages/ProductCatalog.tsx` - Public display
- `src/pages/ProductManagement.tsx` - Admin product list
- `backend/worker/ai-jobs-worker.ts` - AI processing

### Medium Priority
- `src/types/index.ts` - Type definitions
- `src/pages/ProductPage.tsx` - Individual product view
- `backend/services/replicate.js` - AI image generation
- `backend/services/google-cloud-storage.js` - File uploads

### Low Priority (Review Later)
- Product-related API routes in backend
- Product recommendations system
- Product search functionality

---

## Search Commands for Next Session

```bash
# Find all references to in_stock
grep -r "in_stock" src/
grep -r "in_stock" backend/

# Find all product-related files
find src/ -name "*Product*"
find src/pages/ -name "*product*" -o -name "*Product*"

# Find database queries
grep -r "\.from('products')" src/
grep -r "supabase.*products" src/
```

---

## Questions to Answer

1. Should we keep both `status` and `is_active` columns or consolidate?
2. What are the official product lifecycle states?
3. Who can publish products? (admin only, or vendors too?)
4. Should there be an approval workflow for vendor-submitted products?
5. How should inventory be tracked? (simple boolean vs. quantity)
6. What happens to orders when a product is unpublished/deleted?

---

## Related Documentation

- `docs/PRODUCTION_READINESS_CHECKLIST.md` - Production prep tasks
- `docs/AI_PRODUCT_BUILDER.md` - AI builder documentation
- `backend/worker/ai-jobs-worker.ts` - Worker implementation
- `CLAUDE.md` - Project overview and architecture

---

## Notes from Session

- User reported: "i am changing the status to active and its not working its not showing up as products and its not changing the status"
- Root cause: `in_stock` column doesn't exist, should be `is_active`
- 47 products were manually updated from draft to active status
- User wants to continue this work in another chat session
- User emphasized: "the product needs some extensive work"

---

**IMPORTANT**: This is a critical system that affects the entire e-commerce flow. Take time to do it right. Don't rush fixes - understand the full scope first.
