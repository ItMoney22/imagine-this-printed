/**
 * Pure aggregation helpers for founder invoice statistics.
 *
 * Deliberately IMPORT-FREE (no express / stripe / supabase) so the money maths
 * behind `GET /api/invoices/stats/summary` can be transpiled and exercised
 * standalone, without a database or a running server.
 *
 * The founder-share rule these numbers roll up is documented in
 * `backend/routes/invoices.ts` (the canonical source) and mirrored on the
 * frontend in `src/utils/founder-earnings.ts`.
 */

/**
 * Founder earnings percentage — a REVENUE share of `subtotal_cents`, floored to
 * whole cents. See the long-form rationale on `FOUNDER_PERCENTAGE` in
 * `backend/routes/invoices.ts`.
 */
export const FOUNDER_PERCENTAGE = 35

/** Mirrors `src/utils/founder-earnings.ts` → `calculateFounderShareCents()`. */
export function calculateFounderShareCents(
  subtotalCents: number,
  founderPercentage: number = FOUNDER_PERCENTAGE
): number {
  const subtotal = Number(subtotalCents)
  const rate = Number(founderPercentage)
  if (!Number.isFinite(subtotal) || !Number.isFinite(rate) || subtotal <= 0 || rate <= 0) {
    return 0
  }
  return Math.floor(subtotal * (rate / 100))
}

/**
 * Statuses that get their own counter on the summary. The table's CHECK
 * constraint also permits 'uncollectible', which has no counter here — hence
 * the guard, so an uncollectible row can't turn a count into NaN.
 */
export const COUNTED_STATUSES: readonly string[] = [
  'draft',
  'sent',
  'paid',
  'overdue',
  'void'
]

export type CountedStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void'

/** Statuses that represent no money: voided or written off. */
export const DEAD_STATUSES: readonly string[] = ['void', 'uncollectible']

/** Billed to a client and still owed. Overdue counts — it is not a blind spot. */
export const OUTSTANDING_STATUSES: readonly string[] = ['sent', 'overdue']

export interface InvoiceStatsRow {
  status: string
  subtotal_cents: number
  founder_earnings_cents: number
}

export interface InvoiceStatsCents {
  total_invoices: number
  draft: number
  sent: number
  paid: number
  overdue: number
  void: number
  total_billed_cents: number
  total_collected_cents: number
  total_earnings_cents: number
  pending_earnings_cents: number
}

export interface InvoiceStats extends InvoiceStatsCents {
  total_billed: number
  total_collected: number
  total_earnings: number
  pending_earnings: number
}

function toCents(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Roll invoice rows up into the summary payload the API returns. */
export function buildInvoiceStats(rows: InvoiceStatsRow[] | null | undefined): InvoiceStats {
  const stats: InvoiceStatsCents = {
    total_invoices: rows?.length || 0,
    draft: 0,
    sent: 0,
    paid: 0,
    overdue: 0,
    void: 0,
    total_billed_cents: 0,
    total_collected_cents: 0,
    total_earnings_cents: 0,
    pending_earnings_cents: 0
  }

  for (const inv of rows || []) {
    const status = String(inv?.status || '')

    if (COUNTED_STATUSES.indexOf(status) !== -1) {
      stats[status as CountedStatus]++
    }

    // Voided / written-off invoices never represent money billed.
    if (DEAD_STATUSES.indexOf(status) !== -1) continue

    const subtotal = toCents(inv?.subtotal_cents)
    const share = toCents(inv?.founder_earnings_cents)

    stats.total_billed_cents += subtotal

    if (status === 'paid') {
      stats.total_collected_cents += subtotal
      stats.total_earnings_cents += share
    } else if (OUTSTANDING_STATUSES.indexOf(status) !== -1) {
      stats.pending_earnings_cents += share
    }
  }

  return {
    ...stats,
    total_billed: stats.total_billed_cents / 100,
    total_collected: stats.total_collected_cents / 100,
    total_earnings: stats.total_earnings_cents / 100,
    pending_earnings: stats.pending_earnings_cents / 100
  }
}
