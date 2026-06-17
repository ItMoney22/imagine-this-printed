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
  fetchReceivedEmail,
  fetchReceivedAttachments,
  downloadAttachment,
  parseAddress,
  toAddressArray,
  EMAIL_DOMAIN,
  type InboundEmailData,
} from '../services/email-resend.js';
import { uploadFile } from '../services/gcs-storage.js';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const requireAdmin = requireRole(['admin']);

// Inbound attachments are re-hosted in GCS (not stored inline in JSONB), so
// this is just an abuse guard, not a payload-size constraint. 25 MB ≈ a typical
// mail provider attachment limit.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// GCS object names: keep them filesystem-safe and bounded.
function sanitizeAttachmentName(name: string): string {
  return (name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment';
}

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
  // A mailbox ASSIGNED to a user (user_id set) is private to that user — even
  // admins cannot read or send from someone else's assigned mailbox. Unassigned
  // company mailboxes (user_id null, e.g. wecare@) are shared and usable by admins.
  const allowed = mailbox.user_id === user.id || (isAdmin && mailbox.user_id == null);
  return { mailbox, allowed };
}

// Branded HTML signature appended to every outgoing message that has a
// configured signature_title (or display name). Marked with data-itp-signature
// so re-sends / forwards don't stack duplicate signatures.
function renderSignature(mailbox: { display_name?: string | null; address: string; signature_title?: string | null }): string {
  const name = (mailbox.display_name || mailbox.address).trim();
  const role = mailbox.signature_title?.trim();
  const titleLine = role ? `${escapeHtmlText(role)} &middot; Imagine This Printed` : 'Imagine This Printed';
  return (
    `<div data-itp-signature="1" style="margin-top:28px;padding-top:18px;border-top:1px solid #e5e7eb;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">` +
      `<p style="margin:0;font-weight:700;color:#7c3aed;font-size:15px;">${escapeHtmlText(name)}</p>` +
      `<p style="margin:2px 0 0;color:#374151;font-size:13px;">${titleLine}</p>` +
      `<p style="margin:6px 0 0;font-size:12px;color:#6b7280;">` +
        `<a href="https://imaginethisprinted.com" style="color:#7c3aed;text-decoration:none;">imaginethisprinted.com</a>` +
        `&nbsp;&middot;&nbsp;<a href="mailto:${mailbox.address}" style="color:#7c3aed;text-decoration:none;">${mailbox.address}</a>` +
      `</p>` +
    `</div>`
  );
}

function escapeHtmlText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Product cards built server-side with the EXACT (escaped) image/url — the AI
// only places a [[PRODUCTS]] token; it must never try to echo the long signed
// GCS image URLs itself (it mangles them, so images break).
interface EmailProduct { name: string; price: number; url: string; image: string | null }
function buildProductCardsHtml(products: EmailProduct[]): string {
  if (!products.length) return '';
  const cards = products
    .map(p => {
      const img = p.image
        ? `<td width="96" style="padding:12px;"><img src="${escapeHtmlText(p.image)}" alt="${escapeHtmlText(p.name)}" width="80" height="80" style="width:80px;height:80px;object-fit:cover;border-radius:8px;display:block;" /></td>`
        : '';
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff;"><tr>${img}` +
        `<td style="padding:12px;vertical-align:middle;">` +
        `<div style="font-weight:600;color:#374151;font-size:15px;">${escapeHtmlText(p.name)}</div>` +
        `<div style="color:#059669;font-weight:700;margin:4px 0;">$${Number(p.price || 0).toFixed(2)}</div>` +
        `<a href="${escapeHtmlText(p.url)}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;">View Product</a>` +
        `</td></tr></table>`
      );
    })
    .join('');
  return `<div style="margin-top:20px;"><p style="color:#7c3aed;font-weight:600;margin:0 0 8px;font-family:'Segoe UI',Tahoma,sans-serif;">Featured for you</p>${cards}</div>`;
}

