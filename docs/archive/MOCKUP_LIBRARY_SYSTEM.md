# Mockup Library System - Implementation Plan

## Overview
Since Envato Elements doesn't provide API access, we'll build a custom **Mockup Library Manager** where you can upload blank mockup templates from Envato and configure them for use in the Product Designer.

## System Architecture

### Database Schema

#### New Table: `product_mockups`
```sql
CREATE TABLE product_mockups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- 'shirts', 'hoodies', 'tumblers', etc.
  view_type TEXT NOT NULL, -- 'front', 'back', 'side', 'flat-lay', 'lifestyle'
  mockup_image_url TEXT NOT NULL, -- GCS URL to blank mockup
  thumbnail_url TEXT, -- Optional thumbnail
  print_area JSONB NOT NULL, -- {x, y, width, height, rotation}
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  metadata JSONB -- Extra info (source, envato_id, etc.)
);

CREATE INDEX idx_product_mockups_category ON product_mockups(category);
CREATE INDEX idx_product_mockups_active ON product_mockups(is_active);
```

#### Example Data:
```json
{
  "id": "...",
  "name": "White T-Shirt Front View",
  "category": "shirts",
  "view_type": "front",
  "mockup_image_url": "https://storage.googleapis.com/mockups/tshirt-white-front.png",
  "print_area": {
    "x": 0.25,      // 25% from left
    "y": 0.30,      // 30% from top
    "width": 0.50,  // 50% of mockup width
    "height": 0.40, // 40% of mockup height
    "rotation": 0   // degrees
  },
  "is_active": true,
  "metadata": {
    "source": "envato",
    "envato_id": "12345678",
    "color": "white",
    "resolution": "4000x4000"
  }
}
```

### Admin Mockup Manager Interface

**Location:** `/admin/mockups`

**Features:**
1. Upload blank mockup images
2. Configure print area (drag & drop rectangle)
3. Preview mockup with test design
4. Organize by category and view type
5. Activate/deactivate mockups
6. Search and filter mockups

### User Flow

```
Admin (You) Flow:
1. Download blank mockups from Envato Elements
2. Go to /admin/mockups
3. Click "Upload New Mockup"
4. Upload mockup image (stores in GCS)
5. Select category (shirts, hoodies, etc.)
6. Select view type (front, back, etc.)
7. Define print area using visual editor
8. Save mockup to database

Customer Flow:
1. Go to product page
2. Click "Customize Design"
3. Designer loads available mockups for that product category
4. Customer edits design on canvas
5. Live preview shows design on mockup(s)
6. Click "Generate Realistic Preview" → Nano Banana API
7. Add to cart with final mockup
```

## Implementation

### Step 1: Database Migration

**File:** `migrations/add_product_mockups_table.sql`

```sql
-- Create product_mockups table
CREATE TABLE IF NOT EXISTS product_mockups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  view_type TEXT NOT NULL,
  mockup_image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  print_area JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_product_mockups_category ON product_mockups(category);
CREATE INDEX idx_product_mockups_view_type ON product_mockups(view_type);
CREATE INDEX idx_product_mockups_active ON product_mockups(is_active);

-- RLS Policies
ALTER TABLE product_mockups ENABLE ROW LEVEL SECURITY;

-- Everyone can read active mockups
CREATE POLICY "Anyone can view active mockups"
  ON product_mockups FOR SELECT
  USING (is_active = true);

-- Only admins can insert/update/delete
CREATE POLICY "Admins can manage mockups"
  ON product_mockups FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_product_mockups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_product_mockups_updated_at
  BEFORE UPDATE ON product_mockups
  FOR EACH ROW
  EXECUTE FUNCTION update_product_mockups_updated_at();
```

### Step 2: Backend API Endpoints

**File:** `backend/routes/mockups.ts`

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/supabaseAuth.js';
import { supabase } from '../lib/supabase.js';
import { uploadImageFromBase64 } from '../services/google-cloud-storage.js';

const router = Router();

