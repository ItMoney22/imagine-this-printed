import { Router, Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase.js'
import { getCachedRole } from '../lib/role-cache.js'
import { sendViaResend } from '../services/email-resend.js'

// A store's own inbox (David 2026-10-26: "she needs a spot to read her email that goes to
// crystal@imaginethisprinted.com, also put jev in it so we make sure keeps junk away").
//
// Mail reaches the store's mailbox (vendor_storefronts.inbox_mailbox_id) through the Resend webhook in
// routes/email.ts, which files Jev's spam archived + read on the way in (lib/inbound-spam.ts). That filed
// mail is the Junk tab here; this page has no other way to archive, so archived inbound mail IS junk.
//
// Mounted by routes/vendor-store.ts at /api/vendor-store/manage/:slug/inbox behind requireStoreManager.
// Readers: the store's owner and ITP admins (role admin). A manager runs stores but does not read her mail.
//
//   GET   /?folder=inbox|junk     her mail, newest first, with the unread and junk counts
//   GET   /:id                    one message (the owner opening it marks it read) + her replies to it
//   POST  /:id/reply { text }     answer the sender from the store's address
//   PATCH /:id { junk }           move it between Inbox and Junk
const inbox = Router()

const LIST_LIMIT = 30
const REPLY_DAILY_CAP = 100
const replyUse = new Map<string, { day: string; sent: number }>()
function replyAllowed(mailboxId: string): boolean {
  const day = new Date().toISOString().slice(0, 10)
  const u = replyUse.get(mailboxId)
  if (!u || u.day !== day) {
    replyUse.set(mailboxId, { day, sent: 1 })
    return true
  }
  if (u.sent >= REPLY_DAILY_CAP) return false
  u.sent++
  return true
}

type Mailbox = { id: string; address: string; display_name: string | null; is_active: boolean }
type InboxCtx = { mailbox: Mailbox | null; owner: boolean }
declare global {
  namespace Express {
    interface Request { storeInbox?: InboxCtx }
  }
}

/** The store's mailbox follows its owner: hers once she has claimed the store, nobody's before. */
export async function syncInboxOwner(inboxMailboxId: string | null | undefined, userId: string | null): Promise<void> {
  if (!inboxMailboxId) return
  await supabase.from('email_mailboxes').update({ user_id: userId, updated_at: new Date().toISOString() }).eq('id', inboxMailboxId)
}

async function requireInboxReader(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { store } = req.vendorStore!
  const owner = !!store.owner_user_id && store.owner_user_id === req.user!.sub
  if (!owner && (await getCachedRole(req.user!.sub)) !== 'admin') {
    res.status(403).json({ error: 'Only the store owner reads this inbox' })
    return
  }
  let mailbox: Mailbox | null = null
  if (store.inbox_mailbox_id) {
    const { data } = await supabase
      .from('email_mailboxes').select('id, address, display_name, is_active').eq('id', store.inbox_mailbox_id).maybeSingle()
    mailbox = (data as Mailbox) || null
  }
  req.storeInbox = { mailbox, owner }
  next()
}
inbox.use(requireInboxReader)

/** The first words of a message for its row: quoted history and links dropped. */
export function previewOf(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .split(/\r?\n/)
    .filter(l => !/^\s*>/.test(l))
    .join(' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

function headerSafe(s: string): string {
  return String(s || '').replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const countOf = async (mailboxId: string, junk: boolean, unreadOnly: boolean): Promise<number> => {
  let q = supabase
    .from('email_messages').select('id', { count: 'exact', head: true })
    .eq('mailbox_id', mailboxId).eq('direction', 'inbound').eq('is_archived', junk)
  if (unreadOnly) q = q.eq('is_read', false)
  const { count } = await q
  return count ?? 0
}

async function loadInbound(mailboxId: string, id: string) {
  const { data } = await supabase
    .from('email_messages')
    .select('id, message_id, from_address, from_name, to_addresses, subject, text_body, html_body, attachments, is_read, is_archived, created_at')
    .eq('id', id).eq('mailbox_id', mailboxId).eq('direction', 'inbound').maybeSingle()
  return data as any
}

inbox.get('/', async (req: Request, res: Response): Promise<any> => {
  const { mailbox } = req.storeInbox!
  const folder = req.query.folder === 'junk' ? 'junk' : 'inbox'
  if (!mailbox) return res.json({ address: null, folder, unread: 0, junk: 0, messages: [] })
  const [{ data, error }, unread, junk] = await Promise.all([
    supabase
      .from('email_messages')
      .select('id, from_address, from_name, subject, text_body, attachments, is_read, created_at')
      .eq('mailbox_id', mailbox.id).eq('direction', 'inbound').eq('is_archived', folder === 'junk')
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT),
    countOf(mailbox.id, false, true),
    countOf(mailbox.id, true, false),
  ])
  if (error) return res.status(500).json({ error: 'Your mail didn’t load' })
  return res.json({
    address: mailbox.address,
    folder,
    unread,
    junk,
    messages: (data || []).map((m: any) => ({
      id: m.id,
      fromName: m.from_name || '',
      fromAddress: m.from_address,
      subject: m.subject || '(no subject)',
      preview: previewOf(m.text_body),
      at: m.created_at,
      read: !!m.is_read,
      attachments: Array.isArray(m.attachments) ? m.attachments.length : 0,
    })),
  })
})

inbox.get('/:id', async (req: Request, res: Response): Promise<any> => {
  const { mailbox, owner } = req.storeInbox!
  if (!mailbox) return res.status(404).json({ error: 'Message not found' })
  const m = await loadInbound(mailbox.id, req.params.id)
  if (!m) return res.status(404).json({ error: 'Message not found' })
  // Only her own eyes clear the unread dot: an admin looking in leaves it for her.
  if (owner && !m.is_read) await supabase.from('email_messages').update({ is_read: true }).eq('id', m.id)
  const { data: replies } = m.message_id
    ? await supabase
        .from('email_messages').select('created_at, text_body')
        .eq('mailbox_id', mailbox.id).eq('direction', 'outbound').eq('in_reply_to', m.message_id)
        .order('created_at', { ascending: true })
    : { data: [] }
  return res.json({
    message: {
      id: m.id,
      fromName: m.from_name || '',
      fromAddress: m.from_address,
      to: Array.isArray(m.to_addresses) ? m.to_addresses : [],
      subject: m.subject || '(no subject)',
      at: m.created_at,
      html: m.html_body || null,
      text: m.text_body || null,
      attachments: (Array.isArray(m.attachments) ? m.attachments : []).map((a: any) => ({ filename: a.filename, size: a.size || 0, url: a.url || null })),
      junk: !!m.is_archived,
    },
    replies: (replies || []).map((r: any) => ({ at: r.created_at, text: r.text_body || '' })),
  })
})

inbox.post('/:id/reply', async (req: Request, res: Response): Promise<any> => {
  const { mailbox } = req.storeInbox!
  if (!mailbox) return res.status(404).json({ error: 'Message not found' })
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  if (!text) return res.status(400).json({ error: 'Write your reply first' })
  if (text.length > 10000) return res.status(400).json({ error: 'That reply is too long' })
  if (!mailbox.is_active) return res.status(400).json({ error: 'This inbox is switched off' })
  const m = await loadInbound(mailbox.id, req.params.id)
  if (!m) return res.status(404).json({ error: 'Message not found' })
  if (m.is_archived) return res.status(400).json({ error: 'Move it to your inbox first' })
  if (!replyAllowed(mailbox.id)) return res.status(429).json({ error: 'That’s a lot of replies today. Try again tomorrow.' })

  const subject = /^re:/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`.trim()
  const when = new Date(m.created_at).toUTCString()
  const who = m.from_name ? `${m.from_name} <${m.from_address}>` : m.from_address
  const original = String(m.text_body || '').slice(0, 4000)
  const fullText = `${text}\n\nOn ${when}, ${who} wrote:\n${original.split(/\r?\n/).map(l => `> ${l}`).join('\n')}`
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(text)}</div>` +
    (original
      ? `<p style="color:#6b6b6b;font-size:13px;margin:18px 0 6px;">On ${escapeHtml(when)}, ${escapeHtml(who)} wrote:</p>` +
        `<blockquote style="margin:0;padding-left:12px;border-left:3px solid #ddd;color:#555;white-space:pre-wrap;">${escapeHtml(original)}</blockquote>`
      : '')
  const headers: Record<string, string> = {}
  if (m.message_id) {
    headers['In-Reply-To'] = m.message_id
    headers['References'] = m.message_id
  }

  let sentId: string
  try {
    const name = headerSafe(mailbox.display_name || '')
    ;({ id: sentId } = await sendViaResend({
      from: name ? `"${name}" <${mailbox.address}>` : mailbox.address,
      to: [m.from_address],
      subject,
      html,
      text: fullText,
      headers: Object.keys(headers).length ? headers : undefined,
    }))
  } catch (error: any) {
    req.log?.error({ err: error, mailbox: mailbox.address }, 'store inbox reply failed')
    return res.status(502).json({ error: 'Your reply didn’t send. Try again.' })
  }

  const at = new Date().toISOString()
  const { error } = await supabase.from('email_messages').insert({
    mailbox_id: mailbox.id,
    direction: 'outbound',
    resend_id: sentId,
    in_reply_to: m.message_id || null,
    from_address: mailbox.address,
    from_name: mailbox.display_name || '',
    to_addresses: [m.from_address],
    subject,
    text_body: text,
    html_body: html,
    status: 'sent',
    is_read: true,
    created_at: at,
  })
  // It went out; a failed copy only costs her the "you replied" line under the message.
  if (error) req.log?.error({ err: error, mailbox: mailbox.address }, 'store inbox reply sent but not stored')
  return res.json({ ok: true, reply: { at, text } })
})

inbox.patch('/:id', async (req: Request, res: Response): Promise<any> => {
  const { mailbox } = req.storeInbox!
  if (!mailbox) return res.status(404).json({ error: 'Message not found' })
  if (typeof req.body?.junk !== 'boolean') return res.status(400).json({ error: 'Say junk true or false' })
  const m = await loadInbound(mailbox.id, req.params.id)
  if (!m) return res.status(404).json({ error: 'Message not found' })
  const { error } = await supabase.from('email_messages').update({ is_archived: req.body.junk }).eq('id', m.id)
  if (error) return res.status(500).json({ error: 'Failed to move it' })
  return res.json({ ok: true, junk: req.body.junk })
})

export default inbox
