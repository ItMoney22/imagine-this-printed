// Admin user administration — currently the role-change surface.
//
// Role changes used to be a direct `user_profiles` UPDATE from the browser.
// That worked (RLS lets admins write the row) but it left the API's in-process
// role cache holding the OLD role until its TTL expired, so a demoted or
// compromised admin kept admin access on every backend endpoint for the rest of
// the window. Routing the change through here makes revocation immediate:
// the update, the audit record and the cache invalidation happen together.
import { Router, Request, Response } from 'express'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { requireAdmin } from '../../middleware/requireAdmin.js'
import { supabase } from '../../lib/supabase.js'
import { invalidateAllCachedRoles, invalidateCachedRole, roleCacheStats } from '../../lib/role-cache.js'

const router = Router()

router.use(requireAuth)
router.use(requireAdmin)

// Mirrors the `User['role']` union in src/types/index.ts. Anything outside this
// set is rejected rather than written — an unknown role string silently fails
// every authorization check, which reads as "the account is broken".
const ASSIGNABLE_ROLES = [
  'customer',
  'founder',
  'vendor',
  'admin',
  'manager',
  'wholesale',
  'kiosk',
  'support_agent'
] as const

/**
 * POST /api/admin/users/:userId/role
 * Body: { role: string }
 * Changes a user's role, writes the audit record, and invalidates the cached
 * role so the next request re-reads `user_profiles`.
 */
router.post('/:userId/role', async (req: Request, res: Response): Promise<any> => {
  const { userId } = req.params
  const role = typeof req.body?.role === 'string' ? req.body.role.trim() : ''
  const actorId = req.user?.sub

  if (!userId) return res.status(400).json({ error: 'userId is required' })
  if (!ASSIGNABLE_ROLES.includes(role as (typeof ASSIGNABLE_ROLES)[number])) {
    return res.status(400).json({ error: `Invalid role. Allowed: ${ASSIGNABLE_ROLES.join(', ')}` })
  }

  try {
    const { data: existing, error: readError } = await supabase
      .from('user_profiles')
      .select('id, role')
      .eq('id', userId)
      .single()

    if (readError || !existing) {
      return res.status(404).json({ error: 'User profile not found' })
    }

    const previousRole = existing.role ?? null

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ role })
      .eq('id', userId)

    if (updateError) {
      console.error('[admin/users] role update failed:', updateError)
      return res.status(500).json({ error: updateError.message })
    }

    // Immediately: the demoted user's next request re-reads the DB.
    invalidateCachedRole(userId)
    // An admin can demote themselves; drop the actor's entry too so the change
    // is not masked by their own warm cache line.
    if (actorId && actorId !== userId) invalidateCachedRole(actorId)

    await supabase.from('audit_logs').insert({
      user_id: actorId ?? 'admin',
      action: 'ROLE_CHANGE',
      entity: 'User',
      entity_id: userId,
      changes: { previous_role: previousRole, role },
      ip_address: req.ip ?? null,
      user_agent: req.get('user-agent') ?? null,
      created_at: new Date().toISOString()
    })

    console.warn(`[admin/users] role change: ${userId} ${previousRole} -> ${role} by ${actorId}`)

    return res.json({ ok: true, userId, previousRole, role })
  } catch (error: any) {
    console.error('[admin/users] role change error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/users/:userId/invalidate-role-cache
 * Escape hatch for roles changed out of band (Supabase dashboard, SQL) — flush
 * one entry without waiting out the TTL.
 */
router.post('/:userId/invalidate-role-cache', async (req: Request, res: Response): Promise<any> => {
  const { userId } = req.params
  if (!userId) return res.status(400).json({ error: 'userId is required' })
  invalidateCachedRole(userId)
  console.warn(`[admin/users] role cache invalidated for ${userId} by ${req.user?.sub}`)
  return res.json({ ok: true, userId })
})

/**
 * POST /api/admin/users/role-cache/flush
 * Flush every cached role (bulk changes, incident response).
 */
router.post('/role-cache/flush', async (req: Request, res: Response): Promise<any> => {
  const cleared = invalidateAllCachedRoles()
  console.warn(`[admin/users] full role cache flush (${cleared} entries) by ${req.user?.sub}`)
  return res.json({ ok: true, cleared })
})

/** GET /api/admin/users/role-cache/stats — cache size + configured TTLs. */
router.get('/role-cache/stats', async (_req: Request, res: Response): Promise<any> => {
  return res.json(roleCacheStats())
})

export default router
