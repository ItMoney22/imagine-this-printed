/**
 * What the Resend inbound webhook does with one received email: show it and
 * forward it to the mailbox owner's phone (the normal path), or file it quietly.
 *
 * Every message is still STORED (email_messages stays the source of truth and
 * nothing is ever deleted); the only things this decides are whether the copy
 * goes to the owner's phone and whether it sits in the open inbox.
 *
 *  - spam:   Jev labelled it spam at INBOUND_SPAM_CONFIDENCE or above. Stored
 *            archived + read, not forwarded. The bar is above the 0.75 triage
 *            bar on purpose: this one hides mail, so it has to be surer.
 *  - flood:  the same sender already sent INBOUND_FORWARD_MAX_PER_SENDER_HOUR
 *            messages this hour. Stored in the inbox as normal, but the phone
 *            stops buzzing for that sender until the hour rolls over.
 *
 * Pure: the webhook does the I/O and passes the answers in.
 */
import type { EmailTriage } from './jev-triage.js'

export const INBOUND_SPAM_CONFIDENCE = 0.85
export const DEFAULT_MAX_FORWARDS_PER_SENDER_HOUR = 5

export function maxForwardsPerSenderHour(): number {
  const n = Number.parseInt(process.env.INBOUND_FORWARD_MAX_PER_SENDER_HOUR || '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_FORWARDS_PER_SENDER_HOUR
}

export interface InboundFiling {
  forward: boolean
  archive: boolean
  reason: 'ok' | 'spam' | 'sender_flood'
}

export function decideInboundFiling(input: {
  triage?: Pick<EmailTriage, 'label' | 'jev'> | null
  /** Inbound messages already stored from this sender in the last hour (this one excluded). */
  recentFromSender: number
  maxPerSenderHour?: number
}): InboundFiling {
  const t = input.triage
  const spamConfidence = t?.jev?.label?.choice === 'spam' ? t.jev.label.confidence : 0
  if (t?.label === 'spam' && spamConfidence >= INBOUND_SPAM_CONFIDENCE) {
    return { forward: false, archive: true, reason: 'spam' }
  }
  const max = input.maxPerSenderHour ?? maxForwardsPerSenderHour()
  if (input.recentFromSender >= max) return { forward: false, archive: false, reason: 'sender_flood' }
  return { forward: true, archive: false, reason: 'ok' }
}

/** Plain text for Jev from whatever body Resend gave us. */
export function bodyForTriage(text: string | null, html: string | null): string {
  if (text && text.trim()) return text
  if (!html) return ''
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
