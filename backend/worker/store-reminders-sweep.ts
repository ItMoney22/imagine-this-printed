// ============================================================================
// The clock behind a seller's reminders (David 2026-10-26: "setup reminders
// for her through email with her assistant reminding her to post etc.").
//
// Every few minutes: each switched-on reminder whose Eastern-time slot has
// come (and isn't stale) is claimed, written fresh by her store assistant and
// emailed to her store's inbox. services/store-reminders.ts does the writing
// and sending; this file only decides what is due and who sends it.
//
// Shape follows worker/delivery-tracking-sweep.ts: injectable deps, one log
// line per tick, and safe on several worker replicas. The claim is an INSERT
// into vendor_store_reminder_sends, unique on (reminder_id, slot_at): exactly
// one tick on one replica wins a slot, so she gets each reminder once.
// ============================================================================

import { supabase } from '../lib/supabase.js'
import { dueSlot, fireReminder, type ClaimedSend, type FireOutcome, type ReminderRow } from '../services/store-reminders.js'

/** How often the sweep runs. */
export const REMINDER_SWEEP_MINUTES = Number(process.env.STORE_REMINDERS_MINUTES) > 0
  ? Number(process.env.STORE_REMINDERS_MINUTES)
  : 5

/**
 * A slot older than this is let go instead of sent late: a worker that was
 * down at 10 AM shouldn't mail "time to post" at 4 PM.
 */
export const REMINDER_GRACE_MINUTES = Number(process.env.STORE_REMINDERS_GRACE_MINUTES) > 0
  ? Number(process.env.STORE_REMINDERS_GRACE_MINUTES)
  : 120

/** Tries per slot when Resend refuses a send (retries reuse the written email and its idempotency key). */
export const REMINDER_MAX_ATTEMPTS = 3

const FIRST_RUN_DELAY_MS = 60_000

export interface ReminderSweepSummary {
  due: number
  sent: number
  skipped: number
  failed: number
}

export interface ReminderSweepDeps {
  now: () => Date
  /** Switched-on reminders of stores that aren't paused. */
  fetchEnabled: () => Promise<ReminderRow[]>
  /** Win this slot, or null when another tick or replica already has it. */
  claim: (reminder: ReminderRow, slot: Date) => Promise<ClaimedSend | null>
  fire: (claim: ClaimedSend, now: Date) => Promise<FireOutcome>
}

const SEND_COLUMNS = 'id, reminder_id, slot_at, attempts, subject, body, written_by, status'

export function makeSupabaseReminderDeps(): ReminderSweepDeps {
  return {
    now: () => new Date(),

    async fetchEnabled() {
      const { data, error } = await supabase.from('vendor_store_reminders').select('*').eq('enabled', true).limit(500)
      if (error) throw new Error(error.message)
      const reminders = (data || []) as ReminderRow[]
      if (!reminders.length) return []
      const { data: stores, error: storeError } = await supabase
        .from('vendor_storefronts')
        .select('id, status')
        .in('id', [...new Set(reminders.map(r => r.storefront_id))])
      if (storeError) throw new Error(storeError.message)
      const open = new Set((stores || []).filter((s: any) => s.status !== 'paused').map((s: any) => s.id))
      return reminders.filter(r => open.has(r.storefront_id))
    },

    async claim(reminder, slot) {
      const slotAt = slot.toISOString()
      const { data, error } = await supabase
        .from('vendor_store_reminder_sends')
        .insert({ reminder_id: reminder.id, storefront_id: reminder.storefront_id, slot_at: slotAt, status: 'claimed' })
        .select(SEND_COLUMNS)
        .single()
      if (!error) return data as ClaimedSend
      if (error.code !== '23505') throw new Error(error.message)

      // Someone has this slot. Take it back only if their send failed and tries are left.
      const { data: existing } = await supabase
        .from('vendor_store_reminder_sends')
        .select(SEND_COLUMNS)
        .eq('reminder_id', reminder.id)
        .eq('slot_at', slotAt)
        .maybeSingle()
      if (!existing || existing.status !== 'failed' || existing.attempts >= REMINDER_MAX_ATTEMPTS) return null
      const { data: retaken } = await supabase
        .from('vendor_store_reminder_sends')
        .update({ status: 'claimed', attempts: existing.attempts + 1 })
        .eq('id', existing.id)
        .eq('status', 'failed')
        .eq('attempts', existing.attempts)
        .select(SEND_COLUMNS)
        .maybeSingle()
      return (retaken as ClaimedSend) || null
    },

    fire: (claim, now) => fireReminder(claim, now),
  }
}

/** One pass. A single bad reminder never stops the rest. */
export async function sweepReminders(
  deps: ReminderSweepDeps,
  graceMs: number = REMINDER_GRACE_MINUTES * 60 * 1000
): Promise<ReminderSweepSummary> {
  const summary: ReminderSweepSummary = { due: 0, sent: 0, skipped: 0, failed: 0 }
  const now = deps.now()
  const reminders = await deps.fetchEnabled()

  for (const reminder of reminders) {
    const slot = dueSlot(reminder, now, graceMs)
    if (!slot) continue
    try {
      const claim = await deps.claim(reminder, slot)
      if (!claim) continue
      summary.due++
      const outcome = await deps.fire(claim, now)
      summary[outcome.status]++
      console.log(
        `[store-reminders] ${reminder.title} (${reminder.id.slice(0, 8)}) for ${slot.toISOString()}: ${outcome.status}` +
          `${outcome.writtenBy ? `, written by the ${outcome.writtenBy}` : ''}${outcome.error ? ` (${outcome.error})` : ''}`
      )
    } catch (err: any) {
      summary.failed++
      console.error(`[store-reminders] ${reminder.id} failed:`, err?.message || String(err))
    }
  }

  return summary
}

/** One tick, wrapped so a thrown query can never take the worker down. */
export async function runReminderSweep(
  deps: ReminderSweepDeps = makeSupabaseReminderDeps()
): Promise<ReminderSweepSummary | null> {
  try {
    const summary = await sweepReminders(deps)
    if (summary.due > 0) {
      console.log(
        `[store-reminders] ${summary.due} due — ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed`
      )
    }
    return summary
  } catch (err: any) {
    console.error('[store-reminders] sweep failed:', err?.message || String(err))
    return null
  }
}

export function startStoreRemindersSweep(): void {
  if (process.env.STORE_REMINDERS_ENABLED === 'false') {
    console.log('[store-reminders] disabled (STORE_REMINDERS_ENABLED=false)')
    return
  }
  if (!process.env.RESEND_API_KEY) {
    console.log('[store-reminders] RESEND_API_KEY not set — seller reminders are off')
    return
  }

  console.log(
    `[store-reminders] ⏰ checking seller reminders every ${REMINDER_SWEEP_MINUTES}m ` +
      `(Eastern time, a slot more than ${REMINDER_GRACE_MINUTES}m old is let go) — ` +
      'her store assistant writes each one and emails it to her store inbox'
  )

  setInterval(() => { void runReminderSweep() }, REMINDER_SWEEP_MINUTES * 60 * 1000)
  setTimeout(() => { void runReminderSweep() }, FIRST_RUN_DELAY_MS)
}
