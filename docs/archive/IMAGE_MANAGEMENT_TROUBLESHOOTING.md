# Image Management Troubleshooting Guide

## Issue: Set as Main Image Not Working

### Quick Test Steps

1. **Open Browser Console** (F12 or right-click > Inspect > Console)

2. **Set a Main Image:**
   - Go to `/admin?tab=products`
   - Click edit (✏️) on any product with multiple images
   - Hover over a non-main image
   - Click the yellow ⭐ button

3. **Check Console Logs:**
   You should see:
   ```
   🔄 Setting main image: https://storage.googleapis.com/...
   📝 Updating database with new image order: [Array of URLs]
   ✅ Database updated, reloading products...
   ✅ Main image updated successfully
   ```

4. **Verify Database:**
   ```sql
   SELECT
     name,
     images[1] as main_image,
     array_length(images, 1) as total_images
   FROM products
   WHERE id = '<your-product-id>';
   ```

### Common Issues

#### 1. Button Not Clickable
**Symptom:** No console logs appear when clicking ⭐

**Possible Causes:**
- Button is hidden behind another element
- Click handler not attached
- Button is disabled

**Fix:**
- Check that the image has `className="relative group"`
- Verify button has `onClick={() => handleSetMainImage(...)}`
- Make sure you're clicking the yellow star, not the delete button

#### 2. Database Not Updating
**Symptom:** Console shows logs but database unchanged

**Possible Causes:**
- Supabase RLS policy blocking update
- Network error
- Invalid product ID

**Fix:**
- Check Network tab for 401/403 errors
- Verify you're logged in as admin
- Check `updated_at` timestamp in database

#### 3. Catalog Not Refreshing
**Symptom:** Database updated but catalog shows old image

**Possible Causes:**
- Browser cache
- ProductCatalog not reloading
- Image URL cached by browser

**Fixes:**
1. Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. Clear browser cache
3. Check if `location.pathname` dependency is working in ProductCatalog useEffect

### Manual Test

Try this manual database update to verify the catalog refresh works:

```sql
-- Update a specific product's main image
UPDATE products
SET images = ARRAY[
  'https://new-main-image-url.png',
  'https://old-image-1.png',
  'https://old-image-2.png'
]
WHERE id = '<product-id>';
```

Then navigate to `/catalog` and verify the new main image shows.

### Current Status

**What's Working:**
- ✅ Delete image button
- ✅ Visual "Main" badge
- ✅ Hover effects

**What's Not Working:**
- ❌ Set as main image (investigating)
- ❌ Catalog refresh after setting main image

### Debug Information Needed

Please provide:
1. Browser console output when clicking ⭐
2. Network tab - any errors?
3. Which product you're testing with (ID or name)
4. What image you're trying to set as main (source, nobg, mockup, upscaled?)

---

**Last Updated:** 2025-11-08
**Status:** Debugging in progress
