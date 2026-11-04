// =============================================================================
// What ITP's phone line does with what it hears (task 20d54c05, David 2026-10-30:
// "ITP needs to be the (470) 227-8666 number").
//
// Everything a caller or a texter leaves lands where the shop already reads its
// support: a support_tickets row (Admin > Support), the support inbox email, and
// Becky's ping to Christina's phone, exactly like the contact form
// (routes/support.ts). Nothing here can text back: the number's A2P campaign is
// rejected, so outbound SMS is never attempted.
//
//   take_message      Mr. Imagine files the caller's message as a ticket
//   transfer_to_shop  redirect the live call to PHONE_FORWARD_TO, with a missed-call
//                     ticket if nobody picks up (routes/phone.ts /twilio/dial-done)
//   fileTextMessage   an inbound text opens a ticket, or joins the texter's open one
//   fileMissedCall    the Dial fallback rang out: the shop gets the number to call back
//   fileCallTranscript at hangup, the call's turns go onto that call's ticket
// =============================================================================
import type { TicketInput, TicketTriage } from '../lib/jev-triage.js'
import { describeTicketTriage } from '../lib/jev-triage.js'
import type { SupportPing } from './support-ping.js'
import { dial, phoneConfig, phonePublicBase, prettyPhone, say, twiml } from '../lib/phone-twilio.js'

export interface ToolOutcome {
  ok: boolean
  speak: string
  [key: string]: unknown
}

/** The slice of the Supabase client this file uses, so tests can hand in a fake. */
export type PhoneDb = { from: (table: string) => any }

export interface PhoneDeps {
  db: PhoneDb
  triage: (t: TicketInput) => Promise<TicketTriage>
  /** routes/support.ts's team alert: (ticketId, subject, description, priority, category, from?, to?). */
  emailTeam: (ticketId: string, subject: string, description: string, priority: string, category: string, from?: string, to?: string) => Promise<unknown>
  bulkRecipients: () => string[]
  ping: (p: SupportPing) => Promise<boolean>
  updateCall: (callSid: string, twimlBody: string) => Promise<boolean>
}

const OPEN_STATUSES = ['open', 'in_progress']
/** A text joins the texter's open ticket from the last week instead of opening a new one. */
const TEXT_THREAD_DAYS = 7

export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** A US number the caller said, as E.164; else the number they called from; else null. */
export function callbackNumber(said: unknown, from: string): string | null {
  const digits = String(said ?? '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return /^\+\d{8,15}$/.test(from) ? from : null
}

export const textSubject = (from: string) => `Text message from ${prettyPhone(from)}`

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 }

/** Opt-out and help keywords Twilio answers itself; they are not messages for the shop. */
export function isCarrierKeyword(body: string): boolean {
  return /^(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|yes|help|info)$/i.test(body.trim())
}

interface NewTicket {
  subject: string
  description: string
  /** The first thing the customer said, kept as their message on the ticket. */
  message: string
  customerName?: string | null
  orderId?: string | null
  /** The lowest priority the ticket may get (an urgent phone message is at least high). */
  minPriority?: 'high'
}

/** One support ticket, with the same alerts the contact form sends. Spam Jev is sure of is filed closed, quietly. */
async function openTicket(t: NewTicket, deps: PhoneDeps): Promise<{ ticketId: string | null; spam: boolean }> {
  const triage = await deps.triage({ subject: t.subject, description: t.description, customerCategory: 'phone', orderId: t.orderId })
  const category = triage.category ?? 'general'

  if (triage.category === 'spam' && !triage.needsReview) {
    const { error } = await deps.db.from('support_tickets').insert({
      email: null, subject: t.subject, description: t.description, category: 'spam', priority: 'low', status: 'closed',
    })
    if (error) console.error('[phone] failed to file spam ticket:', error.message)
    return { ticketId: null, spam: true }
  }

  let priority = triage.dbPriority as string
  if (t.minPriority && RANK[priority] < RANK[t.minPriority]) priority = t.minPriority

  const { data: ticket, error } = await deps.db
    .from('support_tickets')
    .insert({ email: null, subject: t.subject, description: t.description, category, priority, status: 'open' })
    .select('id')
    .single()
  if (error || !ticket) throw new Error(`support ticket insert failed: ${error?.message || 'no row'}`)

  await deps.db.from('admin_notifications').insert({
    type: 'new_ticket',
    title: `New Support Ticket: ${t.subject}`,
    message: `${t.subject}\nCategory: ${category} · Priority: ${priority}` + (triage.needsReview ? '\nNeeds human triage — Jev was not confident.' : ''),
    ticket_id: ticket.id,
  })
  await deps.db.from('ticket_messages').insert([
    { ticket_id: ticket.id, sender_type: 'user', sender_id: null, message: t.message, is_internal: false },
    { ticket_id: ticket.id, sender_type: 'system', sender_id: null, message: describeTicketTriage(triage), is_internal: true },
  ])

  try {
    await deps.emailTeam(ticket.id, t.subject, t.description, priority, category)
    if (category === 'bulk_quote') {
      for (const to of deps.bulkRecipients()) await deps.emailTeam(ticket.id, t.subject, t.description, priority, 'bulk_quote', undefined, to)
    }
  } catch (err) {
    console.error('[phone] support team email failed:', err instanceof Error ? err.message : String(err))
  }
  await deps.ping({
    kind: 'ticket', ticketId: ticket.id, subject: t.subject, message: t.message,
    customerName: t.customerName ?? null, customerEmail: null, priority, category,
  })
  return { ticketId: ticket.id, spam: false }
}

