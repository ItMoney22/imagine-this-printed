import React, { useState, useEffect, useCallback } from 'react'
import {
  X, RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion, Unlock,
  Image as ImageIcon, Crosshair, Type, Search, DollarSign, Aperture, History
} from 'lucide-react'
import api from '../lib/api'

// ---------------------------------------------------------------------------
// The presentation QA review drawer. Watchtower task 9ec9444a.
//
// This is where a human sees WHY a design is not live. It deliberately shows
// three things in this order:
//   1. the verdict, in one line
//   2. what to FIX, as instructions rather than complaints
//   3. the submission history, so "is this getting better" is answerable
//
// None of the thresholds live here. Every number on screen arrives from the
// endpoint, so a retuned threshold can never leave this panel disagreeing with
// the gate that actually blocks activation — same rule the print-quality badge
// already follows in AdminDesignLibrary.
// ---------------------------------------------------------------------------

type Channel = 'storefront' | 'etsy'
type Severity = 'block' | 'warn'

interface Finding {
  criterion?: string
  severity: Severity
  issue: string
  fix: string
  evidence?: Record<string, unknown>
}

interface CriterionVerdict {
  ok: boolean
  unverified?: boolean
  summary: string
  findings: Finding[]
  measured?: Record<string, unknown>
}

interface Review {
  id: string
  channel: Channel
  submission_no: number
  status: 'passed' | 'failed' | 'overridden' | 'error'
  score: number | null
  criteria: Record<string, CriterionVerdict>
  rework: Finding[]
  submitted_by: string
  model: string | null
  duration_ms: number | null
  override_reason: string | null
  override_by: string | null
  created_at: string
}

interface GateState {
  allowed: boolean
  code: 'passed' | 'overridden' | 'never_reviewed' | 'failed' | 'stale'
  reason: string
}

const CRITERION_META: Record<string, { label: string; Icon: typeof ImageIcon }> = {
  mockup_quality: { label: 'Mockup quality', Icon: ImageIcon },
  design_placement: { label: 'Design placement', Icon: Crosshair },
  typography: { label: 'Typography', Icon: Type },
  seo: { label: 'Title, description & tags', Icon: Search },
  pricing: { label: 'Pricing sanity', Icon: DollarSign },
  image_sharpness: { label: 'Image sharpness', Icon: Aperture }
}

const CRITERION_ORDER = [
  'mockup_quality', 'design_placement', 'typography', 'seo', 'pricing', 'image_sharpness'
]

const labelFor = (id?: string) => (id && CRITERION_META[id]?.label) || id || 'General'

interface Props {
  productId: string
  productName: string
  channel?: Channel
  onClose: () => void
  /** Fired after a review or override changes the gate, so the grid can refetch. */
  onChanged?: () => void
}

