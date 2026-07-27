/**
 * Founder earnings — derivation helpers over REAL invoice data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CANONICAL 35% RULE (single source of truth — do not fork it again)
 * ─────────────────────────────────────────────────────────────────────────────
 * The founder share is **35% of the invoice subtotal**, floored to whole cents:
 *
 *     founder_earnings_cents = Math.floor(subtotal_cents * 35 / 100)
 *
 * It is a REVENUE share on what the client is billed — NOT a profit share.
 * COGS and Stripe processing fees are absorbed by the platform's 65%, they are
 * not deducted before the split.
 *
 * Why this method and not "35% of profit after COGS + Stripe fees":
 *   1. It is what the backend already computes and PERSISTS per invoice
 *      (`backend/routes/invoices.ts` → `founder_earnings_cents`). Those rows are
 *      the money record behind real Stripe invoices; re-deriving them under a
 *      different formula would silently restate amounts already billed/paid.
 *   2. `founder_invoices` carries no cost basis at all — there is no COGS column
 *      and no per-line cost — so a profit-based split is not computable from the
 *      data that exists. The old profit formula only "worked" because it ran on
 *      hardcoded mock numbers.
 *   3. It is deterministic for the founder: they can read a share off any
 *      invoice subtotal without knowing internal costs.
 *
 * `calculateFounderShareCents()` below mirrors the backend arithmetic EXACTLY
 * (same `Math.floor`) so a client-side preview always matches the stored value
 * to the cent. If the rate ever changes, change `FOUNDER_PERCENTAGE` in
 * `backend/routes/invoices.ts` first — the backend is the source of truth, and
 * every persisted invoice also stores its own `founder_percentage` so historical
 * rows keep the rate they were issued under.
 *
 * NOTE — a third, unrelated formula lives in
 * `backend/routes/admin/control-panel.ts` (`totalPlatformFees * founderRate`,
 * i.e. 35% of the 7% platform fee on marketplace ORDERS). That is a different
 * surface (admin-wide order revenue, not founder invoices) and is intentionally
 * left alone here; see the follow-up task in the handoff.
 */

export const FOUNDER_PERCENTAGE = 35

export type FounderInvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'void'
  | 'uncollectible'

export interface FounderInvoiceLineItem {
  description: string
  amount_cents: number
  quantity: number
}

/** Shape returned by GET /api/invoices (table `founder_invoices`). */
export interface FounderInvoice {
  id: string
  client_email: string
  client_name: string | null
  subtotal_cents: number
  platform_fee_cents: number
  founder_earnings_cents: number
  founder_percentage: number | string
  invoice_type?: 'admin' | 'founder'
  status: FounderInvoiceStatus
  line_items: FounderInvoiceLineItem[] | null
  memo: string | null
  due_date: string | null
  created_at: string
  sent_at: string | null
  paid_at: string | null
  stripe_hosted_invoice_url: string | null
}

/** Shape returned by GET /api/invoices/stats/summary. */
export interface InvoiceStatsSummary {
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
  total_billed: number
  total_collected: number
  total_earnings: number
  pending_earnings: number
}

export type EarningsPeriod = 'week' | 'month' | 'quarter' | 'year' | 'all'

export interface EarningsSummary {
  invoiceCount: number
  /** Subtotal billed across live (non-void, non-uncollectible) invoices. */
  billedCents: number
  /** Subtotal on invoices that have actually been paid. */
  collectedCents: number
  /** Founder share realised — share on PAID invoices only. */
  earnedCents: number
  /** Founder share billed to a client but not yet collected (sent + overdue). */
  pendingCents: number
  /** Founder share sitting in unsent drafts — not billed to anyone yet. */
  draftCents: number
  /** Platform's 65% on paid invoices. */
  platformCents: number
  /** Realised share ÷ collected subtotal, as a percentage (0 when nothing paid). */
  effectiveSharePercent: number
}

