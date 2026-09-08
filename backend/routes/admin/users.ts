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

// ---------------------------------------------------------------------------
// Account deletion + signup-bot triage.
//
// Aug 2026: 298 of 303 accounts on the platform turned out to be bot signups.
// The tells were consistent and machine-made, so they are encoded in
// `scoreAccount` below rather than left to eyeballing a table of 300 rows:
//   - first/last name is consonant soup ("Lrfflx Beywpro") — from a generator
//     that never learned real names alternate vowels and consonants
//   - the Gmail local part is dot-injected (a.p.ri.l.dw.o.lf2.013@): Gmail
//     ignores dots, so one real inbox becomes unlimited "unique" signups, which
//     is how the same victim address got registered three separate times
//   - never signed in, never confirmed, and owns nothing
// A real customer trips at most one of these; the bots trip several, so the
// score is a sum and the caller picks the threshold.
//
// Deletion leans on the schema instead of trying to out-clever it: user_profiles
// and user_wallets cascade from auth.users, but orders, itc_transactions,
// points_transactions and founder_earnings are ON DELETE NO ACTION. An account
// with real history therefore fails the cascade at the constraint — Postgres
// refuses to orphan an order. That is the behaviour we want; the handler
// translates the constraint error into a readable reason instead of a 500.

/** Names a generator produced: too few vowels, or a 4+ consonant run. */
function looksGenerated(name?: string | null): boolean {
  if (!name) return false
  const t = name.toLowerCase().replace(/[^a-z]/g, '')
  if (t.length < 4) return false
  const vowels = (t.match(/[aeiou]/g) || []).length
  const longestConsonantRun = Math.max(0, ...t.split(/[aeiou]/).map(s => s.length))
  return vowels / t.length < 0.28 || longestConsonantRun >= 4
}

/** Gmail ignores dots, so 3+ of them is address mutation, not a real address. */
function looksDotInjected(email?: string | null): boolean {
  const local = (email || '').split('@')[0]
  return (local.match(/\./g) || []).length >= 3
}

type BotSignal = { score: number; reasons: string[] }

// The signals are not equally strong, so they are weighted rather than counted.
// A generated name or a dot-injected address is near-conclusive on its own (a
// real person is not called "Xbdwnbbi Wwmeye") and scores 2; dormancy is
// suggestive but innocent on its own — plenty of real people sign up and never
// come back — so it scores 1. At the default threshold of 3 that means every
// flagged account has at least one conclusive tell plus corroboration, and no
// amount of mere dormancy can flag a real account on its own.
const STRONG = 2
const WEAK = 1

function scoreAccount(u: any): BotSignal {
  const reasons: string[] = []
  const meta = u.user_metadata || {}
  let score = 0

  if (looksGenerated(meta.first_name) || looksGenerated(meta.last_name)) {
    reasons.push('machine-generated name')
    score += STRONG
  }
  if (looksDotInjected(u.email)) {
    reasons.push('dot-injected email local part')
    score += STRONG
  }
  if (!u.last_sign_in_at) {
    reasons.push('never signed in')
    score += WEAK
  }
  if (!u.email_confirmed_at && !u.confirmed_at) {
    reasons.push('email never confirmed')
    score += WEAK
  }
  return { score, reasons }
}

/** Every auth user, paged out of the admin API. */
async function listAllAuthUsers(): Promise<any[]> {
  const all: any[] = []
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(error.message)
    all.push(...data.users)
    if (data.users.length < 1000) break
  }
  return all
}

/**
 * GET /api/admin/users/suspected-bots?minScore=3
 * Read-only triage: scores every account and returns the ones at or over the
 * threshold, newest first, with the reasons that flagged them. Nothing is
 * deleted here — this is the list the admin UI previews before any purge.
 */