/** Add a line to an existing ticket (a second text, a missed transfer) and tell Christina. */
async function addToTicket(ticketId: string, subject: string, message: string, deps: PhoneDeps): Promise<void> {
  await deps.db.from('ticket_messages').insert({ ticket_id: ticketId, sender_type: 'user', sender_id: null, message, is_internal: false })
  await deps.db.from('support_tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticketId)
  await deps.db.from('admin_notifications').insert({ type: 'ticket_reply', title: `New reply: ${subject}`, message, ticket_id: ticketId })
  await deps.ping({ kind: 'chat_message', ticketId, subject, message, customerName: null, customerEmail: null })
}

async function ticketForCall(callSid: string, deps: PhoneDeps): Promise<{ id: string; subject: string } | null> {
  if (!callSid) return null
  const { data: call } = await deps.db.from('phone_calls').select('ticket_id').eq('call_sid', callSid).maybeSingle()
  if (!call?.ticket_id) return null
  const { data: ticket } = await deps.db.from('support_tickets').select('id, subject').eq('id', call.ticket_id).maybeSingle()
  return ticket ?? null
}

async function linkCallToTicket(callSid: string, ticketId: string, deps: PhoneDeps): Promise<void> {
  if (!callSid) return
  const { error } = await deps.db
    .from('phone_calls')
    .upsert({ call_sid: callSid, ticket_id: ticketId, updated_at: new Date().toISOString() }, { onConflict: 'call_sid' })
  if (error) console.error('[phone] could not link the call to its ticket:', error.message)
}

// ── take_message ────────────────────────────────────────────────────────────

export async function takeMessage(args: Record<string, unknown>, callSid: string, from: string, deps: PhoneDeps): Promise<ToolOutcome> {
  const callerName = cleanText(args.caller_name, 120) || 'A caller'
  const summary = cleanText(args.summary, 1500)
  if (!summary) return { ok: false, speak: "I need a little more about what it's about." }
  const callback = callbackNumber(args.callback_number, from)
  const orderNumber = cleanText(args.order_number, 60)
  const urgency = ['routine', 'soon', 'urgent'].includes(String(args.urgency)) ? String(args.urgency) : 'routine'

  const subject = `Phone message from ${callerName}`
  const description = [
    'Left with Mr. Imagine on the shop phone line.',
    `Caller: ${callerName}`,
    `Call back: ${callback ? prettyPhone(callback) : 'no number given'}`,
    ...(orderNumber ? [`Order: ${orderNumber}`] : []),
    `Urgency: ${urgency}`,
    '',
    summary,
  ].join('\n')

  // A second message on the same call joins the first ticket.
  const existing = await ticketForCall(callSid, deps)
  if (existing) {
    await addToTicket(existing.id, existing.subject, description, deps)
    return { ok: true, ticketId: existing.id, speak: 'Added that to your message for the shop.' }
  }

  const filed = await openTicket(
    { subject, description, message: description, customerName: callerName, orderId: orderNumber || null, minPriority: urgency === 'urgent' ? 'high' : undefined },
    deps,
  )
  if (filed.ticketId) await linkCallToTicket(callSid, filed.ticketId, deps)
  return {
    ok: true,
    speak: `Message saved for the shop${callback ? '' : ', but I still need a good number to call you back'}.`,
  }
}

// ── transfer_to_shop ────────────────────────────────────────────────────────

export function transferTwiml(reason: string, forwardTo: string): string {
  const doneUrl = new URL(`${phonePublicBase()}/api/phone/twilio/dial-done`)
  if (reason) doneUrl.searchParams.set('reason', reason.slice(0, 200))
  return twiml(say("One moment, I'm putting you through to the shop now.") + dial(forwardTo, { timeout: 25, action: doneUrl.toString() }))
}

export async function transferToShop(args: Record<string, unknown>, callSid: string, deps: PhoneDeps): Promise<ToolOutcome> {
  const cfg = phoneConfig()
  if (!callSid || !cfg.ready) return { ok: false, speak: "I can't put you through right now. Let me take a message instead." }
  const reason = cleanText(args.reason, 200)
  let ok = false
  try {
    ok = await deps.updateCall(callSid, transferTwiml(reason, cfg.forwardTo))
  } catch (err) {
    console.error('[phone] transfer failed:', err instanceof Error ? err.message : String(err))
  }
  return ok
    ? { ok: true, speak: 'Connecting you now.' }
    : { ok: false, speak: "I couldn't put you through. Let me take a message instead." }
}

// ── missed calls (the Dial rang out) ────────────────────────────────────────

/** The Dial's own result: true when nobody at the shop picked up. */
export function dialWasMissed(status: string | undefined): boolean {
  return ['no-answer', 'busy', 'failed'].includes(String(status || '').toLowerCase())
}

export async function fileMissedCall(input: { callSid: string; from: string; reason?: string }, deps: PhoneDeps): Promise<void> {
  const who = prettyPhone(input.from) || 'an unknown number'
  const line = input.reason
    ? `Asked Mr. Imagine for a person (${cleanText(input.reason, 200)}). Nobody picked up. Call back: ${who}`
    : `Called the shop and nobody picked up. Call back: ${who}`
  const existing = await ticketForCall(input.callSid, deps)
  if (existing) return addToTicket(existing.id, existing.subject, line, deps)
  const subject = `Missed call from ${who}`
  const filed = await openTicket({ subject, description: line, message: line }, deps)
  if (filed.ticketId) await linkCallToTicket(input.callSid, filed.ticketId, deps)
}

export function missedCallTwiml(): string {
  return twiml(say("Sorry, nobody could pick up just now. The shop has your number and will call you back. Thanks for calling Imagine This Printed.") + '<Hangup/>')
}

// ── inbound texts ───────────────────────────────────────────────────────────

export async function fileTextMessage(
  input: { from: string; body: string; mediaUrls: string[]; messageSid: string },
  deps: PhoneDeps,
): Promise<{ ticketId: string | null; joined: boolean; skipped?: string }> {
  const body = String(input.body || '').trim().slice(0, 4000)
  if (!body && input.mediaUrls.length === 0) return { ticketId: null, joined: false, skipped: 'empty' }
  if (input.mediaUrls.length === 0 && isCarrierKeyword(body)) return { ticketId: null, joined: false, skipped: 'keyword' }

  const subject = textSubject(input.from)
  const media = input.mediaUrls.length ? `\n\nPictures sent with the text:\n${input.mediaUrls.join('\n')}` : ''
  const message = `${body || '(no words, pictures only)'}${media}`

  const since = new Date(Date.now() - TEXT_THREAD_DAYS * 86_400_000).toISOString()
  const { data: open } = await deps.db
    .from('support_tickets')
    .select('id, subject')
    .eq('subject', subject)
    .in('status', OPEN_STATUSES)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
  const thread = Array.isArray(open) ? open[0] : null
  if (thread) {
    await addToTicket(thread.id, thread.subject, message, deps)
    return { ticketId: thread.id, joined: true }
  }

  const description = [
    `Texted to the shop number. Text back is not possible from it yet, so call or email them.`,
    `From: ${prettyPhone(input.from)}`,
    '',
    message,
  ].join('\n')
  const filed = await openTicket({ subject, description, message }, deps)
  return { ticketId: filed.ticketId, joined: false, skipped: filed.spam ? 'spam' : undefined }
}

// ── the transcript, at hangup ───────────────────────────────────────────────

export async function fileCallTranscript(callSid: string, deps: PhoneDeps): Promise<boolean> {
  const { data: call } = await deps.db.from('phone_calls').select('ticket_id, transcript_filed_at').eq('call_sid', callSid).maybeSingle()
  if (!call?.ticket_id || call.transcript_filed_at) return false
  const { data: turns } = await deps.db
    .from('phone_call_turns')
    .select('speaker, text, seq')
    .eq('call_sid', callSid)
    .order('seq', { ascending: true })
  if (!Array.isArray(turns) || turns.length === 0) return false
  const lines = turns.map((t: { speaker: string; text: string }) => `${t.speaker === 'assistant' ? 'Mr. Imagine' : 'Caller'}: ${t.text}`)
  await deps.db.from('ticket_messages').insert({
    ticket_id: call.ticket_id,
    sender_type: 'system',
    sender_id: null,
    message: `Call transcript (what was said on the phone)\n\n${lines.join('\n')}`.slice(0, 20_000),
    is_internal: true,
  })
  await deps.db.from('phone_calls').update({ transcript_filed_at: new Date().toISOString() }).eq('call_sid', callSid)
  return true
}

// ── dispatcher ──────────────────────────────────────────────────────────────

export async function runPhoneTool(
  tool: string,
  args: Record<string, unknown>,
  callSid: string,
  from: string,
  deps: PhoneDeps,
): Promise<ToolOutcome> {
  switch (tool) {
    case 'take_message':
      return takeMessage(args, callSid, from, deps)
    case 'transfer_to_shop':
      return transferToShop(args, callSid, deps)
    default:
      return { ok: false, speak: "I can't do that one." }
  }
}
