import React, { useState, useEffect } from 'react'
import { FolderOpen, RefreshCw, CheckCircle, EyeOff, ChevronLeft, ChevronRight, Shirt } from 'lucide-react'
import api, { aiProducts } from '../lib/api'

interface Collection {
  name: string
  draft: number
  active: number
  other: number
  total: number
}

interface LibraryProduct {
  id: string
  name: string
  slug: string | null
  price: number
  status: string
  images: string[]
}

export default function AdminDesignLibrary() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'active'>('all')
  const [products, setProducts] = useState<LibraryProduct[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState(60)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [mockupRun, setMockupRun] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 5000)
  }

  const fetchCollections = async () => {
    try {
      setLoading(true)
      const response = await api.get('/api/admin/design-library/collections')
      setCollections(response.data.collections || [])
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load collections')
    } finally {
      setLoading(false)
    }
  }

  const fetchProducts = async (collection: string, status = statusFilter, off = 0) => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/api/admin/design-library/products', {
        params: { collection, status, offset: off }
      })
      setProducts(response.data.products || [])
      setTotal(response.data.total || 0)
      setOffset(response.data.offset || 0)
      setPageSize(response.data.page_size || 60)
      setChecked(new Set())
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load designs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCollections() }, [])
  useEffect(() => {
    if (selected) fetchProducts(selected, statusFilter, 0)
  }, [selected, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (status: 'active' | 'draft', ids?: string[]) => {
    if (!selected) return
    const scope = ids?.length ? `${ids.length} selected design(s)` : `ALL of "${selected}"`
    if (!window.confirm(`${status === 'active' ? 'Activate (go live)' : 'Deactivate (back to draft)'} ${scope}?`)) return
    try {
      setBusy(true)
      setError(null)
      const response = await api.post('/api/admin/design-library/set-status', {
        status,
        ...(ids?.length ? { product_ids: ids } : { collection: selected })
      })
      flash(`${response.data.updated} design(s) → ${status}. ${response.data.note}`)
      fetchCollections()
      fetchProducts(selected, statusFilter, offset)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  // Reuses the existing per-product Create Mockups endpoint (flat-lay + ghost
  // mannequin + Mr. Imagine via Replicate) — the worker falls back to the
  // design PNG in products.images. Deliberate button, not automatic: ~3 paid
  // renders per design.
  const createMockups = async () => {
    const ids = [...checked]
    if (ids.length === 0) return
    if (!window.confirm(
      `Generate mockups for ${ids.length} design(s)? Each design queues ~3 Replicate renders (costs a few cents per design). They appear on the products as they finish.`
    )) return
    setMockupRun({ done: 0, total: ids.length })
    setError(null)
    let failed = 0
    for (const id of ids) {
      try {
        await aiProducts.createMockups(id)
      } catch (err: any) {
        failed++
        console.error('mockup enqueue failed:', id, err?.message)
      }
      setMockupRun(prev => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }
    setMockupRun(null)
    setChecked(new Set())
    flash(`Mockup jobs queued for ${ids.length - failed} design(s)${failed ? ` (${failed} failed to queue)` : ''}. The worker renders them over the next while — images attach automatically.`)
  }

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex gap-6">
      {/* Collections sidebar */}
      <div className="w-72 shrink-0 bg-white rounded-2xl shadow-soft border border-slate-100 p-4 self-start">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold text-slate-900 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-purple-600" /> Collections
          </h3>
          <button onClick={fetchCollections} className="p-1.5 text-slate-400 hover:text-slate-700" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading && !selected ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="space-y-1 max-h-[70vh] overflow-y-auto">
          {collections.map(c => (
            <button key={c.name} onClick={() => setSelected(c.name)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selected === c.name ? 'bg-purple-600 text-white' : 'hover:bg-slate-100 text-slate-700'
              }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{c.name}</span>
                <span className={`text-xs shrink-0 ${selected === c.name ? 'text-purple-200' : 'text-slate-400'}`}>
                  {c.active > 0 && <span className={selected === c.name ? '' : 'text-emerald-600'}>{c.active} live</span>}
                  {c.active > 0 && c.draft > 0 && ' · '}
                  {c.draft > 0 && `${c.draft} draft`}
                </span>
              </div>
            </button>
          ))}
          {collections.length === 0 && !loading && (
            <p className="text-sm text-slate-500 px-2">No imported designs yet.</p>
          )}
        </div>
      </div>

      {/* Design grid */}
      <div className="flex-1 bg-white rounded-2xl shadow-soft border border-slate-100 p-6 min-w-0">
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        {notice && <div className="text-sm text-emerald-600 mb-3">{notice}</div>}

        {!selected ? (
          <div className="text-slate-500 text-sm py-16 text-center">
            Pick a collection to review its designs. Activate a whole collection or hand-pick designs to go live.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-display font-bold text-slate-900">{selected}</h3>
                <div className="flex gap-1">
                  {(['all', 'draft', 'active'] as const).map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${
                        statusFilter === s ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {checked.size > 0 ? (
                  <>
                    <button onClick={() => setStatus('active', [...checked])} disabled={busy || !!mockupRun}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircle className="w-4 h-4" /> Activate {checked.size}
                    </button>
                    <button onClick={createMockups} disabled={busy || !!mockupRun}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                      <Shirt className="w-4 h-4" />
                      {mockupRun ? `Queueing ${mockupRun.done}/${mockupRun.total}…` : `Mockups for ${checked.size}`}
                    </button>
                    <button onClick={() => setStatus('draft', [...checked])} disabled={busy || !!mockupRun}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50">
                      <EyeOff className="w-4 h-4" /> Draft {checked.size}
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setStatus('active')} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircle className="w-4 h-4" /> Activate collection
                    </button>
                    <button onClick={() => setStatus('draft')} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50">
                      <EyeOff className="w-4 h-4" /> All to draft
                    </button>
                  </>
                )}
              </div>
            </div>

            {loading ? (
              <div className="text-slate-500 text-sm py-16 text-center">Loading designs…</div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {products.map(p => (
                    <button key={p.id} onClick={() => toggle(p.id)}
                      className={`text-left border rounded-xl p-2 transition-all ${
                        checked.has(p.id) ? 'border-purple-500 ring-2 ring-purple-200' : 'border-slate-100 hover:border-slate-300'
                      }`}>
                      <div className="aspect-square bg-slate-50 rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                        {p.images?.[0] && <img src={p.images[0]} alt={p.name} loading="lazy" className="max-w-full max-h-full object-contain" />}
                      </div>
                      <div className="text-xs font-medium text-slate-800 truncate" title={p.name}>{p.name}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-slate-400">${Number(p.price).toFixed(2)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>{p.status === 'active' ? 'LIVE' : p.status}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
                  <span>{total} design(s){checked.size > 0 ? ` · ${checked.size} selected` : ''}</span>
                  <div className="flex items-center gap-2">
                    <button disabled={offset === 0}
                      onClick={() => selected && fetchProducts(selected, statusFilter, Math.max(0, offset - pageSize))}
                      className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                    <span>{Math.floor(offset / pageSize) + 1} / {Math.max(1, Math.ceil(total / pageSize))}</span>
                    <button disabled={offset + pageSize >= total}
                      onClick={() => selected && fetchProducts(selected, statusFilter, offset + pageSize)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
