import React, { useState, useEffect } from 'react'
import { Send, RefreshCw, Trash2, Undo2, CheckCircle, PlusCircle } from 'lucide-react'
import api from '../lib/api'

interface OutboxItem {
  id: string
  product_id: string | null
  platform: string
  kind: 'post' | 'listing'
  caption: string | null
  hashtags: string[]
  media_urls: string[]
  listing: Record<string, any>
  status: 'draft' | 'approved' | 'claimed' | 'posted' | 'failed'
  post_url: string | null
  result_note: string | null
  created_at: string
  products?: { name: string; slug: string | null; images: string[] } | null
}

const STATUSES: Array<OutboxItem['status']> = ['draft', 'approved', 'claimed', 'posted', 'failed']

export default function AdminSocialOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [statusFilter, setStatusFilter] = useState<OutboxItem['status']>('draft')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { caption: string; hashtags: string }>>({})

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 4000)
  }

  const fetchItems = async (status = statusFilter) => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/api/social-outbox', { params: { status } })
      setItems(response.data.items || [])
      setCounts(response.data.counts || {})
      setEdits({})
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load outbox')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchItems() }, [statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveEdits = async (item: OutboxItem) => {
    const edit = edits[item.id]
    if (!edit) return true
    try {
      await api.put(`/api/social-outbox/${item.id}`, {
        caption: edit.caption,
        hashtags: edit.hashtags.split(/[\s,]+/).filter(Boolean).map(h => (h.startsWith('#') ? h : `#${h}`))
      })
      return true
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save edits')
      return false
    }
  }

  const act = async (item: OutboxItem, action: 'approve' | 'unapprove' | 'delete') => {
    try {
      setBusy(item.id)
      setError(null)
      if (action === 'approve') {
        if (!(await saveEdits(item))) return
        await api.post(`/api/social-outbox/${item.id}/approve`)
        flash('Approved — Rico will pick it up')
      } else if (action === 'unapprove') {
        await api.post(`/api/social-outbox/${item.id}/unapprove`)
        flash('Pulled back to draft')
      } else {
        if (!window.confirm('Delete this outbox item?')) return
        await api.delete(`/api/social-outbox/${item.id}`)
        flash('Deleted')
      }
      fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to ${action}`)
    } finally {
      setBusy(null)
    }
  }

  const enqueueMissing = async () => {
    try {
      setBusy('enqueue')
      const response = await api.post('/api/social-outbox/enqueue-missing')
      flash(`Queued ${response.data.enqueued} new draft(s) from active products`)
      fetchItems('draft')
      setStatusFilter('draft')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to enqueue')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
            <Send className="w-5 h-5 text-purple-600" /> TikTok Outbox
            <span className="text-sm font-normal text-slate-400">— you approve, Rico posts</span>
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={enqueueMissing} disabled={busy === 'enqueue'}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50">
              <PlusCircle className="w-4 h-4" /> Queue missing actives
            </button>
            <button onClick={() => fetchItems()} className="p-2 text-slate-400 hover:text-slate-700" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                statusFilter === s ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {s} {counts[s] ? `(${counts[s]})` : ''}
            </button>
          ))}
        </div>

        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        {notice && <div className="text-sm text-emerald-600 mb-3">{notice}</div>}

        {loading ? (
          <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-slate-500 text-sm py-8 text-center">
            {statusFilter === 'draft'
              ? 'No drafts waiting. New designs auto-queue here when they go active, or hit "Queue missing actives".'
              : `Nothing ${statusFilter}.`}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => {
              const edit = edits[item.id] ?? {
                caption: item.caption || '',
                hashtags: (item.hashtags || []).join(' ')
              }
              const editable = ['draft', 'approved', 'failed'].includes(item.status)
              return (
                <div key={item.id} className={`border rounded-xl p-4 flex gap-4 ${item.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-slate-100'}`}>
                  {item.media_urls?.[0] && (
                    <img src={item.media_urls[0]} alt="" className="w-20 h-20 object-contain rounded-lg bg-slate-50 border border-slate-100 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {item.products?.name || 'Product'}
                      <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 capitalize">{item.kind}</span>
                      {item.post_url && (
                        <a href={item.post_url} target="_blank" rel="noreferrer" className="text-xs text-purple-600 hover:underline">view post ↗</a>
                      )}
                    </div>
                    {item.result_note && <div className="text-xs text-red-600 mt-0.5">{item.result_note}</div>}
                    {editable ? (
                      <>
                        <textarea
                          value={edit.caption}
                          onChange={e => setEdits(prev => ({ ...prev, [item.id]: { ...edit, caption: e.target.value } }))}
                          rows={2}
                          className="mt-2 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                        />
                        <input
                          value={edit.hashtags}
                          onChange={e => setEdits(prev => ({ ...prev, [item.id]: { ...edit, hashtags: e.target.value } }))}
                          placeholder="#hashtags"
                          className="mt-1 w-full text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-500"
                        />
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{item.caption}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{(item.hashtags || []).join(' ')}</p>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {(item.status === 'draft' || item.status === 'failed') && (
                      <button onClick={() => act(item, 'approve')} disabled={busy === item.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                      </button>
                    )}
                    {item.status === 'approved' && (
                      <button onClick={() => act(item, 'unapprove')} disabled={busy === item.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50">
                        <Undo2 className="w-3.5 h-3.5" /> Pull back
                      </button>
                    )}
                    {item.status !== 'claimed' && (
                      <button onClick={() => act(item, 'delete')} disabled={busy === item.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-400 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
