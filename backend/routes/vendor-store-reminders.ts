import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { requireStoreManager } from './vendor-store.js'
import { scheduleLabel, storeInboxAddress, type ReminderRow } from '../services/store-reminders.js'

// A seller's reminders card (David 2026-10-26: "setup reminders for her through email with her assistant reminding
// her to post etc."; approved mock itp-crystal-store-manager-inbox round 1). The store owner or an ITP admin, like
// the rest of /api/vendor-store/manage. The worker that sends them is worker/store-reminders-sweep.ts.
//
//   GET    /api/vendor-store/manage/:slug/reminders       her reminders + the store inbox they go to
//   POST   /api/vendor-store/manage/:slug/reminders       Add a reminder { title, days, time, note? }
//   PATCH  /api/vendor-store/manage/:slug/reminders/:id   { enabled?, days?, time?, title?, note? }
//   DELETE /api/vendor-store/manage/:slug/reminders/:id   ones she added (the three standing ones switch off instead)
const router = Router()

const MAX_REMINDERS = 20

/** Eastern weekdays 0 (Sunday) .. 6, at least one. */
function readDays(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null
  const days = [...new Set(v.map(Number))].sort((a, b) => a - b)
  return days.length >= 1 && days.length <= 7 && days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) ? days : null
}

/** 'HH:MM', 24-hour Eastern. */
function readTime(v: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  return hh <= 23 && mm <= 59 ? `${String(hh).padStart(2, '0')}:${m[2]}` : null
}

const shape = (r: ReminderRow, lastSentAt: string | null) => {
  const time = String(r.time_of_day).slice(0, 5)
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    note: r.note,
    days: r.days,
    time,
    schedule: scheduleLabel(r.days, time),
    enabled: r.enabled,
    lastSentAt,
  }
}

router.get('/manage/:slug/reminders', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const { data, error } = await supabase
    .from('vendor_store_reminders').select('*').eq('storefront_id', store.id).order('sort').order('created_at')
  if (error) return res.status(500).json({ error: 'Reminders didn’t load' })
  const reminders = (data || []) as ReminderRow[]
  const { data: sends } = reminders.length
    ? await supabase
      .from('vendor_store_reminder_sends')
      .select('reminder_id, sent_at')
      .eq('storefront_id', store.id)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(200)
    : { data: [] }
  const last = new Map<string, string>()
  for (const s of (sends || []) as Array<{ reminder_id: string; sent_at: string }>) if (!last.has(s.reminder_id)) last.set(s.reminder_id, s.sent_at)
  // Her store inbox (vendor_storefronts.inbox_mailbox_id), never the personal address she signs in with.
  const to = await storeInboxAddress((store as { inbox_mailbox_id?: string | null }).inbox_mailbox_id)
  return res.json({ to, timezone: 'Eastern', reminders: reminders.map(r => shape(r, last.get(r.id) ?? null)) })
})

router.post('/manage/:slug/reminders', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const b = req.body || {}
  const title = String(b.title || '').trim().slice(0, 80)
  const days = readDays(b.days)
  const time = readTime(b.time)
  if (!title) return res.status(400).json({ error: 'Say what to remind you about' })
  if (!days) return res.status(400).json({ error: 'Pick at least one day' })
  if (!time) return res.status(400).json({ error: 'Pick a time' })

  const { data: existing } = await supabase.from('vendor_store_reminders').select('sort').eq('storefront_id', store.id)
  if ((existing || []).length >= MAX_REMINDERS) return res.status(400).json({ error: `You can have up to ${MAX_REMINDERS} reminders` })
  const { data, error } = await supabase
    .from('vendor_store_reminders')
    .insert({
      storefront_id: store.id,
      kind: 'custom',
      title,
      note: String(b.note || '').trim().slice(0, 300) || null,
      days,
      time_of_day: time,
      enabled: true,
      armed_at: new Date().toISOString(),
      sort: Math.max(0, ...(existing || []).map((r: any) => Number(r.sort) || 0)) + 1,
    })
    .select()
    .single()
  if (error) return res.status(500).json({ error: 'Failed to save' })
  return res.json({ reminder: shape(data as ReminderRow, null) })
})

router.patch('/manage/:slug/reminders/:id', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const { data: found } = await supabase
    .from('vendor_store_reminders').select('*').eq('id', req.params.id).eq('storefront_id', store.id).maybeSingle()
  const reminder = found as ReminderRow | null
  if (!reminder) return res.status(404).json({ error: 'Reminder not found' })
  const b = req.body || {}
  const patch: Record<string, unknown> = {}
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled
  if (b.days !== undefined) {
    const days = readDays(b.days)
    if (!days) return res.status(400).json({ error: 'Pick at least one day' })
    patch.days = days
  }
  if (b.time !== undefined) {
    const time = readTime(b.time)
    if (!time) return res.status(400).json({ error: 'Pick a time' })
    patch.time_of_day = time
  }
  if (reminder.kind === 'custom') {
    if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 80)
    if (typeof b.note === 'string') patch.note = b.note.trim().slice(0, 300) || null
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' })
  // Switched on again or moved: only slots from now on count, so she never gets one late for a time already past.
  if ((patch.enabled === true && !reminder.enabled) || patch.days || patch.time_of_day) patch.armed_at = new Date().toISOString()
  patch.updated_at = new Date().toISOString()
  const { data, error } = await supabase.from('vendor_store_reminders').update(patch).eq('id', reminder.id).select().single()
  if (error) return res.status(500).json({ error: 'Failed to save' })
  return res.json({ reminder: shape(data as ReminderRow, null) })
})

router.delete('/manage/:slug/reminders/:id', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const { data: reminder } = await supabase
    .from('vendor_store_reminders').select('id, kind').eq('id', req.params.id).eq('storefront_id', store.id).maybeSingle()
  if (!reminder) return res.status(404).json({ error: 'Reminder not found' })
  if (reminder.kind !== 'custom') return res.status(403).json({ error: 'Switch it off instead' })
  const { error } = await supabase.from('vendor_store_reminders').delete().eq('id', reminder.id)
  if (error) return res.status(500).json({ error: 'Failed to delete' })
  return res.json({ ok: true })
})

export default router
