/**
 * Server-side bot check for the public contact form (POST /api/support/tickets).
 *
 * 2026-10-07: 567 of 570 tickets were one bot posting straight to the API (the
 * browser honeypot in Contact.tsx never runs for it): a random 10-char subject, a
 * ~55-char random description, a random 10-char "order id", ~45 a day from 285
 * real-looking webmail addresses. Every one fired an admin notification and a
 * confirmation email to the address it typed in, which is how contact forms get
 * used to flood strangers' inboxes. Spam is now filed closed with no alert and no
 * email; the caller still gets a normal 201 so the bot learns nothing.
 *
 * Pure function, no I/O, so the rules are tested against the real bot's shape.
 */

export interface TicketSubmission {
  name?: unknown
  subject?: unknown
  description?: unknown
  order_id?: unknown
  /** Hidden field in Contact.tsx; people never see it, form-filling bots do. */
  website?: unknown
}

export interface SpamVerdict {
  spam: boolean
  reasons: string[]
}

const REAL_ORDER_ID = /^#?\s*ITP-[A-Z0-9]{6,10}-[A-Z0-9]{3,6}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One unbroken run of mixed-case letters (and usually digits), e.g. "IBBemvLcPW".
 * Tracking numbers and SKUs are upper-case + digits, so they never match.
 */
export function isRandomToken(s: string, minLength: number): boolean {
  if (s.length < minLength || !/^[A-Za-z0-9]+$/.test(s)) return false
  if (!/[A-Z]/.test(s) || !/[a-z]/.test(s)) return false
  let flips = 0
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i]
    if ((/[a-z]/.test(a) && /[A-Z]/.test(b)) || (/[A-Z]/.test(a) && /[a-z]/.test(b))) flips++
  }
  return /[0-9]/.test(s) || flips >= 3
}

export function checkTicketSpam(t: TicketSubmission): SpamVerdict {
  const reasons: string[] = []
  const subject = String(t.subject ?? '').trim()
  const description = String(t.description ?? '').trim()
  const orderId = String(t.order_id ?? '').trim()

  if (String(t.website ?? '').trim()) reasons.push('honeypot')

  const subjectRandom = isRandomToken(subject, 8)
  const descriptionRandom = description.split(/\s+/).some((w) => isRandomToken(w, 30))
  const orderIdFake = !!orderId && !REAL_ORDER_ID.test(orderId) && !UUID.test(orderId) && isRandomToken(orderId, 8)

  if (subjectRandom) reasons.push('random_subject')
  if (descriptionRandom) reasons.push('random_description')
  if (orderIdFake) reasons.push('random_order_id')

  // Two independent random fields, or the honeypot, is a bot. One alone is not:
  // a person can paste a tracking code or type a stray string.
  const randomCount = [subjectRandom, descriptionRandom, orderIdFake].filter(Boolean).length
  return { spam: reasons.includes('honeypot') || randomCount >= 2, reasons }
}
