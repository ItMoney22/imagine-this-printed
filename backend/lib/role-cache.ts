import { supabase } from './supabase.js'

// Per-user role cache shared by `requireAdmin` and `requireRole`. Both
// middlewares used to hit `user_profiles` on every request, which on hot
// admin paths (dashboards, polling) added ~50ms of needless DB latency
// per call.
//
// Negative results are cached too (under a shorter TTL) so a stray
// missing-profile case doesn't hammer the DB on every retry.
//
// TTL is 60s, not the 5 minutes this started at. A cached role is a
// privilege that outlives the decision to revoke it: with a 5-minute window a
// demoted or compromised admin kept admin access for most of an incident
// response. 60s still absorbs the request bursts the cache exists for (a
// dashboard panel load fans out to a dozen endpoints in a second or two)
// while capping worst-case staleness at a minute.
//
// The TTL is only the backstop. Role changes made through
// POST /api/admin/users/:userId/role (backend/routes/admin/users.ts) call
// `invalidateCachedRole` and take effect on the very next request. The TTL
// covers changes made out of band (a direct edit in the Supabase dashboard,
// a SQL migration) and other processes' caches (the cache is per-process).
const POSITIVE_TTL_MS = 60 * 1000
const NEGATIVE_TTL_MS = 30 * 1000

type Entry = { role: string | null; expiresAt: number }
const cache = new Map<string, Entry>()

export async function getCachedRole(userId: string): Promise<string | null> {
  const now = Date.now()
  const hit = cache.get(userId)
  if (hit && hit.expiresAt > now) return hit.role

  const { data, error } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !data) {
    cache.set(userId, { role: null, expiresAt: now + NEGATIVE_TTL_MS })
    return null
  }

  const role = data.role ?? null
  cache.set(userId, { role, expiresAt: now + POSITIVE_TTL_MS })
  return role
}

/**
 * Drop one user's cached role so the next authorization check re-reads
 * `user_profiles`. Call this from every path that can change a role —
 * promotion, demotion, profile deletion — so revocation is immediate rather
 * than TTL-bounded.
 */
export function invalidateCachedRole(userId: string): void {
  cache.delete(userId)
}

/**
 * Flush every cached role. For bulk role changes (a migration, a script) and
 * for the admin "flush role cache" control.
 */
export function invalidateAllCachedRoles(): number {
  const size = cache.size
  cache.clear()
  return size
}

/** Introspection for the admin cache endpoint and tests. */
export function roleCacheStats(): { entries: number; positiveTtlMs: number; negativeTtlMs: number } {
  return { entries: cache.size, positiveTtlMs: POSITIVE_TTL_MS, negativeTtlMs: NEGATIVE_TTL_MS }
}
