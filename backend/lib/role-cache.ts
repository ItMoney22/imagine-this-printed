import { supabase } from './supabase.js'

// Per-user role cache shared by `requireAdmin` and `requireRole`. Both
// middlewares used to hit `user_profiles` on every request, which on hot
// admin paths (dashboards, polling) added ~50ms of needless DB latency
// per call.
//
// Negative results are cached too (under a shorter TTL) so a stray
// missing-profile case doesn't hammer the DB on every retry. Roles change
// rarely; a 5-minute window is the right tradeoff between staleness and
// pressure on `user_profiles`. If a user is promoted/demoted, they'll see
// the new role within 5 minutes — acceptable for an admin tool.
const POSITIVE_TTL_MS = 5 * 60 * 1000
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

// Test/debug helper. Not exported from index.ts; only callable by
// internal admin tooling that wants to flush a stale entry after a role
// change without waiting for the TTL.
export function invalidateCachedRole(userId: string): void {
  cache.delete(userId)
}