function buildCouponBannerHtml(code: string, type: string, value: number): string {
  const label = type === 'fixed' ? `$${Number(value).toFixed(2)} OFF` : `${value}% OFF`;
  return (
    `<div style="margin:20px 0;text-align:center;">` +
    `<div style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#ec4899);border-radius:14px;padding:18px 30px;">` +
    `<div style="color:rgba(255,255,255,.85);font-size:12px;letter-spacing:1px;text-transform:uppercase;font-family:'Segoe UI',Tahoma,sans-serif;">Your code &middot; ${label}</div>` +
    `<div style="color:#fff;font-size:28px;font-weight:800;letter-spacing:3px;margin-top:4px;font-family:'Segoe UI',Tahoma,sans-serif;">${escapeHtmlText(code)}</div>` +
    `</div></div>`
  );
}

// Create (or reuse) a discount_codes coupon. Idempotent on code. Returns the
// coupon, or null if invalid / on error. Codes are stored UPPERCASE to match
// redemption (routes/coupons.ts compares code.toUpperCase()).
async function createEmailCoupon(
  spec: { code?: string; type?: string; value?: number | string },
  userId: string,
  recipient?: string
): Promise<{ code: string; type: string; value: number; existed: boolean } | null> {
  const code = String(spec.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const type = spec.type === 'fixed' ? 'fixed' : 'percentage';
  let value = Number(spec.value);
  if (!code || code.length < 3 || !Number.isFinite(value) || value <= 0) return null;
  if (type === 'percentage') value = Math.min(value, 100);

  const { data: existing } = await supabase
    .from('discount_codes')
    .select('code, type, value')
    .eq('code', code)
    .maybeSingle();
  if (existing) return { code: existing.code, type: existing.type, value: Number(existing.value), existed: true };

  const { data, error } = await supabase
    .from('discount_codes')
    .insert({
      code,
      type,
      value,
      is_active: true,
      current_uses: 0,
      description: `Created via Mr. Imagine email${recipient ? ` for ${recipient}` : ''}`,
      per_user_limit: 1,
      applies_to: 'usd',
      created_by: userId,
      metadata: { source: 'email_compose', intended_recipient: recipient || null },
    })
    .select('code, type, value')
    .single();
  if (error) {
    console.error('[compose-assist] coupon create failed:', error.message);
    return null;
  }
  return { code: data.code, type: data.type, value: Number(data.value), existed: false };
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

// GET /api/email/mailboxes — INBOX view: only the caller's OWN mailboxes
// (admins also see unassigned shared company boxes like wecare@). This is the
// list shown in the 3-pane mail client, so an admin no longer sees employees'
// private mailboxes here.
// GET /api/email/mailboxes?scope=all — admin-only: every mailbox, for the
// "Manage Mailboxes" administration UI.
router.get('/mailboxes', requireAuth, async (req: Request, res: Response) => {
  try {
    const role = await ensureRole(req);
    const scope = String(req.query.scope || 'mine');
    let query = supabase
      .from('email_mailboxes')
      .select('*, owner:user_profiles!user_id(id, email, username)')
      .order('created_at', { ascending: true });
    if (scope === 'all') {
      if (role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
      // no owner filter — full administrative list
    } else if (role === 'admin') {
      // own mailboxes + shared/unassigned company mailboxes
      query = query.or(`user_id.eq.${req.user!.id},user_id.is.null`);
    } else {
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
    const { display_name, user_email, is_active, signature_title } = req.body || {};
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (display_name !== undefined) updates.display_name = display_name;
    if (signature_title !== undefined) updates.signature_title = signature_title || null;
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

    // Build the final HTML body and append the sender's branded signature.
    // If the caller sent rich HTML (AI compose), use it as-is; otherwise wrap
    // the plain text. Signature is added server-side so every outgoing message
    // is consistently signed (and never double-signed).
    let finalHtml =
      (typeof html === 'string' && html.trim())
        ? html
        : `<div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;white-space:pre-wrap;color:#374151;font-size:15px;line-height:1.6;">${escapeHtmlText(text || '')}</div>`;
    if (!finalHtml.includes('data-itp-signature')) {
      finalHtml += renderSignature(mailbox);
    }
    const finalText = (typeof text === 'string' && text.trim()) ? text : htmlToPlainText(finalHtml);

    const result = await sendViaResend({
      from: fromHeader,
      to,
      cc: Array.isArray(cc) && cc.length ? cc : undefined,
      bcc: Array.isArray(bcc) && bcc.length ? bcc : undefined,
      subject,
      html: finalHtml,
      text: finalText,
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
        text_body: finalText || null,
        html_body: finalHtml || null,
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
    const { mailbox_id, instruction, message_id, history } = req.body || {};

    if (!mailbox_id || !instruction || typeof instruction !== 'string') {
      res.status(400).json({ error: 'mailbox_id and instruction are required' });
      return;
    }

    // Prior conversation turns so the user can iterate ("now make it warmer",
    // "tell her we ship Monday"). Keep only the last 8, text only, capped.
    const priorTurns: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(history)
      ? history
          .filter((t: any) => t && (t.role === 'user' || t.role === 'assistant') && typeof (t.text ?? t.content) === 'string')
          .slice(-8)
          .map((t: any) => ({ role: t.role, content: String(t.text ?? t.content).slice(0, 4000) }))
      : [];
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
        // The email context is established once as the first user turn so the
        // model keeps "the email we're discussing" in view across follow-ups.
        { role: 'user', content: context },
        ...priorTurns,
        { role: 'user', content: instruction },
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
// Featured products — for inserting product blocks into composed emails.
// GET /api/email/featured-products?search=
// ---------------------------------------------------------------------------

router.get('/featured-products', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query.search || '').trim();
    let query = supabase
      .from('products')
      .select('id, name, price, images, slug, category, is_featured')
      .eq('is_active', true)
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(24);
    if (search) query = query.ilike('name', `%${search}%`);
    const { data, error } = await query;
    if (error) throw error;
    const products = (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      price: typeof p.price === 'number' ? p.price : Number(p.price ?? 0),
      image: Array.isArray(p.images) && p.images.length ? p.images[0] : null,
      category: p.category || null,
      is_featured: !!p.is_featured,
      url: `https://imaginethisprinted.com/product/${p.id}`,
    }));
    res.json({ products });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ---------------------------------------------------------------------------
// Mr. Imagine compose assistant — writes / polishes a high-end HTML email.
// POST /api/email/compose-assist { mailbox_id, instruction, draft?, recipient?,
//   tone?, products?: [{name, price, url, image}] } -> { subject, html }
// Gemini 2.5 Flash via OpenRouter. Returns an on-brand HTML content fragment
// (no signature — that's appended at send time).
// ---------------------------------------------------------------------------

const COMPOSE_SYSTEM_PROMPT =
  'You are Mr. Imagine, the email copywriter for Imagine This Printed, a custom printing and AI-design company. ' +
  'Write a polished, high-end, on-brand client/marketing email body as clean HTML with INLINE styles only. ' +
  'Brand: friendly but professional, primary purple #7c3aed, pink accent #ec4899, light background, white rounded cards, generous spacing, mobile-friendly. ' +
  'Rules: (1) Do NOT include <html>, <head> or <body> tags — return a content fragment that lives inside an email container. ' +
  '(2) Do NOT add a sign-off name, signature, or "Best, ..." block — the system appends the sender\'s signature automatically. ' +
  '(3) If PRODUCTS are provided, write copy that introduces them, and place the exact token [[PRODUCTS]] on its own line where the product showcase should appear. Do NOT write product cards, <img> tags, prices, or URLs yourself — the real product cards are inserted automatically in place of the token. ' +
  '(4) If the user asks to offer a discount or coupon (e.g. "add a coupon MONEYMAN15 for 15% off"), put it in the JSON "coupon" field as {"code":"<CODE>","type":"percentage"|"fixed","value":<number>}, mention the offer naturally in the copy, and place the exact token [[COUPON]] on its own line where the code box should appear. Do NOT format the code box yourself. Omit the coupon field entirely if no discount was requested. ' +
  '(5) Keep copy concise and compelling — a strong hook, clear value, one clear call to action. ' +
  '(6) Use only inline style="" attributes, never <style> blocks or external CSS. ' +
  'Return STRICT JSON and nothing else: {"subject": "<email subject>", "html": "<the html body fragment>", "coupon": <optional {code,type,value}>}.';

function stripJsonFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

router.post('/compose-assist', requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureRole(req);
    const { mailbox_id, instruction, draft, recipient, tone, products } = req.body || {};

    if (!mailbox_id || !instruction || typeof instruction !== 'string') {
      res.status(400).json({ error: 'mailbox_id and instruction are required' });
      return;
    }
    if (instruction.length > 4000) {
      res.status(400).json({ error: 'Instruction too long' });
      return;
    }
    if (!checkAssistantLimit(req.user!.id)) {
      res.status(429).json({ error: 'Mr. Imagine needs a breather — try again in a minute.' });
      return;
    }
    if (!process.env.OPENROUTER_API_KEY) {
      res.status(503).json({ error: 'Compose assist is not configured (missing OPENROUTER_API_KEY)' });
      return;
    }

    const { mailbox, allowed } = await getMailboxForUser(mailbox_id, req.user!);
    if (!mailbox) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'You do not have access to this mailbox' }); return; }

    const productList = Array.isArray(products)
      ? products.slice(0, 8).map((p: any) => ({
          name: String(p?.name ?? '').slice(0, 200),
          price: typeof p?.price === 'number' ? p.price : Number(p?.price ?? 0),
          url: String(p?.url ?? '').slice(0, 500),
          image: p?.image ? String(p.image).slice(0, 1000) : null,
        }))
      : [];

    const userParts = [
      `SENDER: ${mailbox.display_name || mailbox.address} <${mailbox.address}>`,
      recipient ? `RECIPIENT: ${String(recipient).slice(0, 300)}` : null,
      tone ? `TONE: ${String(tone).slice(0, 200)}` : null,
      draft && String(draft).trim() ? `CURRENT DRAFT TO IMPROVE:\n${String(draft).slice(0, 6000)}` : null,
      productList.length ? `PRODUCTS TO FEATURE (JSON):\n${JSON.stringify(productList)}` : null,
      `REQUEST: ${instruction}`,
    ].filter(Boolean);

    const { default: OpenAI } = await import('openai');
    const openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });

    const completion = await openrouter.chat.completions.create({
      model: 'google/gemini-2.5-flash',
      temperature: 0.7,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: COMPOSE_SYSTEM_PROMPT },
        { role: 'user', content: userParts.join('\n\n') },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      res.status(502).json({ error: 'Mr. Imagine came back empty-handed — try again.' });
      return;
    }

    let parsed: { subject?: string; html?: string; coupon?: { code?: string; type?: string; value?: number } } = {};
    try {
      parsed = JSON.parse(stripJsonFence(raw));
    } catch {
      // Model didn't return clean JSON — treat the whole thing as the HTML body.
      parsed = { html: raw };
    }
    if (!parsed.html) {
      res.status(502).json({ error: 'Mr. Imagine could not draft that — try rephrasing.' });
      return;
    }

    let html = parsed.html;

    // Inject real product cards where the model placed [[PRODUCTS]] (exact,
    // escaped image URLs — never trust the model to echo signed GCS URLs).
    if (productList.length) {
      const block = buildProductCardsHtml(productList);
      html = html.includes('[[PRODUCTS]]') ? html.split('[[PRODUCTS]]').join(block) : html + block;
    }

    // Auto-create the coupon (admin only) and render its banner where [[COUPON]] is.
    let createdCoupon: { code: string; type: string; value: number; existed: boolean } | null = null;
    if (parsed.coupon && parsed.coupon.code && parsed.coupon.value != null) {
      if (req.user!.role === 'admin') {
        createdCoupon = await createEmailCoupon(parsed.coupon, req.user!.id, recipient);
        if (createdCoupon) {
          const banner = buildCouponBannerHtml(createdCoupon.code, createdCoupon.type, createdCoupon.value);
          html = html.includes('[[COUPON]]') ? html.split('[[COUPON]]').join(banner) : html + banner;
        }
      }
    }

    // Strip any leftover tokens (model placed them but we had nothing to fill).
    html = html.split('[[PRODUCTS]]').join('').split('[[COUPON]]').join('');

    res.json({ subject: parsed.subject || '', html, coupon: createdCoupon });
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
    const emailId = data.email_id || (data as Record<string, any>).id || null;

    // Resend's `email.received` webhook is METADATA-ONLY — the html/text body,
    // headers and attachment contents are NOT in the payload. Fetch the full
    // received email from the receiving endpoint (keyed by email_id). Fall back
    // to the webhook metadata if the fetch fails so we never drop a message.
    const full = emailId ? await fetchReceivedEmail(emailId) : null;
    const src = (full || data) as Record<string, any>;

    const htmlBody: string | null = src.html ?? null;
    const textBody: string | null = src.text ?? null;
    if (!full) {
      console.warn('[email-webhook] receiving fetch returned nothing — storing metadata only for', emailId);
    }

    const from = parseAddress(String(src.from || data.from || ''));
    const recipients = [...toAddressArray(src.to ?? data.to), ...toAddressArray(src.cc ?? data.cc)];

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

    // Resend delivers attachment METADATA only — neither the email.received
    // webhook nor the retrieve-received-email body carry the bytes. The actual
    // files live behind short-lived pre-signed download_urls on the attachments
    // endpoint. Fetch those, download each file while the URL is fresh, and
    // re-host it in GCS so the inbox can serve a durable download link.
    // (Previously the code expected inline base64 `content` that Resend never
    // sends, so EVERY inbound attachment was stored byte-less and showed up in
    // the UI as un-openable — exactly the bug being fixed here.)
    let attachments: Array<{ filename: string; content_type: string; size: number; url?: string }> = [];
    if (emailId) {
      const resendAttachments = await fetchReceivedAttachments(emailId);
      attachments = await Promise.all(
        resendAttachments.map(async (a, idx) => {
          const record = {
            filename: a.filename || 'attachment',
            content_type: a.content_type || 'application/octet-stream',
            size: a.size ?? 0,
          };
          if (!a.download_url) return record;
          if (record.size && record.size > MAX_ATTACHMENT_BYTES) {
            console.warn('[email-webhook] attachment over cap, storing metadata only:', record.filename, record.size);
            return record;
          }
          try {
            const buf = await downloadAttachment(a.download_url);
            if (!buf) return record;
            const { publicUrl } = await uploadFile(buf, {
              userId: 'inbound',
              folder: 'email-attachments',
              filename: `${emailId}-${idx}-${sanitizeAttachmentName(a.filename || 'attachment')}`,
              contentType: record.content_type,
            });
            return { ...record, size: record.size || buf.length, url: publicUrl };
          } catch (err) {
            console.error('[email-webhook] attachment persist failed:', record.filename, err instanceof Error ? err.message : err);
            return record;
          }
        })
      );
    }

    let inserted = 0;
    for (const mailbox of mailboxes || []) {
      const { error } = await supabase.from('email_messages').insert({
        mailbox_id: mailbox.id,
        direction: 'inbound',
        resend_id: emailId,
        message_id: src.message_id || data.message_id || null,
        from_address: from.address,
        from_name: from.name,
        to_addresses: toAddressArray(src.to ?? data.to),
        cc_addresses: toAddressArray(src.cc ?? data.cc),
        subject: src.subject || data.subject || '(no subject)',
        text_body: textBody,
        html_body: htmlBody,
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
