import { useEffect, useState } from 'react'
import './progress-note.css'

/**
 * A waiting step at checkout (task b9656cc9, approved mock 0c21434e): what is
 * happening in plain words, a slim purple bar that moves, and how long it has
 * taken. Replaces the spinners and the yellow "Loading payment form" box.
 */
export function ProgressNote({ title, detail }: { title: string; detail?: string }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div role="status" aria-live="polite" className="py-1">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-text">{title}</p>
        {seconds > 0 && <span className="text-xs text-muted tabular-nums">{seconds}s</span>}
      </div>
      {detail && <p className="text-xs text-muted mt-0.5">{detail}</p>}
      <div className="mt-2.5 h-1.5 rounded-full bg-border-subtle overflow-hidden">
        <div className="progress-note-fill h-full w-1/3 rounded-full bg-primary" />
      </div>
    </div>
  )
}
