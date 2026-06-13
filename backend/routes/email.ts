// In-app email system (admin section + per-employee inboxes).
// Sending + receiving via Resend. Tables: email_mailboxes, email_messages
// (RLS locked; this service-role backend is the only reader/writer — role
// checks live here).
//
// Mounted at /api/email. The webhook route (/api/email/webhooks/resend) gets
// a raw body via express.raw() configured in backend/index.ts so the svix
// signature can be verified over the exact payload bytes.

import { Router, type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js';
import {
  sendViaResend,
  verifyResendWebhook,
  parseAddress,
  toAddressArray,
  EMAIL_DOMAIN,
  type InboundEmailData,
} from '../services/email-resend.js';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const requireAdmin = requireRole(['admin']);

const MAX_STORED_ATTACHMENT_BYTES = 1_000_000; // keep payloads sane in JSONB

function normalizeAddress(input: string): string {
  const raw = (input || '').trim().toLowerCase();
  if (!raw) return '';
  const address = raw.includes('@') ? raw : `${raw}@${EMAIL_DOMAIN}`;
  if (!address.endsWith(`@${EMAIL_DOMAIN}`)) return '';
  if (!/^[a-z0-9._%+-]+@/.test(address)) return '';
  return address;
}

async function getMailboxForUser(mailboxId: string, user: { id: string; role?: string }) {
  const { data: mailbox, error } = await supabase
    .from('email_mailboxes')
    .select('*')
    .eq('id', mailboxId)
    .single();
  if (error || !mailbox) return { mailbox: null, allowed: false };

  const isAdmin = user.role === 'admin';
  const allowed = isAdmin || mailbox.user_id === user.id;
  return { mailbox, allowed };
}

/** Resolve effective role when the JWT doesn't carry it. */
async function ensureRole(req: Request): Promise<string> {
  if (req.user?.role) return req.user.role;
  const { data } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', req.user!.id)
    .single();
  req.user!.role = data?.role || 'customer';
  return req.user!.role!;
}

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

// GET /api/email/users — admin-only: list users to assign mailboxes to.
// Powers the assignment dropdown in the Manage Mailboxes UI.
router.get('/users', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, username, role')
      .order('email', { ascending: true });
    if (error) throw error;
    res.json({ users: (data || []).filter((u: any) => u.email) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// GET /api/email/mailboxes — admin sees all, employees see their own
router.get('/mailboxes', requireAuth, async (req: Request, res: Response) => {
  try {
    const role = await ensureRole(req);
    let query = supabase
      .from('email_mailboxes')
      .select('*, owner:user_profiles!user_id(id, email, username)')
      .order('created_at', { ascending: true });
    if (role !== 'admin') {
      query = query.eq('user_id', req.user!.id);
    }
    const { data: mailboxes, error } = await query;
    if (error) throw error;

    // Unread counts (small N — one head-count query per mailbox)
    const withCounts = await Promise.all(
      (mailboxes || []).map(async (m: any) => {
        const { count } = await supabase
          .from('email_messages')
          .select('id', { count: 'exact', head: true })
          .eq('mailbox_id', m.id)
          .eq('direction', 'inbound')
          .eq('is_read', false)
          .eq('is_archived', false);
        return { ...m, unread_count: count ?? 0 };
      })
    );

    res.json({ mailboxes: withCounts });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/email/mailboxes — admin creates a company address
router.post('/mailboxes', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { address, display_name, user_email } = req.body || {};
    const normalized = normalizeAddress(address);
    if (!normalized) {
      res.status(400).json({ error: `Address must be a valid mailbox on @${EMAIL_DOMAIN}` });
      return;
    }

    let user_id: string | null = null;
    if (user_email) {
      const { data: owner } = await supabase
        .from('user_profiles')
        .select('id')
        .ilike('email', String(user_email).trim())
        .maybeSingle();
      if (!owner) {
        res.status(400).json({ error: `No user found with email ${user_email}. They must have an account first.` });
        return;
      }
      user_id = owner.id;
    }

    const { data, error } = await supabase
      .from('email_mailboxes')
      .insert({ address: normalized, display_name: display_name || '', user_id })
      .select()
      .single();
    if (error) {
      if (String(error.message).includes('duplicate')) {
        res.status(409).json({ error: 'That mailbox already exists' });
        return;
      }
      throw error;
    }
    res.json({ mailbox: data });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// PUT /api/email/mailboxes/:id — admin updates assignment / name / active
router.put('/mailboxes/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { display_name, user_email, is_active } = req.body || {};
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (display_name !== undefined) updates.display_name = display_name;
    if (is_active !== undefined) updates.is_active = !!is_active;
    if (user_email !== undefined) {
      if (user_email === null || user_email === '') {
        updates.user_id = null;
      } else {
        const { data: owner } = await supabase
          .from('user_profiles')
          .select('id')
          .ilike('email', String(user_email).trim())
          .maybeSingle();
        if (!owner) {
          res.status(400).json({ error: `No user found with email ${user_email}` });
          return;
        }
        updates.user_id = owner.id;
      }
    }

    const { data, error } = await supabase
      .from('email_mailboxes')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mailbox: data });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// DELETE /api/email/mailboxes/:id — admin only (cascades messages)
router.delete('/mailboxes/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.from('email_mailboxes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// GET /api/email/mailboxes/:id/messages?folder=inbox|sent|archived&search=&limit=&before=
router.get('/mailboxes/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureRole(req);
    const { mailbox, allowed } = await getMailboxForUser(req.params.id, req.user!);
    if (!mailbox) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'You do not have access to this mailbox' }); return; }

    const folder = String(req.query.folder || 'inbox');
    const search = String(req.query.search || '').trim();
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 100);
    const before = String(req.query.before || '');

    let query = supabase
      .from('email_messages')
      .select('id, direction, from_address, from_name, to_addresses, subject, is_read, is_archived, status, created_at, attachments')
      .eq('mailbox_id', mailbox.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (folder === 'sent') {
      query = query.eq('direction', 'outbound');
    } else if (folder === 'archived') {
      query = query.eq('is_archived', true);
    } else {
      query = query.eq('direction', 'inbound').eq('is_archived', false);
    }
    if (search) {
      query = query.or(`subject.ilike.%${search}%,from_address.ilike.%${search}%`);
    }
    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Strip attachment payloads from list responses (keep names/sizes)
    const messages = (data || []).map((m: any) => ({
      ...m,
      attachments: (m.attachments || []).map((a: any) => ({
        filename: a.filename, content_type: a.content_type, size: a.size,
      })),
    }));

    res.json({ messages, mailbox: { id: mailbox.id, address: mailbox.address, display_name: mailbox.display_name } });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// GET /api/email/messages/:id — full message body
router.get('/messages/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureRole(req);
    const { data: message, error } = await supabase
      .from('email_messages')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !message) { res.status(404).json({ error: 'Message not found' }); return; }

    const { allowed } = await getMailboxForUser(message.mailbox_id, req.user!);
    if (!allowed) { res.status(403).json({ error: 'You do not have access to this message' }); return; }

    // Opening an inbound message marks it read
    if (message.direction === 'inbound' && !message.is_read) {
      await supabase.from('email_messages').update({ is_read: true }).eq('id', message.id);
      message.is_read = true;
    }

    res.json({ message });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// PUT /api/email/messages/:id — toggle read / archived
router.put('/messages/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureRole(req);
    const { data: message } = await supabase
      .from('email_messages')
      .select('id, mailbox_id')
      .eq('id', req.params.id)
      .single();
    if (!message) { res.status(404).json({ error: 'Message not found' }); return; }

    const { allowed } = await getMailboxForUser(message.mailbox_id, req.user!);
    if (!allowed) { res.status(403).json({ error: 'You do not have access to this message' }); return; }

    const updates: Record<string, unknown> = {};
    if (req.body?.is_read !== undefined) updates.is_read = !!req.body.is_read;
    if (req.body?.is_archived !== undefined) updates.is_archived = !!req.body.is_archived;
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

    const { data, error } = await supabase
      .from('email_messages')
      .update(updates)
      .eq('id', message.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ message: data });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/email/send — send from one of the user's mailboxes
router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureRole(req);
    const { mailbox_id, to, cc, bcc, subject, html, text, in_reply_to_message_id } = req.body || {};

    if (!mailbox_id || !Array.isArray(to) || to.length === 0 || !subject) {
      res.status(400).json({ error: 'mailbox_id, to[] and subject are required' });
      return;
    }
    if (!html && !text) {
      res.status(400).json({ error: 'Provide html or text body' });
      return;
    }

    const { mailbox, allowed } = await getMailboxForUser(mailbox_id, req.user!);
    if (!mailbox) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'You do not have access to this mailbox' }); return; }
    if (!mailbox.is_active) { res.status(400).json({ error: 'This mailbox is deactivated' }); return; }

    // Reply threading headers
    const headers: Record<string, string> = {};
    let inReplyTo: string | null = null;
    if (in_reply_to_message_id) {
      const { data: original } = await supabase
        .from('email_messages')
        .select('message_id')
        .eq('id', in_reply_to_message_id)
        .single();
      if (original?.message_id) {
        headers['In-Reply-To'] = original.message_id;
        headers['References'] = original.message_id;
        inReplyTo = original.message_id;
      }
    }

    const fromHeader = mailbox.display_name
      ? `${mailbox.display_name} <${mailbox.address}>`
      : mailbox.address;

    const result = await sendViaResend({
      from: fromHeader,
      to,
      cc: Array.isArray(cc) && cc.length ? cc : undefined,
      bcc: Array.isArray(bcc) && bcc.length ? bcc : undefined,
      subject,
      html: html || undefined,
      text: text || undefined,
      headers: Object.keys(headers).length ? headers : undefined,
    });

    const { data: stored, error } = await supabase
      .from('email_messages')
      .insert({
        mailbox_id: mailbox.id,
        direction: 'outbound',
        resend_id: result.id,
        in_reply_to: inReplyTo,
        from_address: mailbox.address,
        from_name: mailbox.display_name || '',
        to_addresses: to,
        cc_addresses: Array.isArray(cc) ? cc : [],
        bcc_addresses: Array.isArray(bcc) ? bcc : [],
        subject,
        text_body: text || null,
        html_body: html || null,
        status: 'sent',
        is_read: true,
      })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, message: stored });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ---------------------------------------------------------------------------
// Mr. Imagine email assistant (summarize / catch-up / draft replies)
// Gemini 2.5 Flash via OpenRouter — chosen over DeepSeek for latency,
// existing integration (OPENROUTER_API_KEY already provisioned), 1M-token
// context for long threads, and US-hosted processing of employee email.
// ---------------------------------------------------------------------------

const assistantRateLimit = new Map<string, { count: number; resetAt: number }>();
const ASSISTANT_LIMIT = 20;
const ASSISTANT_WINDOW_MS = 60_000;

function checkAssistantLimit(userId: string): boolean {
  const now = Date.now();
  const state = assistantRateLimit.get(userId);
  if (!state || state.resetAt < now) {
    assistantRateLimit.set(userId, { count: 1, resetAt: now + ASSISTANT_WINDOW_MS });
    return true;
  }
  if (state.count >= ASSISTANT_LIMIT) return false;
  state.count++;
  return true;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function messageBodyText(m: { text_body?: string | null; html_body?: string | null }, cap: number): string {
  const text = m.text_body?.trim() || (m.html_body ? htmlToPlainText(m.html_body) : '');
  return text.slice(0, cap);
}

const MR_IMAGINE_SYSTEM_PROMPT =
  'You are Mr. Imagine, the friendly purple mascot and inbox sidekick at Imagine This Printed. ' +
  'You help employees understand and handle their email. Your answers are read aloud by text-to-speech, ' +
  'so write in plain spoken sentences: no markdown, no bullet symbols, no links or raw URLs, no emoji. ' +
  'Be warm, upbeat and CONCISE — a few short sentences for summaries, a short paragraph at most unless ' +
  'asked to draft a reply. When drafting a reply, output only the reply text itself. ' +
  'Never invent emails that are not in the provided context; if the context is empty, say so.';

router.post('/assistant', requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureRole(req);
    const { mailbox_id, instruction, message_id } = req.body || {};

    if (!mailbox_id || !instruction || typeof instruction !== 'string') {
      res.status(400).json({ error: 'mailbox_id and instruction are required' });
      return;
    }
    if (instruction.length > 2000) {
      res.status(400).json({ error: 'Instruction too long' });
      return;
    }
    if (!checkAssistantLimit(req.user!.id)) {
      res.status(429).json({ error: 'Mr. Imagine needs a breather — try again in a minute.' });
      return;
    }
    if (!process.env.OPENROUTER_API_KEY) {
      res.status(503).json({ error: 'Assistant is not configured (missing OPENROUTER_API_KEY)' });
      return;
    }

    const { mailbox, allowed } = await getMailboxForUser(mailbox_id, req.user!);
    if (!mailbox) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'You do not have access to this mailbox' }); return; }

    // Build context: one message, or a digest of the recent inbox
    let context: string;
    if (message_id) {
      const { data: m } = await supabase
        .from('email_messages')
        .select('from_address, from_name, subject, created_at, text_body, html_body, to_addresses')
        .eq('id', message_id)
        .eq('mailbox_id', mailbox.id)
        .single();
      if (!m) { res.status(404).json({ error: 'Message not found in this mailbox' }); return; }
      context =
        `EMAIL (mailbox ${mailbox.address})\n` +
        `From: ${m.from_name ? `${m.from_name} ` : ''}${m.from_address}\n` +
        `Date: ${m.created_at}\nSubject: ${m.subject}\n\n${messageBodyText(m, 6000)}`;
    } else {
      const { data: recent } = await supabase
        .from('email_messages')
        .select('from_address, from_name, subject, created_at, is_read, text_body, html_body')
        .eq('mailbox_id', mailbox.id)
        .eq('direction', 'inbound')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(20);
      if (!recent || recent.length === 0) {
        res.json({ reply: `Your ${mailbox.address} inbox is empty right now — nothing to catch up on!` });
        return;
      }
      context =
        `RECENT INBOX for ${mailbox.address} (newest first, ${recent.length} messages):\n\n` +
        recent
          .map((m, i) =>
            `${i + 1}. ${m.is_read ? '' : '[UNREAD] '}From ${m.from_name || m.from_address} — "${m.subject}" (${m.created_at})\n` +
            `   ${messageBodyText(m, 240)}`
          )
          .join('\n');
    }

    const { default: OpenAI } = await import('openai');
    const openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });

    const completion = await openrouter.chat.completions.create({
      model: 'google/gemini-2.5-flash',
      temperature: 0.6,
      max_tokens: 700,
      messages: [
        { role: 'system', content: MR_IMAGINE_SYSTEM_PROMPT },
        { role: 'user', content: `${context}\n\n---\nREQUEST: ${instruction}` },
      ],
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      res.status(502).json({ error: 'Mr. Imagine came back empty-handed — try again.' });
      return;
    }
    res.json({ reply });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ---------------------------------------------------------------------------
// Inbound webhook (Resend email.received, svix-signed, raw body)
// ---------------------------------------------------------------------------

router.post('/webhooks/resend', async (req: Request, res: Response) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);

    const valid = verifyResendWebhook(rawBody, {
      id: req.header('svix-id') || undefined,
      timestamp: req.header('svix-timestamp') || undefined,
      signature: req.header('svix-signature') || undefined,
    });
    if (!valid) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const event = JSON.parse(rawBody);
    if (event?.type !== 'email.received') {
      res.json({ received: true, ignored: event?.type });
      return;
    }

    const data: InboundEmailData = event.data || {};
    const from = parseAddress(String(data.from || ''));
    const recipients = [...toAddressArray(data.to), ...toAddressArray(data.cc)];

    // Resend webhooks are account-wide — only handle our domain's recipients.
    const ourRecipients = [...new Set(recipients.filter(r => r.endsWith(`@${EMAIL_DOMAIN}`)))];
    if (ourRecipients.length === 0) {
      res.json({ received: true, matched: 0 });
      return;
    }

    const { data: mailboxes } = await supabase
      .from('email_mailboxes')
      .select('id, address')
      .in('address', ourRecipients)
      .eq('is_active', true);

    const attachments = (data.attachments || []).map(a => ({
      filename: a.filename || 'attachment',
      content_type: a.content_type || 'application/octet-stream',
      size: a.size ?? (a.content ? Math.floor(a.content.length * 0.75) : 0),
      // Persist small payloads inline so the UI can offer downloads;
      // oversized content is dropped (metadata retained).
      content: a.content && a.content.length <= MAX_STORED_ATTACHMENT_BYTES ? a.content : undefined,
    }));

    let inserted = 0;
    for (const mailbox of mailboxes || []) {
      const { error } = await supabase.from('email_messages').insert({
        mailbox_id: mailbox.id,
        direction: 'inbound',
        resend_id: data.email_id || null,
        message_id: data.message_id || null,
        from_address: from.address,
        from_name: from.name,
        to_addresses: toAddressArray(data.to),
        cc_addresses: toAddressArray(data.cc),
        subject: data.subject || '(no subject)',
        text_body: data.text || null,
        html_body: data.html || null,
        attachments,
        status: 'received',
      });
      // Unique index (mailbox_id, resend_id) absorbs webhook retries
      if (!error) inserted++;
      else if (!String(error.message).includes('duplicate')) {
        console.error('[email-webhook] insert failed:', error.message);
      }
    }

    if ((mailboxes || []).length < ourRecipients.length) {
      const known = new Set((mailboxes || []).map(m => m.address));
      const unknown = ourRecipients.filter(r => !known.has(r));
      console.warn('[email-webhook] mail for unknown mailbox(es):', unknown.join(', '));
    }

    res.json({ received: true, matched: inserted });
  } catch (error) {
    console.error('[email-webhook] error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
