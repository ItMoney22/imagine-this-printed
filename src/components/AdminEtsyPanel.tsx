import React, { useState, useEffect } from 'react'
import { Store, RefreshCw, ExternalLink } from 'lucide-react'
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

export default function AdminEtsyPanel() {
  const [status, setStatus] = useState<EtsyStatus | null>(null)
  const [listings, setListings] = useState<EtsyListingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = async () => {
    try {
      setLoading(true)
      setError(null)
      const statusRes = await api.get('/api/admin/etsy/status')
      setStatus(statusRes.data)
      // The ledger lives behind the same guard but reads a table that only exists
      // once the migration has run, so a failure here must not blank the panel.
      try {
        const listingRes = await api.get('/api/admin/etsy/listings')
        setListings(listingRes.data?.results ?? [])
      } catch {
        setListings([])
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

  const counts = STATES.map(s => ({ state: s, n: listings.filter(l => l.state === s).length }))
  const problems = listings.filter(l => l.state === 'blocked' || l.state === 'error').slice(0, 5)

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
            <div className="flex flex-wrap gap-2 mb-4">
              {counts.filter(c => c.n > 0).map(c => (
                <span key={c.state} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${STATE_STYLES[c.state]}`}>
                  {c.state}: <strong>{c.n}</strong>
                </span>
              ))}
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
        </>
      )}
    </div>
  )
}
