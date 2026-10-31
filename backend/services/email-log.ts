// ============================================================================
// email_logs recorder — the ONE place a transactional send is written to
// public.email_logs (admin history at /api/admin/email-templates/logs/recent
// and the Resend webhook's open/click/bounce updates both read this table).
//
// supabase-js does NOT throw on a failed insert: it resolves with `{ error }`.
// The old logEmail awaited the insert inside try/catch and never looked at
// `error`, so a rejected row (schema drift, bad uuid, RLS) vanished silently.
// This recorder reads `error`, logs it with the row's identity, and never
// throws — a logging failure must not break (or retry) a send that happened.
// ============================================================================

import { supabase } from '../lib/supabase.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Template key used when a sender did not name one, so no send is unrecorded. */
export const UNCLASSIFIED_TEMPLATE_KEY = 'unclassified'

export interface EmailLogEntry {
  templateKey?: string
  recipientEmail: string
  subject?: string
  /** True when the AI writer produced the copy, false for the static template. */
  aiUsed?: boolean
  /** Resend email id — the webhook correlates opens/clicks/bounces on it. */
  messageId?: string
  status: 'sent' | 'failed'
  errorMessage?: string
  /** orders.id. Anything that is not a uuid is moved into metadata (uuid column). */
  orderId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Write one row to email_logs. Resolves true when the row landed, false when it
 * did not (the reason is logged, never thrown).
 */
export async function recordEmailLog(entry: EmailLogEntry): Promise<boolean> {
  const templateKey = entry.templateKey || UNCLASSIFIED_TEMPLATE_KEY
  const metadata: Record<string, unknown> = { ...(entry.metadata || {}) }

  let orderId: string | null = null
  if (entry.orderId) {
    if (UUID.test(entry.orderId)) orderId = entry.orderId
    else metadata.order_ref = entry.orderId // a human order number in a uuid column would reject the whole row
  }

  const row = {
    template_key: templateKey,
    recipient_email: entry.recipientEmail,
    subject_sent: entry.subject ?? null,
    ai_personalization_used: !!entry.aiUsed,
    message_id: entry.messageId ?? null,
    status: entry.status,
    error_message: entry.errorMessage ?? null,
    order_id: orderId,
    metadata,
  }

  try {
    const { error } = await supabase.from('email_logs').insert(row)
    if (error) {
      console.error(
        `[EmailLog] insert REJECTED for template=${templateKey} to=${entry.recipientEmail} status=${entry.status}:`,
        `${error.message}${error.code ? ` (code ${error.code})` : ''}${error.details ? ` — ${error.details}` : ''}${error.hint ? ` — hint: ${error.hint}` : ''}`
      )
      return false
    }
    return true
  } catch (err) {
    console.error(`[EmailLog] insert THREW for template=${templateKey} to=${entry.recipientEmail}:`, err)
    return false
  }
}
