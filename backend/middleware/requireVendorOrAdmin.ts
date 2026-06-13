import type { Request, Response, NextFunction } from 'express'
import { getCachedRole } from '../lib/role-cache.js'

export async function requireVendorOrAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    if (role !== 'admin' && role !== 'vendor' && role !== 'manager') {
      console.warn(`[requireVendorOrAdmin] Access denied for user ${userId} with role: ${role}`)
      res.status(403).json({
        error: 'Forbidden - Vendor or Admin access required',
        userRole: role
      })
      return
    }

    next()
  } catch (error: any) {
    console.error('[requireVendorOrAdmin] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error', detail: error.message })
    return
  }
}