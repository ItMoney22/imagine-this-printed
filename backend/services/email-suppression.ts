// Email suppression list — the addresses we must stop sending to.
//
// Written by the Resend delivery webhook (hard bounces + spam complaints) and
// read by sendEmailWithTracking before every transactional send. Table +
// upsert function: supabase/migrations/20260726_email_suppressions.sql.
//
// FAIL-OPEN by design: if the lookup itself errors (table missing, DB blip)
// we log and let the mail through. A database hiccup must never silently
// swallow every order confirmation on the platform.

import { supabase } from '../lib/supabase.js'

export type SuppressionReason = 'hard_bounce' | 'complaint' | 'manual'
export type SuppressionSource = 'resend' | 'brevo' | 'manual'

export interface SuppressionRecord {
  id: string
  email: string
  reason: SuppressionReason
  detail: string | null
  source: SuppressionSource
  provider_email_id: string | null
  provider_event_id: string | null
  event_count: number
  first_seen_at: string
  last_seen_at: string
  expires_at: string | null
}

export function normalizeEmail(input: string | null | undefined): string {
  return String(input ?? '').trim().toLowerCase()
}

/**
 * Look an address up on the suppression list.
 * Returns null when the address is clear to mail (including on lookup errors).
 */
export async function getSuppression(email: string): Promise<SuppressionRecord | null> {
  const address = normalizeEmail(email)
  if (!address || !address.includes('@')) return null

  const { data, error } = await supabase
    .from('email_suppressions')
    .select('*')
    .eq('email', address)
    .maybeSingle()

  if (error) {
    console.warn('[Suppression] lookup failed (allowing send):', error.message)
    return null
  }
  if (!data) return null

  // Time-boxed suppressions stop applying once they expire.
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null

  return data as SuppressionRecord
}

export async function isSuppressed(email: string): Promise<boolean> {
  return (await getSuppression(email)) !== null
}

/**
 * Add (or re-arm) a suppression. Atomic upsert in Postgres so concurrent
 * webhook deliveries can't race. Never throws — a failed write is logged so it
 * cannot take the webhook response down with it.
 */
export async function recordSuppression(input: {
  email: string
  reason: SuppressionReason
  detail?: string | null
  source?: SuppressionSource
  providerEmailId?: string | null
  providerEventId?: string | null
}): Promise<boolean> {
  const address = normalizeEmail(input.email)
  if (!address || !address.includes('@')) return false

  const { error } = await supabase.rpc('record_email_suppression', {
    p_email: address,
    p_reason: input.reason,
    p_detail: input.detail ?? null,
    p_source: input.source ?? 'resend',
    p_provider_email_id: input.providerEmailId ?? null,
    p_provider_event_id: input.providerEventId ?? null,
  })

  if (error) {
    console.error('[Suppression] failed to record', address, error.message)
    return false
  }
  console.warn(`[Suppression] ${address} suppressed (${input.reason})${input.detail ? ` — ${input.detail}` : ''}`)
  return true
}

/** Read-only listing for the admin UI. */
export async function listSuppressions(opts: { search?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500)
  const offset = Math.max(Number(opts.offset) || 0, 0)

  let query = supabase
    .from('email_suppressions')
    .select('*', { count: 'exact' })
    .order('last_seen_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const search = normalizeEmail(opts.search)
  if (search) query = query.ilike('email', `%${search}%`)

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { suppressions: (data || []) as SuppressionRecord[], total: count ?? (data || []).length }
}
