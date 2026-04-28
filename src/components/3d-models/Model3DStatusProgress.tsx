import { CheckCircle, Circle, Loader2, XCircle } from 'lucide-react'
import type { Model3DStatus } from '../../types'

interface Model3DStatusProgressProps {
  status: Model3DStatus
  errorMessage?: string | null
  className?: string
}

interface Step {
  key: Model3DStatus | 'complete'
  label: string
  description: string
}

const STEPS: Step[] = [
  {
    key: 'queued',
    label: 'Queued',
    description: 'Waiting in queue'
  },
  {
    key: 'generating_concept',
    label: 'Concept',
    description: 'Creating initial design'
  },
  {
    key: 'awaiting_approval',
    label: 'Pick size',
    description: 'Choose print size + tier'
  },
  {
    key: 'generating_3d',
    label: '3D Model',
    description: 'Tripo3D conversion'
  },
  {
    key: 'ready',
    label: 'Complete',
    description: 'Print-ready STL'
  }
]

const STATUS_ORDER: Record<Model3DStatus, number> = {
  queued: 0,
  generating_concept: 1,
  awaiting_approval: 2,         // "Pick size" step — implicit approval via Generate
  awaiting_3d_generation: 2,    // alias if DB is migrated later
  generating_angles: 2,         // legacy slot
  generating_3d: 3,
  ready: 4,
  failed: -1
}