// GET /api/mockups - List all active mockups (public)
router.get('/', async (req, res) => {
  try {
    const { category, view_type } = req.query;

    let query = supabase
      .from('product_mockups')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (category) query = query.eq('category', category);
    if (view_type) query = query.eq('view_type', view_type);

    const { data, error } = await query;

    if (error) throw error;

    return res.json({ ok: true, mockups: data });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/mockups - Create new mockup (admin only)
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, category, view_type, mockup_image, print_area, metadata } = req.body;

    // Upload mockup image to GCS
    let mockupUrl = null;
    if (mockup_image && mockup_image.startsWith('data:image/')) {
      const timestamp = Date.now();
      const destinationPath = `mockups/${category}/${timestamp}.png`;
      const uploadResult = await uploadImageFromBase64(mockup_image, destinationPath);
      mockupUrl = uploadResult.publicUrl;
    } else {
      return res.status(400).json({ error: 'mockup_image is required' });
    }

    // Insert mockup into database
    const { data: mockup, error } = await supabase
      .from('product_mockups')
      .insert({
        name,
        category,
        view_type,
        mockup_image_url: mockupUrl,
        print_area,
        created_by: userId,
        metadata: metadata || {}
      })
      .select()
      .single();

    if (error) throw error;

    return res.json({ ok: true, mockup });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// PATCH /api/mockups/:id - Update mockup (admin only)
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.sub;

    // Check admin status
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId!)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const updates = req.body;

    const { data, error } = await supabase
      .from('product_mockups')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ ok: true, mockup: data });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/mockups/:id - Delete mockup (admin only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.sub;

    // Check admin status
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId!)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { error } = await supabase
      .from('product_mockups')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.json({ ok: true, message: 'Mockup deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
```

### Step 3: Admin Mockup Manager Page

**File:** `src/pages/AdminMockupManager.tsx`

Features:
- Upload mockup images
- Visual print area editor (drag rectangle)
- Preview with test design
- List/grid view of mockups
- Filter by category and view type
- Activate/deactivate
- Edit and delete

### Step 4: Print Area Visual Editor

Interactive canvas where admin can:
1. See mockup image
2. Drag rectangle to define print area
3. Resize handles on corners
4. Show percentage values
5. Test with sample design
6. Save configuration

## Envato Mockup Workflow

### What You'll Do:

1. **Browse Envato Elements Mockups**
   - Search for "blank t-shirt mockup"
   - Search for "blank hoodie mockup"
   - Search for "blank tumbler mockup"
   - Download high-res PSD/PNG files

2. **Export Blank Mockups**
   - Open in Photoshop/Figma
   - Export as PNG (transparent background preferred)
   - Multiple angles: front, back, side
   - Multiple colors if desired

3. **Upload to System**
   - Go to `/admin/mockups`
   - Upload each mockup
   - Configure print area visually
   - Add metadata (color, angle, source)

4. **Use in Designer**
   - Customers see your uploaded mockups
   - Designs apply to defined print area
   - Nano Banana generates realistic version

## Recommended Mockup Collection

### Phase 1 - Essential Mockups
- ✅ White T-Shirt Front
- ✅ Black T-Shirt Front
- ✅ White Hoodie Front
- ✅ Black Tumbler (360° view)

### Phase 2 - Extended Views
- T-Shirt Back View
- Hoodie Back View
- T-Shirt Flat Lay
- Hoodie Lifestyle (person wearing)

### Phase 3 - Color Variants
- Gray T-Shirt
- Navy T-Shirt
- Multiple hoodie colors
- Tumbler color variants

### Phase 4 - Additional Products
- Tank tops
- Long sleeve shirts
- Mugs
- Phone cases
- Tote bags

## Cost Analysis

**Envato Elements Subscription:** You already have this ✅
**GCS Storage:** ~$0.026/GB per month for mockup images
**Nano Banana:** $0.10 per realistic preview generation (charged in ITC)

**Total New Cost:** Essentially free (just storage)

## Benefits of Custom Mockup Library

1. **Full Control:** Choose exact mockups you want
2. **Quality:** Use high-res Envato mockups
3. **Flexibility:** Add new products anytime
4. **No API Limits:** Unlimited mockup usage
5. **Brandable:** Use mockups that match your brand
6. **Reusable:** One mockup, infinite designs
7. **Scalable:** Add more categories as you grow

## Implementation Timeline

1. **Database Setup** (30 min)
   - Run migration
   - Test RLS policies

2. **Backend API** (1 hour)
   - Create mockup routes
   - Image upload to GCS
   - CRUD operations

3. **Admin Manager** (3 hours)
   - Upload interface
   - Print area editor
   - Mockup list/grid
   - Edit/delete functions

4. **Designer Integration** (2 hours)
   - Load mockups by category
   - Apply design to print area
   - Live preview composite
   - Nano Banana button

5. **Testing** (1 hour)
   - Upload test mockups
   - Test designer integration
   - Test Nano Banana generation

**Total: ~7.5 hours**

## Next Steps

1. Run database migration
2. Create mockup API routes
3. Build admin mockup manager
4. Download your first batch of mockups from Envato
5. Upload and configure them
6. Integrate into ProductDesigner

Ready to start building?