export interface MonthlyEarnings {
  /** `YYYY-MM`, sortable. */
  month: string
  /** e.g. `Jul 2026`. */
  label: string
  invoiceCount: number
  billedCents: number
  collectedCents: number
  earnedCents: number
  pendingCents: number
}

export interface BilledItemTotal {
  description: string
  quantity: number
  billedCents: number
  /** Pro-rata slice of the parent invoices' founder_earnings_cents. */
  founderShareCents: number
  invoiceCount: number
}

/** Invoices that were voided or written off never represent money. */
const DEAD_STATUSES: ReadonlySet<FounderInvoiceStatus> = new Set([
  'void',
  'uncollectible'
])

/** Billed to a client and awaiting collection. */
const OUTSTANDING_STATUSES: ReadonlySet<FounderInvoiceStatus> = new Set([
  'sent',
  'overdue'
])

export function isLiveInvoice(invoice: FounderInvoice): boolean {
  return !DEAD_STATUSES.has(invoice.status)
}

function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Founder share for a subtotal, in cents.
 *
 * Mirrors `backend/routes/invoices.ts` exactly, including the floor, so a
 * preview rendered here equals the value the backend persists.
 */
export function calculateFounderShareCents(
  subtotalCents: number,
  founderPercentage: number = FOUNDER_PERCENTAGE
): number {
  const subtotal = toNumber(subtotalCents)
  const rate = toNumber(founderPercentage)
  if (subtotal <= 0 || rate <= 0) return 0
  return Math.floor(subtotal * (rate / 100))
}

/** Start of the window for a period, relative to `now`. `all` returns null. */
export function periodStart(period: EarningsPeriod, now: Date = new Date()): Date | null {
  if (period === 'all') return null
  const start = new Date(now.getTime())
  switch (period) {
    case 'week':
      start.setDate(start.getDate() - 7)
      break
    case 'month':
      start.setMonth(start.getMonth() - 1)
      break
    case 'quarter':
      start.setMonth(start.getMonth() - 3)
      break
    case 'year':
      start.setFullYear(start.getFullYear() - 1)
      break
  }
  return start
}

/** Filter invoices to a period by the date the invoice was raised. */
export function filterByPeriod(
  invoices: FounderInvoice[],
  period: EarningsPeriod,
  now: Date = new Date()
): FounderInvoice[] {
  const start = periodStart(period, now)
  if (!start) return [...invoices]
  const cutoff = start.getTime()
  return invoices.filter(inv => {
    const raised = Date.parse(inv.created_at)
    return Number.isFinite(raised) && raised >= cutoff
  })
}

/** Roll a set of real invoice rows up into the numbers the page displays. */
export function summarizeInvoices(invoices: FounderInvoice[]): EarningsSummary {
  const summary: EarningsSummary = {
    invoiceCount: 0,
    billedCents: 0,
    collectedCents: 0,
    earnedCents: 0,
    pendingCents: 0,
    draftCents: 0,
    platformCents: 0,
    effectiveSharePercent: 0
  }

  for (const inv of invoices) {
    if (!isLiveInvoice(inv)) continue

    const subtotal = toNumber(inv.subtotal_cents)
    const share = toNumber(inv.founder_earnings_cents)

    summary.invoiceCount += 1
    summary.billedCents += subtotal

    if (inv.status === 'paid') {
      summary.collectedCents += subtotal
      summary.earnedCents += share
      summary.platformCents += toNumber(inv.platform_fee_cents)
    } else if (OUTSTANDING_STATUSES.has(inv.status)) {
      summary.pendingCents += share
    } else if (inv.status === 'draft') {
      summary.draftCents += share
    }
  }

  summary.effectiveSharePercent =
    summary.collectedCents > 0
      ? (summary.earnedCents / summary.collectedCents) * 100
      : 0

  return summary
}

