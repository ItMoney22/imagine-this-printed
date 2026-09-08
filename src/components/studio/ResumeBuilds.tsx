// "Pick up where you left off" — every Step Flow build that isn't finished.
//
// David 2026-09-08: "idk where to pick up the step flow i already am doing."
// Once a design is pulled into the flow it leaves the Designs grid's To-do
// view, so without this a half-built product is genuinely hard to find again:
// it is one draft row among thousands in the catalog. This strip sits on the
// builder itself, which is where you go when you want to carry on building.
import React, { useEffect, useState } from 'react'
import { PlayCircle, RefreshCw } from 'lucide-react'
import { type StepFlowBuild } from '../../lib/api'
import { useStudioLane } from './lane'

interface ResumeBuildsProps {
  /** Opens this build in the builder (sets ?productId= on the page). */
  onResume: (productId: string) => void
}

const ResumeBuilds: React.FC<ResumeBuildsProps> = ({ onResume }) => {
  const lane = useStudioLane()
  const [builds, setBuilds] = useState<StepFlowBuild[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { builds } = await lane.api.inProgress()
      setBuilds(builds)
    } catch (err: any) {
      setError(err?.message || 'Could not load your builds in progress')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Nothing half-built is the normal, healthy state — say nothing rather than
  // taking up the top of the page with an empty box.
  if (!loading && !error && builds.length === 0) return null

  return (
    <div className="mb-6 rounded-2xl border border-white/10 bg-card/40 backdrop-blur-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-text">
          Pick up where you left off
          {builds.length > 0 && <span className="ml-2 text-xs font-medium text-muted">{builds.length} in progress</span>}
        </h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="p-1.5 text-muted hover:text-text disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading && builds.length === 0 && !error && <p className="text-xs text-muted">Loading…</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {builds.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onResume(b.id)}
            className="text-left rounded-xl border border-white/10 hover:border-primary/50 bg-bg/40 p-2 transition-colors"
          >
            <div className="aspect-square rounded-lg bg-card-elevated mb-2 overflow-hidden flex items-center justify-center">
              {b.image && <img src={b.image} alt={b.name ?? 'Build'} loading="lazy" className="max-w-full max-h-full object-contain" />}
            </div>
            <div className="text-xs font-semibold text-text truncate" title={b.name ?? undefined}>
              {b.name || 'Untitled design'}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-primary">
              <PlayCircle className="w-3 h-3 shrink-0" />
              Resume · {b.stageLabel}
            </div>
            {b.collection && <div className="text-[10px] text-muted truncate mt-0.5">{b.collection}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}

export default ResumeBuilds
