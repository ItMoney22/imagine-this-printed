// ============================================================================
// The email a customer gets when Christina (or anyone on the team) answers
// their ticket. Pure, so the greeting and header are tested
// (ticket-emails.test.ts); utils/email.ts sendTicketReplyEmail sends it.
//
// David 2026-10-07 (task 5878a61f): it greeted "Friend" even when the customer
// typed a name, and the header said "New Reply From Support" whoever wrote.
// Now it greets the typed name and says who answered and about what.
// ============================================================================
import { typedName } from './email-blocks.js'

const SUPPORT_INBOX = 'wecare@imaginethisprinted.com'

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * The name the customer typed. support_tickets has no name column: the contact
 * form (routes/support.ts) and the chat hand-off (services/live-chat.ts) write it
 * as the description's first line, "Name: Maria Lopez". Only the first line
 * counts, so a "Name:" inside the customer's own message is never read.
 */
export function nameFromTicketDescription(description?: string | null): string | null {
  const m = /^Name:[ \t]*([^\r\n]+)/.exec(String(description || ''))
  return typedName(m?.[1])
}

/** What the ticket is about, without the "Live chat:" filing prefix. */
export function ticketTopic(subject?: string | null): string {
  const s = String(subject || '').replace(/^live chat:\s*/i, '').trim()
  return s || 'your message'
}

/** Who answered: a real first name, or the shop when the reply came from the generic admin seat. */
export function replierName(agentName?: string | null): string {
  const n = String(agentName || '').trim()
  return n && !/^support( team| agent)?$/i.test(n) ? n.slice(0, 40) : 'Imagine This Printed'
}

export interface TicketReplyEmailInput {
  ticketId: string
  subject?: string | null
  /** Already HTML-safe (print-bridge escapes Christina's words; the admin console sends staff text). */
  agentMessageHtml: string
  agentName?: string | null
  customerName?: string | null
}

export function ticketReplyEmail(input: TicketReplyEmailInput): { subject: string; html: string } {
  const who = replierName(input.agentName)
  const name = typedName(input.customerName)
  const topic = ticketTopic(input.subject)
  const ref = String(input.ticketId).slice(0, 8).toUpperCase()
  const replySubject = encodeURIComponent(`Re: ${topic} [Ref ${ref}]`)
  const headline = name ? `Hi ${esc(name)}, ${esc(who)} wrote back` : `${esc(who)} wrote back`

  const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1c1917;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #7c3aed; margin: 0 0 8px 0; font-size: 26px;">${headline}</h1>
          <p style="color: #78716c; font-size: 14px; margin: 0;">About &ldquo;${esc(topic)}&rdquo; &middot; Ref ${ref}</p>
        </div>

        <div style="background: #ffffff; border: 2px solid #ede9fe; border-radius: 16px; padding: 24px; margin-bottom: 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 14px;"><tr>
            <td style="width: 44px; height: 44px; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 50%; text-align: center; vertical-align: middle; color: #ffffff; font-weight: bold; font-size: 18px;">${esc(who[0].toUpperCase())}</td>
            <td style="padding-left: 12px;">
              <p style="margin: 0; color: #1c1917; font-weight: 600; font-size: 15px;">${esc(who)}</p>
              <p style="margin: 0; color: #78716c; font-size: 12px;">Imagine This Printed &middot; Rockmart, GA</p>
            </td>
          </tr></table>
          <p style="color: #44403c; font-size: 15px; line-height: 1.6; white-space: pre-wrap; margin: 0;">${input.agentMessageHtml}</p>
        </div>

        <div style="text-align: center; margin: 28px 0 12px;">
          <a href="mailto:${SUPPORT_INBOX}?subject=${replySubject}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: #ffffff; padding: 14px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Reply to ${esc(who)}
          </a>
        </div>
        <p style="color: #78716c; font-size: 13px; text-align: center; margin: 0 0 28px;">Or just hit reply. It comes straight to our shop inbox.</p>

        <div style="border-top: 1px solid #e7e5e4; padding-top: 18px;">
          <p style="color: #a8a29e; font-size: 12px; text-align: center; margin: 0;">
            Imagine This Printed &middot; 640 Goodyear Ave, Rockmart, GA 30153<br>
            Your reference number is ${ref}.
          </p>
        </div>
      </div>
    `
  return { subject: `${who} wrote back: ${topic}`, html }
}
