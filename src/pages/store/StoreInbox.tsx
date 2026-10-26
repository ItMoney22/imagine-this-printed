// Her store inbox in the store manager (David 2026-10-26: "she needs a spot to read her email that goes to
// crystal@imaginethisprinted.com, also put jev in it so we make sure keeps junk away"). Two tabs, Inbox and
// Junk kept out (what the junk filter filed on the way in), unread dots, open a message, reply. The API
// (backend/routes/vendor-store-inbox.ts) lets only the store's owner and ITP admins read it. Approved mock:
// page_mockup_approvals for itp-crystal-store-manager-inbox, round 1.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Inbox, Mail, Paperclip, Send, ShieldCheck, ShieldX } from 'lucide-react'
import { vendorStoreApi, type InboxFolder, type InboxList, type InboxMessage, type InboxReply } from '../../lib/vendor-store'

const cleanError = (e: any) => String(e?.message || e).replace(/^HTTP \d+: /, '').replace(/^\{"error":"(.*)"\}$/, '$1')

/** 09:42 today, Yesterday, Mon this week, Oct 3 before that. */
function when(at: string): string {
  const d = new Date(at)
  const now = new Date()
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (days <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function StoreInbox({ slug, onUnread, onToast }: { slug: string; onUnread: (n: number) => void; onToast: (m: string) => void }) {
  const [folder, setFolder] = useState<InboxFolder>('inbox')
  const [list, setList] = useState<InboxList | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<{ message: InboxMessage; replies: InboxReply[] } | null>(null)

  const load = useCallback(() => {
    vendorStoreApi.inbox(slug, folder)
      .then(l => { setList(l); setError(''); onUnread(l.unread) })
      .catch(e => setError(/403/.test(e.message) ? 'Only the store owner reads this inbox.' : 'Your mail didn’t load.'))
  }, [slug, folder, onUnread])
  useEffect(load, [load])
  // New mail shows up when she comes back to the tab.
  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && !open && load()
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [load, open])

  const openMessage = async (id: string) => {
    try {
      setOpen(await vendorStoreApi.inboxMessage(slug, id))
      document.getElementById('inbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      load()
    } catch (e) {
      onToast(cleanError(e))
    }
  }
  const back = () => { setOpen(null); load() }
  const move = async (junk: boolean) => {
    if (!open) return
    try {
      await vendorStoreApi.setJunk(slug, open.message.id, junk)
      onToast(junk ? 'Moved to Junk' : 'Moved to your inbox')
      back()
    } catch (e) {
      onToast(cleanError(e))
    }
  }

  return (
    <section id="inbox" className="rounded-3xl bg-white border border-[var(--vs-line)] p-4 sm:p-6 scroll-mt-44 md:scroll-mt-28">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <span className="w-10 h-10 rounded-full grid place-items-center text-white shrink-0" style={{ background: 'var(--vs-primary)' }}><Mail className="w-5 h-5" /></span>
        <div className="min-w-[15rem] flex-1">
          <h2 className="vs-display text-2xl sm:text-3xl leading-tight">Inbox</h2>
          {list?.address && <p className="text-sm text-[var(--vs-muted)] truncate">{list.address}</p>}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--vs-line)] px-3 h-8 text-xs font-medium text-[var(--vs-primary)]">
          <ShieldCheck className="w-4 h-4 text-[var(--vs-green)]" /> Junk filter on
        </span>
      </div>

      {error ? <p className="text-[var(--vs-muted)]">{error}</p> : open ? (
        <Reader slug={slug} open={open} onBack={back} onMove={move} onToast={onToast} onReplied={r => setOpen({ ...open, replies: [...open.replies, r] })} />
      ) : (
        <>
          <div role="tablist" className="grid grid-cols-2 border-b border-[var(--vs-line)] mb-1">
            {(['inbox', 'junk'] as const).map(f => (
              <button
                key={f}
                role="tab"
                aria-selected={folder === f}
                onClick={() => setFolder(f)}
                className={`h-11 text-sm font-medium border-b-2 -mb-px transition-colors ${folder === f ? 'border-[var(--vs-primary)] text-[var(--vs-primary)]' : 'border-transparent text-[var(--vs-muted)] hover:text-[var(--vs-text)]'}`}
              >
                {f === 'inbox' ? `Inbox${list?.unread ? ` (${list.unread} new)` : ''}` : `Junk kept out${list ? ` (${list.junk})` : ''}`}
              </button>
            ))}
          </div>

          {!list || list.folder !== folder ? (
            <div className="flex flex-col gap-2 py-3">{[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-[var(--vs-page)] animate-pulse" />)}</div>
          ) : !list.address ? (
            <p className="text-[var(--vs-muted)] py-4">This store doesn’t have its own email address yet.</p>
          ) : list.messages.length === 0 ? (
            <p className="flex items-center gap-2 text-[var(--vs-muted)] py-6">
              {folder === 'inbox' ? <><Inbox className="w-5 h-5" /> No mail yet. Mail sent to {list.address} lands here.</> : <><ShieldCheck className="w-5 h-5 text-[var(--vs-green)]" /> Nothing kept out. Junk lands here instead of your inbox.</>}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--vs-line)]">
              {list.messages.map(m => (
                <li key={m.id}>
                  <button onClick={() => openMessage(m.id)} className="w-full text-left grid grid-cols-[14px_minmax(0,1fr)_auto] sm:grid-cols-[14px_minmax(0,170px)_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 items-baseline py-3 px-1 rounded-lg hover:bg-[var(--vs-page)]">
                    <span className={`w-2.5 h-2.5 rounded-full self-center ${m.read ? '' : 'bg-[var(--vs-primary)]'}`} aria-label={m.read ? undefined : 'Unread'} />
                    <span className={`truncate text-sm ${m.read ? '' : 'font-semibold'}`}>{m.fromName || m.fromAddress}</span>
                    <span className="hidden sm:block min-w-0 text-sm">
                      <span className={`block truncate ${m.read ? '' : 'font-semibold'}`}>{m.attachments > 0 && <Paperclip className="inline w-3.5 h-3.5 mr-1 text-[var(--vs-muted)]" />}{m.subject}</span>
                      <span className="block truncate text-xs text-[var(--vs-muted)]">{m.preview}</span>
                    </span>
                    <span className="text-xs text-[var(--vs-muted)] whitespace-nowrap">{when(m.at)}</span>
                    {/* Phone: subject and preview under the sender */}
                    <span className="sm:hidden col-start-2 col-span-2 min-w-0 text-sm">
                      <span className={`block truncate ${m.read ? '' : 'font-semibold'}`}>{m.subject}</span>
                      <span className="block truncate text-xs text-[var(--vs-muted)]">{m.preview}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Reader({ slug, open, onBack, onMove, onToast, onReplied }: {
  slug: string
  open: { message: InboxMessage; replies: InboxReply[] }
  onBack: () => void
  onMove: (junk: boolean) => void
  onToast: (m: string) => void
  onReplied: (r: InboxReply) => void
}) {
  const { message: m, replies } = open
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)

  // Size the mail to its content (no scripts run in it; same-origin only lets us measure it).
  useEffect(() => {
    const f = frame.current
    if (!f) return
    const fit = () => {
      try {
        const doc = f.contentDocument
        if (!doc?.documentElement) return
        // Collapse first: a frame's scrollHeight is never less than its own height.
        f.style.height = '1px'
        f.style.height = `${Math.min(Math.max(doc.documentElement.scrollHeight, 120), 1400)}px`
      } catch { /* leave the default height */ }
    }
    const timers: number[] = []
    const onLoad = () => { fit(); [300, 1000, 2500].forEach(ms => timers.push(window.setTimeout(fit, ms))) }
    f.addEventListener('load', onLoad)
    return () => { f.removeEventListener('load', onLoad); timers.forEach(clearTimeout) }
  }, [m.id])

  const send = async () => {
    if (!text.trim()) return onToast('Write your reply first')
    setSending(true)
    try {
      const { reply } = await vendorStoreApi.reply(slug, m.id, text.trim())
      onReplied(reply)
      setText('')
      onToast('Reply sent')
    } catch (e) {
      onToast(cleanError(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full px-3 h-9 text-sm font-medium hover:bg-[var(--vs-page)]">
          <ArrowLeft className="w-4 h-4" /> {m.junk ? 'Junk' : 'Inbox'}
        </button>
        {!m.junk && (
          <button onClick={() => onMove(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--vs-line)] px-3 h-9 text-sm text-[var(--vs-muted)] hover:text-[var(--vs-pink)]">
            <ShieldX className="w-4 h-4" /> Junk
          </button>
        )}
      </div>

      {m.junk && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--vs-page)] p-3 text-sm">
          <ShieldCheck className="w-5 h-5 text-[var(--vs-green)] shrink-0" />
          <span className="flex-1 min-w-[12rem]">Your junk filter kept this out of your inbox.</span>
          <button onClick={() => onMove(false)} className="vs-btn-solid rounded-full px-4 h-9 font-semibold">Not junk</button>
        </div>
      )}

      <div>
        <h3 className="text-lg sm:text-xl font-semibold leading-snug break-words">{m.subject}</h3>
        <p className="text-sm mt-1 break-words">
          <span className="font-medium">{m.fromName || m.fromAddress}</span>
          {m.fromName && <span className="text-[var(--vs-muted)]"> &lt;{m.fromAddress}&gt;</span>}
          <span className="text-[var(--vs-muted)]"> · {new Date(m.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </p>
      </div>

      {m.html ? (
        <iframe
          key={m.id}
          ref={frame}
          title={m.subject}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={`<base target="_blank"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;margin:16px}</style>${m.html}`}
          className="w-full rounded-xl border border-[var(--vs-line)] bg-white block"
          style={{ height: 420 }}
        />
      ) : (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm rounded-xl border border-[var(--vs-line)] p-4">{m.text || '(no message)'}</pre>
      )}

      {m.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {m.attachments.map((a, i) => a.url ? (
            <a key={i} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-[var(--vs-line)] px-3 h-9 text-sm hover:border-[var(--vs-primary)]"><Paperclip className="w-4 h-4" /> {a.filename}</a>
          ) : (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--vs-line)] px-3 h-9 text-sm text-[var(--vs-muted)]"><Paperclip className="w-4 h-4" /> {a.filename}</span>
          ))}
        </div>
      )}

      {replies.map((r, i) => (
        <div key={i} className="rounded-2xl bg-[var(--vs-page)] p-3 text-sm">
          <p className="text-xs text-[var(--vs-muted)] mb-1">You replied · {new Date(r.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
          <p className="whitespace-pre-wrap break-words">{r.text}</p>
        </div>
      ))}

      {!m.junk && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="inbox-reply">Reply to {m.fromName || m.fromAddress}</label>
          <textarea
            id="inbox-reply"
            rows={4}
            maxLength={10000}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Write your reply…"
            className="w-full rounded-xl border border-[var(--vs-line)] px-3 py-2 outline-none focus:border-[var(--vs-primary)]"
          />
          <button disabled={sending || !text.trim()} onClick={send} className="vs-btn-pink w-full sm:w-auto sm:self-end inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold">
            <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      )}
    </div>
  )
}
