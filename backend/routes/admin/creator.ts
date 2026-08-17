import { Router, Request, Response } from 'express'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { requireAdmin } from '../../middleware/requireAdmin.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

// Apply authentication and admin authorization to all routes
router.use(requireAuth)
router.use(requireAdmin)

const CREATOR_TERMS_VERSION = '2026-08-09'
const CREATOR_ROYALTY_PERCENT = 15

// POST /api/admin/creator/opt-in - Manually opt-in a user as a creator
router.post('/opt-in', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, royaltyPercent = CREATOR_ROYALTY_PERCENT } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' })
    }

    // 1. Fetch current profile
    const { data: profile, error: fetchError } = await supabase
      .from('user_profiles')
      .select('id, metadata, role')
      .eq('id', userId)
      .single()

    if (fetchError || !profile) {
      console.error('[admin/creator/opt-in] User not found:', fetchError)
      return res.status(404).json({ error: 'User not found' })
    }

    const metadata = profile.metadata || {}

    // 2. Prepare creator record
    const record = {
      agreed_at: new Date().toISOString(),
      terms_version: CREATOR_TERMS_VERSION,
      royalty_percent: Number(royaltyPercent) || CREATOR_ROYALTY_PERCENT,
    }

    // 3. Update profile using service role (bypassing RLS trigger/policies)
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        metadata: { ...metadata, creator: record },
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (updateError) {
      console.error('[admin/creator/opt-in] Error updating creator status:', updateError)
      return res.status(500).json({ error: 'Failed to update creator status' })
    }

    // Log the admin action
    console.log(`[admin/creator/opt-in] Admin ${adminId} opted-in user ${userId} as creator with ${record.royalty_percent}% royalty`)

    return res.json({
      ok: true,
      userId,
      creator: record
    })
  } catch (error: any) {
    console.error('[admin/creator/opt-in] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
