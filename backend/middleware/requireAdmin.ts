import type { Request, Response, NextFunction } from 'express'
import { getCachedRole } from '../lib/role-cache.js'

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized - No user found' })
      return
    }

    const role = await getCachedRole(userId)

    if (role === null) {
      res.status(403).json({ error: 'Forbidden - Unable to verify user role' })
      return
    }

    if (role !== 'admin') {
      console.warn(`[requireAdmin] Access denied for user ${userId} with role: ${role}`)
      res.status(403).json({
        error: 'Forbidden - Admin access required',
        userRole: role
      })
      return
    }

    // User is admin — happy path stays silent (was a per-request log spam
    // source before; admins hit a lot of these endpoints).
    next()
  } catch (error: any) {
    console.error('[requireAdmin] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error', detail: error.message })
    return
  }
}
