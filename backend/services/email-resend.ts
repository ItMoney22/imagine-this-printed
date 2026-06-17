// Resend integration for the in-app email system.
// - Sending: REST call to https://api.resend.com/emails
// - Receiving: Resend fires `email.received` webhooks (svix-signed); the
//   signature verification here implements the svix scheme so we don't need
//   the svix dependency: HMAC-SHA256 over `${id}.${timestamp}.${payload}`
//   keyed with the base64-decoded portion of the `whsec_...` secret.

import crypto from 'crypto';

const RESEND_API_BASE = 'https://api.resend.com';

export const EMAIL_DOMAIN = (process.env.EMAIL_DOMAIN || 'imaginethisprinted.com').toLowerCase();

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not configured');
  return key;
}

export interface SendEmailParams {
  from: string;            // "Display Name <user@imaginethisprinted.com>"
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string }[]; // base64 content
}

export interface SendEmailResult {
  id: string;
}

export async function sendViaResend(params: SendEmailParams): Promise<SendEmailResult> {
  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || `Resend send failed (HTTP ${res.status})`);
  }
  if (!body?.id) {
    throw new Error('Resend send succeeded but returned no email id');
  }
  return { id: body.id };
}

/**
 * Verify a svix-signed webhook request (Resend webhooks use svix).
 * Returns true when any of the space-separated `v1,<sig>` entries in the
 * `svix-signature` header matches our computed signature, and the timestamp
 * is within tolerance (5 minutes) to block replays.
 */
export function verifyResendWebhook(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret = process.env.RESEND_WEBHOOK_SECRET || ''
): boolean {
  if (!secret) {
    // Fail closed in production; allow unsigned in local dev so the flow can
    // be tested with curl before the webhook secret is provisioned.
    return process.env.NODE_ENV !== 'production';
  }
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  return signature.split(' ').some(part => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

/** Shape of the `email.received` webhook payload's `data` field (fields we use). */
export interface InboundEmailData {
  email_id?: string;
  from?: string;                 // "Name <addr>" or plain address
  to?: string[] | string;
  cc?: string[] | string;
  subject?: string;
  text?: string;
  html?: string;
  message_id?: string;
  headers?: Record<string, string> | { name: string; value: string }[];
  attachments?: {
    filename?: string;
    content_type?: string;
    content?: string;            // base64, when present
    size?: number;
  }[];
}

/**
 * Fetch the FULL received email (incl. html/text body, headers, attachments)
 * from Resend's receiving endpoint. The `email.received` webhook is
 * metadata-only — the body lives here, keyed by the event's `email_id`.
 * (This is exactly how the davidtrinidad.com/Watchtower inbound works.)
 * Returns null on any failure so the caller can fall back to webhook metadata.
 */
export async function fetchReceivedEmail(emailId: string): Promise<(InboundEmailData & { id?: string }) | null> {
  try {
    const res = await fetch(`${RESEND_API_BASE}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    if (!res.ok) {
      console.error('[email-resend] receiving fetch failed:', res.status, await res.text().catch(() => ''));
      return null;
    }
    return (await res.json()) as InboundEmailData & { id?: string };
  } catch (err) {
    console.error('[email-resend] receiving fetch error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** One attachment from `GET /emails/receiving/{id}/attachments`. */
export interface ReceivedAttachment {
  id: string;
  filename?: string;
  content_type?: string;
  content_disposition?: string | null;
  content_id?: string | null;
  size?: number;
  download_url?: string;   // pre-signed, self-authenticating, SHORT-LIVED
  expires_at?: string;
}

/**
 * List the attachments for a received email, each with a pre-signed
 * `download_url`. Resend delivers attachment METADATA only in both the
 * `email.received` webhook and the retrieve-received-email body — the actual
 * bytes are ONLY reachable through this endpoint's download_urls, which expire
 * (`expires_at`). Callers must download promptly and persist the bytes
 * themselves (we re-host in GCS). Returns [] on any failure so a flaky
 * attachments fetch never drops the whole message.
 */
export async function fetchReceivedAttachments(emailId: string): Promise<ReceivedAttachment[]> {
  try {
    const res = await fetch(
      `${RESEND_API_BASE}/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
      { headers: { Authorization: `Bearer ${apiKey()}` } }
    );
    if (!res.ok) {
      console.error('[email-resend] attachments fetch failed:', res.status, await res.text().catch(() => ''));
      return [];
    }
    const body: any = await res.json().catch(() => null);
    // Resend list endpoints return { object: 'list', data: [...] }; tolerate a
    // bare array or an { attachments } envelope too.
    const list = Array.isArray(body) ? body : (body?.data ?? body?.attachments ?? []);
    return Array.isArray(list) ? (list as ReceivedAttachment[]) : [];
  } catch (err) {
    console.error('[email-resend] attachments fetch error:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Download an attachment's raw bytes from its pre-signed download_url. */
export async function downloadAttachment(downloadUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      console.error('[email-resend] attachment download failed:', res.status);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('[email-resend] attachment download error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Parse `"Display Name <user@host>"` into its parts. */
export function parseAddress(raw: string): { name: string; address: string } {
  const m = raw?.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || '').trim(), address: m[2].trim().toLowerCase() };
  return { name: '', address: (raw || '').trim().toLowerCase() };
}

export function toAddressArray(value: string[] | string | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(',');
  return list.map(v => parseAddress(v).address).filter(Boolean);
}
