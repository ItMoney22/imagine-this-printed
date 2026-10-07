import { useEffect } from 'react'
import { X, Ruler } from 'lucide-react'

export interface SizeGuideRow {
  size: string
  chest: string
  length: string
}

interface SizeGuideProps {
  open: boolean
  onClose: () => void
  /** The blank's house name, e.g. "Classic Heavy Cotton". */
  title: string
  /** "Compared to Gildan 5000" — how the shopper can check against a shirt they own. */
  compareTo?: string
  adult: SizeGuideRow[]
  youth?: SizeGuideRow[]
}

function Table({ caption, rows }: { caption?: string; rows: SizeGuideRow[] }) {
  return (
    <div>
      {caption && <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">{caption}</p>}
      <table className="w-full text-sm border border-border rounded-xl overflow-hidden">
        <thead className="bg-bg-warm text-text">
          <tr>
            <th className="text-left font-semibold px-3 py-2">Size</th>
            <th className="text-left font-semibold px-3 py-2">Chest (flat)</th>
            <th className="text-left font-semibold px-3 py-2">Length</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.size} className="border-t border-border">
              <td className="px-3 py-2 font-semibold text-text">{r.size}</td>
              <td className="px-3 py-2 text-text-secondary">{r.chest}"</td>
              <td className="px-3 py-2 text-text-secondary">{r.length}"</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Size guide (task 63520e95): the blank's real measurements, from
 * src/lib/size-charts.ts. Opens from the "Size guide" link beside Size.
 */
export function SizeGuide({ open, onClose, title, compareTo, adult, youth }: SizeGuideProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Size guide"
        className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-card rounded-t-3xl sm:rounded-3xl shadow-soft-xl p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-2xl text-text flex items-center gap-2">
              <Ruler className="w-5 h-5 text-primary" /> Size guide
            </h2>
            <p className="text-sm text-muted mt-1">
              {title}
              {compareTo ? ` · ${compareTo}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-xl hover:bg-border-subtle" aria-label="Close size guide">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-5">
          <Table caption={youth && youth.length ? 'Adult' : undefined} rows={adult} />
          {youth && youth.length > 0 && <Table caption="Youth" rows={youth} />}
        </div>
        <p className="text-xs text-muted mt-4 leading-relaxed">
          Inches, measured on the shirt laid flat: chest straight across one inch below the armholes, length from the top of
          the shoulder to the hem at the back. Lay a shirt you love flat and compare.
        </p>
      </div>
    </div>
  )
}
