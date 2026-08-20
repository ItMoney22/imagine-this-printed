import { useCallback, useEffect, useState } from 'react'
import { mrsImagine } from '../lib/api'

// Mrs. Imagine's admin card — trigger a batch, watch it run, see what she
// shipped. She researches live Etsy data, designs on gpt-image-2, reviews her
// own work through the vision QA gate, then queues Etsy DRAFTS: the only human
// step left is hitting Active in Etsy Shop Manager.

interface DesignRow {
  key: string
  kind: 'garment' | 'metal'
  slug?: string
  status: 'live' | 'draft_rework' | 'error'
  detail?: string
  storefrontScore?: number
  etsyScore?: number
  etsyQueued?: string[]
  attempts: number
}

interface BatchRun {
  id: string
  status: string
  input?: { garments?: number; metal?: number; requestedBy?: string | null }
  output?: { stage?: string; progress?: string[]; designs?: DesignRow[] }
  error?: string | null
  created_at: string
  updated_at: string
}

const STATUS_BADGE: Record<string, string> = {
  live: 'bg-emerald-100 text-emerald-800',
  draft_rework: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-700',
}

export default function AdminMrsImagine() {
  const [runs, setRuns] = useState<BatchRun[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { runs } = await mrsImagine.runs()
      setRuns(runs ?? [])
    } catch {
      // Card stays quiet if the route isn't deployed yet.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Poll while a batch is running so the progress feed moves on its own.
  const running = runs.some((r) => r.status === 'running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void load(), 10_000)
    return () => clearInterval(t)
  }, [running, load])

  const startRun = async () => {
    if (!confirm('Send Mrs. Imagine to work? She researches live Etsy data, designs 10 garments + 5 metal prints on GPT Image 2, reviews her own mockups, and queues Etsy DRAFTS. Nothing goes live on Etsy without you.')) return
    setBusy(true)
    setMessage(null)
    try {
      const { batchId } = await mrsImagine.run()
      setMessage(`Batch started (${batchId.slice(0, 8)}…) — she'll report here as designs finish.`)
      await load()
    } catch (e: any) {
      setMessage(e.message)
    } finally {
      setBusy(false)
    }
  }

  const latest = runs[0]

  return (
    <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <img
            src="/mrs-imagine/mrs-imagine-head.png"
            alt="Mrs. Imagine"
            className="w-16 h-16 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div>
            <h3 className="text-lg font-display font-bold text-slate-900">Mrs. Imagine</h3>
            <p className="text-sm text-slate-500">
              Live Etsy research → GPT Image 2 designs → mockups → her own QA review → Etsy drafts.
              You only hit <span className="font-semibold">Active</span>.
            </p>
          </div>
        </div>
        <button
          onClick={startRun}
          disabled={busy || running}
          className="shrink-0 px-4 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 text-white font-semibold transition-colors"
        >
          {running ? 'Batch running…' : busy ? 'Starting…' : 'Run a batch'}
        </button>
      </div>

      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}

      {latest && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${latest.status === 'running' ? 'bg-blue-100 text-blue-800' : latest.status === 'succeeded' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>
              {latest.status}{latest.output?.stage ? ` · ${latest.output.stage}` : ''}
            </span>
            <span className="text-slate-400">{new Date(latest.created_at).toLocaleString()}</span>
            {latest.error && <span className="text-red-600 truncate">{latest.error}</span>}
          </div>

          {latest.status === 'running' && (latest.output?.progress?.length ?? 0) > 0 && (
            <div className="text-xs font-mono text-slate-500 bg-slate-50 rounded-lg p-2 max-h-24 overflow-y-auto">
              {latest.output!.progress!.slice(-6).map((line, i) => (
                <div key={i} className="truncate">{line.replace(/^\S+\s/, '')}</div>
              ))}
            </div>
          )}

          {(latest.output?.designs?.length ?? 0) > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {latest.output!.designs!.map((d) => (
                <div key={d.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[d.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {d.status === 'live' ? 'live' : d.status === 'draft_rework' ? 'rework' : 'error'}
                  </span>
                  <span className="font-medium text-slate-800 truncate">{d.key}</span>
                  <span className="text-slate-400">{d.kind}</span>
                  {d.storefrontScore != null && <span className="text-slate-500">store {d.storefrontScore}/100</span>}
                  {d.etsyScore != null && <span className="text-slate-500">etsy {d.etsyScore}/100</span>}
                  {(d.etsyQueued?.length ?? 0) > 0 && (
                    <span className="text-emerald-700 text-xs">→ Etsy: {d.etsyQueued!.join(', ')}</span>
                  )}
                  {d.slug && (
                    <a href={`/product/${d.slug}`} target="_blank" rel="noreferrer" className="ml-auto text-fuchsia-600 hover:underline text-xs">
                      view
                    </a>
                  )}
                  {d.detail && d.status !== 'live' && (
                    <span className="text-xs text-slate-400 truncate max-w-[16rem]" title={d.detail}>{d.detail}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {runs.length > 1 && (
        <button
          onClick={() => setExpanded(expanded ? null : 'history')}
          className="mt-3 text-xs text-slate-400 hover:text-slate-600"
        >
          {expanded ? 'Hide' : 'Show'} previous batches ({runs.length - 1})
        </button>
      )}
      {expanded && (
        <div className="mt-2 space-y-1">
          {runs.slice(1).map((r) => (
            <div key={r.id} className="text-xs text-slate-500 flex gap-2">
              <span>{new Date(r.created_at).toLocaleDateString()}</span>
              <span>{r.status}</span>
              <span>{(r.output?.designs ?? []).filter((d) => d.status === 'live').length} live / {(r.output?.designs ?? []).length}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
