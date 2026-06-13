// Client for the in-app email system (/api/email/*).
// Kept separate from api.ts so the email feature has one self-contained client.

import { apiFetch } from './api';

export interface Mailbox {
  id: string;
  address: string;
  display_name: string;
  user_id: string | null;
  is_active: boolean;
  created_at: string;
  unread_count?: number;
  signature_title?: string | null;
  owner?: { id: string; email: string; username: string | null } | null;
}

export interface FeaturedProduct {
  id: string;
  name: string;
  price: number;
  image: string | null;
  category: string | null;
  is_featured: boolean;
  url: string;
}

/** A turn in the Mr. Imagine assistant conversation (for iterative replies). */
export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface EmailAttachment {
  filename: string;
  content_type: string;
  size: number;
  content?: string; // base64, present only on full message fetch for small files
}

export interface EmailMessage {
  id: string;
  mailbox_id: string;
  direction: 'inbound' | 'outbound';
  from_address: string;
  from_name: string;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string;
  text_body: string | null;
  html_body: string | null;
  attachments: EmailAttachment[];
  status: 'received' | 'sent' | 'failed';
  is_read: boolean;
  is_archived: boolean;
  created_at: string;
}

export type EmailFolder = 'inbox' | 'sent' | 'archived';

export interface AssignableUser {
  id: string;
  email: string;
  username: string | null;
  role: string | null;
}

export const emailApi = {
  /** Inbox view — only the caller's own mailboxes (+ shared boxes for admins). */
  listMailboxes: (): Promise<{ mailboxes: Mailbox[] }> =>
    apiFetch('/api/email/mailboxes'),

  /** Admin-only — every mailbox, for the Manage Mailboxes administration UI. */
  listAllMailboxes: (): Promise<{ mailboxes: Mailbox[] }> =>
    apiFetch('/api/email/mailboxes?scope=all'),

  /** Admin-only — users a mailbox can be assigned to (for the dropdown). */
  listUsers: (): Promise<{ users: AssignableUser[] }> =>
    apiFetch('/api/email/users'),

  /** Featured/active products to insert into a composed email. */
  listFeaturedProducts: (search?: string): Promise<{ products: FeaturedProduct[] }> =>
    apiFetch(`/api/email/featured-products${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  /** Ask Mr. Imagine (Gemini 2.5 Flash) to write/polish a high-end HTML email. */
  composeAssist: (body: {
    mailbox_id: string;
    instruction: string;
    draft?: string;
    recipient?: string;
    tone?: string;
    products?: Array<{ name: string; price: number; url: string; image: string | null }>;
  }): Promise<{
    subject: string;
    html: string;
    coupon: { code: string; type: string; value: number; existed: boolean } | null;
  }> =>
    apiFetch('/api/email/compose-assist', { method: 'POST', body: JSON.stringify(body) }),

  createMailbox: (body: { address: string; display_name?: string; user_email?: string }): Promise<{ mailbox: Mailbox }> =>
    apiFetch('/api/email/mailboxes', { method: 'POST', body: JSON.stringify(body) }),

  updateMailbox: (id: string, body: { display_name?: string; user_email?: string | null; is_active?: boolean; signature_title?: string | null }): Promise<{ mailbox: Mailbox }> =>
    apiFetch(`/api/email/mailboxes/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteMailbox: (id: string): Promise<{ success: boolean }> =>
    apiFetch(`/api/email/mailboxes/${id}`, { method: 'DELETE' }),

  listMessages: (
    mailboxId: string,
    opts: { folder?: EmailFolder; search?: string; before?: string; limit?: number } = {}
  ): Promise<{ messages: EmailMessage[]; mailbox: Pick<Mailbox, 'id' | 'address' | 'display_name'> }> => {
    const params = new URLSearchParams();
    if (opts.folder) params.set('folder', opts.folder);
    if (opts.search) params.set('search', opts.search);
    if (opts.before) params.set('before', opts.before);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return apiFetch(`/api/email/mailboxes/${mailboxId}/messages${qs ? `?${qs}` : ''}`);
  },

  getMessage: (id: string): Promise<{ message: EmailMessage }> =>
    apiFetch(`/api/email/messages/${id}`),

  updateMessage: (id: string, body: { is_read?: boolean; is_archived?: boolean }): Promise<{ message: EmailMessage }> =>
    apiFetch(`/api/email/messages/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  send: (body: {
    mailbox_id: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html?: string;
    text?: string;
    in_reply_to_message_id?: string;
  }): Promise<{ success: boolean; message: EmailMessage }> =>
    apiFetch('/api/email/send', { method: 'POST', body: JSON.stringify(body) }),

  /** Ask Mr. Imagine about a mailbox — summarize a message, catch up on the
   *  inbox, or draft a reply. `message_id` scopes the question to one email;
   *  otherwise the latest inbox messages are used as context. */
  assistant: (body: {
    mailbox_id: string;
    instruction: string;
    message_id?: string;
    history?: AssistantTurn[];
  }): Promise<{ reply: string }> =>
    apiFetch('/api/email/assistant', { method: 'POST', body: JSON.stringify(body) }),
};

/** Speak text in Mr. Imagine's voice (MiniMax TTS via the platform voice route).
 *  Returns a playable audio URL. Dynamic emotion is chosen by the model. */
export async function synthesizeMrImagineVoice(text: string): Promise<string> {
  const data = await apiFetch('/api/ai/voice/synthesize', {
    method: 'POST',
    body: JSON.stringify({ text, emotion: 'auto' }),
  });
  if (!data?.audioUrl) throw new Error('Voice synthesis returned no audio');
  return data.audioUrl as string;
}
