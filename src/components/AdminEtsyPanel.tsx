import React, { useState, useEffect, useRef } from 'react'
import { Store, RefreshCw, ExternalLink, Sparkles, Send, Eraser, Camera, X } from 'lucide-react'
import api from '../lib/api'

interface EtsyStatus {
  enabled: boolean
  configured: boolean
  connected: boolean
  shop_id: number | null
  shop_name: string | null
  scopes: string | null
  connected_at: string | null
  token_expires_at: string | null
  redirect_uri: string | null
}

interface EtsyListingRow {
  id: string
  product_id: string
  listing_id: number | null
  state: string
  etsy_url: string | null
  uploaded_image_count: number
  last_error: string | null
  updated_at: string
}

interface EtsyPack {
  title: string
  tags: string[]
  description: string
  price: number
  colors?: string[]
  composed_at: string
  model: string
  edited_at?: string
}

interface EtsyShots {
  status: 'generating' | 'done' | 'failed'
  images: string[]
  total?: number
  stage?: string
  error?: string
}

interface EtsyCandidate {
  id: string
  name: string
  category: string | null
  price: number
  hero_image: string | null
  image_count: number
  taxonomy_mapped: boolean
  gate_pass: boolean
  gate_reasons: string[]
  etsy_pack: EtsyPack | null
  etsy_shots: EtsyShots | null
  created_at: string
}

interface PackDraft {
  title: string
  tags: string
  description: string
  price: string
  colors: string
}

// Ledger states worth surfacing as their own chip, in pipeline order.
const STATES = ['queued', 'processing', 'draft', 'active', 'blocked', 'error'] as const

const STATE_STYLES: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-600',
  processing: 'bg-blue-100 text-blue-700',
  draft: 'bg-amber-100 text-amber-700',
  active: 'bg-emerald-100 text-emerald-700',
  blocked: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700'
}

const packToDraft = (pack: EtsyPack): PackDraft => ({
  title: pack.title,
  tags: pack.tags.join(', '),
  description: pack.description,
  price: String(pack.price),
  colors: (pack.colors ?? []).join(', ')
})