export default function DesignQaPanel({ productId, productName, channel = 'storefront', onClose, onChanged }: Props) {
  const [activeChannel, setActiveChannel] = useState<Channel>(channel)
  const [gate, setGate] = useState<GateState | null>(null)
  const [history, setHistory] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get(`/api/admin/design-qa/product/${productId}`, { params: { channel: activeChannel } })
      setGate(response.data.gate)
      setHistory(response.data.history || [])
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load the QA record')
    } finally {
      setLoading(false)
    }
  }, [productId, activeChannel])

  useEffect(() => { load() }, [load])

  const runReview = async () => {
    try {
      setRunning(true)
      setError(null)
      // A failing review answers 422 — that is a verdict, not an error, so it is
      // read from the rejection rather than surfaced as "something went wrong".
      await api.post(`/api/admin/design-qa/submit/${productId}`, { channel: activeChannel })
    } catch (err: any) {
      if (err.response?.status !== 422) setError(err.response?.data?.error || 'The review could not be run')
    } finally {
      setRunning(false)
      await load()
      onChanged?.()
    }
  }

  const override = async () => {
    const reason = window.prompt(
      `Ship "${productName}" despite failing QA?\n\n` +
      'The findings stay on the record. Say why this is acceptable — it is stored against your name.'
    )
    if (!reason || reason.trim().length < 10) return
    try {
      setRunning(true)
      setError(null)
      await api.post(`/api/admin/design-qa/override/${productId}`, { reason, channel: activeChannel })
      await load()
      onChanged?.()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Override failed')
    } finally {
      setRunning(false)
    }
  }

  const latest = history[0] ?? null
  const blocking = (latest?.rework ?? []).filter(f => f.severity === 'block')
  const warnings = (latest?.rework ?? []).filter(f => f.severity !== 'block')

  const GateIcon = !gate ? ShieldQuestion : gate.allowed ? ShieldCheck : gate.code === 'never_reviewed' ? ShieldQuestion : ShieldAlert
  const gateTone = !gate
    ? 'bg-slate-50 border-slate-200 text-slate-700'
    : gate.allowed
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : gate.code === 'never_reviewed'
        ? 'bg-slate-50 border-slate-200 text-slate-700'
        : 'bg-red-50 border-red-200 text-red-800'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full overflow-y-auto bg-white shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-display font-bold text-slate-900 truncate" title={productName}>{productName}</h2>
              <p className="text-xs text-slate-500 mt-0.5">Presentation QA — every design clears this before it goes live.</p>
            </div>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 shrink-0" title="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="flex gap-1">
              {(['storefront', 'etsy'] as const).map(c => (
                <button key={c} onClick={() => setActiveChannel(c)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${
                    activeChannel === c ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <button onClick={runReview} disabled={running}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
              {running ? 'Reviewing…' : latest ? 'Re-run QA' : 'Run QA'}
            </button>
            {latest?.status === 'failed' && (
              <button onClick={override} disabled={running}
                title="Ship this design despite the failure — recorded against your name"
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 disabled:opacity-50">
                <Unlock className="w-4 h-4" /> Override
              </button>
            )}
          </div>
        </div>

        <div className="px-6 py-4 space-y-5 flex-1">
          {error && <div className="text-sm text-red-600">{error}</div>}

          {/* verdict */}
          <div className={`flex items-start gap-3 rounded-xl border p-3 ${gateTone}`}>
            <GateIcon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {!gate ? 'Loading…' : gate.allowed ? 'Cleared to go live' : 'Blocked from going live'}
                {latest?.score != null && <span className="ml-2 font-normal opacity-80">score {latest.score}/100</span>}
              </div>
              <div className="text-xs mt-0.5 opacity-90">{gate?.reason}</div>
            </div>
          </div>

          {loading ? (
            <div className="text-slate-500 text-sm py-12 text-center">Loading the QA record…</div>
          ) : !latest ? (
            <div className="text-slate-500 text-sm py-12 text-center">
              This design has never been reviewed. Run QA to check its mockups, placement, typography, copy, price and sharpness.
            </div>
          ) : (
            <>
              {/* criteria */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Criteria</h3>
                <div className="space-y-1.5">
                  {CRITERION_ORDER.map(id => {
                    const verdict = latest.criteria?.[id]
                    if (!verdict) return null
                    const { label, Icon } = CRITERION_META[id]
                    return (
                      <div key={id} className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                        verdict.ok ? 'border-slate-100 bg-white' : 'border-red-200 bg-red-50'
                      }`}>
                        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${verdict.ok ? 'text-slate-400' : 'text-red-600'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-800">{label}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                              verdict.unverified ? 'bg-slate-200 text-slate-600'
                                : verdict.ok ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {verdict.unverified ? 'NOT CHECKED' : verdict.ok ? 'PASS' : 'FAIL'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{verdict.summary}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* rework */}
              {blocking.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-2">
                    Must fix before this can go live
                  </h3>
                  <ul className="space-y-2">
                    {blocking.map((f, i) => (
                      <li key={i} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-red-500">{labelFor(f.criterion)}</div>
                        <div className="text-sm text-red-900 mt-0.5">{f.issue}</div>
                        <div className="text-xs text-red-700 mt-1"><span className="font-semibold">Fix:</span> {f.fix}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {warnings.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">
                    Worth fixing — not blocking
                  </h3>
                  <ul className="space-y-2">
                    {warnings.map((f, i) => (
                      <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">{labelFor(f.criterion)}</div>
                        <div className="text-sm text-amber-900 mt-0.5">{f.issue}</div>
                        <div className="text-xs text-amber-800 mt-1"><span className="font-semibold">Fix:</span> {f.fix}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* audit trail */}
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  <History className="w-3.5 h-3.5" /> Submission history
                </h3>
                <ul className="space-y-1">
                  {history.map(r => (
                    <li key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-xs">
                      <span className="font-mono text-slate-400 shrink-0">#{r.submission_no}</span>
                      <span className={`px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${
                        r.status === 'passed' ? 'bg-emerald-100 text-emerald-700'
                          : r.status === 'overridden' ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-700'
                      }`}>{r.status.toUpperCase()}</span>
                      <span className="text-slate-500 capitalize shrink-0">{r.channel}</span>
                      {r.score != null && <span className="text-slate-400 shrink-0">{r.score}/100</span>}
                      <span className="text-slate-500 truncate" title={r.override_reason || r.submitted_by}>
                        {r.override_reason ? `overridden by ${r.override_by}: ${r.override_reason}` : r.submitted_by}
                      </span>
                      <span className="text-slate-400 ml-auto shrink-0">{new Date(r.created_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
