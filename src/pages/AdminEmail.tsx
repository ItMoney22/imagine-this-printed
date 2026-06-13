import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import {
  Mail,
  Send,
  Archive,
  Inbox,
  Paperclip,
  Search,
  RefreshCw,
  Plus,
  Reply,
  ReplyAll,
  Forward,
  MailOpen,
  Trash2,
  ChevronLeft,
  X,
  Settings,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
  Sparkles,
  Volume2,
  VolumeX,
  Wand2,
  Package,
} from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { emailApi, synthesizeMrImagineVoice } from '../lib/email-api'
import type { Mailbox, EmailMessage, EmailFolder, AssignableUser, FeaturedProduct } from '../lib/email-api'

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br/>')
}

// Build a featured-products HTML block for emails composed without AI.
// (When Mr. Imagine writes the email, he weaves the products in himself.)
function buildProductsHtml(products: FeaturedProduct[]): string {
  if (!products.length) return ''
  const cards = products
    .map(
      p => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff;">
        <tr>
          ${p.image ? `<td width="96" style="padding:12px;"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" width="80" height="80" style="width:80px;height:80px;object-fit:cover;border-radius:8px;display:block;" /></td>` : ''}
          <td style="padding:12px;vertical-align:middle;">
            <div style="font-weight:600;color:#374151;font-size:15px;">${escapeHtml(p.name)}</div>
            <div style="color:#059669;font-weight:700;margin:4px 0;">$${p.price.toFixed(2)}</div>
            <a href="${p.url}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;">View Product</a>
          </td>
        </tr>
      </table>`
    )
    .join('')
  return `<div style="margin-top:20px;"><p style="color:#7c3aed;font-weight:600;margin:0 0 8px;font-family:'Segoe UI',Tahoma,sans-serif;">Featured for you</p>${cards}</div>`
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// ─── skeleton ───────────────────────────────────────────────────────────────

const MessageSkeleton: React.FC = () => (
  <div className="animate-pulse space-y-3 p-3">
    {[1, 2, 3, 4, 5].map(i => (
      <div key={i} className="space-y-1">
        <div className="h-3 bg-text/10 rounded w-3/4" />
        <div className="h-3 bg-text/10 rounded w-1/2" />
      </div>
    ))}
  </div>
)

// ─── compose modal ───────────────────────────────────────────────────────────

interface ComposeProps {
  mailboxes: Mailbox[]
  defaultMailboxId?: string
  defaultTo?: string[]
  defaultCc?: string[]
  defaultSubject?: string
  defaultBody?: string
  inReplyToId?: string
  onClose: () => void
  onSent: () => void
}

const ComposeModal: React.FC<ComposeProps> = ({
  mailboxes,
  defaultMailboxId,
  defaultTo = [],
  defaultCc = [],
  defaultSubject = '',
  defaultBody = '',
  inReplyToId,
  onClose,
  onSent,
}) => {
  const toast = useToast()
  const [fromId, setFromId] = useState(defaultMailboxId ?? mailboxes[0]?.id ?? '')
  const [toRaw, setToRaw] = useState(defaultTo.join(', '))
  const [ccRaw, setCcRaw] = useState(defaultCc.join(', '))
  const [bccRaw, setBccRaw] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(defaultCc.length > 0)
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState(defaultBody)
  const [sending, setSending] = useState(false)

  // Mr. Imagine compose-assist (Gemini 2.5 Flash)
  const [aiPrompt, setAiPrompt] = useState('')
  const [tone, setTone] = useState('Friendly & professional')
  const [aiBusy, setAiBusy] = useState(false)
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null)

  // featured products to feature in the email
  const [showProducts, setShowProducts] = useState(false)
  const [products, setProducts] = useState<FeaturedProduct[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [selected, setSelected] = useState<FeaturedProduct[]>([])

  const loadProducts = async (search?: string) => {
    setProductsLoading(true)
    try {
      const { products: p } = await emailApi.listFeaturedProducts(search)
      setProducts(p)
    } catch (err: unknown) {
      toast.error('Products', err instanceof Error ? err.message : 'Failed to load products')
    } finally {
      setProductsLoading(false)
    }
  }

  const toggleProducts = () => {
    const next = !showProducts
    setShowProducts(next)
    if (next && products.length === 0) loadProducts()
  }

  const toggleSelect = (p: FeaturedProduct) => {
    setSelected(prev =>
      prev.some(s => s.id === p.id) ? prev.filter(s => s.id !== p.id) : [...prev, p]
    )
  }

  const runAssist = async (mode: 'write' | 'polish') => {
    if (!fromId) { toast.error('No mailbox selected'); return }
    const instruction =
      mode === 'polish'
        ? `Polish and elevate this draft into a high-end, on-brand email. Keep my intent and key facts.${aiPrompt.trim() ? ` Extra guidance: ${aiPrompt.trim()}` : ''}`
        : aiPrompt.trim()
    if (mode === 'write' && !instruction) {
      toast.error('Tell Mr. Imagine what to say', 'A short brief, e.g. "thank them for their order and show our bestsellers".')
      return
    }
    setAiBusy(true)
    try {
      const { subject: s, html, coupon } = await emailApi.composeAssist({
        mailbox_id: fromId,
        instruction: instruction || 'Write a friendly, professional email.',
        draft: body || undefined,
        recipient: toRaw || undefined,
        tone,
        products: selected.map(p => ({ name: p.name, price: p.price, url: p.url, image: p.image })),
      })
      setGeneratedHtml(html)
      if (s && !subject.trim()) setSubject(s)
      if (coupon) {
        const off = coupon.type === 'fixed' ? `$${coupon.value.toFixed(2)} off` : `${coupon.value}% off`
        toast.success(
          `Coupon ${coupon.code} ${coupon.existed ? 'ready' : 'created'} (${off})`,
          'It\'s live in the system and included in the email.'
        )
      } else {
        toast.success('Mr. Imagine drafted your email', 'Review the preview, then send or tweak it.')
      }
    } catch (err: unknown) {
      toast.error('Mr. Imagine', err instanceof Error ? err.message : 'Could not draft that')
    } finally {
      setAiBusy(false)
    }
  }

  const handleSend = async () => {
    const toList = parseEmailList(toRaw)
    if (toList.length === 0) {
      toast.error('Recipient required', 'Add at least one To address.')
      return
    }
    const invalid = toList.find(e => !EMAIL_RE.test(e))
    if (invalid) {
      toast.error('Invalid email', `"${invalid}" is not a valid email address.`)
      return
    }
    if (!fromId) {
      toast.error('No mailbox selected')
      return
    }

    // Body: use Mr. Imagine's HTML when generated; otherwise wrap the plain
    // text and append any chosen product cards. The signature is added server-side.
    let html: string
    let text: string | undefined
    if (generatedHtml) {
      html = generatedHtml
      text = undefined
    } else {
      html =
        `<div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;white-space:pre-wrap;color:#374151;font-size:15px;line-height:1.6;">${textToHtml(body)}</div>` +
        buildProductsHtml(selected)
      text = body
    }

    setSending(true)
    try {
      await emailApi.send({
        mailbox_id: fromId,
        to: toList,
        cc: showCcBcc && ccRaw ? parseEmailList(ccRaw) : undefined,
        bcc: showCcBcc && bccRaw ? parseEmailList(bccRaw) : undefined,
        subject,
        text,
        html,
        in_reply_to_message_id: inReplyToId,
      })
      toast.success('Message sent')
      onSent()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Send failed', msg)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card border border-text/10 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh]">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-text/10 shrink-0">
          <h2 className="text-base font-semibold text-text">New Message</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-text transition-colors"
            aria-label="Close compose"
          >
            <X size={18} />
          </button>
        </div>

        {/* fields */}
        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          {/* from */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted w-14 shrink-0 text-right">From</span>
            <select
              value={fromId}
              onChange={e => setFromId(e.target.value)}
              className="flex-1 bg-bg border border-text/10 rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {mailboxes.map(m => (
                <option key={m.id} value={m.id}>
                  {m.display_name ? `${m.display_name} <${m.address}>` : m.address}
                </option>
              ))}
            </select>
          </div>

          {/* to */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted w-14 shrink-0 text-right">To</span>
            <input
              type="text"
              value={toRaw}
              onChange={e => setToRaw(e.target.value)}
              placeholder="recipient@example.com, ..."
              className="flex-1 bg-bg border border-text/10 rounded-lg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={() => setShowCcBcc(v => !v)}
              className="text-xs text-muted hover:text-primary transition-colors whitespace-nowrap"
            >
              Cc / Bcc
            </button>
          </div>

          {showCcBcc && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted w-14 shrink-0 text-right">Cc</span>
                <input
                  type="text"
                  value={ccRaw}
                  onChange={e => setCcRaw(e.target.value)}
                  placeholder="cc@example.com, ..."
                  className="flex-1 bg-bg border border-text/10 rounded-lg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted w-14 shrink-0 text-right">Bcc</span>
                <input
                  type="text"
                  value={bccRaw}
                  onChange={e => setBccRaw(e.target.value)}
                  placeholder="bcc@example.com, ..."
                  className="flex-1 bg-bg border border-text/10 rounded-lg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </>
          )}

          {/* subject */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted w-14 shrink-0 text-right">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 bg-bg border border-text/10 rounded-lg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Mr. Imagine compose bar */}
          <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-purple-600/5 to-fuchsia-600/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <img
                src="/mr-imagine/mr-imagine-waving.png"
                alt=""
                aria-hidden="true"
                className="w-6 h-6 object-contain rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 p-0.5"
              />
              <span className="text-xs font-semibold text-text">Mr. Imagine — let me write it for you</span>
            </div>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={2}
              placeholder="Tell me what to say — e.g. 'thank them for their first order and show our bestselling tumblers'"
              className="w-full bg-bg border border-text/10 rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={tone}
                onChange={e => setTone(e.target.value)}
                className="bg-bg border border-text/10 rounded-lg px-2 py-1.5 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {['Friendly & professional', 'Warm & personal', 'Playful & fun', 'Persuasive & sales-y', 'Formal & polished'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                onClick={() => runAssist('write')}
                disabled={aiBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                <Wand2 size={13} /> {aiBusy ? 'Writing…' : 'Write it'}
              </button>
              <button
                onClick={() => runAssist('polish')}
                disabled={aiBusy || !body.trim()}
                title={!body.trim() ? 'Type a draft first' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-primary/30 text-primary font-medium hover:bg-primary/10 disabled:opacity-40 transition-colors"
              >
                <Sparkles size={13} /> Polish my draft
              </button>
              <button
                onClick={toggleProducts}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-text/10 text-text hover:bg-text/5 transition-colors"
              >
                <Package size={13} /> Products{selected.length ? ` (${selected.length})` : ''}
              </button>
            </div>

            {/* product picker */}
            {showProducts && (
              <div className="border-t border-text/10 pt-2 space-y-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && loadProducts(productSearch)}
                    placeholder="Search products…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg border border-text/10 rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                {productsLoading ? (
                  <p className="text-xs text-muted py-3 text-center">Loading products…</p>
                ) : products.length === 0 ? (
                  <p className="text-xs text-muted py-3 text-center">No products found.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                    {products.map(p => {
                      const isSel = selected.some(s => s.id === p.id)
                      return (
                        <button
                          key={p.id}
                          onClick={() => toggleSelect(p)}
                          className={`text-left rounded-lg border p-1.5 transition-colors ${isSel ? 'border-primary bg-primary/10' : 'border-text/10 hover:bg-text/5'}`}
                        >
                          {p.image ? (
                            <img src={p.image} alt="" className="w-full h-16 object-cover rounded mb-1" />
                          ) : (
                            <div className="w-full h-16 rounded mb-1 bg-text/5 flex items-center justify-center">
                              <Package size={16} className="text-muted" />
                            </div>
                          )}
                          <p className="text-[11px] font-medium text-text truncate">{p.name}</p>
                          <p className="text-[11px] text-primary font-semibold">${p.price.toFixed(2)}</p>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* body: Mr. Imagine HTML preview OR plain-text editor */}
          {generatedHtml ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-primary flex items-center gap-1">
                  <Sparkles size={12} /> Mr. Imagine draft (preview)
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => runAssist('write')}
                    disabled={aiBusy}
                    className="text-xs text-muted hover:text-primary transition-colors disabled:opacity-40"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={() => setGeneratedHtml(null)}
                    className="text-xs text-muted hover:text-text transition-colors"
                  >
                    Edit as text
                  </button>
                </div>
              </div>
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={`<div style="padding:12px;font-family:sans-serif;">${generatedHtml}</div>`}
                className="w-full h-72 bg-white rounded-lg border border-text/10"
              />
              <p className="text-[11px] text-muted">Your signature is added automatically when you send.</p>
            </div>
          ) : (
            <>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Write your message..."
                className="w-full bg-bg border border-text/10 rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y min-h-[200px]"
              />
              {selected.length > 0 && (
                <p className="text-[11px] text-muted">
                  {selected.length} product{selected.length > 1 ? 's' : ''} will be added as cards. Your signature is added automatically.
                </p>
              )}
            </>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t border-text/10 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-text/10 text-text hover:bg-text/5 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-5 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Send size={14} />
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── manage mailboxes modal ──────────────────────────────────────────────────

interface ManageMailboxesProps {
  mailboxes: Mailbox[]
  onClose: () => void
  onChanged: () => void
}

const ManageMailboxesModal: React.FC<ManageMailboxesProps> = ({
  mailboxes,
  onClose,
  onChanged,
}) => {
  const toast = useToast()
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [rows, setRows] = useState<Mailbox[]>(mailboxes)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editOwner, setEditOwner] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Admin manages EVERY mailbox here (the inbox list is scoped to the owner),
  // so load the full administrative list and refresh it after each change.
  const loadAll = useCallback(() => {
    emailApi.listAllMailboxes()
      .then(({ mailboxes: mb }) => setRows(mb))
      .catch(() => { /* keep whatever we already have */ })
  }, [])

  // Reload the full list AND tell the parent to refresh its inbox list.
  const refreshAll = useCallback(() => {
    loadAll()
    onChanged()
  }, [loadAll, onChanged])

  useEffect(() => {
    loadAll()
    emailApi.listUsers()
      .then(({ users: u }) => setUsers(u))
      .catch(() => { /* dropdown just falls back to empty */ })
  }, [loadAll])

  const userLabel = (u: AssignableUser) =>
    u.username ? `${u.username} (${u.email})` : u.email
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // new mailbox form
  const [newLocal, setNewLocal] = useState('')
  const [newName, setNewName] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [creating, setCreating] = useState(false)

  const startEdit = (m: Mailbox) => {
    setEditingId(m.id)
    setEditName(m.display_name ?? '')
    setEditOwner(m.owner?.email ?? '')
    setEditTitle(m.signature_title ?? '')
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async (m: Mailbox) => {
    setSavingId(m.id)
    try {
      await emailApi.updateMailbox(m.id, {
        display_name: editName || undefined,
        user_email: editOwner || null,
        signature_title: editTitle.trim() || null,
      })
      toast.success('Mailbox updated')
      setEditingId(null)
      refreshAll()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Update failed', msg)
    } finally {
      setSavingId(null)
    }
  }

  const toggleActive = async (m: Mailbox) => {
    setTogglingId(m.id)
    try {
      await emailApi.updateMailbox(m.id, { is_active: !m.is_active })
      refreshAll()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Toggle failed', msg)
    } finally {
      setTogglingId(null)
    }
  }

  const deleteMailbox = async (m: Mailbox) => {
    if (
      !window.confirm(
        `Delete ${m.address}? This will permanently remove the mailbox and ALL its stored messages.`
      )
    )
      return
    setDeletingId(m.id)
    try {
      await emailApi.deleteMailbox(m.id)
      toast.success('Mailbox deleted')
      refreshAll()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Delete failed', msg)
    } finally {
      setDeletingId(null)
    }
  }

  const createMailbox = async () => {
    if (!newLocal.trim()) {
      toast.error('Address required', 'Enter a local part for the mailbox address.')
      return
    }
    setCreating(true)
    try {
      await emailApi.createMailbox({
        address: newLocal.trim(),
        display_name: newName.trim() || undefined,
        user_email: newOwner.trim() || undefined,
      })
      toast.success('Mailbox created')
      setNewLocal('')
      setNewName('')
      setNewOwner('')
      refreshAll()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Create failed', msg)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card border border-text/10 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-text/10 shrink-0">
          <h2 className="text-base font-semibold text-text flex items-center gap-2">
            <Settings size={16} className="text-primary" />
            Manage Mailboxes
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-text transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* table */}
        <div className="overflow-auto flex-1 px-5 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs border-b border-text/10">
                <th className="text-left pb-2 font-medium">Address</th>
                <th className="text-left pb-2 font-medium">Display Name</th>
                <th className="text-left pb-2 font-medium">Assigned To</th>
                <th className="text-left pb-2 font-medium">Signature</th>
                <th className="text-left pb-2 font-medium">Active</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id} className="border-b border-text/5 hover:bg-text/5 transition-colors">
                  <td className="py-2.5 pr-3 font-mono text-xs text-text">{m.address}</td>
                  <td className="py-2.5 pr-3">
                    {editingId === m.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="bg-bg border border-primary/40 rounded px-2 py-1 text-xs text-text w-full focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    ) : (
                      <span className="text-text">{m.display_name || <span className="text-muted italic">—</span>}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {editingId === m.id ? (
                      <select
                        value={editOwner}
                        onChange={e => setEditOwner(e.target.value)}
                        className="bg-bg border border-primary/40 rounded px-2 py-1 text-xs text-text w-full focus:outline-none focus:ring-1 focus:ring-primary/50"
                      >
                        <option value="">Unassigned</option>
                        {users.map(u => (
                          <option key={u.id} value={u.email}>{userLabel(u)}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-muted text-xs">
                        {m.owner?.email ?? '—'}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {editingId === m.id ? (
                      <input
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        placeholder="e.g. CEO & Co-Founder"
                        className="bg-bg border border-primary/40 rounded px-2 py-1 text-xs text-text w-full focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    ) : (
                      <span className="text-muted text-xs">{m.signature_title || '—'}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <button
                      onClick={() => toggleActive(m)}
                      disabled={togglingId === m.id}
                      className="text-muted hover:text-primary transition-colors disabled:opacity-40"
                      aria-label={m.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {m.is_active ? (
                        <ToggleRight size={20} className="text-primary" />
                      ) : (
                        <ToggleLeft size={20} />
                      )}
                    </button>
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      {editingId === m.id ? (
                        <>
                          <button
                            onClick={() => saveEdit(m)}
                            disabled={savingId === m.id}
                            className="text-xs px-2 py-1 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-xs px-2 py-1 border border-text/10 text-text rounded hover:bg-text/5 transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(m)}
                            className="text-xs text-muted hover:text-primary transition-colors px-2 py-1"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteMailbox(m)}
                            disabled={deletingId === m.id}
                            className="text-muted hover:text-red-500 transition-colors disabled:opacity-40"
                            aria-label="Delete mailbox"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* add new */}
        <div className="border-t border-text/10 px-5 py-4 shrink-0">
          <p className="text-xs text-muted mb-3 font-medium uppercase tracking-wide">Add Mailbox</p>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center border border-text/10 rounded-lg overflow-hidden bg-bg">
              <input
                value={newLocal}
                onChange={e => setNewLocal(e.target.value)}
                placeholder="local-part"
                className="bg-transparent px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none w-32"
                onKeyDown={e => e.key === 'Enter' && createMailbox()}
              />
              <span className="px-2 text-muted text-sm border-l border-text/10 bg-text/5">
                @imaginethisprinted.com
              </span>
            </div>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Display name (opt)"
              className="bg-bg border border-text/10 rounded-lg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 w-44"
            />
            <select
              value={newOwner}
              onChange={e => setNewOwner(e.target.value)}
              className="bg-bg border border-text/10 rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50 w-56"
              title="Assign to an employee (optional)"
            >
              <option value="">Assign to… (optional)</option>
              {users.map(u => (
                <option key={u.id} value={u.email}>{userLabel(u)}</option>
              ))}
            </select>
            <button
              onClick={createMailbox}
              disabled={creating}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
            >
              <Plus size={14} />
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Mr. Imagine assistant ───────────────────────────────────────────────────

const MR_IMAGINE_VOICE_KEY = 'itp-mr-imagine-email-voice'

interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  audioUrl?: string
  voiceError?: boolean
  retryFn?: () => void
}

interface MrImagineAssistantProps {
  mailboxId: string
  openMessageId?: string
  onClose: () => void
  onUseAsReply: (body: string) => void
  initialQuickAction?: 'catchup' | 'summarize' | 'draft'
}

const MrImagineAssistant: React.FC<MrImagineAssistantProps> = ({
  mailboxId,
  openMessageId,
  onClose,
  onUseAsReply,
  initialQuickAction,
}) => {
  const toast = useToast()
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(MR_IMAGINE_VOICE_KEY)
      return stored === null ? true : stored === 'true'
    } catch {
      return true
    }
  })
  const [voiceWarnShown, setVoiceWarnShown] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const initialActionFired = useRef(false)
  // Mirror of `messages` so sendInstruction can pass the running conversation
  // as history without re-creating the callback on every new message.
  const messagesRef = useRef<AssistantMessage[]>([])

  // persist voice toggle
  useEffect(() => {
    try {
      localStorage.setItem(MR_IMAGINE_VOICE_KEY, String(voiceEnabled))
    } catch {
      // ignore
    }
  }, [voiceEnabled])

  // scroll to bottom when messages change + keep the history ref in sync
  useEffect(() => {
    messagesRef.current = messages
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  // auto-resize textarea
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }

  const stopCurrentAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }

  const playAudio = (url: string, msgId: string) => {
    stopCurrentAudio()
    const audio = new Audio(url)
    audioRef.current = audio
    // mark playing state could be added later; simple play for now
    audio.play().catch(err => {
      console.warn('[MrImagine] audio play failed', err)
    })
    // track which message is playing via data attr on audio element
    audio.dataset.msgId = msgId
  }

  const speakReply = useCallback(
    async (text: string, msgId: string) => {
      if (!voiceEnabled) return
      try {
        const url = await synthesizeMrImagineVoice(text)
        playAudio(url, msgId)
        setMessages(prev =>
          prev.map(m => (m.id === msgId ? { ...m, audioUrl: url } : m))
        )
      } catch (err) {
        console.warn('[MrImagine] voice synthesis failed', err)
        if (!voiceWarnShown) {
          setVoiceWarnShown(true)
          setMessages(prev =>
            prev.map(m => (m.id === msgId ? { ...m, voiceError: true } : m))
          )
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voiceEnabled, voiceWarnShown]
  )

  const sendInstruction = useCallback(
    async (instruction: string, userLabel: string, messageId?: string) => {
      if (loading) return
      // Capture the conversation so far (before adding this turn) as history,
      // so follow-ups like "make it warmer" or "tell her we ship Monday" keep context.
      const historyTurns = messagesRef.current
        .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.retryFn))
        .map(m => ({ role: m.role, text: m.text }))
      const userMsgId = `u-${Date.now()}`
      const asstMsgId = `a-${Date.now()}`
      setMessages(prev => [
        ...prev,
        { id: userMsgId, role: 'user', text: userLabel },
      ])
      setLoading(true)

      const doRequest = async () => {
        try {
          const { reply } = await emailApi.assistant({
            mailbox_id: mailboxId,
            instruction,
            message_id: messageId,
            history: historyTurns,
          })
          const newMsg: AssistantMessage = { id: asstMsgId, role: 'assistant', text: reply }
          setMessages(prev => [...prev, newMsg])
          setLoading(false)
          speakReply(reply, asstMsgId)
        } catch (err: unknown) {
          const errText = err instanceof Error ? err.message : 'Request failed'
          toast.error('Mr. Imagine', errText)
          setMessages(prev => [
            ...prev,
            {
              id: asstMsgId,
              role: 'assistant',
              text: `Something went wrong: ${errText}`,
              retryFn: doRequest,
            },
          ])
          setLoading(false)
        }
      }
      await doRequest()
    },
    [loading, mailboxId, speakReply, toast]
  )

  // fire initial quick action once on mount
  useEffect(() => {
    if (initialActionFired.current) return
    if (!initialQuickAction) return
    initialActionFired.current = true
    if (initialQuickAction === 'catchup') {
      sendInstruction(
        "Give me a quick spoken-style briefing of my recent inbox: what's new, what needs my attention first, and anything that can wait.",
        'Catch me up',
        undefined
      )
    } else if (initialQuickAction === 'summarize' && openMessageId) {
      sendInstruction(
        'Summarize this email in a few sentences: who it\'s from, what they want, and any action needed.',
        'Summarize this email',
        openMessageId
      )
    } else if (initialQuickAction === 'draft' && openMessageId) {
      sendInstruction(
        'Draft a short, friendly, professional reply to this email. Give me just the reply text.',
        'Draft a reply',
        openMessageId
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSend = () => {
    const text = inputText.trim()
    if (!text || loading) return
    setInputText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    sendInstruction(text, text, openMessageId ?? undefined)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {/* mobile backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* panel */}
      <div
        role="dialog"
        aria-label="Mr. Imagine AI assistant"
        className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-card border-l border-text/10 shadow-2xl z-50 flex flex-col"
      >
        {/* header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-text/10 bg-gradient-to-r from-purple-600/10 to-fuchsia-600/10 shrink-0">
          <img
            src="/mr-imagine/mr-imagine-waving.png"
            alt="Mr. Imagine"
            className="w-9 h-9 object-contain rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 p-0.5 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text">Mr. Imagine</p>
            <p className="text-xs text-muted truncate">Your inbox sidekick</p>
          </div>
          <button
            onClick={() => setVoiceEnabled(v => !v)}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors"
            aria-label={voiceEnabled ? 'Disable voice' : 'Enable voice'}
            title={voiceEnabled ? 'Voice on — click to mute' : 'Voice off — click to enable'}
          >
            {voiceEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-text/5 transition-colors"
            aria-label="Close Mr. Imagine panel"
          >
            <X size={15} />
          </button>
        </div>

        {/* quick action chips */}
        <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-text/10 shrink-0">
          <button
            onClick={() =>
              sendInstruction(
                "Give me a quick spoken-style briefing of my recent inbox: what's new, what needs my attention first, and anything that can wait.",
                'Catch me up',
                undefined
              )
            }
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded-full hover:bg-primary/20 disabled:opacity-40 transition-colors font-medium"
          >
            <Sparkles size={11} /> Catch me up
          </button>
          <button
            onClick={() =>
              openMessageId &&
              sendInstruction(
                "Summarize this email in a few sentences: who it's from, what they want, and any action needed.",
                'Summarize this email',
                openMessageId
              )
            }
            disabled={loading || !openMessageId}
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded-full hover:bg-primary/20 disabled:opacity-40 transition-colors font-medium"
            title={!openMessageId ? 'Open a message first' : undefined}
          >
            <Sparkles size={11} /> Summarize this email
          </button>
          <button
            onClick={() =>
              openMessageId &&
              sendInstruction(
                'Draft a short, friendly, professional reply to this email. Give me just the reply text.',
                'Draft a reply',
                openMessageId
              )
            }
            disabled={loading || !openMessageId}
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded-full hover:bg-primary/20 disabled:opacity-40 transition-colors font-medium"
            title={!openMessageId ? 'Open a message first' : undefined}
          >
            <Sparkles size={11} /> Draft a reply
          </button>
        </div>

        {/* conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="text-center py-10 text-muted text-sm space-y-2">
              <img
                src="/mr-imagine/mr-imagine-waving.png"
                alt=""
                aria-hidden="true"
                className="w-16 h-16 object-contain mx-auto opacity-60"
              />
              <p>Hi! I'm Mr. Imagine.</p>
              <p className="text-xs">Pick a quick action above or ask me anything about your mailbox.</p>
            </div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <img
                  src="/mr-imagine/mr-imagine-waving.png"
                  alt="Mr. Imagine avatar"
                  className="w-7 h-7 object-contain rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 p-0.5 shrink-0 mt-0.5"
                />
              )}
              <div className={`flex flex-col gap-1 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary/10 text-text rounded-tr-sm'
                      : 'bg-bg border border-text/10 text-text rounded-tl-sm'
                  }`}
                >
                  {msg.text}
                </div>

                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* voice replay button */}
                    {msg.audioUrl && (
                      <button
                        onClick={() => playAudio(msg.audioUrl!, msg.id)}
                        className="flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors"
                        aria-label="Replay voice"
                      >
                        <Volume2 size={11} /> Play
                      </button>
                    )}
                    {msg.voiceError && !voiceWarnShown && (
                      <span className="text-xs text-muted italic">voice unavailable</span>
                    )}
                    {msg.voiceError && voiceWarnShown && (
                      <span className="text-xs text-muted italic">voice unavailable</span>
                    )}
                    {/* retry on error */}
                    {msg.retryFn && (
                      <button
                        onClick={msg.retryFn}
                        className="text-xs text-primary hover:underline"
                      >
                        Retry
                      </button>
                    )}
                    {/* use as reply — shown on "Draft a reply" responses */}
                    {!msg.retryFn && msg.text.length > 20 && (
                      <button
                        onClick={() => onUseAsReply(msg.text)}
                        className="flex items-center gap-1 text-xs px-2 py-0.5 bg-gradient-to-r from-purple-600/20 to-fuchsia-600/20 text-primary border border-primary/20 rounded-full hover:bg-primary/30 transition-colors"
                      >
                        <Reply size={10} /> Use as reply
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* typing indicator */}
          {loading && (
            <div className="flex gap-2 justify-start">
              <img
                src="/mr-imagine/mr-imagine-waving.png"
                alt="Mr. Imagine is thinking"
                className="w-7 h-7 object-contain rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 p-0.5 shrink-0 mt-0.5"
              />
              <div className="bg-bg border border-text/10 rounded-2xl rounded-tl-sm px-3 py-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>

        {/* input area */}
        <div className="border-t border-text/10 px-4 py-3 shrink-0 bg-card">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your mailbox… (Ctrl+Enter to send)"
              rows={1}
              className="flex-1 bg-bg border border-text/10 rounded-xl px-3 py-2 text-sm text-text placeholder:text-muted resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[38px] max-h-24 overflow-y-auto"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || loading}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              aria-label="Send message"
            >
              <Send size={14} />
            </button>
          </div>
          <p className="text-[10px] text-muted mt-1.5 text-right">Ctrl+Enter to send</p>
        </div>
      </div>
    </>
  )
}

// ─── main component ──────────────────────────────────────────────────────────

const AdminEmail: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()
  const isAdmin = user?.role === 'admin'

  // mailboxes
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [mailboxesLoading, setMailboxesLoading] = useState(true)
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null)

  // folder + search
  const [folder, setFolder] = useState<EmailFolder>('inbox')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // messages
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)

  // full message
  const [openMessage, setOpenMessage] = useState<EmailMessage | null>(null)
  const [messageLoading, setMessageLoading] = useState(false)

  // modals
  const [showCompose, setShowCompose] = useState(false)
  const [composeProps, setComposeProps] = useState<Partial<ComposeProps>>({})
  const [showManage, setShowManage] = useState(false)

  // mobile view: 'mailboxes' | 'list' | 'message'
  const [mobileView, setMobileView] = useState<'mailboxes' | 'list' | 'message'>('mailboxes')

  // Mr. Imagine assistant panel
  const [showAssistant, setShowAssistant] = useState(false)
  const [assistantQuickAction, setAssistantQuickAction] = useState<'catchup' | 'summarize' | 'draft' | undefined>(undefined)
  // key changes when we want to reset conversation (e.g. mailbox switch)
  const [assistantKey, setAssistantKey] = useState(0)

  // ── load mailboxes ──────────────────────────────────────────────────────────

  const loadMailboxes = useCallback(async () => {
    setMailboxesLoading(true)
    try {
      const { mailboxes: mb } = await emailApi.listMailboxes()
      setMailboxes(mb)
      if (!selectedMailboxId && mb.length > 0) {
        setSelectedMailboxId(mb[0].id)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load mailboxes'
      toast.error('Mailboxes', msg)
    } finally {
      setMailboxesLoading(false)
    }
  }, [selectedMailboxId, toast])

  useEffect(() => {
    loadMailboxes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── load messages ───────────────────────────────────────────────────────────

  const loadMessages = useCallback(
    // `silent` = background refresh: don't flip to the skeleton or clear the
    // open message (prevents the inbox flashing every poll). Used by the 60s
    // poller; foreground loads (mailbox/folder switch, manual refresh) animate.
    async (mailboxId: string, fld: EmailFolder, search?: string, silent = false) => {
      if (!silent) {
        setMessagesLoading(true)
        setSelectedMessageId(null)
        setOpenMessage(null)
      }
      try {
        const { messages: msgs } = await emailApi.listMessages(mailboxId, {
          folder: fld,
          search: search || undefined,
        })
        setMessages(msgs)
      } catch (err: unknown) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : 'Failed to load messages'
          toast.error('Messages', msg)
        }
      } finally {
        if (!silent) setMessagesLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (selectedMailboxId) {
      loadMessages(selectedMailboxId, folder, searchQuery)
      // reset assistant conversation when mailbox changes
      setAssistantKey(k => k + 1)
      setAssistantQuickAction(undefined)
    }
    // Intentionally exclude loadMessages: it reads its target from arguments,
    // so only the primitive triggers should re-run this. Including it (its
    // identity tracks the toast object) re-fired the effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMailboxId, folder, searchQuery])

  // ── search debounce ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
    }, 400)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchInput])

  // ── open message ────────────────────────────────────────────────────────────

  const openMsg = useCallback(
    async (msg: EmailMessage) => {
      setSelectedMessageId(msg.id)
      setMessageLoading(true)
      setMobileView('message')
      try {
        const { message } = await emailApi.getMessage(msg.id)
        setOpenMessage(message)
        // mark read in local state
        setMessages(prev =>
          prev.map(m => (m.id === msg.id ? { ...m, is_read: true } : m))
        )
        // update unread count
        if (!msg.is_read && msg.direction === 'inbound') {
          setMailboxes(prev =>
            prev.map(mb =>
              mb.id === selectedMailboxId
                ? { ...mb, unread_count: Math.max(0, (mb.unread_count ?? 1) - 1) }
                : mb
            )
          )
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Failed to load message'
        toast.error('Message', errMsg)
      } finally {
        setMessageLoading(false)
      }
    },
    [selectedMailboxId, toast]
  )

  // ── polling ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const tick = () => {
      if (document.hidden) return
      if (selectedMailboxId) {
        loadMessages(selectedMailboxId, folder, searchQuery, true) // silent — no skeleton flash
      }
      // refresh unread counts
      emailApi
        .listMailboxes()
        .then(({ mailboxes: mb }) => {
          setMailboxes(mb)
        })
        .catch(() => {})
    }
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
    // loadMessages excluded for the same reason as above — its identity tracked
    // the toast object and recreated the interval every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMailboxId, folder, searchQuery])

  // ── actions ─────────────────────────────────────────────────────────────────

  const handleArchive = async (msg: EmailMessage) => {
    const newArchived = !msg.is_archived
    try {
      await emailApi.updateMessage(msg.id, { is_archived: newArchived })
      setOpenMessage(prev =>
        prev?.id === msg.id ? { ...prev, is_archived: newArchived } : prev
      )
      setMessages(prev => prev.filter(m => m.id !== msg.id))
      toast.success(newArchived ? 'Archived' : 'Unarchived')
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Archive failed', errMsg)
    }
  }

  const handleMarkUnread = async (msg: EmailMessage) => {
    try {
      await emailApi.updateMessage(msg.id, { is_read: false })
      setOpenMessage(null)
      setSelectedMessageId(null)
      setMessages(prev =>
        prev.map(m => (m.id === msg.id ? { ...m, is_read: false } : m))
      )
      setMailboxes(prev =>
        prev.map(mb =>
          mb.id === selectedMailboxId
            ? { ...mb, unread_count: (mb.unread_count ?? 0) + 1 }
            : mb
        )
      )
      toast.success('Marked as unread')
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Failed', errMsg)
    }
  }

  // ── compose helpers ──────────────────────────────────────────────────────────

  const openReply = (msg: EmailMessage) => {
    setComposeProps({
      defaultMailboxId: msg.mailbox_id,
      defaultTo: [msg.from_address],
      defaultSubject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
      defaultBody: `\n\n--- On ${new Date(msg.created_at).toLocaleString()}, ${msg.from_name || msg.from_address} wrote ---\n${msg.text_body ?? ''}`,
      inReplyToId: msg.id,
    })
    setShowCompose(true)
  }

  const openReplyAll = (msg: EmailMessage) => {
    const ccList = [
      ...msg.to_addresses.filter(a => {
        const mb = mailboxes.find(m => m.id === msg.mailbox_id)
        return mb ? a !== mb.address : true
      }),
      ...msg.cc_addresses,
    ]
    setComposeProps({
      defaultMailboxId: msg.mailbox_id,
      defaultTo: [msg.from_address],
      defaultCc: ccList,
      defaultSubject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
      defaultBody: `\n\n--- On ${new Date(msg.created_at).toLocaleString()}, ${msg.from_name || msg.from_address} wrote ---\n${msg.text_body ?? ''}`,
      inReplyToId: msg.id,
    })
    setShowCompose(true)
  }

  const openForward = (msg: EmailMessage) => {
    setComposeProps({
      defaultMailboxId: msg.mailbox_id,
      defaultTo: [],
      defaultSubject: msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`,
      defaultBody: `\n\n--- Forwarded message ---\nFrom: ${msg.from_name || msg.from_address}\nDate: ${new Date(msg.created_at).toLocaleString()}\nSubject: ${msg.subject}\n\n${msg.text_body ?? ''}`,
    })
    setShowCompose(true)
  }

  const openCompose = () => {
    setComposeProps({
      defaultMailboxId: selectedMailboxId ?? mailboxes[0]?.id,
    })
    setShowCompose(true)
  }

  // Opens compose in reply mode with a pre-filled body (used by Mr. Imagine "Use as reply")
  const openReplyWithBody = (body: string) => {
    if (!openMessage) return
    setComposeProps({
      defaultMailboxId: openMessage.mailbox_id,
      defaultTo: [openMessage.from_address],
      defaultSubject: openMessage.subject.startsWith('Re:')
        ? openMessage.subject
        : `Re: ${openMessage.subject}`,
      defaultBody: body,
      inReplyToId: openMessage.id,
    })
    setShowCompose(true)
  }

  // Open the assistant panel, optionally firing a quick action immediately
  const openAssistant = (quickAction?: 'catchup' | 'summarize' | 'draft') => {
    setAssistantQuickAction(quickAction)
    setShowAssistant(true)
  }

  // ── iframe height auto-resize ───────────────────────────────────────────────

  const iframeRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const onLoad = () => {
      try {
        const h = iframe.contentDocument?.body?.scrollHeight ?? 400
        iframe.style.height = `${Math.max(400, h)}px`
      } catch {
        // cross-origin sandbox — ignore
      }
    }
    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
  }, [openMessage?.html_body])

  // ── derived ──────────────────────────────────────────────────────────────────

  const selectedMailbox = useMemo(
    () => mailboxes.find(m => m.id === selectedMailboxId) ?? null,
    [mailboxes, selectedMailboxId]
  )

  // ── folder label helpers ─────────────────────────────────────────────────────

  const folderEmptyLabel: Record<EmailFolder, string> = {
    inbox: 'Your inbox is empty',
    sent: 'No sent messages',
    archived: 'No archived messages',
  }

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* page header */}
      <div className="border-b border-text/10 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Mail className="text-primary" size={22} />
          <h1 className="text-xl font-semibold text-text">Email</h1>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowManage(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-text/10 rounded-lg text-text hover:bg-text/5 transition-colors"
          >
            <Settings size={14} className="text-primary" />
            Manage Mailboxes
          </button>
        )}
      </div>

      {/* 3-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Pane 1: Mailboxes ───────────────────────────────────────── */}
        <aside
          className={`
            flex-col w-64 shrink-0 border-r border-text/10 bg-card overflow-y-auto
            ${mobileView === 'mailboxes' ? 'flex' : 'hidden'} md:flex
          `}
        >
          {/* compose button */}
          <div className="p-3 border-b border-text/10">
            <button
              onClick={openCompose}
              disabled={mailboxes.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Plus size={15} />
              Compose
            </button>
          </div>

          {/* mailbox list */}
          <div className="flex-1 overflow-y-auto py-2">
            {mailboxesLoading ? (
              <div className="px-4 py-6 text-center text-muted text-sm">Loading...</div>
            ) : mailboxes.length === 0 ? (
              <div className="px-4 py-6 text-center text-muted text-sm">
                No mailbox assigned to you yet — ask an admin.
              </div>
            ) : (
              mailboxes.map(mb => (
                <button
                  key={mb.id}
                  onClick={() => {
                    setSelectedMailboxId(mb.id)
                    setFolder('inbox')
                    setMobileView('list')
                  }}
                  className={`
                    w-full text-left px-4 py-3 transition-colors flex items-center gap-3
                    ${selectedMailboxId === mb.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-text hover:bg-text/5'
                    }
                  `}
                >
                  <Mail size={15} className="shrink-0 opacity-70" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {mb.display_name || mb.address}
                    </p>
                    {mb.display_name && (
                      <p className="text-xs text-muted truncate">{mb.address}</p>
                    )}
                  </div>
                  {(mb.unread_count ?? 0) > 0 && (
                    <span className="bg-primary text-white rounded-full px-2 text-xs font-bold shrink-0">
                      {mb.unread_count}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* folder nav */}
          {selectedMailbox && (
            <div className="border-t border-text/10 py-2">
              {(
                [
                  { id: 'inbox' as EmailFolder, label: 'Inbox', Icon: Inbox },
                  { id: 'sent' as EmailFolder, label: 'Sent', Icon: Send },
                  { id: 'archived' as EmailFolder, label: 'Archived', Icon: Archive },
                ] as { id: EmailFolder; label: string; Icon: React.ElementType }[]
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => {
                    setFolder(id)
                    setMobileView('list')
                  }}
                  className={`
                    w-full text-left px-5 py-2.5 flex items-center gap-3 text-sm transition-colors
                    ${folder === id && selectedMailboxId === selectedMailbox.id
                      ? 'text-primary font-medium'
                      : 'text-muted hover:text-text'
                    }
                  `}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* ── Pane 2: Message List ─────────────────────────────────────── */}
        <div
          className={`
            flex-col w-96 shrink-0 border-r border-text/10 overflow-hidden
            ${mobileView === 'list' ? 'flex' : 'hidden'} md:flex
          `}
        >
          {/* toolbar */}
          <div className="px-3 py-3 border-b border-text/10 flex items-center gap-2">
            {/* mobile back */}
            <button
              className="md:hidden text-muted hover:text-text mr-1"
              onClick={() => setMobileView('mailboxes')}
              aria-label="Back to mailboxes"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="relative flex-1">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search messages..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-bg border border-text/10 rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              onClick={() =>
                selectedMailboxId &&
                loadMessages(selectedMailboxId, folder, searchQuery)
              }
              disabled={messagesLoading}
              className="p-2 text-muted hover:text-primary transition-colors disabled:opacity-40"
              aria-label="Refresh"
            >
              <RefreshCw size={14} className={messagesLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* messages */}
          <div className="flex-1 overflow-y-auto">
            {!selectedMailboxId ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
                <Mail size={32} className="text-muted mb-3 opacity-40" />
                <p className="text-muted text-sm">Select a mailbox to view messages</p>
              </div>
            ) : messagesLoading ? (
              <MessageSkeleton />
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
                <Inbox size={32} className="text-muted mb-3 opacity-40" />
                <p className="text-muted text-sm">{folderEmptyLabel[folder]}</p>
              </div>
            ) : (
              messages.map(msg => {
                const isSelected = msg.id === selectedMessageId
                const displayName =
                  folder === 'sent'
                    ? `To: ${msg.to_addresses[0] ?? '(no recipient)'}`
                    : msg.from_name || msg.from_address
                return (
                  <button
                    key={msg.id}
                    onClick={() => openMsg(msg)}
                    className={`
                      w-full text-left px-4 py-3 border-b border-text/5 transition-colors
                      ${isSelected ? 'bg-primary/10' : 'hover:bg-text/5'}
                    `}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {!msg.is_read && folder !== 'sent' && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1"
                            aria-label="Unread"
                          />
                        )}
                        <p
                          className={`text-sm truncate ${
                            !msg.is_read && folder !== 'sent'
                              ? 'font-semibold text-text'
                              : 'font-normal text-text/80'
                          }`}
                        >
                          {displayName}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {msg.attachments.length > 0 && (
                          <Paperclip size={11} className="text-muted" />
                        )}
                        <span className="text-xs text-muted whitespace-nowrap">
                          {formatDate(msg.created_at)}
                        </span>
                      </div>
                    </div>
                    <p
                      className={`text-xs mt-0.5 truncate ${
                        !msg.is_read && folder !== 'sent'
                          ? 'font-medium text-text'
                          : 'text-muted'
                      }`}
                    >
                      {msg.subject || '(no subject)'}
                    </p>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* ── Pane 3: Reading Pane ─────────────────────────────────────── */}
        <main
          className={`
            flex-col flex-1 overflow-hidden
            ${mobileView === 'message' ? 'flex' : 'hidden'} md:flex
          `}
        >
          {messageLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw size={22} className="animate-spin text-muted" />
            </div>
          ) : !openMessage ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <MailOpen size={48} className="text-muted mb-4 opacity-30" />
              <p className="text-muted text-sm">Select a message to read</p>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* message header */}
              <div className="px-6 py-4 border-b border-text/10 shrink-0">
                {/* mobile back */}
                <button
                  className="md:hidden flex items-center gap-1 text-sm text-muted hover:text-text mb-3 transition-colors"
                  onClick={() => setMobileView('list')}
                >
                  <ChevronLeft size={16} />
                  Back
                </button>

                <h2 className="text-lg font-semibold text-text mb-3">
                  {openMessage.subject || '(no subject)'}
                </h2>

                {/* meta */}
                <div className="space-y-1 text-xs text-muted">
                  <p>
                    <span className="font-medium text-text/70">From:</span>{' '}
                    {openMessage.from_name
                      ? `${openMessage.from_name} <${openMessage.from_address}>`
                      : openMessage.from_address}
                  </p>
                  <p>
                    <span className="font-medium text-text/70">To:</span>{' '}
                    {openMessage.to_addresses.join(', ') || '—'}
                  </p>
                  {openMessage.cc_addresses.length > 0 && (
                    <p>
                      <span className="font-medium text-text/70">Cc:</span>{' '}
                      {openMessage.cc_addresses.join(', ')}
                    </p>
                  )}
                  <p>
                    <span className="font-medium text-text/70">Date:</span>{' '}
                    {new Date(openMessage.created_at).toLocaleString()}
                  </p>
                </div>

                {/* action buttons */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <button
                    onClick={() => openReply(openMessage)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text/10 rounded-lg text-text hover:bg-text/5 transition-colors"
                  >
                    <Reply size={13} /> Reply
                  </button>
                  <button
                    onClick={() => openReplyAll(openMessage)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text/10 rounded-lg text-text hover:bg-text/5 transition-colors"
                  >
                    <ReplyAll size={13} /> Reply All
                  </button>
                  <button
                    onClick={() => openForward(openMessage)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text/10 rounded-lg text-text hover:bg-text/5 transition-colors"
                  >
                    <Forward size={13} /> Forward
                  </button>
                  <button
                    onClick={() => handleArchive(openMessage)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text/10 rounded-lg text-text hover:bg-text/5 transition-colors"
                  >
                    <Archive size={13} />
                    {openMessage.is_archived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button
                    onClick={() => handleMarkUnread(openMessage)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-text/10 rounded-lg text-text hover:bg-text/5 transition-colors"
                  >
                    {openMessage.is_read ? (
                      <>
                        <EyeOff size={13} /> Mark Unread
                      </>
                    ) : (
                      <>
                        <Eye size={13} /> Mark Read
                      </>
                    )}
                  </button>
                  {/* Mr. Imagine: Summarize this email */}
                  <button
                    onClick={() => openAssistant('summarize')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-purple-500/30 rounded-lg bg-gradient-to-r from-purple-600/10 to-fuchsia-600/10 text-primary hover:from-purple-600/20 hover:to-fuchsia-600/20 transition-colors font-medium"
                  >
                    <Sparkles size={13} /> Summarize
                  </button>
                </div>
              </div>

              {/* body */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {openMessage.html_body ? (
                  <iframe
                    ref={iframeRef}
                    sandbox=""
                    srcDoc={openMessage.html_body}
                    title="Email body"
                    className="w-full bg-white rounded-lg min-h-[400px] border border-text/10"
                    style={{ height: '400px' }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-text">
                    {openMessage.text_body ?? '(no content)'}
                  </pre>
                )}
              </div>

              {/* attachments */}
              {openMessage.attachments.length > 0 && (
                <div className="px-6 py-3 border-t border-text/10 shrink-0 flex flex-wrap gap-2">
                  {openMessage.attachments.map((att, i) => {
                    const canDownload = Boolean(att.content)
                    const downloadUrl = canDownload
                      ? `data:${att.content_type};base64,${att.content}`
                      : undefined
                    return canDownload ? (
                      <a
                        key={i}
                        href={downloadUrl}
                        download={att.filename}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                      >
                        <Paperclip size={12} />
                        {att.filename}
                        <span className="text-primary/70">({formatFileSize(att.size)})</span>
                      </a>
                    ) : (
                      <span
                        key={i}
                        title="Attachment too large — view in Resend dashboard"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-text/5 text-muted rounded-lg cursor-not-allowed"
                      >
                        <Paperclip size={12} />
                        {att.filename}
                        <span className="text-muted/70">({formatFileSize(att.size)})</span>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* modals */}
      {showCompose && (
        <ComposeModal
          mailboxes={mailboxes}
          {...composeProps}
          onClose={() => {
            setShowCompose(false)
            setComposeProps({})
          }}
          onSent={() => {
            if (selectedMailboxId) loadMessages(selectedMailboxId, folder, searchQuery)
          }}
        />
      )}

      {showManage && isAdmin && (
        <ManageMailboxesModal
          mailboxes={mailboxes}
          onClose={() => setShowManage(false)}
          onChanged={loadMailboxes}
        />
      )}

      {/* Mr. Imagine floating action button */}
      {selectedMailboxId && !showAssistant && (
        <div className="fixed bottom-6 right-6 z-40 group">
          <button
            onClick={() => openAssistant(undefined)}
            className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-purple-500/60"
            aria-label="Ask Mr. Imagine"
          >
            <img
              src="/mr-imagine/mr-imagine-waving.png"
              alt="Mr. Imagine"
              className="w-10 h-10 object-contain"
            />
          </button>
          {/* hover label */}
          <span
            className="pointer-events-none absolute bottom-1/2 translate-y-1/2 right-16 whitespace-nowrap px-2.5 py-1 text-xs font-medium bg-card border border-text/10 text-text rounded-lg shadow opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
          >
            Ask Mr. Imagine
          </span>
        </div>
      )}

      {/* Mr. Imagine assistant panel */}
      {showAssistant && selectedMailboxId && (
        <MrImagineAssistant
          key={assistantKey}
          mailboxId={selectedMailboxId}
          openMessageId={openMessage?.id}
          onClose={() => {
            setShowAssistant(false)
            setAssistantQuickAction(undefined)
          }}
          onUseAsReply={openReplyWithBody}
          initialQuickAction={assistantQuickAction}
        />
      )}
    </div>
  )
}

export default AdminEmail
