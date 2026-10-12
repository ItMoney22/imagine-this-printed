/**
 * A customer who needs a person reaches Christina on her phone, through Becky.
 *
 * David 2026-10-07: "When someone goes through the ticket system support ... I want Becky to send her a
 * notification ... maybe she could pick up that chat right from Becky. It'll get transferred."
 *
 * Same bridge as the paid-order ping (order-payment.ts notifyTeamOfPaidOrder): POST to
 * davidtrinidad.com/api/phone/support-ping with PRINT_BRIDGE_TOKEN. Becky writes Christina a line, drops a ticket
 * card in her chat and pushes her phone. Her answer comes back through POST /api/print-bridge/ticket-reply, which
 * lands in the customer's live chat window and in their inbox.
 *
 * Five seconds at most and it never throws: a ping that fails must never cost the customer their ticket.
 */

export type SupportPingKind =
  | 'ticket' // a new ticket from the contact form or Mr. Imagine
  | 'live_chat' // the customer asked for a person and is waiting in the chat window
  | 'chat_message' // a customer already handed to Christina wrote again

export interface SupportPing {
  kind: SupportPingKind
  ticketId: string
  subject: string
  message: string
  customerName?: string | null
  customerEmail?: string | null
  priority?: string | null
  category?: string | null
}

/** Christina counts as reachable whenever the bridge to her phone is configured. */
export function christinaReachable(): boolean {
  return !!process.env.PRINT_BRIDGE_TOKEN
}

const MAX_MESSAGE = 600

/** The short reference Christina sees and says back ("reply to 61B69961"). */
export function ticketRef(id: string): string {
  return String(id).slice(0, 8).toUpperCase()
}

/**
 * Which open ticket a reply from Becky is for: the full id, the 8-character reference, or (none given) the newest
 * one. `open` is newest-first. Pure.
 */
export function pickTicket<T extends { id: string }>(ref: string, open: T[]): T | null {
  const r = String(ref || '').trim().replace(/^#/, '').toLowerCase()
  if (!r) return open[0] ?? null
  return open.find((t) => t.id.toLowerCase() === r || t.id.toLowerCase().startsWith(r)) ?? null
}

/** Christina's words go into an HTML email; keep them as text. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The body Becky gets. Pure, so the shape is tested. */
export function supportPingBody(p: SupportPing) {
  const message = String(p.message || '').trim()
  return {
    kind: p.kind,
    ticketId: p.ticketId,
    ticketRef: ticketRef(p.ticketId),
    subject: String(p.subject || '').trim().slice(0, 200),
    message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}...` : message,
    customerFirstName: String(p.customerName || '').trim().split(/\s+/)[0] || null,
    customerEmail: p.customerEmail || null,
    priority: p.priority || null,
    category: p.category || null,
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>

export async function pingChristinaAboutTicket(p: SupportPing, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<boolean> {
  const token = process.env.PRINT_BRIDGE_TOKEN
  if (!token || !p.ticketId) return false
  try {
    const base = (process.env.WATCHTOWER_URL || 'https://davidtrinidad.com').replace(/\/$/, '')
    const res = await fetchImpl(`${base}/api/phone/support-ping`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(supportPingBody(p)),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) console.error('[support-ping] Becky refused the ping:', res.status, p.ticketId)
    return res.ok
  } catch (err) {
    console.error('[support-ping] Becky ping failed:', err instanceof Error ? err.message : String(err), p.ticketId)
    return false
  }
}
