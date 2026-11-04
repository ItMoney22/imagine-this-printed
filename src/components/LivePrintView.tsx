import { useEffect, useState } from 'react'
import { Clock, PlayCircle } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { LIVE_POLL_MS } from '../lib/live-print'

// The live printer view on an order (Watchtower task 528180f9). The API answers
// only the order's signed-in owner; anyone else gets a 404 and sees nothing here.

interface LiveLine {
  lineItemId: string
  state: 'printing' | 'waiting' | 'done' | 'stopped'
  headline: string
  progress: number | null
  frameUrl: string | null
  frameAt: string | null
  isLive: boolean
  timelapseUrl: string | null
}

const fmtFrameAt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function LiveLineCard({ line }: { line: LiveLine }) {
  // A frame link can lapse between polls. The next poll brings a new one.
  const [deadFrame, setDeadFrame] = useState<string | null>(null)
  const frameUrl = line.frameUrl !== deadFrame ? line.frameUrl : null
  const live = line.isLive && !!frameUrl

  return (
    <div className="rounded-xl border border-border bg-card p-4 text-text">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 font-semibold">{line.headline}</p>
        {live ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden="true" />
            Live
          </span>
        ) : line.frameAt ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Last update {fmtFrameAt(line.frameAt)}
          </span>
        ) : null}
      </div>

      {frameUrl && (
        <img
          src={frameUrl}
          alt="The latest picture of your print on the printer"
          className="mt-3 aspect-video w-full rounded-lg border border-border-subtle object-cover"
          onError={() => setDeadFrame(frameUrl)}
        />
      )}

      {line.state === 'printing' && line.progress !== null && (
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-label="Print progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(line.progress)}
        >
          <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${line.progress}%` }} />
        </div>
      )}

      {line.timelapseUrl && (
        <a
          href={line.timelapseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          Watch the timelapse
        </a>
      )}
    </div>
  )
}

export default function LivePrintView({
  orderId,
  poll = true,
  className = ''
}: {
  orderId: string
  poll?: boolean
  className?: string
}) {
  const [lines, setLines] = useState<LiveLine[]>([])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setInterval> | undefined

    const stop = () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }

    async function load() {
      if (stopped || document.hidden) return
      try {
        const data = await apiFetch(`/api/orders/${orderId}/live`)
        if (!stopped) setLines(Array.isArray(data?.lines) ? data.lines : [])
      } catch (err) {
        // Not this customer's order: asking again will not change that.
        // Anything else (a blip, a token mid-refresh) keeps the last view up.
        if (err instanceof Error && err.message.startsWith('HTTP 404')) stop()
      }
    }

    load()
    if (poll) {
      timer = setInterval(load, LIVE_POLL_MS)
      document.addEventListener('visibilitychange', load)
    }
    return stop
  }, [orderId, poll])

  if (lines.length === 0) return null

  return (
    <div className={`space-y-3 ${className}`}>
      {lines.map(line => (
        <LiveLineCard key={line.lineItemId} line={line} />
      ))}
    </div>
  )
}
