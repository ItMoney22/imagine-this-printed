import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import { uploadImageFromBase64 } from '../services/google-cloud-storage.js'

const router = Router()

/**
 * Helper function to check if user is admin
 */
async function isAdmin(userId: string): Promise<boolean> {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    console.error('[mockups] Error fetching user profile:', error)
    return false
  }

  return profile.role === 'admin'
}

/**
 * GET /api/mockups - List mockups (filterable by category/view_type)
 * Public endpoint - no authentication required
 */
router.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const { category, view_type, is_active } = req.query

    let query = supabase
      .from('product_mockups')
      .select('*')
      .order('created_at', { ascending: false })

    // Apply filters if provided
    if (category) {
      query = query.eq('category', category)
    }

    if (view_type) {
      query = query.eq('view_type', view_type)
    }

    if (is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true')
    }

    const { data: mockups, error } = await query

    if (error) {
      console.error('[mockups] Error fetching mockups:', error)
      return res.status(500).json({ error: 'Failed to fetch mockups' })
    }

    return res.json({ ok: true, mockups: mockups || [] })
  } catch (error: any) {
    console.error('[mockups] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/mockups - Create mockup (admin only, uploads to GCS)
 */
router.post('/', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user is admin
    const adminCheck = await isAdmin(userId)
    if (!adminCheck) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' })
    }

    const {
      name,
      category,
      view_type,
      mockup_image, // base64 data URL
      thumbnail,
      print_area,
      is_active = true,
      metadata
    } = req.body

    // Validate required fields
    if (!name || !category || !view_type || !mockup_image) {
      return res.status(400).json({
        error: 'Missing required fields: name, category, view_type, mockup_image'
      })
    }

    // Validate category
    const validCategories = ['shirts', 'hoodies', 'tumblers']
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
      })
    }

    // Validate view_type
    const validViewTypes = ['front', 'back', 'side', 'flat-lay', 'lifestyle']
    if (!validViewTypes.includes(view_type)) {
      return res.status(400).json({
        error: `Invalid view_type. Must be one of: ${validViewTypes.join(', ')}`
      })
    }

    // Upload mockup image to GCS
    const timestamp = Date.now()
    const mockupPath = `mockups/${category}/${timestamp}.png`
    console.log('[mockups] Uploading mockup image to GCS:', mockupPath)

    let mockupImageUrl: string
    try {
      const result = await uploadImageFromBase64(mockup_image, mockupPath)
      mockupImageUrl = result.publicUrl
      console.log('[mockups] Mockup image uploaded successfully:', mockupImageUrl)
    } catch (uploadError: any) {
      console.error('[mockups] Error uploading mockup image:', uploadError)
      return res.status(500).json({
        error: 'Failed to upload mockup image',
        detail: uploadError.message
      })
    }

    // Upload thumbnail if provided
    let thumbnailUrl: string | null = null
    if (thumbnail) {
      const thumbnailPath = `mockups/${category}/${timestamp}_thumb.png`
      try {
        const result = await uploadImageFromBase64(thumbnail, thumbnailPath)
        thumbnailUrl = result.publicUrl
        console.log('[mockups] Thumbnail uploaded successfully:', thumbnailUrl)
      } catch (uploadError: any) {
        console.error('[mockups] Error uploading thumbnail:', uploadError)
        // Continue without thumbnail - not critical
      }
    }

    // Insert mockup into database
    const { data: mockup, error: insertError } = await supabase
      .from('product_mockups')
      .insert({
        name,
        category,
        view_type,
        mockup_image_url: mockupImageUrl,
        thumbnail_url: thumbnailUrl,
        print_area: print_area || null,
        is_active,
        metadata: metadata || null,
        created_by: userId,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[mockups] Error inserting mockup:', insertError)
      return res.status(500).json({ error: 'Failed to create mockup' })
    }

    console.log('[mockups] Mockup created successfully:', mockup.id)

    return res.status(201).json({ ok: true, mockup })
  } catch (error: any) {
    console.error('[mockups] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/mockups/:id - Update mockup (admin only)
 */
router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const mockupId = req.params.id

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user is admin
    const adminCheck = await isAdmin(userId)
    if (!adminCheck) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' })
    }

    if (!mockupId) {
      return res.status(400).json({ error: 'Mockup ID is required' })
    }

    const {
      name,
      category,
      view_type,
      mockup_image, // optional - only update if provided
      thumbnail,
      print_area,
      is_active,
      metadata
    } = req.body

    // Check if mockup exists
    const { data: existingMockup, error: fetchError } = await supabase
      .from('product_mockups')
      .select('*')
      .eq('id', mockupId)
      .single()

    if (fetchError || !existingMockup) {
      return res.status(404).json({ error: 'Mockup not found' })
    }

    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString()
    }

    if (name !== undefined) updateData.name = name
    if (category !== undefined) {
      const validCategories = ['shirts', 'hoodies', 'tumblers']
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        })
      }
      updateData.category = category
    }
    if (view_type !== undefined) {
      const validViewTypes = ['front', 'back', 'side', 'flat-lay', 'lifestyle']
      if (!validViewTypes.includes(view_type)) {
        return res.status(400).json({
          error: `Invalid view_type. Must be one of: ${validViewTypes.join(', ')}`
        })
      }
      updateData.view_type = view_type
    }
    if (print_area !== undefined) updateData.print_area = print_area
    if (is_active !== undefined) updateData.is_active = is_active
    if (metadata !== undefined) updateData.metadata = metadata

    // Handle mockup image update
    if (mockup_image) {
      const timestamp = Date.now()
      const mockupPath = `mockups/${existingMockup.category}/${timestamp}.png`
      try {
        const result = await uploadImageFromBase64(mockup_image, mockupPath)
        updateData.mockup_image_url = result.publicUrl
        console.log('[mockups] Updated mockup image:', result.publicUrl)
      } catch (uploadError: any) {
        console.error('[mockups] Error uploading mockup image:', uploadError)
        return res.status(500).json({
          error: 'Failed to upload mockup image',
          detail: uploadError.message
        })
      }
    }

    // Handle thumbnail update
    if (thumbnail) {
      const timestamp = Date.now()
      const thumbnailPath = `mockups/${existingMockup.category}/${timestamp}_thumb.png`
      try {
        const result = await uploadImageFromBase64(thumbnail, thumbnailPath)
        updateData.thumbnail_url = result.publicUrl
        console.log('[mockups] Updated thumbnail:', result.publicUrl)
      } catch (uploadError: any) {
        console.error('[mockups] Error uploading thumbnail:', uploadError)
        // Continue without thumbnail update - not critical
      }
    }

    // Update mockup in database
    const { data: updatedMockup, error: updateError } = await supabase
      .from('product_mockups')
      .update(updateData)
      .eq('id', mockupId)
      .select()
      .single()

    if (updateError) {
      console.error('[mockups] Error updating mockup:', updateError)
      return res.status(500).json({ error: 'Failed to update mockup' })
    }

    console.log('[mockups] Mockup updated successfully:', mockupId)

    return res.json({ ok: true, mockup: updatedMockup })
  } catch (error: any) {
    console.error('[mockups] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/mockups/:id - Delete mockup (admin only)
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const mockupId = req.params.id

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user is admin
    const adminCheck = await isAdmin(userId)
    if (!adminCheck) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' })
    }

    if (!mockupId) {
      return res.status(400).json({ error: 'Mockup ID is required' })
    }

    // Check if mockup exists
    const { data: existingMockup, error: fetchError } = await supabase
      .from('product_mockups')
      .select('*')
      .eq('id', mockupId)
      .single()

    if (fetchError || !existingMockup) {
      return res.status(404).json({ error: 'Mockup not found' })
    }

    // Delete mockup from database
    const { error: deleteError } = await supabase
      .from('product_mockups')
      .delete()
      .eq('id', mockupId)

    if (deleteError) {
      console.error('[mockups] Error deleting mockup:', deleteError)
      return res.status(500).json({ error: 'Failed to delete mockup' })
    }

    console.log('[mockups] Mockup deleted successfully:', mockupId)

    // Note: We don't delete the GCS files to maintain historical records
    // and avoid breaking links in case they're referenced elsewhere

    return res.json({
      ok: true,
      message: 'Mockup deleted successfully',
      id: mockupId
    })
  } catch (error: any) {
    console.error('[mockups] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
