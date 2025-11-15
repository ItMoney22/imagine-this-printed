import type { Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase.js'

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized - No user found' })
    }

    // Fetch user profile to check role
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single()

    if (error || !profile) {
      console.error('[requireAdmin] Error fetching user profile:', error)
      return res.status(403).json({ error: 'Forbidden - Unable to verify user role' })
    }

    if (profile.role !== 'admin') {
      console.warn(`[requireAdmin] Access denied for user ${userId} with role: ${profile.role}`)
      return res.status(403).json({
        error: 'Forbidden - Admin access required',
        userRole: profile.role
      })
    }

    // User is admin, proceed
    console.log(`[requireAdmin] Admin access granted for user: ${userId}`)
    next()
  } catch (error: any) {
    console.error('[requireAdmin] Unexpected error:', error)
    return res.status(500).json({ error: 'Internal server error', detail: error.message })
  }
}