router.get('/suspected-bots', async (req: Request, res: Response): Promise<any> => {
  const minScore = Math.max(1, Math.min(6, Number(req.query.minScore) || 3))
  try {
    const users = await listAllAuthUsers()

    // Owning a paid order clears an account no matter what its name looks like:
    // the score is a heuristic, an order is a fact.
    const { data: orderRows } = await supabase.from('orders').select('user_id').limit(5000)
    const withOrders = new Set((orderRows || []).map(r => r.user_id).filter(Boolean))

    const flagged = users
      .map(u => ({ user: u, signal: scoreAccount(u) }))
      .filter(({ user, signal }) => signal.score >= minScore && !withOrders.has(user.id))
      .map(({ user, signal }) => ({
        id: user.id,
        email: user.email,
        name: [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(' '),
        createdAt: user.created_at,
        score: signal.score,
        reasons: signal.reasons
      }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

    return res.json({
      total: users.length,
      protectedByOrders: users.filter(u => withOrders.has(u.id)).length,
      minScore,
      flagged
    })
  } catch (error: any) {
    console.error('[admin/users] suspected-bots failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * Deletes one auth user. user_profiles and user_wallets cascade; anything with
 * real history (orders, ITC/points ledger, founder earnings) is NO ACTION and
 * blocks the delete at the constraint, which we report back as a reason.
 */
async function deleteAccount(userId: string, actorId: string | undefined, req: Request) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, email, role')
    .eq('id', userId)
    .maybeSingle()

  if (profile?.role === 'admin') {
    return {
      ok: false as const,
      userId,
      email: profile.email,
      reason: 'Account is an admin — change the role first.'
    }
  }

  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) {
    // 23503 = foreign_key_violation: the account owns rows we refuse to orphan.
    const isFk = /foreign key|violates|23503/i.test(error.message)
    return {
      ok: false as const,
      userId,
      email: profile?.email ?? null,
      reason: isFk
        ? 'Account owns orders or ledger history and cannot be deleted.'
        : error.message
    }
  }

  await supabase.from('audit_logs').insert({
    user_id: actorId ?? 'admin',
    action: 'USER_DELETE',
    entity: 'User',
    entity_id: userId,
    changes: { email: profile?.email ?? null, role: profile?.role ?? null },
    ip_address: req.ip ?? null,
    user_agent: req.get('user-agent') ?? null,
    created_at: new Date().toISOString()
  })

  invalidateCachedRole(userId)
  return { ok: true as const, userId, email: profile?.email ?? null }
}

/**
 * DELETE /api/admin/users/:userId
 * Permanently removes one account.
 */
router.delete('/:userId', async (req: Request, res: Response): Promise<any> => {
  const { userId } = req.params
  const actorId = req.user?.sub

  if (!userId) return res.status(400).json({ error: 'userId is required' })
  if (userId === actorId) {
    return res.status(400).json({ error: 'You cannot delete your own account.' })
  }

  try {
    const result = await deleteAccount(userId, actorId, req)
    if (!result.ok) return res.status(409).json({ error: result.reason })

    console.warn(`[admin/users] deleted account ${userId} (${result.email}) by ${actorId}`)
    return res.json({ ok: true, userId, email: result.email })
  } catch (error: any) {
    console.error('[admin/users] delete failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/users/bulk-delete
 * Body: { userIds: string[] }
 * Deletes up to 500 accounts, reporting per-account outcomes. One failure does
 * not abort the rest — a purge of hundreds should not be undone by the single
 * account that turned out to have an order.
 */
router.post('/bulk-delete', async (req: Request, res: Response): Promise<any> => {
  const actorId = req.user?.sub
  const userIds: unknown = req.body?.userIds

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds must be a non-empty array' })
  }
  if (userIds.length > 500) {
    return res.status(400).json({ error: 'Refusing to delete more than 500 accounts in one call.' })
  }

  const targets = userIds.filter((id): id is string => typeof id === 'string' && id !== actorId)

  const deleted: any[] = []
  const skipped: any[] = []
  for (const id of targets) {
    try {
      const result = await deleteAccount(id, actorId, req)
      if (result.ok) deleted.push(result)
      else skipped.push(result)
    } catch (error: any) {
      skipped.push({ userId: id, reason: error.message })
    }
  }

  console.warn(`[admin/users] bulk delete by ${actorId}: ${deleted.length} deleted, ${skipped.length} skipped`)
  return res.json({
    ok: true,
    deletedCount: deleted.length,
    skippedCount: skipped.length,
    deleted,
    skipped
  })
})

export default router
