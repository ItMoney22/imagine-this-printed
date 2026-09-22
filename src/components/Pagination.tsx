// One pagination control for every paged admin/vendor list.
//
// Before this, the dashboards did not paginate at all — they fetched whole
// tables and filtered in the browser — so there was no existing control to
// reuse and no risk of a second one drifting. Keeping it in one place means the
// range wording ("1–50 of 2,602") and the disabled states behave the same on
// every tab. Colours come from the semantic tokens only (DESIGN.md §3).
import React from 'react'

export interface PaginationProps {
  /** 1-indexed. */
  page: number
  /** Rows per page. */
  limit: number
  /** Total matching rows across all pages, from the server count. */
  total: number
  onPageChange: (page: number) => void
  /** Shown instead of "rows" in the range label, e.g. "customers". */
  label?: string
  /** Disables both buttons while a fetch is in flight. */
  busy?: boolean
  className?: string
}

const nf = new Intl.NumberFormat()

export const Pagination: React.FC<PaginationProps> = ({
  page,
  limit,
  total,
  onPageChange,
  label = 'rows',
  busy = false,
  className = ''
}) => {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(limit, 1)))
  const first = total === 0 ? 0 : (page - 1) * limit + 1
  const last = Math.min(page * limit, total)

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-primary/10 ${className}`}
    >
      <p className="text-sm text-muted" aria-live="polite">
        {total === 0 ? (
          <>No {label} match this view</>
        ) : (
          <>
            Showing <span className="font-semibold text-text">{nf.format(first)}</span>–
            <span className="font-semibold text-text">{nf.format(last)}</span> of{' '}
            <span className="font-semibold text-text">{nf.format(total)}</span> {label}
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={busy || page <= 1}
          className="px-4 py-2 bg-card border border-primary/20 rounded-lg text-sm font-medium text-text hover:bg-primary/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Previous
        </button>
        <span className="text-sm text-muted whitespace-nowrap">
          Page {nf.format(page)} of {nf.format(totalPages)}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={busy || page >= totalPages}
          className="px-4 py-2 bg-card border border-primary/20 rounded-lg text-sm font-medium text-text hover:bg-primary/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default Pagination
