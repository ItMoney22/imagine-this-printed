import React, { useState, useEffect, useCallback } from 'react'
import { Lightbulb, RefreshCw, Check, X, ExternalLink, Clock, Flame } from 'lucide-react'
import api from '../lib/api'
import { MrImagineAvatar } from './mr-imagine'
import { useToast } from '../hooks/useToast'

/**
 * Mr Imagine's Trend Scout (admin tab). He pitches landing pages grounded in
 * what the world is going through right now; approving a pitch files a build
 * task on the Watchtower board (source itp-mr-imagine -> his avatar on the
 * card). Replaces hand-building seasonal pages like July 4th / World Cup.
 */

interface TrendSuggestion {
  id: string
  title: string
  slug: string
  concept: string
  trend_rationale: string
  product_ideas: string[]
  urgency: 'low' | 'medium' | 'high' | 'critical'
  launch_window: string | null
  status: 'pending' | 'approved' | 'dismissed' | 'built'
  watchtower_task_id: string | null
  created_at: string
}

const URGENCY_STYLES: Record<TrendSuggestion['urgency'], string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
}

const FILTERS = ['pending', 'approved', 'dismissed'] as const
type Filter = (typeof FILTERS)[number]

const AdminTrendScout: React.FC = () => {
  const toast = useToast()
  const [suggestions, setSuggestions] = useState<TrendSuggestion[]>([])
  const [filter, setFilter] = useState<Filter>('pending')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [actingOn, setActingOn] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/trend-scout/suggestions')
      setSuggestions(res.data.suggestions || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to load suggestions')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const generate = async () => {
    setGenerating(true)
    try {
      const res = await api.post('/api/admin/trend-scout/generate')
      const fresh: TrendSuggestion[] = res.data.suggestions || []
      setSuggestions(prev => [...fresh, ...prev])
      setFilter('pending')
      toast.success(`Mr Imagine pitched ${fresh.length} new landing pages`)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Mr Imagine hit a snag — try again')
    } finally {
      setGenerating(false)
    }
  }

  const approve = async (s: TrendSuggestion) => {
    setActingOn(s.id)
    try {
      const res = await api.post(`/api/admin/trend-scout/suggestions/${s.id}/approve`)
      setSuggestions(prev => prev.map(x => (x.id === s.id ? res.data.suggestion : x)))
      toast.success(
        res.data.task_id
          ? `Filed on the Watchtower — task ${String(res.data.task_id).slice(0, 8)}`
          : 'Approved and filed on the Watchtower'
      )
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Approval failed — task NOT filed')
    } finally {
      setActingOn(null)
    }
  }

  const dismiss = async (s: TrendSuggestion) => {
    setActingOn(s.id)
    try {
      const res = await api.post(`/api/admin/trend-scout/suggestions/${s.id}/dismiss`)
      setSuggestions(prev => prev.map(x => (x.id === s.id ? res.data.suggestion : x)))
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Dismiss failed')
    } finally {
      setActingOn(null)
    }
  }

  const visible = suggestions.filter(s => s.status === filter)
  const pendingCount = suggestions.filter(s => s.status === 'pending').length

  return (
    <div className="space-y-6">
      {/* Header: Mr Imagine pitches, David decides */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <MrImagineAvatar size="lg" pose="waistUp" expression="thinking" />
          <div className="flex-1">
            <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-amber-500" />
              Mr Imagine&apos;s Trend Scout
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              He watches what the world is going through and pitches the landing pages he wants to
              build. Approve a pitch and it&apos;s filed on the Watchtower board for the fleet —
              with his avatar on the card.
            </p>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium text-sm hover:from-purple-700 hover:to-pink-700 disabled:opacity-60 transition-all shadow-lg"
          >
            <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Scouting the trends…' : 'Ask for fresh pitches'}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${
              filter === f ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-white/20 text-xs">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Suggestion cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500 text-sm">
          {filter === 'pending'
            ? 'No open pitches — ask Mr Imagine for fresh ones.'
            : `Nothing ${filter} yet.`}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map(s => (
            <div key={s.id} className="bg-white rounded-2xl shadow-soft border border-slate-100 p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-display font-bold text-slate-900">{s.title}</h4>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">/{s.slug}</p>
                </div>
                <span className={`shrink-0 px-2 py-1 rounded-full text-xs font-semibold capitalize ${URGENCY_STYLES[s.urgency]}`}>
                  {s.urgency === 'critical' && <Flame className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
                  {s.urgency}
                </span>
              </div>

              <p className="text-sm text-slate-700">{s.concept}</p>

              <div className="text-sm bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-800">
                <span className="font-semibold">Why now:</span> {s.trend_rationale}
              </div>

              {s.product_ideas.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {s.product_ideas.map((p, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs">{p}</span>
                  ))}
                </div>
              )}

              {s.launch_window && (
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {s.launch_window}
                </p>
              )}

              {s.status === 'pending' ? (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => approve(s)}
                    disabled={actingOn === s.id}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-60 transition-colors"
                  >
                    <Check className="w-4 h-4" /> Approve → Watchtower
                  </button>
                  <button
                    onClick={() => dismiss(s)}
                    disabled={actingOn === s.id}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 disabled:opacity-60 transition-colors"
                  >
                    <X className="w-4 h-4" /> Pass
                  </button>
                </div>
              ) : s.status === 'approved' ? (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  <Check className="w-4 h-4" />
                  On the Watchtower
                  {s.watchtower_task_id && (
                    <a
                      href="https://davidtrinidad.com/dashboard/lineup"
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-green-700 underline"
                    >
                      task {s.watchtower_task_id.slice(0, 8)} <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Passed — Mr Imagine won&apos;t pitch this again.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AdminTrendScout
