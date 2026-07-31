import React, { useState, useEffect, useRef } from 'react'
import { Store, RefreshCw, ExternalLink, Sparkles, Send, Eraser, Camera, X, AlertTriangle } from 'lucide-react'
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

/** Per-shot design-fidelity verdict from the backend QA pass, parallel to `images`. */
interface ShotCheck {
  ok: boolean
  reason?: string
  retried?: boolean
}

interface EtsyShots {
  status: 'generating' | 'done' | 'failed'
  images: string[]
  total?: number
  stage?: string
  cast?: string[]
  checks?: ShotCheck[]
  error?: string
}

// Casting catalog from the backend (backend/services/etsy-model-shots.ts).
interface ShotSubject {
  id: string
  label: string
  persona: string
  keywords: string[]
}

/** What the admin picked for one product's shoot before hitting Shoot. */
interface CastDraft {
  ids: string[]
  custom: string
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

// Metal art is staged in room scenes at a fixed pair of panel sizes — there is
// no human subject to cast, so those rows skip the picker entirely.
const HAS_MODEL = (category: string | null) => category !== 'metal-art'

// A shoot casts at most two subjects (one per shot).
const MAX_CAST = 2

/**
 * Pre-select the subjects whose keywords the listing actually mentions, ranked
 * by how many hit. Word-boundary matching on purpose: substring matching made
 * "art" fire on "cartoon" and "party". Nothing matched → empty, which the
 * backend reads as "cast randomly", i.e. the original behavior.
 */
const suggestCast = (candidate: EtsyCandidate, subjects: ShotSubject[]): string[] => {
  const haystack = [candidate.name, ...(candidate.etsy_pack?.tags ?? [])].join(' ').toLowerCase()
  return subjects
    .map(s => ({
      id: s.id,
      hits: s.keywords.filter(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack)).length
    }))
    .filter(s => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, MAX_CAST)
    .map(s => s.id)
}

/**
 * Subject picker. Used twice: before a full shoot (two slots), and to recast a
 * single photo the admin didn't like (one slot). Identical UI both times, so it
 * lives here rather than being written out twice with drifting copy.
 */
