import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import { uploadImageFromBase64 } from '../services/google-cloud-storage.js'
import Replicate from 'replicate'

const router = Router()

// Initialize Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!
})

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

// Product preview prompts for ITP Enhance Engine mockups
const PRODUCT_PROMPTS: Record<string, string> = {
  'tshirt-black': 'Professional product photography of a black t-shirt lying flat on a white background, with a custom graphic design printed on the chest area. The t-shirt is displayed flat lay style, neatly arranged, showing the full front of the shirt. High quality product photography, soft shadows, clean white background.',
  'hoodie-black': 'Professional product photography of a black hoodie lying flat on a white background, with a custom graphic design printed on the chest area. The hoodie is displayed flat lay style with the hood neatly arranged above, showing the full front. High quality product photography, soft shadows, clean white background.',
  'tumbler': 'Professional product photography of a stainless steel tumbler with a custom graphic design wrap printed around the body. The tumbler is standing upright on a white background, showing the design clearly. High quality product photography, reflective surface, soft shadows.',
  'metal-print-4x6': 'Professional product photography of a 4x6 inch metal print with a custom graphic design displayed on it. The metal print is leaning at a slight angle against a neutral background, showing chromaluxe glossy finish with vibrant colors. High quality product photography.',
  'metal-print-8x10': 'Professional product photography of a 8x10 inch metal print with a custom graphic design displayed on it. The metal print is mounted on a wall, showing the full design with chromaluxe glossy finish and vibrant colors. High quality product photography.',
}

/**
 * POST /api/mockups/itp-enhance
 * Generate product preview mockup using ITP Enhance Engine
 * FREE for product preview - no ITC charge
 */
router.post('/itp-enhance', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { design_url, product_type, mockup_type } = req.body

    if (!design_url || !product_type) {
      return res.status(400).json({
        error: 'Missing required fields: design_url, product_type'
      })
    }

    const prompt = PRODUCT_PROMPTS[product_type]
    if (!prompt) {
      return res.status(400).json({
        error: `Unknown product type: ${product_type}. Valid types: ${Object.keys(PRODUCT_PROMPTS).join(', ')}`
      })
    }

    console.log(`[mockups/itp-enhance] Generating ${product_type} mockup for user ${userId}`)
    console.log(`[mockups/itp-enhance] Design URL: ${design_url.substring(0, 100)}...`)

    // Call Replicate ITP Enhance Engine API
    const itpEnhanceModel = "google/itp-enhance:858e56734846d24469ed35a07ca2161aaf4f83588d7060e32964926e1b73b7be"

    const output = await replicate.run(
      itpEnhanceModel as any,
      {
        input: {
          prompt: prompt,
          image_input: [design_url],
          output_format: "png",
          aspect_ratio: "1:1"
        }
      }
    )

    // Handle output (URL string, array, or async iterator)
    let mockupUrl: string | null = null

    if (typeof output === 'string') {
      mockupUrl = output
    } else if (Array.isArray(output) && output.length > 0) {
      mockupUrl = output[0]
    } else if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
      // Handle async iterator
      const outputs: string[] = []
      for await (const item of output as AsyncIterable<any>) {
        if (typeof item === 'string') {
          outputs.push(item)
        } else if (item && typeof item === 'object' && 'url' in item) {
          outputs.push(item.url)
        }
      }
      if (outputs.length > 0) {
        mockupUrl = outputs[0]
      }
    }

    if (!mockupUrl) {
      console.error('[mockups/itp-enhance] No valid output from ITP Enhance Engine:', output)
      return res.status(500).json({ error: 'Failed to generate mockup' })
    }

    console.log(`[mockups/itp-enhance] ✅ Mockup generated: ${mockupUrl.substring(0, 100)}...`)

    return res.json({
      ok: true,
      mockup_url: mockupUrl,
      product_type,
      mockup_type
    })

  } catch (error: any) {
    console.error('[mockups/itp-enhance] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