export function Model3DStatusProgress({
  status,
  errorMessage,
  className = ''
}: Model3DStatusProgressProps) {
  const currentIndex = STATUS_ORDER[status]
  const isFailed = status === 'failed'
  const currentStep = STEPS[currentIndex] ?? STEPS[0]
  const completedSteps = isFailed ? 0 : Math.max(0, currentIndex)
  const percentage = isFailed
    ? 0
    : status === 'ready'
      ? 100
      : Math.round(((currentIndex + (status === 'generating_concept' || status === 'generating_3d' ? 0.5 : 0)) / STEPS.length) * 100)

  // Big-picture state copy that explains exactly what's happening RIGHT NOW
  const headline = isFailed
    ? 'Generation failed'
    : status === 'ready'
      ? 'Print-ready! 🎉'
      : status === 'queued'
        ? 'Queued — your job is in line'
        : status === 'generating_concept'
          ? 'Creating your concept image…'
          : status === 'awaiting_approval'
            ? 'Concept ready — pick a print size to continue'
            : status === 'awaiting_3d_generation'
              ? 'Pick a print size to start the 3D conversion'
              : status === 'generating_angles'
                ? 'Generating multi-view angles…'
                : status === 'generating_3d'
                  ? 'Tripo3D is sculpting your model — this takes 1–3 minutes'
                  : 'Working…'

  const subheadline = isFailed
    ? 'Don\'t worry — no ITC was charged. Try again with a different prompt.'
    : status === 'ready'
      ? 'Your STL is ready to download or send to your printer.'
      : status === 'awaiting_approval' || status === 'awaiting_3d_generation'
          ? 'No ITC charge until you click generate. Bigger sizes use higher mesh detail.'
          : status === 'generating_concept' || status === 'generating_3d' || status === 'generating_angles'
            ? 'You can close this and check back later — we\'ll keep working.'
            : ''

  return (
    <div className={className}>
      {/* HERO STATUS PANEL — high-contrast, unmissable */}
      <div className={`mb-4 rounded-2xl p-5 border-2 ${
        isFailed
          ? 'bg-red-500/10 border-red-500/40'
          : status === 'ready'
            ? 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_30px_rgba(16,185,129,0.2)]'
            : status === 'awaiting_approval' || status === 'awaiting_3d_generation'
              ? 'bg-amber-500/10 border-amber-500/40 shadow-[0_0_25px_rgba(245,158,11,0.15)]'
              : 'bg-primary/10 border-primary/40 shadow-[0_0_25px_rgba(168,85,247,0.18)]'
      }`}>
        <div className="flex items-start gap-4">
          {/* Big animated/static icon */}
          <div className={`flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center ${
            isFailed
              ? 'bg-red-500/20 text-red-400'
              : status === 'ready'
                ? 'bg-emerald-500/20 text-emerald-400'
                : status === 'awaiting_approval' || status === 'awaiting_3d_generation'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-primary/20 text-primary'
          }`}>
            {isFailed ? (
              <XCircle className="w-7 h-7" />
            ) : status === 'ready' ? (
              <CheckCircle className="w-7 h-7" />
            ) : status === 'awaiting_approval' || status === 'awaiting_3d_generation' ? (
              <Circle className="w-7 h-7" />
            ) : (
              <Loader2 className="w-7 h-7 animate-spin" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1 gap-3">
              <h3 className="text-lg font-bold text-text leading-tight">{headline}</h3>
              {!isFailed && (
                <span className="flex-shrink-0 text-xs uppercase tracking-wider text-muted font-mono">
                  Step {Math.min(currentIndex + 1, STEPS.length)}/{STEPS.length}
                </span>
              )}
            </div>
            {subheadline && <p className="text-sm text-muted">{subheadline}</p>}

            {/* Big percent bar */}
            {!isFailed && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted font-medium">{currentStep?.description ?? ''}</span>
                  <span className="text-xs text-text/80 font-mono">{percentage}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-bg/60 border border-white/5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ease-out ${
                      status === 'ready'
                        ? 'bg-gradient-to-r from-emerald-400 to-green-500'
                        : 'bg-gradient-to-r from-primary via-purple-400 to-secondary shadow-[0_0_10px_rgba(168,85,247,0.5)]'
                    }`}
                    style={{ width: `${Math.max(2, percentage)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step pill row — at-a-glance breadcrumb of all steps */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {STEPS.map((step, index) => {
          const isCompleted = !isFailed && completedSteps > index
          const isCurrent = currentIndex === index && !isFailed
          return (
            <div
              key={step.key}
              className={`p-2.5 rounded-xl border text-center transition-all ${
                isFailed && isCurrent
                  ? 'border-red-500/50 bg-red-500/10'
                  : isCompleted
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : isCurrent
                      ? 'border-primary/50 bg-primary/10 ring-2 ring-primary/30 shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                      : 'border-white/10 bg-bg/30'
              }`}
            >
              <div className="flex items-center justify-center mb-1.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                  isFailed && isCurrent
                    ? 'bg-red-500/30 text-red-300'
                    : isCompleted
                      ? 'bg-emerald-500/30 text-emerald-300'
                      : isCurrent
                        ? 'bg-primary/30 text-primary'
                        : 'bg-white/5 text-muted/60'
                }`}>
                  {isFailed && isCurrent ? (
                    <XCircle className="w-3.5 h-3.5" />
                  ) : isCompleted ? (
                    <CheckCircle className="w-3.5 h-3.5" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span className="text-[10px] font-bold">{index + 1}</span>
                  )}
                </div>
              </div>
              <p className={`text-[11px] font-semibold leading-tight ${
                isCompleted ? 'text-emerald-300' : isCurrent ? 'text-primary' : 'text-muted/70'
              }`}>
                {step.label}
              </p>
            </div>
          )
        })}
      </div>

      {/* Error detail */}
      {isFailed && errorMessage && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-400">Generation Failed</p>
              <p className="text-xs text-red-400/70 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Compact inline status indicator
 */
export function Model3DStatusBadge({ status }: { status: Model3DStatus }) {
  const config: Record<Model3DStatus, { label: string; className: string }> = {
    queued: { label: 'Queued', className: 'bg-gray-500/20 text-gray-400' },
    generating_concept: { label: 'Generating...', className: 'bg-blue-500/20 text-blue-400' },
    awaiting_approval: { label: 'Needs Approval', className: 'bg-amber-500/20 text-amber-400' },
    awaiting_3d_generation: { label: 'Pick size', className: 'bg-primary/20 text-primary' },
    generating_angles: { label: 'Multi-View...', className: 'bg-purple-500/20 text-purple-400' },
    generating_3d: { label: 'Creating 3D...', className: 'bg-pink-500/20 text-pink-400' },
    ready: { label: 'Ready', className: 'bg-green-500/20 text-green-400' },
    failed: { label: 'Failed', className: 'bg-red-500/20 text-red-400' }
  }

  const { label, className } = config[status]
  const isProcessing = ['generating_concept', 'generating_angles', 'generating_3d'].includes(status)

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {isProcessing && <Loader2 className="w-3 h-3 animate-spin" />}
      {label}
    </span>
  )
}

export default Model3DStatusProgress