/** Count live invoices per status (void/uncollectible included for visibility). */
export function countByStatus(
  invoices: FounderInvoice[]
): Record<FounderInvoiceStatus, number> {
  const counts: Record<FounderInvoiceStatus, number> = {
    draft: 0,
    sent: 0,
    paid: 0,
    overdue: 0,
    void: 0,
    uncollectible: 0
  }
  for (const inv of invoices) {
    if (inv.status in counts) counts[inv.status] += 1
  }
  return counts
}

/**
 * Real month-by-month series, grouped by the date each invoice was raised
 * (`created_at`). Only months that actually contain invoices are returned —
 * there is no padding, interpolation or projection.
 */
export function groupEarningsByMonth(invoices: FounderInvoice[]): MonthlyEarnings[] {
  const buckets = new Map<string, MonthlyEarnings>()

  for (const inv of invoices) {
    if (!isLiveInvoice(inv)) continue

    const raised = new Date(inv.created_at)
    if (Number.isNaN(raised.getTime())) continue

    const month = `${raised.getFullYear()}-${String(raised.getMonth() + 1).padStart(2, '0')}`
    let bucket = buckets.get(month)
    if (!bucket) {
      bucket = {
        month,
        label: raised.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        invoiceCount: 0,
        billedCents: 0,
        collectedCents: 0,
        earnedCents: 0,
        pendingCents: 0
      }
      buckets.set(month, bucket)
    }

    const subtotal = toNumber(inv.subtotal_cents)
    const share = toNumber(inv.founder_earnings_cents)

    bucket.invoiceCount += 1
    bucket.billedCents += subtotal

    if (inv.status === 'paid') {
      bucket.collectedCents += subtotal
      bucket.earnedCents += share
    } else if (OUTSTANDING_STATUSES.has(inv.status)) {
      bucket.pendingCents += share
    }
  }

  return [...buckets.values()].sort((a, b) => b.month.localeCompare(a.month))
}

/**
 * Real "what am I actually billing for" breakdown, aggregated from the
 * `line_items` stored on each invoice. The founder share per item is a
 * pro-rata slice of that invoice's persisted `founder_earnings_cents`, so the
 * item shares always sum back to the invoice totals.
 */
export function topBilledItems(
  invoices: FounderInvoice[],
  limit = 5
): BilledItemTotal[] {
  // Track contributing invoice ids per bucket separately, so `invoiceCount`
  // counts distinct invoices rather than distinct line rows.
  const invoiceIds = new Map<string, Set<string>>()
  const buckets = new Map<string, BilledItemTotal>()

  for (const inv of invoices) {
    if (!isLiveInvoice(inv)) continue
    if (!Array.isArray(inv.line_items) || inv.line_items.length === 0) continue

    const subtotal = toNumber(inv.subtotal_cents)
    const share = toNumber(inv.founder_earnings_cents)

    for (const item of inv.line_items) {
      const description = (item?.description || 'Untitled item').trim() || 'Untitled item'
      const key = description.toLowerCase()
      const quantity = Math.max(1, toNumber(item?.quantity) || 1)
      const lineCents = toNumber(item?.amount_cents) * quantity

      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = {
          description,
          quantity: 0,
          billedCents: 0,
          founderShareCents: 0,
          invoiceCount: 0
        }
        buckets.set(key, bucket)
        invoiceIds.set(key, new Set<string>())
      }

      const seen = invoiceIds.get(key)!
      seen.add(inv.id)

      bucket.quantity += quantity
      bucket.billedCents += lineCents
      bucket.founderShareCents += subtotal > 0 ? Math.round(share * (lineCents / subtotal)) : 0
      bucket.invoiceCount = seen.size
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.billedCents - a.billedCents)
    .slice(0, limit)
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function centsToDollars(cents: number): number {
  return toNumber(cents) / 100
}

export function formatCents(cents: number): string {
  return formatCurrency(centsToDollars(cents))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(toNumber(amount))
}

export function formatPercentage(value: number): string {
  return `${toNumber(value).toFixed(1)}%`
}
