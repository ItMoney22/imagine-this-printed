import React, { useState, useEffect } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import api from '../lib/api'

interface StalledOrder {
  id: string
  order_number: string | null
  customer_email: string | null
  total: number
  status: string
  fulfillment_status: string | null
  age_days: number
}

interface MonitorStatus {
  worker: { last_seen: string | null; ok: boolean }
  database: { ok: boolean }
  orders_24h: { paid: number; revenue: number }
  stalled_orders: StalledOrder[]
  pending_approvals: number
  low_stock_count: number
  ai_jobs_failed_24h: number
  checked_at: string
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
      ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
    }`}>
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {label}
    </span>
  )
}

function CountChip({ count, label, warnAt = 1 }: { count: number; label: string; warnAt?: number }) {
  const warn = count >= warnAt
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
      warn ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
    }`}>
      {label}: <strong>{count}</strong>
    </span>
  )
}

export default function AdminOpsMonitor() {
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/api/admin/monitor/status')
      setStatus(response.data)
    } catch (err: any) {
      console.error('Error fetching ops status:', err)
      setError(err.response?.data?.error || 'Failed to load ops status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 120000) // refresh every 2 min
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-purple-600" /> Ops Monitor
        </h3>
        <button onClick={fetchStatus} className="p-2 text-slate-400 hover:text-slate-700" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

      {!status && loading ? (
        <div className="text-sm text-slate-500">Checking systems…</div>
      ) : status && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <Chip ok={status.database.ok} label="Database" />
            <Chip ok={status.worker.ok} label={status.worker.ok ? 'Worker' : 'Worker down'} />
            <CountChip count={status.stalled_orders.length} label="Stalled orders" />
            <CountChip count={status.low_stock_count} label="Low stock" />
            <CountChip count={status.pending_approvals} label="Pending approvals" warnAt={5} />
            <CountChip count={status.ai_jobs_failed_24h} label="AI fails 24h" warnAt={5} />
          </div>

          <div className="text-sm text-slate-600 mb-3">
            Last 24h: <strong>{status.orders_24h.paid}</strong> paid orders,{' '}
            <strong>${status.orders_24h.revenue.toFixed(2)}</strong> revenue
            {!status.worker.ok && status.worker.last_seen && (
              <span className="text-red-600"> · worker last seen {new Date(status.worker.last_seen).toLocaleString()}</span>
            )}
          </div>

          {status.stalled_orders.length > 0 && (
            <div className="border border-red-100 bg-red-50 rounded-xl p-4">
              <div className="text-sm font-semibold text-red-700 mb-2">
                Paid orders stuck &gt; 3 days — work these first
              </div>
              <div className="space-y-1">
                {status.stalled_orders.slice(0, 8).map(o => (
                  <div key={o.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">
                      {o.order_number || o.id.slice(0, 8)} · {o.status}/{o.fulfillment_status || 'unfulfilled'}
                      {o.customer_email && <span className="text-slate-400"> · {o.customer_email}</span>}
                    </span>
                    <span className="text-red-600 font-medium">{o.age_days}d · ${o.total.toFixed(2)}</span>
                  </div>
                ))}
                {status.stalled_orders.length > 8 && (
                  <div className="text-xs text-slate-500">…and {status.stalled_orders.length - 8} more</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
