// WatchtowerTaskButton — floating hex button for admins/managers, mounted
// globally in App.tsx (renders null for every other role). Opens a quick form
// that files a REAL task onto the Watchtower dev board (davidtrinidad.com)
// through the backend proxy at /api/watchtower/tasks — same board Mr. Imagine
// files to from the Imagine Studio, different source tag (itp-admin).

import React, { useEffect, useRef, useState } from 'react'
import { ClipboardList, X, Check, Loader2, ImagePlus } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { API_BASE } from '../lib/api'
import { supabase } from '../lib/supabase'

const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'

type Priority = 'low' | 'medium' | 'high' | 'critical'

const WatchtowerTaskButton: React.FC = () => {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filedId, setFiledId] = useState<string | null>(null)
  // Optional screenshot so the agent picking the task up can SEE the problem.
  // Attach via the picker button or just Ctrl+V a Win+Shift+S capture.
  const [screenshot, setScreenshot] = useState<{ file: File; preview: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (screenshot) URL.revokeObjectURL(screenshot.preview) }, [screenshot])

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return null

  const attachFile = (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    if (file.size > 8 * 1024 * 1024) { setError('Screenshot is over 8 MB — crop it down.'); return }
    setScreenshot((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview)
      return { file, preview: URL.createObjectURL(file) }
    })
    setError(null)
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (file) { attachFile(file); e.preventDefault() }
  }

  const reset = () => {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setError(null)
    setFiledId(null)
    setScreenshot((prev) => { if (prev) URL.revokeObjectURL(prev.preview); return null })
  }

  const submit = async () => {
    if (!title.trim()) { setError('Give the task a title.'); return }
    setSubmitting(true)
    setError(null)
    try {
      // Multipart when a screenshot rides along (apiFetch forces a JSON
      // content-type, so build the request by hand either way).
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const form = new FormData()
      form.set('title', title.trim())
      form.set('description', description.trim())
      form.set('priority', priority)
      form.set('source', 'itp-admin')
      if (screenshot) form.set('screenshot', screenshot.file, screenshot.file.name || 'screenshot.png')
      const res = await fetch(`${API_BASE}/api/watchtower/tasks`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      })
      const data = await res.json().catch(() => ({})) as { ok?: boolean; taskId?: string; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setFiledId(data.taskId || 'filed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the Watchtower board.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* floating hex trigger — bottom-left, clear of the cart + chat widgets */}
      <button
        onClick={() => { reset(); setOpen(true) }}
        title="File a task to the Watchtower dev board"
        aria-label="File a Watchtower task"
        className="fixed bottom-6 left-6 z-40 w-14 h-16 flex flex-col items-center justify-center bg-gradient-to-br from-primary to-secondary text-white shadow-glowSm hover:shadow-glow hover:scale-110 transition-all"
        style={{ clipPath: HEX_CLIP }}
      >
        <ClipboardList className="w-5 h-5" />
        <span className="text-[8px] font-bold tracking-widest mt-0.5">WT</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md bg-card border border-white/10 rounded-2xl shadow-2xl p-6" onPaste={onPaste}>
            <button onClick={() => setOpen(false)} className="absolute top-4 right-4 text-muted hover:text-text" aria-label="Close">
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-10 flex items-center justify-center bg-gradient-to-br from-primary to-secondary text-white" style={{ clipPath: HEX_CLIP }}>
                <ClipboardList className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-bold text-text">File a Watchtower task</h2>
            </div>
            <p className="text-xs text-muted mb-4">
              Goes straight to the dev board — a bug, a change, anything you need built or fixed.
            </p>

            {filedId ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-400/30 rounded-xl px-4 py-3">
                  <Check className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div className="text-sm text-text">
                    <span className="font-bold">On the board.</span> The dev fleet will pick it up from here.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={reset}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white text-sm font-bold hover:opacity-90 transition-all"
                  >
                    File another
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-bold text-muted hover:text-text transition-all"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs doing? (short title)"
                  maxLength={300}
                  className="w-full bg-bg/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none focus:border-primary/60"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Details — what's wrong or what you need, where it happens, what it should do instead."
                  rows={4}
                  className="w-full bg-bg/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none focus:border-primary/60 resize-none"
                />
                {/* optional screenshot */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { attachFile(e.target.files?.[0]); e.target.value = '' }}
                />
                {screenshot ? (
                  <div className="relative rounded-xl overflow-hidden border border-white/10 bg-bg/60">
                    <img src={screenshot.preview} alt="Attached screenshot" className="w-full max-h-40 object-contain" />
                    <button
                      onClick={() => setScreenshot((prev) => { if (prev) URL.revokeObjectURL(prev.preview); return null })}
                      className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-500/80 transition-colors"
                      aria-label="Remove screenshot"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 border border-dashed border-white/20 rounded-xl px-4 py-3 text-xs text-muted hover:text-text hover:border-primary/50 transition-all"
                  >
                    <ImagePlus className="w-4 h-4" />
                    Attach a screenshot (optional) — click, or just paste one
                  </button>
                )}

                <div className="flex items-center gap-2">
                  {(['low', 'medium', 'high', 'critical'] as Priority[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                        priority === p
                          ? p === 'critical' ? 'bg-red-500 text-white' : 'bg-gradient-to-r from-primary to-secondary text-white'
                          : 'bg-bg/60 border border-white/10 text-muted hover:text-text'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                {error && (
                  <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>
                )}

                <button
                  onClick={() => { void submit() }}
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-bold shadow-glowSm hover:shadow-glow transition-all disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                  {submitting ? 'Filing…' : 'File task'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default WatchtowerTaskButton
