/**
 * "Talk to a person": a customer in the shop chat is handed to Christina (David 2026-10-07, task 5878a61f).
 *
 * One path for both doors into it: the chat widget's Talk to a person button (POST /api/support/live-chat) and
 * Mr. Imagine's request_live_chat tool (routes/ai/chat.ts). It makes sure there is a real ticket for the chat window
 * to poll, marks it waiting, opens the chat session and pings Christina through Becky (services/support-ping.ts).
 *
 * When nobody is reachable the ticket is still filed (status open) and Christina still gets the ping, so the
 * customer is told the truth: she will write back by email. The old tool path said "a ticket has been created"
 * here without creating one.
 */
import { christinaReachable, type SupportPing } from './support-ping.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The two calls this needs from the Supabase client, so tests can hand in a fake. */
export interface LiveChatDb {
  from(table: string): any
}

/**
 * Is anyone there? Christina counts whenever the bridge to her phone is up: Becky pings her and her answer lands in
 * the customer's chat (services/support-ping.ts). Nobody ever set agent_status online, so before 2026-10-07 "talk to
 * a person" always ended in "no agents are available".
 */
export async function agentAvailability(db: LiveChatDb): Promise<{ available: boolean; count: number }> {
  const viaBecky = christinaReachable() ? 1 : 0
  try {
    const { data, error } = await db.from('agent_status').select('id').eq('is_online', true)
    if (error) throw error
    const count = (data?.length || 0) + viaBecky
    return { available: count > 0, count }
  } catch (error) {
    console.error('[Agent Availability] Error:', error)
    return { available: viaBecky > 0, count: viaBecky }
  }
}

export interface LiveChatDeps {
  checkAgentAvailability: () => Promise<{ available: boolean }>
  createNotification: (type: 'agent_needed' | 'new_ticket', title: string, message: string, ticketId?: string, userId?: string) => Promise<unknown>
  pingChristinaAboutTicket: (p: SupportPing) => Promise<boolean>
}

export interface StartLiveChatInput {
  userId?: string | null
  email?: string | null
  name?: string | null
  /** Why they want a person, in their words or the assistant's summary. */
  reason?: string | null
  /** Their last message, so Christina sees what they asked. */
  message?: string | null
  /** An existing ticket this chat already has (from earlier in the conversation). */
  ticketId?: string | null
}

export interface StartLiveChatResult {
  ok: boolean
  /** True when Christina is reachable and the customer waits in the chat for her. */
  live: boolean
  ticketId: string | null
  email: string | null
  error?: string
}

export function cleanEmail(raw: unknown): string | null {
  const e = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return e && e.length <= 200 && EMAIL_RE.test(e) && e !== 'anonymous@customer.com' ? e : null
}

/** Ticket description; the "Name:" first line is what the reply email greets (utils/ticket-emails.ts). Pure. */
export function liveChatDescription(input: Pick<StartLiveChatInput, 'name' | 'reason' | 'message'>): string {
  const name = String(input.name || '').trim().slice(0, 60)
  const reason = String(input.reason || '').trim().slice(0, 500)
  const last = String(input.message || '').trim().slice(0, 1000)
  const body = [reason, last && last !== reason ? `Last message: ${last}` : ''].filter(Boolean).join('\n\n')
  return name ? `Name: ${name}\n\n${body}`.trim() : body
}

export function liveChatSubject(reason?: string | null): string {
  const r = String(reason || '').trim().replace(/\s+/g, ' ')
  return `Live chat: ${(r || 'customer asked for a person').slice(0, 120)}`
}

export async function startLiveChat(db: LiveChatDb, input: StartLiveChatInput, deps: LiveChatDeps): Promise<StartLiveChatResult> {
  const email = cleanEmail(input.email)
  const userId = input.userId || null
  const { available } = await deps.checkAgentAvailability().catch(() => ({ available: false }))
  const subject = liveChatSubject(input.reason || input.message)

  let ticketId: string | null = null
  if (input.ticketId && UUID_RE.test(input.ticketId)) {
    const { data: existing } = await db.from('support_tickets').select('id, email').eq('id', input.ticketId).maybeSingle()
    if (existing?.id) {
      ticketId = existing.id
      if (email && !cleanEmail(existing.email)) {
        await db.from('support_tickets').update({ email }).eq('id', ticketId)
      }
    }
  }

  if (!ticketId) {
    const { data: created, error } = await db
      .from('support_tickets')
      .insert({
        user_id: userId,
        email,
        subject,
        description: liveChatDescription(input),
        priority: 'high',
        category: 'general',
        // The live support_tickets_status_check allows open | in_progress | resolved | closed only (read off prod
        // 2026-10-07). "Waiting for a person" lives on chat_sessions.status, never on the ticket.
        status: 'open',
      })
      .select('id')
      .single()
    if (error || !created?.id) return { ok: false, live: false, ticketId: null, email, error: error?.message || 'ticket not created' }
    ticketId = created.id as string
  }

  const ping: SupportPing = {
    kind: available ? 'live_chat' : 'ticket',
    ticketId: ticketId!,
    subject: String(input.reason || input.message || 'A customer wants a person').slice(0, 200),
    message: String(input.message || input.reason || ''),
    customerName: input.name || null,
    customerEmail: email,
  }

  if (!available) {
    await deps.pingChristinaAboutTicket(ping)
    return { ok: true, live: false, ticketId, email }
  }

  await db.from('support_tickets').update({ priority: 'high', updated_at: new Date().toISOString() }).eq('id', ticketId)
  const { error: sessionError } = await db
    .from('chat_sessions')
    .upsert({ ticket_id: ticketId, user_id: userId, status: 'waiting', started_at: new Date().toISOString(), ended_at: null }, { onConflict: 'ticket_id' })
  // A guest (no account) needs migration 20261007180000; until then this says so out loud.
  if (sessionError) console.error('[live-chat] chat session not created:', sessionError.message)

  await deps.createNotification('agent_needed', 'Customer Requesting Live Chat', subject, ticketId!, userId || undefined)
  await deps.pingChristinaAboutTicket(ping)
  return { ok: !sessionError, live: !sessionError, ticketId, email, ...(sessionError ? { error: sessionError.message } : {}) }
}
