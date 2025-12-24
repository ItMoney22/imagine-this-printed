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
    label: 'Approval',
    description: 'Review your concept'
  },
  {
    key: 'generating_angles',
    label: 'Multi-View',
    description: 'Generating 4 angles'
  },
  {
    key: 'generating_3d',
    label: '3D Model',
    description: 'Converting to 3D'
  },
  {
    key: 'ready',
    label: 'Complete',
    description: 'Ready to download'
  }
]

const STATUS_ORDER: Record<Model3DStatus, number> = {
  queued: 0,
  generating_concept: 1,
  awaiting_approval: 2,
  generating_angles: 3,
  generating_3d: 4,
  ready: 5,
  failed: -1
}

export function Model3DStatusProgress({
  status,
  errorMessage,
  className = ''
}: Model3DStatusProgressProps) {
  const currentIndex = STATUS_ORDER[status]
  const isFailed = status === 'failed'

  return (
    <div className={`${className}`}>
      {/* Progress Steps */}
      <div className="relative">
        {/* Progress Line */}
        <div className="absolute top-4 left-4 right-4 h-0.5 bg-border">
          <div
            className={`h-full transition-all duration-500 ${
              isFailed ? 'bg-red-500' : 'bg-gradient-to-r from-purple-500 to-pink-500'
            }`}
            style={{
              width: isFailed ? '0%' : `${Math.max(0, (currentIndex / (STEPS.length - 1)) * 100)}%`
            }}
          />
        </div>

        {/* Step Circles */}
        <div className="relative flex justify-between">
          {STEPS.map((step, index) => {
            const isCompleted = currentIndex > index
            const isCurrent = currentIndex === index
            const isPending = currentIndex < index

            return (
              <div key={step.key} className="flex flex-col items-center">
                {/* Circle */}
                <div
                  className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isFailed && isCurrent
                      ? 'bg-red-500 text-white'
                      : isCompleted
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                      : isCurrent
                      ? 'bg-purple-500 text-white ring-4 ring-purple-500/30'
                      : 'bg-card border-2 border-border text-muted'
                  }`}
                >
                  {isFailed && isCurrent ? (
                    <XCircle className="w-4 h-4" />
                  ) : isCompleted ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={`mt-2 text-xs font-medium text-center ${
                    isFailed && isCurrent
                      ? 'text-red-400'
                      : isCompleted || isCurrent
                      ? 'text-text'
                      : 'text-muted'
                  }`}
                >
                  {step.label}
                </span>

                {/* Description (only for current step) */}
                {isCurrent && !isFailed && (
                  <span className="mt-0.5 text-xs text-muted text-center max-w-[80px]">
                    {step.description}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Error Message */}
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