export default function AdminEtsyPanel() {
  const [status, setStatus] = useState<EtsyStatus | null>(null)
  const [listings, setListings] = useState<EtsyListingRow[]>([])
  const [candidates, setCandidates] = useState<EtsyCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, PackDraft>>({})
  const [busy, setBusy] = useState<Record<string, string>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshCandidates = async () => {
    try {
      const candidateRes = await api.get('/api/admin/etsy/candidates')
      setCandidates(candidateRes.data?.results ?? [])
    } catch { /* transient — next poll or manual refresh recovers */ }
  }

  // While any candidate is generating model shots, poll every 5s so stage text
  // and thumbnails move without the admin mashing refresh.
  useEffect(() => {
    const generating = candidates.some(c => c.etsy_shots?.status === 'generating')
    if (generating && !pollRef.current) {
      pollRef.current = setInterval(refreshCandidates, 5_000)
    } else if (!generating && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [candidates])

  const fetchAll = async () => {
    try {
      setLoading(true)
      setError(null)
      const statusRes = await api.get('/api/admin/etsy/status')
      setStatus(statusRes.data)
      // The ledger + candidates live behind the same guard but read tables that
      // only exist once the migration has run, so failures must not blank the panel.
      try {
        const listingRes = await api.get('/api/admin/etsy/listings')
        setListings(listingRes.data?.results ?? [])
      } catch {
        setListings([])
      }
      try {
        const candidateRes = await api.get('/api/admin/etsy/candidates')
        setCandidates(candidateRes.data?.results ?? [])
      } catch {
        setCandidates([])
      }
    } catch (err: any) {
      console.error('Error fetching Etsy status:', err)
      setError(err?.message || 'Failed to load Etsy status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
  }, [])

  // Sends the admin to Etsy's consent screen. Etsy redirects back to the
  // backend callback, which stores the connection server-side.
  const handleConnect = async () => {
    try {
      setConnecting(true)
      setError(null)
      const res = await api.get('/api/admin/etsy/connect')
      if (!res.data?.url) throw new Error('No consent URL returned')
      window.location.href = res.data.url
    } catch (err: any) {
      console.error('Error starting Etsy connect:', err)
      setError(err?.message || 'Failed to start the Etsy connect flow')
      setConnecting(false)
    }
  }

  const setBusyFor = (id: string, action: string | null) =>
    setBusy(prev => {
      const next = { ...prev }
      if (action) next[id] = action
      else delete next[id]
      return next
    })

  const applyPack = (id: string, pack: EtsyPack) => {
    setCandidates(prev => prev.map(c => (c.id === id ? { ...c, etsy_pack: pack } : c)))
    setDrafts(prev => ({ ...prev, [id]: packToDraft(pack) }))
  }

  const handleCompose = async (id: string) => {
    try {
      setBusyFor(id, 'composing')
      setError(null)
      const res = await api.post(`/api/admin/etsy/compose/${id}`)
      applyPack(id, res.data.pack)
      setExpanded(id)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Compose failed')
    } finally {
      setBusyFor(id, null)
    }
  }

  const handleReview = (candidate: EtsyCandidate) => {
    if (expanded === candidate.id) {
      setExpanded(null)
      return
    }
    if (candidate.etsy_pack && !drafts[candidate.id]) {
      setDrafts(prev => ({ ...prev, [candidate.id]: packToDraft(candidate.etsy_pack!) }))
    }
    setExpanded(candidate.id)
  }

  const handleSave = async (id: string) => {
    const draft = drafts[id]
    if (!draft) return
    try {
      setBusyFor(id, 'saving')
      setError(null)
      const res = await api.put(`/api/admin/etsy/pack/${id}`, {
        title: draft.title,
        tags: draft.tags.split(',').map(t => t.trim()).filter(Boolean),
        description: draft.description,
        price: Number(draft.price),
        colors: draft.colors.split(',').map(t => t.trim()).filter(Boolean)
      })
      applyPack(id, res.data.pack)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Save failed')
    } finally {
      setBusyFor(id, null)
    }
  }

  const handleGenerateShots = async (id: string) => {
    try {
      setBusyFor(id, 'shooting')
      setError(null)
      const res = await api.post(`/api/admin/etsy/model-shots/${id}`)
      setCandidates(prev => prev.map(c => (c.id === id ? { ...c, etsy_shots: res.data.shots } : c)))
      // Open the row so the progress skeletons are visible immediately.
      const candidate = candidates.find(c => c.id === id)
      if (candidate?.etsy_pack && !drafts[id]) {
        setDrafts(prev => ({ ...prev, [id]: packToDraft(candidate.etsy_pack!) }))
      }
      setExpanded(id)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Model shot generation failed to start')
    } finally {
      setBusyFor(id, null)
    }
  }

  const handleRemoveShot = async (id: string, url: string) => {
    const candidate = candidates.find(c => c.id === id)
    if (!candidate?.etsy_shots) return
    try {
      setError(null)
      const res = await api.put(`/api/admin/etsy/model-shots/${id}`, {
        images: candidate.etsy_shots.images.filter(u => u !== url)
      })
      setCandidates(prev => prev.map(c => (c.id === id ? { ...c, etsy_shots: res.data.shots } : c)))
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to remove shot')
    }
  }

  const handleQueue = async (id: string) => {
    try {
      setBusyFor(id, 'queueing')
      setError(null)
      await api.post(`/api/admin/etsy/queue/${id}`)
      setCandidates(prev => prev.filter(c => c.id !== id))
      if (expanded === id) setExpanded(null)
      // Refresh the ledger so the new queued row shows in the chips.
      try {
        const listingRes = await api.get('/api/admin/etsy/listings')
        setListings(listingRes.data?.results ?? [])
      } catch { /* chips refresh on next manual refresh */ }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Queue failed')
    } finally {
      setBusyFor(id, null)
    }
  }

  // For drafts David has deleted on Etsy's side (Shop Manager): mark the ledger
  // rows 'removed' so the pipeline chips stop counting ghosts and the products
  // become listable again under the new flow.
  const handleClearDrafts = async () => {
    const draftRows = listings.filter(l => l.state === 'draft')
    if (!draftRows.length) return
    if (!window.confirm(
      `Mark ${draftRows.length} draft listing(s) as removed? Only do this AFTER deleting them in Etsy Shop Manager — this only cleans up our ledger, it does not touch Etsy.`
    )) return
    try {
      setError(null)
      await api.post('/api/admin/etsy/listings/mark-removed', { productIds: draftRows.map(l => l.product_id) })
      await fetchAll()
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Clear failed')
    }
  }

  const counts = STATES.map(s => ({ state: s, n: listings.filter(l => l.state === s).length }))
  const problems = listings.filter(l => l.state === 'blocked' || l.state === 'error').slice(0, 5)
  const draftCount = listings.filter(l => l.state === 'draft').length

  return (
    <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          <Store className="w-5 h-5 text-[#f1641e]" /> Etsy
        </h3>
        <button onClick={fetchAll} className="p-2 text-slate-400 hover:text-slate-700" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

      {!status && loading ? (
        <div className="text-sm text-slate-500">Checking Etsy…</div>
      ) : status && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
              status.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}>
              <span className={`w-2 h-2 rounded-full ${status.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {status.connected ? `Connected: ${status.shop_name ?? 'shop'}` : 'Not connected'}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
              status.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {status.enabled ? 'Posting enabled' : 'Posting paused'}
            </span>
            {!status.configured && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                API keys missing
              </span>
            )}
          </div>

          {listings.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {counts.filter(c => c.n > 0).map(c => (
                <span key={c.state} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${STATE_STYLES[c.state]}`}>
                  {c.state}: <strong>{c.n}</strong>
                </span>
              ))}
              {draftCount > 0 && (
                <button
                  onClick={handleClearDrafts}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                  title="After deleting drafts in Etsy Shop Manager, clear them from our ledger"
                >
                  <Eraser className="w-3 h-3" /> Clear deleted drafts
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-[#f1641e] hover:bg-[#d9531a] disabled:bg-slate-300 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
            >
              {connecting ? 'Opening Etsy…' : status.connected ? 'Reconnect shop' : 'Connect Etsy shop'}
            </button>
            {status.connected && status.shop_name && (
              <a
                href={`https://www.etsy.com/shop/${status.shop_name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                View shop <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <p className="text-xs text-slate-500 mt-2">
            Etsy refresh tokens expire after 90 days. If posting starts failing with an auth error, hit Reconnect.
            {status.connected && status.connected_at && ` Connected ${new Date(status.connected_at).toLocaleDateString()}.`}
          </p>

          {problems.length > 0 && (
            <div className="border border-red-100 bg-red-50 rounded-xl p-4 mt-4">
              <div className="text-sm font-semibold text-red-700 mb-2">Needs attention</div>
              <ul className="space-y-1.5">
                {problems.map(p => (
                  <li key={p.id} className="text-xs text-red-700">
                    <span className="font-medium uppercase">{p.state}</span> · {p.last_error || 'no detail recorded'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* Publish queue — opt-in per shirt: compose → review → queue.    */}
          {/* ------------------------------------------------------------- */}
          <div className="mt-6 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-slate-900">
                Ready for Etsy <span className="text-slate-400 font-normal">({candidates.length})</span>
              </h4>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              New active shirts land here automatically. Compose writes Etsy-native copy for review; Queue posts an
              invisible draft. Listings are priced at $25 — run a 40% shop sale in Shop Manager so buyers see $15.
            </p>

            {candidates.length === 0 ? (
              <div className="text-xs text-slate-400">Nothing waiting — create a new shirt and it shows up here.</div>
            ) : (
              <ul className="space-y-2">
                {candidates.map(c => {
                  const draft = drafts[c.id]
                  const action = busy[c.id]
                  const isOpen = expanded === c.id
                  const blocked = !c.gate_pass
                  return (
                    <li key={c.id} className="border border-slate-100 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        {c.hero_image ? (
                          <img src={c.hero_image} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-100" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-slate-100" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{c.name}</div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {c.category && <span className="text-[10px] uppercase tracking-wide text-slate-400">{c.category}</span>}
                            {blocked && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700" title={c.gate_reasons.join(' | ')}>
                                gate: blocked
                              </span>
                            )}
                            {!c.taxonomy_mapped && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                no taxonomy for “{c.category ?? 'none'}”
                              </span>
                            )}
                            {c.image_count === 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">no images</span>
                            )}
                            {c.etsy_pack && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                copy {c.etsy_pack.edited_at ? 'edited' : 'ready'}
                              </span>
                            )}
                            {c.etsy_shots?.status === 'generating' && (
                              <span className="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700">
                                <span className="relative w-14 h-1.5 rounded-full bg-blue-100 overflow-hidden">
                                  <span
                                    className="absolute inset-y-0 left-0 rounded-full bg-blue-600 transition-all duration-700 animate-pulse"
                                    style={{ width: `${Math.max(8, Math.round(((c.etsy_shots.images.length) / (c.etsy_shots.total || 2)) * 100))}%` }}
                                  />
                                </span>
                                {c.etsy_shots.images.length}/{c.etsy_shots.total || 2} · {c.etsy_shots.stage || 'working…'}
                              </span>
                            )}
                            {c.etsy_shots?.status === 'done' && c.etsy_shots.images.length > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                {c.etsy_shots.images.length} model shot{c.etsy_shots.images.length > 1 ? 's' : ''}
                              </span>
                            )}
                            {c.etsy_shots?.status === 'failed' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700" title={c.etsy_shots.error}>
                                shots failed
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => (c.etsy_pack ? handleReview(c) : handleCompose(c.id))}
                            disabled={!!action}
                            className="inline-flex items-center gap-1.5 text-xs font-medium py-1.5 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            {action === 'composing' ? 'Composing…' : c.etsy_pack ? (isOpen ? 'Close' : 'Review') : 'Compose'}
                          </button>
                          <button
                            onClick={() => handleGenerateShots(c.id)}
                            disabled={!!action || c.etsy_shots?.status === 'generating'}
                            title="Generate AI on-model photos with this design composited — they lead the listing images"
                            className="inline-flex items-center gap-1.5 text-xs font-medium py-1.5 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            {c.etsy_shots?.status === 'generating' ? 'Shooting…' : c.etsy_shots?.images.length ? 'Reshoot' : 'Model shots'}
                          </button>
                          <button
                            onClick={() => handleQueue(c.id)}
                            disabled={!!action || blocked || !c.taxonomy_mapped || c.image_count === 0 || !c.etsy_pack}
                            title={!c.etsy_pack ? 'Compose the listing copy first' : blocked ? c.gate_reasons.join(' | ') : 'Post as an invisible Etsy draft'}
                            className="inline-flex items-center gap-1.5 text-xs font-medium py-1.5 px-3 rounded-lg bg-[#f1641e] hover:bg-[#d9531a] disabled:bg-slate-200 disabled:text-slate-400 text-white"
                          >
                            <Send className="w-3.5 h-3.5" />
                            {action === 'queueing' ? 'Queueing…' : 'Queue draft'}
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                          {c.etsy_shots && (c.etsy_shots.images.length > 0 || c.etsy_shots.status === 'generating') && (
                            <div>
                              <label className="text-[10px] uppercase tracking-wide text-slate-400">
                                Model shots — these lead the listing images
                              </label>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {c.etsy_shots.images.map(url => (
                                  <div key={url} className="relative">
                                    <a href={url} target="_blank" rel="noopener noreferrer">
                                      <img src={url} alt="" className="w-20 h-24 object-cover rounded-lg border border-slate-200 bg-slate-50" />
                                    </a>
                                    <button
                                      onClick={() => handleRemoveShot(c.id, url)}
                                      title="Remove this shot"
                                      className="absolute -top-1.5 -right-1.5 bg-white border border-slate-200 rounded-full p-0.5 shadow hover:bg-red-50"
                                    >
                                      <X className="w-3 h-3 text-slate-500" />
                                    </button>
                                  </div>
                                ))}
                                {c.etsy_shots.status === 'generating' &&
                                  Array.from({ length: Math.max(0, (c.etsy_shots.total || 2) - c.etsy_shots.images.length) }).map((_, i) => (
                                    <div
                                      key={`pending-${i}`}
                                      className="w-20 h-24 rounded-lg border border-dashed border-blue-200 bg-blue-50 animate-pulse flex items-center justify-center"
                                    >
                                      <Camera className="w-4 h-4 text-blue-300" />
                                    </div>
                                  ))}
                              </div>
                              {c.etsy_shots.status === 'generating' && (
                                <p className="text-[11px] text-blue-600 mt-1.5">
                                  {c.etsy_shots.stage || 'Working…'} Each shot takes 30–60 seconds; they appear here as they finish.
                                </p>
                              )}
                            </div>
                          )}
                          {draft && (<>
                          <div>
                            <label className="text-[10px] uppercase tracking-wide text-slate-400">
                              Title <span className={draft.title.length > 140 ? 'text-red-500' : ''}>({draft.title.length}/140)</span>
                            </label>
                            <input
                              value={draft.title}
                              onChange={e => setDrafts(prev => ({ ...prev, [c.id]: { ...draft, title: e.target.value } }))}
                              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wide text-slate-400">
                              Tags, comma separated ({draft.tags.split(',').map(t => t.trim()).filter(Boolean).length}/13, each ≤20 chars)
                            </label>
                            <input
                              value={draft.tags}
                              onChange={e => setDrafts(prev => ({ ...prev, [c.id]: { ...draft, tags: e.target.value } }))}
                              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wide text-slate-400">
                              Shirt colors, comma separated — buyer picks on Etsy; model shots rotate through them
                            </label>
                            <input
                              value={draft.colors}
                              onChange={e => setDrafts(prev => ({ ...prev, [c.id]: { ...draft, colors: e.target.value } }))}
                              placeholder="Burgundy, Black"
                              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wide text-slate-400">Description</label>
                            <textarea
                              value={draft.description}
                              onChange={e => setDrafts(prev => ({ ...prev, [c.id]: { ...draft, description: e.target.value } }))}
                              rows={6}
                              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900"
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <div>
                              <label className="text-[10px] uppercase tracking-wide text-slate-400">Price $</label>
                              <input
                                value={draft.price}
                                onChange={e => setDrafts(prev => ({ ...prev, [c.id]: { ...draft, price: e.target.value } }))}
                                className="w-20 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900"
                              />
                            </div>
                            <span className="text-[11px] text-slate-400 mt-4">shows as $15 once the 40% shop sale is running</span>
                            <div className="flex-1" />
                            <button
                              onClick={() => handleCompose(c.id)}
                              disabled={!!action}
                              className="text-xs font-medium py-1.5 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 mt-4"
                            >
                              {action === 'composing' ? 'Recomposing…' : 'Recompose'}
                            </button>
                            <button
                              onClick={() => handleSave(c.id)}
                              disabled={!!action}
                              className="text-xs font-medium py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-700 disabled:opacity-50 text-white mt-4"
                            >
                              {action === 'saving' ? 'Saving…' : 'Save edits'}
                            </button>
                          </div>
                          </>)}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