function CastPicker({
  subjects, cast, onChange, onSubmit, onSurprise, title, cta, hintFor, maxCast, busy
}: {
  subjects: ShotSubject[]
  cast: CastDraft
  onChange: (next: CastDraft) => void
  onSubmit: () => void
  onSurprise: () => void
  title: string
  cta: string
  hintFor: (picked: number) => string
  maxCast: number
  busy: boolean
}) {
  const picked = cast.ids.length + (cast.custom.trim() ? 1 : 0)
  const toggle = (subjectId: string) =>
    onChange({
      ...cast,
      ids: cast.ids.includes(subjectId)
        ? cast.ids.filter(s => s !== subjectId)
        // At the cap, drop the oldest pick rather than ignoring the click —
        // silently doing nothing reads as a broken chip.
        : [...cast.ids, subjectId].slice(-maxCast)
    })

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[10px] uppercase tracking-wide text-blue-700 font-semibold">{title}</label>
        <span className="text-[10px] text-blue-600">{hintFor(picked)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {subjects.map(s => (
          <button
            key={s.id}
            onClick={() => toggle(s.id)}
            title={s.persona}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
              cast.ids.includes(s.id)
                ? 'bg-[#f1641e] border-[#f1641e] text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <input
        value={cast.custom}
        onChange={e => onChange({ ...cast, custom: e.target.value })}
        maxLength={220}
        placeholder="…or describe someone else (adults only): “a college student with a backpack”"
        className="w-full mt-2 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-900 bg-white"
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={onSubmit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs font-medium py-1.5 px-3 rounded-lg bg-[#f1641e] hover:bg-[#d9531a] disabled:opacity-50 text-white"
        >
          <Camera className="w-3.5 h-3.5" />
          {busy ? 'Starting…' : cta}
        </button>
        <button onClick={onSurprise} className="text-xs text-slate-500 hover:text-slate-700 underline">
          Surprise me
        </button>
        <span className="text-[10px] text-slate-500 ml-auto">
          Every shoot casts a brand-new person — models are always adults.
        </span>
      </div>
    </div>
  )
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
  const [subjects, setSubjects] = useState<ShotSubject[]>([])
  const [castOpen, setCastOpen] = useState<string | null>(null)
  const [casts, setCasts] = useState<Record<string, CastDraft>>({})
  // Which single photo is being recast, and who with. One at a time on purpose.
  const [reshootAt, setReshootAt] = useState<{ id: string; index: number } | null>(null)
  const [reshootCast, setReshootCast] = useState<CastDraft>({ ids: [], custom: '' })
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
      try {
        const subjectRes = await api.get('/api/admin/etsy/shot-subjects')
        setSubjects(subjectRes.data?.subjects ?? [])
      } catch {
        // Picker degrades to "custom subject + surprise me" without the catalog.
        setSubjects([])
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

  // Opening the row + expanding it are the same two moves everywhere the shot
  // flow touches a candidate, so they live here.
  const expandCandidate = (id: string) => {
    const candidate = candidates.find(c => c.id === id)
    if (candidate?.etsy_pack && !drafts[id]) {
      setDrafts(prev => ({ ...prev, [id]: packToDraft(candidate.etsy_pack!) }))
    }
    setExpanded(id)
  }

  const handleGenerateShots = async (id: string, cast?: CastDraft) => {
    try {
      setBusyFor(id, 'shooting')
      setError(null)
      const res = await api.post(`/api/admin/etsy/model-shots/${id}`, {
        subjects: cast?.ids ?? [],
        custom: cast?.custom.trim() || undefined
      })
      setCandidates(prev => prev.map(c => (c.id === id ? { ...c, etsy_shots: res.data.shots } : c)))
      // Open the row so the progress skeletons are visible immediately.
      expandCandidate(id)
      setCastOpen(null)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Model shot generation failed to start')
    } finally {
      setBusyFor(id, null)
    }
  }

  // The Model shots button no longer fires straight into a shoot — it opens the
  // cast picker so the subject is chosen BEFORE any image is paid for (David
  // 2026-07-30: a kids' back-to-school tee came back modeled by a grandma).
  // Metal art has no human subject, so it still shoots immediately.
  const handleShotsButton = (candidate: EtsyCandidate) => {
    if (!HAS_MODEL(candidate.category)) {
      void handleGenerateShots(candidate.id)
      return
    }
    if (castOpen === candidate.id) {
      setCastOpen(null)
      return
    }
    setCasts(prev =>
      prev[candidate.id] ? prev : { ...prev, [candidate.id]: { ids: suggestCast(candidate, subjects), custom: '' } }
    )
    expandCandidate(candidate.id)
    setCastOpen(candidate.id)
  }

  // Recast ONE photo, keeping the rest (David 2026-07-31: rejecting a face
  // should cost one render, not a whole new shoot).
  const handleReshootShot = async (id: string, index: number, cast: CastDraft) => {
    try {
      setBusyFor(id, 'shooting')
      setError(null)
      const res = await api.post(`/api/admin/etsy/model-shots/${id}/reshoot`, {
        index,
        subjects: cast.ids,
        custom: cast.custom.trim() || undefined
      })
      setCandidates(prev => prev.map(c => (c.id === id ? { ...c, etsy_shots: res.data.shots } : c)))
      setReshootAt(null)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Reshoot failed to start')
    } finally {
      setBusyFor(id, null)
    }
  }

  // Metal art has no model to dislike — its reshoot is just a new room scene.
  const openReshoot = (candidate: EtsyCandidate, index: number) => {
    if (!HAS_MODEL(candidate.category)) {
      void handleReshootShot(candidate.id, index, { ids: [], custom: '' })
      return
    }
    if (reshootAt?.id === candidate.id && reshootAt.index === index) {
      setReshootAt(null)
      return
    }
    setReshootCast({ ids: [], custom: '' })
    setCastOpen(null)
    setReshootAt({ id: candidate.id, index })
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
                            onClick={() => handleShotsButton(c)}
                            disabled={!!action || c.etsy_shots?.status === 'generating'}
                            title={
                              HAS_MODEL(c.category)
                                ? 'Pick who models this design, then shoot — these photos lead the listing images'
                                : 'Stage this design as a metal print in two room scenes — these lead the listing images'
                            }
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
                          {castOpen === c.id && c.etsy_shots?.status !== 'generating' && (
                            <CastPicker
                              subjects={subjects}
                              cast={casts[c.id] ?? { ids: [], custom: '' }}
                              onChange={next => setCasts(prev => ({ ...prev, [c.id]: next }))}
                              onSubmit={() => handleGenerateShots(c.id, casts[c.id] ?? { ids: [], custom: '' })}
                              onSurprise={() => setCasts(prev => ({ ...prev, [c.id]: { ids: [], custom: '' } }))}
                              title="Who models this design?"
                              cta="Shoot 2 photos"
                              maxCast={MAX_CAST}
                              busy={action === 'shooting'}
                              hintFor={picked =>
                                picked === 0
                                  ? 'nobody picked — two random looks'
                                  : picked === 1
                                    ? 'one subject — both photos, different scenes'
                                    : 'two subjects — one photo each'
                              }
                            />
                          )}
                          {c.etsy_shots && (c.etsy_shots.images.length > 0 || c.etsy_shots.status === 'generating') && (
                            <div>
                              <label className="text-[10px] uppercase tracking-wide text-slate-400">
                                Model shots — these lead the listing images
                              </label>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {c.etsy_shots.images.map((url, i) => {
                                  const check = c.etsy_shots?.checks?.[i]
                                  const who = c.etsy_shots?.cast?.[i]
                                  return (
                                  <div key={`${url}-${i}`} className="relative">
                                    <a href={url} target="_blank" rel="noopener noreferrer">
                                      <img
                                        src={url}
                                        alt=""
                                        className={`w-20 h-24 object-cover rounded-lg border bg-slate-50 ${
                                          check?.ok === false ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200'
                                        }`}
                                      />
                                    </a>
                                    {check?.ok === false && (
                                      <span
                                        title={`Design check failed: ${check.reason || 'the print does not match the source art'}`}
                                        className="absolute -top-1.5 -left-1.5 bg-amber-400 rounded-full p-0.5 shadow"
                                      >
                                        <AlertTriangle className="w-3 h-3 text-white" />
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleRemoveShot(c.id, url)}
                                      title="Remove this shot"
                                      className="absolute -top-1.5 -right-1.5 bg-white border border-slate-200 rounded-full p-0.5 shadow hover:bg-red-50"
                                    >
                                      <X className="w-3 h-3 text-slate-500" />
                                    </button>
                                    <button
                                      onClick={() => openReshoot(c, i)}
                                      disabled={!!action || c.etsy_shots?.status === 'generating'}
                                      title={
                                        HAS_MODEL(c.category)
                                          ? "Don't like this model? Recast just this photo — the other one stays."
                                          : 'Restage just this panel in a different room scene'
                                      }
                                      className="absolute -bottom-1.5 -right-1.5 bg-white border border-slate-200 rounded-full p-0.5 shadow hover:bg-slate-50 disabled:opacity-40"
                                    >
                                      <RefreshCw className="w-3 h-3 text-slate-500" />
                                    </button>
                                    {who && (
                                      <span className="block w-20 text-[9px] text-slate-500 text-center mt-1 truncate" title={who}>
                                        {who}
                                      </span>
                                    )}
                                  </div>
                                  )
                                })}
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
                              {c.etsy_shots.status !== 'generating' && c.etsy_shots.checks?.some(k => k.ok === false) && (
                                <p className="text-[11px] text-amber-700 mt-1.5">
                                  A flagged photo didn't reproduce the design faithfully even after an automatic retry —
                                  reshoot it or remove it before queueing the draft.
                                </p>
                              )}
                              {reshootAt?.id === c.id && c.etsy_shots.status !== 'generating' && (
                                <div className="mt-2">
                                  <CastPicker
                                    subjects={subjects}
                                    cast={reshootCast}
                                    onChange={setReshootCast}
                                    onSubmit={() => handleReshootShot(c.id, reshootAt.index, reshootCast)}
                                    onSurprise={() => setReshootCast({ ids: [], custom: '' })}
                                    title={`Recast photo ${reshootAt.index + 1}`}
                                    cta="Reshoot this photo"
                                    maxCast={1}
                                    busy={action === 'shooting'}
                                    hintFor={picked =>
                                      picked === 0
                                        ? 'nobody picked — a different random person'
                                        : 'this subject, freshly cast'
                                    }
                                  />
                                </div>
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
