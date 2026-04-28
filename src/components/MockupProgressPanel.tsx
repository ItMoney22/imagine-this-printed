// Inline progress bar shown under the "Create Mockups" buttons while the
// AdminDashboard polls ai_jobs for live status. Renders three states:
//   * polling (some jobs still queued/running) — animated bar + count
//   * complete with all succeeded — green success
//   * complete with at least one failure — amber warning + retry hint
import React from 'react'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

export interface MockupProgress {
  total: number
  succeeded: number
  failed: number
  polling: boolean
}

export const MockupProgressPanel: React.FC<{ progress: MockupProgress }> = ({ progress }) => {
  const { total, succeeded, failed, polling } = progress
  const finished = succeeded + failed
  // Progress bar width — show at least 5% even when nothing's done so the
  // bar is visible (better feedback than a 0%-width bar that looks broken).
  const pctRaw = total > 0 ? Math.round((finished / total) * 100) : 0
  const pct = polling ? Math.max(pctRaw, 5) : pctRaw

  const allDone = !polling
  const allSucceeded = allDone && failed === 0 && succeeded === total
  const someFailed = allDone && failed > 0

  const barColor = someFailed
    ? 'bg-amber-500'
    : allSucceeded
    ? 'bg-emerald-500'
    : 'bg-gradient-to-r from-indigo-500 to-purple-500'

  return (
    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {polling ? (
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          ) : someFailed ? (
            <AlertCircle className="w-4 h-4 text-amber-600" />
          ) : (
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          )}
          {polling
            ? `Generating mockups… ${finished}/${total}`
            : someFailed
            ? `Mockups complete with ${failed} failure${failed === 1 ? '' : 's'}`
            : `${total} mockup${total === 1 ? '' : 's'} ready`}
        </div>
        <span className="text-xs text-slate-500 tabular-nums">{pctRaw}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-500 ${polling ? 'animate-pulse' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {polling && (
        <p className="text-[11px] text-slate-500 mt-1.5">
          Each mockup takes ~30-60 seconds. The page will refresh when they're ready.
        </p>
      )}
      {someFailed && !polling && (
        <p className="text-[11px] text-amber-700 mt-1.5">
          Click "Create Mockups" again to retry the failed ones.
        </p>
      )}
      {allSucceeded && (
        <p className="text-[11px] text-emerald-700 mt-1.5">
          Mockups added to the product gallery.
        </p>
      )}
    </div>
  )
}

export default MockupProgressPanel
